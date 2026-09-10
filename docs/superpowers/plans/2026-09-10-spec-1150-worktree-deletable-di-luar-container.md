# SPEC-1150 — Worktree Deletable di Luar Container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (with superpowers:test-driven-development per task and superpowers:verification-before-completion at the end) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Worktree di luar `<repoDir>/.worktrees/` boleh dipilih & dihapus dari tab Worktrees seperti worktree biasa; satu-satunya baris yang tetap dikecualikan adalah checkout utama repo.

**Architecture:** Ganti gerbang `deletable` di `listWorktrees()` (`server/src/services/worktree-list.ts`) dari `ownsWorktree(baseReal, path)` (container-based) menjadi `path !== baseReal && path !== mainPath`, dengan `mainPath` diturunkan dari baris PERTAMA `git worktree list --porcelain` (working tree utama git yang sesungguhnya — git menjamin urutan ini apa pun cwd pemanggilnya). `ownsWorktree()` sendiri tidak disentuh; ia tetap gerbang untuk pelepasan OTOMATIS di `session-close.ts`/`spec-reset.ts` (SPEC-362), kelas masalah yang berbeda dan sengaja tetap sempit. `deleteWorktrees()`/`collectOrphanWorktrees()` dan `WorktreesPanel.tsx` sudah generik atas `deletable`/`blocked`, jadi tak perlu logika baru — hanya komentar yang menyebut `ownsWorktree` di file itu yang perlu diperbarui.

**Tech Stack:** TypeScript, Fastify, Vitest, git plumbing (`git worktree list --porcelain`).

## Global Constraints

- TypeScript strict; ikuti gaya & idiom di sekitar kode yang disentuh.
- Test HANYA yang tersentuh perubahan ini (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`), bukan suite penuh.
- Jangan ubah `ownsWorktree()` (`server/src/services/session-worktree.ts`) — di luar scope, dan mengubahnya akan melonggarkan pelepasan OTOMATIS worktree saat sesi ditutup/spec direset (SPEC-362), bukan hanya tab Worktrees.
- Nol migration, nol kolom, nol endpoint baru, nol perubahan bentuk `WorktreeView` DTO.
- Update `internal/docs` yang tersentuh (ADR-0132, ADR-0162, ADR-0163 baru, kedua index README, `api-contract.md`) dalam commit yang sama dengan kode (SPEC-386/CLAUDE.md).
- Komentar kode: hanya untuk WHY yang tak terbaca dari kode (alasan keputusan, workaround, invariant) — bukan narasi ulang apa yang kode lakukan.

---

### Task 1: Ganti gerbang `deletable` di `worktree-list.ts` + perbarui test lama

**Files:**
- Modify: `server/src/services/worktree-list.ts:1-21,100-145` (import, `listWorktrees()`)
- Test: `server/test/worktree-list.test.ts:109-128` (dua test existing yang berasumsi gerbang lama)

**Interfaces:**
- Consumes: `parseWorktreePorcelain(text: string): RawWorktree[]` (sudah ada, tak berubah — `RawWorktree = {path, head, branch, prunable, locked, bare}`).
- Produces: `listWorktrees(repoDir, inputs): Promise<WorktreeReport>` — signature tak berubah; hanya nilai `deletable`/`blocked` per baris yang berubah. `deleteWorktrees()` & `collectOrphanWorktrees()` (di file yang sama, tak disentuh task ini) konsumen `w.deletable`/`w.blocked` apa adanya.

- [x] **Step 1: Perbarui test "project ter-bind ke checkout DI BAWAH .worktrees" — sekarang HANYA checkout+main yang tak deletable, bukan nol baris**

Di `server/test/worktree-list.test.ts`, ganti test di baris 119-128:

```ts
  it("project ter-bind ke checkout DI BAWAH .worktrees → tak ada baris yang deletable", async () => {
    const dir = repo();
    const bound = join(dir, ".worktrees", "spec-1");
    const r = await listWorktrees(bound, NONE);
    expect(r.worktrees.length).toBeGreaterThan(1);
    expect(r.worktrees.every((w) => !w.deletable)).toBe(true);
  });
```

menjadi:

```ts
  // GOTCHA · hanoman didogfood DI DALAM worktree-nya sendiri: sebuah project bisa ter-bind ke
  // checkout yang kebetulan berada di bawah `.worktrees/`. Menguji bentuk path saja pernah membuat
  // removeWorktree(repoDir, repoDir) menghapus checkout project itu sendiri (SPEC-362). SPEC-1150
  // melonggarkan gerbang untuk worktree LAIN di luar container, tapi working tree utama yang
  // sesungguhnya (baris pertama `git worktree list`, di sini `dir`) tetap terlindung — kalau tidak,
  // insiden yang sama terjadi lagi hanya berpindah baris.
  it("project ter-bind ke checkout DI BAWAH .worktrees → checkout ITU dan working tree utama tetap tak deletable, sisanya boleh", async () => {
    const dir = repo();
    const bound = join(dir, ".worktrees", "spec-1");
    const r = await listWorktrees(bound, NONE);
    expect(r.worktrees.length).toBeGreaterThan(1);
    expect(r.worktrees.find((w) => w.path === realpathSync(dir))!.deletable).toBe(false);
    expect(r.worktrees.find((w) => w.path === realpathSync(bound))!.deletable).toBe(false);
    expect(r.worktrees.find((w) => w.name === "wt-feat")!.deletable).toBe(true);
    expect(r.worktrees.find((w) => w.name === "gone")!.deletable).toBe(true);
  });
```

Tambahkan juga test baru TEPAT SESUDAHNYA untuk kasus normal (acceptance criterion #1 spec):

```ts
  it("worktree DI LUAR .worktrees (dibuat manual) kini deletable — SPEC-1150", async () => {
    const dir = repo();
    const external = join(dir, "external-wt");
    g(dir, "worktree", "add", "-q", "--detach", external, "main");
    const r = await listWorktrees(dir, NONE);
    const w = r.worktrees.find((x) => x.path === realpathSync(external))!;
    expect(w.deletable).toBe(true);
    expect(w.blocked).toBeNull();
  });
```

`realpathSync` sudah diimpor di baris 3 file ini; `g()` helper git sudah didefinisikan di baris 11-15. Tidak ada import baru yang diperlukan.

- [x] **Step 2: Jalankan test untuk memastikan GAGAL (baseline sebelum implementasi)**

Run: `pnpm vitest --run server/test/worktree-list.test.ts`
Expected: FAIL — test "checkout ITU dan working tree utama tetap tak deletable, sisanya boleh" gagal karena `wt-feat`/`gone` masih `deletable:false` (gerbang lama `ownsWorktree` container-based), dan test "worktree DI LUAR .worktrees ... kini deletable" gagal karena `external-wt` belum ditemukan `deletable:true` (baris tak ada di daftar/kondisi lama menolaknya).

- [x] **Step 3: Implementasikan gerbang baru di `worktree-list.ts`**

Hapus import `ownsWorktree` (baris 7):

```ts
import { ownsWorktree } from "./session-worktree";
```

Di komentar `real()` (sekitar baris 66-70), ganti kalimat terakhir supaya tidak lagi menyebut `ownsWorktree` (yang sudah tak dipakai di file ini):

```ts
// `git worktree list` SELALU menjawab path fisik, sementara repoDir & cwd sesi datang apa adanya
// dari DB/tmux. macOS men-symlink `/tmp` dan `/var/folders` ke `/private/**`, jadi membandingkan
// string mentah gagal palsu — dan bukan cuma di direktori test: repo yang hidup di bawah symlink
// mana pun kena hal yang sama, dan gagalnya SENYAP (baris tak pernah cocok dengan sesinya, gerbang
// `ownsWorktree` menolak worktree yang sah). Cermin `samePath` di runner/src/git.ts.
```

menjadi:

```ts
// `git worktree list` SELALU menjawab path fisik, sementara repoDir & cwd sesi datang apa adanya
// dari DB/tmux. macOS men-symlink `/tmp` dan `/var/folders` ke `/private/**`, jadi membandingkan
// string mentah gagal palsu — dan bukan cuma di direktori test: repo yang hidup di bawah symlink
// mana pun kena hal yang sama, dan gagalnya SENYAP (baris tak pernah cocok dengan sesi/riwayatnya).
// Cermin `samePath` di runner/src/git.ts.
```

Lalu ganti badan `listWorktrees()` (sekitar baris 117-141) dari:

```ts
  const rows: WorktreeView[] = [];
  for (const w of parseWorktreePorcelain(text ?? "")) {
    const path = resolve(w.path);
    if (path === trash || path.startsWith(trash + sep)) continue;
    const name = basename(path);
    // SPEC-362 · `ownsWorktree` adalah SATU-SATUNYA gerbang, dan ia menguji HUBUNGAN cwd↔repoDir,
    // bukan bentuk path. hanoman didogfood di dalam worktree-nya sendiri, sehingga sebuah project
    // bisa ter-bind ke checkout yang kebetulan berada di bawah `.worktrees/`.
    const deletable = ownsWorktree(baseReal, path);
    const spec = inputs.specs.get(name);
    const latest = history.get(path);
    const orphan = latest && (!latest.endedAt || latest.endedReason === "reconciled")
      && !hasWorktreeSession(path, latest.sessionId, inputs.sessions)
      ? { historyId: latest.id, sessionId: latest.sessionId } : undefined;
    rows.push({
      path, name, head: w.head, branch: w.branch,
      prunable: w.prunable, locked: w.locked,
      deletable,
      blocked: deletable ? null : path === baseReal ? "checkout project" : "di luar .worktrees project ini",
      spec: spec ? { id: spec.id, stage: spec.stage } : null,
      session: sessions.get(path) ?? null,
      createdAt: await bornAt(path),
      ...(orphan ? { orphan } : {}),
    });
  }
```

menjadi:

```ts
  const raw = parseWorktreePorcelain(text ?? "");
  // SPEC-1150 · `git worktree list` SELALU memancarkan working tree utama sebagai baris PERTAMA,
  // apa pun cwd pemanggilnya (diverifikasi git 2.x) — sinyal dari struktur repo git itu sendiri,
  // independen dari binding repoDir project. Dogfooding hanoman di dalam worktree-nya sendiri bisa
  // membuat repoDir ter-bind ke checkout TERTAUT, bukan working tree utama; mengecualikan mainPath
  // di sini menjaga working tree utama yang SESUNGGUHNYA tetap tak bisa dihapus meski begitu
  // (ADR-0163) — tanpanya insiden SPEC-362 terulang, hanya berpindah baris.
  const mainPath = raw[0] ? resolve(raw[0].path) : null;
  const rows: WorktreeView[] = [];
  for (const w of raw) {
    const path = resolve(w.path);
    if (path === trash || path.startsWith(trash + sep)) continue;
    const name = basename(path);
    // SPEC-1150 · satu-satunya worktree yang dikecualikan dari hapus adalah checkout utama —
    // worktree lain di luar container `.worktrees` project kini boleh dipilih & dihapus.
    const deletable = path !== baseReal && path !== mainPath;
    const spec = inputs.specs.get(name);
    const latest = history.get(path);
    const orphan = latest && (!latest.endedAt || latest.endedReason === "reconciled")
      && !hasWorktreeSession(path, latest.sessionId, inputs.sessions)
      ? { historyId: latest.id, sessionId: latest.sessionId } : undefined;
    rows.push({
      path, name, head: w.head, branch: w.branch,
      prunable: w.prunable, locked: w.locked,
      deletable,
      blocked: deletable ? null : "checkout project",
      spec: spec ? { id: spec.id, stage: spec.stage } : null,
      session: sessions.get(path) ?? null,
      createdAt: await bornAt(path),
      ...(orphan ? { orphan } : {}),
    });
  }
```

- [x] **Step 4: Jalankan test lagi, pastikan LULUS**

Run: `pnpm vitest --run server/test/worktree-list.test.ts`
Expected: PASS — seluruh test di file ini (termasuk yang sudah ada sebelumnya: "repoDir sendiri tampil tapi TAK PERNAH deletable", dll.) hijau.

- [x] **Step 5: Commit**

Jangan commit di sini — repo ini memakai SATU commit di akhir seluruh pipeline (lihat instruksi run). Lanjut ke Task 2 tanpa commit antara.

---

### Task 2: Test level route untuk delete worktree di luar container

**Files:**
- Modify: `server/test/worktrees.route.test.ts` (tambah satu test baru di `describe("POST /projects/:id/worktrees/delete")`)

**Interfaces:**
- Consumes: `POST /api/projects/:id/worktrees/delete` (`{ names: string[] }` → `{ results: [{name, ok, cleanup|null, error?}] }`, tak berubah bentuknya), `GET /api/projects/:id/worktrees` (tak berubah bentuknya).

- [x] **Step 1: Tulis test baru (gagal dulu)**

Di `server/test/worktrees.route.test.ts`, sisipkan SESUDAH test `"branch terkunci melapor alasannya tanpa membatalkan penghapusan worktree"` (berakhir di baris ~178) dan SEBELUM `"checkout project sendiri TAK PERNAH bisa dihapus"` (baris ~180):

```ts
  it("worktree DI LUAR .worktrees kini bisa dihapus — SPEC-1150", async () => {
    const repoDir = await project("wp11");
    const external = join(repoDir, "external-wt");
    g(repoDir, "worktree", "add", "-q", "--detach", external, "main");
    const list = await app.inject({ method: "GET", url: "/api/projects/wp11/worktrees" });
    const row = list.json().worktrees.find((w: any) => w.name === "external-wt");
    expect(row.deletable).toBe(true);
    const r = await app.inject({ method: "POST", url: "/api/projects/wp11/worktrees/delete",
      payload: { names: ["external-wt"] } });
    expect(r.json().results[0]).toMatchObject({ ok: true });
    expect(existsSync(external)).toBe(false);
  });
```

`g`, `join`, `existsSync`, `project()` sudah tersedia di file ini (baris 4, 16, 2, 27). Tidak ada import baru.

- [x] **Step 2: Jalankan test, pastikan GAGAL sebelum Task 1 (atau LULUS bila Task 1 sudah selesai)**

Run: `pnpm vitest --run server/test/worktrees.route.test.ts -t "DI LUAR .worktrees kini bisa dihapus"`
Expected: PASS (Task 1 sudah menerapkan gerbang baru sebelum task ini dijalankan — bila dikerjakan berurutan seperti plan ini, test langsung hijau; verifikasi tetap dijalankan untuk membuktikan jalur TULIS, bukan cuma `listWorktrees()` murni, benar-benar menegakkannya).

- [x] **Step 3: Jalankan seluruh file test worktrees.route + worktree-list bersama, no-file-parallelism (server share satu DB test)**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`
Expected: seluruh test yang menyentuh berkas berubah (worktree-list.ts, worktree-list.test.ts, worktrees.route.test.ts, WorktreesPanel.tsx) PASS. Bila muncul kegagalan `P2022`/404 massal, itu tanda `TEST_DATABASE_URL` bentrok dengan sesi lain di mesin ini (lihat CLAUDE.md) — set `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan ulangi.

---

### Task 3: Perbarui komentar `WorktreesPanel.tsx` yang menyebut `ownsWorktree`

**Files:**
- Modify: `src/src/screens/WorktreesPanel.tsx:1-5`

Tidak ada test untuk task ini — murni komentar berkas, tak ada perilaku yang berubah (komponen sudah generik atas `w.deletable`/`w.blocked` dari server, dikonfirmasi Task 1-2).

- [x] **Step 1: Update komentar berkas**

Ganti (baris 1-5):

```tsx
/* SPEC-861 · ADR-0132 — panel worktree hidup: satu baris per worktree yang terdaftar di git,
   dengan hapus per baris + bulk yang ikut menutup sesinya dan (opsional) menghapus branch-nya.
   Pasangan BranchesPanel.tsx untuk sisi worktree; seluruh data turunan git dari server.
   Sesi tmux hidup, backlog belum selesai, dan isi kotor adalah PERINGATAN, bukan penolakan —
   satu-satunya baris yang tak bisa dihapus adalah yang ditolak `ownsWorktree` di server. */
```

menjadi:

```tsx
/* SPEC-861 · ADR-0132 — panel worktree hidup: satu baris per worktree yang terdaftar di git,
   dengan hapus per baris + bulk yang ikut menutup sesinya dan (opsional) menghapus branch-nya.
   Pasangan BranchesPanel.tsx untuk sisi worktree; seluruh data turunan git dari server.
   Sesi tmux hidup, backlog belum selesai, dan isi kotor adalah PERINGATAN, bukan penolakan —
   satu-satunya baris yang tak bisa dihapus adalah checkout utama repo (SPEC-1150/ADR-0163). */
```

- [x] **Step 2: Tak ada test untuk dijalankan — lanjut ke Task 4.**

---

### Task 4: Update internal/docs SoT (ADR-0132, ADR-0162, index, api-contract.md)

**Files:**
- Create: `internal/docs/adr/0163-worktree-di-luar-container-kini-deletable.md` — **sudah ditulis** selama fase Spec, isinya final. Task ini hanya memverifikasi isinya masih akurat terhadap Task 1 (baca ulang bila implementasi berbeda dari rencana).
- Modify: `internal/docs/adr/0132-permukaan-penghapusan-worktree.md` (baris 3-4 header, §3 "ownsWorktree() adalah satu-satunya gerbang deletable", butir terakhir §Konsekuensi)
- Modify: `internal/docs/adr/0162-pemungutan-worktree-yatim-dengan-konfirmasi.md` (baris 3-7 header, paragraf "Path `wt-spec-1099` di luar `.worktrees`...")
- Modify: `internal/docs/adr/README.md` (baris 3, tambah entri 0163 di atas)
- Modify: `internal/docs/README.md` (baris 103, tambah entri 0163 di atas, section `## adr`)
- Modify: `internal/docs/architecture/api-contract.md` (baris 642-643, 671-672)

- [x] **Step 1: Tambah baris amandemen di header ADR-0132**

Di `internal/docs/adr/0132-permukaan-penghapusan-worktree.md`, baris 4 saat ini:

```
- Amandemen SPEC-1109: [ADR-0162](0162-pemungutan-worktree-yatim-dengan-konfirmasi.md) menambah penanda yatim dari history/tmux, mode pemungutan dengan konfirmasi tanpa menutup pane, serta statistik gagal baca bernilai null.
```

Tambahkan baris baru TEPAT SESUDAHNYA:

```
- Amandemen SPEC-1150: [ADR-0163](0163-worktree-di-luar-container-kini-deletable.md) mengganti gerbang `deletable` §3 di bawah — bukan lagi `ownsWorktree` (container-based), melainkan pengecualian checkout utama saja (repoDir ATAU working tree utama git yang sesungguhnya). Worktree di luar `.worktrees` kini deletable; butir terakhir §Konsekuensi di bawah digantikan uraian di ADR-0163.
```

- [x] **Step 2: Perbarui §3 ADR-0132 supaya tidak lagi mengaku `ownsWorktree` sebagai gerbang**

Ganti paragraf (sekitar baris 89-94):

```
**`ownsWorktree()` adalah satu-satunya gerbang `deletable`, dan ditegakkan di jalur TULIS.** Ia
menguji HUBUNGAN path↔repoDir, bukan bentuk path. hanoman didogfood di dalam worktree-nya sendiri,
sehingga sebuah project bisa ter-bind ke checkout yang kebetulan berada di bawah `.worktrees/` —
menguji bentuk path saja pernah membuat `removeWorktree(repoDir, repoDir)` menghapus checkout
project itu sendiri (SPEC-362). Checkout project tetap **tampil** sebagai baris (ia konteks yang
berguna) dengan `deletable: false` dan alasan prosa di `blocked`.
```

menjadi:

```
**Gerbang `deletable` ditegakkan di jalur TULIS** (lihat amandemen ADR-0163: sejak SPEC-1150
bukan lagi `ownsWorktree`, melainkan pengecualian checkout utama saja). Checkout project tetap
**tampil** sebagai baris (ia konteks yang berguna) dengan `deletable: false` dan alasan prosa
`"checkout project"` di `blocked`.
```

- [x] **Step 3: Perbaiki butir terakhir §Konsekuensi ADR-0132**

Ganti (sekitar baris 142-144):

```
- Pada instance dogfood yang project-nya ter-bind ke checkout DI BAWAH `.worktrees/`, **tak ada**
  baris yang deletable. Itu benar dan disengaja: `ownsWorktree` menolak, dan menolak adalah jawaban
  yang aman.
```

menjadi:

```
- Pada instance dogfood yang project-nya ter-bind ke checkout DI BAWAH `.worktrees/`: **sejak
  ADR-0163 (SPEC-1150)** hanya checkout yang di-bind DAN working tree utama git yang sesungguhnya
  yang tetap `deletable:false` — bukan lagi seluruh baris.
```

- [x] **Step 4: Tambah baris amandemen & catatan di ADR-0162**

Di `internal/docs/adr/0162-pemungutan-worktree-yatim-dengan-konfirmasi.md`, baris 3-7 saat ini:

```
Status: accepted · 2026-09-05 · SPEC-1109. Kebijakan direkomendasikan sesudah audit dan
disetujui melalui instruksi pengguna untuk melanjutkan. Menegakkan
[0084](0084-melanjutkan-sesi-backlog.md), [0016](0016-sesi-terminal-hidup-di-tmux.md),
[0116](0116-penutupan-sesi-asinkron-worktree-trash.md), dan memperluas
[0132](0132-permukaan-penghapusan-worktree.md).
```

Tambahkan kalimat di akhir paragraf itu:

```
Status: accepted · 2026-09-05 · SPEC-1109. Kebijakan direkomendasikan sesudah audit dan
disetujui melalui instruksi pengguna untuk melanjutkan. Menegakkan
[0084](0084-melanjutkan-sesi-backlog.md), [0016](0016-sesi-terminal-hidup-di-tmux.md),
[0116](0116-penutupan-sesi-asinkron-worktree-trash.md), dan memperluas
[0132](0132-permukaan-penghapusan-worktree.md). **Diamandemen SPEC-1150/[ADR-0163](0163-worktree-di-luar-container-kini-deletable.md)**
pada paragraf checkout non-kanonik di bawah: kepemilikan yang tak terbukti tak lagi jadi alasan
menolak pemindahannya.
```

Lalu ganti paragraf "Path `wt-spec-1099` di luar `.worktrees`..." (sekitar baris 53-56):

```
Path `wt-spec-1099` di luar `.worktrees` tidak ditemukan pembuatnya di jalur produk
saat ini; seluruh peluncur membentuk path kanonik. Ia tetap ditampilkan bila
terdaftar git, dengan alasan blokir. Pemindahan checkout non-kanonik dikecualikan
karena kepemilikannya tidak terbukti; tidak ada migrasi diam-diam.
```

menjadi:

```
Path `wt-spec-1099` di luar `.worktrees` tidak ditemukan pembuatnya di jalur produk
saat ini; seluruh peluncur membentuk path kanonik. **Diamandemen ADR-0163 (SPEC-1150):**
checkout non-kanonik yang terdaftar git kini deletable seperti worktree biasa — hanya
checkout utama repo (repoDir ATAU working tree utama git yang sesungguhnya) yang tetap
dikecualikan pemindahannya.
```

- [x] **Step 5: Tambah entri index di `internal/docs/adr/README.md`**

Sisipkan baris baru di baris 3 (sebelum entri 0162 yang sudah ada):

```
- [0163 — Tab Worktrees: hanya checkout utama yang dikecualikan dari hapus, bukan lagi seluruh isi di luar `.worktrees`](0163-worktree-di-luar-container-kini-deletable.md) — SPEC-1150: **mengamandemen** 0132 §3/Konsekuensi & 0162 (paragraf checkout non-kanonik). `deletable` bukan lagi `ownsWorktree` (container-based) — hanya `path === repoDir` ATAU `path === mainPath` (baris pertama `git worktree list --porcelain`, working tree utama git yang sesungguhnya, sinyal independen dari binding repoDir) yang dikecualikan. `ownsWorktree()` sendiri tak berubah, tetap dipakai `session-close.ts`/`spec-reset.ts` untuk pelepasan OTOMATIS (SPEC-362), kelas masalah berbeda yang sengaja tetap sempit.
```

- [x] **Step 6: Tambah entri index di `internal/docs/README.md`**

Sisipkan baris baru di baris 103 (sebelum entri 0162 yang sudah ada, di section `## adr`):

```
- [0163 — Tab Worktrees: hanya checkout utama yang dikecualikan dari hapus](adr/0163-worktree-di-luar-container-kini-deletable.md) — **mengamandemen 0132 §3/Konsekuensi & 0162**. Worktree di luar `.worktrees` kini `deletable:true` di tab Worktrees; gerbangnya `path !== repoDir && path !== mainPath` (working tree utama git, baris pertama porcelain — bukan lagi `ownsWorktree` container-based). `ownsWorktree()` tak berubah, tetap gerbang pelepasan otomatis SPEC-362 (SPEC-1150)
```

- [x] **Step 7: Perbarui `internal/docs/architecture/api-contract.md`**

Ganti (baris 642-643):

```
#   deletable = ownsWorktree(repoDir, path) — HUBUNGAN path↔repoDir, bukan bentuk path (SPEC-362).
#   Checkout project ikut tampil dengan deletable:false + blocked:"checkout project".
```

menjadi:

```
#   deletable = path !== repoDir && path !== mainPath (baris pertama porcelain = working tree
#   utama git yang sesungguhnya, ADR-0163/SPEC-1150) — bukan lagi ownsWorktree container-based;
#   worktree di luar .worktrees kini deletable. ownsWorktree tetap gerbang SPEC-362 terpisah,
#   dipakai session-close/spec-reset untuk pelepasan OTOMATIS (lihat DELETE /terminal/sessions/:id).
#   Checkout utama ikut tampil dengan deletable:false + blocked:"checkout project".
```

Ganti (baris 671-672):

```
#   Tak ada baris terkunci permanen: sesi hidup / backlog belum done / isi kotor = PERINGATAN yang
#   dinamai dialog konfirmasi (useConfirm + impact[], ADR-0127), bukan penolakan. Yang menolak hanya
#   ownsWorktree. Penghapusan BRANCH tetap bisa gagal & alasannya dilaporkan di baris `branch`.
```

menjadi:

```
#   Tak ada baris terkunci permanen: sesi hidup / backlog belum done / isi kotor = PERINGATAN yang
#   dinamai dialog konfirmasi (useConfirm + impact[], ADR-0127), bukan penolakan. Yang menolak hanya
#   checkout utama repo (ADR-0163). Penghapusan BRANCH tetap bisa gagal & alasannya dilaporkan di
#   baris `branch`.
```

- [x] **Step 8: Tak ada test otomatis untuk dokumentasi — verifikasi manual dengan membaca ulang kelima berkas yang diubah, pastikan tautan `[0163](...)` valid (nama berkas cocok) dan tak ada sisa referensi `ownsWorktree` yang salah konteks di area yang diubah.**

---

### Task 5: Verifikasi akhir

**Files:** tidak ada perubahan; hanya menjalankan perintah.

- [x] **Step 1: Jalankan seluruh test yang tersentuh perubahan (scope SPEC-1150), serial**

Run: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`
Expected: semua PASS, termasuk `server/test/worktree-list.test.ts`, `server/test/worktrees.route.test.ts`, dan test lain yang men-`import` `worktree-list.ts`/`session-worktree.ts` (mis. `worktree-collect.test.ts`, `session-worktree.test.ts` — harus tetap hijau tanpa perubahan karena `ownsWorktree` tak disentuh). Pastikan test BENAR-BENAR berjalan (bukan "no test files" — `--changed` menyalakan `passWithNoTests`).

- [x] **Step 2: Typecheck paket server saja**

Run: `pnpm --filter ./server typecheck`
Expected: 0 error.

- [x] **Step 3: Smoke endpoint end-to-end (task ini menyentuh endpoint `GET|POST /projects/:id/worktrees*`)**

Boot server lokal (`pnpm dev` di root, atau `node server/dist/server.js` bila sudah dibuild) di worktree ini, lalu — pada repo git nyata dengan project ter-daftar — `curl` `GET /api/projects/:id/worktrees` dan konfirmasi baris worktree di luar `.worktrees` (bila ada) tampil `deletable:true`, `blocked:null`, dan baris checkout utama tetap `deletable:false`, `blocked:"checkout project"`. Hentikan server sesudahnya.

- [x] **Step 4: Centang checklist plan ini (`- [ ]` → `- [x]`) untuk setiap task/step yang selesai, sesuai CLAUDE.md.**

- [x] **Step 5: Commit SEMUA perubahan (kode + test + docs) dalam satu commit, lalu `git push origin HEAD:refs/heads/hanoman/spec-1150`.**

Ini worktree detached HEAD — itu disengaja (lihat instruksi run).
