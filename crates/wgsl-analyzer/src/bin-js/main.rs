//! Driver for wgsl-analyzer.
//!
//! Based on cli flags, either spawns an LSP server, or runs a batch analysis.

#![expect(clippy::print_stdout, reason = "CLI tool")]

use std::{env, fs, path::PathBuf, process::ExitCode, str::FromStr as _, sync::Arc};

use anyhow::Context as _;
use lsp_server::{Connection, Message, Notification};
use lsp_types::{
    InitializeParams, InitializeResult, MessageType, Notification as _, ServerInfo,
    ShowMessageNotification, ShowMessageParams, WorkspaceFolders,
};
use paths::{AbsPathBuf, Utf8Component, Utf8Path, Utf8PathBuf, Utf8Prefix};
use tracing::info;
use tracing_subscriber::fmt::writer::BoxMakeWriter;
use wgsl_analyzer::{
    Result,
    cli::flags,
    config::{Config, ConfigChange, ConfigErrors},
    from_json,
};

mod emscripten_io;

fn main() -> Result<ExitCode> {
    let flags = flags::WgslAnalyzer::from_env_or_exit();

    #[expect(clippy::unimplemented, reason = "TODO")]
    #[expect(
        clippy::wildcard_enum_match_arm,
        reason = "future variants are not a current concern"
    )]
    match flags.subcommand {
        flags::WgslAnalyzerCmd::LspServer(command) => {
            if command.print_config_schema {
                println!("{:#}", Config::json_schema());
            } else if command.version {
                println!("wgsl-analyzer {}", wgsl_analyzer::version());
            } else {
                // wgsl-analyzer’s “main thread” is actually
                // a secondary latency-sensitive thread with an increased stack size.
                // We use this thread intent because any delay in the main loop
                // will make actions like hitting enter in the editor slow.
                with_extra_thread(
                    "LspServer",
                    stdx::thread::ThreadIntent::LatencySensitive,
                    run_server,
                )?;
            }

            Ok(ExitCode::SUCCESS)
        },
        _ => unimplemented!("subcommand not implemented"),
    }
}

fn run_server() -> anyhow::Result<()> {
    tracing::info!("server version {} will start", wgsl_analyzer::version());

    // Under emscripten, stdin reads are proxied to the main runtime thread and
    // block it; see wasm_io for why that deadlocks. Use postMessage instead.
    let (connection, io_threads) = emscripten_io::connection();

    let (initialize_id, initialize_parameters) = match connection.initialize_start() {
        Ok((initialize_id, initialize_parameters)) => (initialize_id, initialize_parameters),
        Err(error) => {
            if error.channel_is_disconnected() {
                io_threads.join()?;
            }
            return Err(error.into());
        },
    };

    tracing::info!("InitializeParameters: {}", initialize_parameters);
    let InitializeParams {
        #[expect(deprecated, reason = "migration TODO")]
        root_uri,
        capabilities,
        workspace_folders_initialize_params,
        initialization_options,
        client_info,
        ..
    } = from_json::<InitializeParams, _>("InitializeParameters", &initialize_parameters)?;

    let root_path = if let Some(path) = root_uri
        .and_then(|uri| uri.to_file_path().ok())
        .and_then(|path| Utf8PathBuf::from_path_buf(path).ok())
        .and_then(|path| AbsPathBuf::try_from(path).ok())
    {
        path
    } else {
        let cwd = env::current_dir()?;
        AbsPathBuf::assert_utf8(cwd)
    };

    if let Some(client_info) = &client_info {
        tracing::info!(
            "Client '{}' {}",
            client_info.name,
            client_info.version.as_deref().unwrap_or_default()
        );
    }

    let workspace_roots = workspace_folders_initialize_params
        .workspace_folders
        .and_then(|workspaces| match workspaces {
            WorkspaceFolders::WorkspaceFolderList(workspace_folders) => Some(workspace_folders),
            WorkspaceFolders::Null => None,
        })
        .map(|workspaces| {
            workspaces
                .into_iter()
                .filter_map(|folder| folder.uri.to_file_path().ok())
                .filter_map(|path| Utf8PathBuf::from_path_buf(path).ok())
                .filter_map(|path| AbsPathBuf::try_from(path).ok())
                .collect::<Vec<_>>()
        })
        .filter(|workspaces| !workspaces.is_empty())
        .unwrap_or_else(|| vec![root_path.clone()]);
    let mut config = Config::new(root_path, capabilities, workspace_roots, client_info);
    if let Some(json) = initialization_options {
        let mut change = ConfigChange::default();
        change.change_client_config(json);

        let error_sink: ConfigErrors;
        (config, error_sink, _) = config.apply_change(change);

        if !error_sink.is_empty() {
            let notification = Notification::new(
                ShowMessageNotification::METHOD.into(),
                ShowMessageParams {
                    kind: MessageType::Warning,
                    message: error_sink.to_string(),
                },
            );
            connection
                .sender
                .send(Message::Notification(notification))
                .unwrap();
        }
    }

    let server_capabilities = wgsl_analyzer::server_capabilities(&config);

    let initialize_result = InitializeResult {
        capabilities: server_capabilities,
        server_info: Some(ServerInfo {
            name: String::from("wgsl-analyzer"),
            version: Some(wgsl_analyzer::version().to_string()),
        }),
    };

    let initialize_result = serde_json::to_value(initialize_result).unwrap();

    if let Err(error) = connection.initialize_finish(initialize_id, initialize_result) {
        if error.channel_is_disconnected() {
            io_threads.join()?;
        }
        return Err(error.into());
    }

    // If the io_threads have an error, there's usually an error on the main
    // loop too because the channels are closed. Ensure we report both errors.
    match (
        wgsl_analyzer::main_loop(config, connection),
        io_threads.join(),
    ) {
        (Err(loop_e), Err(join_e)) => anyhow::bail!("{loop_e}\n{join_e}"),
        (Ok(()), Err(join_e)) => anyhow::bail!("{join_e}"),
        (Err(loop_e), Ok(())) => anyhow::bail!("{loop_e}"),
        (Ok(()), Ok(())) => {},
    }

    tracing::info!("server did shut down");
    Ok(())
}

const STACK_SIZE: usize = 1 << 24;

/// Parts of wgsl-analyzer can use a lot of stack space, and some operating systems only give us
/// 1 MB by default (eg. Windows), so this spawns a new thread with hopefully sufficient stack
/// space.
fn with_extra_thread<ThreadName, Function>(
    thread_name: ThreadName,
    thread_intent: stdx::thread::ThreadIntent,
    function: Function,
) -> anyhow::Result<()>
where
    ThreadName: Into<String>,
    Function: FnOnce() -> anyhow::Result<()> + Send + 'static,
{
    let handle = stdx::thread::Builder::new(thread_intent, thread_name)
        .stack_size(STACK_SIZE)
        .spawn(function)?;
    handle.join()?;
    Ok(())
}
