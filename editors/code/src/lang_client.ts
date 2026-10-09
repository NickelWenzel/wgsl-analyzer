import * as vscode from "vscode";
import * as lc from "vscode-languageclient";

/** Adjusts `handleFailedRequest`'s `showNotification` for wgsl-analyzer's errors. */
export function failedRequestNotification(
	error: unknown,
	showNotification: boolean | undefined,
): boolean | undefined {
	const showError = vscode.workspace
		.getConfiguration("wgsl-analyzer")
		.get("showRequestFailedErrorNotification");
	if (
		!showError
		&& error instanceof lc.ResponseError
		&& error.code === lc.ErrorCodes.InternalError
	) {
		// Do not show notification for internal errors, these are emitted by w-a when a request fails.
		return false;
	}
	return showNotification;
}
