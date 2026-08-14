import { i as joinUnc, n as isValidWslUsername, s as parseWslUnc } from "./paths-DBaSmi7x.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
//#region src/shared/wsl-credentials.ts
/**
* Per-workspace WSL credentials (host side only). The dialog stores the
* optional Linux username of a WSL workspace under the harness home; the
* per-session env contributor and the WSL shell executor read it back so
* `wsl.exe -u <username>` can run commands as that user. Keys are canonical
* UNC workspace paths. This module touches node builtins, so the browser
* half never imports it.
* @module dsh-wsl-workspace/shared/wsl-credentials
*/
/** The store file lives under the harness home so both host halves share it. */
function storePath() {
	return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "wsl-workspaces.json");
}
/** Read the store; a missing or corrupt file reads as empty (never throws). */
function readStore() {
	try {
		const parsed = JSON.parse(readFileSync(storePath(), "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}
/**
* Canonicalize any accepted WSL UNC spelling into the store's key form.
* @param path - candidate workspace path (either UNC host form).
* @returns the canonical UNC path, or null when the path is not a WSL UNC.
*/
function canonicalWslUnc(path) {
	const parsed = parseWslUnc(path);
	return parsed === null ? null : joinUnc(parsed.distro, parsed.linuxPath);
}
/**
* Read the stored username for a WSL workspace.
* @param uncPath - the workspace path (any accepted WSL UNC spelling).
* @returns the username, or undefined when none is stored.
*/
function getWorkspaceUsername(uncPath) {
	const key = canonicalWslUnc(uncPath);
	if (key === null) return void 0;
	const username = readStore()[key]?.username;
	return username === void 0 || username === "" ? void 0 : username;
}
/**
* Store (or clear) the username of a WSL workspace.
* @param uncPath - the workspace path (any accepted WSL UNC spelling).
* @param username - the username; empty or undefined clears the stored value.
*/
function setWorkspaceUsername(uncPath, username) {
	const key = canonicalWslUnc(uncPath);
	if (key === null) throw new Error("wsl-workspace: workspace path is not a WSL UNC path");
	const store = readStore();
	if (username === void 0 || username.trim() === "") delete store[key];
	else {
		const trimmed = username.trim();
		if (!isValidWslUsername(trimmed)) throw new Error("wsl-workspace: username must match the Linux username pattern [A-Za-z_][A-Za-z0-9_.-]*");
		store[key] = { username: trimmed };
	}
	const path = storePath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(store, null, 2) + "\n", "utf8");
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
const execFileAsync = promisify(execFile);
/** Executable timeout for the short discovery calls. */
const DISCOVERY_TIMEOUT_MS = 1e4;
const LXSS_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss";
/** Human text for an unknown rejection. */
function messageOf(value) {
	return value instanceof Error ? value.message : String(value);
}
/**
* Decode `wsl.exe -l -q` output. Newer builds emit UTF-8; most emit UTF-16LE
* with NUL bytes interleaved — the NUL probe picks the right one.
* @param buffer - the raw captured output.
* @returns the decoded text.
*/
function decodeWslOutput(buffer) {
	return buffer.includes(0) ? buffer.toString("utf16le") : buffer.toString("utf8");
}
/**
* List installed WSL distributions in `wsl.exe` order.
* @param wslPath - the `wsl.exe` executable (absolute or PATH name).
* @returns distribution names, blank lines dropped.
*/
async function listDistros(wslPath = "wsl.exe") {
	let stdout;
	try {
		stdout = (await execFileAsync(wslPath, ["-l", "-q"], {
			encoding: "buffer",
			timeout: DISCOVERY_TIMEOUT_MS
		})).stdout;
	} catch (error) {
		throw new Error(`wsl-workspace: cannot list WSL distributions (${messageOf(error)}); is WSL installed?`);
	}
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
		const value = await execFileAsync("reg.exe", [
			"query",
			LXSS_KEY,
			"/v",
			"DefaultDistribution"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const guid = /DefaultDistribution\s+REG_SZ\s+(\{[0-9a-fA-F-]+\})/i.exec(value.stdout)?.[1];
		if (guid === void 0) return void 0;
		const name = await execFileAsync("reg.exe", [
			"query",
			`${LXSS_KEY}\\${guid}`,
			"/v",
			"DistributionName"
		], { timeout: DISCOVERY_TIMEOUT_MS });
		const distro = /DistributionName\s+REG_SZ\s+(.+)/i.exec(name.stdout)?.[1]?.trim();
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
export { getWorkspaceUsername as a, canonicalWslUnc as i, defaultDistroSync as n, setWorkspaceUsername as o, listDistros as r, defaultDistro as t };

//# sourceMappingURL=wsl-GjkUifnx.js.map