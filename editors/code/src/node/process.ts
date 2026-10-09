import {
	type ExecOptionsWithStringEncoding,
	exec,
	type SpawnOptionsWithoutStdio,
	spawn,
} from "node:child_process";
import { log } from "../utilities";

/** Awaitable wrapper around `child_process.exec` */
export function execute(command: string, options: ExecOptionsWithStringEncoding): Promise<string> {
	log.info(`running command: ${command}`);
	return new Promise((resolve, reject) => {
		exec(command, options, (error, stdout, stderr) => {
			if (error) {
				log.error("error:", error);
				reject(error);
				return;
			}

			if (stderr) {
				reject(new Error(stderr));
				return;
			}

			resolve(stdout.trimEnd());
		});
	});
}

interface SpawnAsyncReturns {
	stdout: string;
	stderr: string;
	status: number | null;
	error?: Error | undefined;
}

export async function spawnAsync(
	path: string,
	inputs?: ReadonlyArray<string>,
	options?: SpawnOptionsWithoutStdio,
): Promise<SpawnAsyncReturns> {
	const child = spawn(path, inputs, options);
	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	const stdout: Array<Buffer<any>> = [];
	// biome-ignore lint/suspicious/noExplicitAny: Signature comes from upstream
	const stderr: Array<Buffer<any>> = [];
	try {
		const result = await new Promise<{
			status: null | number;
			stderr: string;
			stdout: string;
		}>((resolve, reject) => {
			child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
			child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
			child.on("error", (error) => {
				reject({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					error,
				});
			});
			child.on("close", (status) => {
				resolve({
					stdout: Buffer.concat(stdout).toString("utf8"),
					stderr: Buffer.concat(stderr).toString("utf8"),
					status,
				});
			});
		});

		return {
			stdout: result.stdout,
			stderr: result.stderr,
			status: result.status,
		};
	} catch (exception: unknown) {
		assertIsStructuredError(exception);
		return {
			stdout: exception.stdout,
			stderr: exception.stderr,
			status: exception.status,
			error: exception.error,
		};
	}
}

type StructuredError = {
	error?: Error | undefined;
	status: null | number;
	stderr: string;
	stdout: string;
};

function assertIsStructuredError(object: unknown): asserts object is StructuredError {
	if (typeof object !== "object" || object === null || !("error" in object)) {
		throw new TypeError("Unexpected exception shape");
	}
}
