import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync, closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, opendirSync, readSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isAntigravityChildTier } from "@hanoman/shared";
import { agentEnvironment } from "./agent-env";
import { agentPromptOf, phasePromptOf, type AgentDef } from "./custom-agents";

const digest = (bytes: string): string => createHash("sha256").update(bytes).digest("hex");
const validName = (name: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(name);
const MARKER = "# hanoman:antigravity-agents:";
type Warning = { agentName: string; reason: string };
type OwnedFile = { name: string; hash: string; ino: number; dev: number; pair: string };
type Manifest = { version: 1; cwd: string; sessionId: string; files: OwnedFile[] };
type Options = {
  cwd: string; sessionId: string; defs: AgentDef[];
  writeFile?: (path: string, content: string) => void;
};
export type AntigravityMaterialization = {
  names: string[]; cleanup: () => void; warnings: Warning[]; liveDefs: AgentDef[];
};

export function renderAntigravityAgent(def: AgentDef, roster: AgentDef[]): string {
  if (!validName(def.name)) throw new Error("invalid native agent name");
  if (!isAntigravityChildTier(def.model ?? "inherit")) throw new Error("unsupported native child model tier");
  if (def.effort != null) throw new Error("independent native child effort unavailable");
  if (def.tools != null) throw new Error("native child tool restriction unavailable");
  if (def.workspacePolicy && def.workspacePolicy !== "inherit") throw new Error(`${def.workspacePolicy} native child policy unavailable`);
  const prompt = def.kind === "phase" ? phasePromptOf(def) : agentPromptOf(def, roster, "antigravity");
  return [
    "---", `name: ${JSON.stringify(def.name)}`, `description: ${JSON.stringify(def.description)}`,
    `model: ${JSON.stringify(def.model ?? "inherit")}`, "mainAgent: false", "subagent: true", "---", prompt, "",
  ].join("\n");
}

function paths(opts: { cwd: string; sessionId: string }) {
  if (!validName(opts.sessionId)) throw new Error("invalid native session id");
  const cwd = resolve(opts.cwd), directory = join(cwd, ".agents", "agents");
  const prefix = `hanoman-${digest(`${cwd}\0${opts.sessionId}`).slice(0, 24)}-`;
  const manifest = join(directory, `.${prefix}manifest.json`);
  const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, env: agentEnvironment(null, process.env), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const exclude = join(isAbsolute(common) ? common : join(cwd, common), "info", "exclude");
  return { cwd, directory, prefix, manifest, exclude };
}

function safeDirectory(path: string): void {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (st && (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.())) throw new Error("unsafe native registry directory");
  if (!st) mkdirSync(path, { mode: 0o700 });
}
function safeRegularFile(path: string): boolean {
  const st = lstatSync(path, { throwIfNoEntry: false });
  return !!st && st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid?.();
}
function readExclude(path: string): string {
  if (!lstatSync(path, { throwIfNoEntry: false })) return "";
  if (!safeRegularFile(path)) throw new Error("unsafe Git exclude file");
  return readFileSync(path, "utf8");
}
function excludePair(p: ReturnType<typeof paths>, file: string): string {
  return `${MARKER}${digest(`${p.cwd}\0${p.prefix}\0${file}`)}\n/.agents/agents/${file}\n`;
}
function addExclude(p: ReturnType<typeof paths>, pair: string): void {
  const current = readExclude(p.exclude);
  appendFileSync(p.exclude, `${current && !current.endsWith("\n") ? "\n" : ""}${pair}`);
}
function removeExclude(p: ReturnType<typeof paths>, pair: string): void {
  const current = readExclude(p.exclude);
  if (current.includes(pair)) writeFileSync(p.exclude, current.replace(pair, ""));
}
function readManifest(p: ReturnType<typeof paths>, sessionId: string): Manifest | null {
  if (!safeRegularFile(p.manifest)) return null;
  const data: unknown = JSON.parse(readFileSync(p.manifest, "utf8"));
  if (!data || typeof data !== "object") throw new Error("invalid native registry manifest");
  const m = data as Manifest;
  if (m.version !== 1 || m.cwd !== p.cwd || m.sessionId !== sessionId || !Array.isArray(m.files)
    || m.files.some(f => !f || typeof f.name !== "string" || !f.name.startsWith(p.prefix)
      || !validName(f.name.slice(p.prefix.length, -3)) || !f.name.endsWith(".md")
      || !/^[a-f0-9]{64}$/.test(f.hash) || typeof f.ino !== "number" || typeof f.dev !== "number"
      || f.pair !== excludePair(p, f.name))) throw new Error("invalid native registry manifest");
  return m;
}
function writeManifest(p: ReturnType<typeof paths>, manifest: Manifest): void {
  const temporary = `${p.manifest}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
    renameSync(temporary, p.manifest);
  } finally { try { unlinkSync(temporary); } catch { /* rename already consumed it */ } }
}

const OWNERSHIP_CHANGED = "native registry ownership changed during roster preparation";

function rewriteOwnedFile(p: ReturnType<typeof paths>, own: OwnedFile, content: string): void {
  const path = join(p.directory, own.name);
  let fd: number;
  try { fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW); }
  catch { throw new Error(OWNERSHIP_CHANGED); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid?.() || st.ino !== own.ino || st.dev !== own.dev
      || (st.mode & 0o777) !== 0o600 || digest(readFileSync(fd, "utf8")) !== own.hash) throw new Error(OWNERSHIP_CHANGED);
    // Positional writes use this verified inode even if the path is replaced afterwards.
    const bytes = Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!written) throw new Error("native registry preparation failed");
      offset += written;
    }
    ftruncateSync(fd, bytes.length);
    const current = lstatSync(path, { throwIfNoEntry: false });
    if (!current?.isFile() || current.isSymbolicLink() || current.ino !== own.ino || current.dev !== own.dev) throw new Error(OWNERSHIP_CHANGED);
    own.hash = digest(content);
  } finally { closeSync(fd); }
}

/** Persisted ownership lets killSession clean a roster after an API restart. */
export function cleanupAntigravityAgents(opts: { cwd: string; sessionId: string }): void {
  try {
    const p = paths(opts);
    for (const directory of [join(p.cwd, ".agents"), p.directory]) {
      const st = lstatSync(directory, { throwIfNoEntry: false });
      if (!st || !st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.()) return;
    }
    const m = readManifest(p, opts.sessionId);
    if (!m) return;
    const retained: OwnedFile[] = [];
    for (const f of m.files) {
      const path = join(p.directory, f.name), st = lstatSync(path, { throwIfNoEntry: false });
      if (st && (!safeRegularFile(path) || st.ino !== f.ino || st.dev !== f.dev || digest(readFileSync(path, "utf8")) !== f.hash)) {
        retained.push(f); continue;
      }
      if (st) unlinkSync(path);
      removeExclude(p, f.pair);
    }
    if (retained.length) writeManifest(p, { ...m, files: retained });
    else {
      unlinkSync(p.manifest);
      removeExclude(p, excludePair(p, p.manifest.split("/").at(-1)!));
    }
  } catch { /* Missing or operator-edited ownership must never delete their files. */ }
}

function operatorDefinitions(directory: string): string[] {
  const dir = opendirSync(directory), files: string[] = [];
  let inspected = 0;
  try {
    for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
      if (++inspected > 1024) throw new Error("native registry inspection limit");
      if (entry.name.endsWith(".md")) files.push(entry.name);
      if (files.length > 256) throw new Error("native registry inspection limit");
    }
  } finally { dir.closeSync(); }
  return files;
}

function operatorFrontmatter(path: string): string {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { throw new Error("unsafe native registry definition"); }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.uid !== process.getuid?.()) throw new Error("unsafe native registry definition");
    const prefix = Buffer.alloc(16 * 1024), count = readSync(fd, prefix, 0, prefix.length, 0);
    const contents = prefix.subarray(0, count).toString("utf8");
    if (/^---\r?\n/.test(contents) && !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(contents)) {
      throw new Error("native registry frontmatter inspection limit");
    }
    const after = fstatSync(fd), current = lstatSync(path, { throwIfNoEntry: false });
    if (!current?.isFile() || current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("native registry definition changed during inspection");
    return contents;
  } finally { closeSync(fd); }
}

export function materializeAntigravityAgents(opts: Options): AntigravityMaterialization {
  const p = paths(opts);
  for (const directory of [join(p.cwd, ".agents"), p.directory]) safeDirectory(directory);
  cleanupAntigravityAgents(opts);
  if (lstatSync(p.manifest, { throwIfNoEntry: false })) throw new Error("native registry ownership collision");
  const write = opts.writeFile;
  const warnings: Warning[] = [], liveDefs: AgentDef[] = [];
  const names = new Set<string>();
  for (const file of operatorDefinitions(p.directory)) {
    const path = join(p.directory, file);
    if (!safeRegularFile(path)) throw new Error("unsafe native registry definition");
    const contents = operatorFrontmatter(path);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(contents)?.[1];
    const raw = frontmatter && /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
    if (raw) {
      let name: unknown;
      if (raw.startsWith('"')) {
        const scalar = /^"(?:[^"\\]|\\.)*"/.exec(raw)?.[0];
        try { name = scalar && JSON.parse(scalar); } catch { /* reject an ambiguous operator scalar */ }
      } else if (raw.startsWith("'")) {
        name = /^'((?:[^']|'')*)'(?:\s+#.*)?$/.exec(raw)?.[1]?.replaceAll("''", "'");
      } else name = raw.replace(/\s+#.*$/, "").trim();
      if (typeof name !== "string" || !validName(name)) throw new Error("unsupported native operator name scalar");
      names.add(name);
    }
    names.add(file.slice(0, -3));
  }
  const manifest: Manifest = { version: 1, cwd: p.cwd, sessionId: opts.sessionId, files: [] };
  writeFileSync(p.manifest, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  const manifestPair = excludePair(p, p.manifest.split("/").at(-1)!);
  try { addExclude(p, manifestPair); }
  catch (error) { unlinkSync(p.manifest); throw error; }
  for (const def of opts.defs) {
    let ownedPath: string | undefined, identity: { ino: number; dev: number } | undefined, pair = "", content = "";
    try {
      if (names.has(def.name)) throw new Error("native agent name collision");
      content = renderAntigravityAgent(def, opts.defs);
      const file = `${p.prefix}${def.name}.md`, path = join(p.directory, file);
      if (lstatSync(path, { throwIfNoEntry: false })) throw new Error("native agent file collision");
      // Exclusive creation records the inode before a partial disk write can fail.
      const fd = openSync(path, "wx", 0o600);
      ownedPath = path;
      identity = fstatSync(fd);
      try { if (write) write(path, content); else writeFileSync(fd, content); }
      finally { closeSync(fd); }
      const st = lstatSync(path);
      if (!safeRegularFile(path) || st.ino !== identity.ino || st.dev !== identity.dev || (st.mode & 0o777) !== 0o600) throw new Error("unsafe native registry permissions");
      pair = excludePair(p, file); addExclude(p, pair);
      manifest.files.push({ name: file, hash: digest(content), ino: st.ino, dev: st.dev, pair });
      writeManifest(p, manifest);
      names.add(def.name); liveDefs.push(def);
    } catch (error) {
      if (ownedPath) {
        try { const st = lstatSync(ownedPath); if (safeRegularFile(ownedPath) && st.ino === identity?.ino && st.dev === identity?.dev) unlinkSync(ownedPath); } catch { /* preserve replacements */ }
        try { if (pair) removeExclude(p, pair); } catch { /* cleanup best effort */ }
      }
      warnings.push({ agentName: def.name, reason: error instanceof Error && /^(invalid|unsupported|independent|native|unsafe|read-only|isolated-worktree)/.test(error.message)
        ? error.message : "native registry preparation failed" });
    }
  }
  const failedPhase = warnings.some(w => opts.defs.some(d => d.name === w.agentName && d.kind === "phase"));
  const cleanup = () => cleanupAntigravityAgents(opts);
  if (failedPhase) { cleanup(); return { names: [], warnings, liveDefs: [], cleanup }; }
  // A later definition write can reveal operator replacement of an earlier owned file.
  // Retry the survivors so their mentions cannot retain any newly unavailable agent.
  let changed: boolean;
  do {
    changed = false;
    for (const def of [...liveDefs]) {
      const owned = manifest.files.find(f => f.name === `${p.prefix}${def.name}.md`)!;
      try {
        rewriteOwnedFile(p, owned, renderAntigravityAgent(def, liveDefs));
        writeManifest(p, manifest);
      } catch (error) {
        warnings.push({ agentName: def.name, reason: error instanceof Error && error.message === OWNERSHIP_CHANGED
          ? OWNERSHIP_CHANGED : "native registry preparation failed" });
        liveDefs.splice(liveDefs.indexOf(def), 1);
        if (def.kind === "phase") {
          cleanup();
          return { names: [], warnings, liveDefs: [], cleanup };
        }
        changed = true;
      }
    }
  } while (changed && liveDefs.length);
  return { names: liveDefs.map(d => d.name), liveDefs, warnings, cleanup };
}
