import { defaultDistroSync, isValidWslUsername, parseWslUnc, windowsToMntPath } from "./wsl-CECXiGZH.js";
import { spawn } from "node:child_process";

//#region src/host/wsl-relay.ts
/** Shell signals whose arrival means this relay should take the shell down. */
const FORWARDED_SIGNALS = [
	"SIGINT",
	"SIGTERM",
	"SIGHUP",
	"SIGBREAK"
];
/** POSIX single-quote a path so the `cd` command reaches bash as one word. */
function quote(path) {
	return `'${path.replace(/'/g, `'\\''`)}'`;
}
/** Fail loudly: the PTY has no other way to tell the model what went wrong. */
function fail(message) {
	console.error(`dsh-wsl-workspace: ${message}`);
	process.exit(1);
}
/** The distribution this shell belongs to. */
function resolveDistro(uncDistro) {
	if (uncDistro !== void 0 && uncDistro !== "") return uncDistro;
	const fromEnv = process.env.DSH_WSL_DISTRO;
	if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
	const fallback = defaultDistroSync();
	if (fallback !== void 0 && fallback !== "") return fallback;
	return fail("persistent shell: the session cwd carries no distribution, DSH_WSL_DISTRO is unset and no WSL default is readable");
}
/** The workspace user, when one is configured and safe for `wsl.exe -u`. */
function resolveUser() {
	const user$1 = process.env.DSH_WSL_USER;
	if (user$1 === void 0 || user$1 === "") return void 0;
	if (!isValidWslUsername(user$1)) fail(`persistent shell: refusing the malformed username "${user$1}"`);
	return user$1;
}
const cwd = process.cwd();
const unc = parseWslUnc(cwd);
const distro = resolveDistro(unc?.distro);
const user = resolveUser();
const linuxCwd = unc !== null ? unc.linuxPath : windowsToMntPath(cwd) ?? void 0;
const command = `${linuxCwd === void 0 ? "" : `cd ${quote(linuxCwd)} && `}exec bash -i`;
const argv = [
	"wsl.exe",
	"-d",
	distro,
	...user === void 0 ? [] : ["-u", user],
	"--cd",
	cwd,
	"-e",
	"bash",
	"-lc",
	command
];
const child = spawn(argv[0] ?? "wsl.exe", argv.slice(1), { stdio: "inherit" });
child.on("error", (error) => fail(`persistent shell: cannot start ${argv[0] ?? "wsl.exe"} (${error.message})`));
child.on("exit", (code, signal) => process.exit(signal === null ? code ?? 0 : 1));
for (const signal of FORWARDED_SIGNALS) process.on(signal, () => {
	if (child.exitCode === null && child.signalCode === null) child.kill(signal);
});

//#endregion
export {  };
//# sourceMappingURL=wsl-relay.js.map