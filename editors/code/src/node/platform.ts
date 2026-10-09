import * as os from "node:os";
import * as path from "node:path";
import type { PlatformEnv } from "../config";
import type { Platform } from "../context";
import { prepareNodeServer } from "./server";

export const nodePlatformEnv: PlatformEnv = {
	env: (name) => process.env[name],
	homedir: () => os.homedir(),
	cwd: () => process.cwd(),
	// see
	// https://github.com/microsoft/vscode/blob/08ac1bb67ca2459496b272d8f4a908757f24f56f/src/vs/workbench/api/common/extHostVariableResolverService.ts#L81
	// or
	// https://github.com/microsoft/vscode/blob/29eb316bb9f154b7870eb5204ec7f2e7cf649bec/src/vs/server/node/remoteTerminalChannel.ts#L56
	execPath: () => process.env["VSCODE_EXEC_PATH"] ?? process.execPath,
	pathSeparator: path.sep, // spellchecker:disable-line
	workspaceFolder: (folder) => folder.fsPath,
};

export const nodePlatform: Platform = {
	env: nodePlatformEnv,
	// We only support local folders, not, for example, Live Share (`vlsl:` scheme).
	supportsFolder: (folder) => folder.scheme === "file",
	prepareServer: prepareNodeServer,
};
