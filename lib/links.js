import { a as isAbsoluteLinuxPath, c as joinUnc, d as parseWslUnc } from "./wsl.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
//#region src/shared/links.ts
/**
* Linux symlink resolution through the owning distribution.
*
* The `\\wsl.localhost\<distro>\…` 9P share lists a Linux symlink entry but
* cannot resolve its target: `readdir` reports it, and every Windows-side
* `stat` on it fails (`ENOENT`/`EISDIR`). The distribution resolves the same
* path trivially, so both halves of this plugin — the skill walk and the
* filesystem backend — ask it with one short `wsl.exe … readlink -f` call per
* link.
*
* Each link gets its own call on purpose: `wsl.exe` drops the arguments that
* follow a command (`sh -c 'echo ARGC:$#' sh a b c` answers 0) and its
* command-line parser truncates an argument containing a double quote, while a
* bare multi-argument `readlink -f a b c` stops at the first path it cannot
* resolve and still exits non-zero. A process argument carries any path
* without quoting, which is what keeps this correct.
*
* @module dsh-wsl-workspace/shared/links
*/
const execFileAsync = promisify(execFile);
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
	const workers = Array.from({ length: Math.min(4, uncPaths.length) }, async () => {
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
		return;
	}
}
//#endregion
export { resolveLinuxSymlinks as n, resolveLinuxSymlink as t };

//# sourceMappingURL=links.js.map