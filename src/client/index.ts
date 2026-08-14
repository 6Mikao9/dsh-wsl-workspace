/**
 * Browser half of dsh-wsl-workspace. Registers the "Add WSL workspace…"
 * action beside Settings at the sidebar foot (the official
 * `sidebar.footer.action` slot), and keeps every blank session whose
 * workspace is a WSL UNC path composed from the WSL VARIANT of the mode it
 * currently runs (`standard` → `wsl-standard`, PTC → `wsl-code`, …) — so the
 * WSL execution world composes with any mode instead of being a mode itself.
 *
 * The binding is a watching effect rather than a one-shot dialog action so
 * EVERY creation path (this dialog, the workspace row's New Session, the
 * hero picker) converges on the WSL-backed composition automatically.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale), the
// runtime's ClientContext, and the ui-sidebar SlotMap merge (the
// 'sidebar.footer.action' entry) into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { check as checkApi, listDir as listDirApi, listDistros as listDistrosApi } from './api.ts'
import { AddWslWorkspace, type AddWslWorkspaceInjected } from './AddWslWorkspace.tsx'
import { ensureStyles } from './styles.ts'
import { zh, en } from './locales.ts'
import { isWslUnc } from '../shared/paths.ts'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'workspaces']

/** The legacy standalone WSL preset id (folded into the mode variants). */
const LEGACY_WSL_PRESET_ID = 'wsl'

/**
 * Minimal sessions-service face. The renderer-host ctx merge types
 * `ctx.sessions` as its own SessionStore; the service the runtime actually
 * registers under that key satisfies this narrower contract, so the cast is
 * the documented boundary for a third-party plugin.
 */
interface WslSessionsFace {
  list: {
    getSnapshot(): { ids: string[]; byId: Record<string, { blank: boolean; cwd?: string; agentPreset?: string }> }
    subscribe(fn: () => void): () => void
  }
  noteAgentPreset(sessionId: string, agentPreset: string): void
}

/** Minimal workspaces-service face (create + start-session only). */
interface WslWorkspacesFace {
  create(input: { path: string }): Promise<{ workspaceId: string }>
  startSession(workspaceId?: string): void
}

/**
 * Mount the sidebar action and the auto-binding effect.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  const workspaces = ctx.get('workspaces') as unknown as WslWorkspacesFace
  const sessions = ctx.get('sessions') as unknown as WslSessionsFace

  ensureStyles()

  ctx.effect(
    () => ctx.locale.register('wslWorkspace' as never, { zh, en }),
    'dsh-wsl-workspace: locale dictionaries',
  )

  // The injected translate function reads the live locale preference.
  const t = ctx.locale.bind('wslWorkspace' as never) as unknown as (key: string, params?: Record<string, unknown>) => string

  const injected = (): AddWslWorkspaceInjected => ({
    t,
    checkPreset: async (): Promise<string | undefined> => {
      let roster
      try {
        const response = await api.agentPresets.list({})
        roster = response.result
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      if (!roster.ok) return roster.error.message
      const healthy = roster.value.presets.find((entry: { id: string; broken?: string }) =>
        entry.id.startsWith('wsl-') && entry.broken === undefined)
      if (healthy === undefined) return t('error.presetMissing')
      return undefined
    },
    listDistros: () => listDistrosApi(),
    listDir: (distro, path) => listDirApi(distro, path),
    check: (distro, path) => checkApi(distro, path),
    createWorkspace: async (path): Promise<string | undefined> => {
      try {
        const view = await workspaces.create({ path })
        workspaces.startSession(view.workspaceId)
        return undefined
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
  })

  ctx.effect(
    () => ctx.slots.inject(
      'sidebar.footer.action',
      () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'wsl-workspace', inject: injected },
        AddWslWorkspace,
      ),
    ),
    'dsh-wsl-workspace: sidebar footer action',
  )

  // Mode-variant binding: a blank session whose workspace is a WSL UNC path
  // is recomposed to the WSL variant of the mode it currently runs — plain
  // 标准 becomes `wsl-standard`, PTC becomes `wsl-code`, and so on — so the
  // WSL execution world composes with ANY mode instead of replacing it. The
  // host refuses non-blank sessions (agent-preset-locked), so the swap is
  // attempted at most a few times per session.
  ctx.effect(() => {
    const inFlight = new Set<string>()
    const attempts = new Map<string, number>()
    const MAX_ATTEMPTS = 3
    // Healthy `wsl-<mode>` variant ids plus the roster's default preset id
    // (what a session with no explicit choice gets). Refreshed periodically
    // so variants generated after this page loaded are picked up.
    let variants = new Set<string>()
    let defaultPreset: string | undefined
    const refreshRoster = (): void => {
      void api.agentPresets.list({}).then((response: {
        result: { ok: boolean; value: { presets: { id: string; broken?: string; isDefault?: boolean }[] } }
      }) => {
        const result = response.result
        if (!result.ok) return
        variants = new Set(result.value.presets
          .filter((entry: { id: string; broken?: string }) =>
            entry.broken === undefined && entry.id.startsWith('wsl-'))
          .map((entry: { id: string }) => entry.id))
        defaultPreset = result.value.presets.find(
          (entry: { id: string; isDefault?: boolean }) => entry.isDefault === true,
        )?.id
      }).catch(() => {
        // A failed roster read leaves the previous mapping; sessions stay on
        // their current composition until the next refresh.
      })
    }
    refreshRoster()
    const maybeBind = (): void => {
      const state = sessions.list.getSnapshot()
      for (const id of state.ids) {
        const summary = state.byId[id]
        if (summary === undefined || !summary.blank || summary.cwd === undefined) continue
        if (!isWslUnc(summary.cwd)) continue
        const current = summary.agentPreset
        if (current !== undefined && current.startsWith('wsl-')) continue
        // Legacy standalone `wsl` (now folded into the variants): remap it to
        // the default mode's variant, since the standalone preset no longer
        // exists in the roster.
        const base = current === LEGACY_WSL_PRESET_ID
          ? (defaultPreset ?? 'standard')
          : (current ?? defaultPreset)
        if (base === undefined || base === LEGACY_WSL_PRESET_ID || base.startsWith('wsl-')) continue
        const target = `wsl-${base.toLowerCase()}`
        if (!variants.has(target)) continue
        if (inFlight.has(id) || (attempts.get(id) ?? 0) >= MAX_ATTEMPTS) continue
        inFlight.add(id)
        void api.agentPresets.select({ sessionId: id, agentPreset: target })
          .then((response: { result: { ok: boolean } }) => {
            if (response.result.ok) sessions.noteAgentPreset(id, target)
          })
          .catch(() => {
            // A refused or aborted swap (session already produced output,
            // roster churn, reconnect) leaves the session on its current
            // composition; count the attempt so a stuck session stops
            // retrying after MAX_ATTEMPTS.
            attempts.set(id, (attempts.get(id) ?? 0) + 1)
          })
          .finally(() => {
            inFlight.delete(id)
          })
      }
    }
    maybeBind()
    const unsubscribe = sessions.list.subscribe(() => maybeBind())
    // Variants are generated at host boot; a page loaded before that would
    // never see them without a periodic refresh.
    const timer = window.setInterval(refreshRoster, 60_000)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, 'dsh-wsl-workspace: WSL mode-variant binding')
}
