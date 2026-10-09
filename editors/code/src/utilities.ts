import * as vscode from "vscode";

export function assert(condition: boolean, explanation: string): asserts condition {
	if (!condition) {
		log.error(`Assertion failed:`, explanation);
		throw new Error(explanation);
	}
}

export type Env = {
	[name: string]: string;
};

class Log {
	private readonly output = vscode.window.createOutputChannel("WGSL Analyzer Client", {
		log: true,
	});

	trace(...messages: [unknown, ...unknown[]]): void {
		this.output.trace(this.stringify(messages));
	}

	debug(...messages: [unknown, ...unknown[]]): void {
		this.output.debug(this.stringify(messages));
	}

	info(...messages: [unknown, ...unknown[]]): void {
		this.output.info(this.stringify(messages));
	}

	warn(...messages: [unknown, ...unknown[]]): void {
		this.output.warn(this.stringify(messages));
	}

	error(...messages: [unknown, ...unknown[]]): void {
		this.output.error(this.stringify(messages));
		this.output.show(true);
	}

	private stringify(messages: unknown[]): string {
		return messages
			.map((message) => {
				if (typeof message === "string") {
					return message;
				}
				if (message instanceof Error) {
					return message.stack || message.message;
				}
				try {
					return JSON.stringify(message, null, 2);
				} catch {
					return String(message);
				}
			})
			.join(" ");
	}
}

export const log = new Log();

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export type WeslDocument = vscode.TextDocument & ({ languageId: "wesl" } | { languageId: "wgsl" });

export type WeslEditor = vscode.TextEditor & { document: WeslDocument };

export function isWeslDocument(document: vscode.TextDocument): document is WeslDocument {
	// Prevent corrupted text (particularly when using inlay hints) in diff views
	// by allowing only `file` schemes.
	// Unfortunately, extensions that use diff views not always set this
	// to something different than "file".
	// See: https://github.com/rust-lang/rust-analyzer/issues/4608
	return (
		(document.languageId === "wgsl" || document.languageId === "wesl")
		&& document.uri.scheme === "file"
	);
}

export function isWeslEditor(editor: vscode.TextEditor): editor is WeslEditor {
	return isWeslDocument(editor.document);
}

export function isWeslTomlDocument(document: vscode.TextDocument): boolean {
	// ideally `document.languageId` should be 'toml' but user might not have a toml extension installed
	return (
		document.uri.scheme === "file"
		&& (document.uri.path.endsWith("/wesl.toml") || document.uri.path.endsWith("/Cargo.toml"))
	);
}

export function isWeslTomlEditor(editor: vscode.TextEditor): boolean {
	return isWeslTomlDocument(editor.document);
}

export function isDocumentInWorkspace(document: WeslDocument): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return false;
	}
	for (const folder of workspaceFolders) {
		if (document.uri.fsPath.startsWith(folder.uri.fsPath)) {
			return true;
		}
	}
	return false;
}

/** Sets ['when'](https://code.visualstudio.com/docs/getstarted/keybindings#_when-clause-contexts) clause contexts */
// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
export function setContextValue(key: string, value: any): Thenable<void> {
	return vscode.commands.executeCommand("setContext", key, value);
}

/**
 * Returns a higher-order function that caches the results of invoking the
 * underlying async function.
 */
export function memoizeAsync<Ret, TThis, Parameter extends string>(
	func: (this: TThis, argument: Parameter) => Promise<Ret>,
) {
	const cache = new Map<string, Ret>();

	return async function (this: TThis, argument: Parameter) {
		const cached = cache.get(argument);
		if (cached) return cached;

		const result = await func.call(this, argument);
		cache.set(argument, result);

		return result;
	};
}

export class LazyOutputChannel implements vscode.LogOutputChannel {
	constructor(name: string) {
		this.name = name;
	}
	name: string;
	_channel: vscode.LogOutputChannel | undefined;

	get channel(): vscode.LogOutputChannel {
		if (!this._channel) {
			this._channel = vscode.window.createOutputChannel(this.name, { log: true });
		}
		return this._channel;
	}
	get logLevel(): vscode.LogLevel {
		return this.channel.logLevel;
	}
	get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
		return this.channel.onDidChangeLogLevel;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	trace(message: string, ...args: any[]): void {
		this.channel.trace(message, ...args);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	debug(message: string, ...args: any[]): void {
		this.channel.debug(message, ...args);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	info(message: string, ...args: any[]): void {
		this.channel.info(message, ...args);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	warn(message: string, ...args: any[]): void {
		this.channel.warn(message, ...args);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	error(error: string | Error, ...args: any[]): void {
		this.channel.error(error, ...args);
	}

	append(value: string): void {
		this.channel.append(value);
	}

	appendLine(value: string): void {
		this.channel.appendLine(value);
	}

	replace(value: string): void {
		this.channel.replace(value);
	}

	clear(): void {
		if (this._channel) {
			this._channel.clear();
		}
	}

	show(preserveFocus?: boolean): void;
	show(column: vscode.ViewColumn, preserveFocus?: boolean): void;
	show(arg1?: boolean | vscode.ViewColumn, arg2?: boolean): void {
		let preserveFocus: boolean;
		if (typeof arg1 === "boolean") {
			preserveFocus = arg1;
		} else {
			preserveFocus = arg2 === true;
		}
		this.channel.show(preserveFocus);
	}

	hide(): void {
		if (this._channel) {
			this._channel.hide();
		}
	}

	dispose(): void {
		if (this._channel) {
			this._channel.dispose();
		}
	}
}

export type NotNull<T> = T extends null ? never : T;

export type Nullable<T> = null | T;

function isNotNull<T>(input: Nullable<T>): input is NotNull<T> {
	return input !== null;
}

function expectNotNull<T>(input: Nullable<T>, message: string): NotNull<T> {
	if (isNotNull(input)) {
		return input;
	}

	throw new TypeError(message);
}
export function unwrapNullable<T>(input: Nullable<T>): NotNull<T> {
	return expectNotNull(input, `unwrapping \`null\``);
}

export type NotUndefined<T> = T extends undefined ? never : T;
export type Undefinable<T> = T | undefined;

function isNotUndefined<T>(input: Undefinable<T>): input is NotUndefined<T> {
	return input !== undefined;
}

export function expectNotUndefined<T>(input: Undefinable<T>, message: string): NotUndefined<T> {
	if (isNotUndefined(input)) {
		return input;
	}

	throw new TypeError(message);
}

export function unwrapUndefinable<T>(input: Undefinable<T>): NotUndefined<T> {
	return expectNotUndefined(input, `unwrapping \`undefined\``);
}
