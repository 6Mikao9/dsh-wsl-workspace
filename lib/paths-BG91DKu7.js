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
* True when a value is a Windows-shaped path (drive or UNC), which is how
* the shell executor decides the WSLENV `/p` translation flag: only Windows
* path values need translation when they cross into the Linux process.
* @param value - the environment value to classify.
* @returns whether the value looks like a Windows path.
*/
function isWindowsPathShaped(value) {
	return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
//#endregion
export { parseWslUnc as a, normalizeLinuxPath as i, isWindowsPathShaped as n, windowsToMntPath as o, joinUnc as r, isAbsoluteLinuxPath as t };

//# sourceMappingURL=paths-BG91DKu7.js.map