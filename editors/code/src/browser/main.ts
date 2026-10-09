import * as vscode from "vscode";
import * as lc from "vscode-languageclient/browser";
import type { PlatformEnv } from "../config";
import type { Platform, PreparedServer, ServerContext } from "../context";
import { failedRequestNotification } from "../lang_client";
import {
	activateWith,
	deactivate as deactivateShared,
	type WgslAnalyzerExtensionApi,
} from "../main";
import { disposeServer, startServer } from "./server";
import { UriMapping } from "./uris";
import { mirrorWatchedFile, readWorkspace } from "./workspace";

const WORKSPACE_ROOT = "/workspace";

export function activate(context: vscode.ExtensionContext): Promise<WgslAnalyzerExtensionApi> {
	return activateWith(context, browserPlatform());
}

export async function deactivate(): Promise<void> {
	await deactivateShared();
	disposeServer();
}

/** The server only sees the first workspace folder, mirrored at {@link WORKSPACE_ROOT}. */
function browserPlatform(): Platform {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const env: PlatformEnv = {
		env: () => undefined,
		homedir: () => "",
		cwd: () => WORKSPACE_ROOT,
		execPath: () => "",
		pathSeparator: "/",
		workspaceFolder: () => WORKSPACE_ROOT,
	};
	return {
		env,
		// Other schemes, like `git:` for the left side of a diff, would open a
		// second copy of a workspace file on the server.
		servesUri: (uri) => folder === undefined || uri.scheme === folder.uri.scheme,
		prepareServer: (serverContext) => prepareServer(serverContext, folder),
	};
}

function prepareServer(
	{ extensionContext }: ServerContext,
	folder: vscode.WorkspaceFolder | undefined,
): Promise<PreparedServer> {
	const uris = new UriMapping(folder?.uri);
	return Promise.resolve({
		createClient: (id, name, options) =>
			new WaLanguageClient(
				id,
				name,
				async () => {
					const log = (line: string) => options.outputChannel?.appendLine(line);
					const files = folder === undefined ? {} : await readWorkspace(folder, uris, log);
					return startServer(extensionContext.extensionUri, files, log);
				},
				{
					...options,
					middleware: {
						...options.middleware,
						workspace: {
							...options.middleware?.workspace,
							didChangeWatchedFile: mirrorWatchedFile(
								uris,
								options.middleware?.workspace?.didChangeWatchedFile,
							),
						},
					},
					documentSelector: ["wgsl", "wesl"].map((language) =>
						folder === undefined ? { language } : { scheme: folder.uri.scheme, language },
					),
					uriConverters: {
						code2Protocol: (uri) => uris.toServer(uri),
						protocol2Code: (value) => uris.toEditor(value),
					},
				},
			),
	});
}

class WaLanguageClient extends lc.LanguageClient {
	override handleFailedRequest<T>(
		type: lc.MessageSignature,
		token: vscode.CancellationToken | undefined,
		// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
		error: any,
		defaultValue: T,
		showNotification?: boolean,
	): T {
		return super.handleFailedRequest(
			type,
			token,
			error,
			defaultValue,
			failedRequestNotification(error, showNotification),
		);
	}
}
