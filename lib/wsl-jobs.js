import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";

//#region src/host/wsl-jobs.ts
/** The tool name this plugin registers. */
const TOOL_NAME = "bash_background";
/**
* The defaults, kept as data as well as schema fields: a world row that mounts
* this plugin without a `config:` block hands `apply` an *undefined* config, and
* schemastery's defaults are not applied on that path. The `wsl-search` entry
* learned this from a live session; this one learned it the same way, which is
* why both read their defaults from one place.
*/
const DEFAULTS = { timeoutMs: 15e3 };
/** Validated plugin config. */
const Config = z.object({ timeoutMs: z.number().default(DEFAULTS.timeoutMs) });
/** Services this tool registers into (all three are read with `get`). */
const inject = ["tools"];
/**
* Turn one finished background process into the registry's outcome shape.
* @param process - the settled shell process handle.
* @returns the job outcome with a kind-specific detail line.
*/
function outcomeOf(process) {
	const detail = process.signal !== null ? `signal: ${process.signal}` : process.exitCode !== null ? `exit code: ${process.exitCode}` : void 0;
	const status = process.status === "killed" ? "killed" : process.status === "completed" ? "completed" : "failed";
	return detail === void 0 ? { status } : {
		status,
		detail
	};
}
/**
* Render one consuming output read as the string the registry hands to
* `job_output`. The delta is the payload; a lossy read and any full-stream spill
* files are named, because the consumer cannot see them otherwise.
* @param read - the shell provider's incremental read.
* @returns the text for this read.
*/
function renderRead(read) {
	const parts = [read.delta];
	if (read.lossy) parts.push("[output truncated: unread bytes were dropped]");
	if (read.stdoutSpillPath !== void 0) parts.push(`[full stdout: ${read.stdoutSpillPath}]`);
	if (read.stderrSpillPath !== void 0) parts.push(`[full stderr: ${read.stderrSpillPath}]`);
	return parts.filter((part) => part !== "").join("\n");
}
/**
* Register the world's background-bash producer.
*
* The tool returns the registry's job id immediately; `job_output` reads the
* stream and `job_kill` cancels it, exactly as for the host's one-shot tool.
* @param ctx - plugin context; registrations are effects scoped to it.
* @param config - plugin configuration; a row without a `config:` block mounts
*   this plugin with none, and {@link DEFAULTS} then supplies every knob.
*/
function apply(ctx, config) {
	const resolved = {
		...DEFAULTS,
		...config === void 0 ? {} : config
	};
	const tools = ctx.get("tools");
	if (tools === void 0) return;
	const tool = defineTool({
		name: TOOL_NAME,
		description: "Run one command in the background inside this WSL distribution and return a job id immediately. Read its output with job_output and stop it with job_kill. The `bash` tool is a persistent shell and takes `command` only - it has no `run_in_background` parameter, so this tool is its equivalent.",
		parameters: {
			command: {
				type: "string",
				required: true,
				description: "The bash command to run in the background."
			},
			workdir: {
				type: "string",
				description: "Linux working directory for the command. Defaults to the session workspace; a relative path resolves against it."
			}
		},
		timeoutMs: resolved.timeoutMs,
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { jobId: {
					type: "string",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: `started background job ${value.jobId}`
			}]
		},
		async execute(args, exec) {
			const jobs = ctx.get("jobs");
			if (jobs === void 0) throw new Error("background jobs unavailable: this deployment mounts no jobs registry (load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs)");
			const shell = ctx.get("shell");
			if (shell === void 0 || typeof shell.start !== "function" || typeof shell.resolve !== "function") throw new Error("background jobs unavailable: the WSL world provides no shell with background support");
			const shellEnv = ctx.get("shellEnv");
			const dshEnv = typeof shellEnv?.collect === "function" ? shellEnv.collect(exec) : void 0;
			const request = {
				command: args.command,
				...args.workdir === void 0 ? {} : { workdir: args.workdir },
				...dshEnv === void 0 ? {} : { dshEnv }
			};
			const jobId = jobs.start({
				kind: "bash",
				label: args.command,
				...exec.agent === void 0 ? {} : { owner: exec.agent },
				run: () => {
					const process = shell.start(shell.resolve(request));
					return {
						cancel: () => {
							process.kill();
						},
						done: process.done.then(() => outcomeOf(process)),
						readOutput: () => renderRead(process.readOutput())
					};
				}
			});
			return { jobId: String(jobId) };
		},
		presentCall: (args) => ({
			card: "generic",
			title: `Bash (background) ${args.command}`,
			kind: "execute",
			rawInput: args.command
		})
	});
	tools.register(tool);
}
var wsl_jobs_default = apply;

//#endregion
export { Config, TOOL_NAME, apply, wsl_jobs_default as default, inject, outcomeOf, renderRead };
//# sourceMappingURL=wsl-jobs.js.map