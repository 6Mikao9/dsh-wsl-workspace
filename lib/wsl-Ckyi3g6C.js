import { execFile, execFileSync } from "node:child_process";
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
* Translate a WSL UNC path to the absolute Linux path a process inside the
* distribution can open. Throws on non-WSL input: callers rely on this
* conversion to hand paths to the Linux world, so a silent pass-through
* would hand a Windows path to bash.
* @param uncPath - a path {@link parseWslUnc} accepts.
* @returns the absolute Linux path.
*/
function uncToLinux(uncPath) {
	const parts = parseWslUnc(uncPath);
	if (parts === null) throw new Error(`wsl-workspace: "${uncPath}" is not a WSL UNC path`);
	return parts.linuxPath;
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
* Translate a Windows drive path to the drvfs mount path WSL distributions
* conventionally expose it at (`C:\foo` → `/mnt/c/foo`). Only single-letter
* drives under `/mnt` are mapped; custom mount points are out of scope.
* @param path - the candidate Windows path.
* @returns the `/mnt/<drive>/…` path, or `null` for non-drive paths.
*/
function windowsToMntPath(path) {
	const match = /^([A-Za-z]):[\\/](.*)$/.exec(path);
	if (match === null) return null;
	const rest = (match[2] ?? "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
	return `/mnt/${(match[1] ?? "").toLowerCase()}${rest === "" ? "" : `/${rest}`}`;
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
/**
* True when a value is a Windows-shaped path (drive or UNC), which is how
* the shell executor decides the WSLENV `/p` translation flag: only Windows
* path values need translation when they cross into the Linux process.
* @param value - the environment value to classify.
* @returns whether the value looks like a Windows path.
*/
function isWindowsPathShaped(value) {
	return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
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
//#region src/shared/wsl.ts
/**
* WSL discovery helpers (host side): enumerate installed distributions
* through `wsl.exe -l -q` and read the default distribution from the Lxss
* registry key. `wsl.exe` output is UTF-16LE on most builds, so decoding
* sniffs for NUL bytes before choosing an encoding.
* @module dsh-wsl-workspace/shared/wsl
*/
/** Executable timeout for the short discovery calls. */
const DISCOVERY_TIMEOUT_MS = 1e4;
const LXSS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss";
/** Human text for an unknown rejection. */
function messageOf(value) {
	return value instanceof Error ? value.message : String(value);
}
/**
* Run `execFile` through its callback API and resolve `{ stdout, stderr }`.
*
* `util.promisify(execFile)` only resolves that object because `execFile`
* carries `util.promisify.custom`. A host that replaces
* `child_process.execFile` with a plain wrapper loses that metadata, and
* `promisify` then falls back to "resolve the first callback value" — which is
* stdout itself, so `result.stdout` is `undefined` (issue #35: DSH Desktop
* injects `windowsHide: true` that way, and `listDistros()` died with
* `Cannot read properties of undefined (reading 'includes')`).
*
* The callback form is what every such wrapper preserves, so this does not
* depend on how the host patched the module.
* @param file - the executable.
* @param args - its arguments.
* @param options - `execFile` options, including the requested encoding.
* @returns both streams; the caller narrows them by the encoding it asked for.
*/
function execFileResult(file, args, options) {
	return new Promise((settle, fail) => {
		execFile(file, [...args], options, (error, stdout, stderr) => {
			if (error !== null && error !== void 0) {
				fail(error);
				return;
			}
			settle({
				stdout,
				stderr
			});
		});
	});
}
/** Read a captured stream as text, whichever way the encoding arrived. */
function textOf(stream) {
	return typeof stream === "string" ? stream : stream.toString("utf8");
}
/**
* The `wsl.exe` spellings to try, in order.
*
* The bare name relies on `PATH`. A host whose `PATH` omits `System32` can run
* every other part of this plugin — `listDir`/`check` go through the
* `\\wsl.localhost\…` share and never spawn anything — while `listDistros`
* reports that WSL is missing, which is what issue #36 describes. The
* absolute fallback removes that failure mode.
* @param wslPath - the configured executable.
* @returns the candidates, without duplicates.
*/
function wslExecutableCandidates(wslPath) {
	if (wslPath !== "wsl.exe") return [wslPath];
	const root = process.env.SystemRoot ?? process.env.windir;
	if (root === void 0 || root === "") return [wslPath];
	return [wslPath, `${root.replace(/[\\/]+$/, "")}\\System32\\wsl.exe`];
}
/**
* Decode `wsl.exe -l -q` output. Newer builds emit UTF-8; most emit UTF-16LE
* with NUL bytes interleaved — the NUL probe picks the right one. A host that
* handed back something other than the captured stream is reported as such
* instead of throwing `Cannot read properties of undefined`.
* @param buffer - the raw captured output.
* @returns the decoded text.
*/
function decodeWslOutput(buffer) {
	if (typeof buffer === "string") return buffer;
	if (!(buffer instanceof Uint8Array)) throw new Error(`wsl-workspace: expected captured output, got ${typeof buffer}`);
	return buffer.includes(0) ? buffer.toString("utf16le") : buffer.toString("utf8");
}
/**
* List installed WSL distributions in `wsl.exe` order.
* @param wslPath - the `wsl.exe` executable (absolute or PATH name).
* @returns distribution names, blank lines dropped.
*/
async function listDistros(wslPath = "wsl.exe") {
	const candidates = wslExecutableCandidates(wslPath);
	let stdout;
	let lastError;
	for (const candidate of candidates) try {
		stdout = (await execFileResult(candidate, ["-l", "-q"], {
			encoding: "buffer",
			timeout: DISCOVERY_TIMEOUT_MS
		})).stdout;
		break;
	} catch (error) {
		lastError = error;
	}
	if (stdout === void 0) throw new Error(`wsl-workspace: cannot list WSL distributions (tried ${candidates.join(" and ")}: ${messageOf(lastError)}); is WSL installed?`);
	return decodeWslOutput(stdout).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}
/**
* Read the user's default distribution from the Lxss registry. Non-fatal:
* returns `undefined` when the value is absent or unreadable (the caller
* falls back to list order).
* @returns the default distribution name, or `undefined`.
*/
async function defaultDistro() {
	try {
		const value = await execFileResult("reg.exe", [
			"query",
			LXSS_KEY,
			"/v",
			"DefaultDistribution"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const guid = /DefaultDistribution\s+REG_SZ\s+(\{[0-9a-fA-F-]+\})/i.exec(textOf(value.stdout))?.[1];
		if (guid === void 0) return void 0;
		const name = await execFileResult("reg.exe", [
			"query",
			`${LXSS_KEY}\\${guid}`,
			"/v",
			"DistributionName"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const distro = /DistributionName\s+REG_SZ\s+(.+)/i.exec(textOf(name.stdout))?.[1]?.trim();
		return distro === void 0 || distro === "" ? void 0 : distro;
	} catch {
		return;
	}
}
/** Module-level cache for {@link defaultDistroSync} (one registry read per process). */
let syncDefaultResolved = false;
let syncDefault;
/**
* Synchronous variant of {@link defaultDistro} for executors that must
* resolve a distribution inside a synchronous plan step. Cached after the
* first read; non-fatal (returns `undefined` when the registry is
* unreadable, letting the caller fail loud with its own message).
* @returns the default distribution name, or `undefined`.
*/
function defaultDistroSync() {
	if (syncDefaultResolved) return syncDefault;
	syncDefaultResolved = true;
	try {
		const value = execFileSync("reg.exe", [
			"query",
			LXSS_KEY,
			"/v",
			"DefaultDistribution"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const guid = /DefaultDistribution\s+REG_SZ\s+(\{[0-9a-fA-F-]+\})/i.exec(String(value))?.[1];
		if (guid === void 0) return void 0;
		const name = execFileSync("reg.exe", [
			"query",
			`${LXSS_KEY}\\${guid}`,
			"/v",
			"DistributionName"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const distro = /DistributionName\s+REG_SZ\s+(.+)/i.exec(String(name))?.[1]?.trim();
		syncDefault = distro === void 0 || distro === "" ? void 0 : distro;
	} catch {
		syncDefault = void 0;
	}
	return syncDefault;
}
//#endregion
export { textOf as a, isAbsoluteLinuxPath as c, joinUnc as d, mntToWindowsPath as f, windowsToMntPath as g, uncToLinux as h, listDistros as i, isValidWslUsername as l, parseWslUnc as m, defaultDistroSync as n, wslExecutableCandidates as o, normalizeLinuxPath as p, execFileResult as r, canonicalWindowsPath as s, defaultDistro as t, isWindowsPathShaped as u };

//# sourceMappingURL=wsl-Ckyi3g6C.js.map