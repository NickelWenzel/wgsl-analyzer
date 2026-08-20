//! Browser transport for the LSP server.
//!
//! `Connection::stdio()` cannot be used under emscripten in a browser. Emscripten
//! puts `fd_read` in its `proxiedFunctionTable`, so a blocking stdin read issued by
//! the `lsp-server` reader thread is proxied to the *main runtime thread* — the
//! Web Worker's top-level thread. Blocking there also stalls `fd_write` from other
//! threads and the deferred `pthread_create` handler, which deadlocks the server.
//!
//! Instead we build a `Connection` directly out of two crossbeam channels
//! (its fields are `pub`, and it is "just a pair of channels of LSP messages"):
//!
//! - inbound:  JS calls `wa_push(json)` on the worker's top-level thread, which
//!   pushes into a channel. Never blocks, no syscall proxying involved.
//! - outbound: a dedicated writer thread drains the channel and calls `wa_emit`,
//!   a JS-library function annotated `__proxy: 'async'` so it runs on the main
//!   runtime thread and can reach the worker's `postMessage`.
//!
//! All blocking therefore happens inside wasm on pthreads, where it is legal
//! (emscripten: "Blocking in a worker/pthread is fine"), and the main runtime
//! thread stays free.

use std::{
    ffi::{CStr, CString, c_char, c_int},
    sync::OnceLock,
    thread::JoinHandle,
};

use crossbeam_channel::{Sender, unbounded};
use lsp_server::{Connection, Message};

static INBOUND: OnceLock<Sender<Message>> = OnceLock::new();

unsafe extern "C" {
    /// Implemented in `wasm/wa-io.js`. Delivers one JSON-RPC message to the page.
    fn wa_emit(ptr: *const c_char);
    /// Implemented in `wasm/wa-io.js`. Signals that `wa_push` is now accepting
    /// messages. `callMain` returns before this happens, because
    /// `-sPROXY_TO_PTHREAD` starts `main()` asynchronously on another thread.
    fn wa_ready();
}

/// Feed one JSON-RPC message into the server.
///
/// Called from JS as `Module.ccall('wa_push', 'number', ['string'], [json])`.
/// Returns 0 on success, negative on error.
///
/// # Safety
/// `ptr` must be a valid NUL-terminated UTF-8 C string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn wa_push(ptr: *const c_char) -> c_int {
    if ptr.is_null() {
        return -1;
    }
    // SAFETY: caller guarantees a valid NUL-terminated string.
    let text = match unsafe { CStr::from_ptr(ptr) }.to_str() {
        Ok(text) => text,
        Err(error) => {
            tracing::error!("wa_push: invalid utf-8: {error}");
            return -2;
        },
    };
    let message: Message = match serde_json::from_str(text) {
        Ok(message) => message,
        Err(error) => {
            tracing::error!("wa_push: malformed LSP payload: {error}: {text}");
            return -3;
        },
    };
    let Some(sender) = INBOUND.get() else {
        tracing::error!("wa_push: called before the connection was created");
        return -4;
    };
    match sender.send(message) {
        Ok(()) => 0,
        Err(error) => {
            tracing::error!("wa_push: server is gone: {error}");
            -5
        },
    }
}

/// Stand-in for `lsp_server::IoThreads`, which can only be built by `stdio()`.
pub struct WasmIoThreads {
    writer: Option<JoinHandle<()>>,
}

impl WasmIoThreads {
    pub fn join(mut self) -> std::io::Result<()> {
        if let Some(writer) = self.writer.take()
            && writer.join().is_err()
        {
            return Err(std::io::Error::other("LSP writer thread panicked"));
        }
        Ok(())
    }
}

/// Build a `Connection` backed by `postMessage` instead of stdio.
pub fn connection() -> (Connection, WasmIoThreads) {
    let (inbound_sender, inbound_receiver) = unbounded::<Message>();
    let (outbound_sender, outbound_receiver) = unbounded::<Message>();

    if INBOUND.set(inbound_sender).is_err() {
        tracing::error!("wasm connection created twice");
    }

    let writer = std::thread::Builder::new()
        .name("WasmLspWriter".to_owned())
        .spawn(move || {
            // Ends when the server drops its sender, i.e. on shutdown.
            for message in outbound_receiver {
                let json = match serde_json::to_string(&message) {
                    Ok(json) => json,
                    Err(error) => {
                        tracing::error!("failed to serialise LSP message: {error}");
                        continue;
                    },
                };
                match CString::new(json) {
                    // SAFETY: `text` is a valid NUL-terminated C string for the
                    // duration of the call; wa_emit copies before returning.
                    Ok(text) => unsafe { wa_emit(text.as_ptr()) },
                    Err(error) => tracing::error!("LSP message contained a NUL: {error}"),
                }
            }
        })
        .expect("failed to spawn LSP writer thread");

    // Only now is wa_push able to accept messages.
    // SAFETY: plain call into the JS runtime, no arguments.
    unsafe {
        wa_ready();
    }

    (
        Connection {
            sender: outbound_sender,
            receiver: inbound_receiver,
        },
        WasmIoThreads {
            writer: Some(writer),
        },
    )
}
