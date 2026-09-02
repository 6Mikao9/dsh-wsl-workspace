import * as ToolCordis from "@deepseek-ai/dsh-tool-cordis";
//#region src/tool-cordis-wsl.ts
const sharedByRegistry = /* @__PURE__ */ new WeakMap();
/** Register one WSL-namespaced provider, reference-counted per Host registry. */
function registerShared(registry, originalRegister, registration) {
	const id = `wsl-${registration.manifest.id}`;
	let entries = sharedByRegistry.get(registry);
	if (entries === void 0) {
		entries = /* @__PURE__ */ new Map();
		sharedByRegistry.set(registry, entries);
	}
	const token = Symbol(id);
	let shared = entries.get(id);
	if (shared === void 0) {
		const delegates = new Map([[token, registration]]);
		const aliased = {
			...registration,
			manifest: {
				...registration.manifest,
				id
			},
			query(...args) {
				const delegate = [...delegates.values()].at(-1);
				if (delegate === void 0) throw new Error(`WSL Cordis inspect provider "${id}" is unavailable`);
				return Reflect.apply(delegate.query, delegate, args);
			}
		};
		shared = {
			delegates,
			dispose: Reflect.apply(originalRegister, registry, [aliased])
		};
		entries.set(id, shared);
	} else shared.delegates.set(token, registration);
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		const active = entries?.get(id);
		if (active !== shared) return;
		active.delegates.delete(token);
		if (active.delegates.size > 0) return;
		entries?.delete(id);
		active.dispose();
	};
}
const name = "tool-cordis-wsl";
const inject = ToolCordis.inject;
/** Apply the upstream toolset while namespacing only its global providers. */
function apply(ctx) {
	const registry = ctx.get("cordisInspect");
	if (registry === void 0 || typeof registry.register !== "function") {
		ToolCordis.apply(ctx);
		return;
	}
	const originalRegister = registry.register;
	registry.register = (registration) => registerShared(registry, originalRegister, registration);
	try {
		ToolCordis.apply(ctx);
	} finally {
		registry.register = originalRegister;
	}
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=tool-cordis-wsl.js.map