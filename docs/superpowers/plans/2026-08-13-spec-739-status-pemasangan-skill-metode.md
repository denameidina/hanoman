# SPEC-739 — Status & pemasangan skill metode · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator melihat dalam satu layar metode mana yang benar-benar siap dipakai di mesin ini — **per agen** — dan bisa memasang yang kurang tanpa meninggalkan dashboard.

**Architecture:** Deteksi membaca disk (`runner/src/skills.ts`, dipakai server **dan** CLI seperti `paths.ts`); vonis adalah fungsi murni di `shared` yang membandingkan hasil deteksi dengan katalog `METHODS`; endpoint `GET /api/methods/status` menurunkannya **live tiap request** tanpa satu pun kolom DB; pemasangan dilakukan **shell di dalam pane tmux** yang dilahirkan `POST /terminal/sessions` (ADR-0056) dengan perintah yang diturunkan dari katalog — server tak pernah memasang apa pun.

**Tech Stack:** TypeScript strict · Node `node:fs`/`node:os`/`node:path` · Fastify · zod (hanya di batas HTTP) · React + Vite · vitest.

## Global Constraints

- **SERVER TAK MEMASANG APA PUN.** Tombol install WAJIB lewat sesi terminal (ADR-0056). Jangan menambah `execFile` pemasang di server; jangan menambah protokol restart ala ADR-0088.
- **DETEKSI FAIL-OPEN pada GERBANG, bukan pada VONIS.** Metode yang tak terdeteksi **ditandai, tak pernah menolak Start**. Pencocokan skill tetap **ketat & id persis** — vonis optimistis palsu adalah kegagalan senyap yang spec ini hapus.
- **TIDAK ADA STATUS TERSIMPAN DI DB.** Diturunkan dari disk tiap request (cermin ADR-0011/0018). Nol model Prisma baru ⇒ nol entri `FIELDS` sync.
- **DUA AKAR, DUA AGEN — jangan pernah menyatukannya.** Status wajib per-agen di seluruh jalur: deteksi, endpoint, checklist, peringatan picker, doctor.
- **PERINTAH INSTALASI ADALAH DATA KATALOG**, hidup di `METHODS` bersama `requires`. Metode ketiga = satu entri, nol sunting di server/web.
- **JANGAN menambah cermin `requires`.** Katalog tunggal `shared/src/method-catalog.ts`, di-**impor** runner.
- **Bukti test dari akar ber-env**, tak pernah dari HOME mesin yang menjalankan test.
- Verifikasi ber-scope: `pnpm vitest --run --no-file-parallelism` dengan **path test yang disebut**, plus `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` untuk test server. Jangan suite penuh, jangan `pnpm -r typecheck`.
- Bahasa komentar & UI: Indonesia, mengikuti gaya berkas sekitarnya. Setiap komentar menjelaskan **kenapa**, bukan mengulang kode.

---

## File Structure

| Berkas | Peran |
|---|---|
| `runner/src/skills.ts` (baru) | **Deteksi**: pindai akar skill per agen, hasilkan daftar skill + paket terpasang. Satu-satunya berkas yang menyentuh fs untuk urusan ini. |
| `runner/test/skills.test.ts` (baru) | Test deteksi atas pohon direktori sementara ber-env. |
| `runner/src/index.ts` | `export * from "./skills"`. |
| `shared/src/method-catalog.ts` | Tambah `MethodDef.install` (perintah per agen). |
| `shared/src/method-status.ts` (baru) | **Vonis murni**: katalog ↔ hasil deteksi → `MethodSkillStatus`. Dipakai server **dan** web. |
| `shared/src/method-status.test.ts` (baru) | Test vonis + invarian sumber `install`. |
| `shared/src/index.ts` | `export * from "./method-status"`. |
| `shared/src/api.ts` | Path `methodStatus`. |
| `shared/src/dto.ts` | Varian shell `zTerminalSession` + field `install` opsional. |
| `server/src/services/method-status.ts` (baru) | Rakit laporan (deteksi × katalog) + `installCommand()` untuk pane. |
| `server/src/routes/methods.ts` (baru) | `GET /api/methods/status`. |
| `server/src/app.ts` | Daftarkan route. |
| `server/src/routes/terminal.ts` | Cabang shell menjalankan perintah instalasi bila `install` dikirim. |
| `server/test/method-status.route.test.ts` (baru) | Endpoint + cabang install. |
| `src/src/api/client.ts` | `getMethodStatus()`, `createShell(project, install?)`. |
| `src/src/screens/SettingsScreen.tsx` | Checklist per metode × agen + tombol Pasang. |
| `src/src/App.tsx` | Catatan status di picker Start (metode × agen terpilih). |
| `src/test/method-status-ui.test.tsx` (baru) | Kedua permukaan UI. |
| `cli/src/commands/doctor.ts` | Baris `!` non-fatal untuk metode default. |
| `cli/test/doctor.test.ts` | Kasus baru. |
| `internal/docs/adr/0114-*.md` (baru) + `internal/docs/README.md` + `internal/docs/adr/README.md` + `internal/skills/hanoman/SKILL.md` | Docs SoT. |

---

### Task 1: Deteksi skill per agen (`runner/src/skills.ts`)

**Files:**
- Create: `runner/src/skills.ts`
- Create: `runner/test/skills.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: `EnvLike` dari `runner/src/paths.ts`; `Agent` dari `runner/src/types.ts`.
- Produces:
  - `interface InstalledSkill { id: string; name: string; pkg: string | null; dir: string }`
  - `interface AgentSkills { agent: Agent; home: string; roots: string[]; skills: InstalledSkill[]; packages: string[] }`
  - `function agentSkillHome(agent: Agent, env?: EnvLike, osHome?: string): string`
  - `function scanAgentSkills(agent: Agent, env?: EnvLike, osHome?: string): AgentSkills`

- [x] **Step 1: Tulis test yang gagal**

Buat `runner/test/skills.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentSkillHome, scanAgentSkills } from "../src/skills";

// CATATAN VERIFIKASI SPEC-739: seluruh bukti "terpasang/tak terpasang" datang dari pohon
// direktori yang dirakit test ini dan ditunjuk lewat env — TIDAK PERNAH dari HOME mesin yang
// menjalankannya. Tanpa itu hijau/merah bergantung siapa yang menjalankan suite-nya.
let root: string;
const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "hn-skills-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("agentSkillHome", () => {
  it("default ~/.claude dan ~/.codex", () => {
    expect(agentSkillHome("claude", {}, "/Users/x")).toBe("/Users/x/.claude");
    expect(agentSkillHome("codex", {}, "/Users/x")).toBe("/Users/x/.codex");
  });
  it("HANOMAN_*_HOME menang (cermin HANOMAN_CLAUDE_BIN/HANOMAN_CODEX_BIN)", () => {
    expect(agentSkillHome("claude", { HANOMAN_CLAUDE_HOME: "/a" }, "/Users/x")).toBe("/a");
    expect(agentSkillHome("codex", { HANOMAN_CODEX_HOME: "/b" }, "/Users/x")).toBe("/b");
  });
  it("CODEX_HOME dihormati untuk codex, tapi kalah dari HANOMAN_CODEX_HOME", () => {
    expect(agentSkillHome("codex", { CODEX_HOME: "/c" }, "/Users/x")).toBe("/c");
    expect(agentSkillHome("codex", { CODEX_HOME: "/c", HANOMAN_CODEX_HOME: "/b" }, "/Users/x")).toBe("/b");
  });
  it("CODEX_HOME TIDAK bocor ke claude — dua akar, dua agen", () => {
    expect(agentSkillHome("claude", { CODEX_HOME: "/c" }, "/Users/x")).toBe("/Users/x/.claude");
  });
});

describe("scanAgentSkills · akar tak ada", () => {
  it("akar kosong → nol skill, bukan lemparan", () => {
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: join(root, "tak-ada") });
    expect(r.skills).toEqual([]);
    expect(r.packages).toEqual([]);
    expect(r.roots).toEqual([]);
  });
});

describe("scanAgentSkills · skill user", () => {
  it("`<home>/skills/<n>/SKILL.md` → id polos tanpa paket", () => {
    skill(join(root, "skills"), "hanoman");
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["hanoman"]);
    expect(r.skills[0]!.pkg).toBeNull();
    expect(r.packages).toEqual([]);
  });
  it("direktori tanpa SKILL.md bukan skill", () => {
    mkdirSync(join(root, "skills", "bukan-skill"), { recursive: true });
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills).toEqual([]);
  });
  it("direktori berawalan titik dilewati (mis. ~/.codex/skills/.system)", () => {
    skill(join(root, "skills", ".system"), "review-agent");
    skill(join(root, "skills"), "hanoman");
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["hanoman"]);
  });
});

describe("scanAgentSkills · plugin dari cache", () => {
  const cached = (pkg: string, mkt: string, ver: string, names: string[]) => {
    const dir = join(root, "plugins", "cache", mkt, pkg, ver, "skills");
    for (const n of names) skill(dir, n);
  };

  it("`plugins/cache/<mkt>/<pkg>/<ver>/skills/<n>` → id `<pkg>:<n>`", () => {
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming", "writing-plans"]);
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id).sort())
      .toEqual(["superpowers:brainstorming", "superpowers:writing-plans"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  // KOREKSI TERUKUR atas premis brief: codex punya akar KEDUA yang sama bentuknya. Deteksi yang
  // hanya memindai ~/.codex/skills melaporkan superpowers KURANG di mesin yang sebenarnya sehat.
  it("codex memindai cache plugin-nya juga, bukan hanya ~/.codex/skills", () => {
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("plugin yang DINYATAKAN nonaktif dilewati · claude settings.json", () => {
    cached("ponytail", "ponytail", "4.8.4", ["tail"]);
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming"]);
    writeFileSync(join(root, "settings.json"), JSON.stringify({
      enabledPlugins: { "ponytail@ponytail": false, "superpowers@superpowers-marketplace": true },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("plugin yang DINYATAKAN nonaktif dilewati · codex config.toml", () => {
    cached("ponytail", "ponytail", "4.8.4", ["tail"]);
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    writeFileSync(join(root, "config.toml"),
      `[projects."/tmp/x"]\ntrust_level = "trusted"\n\n`
      + `[plugins."ponytail@ponytail"]\nenabled = false\n\n`
      + `[plugins."superpowers@openai-curated"]\nenabled = true\n`);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("tanpa pernyataan apa pun plugin dianggap AKTIF — absen bukan penolakan", () => {
    cached("superpowers", "openai-curated", "11c74d6b", ["brainstorming"]);
    const r = scanAgentSkills("codex", { HANOMAN_CODEX_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("berkas gerbang rusak tidak mengosongkan hasil (fail-open per sumber)", () => {
    cached("superpowers", "superpowers-marketplace", "6.0.3", ["brainstorming"]);
    writeFileSync(join(root, "settings.json"), "{ bukan json");
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.packages).toEqual(["superpowers"]);
  });
});

describe("scanAgentSkills · plugin dari manifest", () => {
  it("installed_plugins.json → installPath dipindai walau di luar cache", () => {
    const dir = join(root, "elsewhere", "sp");
    skill(join(dir, "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { "superpowers@superpowers-marketplace": [{ installPath: dir, version: "6.0.3" }] },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
  });

  it("manifest & cache menunjuk skill yang sama → tak ada duplikat", () => {
    const dir = join(root, "plugins", "cache", "m", "superpowers", "1.0.0");
    skill(join(dir, "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), JSON.stringify({
      plugins: { "superpowers@m": [{ installPath: dir }] },
    }));
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
    expect(r.packages).toEqual(["superpowers"]);
  });

  it("manifest rusak diabaikan, cache tetap terbaca", () => {
    skill(join(root, "plugins", "cache", "m", "superpowers", "1.0.0", "skills"), "brainstorming");
    mkdirSync(join(root, "plugins"), { recursive: true });
    writeFileSync(join(root, "plugins", "installed_plugins.json"), "]]]");
    const r = scanAgentSkills("claude", { HANOMAN_CLAUDE_HOME: root });
    expect(r.skills.map((s) => s.id)).toEqual(["superpowers:brainstorming"]);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism runner/test/skills.test.ts
```
Expected: FAIL — `Failed to resolve import "../src/skills"`.

- [x] **Step 3: Implementasi `runner/src/skills.ts`**

```ts
// SPEC-739 · ADR-0114 — deteksi skill yang benar-benar terpasang, PER AGEN.
//
// Duduk di `runner` karena di sinilah library node-only yang dipakai server DAN cli (preseden
// `paths.ts`). `shared` tak bisa: ia ikut dibundel Vite ke browser, sementara berkas ini membaca
// filesystem.
//
// FAIL-OPEN PER SUMBER, bukan fail-open pada vonis: direktori hilang / JSON rusak / izin ditolak
// membuat SATU sumber menyumbang nol skill, tak pernah melempar dan tak pernah mengosongkan
// sumber lain. Yang tak boleh longgar adalah pencocokannya (lihat `method-status.ts`) — vonis
// optimistis palsu justru kegagalan senyap yang spec ini hapus.
import { homedir } from "node:os";
import { join } from "node:path";
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
function skillsUnder(dir: string, pkg: string | null): InstalledSkill[] {
  return dirsIn(dir)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .map((name) => ({ id: pkg ? `${pkg}:${name}` : name, name, pkg, dir: join(dir, name) }));
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
export function scanAgentSkills(agent: Agent, env: EnvLike = process.env, osHome: string = homedir()): AgentSkills {
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
    const dir = join(r.dir, "skills");
    const found = skillsUnder(dir, r.pkg);
    if (!found.length) continue;
    packages.add(r.pkg);
    add(dir, found);
  }
  return { agent, home, roots, skills, packages: [...packages] };
}
```

- [x] **Step 4: Ekspor dari barrel runner**

Di `runner/src/index.ts`, tambahkan setelah baris `export * from "./paths";`:

```ts
export * from "./skills";
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism runner/test/skills.test.ts
```
Expected: PASS, seluruh test dari Step 1 hijau (bukan "no test files").

- [x] **Step 6: Typecheck runner**

```bash
pnpm --filter ./runner typecheck
```
Expected: keluar 0, tanpa output error.

- [x] **Step 7: Commit**

```bash
git add runner/src/skills.ts runner/test/skills.test.ts runner/src/index.ts
git commit -m "feat(spec-739): deteksi skill terpasang per agen, akar ber-env"
```

---

### Task 2: Vonis murni + perintah instalasi di katalog

**Files:**
- Modify: `shared/src/method-catalog.ts`
- Create: `shared/src/method-status.ts`
- Create: `shared/src/method-status.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `METHODS`, `METHOD_IDS`, `MethodDef` dari `./method-catalog`.
- Produces:
  - `MethodDef.install: Readonly<Record<"claude"|"codex", readonly string[]>>`
  - `interface MethodSkillStatus { method: string; label: string; agent: Agent; ready: boolean; missingPackages: string[]; missingSkills: string[]; install: string[] }`
  - `interface MethodStatusResponse { agents: Array<{ agent: Agent; home: string; roots: string[]; skills: number }>; methods: MethodSkillStatus[] }`
  - `function methodSkills(m: MethodDef): string[]`
  - `function methodStatus(m: MethodDef, agent: Agent, installed: { skills: readonly string[]; packages: readonly string[] }): MethodSkillStatus`

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/method-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zAgent } from "./enums";
import { METHODS, METHOD_IDS } from "./method-catalog";
import { methodSkills, methodStatus } from "./method-status";

const ALL = { skills: [] as string[], packages: [] as string[] };

describe("methodSkills", () => {
  it("union phaseSkills ∪ exitSkills, ter-dedup", () => {
    const s = methodSkills(METHODS.superpowers!);
    expect(s).toContain("superpowers:brainstorming");
    expect(s).toContain("superpowers:verification-before-completion");
    expect(new Set(s).size).toBe(s.length);
  });
});

describe("methodStatus", () => {
  it("nol terpasang → kurang PAKET dan kurang SKILL, keduanya dilaporkan", () => {
    const st = methodStatus(METHODS.superpowers!, "codex", ALL);
    expect(st.ready).toBe(false);
    expect(st.missingPackages).toEqual(["superpowers"]);
    expect(st.missingSkills).toContain("superpowers:brainstorming");
    expect(st.agent).toBe("codex");
  });

  // Butir `requires` adalah nama PAKET; yang dipanggil prompt adalah id SKILL. Paket ada dengan
  // skill kurang itu keadaan nyata (versi lebih tua) — dua pertanyaan, dua jawaban.
  it("paket ada tapi skill kurang → tetap belum siap, hanya missingSkills terisi", () => {
    const st = methodStatus(METHODS.superpowers!, "claude", {
      packages: ["superpowers"], skills: ["superpowers:brainstorming"],
    });
    expect(st.missingPackages).toEqual([]);
    expect(st.missingSkills).toContain("superpowers:verification-before-completion");
    expect(st.ready).toBe(false);
  });

  it("seluruh paket & skill ada → siap", () => {
    const m = METHODS.superpowers!;
    const st = methodStatus(m, "claude", { packages: [...m.requires], skills: methodSkills(m) });
    expect(st).toMatchObject({ ready: true, missingPackages: [], missingSkills: [] });
  });

  // PENCOCOKAN KETAT: skill user bernama `brainstorming` beralamat `brainstorming`, bukan
  // `superpowers:brainstorming` — prompt yang memanggil id berprefiks tetap akan gagal.
  it("skill polos tak memuaskan id berprefiks paket", () => {
    const st = methodStatus(METHODS.superpowers!, "codex", {
      packages: ["superpowers"], skills: ["brainstorming", "writing-plans"],
    });
    expect(st.missingSkills).toContain("superpowers:brainstorming");
  });

  it("install datang dari katalog metode itu, per agen", () => {
    expect(methodStatus(METHODS.superpowers!, "claude", ALL).install)
      .toEqual([...METHODS.superpowers!.install.claude]);
    expect(methodStatus(METHODS.superpowers!, "codex", ALL).install)
      .toEqual([...METHODS.superpowers!.install.codex]);
  });
});

// Invarian SUMBER (pola SPEC-490/AC-7 ADR-0113): ditegakkan di katalog, bukan di render — nol
// test UI bisa menangkap entri metode ketiga yang lupa membawa perintah pemasangannya.
describe("katalog · MethodDef.install", () => {
  it("setiap metode punya perintah untuk SETIAP agen, non-kosong", () => {
    for (const id of METHOD_IDS) {
      const m = METHODS[id]!;
      expect(Object.keys(m.install).sort()).toEqual([...zAgent.options].sort());
      for (const a of zAgent.options) {
        expect(m.install[a].length).toBeGreaterThan(0);
        for (const cmd of m.install[a]) expect(cmd.trim()).not.toBe("");
      }
    }
  });

  it("perintahnya menyebut sedikitnya satu paket yang ada di `requires`", () => {
    for (const id of METHOD_IDS) {
      const m = METHODS[id]!;
      for (const a of zAgent.options) {
        const joined = m.install[a].join(" ");
        expect(m.requires.some((r) => joined.includes(r))).toBe(true);
      }
    }
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/method-status.test.ts
```
Expected: FAIL — `Failed to resolve import "./method-status"`.

- [x] **Step 3: Tambahkan `install` ke katalog**

Di `shared/src/method-catalog.ts`, tambahkan tepat sebelum `export interface MethodDef`:

```ts
// Cermin SEMPIT `Agent` (shared/entities.ts). Disalin, bukan diimpor: `entities.ts` mengimpor
// DEFAULT_METHOD dari berkas ini, jadi impor balik menutup lingkaran — dan berkas ini sengaja
// bebas dependensi. Cerminnya tak bisa hanyut: `method-status.test.ts` mengadu kunci `install`
// dengan `zAgent.options`.
type MethodAgent = "claude" | "codex";
```

Di dalam `interface MethodDef`, tambahkan setelah field `requires`:

```ts
  /**
   * Perintah pemasangan per agen, dijalankan di SESI TERMINAL (ADR-0056) — server tak pernah
   * menjalankannya sendiri (ADR-0087/0088). Ia hidup di sini bersama `requires` supaya metode
   * ketiga tak menuntut sunting di server/web (AC-10 ADR-0113).
   */
  readonly install: Readonly<Record<MethodAgent, readonly string[]>>;
```

Di entri `superpowers`, setelah `requires: ["superpowers"],`:

```ts
    install: {
      claude: [
        "claude plugin marketplace add obra/superpowers-marketplace",
        "claude plugin install superpowers@superpowers-marketplace",
      ],
      codex: ["codex plugin add superpowers@openai-curated"],
    },
```

Di entri `matt`, setelah `requires: ["mattpocock-skills", "superpowers"],`:

```ts
    // `mattpocock-skills` ada di marketplace resmi Claude Code → tanpa `marketplace add`.
    // superpowers ikut dipasang karena `requires` menyebutnya: gerbang verifikasinya dipinjam
    // dari sana (INVARIAN 2). codex belum punya plugin native mattpocock — jalur resminya
    // `npx skills`, dan ia interaktif; itu justru alasan pemasangan hidup di pane yang ditonton.
    install: {
      claude: [
        "claude plugin install mattpocock-skills",
        "claude plugin marketplace add obra/superpowers-marketplace",
        "claude plugin install superpowers@superpowers-marketplace",
      ],
      codex: [
        "npx skills@latest add mattpocock/skills",
        "codex plugin add superpowers@openai-curated",
      ],
    },
```

- [x] **Step 4: Implementasi `shared/src/method-status.ts`**

```ts
// SPEC-739 · ADR-0114 — vonis kesiapan metode: katalog ↔ hasil deteksi.
//
// MURNI dan di `shared` karena bentuk yang sama dipakai server (endpoint) DAN web (checklist
// Settings, catatan picker Start). Berkas ini tak menyentuh filesystem sama sekali — yang
// memindai disk adalah `runner/src/skills.ts`.
import type { Agent } from "./entities";
import type { MethodDef } from "./method-catalog";

export interface MethodSkillStatus {
  readonly method: string;
  readonly label: string;
  readonly agent: Agent;
  readonly ready: boolean;
  /** Dari `MethodDef.requires` — nama PAKET. */
  readonly missingPackages: string[];
  /** Dari `phaseSkills` ∪ `exitSkills` — id SKILL yang benar-benar dipanggil prompt. */
  readonly missingSkills: string[];
  readonly install: string[];
}

export interface MethodStatusResponse {
  readonly agents: Array<{ agent: Agent; home: string; roots: string[]; skills: number }>;
  readonly methods: MethodSkillStatus[];
}

/** Skill konkret yang dipanggil prompt metode ini. */
export function methodSkills(m: MethodDef): string[] {
  return [...new Set([...Object.values(m.phaseSkills).flat(), ...m.exitSkills])];
}

/**
 * PENCOCOKAN KETAT & id persis. "Fail-open" spec ini adalah sifat GERBANG (Start tak pernah
 * ditolak), bukan sifat vonis: menganggap sesuatu terpasang tanpa bukti adalah persis kegagalan
 * senyap yang SPEC-739 ada untuk menghapus.
 */
export function methodStatus(
  m: MethodDef, agent: Agent,
  installed: { skills: readonly string[]; packages: readonly string[] },
): MethodSkillStatus {
  const haveSkills = new Set(installed.skills);
  const havePackages = new Set(installed.packages);
  const missingPackages = m.requires.filter((p) => !havePackages.has(p));
  const missingSkills = methodSkills(m).filter((id) => !haveSkills.has(id));
  return {
    method: m.id, label: m.label, agent,
    ready: missingPackages.length === 0 && missingSkills.length === 0,
    missingPackages, missingSkills,
    install: [...m.install[agent]],
  };
}
```

- [x] **Step 5: Ekspor dari barrel shared**

Di `shared/src/index.ts`, tambahkan tepat setelah `export * from "./method-catalog";`:

```ts
export * from "./method-status";
```

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/method-status.test.ts shared/src/method-catalog.test.ts
```
Expected: PASS untuk kedua berkas.

- [x] **Step 7: Typecheck shared**

```bash
pnpm --filter ./shared typecheck
```
Expected: keluar 0.

- [x] **Step 8: Commit**

```bash
git add shared/src/method-catalog.ts shared/src/method-status.ts shared/src/method-status.test.ts shared/src/index.ts
git commit -m "feat(spec-739): vonis kesiapan metode + perintah instalasi sebagai data katalog"
```

---

### Task 3: Endpoint `GET /api/methods/status`

**Files:**
- Create: `server/src/services/method-status.ts`
- Create: `server/src/routes/methods.ts`
- Modify: `server/src/app.ts`
- Modify: `shared/src/api.ts`
- Create: `server/test/method-status.route.test.ts`

**Interfaces:**
- Consumes: `scanAgentSkills` (Task 1), `methodStatus`/`MethodStatusResponse` (Task 2).
- Produces:
  - `function methodStatusReport(env?: NodeJS.ProcessEnv): MethodStatusResponse`
  - Path `paths.methodStatus` = `/api/methods/status`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/method-status.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { METHODS, methodSkills } from "@hanoman/shared";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let claudeHome: string;
let codexHome: string;

const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
};

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); });

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "hn-claude-"));
  codexHome = mkdtempSync(join(tmpdir(), "hn-codex-"));
  process.env.HANOMAN_CLAUDE_HOME = claudeHome;
  process.env.HANOMAN_CODEX_HOME = codexHome;
});
afterEach(() => {
  delete process.env.HANOMAN_CLAUDE_HOME;
  delete process.env.HANOMAN_CODEX_HOME;
  rmSync(claudeHome, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

const get = () => app.inject({ method: "GET", url: "/api/methods/status" });

describe("GET /api/methods/status (SPEC-739)", () => {
  it("melaporkan setiap metode untuk KEDUA agen", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const pairs = body.methods.map((m: any) => `${m.method}/${m.agent}`);
    for (const id of Object.keys(METHODS)) {
      expect(pairs).toContain(`${id}/claude`);
      expect(pairs).toContain(`${id}/codex`);
    }
    expect(body.agents.map((a: any) => a.agent).sort()).toEqual(["claude", "codex"]);
  });

  it("akar kosong → semua metode belum siap, dengan sebab spesifik", async () => {
    const body = (await get()).json();
    const sp = body.methods.find((m: any) => m.method === "superpowers" && m.agent === "claude");
    expect(sp.ready).toBe(false);
    expect(sp.missingPackages).toContain("superpowers");
    expect(sp.missingSkills.length).toBeGreaterThan(0);
    expect(sp.install.length).toBeGreaterThan(0);
  });

  // Gejala paling mahal spec ini: mengira "terpasang" satu bit global. Status wajib per-agen.
  it("siap untuk claude, kosong untuk codex — di mesin yang sama", async () => {
    const dir = join(claudeHome, "plugins", "cache", "mkt", "superpowers", "6.0.3", "skills");
    for (const s of methodSkills(METHODS.superpowers!)) skill(dir, s.split(":")[1]!);
    const body = (await get()).json();
    const claude = body.methods.find((m: any) => m.method === "superpowers" && m.agent === "claude");
    const codex = body.methods.find((m: any) => m.method === "superpowers" && m.agent === "codex");
    expect(claude.ready).toBe(true);
    expect(codex.ready).toBe(false);
    expect(codex.missingPackages).toContain("superpowers");
  });

  // Diturunkan LIVE tiap request: kolom status akan basi persis saat ia paling menyesatkan —
  // sesudah operator memasang skill-nya.
  it("status berubah tanpa restart begitu skill muncul di disk", async () => {
    const before = (await get()).json().methods
      .find((m: any) => m.method === "superpowers" && m.agent === "codex");
    expect(before.ready).toBe(false);
    const dir = join(codexHome, "plugins", "cache", "mkt", "superpowers", "1.0.0", "skills");
    for (const s of methodSkills(METHODS.superpowers!)) skill(dir, s.split(":")[1]!);
    const after = (await get()).json().methods
      .find((m: any) => m.method === "superpowers" && m.agent === "codex");
    expect(after.ready).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/method-status.route.test.ts
```
Expected: FAIL — respons 404 pada `/api/methods/status`.

- [x] **Step 3: Implementasi service**

Buat `server/src/services/method-status.ts`:

```ts
// SPEC-739 · ADR-0114 — laporan kesiapan metode, DITURUNKAN dari disk tiap kali diminta.
// Tanpa tabel, tanpa kolom, tanpa cache: status instalasi akan basi persis pada saat ia paling
// menyesatkan — sesudah operator memasang skill yang kurang (cermin coverage docs ADR-0011/0018).
import { zAgent, METHODS, METHOD_IDS, methodStatus, type MethodStatusResponse, type MethodDef, type Agent }
  from "@hanoman/shared";
import { scanAgentSkills } from "@hanoman/runner";
import { shellBin } from "./pty";

export function methodStatusReport(env: NodeJS.ProcessEnv = process.env): MethodStatusResponse {
  const scans = zAgent.options.map((a) => scanAgentSkills(a, env));
  return {
    agents: scans.map((s) => ({ agent: s.agent, home: s.home, roots: s.roots, skills: s.skills.length })),
    methods: scans.flatMap((s) => {
      const installed = { skills: s.skills.map((k) => k.id), packages: s.packages };
      return METHOD_IDS.map((id) => methodStatus(METHODS[id]!, s.agent, installed));
    }),
  };
}

/**
 * Argv shell yang MENJALANKAN perintah pemasangan lalu menyerahkan pane ke operator. `exec` di
 * ujung disengaja: pemasangan yang gagal harus meninggalkan shell hidup di tempat kejadian, bukan
 * pane mati yang harus dilahirkan ulang untuk dibaca. Server tak menjalankan apa pun dari sini —
 * ia hanya menyusun argv untuk pane tmux (ADR-0056; ADR-0037 & ADR-0087/0088 utuh).
 */
export function installCommand(m: MethodDef, agent: Agent, shell = shellBin()): string[] {
  return [shell, "-lc", `${m.install[agent].join(" && ")}; exec '${shell}' -l`];
}
```

- [x] **Step 4: Implementasi route**

Buat `server/src/routes/methods.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { methodStatusReport } from "../services/method-status";

// GET /api/methods/status (SPEC-739 · ADR-0114) — metode mana yang benar-benar siap dipakai di
// MESIN ini, per agen. Murni observabilitas: metode yang belum siap ditandai, tak pernah
// memblokir kelahiran sesi (ADR-0037, cermin `GET /codex/version` SPEC-339).
//
// `capabilityForRoute` tak mengenal prefix `methods` → cookie-only. Disengaja: ini properti mesin
// yang dibaca dashboard, bukan permukaan kerja agen.
export default async function methods(app: FastifyInstance) {
  app.get("/methods/status", async () => methodStatusReport());
}
```

- [x] **Step 5: Daftarkan route**

Di `server/src/app.ts`, tambahkan impor di dekat `import codex from "./routes/codex";`:

```ts
import methods from "./routes/methods";
```

dan registrasi tepat setelah baris `await api.register(limits);`:

```ts
    await api.register(methods);   // SPEC-739 · ADR-0114 · kesiapan skill metode
```

(Jika `codex` sudah terdaftar di dekat situ, letakkan `methods` bersebelahan dengannya.)

- [x] **Step 6: Tambahkan path API bersama**

Di `shared/src/api.ts`, tepat setelah baris `codexVersion: …`:

```ts
  methodStatus: `${API}/methods/status`,   // SPEC-739 · ADR-0114 · kesiapan skill metode per agen
```

- [x] **Step 7: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/method-status.route.test.ts
```
Expected: PASS, 4 test.

- [x] **Step 8: Commit**

```bash
git add server/src/services/method-status.ts server/src/routes/methods.ts server/src/app.ts shared/src/api.ts server/test/method-status.route.test.ts
git commit -m "feat(spec-739): GET /methods/status — kesiapan metode per agen, diturunkan live"
```

---

### Task 4: Pemasangan lewat sesi terminal

**Files:**
- Modify: `shared/src/dto.ts:371`
- Modify: `server/src/routes/terminal.ts:120-126`
- Modify: `src/src/api/client.ts:276`
- Modify: `server/test/method-status.route.test.ts` (tambah blok describe)

**Interfaces:**
- Consumes: `installCommand` (Task 3), `METHODS` (Task 2).
- Produces: `POST /api/terminal/sessions` menerima `{ project, shell: true, install?: { method, agent } }`; klien `api.createShell(project, install?)`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/method-status.route.test.ts`:

```ts
import { listSessions, killSession } from "../src/services/pty";

// SPEC-739 · ADR-0114 · pemasangan lewat SESI TERMINAL (ADR-0056). Server tak pernah memasang
// apa pun sendiri — yang menjalankan perintah adalah shell di dalam pane, ditonton operator.
describe("POST /terminal/sessions · install metode (SPEC-739)", () => {
  const post = (payload: unknown) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload });

  it("shell tanpa `install` tetap shell mentah (perilaku SPEC-236 utuh)", async () => {
    const res = await post({ project: "p1", shell: true });
    expect(res.statusCode).toBe(201);
    killSession(res.json().id);
  });

  it("`install` melahirkan pane yang menjalankan perintah katalog", async () => {
    const res = await post({ project: "p1", shell: true, install: { method: "superpowers", agent: "codex" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const s = listSessions().find((x) => x.id === id)!;
    expect(s.flow).toBeUndefined();
    killSession(id);
  });

  // Sengaja TIDAK lenient seperti `resolveMethod`: resolusi longgar benar untuk MEMBACA, tapi ini
  // TINDAKAN — memasang default karena metodenya tak dikenal berarti menjalankan perintah yang
  // tak diminta siapa pun.
  it("metode tak dikenal → 400, bukan jatuh ke default", async () => {
    const res = await post({ project: "p1", shell: true, install: { method: "tak-ada", agent: "claude" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("tak-ada");
  });
});
```

Tambahkan juga test murni untuk `installCommand` di berkas yang sama:

```ts
import { installCommand } from "../src/services/method-status";

describe("installCommand (SPEC-739)", () => {
  it("merangkai perintah katalog dan menyerahkan pane ke operator", () => {
    const argv = installCommand(METHODS.superpowers!, "codex", "/bin/zsh");
    expect(argv[0]).toBe("/bin/zsh");
    expect(argv[1]).toBe("-lc");
    expect(argv[2]).toContain("codex plugin add superpowers@openai-curated");
    expect(argv[2]).toContain("exec '/bin/zsh' -l");
  });
  it("perintah jamak dirangkai `&&` — langkah kedua tak jalan bila yang pertama gagal", () => {
    const argv = installCommand(METHODS.superpowers!, "claude", "/bin/zsh");
    expect(argv[2]).toContain(" && ");
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/method-status.route.test.ts
```
Expected: FAIL — `installCommand` belum diekspor / payload `install` diabaikan, dan metode tak dikenal menjawab 201.

- [x] **Step 3: Perluas DTO**

Di `shared/src/dto.ts`, ganti varian shell (baris ~371):

```ts
  z.object({ project: z.string(), shell: z.literal(true) }),
```

menjadi:

```ts
  // SPEC-739 · ADR-0114 · pemasangan skill metode: klien mengirim METODE + AGEN, bukan teks
  // perintah — perintahnya diturunkan server dari katalog `METHODS`. Dengan begitu "perintah
  // instalasi adalah data katalog" berlaku ujung ke ujung, dan endpoint ini tak pernah menjadi
  // "jalankan shell arbitrer". Tanpa field ini, shell mentah persis seperti SPEC-236.
  z.object({ project: z.string(), shell: z.literal(true),
    install: z.object({ method: z.string(), agent: zAgent }).optional() }),
```

- [x] **Step 4: Cabang install di route**

Di `server/src/routes/terminal.ts`, ganti isi blok `if ("shell" in parsed.data) { … }` (baris ~120-126) menjadi:

```ts
    if ("shell" in parsed.data) {
      const repoDir = await resolveRepoDir(project.id);
      if (!repoDir) return reply.code(400)
        .send({ error: `project "${project.id}" belum di-bind ke checkout lokal`, needsBind: true });
      // SPEC-739 · ADR-0114 · pemasangan skill metode. Yang menjalankan perintah adalah SHELL di
      // dalam pane, bukan server: ADR-0087 menolak "server memasang dirinya sendiri" dan ADR-0088
      // memindahkan pemasangan ke CLI supervisor justru karena itu. Pemasang bukan-server berarti
      // nol executor baru — ADR-0037 utuh.
      const inst = parsed.data.install;
      if (inst) {
        // Sengaja bukan `resolveMethod` yang lenient: resolusi longgar benar untuk MEMBACA (id
        // dari hub jatuh diam ke default), tapi ini tindakan.
        const m = METHODS[inst.method];
        if (!m) return reply.code(400).send({ error: `metode "${inst.method}" tak dikenal` });
        const s = createSession(project.id, repoDir, { command: installCommand(m, inst.agent) });
        return reply.code(201).send({ id: s.id });
      }
      const s = createSession(project.id, repoDir, { command: [shellBin()] });
      return reply.code(201).send({ id: s.id });
    }
```

Tambahkan impor di bagian atas berkas yang sama:

```ts
import { METHODS } from "@hanoman/shared";
import { installCommand } from "../services/method-status";
```

(Bila `@hanoman/shared` sudah diimpor di berkas itu, cukup tambahkan `METHODS` ke daftar impor yang ada.)

- [x] **Step 5: Klien API**

Di `src/src/api/client.ts`, ganti baris `createShell` (~276):

```ts
  // SPEC-236 · terminal biasa non-claude: shell mentah di repoDir project (tanpa flow).
  // SPEC-739 · ADR-0114 · `install` opsional membuat pane menjalankan perintah pemasangan metode;
  // tanpa argumen itu, body-nya byte-identik dengan sebelum SPEC-739.
  createShell: (project: string, install?: { method: string; agent: Agent }) =>
    j<{ id: string }>(paths.terminalSessions, {
      method: "POST", ...body({ project, shell: true, ...(install ? { install } : {}) }),
    }),
```

- [x] **Step 6: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/method-status.route.test.ts server/test/terminal.route.test.ts
```
Expected: PASS — termasuk test shell SPEC-236 lama yang tak boleh berubah.

- [x] **Step 7: Typecheck server**

```bash
pnpm --filter ./server typecheck
```
Expected: keluar 0.

- [x] **Step 8: Commit**

```bash
git add shared/src/dto.ts server/src/routes/terminal.ts src/src/api/client.ts server/test/method-status.route.test.ts
git commit -m "feat(spec-739): pasang skill metode lewat sesi terminal, perintah dari katalog"
```

---

### Task 5: Checklist di Settings (tab Sesi)

**Files:**
- Modify: `src/src/api/client.ts` (tambah `getMethodStatus`)
- Modify: `src/src/screens/SettingsScreen.tsx:1209-1228`
- Create: `src/test/method-status-ui.test.tsx`

**Interfaces:**
- Consumes: `paths.methodStatus`, `MethodStatusResponse`, `MethodSkillStatus` (Task 2/3); `api.createShell(project, install)` (Task 4).
- Produces: kartu "Metode workflow — sesi backlog" ber-`data-testid="method-status"`; setiap baris ber-`data-testid="method-status-<method>-<agent>"`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/method-status-ui.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { METHODS, methodSkills } from "@hanoman/shared";

vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), startSession: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
    getMethodStatus: vi.fn(), listProjects: vi.fn(), createShell: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const settings = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  verifyScope: "changed", method: "superpowers", agent: "claude",
  codex: { model: "gpt-5.6-sol", effort: "xhigh" },
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
};

const status = (over: Partial<Record<string, unknown>> = {}) => ({
  agents: [
    { agent: "claude", home: "/h/.claude", roots: ["/h/.claude/skills"], skills: 14 },
    { agent: "codex", home: "/h/.codex", roots: [], skills: 0 },
  ],
  methods: [
    { method: "superpowers", label: "superpowers", agent: "claude", ready: true,
      missingPackages: [], missingSkills: [], install: ["claude plugin install superpowers@superpowers-marketplace"] },
    { method: "superpowers", label: "superpowers", agent: "codex", ready: false,
      missingPackages: ["superpowers"], missingSkills: methodSkills(METHODS.superpowers!),
      install: ["codex plugin add superpowers@openai-curated"] },
    { method: "matt", label: "mattpocock", agent: "claude", ready: false,
      missingPackages: ["mattpocock-skills"], missingSkills: ["mattpocock-skills:grilling"],
      install: ["claude plugin install mattpocock-skills"] },
    { method: "matt", label: "mattpocock", agent: "codex", ready: false,
      missingPackages: ["mattpocock-skills", "superpowers"], missingSkills: ["mattpocock-skills:grilling"],
      install: ["npx skills@latest add mattpocock/skills"] },
  ],
  ...over,
});

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };
const openSesi = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Sesi" }));
};

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings as any);
  vi.mocked(api.putSettings).mockResolvedValue(settings as any);
  vi.mocked(api.getMethodStatus).mockResolvedValue(status() as any);
  vi.mocked(api.listProjects).mockResolvedValue({ items: [{ id: "hanoman", binding: "/repo" }], total: 1, page: 1, pageSize: 20 } as any);
  vi.mocked(api.createShell).mockResolvedValue({ id: "sh1" } as any);
});

describe("SettingsScreen · checklist kesiapan metode (SPEC-739)", () => {
  it("menampilkan satu baris per metode × agen", async () => {
    openSesi();
    await waitFor(() => expect(screen.getByTestId("method-status-superpowers-claude")).toBeInTheDocument());
    for (const id of ["superpowers", "matt"])
      for (const a of ["claude", "codex"])
        expect(screen.getByTestId(`method-status-${id}-${a}`)).toBeInTheDocument();
  });

  // Peringatan WAJIB menyebut agen: superpowers bisa siap untuk claude dan kosong untuk codex
  // di mesin yang sama.
  it("baris menyebut AGEN-nya, dan siap/belum siap berbeda per agen", async () => {
    openSesi();
    const ok = await screen.findByTestId("method-status-superpowers-claude");
    const bad = screen.getByTestId("method-status-superpowers-codex");
    expect(ok).toHaveTextContent("Claude Code");
    expect(ok).toHaveTextContent("siap");
    expect(bad).toHaveTextContent("Codex CLI");
    expect(bad).toHaveTextContent("belum siap");
  });

  it("sebabnya spesifik: paket kurang DAN id skill kurang", async () => {
    openSesi();
    const bad = await screen.findByTestId("method-status-superpowers-codex");
    expect(bad).toHaveTextContent("superpowers");
    expect(bad).toHaveTextContent("superpowers:verification-before-completion");
  });

  it("tombol Pasang melahirkan sesi terminal dengan metode & agen barisnya", async () => {
    openSesi();
    const bad = await screen.findByTestId("method-status-superpowers-codex");
    fireEvent.click(within(bad).getByRole("button", { name: /pasang/i }));
    await waitFor(() => expect(api.createShell).toHaveBeenCalledWith(
      "hanoman", { method: "superpowers", agent: "codex" }));
  });

  it("baris yang sudah siap tak menawarkan tombol Pasang", async () => {
    openSesi();
    const ok = await screen.findByTestId("method-status-superpowers-claude");
    expect(within(ok).queryByRole("button", { name: /pasang/i })).toBeNull();
  });

  // Endpoint gagal tak boleh mematikan kartu — ini observabilitas, bukan gerbang.
  it("status gagal dimuat → kartu tetap render tanpa checklist", async () => {
    vi.mocked(api.getMethodStatus).mockRejectedValue(new Error("boom"));
    openSesi();
    await waitFor(() => expect(screen.getByLabelText("Metode default")).toBeInTheDocument());
    expect(screen.queryByTestId("method-status-superpowers-claude")).toBeNull();
  });
});
```

Tambahkan `within` ke impor `@testing-library/react` di baris pertama:

```tsx
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/method-status-ui.test.tsx
```
Expected: FAIL — `getMethodStatus is not a function` / testid tak ditemukan.

- [x] **Step 3: Tambahkan klien API**

Di `src/src/api/client.ts`, tepat setelah `getCodexVersion` (~172):

```ts
  // SPEC-739 · ADR-0114 · kesiapan skill metode per agen. LOCAL-only, diturunkan live dari disk.
  getMethodStatus: () => j<MethodStatusResponse>(paths.methodStatus),
```

Tambahkan `MethodStatusResponse` ke impor `type` dari `@hanoman/shared` di berkas itu, dan pastikan `Agent` sudah ada di sana (dipakai `createShell` Task 4).

- [x] **Step 4: Render checklist di SettingsScreen**

Di `src/src/screens/SettingsScreen.tsx`, tambahkan state & fetch di dekat `codexVer` (~508):

```tsx
  // SPEC-739 · ADR-0114 · kesiapan skill metode per agen. Gagal-diam seperti codexVer: kartu
  // Metode harus tetap bisa dipakai walau endpoint statusnya error.
  const [methodStatuses, setMethodStatuses] = React.useState<MethodStatusResponse | null>(null);
  const [installProject, setInstallProject] = React.useState<string>("");
  const loadMethodStatus = React.useCallback(() => {
    api.getMethodStatus().then(setMethodStatuses).catch(() => setMethodStatuses(null));
  }, []);
  React.useEffect(() => {
    if (tab !== "sesi") return;
    loadMethodStatus();
    // Pemasangan butuh project yang ter-bind ke checkout lokal — pane lahir di repoDir-nya.
    api.listProjects({ pageSize: 100 })
      .then((r) => setInstallProject((p) => p || (r.items.find((x) => x.binding || x.repoDir)?.id ?? "")))
      .catch(() => {});
  }, [tab, loadMethodStatus]);
```

Tambahkan impor tipe `MethodStatusResponse` (dan `MethodSkillStatus`) pada baris `import type { … } from "@hanoman/shared";` di atas berkas.

Ganti blok akhir kartu Metode (baris ~1224-1227, `settings-method-requires`) dengan:

```tsx
        {/* SPEC-739 · ADR-0114 · checklist kesiapan: metode × agen, diturunkan live dari disk.
            Metode yang belum siap DITANDAI, tak pernah diblokir — sesi tetap boleh lahir
            (ADR-0037). Peringatannya wajib menyebut agen: superpowers bisa siap untuk claude dan
            kosong untuk codex di mesin yang sama. */}
        {methodStatuses && (
          <div data-testid="method-status" style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {METHOD_IDS.map((id) => (
              <div key={id} style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{METHODS[id]!.label}</div>
                {methodStatuses.methods.filter((m) => m.method === id).map((m) => (
                  <div key={m.agent} data-testid={`method-status-${m.method}-${m.agent}`}
                    style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                    <Badge tone={m.ready ? "ok" : "warn"}>{m.ready ? "siap" : "belum siap"}</Badge>
                    <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                      <b>{AGENT_LABEL[m.agent]}</b>
                      {!m.ready && (
                        <div style={{ color: "var(--text-muted)" }}>
                          {m.missingPackages.length > 0 && <>paket kurang: <code>{m.missingPackages.join(" · ")}</code><br /></>}
                          {m.missingSkills.length > 0 && <>skill kurang: <code>{m.missingSkills.join(" · ")}</code></>}
                        </div>
                      )}
                    </div>
                    {!m.ready && (
                      <Button size="sm" variant="ghost" leftIcon="download" disabled={!installProject}
                        onClick={() => installMethod(m)}>Pasang</Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {!installProject && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Pemasangan butuh satu project yang sudah di-bind ke checkout lokal — perintahnya
                dijalankan di sesi terminal project itu.
              </div>
            )}
          </div>
        )}
```

Di dalam `prefs()` (sebelum `if (tab === "telegram")`), tambahkan handler:

```tsx
    // SPEC-739 · ADR-0114 · pemasangan lewat SESI TERMINAL. Server tak memasang apa pun; yang
    // dikirim hanya metode + agen, dan perintahnya diturunkan server dari katalog.
    const installMethod = async (m: MethodSkillStatus) => {
      if (!installProject) return;
      try {
        await api.createShell(installProject, { method: m.method, agent: m.agent });
        onToast?.(`Pemasangan ${m.label} · ${AGENT_LABEL[m.agent]} berjalan di Terminal`, "ok", "terminal");
      } catch { onToast?.("Gagal membuka sesi terminal pemasangan", "err", "alert-triangle"); }
    };
```

Tambahkan konstanta di dekat `S_MODELS` (atas berkas):

```tsx
// SPEC-739 · label agen dipakai di checklist metode; nama agen wajib terbaca manusia di setiap
// peringatan, bukan hanya id `claude`/`codex`.
const AGENT_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex CLI" };
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/method-status-ui.test.tsx src/test/method-picker.test.tsx
```
Expected: PASS — termasuk `method-picker.test.tsx` lama; **hapus** assert `settings-method-requires` di sana bila ia gagal karena baris statisnya diganti (baris itu memang digantikan checklist).

- [x] **Step 6: Commit**

```bash
git add src/src/api/client.ts src/src/screens/SettingsScreen.tsx src/test/method-status-ui.test.tsx src/test/method-picker.test.tsx
git commit -m "feat(spec-739): checklist kesiapan metode per agen + tombol Pasang di Settings"
```

---

### Task 6: Catatan status di picker Start

**Files:**
- Modify: `src/src/App.tsx:83-113, 239-251`
- Modify: `src/test/method-status-ui.test.tsx` (tambah blok describe)

**Interfaces:**
- Consumes: `api.getMethodStatus()` (Task 5), state `method` & `agent` yang sudah ada di `StartSessionModal`.
- Produces: `data-testid="method-status-note"` (belum siap) dan `data-testid="method-requires"` (tetap ada, kini menyebut agen).

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/method-status-ui.test.tsx`:

```tsx
import { StartSessionModal } from "../src/App";

const spec: any = { id: "SPEC-739", source: "brief", title: "t", stage: "planned" };

describe("StartSessionModal · catatan kesiapan metode (SPEC-739)", () => {
  it("metode siap untuk agen terpilih → tanpa peringatan", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("superpowers"));
    expect(screen.queryByTestId("method-status-note")).toBeNull();
  });

  it("berpindah ke agen yang belum siap memunculkan peringatan yang MENYEBUT agennya", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("superpowers"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    const note = await screen.findByTestId("method-status-note");
    expect(note).toHaveTextContent("Codex CLI");
    expect(note).toHaveTextContent("superpowers");
  });

  // Metode belum siap TIDAK memblokir Start — cermin catatan versi codex SPEC-339.
  it("peringatan tidak menonaktifkan tombol Mulai", async () => {
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("superpowers"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await screen.findByTestId("method-status-note");
    expect(screen.getByRole("button", { name: "Mulai" })).not.toBeDisabled();
  });

  it("status gagal dimuat → tak ada peringatan, modal tetap utuh", async () => {
    vi.mocked(api.getMethodStatus).mockRejectedValue(new Error("boom"));
    render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Metode")).toHaveValue("superpowers"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    expect(screen.queryByTestId("method-status-note")).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/method-status-ui.test.tsx
```
Expected: FAIL pada blok `StartSessionModal` — `method-status-note` tak pernah muncul.

- [x] **Step 3: Ambil status di modal**

Di `src/src/App.tsx`, setelah state `codexVer` (~88):

```tsx
  // SPEC-739 · ADR-0114 · kesiapan skill metode di mesin ini. Gagal-diam: modal harus tetap bisa
  // dipakai, dan ketiadaan bukti bukan bukti ketiadaan (cermin catatan versi codex SPEC-339).
  const [methodStatuses, setMethodStatuses] = React.useState<MethodSkillStatus[] | null>(null);
```

Di dalam `React.useEffect` yang sudah ada (setelah `api.getCodexVersion()…`):

```tsx
    api.getMethodStatus().then((r) => setMethodStatuses(r.methods)).catch(() => setMethodStatuses(null));
```

Sebelum `return (` (dekat `const blockers = …`):

```tsx
  // SPEC-739 · status untuk pasangan (metode, agen) yang SEDANG dipilih — dua-duanya, karena
  // superpowers bisa siap untuk claude dan kosong untuk codex di mesin yang sama.
  const methodStat = methodStatuses?.find((m) => m.method === method && m.agent === agent) ?? null;
```

Tambahkan `MethodSkillStatus` ke impor tipe dari `@hanoman/shared` di atas berkas.

- [x] **Step 4: Render catatan**

Di `src/src/App.tsx`, ganti blok `data-testid="method-requires"` (baris ~247-250) dengan:

```tsx
        {/* SPEC-739 · ADR-0114 · menggantikan baris statis "Butuh terpasang: …". Metode yang
            belum siap DITANDAI, tak pernah memblokir Mulai — skill yang hilang tak mematikan
            sesi, tapi gerbangnya ikut hilang, dan itulah yang perlu operator tahu. */}
        <div data-testid="method-requires"
          style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
          Butuh terpasang: {METHODS[method]?.requires.join(" · ") ?? "—"}
        </div>
        {methodStat && !methodStat.ready && (
          <div data-testid="method-status-note" style={{
            fontSize: 12, lineHeight: 1.5, marginTop: 8, padding: "8px 10px",
            borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
          }}>
            <b>{methodStat.label}</b> belum siap untuk <b>{agent === "codex" ? "Codex CLI" : "Claude Code"}</b> di
            mesin ini
            {methodStat.missingPackages.length > 0 && <> · paket kurang: <code>{methodStat.missingPackages.join(" · ")}</code></>}
            {methodStat.missingSkills.length > 0 && <> · skill kurang: <code>{methodStat.missingSkills.join(" · ")}</code></>}.
            Sesi tetap boleh dijalankan — skill yang hilang tak mematikan sesi, tapi gerbang yang
            disebut prompt tak akan ada. Pasang dari Settings → Sesi.
          </div>
        )}
```

- [x] **Step 5: Jalankan test, pastikan LULUS**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/method-status-ui.test.tsx src/test/method-picker.test.tsx src/test/start-session-model.test.tsx
```
Expected: PASS di ketiganya.

- [x] **Step 6: Typecheck web**

```bash
pnpm --filter ./src typecheck
```
Expected: keluar 0. (Bila nama paket web bukan `./src`, pakai nama dari `package.json` di direktori itu.)

- [x] **Step 7: Commit**

```bash
git add src/src/App.tsx src/test/method-status-ui.test.tsx
git commit -m "feat(spec-739): catatan kesiapan metode × agen di picker Start"
```

---

### Task 7: `hanoman doctor` melaporkan metode default

**Files:**
- Modify: `cli/src/commands/doctor.ts`
- Modify: `cli/test/doctor.test.ts`

**Interfaces:**
- Consumes: `methodStatus`, `METHODS`, `DEFAULT_METHOD` (Task 2); `scanAgentSkills` (Task 1).
- Produces: `Probes.methods: MethodSkillStatus[]` (hanya metode default, hanya agen yang CLI-nya ada).

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `cli/test/doctor.test.ts`:

```ts
import { METHODS, methodSkills, methodStatus, DEFAULT_METHOD } from "@hanoman/shared";

// Bantu: probe minimal yang sehat, supaya kasus di bawah hanya menguji baris metode.
const base = {
  node: "v22.0.0", git: "git 2.4", tmux: "tmux 3.4", claude: "2.1.0", codex: "0.145.0",
  gh: null, homeWritable: true, web: true, db: "/tmp/x.db",
};

describe("doctorReport · metode default (SPEC-739)", () => {
  it("metode default tak siap → tanda `!` NON-FATAL + perintah pemasangannya", () => {
    const st = methodStatus(METHODS[DEFAULT_METHOD]!, "codex", { skills: [], packages: [] });
    const r = doctorReport({ ...base, methods: [st] });
    const text = r.lines.join("\n");
    expect(text).toContain("!");
    expect(text).toContain(DEFAULT_METHOD);
    expect(text).toContain("Codex CLI");
    expect(text).toContain(METHODS[DEFAULT_METHOD]!.install.codex[0]!);
    expect(r.ok).toBe(true);   // non-fatal: hanoman tetap bisa menjalankan sesi
  });

  it("metode default siap → tanda `✓`, tanpa perintah", () => {
    const m = METHODS[DEFAULT_METHOD]!;
    const st = methodStatus(m, "claude", { skills: methodSkills(m), packages: [...m.requires] });
    const r = doctorReport({ ...base, methods: [st] });
    const text = r.lines.join("\n");
    expect(text).toContain(`✓ metode ${DEFAULT_METHOD}`);
    expect(text).not.toContain(m.install.claude[0]!);
  });

  it("tanpa metode yang dilaporkan, laporan lama tak berubah", () => {
    const r = doctorReport({ ...base, methods: [] });
    expect(r.lines.join("\n")).not.toContain("metode ");
    expect(r.ok).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism cli/test/doctor.test.ts
```
Expected: FAIL — properti `methods` tak ada di tipe `Probes`, baris metode tak dicetak.

- [x] **Step 3: Implementasi**

Di `cli/src/commands/doctor.ts`, tambahkan impor:

```ts
import { DEFAULT_METHOD, METHODS, methodStatus, zAgent, type MethodSkillStatus } from "@hanoman/shared";
import { scanAgentSkills } from "@hanoman/runner";
```

(gabungkan dengan impor `@hanoman/runner` yang sudah ada)

Tambahkan field ke `Probes`:

```ts
export type Probes = {
  node: string; git: string | null; tmux: string | null;
  claude: string | null; codex: string | null;
  gh: string | null;   // SPEC-471 · opsional: tanpa gh, tarik issue lewat REST + GITHUB_TOKEN
  homeWritable: boolean; web: boolean; db: string;
  // SPEC-739 · ADR-0114 · kesiapan metode DEFAULT untuk tiap agen yang CLI-nya benar-benar ada.
  // Kosong = tak ada yang dilaporkan (mis. tak ada CLI agen sama sekali).
  methods: MethodSkillStatus[];
};
```

Di `doctorReport`, tepat sebelum `if (!p.claude && !p.codex) {`:

```ts
  // SPEC-739 · ADR-0114 · NON-FATAL, sejajar dengan cara aset dashboard yang hilang dilaporkan:
  // skill yang kurang tak mematikan sesi, ia hanya membuat gerbang yang disebut prompt tak ada.
  for (const m of p.methods) {
    const agent = m.agent === "codex" ? "Codex CLI" : "Claude Code";
    rows.push({
      mark: m.ready ? "✓" : "!",
      text: m.ready
        ? `metode ${m.method} · ${agent} — siap`
        : `metode ${m.method} · ${agent} — belum siap: `
          + [...m.missingPackages, ...m.missingSkills].join(", ")
          + m.install.map((c) => `\n      ${c}`).join(""),
      fatal: false,
    });
  }
```

Di fungsi `doctor()`, hitung probe-nya sesudah `homeWritable` (`claude`/`codex` sudah dihitung inline di pemanggilan `doctorReport` hari ini — angkat keduanya ke variabel):

```ts
  const claude = version(ctx.env.HANOMAN_CLAUDE_BIN ?? "claude", ["--version"]);
  const codex = version(ctx.env.HANOMAN_CODEX_BIN ?? "codex", ["--version"]);
  // Hanya agen yang CLI-nya ADA yang dilaporkan: metode codex di mesin tanpa codex cuma derau.
  const method = METHODS[DEFAULT_METHOD]!;
  const methods = zAgent.options
    .filter((a) => (a === "codex" ? codex : claude) !== null)
    .map((a) => {
      const s = scanAgentSkills(a, ctx.env);
      return methodStatus(method, a, { skills: s.skills.map((k) => k.id), packages: s.packages });
    });
```

lalu ganti pemanggilan `doctorReport({…})` supaya memakai `claude`, `codex`, dan `methods` itu.

- [x] **Step 4: Jalankan test, pastikan LULUS**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism cli/test/doctor.test.ts
```
Expected: PASS, termasuk seluruh test doctor lama (yang perlu ditambahi `methods: []` pada literal `Probes`-nya).

- [x] **Step 5: Typecheck cli**

```bash
pnpm --filter ./cli typecheck
```
Expected: keluar 0.

- [x] **Step 6: Commit**

```bash
git add cli/src/commands/doctor.ts cli/test/doctor.test.ts
git commit -m "feat(spec-739): hanoman doctor melaporkan kesiapan metode default per agen"
```

---

### Task 8: Docs Source of Truth — ADR-0114 + index

**Files:**
- Create: `internal/docs/adr/0114-status-pemasangan-skill-metode.md`
- Modify: `internal/docs/README.md` (bagian `## adr`, baris pertama daftar)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/skills/hanoman/SKILL.md` (butir "Aturan Sesi & Eksekusi", setelah butir SPEC-734)
- Modify: `internal/docs/architecture/api-contract.md` (endpoint baru + field `install`)

**Interfaces:**
- Consumes: seluruh keputusan Task 1-7.
- Produces: —

- [x] **Step 1: Tulis ADR-0114**

Buat `internal/docs/adr/0114-status-pemasangan-skill-metode.md` dengan bagian: Status (Diterima, 2026-08-13) · Konteks · Keputusan · Alternatif yang ditolak · Konsekuensi · Gotcha. Isi yang WAJIB ada:

- Katalog `METHODS` kini juga membawa `install` per agen — perintah adalah data, bukan literal UI.
- Deteksi hidup di `runner/src/skills.ts`; akar per agen bisa di-override `HANOMAN_CLAUDE_HOME`/`HANOMAN_CODEX_HOME` (+ `CODEX_HOME` untuk codex).
- **Koreksi terukur:** codex punya DUA akar (`~/.codex/skills` **dan** `~/.codex/plugins/cache/**`); memindai satu saja memberi salah-negatif di mesin yang sehat.
- Enable-gate berbentuk sama di kedua agen (`enabledPlugins` JSON vs `[plugins."x@y"] enabled` TOML); **absen = aktif**.
- Fail-open adalah sifat **gerbang**, bukan sifat **vonis** — pencocokan skill ketat & id persis.
- Status **LOCAL-only, nol tabel**: diturunkan live tiap request (ADR-0011/0018).
- Pemasangan lewat sesi terminal (ADR-0056); server tak pernah memasang (ADR-0087/0088), nol executor baru (ADR-0037 utuh).
- Metode tak dikenal pada jalur **install** → 400, sengaja tak lenient seperti `resolveMethod`.
- `doctor` melaporkan **metode default saja**, hanya untuk agen yang CLI-nya ada, **non-fatal**.

- [x] **Step 2: Tautkan di kedua index**

Di `internal/docs/README.md`, sisipkan sebagai baris pertama daftar `## adr`:

```markdown
- [0114 — Status pemasangan skill metode: deteksi per agen LOCAL-only, pemasangan lewat sesi terminal](adr/0114-status-pemasangan-skill-metode.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasi 0114 mengikuti bentuk entri 0113 di sana.

- [x] **Step 3: Perbarui SKILL.md**

Di `internal/skills/hanoman/SKILL.md`, tepat setelah butir "Metode workflow adalah data, bukan literal" (SPEC-734), tambahkan butir SPEC-739 yang menyebut: endpoint `GET /api/methods/status`, letak deteksi, dua akar per agen, gerbang enable, pencocokan ketat, pemasangan lewat `POST /terminal/sessions {install}`, dan baris `!` di doctor.

- [x] **Step 4: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md`, tambahkan `GET /api/methods/status` (bentuk respons) dan catat perluasan varian shell `POST /api/terminal/sessions` dengan `install?: { method, agent }`.

- [x] **Step 5: Cek integritas index**

```bash
node cli/src/index.ts docs index --check || pnpm hanoman docs index --check
```
Expected: index konsisten (semua doc ter-link). Bila perintahnya tak tersedia di worktree ini, verifikasi manual bahwa berkas ADR baru muncul di **kedua** README.

- [x] **Step 6: Commit**

```bash
git add internal/docs/adr/0114-status-pemasangan-skill-metode.md internal/docs/README.md internal/docs/adr/README.md internal/skills/hanoman/SKILL.md internal/docs/architecture/api-contract.md
git commit -m "docs(spec-739): ADR-0114 status & pemasangan skill metode + index & SKILL"
```

---

### Task 9: Verifikasi akhir & smoke endpoint

**Files:** —

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: bukti hijau tercatat.

- [x] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism \
  runner/test/skills.test.ts \
  shared/src/method-status.test.ts shared/src/method-catalog.test.ts \
  server/test/method-status.route.test.ts server/test/terminal.route.test.ts \
  src/test/method-status-ui.test.tsx src/test/method-picker.test.tsx \
  cli/test/doctor.test.ts
```
Expected: seluruh berkas PASS, dan jumlah test > 0 di **setiap** berkas (nol test bukan bukti — `--changed` menyalakan `passWithNoTests`).

- [x] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./runner typecheck && pnpm --filter ./server typecheck && pnpm --filter ./cli typecheck
```
Expected: keluar 0 di keempatnya. (Jalankan berurutan, bukan `-r`.)

- [x] **Step 3: Smoke endpoint nyata**

```bash
HANOMAN_HOME="$(mktemp -d)" node --experimental-strip-types server/src/server.ts &
sleep 4
curl -s localhost:8787/api/methods/status | head -c 800
```

Bila server dev di worktree ini butuh jalur lain, pakai `pnpm dev` lalu curl endpoint yang sama. Expected: JSON `{"agents":[…],"methods":[…]}` memuat 2 agen × jumlah metode, dan — di mesin dev ini — `superpowers/claude` **dan** `superpowers/codex` keduanya `ready: true`, `matt` keduanya `ready: false`. Matikan server per-PID (`lsof -ti:8787` → `kill <pid>`), **jangan** `pkill -f`.

- [x] **Step 4: Commit bukti verifikasi**

```bash
git add -u
git commit -m "chore(spec-739): centang plan + catat bukti verifikasi"
```

---

## Bukti verifikasi (dijalankan 2026-08-13)

**Test yang tersentuh — 8 berkas, 153 test, semua hijau** (jumlahnya non-nol di tiap berkas; `--changed`
menyalakan `passWithNoTests`, jadi "no test files" tak pernah diterima sebagai bukti):

```
✓ server/test/terminal.route.test.ts        (70)   ← 70 test SPEC-236/394/517 lama, tak disunting
✓ runner/test/skills.test.ts                (17)
✓ shared/src/method-catalog.test.ts         (17)
✓ cli/test/doctor.test.ts                   (13)
✓ src/test/method-status-ui.test.tsx        (10)
✓ src/test/method-picker.test.tsx            (9)
✓ server/test/method-status.route.test.ts    (9)
✓ shared/src/method-status.test.ts           (8)
Test Files 8 passed · Tests 153 passed
```

**18 berkas test web ber-mock parsial** (ditambal `getMethodStatus`/`listProjects`): 18 berkas,
**84 test**, semua hijau.

**Typecheck** lima paket tersentuh, dijalankan berurutan (bukan `-r`): `shared`, `runner`, `server`,
`cli`, `@hanoman/app` — `tsc --noEmit` keluar 0 di semuanya.

**Smoke `hanoman doctor`** terhadap mesin nyata (`cli/dist/hanoman.js doctor`):

```
✓ metode superpowers · Claude Code — siap
✓ metode superpowers · Codex CLI — siap
```

dan dengan akar disuntik ke direktori kosong (`HANOMAN_CLAUDE_HOME`/`HANOMAN_CODEX_HOME`):

```
! metode superpowers · Claude Code — belum siap: superpowers, superpowers:brainstorming, …
      claude plugin marketplace add obra/superpowers-marketplace
      claude plugin install superpowers@superpowers-marketplace
! metode superpowers · Codex CLI — belum siap: …
      codex plugin add superpowers@openai-curated
```

**exit code 0** di kedua kasus — non-fatal, sesuai butir 5 brief.

**Smoke endpoint** (server dibundel + DB khusus `HANOMAN_DATABASE_URL`, port 8811, cookie sesi):

- `GET /api/methods/status` → 200. claude: 2 akar / 17 skill · codex: **15 akar / 74 skill** (termasuk
  `plugins/cache/openai-curated/superpowers/11c74d6b/skills`). `superpowers` **`ready: true` untuk KEDUA
  agen**, `matt` `ready: false` di keduanya dengan 1 paket + 6 id skill yang kurang dan perintah
  pemasangannya. Ini bukti langsung Koreksi 1: deteksi yang hanya memindai `~/.codex/skills/` akan
  menjawab `ready: false` untuk codex di mesin yang sehat.
- `POST /api/terminal/sessions {shell:true, install:{method:"tak-ada",…}}` → **400**
  `metode "tak-ada" tak dikenal`.
- `POST … {install:{method:"superpowers",agent:"codex"}}` → **201** `{id}`, sesi tmux lahir
  (`HANOMAN_SHELL=/bin/echo` supaya smoke tak benar-benar memasang apa pun). Sesi smoke dibunuh
  **per-nama** (`tmux kill-session -t hanoman-<id>`); lima sesi tetangga selamat, `killAll`/`pkill -f`
  tak pernah dipakai (SPEC-402).

Suite penuh, lint penuh, dan build penuh tetap tugas manusia sebelum merge (ADR-0080).

## Self-Review

**Spec coverage:**
- Butir 1 DETEKSI → Task 1 (murni-per-sumber, bertest, tanpa jaringan, akar ber-env). ✔
- Butir 2 STATUS → Task 2 (vonis `requires` **dan** id skill) + Task 3 (endpoint, LOCAL-only, nol model ⇒ nol `FIELDS`). ✔
- Butir 3 DASHBOARD → Task 5 (checklist Settings) + Task 6 (catatan picker, menggantikan baris statis, menyebut agen, tak memblokir). ✔
- Butir 4 PEMASANGAN → Task 4 (jalur `POST /terminal/sessions`, perintah dari katalog, nol executor server). ✔
- Butir 5 DOCTOR → Task 7 (metode default, tanda `!`, non-fatal, dengan perintahnya). ✔
- Docs SoT → Task 8. Verifikasi → Task 9. ✔

**Placeholder scan:** tak ada "TBD"/"tangani edge case"; setiap langkah kode memuat kodenya. Task 8 menyebut isi wajib tiap dokumen alih-alih menyalin naskah penuh — itu tulisan prosa, bukan kode, dan daftar butirnya lengkap.

**Type consistency:** `MethodSkillStatus`/`MethodStatusResponse`/`methodSkills`/`methodStatus` dipakai dengan nama & bentuk yang sama di Task 2→3→5→6→7; `scanAgentSkills(agent, env, osHome)` dipanggil dengan urutan argumen yang sama di Task 3 & 7; `installCommand(m, agent, shell?)` didefinisikan Task 3 dan dipakai Task 4; `api.createShell(project, install?)` didefinisikan Task 4 dan dipakai Task 5.
