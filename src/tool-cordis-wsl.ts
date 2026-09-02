/**
 * WSL-safe adapter for the optional Creator-mode Cordis toolset.
 *
 * DSH composes a replacement preset before it disposes the current one. The
 * upstream tool registers four process-global inspect providers, so changing
 * between `cordis` and `wsl-cordis` would otherwise reject the replacement as
 * a duplicate. WSL variants give those providers their own names and share
 * them across concurrently mounted WSL Creator sessions.
 */

import type { Context } from '@deepseek-ai/cordis'
import * as ToolCordis from '@deepseek-ai/dsh-tool-cordis'

interface InspectManifest {
  id: string
  description: string
  methods: readonly unknown[]
}

interface InspectRegistration {
  manifest: InspectManifest
  query(...args: unknown[]): unknown
}

interface InspectRegistry {
  register(registration: InspectRegistration): () => void
}

interface SharedRegistration {
  delegates: Map<symbol, InspectRegistration>
  dispose(): void
}

const sharedByRegistry = new WeakMap<object, Map<string, SharedRegistration>>()

/** Register one WSL-namespaced provider, reference-counted per Host registry. */
function registerShared(
  registry: InspectRegistry,
  originalRegister: InspectRegistry['register'],
  registration: InspectRegistration,
): () => void {
  const id = `wsl-${registration.manifest.id}`
  let entries = sharedByRegistry.get(registry)
  if (entries === undefined) {
    entries = new Map()
    sharedByRegistry.set(registry, entries)
  }

  const token = Symbol(id)
  let shared = entries.get(id)
  if (shared === undefined) {
    const delegates = new Map<symbol, InspectRegistration>([[token, registration]])
    const aliased: InspectRegistration = {
      ...registration,
      manifest: { ...registration.manifest, id },
      query(...args: unknown[]): unknown {
        const delegate = [...delegates.values()].at(-1)
        if (delegate === undefined) throw new Error(`WSL Cordis inspect provider "${id}" is unavailable`)
        return Reflect.apply(delegate.query, delegate, args)
      },
    }
    const dispose = Reflect.apply(originalRegister, registry, [aliased]) as () => void
    shared = { delegates, dispose }
    entries.set(id, shared)
  } else {
    shared.delegates.set(token, registration)
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const active = entries?.get(id)
    if (active !== shared) return
    active.delegates.delete(token)
    if (active.delegates.size > 0) return
    entries?.delete(id)
    active.dispose()
  }
}

export const name = 'tool-cordis-wsl'
export const inject = ToolCordis.inject

/** Apply the upstream toolset while namespacing only its global providers. */
export function apply(ctx: Context): void {
  const registry = ctx.get('cordisInspect') as unknown as InspectRegistry | undefined
  if (registry === undefined || typeof registry.register !== 'function') {
    // Older Creator implementations did not expose this global registry.
    ToolCordis.apply(ctx)
    return
  }

  const originalRegister = registry.register
  registry.register = registration => registerShared(registry, originalRegister, registration)
  try {
    ToolCordis.apply(ctx)
  } finally {
    registry.register = originalRegister
  }
}
