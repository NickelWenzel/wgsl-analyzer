import * as vscode from "vscode";
import {
	AbstractMessageReader,
	AbstractMessageWriter,
	type DataCallback,
	type Disposable,
	type Message,
	type MessageTransports,
} from "vscode-languageclient/browser";
import { WgslAnalyzerServer, type WorkspaceFiles } from "wgsl-analyzer-web";

let running: WgslAnalyzerServer | undefined;

/** Starts the server in a worker, replacing any server started before. */
export async function startServer(
	extensionUri: vscode.Uri,
	files: WorkspaceFiles,
	onStderr: (line: string) => void,
): Promise<MessageTransports> {
	if (!crossOriginIsolated) {
		throw new Error(
			"wgsl-analyzer needs a cross-origin isolated page. On vscode.dev, add ?vscode-coi= to the URL.",
		);
	}
	disposeServer();

	const workerScript = vscode.Uri.joinPath(extensionUri, "out", "wasm", "worker.js").toString(true);
	const worker = new Worker(bootstrapUrl(workerScript));
	let reader: ServerReader | undefined;
	worker.addEventListener("error", (event) => reader?.failed(new Error(event.message)));

	const server = await WgslAnalyzerServer.start({
		worker,
		files,
		onStderr,
		onExit: (code) => reader?.closed(code),
	});
	running = server;
	reader = new ServerReader(server);
	return { reader, writer: new ServerWriter(server) };
}

/** Mirrors a change made outside the editor into the running server's filesystem. */
export function writeServerFile(path: string, contents: Uint8Array): void {
	running?.writeFile(path, contents);
}

/** See {@link writeServerFile}. */
export function deleteServerFile(path: string): void {
	running?.deleteFile(path);
}

export function disposeServer(): void {
	running?.dispose();
	running = undefined;
}

/**
 * A classic worker script that runs `worker.js`.
 *
 * VS Code's web extension host wraps every worker in `importScripts`, which
 * module workers reject, so the worker has to be classic. `worker.js` comes from
 * another origin, so it is imported as a module, which resolves its own imports
 * against its URL, and messages that arrive before it has loaded are replayed.
 * The emscripten glue spawns its pthreads as module workers of itself, which
 * cannot import it from that origin under the extension host's CSP, so they
 * run a copy of the glue from a blob. Pthreads receive the compiled wasm by
 * message, so the copy's own URL does not matter.
 */
function bootstrapUrl(workerScript: string): string {
	const source = `
const NativeWorker = Worker;
let glue;
self.Worker = function (url, options) {
	if (options?.type !== "module") return new NativeWorker(url, options);
	if (glue === undefined) {
		const request = new XMLHttpRequest();
		request.open("GET", String(url), false);
		request.send();
		glue = URL.createObjectURL(new Blob([request.responseText], { type: "text/javascript" }));
	}
	return new NativeWorker(glue, options);
};
const early = [];
self.onmessage = (event) => early.push(event);
import(${JSON.stringify(workerScript)}).then(
	() => { for (const event of early) self.onmessage(event); },
	(error) => self.postMessage({ type: "error", message: String(error), stack: error?.stack }),
);
`;
	return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

class ServerReader extends AbstractMessageReader {
	readonly #server: WgslAnalyzerServer;

	constructor(server: WgslAnalyzerServer) {
		super();
		this.#server = server;
	}

	listen(callback: DataCallback): Disposable {
		return this.#server.onMessage((message) => callback(message as Message));
	}

	closed(code: number): void {
		if (code !== 0) this.fireError(new Error(`wgsl-analyzer exited with code ${code}`));
		this.fireClose();
	}

	failed(error: Error): void {
		this.fireError(error);
	}
}

class ServerWriter extends AbstractMessageWriter {
	readonly #server: WgslAnalyzerServer;

	constructor(server: WgslAnalyzerServer) {
		super();
		this.#server = server;
	}

	write(message: Message): Promise<void> {
		// `postMessage` cannot clone functions, which settings objects carry. Over
		// stdio, JSON serialization drops them instead.
		this.#server.sendMessage(JSON.parse(JSON.stringify(message)));
		return Promise.resolve();
	}

	end(): void {}

	override dispose(): void {
		super.dispose();
		this.#server.dispose();
		if (running === this.#server) running = undefined;
	}
}
