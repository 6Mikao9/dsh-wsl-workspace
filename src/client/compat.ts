/** Cross-release browser-service adapters for DeepSeek Harness. */

export interface AgentPresetEntry {
  id: string
  broken?: string
  isDefault?: boolean
}

export interface AgentPresetRoster {
  presets: AgentPresetEntry[]
}

export type AgentPresetResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { message: string } }

export interface AgentPresetsApi {
  list(args: Record<string, never>): Promise<{ result: AgentPresetResult<AgentPresetRoster> }>
  select(args: { sessionId: string; agentPreset: string }): Promise<{ result: AgentPresetResult<unknown> }>
}

interface RpcConnection {
  call(channel: string, endpoint: string, payload: unknown): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function legacyAgentPresets(connection: Record<string, unknown>): AgentPresetsApi | undefined {
  if (!isRecord(connection.api) || !isRecord(connection.api.agentPresets)) return undefined
  const candidate = connection.api.agentPresets
  if (typeof candidate.list !== 'function' || typeof candidate.select !== 'function') return undefined
  return candidate as unknown as AgentPresetsApi
}

/**
 * Normalize the client connection contract used by every supported DSH line.
 *
 * DSH through 0.1.1-rc.2 exposes both `api` and `rpc`; the namespaced API must
 * therefore win whenever it is present. DSH 0.1.2-alpha removes that API and
 * routes the generated Typert remotes through `/api` with named wire args.
 */
export function resolveAgentPresetsApi(connection: unknown): AgentPresetsApi {
  if (isRecord(connection)) {
    const legacy = legacyAgentPresets(connection)
    if (legacy !== undefined) return legacy

    const rpc = isRecord(connection.rpc) && typeof connection.rpc.call === 'function'
      ? connection.rpc as unknown as RpcConnection
      : undefined
    if (rpc !== undefined) {
      return {
        list: async () => ({
          result: await rpc.call('/api', 'agentPresets/list', { args: {} }) as AgentPresetResult<AgentPresetRoster>,
        }),
        select: async ({ sessionId, agentPreset }) => ({
          result: await rpc.call('/api', 'agentPresets/select', {
            args: { agentId: sessionId, agentPreset },
          }) as AgentPresetResult<unknown>,
        }),
      }
    }
  }

  return {
    list: async () => ({
      result: { ok: false, error: { message: 'agentPresets API unavailable' } },
    }),
    select: async () => ({
      result: { ok: false, error: { message: 'agentPresets API unavailable' } },
    }),
  }
}

interface SessionStarter {
  startSession(workspaceId?: string): void
}

function sessionStarter(value: unknown): SessionStarter | undefined {
  return isRecord(value) && typeof value.startSession === 'function'
    ? value as unknown as SessionStarter
    : undefined
}

/** Start the new workspace through the service available in this DSH line. */
export function startWorkspaceSession(
  workspaces: unknown,
  uiWorkspace: unknown,
  workspaceId?: string,
): void {
  const legacy = sessionStarter(workspaces)
  if (legacy !== undefined) {
    legacy.startSession(workspaceId)
    return
  }
  const current = sessionStarter(uiWorkspace)
  if (current !== undefined) {
    current.startSession(workspaceId)
    return
  }
  throw new Error('workspace session API unavailable')
}
