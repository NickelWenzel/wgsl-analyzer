import * as vscode from "vscode";
import * as lc from "vscode-languageclient/browser";
import { disposeServer, startServer } from "./server";
import { UriMapping } from "./uris";

let client: lc.LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel("wgsl-analyzer Language Server", { log: true });
	context.subscriptions.push(output);

	const folder = vscode.workspace.workspaceFolders?.[0];
	const uris = new UriMapping(folder?.uri);
	// Other schemes, like `git:` for the left side of a diff, would open a second
	// copy of the same file on the server.
	const schemes = folder === undefined ? [{}] : [{ scheme: folder.uri.scheme }];

	client = new lc.LanguageClient(
		"wgsl-analyzer",
		"wgsl-analyzer Language Server",
		() => startServer(context.extensionUri, {}, output),
		{
			documentSelector: schemes.flatMap((scheme) => [
				{ ...scheme, language: "wgsl" },
				{ ...scheme, language: "wesl" },
			]),
			...(folder === undefined ? {} : { workspaceFolder: folder }),
			initializationOptions: JSON.parse(
				JSON.stringify(vscode.workspace.getConfiguration("wgsl-analyzer")),
			),
			uriConverters: {
				code2Protocol: (uri) => uris.toServer(uri),
				protocol2Code: (value) => uris.toEditor(value),
			},
			diagnosticCollectionName: "wgsl-analyzer",
			outputChannel: output,
			markdown: { supportHtml: true },
		},
	);

	try {
		await client.start();
	} catch (error) {
		void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
	}
}

export async function deactivate(): Promise<void> {
	await client?.stop();
	client = undefined;
	disposeServer();
}
