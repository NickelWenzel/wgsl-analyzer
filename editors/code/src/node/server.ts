import { spawn } from "node:child_process";
import { text } from "node:stream/consumers";
import type * as vscode from "vscode";
import * as lc from "vscode-languageclient/node";
import type { PreparedServer, ServerContext } from "../context";
import { failedRequestNotification } from "../lang_client";
import { log } from "../utilities";
import { bootstrap } from "./bootstrap";

export async function prepareNodeServer({
	extensionContext,
	config,
	state,
}: ServerContext): Promise<PreparedServer> {
	const path = await bootstrap(extensionContext, config, state).catch((exception: unknown) => {
		let message = "bootstrap error. ";

		message += 'See the logs in "OUTPUT > wgsl-analyzer Client" (should open automatically). ';
		message +=
			'To enable verbose logs, click the gear icon in the "OUTPUT" tab and select "Debug".';

		log.error("Bootstrap error", exception);
		throw new Error(message);
	});
	const version = text(spawn(path, ["--version"]).stdout.setEncoding("utf-8")).then((data) => {
		const prefix = `wgsl-analyzer `;
		return data.slice(data.startsWith(prefix) ? prefix.length : 0).trim();
	});
	const run: lc.Executable = {
		command: path,
		options: { env: Object.assign({}, process.env, config.serverExtraEnv) },
	};
	return {
		path,
		version,
		createClient: (id, name, options) =>
			new WaLanguageClient(id, name, { run, debug: run }, options),
	};
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
