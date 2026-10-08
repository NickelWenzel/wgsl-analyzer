import * as vscode from "vscode";

const WORKSPACE_ROOT = "/workspace";
const DETACHED_ROOT = "/detached";

/**
 * Translates between the editor's URIs and the server's, which name files in
 * its in-memory filesystem.
 *
 * Files in the workspace folder map to `file:///workspace/...`, everything else
 * to a unique path under `file:///detached`.
 */
export class UriMapping {
	readonly #folder: vscode.Uri | undefined;
	readonly #detached = new Map<string, vscode.Uri>();

	constructor(folder: vscode.Uri | undefined) {
		this.#folder = folder;
	}

	toServer(uri: vscode.Uri): string {
		const relative = this.#relativePath(uri);
		if (relative !== undefined) {
			return vscode.Uri.file(`${WORKSPACE_ROOT}${relative}`).toString();
		}
		const authority = encodeURIComponent(uri.authority) || "~";
		const path = uri.path.startsWith("/") ? uri.path : `/${uri.path}`;
		const server = vscode.Uri.file(`${DETACHED_ROOT}/${uri.scheme}/${authority}${path}`)
			.with({ query: uri.query })
			.toString();
		this.#detached.set(server, uri);
		return server;
	}

	toEditor(value: string): vscode.Uri {
		const detached = this.#detached.get(value);
		if (detached !== undefined) return detached;
		const uri = vscode.Uri.parse(value);
		if (
			this.#folder !== undefined
			&& uri.scheme === "file"
			&& (uri.path === WORKSPACE_ROOT || uri.path.startsWith(`${WORKSPACE_ROOT}/`))
		) {
			return vscode.Uri.joinPath(this.#folder, uri.path.slice(WORKSPACE_ROOT.length));
		}
		return uri;
	}

	/** The path of `uri` below the workspace folder, with a leading slash, or `""` for the folder itself. */
	#relativePath(uri: vscode.Uri): string | undefined {
		const folder = this.#folder;
		if (
			folder === undefined
			|| uri.scheme !== folder.scheme
			|| uri.authority !== folder.authority
		) {
			return undefined;
		}
		const base = folder.path.replace(/\/+$/, "");
		if (uri.path === base) return "";
		return uri.path.startsWith(`${base}/`) ? uri.path.slice(base.length) : undefined;
	}
}
