import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentPresetOf,
  noteAgentPresetIfAvailable,
  resolveAgentPresetsApi,
  selectWslAgentPreset,
  startWorkspaceSession,
  type AgentPresetsApi,
  type AgentPresetResult,
  type AgentPresetRoster,
} from '../src/client/compat.ts'

test('reads legacy and alpha session preset projections', () => {
  assert.equal(agentPresetOf({ agentPreset: 'standard' }), 'standard')
  assert.equal(agentPresetOf({ projectionValues: { agentPreset: 'code' } }), 'code')
  assert.equal(agentPresetOf({}), undefined)
})

test('notes a selected preset only on legacy session stores', () => {
  const calls: string[] = []
  const legacy = {
    prefix: 'legacy',
    noteAgentPreset(this: { prefix: string }, id: string, preset: string) {
      calls.push(`${this.prefix}:${id}:${preset}`)
    },
  }
  noteAgentPresetIfAvailable(legacy, 'session-1', 'wsl-standard')
  noteAgentPresetIfAvailable({}, 'session-2', 'wsl-code')
  assert.deepEqual(calls, ['legacy:session-1:wsl-standard'])
})

test('selects a WSL variant and updates legacy session stores', async () => {
  const calls: string[] = []
  const api: AgentPresetsApi = {
    list: async () => ({ result: { ok: true, value: { presets: [] } } }),
    select: async ({ agentPreset }: { sessionId: string; agentPreset: string }) => {
      calls.push(`select:${agentPreset}`)
      return { result: { ok: true, value: agentPreset } } as const
    },
  }
  const sessions = {
    noteAgentPreset: (_id: string, preset: string) => calls.push(`note:${preset}`),
  }

  assert.equal(await selectWslAgentPreset(
    api,
    sessions,
    'session-creator',
    'wsl-cordis',
  ), true)
  assert.deepEqual(calls, [
    'select:wsl-cordis',
    'note:wsl-cordis',
  ])
})

test('prefers the legacy namespaced API when old DSH also exposes rpc', async () => {
  const calls: string[] = []
  const listResult = { result: { ok: true, value: { presets: [] } } } as const
  const selectResult = { result: { ok: true, value: 'wsl-standard' } } as const
  const api = resolveAgentPresetsApi({
    api: {
      agentPresets: {
        list: async (args: Record<string, never>) => {
          assert.deepEqual(args, {})
          calls.push('api.list')
          return listResult
        },
        select: async (args: { sessionId: string; agentPreset: string }) => {
          assert.deepEqual(args, { sessionId: 'session-1', agentPreset: 'wsl-standard' })
          calls.push('api.select')
          return selectResult
        },
      },
    },
    rpc: {
      call: async () => {
        calls.push('rpc')
        throw new Error('legacy releases must not use generic rpc')
      },
    },
  })

  assert.equal(await api.list({}), listResult)
  assert.equal(await api.select({ sessionId: 'session-1', agentPreset: 'wsl-standard' }), selectResult)
  assert.deepEqual(calls, ['api.list', 'api.select'])
})

test('uses the 0.1.2-alpha Typert gateway channel, endpoints and named args', async () => {
  const roster: AgentPresetResult<AgentPresetRoster> = {
    ok: true,
    value: { presets: [{ id: 'wsl-standard', isDefault: true }] },
  }
  const selected: AgentPresetResult<string> = { ok: true, value: 'wsl-standard' }
  const calls: unknown[][] = []
  const api = resolveAgentPresetsApi({
    rpc: {
      call: async (...args: unknown[]) => {
        calls.push(args)
        return calls.length === 1 ? roster : selected
      },
    },
  })

  assert.deepEqual(await api.list({}), { result: roster })
  assert.deepEqual(await api.select({ sessionId: 'session-2', agentPreset: 'wsl-code' }), { result: selected })
  assert.deepEqual(calls, [
    ['/api', 'agentPresets/list', { args: {} }],
    ['/api', 'agentPresets/select', { args: { agentId: 'session-2', agentPreset: 'wsl-code' } }],
  ])
})

test('reports a stable unavailable result when neither connection API exists', async () => {
  const api = resolveAgentPresetsApi(undefined)
  assert.deepEqual(await api.list({}), {
    result: { ok: false, error: { message: 'agentPresets API unavailable' } },
  })
  assert.deepEqual(await api.select({ sessionId: 'session-3', agentPreset: 'wsl-minimal' }), {
    result: { ok: false, error: { message: 'agentPresets API unavailable' } },
  })
})

test('starts sessions through old workspaces first and new uiWorkspace otherwise', () => {
  const calls: string[] = []
  const workspaces = { startSession: (id?: string) => calls.push(`workspaces:${id}`) }
  const uiWorkspace = { startSession: (id?: string) => calls.push(`uiWorkspace:${id}`) }

  startWorkspaceSession(workspaces, uiWorkspace, 'workspace-old')
  startWorkspaceSession({}, uiWorkspace, 'workspace-new')

  assert.deepEqual(calls, ['workspaces:workspace-old', 'uiWorkspace:workspace-new'])
})

test('fails explicitly when no release-compatible session service is available', () => {
  assert.throws(
    () => startWorkspaceSession({}, undefined, 'workspace-missing'),
    /workspace session API unavailable/,
  )
})
