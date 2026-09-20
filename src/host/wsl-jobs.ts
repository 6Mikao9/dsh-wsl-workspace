/**
 * The WSL world's tracked background jobs.
 *
 * DSH's one-shot `bash` tool is what *starts* a tracked job: `run_in_background:
 * true` calls `ctx.jobs.start(...)` around a `ctx.shell.start(...)` handle, and
 * the host's `job_list` / `job_output` / `job_kill` tools read that registry. A
 * WSL world replaces that tool with the host's *persistent* shell — whose schema
 * declares only `command` — so nothing in a WSL session produced a job. Worse,
 * the parameter schema does not forbid extra properties, so a
 * `run_in_background: true` argument was silently accepted and ignored: the
 * command ran in the foreground and `job_list` stayed empty. A real session found
 * exactly that, after this plugin's own shell description suggested the
 * parameter.
 *
 * This module restores the producer, and only the producer. The registry owns
 * identity, lifecycle, authorization and completion notices; this plugin's shell
 * provider already implements the background process handle (`start()`); the tool
 * bridges the two and nothing else.
 *
 * It is mounted only where it is needed: a world that keeps the *one-shot* bash
 * row (the platform-capability fallback) already gets `run_in_background` from
 * the host tool, so the row is omitted there.
 *
 * @module dsh-wsl-workspace/host/wsl-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** The tool name this plugin registers. */
export const TOOL_NAME = 'bash_background'

/** Plugin config. */
export interface Config {
  /** Cooperative tool-call budget in milliseconds for the *start* call itself. */
  timeoutMs?: number
}

/**
 * The defaults, kept as data as well as schema fields: a world row that mounts
 * this plugin without a `config:` block hands `apply` an *undefined* config, and
 * schemastery's defaults are not applied on that path. The `wsl-search` entry
 * learned this from a live session; this one learned it the same way, which is
 * why both read their defaults from one place.
 */
const DEFAULTS: Required<Config> = {
  timeoutMs: 15_000,
}

/** Validated plugin config. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULTS.timeoutMs),
})

/** Services this tool registers into (all three are read with `get`). */
export const inject = ['tools']

/** The tool-execution face this tool reads. */
interface ToolExecution {
  signal?: AbortSignal
  agent?: unknown
}

/** The `ctx.tools` face. */
interface ToolsRegistryFace {
  register(tool: unknown): void
}

/** One background process handle, as this plugin's shell provider returns it. */
interface ShellProcessFace {
  readonly status: 'running' | 'completed' | 'killed'
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly done: Promise<void>
  readOutput(): { delta: string; lossy: boolean; stdoutSpillPath?: string; stderrSpillPath?: string }
  kill(): boolean
}

/** The `ctx.shell` face: resolve a request, then start it in the background. */
interface ShellFace {
  resolve(request: { command: string; workdir?: string; dshEnv?: Record<string, string> }): unknown
  start(spec: unknown): ShellProcessFace
}

/** The `ctx.jobs` face: identity and lifecycle for one produced job. */
interface JobsFace {
  start(spec: {
    kind: string
    label: string
    owner?: unknown
    run(): {
      cancel(reason?: string): void
      done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>
      readOutput?(): string
    }
  }): unknown
}

/** The `ctx.shellEnv` face, read opportunistically like the host tool does. */
interface ShellEnvFace {
  collect(exec: unknown): Record<string, string> | undefined
}

/**
 * Turn one finished background process into the registry's outcome shape.
 * @param process - the settled shell process handle.
 * @returns the job outcome with a kind-specific detail line.
 */
export function outcomeOf(process: ShellProcessFace): { status: 'completed' | 'killed' | 'failed'; detail?: string } {
  const detail = process.signal !== null
    ? `signal: ${process.signal}`
    : process.exitCode !== null ? `exit code: ${process.exitCode}` : undefined
  const status = process.status === 'killed' ? 'killed' : process.status === 'completed' ? 'completed' : 'failed'
  return detail === undefined ? { status } : { status, detail }
}

/**
 * Render one consuming output read as the string the registry hands to
 * `job_output`. The delta is the payload; a lossy read and any full-stream spill
 * files are named, because the consumer cannot see them otherwise.
 * @param read - the shell provider's incremental read.
 * @returns the text for this read.
 */
export function renderRead(read: { delta: string; lossy: boolean; stdoutSpillPath?: string; stderrSpillPath?: string }): string {
  const parts = [read.delta]
  if (read.lossy) parts.push('[output truncated: unread bytes were dropped]')
  if (read.stdoutSpillPath !== undefined) parts.push(`[full stdout: ${read.stdoutSpillPath}]`)
  if (read.stderrSpillPath !== undefined) parts.push(`[full stderr: ${read.stderrSpillPath}]`)
  return parts.filter(part => part !== '').join('\n')
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
export function apply(ctx: Context, config?: Config): void {
  const resolved: Required<Config> = { ...DEFAULTS, ...config === undefined ? {} : config }
  const tools = ctx.get('tools') as unknown as ToolsRegistryFace | undefined
  if (tools === undefined) return
  const tool = defineTool({
    name: TOOL_NAME,
    description: 'Run one command in the background inside this WSL distribution and return a job id immediately. Read its output with job_output and stop it with job_kill. The `bash` tool is a persistent shell and takes `command` only - it has no `run_in_background` parameter, so this tool is its equivalent.',
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The bash command to run in the background.',
      },
      workdir: {
        type: 'string',
        description: 'Linux working directory for the command. Defaults to the session workspace; a relative path resolves against it.',
      },
    },
    timeoutMs: resolved.timeoutMs,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
        },
      },
      render: (_args: unknown, value: { jobId: string }) => [{
        type: 'text',
        text: `started background job ${value.jobId}`,
      }],
    },
    async execute(args: { command: string; workdir?: string }, exec: ToolExecution) {
      const jobs = ctx.get('jobs') as unknown as JobsFace | undefined
      if (jobs === undefined) {
        throw new Error('background jobs unavailable: this deployment mounts no jobs registry (load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs)')
      }
      const shell = ctx.get('shell') as unknown as ShellFace | undefined
      if (shell === undefined || typeof shell.start !== 'function' || typeof shell.resolve !== 'function') {
        throw new Error('background jobs unavailable: the WSL world provides no shell with background support')
      }
      const shellEnv = ctx.get('shellEnv') as unknown as ShellEnvFace | undefined
      const dshEnv = typeof shellEnv?.collect === 'function' ? shellEnv.collect(exec) : undefined
      const request = {
        command: args.command,
        ...args.workdir === undefined ? {} : { workdir: args.workdir },
        ...dshEnv === undefined ? {} : { dshEnv },
      }
      const jobId = jobs.start({
        kind: 'bash',
        label: args.command,
        ...exec.agent === undefined ? {} : { owner: exec.agent },
        run: () => {
          const process = shell.start(shell.resolve(request))
          return {
            cancel: () => {
              process.kill()
            },
            done: process.done.then(() => outcomeOf(process)),
            readOutput: () => renderRead(process.readOutput()),
          }
        },
      })
      return { jobId: String(jobId) }
    },
    presentCall: (args: { command: string }) => ({
      card: 'generic',
      title: `Bash (background) ${args.command}`,
      kind: 'execute',
      rawInput: args.command,
    }),
  })
  tools.register(tool)
}

export default apply
