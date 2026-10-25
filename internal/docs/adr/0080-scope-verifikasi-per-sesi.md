# ADR-0080 — Scope verifikasi per sesi: klausa prompt + env, bukan hook deny

**Status:** aktif (SPEC-376). Memperluas ADR-0061 (model/effort per sesi), ADR-0073 (mode goal per
sesi), ADR-0074 (agen per sesi) — pola "properti sesi" yang sama. Terkait ADR-0002 (isolasi
worktree), ADR-0029 (gate plan terceklist), ADR-0072 (cap concurrency scheduler).
**TIDAK membalik ADR-0037** — tak ada hook deny yang dihidupkan kembali.
**Diperluas ADR-0229** — nilai ketiga `"none"` (sesi tak menjalankan test sama sekali).

## Konteks

Sesi hanoman cenderung memverifikasi **seluruh** project untuk perubahan sekecil apa pun: suite
test penuh, `pnpm -r typecheck`, lint repo-wide, build produksi, dan boot server + curl. Beberapa
sesi berjalan bersamaan di satu mesin operator (8 core / 8 GB), jadi biaya itu dikalikan sampai
mesin tersendat.

Ukuran nyata di repo hanoman sendiri:

| Kebiasaan | Biaya |
| --- | --- |
| `vitest run --no-file-parallelism` (DoD lama di `AGENTS.md`) | **258 berkas test** (server 136 · src 85 · shared 19 · runner 10 · cli 6 · sdk 2) |
| `pnpm -r typecheck` | **6 proses `tsc`** serentak |
| `pnpm build` | `vite build` + `esbuild` bundling |
| Boot server + curl (dulu diwajibkan `CLAUDE.md` tiap task) | Postgres + build + proses server per task |

**Akar masalahnya bukan satu berkas melainkan lubang di kontrak prompt.** `runner/src/prompt.ts` —
satu-satunya instruksi yang hanoman berikan ke sesi — bicara soal fase (`phaseInstruction`),
otonomi (`AUTONOMY_CLAUSE`), skill (`skillInstruction`), commit, dan push, tapi **tak pernah
menyebut scope verifikasi sama sekali**. Karena prompt diam, agen jatuh ke dua sumber lain:
konvensi repo target (DoD-nya sendiri) dan kebiasaan default "kalau ragu, jalankan semuanya".

## Keputusan

**Scope verifikasi menjadi properti sesi yang dinyatakan eksplisit**, sama seperti model/effort
(ADR-0061), mode goal (ADR-0073), dan agen (ADR-0074).

1. **Kosakata `verifyScope`** — `"changed"` (default baru) | `"full"` (perilaku lama).
   `zVerifyScope` di `@hanoman/shared`, cermin `VerifyScope` di `@hanoman/runner` (pola
   `Flow`/`zFlow`, `Agent`/`zAgent`).
2. **Knob global `Setting.verifyScope`** dengan `.default("changed")`. `Setting.data` adalah kolom
   `Json` → **tanpa migration**; baris `Setting` lama tanpa kunci ini tetap parse.
3. **Override per sesi** — `verifyScope` opsional di body `POST /terminal/sessions`, dipilih di
   `StartSessionModal`. Presedens: **override sesi → `Setting.verifyScope` → `"changed"`**.
4. **Mewujud sebagai klausa prompt** (`runner/src/verify-scope.ts` → `verifyScopeClause`), disisipkan
   `startPrompt`/`continuePrompt` **hanya untuk flow yang punya fase `Execute`**. Flow dokumen
   (`audit`, `cross-audit`, `prd`, `breakdown`, `reverse`, `scaffold`) tak menulis kode, jadi tak
   punya test untuk dijalankan — klausa di sana hanya menambah token. `"full"` menghasilkan string
   kosong, jadi prompt-nya persis seperti sebelum spec ini.
5. **Ditopang env sesi** — `HANOMAN_BASE_SHA` (commit tempat worktree lahir; sudah dihitung
   `realGit.addWorktree`) dan `HANOMAN_VERIFY_SCOPE`, lewat `CreateOpts.env` yang sudah ada
   (jalur yang sama dipakai kunci audit lintas, ADR-0075).

Isi klausa `changed`: cari berkas berubah lewat `git diff --name-only "$HANOMAN_BASE_SHA"...HEAD`
+ `git status --porcelain`; test ber-scope (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` /
`vitest related` / sebut path; padanan `pytest <path>`, `go test ./paket/...`) dan **jangan**
`pnpm test`/`vitest run` polos; typecheck **per paket**, bukan `pnpm -r typecheck`; lint hanya
berkas berubah; build penuh hanya bila menyentuh build/bundling; boot server + curl hanya bila
menyentuh endpoint, sekali di akhir.

## Konsekuensi

- **Mengarahkan, bukan memaksa.** Tak ada hook `PreToolUse` yang menolak perintah — ADR-0037 tetap
  utuh, dengan preseden ADR-0073 yang menambah hook `Stop` sambil menegaskan ia bukan guardrail
  deny. Agen yang memilih menjalankan suite penuh tetap bisa; yang diubah adalah default yang ia
  ikuti saat prompt tak berkata apa-apa.
- **Jalan keluar eksplisit ada di dalam klausanya.** Scope sempit yang dipatuhi membabi buta akan
  meloloskan regresi, jadi klausa menyuruh agen memperluas scope sendiri untuk perubahan berdampak
  luas (tipe/kontrak bersama, skema, berkas yang diimpor banyak modul) **asal menyebut alasannya**.
- **Suite penuh pindah ke manusia sebelum merge**, bukan ke sesi. DoD hanoman (`AGENTS.md`,
  `CLAUDE.md`, `internal/skills/hanoman/SKILL.md`) diperbarui mengikuti keputusan ini — sumber
  kebiasaan lama itu ada di sana.
- **Terminal biasa tak terjangkau klausa.** Sesi agen tanpa `flow` lahir **tanpa prompt** (manusia
  yang mengetik), jadi ia hanya menerima env; pengarahannya datang dari `AGENTS.md`/`CLAUDE.md` repo
  target. Batas yang disadari, bukan yang terlewat.
- **Tanpa migration, tanpa kolom DB, tanpa endpoint baru.**

## Gotcha wajib

- **`vitest --changed` menyalakan `passWithNoTests`** (`resolveConfig.ts`: `if (resolved.changed)
  resolved.passWithNoTests ??= true`). Artinya **nol test terlihat hijau** — scope sempit justru
  memproduksi kepercayaan palsu bila agen menerima "no test files" sebagai bukti. Klausa menyebut
  jebakan ini terang-terangan.
- **`baseSha` WAJIB lewat env.** Worktree sesi lahir `--detach` (ADR-0002), jadi di dalamnya `main`
  belum tentu ada dan `HEAD~1` salah (ia menunjuk commit sebelum kerja sesi hanya kalau kebetulan
  ada tepat satu commit). Tanpa `HANOMAN_BASE_SHA`, "berkas yang berubah" hanya bisa ditebak.
- **Env sesi tak terlihat di argv.** `pty.createSession` memasang env sebagai **prefix shell**
  (`K=V … claude …`, bukan `new-session -e` yang baru ada sejak tmux 3.0), jadi ia tak pernah muncul
  di keluaran `/bin/echo`. Membuktikannya harus dari DALAM proses — `server/test/fixtures/
  fake-agent-env.sh` mencetak nilainya (pola SPEC-337).
- **Penggabungan env harus aditif.** `session-launch` menggabung `{...scopeEnv, ...extra.env}`; kalau
  salah satunya menimpa yang lain, sesi cross-audit kehilangan kunci `HANOMAN_AUDIT_KEY`-nya.
- **Untuk perubahan di modul INTI, `--changed` memang mendekati suite penuh — dan itu benar.**
  Terukur saat mengerjakan SPEC-376 ini sendiri: karena ia menyentuh `shared/src/enums.ts`,
  `entities.ts`, dan `dto.ts` (diimpor hampir semua modul), `pnpm vitest --run --changed <baseSha>`
  menjalankan **217 berkas / 1589 test dalam 177 dtk** — praktis seluruh repo. Penghematan datang
  dari perubahan berdaun (route, komponen, satu service), bukan dari perubahan kontrak bersama.
  Ini **fitur, bukan kegagalan**: `--changed` menghitung blast radius yang sebenarnya alih-alih
  menebaknya, jadi ia menyempit saat memang aman menyempit dan melebar saat memang harus melebar.
  Jangan "memperbaiki"-nya dengan menyaring path secara manual.
- **Run ber-scope yang lebih besar memunculkan flake yang sudah ada, dan itu mudah disalahartikan
  sebagai regresi.** Saat mengerjakan SPEC-376, `server/test/sync-ws.test.ts` melewati timeout
  5000 ms di dua run campur-project, tetapi: lulus **186 ms** sendirian, lulus bersama tetangga
  server (`session-launch`+`terminal.route`+`cross-audit`), lulus bersama 25 berkas `src`, dan
  **lulus saat set 15-berkas yang persis sama dijalankan ulang** (185/185). Jadi ia
  **non-deterministik**, bukan akibat perubahan mana pun — penyebab pastinya belum ditemukan dan
  di luar scope ADR ini. Aturannya: sebelum menyalahkan perubahanmu, jalankan ulang berkas itu
  terisolasi DAN ulangi set yang sama; satu kegagalan tunggal di run besar bukan bukti regresi.

## Alternatif yang ditolak

- **Hook `PreToolUse` yang MENOLAK `pnpm test` / `vitest run` polos.** Deterministik, tapi itu
  menghidupkan kembali guardrail deny — ADR-0037 mensyaratkan ADR baru yang mencabutnya. Ditolak
  operator secara eksplisit saat brainstorm: jaminan keras tak sebanding dengan membalik keputusan
  kepercayaan-penuh terhadap agen.
- **Cukup memperbarui `AGENTS.md`/`CLAUDE.md` hanoman.** Menyembuhkan repo ini saja; hanoman adalah
  orchestrator yang mendorong **banyak** project, dan prompt adalah satu-satunya kanal yang sampai
  ke semuanya.
- **Menurunkan `Setting.scheduler.maxConcurrent`.** Mengurangi jumlah sesi, bukan biaya per sesi —
  dan mengurangi throughput justru bertentangan dengan tujuan scheduler (ADR-0072). Ortogonal;
  knob itu tetap ada.
- **Mengatur `--maxWorkers`/`poolOptions` vitest dari hanoman.** hanoman tak memiliki konfigurasi
  vitest project target dan tak boleh menyuntiknya; lagipula ia menekan paralelisme tanpa menekan
  **jumlah** test yang dijalankan.
