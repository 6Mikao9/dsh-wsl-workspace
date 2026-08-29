import { a as isAbsoluteLinuxPath, c as joinUnc, d as parseWslUnc, l as mntToWindowsPath, o as isValidWslUsername, r as listDistros, t as defaultDistro, u as normalizeLinuxPath } from "./wsl-C5_mxGPM.js";
import { a as registerWindowsWorkspace, i as listWorkspaceKeys, n as getWindowsWorkspace, o as setWorkspaceUsername, r as getWorkspaceUsername, t as canonicalWslUnc } from "./wsl-credentials-BI4v5TNZ.js";
import z from "@deepseek-ai/schemastery";
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, posix } from "node:path";
import { homedir } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
//#region src/host/variants.ts
/**
* WSL preset-variant generator. For every healthy source preset the roster
* supplies, a `wsl-<id>` variant is materialized under the roster's user
* root: the source composition with its shell/filesystem world replaced by
* the WSL providers, so any mode (standard, minimal, code, cordis, user
* presets) can run on top of a WSL execution world. The execution world is
* therefore orthogonal to the mode instead of a mode itself.
*
* The transformation is text-level on the top-level rows of the composition
* (the shape all shipped presets share), with surgical edits for the known
* special groups; unknown shapes are kept verbatim where possible.
* @module dsh-wsl-workspace/host/variants
*/
/** Top-level rows that name the execution world and are replaced by the variant's own. */
const WORLD_ROWS = new Set([
	"tool-bash",
	"tool-pwsh",
	"tool-fs",
	"tool-fs-search",
	"str-replace-editor",
	"filesystem",
	"persistent-shell",
	"custom-bash",
	"bootstrap-filesystem"
]);
/** The injected WSL world group: providers + the bash/fs consumers, entry-local. */
function wslWorldGroup(shellPath, fsPath, includeEditor) {
	return [
		"# ── WSL execution world (dsh-wsl-workspace variant) ─────────────────────",
		"# The shell and fs services are provided entry-locally (the isolate",
		"# realm); host services (tools registry, shell-env, jobs) fall through.",
		"# tool-fs-search is intentionally absent: the packaged ripgrep runs on",
		"# the Windows host and cannot open Linux paths; WSL sessions search with",
		"# shell tools instead.",
		"- id: wsl-world",
		"  name: cordis:group",
		"  group: true",
		"  isolate:",
		"    shell: true",
		"    fs: true",
		"  config:",
		`    - id: shell-wsl`,
		`      name: '${shellPath.replace(/'/g, "''")}'`,
		"    - id: fs-wsl",
		`      name: '${fsPath.replace(/'/g, "''")}'`,
		"    - id: tool-bash",
		"      name: '@deepseek-ai/dsh-tool-bash'",
		"    - id: tool-fs",
		"      name: '@deepseek-ai/dsh-tool-fs'",
		...includeEditor ? [
			"    - id: str-replace-editor",
			"      name: '@deepseek-ai/dsh-tool-str-replace-editor'",
			"      config:",
			"        maxOutputChars: 16000"
		] : [],
		""
	].join("\n");
}
/** The sentence appended to a standard-like persona when the variant runs in WSL. */
const PERSONA_APPEND = " Your working directory {{cwd}} is inside a WSL (Windows Subsystem for Linux) distribution: the bash tool and the file read/write/edit tools use Linux paths, and the Windows filesystem is reachable as /mnt/<drive> for file migration.";
/** The top-level rows of one composition, as (startLine, endLineExclusive) spans. */
function topLevelSpans(lines) {
	const spans = [];
	let start = -1;
	for (let index = 0; index < lines.length; index++) if (lines[index]?.startsWith("- id: ") === true) {
		if (start >= 0) spans.push({
			start,
			end: index
		});
		start = index;
	}
	if (start >= 0) spans.push({
		start,
		end: lines.length
	});
	return spans;
}
/** The row id of a top-level span, or undefined when the first line is malformed. */
function spanId(lines, span) {
	return /^- id: ([A-Za-z0-9_.-]+)/.exec(lines[span.start] ?? "")?.[1];
}
/** Whether a top-level span is a `persona` row with an appendable folded text. */
function appendablePersona(lines, span) {
	const block = lines.slice(span.start, span.end).join("\n");
	if (!block.includes("complete: true") && /text: [>|-]/.test(block)) {
		const textLine = block.split("\n").find((line) => /^(\s*)text: [>|-]/.test(line));
		if (textLine !== void 0) {
			const indent = /^(\s*)/.exec(textLine)?.[1]?.length ?? 0;
			return block.split("\n").some((line) => line.length > indent && /^\s+/.test(line) && !line.includes(":"));
		}
	}
	return false;
}
/** Append the WSL sentence to a persona row's folded text (in place of its last text line). */
function appendPersona(lines, span) {
	const block = lines.slice(span.start, span.end);
	const textIndex = block.findIndex((line) => /^(\s*)text: [>|-]/.test(line));
	if (textIndex < 0) return [...block];
	const indent = /^(\s*)/.exec(block[textIndex] ?? "")?.[1]?.length ?? 0;
	let lastText = -1;
	for (let index = textIndex + 1; index < block.length; index++) {
		const line = block[index] ?? "";
		if (line.trim() === "") continue;
		if (line.length > indent && /^\s+/.test(line)) lastText = index;
	}
	if (lastText < 0) return [...block];
	const updated = [...block];
	const textIndent = /^(\s*)/.exec(block[lastText] ?? "")?.[1] ?? "  ";
	updated.splice(lastText + 1, 0, `${textIndent}${PERSONA_APPEND}`);
	return updated;
}
/**
* Transform one source preset composition into its WSL variant: drop the
* execution-world rows, keep everything else verbatim, and append the WSL
* world group. The persistent-shell group is NOT re-added: it registers the
* same `bash` tool name as the WSL world's `dsh-tool-bash`, and the tools
* registry rejects duplicates within one preset layer — the whole variant
* fails to mount and the session falls back to another preset. Its PTY
* backend additionally cannot run on this plugin's Windows host
* (`dsh-subprocess-local`: "terminal inspection is unsupported on platform
* win32"), so the group could never spawn a shell here anyway. The WSL
* world's ordinary `bash` tool covers command execution for every variant.
* @param source - the source composition text.
* @param shellPath - absolute path of the plugin's built WSL shell provider.
* @param fsPath - absolute path of the plugin's built WSL fs provider.
* @returns the variant composition text.
*/
function transformPresetForWsl(source, shellPath, fsPath) {
	const lines = source.split("\n");
	const spans = topLevelSpans(lines);
	const kept = [];
	let sawEditor = false;
	let personaAppended = false;
	for (const span of spans) {
		const id = spanId(lines, span);
		if (id === void 0) {
			kept.push(...lines.slice(span.start, span.end));
			continue;
		}
		if (WORLD_ROWS.has(id)) continue;
		if (id === "persona" && !personaAppended && appendablePersona(lines, span)) {
			kept.push(...appendPersona(lines, span));
			personaAppended = true;
			continue;
		}
		kept.push(...lines.slice(span.start, span.end));
		if (id === "str-replace-editor") sawEditor = true;
	}
	if (source.includes("str-replace-editor")) sawEditor = true;
	const result = [...kept];
	if (result.length > 0 && result[result.length - 1] !== "") result.push("");
	result.push(wslWorldGroup(shellPath, fsPath, sawEditor));
	return result.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
/** Whether an id is one of this plugin's own preset directories. */
function isWslVariantId(id) {
	return id === "wsl" || /^wsl-[a-z0-9-]+$/.test(id);
}
/** The variant id for one source preset id. */
function variantIdFor(sourceId) {
	return `wsl-${sourceId.toLowerCase()}`;
}
//#endregion
//#region src/host/wsl-skills.ts
/**
* WSL workspace skill provider (host half).
*
* DSH's shipped skill-filesystem provider scans only the session cwd's
* project root (the nearest `.git` ancestor) for `.dsh/skills` / `.agents/skills`
* and never descends into nested projects. A WSL workspace whose project
* folders live below the registered workspace root therefore shows an empty
* skill catalog, even though the same layout works when the session cwd is
* the project folder itself (issue #10).
*
* This provider mirrors the host's discovery rules for WSL UNC session
* workspaces: it starts at the session cwd's nearest `.git` ancestor (the
* host's project-root rule; the cwd itself when no ancestor has a `.git`
* marker), then walks that root (depth- and budget-bounded), collects every
* `.dsh/skills` and `.agents/skills` directory it finds — including nested
* projects — and publishes their skills with the same
* project ranks and sources the host uses, so precedence and duplicate
* resolution behave identically. Non-WSL lookups return nothing and leave
* the host's own providers untouched.
*
* All filesystem reads go through `node:fs` against the `\\wsl.localhost\…`
* 9P share (the same substrate `WslFileSystem` uses); an injectable IO face
* keeps the discovery logic unit-testable without a live distro.
*
* @module dsh-wsl-workspace/host/wsl-skills
*/
/** Project ranks copied from @deepseek-ai/dsh-skill-filesystem so WSL and host entries interleave identically. */
const PROJECT_DSH_RANK = 100;
const PROJECT_AGENTS_RANK = 200;
/** How many directory levels below the workspace root are scanned. */
const MAX_SCAN_DEPTH = 4;
/** Maximum distinct skill directories published per lookup. */
const MAX_SKILL_ROOTS = 64;
/** Maximum directories visited per lookup (an absolute blast-radius cap). */
const MAX_VISITED_DIRECTORIES = 4096;
/** How many parent levels above the session cwd are searched for a `.git` project marker. */
const MAX_ANCESTOR_WALK = 64;
/** Kebab-case skill names, matching the host grammar. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Directory names that never contain project skill roots (safe to prune while walking). */
const PRUNED_DIRECTORY_NAMES = new Set([
	".git",
	".hg",
	".svn",
	".bzr",
	"node_modules",
	".venv",
	"venv",
	".tox",
	".pants.d",
	".next",
	".nuxt",
	"dist",
	"build",
	"out",
	"coverage",
	"__pycache__",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".cache",
	".idea",
	".vscode",
	".serverless",
	".terraform",
	".yarn",
	".pnpm-store"
]);
/** The node:fs/promises implementation the provider uses in production. */
const nodeSkillIo = {
	readdir: async (path, options) => readdir(path, options),
	readFile: async (path, options) => readFile(path, options),
	stat: async (path) => stat(path)
};
/**
* Locate the nearest ancestor of `linuxDir` (the directory itself included)
* containing a `.git` marker, mirroring the host skill-filesystem's
* project-root rule. `.git` may be a directory or a worktree pointer file;
* existence is enough. Bounded so a pathological path cannot spin the walk.
* @param distro - the WSL distribution name.
* @param linuxDir - the session cwd's absolute Linux path.
* @param io - filesystem face.
* @returns the project root's Linux path, or `undefined` when no ancestor carries a `.git`.
*/
async function nearestGitAncestor(distro, linuxDir, io) {
	let current = linuxDir;
	for (let levels = 0; levels <= MAX_ANCESTOR_WALK; levels += 1) {
		try {
			await io.stat(joinUnc(distro, posix.join(current, ".git")));
			return current;
		} catch {}
		const parent = posix.dirname(current);
		if (parent === current) return void 0;
		current = parent;
	}
}
/**
* Scan a WSL workspace root for nested skill directories.
* @param distro - the WSL distribution name.
* @param linuxRoot - the workspace's absolute Linux path.
* @param io - filesystem face.
* @returns discovered skill directories, bounded by depth and budget.
*/
async function discoverSkillRoots(distro, linuxRoot, io) {
	const roots = [];
	const visited = /* @__PURE__ */ new Set();
	let frontier = [[linuxRoot, 0]];
	while (frontier.length > 0 && roots.length < MAX_SKILL_ROOTS) {
		const next = [];
		for (const [dir, depth] of frontier) {
			if (visited.size >= MAX_VISITED_DIRECTORIES) return roots;
			if (visited.has(dir)) continue;
			visited.add(dir);
			if (roots.length < MAX_SKILL_ROOTS) {
				const directoryRoots = await skillRootsOfDirectory(distro, dir, io);
				roots.push(...directoryRoots.slice(0, MAX_SKILL_ROOTS - roots.length));
			}
			if (depth >= MAX_SCAN_DEPTH) continue;
			let entries;
			try {
				entries = await io.readdir(joinUnc(distro, dir), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				if (PRUNED_DIRECTORY_NAMES.has(entry.name)) continue;
				if (entry.name.startsWith(".") && entry.name !== ".dsh" && entry.name !== ".agents") continue;
				if (entry.name === ".dsh" || entry.name === ".agents") continue;
				next.push([posix.join(dir, entry.name), depth + 1]);
			}
		}
		frontier = next;
	}
	return roots;
}
/**
* Publish the skill roots of one scanned directory (its `.dsh/skills` and
* `.agents/skills`, each with the host's project ranks).
* @param distro - the WSL distribution name.
* @param linuxDir - the scanned directory's Linux path.
* @param io - filesystem face.
* @returns the directory's skill roots that exist.
*/
async function skillRootsOfDirectory(distro, linuxDir, io) {
	const result = [];
	for (const [marker, source, rank] of [[
		".dsh",
		"project-dsh",
		PROJECT_DSH_RANK
	], [
		".agents",
		"project-agents",
		PROJECT_AGENTS_RANK
	]]) {
		const path = joinUnc(distro, posix.join(linuxDir, marker, "skills"));
		try {
			if ((await io.stat(path)).isDirectory()) result.push({
				path,
				source,
				rank
			});
		} catch {}
	}
	return result;
}
/** List one skills directory's entries (directory bundles and flat `.md` skills). */
async function listSkillEntries(root, io) {
	let dirents;
	try {
		dirents = await io.readdir(root.path, { withFileTypes: true });
	} catch {
		return [];
	}
	const entries = [];
	for (const entry of dirents) if (entry.isDirectory()) entries.push({
		name: entry.name,
		kind: "bundle",
		path: join(root.path, entry.name, "SKILL.md")
	});
	else if (entry.isFile() && entry.name.endsWith(".md")) entries.push({
		name: entry.name.slice(0, -3),
		kind: "flat",
		path: join(root.path, entry.name)
	});
	return entries.sort((a, b) => a.name.localeCompare(b.name));
}
/** Read and parse one skill file; `undefined` when missing or unparsable. */
async function readSkill(path, io, signal) {
	signal?.throwIfAborted();
	let raw;
	try {
		raw = await io.readFile(path, { encoding: "utf8" });
	} catch {
		return;
	}
	signal?.throwIfAborted();
	return parseSkillFrontmatter(raw, path);
}
/**
* Parse the frontmatter subset skill files use: `---` fenced YAML with
* `name` / `description` / `whenToUse` / `user-invocable` /
* `disable-model-invocation`. Host-incompatible files are skipped, matching
* the shipped provider's leniency: a bad file must not fail the catalog.
*/
function parseSkillFrontmatter(raw, path) {
	const firstLineEnd = raw.indexOf("\n");
	if (firstLineEnd < 0) return void 0;
	if (raw.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return void 0;
	const start = firstLineEnd + 1;
	const closing = findFrontmatterEnd(raw, start);
	if (closing === void 0) return void 0;
	const fields = /* @__PURE__ */ new Map();
	for (const line of raw.slice(start, closing).split("\n")) {
		const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.replace(/\r$/, ""));
		if (match === null) continue;
		const value = match[2]?.trim() ?? "";
		if (value !== "") fields.set(match[1] ?? "", unquote(value));
	}
	const name = fields.get("name") ?? "";
	const description = fields.get("description") ?? "";
	if (!SKILL_NAME.test(name) || description === "") return;
	const whenToUse = fields.get("whenToUse");
	return {
		name,
		description,
		...whenToUse !== void 0 && whenToUse !== "" ? { whenToUse } : {},
		invocation: {
			modelInvocable: !frontmatterBoolean(fields, "disable-model-invocation"),
			userInvocable: frontmatterBoolean(fields, "user-invocable", true)
		},
		content: raw.slice(closing + 1).trim()
	};
}
/** Locate the closing `---` line of a frontmatter block. */
function findFrontmatterEnd(raw, start) {
	let lineStart = start;
	while (lineStart <= raw.length) {
		const nextNewline = raw.indexOf("\n", lineStart);
		const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
		if (raw.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") return lineEnd + 1;
		if (nextNewline < 0) return void 0;
		lineStart = nextNewline + 1;
	}
}
/** Strip one level of matching quotes from a scalar value. */
function unquote(value) {
	if (value.length >= 2) {
		const first = value[0];
		const last = value[value.length - 1];
		if (first === "\"" && last === "\"" || first === "'" && last === "'") return value.slice(1, -1);
	}
	return value;
}
/** Boolean semantics for `user-invocable` / `disable-model-invocation` (matches the host parser). */
function frontmatterBoolean(fields, key, dflt = false) {
	const value = fields.get(key);
	if (value === void 0) return dflt;
	switch (value.toLowerCase()) {
		case "true":
		case "yes":
		case "on":
		case "1": return true;
		case "false":
		case "no":
		case "off":
		case "0": return false;
		default: return dflt;
	}
}
/**
* The WSL workspace skill provider. Registered on the host's `ctx.skills`
* registry; serves only lookups whose cwd is a WSL UNC workspace path.
*/
var WslSkillsProvider = class {
	name = "wsl-workspace";
	control;
	io;
	constructor(control, io = nodeSkillIo) {
		this.control = control;
		this.io = io;
	}
	/**
	* Discover nested project skills for a WSL UNC session workspace.
	* @param options - lookup options; `cwd` selects the WSL workspace.
	* @returns candidates for every `.dsh/skills` / `.agents/skills` under the
	*   session's scan root — the nearest `.git` ancestor of the cwd, else the
	*   cwd itself — or an empty array for non-WSL lookups.
	*/
	async list(options) {
		this.control.signal.throwIfAborted();
		options.signal?.throwIfAborted();
		const unc = options.cwd === void 0 ? null : parseWslUnc(options.cwd);
		if (unc === null) return [];
		const scanRoot = await nearestGitAncestor(unc.distro, unc.linuxPath, this.io) ?? unc.linuxPath;
		const roots = await discoverSkillRoots(unc.distro, scanRoot, this.io);
		const candidates = [];
		for (const root of roots) {
			const entries = await listSkillEntries(root, this.io);
			for (const entry of entries) {
				options.signal?.throwIfAborted();
				const parsed = await readSkill(entry.path, this.io, options.signal);
				if (parsed === void 0) continue;
				candidates.push({
					name: parsed.name,
					description: parsed.description,
					...parsed.whenToUse !== void 0 ? { whenToUse: parsed.whenToUse } : {},
					invocation: parsed.invocation,
					source: root.source,
					provider: this.name,
					rank: root.rank,
					locator: {
						path: entry.path,
						directory: entry.kind === "bundle" ? join(entry.path, "..") : root.path
					},
					path: entry.path
				});
			}
		}
		return candidates;
	}
	/**
	* Load a complete skill body for a previously listed candidate.
	* @param candidate - the candidate this provider returned.
	* @param options - lookup options whose signal cancels the read.
	* @returns the full skill, or `undefined` if the file disappeared.
	*/
	async get(candidate, options) {
		this.control.signal.throwIfAborted();
		const parsed = await readSkill(candidate.locator.path, this.io, options.signal);
		if (parsed === void 0 || parsed.name !== candidate.name) return void 0;
		return {
			name: parsed.name,
			description: parsed.description,
			...parsed.whenToUse !== void 0 ? { whenToUse: parsed.whenToUse } : {},
			invocation: parsed.invocation,
			source: candidate.source,
			provider: candidate.provider,
			rank: candidate.rank,
			locator: candidate.locator,
			path: candidate.path,
			content: parsed.content
		};
	}
};
//#endregion
//#region src/index.ts
/** The HTTP route this plugin serves (a relative, same-origin path). */
const DEFAULT_ROUTE = "/wsl-workspace/api";
/**
* Bilingual display labels for the shipped source modes, matching the app's
* own built-in copy in each language — note the `code` preset is "PTC 模式"
* in the Chinese copy but "Code mode" in English. The DSH picker localizes
* only the four built-in ids itself; `wsl-*` variant ids render the
* preset.yml text verbatim, so the plugin writes one bilingual string so
* both locales can identify each variant. Custom presets keep their own
* name.
*/
const MODE_DISPLAY_LABELS = {
	standard: {
		en: "Standard mode",
		zh: "标准模式"
	},
	code: {
		en: "Code mode",
		zh: "PTC 模式"
	},
	minimal: {
		en: "Minimal mode",
		zh: "极简模式"
	},
	cordis: {
		en: "Creator mode",
		zh: "创造模式"
	}
};
/**
* Quote a value as a single-line YAML single-quoted scalar. Plain scalars
* cannot contain `: ` (colon + space), which plain English sentences do —
* written unquoted they make the whole preset.yml unparsable, dropping the
* name, description and order together.
*/
function yamlScalar(value) {
	return `'${value.replace(/'/g, "''")}'`;
}
/** The variant name for one shipped mode (bilingual) or a custom preset. */
function variantName(presetId, sourceName) {
	const labels = MODE_DISPLAY_LABELS[presetId];
	return labels === void 0 ? `WSL · ${sourceName}` : `WSL · ${labels.en}（${labels.zh}）`;
}
/** The variant description for one shipped mode (bilingual) or a custom preset. */
function variantDescription(presetId) {
	const labels = MODE_DISPLAY_LABELS[presetId];
	return `WSL execution world for ${labels === void 0 ? presetId : `${labels.en}（${labels.zh}）`}: bash and file tools run inside the WSL distribution.`;
}
const MAX_BODY_BYTES = 1024 * 1024;
/** Valid WSL distribution names: one path-safe segment (no separators, no dot-dirs). */
const DISTRO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;
/** The loopback hostnames the data route answers to (DNS-rebinding fence). */
const LOOPBACK_HOSTNAMES = new Set([
	"localhost",
	"127.0.0.1",
	"::1",
	"::ffff:127.0.0.1"
]);
/** True when a socket address is loopback (any IPv4/IPv6 spelling). */
function isLoopback(address) {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
/** The hostname part of a `Host` header value (port and IPv6 brackets stripped). */
function hostNameOf(host) {
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		return end >= 0 ? host.slice(1, end) : host;
	}
	return host.split(":")[0] ?? "";
}
/** True when the request's `Host` header names a loopback host. */
function isLoopbackHost(host) {
	return host !== void 0 && LOOPBACK_HOSTNAMES.has(hostNameOf(host).toLowerCase());
}
/**
* Validate a wire-supplied distribution name before it becomes a UNC segment:
* an attacker-controlled segment containing separators or `..` would escape
* the `\\wsl.localhost\` share structure into arbitrary UNC paths.
* @param value - the raw wire value.
* @returns the validated distro name.
*/
function requireDistro(value) {
	if (typeof value !== "string" || !DISTRO_PATTERN.test(value) || value === "." || value === "..") throw new Error("distro must be a valid WSL distribution name");
	return value;
}
/** Human text for an unknown rejection. */
function messageOf(value) {
	return value instanceof Error ? value.message : String(value);
}
/** Write one JSON envelope. */
function json(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(body));
}
/** Collect and parse the request body, bounded. */
async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES) throw new Error("request body is too large");
		chunks.push(buffer);
	}
	const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
	return parsed;
}
/** Normalize a Linux path for the wire (rejecting non-absolute input). */
function requireLinuxPath(value, label) {
	if (typeof value !== "string" || !isAbsoluteLinuxPath(value)) throw new Error(`${label} must be an absolute Linux path`);
	return normalizeLinuxPath(value);
}
/** Validate a wire-supplied workspace path and return its canonical UNC form. */
function requireWslUnc(value) {
	if (typeof value !== "string") throw new Error("path must be a string");
	const canonical = canonicalWslUnc(value);
	if (canonical === null) throw new Error("path must be a WSL UNC workspace path");
	return canonical;
}
/**
* Resolve one directory listing for the dialog. The 9P share (`\\wsl.localhost\…`)
* serves only the ext4 volume: `/mnt/<drive>` (drvfs) reads return Access
* denied, so drvfs paths are read through their Windows drive spelling and
* `/mnt` itself is synthesized from the drives present on the host.
*/
function listWslDir(distro, linuxPath) {
	if (linuxPath === "/mnt") {
		const entries = [];
		for (let i = 0; i < 26; i++) {
			const letter = String.fromCharCode(65 + i);
			try {
				if (statSync(`${letter}:\\`).isDirectory()) entries.push({
					name: letter.toLowerCase(),
					kind: "directory"
				});
			} catch {}
		}
		return {
			path: "/mnt",
			parent: "/",
			entries
		};
	}
	const winPath = mntToWindowsPath(linuxPath);
	const entries = readdirSync(winPath !== null ? winPath : joinUnc(distro, linuxPath), { withFileTypes: true }).slice(0, 1e3).map((dirent) => {
		const kind = dirent.isDirectory() ? "directory" : dirent.isFile() ? "file" : "other";
		return {
			name: dirent.name,
			kind
		};
	}).sort((a, b) => {
		if (a.kind === "directory" && b.kind !== "directory") return -1;
		if (a.kind !== "directory" && b.kind === "directory") return 1;
		return a.name.localeCompare(b.name);
	});
	return {
		path: linuxPath,
		parent: linuxPath === "/" ? null : linuxPath.split("/").slice(0, -1).join("/") || "/",
		entries
	};
}
/** Route one method dispatch. */
async function dispatch(method, params) {
	switch (method) {
		case "listDistros": {
			const distros = await listDistros();
			const fallback = await defaultDistro();
			if (fallback !== void 0 && distros.includes(fallback)) return [fallback, ...distros.filter((name) => name !== fallback)];
			return distros;
		}
		case "listDir": return listWslDir(requireDistro(params.distro), requireLinuxPath(params.path, "path"));
		case "check": {
			const distro = requireDistro(params.distro);
			const path = requireLinuxPath(params.path, "path");
			const winPath = mntToWindowsPath(path);
			const readPath = winPath !== null ? winPath : joinUnc(distro, path);
			try {
				return {
					exists: true,
					isDirectory: statSync(readPath).isDirectory()
				};
			} catch {
				return {
					exists: false,
					isDirectory: false
				};
			}
		}
		case "registerWindows": {
			const distro = requireDistro(params.distro);
			const winPath = mntToWindowsPath(requireLinuxPath(params.linuxPath, "path"));
			if (winPath === null) throw new Error("registerWindows requires a /mnt/<drive> Linux path");
			registerWindowsWorkspace(winPath, distro, typeof params.username === "string" ? params.username : void 0);
			return null;
		}
		case "listWorkspaces": return listWorkspaceKeys();
		case "setUser": {
			const path = requireWslUnc(params.path);
			const username = params.username;
			if (username === void 0 || username === "") setWorkspaceUsername(path, void 0);
			else {
				if (typeof username !== "string" || !isValidWslUsername(username)) throw new Error("username must match the Linux username pattern [A-Za-z_][A-Za-z0-9_.-]*");
				setWorkspaceUsername(path, username);
			}
			return null;
		}
		default: throw new Error(`unknown method "${method}"`);
	}
}
/**
* Publish a fully staged preset directory while preserving the last complete
* variant if publication fails. Stable sibling names also let the next boot
* recover an interrupted old-to-backup rename before doing new work.
*/
function publishVariant(staging, dest) {
	const previous = `${dest}.previous`;
	if (!existsSync(dest) && existsSync(previous)) renameSync(previous, dest);
	if (existsSync(previous)) rmSync(previous, {
		recursive: true,
		force: true
	});
	if (existsSync(dest)) renameSync(dest, previous);
	try {
		renameSync(staging, dest);
	} catch (error) {
		if (!existsSync(dest) && existsSync(previous)) renameSync(previous, dest);
		throw error;
	}
	rmSync(previous, {
		recursive: true,
		force: true
	});
}
/** Materialize one WSL variant per healthy source preset. */
async function materializeVariants(agentPresets, dshHome, shellPath, fsPath) {
	const presets = await agentPresets.list();
	const userRoot = join(dshHome, ".agent-presets");
	const generated = /* @__PURE__ */ new Set();
	for (const preset of presets) {
		if (preset.broken !== void 0) continue;
		if (isWslVariantId(preset.id)) continue;
		const variantId = variantIdFor(preset.id);
		const transformed = transformPresetForWsl(await agentPresets.read(preset.id), shellPath, fsPath);
		const dir = join(userRoot, variantId);
		const staging = `${dir}.staging`;
		rmSync(staging, {
			recursive: true,
			force: true
		});
		cpSync(dirname(preset.path), staging, {
			recursive: true,
			force: true
		});
		writeFileSync(join(staging, "agent.cordis.yml"), transformed, "utf8");
		const labels = MODE_DISPLAY_LABELS[preset.id];
		let name = variantName(preset.id, preset.id);
		let orderLine = "";
		try {
			const meta = readFileSync(join(dirname(preset.path), "preset.yml"), "utf8");
			if (labels === void 0) {
				const match = /^name:\s*(.+)$/m.exec(meta);
				if (match?.[1] !== void 0 && match[1].trim() !== "") name = variantName(preset.id, match[1].trim());
			}
			const orderMatch = /^order:\s*(\d+)\s*$/m.exec(meta);
			if (orderMatch?.[1] !== void 0) orderLine = `order: ${orderMatch[1]}\n`;
		} catch {}
		writeFileSync(join(staging, "preset.yml"), `name: ${yamlScalar(name)}\n` + orderLine + `description: ${yamlScalar(variantDescription(preset.id))}\n`, "utf8");
		publishVariant(staging, dir);
		generated.add(variantId);
	}
	for (const entry of readdirSync(userRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "wsl") {
			rmSync(join(userRoot, entry.name), {
				recursive: true,
				force: true
			});
			continue;
		}
		if (!/^wsl-[a-z0-9-]+$/.test(entry.name)) continue;
		if (!generated.has(entry.name)) rmSync(join(userRoot, entry.name), {
			recursive: true,
			force: true
		});
	}
}
/** Function-plugin plugin contract. */
const name = "dsh-wsl-workspace";
/** Required services. */
const inject = ["webServer"];
/** Validated plugin config (schemastery applied the defaults). */
const Config = z.object({ route: z.string().default(DEFAULT_ROUTE) });
/**
* Apply the host half: materialize a `wsl-<mode>` variant for every healthy
* roster preset, register the data route, and
* contribute the per-session `DSH_WSL_DISTRO` managed-env fact so the WSL
* shell executor can resolve a plain Linux `workdir` to the calling
* session's distribution.
* @param ctx - the host plugin context.
* @param config - the validated configuration.
*/
function apply(ctx, config) {
	const resolved = config;
	const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const shellPath = join(packageRoot, "lib", "shell.js").replace(/\\/g, "/");
	const fsPath = join(packageRoot, "lib", "fs.js").replace(/\\/g, "/");
	const agentPresets = ctx.get("agentPresets");
	if (agentPresets !== void 0) ctx.effect(() => {
		materializeVariants(agentPresets, dshHome, shellPath, fsPath).catch((error) => {
			console.error(`dsh-wsl-workspace: WSL preset-variant generation failed: ${messageOf(error)}`);
		});
		return () => {};
	}, "dsh-wsl-workspace: WSL preset variants");
	const skills = ctx.get("skills");
	if (skills !== void 0 && typeof skills.registerProvider === "function") ctx.effect(() => skills.registerProvider((control) => new WslSkillsProvider(control)), "dsh-wsl-workspace: WSL workspace skills provider");
	const shellEnv = ctx.get("shellEnv");
	if (shellEnv !== void 0) ctx.effect(() => shellEnv.register({
		name: "wsl-workspace-distro",
		variables: {
			DSH_WSL_DISTRO: { description: "The WSL distribution of the calling session workspace, when the session cwd is a WSL UNC path." },
			DSH_WSL_USER: { description: "The Linux user of the calling session workspace, when the workspace has one configured." }
		},
		resolve(execution) {
			const cwd = execution.agent?.session.header.cwd;
			const unc = cwd === void 0 ? null : parseWslUnc(cwd);
			if (unc !== null) {
				const username = getWorkspaceUsername(joinUnc(unc.distro, unc.linuxPath));
				return username === void 0 || username === "" ? { DSH_WSL_DISTRO: unc.distro } : {
					DSH_WSL_DISTRO: unc.distro,
					DSH_WSL_USER: username
				};
			}
			if (cwd !== void 0 && /^[A-Za-z]:[\\/]/.test(cwd)) {
				const entry = getWindowsWorkspace(cwd);
				if (entry !== void 0 && entry.distro !== void 0 && entry.distro !== "") return entry.username === void 0 || entry.username === "" ? { DSH_WSL_DISTRO: entry.distro } : {
					DSH_WSL_DISTRO: entry.distro,
					DSH_WSL_USER: entry.username
				};
			}
			return {};
		}
	}), "dsh-wsl-workspace: per-session distro env fact");
	const webServer = ctx.get("webServer");
	ctx.effect(() => webServer.register({
		kind: "exact",
		path: resolved.route,
		handler: async (req, res) => {
			if (!isLoopback(req.socket.remoteAddress) || !isLoopbackHost(req.headers.host)) {
				json(res, 403, {
					ok: false,
					error: "loopback-only"
				});
				return;
			}
			if (req.method !== "POST") {
				json(res, 405, {
					ok: false,
					error: "method not allowed"
				});
				return;
			}
			let body;
			try {
				body = await readBody(req);
			} catch (error) {
				json(res, 400, {
					ok: false,
					error: messageOf(error)
				});
				return;
			}
			const method = typeof body.method === "string" ? body.method : "";
			const params = body.params === void 0 ? {} : body.params;
			if (params === null || typeof params !== "object" || Array.isArray(params)) {
				json(res, 400, {
					ok: false,
					error: "params must be an object"
				});
				return;
			}
			try {
				json(res, 200, {
					ok: true,
					value: await dispatch(method, params)
				});
			} catch (error) {
				json(res, 200, {
					ok: false,
					error: messageOf(error)
				});
			}
		}
	}), "dsh-wsl-workspace: dialog data route");
}
//#endregion
export { Config, DEFAULT_ROUTE, apply, inject, name };

//# sourceMappingURL=index.js.map