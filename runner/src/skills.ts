// SPEC-739 · ADR-0114 — deteksi skill yang benar-benar terpasang, PER AGEN.
//
// Duduk di `runner` karena di sinilah library node-only yang dipakai server DAN cli (preseden
// `paths.ts`). `shared` tak bisa: ia ikut dibundel Vite ke browser, sementara berkas ini membaca
// filesystem.
//
// FAIL-OPEN PER SUMBER, bukan fail-open pada vonis: direktori hilang / JSON rusak / izin ditolak
// membuat SATU sumber menyumbang nol skill, tak pernah melempar dan tak pernah mengosongkan
// sumber lain. Yang tak boleh longgar adalah pencocokannya (lihat `shared/src/method-status.ts`) —
// vonis optimistis palsu justru kegagalan senyap yang spec ini hapus.
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { Agent } from "./types";
import type { EnvLike } from "./paths";

export interface InstalledSkill {
  /** Alamat pemanggilan: `<pkg>:<name>` untuk skill plugin, `<name>` untuk skill user. */
  readonly id: string;
  readonly name: string;
  /** `null` = skill user, tak berpaket. */
  readonly pkg: string | null;
  /** Bukti: direktori yang memuat SKILL.md. */
  readonly dir: string;
}

export interface AgentSkills {
  readonly agent: Agent;
  /** Akar yang dipindai, sesudah override env. */
  readonly home: string;
  readonly roots: string[];
  readonly skills: InstalledSkill[];
  readonly packages: string[];
}

/**
 * Akar konfigurasi agen. `HANOMAN_*_HOME` mencerminkan `HANOMAN_CLAUDE_BIN`/`HANOMAN_CODEX_BIN`
 * dan sengaja MENANG atas `CODEX_HOME`: test tak boleh bergantung pada env agen nyata, sementara
 * `CODEX_HOME` tetap dihormati karena codex sendiri memakainya (`codex-limits`, `codex-trust`).
 */
export function agentSkillHome(agent: Agent, env: EnvLike = process.env, osHome: string = homedir()): string {
  const own = (agent === "codex" ? env.HANOMAN_CODEX_HOME : env.HANOMAN_CLAUDE_HOME)?.trim();
  if (own) return own;
  if (agent === "codex") {
    const cx = env.CODEX_HOME?.trim();
    if (cx) return cx;
  }
  return join(osHome, agent === "codex" ? ".codex" : ".claude");
}

/**
 * Akar skill LINTAS-AGEN `~/.agents`, tempat `npx skills add` memasang. Ia bukan milik satu agen,
 * jadi ia punya env sendiri — `HANOMAN_AGENTS_HOME` — dan bukan turunan `agentSkillHome`.
 */
export function agentsSkillHome(env: EnvLike = process.env, osHome: string = homedir()): string {
  return env.HANOMAN_AGENTS_HOME?.trim() || join(osHome, ".agents");
}

/** Sub-direktori yang bukan dot-dir. Simlink ikut: plugin cache sah memakainya. */
function dirsIn(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch { return []; }
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/** Sebuah direktori adalah skill bila ia memuat SKILL.md — aturan yang sama di kedua agen. */
function isSkillDir(dir: string): boolean { return existsSync(join(dir, "SKILL.md")); }

function asSkill(dir: string, pkg: string | null, name = basename(dir)): InstalledSkill {
  return { id: pkg ? `${pkg}:${name}` : name, name, pkg, dir };
}

/**
 * Skill di bawah satu akar. Layout DATAR (`skills/<n>/`) MAUPUN BERSARANG PER KATEGORI
 * (`skills/engineering/<n>/`) sama-sama terbaca — `mattpocock-skills` memakai yang kedua, dan
 * asumsi datar membuat paket yang sungguh-sungguh terpasang dilaporkan hilang SELURUHNYA
 * (terukur di mesin operator, v1.2.3: yang terlihat cuma `engineering/` & `productivity/`).
 *
 * Direktori yang SUDAH menjadi skill tidak ditembus lebih dalam: `skills/<n>/agents/…` adalah
 * berkas pendukung skill itu, bukan skill bersarang.
 */
function skillsUnder(dir: string, pkg: string | null, depth = 2): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  for (const name of dirsIn(dir)) {
    const sub = join(dir, name);
    if (isSkillDir(sub)) out.push(asSkill(sub, pkg, name));
    else if (depth > 1) out.push(...skillsUnder(sub, pkg, depth - 1));
  }
  return out;
}

/**
 * Daftar skill yang DINYATAKAN manifest plugin (`skills[]` di `.claude-plugin/plugin.json` atau
 * `.codex-plugin/plugin.json`). Ini sumber paling otoritatif — ia menyebut path persis, jadi layout
 * seaneh apa pun terbaca tanpa menebak. Entri boleh menunjuk direktori atau `SKILL.md`-nya langsung.
 * Entri yang menunjuk ke berkas yang tak ada dibuang diam-diam: manifest boleh mendahului isi.
 */
function manifestSkills(installPath: string, pkg: string): InstalledSkill[] {
  for (const marker of [".claude-plugin", ".codex-plugin"]) {
    const j = readJson(join(installPath, marker, "plugin.json")) as { skills?: unknown } | null;
    const declared = j?.skills;
    if (!Array.isArray(declared)) continue;
    const out: InstalledSkill[] = [];
    for (const rel of declared) {
      if (typeof rel !== "string" || !rel) continue;
      const p = resolve(installPath, rel);
      const dir = basename(p) === "SKILL.md" ? dirname(p) : p;
      if (isSkillDir(dir)) out.push(asSkill(dir, pkg));
    }
    if (out.length) return out;
  }
  return [];
}

/** Skill satu plugin: manifest bila ia menyatakannya, selain itu pemindaian `skills/`. */
function pluginSkills(installPath: string, pkg: string): InstalledSkill[] {
  const declared = manifestSkills(installPath, pkg);
  return declared.length ? declared : skillsUnder(join(installPath, "skills"), pkg);
}

/**
 * Asal-usul skill di `~/.agents/skills`, dari `.skill-lock.json` yang ditulis `npx skills add`.
 * `pluginName` di situ adalah BUKTI paket asal, bukan tebakan — tanpanya skill yang dipasang lewat
 * jalur itu hanya punya nama polos dan metode yang memanggil `<pkg>:<n>` selamanya merah.
 */
function lockPluginNames(agentsHome: string): Map<string, string> {
  const out = new Map<string, string>();
  const j = readJson(join(agentsHome, ".skill-lock.json")) as
    { skills?: Record<string, unknown> } | null;
  const skills = j?.skills;
  if (!skills || typeof skills !== "object") return out;
  for (const [name, entry] of Object.entries(skills)) {
    const pkg = (entry as { pluginName?: unknown } | null)?.pluginName;
    if (typeof pkg === "string" && pkg.trim()) out.set(name, pkg.trim());
  }
  return out;
}

interface PluginRoot { pkg: string; marketplace: string; dir: string }

/** `<pkg>@<marketplace>`; `@` terakhir yang memisah, karena nama paket boleh memuatnya. */
function splitPluginKey(key: string): { pkg: string; marketplace: string } {
  const at = key.lastIndexOf("@");
  return at > 0 ? { pkg: key.slice(0, at), marketplace: key.slice(at + 1) } : { pkg: key, marketplace: "" };
}

function manifestRoots(home: string): PluginRoot[] {
  const j = readJson(join(home, "plugins", "installed_plugins.json")) as
    { plugins?: Record<string, unknown> } | null;
  const plugins = j?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const out: PluginRoot[] = [];
  for (const [key, entries] of Object.entries(plugins)) {
    const { pkg, marketplace } = splitPluginKey(key);
    for (const e of Array.isArray(entries) ? entries : []) {
      const p = (e as { installPath?: unknown } | null)?.installPath;
      if (typeof p === "string" && p) out.push({ pkg, marketplace, dir: p });
    }
  }
  return out;
}

/** `plugins/cache/<marketplace>/<pkg>/<versi>/`. Bentuk ini dipakai claude MAUPUN codex. */
function cacheRoots(home: string): PluginRoot[] {
  const cache = join(home, "plugins", "cache");
  const out: PluginRoot[] = [];
  for (const marketplace of dirsIn(cache))
    for (const pkg of dirsIn(join(cache, marketplace)))
      for (const version of dirsIn(join(cache, marketplace, pkg)))
        out.push({ pkg, marketplace, dir: join(cache, marketplace, pkg, version) });
  return out;
}

/**
 * Plugin yang DINYATAKAN nonaktif. Absen ⇒ aktif: berkas gerbangnya boleh saja tak ada sama
 * sekali, dan ketiadaan pernyataan bukan pernyataan ketiadaan.
 *
 * codex menyatakannya di `config.toml`; berkas itu puluhan KB berisi ratusan blok
 * `[projects."…"]` yang tak ada urusannya dengan kita, dan yang dibaca cuma satu boolean —
 * menyeret parser TOML ke `runner` demi itu tak sepadan.
 */
function disabledPlugins(agent: Agent, home: string): Set<string> {
  const out = new Set<string>();
  if (agent === "claude") {
    const en = (readJson(join(home, "settings.json")) as
      { enabledPlugins?: Record<string, unknown> } | null)?.enabledPlugins;
    if (en && typeof en === "object")
      for (const [k, v] of Object.entries(en)) if (v === false) out.add(k);
    return out;
  }
  let toml: string;
  try { toml = readFileSync(join(home, "config.toml"), "utf8"); } catch { return out; }
  let current: string | null = null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    const head = /^\[([^\]]*)\]$/.exec(line);
    if (head) {
      const m = /^plugins\."(.+)"$/.exec(head[1] ?? "");
      current = m ? m[1]! : null;
      continue;
    }
    if (current && /^enabled\s*=\s*false\b/.test(line)) out.add(current);
  }
  return out;
}

/** Skill yang terpasang untuk satu agen: `<home>/skills/*` ∪ plugin (manifest ∪ cache). */
export function scanAgentSkills(
  agent: Agent, env: EnvLike = process.env, osHome: string = homedir(),
): AgentSkills {
  const home = agentSkillHome(agent, env, osHome);
  const disabled = disabledPlugins(agent, home);
  const roots: string[] = [];
  const skills: InstalledSkill[] = [];
  const packages = new Set<string>();
  const seenSkill = new Set<string>();
  const seenRoot = new Set<string>();

  const add = (dir: string, found: InstalledSkill[]) => {
    if (!found.length) return;
    if (!seenRoot.has(dir)) { seenRoot.add(dir); roots.push(dir); }
    for (const s of found) if (!seenSkill.has(s.id)) { seenSkill.add(s.id); skills.push(s); }
  };

  const userDir = join(home, "skills");
  add(userDir, skillsUnder(userDir, null));

  for (const r of [...manifestRoots(home), ...cacheRoots(home)]) {
    if (disabled.has(`${r.pkg}@${r.marketplace}`)) continue;
    const found = pluginSkills(r.dir, r.pkg);
    if (!found.length) continue;
    packages.add(r.pkg);
    add(join(r.dir, "skills"), found);
  }

  // AKAR KETIGA, khusus codex: `~/.agents/skills`. `npx skills add` — jalur pemasangan resmi
  // mattpocock di codex — memasang ke sini dan TIDAK menyentuh `~/.codex/skills`, sehingga paket
  // yang sudah terpasang tampak nol. codex membacanya (`codex_skills/src/host_roots.rs` menyebut
  // `.agents` bersama `.codex/skills`); claude tidak, jadi akar ini tak boleh menghijaukan claude.
  if (agent === "codex") {
    const agentsHome = agentsSkillHome(env, osHome);
    const dir = join(agentsHome, "skills");
    const names = lockPluginNames(agentsHome);
    const flat = skillsUnder(dir, null);
    // DUA alamat untuk berkas yang sama, keduanya benar: prompt metode memanggil `<pkg>:<n>`,
    // sementara codex melihat direktori datar bernama `<n>`. Menerbitkan satu saja membuat salah
    // satu sisi berbohong — dan yang berpaket hanya terbit bila lock benar-benar membuktikannya.
    const withPkg = flat.flatMap((s) => {
      const pkg = names.get(s.name);
      if (!pkg) return [s];
      packages.add(pkg);
      return [asSkill(s.dir, pkg, s.name), s];
    });
    add(dir, withPkg);
  }
  return { agent, home, roots, skills, packages: [...packages] };
}
