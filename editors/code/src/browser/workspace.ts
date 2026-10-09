import * as vscode from "vscode";
import * as lc from "vscode-languageclient/browser";
import type { WorkspaceFiles } from "wgsl-analyzer-web";
import { deleteServerFile, writeServerFile } from "./server";
import type { UriMapping } from "./uris";

const PATTERN = "**/{*.wgsl,*.wesl,wesl.toml}";
const MAX_FILE_BYTES = 1024 * 1024;

/** Reads the files the server needs from the workspace folder, to seed its filesystem. */
export async function readWorkspace(
	folder: vscode.WorkspaceFolder,
	uris: UriMapping,
	log: (line: string) => void,
): Promise<WorkspaceFiles> {
	const files: WorkspaceFiles = {};
	const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, PATTERN));
	await Promise.all(
		found.map(async (uri) => {
			const path = uris.workspacePath(uri);
			if (path === undefined) return;
			const contents = await vscode.workspace.fs.readFile(uri);
			if (contents.byteLength > MAX_FILE_BYTES) {
				log(`Not loading ${path} into the server, it is larger than ${MAX_FILE_BYTES} bytes`);
				return;
			}
			files[path] = contents;
		}),
	);
	return files;
}

/**
 * Updates the server's filesystem before the server hears about a change to a
 * file it watches. The server only reads files from its own filesystem, and
 * the update and the notification reach it in order, over the same worker.
 */
export function mirrorWatchedFile(
	uris: UriMapping,
	next: lc.WorkspaceMiddleware["didChangeWatchedFile"],
): NonNullable<lc.WorkspaceMiddleware["didChangeWatchedFile"]> {
	return async (event, forward) => {
		// The event already carries the server's URI.
		const uri = uris.toEditor(event.uri);
		const path = uris.workspacePath(uri);
		if (path !== undefined) {
			if (event.type === lc.FileChangeType.Deleted) {
				deleteServerFile(path);
			} else {
				writeServerFile(path, await vscode.workspace.fs.readFile(uri));
			}
		}
		await (next === undefined ? forward(event) : next(event, forward));
	};
}
