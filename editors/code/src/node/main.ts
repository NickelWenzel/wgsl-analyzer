import type * as vscode from "vscode";
import { activateWith, type WgslAnalyzerExtensionApi } from "../main";
import { nodePlatform } from "./platform";

export { deactivate } from "../main";

export function activate(context: vscode.ExtensionContext): Promise<WgslAnalyzerExtensionApi> {
	return activateWith(context, nodePlatform);
}
