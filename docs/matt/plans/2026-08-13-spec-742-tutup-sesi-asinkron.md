# SPEC-742 — Tutup sesi terminal jadi asinkron · Implementation Plan

> **For agentic workers:** kerjakan task demi task. Tiap step berkotak (`- [ ]`) — centang saat
> benar-benar selesai & terverifikasi. hanoman menahan backlog di `executing` selama masih ada
> `- [ ]`.

**Goal:** `DELETE /terminal/sessions/:id` membalas dalam waktu yang tak bergantung ukuran worktree,
event loop tak pernah terblokir oleh pembersihan, dan operator bisa langsung membuka sesi baru —
termasuk untuk backlog yang sama — selagi penyapuan masih jalan.

**Architecture:** Worktree tak dihapus di jalur panas, melainkan di-`rename` ke
`<repoDir>/.worktrees/.trash/<sesi>.<stempel>` (1 ms). Penyapu in-process
(`services/worktree-reaper.ts`, `setInterval` 60 dtk + tendangan langsung + sapuan boot) menghapus
byte-nya dengan `fs.promises.rm`. `.trash` adalah catatan durable-nya; peta di memori cuma read
model untuk `GET /terminal/cleanups` + frame siar. Detail & alasan: [design doc](../specs/2026-08-13-spec-742-tutup-sesi-asinkron-design.md),
[ADR-0116](../../../internal/docs/adr/0116-penutupan-sesi-asinkron-worktree-trash.md).

**Tech Stack:** Node + TypeScript (Fastify), Prisma/SQLite, React 18 + Vite, vitest.

## Global Constraints

- **`fs.promises.rm`, JANGAN `rmSync`** di penyapu. Terukur 3 ms vs **1 364 ms** lag event loop
  untuk pekerjaan yang sama (gotcha 1 ADR-0116).
- **`advanceStage()` & `recordHeadSha()` tetap di dalam request, sebelum `rename`.** Keduanya membaca
  dari DALAM worktree (SPEC-176/ADR-0030, SPEC-475). Memindahkannya ke latar = stage tak maju &
  `headSha` hilang (gotcha 2).
- **`ownsWorktree()` berdiri SEBELUM `trashWorktree`.** `rename` sama merusaknya dengan `rm` bila
  targetnya checkout project (SPEC-362, gotcha 3).
- **`rename` gagal → jatuh ke `removeWorktree` sinkron**, jangan ke penghapusan latar atas path
  aslinya (gotcha 4).
- Penyapu **hanya** menyentuh `<repoDir>/.worktrees/.trash/**`. Tak pernah path hidup.
- Timer dipasang dari `server.ts` saja — `app.ts` tetap bebas-timer (ADR-0072/0103).
- Tanpa migration, tanpa kolom, tanpa domain capability baru.
- Test server: `./node_modules/.bin/vitest run --no-file-parallelism <path>` dari akar repo, dengan
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (SPEC-479). Test web: `cd src && env -u NODE_ENV
  ./node_modules/.bin/vitest run <path>` (SPEC-293 + jebakan cwd drift).
- Docs yang tersentuh diperbarui **dalam commit yang sama** & ter-link di `internal/docs/README.md`.

---

### Task 1 — Primitif `trashWorktree` + reclaim `addWorktree`

**Files:** Modify `runner/src/git.ts`, `runner/src/types.ts` · Test `runner/test/git.test.ts`

**Produces:** `GitOps.trashWorktree(repo, path): string | null` — memindahkan `path` ke
`<repo>/.worktrees/.trash/<basename>.<stempel36>-<urut36>`; `null` bila tak ada yang dipindah;
**melempar** bila pemindahannya mustahil (pemanggil yang jatuh ke `removeWorktree`).

- [x] **Step 1: Test yang gagal** di `runner/test/git.test.ts` — (a) `trashWorktree` memindahkan
  worktree keluar dari path-nya dan mengembalikan path trash yang isinya utuh; (b) path absen →
  `null`; (c) target = repo itu sendiri → **melempar** (cermin `removeWorktree`); (d) target yang
  sudah di dalam `.trash` → `null`; (e) `addWorktree` atas path yang sudah terisi berhasil merebutnya
  dan isi lamanya mendarat di `.trash`, bukan terhapus.
- [x] **Step 2: Implementasi.** `trashWorktree` di `realGit`: resolve target → tolak `=== resolve(repo)`
  → `null` bila tak ada atau sudah di dalam trash → `mkdirSync(trashDir, {recursive:true})` →
  `renameSync`. Nama entri: `${basename}.${Date.now().toString(36)}-${(seq++).toString(36)}`
  (id sesi disanitasi ke `[a-z0-9_-]` → tak pernah memuat titik, jadi `split(".")[0]` memulihkannya).
- [x] **Step 3: `addWorktree` merebut path lewat `trashWorktree`,** bukan `worktree remove --force` +
  `rmSync`. `git worktree prune` tetap dijalankan sesudahnya (yang membatalkan registrasinya). Gagal
  memindah → jalur lama apa adanya sebagai fallback.
- [x] **Step 4: Verifikasi** `./node_modules/.bin/vitest run runner/test/git.test.ts` hijau.

---

### Task 2 — Penyapu latar `worktree-reaper.ts`

**Files:** Create `server/src/services/worktree-reaper.ts` · Modify `server/src/services/notifications.ts`
· Test `server/test/worktree-reaper.test.ts`

**Produces:**
- `trashDirOf(repoDir): string`
- `releaseWorktree(repoDir, cwd, projectId): string | null` — trash + catat + tendang penyapu dalam
  SATU panggilan (efek samping yang dipisah ke call site = kelas bug SPEC-431/448/475/481)
- `listCleanups(): WorktreeCleanupView[]` — dari peta memori (read model, nol I/O)
- `sweepRepo(repoDir, projectId): Promise<number>` — rescan `.trash` → rekonsiliasi peta →
  `fs.promises.rm` tiap entri → `git worktree prune` **sekali per repo**
- `sweepAll(): Promise<void>` — atas repoDir unik seluruh project
- `startWorktreeReaper(): void` — sapuan boot + `setInterval` 60 dtk (`.unref()`)
- `reapSoon(repoDir, projectId): void` — fire-and-forget, ber-guard in-flight per repoDir
- `__resetReaper()` (test-only)
- di `notifications.ts`: `recordCleanupFailure(sessionId, projectId, entry, reason)` —
  `type:"cleanup"`, `key: "cleanup:<entry>"`, `P2002` diabaikan

- [x] **Step 1: Test yang gagal** di `server/test/worktree-reaper.test.ts` — (a) sapuan mengosongkan
  `.trash` dan mengembalikan jumlahnya; (b) sapuan atas repo tanpa `.trash` = no-op, tak melempar;
  (c) `rm` yang melempar → satu notifikasi `cleanup:` lahir, **entri tetap ada**, sapuan kedua
  mencoba lagi; (d) notifikasi tak berlipat untuk entri yang sama di sapuan berikutnya (`key` dedup);
  (e) `listCleanups()` memulihkan `sessionId` dari nama entri yang ditemukan di disk (jalur pasca-restart,
  tanpa lewat `releaseWorktree`); (f) sapuan **tak pernah** menyentuh apa pun di luar `.trash` — worktree hidup
  bertetangga tetap utuh.
- [x] **Step 2: Implementasi** dengan deps injectable (`rm`, `prune`, `projects`) — pola
  `AutoMergeDeps` (ADR-0103). Peta `Map<string, PendingCleanup>` berkunci path trash.
- [x] **Step 3: Verifikasi** `TEST_DATABASE_URL=… ./node_modules/.bin/vitest run --no-file-parallelism
  server/test/worktree-reaper.test.ts` hijau.

---

### Task 3 — Route `DELETE` 202 + `GET /terminal/cleanups` + wiring

**Files:** Modify `server/src/routes/terminal.ts`, `server/src/services/session-worktree.ts`,
`server/src/services/events.ts`, `server/src/server.ts` · Test `server/test/terminal.route.test.ts`,
`server/test/session-worktree.test.ts`

**Produces:** route memakai `releaseWorktree()` dari penyapu; `session-worktree.ts` tetap MURNI
(hanya `ownsWorktree`) — menaruh IO di sebelahnya melunturkan alasan ia diuji murni.

- [x] **Step 1: Test yang gagal** di `server/test/terminal.route.test.ts` — (a) `DELETE` → **202**
  dan `.worktrees/<id>` **sudah tak ada** saat respons kembali; (b) `stage` & `headSha` tetap terekam
  (test SPEC-176/SPEC-173 yang sudah ada, dipindah ke 202); (c) `POST /terminal/sessions` untuk spec
  yang **sama** langsung 201 selagi entri `.trash`-nya sengaja ditahan; (d) `GET /terminal/cleanups`
  memuat entri itu lalu kosong sesudah disapu; (e) sesi tanpa worktree → `202 { cleanup: null }`;
  (f) DELETE kedua → 404; (g) regresi SPEC-362 (menutup shell tak menghapus `repoDir`, `PENANDA.txt`
  selamat) tetap hijau.
- [x] **Step 2: Route `DELETE`** — urutan: gerbang → `resolveRepoDir` → `advanceStage` →
  `recordHeadSha` → `killSession` → `ownsWorktree` → `releaseWorktree` → `202 { cleanup }` →
  `reapSoon()` sesudah respons.
- [x] **Step 3: `GET /terminal/cleanups`** → `{ items: listCleanups() }`. Tanpa perubahan
  `capabilityForRoute` (jatuh ke `rw("sessions")`) — **tambahkan test yang mengikat itu**.
- [x] **Step 4: Grup siar `cleanups`** di `events.ts` (`everyTicks: 3`, `build` membaca peta memori →
  nol I/O per tick) + `startWorktreeReaper()` di `server.ts`.
- [x] **Step 5: Verifikasi** test server yang tersentuh hijau.

---

### Task 4 — Kontrak bersama & UI

**Files:** Modify `shared/src/api.ts`, `shared/src/dto.ts`, `src/src/api/client.ts`,
`src/src/screens/TerminalScreen.tsx` · Test `src/test/terminal-cleanups.test.tsx`

**Produces:** `paths.terminalCleanups`; `WorktreeCleanupView = { sessionId; projectId; entry; since;
error?: string }`; varian `EventMsg` `{ t: "cleanups"; cleanups: WorktreeCleanupView[] }`;
`api.listCleanups()`; tipe balikan `api.deleteTerminal` → `{ cleanup: string | null }`.

- [x] **Step 1: Test yang gagal** di `src/test/terminal-cleanups.test.tsx` — indikator "membersihkan
  N worktree…" muncul saat frame `cleanups` tak kosong dan hilang saat kosong; tab yang ditutup
  **langsung** lepas dari daftar tanpa menunggu apa pun.
- [x] **Step 2: Implementasi** kontrak bersama + klien + indikator di toolbar TerminalScreen
  (subscribe frame `cleanups`, cermin `sessions`).
- [x] **Step 3: Verifikasi** `cd src && env -u NODE_ENV ./node_modules/.bin/vitest run
  test/terminal-cleanups.test.tsx` hijau. Berkas test web yang me-mock `api` sebagian wajib menyebut
  `getMethodStatus` (SPEC-739).

---

### Task 5 — Docs & verifikasi akhir

**Files:** Modify `internal/docs/README.md`, `internal/docs/adr/README.md`,
`internal/docs/architecture/api-contract.md`, `internal/skills/hanoman/SKILL.md`

- [x] **Step 1: Index & narasi ADR** — tautkan ADR-0116 di `internal/docs/README.md` **dan**
  `internal/docs/adr/README.md` (SPEC-386: dua tempat, bukan satu).
- [x] **Step 2: `api-contract.md`** — `DELETE /terminal/sessions/:id` `204 → 202 { cleanup }`,
  `GET /terminal/cleanups`, frame siar `cleanups`.
- [x] **Step 3: `SKILL.md`** — satu butir di "Aturan Sesi & Eksekusi" berisi keputusan + gotcha-nya.
- [x] **Step 4: Verifikasi akhir** — test yang tersentuh hijau (`--changed "$HANOMAN_BASE_SHA"
  --no-file-parallelism`, dengan `TEST_DATABASE_URL` terisolasi), `pnpm --filter ./server typecheck`
  + paket lain yang tersentuh, dan **smoke nyata sekali di akhir**: boot server → buat sesi → `DELETE`
  → ukur latensinya → `GET /terminal/cleanups` → pastikan worktree benar-benar lenyap.

---

## Bukti verifikasi (2026-08-13)

**Test yang tersentuh — 70 berkas, 1 224 test, semuanya hijau.** Set-nya dipilih eksplisit, bukan
`--changed`: perubahan di `shared/src/{api,dto}.ts` murni **aditif** (satu tipe, satu varian
`EventMsg`, satu path), jadi `--changed` menyeret **376 berkas** yang dominasinya "mengimpor barrel",
bukan "terpengaruh". Yang dijalankan = setiap berkas test yang menyebut worktree/`killSession`/
`terminal/sessions`/`events`/`notifications`/`capabilityForRoute`/`realGit`, dijalankan
`--no-file-parallelism` dengan `TEST_DATABASE_URL` terisolasi (SPEC-479):
508 + 405 + 307 test (server + runner + shared) dan **149 berkas / 901 test** web.

`src/test/placeholder-contract.test.ts` gagal bila dijalankan dari `cd src` — ia memindai `src/src`
relatif terhadap cwd (jebakan cwd drift, bukan regresi); dari akar repo ia hijau.

**Typecheck:** `server` · `runner` · `shared` · `src` — keempatnya bersih.

**Smoke nyata** (server sungguhan, DB & `HANOMAN_HOME` terisolasi di tmpdir — `DATABASE_URL`
sesi menunjuk DB PRODUKSI, jadi wajib di-override), worktree sesi dibuat **533 MB / 24 719 entri**
supaya biayanya setara keadaan nyata:

| yang diukur | hasil |
|---|---|
| `DELETE /terminal/sessions/spec-141` | **202** dalam **47–56 ms**, body `{"cleanup":"spec-141.msrls5ec-0"}` |
| `.worktrees/spec-141` saat respons kembali | **sudah tak ada** |
| server responsif selama penutupan | 539 probe `/api/health`, **gap terburuk 35 ms** (interval probe sendiri 20 ms) |
| `POST /terminal/sessions` backlog **yang sama**, langsung sesudahnya | **201 `{id, resumed:true}` dalam 185 ms**, selagi entri trash 533 MB masih tertahan |
| worktree sesi baru | lahir bersih — `node_modules` lama **tidak** terbawa |
| `Spec.headSha` sesudah tutup | terekam (`a1d2bd53…`) — bookkeeping wajib-urut selamat |
| `.trash` & `GET /terminal/cleanups` | kosong dalam **< 1 dtk**; `git worktree list` bersih |
| notifikasi `type:"cleanup"` | nol (tak ada kegagalan) |

Pembanding yang membuat angka di atas berarti: penghapusan pohon yang sama secara sinkron terukur
**1 370 ms dengan event loop terblokir 1 364 ms dan NOL tick**, dan jalur lama membayarnya dua kali.
