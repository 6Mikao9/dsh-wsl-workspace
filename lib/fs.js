import { a as joinUnc, c as parseWslUnc, l as windowsToMntPath, n as isAbsoluteLinuxPath, o as mntToWindowsPath } from "./paths-BDE1NVOv.js";
import z from "@deepseek-ai/schemastery";
import { link, lstat, rename } from "node:fs/promises";
import { FsError } from "@deepseek-ai/dsh-fs";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
//#region src/fs.ts
/**
* The WSL filesystem backend. Identity keys are canonical UNC paths; the
* Linux form is derived on demand, so both worlds stay in sync across
* aliases and symlinks.
*/
var WslFileSystem = class WslFileSystem extends LocalFileSystem {
	static Config = z.object({
		cwd: z.string(),
		distro: z.string(),
		diffBasisMaxBytes: z.number().default(10 * 1024 * 1024)
	});
	distro;
	constructor(ctx, config) {
		super(ctx, config);
		this.distro = config.distro;
		this.internals = {
			linkFile: WslFileSystem.publishNoReplace,
			replaceFile: WslFileSystem.replaceOverWrite,
			copyFileDacl: WslFileSystem.skipDaclCopy
		};
	}
	/**
	* No-replace publication for filesystems without hard links. A real
	* collision (a concurrent external creator won) must still surface as the
	* original EEXIST so the guarded-create failure path classifies it; an
	* absent target falls back to rename, which on Windows publishes without
	* replacing anything. Safe against this backend's own writers because the
	* per-target lock serializes them.
	* @param tempPath - the staged file.
	* @param destPath - the destination to create.
	*/
	static async publishNoReplace(tempPath, destPath) {
		try {
			await link(tempPath, destPath);
			return;
		} catch (error) {
			let exists = false;
			try {
				await lstat(destPath);
				exists = true;
			} catch {}
			if (exists) throw error;
			await rename(tempPath, destPath);
		}
	}
	/**
	* Security-preserving replacement boundary: Windows rename replaces an
	* existing destination atomically; no DACL preservation is needed over 9P.
	* @param destPath - the file being replaced.
	* @param tempPath - the staged replacement.
	*/
	static async replaceOverWrite(destPath, tempPath) {
		await rename(tempPath, destPath);
	}
	/** 9P files inherit their directory's DACL; nothing to preserve. */
	static async skipDaclCopy() {}
	/** Translate a model/plugin path into Windows-side coordinates. */
	translate(path, cwd) {
		const unc = parseWslUnc(path);
		if (unc !== null) return {
			input: joinUnc(unc.distro, unc.linuxPath),
			cwd: this.cwdOr(cwd)
		};
		if (isAbsoluteLinuxPath(path)) {
			const win = mntToWindowsPath(path);
			if (win !== null) return {
				input: win,
				cwd: this.cwdOr(cwd)
			};
			return {
				input: joinUnc(this.distroFor(cwd), path),
				cwd: this.cwdOr(cwd)
			};
		}
		if (windowsToMntPath(path) !== null) return {
			input: path,
			cwd: this.cwdOr(cwd)
		};
		return {
			input: path,
			cwd: this.uncCwd(cwd)
		};
	}
	/** A base for absolute inputs (unused by resolution, but the parent needs one). */
	cwdOr(cwd) {
		return cwd ?? this.config.cwd ?? process.cwd();
	}
	uncCwd(cwd) {
		const base = cwd ?? this.config.cwd;
		if (base === void 0 || base === "") throw new FsError("wsl-fs: no cwd and no configured base for relative resolution", "FS_IO_ERROR");
		const unc = parseWslUnc(base);
		if (unc !== null) return joinUnc(unc.distro, unc.linuxPath);
		if (isAbsoluteLinuxPath(base)) return joinUnc(this.distroFor(base), base);
		if (windowsToMntPath(base) !== null) return base;
		throw new FsError(`wsl-fs: cwd "${base}" is not in the WSL execution world`, "FS_IO_ERROR");
	}
	distroFor(cwd) {
		const fromCwd = parseWslUnc(cwd ?? "");
		if (fromCwd !== null) return fromCwd.distro;
		const distro = this.distro;
		if (distro === void 0 || distro === "") throw new FsError("wsl-fs: Linux path carries no distribution and none is configured", "FS_IO_ERROR");
		return distro;
	}
	/** The Linux display path for a resolved Windows-side path. */
	linuxDisplay(raw) {
		const unc = parseWslUnc(raw);
		if (unc !== null) return unc.linuxPath;
		const mnt = windowsToMntPath(raw);
		if (mnt !== null) return mnt;
		throw new FsError(`wsl-fs: resolved path "${raw}" is outside the WSL execution world`, "FS_IO_ERROR");
	}
	async resolve(path, opts) {
		if (opts?.signal?.aborted) throw new FsError("resolve aborted", "FS_ABORTED");
		const { input, cwd } = this.translate(path, opts?.cwd);
		const local = await super.resolve(input, {
			cwd,
			...opts?.signal !== void 0 ? { signal: opts.signal } : {}
		});
		return {
			targetKey: local.targetKey,
			displayPath: this.linuxDisplay(String(local.displayPath))
		};
	}
	processPath(target) {
		const key = String(target.targetKey);
		const unc = parseWslUnc(key);
		if (unc !== null) return unc.linuxPath;
		const mnt = windowsToMntPath(key);
		if (mnt !== null) return mnt;
		throw new FsError(`wsl-fs: target "${target.displayPath}" is outside the WSL execution world`, "FS_IO_ERROR");
	}
	fileUrl(target) {
		return `file://${this.processPath(target).split("/").map(encodeURIComponent).join("/")}`;
	}
	contains(parent, child) {
		const parentWorld = this.worldPath(parent);
		const childWorld = this.worldPath(child);
		if (parentWorld.distro !== childWorld.distro) return false;
		const parentPath = parentWorld.linuxPath;
		const childPath = childWorld.linuxPath;
		if (childPath === parentPath) return true;
		return parentPath === "/" ? true : childPath.startsWith(`${parentPath}/`);
	}
	/** One target's (distro, linuxPath) pair for containment; `undefined` distro = Windows world. */
	worldPath(target) {
		const key = String(target.targetKey);
		const unc = parseWslUnc(key);
		if (unc !== null) return {
			distro: unc.distro,
			linuxPath: unc.linuxPath
		};
		const mnt = windowsToMntPath(key);
		if (mnt !== null) return {
			distro: void 0,
			linuxPath: mnt
		};
		throw new FsError(`wsl-fs: target "${target.displayPath}" is outside the WSL execution world`, "FS_IO_ERROR");
	}
	async lstat(path, opts, signal) {
		if (signal?.aborted) throw new FsError("lstat aborted", "FS_ABORTED");
		if (path.trim().length === 0) throw new FsError("file_path must be a non-empty string", "FS_NOT_FOUND");
		const { input, cwd } = this.translate(path, opts?.cwd);
		return super.lstat(input, { cwd }, signal);
	}
};
//#endregion
export { WslFileSystem, WslFileSystem as default };

//# sourceMappingURL=fs.js.map