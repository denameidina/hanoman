# Ubah type backlog lintas-alur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Item backlog yang sudah dimulai bisa pindah type ke alur kerja mana pun, dengan konsekuensi eksplisit berkonfirmasi: item kembali ke `brainstorming` dan jejak sesi lamanya dibuang.

**Architecture:** Gerbang murni `checkSourceChange` berhenti menolak lintas-alur dan mulai menjawab *rencana* (`reset: boolean`). Route `POST /specs/:id/source` jadi dua fase seperti revert stage SPEC-167: request tanpa `confirmReset` menjawab `{ pending: true, … }` tanpa mutasi apa pun; request kedua menjalankannya. Efek samping non-DB (hapus dokumen fase, lepas worktree, hapus branch) hidup di satu modul baru `spec-reset.ts` supaya route tetap tipis dan gerbangnya tetap murni.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod, React 18 + Vite, vitest, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-25-ubah-type-lintas-alur-design.md`

## Global Constraints

- Bahasa komentar & pesan error: **Indonesia**, mengikuti berkas sekitarnya.
- TypeScript strict. Tak ada `any` baru.
- `server/src/services/spec-source.ts` tetap **murni**: tanpa DB, git, tmux, atau jam sistem. Semua efek samping masuk `spec-reset.ts`.
- Test server dijalankan dengan DB terisolasi: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism`. Tanpa keduanya, suite gagal ramai 404/P2022 karena worktree tetangga menghapus DB bersama di tengah run.
- Branch **remote tidak pernah disentuh** oleh operasi ini.
- Perpindahan **se-alur** (`brief ↔ help`) untuk item yang sudah dimulai tak boleh berubah perilakunya: tanpa reset, tanpa konfirmasi, tanpa penghapusan. Setiap task yang menyentuh jalur itu wajib membuktikannya lewat test.
- `internal/docs` yang tersentuh diperbarui **dalam commit yang sama** dan ditautkan di `internal/docs/README.md`.
- Nomor ADR final dikonfirmasi saat commit (nomor ADR pernah bertabrakan antar-worktree). Rencana ini memakai **ADR-0149**.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `server/src/services/spec-source.ts` | gerbang murni: boleh/tidak + rencana `reset` | ubah |
| `server/src/services/spec-reset.ts` | efek samping reset: daftar & eksekusi (docs, worktree, branch) | **baru** |
| `server/src/routes/specs.ts` | orkestrasi dua fase di `POST /specs/:id/source` | ubah |
| `shared/src/dto.ts` | `confirmReset` di `zChangeSpecSource` | ubah |
| `src/src/api/client.ts` | tipe balasan `SourceResetPending` | ubah |
| `src/src/App.tsx` | handler mengembalikan hasil ke dialog | ubah |
| `src/src/screens/ChangeSourceDialog.tsx` | opsi tanpa saringan flow, peringatan, konfirmasi 2 langkah | ubah |
| `internal/docs/adr/0149-*.md` | amandemen ADR-0109 | **baru** |

---

### Task 1: Gerbang murni menjawab rencana, bukan penolakan

**Files:**
- Modify: `server/src/services/spec-source.ts:8-47`
- Test: `server/test/spec-source-gate.test.ts`

**Interfaces:**
- Consumes: `flowForSource`, `convertPayload`, `payloadMatchesSource` dari `@hanoman/shared` (sudah diimpor di berkas itu).
- Produces: `SourceGate` dengan field baru `reset: boolean` pada cabang `ok: true`. Dipakai Task 3.

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/spec-source-gate.test.ts`, **ganti** test `"item yang sudah dimulai DITOLAK ke source ber-flow lain"` (baris ~42) dengan:

```ts
  it("item yang sudah dimulai kini BOLEH lintas-alur, ditandai reset", () => {
    for (const to of ["qa", "audit", "goal", "no_effort"]) {
      const g = checkSourceChange(started, to);
      expect(g.ok).toBe(true);
      expect(g.ok && g.reset).toBe(true);
    }
  });

  it("lintas-alur mengonversi isi seperti item yang belum dimulai", () => {
    const g = checkSourceChange(started, "qa");
    expect(g.ok && g.payload).toEqual({
      severity: "minor", steps: "", expected: "o", actual: "c", env: "", constraints: "k",
    });
  });

  it("se-alur TIDAK mereset — brief ↔ help tetap in-place, isi tak tersentuh", () => {
    const g = checkSourceChange(started, "help");
    expect(g.ok).toBe(true);
    expect(g.ok && g.reset).toBe(false);
    expect(g.ok && g.payload).toEqual(brief);
  });

  it("item yang belum dimulai tak pernah mereset apa pun", () => {
    for (const to of ["qa", "audit", "help", "goal", "no_effort"]) {
      const g = checkSourceChange(fresh, to);
      expect(g.ok && g.reset).toBe(false);
    }
  });
```

Lalu **ganti** test `"item yang sudah dimulai tak boleh sekalian mengubah payload"` (baris ~50) dengan:

```ts
  it("se-alur tetap menolak payload eksplisit — isinya memang tak berpindah", () => {
    const g = checkSourceChange(started, "help", brief);
    expect(g.ok).toBe(false);
    expect(!g.ok && g.code).toBe(409);
  });

  it("lintas-alur MENERIMA payload eksplisit bila bentuknya cocok", () => {
    const qa = { severity: "critical", steps: "1", expected: "e", actual: "a", env: "prod" };
    const g = checkSourceChange(started, "qa", qa);
    expect(g.ok && g.payload).toEqual(qa);
    expect(g.ok && g.reset).toBe(true);
  });
```

Di blok `describe("SPEC-825 · no_effort")` (baris ~74), **ganti** test `"item yang sudah dimulai ditolak 409 ke no_effort"` dengan:

```ts
  it("item yang sudah dimulai boleh ke no_effort, dan itu selalu mereset — flow-nya sendiri", () => {
    const g = checkSourceChange(started, "no_effort");
    expect(g.ok && g.reset).toBe(true);
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-source-gate.test.ts
```

Expected: FAIL — `expected false to be true` pada `g.ok` untuk `qa/audit/goal/no_effort`, dan `g.reset` `undefined`.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/services/spec-source.ts`, ganti tipe dan fungsi:

```ts
export type SourceGate =
  | { ok: true; payload: Record<string, unknown>; dropped: string[]; reset: boolean }
  | { ok: false; code: number; error: string };
```

```ts
export function checkSourceChange(spec: SpecLike, to: string, payload?: unknown): SourceGate {
  const started = spec.stage !== "brainstorming" || spec.baseSha !== null;
  // Se-alur pada item berjalan tetap in-place: tak ada berkas fase yang jadi tak cocok, jadi
  // tak ada yang perlu dibuang — dan isinya memang tak ikut berpindah (gerbang SPEC-186).
  if (started && flowForSource(spec.source) === flowForSource(to)) {
    if (payload !== undefined)
      return { ok: false, code: 409, error: "backlog item sudah dimulai — isinya tak bisa diubah" };
    return { ok: true, payload: (spec.payload ?? {}) as Record<string, unknown>, dropped: [], reset: false };
  }
  if (payload !== undefined) {
    // Bentuknya sudah dijamin `zChangeSpecSource` di batas HTTP; diperiksa lagi di sini supaya
    // pemanggil non-HTTP tak bisa menyelundupkan bentuk salah lewat service.
    if (!payloadMatchesSource(to, payload))
      return { ok: false, code: 400, error: "bentuk payload tak cocok dengan source" };
    return { ok: true, payload: payload as Record<string, unknown>, dropped: [], reset: started };
  }
  const c = convertPayload(to, spec.payload);
  return { ok: true, payload: c.payload, dropped: c.dropped, reset: started };
}
```

Ganti juga blok komentar doc di atasnya (baris 14-25) dengan:

```ts
/**
 * Boleh tidak item ini pindah ke `to`, isi apa yang berlaku sesudahnya, dan perlukah item itu
 * dikembalikan ke `brainstorming`.
 *
 * ADR-0109 dulu MENGUNCI flow: item yang sudah dimulai hanya boleh pindah ke source se-flow.
 * Alasannya sah — sesi menulis nama fase `PIPELINES[flow]` ke berkas fase, jadi item `feature`
 * (lima fase) yang pindah ke `goal` (dua fase) meninggalkan berkas yang TAK AKAN PERNAH
 * memuaskan `phasesComplete` flow barunya (bentuk SPEC-433). Yang salah bukan diagnosisnya
 * melainkan obatnya: berkas yang mengganggu itu bisa dibuang. ADR-0149 menggantinya dengan
 * `reset` — perpindahan lintas-alur diizinkan, dengan syarat item kembali ke titik nol.
 *
 * `reset: false` untuk dua keadaan yang tak punya berkas fase bermasalah: item yang belum
 * pernah dimulai, dan perpindahan SE-ALUR (`brief ↔ help`) yang tak mengubah apa pun yang
 * dipegang sesi.
 */
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-source-gate.test.ts
```

Expected: PASS, semua test di berkas itu hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/spec-source.ts server/test/spec-source-gate.test.ts
git commit -m "feat(spec-source): gerbang menjawab rencana reset, bukan penolakan lintas-alur"
```

---

### Task 2: `confirmReset` di kontrak HTTP

**Files:**
- Modify: `shared/src/dto.ts:120-126`
- Test: `shared/src/spec-source.test.ts`

**Interfaces:**
- Produces: `zChangeSpecSource` menerima `confirmReset?: boolean`. Dipakai Task 3 (route) dan Task 4 (klien).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `shared/src/spec-source.test.ts`:

```ts
describe("ADR-0149 · confirmReset", () => {
  it("diterima sebagai boolean opsional", () => {
    expect(zChangeSpecSource.safeParse({ source: "qa" }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", confirmReset: true }).success).toBe(true);
    expect(zChangeSpecSource.safeParse({ source: "qa", confirmReset: "ya" }).success).toBe(false);
  });
});
```

Pastikan `zChangeSpecSource` ikut diimpor di berkas itu; kalau belum, tambahkan ke daftar import yang ada.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run shared/src/spec-source.test.ts
```

Expected: FAIL pada baris `confirmReset: "ya"` — zod object default **strip**, jadi field tak dikenal lolos diam-diam dan `success` bernilai `true`.

- [ ] **Step 3: Implementasi minimal**

Di `shared/src/dto.ts`, tambahkan field ke `zChangeSpecSource`:

```ts
export const zChangeSpecSource = z.object({
  source: zSpecSource,
  payload: z.union([zBriefPayload, zQaPayload, zGoalPayload]).optional(),
  // ADR-0149 · perpindahan LINTAS-ALUR pada item yang sudah dimulai mengembalikan item ke
  // `brainstorming` dan membuang jejak sesi lamanya. Tanpa flag ini server menjawab dry-run
  // (`pending`) alih-alih mengeksekusi — cermin `confirmDelete` revert stage SPEC-167.
  // Diabaikan bila perpindahannya tak butuh reset.
  confirmReset: z.boolean().optional(),
}).superRefine((o, ctx) => {
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/spec-source.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/dto.ts shared/src/spec-source.test.ts
git commit -m "feat(dto): confirmReset pada zChangeSpecSource"
```

---

### Task 3: Modul efek samping reset

**Files:**
- Create: `server/src/services/spec-reset.ts`
- Test: `server/test/spec-reset.test.ts`

**Interfaces:**
- Consumes: `artifactsToRemove` (`services/stage-artifacts`), `deleteDoc` (`services/docs`), `resolveRepoDir` (`services/local-binding`), `releaseWorktree` (`services/worktree-reaper`), `ownsWorktree` (`services/session-worktree`), `runGitOp` (`services/git-ide`), `sessionIdForSpec` (`services/session-id`).
- Produces:
  ```ts
  export type ResetPlan = { wouldDelete: string[]; worktree: string | null; branch: string | null };
  export function planSpecReset(spec: { id: string; projectId: string; stage: string }): Promise<ResetPlan>
  export function applySpecReset(spec: { id: string; projectId: string }, plan: ResetPlan): Promise<void>
  ```
  Keduanya dipakai Task 4 (route).

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/spec-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSpecReset, applySpecReset } from "../src/services/spec-reset";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

// Repo sungguhan, bukan mock: yang diuji di sini justru interaksinya dengan git — worktree yang
// lepas dan branch yang benar-benar hilang. Mock git hanya akan menguji mock.
function repoWithSpecWorktree(specId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-reset-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  mkdirSync(join(dir, "docs/superpowers/plans"), { recursive: true });
  writeFileSync(join(dir, "docs/superpowers/plans", `${specId.toLowerCase()}-plan.md`), "# plan\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  const sid = specId.toLowerCase();
  git("worktree", "add", "-q", "-b", `hanoman/${sid}`, join(dir, ".worktrees", sid));
  return dir;
}

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "pr" });
});

describe("ADR-0149 · reset item saat type pindah lintas-alur", () => {
  it("planSpecReset melaporkan dokumen fase, worktree, dan branch — tanpa menghapus apa pun", async () => {
    const repo = repoWithSpecWorktree("SPEC-810");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-810", projectId: "pr", stage: "executing", baseSha: "abc" });

    const plan = await planSpecReset({ id: "SPEC-810", projectId: "pr", stage: "executing" });
    expect(plan.wouldDelete).toContain("docs/superpowers/plans/spec-810-plan.md");
    expect(plan.worktree).toBe(join(repo, ".worktrees", "spec-810"));
    expect(plan.branch).toBe("hanoman/spec-810");
    // Dry-run: semuanya masih di tempatnya.
    expect(existsSync(join(repo, "docs/superpowers/plans/spec-810-plan.md"))).toBe(true);
    expect(existsSync(plan.worktree!)).toBe(true);
  });

  it("applySpecReset membuang ketiganya", async () => {
    const repo = repoWithSpecWorktree("SPEC-811");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-811", projectId: "pr", stage: "executing", baseSha: "abc" });

    const plan = await planSpecReset({ id: "SPEC-811", projectId: "pr", stage: "executing" });
    await applySpecReset({ id: "SPEC-811", projectId: "pr" }, plan);

    expect(existsSync(join(repo, "docs/superpowers/plans/spec-811-plan.md"))).toBe(false);
    expect(existsSync(join(repo, ".worktrees", "spec-811"))).toBe(false);
    const branches = execFileSync("git", ["branch", "--format=%(refname:short)"], { cwd: repo, encoding: "utf8" });
    expect(branches).not.toContain("hanoman/spec-811");
  });

  it("item tanpa worktree & branch: rencana kosong, apply tak melempar", async () => {
    const repo = repoWithSpecWorktree("SPEC-812");
    await prisma.project.update({ where: { id: "pr" }, data: { repoDir: repo } });
    await makeSpec({ id: "SPEC-813", projectId: "pr", stage: "planned" });

    const plan = await planSpecReset({ id: "SPEC-813", projectId: "pr", stage: "planned" });
    expect(plan.worktree).toBeNull();
    expect(plan.branch).toBeNull();
    await expect(applySpecReset({ id: "SPEC-813", projectId: "pr" }, plan)).resolves.toBeUndefined();
  });

  it("project tanpa repoDir: rencana kosong, apply tak melempar", async () => {
    await makeProject({ id: "nodir", repoDir: null });
    await makeSpec({ id: "SPEC-814", projectId: "nodir", stage: "executing", baseSha: "x" });
    const plan = await planSpecReset({ id: "SPEC-814", projectId: "nodir", stage: "executing" });
    expect(plan).toEqual({ wouldDelete: [], worktree: null, branch: null });
    await expect(applySpecReset({ id: "SPEC-814", projectId: "nodir" }, plan)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-reset.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/services/spec-reset"`.

- [ ] **Step 3: Implementasi minimal**

Buat `server/src/services/spec-reset.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { artifactsToRemove } from "./stage-artifacts";
import { deleteDoc } from "./docs";
import { resolveRepoDir } from "./local-binding";
import { releaseWorktree } from "./worktree-reaper";
import { ownsWorktree } from "./session-worktree";
import { runGitOp } from "./git-ide";
import { shaResolvable } from "./spec-review";
import { sessionIdForSpec } from "./session-id";
import type { Stage } from "@hanoman/shared";

// ADR-0149 · efek samping "kembalikan item ke titik nol" saat type-nya pindah LINTAS-ALUR.
// Terpisah dari `spec-source.ts` yang wajib tetap murni, dan terpisah dari route supaya urutan
// operasinya — yang mengikat, lihat `applySpecReset` — punya satu tempat untuk dibaca dan diuji.

export type ResetPlan = {
  /** Path docs relatif repo yang akan dihapus. */
  wouldDelete: string[];
  /** Path absolut worktree sesi, `null` bila sudah lepas atau tak pernah ada. */
  worktree: string | null;
  /** Nama branch lokal sesi, `null` bila tak ada. */
  branch: string | null;
};

const EMPTY: ResetPlan = { wouldDelete: [], worktree: null, branch: null };

/** Apa saja yang akan hilang. TIDAK menyentuh apa pun — inilah yang dipakai layar konfirmasi. */
export async function planSpecReset(
  spec: { id: string; projectId: string; stage: string },
): Promise<ResetPlan> {
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) return EMPTY;
  const sid = sessionIdForSpec(spec.id);
  const wt = join(repoDir, ".worktrees", sid);
  const branch = `hanoman/${sid}`;
  // `GitOp` tak punya varian baca; `shaResolvable` (services/spec-review) sudah melakukan persis
  // ini lewat `git cat-file -e <ref>^{commit}` dan sudah dipakai route yang sama.
  const hasBranch = await shaResolvable(repoDir, `refs/heads/${branch}`);
  return {
    // Berkas fase seluruh stage yang ditinggalkan — persis rentang yang dipakai revert stage.
    wouldDelete: await artifactsToRemove(spec.projectId, spec.id, "brainstorming", spec.stage as Stage),
    worktree: existsSync(wt) ? wt : null,
    branch: hasBranch ? branch : null,
  };
}

/**
 * Jalankan rencana. Urutannya MENGIKAT dan bukan selera:
 *
 * 1. dokumen fase dulu — ia dibaca lewat repoDir, tak bergantung worktree;
 * 2. worktree dilepas SEBELUM branch dihapus — git menolak menghapus branch yang di-checkout
 *    sebuah worktree;
 * 3. branch dihapus SEBELUM pemanggil menulis `stage: "brainstorming"` ke DB — kunci
 *    `spec-open` di `branch-cleanup.ts` menyala untuk backlog yang belum selesai, dan jalur
 *    pembersihan branch mana pun sesudah itu akan menolaknya.
 *
 * Setiap langkah gagal-diam: reset yang setengah jalan lebih baik daripada type yang gagal
 * berpindah, dan sisa berkasnya tetap bisa dibuang lewat tab Worktrees/Branches.
 */
export async function applySpecReset(
  spec: { id: string; projectId: string }, plan: ResetPlan,
): Promise<void> {
  const repoDir = await resolveRepoDir(spec.projectId);
  if (!repoDir) return;
  for (const rel of plan.wouldDelete) await deleteDoc(spec.projectId, rel).catch(() => { });
  if (plan.worktree && ownsWorktree(repoDir, plan.worktree)) {
    // SPEC-742 · ADR-0116 · lewat `.trash`, bukan `rm` langsung: penghapusan byte-nya di latar.
    try { releaseWorktree(repoDir, plan.worktree, spec.projectId); } catch { /* biar tab Worktrees yang bereskan */ }
  }
  if (plan.branch) {
    // Sengaja BUKAN `deleteBranches`: gerbang di sana dirancang untuk pembersihan massal
    // tak-terarah, tempat operator tak melihat satu per satu apa yang dibuang. Di sini ia
    // menunjuk satu branch dan sudah menyetujui daftarnya. Remote tak disentuh (`remote` tak diisi).
    await runGitOp(repoDir, { op: "delete-branch", name: plan.branch, force: true });
  }
}
```

`GitOp` (`server/src/services/git-ide.ts:270-290`) sengaja tak punya varian baca — semua variannya menulis. Karena itu deteksi keberadaan branch memakai `shaResolvable`, bukan varian `GitOp` baru. Jangan menambah varian ke `GitOp` untuk keperluan ini.

`Interfaces` di atas menyebut `runGitOp` untuk **menghapus** branch (`op: "delete-branch"`, varian yang memang ada) dan `shaResolvable` untuk **membaca** keberadaannya.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-reset.test.ts
```

Expected: PASS, 4 test hijau.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/spec-reset.ts server/test/spec-reset.test.ts
git commit -m "feat(spec-reset): rencana & eksekusi pembuangan jejak sesi saat type pindah alur"
```

---

### Task 4: Route dua fase

**Files:**
- Modify: `server/src/routes/specs.ts:251-283`
- Test: `server/test/spec-source.route.test.ts`

**Interfaces:**
- Consumes: `checkSourceChange` (Task 1, kini membawa `reset`), `planSpecReset`/`applySpecReset` (Task 3), `zChangeSpecSource` (Task 2), `listSessions` (sudah diimpor di berkas ini).
- Produces: balasan `{ pending: true, wouldDelete, worktree, branch }` untuk dry-run; `409 { error: "session-live", session }` saat ada sesi hidup. Dipakai Task 5 (klien).

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/spec-source.route.test.ts`, **ganti** test `"item yang SUDAH DIMULAI: brief→help 200, brief→qa 409, brief→help+payload 409"` dengan:

```ts
  it("item yang SUDAH DIMULAI: brief→help tetap in-place tanpa konfirmasi apa pun", async () => {
    await makeSpec({ id: "SPEC-804", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", payload: brief });
    expect((await post("SPEC-804", { source: "help", payload: brief })).statusCode).toBe(409);
    const ok = await post("SPEC-804", { source: "help" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().source).toBe("help");
    expect(ok.json().payload).toEqual(brief);      // isi tak tersentuh
    expect(ok.json().stage).toBe("executing");     // TIDAK direset
    expect(ok.json().baseSha).toBe("deadbeef");
  });

  it("lintas-alur tanpa confirmReset = dry-run: pending, dan NOL mutasi", async () => {
    await makeSpec({ id: "SPEC-820", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", payload: brief });
    const r = await post("SPEC-820", { source: "qa" });
    expect(r.statusCode).toBe(200);
    expect(r.json().pending).toBe(true);
    expect(Array.isArray(r.json().wouldDelete)).toBe(true);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-820" } });
    expect(row!.source).toBe("brief");             // belum berpindah
    expect(row!.stage).toBe("executing");
    expect(row!.baseSha).toBe("deadbeef");
    expect(row!.sourceHistory).toEqual([]);        // belum ada jejak
  });

  it("lintas-alur dengan confirmReset: type pindah DAN item kembali ke brainstorming", async () => {
    await makeSpec({ id: "SPEC-821", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", headSha: "cafe", startedAt: new Date(), payload: brief });
    const r = await post("SPEC-821", { source: "qa", confirmReset: true });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.source).toBe("qa");
    expect(body.stage).toBe("brainstorming");
    expect(body.baseSha).toBeNull();
    expect(body.headSha).toBeNull();
    expect(body.startedAt).toBeNull();
    expect(body.payload.actual).toBe("operator buka tiga layar");   // isi ikut dikonversi
    expect(body.sourceHistory).toHaveLength(1);
    expect(body.sourceHistory[0]).toMatchObject({ from: "brief", to: "qa" });
    expect(body.sourceHistory[0].payload).toEqual(brief);           // bentuk lama utuh
  });

  it("sesi hidup menolak reset — worktree tak boleh lepas di bawah kaki agen", async () => {
    await makeSpec({ id: "SPEC-822", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", payload: brief });
    const pty = await import("../src/services/pty");
    const spy = vi.spyOn(pty, "listSessions").mockReturnValue(
      [{ id: "spec_822", specId: "SPEC-822", exited: false, agent: "claude" }] as never);
    try {
      const r = await post("SPEC-822", { source: "qa", confirmReset: true });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("session-live");
      const row = await prisma.spec.findUnique({ where: { id: "SPEC-822" } });
      expect(row!.source).toBe("brief");   // nol mutasi
    } finally {
      spy.mockRestore();
    }
  });
```

Tambahkan `vi` ke import vitest di baris 1 berkas itu.

> **Catatan pemasangan spy:** kalau `listSessions` dipanggil lewat binding impor statis di `specs.ts`, `vi.spyOn` pada modulnya tak akan tertangkap. Bila test sesi-hidup gagal karena itu, pakai `vi.mock("../src/services/pty", async (orig) => ({ ...(await orig()), listSessions: () => [...] }))` di puncak berkas dan aktifkan per-test lewat variabel modul — jangan mengubah kode produksi hanya supaya bisa di-spy.

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-source.route.test.ts
```

Expected: FAIL — dry-run menjawab 409 (`sudah dimulai — type hanya bisa pindah…`) alih-alih `pending`.

- [ ] **Step 3: Implementasi minimal**

Di `server/src/routes/specs.ts`, tambahkan import:

```ts
import { planSpecReset, applySpecReset } from "../services/spec-reset";
```

Ganti isi handler `POST /specs/:id/source` mulai dari baris `const gate = checkSourceChange(...)`:

```ts
    const gate = checkSourceChange(spec, to, parsed.data.payload);
    if (!gate.ok) return reply.code(gate.code).send({ error: gate.error });

    // ADR-0149 · perpindahan lintas-alur pada item yang sudah dimulai mengembalikannya ke titik
    // nol. Dua langkah, cermin `confirmDelete` revert stage SPEC-167: operator harus melihat
    // daftar konkret apa yang hilang sebelum satu byte pun tersentuh.
    let plan: Awaited<ReturnType<typeof planSpecReset>> | null = null;
    if (gate.reset) {
      // Yang ditanya: adakah pane yang MENGAKU mengerjakan item ini — properti `specId` pane,
      // bukan tebakan atas nama sesinya (pola `POST /specs/:id/done`). Melepas worktree di bawah
      // agen yang sedang mengetik adalah kelas bug "worktree pruned mid-run".
      const live = listSessions().find((s) => s.specId === id && !s.exited);
      if (live) return reply.code(409).send({ error: "session-live", session: { id: live.id, agent: live.agent } });
      plan = await planSpecReset(spec);
      // Konfirmasi diminta WALAU ketiga daftarnya kosong: yang dikonfirmasi bukan cuma
      // penghapusan, melainkan mundurnya stage.
      if (parsed.data.confirmReset !== true)
        return reply.send({ pending: true, wouldDelete: plan.wouldDelete, worktree: plan.worktree, branch: plan.branch });
    }

    const by = req.user?.email ?? "system";
    const history = appendSourceHistory(
      spec.sourceHistory, sourceChangeEntry(spec, to, by, new Date()));
    // Turunan dihitung ulang terhadap bentuk yang BERLAKU: konversi ke qa memindahkan kendali
    // prioritas ke `severity`, konversi ke goal membuat objective = goal-nya.
    const { priority, objective } = deriveSpecFields(
      to, gate.payload, (gate.payload.priority as string) ?? spec.priority);
    // Git & disk dibereskan SEBELUM baris DB berubah: begitu stage jadi `brainstorming`, kunci
    // `spec-open` menyala dan branch sesi tak bisa dihapus jalur mana pun lagi.
    if (plan) await applySpecReset(spec, plan);
    // `author` SENGAJA tak disentuh: prefix `QA ·`/`Audit ·`/`Goal ·` menjawab *siapa yang
    // memfilekan item ini dan lewat pintu mana* — fakta historis, cermin `createdAt` ADR-0090
    // yang tak pernah ditulis route. Lencana type yang dilihat operator memang berpindah.
    const updated = await prisma.spec.update({
      where: { id },
      data: {
        source: to, payload: gate.payload as Prisma.InputJsonValue, priority, objective,
        sourceHistory: history as unknown as Prisma.InputJsonValue,
        // ADR-0149 · `baseSha` bukan sekadar catatan: `session-launch.ts` memakainya sebagai
        // penanda RESUME, dan `PATCH /specs/:id` memakainya sebagai kunci edit konten SPEC-186.
        // Meninggalkannya berarti item "yang sudah kembali ke brainstorming" tetap melanjutkan
        // worktree lama dan tetap tak bisa diedit isinya.
        ...(plan ? { stage: "brainstorming", baseSha: null, headSha: null, startedAt: null } : {}),
      },
    });
```

Sisanya (`recordSourceChange`, `notifySynced`, `return updated`) tak berubah.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/spec-source.route.test.ts server/test/spec-source-gate.test.ts server/test/spec-reset.test.ts server/test/spec-source-contract.test.ts
```

Expected: PASS semuanya. Kalau `spec-source-contract.test.ts` merah pada `eventTypeFor`, jangan ubah asersinya tanpa membaca Step 5 di bawah.

- [ ] **Step 5: Catat perilaku webhook yang berubah**

Reset mengubah `source` **dan** `stage` dalam satu update, sehingga `eventTypeFor(spec, "updated", ["source", "stage"])` hanya memancarkan satu jenis event — yang pertama cocok di daftar `derived`. Tambahkan test yang **mengunci** perilaku itu supaya ia jadi keputusan, bukan kebetulan, di `server/test/spec-source-contract.test.ts`:

```ts
  it("ADR-0149 · reset mengubah source+stage sekaligus: satu event, dan itu source_changed", () => {
    const spec = WEBHOOK_ENTITIES.find((d) => d.entity === "spec")!;
    expect(eventTypeFor(spec, "updated", ["source", "stage"])).toBe("spec.source_changed");
  });
```

Jalankan; kalau hasilnya `spec.stage_changed`, **jangan** balikkan asersinya — urutkan `derived` di `shared/src/webhook.ts` supaya `source` menang, karena perpindahan type adalah peristiwa yang menyebabkan mundurnya stage, bukan sebaliknya.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/specs.ts server/test/spec-source.route.test.ts server/test/spec-source-contract.test.ts
git commit -m "feat(specs): POST /specs/:id/source dua fase untuk perpindahan lintas-alur"
```

---

### Task 5: Klien API & handler

**Files:**
- Modify: `src/src/api/client.ts:225-228`
- Modify: `src/src/App.tsx:1145-1159`

**Interfaces:**
- Consumes: balasan route dari Task 4.
- Produces:
  ```ts
  export type SourceResetPending = { pending: true; wouldDelete: string[]; worktree: string | null; branch: string | null };
  // api.changeSpecSource(id, { source, payload?, confirmReset? }): Promise<Spec | SourceResetPending>
  // App: changeSourceOfSpec(spec, source, payload?, confirmReset?): Promise<SourceResetPending | null>
  ```
  Dipakai Task 6 (dialog).

- [ ] **Step 1: Ubah tipe klien**

Di `src/src/api/client.ts`, di dekat `RevertPending` (baris 38) tambahkan:

```ts
// ADR-0149 · dry-run perpindahan type LINTAS-ALUR: apa saja yang hilang bila operator lanjut.
export type SourceResetPending = {
  pending: true; wouldDelete: string[]; worktree: string | null; branch: string | null;
};
```

dan ganti `changeSpecSource`:

```ts
  // SPEC-546 · ADR-0109 · ubah type/source item in-place. `payload` dihilangkan untuk item yang
  // sudah dimulai & se-alur (server memakai payload lama apa adanya).
  // ADR-0149 · lintas-alur pada item yang sudah dimulai menjawab `SourceResetPending` sampai
  // `confirmReset: true` dikirim; 409 `session-live` = ada sesi yang masih berjalan.
  changeSpecSource: (id: string, b: { source: string; payload?: unknown; confirmReset?: boolean }) =>
    j<Spec | SourceResetPending>(paths.specSource(id), { method: "POST", ...body(b) }),
```

- [ ] **Step 2: Ubah handler App**

Di `src/src/App.tsx`, ganti `changeSourceOfSpec`:

```ts
  // SPEC-546 · ADR-0109 · ubah type/source item in-place — id SPEC-nnn, riwayat, dan dependency
  // tetap. 400 = bentuk payload tak cocok source tujuan.
  // ADR-0149 · perpindahan LINTAS-ALUR pada item yang sudah dimulai menjawab rencana reset;
  // ia dikembalikan ke dialog (bukan ditelan toast) supaya operator melihat daftarnya dan
  // memutuskan. 409 `session-live` = sesi masih berjalan.
  async function changeSourceOfSpec(
    spec: Spec, source: string, payload?: unknown, confirmReset?: boolean,
  ): Promise<SourceResetPending | null> {
    try {
      const res = await api.changeSpecSource(spec.id, { source, payload, confirmReset });
      if ("pending" in res) return res;
      setBacklog((b) => b.map((s) => (s.id === res.id ? res : s)));
      showToast(`${spec.id} · type ${spec.source} → ${source}`, "ok", "shuffle");
      return null;
    } catch (e) {
      const live = e instanceof ApiError && e.status === 409;
      showToast(live
        ? `${spec.id} punya sesi yang masih berjalan — tutup dulu sesinya`
        : `Gagal mengubah type ${spec.id}`, "warn", "x-circle");
      return null;
    }
  }
```

Tambahkan `SourceResetPending` ke daftar import dari `./api/client` di puncak `App.tsx`.

- [ ] **Step 3: Sesuaikan prop `onChangeSource`**

Di `src/src/screens/BacklogScreen.tsx:137`, ubah tipe prop supaya membawa hasil:

```ts
    // SPEC-546 · ADR-0109 · ubah type/source item in-place. ADR-0149 · mengembalikan rencana
    // reset (atau null) supaya dialog bisa meminta konfirmasi sebelum apa pun terhapus.
    onChangeSource?: (s: Spec, source: string, payload?: unknown, confirmReset?: boolean)
      => Promise<SourceResetPending | null> | void;
```

Impor `SourceResetPending` di berkas itu dari `../api/client`. Teruskan argumen keempat di call site `:544-549`:

```tsx
      {showSource && onChangeSource && (
        <ChangeSourceDialog spec={spec} onClose={() => setShowSource(false)}
          onSubmit={(source, payload, confirmReset) =>
            Promise.resolve(onChangeSource(spec, source, payload, confirmReset))} />
      )}
```

Perhatikan: `setShowSource(false)` **tidak** lagi dipanggil di sini — dialog yang menutup dirinya sendiri lewat `onClose` setelah submit berhasil (Task 6), karena submit pertama pada jalur reset justru harus membuat dialog tetap terbuka.

- [ ] **Step 4: Verifikasi kompilasi**

```bash
pnpm --filter hanoman-web exec tsc --noEmit -p tsconfig.json
```

Expected: nol error. Kalau nama paket berbeda, jalankan `pnpm -C src exec tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/src/App.tsx src/src/screens/BacklogScreen.tsx
git commit -m "feat(web): jalur data rencana reset dari route ke dialog ubah type"
```

---

### Task 6: Dialog — opsi penuh, peringatan, konfirmasi dua langkah

**Files:**
- Modify: `src/src/screens/ChangeSourceDialog.tsx`
- Test: `src/test/change-source.test.tsx`

**Interfaces:**
- Consumes: `SourceResetPending` dan `onSubmit(source, payload?, confirmReset?) => Promise<SourceResetPending | null>` dari Task 5.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/test/change-source.test.tsx`, **ganti** test `"item yang sudah dimulai hanya menawarkan source se-flow dan tak menampilkan form"` dengan:

```ts
  it("item yang sudah dimulai kini menawarkan KELIMA source lain — bug: dulu qa/audit/goal nol opsi", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={async () => null} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value).sort()).toEqual(["audit", "goal", "help", "no_effort", "qa"]);
  });

  it("se-alur pada item berjalan: tanpa form, tanpa peringatan reset", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn(async () => null);
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "help" } });
    expect(screen.queryByTestId("source-reset-warning")).toBeNull();
    expect(screen.queryByLabelText("Konteks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("help", undefined, undefined);
  });

  it("lintas-alur pada item berjalan: form konversi + peringatan reset", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={async () => null} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.getByTestId("source-reset-warning").textContent).toContain("Brainstorming");
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
  });

  it("balasan pending memunculkan daftar konkret, lalu submit kedua membawa confirmReset", async () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ pending: true, wouldDelete: ["docs/superpowers/plans/spec-800-plan.md"],
        worktree: "/repo/.worktrees/spec-800", branch: "hanoman/spec-800" })
      .mockResolvedValueOnce(null);
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));

    const list = await screen.findByTestId("source-reset-impact");
    expect(list.textContent).toContain("spec-800-plan.md");
    expect(list.textContent).toContain("hanoman/spec-800");

    fireEvent.click(screen.getByRole("button", { name: /Reset & ubah type/i }));
    expect(onSubmit).toHaveBeenLastCalledWith("qa", expect.objectContaining({ actual: "gejalanya" }), true);
  });
```

Tambahkan test regresi untuk keluhan aslinya di blok `describe("SPEC-546 · backlog: tab help & jejak konversi")`:

```ts
  it("ADR-0149 · item qa yang sudah done MEMBUKA modal — dulu tombolnya diam total", () => {
    const doneQa = { ...briefSpec, source: "qa", stage: "done", baseSha: "abc",
      payload: { severity: "minor", steps: "", expected: "e", actual: "a", env: "" } } as Spec;
    render(<BacklogScreen backlog={[doneQa]} projects={[]} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-800" onChangeSource={async () => null} />);
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(screen.getByLabelText("Type tujuan")).toBeTruthy();
  });
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```bash
pnpm vitest --run src/test/change-source.test.tsx
```

Expected: FAIL — opsi item berjalan hanya `["help"]`, `source-reset-warning` tak ada, dan test regresi gagal karena dialog `return null` (tepat bug yang dilaporkan).

- [ ] **Step 3: Implementasi**

Ganti `src/src/screens/ChangeSourceDialog.tsx` menjadi:

```tsx
import React from "react";
import { Modal, Button, Select, Field, HnTextarea, Badge } from "../ds";
import { convertPayload, flowForSource, payloadShapeFor, shapeOfPayload } from "@hanoman/shared";
import { SOURCE_OPTS, SHAPE_FIELDS, PRIO_OPTS, SEV_OPTS, sourceMeta } from "./source-meta";
import type { SourceResetPending } from "../api/client";
import type { Spec } from "./types";

// SPEC-546 · ADR-0109 · dialog "Ubah type". Prefill form-nya memakai `convertPayload` — fungsi
// MURNI yang sama yang dipakai server saat `payload` tak dikirim, jadi apa yang dilihat operator
// di sini persis apa yang akan tersimpan.
//
// ADR-0149 · daftar tujuan TIDAK lagi disaring flow. Saringan itulah yang membuat item
// qa/audit/goal/no_effort yang sudah dimulai kehabisan opsi, dan dialog menjawabnya dengan
// `return null` — tombol terklik, tak ada modal, tak ada pesan. Sekarang perpindahan lintas-alur
// ditawarkan berikut harganya: item kembali ke Brainstorming dan jejak sesi lamanya dibuang.
export function ChangeSourceDialog({ spec, onClose, onSubmit }: {
  spec: Spec;
  onClose: () => void;
  /** `payload` undefined = perpindahan se-alur pada item berjalan (isi tak ikut pindah). */
  onSubmit: (source: string, payload?: Record<string, string>, confirmReset?: boolean)
    => Promise<SourceResetPending | null>;
}) {
  const started = spec.stage !== "brainstorming" || spec.baseSha != null;
  const options = SOURCE_OPTS.filter((o) => o.value !== spec.source);
  const [target, setTarget] = React.useState(options[0]?.value ?? "");
  // Cermin `checkSourceChange` server: hanya perpindahan LINTAS-ALUR pada item berjalan yang
  // mereset. `brief ↔ help` tetap in-place seperti sebelum ADR-0149.
  const resetNeeded = started && flowForSource(target) !== flowForSource(spec.source);
  // Se-alur pada item berjalan: isinya memang tak berpindah (server menolak payload di jalur itu).
  const sameFlowStarted = started && !resetNeeded;
  const conv = React.useMemo(() => convertPayload(target, spec.payload), [target, spec.payload]);
  const [form, setForm] = React.useState<Record<string, string>>(
    () => conv.payload as Record<string, string>);
  const [pending, setPending] = React.useState<SourceResetPending | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Ganti target ⇒ form dirakit ulang dari peta konversi, dan rencana reset lama gugur: ia
  // dihitung server untuk target yang SUDAH TIDAK dipilih lagi.
  React.useEffect(() => { setForm(conv.payload as Record<string, string>); setPending(null); }, [target]);
  const setField = (k: string) => (e: React.ChangeEvent<any>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));
  const shape = payloadShapeFor(target);
  const fields = SHAPE_FIELDS[shape] ?? [];
  const labelOf = (key: string) =>
    (SHAPE_FIELDS[shapeOfPayload(spec.payload)] ?? []).find(([k]) => k === key)?.[1] ?? key;

  async function submit(confirmReset?: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await onSubmit(target, sameFlowStarted ? undefined : { ...form }, confirmReset);
      // `pending` = server minta konfirmasi; dialog TETAP terbuka dan berganti jadi daftar.
      if (res && res.pending) setPending(res);
      else onClose();
    } finally {
      setBusy(false);
    }
  }

  if (pending) return (
    <Modal open title="Item ini akan dikembalikan ke Brainstorming" icon="rotate-ccw"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label} → ${sourceMeta(target).label}`}
      onClose={busy ? undefined : onClose}>
      <div style={{ fontSize: 13.5, color: "var(--text-strong)", lineHeight: 1.55, marginBottom: 12 }}>
        Alur kerja {sourceMeta(target).label} berbeda dari yang sudah dikerjakan, jadi item ini
        mulai lagi dari awal. Kode yang sudah ter-commit di branch lain tak disentuh.
      </div>
      <ul data-testid="source-reset-impact" style={{
        fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)",
        marginBottom: 16, paddingLeft: 18, lineHeight: 1.6,
      }}>
        {pending.wouldDelete.map((f) => <li key={f}>{f}</li>)}
        {pending.worktree && <li>{pending.worktree}</li>}
        {pending.branch && <li>{pending.branch}</li>}
        {!pending.wouldDelete.length && !pending.worktree && !pending.branch && (
          <li>tak ada berkas yang perlu dibuang — hanya tahapnya yang mundur</li>
        )}
      </ul>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onClose}>Batal</Button>
        <Button size="sm" variant="danger" leftIcon="rotate-ccw" loading={busy}
          onClick={() => submit(true)}>Reset &amp; ubah type</Button>
      </div>
    </Modal>
  );

  return (
    <Modal open title="Ubah type backlog item" icon="shuffle"
      eyebrow={`${spec.id} · ${sourceMeta(spec.source).label}`} onClose={onClose}>
      <Field label="Type tujuan">
        <Select aria-label="Type tujuan" value={target} onChange={(e) => setTarget(e.target.value)}
          options={options} style={{ width: "100%" }} />
      </Field>
      {!options.length && (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Tak ada type lain yang bisa dituju. (Dialog tetap terbuka dan mengatakannya — menolak
          dengan diam adalah bug yang melahirkan ADR-0149.)
        </div>
      )}
      {sameFlowStarted ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
          Item ini sudah pernah dikerjakan sesi, dan type tujuannya memakai alur kerja yang sama —
          yang berpindah hanya <strong>labelnya</strong>. Isi, worktree, dan berkas fase tak disentuh.
        </div>
      ) : (
        <>
          {resetNeeded && (
            <div data-testid="source-reset-warning" style={{
              fontSize: 12.5, color: "var(--text-strong)", lineHeight: 1.5, marginBottom: 12,
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 10,
            }}>
              <Badge tone="warn" size="sm">alur kerja berbeda</Badge>{" "}
              Item ini akan kembali ke tahap <strong>Brainstorming</strong>; dokumen fase, worktree,
              dan branch sesi lamanya dihapus. Daftar persisnya ditampilkan sebelum kamu menyetujui.
            </div>
          )}
          {conv.dropped.length > 0 && (
            <div data-testid="source-dropped" style={{
              fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12,
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", padding: 10,
            }}>
              <Badge tone="warn" size="sm">tak punya padanan</Badge>{" "}
              {conv.dropped.map(labelOf).join(", ")} tidak ada di bentuk{" "}
              {sourceMeta(target).label}. Teks lamanya tetap tersimpan di{" "}
              <strong>jejak konversi</strong> item ini.
            </div>
          )}
          {shape !== "qa" && (
            <Field label="Prioritas">
              <Select aria-label="Prioritas" value={form.priority ?? "sedang"}
                onChange={setField("priority")} options={PRIO_OPTS} style={{ width: "100%" }} />
            </Field>
          )}
          {fields.map(([k, label, ph]) => (
            <Field key={k} label={label}>
              {k === "severity"
                ? <Select aria-label={label} value={form[k] ?? "minor"} onChange={setField(k)}
                    options={SEV_OPTS} style={{ width: "100%" }} />
                : <HnTextarea aria-label={label} value={form[k] ?? ""} onChange={setField(k)}
                    rows={2} placeholder={ph} />}
            </Field>
          ))}
        </>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onClose}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="shuffle" loading={busy}
          disabled={!options.length} onClick={() => submit()}>Ubah type</Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```bash
pnpm vitest --run src/test/change-source.test.tsx
```

Expected: PASS. Kalau `variant="danger"` tak ada di `Button` DS, periksa `src/src/ds/components/forms.tsx` dan pakai varian yang benar-benar tersedia — `ConfirmDialog.tsx:34` sudah memakai `danger`, jadi seharusnya ada.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/ChangeSourceDialog.tsx src/test/change-source.test.tsx
git commit -m "fix(backlog): dialog Ubah type tak lagi menolak dengan diam; tawarkan lintas-alur"
```

---

### Task 7: ADR & dokumentasi

**Files:**
- Create: `internal/docs/adr/0149-ubah-type-lintas-alur-dengan-reset.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/adr/0109-*.md` (tautan amandemen)

- [ ] **Step 1: Konfirmasi nomor ADR belum dipakai**

```bash
ls internal/docs/adr | tail -3
```

Expected: nomor tertinggi `0148`. Kalau sudah ada `0149` (worktree tetangga menerbitkannya lebih dulu), pakai nomor berikutnya yang bebas dan **sesuaikan seluruh rujukan ADR-0149** di kode yang sudah ditulis task-task sebelumnya.

- [ ] **Step 2: Tulis ADR**

Buat `internal/docs/adr/0149-ubah-type-lintas-alur-dengan-reset.md` mengikuti bentuk ADR tetangganya (baca `0147-kanal-presence-di-socket-sync.md` untuk formatnya). Isi wajib:

- **Konteks:** gerbang ADR-0109 mengunci flow; empat dari enam source sendirian di flow-nya, sehingga item `qa`/`audit`/`goal`/`no_effort` yang sudah dimulai punya nol tujuan. Dialog menjawab nol tujuan dengan `return null`, jadi penolakan itu **tak punya suara**: tombol terklik, tak ada modal. Terukur di DB produksi 2026-08-25: 307 item terdampak.
- **Keputusan:** perpindahan lintas-alur diizinkan dengan reset ke `brainstorming` + pembuangan dokumen fase, worktree, dan branch, di belakang konfirmasi dua fase. Se-alur tetap in-place.
- **Konsekuensi:** premis "stage hanya maju" (ADR-0008) ditembus lewat pintu eksplisit kedua — yang pertama revert stage SPEC-167. Sesi hidup menolak operasi (409). Branch remote tak disentuh. Webhook memancarkan `spec.source_changed`, bukan `spec.stage_changed`, untuk update gabungan ini.
- **Alternatif yang ditolak:** (a) tetap melarang dan hanya memperbaiki umpan baliknya — menyelesaikan gejala bisu tapi membiarkan operator tanpa jalan sama sekali; (b) izinkan lintas-alur tanpa reset — mengembalikan persis kelas bug yang melahirkan ADR-0109.

- [ ] **Step 3: Tautkan**

Tambahkan barisnya di `internal/docs/README.md` pada daftar ADR, dan tambahkan satu baris "Diamandemen ADR-0149" di kepala `internal/docs/adr/0109-*.md`.

- [ ] **Step 4: Verifikasi tautan terjangkau**

```bash
grep -n "0149" internal/docs/README.md internal/docs/adr/0109-*.md
```

Expected: kedua berkas menyebut 0149.

- [ ] **Step 5: Commit**

```bash
git add internal/docs
git commit -m "docs(adr-0149): amandemen ADR-0109 — lintas-alur boleh, dengan reset"
```

---

### Task 8: Verifikasi menyeluruh

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/spec-source-gate.test.ts server/test/spec-source.route.test.ts \
  server/test/spec-reset.test.ts server/test/spec-source-contract.test.ts \
  shared/src/spec-source.test.ts src/test/change-source.test.tsx
```

Expected: seluruhnya PASS.

- [ ] **Step 2: Cari pemakai lama yang ikut patah**

```bash
grep -rn "checkSourceChange\|changeSpecSource\|onChangeSource" --include='*.ts' --include='*.tsx' \
  server/src src/src shared/src cli sdk | grep -v node_modules
```

Setiap call site harus sudah cocok dengan tanda tangan barunya. Perhatikan `cli/` dan `sdk/` — kalau ada pemakai di sana, sesuaikan dan jalankan test-nya.

- [ ] **Step 3: Uji endpoint sungguhan di lokal**

Boot server, lalu terhadap sebuah item `qa` yang sudah `done` di DB dev:

```bash
curl -s -X POST localhost:3000/api/specs/<SPEC-nnn>/source \
  -H 'content-type: application/json' -d '{"source":"brief"}' | head -20
```

Expected: `{"pending":true,"wouldDelete":[...],"worktree":...,"branch":...}` — **bukan** 409. Lalu kirim ulang dengan `"confirmReset":true` dan pastikan balasannya `"stage":"brainstorming"` dan `"baseSha":null`.

> Pakai DB dev, bukan `~/.hanoman/hanoman.db` produksi operator — operasi ini menghapus berkas.

- [ ] **Step 4: Centang plan & commit**

Centang seluruh `- [ ]` yang selesai di berkas plan ini, lalu:

```bash
git add docs/superpowers/plans/2026-08-25-ubah-type-lintas-alur.md
git commit -m "docs(plan): centang penyelesaian ubah type lintas-alur"
```
