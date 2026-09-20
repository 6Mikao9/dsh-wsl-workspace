import { isAbsoluteLinuxPath, joinUnc, parseWslUnc } from "./wsl-CECXiGZH.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

//#region src/shared/links.ts
const execFileAsync = promisify(execFile);
/** How many `readlink` calls may be in flight at once. */
const LINK_RESOLVE_CONCURRENCY = 4;
/** How long the distribution may take to answer one `readlink` call. */
const LINK_RESOLVE_TIMEOUT_MS = 1e4;
/**
* Resolve Linux symlinks through the distribution that owns them.
*
* Never throws: a link the distribution cannot resolve (a missing component, a
* stopped distribution, a `readlink` that fails) stays unresolved, and callers
* keep whatever behaviour they had before this fallback existed.
*
* @param uncPaths - the links to resolve, in UNC spelling.
* @param wslPath - the `wsl.exe` executable (absolute or PATH name).
* @returns one entry per input, in order: the resolved real path as a UNC
*   path, or `undefined` when the link or the distribution could not answer.
*/
async function resolveLinuxSymlinks(uncPaths, wslPath = "wsl.exe") {
	const resolved = uncPaths.map(() => void 0);
	let next = 0;
	const workers = Array.from({ length: Math.min(LINK_RESOLVE_CONCURRENCY, uncPaths.length) }, async () => {
		for (let index = next; index < uncPaths.length; index = next) {
			next += 1;
			resolved[index] = await resolveLinuxSymlink(uncPaths[index] ?? "", wslPath);
		}
	});
	await Promise.all(workers);
	return resolved;
}
/**
* Resolve one Linux symlink the share cannot follow.
* @param uncPath - the link, in UNC spelling.
* @param wslPath - the `wsl.exe` executable (absolute or PATH name).
* @returns the real path as a UNC path, or `undefined` when it does not resolve.
*/
async function resolveLinuxSymlink(uncPath, wslPath = "wsl.exe") {
	const unc = parseWslUnc(uncPath);
	if (unc === null || /[\r\n]/.test(unc.linuxPath)) return void 0;
	try {
		const output = await execFileAsync(wslPath, [
			"-d",
			unc.distro,
			"--",
			"readlink",
			"-f",
			unc.linuxPath
		], {
			encoding: "utf8",
			timeout: LINK_RESOLVE_TIMEOUT_MS,
			windowsHide: true
		});
		const target = String(output.stdout).trim();
		return isAbsoluteLinuxPath(target) ? joinUnc(unc.distro, target) : void 0;
	} catch {
		return void 0;
	}
}

//#endregion
export { resolveLinuxSymlink, resolveLinuxSymlinks };
//# sourceMappingURL=links-BQxdJOMy.js.map