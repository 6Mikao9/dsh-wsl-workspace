window.__ModuleLoader__.load({
	id: "dsh-wsl-workspace",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		/**
		* Thin fetch client for the Host plugin route. The browser calls
		* POST /wsl-workspace/api with a `{ method, params }` envelope and the Host
		* answers `{ ok: true, value }` or `{ ok: false, error }`.
		*/
		/** Relative route the Host half registers (same-origin with the web server). */
		const ENDPOINT = "/wsl-workspace/api";
		/** Human text for an unknown rejection, reusing the repository's idiom. */
		function errorMessage(value) {
			return value instanceof Error ? value.message : String(value);
		}
		/**
		* Perform one POST call and unwrap the envelope.
		* @param method - the Host method name.
		* @param params - the method payload.
		* @returns the unwrapped value, or throws an Error on network or `ok:false`.
		*/
		async function call(method, params = {}) {
			let response;
			try {
				response = await fetch(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						method,
						params
					})
				});
			} catch (error) {
				throw new Error(`wsl-workspace request failed: ${errorMessage(error)}`);
			}
			let envelope;
			try {
				envelope = await response.json();
			} catch {
				throw new Error(`wsl-workspace answered non-JSON (${response.status})`);
			}
			if (!envelope.ok) throw new Error(envelope.error);
			return envelope.value;
		}
		/**
		* List the WSL distros installed on the host.
		* @returns distro names in registry order.
		*/
		async function listDistros() {
			return call("listDistros", {});
		}
		/**
		* List one directory level inside a distro.
		* @param distro - distro name.
		* @param path - absolute Linux directory to list.
		* @returns the level's listing with ancestry.
		*/
		async function listDir(distro, path) {
			return call("listDir", {
				distro,
				path
			});
		}
		/**
		* Check whether a Linux path exists and is a directory.
		* @param distro - distro name.
		* @param path - absolute Linux path.
		* @returns existence and directory facts.
		*/
		async function check(distro, path) {
			return call("check", {
				distro,
				path
			});
		}
		/**
		* Store (or clear, with an empty string) the username of one WSL workspace.
		* @param path - the workspace UNC path.
		* @param username - the Linux username; empty string clears the stored value.
		*/
		async function setWorkspaceUser(path, username) {
			return call("setUser", {
				path,
				username
			});
		}
		/**
		* Register a `/mnt/<drive>` WSL workspace under its Windows drive path,
		* recording the distro (and optional username) for the session env.
		* @param linuxPath - the `/mnt/<drive>/…` Linux path.
		* @param distro - the WSL distribution the workspace belongs to.
		* @param username - optional Linux username.
		*/
		async function registerWindows(linuxPath, distro, username) {
			return call("registerWindows", {
				linuxPath,
				distro,
				username
			});
		}
		/**
		* List every registered WSL workspace key (canonical UNC and Windows drive
		* spellings). The client uses the drive keys to recognize `/mnt` workspaces
		* across page reloads.
		*/
		async function listWorkspaces() {
			return call("listWorkspaces", {});
		}
		//#endregion
		//#region src/shared/paths.ts
		/** The two UNC hosts WSL exposes a distribution's filesystem under. */
		const UNC_HOSTS = ["wsl.localhost", "wsl$"];
		/**
		* Parse a WSL UNC path into its distro and Linux path. Accepts the WSL2
		* `\\wsl.localhost\<distro>\<linux>` form, the legacy `\\wsl$\<distro>\<linux>`
		* interop form, and forward-slash spellings of either.
		* @param raw - candidate absolute path.
		* @returns the parsed target, or null when the path is not a WSL UNC.
		*/
		function parseWslUnc(raw) {
			const normalized = raw.replace(/\\/g, "/").replace(/\/\/+/g, "//");
			if (!normalized.startsWith("//")) return null;
			const segments = normalized.slice(2).split("/");
			const host = (segments[0] ?? "").toLowerCase();
			if (!UNC_HOSTS.includes(host)) return null;
			const distro = segments[1] ?? "";
			if (distro === "") return null;
			return {
				distro,
				linuxPath: `/${segments.slice(2).filter((segment) => segment.length > 0).join("/")}`
			};
		}
		/**
		* Whether a path resolves into a WSL distro through either UNC form.
		* @param raw - candidate absolute path.
		* @returns whether the path parses as a WSL UNC.
		*/
		function isWslUnc(raw) {
			return parseWslUnc(raw) !== null;
		}
		/**
		* Normalize a Linux absolute path for the Host: collapse repeated slashes and
		* strip a trailing slash (root becomes `/`).
		* @param path - absolute Linux path.
		* @returns the normalized path.
		*/
		function normalizeLinuxPath(path) {
			const collapsed = path.replace(/\/+/g, "/");
			return collapsed === "/" ? "/" : collapsed.replace(/\/$/, "");
		}
		/**
		* Whether a path is an absolute, non-empty Linux path.
		* @param path - candidate.
		* @returns whether it starts with `/` and contains no NUL.
		*/
		function isAbsoluteLinuxPath(path) {
			return path.startsWith("/") && !path.includes("\0");
		}
		/**
		* Join a distro and a Linux absolute path into the WSL2 UNC form used as the
		* workspace identity (`\\wsl.localhost\<distro>\<linux>`, backslash segments).
		* @param distro - distro name.
		* @param linuxPath - absolute Linux path (leading `/`).
		* @returns the UNC path.
		*/
		function joinUnc(distro, linuxPath) {
			if (!isAbsoluteLinuxPath(linuxPath)) throw new Error(`wsl-workspace: cannot map a non-absolute Linux path "${linuxPath}" to UNC`);
			if (distro === "" || distro === "." || distro === ".." || /[\\/]/.test(distro)) throw new Error(`wsl-workspace: invalid distribution name "${distro}"`);
			const normalized = linuxPath.replace(/\/+/g, "/").replace(/\/$/, "");
			const windowsSegments = (normalized.startsWith("/") ? normalized.slice(1) : normalized).replace(/\//g, "\\");
			return `\\\\wsl.localhost\\${distro}${windowsSegments === "" ? "" : `\\${windowsSegments}`}`;
		}
		/**
		* Translate a `/mnt/<drive>/…` path back to its Windows drive path.
		* @param linuxPath - the candidate Linux path.
		* @returns the `X:\…` drive path, or `null` when the path is not a drvfs mount.
		*/
		function mntToWindowsPath(linuxPath) {
			const match = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(linuxPath);
			if (match === null) return null;
			const rest = (match[2] ?? "").replace(/\//g, "\\");
			return `${(match[1] ?? "").toUpperCase()}:\\${rest}`;
		}
		/**
		* Canonical Windows drive path for store keys and cross-realm identity:
		* separators unified to `\`, trailing separator stripped, and the WHOLE path
		* lowercased — Windows paths compare case-insensitively, and the workspace
		* registry may realpath a different casing than the caller spelled (8.3 or
		* on-disk casing), so the store key must collide across casings.
		* @param path - candidate Windows drive path.
		* @returns the canonical form, or `null` when not drive-shaped.
		*/
		function canonicalWindowsPath(path) {
			const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
			if (match === null) return null;
			const rest = (match[2] ?? "").replace(/[\\/]+/g, "\\").replace(/\\$/, "").toLowerCase();
			return `${(match[1] ?? "").toLowerCase()}:\\${rest}`;
		}
		/** Linux username shape for `wsl.exe -u`: starts with a letter or underscore, then letters/digits/`_`/`.`/`-` (max 64). */
		const WSL_USERNAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
		/**
		* Whether a value is a safe Linux username for `wsl.exe -u`. The check is
		* strict on purpose: a value starting with `-` could be parsed as a wsl.exe
		* option instead of a username.
		* @param value - candidate username.
		* @returns whether it matches the Linux username shape.
		*/
		function isValidWslUsername(value) {
			return WSL_USERNAME_PATTERN.test(value);
		}
		//#endregion
		//#region src/client/AddWslWorkspace.tsx
		/**
		* Build the Linux child path one level below a parent, for the breadcrumb/
		* browse drill.
		* @param parent - the currently listed absolute path (`/` for root).
		* @param name - the child directory name.
		* @returns the child's absolute Linux path.
		*/
		function dirChildPath(parent, name) {
			return parent === "/" ? `/${name}` : `${parent}/${name}`;
		}
		/** A tiny inline terminal glyph for the dialog's directory rows. */
		function WslGlyph({ size = 16 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2.5",
						y: "4.5",
						width: "19",
						height: "15",
						rx: "2.5",
						stroke: "currentColor",
						strokeWidth: "1.6"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M6 9l3.2 2.6L6 14",
						stroke: "currentColor",
						strokeWidth: "1.6",
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: "M12 14h5",
						stroke: "currentColor",
						strokeWidth: "1.6",
						strokeLinecap: "round"
					})
				]
			});
		}
		/**
		* The "Add WSL workspace…" footer action and its dialog.
		* @param props - owner share + injected face.
		*/
		function AddWslWorkspace({ wide, t, checkPreset, listDistros, listDir, check, createWorkspace }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [opening, setOpening] = (0, react.useState)(false);
			const [distros, setDistros] = (0, react.useState)([]);
			const [distro, setDistro] = (0, react.useState)("");
			const [pathInput, setPathInput] = (0, react.useState)("/home/");
			const [username, setUsername] = (0, react.useState)("");
			const [listing, setListing] = (0, react.useState)(null);
			const [browsePath, setBrowsePath] = (0, react.useState)("/");
			const [browsing, setBrowsing] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const browseSeq = (0, react.useRef)(0);
			const refreshBrowse = async (root, targetDistro) => {
				const seq = ++browseSeq.current;
				setBrowsing(true);
				setBrowsePath(root);
				try {
					const value = await listDir(targetDistro, root);
					if (seq === browseSeq.current) setListing(value);
				} catch {
					if (seq === browseSeq.current) {
						setListing(null);
						setError((previous) => previous ?? t("error.loadDir"));
					}
				} finally {
					if (seq === browseSeq.current) setBrowsing(false);
				}
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				setError(null);
				setOpening(true);
				(async () => {
					let presetIssue;
					try {
						presetIssue = await checkPreset();
					} catch {
						presetIssue = t("error.loadDistros");
					}
					let names;
					try {
						names = await listDistros();
					} catch {
						if (cancelled) return;
						setOpening(false);
						setError(t("error.loadDistros"));
						return;
					}
					if (cancelled) return;
					setDistros(names);
					const first = names[0] ?? "";
					setDistro(first);
					setBrowsing(true);
					setOpening(false);
					if (presetIssue !== void 0) setError(presetIssue);
					if (first !== "") refreshBrowse("/", first);
				})();
				return () => {
					cancelled = true;
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onKey = (event) => {
					if (event.key === "Escape" && !busy) setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open, busy]);
			if (!open) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: wide ? "dww-action dww-action--wide" : "dww-action dww-action--rail",
				title: t("action.title"),
				"aria-label": t("action.title"),
				onClick: () => setOpen(true),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dww-letter",
					"aria-hidden": "true",
					children: "W"
				})
			});
			const onDrill = (name) => {
				const next = dirChildPath(listing?.path ?? browsePath, name);
				setPathInput(next);
				refreshBrowse(next, distro);
			};
			const onUp = () => {
				const parent = listing?.parent ?? null;
				if (parent === null) return;
				setPathInput(parent);
				refreshBrowse(parent, distro);
			};
			const onDistroChange = (value) => {
				setDistro(value);
				refreshBrowse(browsePath, value);
			};
			const onCheck = async () => {
				const path = normalizeLinuxPath(pathInput);
				setError(null);
				if (!isAbsoluteLinuxPath(path) || path === "/") {
					setError(t("error.invalidPath"));
					return;
				}
				let facts;
				try {
					facts = await check(distro, path);
				} catch {
					setError(t("error.pathNotFound"));
					return;
				}
				if (!facts.exists || !facts.isDirectory) {
					setError(t("error.pathNotFound"));
					return;
				}
				refreshBrowse(path, distro);
			};
			const onConfirm = async () => {
				const path = normalizeLinuxPath(pathInput);
				setError(null);
				if (!isAbsoluteLinuxPath(path) || path === "/") {
					setError(t("error.invalidPath"));
					return;
				}
				const user = username.trim();
				if (user !== "" && !isValidWslUsername(user)) {
					setError(t("error.invalidUsername"));
					return;
				}
				setBusy(true);
				try {
					let facts;
					try {
						facts = await check(distro, path);
					} catch {
						setError(t("error.pathNotFound"));
						return;
					}
					if (!facts.exists || !facts.isDirectory) {
						setError(t("error.pathNotFound"));
						return;
					}
					const failure = await createWorkspace(path, user, distro);
					if (failure !== void 0) {
						setError(failure);
						return;
					}
					setOpen(false);
				} finally {
					setBusy(false);
				}
			};
			const children = (listing?.entries.filter((entry) => entry.kind === "directory") ?? []).map((entry) => entry.name);
			const maskClick = () => {
				if (!busy) setOpen(false);
			};
			const listScroll = () => {};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dww-overlay",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dww-overlay-mask",
					onClick: maskClick
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dww-card",
					role: "dialog",
					"aria-modal": "true",
					"aria-label": t("dialog.title"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dww-header",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: "dww-title",
								children: t("dialog.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dww-close",
								"aria-label": t("dialog.cancel"),
								onClick: maskClick,
								children: "✕"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dww-body",
							children: [
								error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dww-error",
									children: [error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dww-retry",
										onClick: () => setError(null),
										children: t("dialog.retry")
									})]
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dww-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "dww-field-label",
										htmlFor: "dww-distro",
										children: t("dialog.distro")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
										id: "dww-distro",
										className: "dww-select",
										value: distro,
										disabled: opening || busy,
										onChange: (event) => onDistroChange(event.target.value),
										children: distros.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: opening ? t("dialog.loading") : ""
										}) : distros.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: name,
											children: name
										}, name))
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dww-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "dww-field-label",
										htmlFor: "dww-path",
										children: t("dialog.path")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dww-input-row",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											id: "dww-path",
											className: "dww-input",
											value: pathInput,
											placeholder: t("dialog.pathPlaceholder"),
											disabled: opening || busy,
											onChange: (event) => setPathInput(event.target.value)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "dww-check-btn",
											disabled: opening || busy,
											onClick: () => void onCheck(),
											children: t("dialog.check")
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dww-field",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
										className: "dww-field-label",
										htmlFor: "dww-username",
										children: t("dialog.username")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										id: "dww-username",
										className: "dww-input",
										value: username,
										placeholder: t("dialog.usernamePlaceholder"),
										disabled: opening || busy,
										autoComplete: "off",
										spellCheck: false,
										onChange: (event) => setUsername(event.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dww-feedback",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dww-breadcrumb",
										children: browsePath
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dww-dirlist",
										onScroll: listScroll,
										children: [browsing ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dww-dir-empty",
											children: t("dialog.loading")
										}) : listing?.parent !== null && listing !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dww-dir-row dww-dir-row--up",
											onClick: onUp,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WslGlyph, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("dialog.upLevel") })]
										}) : null, !browsing && children.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dww-dir-empty",
											children: t("dialog.browseEmpty")
										}) : children.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: "dww-dir-row",
											onClick: () => onDrill(name),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WslGlyph, { size: 14 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: name })]
										}, name))]
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dww-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dww-btn",
								disabled: busy,
								onClick: maskClick,
								children: t("dialog.cancel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dww-btn dww-btn--primary",
								disabled: busy || opening,
								onClick: () => void onConfirm(),
								children: busy ? t("dialog.loading") : t("dialog.confirm")
							})]
						})
					]
				})]
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* Third-party stylesheet injection for the WSL workspace UI (the plugin
		* builds no CSS bundle, so styles are injected as one idempotent `<style>`).
		* Colors derive exclusively from the `--dsw-*` design tokens.
		*/
		const STYLE_TAG_DATA_ATTRIBUTE = "data-plugin=\"dsh-wsl-workspace\"";
		const STYLES = `
/* Sidebar-foot icon action beside Settings (28px round in the wide sidebar,
   36px round in the rail), matching the shell's icon-button language. */
.dww-action {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  transition:
    background-color 120ms var(--dsw-ease-in-out, ease-in-out),
    color 120ms var(--dsw-ease-in-out, ease-in-out);
}
.dww-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.dww-action:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-pressed, var(--dsw-alias-interactive-bg-hover));
}
.dww-action:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dww-action:disabled { cursor: default; opacity: 0.6; }
.dww-action--rail {
  width: 36px;
  height: 36px;
  color: var(--dsw-alias-label-primary);
}
.dww-action svg { flex: none; }

/* The W letter mark of the sidebar action (sized for wide/rail buttons). */
.dww-letter {
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
  user-select: none;
}
.dww-action--rail .dww-letter { font-size: 17px; }

/* Full-viewport overlay + centered card (mirrors the platform Mask/Dialog). */
.dww-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dww-overlay-mask {
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
}
.dww-card {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(440px, 100%);
  max-height: min(640px, 90vh);
  padding: 0 0 20px;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv3);
  font-family: var(--dsw-font-family);
}
.dww-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 18px 20px 12px;
}
.dww-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dww-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.dww-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dww-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 0 20px;
  overflow: auto;
}
.dww-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dww-field-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.dww-select {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}
.dww-input-row { display: flex; gap: 8px; align-items: center; }
.dww-input {
  box-sizing: border-box;
  flex: 1;
  height: 36px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
}
.dww-input:focus, .dww-select:focus {
  outline: none;
  border-color: var(--dsw-alias-state-business-primary);
}
.dww-check-btn {
  flex: none;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 12px;
}
.dww-check-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dww-check-btn:disabled { cursor: default; }

/* Directory browse list. */
.dww-dirlist {
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
  min-height: 120px;
  max-height: 200px;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
}
.dww-breadcrumb {
  padding: 0 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dww-dir-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.dww-dir-row:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dww-dir-row:disabled { cursor: default; color: var(--dsw-alias-label-tertiary); }
.dww-dir-row--up { color: var(--dsw-alias-label-secondary); }
.dww-dir-row svg { flex: none; color: var(--dsw-alias-label-tertiary); }
.dww-dir-empty {
  padding: 8px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

/* Error strip. */
.dww-error {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dww-retry {
  margin-left: 6px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
}

/* Dialog footer actions. */
.dww-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 0;
}
.dww-btn {
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 14px;
}
.dww-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dww-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dww-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dww-btn:disabled { cursor: default; opacity: 0.6; }
`;
		/**
		* Idempotently inject the plugin stylesheet. No-op when a tag with the
		* plugin's data attribute already exists.
		*/
		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[${STYLE_TAG_DATA_ATTRIBUTE}]`) !== null) return;
			const style = document.createElement("style");
			style.setAttribute("data-plugin", "dsh-wsl-workspace");
			style.textContent = STYLES;
			document.head.appendChild(style);
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Bilingual dictionaries for the `wslWorkspace` locale namespace. Product copy
		* is Chinese; English is the parallel export for the standalone bundle.
		*/
		/**
		* The `wslWorkspace` translations (Chinese, the primary product copy).
		*/
		const zh = {
			"action.add": "WSL 工作区",
			"action.title": "添加 WSL 工作区…",
			"dialog.title": "添加 WSL 工作区",
			"dialog.distro": "发行版",
			"dialog.path": "路径",
			"dialog.pathPlaceholder": "/home/",
			"dialog.username": "用户名",
			"dialog.usernamePlaceholder": "留空则使用发行版默认用户",
			"dialog.loading": "正在加载…",
			"dialog.browseEmpty": "此目录没有子文件夹",
			"dialog.upLevel": "..（返回上级）",
			"dialog.browse": "浏览",
			"dialog.check": "检查",
			"dialog.confirm": "创建并打开",
			"dialog.cancel": "取消",
			"dialog.retry": "重试",
			"error.loadDistros": "无法获取 WSL 发行版列表，请确认已安装 WSL 且插件宿主端可用",
			"error.rateLimited": "操作过于频繁，请稍后重试",
			"error.loadDir": "无法浏览该目录",
			"error.presetMissing": "未找到健康的 wsl preset，请确认插件宿主端已安装并配置该 preset",
			"error.invalidPath": "请输入以 / 开头的 Linux 绝对路径",
			"error.invalidUsername": "用户名无效：需以字母或下划线开头，仅含字母、数字、_、.、-",
			"error.pathNotFound": "该路径不存在或是文件，请选择一个文件夹",
			"error.createFailed": "创建工作区失败"
		};
		/**
		* The `wslWorkspace` translations (English).
		*/
		const en = {
			"action.add": "WSL Workspace",
			"action.title": "Add WSL workspace…",
			"dialog.title": "Add WSL workspace",
			"dialog.distro": "Distro",
			"dialog.path": "Path",
			"dialog.pathPlaceholder": "/home/",
			"dialog.username": "Username",
			"dialog.usernamePlaceholder": "Leave empty to use the distro default user",
			"dialog.loading": "Loading…",
			"dialog.browseEmpty": "No subdirectories here",
			"dialog.upLevel": ".. (up)",
			"dialog.browse": "Browse",
			"dialog.check": "Check",
			"dialog.confirm": "Create & open",
			"dialog.cancel": "Cancel",
			"dialog.retry": "Retry",
			"error.loadDistros": "Could not list WSL distros; confirm WSL is installed and the plugin host side is reachable",
			"error.rateLimited": "Too many attempts; retry in a moment",
			"error.loadDir": "Could not browse this directory",
			"error.presetMissing": "No healthy \"wsl\" preset found; confirm the plugin host side installed and configured it",
			"error.invalidPath": "Enter an absolute Linux path starting with /",
			"error.invalidUsername": "Invalid username: start with a letter or underscore; only letters, digits, _ . -",
			"error.pathNotFound": "The path does not exist or is a file; choose a folder",
			"error.createFailed": "Failed to create the workspace"
		};
		//#endregion
		//#region src/client/index.ts
		/** Required services (cordis fiber inject). */
		const inject = [
			"slots",
			"locale",
			"connection",
			"sessions",
			"workspaces"
		];
		/** The legacy standalone WSL preset id (folded into the mode variants). */
		const LEGACY_WSL_PRESET_ID = "wsl";
		/**
		* Mount the sidebar action and the auto-binding effect.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const { api } = ctx.get("connection");
			const workspaces = ctx.get("workspaces");
			const sessions = ctx.get("sessions");
			ensureStyles();
			ctx.effect(() => ctx.locale.register("wslWorkspace", {
				zh,
				en
			}), "dsh-wsl-workspace: locale dictionaries");
			const t = ctx.locale.bind("wslWorkspace");
			let wslWindowsPaths = /* @__PURE__ */ new Set();
			const injected = () => ({
				t,
				checkPreset: async () => {
					let roster;
					try {
						roster = (await api.agentPresets.list({})).result;
					} catch (error) {
						return error instanceof Error ? error.message : String(error);
					}
					if (!roster.ok) return roster.error.message;
					if (roster.value.presets.find((entry) => entry.id.startsWith("wsl-") && entry.broken === void 0) === void 0) return t("error.presetMissing");
				},
				listDistros: () => listDistros(),
				listDir: (distro, path) => listDir(distro, path),
				check: (distro, path) => check(distro, path),
				createWorkspace: async (linuxPath, username, distro) => {
					try {
						const winPath = mntToWindowsPath(linuxPath);
						if (winPath !== null) {
							const view = await workspaces.create({ path: winPath });
							await registerWindows(linuxPath, distro, username);
							const canonical = canonicalWindowsPath(winPath);
							if (canonical !== null) wslWindowsPaths = new Set(wslWindowsPaths).add(canonical);
							workspaces.startSession(view.workspaceId);
							return;
						}
						const uncPath = joinUnc(distro, linuxPath);
						const view = await workspaces.create({ path: uncPath });
						await setWorkspaceUser(uncPath, username);
						workspaces.startSession(view.workspaceId);
						return;
					} catch (error) {
						return error instanceof Error ? error.message : String(error);
					}
				}
			});
			ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "wsl-workspace",
				inject: injected
			}, AddWslWorkspace)), "dsh-wsl-workspace: sidebar footer action");
			ctx.effect(() => {
				const inFlight = /* @__PURE__ */ new Set();
				const attempts = /* @__PURE__ */ new Map();
				const MAX_ATTEMPTS = 3;
				let variants = /* @__PURE__ */ new Set();
				let defaultPreset;
				const refreshRoster = () => {
					api.agentPresets.list({}).then((response) => {
						const result = response.result;
						if (!result.ok) return;
						variants = new Set(result.value.presets.filter((entry) => entry.broken === void 0 && entry.id.startsWith("wsl-")).map((entry) => entry.id));
						defaultPreset = result.value.presets.find((entry) => entry.isDefault === true)?.id;
					}).catch(() => {});
				};
				refreshRoster();
				const refreshWorkspaces = () => {
					listWorkspaces().then((keys) => {
						const next = /* @__PURE__ */ new Set();
						for (const key of keys) {
							const canonical = canonicalWindowsPath(key);
							if (canonical !== null) next.add(canonical);
						}
						wslWindowsPaths = next;
					}).catch(() => {});
				};
				refreshWorkspaces();
				const maybeBind = () => {
					const state = sessions.list.getSnapshot();
					for (const id of state.ids) {
						const summary = state.byId[id];
						if (summary === void 0 || !summary.blank || summary.cwd === void 0) continue;
						const canonical = canonicalWindowsPath(summary.cwd);
						if (!(isWslUnc(summary.cwd) || canonical !== null && wslWindowsPaths.has(canonical))) continue;
						const current = summary.agentPreset;
						if (current !== void 0 && current.startsWith("wsl-")) continue;
						const base = current === LEGACY_WSL_PRESET_ID ? defaultPreset ?? "standard" : current ?? defaultPreset;
						if (base === void 0 || base === LEGACY_WSL_PRESET_ID || base.startsWith("wsl-")) continue;
						const target = `wsl-${base.toLowerCase()}`;
						if (!variants.has(target)) continue;
						if (inFlight.has(id) || (attempts.get(id) ?? 0) >= MAX_ATTEMPTS) continue;
						inFlight.add(id);
						api.agentPresets.select({
							sessionId: id,
							agentPreset: target
						}).then((response) => {
							if (response.result.ok) sessions.noteAgentPreset(id, target);
						}).catch(() => {
							attempts.set(id, (attempts.get(id) ?? 0) + 1);
						}).finally(() => {
							inFlight.delete(id);
						});
					}
				};
				maybeBind();
				const unsubscribe = sessions.list.subscribe(() => maybeBind());
				const timer = window.setInterval(refreshRoster, 6e4);
				return () => {
					unsubscribe();
					window.clearInterval(timer);
				};
			}, "dsh-wsl-workspace: WSL mode-variant binding");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map