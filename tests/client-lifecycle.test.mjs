// Client-lifecycle regressions for the browser half, executed against the
// SHIPPED bundle (lib/client.js) rather than the sources, so a bundling or
// entry-point mistake fails here too.
//
// The fixture models the two service shapes the supported DSH lines expose:
//   legacy (<= 0.1.1-rc.2): connection.api.agentPresets + workspaces.startSession
//   current (>= 0.1.2-rc.1): remote.agentPresets namespace + uiWorkspace
// and the session-summary field each line serves for the agent preset
// (`agentPreset` at the top level vs `projectionValues.agentPreset`).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

/**
 * Mount the shipped client bundle over a fake DSH client runtime.
 * @param options.legacy - model a v0.1.1-rc.2 runtime instead of v0.1.2-rc.1+.
 * @param options.late - register the version-dependent services only after
 *   `apply()` has run, which is what the real runtime does: this plugin applies
 *   before the UI domain publishing `uiWorkspace` registers its service.
 * @param options.startService - which session starter to expose: 'ui',
 *   'legacy' (on `workspaces`), or 'none'.
 */
function fixture({ legacy = false, late = false, startService = legacy ? 'legacy' : 'ui' } = {}) {
  let plugin, dialog, subscriber, tick;
  const effects = [], calls = [];
  const summary = legacy
    ? { blank: true, cwd: '\\\\wsl.localhost\\Ubuntu\\tmp\\fixture', agentPreset: 'standard' }
    : { blank: true, cwd: '\\\\wsl.localhost\\Ubuntu\\tmp\\fixture', projectionValues: { agentPreset: 'standard' } };
  const state = { ids: ['s1'], byId: { s1: summary } };
  const setPreset = value => {
    if (legacy) summary.agentPreset = value;
    else summary.projectionValues = { agentPreset: value };
  };
  const presets = ['standard', 'code', 'ptc', 'minimal', 'cordis', 'custom']
    .flatMap(id => [{ id, isDefault: id === 'standard' }, { id: `wsl-${id}` }]);
  const services = {
    sessions: {
      list: { getSnapshot: () => state, subscribe: fn => (subscriber = fn, () => { subscriber = undefined; }) },
    },
    workspaces: {
      create: async () => { calls.push(['create']); return { workspaceId: 'w1' }; },
    },
  };
  if (legacy) {
    services.sessions.noteAgentPreset = (_id, id) => { calls.push(['note', id]); setPreset(id); };
  }
  if (startService === 'legacy') {
    services.workspaces.startSession = id => { calls.push(['start', id]); };
  }

  const mount = () => {
    if (legacy) {
      services.connection = { api: { agentPresets: {
        list: async () => ({ result: { ok: true, value: { presets } } }),
        select: async args => {
          calls.push(['select', args.agentPreset]);
          setPreset(args.agentPreset);
          return { result: { ok: true } };
        },
      } } };
      return;
    }
    services['remote.agentPresets'] = {
      list: async () => ({ ok: true, value: { presets } }),
      select: async (_sessionId, presetId) => {
        calls.push(['select', presetId]);
        setPreset(presetId);
        return { ok: true };
      },
    };
    if (startService === 'ui') {
      services.uiWorkspace = { startSession: id => { calls.push(['start', id]); } };
    }
  };
  if (!late) mount();

  const ctx = {
    get: key => services[key],
    effect: fn => effects.push(fn()),
    locale: { register: () => () => {}, bind: () => key => key },
    slots: { inject: (_name, fn) => fn(), register: config => { dialog = config.inject(); return () => {}; } },
  };
  services.slots = ctx.slots;

  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: { load: mod => { plugin = mod.factory(() => ({})); } },
      setInterval: fn => (tick = fn, 1),
      clearInterval: () => { tick = undefined; },
    },
    console,
    document: { getElementById: () => ({}), querySelector: () => ({}) },
    // The plugin's host API calls (workspace key store) are not under test here.
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: [] }) }),
  });
  plugin.apply(ctx);
  return {
    calls, services, dialog, mount, summary, setPreset,
    emit: () => subscriber?.(),
    tick: () => tick?.(),
    dispose: () => effects.reverse().forEach(fn => typeof fn === 'function' && fn()),
    selected: () => calls.filter(c => c[0] === 'select').map(c => c[1]),
    creates: () => calls.filter(c => c[0] === 'create').length,
    starts: () => calls.filter(c => c[0] === 'start').map(c => c[1]),
  };
}

for (const legacy of [true, false]) {
  const line = legacy ? 'legacy' : 'current';

  test(`${line}: apply() survives a runtime that exposes no version-specific service`, async () => {
    const f = fixture({ legacy, late: true, startService: 'none' });
    await flush();
    assert.equal(f.selected().length, 0);
    f.dispose();
  });

  test(`${line}: a blank WSL session binds to its WSL variant`, async () => {
    const f = fixture({ legacy });
    await flush();
    assert.deepEqual(f.selected(), ['wsl-standard']);
    f.dispose();
  });

  test(`${line}: a blank session binds when the services land after apply`, async () => {
    const f = fixture({ legacy, late: true });
    await flush();
    f.mount();
    f.tick();
    await flush();
    assert.deepEqual(f.selected(), ['wsl-standard']);
    f.dispose();
  });

  test(`${line}: every mode converges to its WSL variant`, async () => {
    const f = fixture({ legacy });
    await flush();
    for (const mode of ['code', 'ptc', 'minimal', 'cordis', 'custom']) {
      f.setPreset(mode);
      f.emit();
      await flush();
      assert.equal(f.selected().at(-1), `wsl-${mode}`);
    }
    f.dispose();
  });

  test(`${line}: create & open starts a session in the new workspace`, async () => {
    const f = fixture({ legacy });
    await flush();
    const error = await f.dialog.createWorkspace('/home/mille/ws', 'mille', 'Ubuntu');
    assert.equal(error, undefined);
    assert.equal(f.creates(), 1);
    assert.deepEqual(f.starts(), ['w1']);
    f.dispose();
  });
}

test('current: create & open starts a session when uiWorkspace registers after apply', async () => {
  // Regression: the plugin applies before the UI domain publishing
  // `uiWorkspace` registers its service, so caching the lookup at apply time
  // made `startSession` unavailable for the whole page life and left the new
  // workspace behind with no session.
  const f = fixture({ legacy: false, late: true });
  await flush();
  assert.equal(typeof f.services.uiWorkspace, 'undefined');
  f.mount();
  const error = await f.dialog.createWorkspace('/home/mille/ws', 'mille', 'Ubuntu');
  assert.equal(error, undefined);
  assert.equal(f.creates(), 1);
  assert.deepEqual(f.starts(), ['w1']);
  f.dispose();
});

test('create & open refuses without a session starter, and writes nothing', async () => {
  for (const legacy of [true, false]) {
    const f = fixture({ legacy, startService: 'none' });
    await flush();
    const error = await f.dialog.createWorkspace('/home/mille/ws', 'mille', 'Ubuntu');
    assert.equal(typeof error, 'string');
    assert.match(error, /session API unavailable/);
    // The point of resolving the starter first: no orphaned workspace.
    assert.equal(f.creates(), 0);
    f.dispose();
  }
});

test('current: create & open never falls back to the legacy starter', async () => {
  // A v0.1.2-rc.1+ runtime keeps `uiWorkspace`; `workspaces.startSession` is
  // gone there, so the legacy branch must not be reached even if a stray
  // function of that name exists.
  const f = fixture({ legacy: false, startService: 'ui' });
  await flush();
  const error = await f.dialog.createWorkspace('/home/mille/ws', 'mille', 'Ubuntu');
  assert.equal(error, undefined);
  assert.deepEqual(f.starts(), ['w1']);
  f.dispose();
});
