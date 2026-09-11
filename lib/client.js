window.__ModuleLoader__.load({ id: "dsh-wsl-workspace", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));

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
/**
* Read the plugin build version and its declared DSH compatibility matrix,
* for the dialog help panel.
* @returns the self-description reported by the host plugin.
*/
async function describe() {
	return call("describe", {});
}

//#endregion
//#region src/shared/paths.ts
/**
* WSL path helpers shared by the client and host halves. Pure and
* dependency-free so both planes can import them without a runtime edge.
*/
/** WSL2 default loopback bridge host: `\\wsl.localhost\<distro>\...`. */
const WSL_LOCALHOST_HOST = "wsl.localhost";
/** Legacy WSL interop host: `\\wsl$\<distro>\...`. */
const WSL_LEGACY_HOST = "wsl$";
/** The two UNC hosts WSL exposes a distribution's filesystem under. */
const UNC_HOSTS = [WSL_LOCALHOST_HOST, WSL_LEGACY_HOST];
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
	const rest = segments.slice(2).filter((segment) => segment.length > 0);
	return {
		distro,
		linuxPath: `/${rest.join("/")}`
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
	const withoutLeading = normalized.startsWith("/") ? normalized.slice(1) : normalized;
	const windowsSegments = withoutLeading.replace(/\//g, "\\");
	const suffix = windowsSegments === "" ? "" : `\\${windowsSegments}`;
	return `\\\\wsl.localhost\\${distro}${suffix}`;
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
//#region src/client/help.tsx
/**
* Split one dictionary entry into its bullet lines.
* @param value - the multi-line dictionary string.
* @returns the non-empty lines, trimmed.
*/
function bullets(value) {
	return value.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}
/** One titled section of the panel. */
function Section({ title, children }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "dww-help-section",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
			className: "dww-help-title",
			children: title
		}), children]
	});
}
/**
* Render the help panel shown behind the dialog's "?" button.
* @param props - translate function plus the host's self-description.
*/
function WslHelp({ t, description }) {
	const releases = description?.releases ?? [];
	const version = description === null ? t("help.compat.unknown") : `${t("help.compat.versionLabel")} v${description.version}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "dww-help",
		role: "region",
		"aria-label": t("help.button"),
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Section, {
				title: t("help.compat.title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dww-help-meta",
						children: version
					}),
					releases.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dww-help-chips",
						children: releases.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dww-help-chip",
							children: entry.id
						}, entry.id))
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dww-help-list",
						children: bullets(t("help.compat.body")).map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: line }, line))
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
				title: t("help.usage.title"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dww-help-list",
					children: bullets(t("help.usage.body")).map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: line }, line))
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Section, {
				title: t("help.known.title"),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
					className: "dww-help-list dww-help-list--known",
					children: bullets(t("help.known.body")).map((line) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: line }, line))
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dww-help-footer",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					className: "dww-help-link",
					href: "https://www.npmjs.com/package/dsh-wsl-workspace",
					target: "_blank",
					rel: "noreferrer",
					children: t("help.footer.npm")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
					className: "dww-help-link",
					href: "https://github.com/6Mikao9/dsh-wsl-workspace",
					target: "_blank",
					rel: "noreferrer",
					children: t("help.footer.repo")
				})]
			})
		]
	});
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
function AddWslWorkspace({ wide, t, describe: describe$1, checkPreset, listDistros: listDistros$1, listDir: listDir$1, check: check$1, createWorkspace }) {
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
	const [helpOpen, setHelpOpen] = (0, react.useState)(false);
	const [selfDescription, setSelfDescription] = (0, react.useState)(null);
	const browseSeq = (0, react.useRef)(0);
	const refreshBrowse = async (root, targetDistro) => {
		const seq = ++browseSeq.current;
		setBrowsing(true);
		setBrowsePath(root);
		try {
			const value = await listDir$1(targetDistro, root);
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
		describe$1().then((value) => {
			if (!cancelled) setSelfDescription(value);
		}).catch(() => {
			if (!cancelled) setSelfDescription(null);
		});
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
				names = await listDistros$1();
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
			facts = await check$1(distro, path);
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
				facts = await check$1(distro, path);
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
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: "dww-title",
							children: t("dialog.title")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dww-help-btn",
							title: t("help.button"),
							"aria-label": t("help.button"),
							"aria-pressed": helpOpen,
							onClick: () => setHelpOpen((value) => !value),
							children: "?"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dww-close",
							"aria-label": t("dialog.cancel"),
							onClick: maskClick,
							children: "✕"
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dww-body",
					children: helpOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WslHelp, {
						t,
						description: selfDescription
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
					] })
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
/* Help panel behind the dialog's "?" button. */
.dww-help-btn {
  flex: none;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.dww-help-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dww-help-btn[aria-pressed='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dww-help {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 52vh;
  overflow-y: auto;
  padding-right: 4px;
}
.dww-help-section { display: flex; flex-direction: column; gap: 6px; }
.dww-help-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dww-help-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dww-help-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dww-help-chip {
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dww-help-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}
.dww-help-list--known { color: var(--dsw-alias-label-primary); }
.dww-help-footer {
  display: flex;
  gap: 14px;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dww-help-link { font-size: 12px; color: var(--dsw-alias-label-tertiary); text-decoration: underline; }
.dww-help-link:hover { color: var(--dsw-alias-label-primary); }
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
	"error.createFailed": "创建工作区失败",
	"help.button": "插件说明",
	"help.compat.title": "兼容性",
	"help.compat.versionLabel": "插件版本",
	"help.compat.unknown": "未能读取版本与兼容声明（宿主端没有响应）",
	"help.compat.body": "上方是这份构建声明兼容的 DSH 版本，每一条都在隔离实例上实测过（独立 DSH_HOME、依赖固定到该版本、跑满十项门禁）。\n插件在运行时会识别 DSH 版本：0.1.2 线用 uiWorkspace + remote.agentPresets，更早的版本用 workspaces.startSession + connection.api；两边都没有时会明确报错，而不是留下一个空工作区。\n版本不在列表里通常仍然可用，但未经验证。",
	"help.usage.title": "用法与特性",
	"help.usage.body": "点击侧边栏底部的 W 按钮 → 选发行版 → 输入或浏览 Linux 路径 → 检查 → 创建并打开。\n创建出的会话里，bash 与文件工具都落在该发行版内，模型看到的路径全是 Linux 路径；Windows 盘可从会话内通过 /mnt/<盘符> 访问。\n四种模式（标准 / PTC / 极简 / 创造）各有 WSL 变体，在模式选择器里直接选即可，名字形如 WSL · Standard mode（标准模式）。\n用户名可选，等价于 wsl.exe -u <用户名>，只改变 bash 的运行身份；文件工具走 Windows 侧共享，不受它影响。\n技能目录从会话 cwd 最近的 .git 祖先开始向下扫描 .dsh/skills 与 .agents/skills（含嵌套项目），上限 4 层目录 / 64 个技能目录 / 4096 个已访问目录，并按扫描根缓存 10 秒。\n为了让 UNC 工作区也能拿到目录，插件生成预设时会把技能行的 watch 关掉，目录改由会话启动时扫描一次：会话中途新加入的技能要等下一个会话才出现，而技能内容（get）始终是实时读取的。\nbash 在发行版内运行，不受 DSH 文件策略约束；文件工具（read/write/edit）受策略约束，工作区内修改模式下只能写工作区内。",
	"help.known.title": "已知问题",
	"help.known.body": "Windows 侧共享无法解析 Linux 符号链接：用 ln -s 链进工作区的项目发现不了（扫描会跳过、不报错），请把工作区注册在真实项目目录所在的层级。\n会话运行中途新加入的技能不会即时出现在目录里（因为对 UNC 关闭了文件监视，见「用法与特性」）；重开一个会话即可看到。技能内容本身始终实时读取。\n只有经本插件注册的 WSL 工作区才会默认用 WSL 变体；在其它工作区里手动新建的会话用宿主默认预设，bash/文件工具就是 Windows 侧的。\n0.4.3 已修复：UNC 工作区下模型收不到技能目录（宿主 fs.watch 在 \\\\wsl.localhost\\… 上失败导致整条目录消息被丢弃），现在生成预设时会关闭该监视，目录照常注入。",
	"help.footer.npm": "npm 包",
	"help.footer.repo": "GitHub 仓库"
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
	"error.createFailed": "Failed to create the workspace",
	"help.button": "About this plugin",
	"help.compat.title": "Compatibility",
	"help.compat.versionLabel": "Plugin version",
	"help.compat.unknown": "Version and compatibility declaration unavailable (the host side did not answer)",
	"help.compat.body": "The chips above are the DSH releases this build declares, each verified on an isolated instance (own DSH_HOME, dependencies pinned to that release, full check suite).\nThe plugin detects the DSH generation at runtime: the 0.1.2 line uses uiWorkspace + remote.agentPresets, older releases use workspaces.startSession + connection.api, and a release exposing neither fails loudly instead of leaving an empty workspace.\nA release outside the list usually still works, but is unverified.",
	"help.usage.title": "Usage and features",
	"help.usage.body": "Click the W button at the sidebar foot, pick a distribution, type or browse to a Linux path, press Check, then Create & open.\nIn that session the bash tool and the file tools run inside the distribution, so every path the model sees is a Linux path; Windows drives stay reachable as /mnt/<drive>.\nEach mode (Standard / PTC / Minimal / Creator) has a WSL variant in the mode picker, named like WSL · Standard mode.\nThe optional username behaves like wsl.exe -u <user> for the bash tool only; the file tools go through the Windows-side share and are unaffected.\nThe skill catalog is discovered from the nearest .git ancestor of the session cwd downwards (.dsh/skills and .agents/skills, nested projects included), bounded to 4 levels / 64 skill directories / 4096 visited directories, and cached per scan root for 10 seconds.\nSo that a UNC workspace still receives a catalog, the generated preset turns that row's `watch` off and the catalog is scanned once at session start: a skill added mid-session appears in the next session, while skill bodies are always read live.\nbash runs inside the distribution and is not wrapped by the DSH file policy; read/write/edit are, and workspace-write only writes inside the workspace.",
	"help.known.title": "Known issues",
	"help.known.body": "The Windows-side share cannot resolve Linux symlinks, so a project linked in with ln -s is not discoverable (the scan skips it without failing); register the workspace at a level that holds the real project directories.\nA skill added while a session is running does not show up in that session's catalog (file watching is off for UNC workspaces, see Usage and features); start a new session to pick it up. Skill bodies are always read live.\nOnly workspaces registered through this plugin default to a WSL variant; a session started by hand in another workspace keeps the host default preset, so its bash and file tools run on the Windows side.\nFixed in 0.4.3: on a UNC workspace the model did not receive the skill catalog at all (the host fs.watch call fails on \\\\wsl.localhost\\... and the whole catalog message was dropped). The generated preset now disables that watcher, and the catalog is injected as usual.",
	"help.footer.npm": "npm package",
	"help.footer.repo": "GitHub repository"
};

//#endregion
//#region src/client/index.ts
/** Required services (cordis fiber inject). */
const inject = [
	"slots",
	"locale",
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
	const workspaces = ctx.get("workspaces");
	const sessions = ctx.get("sessions");
	const legacyApi = () => ctx.get("connection")?.api;
	const remoteAgentPresets = () => ctx.get("remote.agentPresets");
	const uiWorkspaceService = () => ctx.get("uiWorkspace");
	const hasNoteAgentPreset = typeof sessions.noteAgentPreset === "function";
	/** Unified agent-preset list: new `remote.agentPresets` namespace (v0.1.2-rc.1+) or legacy `connection.api` (v0.1.1-rc.2). */
	const listAgentPresets = async () => {
		const agentPresets = remoteAgentPresets();
		if (agentPresets !== void 0) {
			const r = await agentPresets.list();
			if (!r.ok) return {
				ok: false,
				presets: [],
				error: r.error?.message ?? "list failed"
			};
			return {
				ok: true,
				presets: r.value?.presets ?? []
			};
		}
		const api = legacyApi();
		if (api !== void 0) {
			const r = await api.agentPresets.list({});
			if (!r.result.ok) return {
				ok: false,
				presets: [],
				error: r.result.error?.message ?? "list failed"
			};
			return {
				ok: true,
				presets: r.result.value?.presets ?? []
			};
		}
		return {
			ok: false,
			presets: [],
			error: "no remote api available"
		};
	};
	/** Unified agent-preset select: new `agentPresets.select(id, preset)` or legacy `connection.api.select({...})`. */
	const selectAgentPreset = async (sessionId, presetId) => {
		const agentPresets = remoteAgentPresets();
		if (agentPresets !== void 0) return agentPresets.select(sessionId, presetId);
		const api = legacyApi();
		if (api !== void 0) {
			const r = await api.agentPresets.select({
				sessionId,
				agentPreset: presetId
			});
			return { ok: r.result.ok };
		}
		return { ok: false };
	};
	/**
	* Resolve how this release opens a session for a workspace - v0.1.2-rc.1+
	* exposes `uiWorkspace.startSession`, v0.1.1-rc.2 keeps it on `workspaces`.
	*
	* Resolved BEFORE the workspace is written. A release that offers neither
	* cannot open a session, and a silent fall-through would leave the workspace
	* behind with an empty `sessionIds` while the dialog still reports success;
	* failing here names the missing capability instead.
	* @returns the starter for the service this release actually exposes.
	* @throws Error naming both candidates when neither service is available.
	*/
	const resolveSessionStarter = () => {
		const ui = uiWorkspaceService();
		if (ui !== void 0) return (workspaceId) => {
			ui.startSession(workspaceId);
		};
		const legacyStart = workspaces.startSession;
		if (typeof legacyStart === "function") return (workspaceId) => {
			Reflect.apply(legacyStart, workspaces, [workspaceId]);
		};
		throw new Error("workspace session API unavailable: this DSH release exposes neither uiWorkspace.startSession nor workspaces.startSession");
	};
	/** Read agent preset — v0.1.2-rc.1+ uses projectionValues; v0.1.1-rc.2 uses direct field. */
	const getAgentPreset = (summary) => {
		if (summary.projectionValues?.agentPreset !== void 0) {
			const v = summary.projectionValues.agentPreset;
			return v === null ? void 0 : v;
		}
		return summary.agentPreset;
	};
	/** Note preset change — v0.1.1-rc.2 calls noteAgentPreset; v0.1.2-rc.1+ is auto-synced via projection. */
	const noteAgentPresetCompat = (sessionId, presetId) => {
		if (hasNoteAgentPreset && sessions.noteAgentPreset) sessions.noteAgentPreset(sessionId, presetId);
	};
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
				roster = await listAgentPresets();
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			if (!roster.ok) return roster.error;
			const healthy = roster.presets.find((entry) => entry.id.startsWith("wsl-") && entry.broken === void 0);
			if (healthy === void 0) return t("error.presetMissing");
			return void 0;
		},
		listDistros: () => listDistros(),
		describe: () => describe(),
		listDir: (distro, path) => listDir(distro, path),
		check: (distro, path) => check(distro, path),
		createWorkspace: async (linuxPath, username, distro) => {
			try {
				const startSession = resolveSessionStarter();
				const winPath = mntToWindowsPath(linuxPath);
				if (winPath !== null) {
					const view$1 = await workspaces.create({ path: winPath });
					await registerWindows(linuxPath, distro, username);
					const canonical = canonicalWindowsPath(winPath);
					if (canonical !== null) wslWindowsPaths = new Set(wslWindowsPaths).add(canonical);
					await startSession(view$1.workspaceId);
					return void 0;
				}
				const uncPath = joinUnc(distro, linuxPath);
				const view = await workspaces.create({ path: uncPath });
				await setWorkspaceUser(uncPath, username);
				await startSession(view.workspaceId);
				return void 0;
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
			listAgentPresets().then((result) => {
				if (!result.ok) return;
				variants = new Set(result.presets.filter((entry) => entry.broken === void 0 && entry.id.startsWith("wsl-")).map((entry) => entry.id));
				defaultPreset = result.presets.find((entry) => entry.isDefault === true)?.id;
				maybeBind();
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
				maybeBind();
			}).catch(() => {});
		};
		refreshWorkspaces();
		const maybeBind = () => {
			const state = sessions.list.getSnapshot();
			for (const id of state.ids) {
				const summary = state.byId[id];
				if (summary === void 0 || !summary.blank || summary.cwd === void 0) continue;
				const canonical = canonicalWindowsPath(summary.cwd);
				const isWsl = isWslUnc(summary.cwd) || canonical !== null && wslWindowsPaths.has(canonical);
				if (!isWsl) continue;
				const current = getAgentPreset(summary);
				if (current !== void 0 && current.startsWith("wsl-")) continue;
				const base = current === LEGACY_WSL_PRESET_ID ? defaultPreset ?? "standard" : current ?? defaultPreset;
				if (base === void 0 || base === LEGACY_WSL_PRESET_ID || base.startsWith("wsl-")) continue;
				const target = `wsl-${base.toLowerCase()}`;
				if (!variants.has(target)) continue;
				if (inFlight.has(id) || (attempts.get(id) ?? 0) >= MAX_ATTEMPTS) continue;
				inFlight.add(id);
				selectAgentPreset(id, target).then((result) => {
					if (result.ok) noteAgentPresetCompat(id, target);
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
return module.exports; } });
//# sourceMappingURL=client.js.map