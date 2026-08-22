# SPEC-883 · Provisioning VPS Satu Perintah — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Satu tombol (dan satu subperintah CLI) memasang hanoman beserta komponen pilihan di sebuah VPS, lalu menandai apa yang benar-benar ada di sana berdasarkan probe.

**Architecture:** Satu skrip shell deterministik `provision.sh` dengan dua mode (`probe` → baris `COMP`, `apply` → baris `STEP`) dikirim lewat stdin SSH persis pola `remediate.sh`. Katalog komponen adalah data TypeScript di server; dependensi diselesaikan di server, skrip hanya mengeksekusi daftar yang sudah lengkap dan terurut. Status komponen di DB **hanya** ditulis dari keluaran probe.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod (`@hanoman/shared`), React + Vite, vitest, bash (POSIX + bashism yang sudah dipakai `harden.sh`).

**Spec:** `docs/superpowers/specs/2026-08-22-spec-883-provisioning-vps-satu-perintah-design.md`

## Global Constraints

- Bahasa komentar & pesan UI: **Bahasa Indonesia**, mengikuti seluruh repo.
- **TypeScript strict.** Tak ada `any` baru; kode server memakai tipe dari `@hanoman/shared`.
- **Nomor spec sementara.** Bila server menerbitkan id backlog selain `SPEC-883`, selaraskan seluruh rujukan (`SPEC-883`, nama berkas spec/plan, komentar kode) dalam satu commit.
- **ADR baru: `ADR-0137`** — `internal/docs/adr/0136-*` sudah terpakai (SPEC-881).
- **Migration ditulis tangan**, additif murni, tanpa `migrate dev` (worktree tetangga membuat `migrate dev` me-reset DB saat ada drift). Nama: `20260822120000_vps_provision`.
- **Kolom baru TIDAK masuk `FIELDS.vps`** (`server/src/services/sync.ts:63`). Terukur di SPEC-880: `snapshot()` mengirim kolom baru di setiap push → hub lama menolak seluruh push entitas itu.
- **Tak ada peta capability baru.** Endpoint baru hidup di bawah prefix `/vps` yang sudah ada; read/write diturunkan dari method.
- **Nol rahasia di skrip.** `provision.sh` tak pernah membaca, menulis, meminta, atau meneruskan kredensial agen. Provision selalu key-only (`BatchMode=yes` lewat `sshExec` tanpa `password`).
- **Marker skrip wajib.** Setiap skrip VPS memuat string penanda di komentar kepalanya (`hanoman-audit`, `hanoman-harden`, `hanoman-remediate`); `provision.sh` memakai **`hanoman-provision`**. Fixture `server/test/fixtures/fake-ssh.sh` mencabang atas isi stdin memakai marker itu — tanpa marker, seluruh test route gagal senyap.
- **Perintah test** (CLAUDE.md): selalu sertakan DB terisolasi dan serialisasi berkas untuk test server:
  ```bash
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>
  ```
  Suite yang gagal ramai dengan 404/P2022 hampir selalu isolasi DB, bukan regresi.
- **Commit per task.** Docs yang tersentuh ikut di commit yang sama (Task 10 memuat sisanya).

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `server/scripts/vps/provision.sh` | **Baru.** Satu skrip, dua mode. Nol asumsi tentang SSH (dijalankan lokal oleh CLI juga). |
| `server/scripts/vps/agent.Containerfile` | **Baru.** Definisi image `hanoman-agent:latest` (profil production). |
| `server/src/vps/catalog/components.ts` | **Baru.** Katalog komponen + `resolveComponents` (penutupan dependensi + urutan topologis). |
| `server/src/services/vps-provision.ts` | **Baru.** Parser `COMP`/`STEP`, `probeComponents`, `provision`, `readSetupToken`. |
| `server/src/services/vps-audit.ts:73` | Ubah `scriptPath` → cari lokasi terpaket lebih dulu. |
| `server/src/routes/vps.ts` | Empat endpoint baru. |
| `server/prisma/schema.prisma` + `migrations/20260822120000_vps_provision/migration.sql` | Tiga kolom additif. |
| `shared/src/dto.ts` | Tipe & zod: `ComponentId`, `ProvisionProfile`, `ProvisionComponent`, `ComponentProbe`, `ProvisionStep`, `zProvision`. |
| `shared/src/api.ts` | Empat path baru. |
| `cli/src/release/pack.ts` | `copyPlan` + `REQUIRED_ARTIFACTS` memuat skrip VPS. |
| `cli/src/commands/provision.ts` | **Baru.** Subperintah `hanoman provision`. |
| `cli/src/router.ts` | Routing + help. |
| `src/src/api/client.ts` | Empat metode baru. |
| `src/src/screens/VpsProvision.tsx` | **Baru.** Panel toggle + lencana + kartu serah-terima. Dipisah dari `VpsScreen.tsx` (240 baris) supaya keduanya tetap satu tanggung jawab. |
| `src/src/screens/VpsScreen.tsx` | Sisipkan panel + lencana ke modal detail. |

---

## Task 1: Skrip VPS ikut terpaket

Temuan yang memaksa task ini duluan: `copyPlan()` tak menyalin `server/scripts/vps/`, sementara `scriptPath()` menjangkar ke `repoRoot()` yang mencari `pnpm-workspace.yaml`. Di instalasi npm global marker itu tak ada → `repoRoot()` jatuh ke `process.cwd()` (systemd `WorkingDirectory=/var/lib/hanoman`) → `readFileSync` melempar. Audit, harden, dan remediate kemungkinan besar sudah mati senyap di produksi. `provision.sh` mustahil bekerja sebelum ini beres.

**Files:**
- Modify: `cli/src/release/pack.ts:26-30` (`REQUIRED_ARTIFACTS`), `:73-87` (`copyPlan`)
- Modify: `server/src/services/vps-audit.ts:73` (`scriptPath`)
- Test: `cli/test/pack.test.ts`, `server/test/vps-script-path.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `scriptPath(f: string): string` yang benar di checkout **dan** di paket npm. Task 3–5 memakainya.

- [ ] **Step 1: Tulis test packing yang gagal**

Tambahkan ke `cli/test/pack.test.ts`:

```ts
import { copyPlan, REQUIRED_ARTIFACTS } from "../src/release/pack";

describe("SPEC-883 · skrip VPS ikut terpaket", () => {
  it("copyPlan menyalin direktori scripts/vps", () => {
    const item = copyPlan("/repo").find((i) => i.to === "scripts/vps");
    expect(item).toBeDefined();
    expect(item!.from).toBe("/repo/server/scripts/vps");
    expect(item!.dir).toBe(true);
  });

  it("keempat skrip wajib ada di artefak", () => {
    for (const f of ["audit.sh", "harden.sh", "remediate.sh", "provision.sh"]) {
      expect(REQUIRED_ARTIFACTS).toContain(`scripts/vps/${f}`);
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
pnpm vitest --run cli/test/pack.test.ts
```
Expected: FAIL — `expect(item).toBeDefined()` menerima `undefined`.

- [ ] **Step 3: Perbaiki `copyPlan` dan `REQUIRED_ARTIFACTS`**

Di `cli/src/release/pack.ts`, tambahkan ke array `REQUIRED_ARTIFACTS` (sesudah `"docs/agent-integration.md"`):

```ts
  // SPEC-883 · skrip VPS dibaca runtime oleh scriptPath(). Sebelum ini keempatnya TIDAK
  // ikut terpaket sementara scriptPath menjangkar ke repoRoot() — di instalasi npm marker
  // pnpm-workspace.yaml tak ada, repoRoot jatuh ke cwd, dan audit/harden/remediate melempar
  // ENOENT. Gerbang ini yang membuat kegagalan itu tak bisa terbit lagi.
  "scripts/vps/audit.sh", "scripts/vps/harden.sh",
  "scripts/vps/remediate.sh", "scripts/vps/provision.sh",
```

Di `copyPlan`, tambahkan sebelum `LICENSE`:

```ts
    { from: join(repo, "server/scripts/vps"), to: "scripts/vps", dir: true },
```

Di `packageJsonFor`, tambahkan `"scripts"` ke daftar `files`:

```ts
    files: ["bin", "dist", "web", "prisma", "docs", "scripts", "README.md", "LICENSE"],
```

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
pnpm vitest --run cli/test/pack.test.ts
```
Expected: PASS.

- [ ] **Step 5: Tulis test resolusi path yang gagal**

Buat `server/test/vps-script-path.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { scriptPath } from "../src/services/vps-audit";

describe("SPEC-883 · scriptPath", () => {
  it("menemukan skrip di checkout", () => {
    for (const f of ["audit.sh", "harden.sh", "remediate.sh"]) {
      expect(existsSync(scriptPath(f))).toBe(true);
    }
  });

  it("mengabaikan cwd — dijalankan dari direktori mana pun tetap benar", () => {
    const before = process.cwd();
    try {
      process.chdir("/");
      expect(existsSync(scriptPath("audit.sh"))).toBe(true);
    } finally { process.chdir(before); }
  });
});
```

- [ ] **Step 6: Jalankan, pastikan test kedua gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-script-path.test.ts
```
Expected: FAIL pada test kedua — `repoRoot()` jatuh ke `/` dan berkas tak ada. (Ini persis kegagalan produksi, direproduksi.)

- [ ] **Step 7: Ubah `scriptPath` — lokasi terpaket lebih dulu**

Di `server/src/services/vps-audit.ts`, ganti baris `export const scriptPath = …` dengan:

```ts
// SPEC-883 · dua lokasi, terpaket lebih dulu. Di paket npm bundle hidup di <pkg>/dist/server.js
// dan skrip di <pkg>/scripts/vps — `import.meta.url` satu-satunya jangkar yang benar di sana.
// Di checkout, URL itu menunjuk server/src/services/, jadi kita jatuh ke repoRoot() (marker
// pnpm-workspace.yaml). Urutan ini tak boleh dibalik: repoRoot() SELALU memulangkan string
// (fallback cwd), jadi ia tak pernah "gagal" — ia hanya memulangkan path yang salah.
const packagedScript = (f: string): string =>
  fileURLToPath(new URL(`../scripts/vps/${f}`, import.meta.url));

export const scriptPath = (f: string): string => {
  const packed = packagedScript(f);
  return existsSync(packed) ? packed : join(repoRoot(), "server", "scripts", "vps", f);
};
```

Tambahkan impor di kepala berkas yang sama:

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
```

(`readFileSync` dan `join` sudah diimpor; periksa jangan menduplikasi impor `node:fs`.)

- [ ] **Step 8: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-script-path.test.ts cli/test/pack.test.ts
```
Expected: PASS semua.

- [ ] **Step 9: Commit**

```bash
git add cli/src/release/pack.ts cli/test/pack.test.ts server/src/services/vps-audit.ts server/test/vps-script-path.test.ts
git commit -m "fix(spec-883): skrip VPS ikut terpaket & scriptPath tak lagi bergantung cwd"
```

---

## Task 2: Katalog komponen & DTO

**Files:**
- Modify: `shared/src/dto.ts` (sesudah blok `zRemediate`/`RemediateStep`, ±baris 557)
- Create: `server/src/vps/catalog/components.ts`
- Test: `server/test/vps-catalog-components.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `ComponentId = "base"|"node"|"hanoman"|"caddy"|"podman"|"agent-image"|"claude"|"codex"|"gh"`
  - `ProvisionProfile = "lab"|"production"`
  - `ComponentProbe = { id: ComponentId; status: "ok"|"partial"|"absent"; detail: string }`
  - `ProvisionStep = { item: string; status: "would"|"ok"|"fail"|"skip"; detail: string }`
  - `zProvision` (zod body)
  - `COMPONENTS: ProvisionComponent[]`, `componentById(id)`, `resolveComponents(ids, profile)`

- [ ] **Step 1: Tulis test katalog yang gagal**

Buat `server/test/vps-catalog-components.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COMPONENTS, componentById, resolveComponents } from "../src/vps/catalog/components";

describe("SPEC-883 · katalog komponen", () => {
  it("setiap `requires` menunjuk komponen yang ada, tanpa siklus", () => {
    for (const c of COMPONENTS) {
      for (const profile of ["lab", "production"] as const) {
        for (const dep of c.requires[profile]) {
          expect(componentById(dep), `${c.id} → ${dep}`).toBeDefined();
          expect(dep).not.toBe(c.id);
        }
      }
    }
  });

  it("hanoman di lab menutup base+node, terurut topologis", () => {
    const r = resolveComponents(["hanoman"], "lab");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toEqual(["base", "node", "hanoman"]);
  });

  it("hanoman di production ikut menarik podman", () => {
    const r = resolveComponents(["hanoman"], "production");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toContain("podman");
    expect(r.items.indexOf("podman")).toBeLessThan(r.items.indexOf("hanoman"));
  });

  it("claude di production menarik agent-image, di lab tidak", () => {
    const prod = resolveComponents(["claude"], "production");
    const lab = resolveComponents(["claude"], "lab");
    expect(prod.ok && prod.items).toContain("agent-image");
    expect(lab.ok && lab.items).not.toContain("agent-image");
  });

  it("komponen di luar profil ditolak", () => {
    const r = resolveComponents(["agent-image"], "lab");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/profil/);
  });

  it("id tak dikenal ditolak", () => {
    const r = resolveComponents(["wat" as never], "lab");
    expect(r.ok).toBe(false);
  });

  it("daftar kosong ditolak", () => {
    expect(resolveComponents([], "lab").ok).toBe(false);
  });

  it("duplikat tak menggandakan langkah", () => {
    const r = resolveComponents(["node", "node", "hanoman"], "lab");
    expect(r.ok && r.items).toEqual(["base", "node", "hanoman"]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-catalog-components.test.ts
```
Expected: FAIL — `Cannot find module '../src/vps/catalog/components'`.

- [ ] **Step 3: Tambahkan tipe & zod ke `shared/src/dto.ts`**

Sisipkan sesudah `export type RemediateStep = …`:

```ts
// SPEC-883 · ADR-0137 · provisioning VPS berbasis katalog. Katalog hidup di server
// (server/src/vps/catalog/components.ts) dan dikirim utuh lewat GET /vps/components —
// frontend TIDAK mengimpor katalog server, pola yang sama dengan checklist SPEC-220.
export const PROVISION_PROFILES = ["lab", "production"] as const;
export type ProvisionProfile = (typeof PROVISION_PROFILES)[number];

export const COMPONENT_IDS = [
  "base", "node", "hanoman", "caddy", "podman", "agent-image", "claude", "codex", "gh",
] as const;
export type ComponentId = (typeof COMPONENT_IDS)[number];
export type ComponentSection = "dasar" | "hanoman" | "ingress" | "sandbox" | "agen";

export type ProvisionComponent = {
  id: ComponentId;
  label: string;
  section: ComponentSection;
  /** Prasyarat BERBEDA per profil: `claude` dipasang di host (lab) atau ke dalam image (production). */
  requires: Record<ProvisionProfile, ComponentId[]>;
  profiles: ProvisionProfile[];
  /** true → probe tak pernah memulangkan `ok`; paling jauh `partial not-logged-in`. */
  interactiveLogin: boolean;
  needsDomain: boolean;
};

// `ok` = terpasang & siap · `partial` = terpasang, belum siap (belum login, service mati, tanpa TLS)
// · `absent` = tak ada. Nilai ini HANYA lahir dari MODE=probe, tak pernah dari niat (SPEC-487).
export type ComponentStatus = "ok" | "partial" | "absent";
export type ComponentProbe = { id: ComponentId; status: ComponentStatus; detail: string };
export type VpsComponents = Record<string, { status: ComponentStatus; detail: string }>;

// `skip` adalah alasan parser ini TERPISAH dari RemediateStep (SPEC-220): komponen yang
// prasyaratnya gagal wajib tetap menerbitkan baris, kalau tidak UI menampilkan daftar langkah
// lebih pendek dari yang dicentang dan itu terbaca seperti "berhasil".
export type ProvisionStep = { item: string; status: "would" | "ok" | "fail" | "skip"; detail: string };

export const zProvision = z.object({
  items: z.array(z.enum(COMPONENT_IDS)).min(1).max(16),
  profile: z.enum(PROVISION_PROFILES),
  domain: z.string().min(1).regex(HOST_RE).optional(),
  confirm: z.boolean().optional(),
  force: z.boolean().optional(),
});

export type ProvisionResult = {
  steps: ProvisionStep[];
  components: ComponentProbe[];
  checkedAt: string;
  setup: { url: string; expiresAt: string } | null;
};
```

- [ ] **Step 4: Tulis katalog**

Buat `server/src/vps/catalog/components.ts`:

```ts
// SPEC-883 · ADR-0137 · katalog komponen provisioning. Komponen adalah DATA, bukan cabang di
// dalam skrip: skrip menerima daftar yang sudah lengkap & terurut dan tak pernah menebak.
import type { ComponentId, ProvisionComponent, ProvisionProfile } from "@hanoman/shared";

const BOTH: ProvisionProfile[] = ["lab", "production"];

export const COMPONENTS: ProvisionComponent[] = [
  { id: "base", label: "Paket dasar (curl, git, tmux, toolchain node-pty)", section: "dasar",
    requires: { lab: [], production: [] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "node", label: "Node.js 22 LTS", section: "dasar",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "hanoman", label: "hanoman (npm global + user service + systemd)", section: "hanoman",
    requires: { lab: ["node"], production: ["node", "podman"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "caddy", label: "Caddy + TLS otomatis", section: "ingress",
    requires: { lab: [], production: [] }, profiles: BOTH, interactiveLogin: false, needsDomain: true },
  { id: "podman", label: "Podman rootless + network egress", section: "sandbox",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: false, needsDomain: false },
  { id: "agent-image", label: "Image agen hanoman-agent:latest", section: "sandbox",
    requires: { lab: [], production: ["podman"] }, profiles: ["production"], interactiveLogin: false, needsDomain: false },
  { id: "claude", label: "Claude Code CLI", section: "agen",
    requires: { lab: ["node"], production: ["agent-image"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
  { id: "codex", label: "Codex CLI", section: "agen",
    requires: { lab: ["node"], production: ["agent-image"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
  { id: "gh", label: "GitHub CLI", section: "agen",
    requires: { lab: ["base"], production: ["base"] }, profiles: BOTH, interactiveLogin: true, needsDomain: false },
];

const BY_ID = new Map(COMPONENTS.map((c) => [c.id, c]));
export const componentById = (id: string): ProvisionComponent | undefined => BY_ID.get(id as ComponentId);

export type Resolved = { ok: true; items: ComponentId[] } | { ok: false; error: string };

// DFS post-order = urutan topologis. Graf katalog kecil & asiklik (dijaga test); `seen`
// mencegah kunjungan ganda, jadi duplikat di input tak menggandakan langkah.
export function resolveComponents(ids: readonly ComponentId[], profile: ProvisionProfile): Resolved {
  if (ids.length === 0) return { ok: false, error: "tak ada komponen yang dipilih" };
  const out: ComponentId[] = [];
  const seen = new Set<ComponentId>();
  const stack = new Set<ComponentId>();

  const visit = (id: ComponentId): string | null => {
    const c = componentById(id);
    if (!c) return `komponen tak dikenal: ${id}`;
    if (!c.profiles.includes(profile)) return `komponen ${id} tak tersedia di profil ${profile}`;
    if (seen.has(id)) return null;
    if (stack.has(id)) return `siklus dependensi pada ${id}`;
    stack.add(id);
    for (const dep of c.requires[profile]) {
      const err = visit(dep);
      if (err) return err;
    }
    stack.delete(id);
    seen.add(id);
    out.push(id);
    return null;
  };

  for (const id of ids) {
    const err = visit(id);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, items: out };
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-catalog-components.test.ts
```
Expected: PASS (8 test).

- [ ] **Step 6: Commit**

```bash
git add shared/src/dto.ts server/src/vps/catalog/components.ts server/test/vps-catalog-components.test.ts
git commit -m "feat(spec-883): katalog komponen provisioning + DTO"
```

---

## Task 3: `provision.sh` mode probe

**Files:**
- Create: `server/scripts/vps/provision.sh`
- Test: `server/test/vps-provision-script.test.ts`

**Interfaces:**
- Consumes: —
- Produces: kontrak baris `COMP <id> <ok|partial|absent> <detail>` di stdout saat `MODE=probe`. Task 5 mem-parse-nya.

- [ ] **Step 1: Tulis test skrip yang gagal**

Buat `server/test/vps-provision-script.test.ts`. Test menjalankan skrip **sungguhan** di mesin test dengan `PATH` fixture, jadi ia tak pernah menyentuh mesin nyata:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/vps/provision.sh", import.meta.url));

// PATH palsu: setiap perintah yang diperiksa skrip diganti stub yang bisa kita atur.
let binDir: string;
const stub = (name: string, body: string) => {
  const p = join(binDir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(p, 0o755);
};
const run = (env: Record<string, string>) =>
  execFileSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { PATH: `${binDir}:/usr/bin:/bin`, ...env },
  });

beforeAll(() => {
  // PATH sengaja minimal (binDir + /usr/bin + /bin): apa pun di luar itu (node, claude, caddy,
  // podman) tak terlihat skrip kecuali kita men-stub-nya. `command -v` adalah builtin shell —
  // ia TIDAK bisa di-stub lewat PATH, jadi jangan mencoba.
  binDir = mkdtempSync(join(tmpdir(), "hanoman-provision-bin-"));
});

describe("SPEC-883 · provision.sh MODE=probe", () => {
  it("komponen absen dilaporkan absent, satu baris per komponen", () => {
    const out = run({ MODE: "probe" });
    const ids = out.split("\n").filter((l) => l.startsWith("COMP ")).map((l) => l.split(" ")[1]);
    expect(ids).toEqual(expect.arrayContaining(["base", "node", "hanoman", "caddy", "podman", "claude", "codex", "gh"]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("node terpasang → COMP node ok <versi>", () => {
    stub("node", 'echo "v22.11.0"');
    const line = run({ MODE: "probe" }).split("\n").find((l) => l.startsWith("COMP node "));
    expect(line).toMatch(/^COMP node ok v22\.11\.0/);
  });

  it("claude terpasang tapi belum login → partial not-logged-in, TAK PERNAH ok", () => {
    stub("claude", 'echo "1.2.3"');
    const line = run({ MODE: "probe" }).split("\n").find((l) => l.startsWith("COMP claude "));
    expect(line).toMatch(/^COMP claude partial not-logged-in/);
  });

  it("probe nol tulis: tak memanggil satu perintah instalasi pun", () => {
    const log = join(binDir, "install.log");
    stub("apt-get", `echo "$@" >> ${log}; exit 0`);
    stub("dnf", `echo "$@" >> ${log}; exit 0`);
    stub("npm", `echo "$@" >> ${log}; exit 0`);
    run({ MODE: "probe" });
    expect(() => execFileSync("cat", [log])).toThrow(); // berkas tak pernah dibuat
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-script.test.ts
```
Expected: FAIL — `ENOENT` pada `server/scripts/vps/provision.sh`.

- [ ] **Step 3: Tulis kerangka skrip + mode probe**

Buat `server/scripts/vps/provision.sh`:

```bash
#!/usr/bin/env bash
# hanoman-provision · SPEC-883 · ADR-0137
#
# Marker "hanoman-provision" di baris atas WAJIB: server mengirim skrip ini lewat stdin dan
# fixture test (server/test/fixtures/fake-ssh.sh) mencabang atas isi stdin memakai marker itu.
#
# Dua mode, dipilih lewat env MODE:
#   MODE=probe                                 → COMP <id> <ok|partial|absent> <detail>
#   MODE=apply ITEMS=a,b PROFILE=lab DRY_RUN=1 → STEP <id> <would|ok|fail|skip> <detail>
#
# NOL asumsi tentang SSH: skrip ini dijalankan lewat `ssh … bash -s` DAN secara lokal oleh
# `hanoman provision`. Jangan pernah membaca $SSH_*, /dev/tty, atau berasumsi ada tty.
# NOL rahasia: tak pernah membaca, menulis, atau meminta kredensial agen.
set -uo pipefail   # sengaja TANPA -e: satu komponen gagal tak boleh membunuh laporan sisanya

MODE="${MODE:-probe}"
PROFILE="${PROFILE:-lab}"
DOMAIN="${DOMAIN:-}"
DRY_RUN="${DRY_RUN:-}"
HANOMAN_PORT="${HANOMAN_PORT:-8787}"
HANOMAN_USER="${HANOMAN_USER:-hanoman}"
HANOMAN_DATA="${HANOMAN_DATA:-/var/lib/hanoman}"
IMAGE="${IMAGE:-hanoman-agent:latest}"

comp() { echo "COMP $1 $2 ${3:-}"; }
step() { echo "STEP $1 $2 ${3:-}"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- probe ----------

probe_base()    { if have git && have tmux && have curl; then comp base ok "git+tmux+curl"; else comp base absent "paket dasar belum lengkap"; fi; }
probe_node()    { if have node; then comp node ok "$(node --version 2>/dev/null | head -1)"; else comp node absent ""; fi; }
probe_caddy() {
  if ! have caddy; then comp caddy absent ""; return; fi
  if systemctl is-active --quiet caddy 2>/dev/null; then comp caddy ok "$(caddy version 2>/dev/null | head -1)"
  else comp caddy partial service-inactive; fi
}
probe_podman()  { if have podman; then comp podman ok "$(podman --version 2>/dev/null | head -1)"; else comp podman absent ""; fi; }
probe_gh()      { if have gh; then comp gh partial not-logged-in; else comp gh absent ""; fi; }

probe_hanoman() {
  if ! have hanoman; then comp hanoman absent ""; return; fi
  local v; v="$(hanoman --version 2>/dev/null | head -1)"
  if systemctl is-active --quiet hanoman 2>/dev/null; then comp hanoman ok "$v"
  else comp hanoman partial "service-inactive $v"; fi
}

probe_agent_image() {
  if ! have podman; then comp agent-image absent "podman tak ada"; return; fi
  local id; id="$(podman image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | head -1)"
  if [ -n "$id" ]; then comp agent-image ok "${id:0:12}"; else comp agent-image absent ""; fi
}

# Komponen ber-login TIDAK PERNAH `ok`: biner ada ≠ siap dipakai (SPEC-487, marker ≠ bukti).
probe_agent_cli() {
  local id="$1"
  if have "$id"; then comp "$id" partial "not-logged-in $("$id" --version 2>/dev/null | head -1)"
  else comp "$id" absent ""; fi
}

do_probe() {
  probe_base; probe_node; probe_hanoman; probe_caddy; probe_podman; probe_agent_image
  probe_agent_cli claude; probe_agent_cli codex; probe_gh
}

case "$MODE" in
  probe) do_probe ;;
  apply) echo "STEP _ fail mode apply belum diimplementasikan" ;;
  *)     echo "STEP _ fail MODE tak dikenal: $MODE"; exit 2 ;;
esac
```

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
chmod +x server/scripts/vps/provision.sh
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-script.test.ts
```
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/vps/provision.sh server/test/vps-provision-script.test.ts
git commit -m "feat(spec-883): provision.sh mode probe"
```

---

## Task 4: `provision.sh` mode apply, dry-run, gerbang DNS

**Files:**
- Modify: `server/scripts/vps/provision.sh`
- Create: `server/scripts/vps/agent.Containerfile`
- Test: `server/test/vps-provision-script.test.ts` (tambahan)

**Interfaces:**
- Consumes: kontrak `COMP` dari Task 3.
- Produces: kontrak `STEP <id> <would|ok|fail|skip> <detail>`; `skip blocked-by <id>` untuk komponen yang prasyaratnya gagal; `fail dns-mismatch` untuk `caddy`.

- [ ] **Step 1: Tulis test apply yang gagal**

Tambahkan ke `server/test/vps-provision-script.test.ts`:

```ts
describe("SPEC-883 · provision.sh MODE=apply", () => {
  const steps = (out: string) =>
    out.split("\n").filter((l) => l.startsWith("STEP ")).map((l) => {
      const [, item, status, ...rest] = l.split(" ");
      return { item, status, detail: rest.join(" ") };
    });

  it("DRY_RUN=1 memulangkan `would` untuk setiap item, nol tulis", () => {
    const log = join(binDir, "apply.log");
    stub("apt-get", `echo "$@" >> ${log}; exit 0`);
    const out = run({ MODE: "apply", ITEMS: "base,node", PROFILE: "lab", DRY_RUN: "1" });
    expect(steps(out).map((s) => s.item)).toEqual(["base", "node"]);
    expect(steps(out).every((s) => s.status === "would")).toBe(true);
    expect(() => execFileSync("cat", [log])).toThrow();
  });

  it("komponen yang sudah ada → skip already-present (idempoten)", () => {
    stub("node", 'echo "v22.11.0"');
    const out = run({ MODE: "apply", ITEMS: "node", PROFILE: "lab" });
    expect(steps(out)[0]).toMatchObject({ item: "node", status: "skip" });
    expect(steps(out)[0].detail).toMatch(/already-present/);
  });

  it("prasyarat gagal → dependennya skip blocked-by, komponen tak terkait TETAP jalan", () => {
    stub("apt-get", "exit 1");
    stub("dnf", "exit 1");
    const out = run({ MODE: "apply", ITEMS: "base,node,gh", PROFILE: "lab" });
    const byItem = Object.fromEntries(steps(out).map((s) => [s.item, s]));
    expect(byItem.base.status).toBe("fail");
    expect(byItem.node.status).toBe("skip");
    expect(byItem.node.detail).toMatch(/blocked-by base/);
    expect(byItem.gh).toBeDefined();  // baris tetap terbit, tak pernah hilang senyap
  });

  it("caddy dengan DNS tak cocok → fail dns-mismatch, komponen lain tetap jalan", () => {
    stub("getent", 'echo "203.0.113.99  contoh.test"');
    stub("curl", 'echo "198.51.100.7"');
    stub("node", 'echo "v22.11.0"');
    const out = run({ MODE: "apply", ITEMS: "caddy,node", PROFILE: "lab", DOMAIN: "contoh.test" });
    const byItem = Object.fromEntries(steps(out).map((s) => [s.item, s]));
    expect(byItem.caddy.status).toBe("fail");
    expect(byItem.caddy.detail).toMatch(/dns-mismatch/);
    expect(byItem.node).toBeDefined();
  });

  it("caddy tanpa DOMAIN → fail, tak pernah memasang apa pun", () => {
    const out = run({ MODE: "apply", ITEMS: "caddy", PROFILE: "lab" });
    expect(steps(out)[0]).toMatchObject({ item: "caddy", status: "fail" });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-script.test.ts
```
Expected: FAIL — semua test apply, karena mode apply masih stub.

- [ ] **Step 3: Ganti cabang `apply` di `provision.sh`**

Ganti blok `case "$MODE"` di akhir berkas dengan implementasi berikut (letakkan fungsi-fungsi di atasnya, sesudah blok probe):

```bash
# ---------- apply ----------

FAILED=""                                   # daftar id yang gagal, dipakai gerbang blocked-by
mark_failed() { FAILED="$FAILED $1"; }
has_failed()  { case " $FAILED " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Prasyarat per komponen, DUPLIKAT dari katalog TypeScript dengan sengaja: server sudah
# mengirim daftar terurut & lengkap, tabel ini hanya dipakai untuk menerbitkan `blocked-by`
# yang benar. Kalau keduanya melenceng, test route (Task 7) yang menangkapnya.
deps_of() {
  case "$1" in
    node)        echo "base" ;;
    hanoman)     if [ "$PROFILE" = production ]; then echo "node podman"; else echo "node"; fi ;;
    podman)      echo "base" ;;
    agent-image) echo "podman" ;;
    claude|codex) if [ "$PROFILE" = production ]; then echo "agent-image"; else echo "node"; fi ;;
    gh)          echo "base" ;;
    *)           echo "" ;;
  esac
}

pkg_install() {
  if have apt-get; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null 2>&1
  elif have dnf;    then dnf install -y "$@" >/dev/null 2>&1
  else return 127; fi
}

# Alamat publik mesin ini. curl ke resolver eksternal adalah satu-satunya cara yang jujur di
# balik NAT; kegagalannya (offline) memulangkan string kosong dan gerbang DNS menolak apa adanya.
public_ip() { curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null | head -1; }
resolve_a() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | head -1; }

apply_base() { pkg_install curl git tmux ca-certificates build-essential python3 || pkg_install curl git tmux ca-certificates gcc gcc-c++ make python3; }
apply_node() { curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | bash - >/dev/null 2>&1 && pkg_install nodejs; }
apply_gh()   { pkg_install gh; }
apply_podman() {
  pkg_install podman || return 1
  id -u "$HANOMAN_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HANOMAN_DATA" "$HANOMAN_USER"
  sudo -u "$HANOMAN_USER" podman network exists hanoman-egress 2>/dev/null ||
    sudo -u "$HANOMAN_USER" podman network create --internal hanoman-egress >/dev/null 2>&1
}
apply_agent_image() {
  local cf="${CONTAINERFILE:-/tmp/hanoman-agent.Containerfile}"
  [ -f "$cf" ] || return 1
  sudo -u "$HANOMAN_USER" podman build -t "$IMAGE" -f "$cf" >/dev/null 2>&1
}
apply_claude() { npm i -g @anthropic-ai/claude-code >/dev/null 2>&1; }
apply_codex()  { npm i -g @openai/codex >/dev/null 2>&1; }

apply_hanoman() {
  id -u "$HANOMAN_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HANOMAN_DATA" "$HANOMAN_USER"
  install -d -o "$HANOMAN_USER" -g "$HANOMAN_USER" -m 0700 "$HANOMAN_DATA" || return 1
  npm i -g hanoman >/dev/null 2>&1 || return 1
  write_env || return 1
  write_unit || return 1
  systemctl daemon-reload >/dev/null 2>&1
  systemctl enable --now hanoman >/dev/null 2>&1
}

# Profil lab TIDAK menyetel NODE_ENV=production: gerbang assertRuntimeBoundary menuntut Podman,
# credential dir, dan egress proxy di sana. Konsekuensinya cookie sesi lahir tanpa flag `Secure`
# (server/src/services/auth.ts) — itu sebabnya profil lab tak boleh melayani permukaan Help publik.
write_env() {
  umask 077
  { echo "HANOMAN_HOME=$HANOMAN_DATA"
    echo "PORT=$HANOMAN_PORT"
    echo "HOST=127.0.0.1"
    echo "HANOMAN_TMUX_SOCKET=hanoman-prod"
    if [ "$PROFILE" = production ]; then
      echo "NODE_ENV=production"
      echo "HANOMAN_SESSION_SANDBOX=podman"
      echo "HANOMAN_SESSION_IMAGE=$IMAGE"
      echo "HANOMAN_SESSION_NETWORK=hanoman-egress"
      echo "HANOMAN_EGRESS_PROXY=${EGRESS_PROXY:-http://127.0.0.1:3128}"
      echo "HANOMAN_AGENT_CREDENTIAL_DIR=$HANOMAN_DATA/agent-credentials"
      echo "HANOMAN_TRUST_PROXY=1"
      echo "HANOMAN_SINGLE_ORIGIN=1"
      [ -n "$DOMAIN" ] && echo "HANOMAN_CONTROL_ORIGINS=https://$DOMAIN"
    fi
  } > /etc/hanoman.env
  chown "root:$HANOMAN_USER" /etc/hanoman.env 2>/dev/null
  chmod 0640 /etc/hanoman.env
}

write_unit() {
  cat > /etc/systemd/system/hanoman.service <<UNIT
[Unit]
Description=hanoman orchestrator + dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$HANOMAN_USER
Group=$HANOMAN_USER
WorkingDirectory=$HANOMAN_DATA
UMask=0077
Environment=HOME=$HANOMAN_DATA
EnvironmentFile=/etc/hanoman.env
ExecStart=/usr/bin/env hanoman
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
}

apply_caddy() {
  pkg_install caddy || return 1
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:$HANOMAN_PORT
}
CADDY
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || return 1
  systemctl enable --now caddy >/dev/null 2>&1
  systemctl reload caddy >/dev/null 2>&1
}

# Gerbang DNS mendahului instalasi apa pun: sertifikat ACME yang gagal terbit meninggalkan Caddy
# hidup tanpa TLS DAN membakar rate-limit Let's Encrypt. Menolak di depan jauh lebih murah.
caddy_gate() {
  [ -n "$DOMAIN" ] || { echo "domain-required"; return 1; }
  local want got
  want="$(public_ip)"; got="$(resolve_a "$DOMAIN")"
  [ -n "$got" ] || { echo "dns-unresolved $DOMAIN"; return 1; }
  [ "$got" = "$want" ] || { echo "dns-mismatch $got != ${want:-tak-diketahui}"; return 1; }
  return 0
}

# `probe_one` memulangkan status komponen tunggal — dipakai gerbang idempotensi.
probe_one() {
  case "$1" in
    base) probe_base ;; node) probe_node ;; hanoman) probe_hanoman ;; caddy) probe_caddy ;;
    podman) probe_podman ;; agent-image) probe_agent_image ;; gh) probe_gh ;;
    claude|codex) probe_agent_cli "$1" ;;
  esac | awk '{print $3}'
}

apply_one() {
  local id="$1"

  for d in $(deps_of "$id"); do
    if has_failed "$d"; then step "$id" skip "blocked-by $d"; mark_failed "$id"; return; fi
  done

  if [ "$id" = caddy ]; then
    local why
    if ! why="$(caddy_gate)"; then step caddy fail "$why"; mark_failed caddy; return; fi
  fi

  # Idempoten: komponen ber-login berhenti di `partial`, jadi `partial` DIANGGAP sudah terpasang
  # untuk mereka — memasang ulang biner tak membuat siapa pun login.
  local st; st="$(probe_one "$id")"
  if [ "$st" = ok ] || { [ "$st" = partial ] && case "$id" in claude|codex|gh) true ;; *) false ;; esac; }; then
    step "$id" skip "already-present"; return
  fi

  if [ -n "$DRY_RUN" ]; then step "$id" would "akan dipasang"; return; fi

  local rc=0
  case "$id" in
    base) apply_base || rc=$? ;; node) apply_node || rc=$? ;; hanoman) apply_hanoman || rc=$? ;;
    caddy) apply_caddy || rc=$? ;; podman) apply_podman || rc=$? ;;
    agent-image) apply_agent_image || rc=$? ;; claude) apply_claude || rc=$? ;;
    codex) apply_codex || rc=$? ;; gh) apply_gh || rc=$? ;;
    *) step "$id" fail "komponen tak dikenal"; mark_failed "$id"; return ;;
  esac

  if [ "$rc" -eq 0 ]; then step "$id" ok "terpasang"; else step "$id" fail "kode keluar $rc"; mark_failed "$id"; fi
}

do_apply() {
  IFS=',' read -ra arr <<< "${ITEMS:-}"
  for id in "${arr[@]}"; do [ -n "$id" ] && apply_one "$id"; done
}

case "$MODE" in
  probe) do_probe ;;
  apply) do_apply ;;
  *)     echo "STEP _ fail MODE tak dikenal: $MODE"; exit 2 ;;
esac
```

- [ ] **Step 4: Tulis `agent.Containerfile`**

Buat `server/scripts/vps/agent.Containerfile`:

```dockerfile
# SPEC-883 · ADR-0137 · image sesi agen untuk profil production (ADR-0117).
# Kredensial TIDAK pernah masuk image: sandboxArgv me-mount HANOMAN_AGENT_CREDENTIAL_DIR
# sebagai /agent-home:ro dan menyetel HOME=/agent-home.
FROM docker.io/library/node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm i -g @anthropic-ai/claude-code @openai/codex

WORKDIR /workspace
```

- [ ] **Step 5: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-script.test.ts
```
Expected: PASS (9 test — 4 dari Task 3 + 5 baru).

- [ ] **Step 6: Commit**

```bash
git add server/scripts/vps/provision.sh server/scripts/vps/agent.Containerfile server/test/vps-provision-script.test.ts
git commit -m "feat(spec-883): provision.sh mode apply, dry-run, gerbang DNS"
```

---

## Task 5: Service `vps-provision.ts`

**Files:**
- Create: `server/src/services/vps-provision.ts`
- Test: `server/test/vps-provision-parse.test.ts`

**Interfaces:**
- Consumes: `sshExec`, `SshTarget` (`services/vps-ssh.ts`); `scriptPath` (Task 1); `VpsRow` (`services/vps-audit.ts`).
- Produces:
  - `parseComponents(out: string): ComponentProbe[]`
  - `parseProvisionSteps(out: string): ProvisionStep[]`
  - `probeComponents(v: VpsRow): Promise<{ ok: true; components: ComponentProbe[] } | { ok: false; out: string }>`
  - `provision(v: VpsRow, items: ComponentId[], opts: { profile: ProvisionProfile; domain?: string; dryRun: boolean }): Promise<{ ok: boolean; steps: ProvisionStep[]; out: string }>`
  - `readSetupToken(v: VpsRow): Promise<string | null>`
  - `PROVISION_TIMEOUT_MS = 900_000`

- [ ] **Step 1: Tulis test parser yang gagal**

Buat `server/test/vps-provision-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseComponents, parseProvisionSteps } from "../src/services/vps-provision";

describe("SPEC-883 · parseComponents", () => {
  it("membaca baris COMP sah", () => {
    expect(parseComponents("COMP node ok v22.11.0\nCOMP gh absent")).toEqual([
      { id: "node", status: "ok", detail: "v22.11.0" },
      { id: "gh", status: "absent", detail: "" },
    ]);
  });

  it("mengabaikan baris di luar format, tanpa melempar (pola parseAudit)", () => {
    expect(parseComponents("sudo: a password is required\nCOMP base ok x\nSTEP base ok y"))
      .toEqual([{ id: "base", status: "ok", detail: "x" }]);
  });

  it("status tak dikenal diabaikan — bukan diterima sebagai ok", () => {
    expect(parseComponents("COMP node maybe siapa-tahu")).toEqual([]);
  });

  it("id di luar katalog diabaikan", () => {
    expect(parseComponents("COMP wat ok x")).toEqual([]);
  });
});

describe("SPEC-883 · parseProvisionSteps", () => {
  it("membaca keempat status termasuk skip", () => {
    const out = "STEP base ok terpasang\nSTEP node skip blocked-by base\nSTEP caddy fail dns-mismatch a != b\nSTEP gh would akan dipasang";
    expect(parseProvisionSteps(out)).toEqual([
      { item: "base", status: "ok", detail: "terpasang" },
      { item: "node", status: "skip", detail: "blocked-by base" },
      { item: "caddy", status: "fail", detail: "dns-mismatch a != b" },
      { item: "gh", status: "would", detail: "akan dipasang" },
    ]);
  });

  it("baris asing diabaikan", () => {
    expect(parseProvisionSteps("Reading package lists...\nSTEP base ok x")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-parse.test.ts
```
Expected: FAIL — modul tak ada.

- [ ] **Step 3: Tulis service**

Buat `server/src/services/vps-provision.ts`:

```ts
// SPEC-883 · ADR-0137 · provisioning VPS berbasis katalog. Jalur eksekusinya identik
// vps-remediate.ts: skrip deterministik dikirim lewat stdin ssh, keluaran di-parse per baris.
// Bukan sesi Claude — provisioning harus bisa diulang dan hasilnya harus bisa dibandingkan.
import { readFileSync } from "node:fs";
import type { ComponentId, ComponentProbe, ComponentStatus, ProvisionProfile, ProvisionStep } from "@hanoman/shared";
import { sshExec } from "./vps-ssh";
import { scriptPath, type VpsRow } from "./vps-audit";
import { componentById } from "../vps/catalog/components";

// `npm i -g` + build image bisa jauh melewati 300 dtk yang dipakai remediate. sshExec
// SIGKILL pada timeout tetapi TETAP memulangkan `out` yang sudah terkumpul, jadi kegagalan
// karena timeout tetap terbaca sebagai transcript parsial, bukan layar kosong.
export const PROVISION_TIMEOUT_MS = 900_000;
const PROBE_TIMEOUT_MS = 60_000;

const STATUSES: ComponentStatus[] = ["ok", "partial", "absent"];

// Baris di luar format diabaikan diam-diam (pola parseAudit/parseSteps): keluaran nyata
// bercampur peringatan apt, banner sudo, dan motd.
export function parseComponents(out: string): ComponentProbe[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^COMP (\S+) (\S+)(?: (.*))?$/);
    if (!m) return [];
    const [, id, status] = m;
    if (!componentById(id!)) return [];
    if (!STATUSES.includes(status as ComponentStatus)) return [];
    return [{ id: id as ComponentId, status: status as ComponentStatus, detail: (m[3] ?? "").trim() }];
  });
}

export function parseProvisionSteps(out: string): ProvisionStep[] {
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^STEP (\S+) (would|ok|fail|skip)(?: (.*))?$/);
    return m ? [{ item: m[1]!, status: m[2] as ProvisionStep["status"], detail: (m[3] ?? "").trim() }] : [];
  });
}

const script = (): string => readFileSync(scriptPath("provision.sh"), "utf8");

// Probe TIDAK memakai sudo: setiap pemeriksaannya (`command -v`, `--version`, `systemctl
// is-active`) bekerja sebagai user biasa. `sudo -n` yang meminta password menghasilkan keluaran
// tanpa satu pun baris protokol — dan itu akan terbaca sebagai "semua absent", bukan "gagal".
export async function probeComponents(v: VpsRow):
  Promise<{ ok: true; components: ComponentProbe[] } | { ok: false; out: string }> {
  const r = await sshExec(v, "env MODE=probe bash -s", { stdin: script(), timeoutMs: PROBE_TIMEOUT_MS });
  const components = parseComponents(r.out);
  if (r.code !== 0 || components.length === 0) return { ok: false, out: r.out };
  return { ok: true, components };
}

export async function provision(
  v: VpsRow,
  items: ComponentId[],
  opts: { profile: ProvisionProfile; domain?: string; dryRun: boolean },
): Promise<{ ok: boolean; steps: ProvisionStep[]; out: string }> {
  // items sudah divalidasi & diurutkan resolveComponents; profile/domain sudah lewat zod
  // (enum + HOST_RE), jadi aman dirangkai ke `env` — pola yang sama dengan vps-remediate.
  const env = [
    "MODE=apply",
    `ITEMS=${items.join(",")}`,
    `PROFILE=${opts.profile}`,
    ...(opts.domain ? [`DOMAIN=${opts.domain}`] : []),
    ...(opts.dryRun ? ["DRY_RUN=1"] : []),
  ].join(" ");
  const r = await sshExec(v, `sudo -n env ${env} bash -s`, { stdin: script(), timeoutMs: PROVISION_TIMEOUT_MS });
  return { ok: r.code === 0, steps: parseProvisionSteps(r.out), out: r.out };
}

// Setup token dibaca sebagai user service, satu baris pertama saja (services/bootstrap.ts
// menulis "<token>\n<expiry ISO>\n"). Nilainya TAK PERNAH disimpan, di-log, atau dipulangkan
// endpoint lain — ia hanya lewat sekali di badan respons provision.
export async function readSetupToken(v: VpsRow, home = "/var/lib/hanoman"): Promise<string | null> {
  const r = await sshExec(v, `sudo -n cat ${home}/setup.token`, { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  const [token, expires] = r.out.trim().split("\n");
  if (!token || !expires) return null;
  return Date.parse(expires) > Date.now() ? token : null;
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-parse.test.ts
```
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/vps-provision.ts server/test/vps-provision-parse.test.ts
git commit -m "feat(spec-883): service vps-provision (parser, probe, apply, setup token)"
```

---

## Task 6: Skema — tiga kolom additif, local-only

**Files:**
- Modify: `server/prisma/schema.prisma:281-298` (model `Vps`)
- Create: `server/prisma/migrations/20260822120000_vps_provision/migration.sql`
- Test: `server/test/vps-provision-contract.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `Vps.components` (Json?), `Vps.componentsCheckedAt` (DateTime?), `Vps.provisionProfile` (String?). Task 7 menulisnya.

- [ ] **Step 1: Tulis test kontrak yang gagal**

Buat `server/test/vps-provision-contract.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { __FIELDS } from "../src/services/sync";

const vpsModel = Prisma.dmmf.datamodel.models.find((m) => m.name === "Vps")!;
const field = (name: string) => vpsModel.fields.find((f) => f.name === name);

describe("SPEC-883 · kolom provisioning", () => {
  it("ketiganya ada dan nullable", () => {
    expect(field("components")).toMatchObject({ type: "Json", isRequired: false });
    expect(field("componentsCheckedAt")).toMatchObject({ type: "DateTime", isRequired: false });
    expect(field("provisionProfile")).toMatchObject({ type: "String", isRequired: false });
  });

  // SPEC-880: kolom baru di snapshot() dikirim pada SETIAP push, sehingga hub yang lebih tua
  // menolak seluruh push entitas itu. Status komponen juga milik mesin pemegang key SSH.
  it("TIDAK ikut sync", () => {
    for (const f of ["components", "componentsCheckedAt", "provisionProfile"]) {
      expect(__FIELDS.vps).not.toContain(f);
    }
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-contract.test.ts
```
Expected: FAIL — `field("components")` `undefined`.

- [ ] **Step 3: Tambahkan kolom ke schema**

Di `server/prisma/schema.prisma`, di dalam `model Vps`, sesudah baris `hardened`:

```prisma
  // SPEC-883 · ADR-0137 · hasil MODE=probe provision.sh: { [ComponentId]: { status, detail } }.
  // DITULIS HANYA dari probe, tak pernah dari niat "kami barusan memasang X" (SPEC-487).
  // LOCAL-ONLY: ketiganya sengaja di luar FIELDS.vps (pelajaran SPEC-880).
  components          Json?
  componentsCheckedAt DateTime?
  provisionProfile    String? // "lab" | "production" — profil yang terakhir diterapkan
```

- [ ] **Step 4: Tulis migration tangan**

Buat `server/prisma/migrations/20260822120000_vps_provision/migration.sql`:

```sql
-- SPEC-883 · ADR-0137 · penandaan komponen hasil probe + profil provisioning.
--
-- Ditulis tangan (bukan `migrate dev`): worktree tetangga membuat `migrate dev` me-reset DB saat
-- ada drift. ADITIF murni — tiga kolom NULLABLE tanpa default, tak ada tabel diredefinisi.
--
-- TANPA backfill, sengaja: sebelum spec ini status komponen memang tak pernah diukur di mana pun.
-- NULL = "belum diperiksa", dan itu jawaban yang jujur — bukan "tak ada komponen".
ALTER TABLE "Vps" ADD COLUMN "components" JSONB;
ALTER TABLE "Vps" ADD COLUMN "componentsCheckedAt" DATETIME;
ALTER TABLE "Vps" ADD COLUMN "provisionProfile" TEXT;
```

- [ ] **Step 5: Terapkan migrasi & generate client**

```bash
cd server && pnpm prisma migrate deploy && pnpm prisma generate && cd ..
```
Expected: `1 migration applied` lalu `Generated Prisma Client`.

- [ ] **Step 6: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-contract.test.ts
```
Expected: PASS (2 test).

- [ ] **Step 7: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/20260822120000_vps_provision server/test/vps-provision-contract.test.ts
git commit -m "feat(spec-883): kolom components/componentsCheckedAt/provisionProfile (local-only)"
```

---

## Task 7: Endpoint provisioning

**Files:**
- Modify: `server/src/routes/vps.ts` (sesudah blok remediate, sebelum `harden`)
- Modify: `shared/src/api.ts` (sesudah `vpsRemediate`, ±baris 141)
- Modify: `server/test/fixtures/fake-ssh.sh`
- Test: `server/test/vps-provision.route.test.ts`, `server/test/vps-provision-setup.test.ts`

**Interfaces:**
- Consumes: `resolveComponents`, `COMPONENTS` (Task 2); `probeComponents`, `provision`, `readSetupToken` (Task 5); kolom DB (Task 6).
- Produces: empat endpoint + path helper `vpsComponents`, `vpsProbe`, `vpsProvisionPreview`, `vpsProvision`.

- [ ] **Step 1: Ajari fixture ssh mengenali provision.sh**

Di `server/test/fixtures/fake-ssh.sh`, sisipkan **sebelum** cabang `hanoman-remediate`:

```bash
# SPEC-883 · provision.sh: MODE=probe → COMP, MODE=apply → STEP (would bila DRY_RUN=1).
if [[ "$input" == *"hanoman-provision"* ]]; then
  if [[ "$last" == *"MODE=probe"* ]]; then
    if [ "${FAKE_SSH_MODE:-}" = "probe-garbage" ]; then echo "sudo: a password is required"; exit 0; fi
    echo "COMP base ok git+tmux+curl"
    echo "COMP node ok v22.11.0"
    if [ "${FAKE_SSH_MODE:-}" = "hanoman-present" ]; then echo "COMP hanoman ok 1.4.2"
    else echo "COMP hanoman absent"; fi
    echo "COMP caddy absent"; echo "COMP podman absent"; echo "COMP agent-image absent"
    echo "COMP claude partial not-logged-in 1.2.3"
    echo "COMP codex absent"; echo "COMP gh absent"
    exit 0
  fi
  items=$(echo "$last" | sed -n 's/.*ITEMS=\([^ ]*\).*/\1/p')
  mode=ok; [[ "$last" == *"DRY_RUN=1"* ]] && mode=would
  IFS=',' read -ra arr <<< "$items"
  for it in "${arr[@]}"; do echo "STEP $it $mode dipasang(fake)"; done
  exit 0
fi

# SPEC-883 · pembacaan setup token (perintah remote `sudo -n cat …/setup.token`).
if [[ "$last" == *"setup.token"* ]]; then
  case "${FAKE_SSH_MODE:-}" in
    setup-expired) echo "tok-lama"; echo "2020-01-01T00:00:00.000Z"; exit 0 ;;
    setup-absent)  echo "cat: setup.token: No such file" >&2; exit 1 ;;
    *)             echo "tok-baru"; date -u -v+15M +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -d "+15 minutes" +"%Y-%m-%dT%H:%M:%S.000Z"; exit 0 ;;
  esac
fi
```

- [ ] **Step 2: Tulis test route yang gagal**

Buat `server/test/vps-provision.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; delete process.env.FAKE_SSH_MODE; });

describe("SPEC-883 · GET /vps/components", () => {
  it("memulangkan katalog lengkap", async () => {
    const res = await app.inject({ method: "GET", url: "/api/vps/components" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().components.map((c: { id: string }) => c.id);
    expect(ids).toContain("hanoman");
    expect(ids).toContain("agent-image");
  });
});

describe("SPEC-883 · POST /vps/:id/probe", () => {
  it("menulis components + componentsCheckedAt", async () => {
    const v = await makeVps({ name: "pb1", host: "198.51.100.11" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/probe` });
    expect(res.statusCode).toBe(200);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect((row.components as Record<string, { status: string }>).node.status).toBe("ok");
    expect((row.components as Record<string, { status: string }>).claude.status).toBe("partial");
    expect(row.componentsCheckedAt).toBeInstanceOf(Date);
  });

  it("keluaran tanpa satu pun baris COMP = gagal, BUKAN 'semua absent'", async () => {
    const v = await makeVps({ name: "pb2", host: "198.51.100.12" });
    process.env.FAKE_SSH_MODE = "probe-garbage";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/probe` });
    expect(res.statusCode).toBe(502);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.components).toBeNull();
  });

  it("vps tak dikenal → 404", async () => {
    const res = await app.inject({ method: "POST", url: "/api/vps/hantu/probe" });
    expect(res.statusCode).toBe(404);
  });
});

describe("SPEC-883 · POST /vps/:id/provision/preview", () => {
  it("menutup dependensi & memulangkan would, tak menyentuh DB", async () => {
    const v = await makeVps({ name: "pv1", host: "198.51.100.13" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["hanoman"], profile: "lab" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.map((s: { item: string }) => s.item)).toEqual(["base", "node", "hanoman"]);
    expect(res.json().steps.every((s: { status: string }) => s.status === "would")).toBe(true);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.components).toBeNull();
  });

  it("caddy tanpa domain → 400", async () => {
    const v = await makeVps({ name: "pv2", host: "198.51.100.14" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["caddy"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });

  it("komponen di luar profil → 400", async () => {
    const v = await makeVps({ name: "pv3", host: "198.51.100.15" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["agent-image"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });

  it("id tak dikenal → 400", async () => {
    const v = await makeVps({ name: "pv4", host: "198.51.100.16" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision/preview`,
      payload: { items: ["wat"], profile: "lab" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("SPEC-883 · POST /vps/:id/provision", () => {
  it("tanpa confirm → 409 confirm-required beserta langkah dry-run", async () => {
    const v = await makeVps({ name: "ap1", host: "198.51.100.17" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("confirm-required");
    expect(res.json().steps.every((s: { status: string }) => s.status === "would")).toBe(true);
  });

  it("dengan confirm → apply + probe ulang tersimpan + profil tercatat", async () => {
    const v = await makeVps({ name: "ap2", host: "198.51.100.18" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().steps.every((s: { status: string }) => s.status === "ok")).toBe(true);
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.provisionProfile).toBe("lab");
    expect(row.componentsCheckedAt).toBeInstanceOf(Date);
  });

  it("profil berbeda pada instance yang sudah ada hanoman → 409 profile-mismatch", async () => {
    const v = await makeVps({ name: "ap3", host: "198.51.100.19",
      provisionProfile: "lab", components: { hanoman: { status: "ok", detail: "1.4.2" } } });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "production", confirm: true } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("profile-mismatch");
    expect(res.json().current).toBe("lab");
  });

  it("force menembus profile-mismatch", async () => {
    const v = await makeVps({ name: "ap4", host: "198.51.100.20",
      provisionProfile: "lab", components: { hanoman: { status: "ok", detail: "1.4.2" } } });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "production", confirm: true, force: true } });
    expect(res.statusCode).toBe(200);
  });

  it("ssh mati → 502 dengan transcript, DB tak berubah", async () => {
    const v = await makeVps({ name: "ap5", host: "198.51.100.21" });
    process.env.FAKE_SSH_MODE = "unreachable";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(502);
    expect(res.json().transcript).toBeTruthy();
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.provisionProfile).toBeNull();
  });

  it("key hilang di mesin ini → 409 keyMissing", async () => {
    const v = await makeVps({ name: "ap6", host: "198.51.100.22", keyPath: "/tak/ada/key" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { items: ["node"], profile: "lab", confirm: true } });
    expect(res.statusCode).toBe(409);
    expect(res.json().keyMissing).toBe(true);
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision.route.test.ts
```
Expected: FAIL — semua route 404.

- [ ] **Step 4: Tambahkan path helper**

Di `shared/src/api.ts`, sesudah `vpsRemediate`:

```ts
  // SPEC-883 · provisioning berbasis katalog
  vpsComponents: () => `${API}/vps/components`,
  vpsProbe: (id: string) => `${API}/vps/${id}/probe`,
  vpsProvisionPreview: (id: string) => `${API}/vps/${id}/provision/preview`,
  vpsProvision: (id: string) => `${API}/vps/${id}/provision`,
```

- [ ] **Step 5: Tulis endpoint**

Di `server/src/routes/vps.ts`, tambahkan impor:

```ts
import { zProvision, type ComponentId, type ProvisionProfile, type VpsComponents } from "@hanoman/shared";
import { COMPONENTS, componentById, resolveComponents } from "../vps/catalog/components";
import { probeComponents, provision, readSetupToken } from "../services/vps-provision";
```

Lalu sisipkan sesudah endpoint `remediate` (sebelum komentar `// Harden TIDAK PERNAH terjadwal`):

```ts
  // SPEC-883 · ADR-0137 · katalog komponen. GET statis: frontend tak mengimpor katalog server
  // (pola checklist SPEC-220). Route ini didaftarkan SEBELUM "/vps/:id" tak masalah — Fastify
  // memberi prioritas pada segmen statis atas parameter, jadi "components" tak pernah dibaca
  // sebagai id.
  app.get("/vps/components", async () => ({ components: COMPONENTS }));

  // Validasi seleksi: id dikenal, tersedia di profil, dependensi tertutup & terurut,
  // dan `domain` hadir bila ada komponen yang menuntutnya.
  function planItems(items: ComponentId[], profile: ProvisionProfile, domain?: string):
    { ok: true; items: ComponentId[] } | { ok: false; error: string } {
    const r = resolveComponents(items, profile);
    if (!r.ok) return r;
    const needsDomain = r.items.some((id) => componentById(id)?.needsDomain);
    if (needsDomain && !domain) return { ok: false, error: "domain wajib untuk komponen ingress" };
    return r;
  }

  // Probe = SATU-SATUNYA penulis `components`. Niat tak pernah menulis penandaan (SPEC-487).
  async function runProbe(v: { id: string; host: string; port: number; user: string; keyPath: string | null }) {
    const r = await probeComponents(v);
    if (!r.ok) return r;
    const map: VpsComponents = {};
    for (const c of r.components) map[c.id] = { status: c.status, detail: c.detail };
    const checkedAt = new Date();
    await prisma.vps.update({ where: { id: v.id }, data: { components: map, componentsCheckedAt: checkedAt } });
    return { ok: true as const, components: r.components, checkedAt };
  }

  app.post("/vps/:id/probe", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const r = await runProbe(v);
    if (!r.ok) return reply.code(502).send({ error: "probe gagal lewat ssh", out: r.out });
    return { components: r.components, checkedAt: r.checkedAt.toISOString() };
  });

  app.post("/vps/:id/provision/preview", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const p = zProvision.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const plan = planItems(p.data.items, p.data.profile, p.data.domain);
    if (!plan.ok) return reply.code(400).send({ error: plan.error });
    const r = await provision(v, plan.items, { profile: p.data.profile, domain: p.data.domain, dryRun: true });
    if (!r.ok) return reply.code(502).send({ error: "preview gagal lewat ssh", out: r.out });
    return { steps: r.steps };
  });

  // Dua langkah seperti POST /api/update/apply (ADR-0088): tanpa `confirm` ia dry-run dan
  // memulangkan 409 berisi langkah-langkahnya, jadi UI tak pernah meminta persetujuan atas
  // rencana yang belum pernah dihitung.
  app.post("/vps/:id/provision", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const p = zProvision.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const plan = planItems(p.data.items, p.data.profile, p.data.domain);
    if (!plan.ok) return reply.code(400).send({ error: plan.error });

    if (!p.data.confirm) {
      const dry = await provision(v, plan.items, { profile: p.data.profile, domain: p.data.domain, dryRun: true });
      if (!dry.ok) return reply.code(502).send({ error: "dry-run gagal lewat ssh", out: dry.out });
      return reply.code(409).send({ error: "confirm-required", steps: dry.steps });
    }

    // Menulis ulang /etc/hanoman.env dari lab ke production membuat service menolak boot sampai
    // Podman siap — itu memutus instance yang sedang dipakai, bukan sekadar mengubah setelan.
    const installed = (v.components as VpsComponents | null)?.hanoman?.status === "ok";
    if (installed && v.provisionProfile && v.provisionProfile !== p.data.profile && !p.data.force) {
      return reply.code(409).send({ error: "profile-mismatch", current: v.provisionProfile });
    }

    const r = await provision(v, plan.items, { profile: p.data.profile, domain: p.data.domain, dryRun: false });
    if (!r.ok) return reply.code(502).send({ error: "provision gagal lewat ssh", transcript: r.out, steps: r.steps });

    const probe = await runProbe(v);
    if (!probe.ok) return reply.code(502).send({ error: "probe pasca-provision gagal", transcript: r.out, steps: r.steps });
    await prisma.vps.update({ where: { id: v.id }, data: { provisionProfile: p.data.profile } });

    // Serah-terima: token transien, hanya lewat sekali di badan respons ini.
    let setup: { url: string; expiresAt: string } | null = null;
    const hanomanOk = probe.components.some((c) => c.id === "hanoman" && c.status === "ok");
    if (hanomanOk) {
      const token = await readSetupToken(v);
      if (token) {
        const base = p.data.domain ? `https://${p.data.domain}` : `http://${v.host}:8787`;
        setup = { url: `${base}/setup?token=${encodeURIComponent(token)}`,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
      }
    }
    return { steps: r.steps, components: probe.components,
      checkedAt: probe.checkedAt.toISOString(), setup };
  });
```

- [ ] **Step 6: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision.route.test.ts
```
Expected: PASS (13 test).

- [ ] **Step 7: Tulis test serah-terima**

Buat `server/test/vps-provision-setup.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeVps } from "./factory";

const FAKE_SSH = fileURLToPath(new URL("./fixtures/fake-ssh.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
beforeAll(async () => { await resetDb(); });
beforeEach(() => { process.env.HANOMAN_SSH_BIN = FAKE_SSH; process.env.FAKE_SSH_MODE = "hanoman-present"; });

const provisionBody = { items: ["node"], profile: "lab", confirm: true };

describe("SPEC-883 · serah-terima setup token", () => {
  it("hanoman ok + token hidup → tautan setup siap klik", async () => {
    const v = await makeVps({ name: "st1", host: "198.51.100.31" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`,
      payload: { ...provisionBody, domain: "contoh.test" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().setup.url).toBe("https://contoh.test/setup?token=tok-baru");
    expect(Date.parse(res.json().setup.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("tanpa domain → tautan jatuh ke host:8787", async () => {
    const v = await makeVps({ name: "st2", host: "198.51.100.32" });
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup.url).toBe("http://198.51.100.32:8787/setup?token=tok-baru");
  });

  it("token kedaluwarsa → setup null, bukan tautan mati", async () => {
    const v = await makeVps({ name: "st3", host: "198.51.100.33" });
    process.env.FAKE_SSH_MODE = "setup-expired";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup).toBeNull();
  });

  it("token tak ada (admin sudah dibuat) → setup null", async () => {
    const v = await makeVps({ name: "st4", host: "198.51.100.34" });
    process.env.FAKE_SSH_MODE = "setup-absent";
    const res = await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    expect(res.json().setup).toBeNull();
  });

  it("token TIDAK PERNAH tersimpan ke DB", async () => {
    const v = await makeVps({ name: "st5", host: "198.51.100.35" });
    await app.inject({ method: "POST", url: `/api/vps/${v.id}/provision`, payload: provisionBody });
    const row = await prisma.vps.findUniqueOrThrow({ where: { id: v.id } });
    expect(JSON.stringify(row)).not.toContain("tok-baru");
  });
});
```

Catatan untuk pelaksana: `FAKE_SSH_MODE` di fixture mengontrol **satu** cabang pada satu waktu. Cabang `setup-expired`/`setup-absent` di Step 1 tak memengaruhi cabang probe, jadi `COMP hanoman` di kedua test itu memulangkan `absent` — sesuaikan fixture bila test menuntut keduanya sekaligus (tambahkan `hanoman-present` ke daftar `case` yang menerbitkan `COMP hanoman ok`).

- [ ] **Step 8: Jalankan, pastikan lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/vps-provision-setup.test.ts server/test/vps-provision.route.test.ts server/test/vps-remediate.route.test.ts server/test/vps.route.test.ts
```
Expected: PASS semua — termasuk suite VPS lama, yang membuktikan fixture baru tak merusak cabang lama.

- [ ] **Step 9: Commit**

```bash
git add server/src/routes/vps.ts shared/src/api.ts server/test/fixtures/fake-ssh.sh server/test/vps-provision.route.test.ts server/test/vps-provision-setup.test.ts
git commit -m "feat(spec-883): endpoint katalog, probe, preview, provision + serah-terima setup"
```

---

## Task 8: UI — panel toggle, lencana, kartu serah-terima

**Files:**
- Create: `src/src/screens/VpsProvision.tsx`
- Modify: `src/src/api/client.ts` (sesudah `remediate`, ±baris 456), `src/src/screens/VpsScreen.tsx`
- Test: `src/test/vps-provision.test.tsx`

**Interfaces:**
- Consumes: `paths.vpsComponents/vpsProbe/vpsProvisionPreview/vpsProvision` (Task 7); tipe dari `@hanoman/shared` (Task 2).
- Produces: `<VpsProvisionPanel vps={v} onToast={…} onGotoTerminal={…} />`, `<ComponentBadges components={…} checkedAt={…} />`.

- [ ] **Step 1: Tambahkan metode API client**

Di `src/src/api/client.ts`, sesudah `remediate`:

```ts
  listVpsComponents: () => j<{ components: ProvisionComponent[] }>(paths.vpsComponents()),
  probeVps: (id: string) =>
    j<{ components: ComponentProbe[]; checkedAt: string }>(paths.vpsProbe(id), { method: "POST" }),
  provisionPreview: (id: string, body: { items: ComponentId[]; profile: ProvisionProfile; domain?: string }) =>
    j<{ steps: ProvisionStep[] }>(paths.vpsProvisionPreview(id), { method: "POST", body: JSON.stringify(body) }),
  provisionVps: (id: string, body: { items: ComponentId[]; profile: ProvisionProfile; domain?: string; confirm: boolean; force?: boolean }) =>
    j<ProvisionResult>(paths.vpsProvision(id), { method: "POST", body: JSON.stringify(body) }),
```

Tambahkan tipe-tipe itu ke blok `import type { … } from "@hanoman/shared"` di kepala berkas.

- [ ] **Step 2: Tulis test UI yang gagal**

Buat `src/test/vps-provision.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { VpsProvisionPanel, ComponentBadges } from "../src/screens/VpsProvision";
import { api } from "../src/api/client";

const VPS = { id: "v1", name: "vps1", host: "203.0.113.10", port: 22, user: "deploy",
  keyPath: null, createdAt: "", lastSeenAt: null, health: null, lastAuditAt: null,
  audit: null, hardened: false } as never;

const CATALOG = [
  { id: "base", label: "Paket dasar", section: "dasar", requires: { lab: [], production: [] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "node", label: "Node.js 22 LTS", section: "dasar", requires: { lab: ["base"], production: ["base"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "hanoman", label: "hanoman", section: "hanoman", requires: { lab: ["node"], production: ["node", "podman"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "caddy", label: "Caddy + TLS", section: "ingress", requires: { lab: [], production: [] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: true },
  { id: "podman", label: "Podman", section: "sandbox", requires: { lab: ["base"], production: ["base"] },
    profiles: ["lab", "production"], interactiveLogin: false, needsDomain: false },
  { id: "claude", label: "Claude Code CLI", section: "agen", requires: { lab: ["node"], production: ["agent-image"] },
    profiles: ["lab", "production"], interactiveLogin: true, needsDomain: false },
];

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(api, "listVpsComponents").mockResolvedValue({ components: CATALOG as never });
});

describe("SPEC-883 · lencana komponen", () => {
  it("belum pernah diprobe → 'belum diperiksa', bukan deretan strip", () => {
    render(<ComponentBadges components={null} checkedAt={null} />);
    expect(screen.getByText(/belum diperiksa/i)).toBeTruthy();
  });

  it("partial ditampilkan sebagai 'belum login', bukan terpasang", () => {
    render(<ComponentBadges checkedAt="2026-08-22T00:00:00.000Z"
      components={{ claude: { status: "partial", detail: "not-logged-in 1.2.3" } } as never} />);
    expect(screen.getByText(/belum login/i)).toBeTruthy();
  });
});

describe("SPEC-883 · panel provisioning", () => {
  it("mencentang hanoman ikut mencentang & mengunci prasyaratnya", async () => {
    render(<VpsProvisionPanel vps={VPS} onToast={() => {}} onGotoTerminal={() => {}} />);
    await waitFor(() => screen.getByLabelText("hanoman"));
    fireEvent.click(screen.getByLabelText("hanoman"));
    const base = screen.getByLabelText("Paket dasar") as HTMLInputElement;
    const node = screen.getByLabelText("Node.js 22 LTS") as HTMLInputElement;
    expect(base.checked).toBe(true);
    expect(node.checked).toBe(true);
    expect(base.disabled).toBe(true);
  });

  it("field domain muncul hanya saat caddy menyala, dan Pratinjau terkunci tanpa isinya", async () => {
    render(<VpsProvisionPanel vps={VPS} onToast={() => {}} onGotoTerminal={() => {}} />);
    await waitFor(() => screen.getByLabelText("Caddy + TLS"));
    expect(screen.queryByLabelText(/domain/i)).toBeNull();
    fireEvent.click(screen.getByLabelText("Caddy + TLS"));
    expect(screen.getByLabelText(/domain/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /pratinjau/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("profil production menyembunyikan komponen yang tak tersedia di sana", async () => {
    render(<VpsProvisionPanel vps={VPS} onToast={() => {}} onGotoTerminal={() => {}} />);
    await waitFor(() => screen.getByLabelText("Node.js 22 LTS"));
    fireEvent.click(screen.getByLabelText(/production/i));
    expect(screen.getByLabelText("Claude Code CLI")).toBeTruthy();
  });

  it("Pratinjau menampilkan langkah would", async () => {
    vi.spyOn(api, "provisionPreview").mockResolvedValue({
      steps: [{ item: "base", status: "would", detail: "akan dipasang" }] });
    render(<VpsProvisionPanel vps={VPS} onToast={() => {}} onGotoTerminal={() => {}} />);
    await waitFor(() => screen.getByLabelText("Paket dasar"));
    fireEvent.click(screen.getByLabelText("Paket dasar"));
    fireEvent.click(screen.getByRole("button", { name: /pratinjau/i }));
    await waitFor(() => expect(screen.getByText(/akan dipasang/)).toBeTruthy());
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
pnpm vitest --run src/test/vps-provision.test.tsx
```
Expected: FAIL — modul `../src/screens/VpsProvision` tak ada.

- [ ] **Step 4: Tulis komponen**

Buat `src/src/screens/VpsProvision.tsx`:

```tsx
/* SPEC-883 · ADR-0137 · panel provisioning + lencana komponen. Dipisah dari VpsScreen supaya
   keduanya tetap satu tanggung jawab: VpsScreen mengurus daftar & CRUD, berkas ini mengurus
   "apa yang ada di mesin itu dan apa yang mau dipasang". */
import React from "react";
import { Button, Field, Input, StateBlock, Icon, useConfirm } from "../ds";
import { api } from "../api/client";
import { usePersistedState } from "../ui-state";
import type {
  ComponentId, ComponentProbe, ProvisionComponent, ProvisionProfile, ProvisionStep, VpsComponents, VpsView,
} from "@hanoman/shared";

const STATUS_LABEL: Record<string, string> = {
  ok: "terpasang", partial: "belum login", absent: "belum ada" };
const STATUS_COLOR: Record<string, string> = {
  ok: "var(--leaf-600)", partial: "var(--amber-600)", absent: "var(--text-subtle)" };

// `partial` pada komponen ber-login SELALU berbunyi "belum login" — status itu satu-satunya
// yang jujur tentang biner yang ada tapi belum siap (SPEC-487, marker ≠ bukti).
function badgeText(id: string, entry: { status: string; detail: string }): string {
  if (entry.status === "partial" && entry.detail.startsWith("not-logged-in")) return `${id} · belum login`;
  if (entry.status === "partial") return `${id} · ${entry.detail || "belum siap"}`;
  return `${id} · ${STATUS_LABEL[entry.status] ?? entry.status}${entry.detail ? ` ${entry.detail}` : ""}`;
}

export function ComponentBadges({ components, checkedAt }:
  { components: VpsComponents | null; checkedAt: string | null }) {
  if (!components || !checkedAt) {
    return <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Komponen belum diperiksa</span>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {Object.entries(components).map(([id, entry]) => (
        <span key={id} style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
          color: STATUS_COLOR[entry.status], border: `1px solid ${STATUS_COLOR[entry.status]}`,
          borderRadius: 3, padding: "0 4px", whiteSpace: "nowrap" }}>{badgeText(id, entry)}</span>
      ))}
      <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
        diperiksa {new Date(checkedAt).toLocaleString("id-ID")}
      </span>
    </div>
  );
}

// Penutupan dependensi di klien HANYA untuk mengunci checkbox & memberi alasan. Server tetap
// menghitung ulang lewat resolveComponents — klien tak pernah jadi otoritas.
function closure(ids: Set<ComponentId>, catalog: ProvisionComponent[], profile: ProvisionProfile): Set<ComponentId> {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out = new Set<ComponentId>();
  const visit = (id: ComponentId) => {
    if (out.has(id)) return;
    out.add(id);
    for (const dep of byId.get(id)?.requires[profile] ?? []) visit(dep);
  };
  for (const id of ids) visit(id);
  return out;
}

export function VpsProvisionPanel({ vps, onToast, onGotoTerminal }: {
  vps: VpsView & { components?: VpsComponents | null; componentsCheckedAt?: string | null };
  onToast: (msg: string, kind?: string, icon?: string) => void;
  onGotoTerminal: (sessionId: string) => void;
}) {
  const [catalog, setCatalog] = React.useState<ProvisionComponent[]>([]);
  const [profile, setProfile] = usePersistedState<ProvisionProfile>(
    "vps", `provisionProfile@${vps.id}`, "lab", (v) => (v === "production" ? "production" : "lab"));
  const [picked, setPicked] = React.useState<Set<ComponentId>>(new Set());
  const [domain, setDomain] = React.useState("");
  const [steps, setSteps] = React.useState<ProvisionStep[] | null>(null);
  const [probe, setProbe] = React.useState<{ components: ComponentProbe[]; checkedAt: string } | null>(null);
  const [setup, setSetup] = React.useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  React.useEffect(() => { api.listVpsComponents().then((r) => setCatalog(r.components)).catch(() => setCatalog([])); }, []);

  const visible = catalog.filter((c) => c.profiles.includes(profile));
  const required = closure(picked, catalog, profile);
  const needsDomain = [...required].some((id) => catalog.find((c) => c.id === id)?.needsDomain);
  const canRun = required.size > 0 && (!needsDomain || domain.trim().length > 0);
  const items = [...required];

  function toggle(id: ComponentId) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function doProbe() {
    setBusy("probe");
    try { setProbe(await api.probeVps(vps.id)); onToast("Komponen diperiksa", "ok", "server"); }
    catch { onToast("Probe gagal", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  async function doPreview() {
    setBusy("preview");
    try { setSteps((await api.provisionPreview(vps.id, { items, profile, domain: domain || undefined })).steps); }
    catch { onToast("Pratinjau gagal", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  async function doApply() {
    if (!await confirm({
      title: `Pasang ${items.length} komponen di "${vps.name}"?`,
      message: `Profil ${profile}. Langkah dijalankan lewat SSH dan bisa memakan beberapa menit.`,
      impact: items.map((id) => catalog.find((c) => c.id === id)?.label ?? id),
      confirmLabel: "Pasang", icon: "server",
    })) return;
    setBusy("apply");
    try {
      const r = await api.provisionVps(vps.id, { items, profile, domain: domain || undefined, confirm: true });
      setSteps(r.steps);
      setProbe({ components: r.components, checkedAt: r.checkedAt });
      setSetup(r.setup);
      onToast("Provisioning selesai", "ok", "server");
    } catch { onToast("Provisioning gagal", "err", "x-circle"); }
    finally { setBusy(null); }
  }

  const openConsole = async () => {
    try { const { id } = await api.vpsConsole(vps.id); onGotoTerminal(id); }
    catch { onToast("Gagal membuka console", "err", "x-circle"); }
  };

  const current: VpsComponents | null = probe
    ? Object.fromEntries(probe.components.map((c) => [c.id, { status: c.status, detail: c.detail }]))
    : (vps.components ?? null);
  const checkedAt = probe?.checkedAt ?? vps.componentsCheckedAt ?? null;
  const pending = current
    ? Object.entries(current).filter(([, e]) => e.status === "partial" && e.detail.startsWith("not-logged-in"))
    : [];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <ComponentBadges components={current} checkedAt={checkedAt} />
        <Button onClick={doProbe} disabled={busy !== null}>Periksa</Button>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        {(["lab", "production"] as ProvisionProfile[]).map((p) => (
          <label key={p} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12 }}>
            <input type="radio" aria-label={p} checked={profile === p} onChange={() => setProfile(p)} />
            {p}
          </label>
        ))}
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        {visible.map((c) => {
          const auto = required.has(c.id) && !picked.has(c.id);
          return (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
              <input type="checkbox" aria-label={c.label} checked={required.has(c.id)}
                disabled={auto} onChange={() => toggle(c.id)} />
              {c.label}
              {auto && <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>prasyarat</span>}
            </label>
          );
        })}
      </div>

      {needsDomain && (
        <Field label="Domain">
          <Input aria-label="Domain" value={domain} onChange={(e) => setDomain(e.currentTarget.value)}
            placeholder="hanoman.contoh.id" />
        </Field>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={doPreview} disabled={!canRun || busy !== null}>Pratinjau</Button>
        <Button onClick={doApply} disabled={!canRun || busy !== null}>Pasang</Button>
      </div>

      {steps && (
        <pre style={{ fontSize: 11, fontFamily: "var(--font-mono)", maxHeight: 220, overflow: "auto" }}>
          {steps.map((s) => `${s.item.padEnd(14)} ${s.status.padEnd(6)} ${s.detail}`).join("\n")}
        </pre>
      )}

      {setup && (
        <StateBlock icon="link" title="Buat admin pertama">
          <a href={setup.url} target="_blank" rel="noreferrer">{setup.url}</a>
          <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>
            berlaku sampai {new Date(setup.expiresAt).toLocaleTimeString("id-ID")}
          </div>
          <Button onClick={() => void navigator.clipboard?.writeText(setup.url)}>Salin</Button>
        </StateBlock>
      )}

      {pending.length > 0 && (
        <div style={{ fontSize: 12 }}>
          <Icon name="alert-triangle" /> {pending.map(([id]) => id).join(", ")} terpasang tapi belum login.
          <Button onClick={openConsole}>Login lewat Console</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
```

- [ ] **Step 5: Jalankan, pastikan lulus**

```bash
pnpm vitest --run src/test/vps-provision.test.tsx
```
Expected: PASS (6 test). Bila `Field`/`StateBlock`/`Icon` menuntut prop lain, sesuaikan pemakaiannya dengan `src/src/ds` — jangan mengubah design system.

- [ ] **Step 6: Sisipkan ke `VpsScreen`**

Di `src/src/screens/VpsScreen.tsx`, tambahkan impor `import { VpsProvisionPanel, ComponentBadges } from "./VpsProvision";` lalu render `<VpsProvisionPanel vps={detailVps} onToast={onToast} onGotoTerminal={onGotoTerminal} />` di dalam modal detail (di bawah checklist), dan `<ComponentBadges components={v.components ?? null} checkedAt={v.componentsCheckedAt ?? null} />` di baris kartu daftar.

`VpsView` (`shared/src/dto.ts`) perlu dua field opsional agar tipe lulus:

```ts
  components?: VpsComponents | null;
  componentsCheckedAt?: string | null;
  provisionProfile?: string | null;
```

- [ ] **Step 7: Jalankan test layar VPS lama**

```bash
pnpm vitest --run src/test/vps-screen.test.tsx src/test/vps-checklist.test.tsx src/test/vps-apply-confirm.test.tsx src/test/vps-provision.test.tsx
```
Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/VpsProvision.tsx src/src/screens/VpsScreen.tsx src/src/api/client.ts shared/src/dto.ts src/test/vps-provision.test.tsx
git commit -m "feat(spec-883): panel provisioning, lencana komponen, kartu serah-terima"
```

---

## Task 9: CLI `hanoman provision`

**Files:**
- Create: `cli/src/commands/provision.ts`
- Modify: `cli/src/router.ts` (HELP + `route` + `run`)
- Test: `cli/test/provision.test.ts`

**Interfaces:**
- Consumes: `Ctx` (`cli/src/router.ts`); `provision.sh` (Task 3–4).
- Produces: `parseProvisionArgs(args: string[]): { mode: "probe"|"apply"; items: string[]; profile: string; domain?: string; dryRun: boolean; yes: boolean } | { error: string }` dan default export `(args, ctx) => Promise<number>`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `cli/test/provision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseProvisionArgs, scriptEnv } from "../src/commands/provision";
import { route } from "../src/router";

describe("SPEC-883 · argv provision", () => {
  it("--probe → mode probe", () => {
    expect(parseProvisionArgs(["--probe"])).toMatchObject({ mode: "probe" });
  });

  it("--with menentukan items, --profile & --domain diteruskan", () => {
    expect(parseProvisionArgs(["--with=hanoman,caddy", "--profile=production", "--domain=a.test"]))
      .toMatchObject({ mode: "apply", items: ["hanoman", "caddy"], profile: "production", domain: "a.test" });
  });

  it("apply tanpa --with ditolak", () => {
    expect(parseProvisionArgs([])).toMatchObject({ error: expect.stringMatching(/--with/) });
  });

  it("profil tak dikenal ditolak", () => {
    expect(parseProvisionArgs(["--with=node", "--profile=wat"])).toMatchObject({ error: expect.any(String) });
  });

  it("env skrip dirangkai dari argumen", () => {
    const parsed = parseProvisionArgs(["--with=node", "--dry-run"]);
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(scriptEnv(parsed)).toMatchObject({ MODE: "apply", ITEMS: "node", PROFILE: "lab", DRY_RUN: "1" });
  });

  it("router mengenali `provision`", () => {
    expect(route(["provision", "--probe"])).toEqual({ cmd: "provision", args: ["--probe"] });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
pnpm vitest --run cli/test/provision.test.ts
```
Expected: FAIL — modul tak ada, `route` memulangkan `unknown`.

- [ ] **Step 3: Tulis perintah**

Buat `cli/src/commands/provision.ts`:

```ts
// SPEC-883 · ADR-0137 · jalur mandiri: menjalankan provision.sh yang SAMA secara lokal, tanpa
// ssh. Itulah alasan skrip itu dilarang berasumsi apa pun tentang SSH atau tty.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ctx } from "../router";

const PROFILES = ["lab", "production"];

export type ProvisionArgs = {
  mode: "probe" | "apply";
  items: string[];
  profile: string;
  domain?: string;
  dryRun: boolean;
  yes: boolean;
};

const flag = (args: string[], name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

export function parseProvisionArgs(args: string[]): ProvisionArgs | { error: string } {
  const probe = args.includes("--probe");
  const items = (flag(args, "with") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const profile = flag(args, "profile") ?? "lab";
  const domain = flag(args, "domain");
  if (!PROFILES.includes(profile)) return { error: `profil tak dikenal: ${profile}` };
  if (!probe && items.length === 0) return { error: "sebutkan komponen dengan --with=a,b" };
  return { mode: probe ? "probe" : "apply", items, profile, domain,
    dryRun: args.includes("--dry-run"), yes: args.includes("--yes") };
}

export function scriptEnv(a: ProvisionArgs): Record<string, string> {
  return {
    MODE: a.mode,
    ...(a.mode === "apply" ? { ITEMS: a.items.join(","), PROFILE: a.profile } : {}),
    ...(a.domain ? { DOMAIN: a.domain } : {}),
    ...(a.dryRun ? { DRY_RUN: "1" } : {}),
  };
}

// Dua lokasi, terpaket lebih dulu — cermin scriptPath() di server (SPEC-883 Task 1).
export function localScriptPath(): string {
  const packed = fileURLToPath(new URL("../scripts/vps/provision.sh", import.meta.url));
  if (existsSync(packed)) return packed;
  return join(process.cwd(), "server", "scripts", "vps", "provision.sh");
}

function runScript(env: Record<string, string>, ctx: Ctx): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("bash", [localScriptPath()], { env: { ...process.env, ...env } });
    p.stdout.on("data", (d) => ctx.stdout(String(d)));
    p.stderr.on("data", (d) => ctx.stderr(String(d)));
    p.on("close", (code) => resolve(code ?? 1));
    p.on("error", (e) => { ctx.stderr(`${e}\n`); resolve(127); });
  });
}

export default async function provisionCmd(args: string[], ctx: Ctx): Promise<number> {
  const parsed = parseProvisionArgs(args);
  if ("error" in parsed) { ctx.stderr(`${parsed.error}\n`); return 1; }
  if (parsed.mode === "probe" || parsed.dryRun) return runScript(scriptEnv(parsed), ctx);

  // Tanpa --yes: dry-run dulu, lalu minta konfirmasi. Perintah ini menulis /etc/hanoman.env
  // dan unit systemd — ia tak boleh berjalan karena salah ketik.
  if (!parsed.yes) {
    ctx.stdout("Rencana (dry-run):\n");
    await runScript({ ...scriptEnv(parsed), DRY_RUN: "1" }, ctx);
    const answer = (await ctx.readStdin?.() ?? "").trim().toLowerCase();
    if (answer !== "y" && answer !== "ya") { ctx.stderr("dibatalkan\n"); return 1; }
  }
  return runScript(scriptEnv(parsed), ctx);
}
```

- [ ] **Step 4: Daftarkan di router**

Di `cli/src/router.ts`, tambahkan ke `HELP` sesudah baris `doctor`:

```
  provision [--with=a,b] [--profile=lab|production]   pasang komponen di MESIN INI
    [--domain <d>] [--probe] [--dry-run] [--yes]      (hanoman, caddy, claude, codex, gh, …)
```

Di `route`, tambahkan `provision` ke daftar perintah tingkat atas:

```ts
  if (group === "start" || group === "doctor" || group === "update" || group === "mcp" || group === "provision")
    return { cmd: group, args: argv.slice(1) };
```

Di `run`, tambahkan:

```ts
  if (cmd === "provision") return (await import("./commands/provision")).default(args, ctx);
```

- [ ] **Step 5: Jalankan, pastikan lulus**

```bash
pnpm vitest --run cli/test/provision.test.ts cli/test/router.test.ts
```
Expected: PASS. Bila `cli/test/router.test.ts` menegakkan isi `HELP` secara harfiah, perbarui ekspektasinya.

- [ ] **Step 6: Uji nyata sekali di mesin ini (probe saja — nol tulis)**

```bash
pnpm --filter @hanoman/cli build 2>/dev/null || pnpm -r build
MODE=probe bash server/scripts/vps/provision.sh
```
Expected: sembilan baris `COMP …` yang menggambarkan mesin ini apa adanya. **Jangan** menjalankan `MODE=apply` di mesin ini.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/provision.ts cli/src/router.ts cli/test/provision.test.ts
git commit -m "feat(spec-883): subperintah hanoman provision"
```

---

## Task 10: Docs, ADR-0137, dan verifikasi API nyata

**Files:**
- Create: `internal/docs/adr/0137-provisioning-vps-berbasis-katalog.md`
- Modify: `internal/docs/adr/README.md`, `internal/docs/README.md`, `internal/docs/operations/deploy-vps.md`, `internal/docs/architecture/api-contract.md`, `internal/docs/architecture/data-model.md`, `internal/docs/operations/npm-readme.md`

**Interfaces:**
- Consumes: seluruh task sebelumnya.
- Produces: dokumentasi Source of Truth yang selaras.

- [ ] **Step 1: Tulis ADR-0137**

Buat `internal/docs/adr/0137-provisioning-vps-berbasis-katalog.md` dengan struktur ADR yang sudah dipakai (`Status`, `Konteks`, `Keputusan`, `Konsekuensi`, `Alternatif yang ditolak`). Isi wajibnya:

- **Keputusan:** komponen adalah data (katalog server), skrip hanya mengeksekusi daftar terurut; `COMP` dari probe adalah **satu-satunya** penulis `Vps.components`; komponen ber-login berhenti di `partial`; dua profil `lab`/`production`; kolom baru local-only.
- **Konsekuensi:** provisioning bisa diulang & dibandingkan; penandaan tetap jujur saat mesin diubah di luar hanoman; profil lab menjalankan server tanpa `NODE_ENV=production` sehingga cookie sesi lahir tanpa `Secure` dan profil itu tak boleh melayani permukaan Help publik.
- **Alternatif yang ditolak:** (a) mencatat apa yang hanoman pasang (marker ≠ bukti, SPEC-487); (b) menyalin kredensial agen antar mesin; (c) sesi Claude sebagai mesin provisioning (tak deterministik, tak bisa dry-run); (d) menyertakan `components` ke sync (SPEC-880: hub lama menolak seluruh push).
- **Amandemen:** ADR-0087 (packing) — skrip VPS kini bagian paket npm; ADR-0117 ditegakkan, tak dilonggarkan.

Tambahkan barisnya ke `internal/docs/adr/README.md` mengikuti format entri di sekitarnya.

- [ ] **Step 2: Perbarui `deploy-vps.md`**

Sisipkan seksi **0** di atas seksi 1, sebelum prosedur manual:

- jalur dashboard (tombol Pasang di layar VPS) dan jalur CLI (`hanoman provision`),
- tabel sembilan komponen + dua profil,
- kalimat eksplisit bahwa prosedur manual di bawahnya **tetap acuan kebenaran** skrip — bila keduanya berbeda, dokumen yang benar,
- batas jujur profil lab (cookie tanpa `Secure`, sesi tak ber-sandbox).

- [ ] **Step 3: Perbarui `api-contract.md` & `data-model.md`**

Di `api-contract.md`, seksi VPS: empat endpoint beserta bentuk 400/409/502-nya. Di `data-model.md`, seksi Vps: tiga kolom baru + catatan **local-only, di luar `FIELDS.vps`** dengan alasan SPEC-880.

- [ ] **Step 4: Perbarui `npm-readme.md`**

Tambahkan `provision` ke daftar subperintah beserta contoh:

```
hanoman provision --with=hanoman,caddy --domain=hanoman.contoh.id --yes
hanoman provision --probe
```

- [ ] **Step 5: Tambahkan entri index**

Tambahkan ADR-0137 ke `internal/docs/README.md` mengikuti format entri ADR di sekitarnya. (Entri rancangan SPEC-883 sudah ada sejak commit spec.)

- [ ] **Step 6: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/vps-provision-parse.test.ts server/test/vps-provision.route.test.ts \
  server/test/vps-provision-setup.test.ts server/test/vps-provision-contract.test.ts \
  server/test/vps-provision-script.test.ts server/test/vps-catalog-components.test.ts \
  server/test/vps-script-path.test.ts server/test/vps.route.test.ts \
  server/test/vps-remediate.route.test.ts
pnpm vitest --run src/test/vps-provision.test.tsx src/test/vps-screen.test.tsx cli/test/provision.test.ts cli/test/pack.test.ts
```
Expected: PASS semua.

- [ ] **Step 7: Uji endpoint nyata di local (wajib, CLAUDE.md)**

Boot server lalu curl keempat endpoint:

```bash
pnpm dev &            # atau: node server/dist/server.js
sleep 5
curl -s localhost:8787/api/vps/components | head -c 400
# Untuk probe/preview/provision butuh satu baris Vps. Pakai VPS uji yang kamu kendalikan,
# JANGAN VPS produksi. Tanpa VPS uji, cukup verifikasi 404 pada id yang tak ada:
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8787/api/vps/hantu/probe   # 404
```
Expected: katalog terbit sebagai JSON; `404` untuk id yang tak ada.

- [ ] **Step 8: Commit**

```bash
git add internal/docs
git commit -m "docs(spec-883): ADR-0137 + deploy-vps, api-contract, data-model, npm-readme"
```

- [ ] **Step 9: Centang seluruh checklist plan ini**

Ubah setiap `- [ ]` yang sudah selesai menjadi `- [x]` di berkas plan ini, lalu commit.

```bash
git add docs/superpowers/plans/2026-08-22-spec-883-provisioning-vps-satu-perintah.md
git commit -m "chore(spec-883): centang seluruh checklist plan"
```

---

## Catatan penyimpangan dari spec

1. **`parseSteps` tidak dipakai ulang.** Spec menulis "protokolnya identik `remediate.sh`, jadi `parseSteps` dipakai ulang apa adanya". `RemediateStep["status"]` tak memuat `"skip"`, dan `skip` wajib ada (K3). Yang dipakai ulang adalah **polanya**, lewat `parseProvisionSteps` terpisah; `vps-remediate.ts` tak disentuh.
2. **`deps_of` di `provision.sh` menduplikasi tabel dependensi katalog.** Sengaja: server sudah mengirim daftar lengkap & terurut, tabel di skrip hanya dipakai menerbitkan `blocked-by` yang benar saat sebuah prasyarat gagal di tengah jalan. Jaga keduanya selaras; test route Task 7 yang menangkap kalau melenceng.
