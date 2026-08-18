---
name: hanoman
description: >-
  Pakai saat mengerjakan project hanoman: orchestrator + dashboard workflow
  docs-driven untuk nafanesia.id — perencanaan produk, arsitektur (Fastify +
  SQLite/Prisma + node-pty/tmux + git worktree), distribusi paket npm global
  (`hanoman start|doctor|update|migrate-from-postgres`), sesi Claude Code
  interaktif, fase spec/plan/execute, backlog & PRD, terminal realtime, modul
  VPS/sync, auth, keamanan, design system, docs Source of Truth, atau operasi
  agent di dalam repo hanoman.
---

# hanoman

## Ikhtisar

hanoman adalah **orchestrator workflow docs-driven** untuk nafanesia.id: ia menyuruh **Claude Code** membangun project terhadap dokumentasi sebagai kebenaran, lalu memantau semua sesi dalam satu dashboard yang tenang. Manusia menuang ide / menulis brief / memfilekan QA finding → hanoman brainstorm sampai **MVP objective** terkunci → **scaffold** doc index (from-scratch) atau **reverse-engineer** docs dari codebase (existing). Brief & finding menjadi **spec** di backlog; spec di-**plan** lalu di-**execute** oleh Claude Code sebagai **sesi interaktif** di **git worktree terisolasi** per backlog. Pakai skill ini untuk menjaga keputusan produk, arsitektur, sesi, keamanan, dan docs tetap selaras dengan `internal/docs/**`.

## Bacaan Awal

Saat memulai kerja hanoman, baca hanya doc yang dibutuhkan task:

- Index Source of Truth: `internal/docs/README.md`
- Blueprint satu halaman: `internal/docs/entrypoints/blueprint.md`
- Entrypoints: `internal/docs/entrypoints/{brd,prd,frd,rd}.md`
- Product: `internal/docs/product/blueprint.md` · `scope-principles.md` · `onboarding.md`
- Requirements detail: `internal/docs/requirements/{prd,frd,rd}.md`
- Standar acceptance (EARS): `internal/docs/requirements/acceptance-criteria-ears-standard.md`
- Tech stack: `internal/docs/architecture/stack.md`
- Data model (tujuh model): `internal/docs/architecture/data-model.md`
- Kontrak API: `internal/docs/architecture/api-contract.md`
- NFR: `internal/docs/architecture/nfr.md`
- Kontrak agent: `internal/docs/operations/agent-documentation-workflow.md`
- Standar keamanan: `internal/docs/security/security-standard.md`
- Design system (editorial, bone paper, brass accent): `internal/docs/design-system/design-system.md`
- Implementasi frontend: `internal/docs/frontend/frontend-implementation.md`
- Roadmap & GTM: `internal/docs/operations/{roadmap,gtm}.md`
- Deploy: `internal/docs/operations/deploy-vps.md` (split public/control host, non-root systemd, rootless agent sandbox) · `production.md` (prod di samping dev) · `security/threat-model.md` · `npm-readme.md`
- ADR (nomor unik & imutable): daftar lengkap di `internal/docs/README.md`, narasinya di `internal/docs/adr/README.md`; yang paling sering diacu — 0086 (SQLite satu-satunya provider) & 0087 (distribusi npm global), 0024 (sesi interaktif menggantikan run), 0023 (guardrail SoT dicabut), 0037 (guardrail safety dicabut), 0002 (isolasi worktree), 0015 (satu backlog satu sesi), 0016 (sesi tmux), 0028 (auth sesi opaque), 0011/0018 (docs & coverage live/derived), 0035 (sesi tembus batas fase), 0041 (PRD sebagai dokumen), 0043–0048 (sync/device-token/auto-update).
- Kontrak agent repo: `AGENTS.md` · `CLAUDE.md` (root repo).

## Sub-Skill

Pakai skill lebih sempit saat task cocok:

- `hanoman-devops` (`internal/skills/hanoman-devops/SKILL.md`) — deploy & operasikan aplikasi hanoman: paket npm global, non-root systemd, split public/control ingress, rootless Podman agent sandbox, prod berdampingan, migrasi Postgres, update, sync, retensi, dan incident rotation.

## Aturan Produk

- Bentuk produk: **instrument panel yang tenang**. Overview sebagai beranda; tiap area (Projects/PRD/Backlog/Terminal/Docs/VPS/Settings) satu klik dari sidebar; Terminal adalah pusat gravitasi saat sesuatu berjalan.
- **Manusia terakhir yang memutuskan.** Otomasi penuh boleh, tapi selalu bisa diinterupsi/di-steer.
  **Kecuali project yang meng-opt-in hanoman-lead** (SPEC-409/ADR-0091): di sana prinsipnya jadi
  **"manusia terakhir yang bisa membatalkan"** — lead memutuskan lalu melapor. Opt-in per project,
  default mati; selama `Setting.lead.enabled` mati prinsip lama berlaku di seluruh workspace.
- **Satu workspace dulu** (nafanesia.id). Multi-tenant adalah pasca-MVP.
- Objektif MVP: satu operator menjalankan & memantau Claude Code di banyak project sekaligus, dengan docs sebagai Source of Truth, tanpa kehilangan kendali atas sesi berjalan.
- Empat lakon (temperamen produk): **Anoman Duta** (kepercayaan dibuktikan spec & docs), **Anoman Obong** (sesi menyelesaikan tugas & lapor balik), **Gunung Dronagiri** (ragu → dokumentasikan semuanya), **Chiranjivi** (docs abadi melampaui commit).
- PRD (SPEC-210) duduk di hulu Backlog: brief + brainstorm → dokumen PRD sebelum fitur dipecah ke spec + plan.

## Aturan Arsitektur

- Dashboard: **React + TypeScript + Vite**. Server: **Node.js + TypeScript (Fastify)**. DB: **SQLite via Prisma 6** — satu berkas di `$HANOMAN_HOME` (default `~/.hanoman/hanoman.db`), **tanpa Docker/Postgres/Redis** (SPEC-398/ADR-0086). Lokasi data ditentukan tiga fungsi murni di `runner/src/paths.ts` (`resolveHome`/`resolveDbUrl`/`dbFilePath`), dipakai server **dan** CLI; `DATABASE_URL` non-`file:` **melempar** dan menunjuk `hanoman migrate-from-postgres`.
- **Distribusi = paket npm global** (SPEC-398/ADR-0087): `npm i -g hanoman` → `hanoman`. `hanoman` telanjang = `start` (migrate deploy → spawn server production); `doctor` juga memeriksa kesiapan rootless Podman/network/egress proxy/credential dir saat public/production boundary diwajibkan (SPEC-761/ADR-0117). `update [--check]` membandingkan semver registry; `migrate-from-postgres` memindahkan instance lama. Packaging server tetap non-container, tetapi semua proses agen production masuk sandbox. Deteksi update read-only di server; staging rilis `dist-npm/` dirakit `hanoman __pack`; **`npm publish` tindakan manusia**.
- **Update sekali klik, tapi server tetap tak memasang apa pun** (SPEC-405/ADR-0088, mengamandemen
  ADR-0048 & membalik satu alternatif yang ditolak ADR-0087): `POST /api/update/apply` hanya membuat
  proses server **keluar dengan `UPDATE_RESTART_EXIT = 75`**; yang menjalankan `npm i -g hanoman@latest`
  → `prisma generate` → `migrate deploy` → spawn lagi adalah **CLI parent `hanoman start`**, yang sejak
  ADR-0087 memang sudah men-spawn server sebagai proses ANAK. **Supervised-only**: digerbangi
  `process.env.HANOMAN_SUPERVISOR === "1"` yang HANYA disuntik `serverEnv()` di
  `cli/src/commands/start.ts` dan diekspor sebagai `UpdateStatus.canApply` — **dibaca dari
  `process.env` langsung, bukan `effectiveBool()`**, karena helper itu membaca cache config DB lebih
  dulu sehingga siapa pun yang bisa menulis config bisa mengaku disupervisi. Endpoint punya **dua
  langkah**: tanpa `confirm` ia dry-run `409 confirm-required` + jumlah sesi hidup yang dihitung saat
  itu juga (jumlah itu sengaja **tidak** masuk `UpdateStatus` — grup siar `update` di-recompute tiap
  300 tick); sesi hidup **tak memblokir** apa pun di server. Premis "restart memutus sesi tmux"
  **tidak akurat**: `pty.ts` memakai `tmux new-session -d`, tmux daemon terpisah — yang putus hanya
  jembatan `tmux attach` + WebSocket, dan klien sudah reconnect ber-backoff (ADR-0016). **Install
  gagal tak fatal** (respawn versi lama + cetak alasan), **migrasi gagal fatal**, jatah
  `MAX_UPDATE_RESTARTS = 5` dengan alasan dicetak saat habis. **Dua gotcha wajib:** `prisma generate`
  dijalankan **tanpa cek dulu** karena `@prisma/client` sudah ter-cache di proses supervisor sejak
  boot (`ensurePrismaClient` akan menjawab "siap" memakai modul LAMA — kelas jebakan `existsSync` di
  ADR-0087); dan `capabilityForRoute` dulu memetakan prefix status (`update`/`limits`/`events`/`fs`/
  `health`) ke `GLOBAL_READ` **tanpa melihat method**, jadi menambah endpoint tulis di bawahnya
  berarti setiap agent token bisa me-restart instance — kini `GLOBAL_READ` hanya untuk method baca.
- Realtime: **WebSocket hanya untuk terminal PTY**; sisanya **HTTP polling** (projects, backlog, notifications, limits, vps). Jaga UI responsif — log sesi streaming, jangan blok main thread.
- **State tampilan tiap halaman persisten di storage, berkunci per layar** (SPEC-740/**ADR-0115**;
  ADR-0107 & ADR-0071 **ditegakkan**, tak ada yang dicabut): filter & pencarian, paginasi, posisi
  scroll, item terpilih & panel terbuka bertahan lintas navigasi **dan** refresh/buka-ulang browser.
  Sebabnya struktural — dashboard menavigasi lewat state `section` di App, bukan router URL, jadi tiap
  layar di-unmount dan seluruh `useState`-nya hilang; refresh lebih buruk lagi karena `section` sendiri
  lahir `"overview"`. Mekanismenya **satu** modul `src/src/ui-state` (`store.ts` bebas React →
  bisa diuji langsung, `hooks.ts`, `ResetViewButton.tsx`), bukan tambalan per layar: layar baru
  memakai **`usePersistedState(screen, field, initial, accept?)`** alih-alih `useState` dan otomatis
  ikut. Kunci **`hn.ui.v1.<screen>[@<scope>].<field>`** — **versi hidup DI DALAM kunci** (menaikkannya
  membuat state lama tak terlihat tanpa satu baris migrasi; `pruneUiState()` menyapu sisanya saat App
  mount), `@<scope>` untuk state per-project, nilai rusak/salah bentuk **jatuh ke default, tak pernah
  melempar**. Cakupannya seluruh `HN_NAV` + `app.section`/`projectId`/`projectFilter`; Overview memang
  tak punya state tampilan. Reset lewat **pub/sub** (menghapus kunci saja tak mengembalikan komponen
  yang sedang ter-mount), dan `ResetViewButton` sekaligus merender lencana **"N filter aktif"** supaya
  daftar yang tampak kosong tak terbaca sebagai data kosong. **Tujuh gotcha:** nilai disimpan
  **beserta kuncinya** dan disinkronkan **saat render** — kalau terpisah, ganti project menimpa state
  project lain; pemulihan scroll wajib **membisukan penulisnya** + loop rAF berbatas (percobaan
  pertama pada konten yang masih pendek menulis balik nilai TERPOTONG); `section` digerbangi
  **`NAV_KEYS`** (section transien `project`/`review` = mendarat di layar kosong, key mati = App
  merender kosong berikut sidebar-nya — gotcha SPEC-519); **hanya `page` yang dipulihkan, tak pernah
  `limit`** (PLAFON, ADR-0107); `src/test/setup.ts` wajib `localStorage.clear()` tiap test (satu jsdom
  per berkas → state bocor antar-test dan terbaca seperti regresi komponen); `ResetViewButton` &
  `ds/shell.tsx` mengimpor lewat berkas, **bukan barrel** (`ds → shell → ui-state → ds` = lingkaran
  impor yang mati saat init); dan state milik App yang dipakai sebuah layar (`projectFilter`) di luar
  jangkauan reset berskop layar → lewat prop `onReset`. Filter/scroll/fullscreen tetap murni state
  klien; pengecualian mapping kerja Terminal ditetapkan ADR-0118. Flag Pet tetap pada key lamanya.
- **Mapping workspace Terminal adalah state server per akun admin** (SPEC-786/**ADR-0118**,
  mengamandemen sebagian ADR-0115; ADR-0016 ditegakkan): `TerminalWorkspaceV1` berisi grup berurutan
  + grid row-major + `sessionId`, disimpan LOCAL-only pada `User.terminalWorkspace` bersama
  `terminalWorkspaceRevision`/`terminalWorkspaceUpdatedAt`. `GET/PUT /api/terminal/workspace`
  COOKIE_ONLY; PUT wajib `{baseRevision,workspace}`, stale → `409 revision-conflict + current`.
  Klien server-first: legacy `hanoman.terminal.workspace` hanya seed bila GET null; browser kosong
  tak PUT; cache `hanoman.terminal.workspace.v2.<userId>` hanya recovery read-only. Semua request
  diserialkan, konflik di-reapply tepat sekali lalu refetch/fail visible. Rekonsiliasi cell mati baru
  setelah workspace server + daftar tmux sukses; rejection bukan `[]`. Responsive hanya proyeksi:
  active group/cell, fullscreen, modal, viewport tetap lokal dan resize tak pernah menulis mapping.
- Terminal server: **node-pty + tmux** (socket `-L hanoman`, `remain-on-exit on`); terminal web: **xterm.js** merender TUI Claude Code apa adanya. tmux menahan sesi hidup lintas restart API (ADR-0016). xterm mengirim satu frame WS per ketikan, jadi route terminal memakai quota 6.000 frame/menit (bukan default 120); `TerminalPane` menahan input selama `CONNECTING` dan swipe vertikal satu jari menggulir scrollback lewat `Terminal.scrollLines()` tanpa menggerakkan layout (SPEC-771). **Arah keluarnya di-coalesce dan dikompresi** (SPEC-812, tanpa ADR — ADR-0014/0016 ditegakkan): node-pty membaca dengan buffer tetap **1024 byte**, jadi satu frame per chunk berarti **±128 frame/dtk ≈ 966 kbit/dtk per pane** saat sesi ramai keluaran — dikali jumlah pane di grid Terminal, tanpa kompresi (default `ws`), lewat tunnel ke ponsel; echo ketikan lahir di belakang antrean itu dan delay-nya tumbuh mengikuti kedalamannya. `pty.ts` karena itu menahan keluaran dalam jendela **`COALESCE_MS` = 16** (satu frame animasi; atau langsung saat menembus `COALESCE_MAX_BYTES` = 64 KiB) dan `app.ts` menyalakan **`perMessageDeflate`** (level 6, `memLevel` 7 — rasio identik dengan 8, memori separuh; `threshold` bawaan 1 KiB menjaga frame kecil tak membayar). Terukur di server hidup pada aliran yang sama: **1 464 KB → 24,1 KB di kawat (60,6×)**, **±128 → 16 frame/dtk**. **Tiga gotcha:** (1) `pending` masuk ke `scrollback` **hanya di dalam `flushOutput`** — kalau tidak, replay scrollback ke klien yang baru attach menduplikasi byte yang masih menunggu siaran; (2) `flushOutput` wajib dipanggil di `drop()` **dan** sebelum frame `exit` — byte terakhir sebuah sesi lahir tepat sebelum kliennya dilepas; (3) `trimScrollback` memotong hanya saat melewati `MAX_SCROLLBACK + SCROLLBACK_SLACK` (memotong tiap chunk meratakan cons-string = **178 µs/chunk = 210 ms CPU per 10 dtk per pane**). Kontrol negatif yang menutup hipotesis lain: pada CPU throttle 6× antrean `WriteBuffer` xterm **0 ms** — klien bukan penyebabnya, jalur jaringan yang membedakan mobile dari desktop.
- **Tidak ada** message queue, Redis, worker terpisah, scheduler cron, maupun webhook GitHub — semua dicabut saat pindah ke sesi interaktif (ADR-0024). Kerja latar semuanya `setInterval` in-process yang di-`start` dari `server.ts` (`app.ts` bebas-timer): monitor VPS (health 5 mnt, audit 24 jam), engine scheduler (ADR-0072) — yang sejak **SPEC-646/ADR-0112** juga memiliki **cronjob per project** (jadwal HH:MM yang ditunda ADR-0072): jatuh tempo dimaterialisasi jadi baris `SchedulerCronRun` di tick yang SAMA, tanpa timer kedua, dan sesinya lahir ber-id deterministik `cron-<cronId>` di worktree isolasi — dan denyut hanoman-lead (ADR-0091).
- Server production **bind `127.0.0.1` tanpa pengecualian**; public/control exact origin dipisah dan control host wajib access proxy SSO/MFA/VPN (SPEC-761/ADR-0117).
- `runner/src/*` adalah **library**, bukan proses: `git.ts` (worktree), `prompt.ts` (prompt + `PIPELINES` fase), `reverse-standard.ts`, `settings.ts`. Tak ada lagi invokasi `claude` headless; flow CLI lama (execute/spec/plan/qa) sudah dicabut (ADR-0024).
- **Bersihkan branch tak terpakai** (SPEC-360/ADR-0077): daftar branch ter-merge = **nilai turunan git**
  (`GET /projects/:id/branches/unused`, `git branch --merged`, base `?base=→main→master→branch aktif`,
  ref origin dibanding `origin/<base>` — jangan hardcode `"main"`). Lima kunci proteksi per-branch
  (`current`/`base`/`worktree`/`spec-open`/`session`) **ditegakkan ulang** di `POST …/branches/delete`
  (yang menurunkan ulang daftarnya sendiri), jadi klien tak bisa menyelundupkan branch lewat body;
  scope (`local`/`remote`/`both`) menyempit per branch. Eksekusi tetap lewat `runGitOp` `delete-branch`
  (SPEC-206) — satu jalur, **tanpa `-D`/force**. Kunci `session` terpisah dari `worktree` karena sesi
  lahir `--detach` (ADR-0002) sehingga tak muncul di `git worktree list`. **Tiga gotcha git terukur:**
  `git branch --merged --format` memancarkan baris `(no branch)` di worktree detached; `origin/HEAD`
  dipendekkan git jadi bare `origin` (cermin `services/branches.ts`); dan `--end-of-options` **tak
  berlaku** untuk argumen `--merged` → base wajib di-resolve ke SHA lebih dulu. Ini pagar keselamatan
  data untuk satu endpoint bulk, **bukan** guardrail eksekusi — ADR-0037 tetap utuh.
- **Backlog bisa ditandai selesai MANUAL** (SPEC-804/**ADR-0120**; ADR-0008 & ADR-0047 & ADR-0099 &
  ADR-0105 ditegakkan, **ADR-0103 diamandemen**): `POST /specs/:id/done` `{reason?, confirm?}`
  memajukan satu item ke `done` tanpa sesi — untuk pekerjaan yang beres DI LUAR sesi (dikerjakan
  langsung, sudah ter-merge, atau sudah tercakup item lain), yang sebelumnya menggantung selamanya
  dan terus diantrekan checker `UNSTARTED_SPEC_WHERE` (SPEC-431). **Operasi khusus**, bukan field
  `PATCH /specs/:id`: `stage` di sana **backward-only by construction** (SPEC-167) dan
  melonggarkannya meruntuhkan premis "kemajuan hanya berasal dari fase sesi" yang menopang ketiga
  guard CAS persist stage; bentuknya preseden ADR-0064/0109. Jejaknya **satu** kolom
  `Spec.manualDone Json?` = `{at, by, reason?}` — bukan tiga skalar yang bisa drift — dan `doneAt`
  (ADR-0105) **tak berubah maknanya** (tetap "selesai pertama", tetap ditulis hanya di dalam
  `recordCompletion`). Eksekusinya satu titik cekik `completeSpecManually()` (CAS `stage != done` →
  `recordCompletion` → `recordSessionResult` → `notifySynced`), jadi efek penyelesaian tak pernah
  disalin ke call site (kelas SPEC-431/448/475). **Lima gotcha:** (1) `manualDone` wajib di
  `FIELDS.spec` **dan** `JSON_FIELDS`, **bukan** `DATE_FIELDS` (`at` di dalam JSON) — kolom terlewat
  mendarat sebagai null palsu tanpa satu pun error; (2) kandidat sweep auto-merge = notifikasi
  `done:` yang kini juga ditulis jalur manual, jadi `settleOne` **melewati** item ber-`manualDone` —
  tanpa itu item tanpa sesi melahirkan notifikasi "belum ter-push" yang salah, dan item ber-branch
  sesi lama yang **ditinggalkan** di-merge setengah jadi; (3) durabilitas terhadap overlay stage-live
  adalah konsekuensi guard forward-only `liveSpecs`, **dikunci test**, bukan diasumsikan; (4) gerbang
  "sesi hidup" membaca `specId` pane lewat `listSessions()`, bukan `getSession(sessionIdForSpec(id))`,
  dan pane MATI bukan sesi hidup; (5) `manualDone` **ditimpa** tiap penandaan dan revert stage sengaja
  **tidak** mengosongkannya (cermin `doneAt`; riwayat transisinya di `SessionResult`). Konfirmasi dua
  langkah (`409 confirm-required` + `session`) cermin ADR-0088, dan sesinya **tidak** dibunuh. Tool
  MCP sengaja **tak** ditambahkan — ADR-0099 meniadakan tool yang memindahkan stage.
- **Stempel waktu backlog** (SPEC-408/ADR-0090): `Spec` punya `createdAt` (NOT NULL, `@default(now())`,
  **tak pernah ditulis route**) dan `startedAt` (nullable). `startedAt` ditulis di **titik cekik yang
  sama dengan `baseSha`** (`session-launch.ts`, cabang `if (!resume)`) → maknanya **mulai pertama**,
  bukan sentuhan terakhir; jalur melanjutkan (ADR-0084) sengaja tak menimpanya. `updatedAt` **bukan**
  proksi keduanya — mesin sync mem-bump `version` (`publishLocal`/`backfillFeed`) dan overlay
  stage-live menulis kemajuan tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia. Arah
  keputusannya **berlawanan dengan ADR-0018/0019** dan itu disengaja: aturannya bukan "selalu
  turunkan" melainkan *bisakah dihitung ulang dari sumber lain* — coverage bisa, diff bisa, waktu
  lahir sebuah baris tidak. `GET /specs` menerima `dateField=created|started` + `from`/`to`
  (`YYYY-MM-DD`, **inklusif**, boleh sendirian), disaring di layer response bersama filter lain
  (ADR-0038 utuh) lewat helper murni `services/date-range.ts`; `dateField=started` **membuang** item
  ber-`startedAt` null. **Tiga gotcha:** SQLite melarang `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP` →
  migration wajib redefinisi tabel (dan klausa `SELECT`-nya satu-satunya tempat backfill dari
  `updatedAt` bisa terjadi sekali jalan); `new Date("2026-07-31")` = tengah malam **UTC** sehingga
  batas `to` polos membuang hampir seluruh hari itu di WIB → parsing komponen-per-komponen di zona
  lokal + uji-balik terhadap input (`2026-02-30` → null, bukan 2 Maret); dan kedua kolom **wajib**
  ada di `FIELDS.spec` + `DATE_FIELDS.spec` — `upsert` yang tak menyebut kolom ber-default **tetap
  berhasil**, jadi tanpa itu spec asal-hub mendapat `createdAt` lokal palsu di tiap client tanpa
  satu pun error.
- **Webhook keluar — tap Prisma, bukan emit di call site** (SPEC-481/**ADR-0100**; ADR-0024, ADR-0037,
  ADR-0039 utuh): hanoman mem-POST amplop bertanda tangan HMAC ke endpoint yang didaftarkan operator
  setiap kali sebuah baris DB berubah. Peristiwanya diambil di **satu** client extension Prisma
  (`services/webhooks/tap.ts`) yang dipasang di `db.ts` — satu-satunya tempat klien lahir — bukan
  di call site, karena "pancarkan peristiwa" adalah **efek samping murni** dan hanoman sudah tiga
  kali membayar kelas bug "satu definisi, N call site" pada bentuk itu (SPEC-431/448/**475**).
  Katalog **`WEBHOOK_ENTITIES`** (`@hanoman/shared`) menyetir tap **dan** halaman dokumentasi
  in-app, jadi jenis peristiwa tak bisa basi; **allowlist field** di dalamnya sekaligus pagar data
  sensitif dan kontrak payload, dijaga test DMMF (cermin `PG_ORDER`). Antreannya `WebhookDelivery`
  — satu tabel merangkap antrean **dan** riwayat, dikuras `setInterval` dari `server.ts` (pola
  ADR-0072/0096) — dan `payload` disimpan **per baris** supaya retry mengirim byte identik (id
  peristiwa stabil ⇒ penerima bisa idempoten). **Enam gotcha wajib:** (1) gerbang `webhooksActive()`
  dibaca pada SETIAP tulisan Prisma — jaga tetap satu boolean, dan dengan nol endpoint (default)
  tap tak melakukan apa pun; (2) **diff kosong tak memancarkan** — tanpa itu overlay stage-live
  `liveSpecs` (menulis tiap `GET /specs`) dan bump `version` mesin sync jadi banjir peristiwa hampa;
  (3) peristiwa turunan **menggantikan**, `spec.stage_changed` alih-alih `spec.updated`; (4) cascade
  delete tingkat-DB **tak terlihat** tap (dilaporkan sebagai `data.cascade`), dan `$executeRaw`/
  `createMany` atas model terlacak **dilarang** — dijaga `webhook-no-raw-writes.test.ts` karena
  pelanggarannya gagal SENYAP; (5) baris `sending` yang tertinggal crash **DIULANG** saat boot,
  sengaja berlawanan dengan `TelegramOutbox` yang memilih `uncertain` (di sana kembarannya pesan
  ganda ke manusia; di sini kontraknya at-least-once ber-id stabil); (6) klien Prisma yang diekspor
  kini **ber-extension** sehingga tak assignable ke `PrismaClient`/`Prisma.TransactionClient` —
  pakai alias **`Db`/`DbTx`** dari `db.ts`, jangan mengetik ulang tipe Prisma polos. Pengelolaannya
  **COOKIE_ONLY** (memegang secret + menentukan ke mana data mengalir), secret terenkripsi lewat
  `secret-box.ts` dan ditampilkan sekali, SSRF diperiksa saat simpan (bentuk + IP literal, **tanpa
  DNS**) dan lagi di **tiap percobaan kirim** (resolve DNS, fail-closed).
- **Auto-merge saat sesi selesai — kebijakan per project/spec, dieksekusi SWEEP tanpa call site**
  (SPEC-486/**ADR-0103**, memperluas ADR-0031; ADR-0002/0030/0033/0072/0100 utuh): `Project.autoMerge`
  (default) + `Spec.autoMerge` (override; `null` = warisi, `{mode:"off"}` = matikan untuk item ini)
  bertipe **`Json?`** — `{mode:"off"|"default-branch"|"branch", dest:"local"|"origin", branch,
  deleteBranch}`, resolver murni `resolveAutoMerge()` di `@hanoman/shared` dipakai server **dan** UI.
  Target memakai kosakata `local:<b>`/`origin:<b>` yang **sama** dengan `POST /specs/:id/integrate`,
  dan mesin merge-nya `integrate()` ADR-0031 apa adanya. **LOCAL-only** (tak di `FIELDS` sync, cermin
  `repoDir`), **masuk** `WEBHOOK_ENTITIES`. Pemicunya **`services/auto-merge.ts` → `sweepAutoMerge()`**,
  `setInterval` 60 dtk dari `server.ts` saja: `stage="done"` dipersist di **TIGA** jalur dan menyalin
  efek samping ke ketiganya adalah kelas bug SPEC-431/448/475/481 — tapi yang lebih menentukan, **tak
  satu pun aman sebagai pemicu**, karena prompt sesi menulis baris fase terakhir SEBELUM `git push`
  sehingga `liveSpecs` bisa mencapai `done` beberapa detik sebelum `hanoman/<spec>` ada di origin.
  Kandidat = notifikasi **`done:<specId>`** (stempel selesai yang sudah ada di ketiga jalur → nol tabel
  baru) dalam **window 24 jam**, tanpa penanda `automerge:<specId>`; kesiapan = `headSha` sudah jadi
  **leluhur** tip branch (`merge-base --is-ancestor`), belum siap dalam **grace 15 mnt** → diam & ulangi,
  lewat grace → menyerah **dengan suara**. **Tujuh gotcha wajib:** (1) reopen-lalu-selesai-lagi TAK
  di-auto-merge ulang (`recordCompletion` idempoten — cermin batasan ADR-0033); (2) window 24 jam
  satu-satunya pagar yang mencegah "menyalakan setting = menggabungkan seluruh sejarah project";
  (3) kesiapan wajib `headSha ⊆ tip`, bukan sekadar "branch ada"; (4) `integrate` **meninggalkan**
  worktree konflik by design → pemanggil yang tak melahirkan sesi WAJIB `discardMergeWorktree()`;
  (5) **`Prisma.DbNull`** bukan `null` polos untuk mengosongkan kolom `Json?`; (6) sweep dipasang dari
  `server.ts` SAJA (`app.ts` bebas-timer); (7) default branch diresolve **saat eksekusi** dan **tak
  pernah** di-hardcode `"main"` (`origin/HEAD` → main → master → **null**). Operasi **terkunci `merge`**
  (rebase = force-push, dilarang) dan branch kerja tak pernah dihapus sebelum hasil `clean`
  (`deleteBranch` opt-in, default mati). Konflik **tidak** melahirkan sesi agen — notifikasi + branch
  utuh, lalu tombol Rebase/Merge ADR-0031 tetap memberi jalur konflik yang lengkap.
- **Changelog per project — `Spec.doneAt` berkolom, hasil tersimpan LOCAL-only, narasi agen
  ber-fallback** (SPEC-516/**ADR-0105**, melanjutkan arah ADR-0090; ADR-0018/0019, 0033, 0078, 0091,
  0099, 0100 utuh): tiga mode (rentang tanggal backlog · rentang SHA · versi/tag) di bawah
  `/projects/:id/changelog`, semuanya menghasilkan teks pendek **berorientasi pemakai**.
  **`Spec.doneAt`** ditambahkan karena `updatedAt` bergerak tanpa ada manusia (ADR-0090) — dan
  penulisnya **SATU**: bukan di ketiga jalur yang mempersist `stage="done"` melainkan **di dalam
  `recordCompletion()`**, satu-satunya fungsi yang sudah dipanggil ketiganya (menyalin efek samping
  ke call site = kelas bug SPEC-431/448/475, dan efek samping tak punya tipe yang memaksanya
  konsisten). **Tulis-sekali** ber-guard `doneAt: null` → maknanya *selesai pertama*, cermin
  `startedAt`; revert stage tak mengosongkannya. Backfill sekali-jalan dari notifikasi
  `done:<specId>` (sumber yang sama dengan sweep ADR-0103). Narasi lewat **`think()` yang DIIMPOR**
  dari `lead/brain.ts` — titik spawn agen ketiga akan mengulang SPEC-448 — dengan **anggaran waktu
  disebut di dalam prompt** (SPEC-432: 306 → 101 dtk); agen gagal/kosong **bukan galat**, baris
  tetap lahir ber-`generator:"fallback"` + `warning`. Scrub dijalankan **dua kali** dan yang
  menentukan sisi **INPUT** (SHA bahkan tak pernah dikumpulkan dari `git log`). Model `Changelog`
  **LOCAL-only** (tanpa kolom `version`), capability **domain `docs`** bukan `projects`, dan keadaan
  sah yang bukan galat dijawab **422 + pesan** — `…/changelog/sources` bahkan **200 dengan `reason`**.
  **Lima gotcha wajib:** (1) `PG_ORDER` wajib memuat model baru **sesudah `Project`** —
  `cli/test/migrate-pg.test.ts` menuntutnya sama persis dengan DMMF, satu-satunya gerbangnya;
  (2) `doneAt` wajib di `FIELDS.spec` **dan** `DATE_FIELDS.spec` (`upsert` yang tak menyebut sebuah
  kolom tetap berhasil — kelas gagal-senyap ADR-0090/0093/0094); (3) batas hari wajib **LOKAL**
  (`new Date("2026-07-31")` = tengah malam UTC); (4) regex scrub camelCase wajib menuntut ≥2 huruf
  kecil di **kedua** sisi kapital (kalau tidak `macOS`/`iOS` ikut terbuang) dan regex hash wajib
  menuntut satu digit **dan** satu huruf a–f (kalau tidak `1000000` terbaca sebagai sha);
  (5) "versi sebelumnya" diturunkan `git describe --abbrev=0 <tag>^` (**riwayat**), bukan urutan
  tanggal — tanggal tag anotasi beresolusi DETIK dan git jatuh ke urutan NAMA saat seri.
  **Runtime/model/effort penarasinya punya setelan sendiri sejak SPEC-518** (tanpa ADR — ADR-0105
  ditegakkan, hanya *dari mana triple-nya datang* yang berubah): blok **`Setting.changelog`**
  bertipe **`zAgentEngine` yang SAMA** dengan `lead.engine`/`telegram.engine` (SPEC-492 — bukan
  bentuk kelima), **flat** seperti `conflict` karena bloknya tak punya knob tetangga, dibaca
  `changelogAgentDefaults()` di `services/changelog/config.ts`. **Opt-in**: mati = mendelegasikan
  penuh ke `sessionAgentDefaults()`, persis perilaku pra-SPEC-518. Tanpa migration (kolom `Json` +
  `.default()`), tanpa endpoint baru; kartu "Agen changelog" di Settings → Model sesi menulis lewat
  **`PUT /settings`** — bukan endpoint khusus seperti kartu lead maupun baca-ulang seperti kartu
  Telegram — karena blok itu **tak punya penulis kedua**. Effort codex dikoersi **di resolver**,
  bukan hanya di picker (`PUT` ber-`AgentToken` tak lewat UI). `CHANGELOG_TIMEOUT_MS` sengaja
  **tetap konstanta**: ia disebut di dalam prompt, dan anggaran yang bisa digeser diam-diam
  berbohong kepada agennya (SPEC-432).
  **Letak & jangkauan (SPEC-519, tanpa ADR):** changelog punya **entri sidebar sendiri**
  (`changelog`, ikon `megaphone`) dan halaman yang bisa dibuka langsung lewat
  **`#changelog=<projectId>[&cl=<changelogId>]`** (pola hash ADR-0071 yang sama dengan `#spec=`,
  di-parse sekali saat mount lalu dibersihkan; kedua parser saling eksklusif). Daftar rilisnya
  bergulir dengan **tinggi berbatas** (rantai flex yang menembus `Card` putus tanpa prop `fill` —
  audit SPEC-393) dan dicari lewat **satu parameter aditif `?q=`** pada `GET /projects/:id/changelog`
  yang sudah ada — predikat murni `changelogMatches()` di `@hanoman/shared`, disaring **sebelum**
  `paginate` supaya `total` menghitung hasil cari (ADR-0038); menyaring di klien hanya menjangkau
  halaman yang kebetulan termuat. `ChangelogPanel` jadi **generator murni** (hasil diserahkan lewat
  `onGenerated`, satu jalur render untuk rilis baru maupun lama) dan detail project menunjuk ke
  halaman itu lewat **pintu**, bukan menyalin generatornya. **Gotcha keenam:** setiap key `HN_NAV`
  wajib punya cabang `section === …` di `App.tsx` — tanpa itu App merender kosong dan sidebar ikut
  hilang (`runs`/`triggers`, SPEC-162); kini dijaga test kontrak `src/test/changelog-nav.test.tsx`
  yang membaca sumber `App.tsx` **dari cwd**, sebab `import.meta.url` di bawah transform Vite bukan
  URL ber-skema `file:`.
- **Panduan AI agent punya URL** (SPEC-489, tanpa ADR — ADR-0065 & ADR-0099 **ditegakkan**):
  `docs/agent-integration.md` adalah **naskah tunggal**, disajikan mentah di
  **`GET /api/agent-integration.md`** (`text/markdown`, masuk daftar `PUBLIC` `app.ts` bersama
  `/health` — bukan kelalaian: byte-nya sudah publik di GitHub, dan menggerbanginya berarti agen
  yang capability-nya kurang menerima **403 pada dokumen yang menjelaskan arti 403**, sekaligus
  mematahkan janji "cukup diberi tautan + token" karena tautannya harus terbaca SEBELUM token
  disetel). **Tiga jebakan mengikat:** (1) resolusinya duduk di **`app.ts`**, bukan di route-nya —
  `import.meta.url` sebuah route sedalam `server/src/routes` saat tsx tapi `server/dist` sesudah
  dibundel esbuild, dua kedalaman berbeda, sementara `app.ts` invarian (persis alasan `pickWebDir`
  duduk di sana); `pickGuideFile()` karena itu cukup punya dua kandidat (`../docs/…` paket npm,
  `../../docs/…` checkout yang melayani `server/src` **dan** `server/dist`), dengan override
  `HANOMAN_AGENT_DOC` yang **melempar** bila di-set tapi tak ada (cermin `HANOMAN_WEB_DIR`);
  (2) naskahnya **wajib** masuk `copyPlan`/`files`/`REQUIRED_ARTIFACTS` (`cli/src/release/pack.ts`)
  — tanpa itu setiap instalasi npm menjawab 404 sementara checkout dev terlihat sehat sempurna;
  (3) kartu Settings me-render **respons endpoint itu**, bukan salinan — kendalanya satu sumber
  tulisan, jadi versi dashboard/GitHub/runtime tak boleh bisa berbeda. Anti-basi tak bisa memakai
  render-dari-katalog (ADR-0100) karena sumbernya markdown; gantinya `agent-doc-contract.test.ts`
  mengikat naskah ke `CAPABILITY_DOMAINS`, daftar `COOKIE_ONLY`, `zSpecSource`, dan larangan token
  nyata — katalog bertambah → test merah → naskah ikut diperbarui.
- **Status PRD adalah nilai turunan, bukan kolom** (SPEC-520, tanpa ADR — ADR-0018/0019 &
  ADR-0041 & ADR-0069 **ditegakkan**): `PrdDoc.status` = `draft` (nol backlog turunan) ·
  `dieskalasi` (ada, belum semua `done`) · `terwujud` (semua `done`), + `specCount`/`doneCount`,
  dihitung `prdStatusOf()` (`shared/src/prd-status.ts`, murni) atas baris `Spec` **project yang
  sama**. Dua kunci jejak yang sudah ada: path PRD **utuh** di `payload.context`/`payload.goal`
  (25/25 baris berjejak di instalasi hidup) dan `branchFrom === "prd/<slug>"` (nol tambahan hari
  ini, dipasang untuk backlog manual dari branch PRD). **Tiga gotcha:** (1) cocokkan **path utuh,
  bukan kata "PRD"** — SPEC-244/273/407 menyebut kata itu tanpa path, dan akhiran `.md` yang
  membuat slug berawalan sama tak saling cocok; (2) `listAllPrds` menarik trace **semua** project
  dalam SATU query — memanggil `listPrds` polos per project mengubahnya jadi N+1; (3) baris prosa
  `> Status: Draft …` di dalam dokumen PRD bukan sumbernya (ditulis agen sekali, tak punya
  penulis kedua) dan lencana `live` karena itu berganti kata jadi **`sesi hidup`**.
- **Type backlog item bisa dipindah — operasi khusus, gerbang mengunci FLOW bukan label**
  (SPEC-546/**ADR-0109**; ADR-0064 preseden, ADR-0090 & ADR-0100 ditegakkan):
  `POST /specs/:id/source` `{source, payload?}` mengubah `Spec.source` **in-place** — id SPEC-nnn,
  `createdAt`, `dependsOn`, dan dokumen sesi tak disentuh, tak ada baris baru. Bukan field
  `PATCH /specs/:id`: gerbangnya berbeda dari `editingContent` (SPEC-186), dan ADR-0064 sudah
  menetapkan bentuk "operasi khusus" untuk perubahan sejenis (rename `Project.id`). Daftar source
  yang sah persis `zSpecSource` — **`cross-audit` sudah tak ada** (dicabut SPEC-384/ADR-0092).
  **Gerbangnya**: item belum dimulai bebas ke source mana pun; item yang **sudah dimulai** hanya ke
  source ber-`flowForSource` sama (hari ini `brief ↔ help`) dan **tanpa** payload — karena yang
  dilindungi SPEC-186 adalah pekerjaan yang sedang berjalan, dan berkas fase sesi berisi nama fase
  `PIPELINES[flow lama]` yang tak akan pernah memuaskan `phasesComplete` flow baru (kelas SPEC-433).
  Ikatan source↔bentuk payload kini SATU predikat di `shared/src/spec-source.ts` yang dipakai
  `zCreateSpec` **dan** `zChangeSpecSource`; peta konversinya `convertPayload(to, payload)` — MURNI,
  **field-ke-field, tak pernah menyambung prosa**, bentuk asal dibaca dari **payload**-nya bukan dari
  `source` lama — dipakai dialog UI untuk prefill **dan** server sebagai default saat `payload` tak
  dikirim. `Spec.sourceHistory Json?` menyimpan jejak `[{at, from, to, by, payload}]` dengan
  **payload bentuk LAMA utuh**, jadi field tanpa padanan (`dropped`) tak pernah benar-benar hilang.
  **Tujuh gotcha:** (1) `sourceHistory` wajib di `FIELDS.spec` — kolom yang terlewat mendarat sebagai
  null palsu tanpa satu pun error; (2) **tak boleh** masuk `WEBHOOK_ENTITIES.fields` (ia membawa
  payload, yang memang dikecualikan) — yang terpancar `spec.source_changed`; (3) predikat bentuk
  wajib tetap satu — menyalinnya mengembalikan kelas SPEC-431/448/475/481; (4) tak ada salinan
  `source` yang perlu ikut diperbarui — `flowForSource` dibaca saat sesi lahir, dan
  `SchedulerQueueItem.source` itu asal *checker* (`backlog`|`triase`), bukan source Spec;
  (5) `priority` **tidak** round-trip lewat qa (peta severity hanya dua nilai: `rendah → minor →
  sedang`) — dinyatakan & diuji, yang round-trip adalah prosanya; (6) `sourceHistory` masuk `zSpec`
  ber-`.default([])` sehingga tiap literal `Spec` di test wajib menyebutnya, dan UI menulis
  `?? []` (cermin `blockedBy`); (7) env test berperan **hub**, jadi bukti "konversi merambat sync"
  ada di **`SyncLog`**, bukan `syncOutbox`. `author` (`QA ·`/`Audit ·`/`Goal ·`) **sengaja tak
  disentuh**: ia fakta historis, cermin `createdAt`. UI: aksi "Ubah type" di detail backlog + blok
  "Jejak konversi type"; katalog source (lencana, opsi, field per bentuk) pindah ke satu berkas
  `src/src/screens/source-meta.ts` — yang sekalian menambal entri **`help`** yang selama ini hilang
  (item Help Center memakai lencana "feature brief" lewat fallback) berikut tab filternya.
  **SPEC-826/ADR-0122** menutup empat arah lossy di dalamnya: `constraints` kini dimiliki **ketiga**
  bentuk payload, jadi `convertPayload` tak lagi membuangnya ke `dropped` (`brief→qa` kini
  `dropped: []`, `goal→qa` tinggal `["done"]`) maupun melahirkannya kosong di arah balik. Kuncinya
  `zQaPayload.constraints` **`z.string().default("")`, bukan `z.string()` polos** — payload qa yang
  sudah tersimpan tak punya field itu dan `zQaPayload` dipakai `zSpec`/`zCreateSpec`/`zPatchSpec`/
  `zChangeSpecSource`, jadi polos berarti setiap baris lama gagal validasi begitu ia dibaca,
  diedit, atau dikonversi. Yang **tetap** pengecualian dan itu disengaja: `priority` tak ada di
  payload qa (turunan `severity`, menambahkannya menabrak `deriveSpecFields`), `constraints` di
  luar `SHAPE_REQUIRED.qa` (kosong = normal), dan pembeda `shapeOfPayload` tetap `severity`/`goal`.
  Label diseragamkan **"Batasan"** untuk ketiga bentuk. Dua gotcha: `dropped` yang menyusut
  membuat blok `source-dropped` dialog **tak dirender** untuk `brief→qa` (test pelaporan `dropped`
  pindah ke `brief→goal`), dan **dua pabrik payload qa di server** (`ticket-accept.ts`,
  `github-accept.ts`) menulis lewat `prisma.spec.create` **tanpa zod** sehingga default tak
  menyentuhnya — kelas ADR-0090/0093/0105.
- **MCP server = `hanoman mcp`, KLIEN REST, bukan permukaan kedua** (SPEC-482/ADR-0099, memperluas
  ADR-0065): subcommand stdio di CLI yang memanggil `/api` dengan agent token yang sama, sehingga
  gate `onRequest` tetap satu-satunya otorisasi dan route cookie-only tak terjangkau **secara
  struktural**. **Tanpa endpoint baru, tanpa skema, tanpa migration.** Katalog **17 tool** hidup di
  `shared/src/mcp-{schema,shape,catalog}.ts` sebagai data murni yang dipakai runtime CLI **dan**
  panel Settings — dan diikat ke gate oleh `server/test/mcp-capability.test.ts`
  (`capabilityForRoute(sampleMethod, samplePath) === capability`, plus larangan cookie-only/`/vps`/
  `/terminal` non-GET). **Tool yang mengeksekusi sengaja tak ada:** `POST /terminal/sessions`,
  `/vps*`, `integrate`, `DELETE /specs/:id`, `PATCH stage`. Mode `--read-only` **menghilangkan**
  keempat tool tulis dari `tools/list`, bukan menolaknya saat dipanggil. `MCP_TOOL_SCHEMA_VERSION`
  aditif-dalam-versi, dijaga test snapshot. **Tiga gotcha wajib:** (1) **stdout milik JSON-RPC** —
  perintah `mcp` tak pernah memanggil `ctx.stdout`, satu byte diagnostik di sana merusak protokol
  dan klien melaporkannya sebagai "server rusak" tanpa sebab; (2) `allOf`/`if`/`then` di JSON Schema
  **ditegakkan validator SDK**, jadi `source:"qa"` + payload brief ditolak **di klien** dan 400
  `"bentuk payload tak cocok dengan source"` tak pernah lahir — itulah cara "agen dibimbing ke
  panggilan yang sah" benar-benar bekerja; (3) **401 telanjang tak bisa dibedakan** antara host
  salah / master switch mati / token dicabut → probe `GET /api/health` (PUBLIC, tanpa auth) sekali
  lalu di-cache adalah satu-satunya pemisah "host salah" dari "token salah". Selain itu: `GET
  /specs/:id` **tidak ada** (backlog_get mencocokkan id persis atas `q` yang substring), `startable`
  diekspos **boolean** (`false` menghilangkan parameternya — string selain `"true"` diabaikan senyap
  oleh server), token **tak pernah dari flag** (ARGV terbaca `ps`, SPEC-402), redaksi di **satu**
  titik keluar (SPEC-472), dan pemotongan balasan **wajib tetap JSON sah**.
- **Penghapusan menyeberang sebagai TOMBSTONE, dua arah** (SPEC-799/**ADR-0119**; ADR-0045 diperluas,
  ADR-0068 & ADR-0082 **sebagian dicabut** — batasan "feed append-only tanpa tombstone"; kontrak apply
  ADR-0082 & ADR-0043/0046/0067/0064/0100 **ditegakkan**): mesin sync dulu hanya mengenal UPSERT, jadi
  hapus tak pernah menyeberang dan sisi lain menghidupkannya kembali lewat **dua jalur berlawanan
  arah** — hapus di client (feed hub memutar ulang record itu lewat edit siapa pun, `backfillFeed`
  saat boot, atau tombol Tarik ulang) dan hapus di hub (`applyPush` menerima id yang absen sebagai
  INSERT BARU yang **selalu** diterima). Bentuknya **hard-delete + tabel `SyncTombstone`**
  (`entity, recordId, version, data, deletedAt, deviceId`), **bukan** soft-delete `deletedAt` per
  entitas: bentuk itu menyentuh SETIAP query baca delapan entitas SYNCED (satu penyaring terlewat =
  bug yang sedang diperbaiki, gagal SENYAP), menggugurkan `onDelete: Cascade`, menabrak
  `@@unique([projectId, number])` saat pembuatan ulang, dan membuat tap Prisma ADR-0100 membaca hapus
  sebagai `update`. Ide intinya: **tombstone ADALAH versi record itu sendiri, berkeadaan dihapus** —
  `applyPush` membaca "versi saat ini" dari baris **atau** tombstone, sehingga penolakan kebangkitan
  jatuh dari optimistic-concurrency yang sudah ada, tanpa cabang khusus. Peristiwanya mengalir lewat
  kolom **`SyncLog.op`** (`"upsert"|"delete"`, `@default`). Penghapusannya satu panggilan
  **`deleteSynced()`** (`services/sync-delete.ts`: baca versi+snapshot → hapus → tulis tombstone →
  terbitkan sadar-peran) yang dipakai **enam** route DELETE; retensi otomatis sengaja **tidak** ikut
  (ia memang sudah di luar permukaan `notifySynced`). **Delete menang TANPA SYARAT** supaya hasil
  hapus-vs-edit independen urutan tiba; edit pending yang tergilas melahirkan `Notification`
  `sync-delete:<entity>:<id>:<version>`. Anak yatim bagi induk bertombstone dibuang **sengaja** lewat
  peta `PARENTS` ber-gerbang DMMF. Jalan pulang data yang terlanjur bangkit: **hapus ulang sekali di
  sisi mana pun**, tanpa migrasi data. **Enam gotcha:** (1) `op` wajib **TOP-LEVEL**, tak pernah di
  dalam `data` — allowlist `validateSyncData` menolaknya di client lama → `feedHole` → kursornya
  tertahan SELAMANYA; (2) baris feed `op:"delete"` wajib membawa **snapshot yang sah** — objek kosong
  membuat hub lama 500 (create tanpa kolom required); (3) `SyncTombstone` wajib masuk **`PG_ORDER`**
  (`cli/test/migrate-pg.test.ts` satu-satunya gerbangnya); (4) `writeTombstone` wajib **monoton** —
  replay full-pull memutar feed dari awal; (5) konsumsi tombstone saat pembuatan ulang duduk di
  **`notifySynced`** (kelas bug SPEC-431/448/475/481) **dan** wajib mengangkat `version` baris ke
  versi tombstone, karena baris baru lahir di `version = 0`; (6) `op` tak dikenal **dilewati**, tak
  pernah melempar. Rename **bukan** hapus: pintu `renamedFrom` (ADR-0064) memang melewati
  optimistic-concurrency, jadi ia mendapat gerbang tombstone sendiri.
- Docs SoT & coverage dipindai **live dari path efektif** tiap request (ADR-0011/0018), bukan tabel DB.
- Verifikasi doc terkini via Context7 sebelum mengubah keputusan platform/framework.

## Aturan Sesi & Eksekusi

- Mesin eksekusi nyata = **`server/src/services/pty.ts`**: `createSession()` men-spawn agen (`<prompt>` + flag agen) di window tmux; node-pty `tmux attach` menjembatani ke WebSocket, poll 500 ms mengawasi exit + perubahan phase-file lalu broadcast frame. **tmux adalah satu-satunya sumber kebenaran pekerjaan berjalan — tidak ada baris `Run` di DB.**
- **Penutupan sesi ASINKRON: worktree dipindah ke `.trash`, penyapu latar yang menghapus**
  (SPEC-742/**ADR-0116**; ADR-0079 gerbang `ownsWorktree`, ADR-0030/0093 bukti `headSha`, ADR-0018/0019
  nilai turunan, pola sweep ADR-0072/0103 — semuanya **ditegakkan**, tak ada yang dicabut). Menutup
  satu sesi dulu membekukan **seluruh server**, bukan cuma request-nya: `DELETE /terminal/sessions/:id`
  memanggil `realGit.removeWorktree` sinkron, dan atas salinan worktree nyata (562 MB / 25 040 entri)
  `rmSync` terukur **1 370 ms dengan event loop terblokir 1 364 ms dan NOL tick** — vs `fs.promises.rm`
  **947 ms / lag 3 ms** dan `renameSync` **1 ms**. Karena itu "balas 202 lalu hapus di `setImmediate`"
  **tidak memperbaiki apa pun**; biayanya bahkan dibayar dua kali (`git worktree remove --force` sudah
  menghapus pohonnya, lalu `rmSync` lagi). Sekarang: di dalam request hanya `advanceStage()` →
  `recordHeadSha()` → `killSession()` → **`rename` ke `<repoDir>/.worktrees/.trash/<sesi>.<stempel>`**,
  lalu **`202 { cleanup }`**; `services/worktree-reaper.ts` (sapuan boot + `setInterval` 60 dtk dari
  `server.ts` + tendangan langsung) yang menghapus byte-nya. Yang membuatnya bebas kunci: **domain
  penyapu `.trash/**` lepas total dari setiap path hidup** — penutupan tumpang-tindih dan sesi baru
  yang lahir selagi penyapuan jalan aman **menurut konstruksi**, dan `.trash` sekaligus catatan
  durable-nya (nol tabel, nol kolom, nol migration). **Reclaim `addWorktree` memakai primitif yang
  sama** — ia dilewati tiap kali backlog `done` dibuka lagi (SPEC-172), jadi tanpa itu penutupan cepat
  sementara pembukaan tetap beku. Diamati lewat **`GET /terminal/cleanups`** (muncul = `closing`,
  hilang = `closed`) + frame siar `cleanups`; kegagalan → `Notification` `type:"cleanup"` ber-`key`
  per ENTRI (satu baris per sampah, bukan satu per tick) dan entrinya tetap tinggal untuk disapu ulang.
  **Delapan gotcha:** `rmSync` → `fs.promises.rm` bukan kosmetik; `advanceStage`/`recordHeadSha` **wajib
  tetap di dalam request sebelum `rename`** (keduanya membaca berkas fase/plan/HEAD dari DALAM
  worktree); `ownsWorktree` berdiri **sebelum** `trashWorktree` (rename sama merusaknya dengan rm,
  SPEC-362); `rename` gagal → jatuh ke `removeWorktree` sinkron, **jangan** ke penghapusan latar atas
  path aslinya (path itu bisa direbut peluncuran berikutnya); nama entri memuat id sesi — satu-satunya
  cara "milik sesi mana" bertahan melewati restart tanpa tabel; `git worktree prune` sekali per repo
  per sapuan; peta pembersihan di memori adalah **read model**, diisi ulang dari `.trash` tiap
  sapuan; dan pemindahan + pencatatan + tendangan penyapu adalah **SATU panggilan**
  (`releaseWorktree()`) sementara `session-worktree.ts` tetap MURNI — memisahkannya berarti tiap
  call site baru harus mengingat ketiganya. Tiga jalur `killSession` lain (`lead/apply.ts` `stopSession`/`integrate-main`,
  `telegram/session.ts`, `session-launch.ts`) **tak diubah**: tak satu pun menghapus worktree, jadi tak
  satu pun bisa balapan dengan penyapu. `integrate.ts` (`discardMergeWorktree`) sengaja tetap sinkron.
- **Metode workflow adalah data, bukan literal** (SPEC-734/**ADR-0113**; ADR-0029 **ditegakkan** — jangkauannya diperluas ke seluruh metode, aturannya tak berubah): satu konstanta **`METHODS`** di `shared/src/method-catalog.ts` mendeklarasikan per metode peta fase→skill, `planDir`/`specDir`, `extraClause`, `exitSkills`, dan `requires`. Menambah metode ketiga = **SATU entri** — sembilan titik yang dulu menulis `"superpowers"` literal kini bertanya ke registry. Katalog awal `superpowers` (default) & `matt` (mattpocock/skills). Resolusi mencerminkan `verifyScope` (ADR-0080): **`opts.method` → `Spec.payload.method` → `Setting.method` → `"superpowers"`**, distempel ke payload di peluncuran **PERTAMA** lalu **beku** (fakta historis, cermin `startedAt` ADR-0090). Tanpa migration, tanpa endpoint baru; picker di Start modal **dan** Settings (tab **Sesi**, bukan Model sesi) sama-sama memetakan `METHOD_IDS`. **Empat gotcha wajib:** (1) **gerbang plan memindai UNION `PLAN_DIRS`** dan `planComplete` wajib **`continue`, BUKAN `return true`** saat sebuah direktori tak ada — bentuk lama benar untuk satu direktori dan **fail-open** untuk banyak: direktori metode PERTAMA yang absen mengakhiri pemindaian sebelum metode kedua dilihat, lalu backlog lompat ke `done` dengan plan lama penuh `- [ ]`. Jangan pernah mengembalikannya ke satu direktori. **Prompt** tetap menyebut direktori metode sesi itu; yang union adalah gerbangnya; (2) **`runner/src/goal.ts` mudah terlewat** — ia bukan "prompt" jadi tak muncul saat orang mengaudit prompt, DAN gerbangnya menuntut hasil `grep` yang **KOSONG** sebagai bukti selesai, sehingga direktori yang salah membuatnya **LULUS**, bukan gagal; (3) **`exitSkills` wajib non-kosong + memuat `superpowers:verification-before-completion`**, ditegakkan test DI SUMBER (pola SPEC-490) dan digabungkan ke fase TERAKHIR lewat gerbang `writesCode` yang SAMA dengan `scopeClause`/`codeStyleClause` — mattpocock tak punya padanannya, dan tanpa itu flow `goal` kehilangan satu-satunya gerbangnya (fase `Goal` sengaja tanpa skill, ADR-0089); menambahkannya tanpa gerbang `writesCode` memecah byte-identitas prompt scaffold/prd; (4) **registry di `shared` DI-IMPOR runner, bukan dicerminkan** — deviasi sadar dari `enums.ts` (SPEC-407 sudah membayar konvensi cermin dengan EMPAT cermin `Flow`), karena itu `method-catalog.ts` **bebas zod**. **`PIPELINES` TIDAK BERUBAH**: nama fase adalah kunci peta `REACHED`. `zMethod` **lenient** (`z.string()`, bukan `z.enum`) dan nilai mentah tak pernah dikoersi saat simpan/baca — id dari hub harus jadi fallback diam di titik pakai. Metode adalah properti sesi **BACKLOG**; sesi project-level/cron/konflik tetap default. Tanpa pilihan eksplisit, prompt **byte-identik** dengan sebelum spec ini.
- **Kesiapan skill metode adalah nilai TURUNAN per agen, dan yang memasang bukan server** (SPEC-739/**ADR-0114**, melengkapi ADR-0113; ADR-0011/0018, 0037, 0056, 0087/0088 **ditegakkan**): `MethodDef.requires` punya **nol pembaca runtime** sampai spec ini — hanoman menjanjikan metodologi yang tak pernah ia pastikan ada, dan skill yang hilang **tak mematikan sesi** (tool error, agen lanjut) sehingga gerbangnya mati DIAM-DIAM: tanpa skill fase Plan tak ada berkas plan → `planComplete` `true` HAMPA; tanpa superpowers, `verification-before-completion` (INVARIAN 2 ADR-0113) jadi no-op. Deteksi hidup di **`runner/src/skills.ts`** (bukan `shared` — ia dibundel Vite ke browser; preseden `paths.ts`) dan memindai **DUA akar per agen**: `<home>/skills/<n>/SKILL.md` (id `<n>`) ∪ plugin dari `plugins/installed_plugins.json` ∪ plugin dari `plugins/cache/<mkt>/<pkg>/<versi>/skills/` (id `<pkg>:<n>`). **codex PUNYA akar plugin** — `superpowers@openai-curated` terukur `installed, enabled` di mesin dev, jadi memindai `~/.codex/skills/` saja memberi salah-negatif. Plugin dilewati **hanya bila dinyatakan nonaktif** (`settings.json` `enabledPlugins` untuk claude, `[plugins."x@y"] enabled = false` untuk codex); absen ⇒ aktif. Akar bisa di-override `HANOMAN_CLAUDE_HOME`/`HANOMAN_CODEX_HOME` (+ `CODEX_HOME`, kalah dari `HANOMAN_*`) — bukti test wajib dari sana, tak pernah dari HOME mesin. **`GET /api/methods/status`** menurunkannya **live tiap request**: nol tabel, nol kolom, nol entri `FIELDS` sync (properti MESIN, cermin `LocalBinding`/`repoDir`), cookie-only seperti `GET /codex/version`. Vonisnya murni di `shared/src/method-status.ts` dan melaporkan **DUA daftar terpisah** — `missingPackages` (dari `requires`, nama PAKET) dan `missingSkills` (dari `phaseSkills ∪ exitSkills`, id SKILL yang dipanggil prompt). **Fail-open adalah sifat GERBANG, bukan sifat VONIS**: metode belum siap **ditandai, tak pernah memblokir Start** (checklist di Settings → Sesi, catatan di picker Start, keduanya WAJIB menyebut agen), tapi pencocokannya **ketat & id persis** — skill polos `brainstorming` tak memuaskan `superpowers:brainstorming`. Pemasangan lewat **sesi terminal**: varian shell `POST /terminal/sessions` menerima `install?: {method, agent}` dan **server yang menurunkan perintahnya dari katalog** (`MethodDef.install` per agen) — klien tak pernah mengirim teks perintah, dan yang menjalankan adalah shell di pane tmux. **Server tak memasang apa pun** (ADR-0087/0088), **nol executor baru** (ADR-0037 utuh). `hanoman doctor` melaporkan metode **default** saja, hanya untuk agen yang CLI-nya ada, sebagai baris `!` **non-fatal** + perintahnya. **Empat gotcha:** metode tak dikenal di jalur install → **400**, sengaja TIDAK lenient seperti `resolveMethod` (ini tindakan, bukan bacaan); `MethodAgent` di `method-catalog.ts` adalah cermin sempit karena impor balik ke `entities.ts` menutup lingkaran (dijaga test yang mengadu kunci `install` dengan `zAgent.options`); dot-dir dilewati (`~/.codex/skills/.system/` milik codex); dan setiap berkas test web yang me-mock `api` sebagian wajib menyebut `getMethodStatus` — 18 berkas ikut ditambal, kegagalannya terbaca seperti regresi komponen.
- **Dua agen** (SPEC-338/ADR-0074): `Agent = "claude" | "codex"`. `Setting.agent` = default global untuk SEMUA sesi yang men-spawn agen (backlog, reverse, prd, scaffold, breakdown, terminal-agen, konflik-integrasi); **dua** pintu bisa meng-override per sesi: sesi backlog lewat `agent` di `POST /terminal/sessions` (picker Start, ADR-0061) dan — sejak **SPEC-517** — terminal agen biasa lewat form "Sesi baru" (`{project, agent?, model?, effort?}`, diresolusi `terminalAgentDefaults()`; aturan katalog UI-nya di `src/src/screens/session-runtime.ts`, berkas yang sama yang dipakai picker Start supaya keduanya tak bisa berselisih). Sisanya (reverse/prd/scaffold/breakdown, konflik) tetap mengikuti Setting. Argv dirakit `runner/src/agent-cli.ts` (`agentFlags()`, murni & bertest), agen sesi disimpan di tmux `@hanoman_agent`. Padanan flag: `--model`→`-m`, `--effort`→`-c model_reasoning_effort`, `--dangerously-skip-permissions`→`--dangerously-bypass-approvals-and-sandbox`, `--settings`→`-c hooks.<Event>=<toml>` (+`--dangerously-bypass-hook-trust`, wajib — tanpa itu TUI mentok di "Hooks need review"). Model codex di `Setting.codex`; `HANOMAN_CODEX_BIN` cermin `HANOMAN_CLAUDE_BIN`. **Tanpa migration** (`Setting` kolom `Json`). Tiga perbedaan sadar: codex **tak punya event `Notification`** (marker keputusan pakai `Stop`+`UserPromptSubmit` → marker juga menyala saat sesi selesai wajar); codex **mendiamkan hook `type:"prompt"`** (mode goal jadi gate sh deterministik: phase file lengkap + plan tanpa `- [ ]`, exit 2 = continuation prompt), berpagar `GOAL_MAX_BLOCKS=25`. **`armGoalInTui` tak lagi khusus claude** sejak SPEC-397/ADR-0085 — lihat butir mode goal di bawah. **Gotcha wajib:** codex menolak jalan di direktori belum-dipercaya dan `-c projects."…".trust_level` TAK membukanya — `services/codex-trust.ts` menulis satu entri `[projects."<repoDir>"]` per project (worktree mewarisi trust root). Limit langganan punya DUA sumber terpisah: `services/limits.ts` (claude, panggilan API live 30 dtk) dan `services/codex-limits.ts` (codex, SNAPSHOT `rate_limits` dari rollout `$CODEX_HOME/sessions/**` — nol jaringan, nol sentuhan token; >12 jam → `stale`). Dua badge & dua grup siar (`limits` + `codexLimits`), sengaja tak digabung karena kesegarannya beda. Gotcha: label window WAJIB dari `window_minutes` (`primary` bisa 5-jam ATAU mingguan), `resets_at` codex = epoch DETIK.
- **Sesi penyelesai konflik ikut `Setting.agent`** (SPEC-377, tanpa ADR — memulihkan ADR-0074 di dua call
  site yang terlewat): rebase/merge jalan deterministik di worktree isolasi; yang **konflik** menyerahkan
  worktree itu ke sesi agen, dan sesi itu lahir dari **`sessionAgentDefaults()`**, bukan `sessionModel()`.
  `sessionModel()` **sengaja khusus claude** — ia tak pernah melihat `Setting.agent`/`Setting.codex` — jadi
  memakainya di titik kelahiran sesi berarti `createSession` jatuh ke `opts.agent ?? "claude"` dan sesi
  lahir claude ber-model default apa pun isi Settings. Terukur: `{agent:"codex", codex:{model:"gpt-5.6-terra"}}`
  tetap melahirkan `--model claude-opus-5 --effort xhigh --dangerously-skip-permissions`. Berlaku untuk
  **ketiga** pintu konflik — `POST /specs/:id/integrate` (backlog), `finishGraphOp` di `routes/ide.ts`
  (git graph merge·rebase·pull·drop, satu titik menutup keempatnya), dan `POST /terminal/sessions/:id/integrate`
  (PRD, sudah benar sejak SPEC-338). Wajib disertai **`ensureCodexTrust(repoDir)`** saat agennya codex:
  tanpa itu sesi mentok di layar trust tanpa manusia di pane. Tak ada override per-request — pilihan agen
  hidup di Settings (kartu "Agen sesi" memang sudah menjanjikan "worktree, fase, stage, review, **integrate**").
  Aturan umumnya: **setiap titik kelahiran sesi baru wajib lewat `sessionAgentDefaults()`** — kecuali tiga
  pintu konflik yang kini lewat `conflictSessionDefaults()` (di bawah); `sessionModel()` tersisa hanya untuk
  `POST /vps/:id/session` dan menunggu dipensiunkan.
- **Sesi konflik boleh punya default sendiri** (SPEC-383/ADR-0081): blok `Setting.conflict`
  `{enabled,agent,model,effort}` (kolom `Json` → **tanpa migration**, tanpa endpoint baru) dibaca
  `conflictSessionDefaults()` dan dipakai **ketiga** pintu konflik (backlog `POST /specs/:id/integrate`,
  `finishGraphOp` di `routes/ide.ts`, PRD `POST /terminal/sessions/:id/integrate`). **OPT-IN**: selama
  `enabled` mati helper itu **mendelegasikan penuh** ke `sessionAgentDefaults()` — perilaku SPEC-377 tanpa
  selisih satu argv pun. Alasan pemisahannya: menyelesaikan konflik itu sempit, tak berfase, tak berplan,
  dan sering beruntun — tak perlu effort sesi Execute. **Satu triple, bukan blok per-agen** seperti `Setting`
  akar: menukar `agent` menukar model/effort sekalian (cermin `pickAgent` di `StartSessionModal`), effort
  codex dikoersi `coerceCodexEffort` di helper. **Gotcha wajib:** `ensureCodexTrust` HARUS diturunkan dari
  agen **hasil helper**, bukan `Setting.agent` — dengan blok ini keduanya bisa berbeda, dan membaca yang
  salah mengulang bug SPEC-377 (sesi codex mentok di layar trust) dalam bentuk baru. Tetap **tak ada**
  override per-request; pilihan hidup di Settings. UI: kartu "Konflik rebase & merge" di tab Model sesi;
  saat mati kartunya **menampilkan nilai warisan** supaya tak ada pertanyaan "lalu konflik pakai apa".
  Tab itu sekalian ditata ulang **bersumbu agen** (dua blok berjudul "Claude Code"/"Codex CLI" + badge
  `dipakai sesi baru`): sebelumnya blok claude cuma berbunyi "Model"/"Effort" — nama agennya hanya di
  `aria-label` — sementara judul "default global" tetap terpampang meski agen aktifnya codex. Katalog claude
  di Settings kini dibaca dari `MODELS`/`EFFORTS` (`@hanoman/shared`), sumber yang sama dengan picker Start.
- **Katalog codex per model** (SPEC-339): effort adalah properti MODEL, bukan properti CLI. `CODEX_MODELS` (shared) membawa `efforts`/`fallback`/`minClient` per entri; `CODEX_EFFORTS` tinggal gabungan, **bukan** sumber pilihan UI — picker WAJIB `codexEfforts(model)`. Isi katalog: `gpt-5.6-sol` (default global) & `gpt-5.6-terra` = ultra/max/xhigh/high/medium/low, `gpt-5.6-luna` = **tanpa ultra**, `gpt-5.5` = tanpa max & ultra. Koersi effort dilakukan di **`createSession`** (titik cekik tunggal — jalur ber-`AgentToken` pun lewat sana), dan model pensiun (`gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex-spark`) diremap ke `gpt-5.5` saat `getSetting()` membaca; sengaja bukan ke 5.6 agar setelan lama tak pindah ke model yang CLI-nya belum sanggup. **Gotcha wajib:** trio 5.6 butuh codex CLI **≥ 0.144.0** dan manifest model disaring server **berdasarkan versi klien** (cache `~/.codex/models_cache.json`) — CLI lama tak akan pernah melihat model itu, dan `max` bahkan belum ada di enum effort 0.142.5. `GET /api/codex/version` memberi catatan lunak di Settings & picker Start, **tanpa** memblokir Start. Rujukan otoritatif katalog = `codex debug models`, bukan ingatan.
- **Riwayat sesi** (SPEC-362/ADR-0079): tmux tetap sumber kebenaran sesi **hidup**, tapi setiap sesi kini
  meninggalkan baris `SessionHistory` (LOCAL-only, tak disync) yang **lahir bersama sesinya** (sesi berjalan
  pun tercatat, `endedAt: null`) dan ditutup saat `killSession`. `pty.ts` tetap **nol dependensi DB** — ia
  hanya menembakkan `registerSessionHooks({onBirth,onDeath})` dari **dua titik cekik**
  `createSession`/`killSession`; jangan menambahkan pencatatan di call site (ada 12, dan flow baru akan
  menambah lagi). `onBirth` **tak** menembak saat re-attach. Transkrip di-`capture-pane` **tanpa `-e`**
  SEBELUM pane dibunuh (sesudah itu scrollback lenyap), disimpan sebagai berkas di `HANOMAN_TRANSCRIPT_DIR`
  (`services/transcript-store.ts`) dengan cap 1 MiB **menyimpan ekor**; DB hanya pointer. **PK baris = uuid,
  BUKAN `sessionId`**: id sesi spec deterministik dan berulang tiap reopen — PK `sessionId` akan menimpa
  riwayat lama. `GET/DELETE /api/terminal/history*` sengaja di bawah prefix `/terminal` agar mewarisi
  capability `sessions`; `skip`/`take` DB sah di sana (tak ada overlay live seperti `GET /specs`, ADR-0038).
  UI = modal di Terminal (grid tak berubah ukuran) + "Mulai lagi" ber-`restartableKind`.
- **Penghapusan worktree saat sesi ditutup digerbangi `ownsWorktree`** (`services/session-worktree.ts`,
  SPEC-362): `DELETE /terminal/sessions/:id` hanya memanggil `realGit.removeWorktree` bila cwd sesi
  benar-benar berada DI DALAM `<repoDir>/.worktrees/`. Jangan pernah memutuskannya dari substring
  `"/.worktrees/"` pada cwd — itu menguji **bentuk path**, bukan **hubungan cwd↔repoDir**, dan begitu
  sebuah project di-bind ke checkout di bawah `.worktrees/` (persis saat hanoman didogfood di
  worktree-nya sendiri) terminal biasa ber-`cwd === repoDir` ikut lolos dan checkout project itu
  sendiri terhapus. `realGit.removeWorktree` juga **melempar** bila diminta menghapus repo itu sendiri:
  `git worktree remove` di dalamnya gagal-diam (`tryGit`), jadi `rmSync` terakhir tetap jalan meski
  git menolak.
- **`pkill -f` satu sesi membunuh agen sesi LAIN** (SPEC-402, tanpa ADR — QA): prompt sesi
  diserahkan sebagai **argumen positional** agen (`claude "$(cat <promptfile>)"`, SPEC-223 — dan itu
  tak bisa dihindari: `claude`/`codex` tak punya opsi prompt-dari-berkas, stdin dipakai TUI), jadi
  **seluruh prompt hidup di ARGV** proses agen. Karena klausa scope verifikasi (ADR-0080) memuat
  `vitest` (5×), `tsc`, `node server/dist/server.js`, setiap sesi ber-`verifyScope=changed` **cocok**
  dengan `pkill -f vitest` / `pkill -f tsc`. BSD `pkill` **mengecualikan leluhurnya sendiri**
  (`man pkill`: "-a … by default the current pgrep or pkill process and all of its ancestors are
  excluded"), jadi pola itu berperilaku sebagai "bunuh semua sesi lain, sisakan sesi saya" — dan
  itulah "intermitten"-nya: yang mati selalu sesi tetangga. Terukur 29 Jul: `pkill -f "tsc" ;
  pkill -f "vitest"` di sesi `spec-389` pukul 15:36:04.4Z → pane `spec-319` & `spec-390` mati
  **status 143** pukul 15:36:08 & 15:36:10, sementara `spec-389` sendiri selamat. Mitigasinya
  **klausa kontrak** di `runner/src/verify-scope.ts` (bunuh per-PID/port, atau sempitkan pola ke path
  worktree sendiri), bukan hook deny — ADR-0037 tetap utuh.
- **Pane mati ≠ pekerjaan selesai** (SPEC-402): `SessionInfo.exitCode` (`#{pane_dead_status}`, hanya
  saat `exited`) mengalir ke `SessionDTO`/klien, dan pane berkode ≠ 0 diberi pil **"Gagal · exit
  <n>"** (`--status-err-tint`), bukan pil hijau "Selesai". `markExited` **menyimpan** kode dari frame
  `exit` (dulu dibuang), jadi sesi yang mati di depan mata operator langsung terbaca gagal; nilai
  yang sama datang lagi dari daftar sesi sehingga labelnya selamat dari refresh. Sesudah itu tombol
  "Lanjutkan" (ADR-0084) baru punya makna — sebelumnya sesi terputus tampak tuntas.
- **Pekerjaan selesai ≠ pane mati** (SPEC-433, tanpa ADR — QA; belahan KEDUA dari konflasi di atas):
  sel Terminal dulu menggerbangi SELURUH statusnya pada `session.exited` (⇐ `#{pane_dead}`),
  padahal agen adalah **TUI interaktif** — sesudah menulis baris fase terakhir + push ia kembali ke
  prompt-nya dan pane hidup terus sampai operator menekan Tutup. Jadi pada jalur sukses `pane_dead`
  **tak pernah** jadi `1` dan pil hijau "Selesai" **secara struktural tak bisa muncul**; satu-satunya
  yang pernah menampilkannya adalah sesi yang mati exit 0 (di-`/exit` manual). Terukur 31 Jul dari
  keadaan hidup: `spec-431`/`spec-432` berkas fasenya lengkap (`Audit done`/`Spec skipped`/`Plan
  skipped`/`Execute done`), commit-nya mendarat, `Spec.stage = done` di DB — tapi `dead=0` dan
  `capture-pane` menunjukkan TUI menganggur di `❯`. Server sudah tahu jawabannya (`stageForRun`,
  dipakai `liveSpecs`); yang menyeberang ke Terminal hanya **daftar nama fase** yang dirender
  `PhaseStrip`, tanpa verdict. Fix: **`sessionComplete(phases, worktree, specId?)`** =
  `phasesComplete` (semua fase `done`|`skipped`, daftar kosong → **false**) **DAN** `planComplete`
  untuk sesi ber-spec, ikut frame WS yang sudah mengalir → `{t:"phase", phases, complete}`, dikirim
  dari **dua** titik (`pollPhases` + `attach`, jadi pil selamat dari refresh/pindah sel). Sengaja
  **bukan** `stageForRun(...) === "done"`: peta `REACHED` berkunci nama fase dan tak mengenal fase
  flow dokumen (`PRD`, `Serah terima`, `Breakdown`) — sesi itu akan selamanya terbaca belum selesai.
  **Tiga jebakan mengikat:** (1) kunci dedup `pollPhases`/`attach` **wajib memuat `complete`** —
  ia berubah tanpa satu baris fase pun berubah saat kotak `- [ ]` terakhir dicentang, dan dedup
  berkunci `phases` saja menelan frame itu (bentuk yang sama dengan dedup lengket `events.ts`
  SPEC-402); (2) gerbang plan ADR-0029 **wajib** ikut — tanpa itu "tak pernah hijau" cuma bertukar
  jadi **"hijau palsu"**; (3) `complete` **menang atas `awaiting`** (SPEC-196) karena marker
  keputusan **codex menyala saat sesi selesai wajar** (tak ada event `Notification` → dipasang di
  `Stop`+`UserPromptSubmit`, ADR-0074) — membiarkan `awaiting` menang mengulang bug ini untuk
  separuh agen. Urutan pil: `exited` → `complete` → `awaiting`. Badan pane **tidak** diredupkan saat
  `complete` (prosesnya masih hidup & bisa diketik); peredupan tetap milik `exited` (SPEC-188).
  `exited` sendiri **tak disentuh** — ia tetap menggerbangi re-attach (ADR-0084), "Lanjutkan",
  `startable`, `liveDecisions`, dan penutupan `SessionHistory`, yang memang bertanya soal proses.
- **Kegagalan `tmux` BUKAN "tak ada sesi"** (SPEC-402): `listPanes()` mengembalikan `[]` hanya untuk
  `no server running`/`error connecting to` (`TmuxError.noServer`); kegagalan lain **dilempar**.
  Dulu `catch { return []; }` menelan semuanya, dan loop poll 500 ms membacanya sebagai "semua sesi
  dibunuh dari luar" → `end(id, 0)` = **"— sesi berakhir (exit 0) —"** untuk SETIAP terminal yang
  terbuka, pada agen yang masih bekerja. Dua pemberat: dedup siaran `services/events.ts` tak pernah
  mengirim ulang kebenaran (`exited:false`) sehingga pil palsu itu **lengket**, dan `getSession()`
  yang bersumber sama menggerbangi kelahiran sesi — `undefined` palsu membuat `startSpecSession`
  memanggil `realGit.addWorktree` yang merebut path dengan `remove --force` + `rmSync` **atas
  worktree sesi yang sedang berjalan**. Loop poll melewatkan tick yang gagal, `events.ts` melewatkan
  siaran grup (mekanisme lama), `server.ts` melewatkan `reconcileHistory` (daftar kosong palsu akan
  menutup baris riwayat sesi yang masih hidup). Satu pengecualian sadar: `sessionPhasesBySpec()`
  tetap **lunak** (peta kosong) karena overlay stage forward-only.
- **Satu backlog = satu sesi** (ADR-0015): id sesi diturunkan deterministik dari id spec — menekan Start dua kali = **re-attach**, bukan spawn kedua.
- **Sesi backlog DILANJUTKAN, bukan diulang** (SPEC-394/ADR-0084, memulihkan substansi ADR-0017 yang
  ikut tercabut bersama ADR-0024 atas premis "sesi tmux tak pernah terputus" — benar untuk restart
  API, **salah** untuk mesin restart / agen keluar / operator menutup sesi): `startSpecSession` punya
  **tiga** keadaan, bukan dua. **live** = pane tmux hidup → re-attach. **resume** = `stage ≠ done` +
  `baseSha` ada + artefak masih ada → lanjutkan (`201 { id, resumed: true }`). **fresh** = selain itu.
  **Pane MATI bukan sesi** — `remain-on-exit on` menahannya hanya agar layar terakhirnya terbaca, dan
  mengembalikannya sebagai sesi membuat tombol "Lanjutkan" **diam** (UI sudah menghitung `!exited`,
  jadi tombol itu muncul persis saat pane mati); ia dibunuh dulu (menutup `SessionHistory` + simpan
  transkrip, ADR-0079) lalu sesi dilahirkan ulang. Dua bentuk resume: worktree `.worktrees/<id>` yang
  masih sah dipakai **apa adanya** — satu-satunya jalur yang TIDAK memanggil `addWorktree`, karena
  helper itu selalu merebut path dengan `remove --force` + `rmSync` — atau, bila worktree hilang,
  dibangun ulang `--detach` di tip **`origin/hanoman/<id>` → `hanoman/<id>` → `Spec.headSha`**.
  Urutan itu mengikat: `origin/…` adalah ref yang `git push` di akhir sesi harus fast-forward, dan
  worktree yang lahir dari `branchFrom` membuat push itu **ditolak non-fast-forward** (terukur —
  sesi ulangan bahkan tak bisa menyimpan hasil ulangannya). `baseSha` & `headSha` **tak pernah
  ditulis ulang saat resume** (rentang review ADR-0030 tetap dari basis asli); `baseSha` null =
  belum pernah punya worktree = bukan resume. Prompt-nya `resumePrompt` yang menyebut baris fase
  yang sudah tercatat + fase berikutnya + bentuk worktree-nya, dan **tak mengulang** klausa keputusan
  pasca-Audit (ADR-0040) begitu `Audit` tercatat — keputusannya sudah mewujud sebagai baris fase.
  Server **tak pernah menulis** ke `$HANOMAN_PHASE_FILE` (tetap milik agen, append-only). Ia hidup
  di luar worktree, jadi ia **selamat** dari penghapusan worktree — itulah kenapa server bisa
  menyebutkannya dan agen tidak bisa menurunkannya sendiri. `stage = done` tetap jalur SPEC-172
  (`continuePrompt`, worktree dari `branchFrom`) — kerjanya umumnya sudah ter-merge. `worktreeAlive`
  bertanya ke **git** (`rev-parse --is-inside-work-tree` + toplevel = path itu sendiri), bukan
  `existsSync`: direktori telanjang di dalam repo pun "ada". Berlaku juga untuk governor scheduler
  (jalur peluncuran sama).
- **Gerbang pane-mati hidup di titik cekik `createSession`** (SPEC-394/ADR-0084), bukan hanya di
  `startSpecSession` — jadi ia menutup sekaligus jalur yang **tak punya gerbang sendiri**: sesi
  konflik `merge-<spec>` (`routes/specs.ts`) & `finishGraphOp` (`routes/ide.ts`), dan konsol VPS
  `vpsc-<id>` (`routes/vps.ts`). Keempat route **project-level** (reverse · scaffold · prd ·
  breakdown) punya gerbang `getSession` sendiri di depan `createSession`, jadi
  masing-masing ikut disempitkan ke `!exited`. **`attach()` pada pane mati TETAP sah** — itu justru
  cara membaca layar terakhir sesi yang sudah selesai; jangan ikut dipagari. **Pasangan wajib untuk
  flow project-level:** kelimanya memanggil `realGit.addWorktree` **setelah** gerbangnya, jadi
  memperbaiki gerbangnya SENDIRIAN menukar gejala "tombol diam" (tak merusak apa pun) dengan
  **kehilangan dokumen yang belum di-commit** — regresi yang lebih buruk daripada bugnya. Helper
  `ensureWorktree()` di `routes/terminal.ts` melewati `addWorktree` bila `worktreeAlive(wt)`, dan
  prompt-nya diberi satu kalimat `RESUMED_WORKTREE_NOTE`. Flow dokumen sengaja **tidak** memakai
  `resumePrompt`: deliverable-nya dokumen, dan fasenya tak punya artefak berkotak seperti `- [ ]`
  di plan. Konsekuensi yang diterima sadar: "mulai benar-benar dari nol" untuk flow dokumen kini
  menuntut operator menutup sesinya dulu (Tutup memang menghapus worktree, SPEC-362).
- Sesi berjalan di worktree sendiri di `<repoDir>/.worktrees/<id>`, dibuat `--detach` dari `branchFrom` (default `main`); `baseSha` dicatat untuk rentang review (ADR-0030). Jenis sesi: **spec-flow** (feature/qa/audit), **reverse** (project-level), **prd**, **plain terminal** (claude di repoDir; atau shell mentah non-claude via `{shell:true}`, SPEC-236/ADR-0056), **integrate-conflict** (merge-<id>), **vps**. Flow **audit** (SPEC-237/ADR-0057) = audit-only: pipeline `Audit → Laporan`, hanya dokumen SoT (`research/audit-<id>-<slug>.md`), tanpa Execute; bisa dinaikkan jadi Finding QA.
- **Fase bukan proses melainkan giliran** dalam satu sesi: `runner/src/prompt.ts` `PIPELINES` mendefinisikan nama fase per flow; prompt menyuruh agen `echo "<Fase> done" >> $HANOMAN_PHASE_FILE`. Server membaca file append-only itu (`services/session-phases.ts`) untuk menurunkan fase aktif → `Stage`. Konteks terbawa antar fase karena semuanya satu sesi.
- **Kontrak otonomi** (ADR-0035): agen menembus batas antar-fase tanpa berhenti — checkpoint "review" milik skill superpowers **bukan** titik berhenti — dan hanya berhenti untuk bertanya di terminal saat butuh keputusan manusia sejati. Waspada: subagent async bisa bikin agen `end_turn` dan runner mengira fase selesai (fase jadi dangkal).
- **Eskalasi audit dinamis** (SPEC-340/ADR-0076, memperluas ADR-0057): audit punya
  **tiga** pintu tindak lanjut — Finding QA · Feature brief · PRD — bukan lagi hanya QA. Rekomendasi
  hanoman **terbaca mesin**: fase Laporan menulis satu blok ```json kanonik
  `{escalation:{target:"none|qa|brief|prd",reason,alternatives,prefill}}` di dokumen audit (pola
  manifest breakdown ADR-0069), di-parse `services/audit-escalation.ts` (defensif — rusak/absen →
  `null`) dan disajikan `GET /api/specs/:id/escalation` sebagai **nilai turunan** freshest-wins
  (ADR-0018) — **tak ada kolom DB, tanpa migration**. UI menyorot target rekomendasi (primary +
  badge) tapi ketiga tombol selalu tersedia: manusia terakhir yang memutuskan. Kontinuitas: brief
  lanjutan audit memakai `payload.fromAudit` (kini juga diterima `zBriefPayload`) + `branchFrom`
  `hanoman/<audit-id>`, tapi **TIDAK** melewati fase mana pun — beda sadar dari qa (ADR-0059), karena
  dokumen audit memuat temuan, bukan bentuk solusi. Sesi PRD menerima `branchFrom` **dan** `fromAudit`
  di `POST /terminal/sessions` (worktree lahir dari branch audit + isi dokumen audit disematkan ke
  `startPrdPrompt`); tanpa keduanya perilaku PRD lama utuh.
- **Model & effort per SESI** (SPEC-252/ADR-0061, mengamandemen ADR-0058): dipilih saat **Start** backlog lewat picker `StartSessionModal` (default = setelan global `model`/`effort`, `claude-opus-5` / `xhigh`), dikirim sebagai body opsional `model`/`effort` di `POST /terminal/sessions`, jadi argv `--model`/`--effort` saat sesi lahir → **andal penuh** (tak bergantung agen). Sesi tetap **satu proses, satu model seumur hidup**. Matrix per-fase lama (`phaseModels`, ADR-0058) **dicabut**: tak andal karena bergantung agen mengetik `/model`+`/effort` di batas fase, padahal agen menembus batas fase tanpa berhenti. Manusia tetap bisa `/model` manual di terminal. `steps` headless (ADR-0003) tetap usang.
- **Mode goal per sesi backlog** (SPEC-332/ADR-0073): sesi bisa lahir membawa gate `Stop` — `guardSettings` menyisipkan `hooks.Stop=[{type:"prompt",prompt:<kondisi>}]` ke `--settings` (mesin yang sama dipasang `/goal` Claude Code, tapi deterministik saat sesi lahir), plus keystroke `/goal` best-effort ke pane untuk visibilitas TUI. Kondisi default = DoD hanoman (semua fase tercatat di phase file, plan tak menyisakan `- [ ]`, push sukses) dan menuntut **bukti segar** karena evaluator hook `prompt` tak punya tool dan hanya membaca transkrip (yang bisa terpotong). Knob `Setting.goal` (default mati) + override `goal`/`goalCondition` saat Start; sesi scheduler mengikuti default global. **Bukan** guardrail deny — ADR-0037 tetap berlaku; interrupt manusia (`Esc`) bukan event Stop, jadi kendali tetap ada.
- **Mode goal codex memakai goal NATIVE codex** (SPEC-397/ADR-0085, mengamandemen ADR-0074 butir (b)):
  `armGoalInTui` **tak lagi khusus claude** — codex-cli **0.146.0** punya mode goal native
  (`codex features list` → `goals stable true`; `thread_goals` di `$CODEX_HOME/goals_1.sqlite`;
  status line `Pursuing goal` · `Goal achieved` · `Goal unmet`) dan codex **melanjutkan sendiri
  sesudah turn berakhir** sampai objektif tercapai. Premis ADR-0074 ("tak ada padanan terverifikasi")
  benar di 0.142.5, salah di 0.146.0. Gate sh **tetap terpasang** (masih menembak di 0.146): ia
  satu-satunya yang benar-benar **membaca** berkas fase & kotak `- [ ]` (cermin ADR-0029), sementara
  goal native menilai dengan prosa — jadi kondisi prosa bebas kini benar-benar dievaluasi di codex,
  batasan ADR-0074 itu dicabut. Harga yang diterima sadar: satu percobaan berhenti dievaluasi **dua
  kali**, keduanya berpagar (`GOAL_MAX_BLOCKS=25` / akunting budget codex). **Gotcha wajib:** TUI
  codex mengubah masukan yang datang dalam **satu burst ≥ 1024 karakter** jadi
  `[Pasted Content N chars]`, dan begitu itu terjadi slash-dispatch **tak jalan** — `/goal` terkirim
  sebagai **pesan chat biasa tanpa error, tanpa goal**. Deteksinya **per-burst PTY, bukan
  per-invokasi `send-keys`** (terukur: 4×500 char TANPA jeda → `[Pasted Content 1500 chars]`), jadi
  memotong keystroke tanpa jeda tak menyelesaikan apa pun → `goalChunks()` (runner, murni) mengirim
  potongan **500** ber-jeda 50 ms, dipakai **kedua** agen karena jebakan yang sama laten di claude
  (`GOAL_MAX` mengizinkan 4000 karakter). **Jebakan test:** verifikasi lama
  `paneText.includes("/goal")` **lulus palsu** persis untuk degradasi paste itu — pane memang memuat
  `/goal …`, sebagai pesan chat — jadi codex diverifikasi lewat penanda runtime goal-nya sendiri dan
  arming yang gagal boleh dikirim ulang (maks 3); verifikasi claude sengaja **tak disentuh**.
  Tanpa skema/migration/endpoint/knob baru.
- **Backlog goal — sesi dua fase tanpa perencanaan** (SPEC-407/ADR-0089, memperluas ADR-0073):
  source **`goal`** → flow **`goal`** = `PIPELINES.goal = ["Goal", "Verifikasi"]`. Sampai spec ini
  mode goal cuma **knob di atas pipeline `feature`**, jadi sesi "goal" tetap menulis design doc +
  plan berkotak sebelum menyentuh pekerjaannya. Kini prompt-nya builder terpisah
  **`startGoalPrompt`** (mengeja `Goal` / `Selesai bila` / `Batasan` dari payload; tanpa instruksi
  fase perencanaan, tanpa keputusan pasca-Audit, tanpa skill Brainstorm/Plan — fase `Goal` sengaja
  **tanpa skill**, hanya `Verifikasi` → `verification-before-completion`). Stage: `Goal` **aktif
  maupun tercatat** → `executing`, `Verifikasi` → `done` (nama fase wajib unik lintas `PIPELINES`
  — `REACHED` berkunci nama). Payload **bentuk ketiga** `zGoalPayload {goal, done, constraints,
  priority}`; `superRefine` `zCreateSpec` kini **tiga-arah** (`qa` ↔ `severity`, `goal` ↔ `goal`,
  selain itu brief) dan `Spec.objective` diturunkan dari `payload.goal`. **Mode goal dipaksa
  menyala** untuk flow ini (`opts.goal:false` diabaikan) dan **template global
  `Setting.goal.condition` DILEWATI** — ia generik untuk semua sesi sedangkan item goal membawa
  kondisinya sendiri; override per-sesi tetap paling tinggi. **Dua gotcha wajib:** (1) gerbang
  klausa scope verifikasi pindah dari "pipeline punya fase `Execute`" ke predikat
  **`writesCode(flow)`** — sesi goal menulis kode meski tanpa fase `Execute`, dan melewatkannya
  membuatnya jatuh ke DoD repo target alias suite penuh (lubang yang ditutup ADR-0080); (2)
  `resumeClause` hanya menyebut plan `docs/superpowers/plans/**` untuk pipeline ber-fase `Plan` —
  menyuruh sesi goal mencari plan justru mengundangnya membuat satu. Dua pintu masuk: tab **Goal**
  di modal backlog baru, dan tombol **"Take ke backlog"** di preview PRD yang kini **pemilih**
  (brief / goal, keduanya ber-`branchFrom = prd/<slug>`). Tanpa migration, tanpa endpoint baru;
  ADR-0029 (gerbang plan) & ADR-0037 tetap utuh.
- **hanoman-lead — agen pemimpin di atas agen** (SPEC-409/ADR-0091, **mengamandemen ADR-0035**):
  mekanisme "sesi menunggu keputusan" sudah lengkap sejak SPEC-184/196; yang tak pernah ada adalah
  **yang menjawabnya selain manusia**. Lead adalah **agen** yang dipanggil sekali-jalan non-interaktif
  (`claude -p`/`codex exec`, `services/lead/brain.ts`) dengan keluaran satu blok ```json — **bukan**
  menghidupkan run headless ADR-0024 (yang dicabut itu MENGERJAKAN pekerjaan bertahap; lead cuma
  penasihat berumur pendek yang tak menyentuh worktree sesi manapun). **Tiga pintu, satu otak**
  (`services/lead/decide.ts`, urutan wajib bukti → putusan → saring rujukan → gerbang tindakan →
  **TULIS JEJAK** → notifikasi): kontrak eksplisit `POST /api/lead/decisions` (agen internal &
  eksternal ber-`AgentToken`, capability domain **`lead`** dipetakan MENURUT METHOD — kelas bug
  SPEC-405), deteksi otomatis (baca pane ber-marker → ketik jawabannya lewat `pty.sendToPane`), dan
  denyut proaktif `setInterval` in-process (urutan kerja diserahkan ke antrean+governor ADR-0072,
  bukan antrean kedua; tabrakan area kerja dari diff worktree; tindak lanjut sesi ber-`exitCode ≠ 0`
  atau plan bersisa `- [ ]`). **Batas kerasnya di permukaan tindakan LEAD** (`LEAD_ACTIONS` =
  allowlist tertutup, konstanta modul **bukan konfigurasi**), ditegakkan **di server** — **ADR-0037
  tetap utuh**, sesi pekerja tak diberi hook deny apa pun. Konsekuensi mengikat: **"ulangi dari nol"
  mustahil bagi lead** (butuh menghapus worktree = terkunci), dan `stop-session` memanggil
  `killSession()` LANGSUNG — bukan `DELETE /terminal/sessions/:id` yang memang menghapus worktree
  (SPEC-362). Jejaknya model **`LeadDecision`** (migration tulis tangan, LOCAL-only, ikut `PG_ORDER`;
  `trail.ts` sengaja **tak punya fungsi hapus**) + `Setting.lead` (kolom `Json` → tanpa migration) +
  `Project.leadOptIn` (cermin `schedulerOptIn`). Jejak & status lewat **HTTP polling** — tanpa kanal
  WS baru (ADR-0039 utuh). **Semua default MATI.** **Enam gotcha:** penghitung jawaban otomatis TAK
  BOLEH di-reset saat marker kosong (marker memang kosong sesaat sesudah lead mengetik — hook
  `UserPromptSubmit` menjalankan `: >` — jadi reset di sana membuat pagar AC-11 tak pernah tercapai);
  idempotensi denyut lewat **jejak** bukan `Set` memori (pane mati bertahan berhari-hari, `Set`
  kosong justru sesudah restart); `zLeadVerdict.action` sengaja `string` bukan enum supaya "deploy"
  bisa MASUK lalu ditolak-dan-dicatat, bukan lenyap sebagai keluaran rusak; jawaban ke pane dipotong
  `goalChunks` (burst ≥1024 char → `[Pasted Content]` SENYAP, ADR-0085); rujukan disaring terhadap
  repo (path absolut & `..` ditolak); dan marker sesi **codex** menyala juga saat selesai wajar
  (ADR-0074) → `services/lead/pane.ts` bias ke DIAM.
- **Runtime/model/effort lead punya permukaan operator** (SPEC-488, tanpa ADR — skema `Setting`
  tak berubah): blok `Setting.lead.engine` `{enabled,agent,model,effort}` ada sejak ADR-0091 dan
  `leadAgentDefaults()` sudah menyalurkannya ke `decide()` → `think()` → `leadArgv()`, tetapi
  sampai spec ini **tak ada satu pun kontrol UI** (`grep "engine" src/src/` → nol) dan **tak ada
  satu pun test** (`lead-decide.test.ts` menyuntik `think` sebagai stub, jadi `brain.ts` maupun
  `leadAgentDefaults()` tak pernah dieksekusi olehnya). Permukaannya kini kartu **"Agen
  hanoman-lead"** di Settings → Model sesi, cermin kartu konflik ADR-0081; `LeadScreen` menampilkan
  hasilnya sebagai satu baris tanpa permintaan baru. **Tiga gotcha:** (1) kartu itu menulis lewat
  **`PUT /lead/config`**, bukan `PUT /settings` — `SettingsScreen` mengirim seluruh `Setting` dari
  snapshot yang dimuat **sekali** saat mount, dan blok `lead` punya **penulis kedua** (`LeadScreen`:
  Pause/denyut/opt-in), jadi menulisnya dari snapshot membuat **rem darurat lepas sendiri**; blok
  `conflict` aman dengan `save()` justru karena tak punya penulis kedua; (2) bukti "setelan dipakai"
  harus dibaca dari **argv proses**, bukan bentuk respons API — fixture `fake-lead-argv.sh` merekam
  argv (kecuali argumen terakhir, yakni prompt ±10 KB ber-baris-baru) lalu mencetak putusan json
  **sah**; `fake-lead-agent.sh` tak pernah mencetak json sehingga `decide()` berhenti di parser
  sebelum membuktikan apa pun, dan `fake-claude.sh` (`exec cat`) haram untuk agen one-shot
  (SPEC-448); (3) "tanpa restart" adalah **sifat** `getSetting()` yang tak punya cache dan dipanggil
  di dalam `decide()` — dikunci test yang memanggil `decide()` dua kali dalam satu proses dengan
  baris `Setting` berbeda di antaranya, supaya cache yang kelak ditambahkan orang lain memerahkan
  sesuatu. Terukur saat spec ini ditulis: memutus `leadAgentDefaults()` (paksa selalu warisan)
  memerahkan **5 dari 8** test berkas itu — buktinya tidak hampa.
- **Backlog yang SELESAI juga butuh diputuskan — pintu keberhasilan** (SPEC-451, tanpa ADR — QA;
  ADR-0091 **ditegakkan**, ADR-0037 & ADR-0072 utuh): denyut lead punya pintu untuk kegagalan
  (`followUpFinished`: exit ≠ 0 atau plan bersisa `- [ ]`) dan **tak punya pintu untuk
  keberhasilan**. Gerbangnya `s.exited`, dan SPEC-433 sudah membuktikan pane sesi sukses **tak
  pernah mati** — jadi keberhasilan bukan keadaan yang jarang diputuskan melainkan yang **secara
  struktural tak bisa** diputuskan; gerbang kedua (`!bad && !unfinished → continue`) membuangnya
  sekali lagi. Akibatnya `integrate-main` & `stop-session` — dua tindakan yang **sudah lengkap** di
  `apply.ts` sejak ADR-0091, berikut gerbang bukti objektif `requireGreenBeforeIntegrate` — tak
  pernah ditawarkan **satu pun dari lima call site `decide()`**: mesin tanpa pengemudi. Harganya
  slot governor: `liveCount()` (`scheduler/engine.ts`) menghitung **pane hidup**, jadi
  `maxConcurrent` sesi tuntas mengunci antrean selamanya — `reconcile` menutup baris antreannya
  dengan benar tapi ia tak membaca tmux. Terukur dari keadaan hidup 2026-08-01: SPEC-450
  `stage=done`, fase 5/5, plan **0** kotak, pane `dead=0` di `❯` — **4 jam 24 menit** memegang satu
  dari 6 slot, nol keputusan, **32 baris antrean `queued`**. Fix: **`sessionFinished(id)`** diekspor
  `pty.ts` sebagai **satu** definisi bersama frame `phase` (`paneComplete`) — menyalinnya adalah
  kelas bug SPEC-431/448 — dan **tidak** dijadikan field `SessionInfo` (governor memanggil
  `listSessions()` tiap 10 dtk; verdict itu akan membayar `readdir`+`readFile` sepanjang hidup tiap
  sesi, bukan di ekornya); pintu keempat **`followUpComplete`** digerbangi **`finished`, BUKAN
  `exited`**, **saling eksklusif** dengan pintu kegagalan secara konstruksi (`finished` ⇒
  `planComplete` ⇒ `!unfinished`, plus tolak `exitCode ≠ 0`) sehingga tak ada sesi yang membeli dua
  giliran agen untuk satu keadaan, dengan awalan idempotensi sendiri (`Backlog … sudah selesai di
  sesi …`, **bukan** `kind` — SPEC-432) dan **tanpa** gerbang `Setting.scheduler` (beda dari
  `orderReadyWork`: mengintegrasikan hasil yang sudah selesai berharga walau antrean tak dikuras);
  dan `integrateMain` **melepas panenya** pada hasil `clean` lewat `killSession` LANGSUNG (worktree
  utuh, AC-32a → rentang review ADR-0030 & tombol "Lanjutkan" ADR-0084 selamat), digerbangi
  **`planDone`, bukan `requireGreenBeforeIntegrate`** — knob itu menjawab "boleh diintegrasikan?",
  gerbang ini "boleh panenya dilepas?". **Dua penolakan sadar:** `rebase` tak ditambahkan ke
  `LEAD_ACTIONS` (allowlist itu konstanta, AC-31; merge yang paling mudah dibatalkan — persis
  kriteria yang diperintahkan prompt lead sendiri), dan **`liveCount()` tak disentuh** — menyaring
  pane selesai dari cap menukar antrean mandek dengan **pane menumpuk tanpa batas** dan menutup
  terminal tanpa keputusan siapa pun; yang benar adalah menutup panenya. Konsekuensi: selama
  `Setting.lead.enabled` mati (default) perilakunya **tak berubah** — operator yang menutup sesinya.
- **`services/lead/brain.ts` adalah titik spawn agen KEDUA — satu-satunya di luar `pty.ts`**
  (SPEC-448, tanpa ADR — QA; ADR-0091 ditegakkan, ADR-0037 utuh). Konsekuensinya mengikat: **setiap
  pelajaran spawn yang sudah dibayar di `pty.ts` harus dibayar ulang di sini**, dan sampai spec ini
  tak ada satu pun test yang menjalankannya (`lead-decide.test.ts` menyuntik `think` sebagai stub).
  Dua kegagalan lahir di celah itu, keduanya membuat lead **tak pernah** memutuskan. **(A) `execFile`
  tak pernah menutup stdin anak** — Node **tak meneruskan opsi `stdio`** untuk `execFile` (hanya
  `cwd`/`env`/`uid`/`shell`/`signal` yang sampai ke `spawn`), jadi pipa selalu lahir dan menyetel
  `stdio:["ignore",…]` di sana diam-diam tak berefek; satu-satunya jalan `child.stdin?.end()` lewat
  handle yang dikembalikan. `claude -p` membaca stdin sebagai sumber prompt alternatif dan menunggu
  **3 detik penuh**. Terukur (claude 2.1.220, prompt & anggaran 6 dtk sama, satu variabel): pipa
  terbuka → 6551 ms **dibunuh, stdout KOSONG**; ditutup → 3554 ms **jawaban benar**. Peringatannya
  mendarat di **stderr** — sumber yang sama yang dipakai `think()` menyusun pesan galat — sehingga
  sebab sebenarnya terdorong ke baris kedua dan gejalanya terbaca salah. Prompt lead memang lewat
  **argv** (`leadArgv`), bukan stdin, sama seperti sesi pekerja (SPEC-223). **(B) gerbang root claude
  tak menyeberang**: `rootBypassEnv` (`IS_SANDBOX=1`, SPEC-403) hidup di `pty.ts` saja — kedua commit
  lahir di worktree paralel di hari yang sama (`e5c73ac` **bukan** leluhur `a16465e`) — dan `brain.ts`
  men-spawn tanpa opsi `env` sama sekali. Claude `exit(1)` **sebelum satu token diproses**
  (`getuid()===0 && IS_SANDBOX!=="1" && !CLAUDE_CODE_BUBBLEWRAP`); tiga default resmi menjamin ini
  kena 100% di deployment lama — `deploy-vps.md` saat itu memakai root, agen default `claude`, dan sesi pekerja
  **selamat** lewat `pty.ts` sehingga tak ada gejala lain yang menunjuk ke root. `leadEnv()`
  **mengimpor** `rootBypassEnv`, tak menyalinnya: dua definisi yang tak sepakat justru penyebabnya.
  Hanya untuk **claude** — codex 0.146.0 tak punya gerbang root maupun rujukan `IS_SANDBOX`. **Jebakan
  fixture:** `fake-claude.sh` diakhiri `exec cat` karena ia mensimulasikan TUI di pane; memakainya
  untuk agen one-shot membuat tiap test `think()` selalu "kehabisan waktu" — hijau & merah tak
  terbedakan. Agen lead butuh fixture yang **keluar sendiri** (`fake-lead-agent.sh`).
- **Menjawab dialog `AskUserQuestion` bukan mengetik prosa** (SPEC-452, tanpa ADR — QA; ADR-0091
  ditegakkan, ADR-0037 utuh): `sendToPane` selama ini mengasumsikan pane **selalu** kolom teks.
  Untuk dialog pilihan claude asumsi itu salah — layarnya **widget daftar** Ink, dan handler-nya
  membandingkan `input` **UTUH** dengan nomor baris, jadi burst apa pun yang lebih dari **satu
  karakter** ditelan tanpa jejak dan `Enter` memilih baris yang sedang **disorot** (baris 1).
  Akibatnya keputusan lead **tak pernah menyeberang**: yang terpilih selalu opsi pertama, apa pun
  isinya. Terukur pada claude 2.1.220: prosa 55 karakter → layar tak berubah, `Enter` → baris 1;
  jawaban yang eksplisit menyebut nomornya (`"Pilih opsi 2 (Node 22) karena …"`) tetap memilih
  **Node 20** — kebalikannya, dan jejaknya tetap berstatus `berlaku`. `goalChunks` (ADR-0085)
  **tak menolong**: potongan 500 karakter tetap bukan satu karakter — `send-keys -l "2"` telanjang
  memilih **seketika** (tanpa `Enter`), menempel pada teks lain nol efek. **Deteksinya tak pernah
  rusak**: dialog memancarkan `Notification` `notification_type: permission_prompt` lewat pengait
  idle 6 dtk dan marker SPEC-184 terisi. Jalan keluarnya milik claude sendiri: setiap
  `AskUserQuestion` punya **kolom jawaban bebas** (`Type something.`) di nomor `jumlah_opsi + 1`,
  dan baris terakhir `Chat about this` di `jumlah_opsi + 2`. Urutan yang benar & terverifikasi:
  nomor kolom bebas sebagai `send-keys` **tersendiri berisi tepat satu karakter** → prosa (tetap
  ber-`goalChunks`, kolom bebas adalah kolom teks) → **`Enter` HANYA setelah teksnya terbukti
  mendarat**; nomor opsi biasa memilih seketika, nomor kolom bebas cuma memindahkan fokus.
  Mekanismenya di `services/tui-dialog.ts` (baca murni, tulis lewat `PaneIO` yang disuntikkan) dan
  **fail-closed** di setiap ragu — bukan dialog → jalur lama persis seperti sebelumnya, dan dialog
  **tanpa** kolom bebas (trust, prompt izin) sengaja tak disentuh karena di sana `Enter` = baris 1
  = "ya". **Dua gotcha mengikat:** (1) verifikasi sebelum `Enter` itu wajib — menekannya
  "kalau-kalau berhasil" mengulang bug ini lewat jalur baru; (2) marker keputusan **tak ikut
  kosong** sesudah dialog dijawab (menjawab dialog bukan `UserPromptSubmit`, terukur 8 byte sebelum
  & sesudah), jadi `detect.ts` mengosongkannya sendiri sesudah jawaban mendarat — tanpa itu denyut
  berikutnya membakar giliran agen lalu mengetik prosa ke kolom chat yang sudah normal, **pesan
  liar** ke sesi yang sedang bekerja, sampai `maxAutoAnswers`. Opsi dialog sekalian disodorkan ke
  `leadPrompt.options` — field yang ada sejak ADR-0091 dan tak pernah diisi pintu deteksi. Pintu
  override operator (`POST /lead/decisions/:id/override`) ikut sembuh lewat `sendToPane` yang sama.
- **Lead yang gagal WAJIB mengatakan kenapa, dan wajib punya ujung** (SPEC-472, tanpa ADR — QA;
  ADR-0091 ditegakkan, ADR-0037 utuh). Dua aturan yang lahir dari satu kejadian: `claude -p` milik
  lead ditolak **401** karena `think()` meneruskan seluruh `process.env` server, dan di sana ada
  **`ANTHROPIC_API_KEY`** yang disuntik `services/config-apply.ts` dari `RuntimeConfig` — kunci API
  eksplisit **mengalahkan** `CLAUDE_CODE_OAUTH_TOKEN`, jadi satu nilai salah di Settings mematikan
  seluruh lead. Ia **tak terlihat di `/proc/<pid>/environ`** (itu env saat exec, bukan `process.env`
  yang sudah dimutasi runtime): bandingkan jumlah var, atau `strace -v -e trace=execve`. Sesi
  interaktif **tak** ikut kena karena lahir lewat **tmux**, yang env-nya membeku saat daemon lahir —
  jadi `inheritEnv: true` di `config-registry.ts` hari ini hanya sampai ke anak yang di-`spawn`
  LANGSUNG oleh proses server. **(A) Alasan gagal.** `leadFailureReason()` (murni, di `brain.ts`)
  membaca **KEDUA stream** (stderr dulu, lalu stdout), menyebut exit code/sinyal, dan menyimpan
  **ekor** keluaran (cermin cap transkrip ADR-0079). Tiga jebakan yang membuat
  `(stderr || err.message).slice(0, 500)` gagal total: agen CLI **tak sepakat soal stream** — dengan
  env ramping penolakan kunci mendarat di **stdout** (`stderr === ""`), dengan env server penuh
  nasihat yang paling berguna ("ANTHROPIC_API_KEY … takes precedence · Unset it") justru di
  **stderr** dan vonisnya tetap di stdout, jadi mana yang terbuang **bergantung env**;
  `err.message` `execFile` berbentuk `Command failed: <bin> <argv…>` yang argumen terakhirnya adalah
  **prompt lead ±10 KB**, jadi ia tak boleh dipotong melainkan **tak boleh dipakai** (galat `spawn …
  ENOENT` berbentuk lain dan tetap berguna); dan pesan galat hidup di **ekor**, jadi memotong kepala
  membuang persis yang dicari. Gejalanya: 152 baris jejak `gagal` beruntun, semuanya **552 char**,
  semuanya identik, dan `journalctl` bisu karena `decide()` memang menjadikannya baris jejak, bukan
  `console.error`. **(B) Ujung.** `detect.ts` punya penghitung **kedua** (`failures`, ambang
  `maxAutoAnswers` yang sama) karena pagar AC-11 mengukur jawaban yang BERHASIL diberikan dan karena
  itu tak pernah bergerak untuk sesi yang keputusannya selalu gagal — `engine.ts` `TICK_MS = 5_000`
  lalu men-spawn agen lead baru selamanya (terukur 152 percobaan / ±13 menit atas tiga sesi, kuota
  langganan yang sama dengan sesi pekerja). Gerbangnya **sebelum** `decide()` — yang mahal adalah
  panggilannya. `null` dari `decide()` (lead dijeda di tengah panggilan) **bukan** kegagalan dan tak
  dihitung; keberhasilan mengosongkan rantainya ("beruntun"), begitu pula `resetSession`/`sweep`.
- **Dialog `AskUserQuestion` BERANTAI harus dituntaskan sampai submit** (SPEC-474, tanpa ADR —
  brief; ADR-0091 ditegakkan, SPEC-452 diperluas): satu tool call boleh memuat **1–4 pertanyaan**,
  dan menjawab satu pertanyaan **hanya memajukan** dialognya. Terukur in-vivo (claude 2.1.220):
  layar berantai memuat **tab strip** `←  ☐ Warna  ☐ Ukuran  ✔ Submit  →` (`☒` = sudah dijawab) dan
  footer `Tab/Arrow keys to navigate`; sesudah pertanyaan terakhir muncul **layar rekap** —
  `Review your answers` · `Ready to submit your answers?` · `❯ 1. Submit answers` / `2. Cancel` —
  yang **tak punya baris footer chord sama sekali**, jadi parser SPEC-452 (berpangkal pada
  `enter to select|confirm`) **tak pernah melihatnya**. Di layar itu prosa **ditelan** (layar
  byte-identik) dan **satu digit** memilih seketika. Cacat yang diperbaiki bukan "jawaban salah"
  melainkan **hang senyap**: `detect.ts` menjawab pertanyaan pertama lalu mengosongkan marker,
  padahal hook `Notification` mengisi marker **SEKALI per dialog** dan **tak pernah menembak lagi**
  (terukur **0 B selama 120 dtk** dengan dialog masih terbuka) → sisa rantai tak terlihat pintu
  mana pun (`if (!filled) continue` bahkan tak meninggalkan baris skip), pane hidup terus, satu
  slot governor terkunci (kelas SPEC-451). **Empat aturan mengikat:** (1) rantai dituntaskan dalam
  **satu putaran deteksi** — menunggu denyut berikutnya mustahil karena markernya takkan terisi
  lagi; (2) **satu rantai = satu jawaban otomatis** terhadap `maxAutoAnswers` (default 3) —
  menghitung per pertanyaan membuat dialog 4 pertanyaan **mustahil selesai**; (3) **submit tak
  pernah memanggil agen** (`deps.submit` → `submitPaneDialog`, keystroke satu karakter lalu
  **membuktikan** layar rekapnya pergi) — menekan tombol yang tak butuh pertimbangan tak boleh
  membakar giliran; (4) rantai yang **putus di tengah** membiarkan marker **tetap terisi** +
  menaikkan `failures`, jadi sesinya tetap terbaca menunggu oleh operator. Anti-loop lewat
  **identitas layar** (`dialogKey` = tab strip + **judul** pertanyaan) — bukan label baris:
  label kolom-bebas berubah begitu prosa lead mendarat, sehingga kunci berbasis label membaca
  layar yang MACET sebagai layar yang maju. Batasnya `MAX_CHAIN_STEPS = 6`, **konstanta modul**
  (cermin `LEAD_ACTIONS`). **Varian ketiga yang wajib diingat:** `AskUserQuestion` yang opsinya
  ber-**`preview`** dirender widget lain — **tak ada baris `Type something.`**, `Chat about this`
  tanpa nomor, catatan lewat tombol **`n`**, dan panel pratinjau duduk di **kolom yang sama**
  dengan baris opsi (label mentahnya menyeret ornamen kotak → `cleanLabel`). Sebelum spec ini ia
  lolos sebagai "dialog tanpa kolom bebas" → jalur lama → `Enter` memilih **opsi 1** secara senyap.
  Jalur benarnya `answerNotesDialog` (`n` → prosa ber-`goalChunks` → `Enter` **hanya** sesudah
  `notesFilled`); layar rekap menampilkan `(notes only)` tapi prosanya sampai ke model **verbatim**.
  Dialog **tanpa tab strip** (trust, prompt izin) tetap tak disentuh: di sana `Enter` = baris 1 =
  "ya". Pintu override operator (`POST /lead/decisions/:id/override`) ikut sembuh lewat
  `sendToPane` yang sama, dan sengaja **tak** mengosongkan marker → sisa rantai dilanjutkan lead.
- **Putusan lead ringkas & TERSTRUKTUR** (SPEC-480/**ADR-0098**, **mengamandemen ADR-0091 AC-1 &
  AC-22**; ADR-0037 utuh): `DecideRequest.options` sudah dipakai **empat** pemanggil — pintu
  deteksi dialog (SPEC-452) dan tiga pintu denyut — tapi verdict tak pernah punya field yang
  menjawab **"opsi yang mana"**. Label opsi denyut sengaja diawali nama tindakan
  (`"integrate-main — …"`), dan itulah satu-satunya jembatan antara pilihan dan eksekusi: berupa
  **harapan** bahwa prosa `decision` dan field `action` sepakat. Lead yang memilih opsi 1 di
  prosanya lalu membiarkan `action` pada default `"none"` melahirkan baris `berlaku` yang **tak
  berefek apa pun** dan tak terbaca sebagai kesalahan oleh siapa pun; `orderReadyWork` bahkan
  mem-`split` prosanya dengan regex. Kini verdict punya **`choice`** (string bebas — pilihan
  karangan harus BISA MASUK supaya ditolak-dan-dicatat, alasan yang sama dengan `action`) yang
  diselesaikan **`resolveChoice`** (shared, murni, **fail-closed**: nomor · nomor+label yang
  sepakat · teks persis · kepala label sebelum `—`/`:` · awalan **unik**; ambigu → `null`, karena
  SPEC-452 sudah mengukur ongkos pencocokan yang "kelihatan benar"). Di luar daftar → **baris tetap
  lahir** + `DITOLAK:` di `reason` + `weighty`, dan **`kind` TIDAK ditulis ulang** (mengganti `kind`
  merusak idempotensi denyut — SPEC-432). `action` boleh **diturunkan** dari `optionActionHint`
  **hanya saat lead diam**; bertentangan → `none` + `KONFLIK:` + notifikasi, tak pernah ditebak —
  sah hanya karena label opsi dirakit **pemanggil**, bukan lead (label bebas → hint `null`).
  Ringkas ditegakkan **dua lapis**: prompt menyebut `LEAD_DECISION_MAX = 240`/`LEAD_REASON_MAX = 480`
  **dengan angkanya** + larangan eksplisit (ringkasan ulang konteks · latar belakang · alternatif tak
  diminta), sementara `clampProse` memangkas **hanya yang dikirim** (balasan pintu #1 + ketikan ke
  pane) — **jejak menyimpan prosa UTUH**, dan catatan `DITOLAK`/`KONFLIK` ditempel **sesudah**
  pemangkasan supaya bagian terpenting tak terpotong. **`missing`** memberi AC-22 satu pengecualian
  **bernama**: bukan "bukti tipis" (itu `confidence: "ragu"` yang sudah ada) melainkan fakta konkret
  yang tak ada di repo — terisi ⇒ `ragu` dipaksa ⇒ weighty ⇒ operator dipanggil dengan pertanyaan
  **presisi**, bukan dengan diam; `decision` tetap wajib = kompatibilitas mundur. Empat kolom aditif
  nullable (`choice`/`choiceIndex`/`options`/`missing`); `options` disimpan karena `question`
  tersimpan sedangkan menunya tidak. **Dua gotcha sisa:** `clampProse` melipat spasi bukan demi rapi
  melainkan karena satu baris baru yang lolos ke pane adalah `Enter` yang mengirim jawaban separuh
  jadi (kelas SPEC-452); dan saluran `takeDelivery` hidup di memori berumur satu ketikan sehingga
  fallback ke `answer` wajib — di `detect.ts` ia **disuntikkan** sebagai dep `delivery`, prod tetap
  satu definisi.
- **Lead punya BATAS KONKURENSI, dan batas itu harus dinyatakan** (SPEC-479, tanpa ADR — QA;
  ADR-0091 ditegakkan, ADR-0024 & ADR-0039 utuh): sebelum spec ini **tak ada satu pun** batas
  konkurensi di subsistem lead — bukan salah setel, ia tak ada. Karena tak dinyatakan, jawabannya
  jatuh ke **bentuk kode masing-masing pintu**, dan hasilnya dua kelakuan berlawanan yang sama-sama
  kebetulan: pintu deteksi `for (const s of sessions) { await … }` → **serial mutlak** (terukur
  `maxInFlight = 1`, tangga tunggu **0/204/407/614/832/1035 ms** untuk 6 sesi; head-of-line: dua
  keputusan 20 ms selesai di 1028 & 1053 ms di belakang satu keputusan 1000 ms), sementara
  `POST /lead/decisions` tanpa pengereman apa pun → **12 permintaan bersamaan = 12 proses
  `claude -p --effort xhigh`** (terukur) di mesin 8 GB / 8 core yang sudah menanggung sesi pekerja.
  Jejak nyata membenarkan bentuk serialnya: **jarak minimum 49,2 dtk, nol pasangan tumpang tindih**
  di 18 baris `LeadDecision`. Dengan `timeoutSec` 600 × `MAX_CHAIN_STEPS` 6 satu sesi berantai boleh
  memegang pintu deteksi **60,6 menit** sendirian sementara `busyDetect` memulangkan tiap tick 5 dtk,
  snapshot sesinya diambil **sekali** di awal loop, dan urutan `tmux list-panes -a` **stabil** →
  ekor daftar selalu di ekor: **kelaparan yang bisa direproduksi**, bukan antrean lambat. M1 (median
  ≤ 2 mnt) pecah di **N=5** pada keputusan tercepat terukur dan **N=2** pada anggaran penuh.
  Perbaikannya satu gerbang penerimaan **FIFO** (`services/lead/gate.ts`, kapasitas
  `lead.maxConcurrent` default **2**, deadline `lead.queueWaitSec` default **120** — keduanya di
  kolom `Json`, tanpa migration) dipasang di choke point yang **sudah tunggal**, `decide()`; FIFO
  bukan gaya melainkan syarat, sebab gerbang "siapa cepat" di atas urutan tmux yang stabil
  melaparkan ekor daftar persis seperti loop yang digantikannya. **Tiga aturan mengikat:**
  (1) **penuh ≠ gagal** — `LeadBusyError` tak menulis baris jejak dan tak menambah `failures`
  (pagar SPEC-472 dibuat untuk sebab yang **tak hilang dengan mengulang**; penuh hilang begitu slot
  bebas, dan menghitungnya membuat tiga lonjakan beban menutup sesi itu **selamanya** karena
  `failCapped` adalah keadaan **menyerap** — terukur **0 percobaan baru dalam 10 denyut** sesudah
  bebannya hilang); (2) pintu kontrak menjawab **503 + `Retry-After` + `retryable:true`**, sengaja
  bukan 409 (lead mati) maupun 504 (sudah mencoba) — keduanya menyuruh peminta menyerah;
  (3) fan-out pintu deteksi tetap **berbatas** oleh angka yang sama, sebab satu rantai mem-*poll*
  `capturePane` sampai 20×/langkah dan `tmux()` memakai `execFileSync` yang membekukan event loop
  **6,28 ms/panggilan** — fan-out tanpa batas menukar kelaparan dengan server tersendat. Hipotesis
  yang **terbantah** & jangan "diperbaiki": `timeoutSec` 600 > `requestTimeout` Node 300 dtk tidak
  memutus peminta — **Fastify menyetelnya 0** (terukur dari `buildApp()`), jadi satu-satunya batas
  tunggu adalah yang kita pasang sendiri. Residu yang **sadar dibiarkan**: `busyDetect` masih
  menutup pintu deteksi selama satu putaran berjalan, jadi penunggu baru menunggu putaran
  berikutnya (kini hitungan menit, bukan puluhan menit) — mengubahnya menyentuh semantik
  re-entrancy `engine.ts` (SPEC-432) dan pantas dapat spec sendiri.
- **Pilihan lead JAMAK & rantai keputusan** (SPEC-485/**ADR-0102**, **memperluas ADR-0098** &
  SPEC-452/474; ADR-0091 ditegakkan, ADR-0024/0037/0039 tak disentuh): dua batas yang tak pernah
  dinyatakan, dan seperti SPEC-479 keduanya jatuh ke **bentuk kode**. **(A)** `choice` satu `string`
  di atas sepasang kolom skalar → peminta yang opsinya tak saling eksklusif hanya bisa menuang
  jawabannya ke prosa (membatalkan yang dibangun ADR-0098) atau memanggil ulang, satu proses
  `claude -p` per panggilan. **(B)** dialog `AskUserQuestion` ber-**`multiSelect`** adalah widget
  yang **BERBEDA**, dan empat perbedaannya masing-masing cukup untuk merusak jalur SPEC-452/474 —
  terukur in-vivo pada claude 2.1.220: (1) tiap label diawali `[ ]`/`[✔]` sehingga
  `"[ ] Type something"` tak lagi cocok `PLACEHOLDER` → `freeIndex === null` → `sendToPane` jatuh ke
  jalur prosa+`Enter`; (2) **digit MEN-TOGGLE** (`b = toggleValue` di biner), kebalikan penuh dari
  single-select yang memilih seketika; (3) ada tombol kirim **tanpa nomor** (`Submit`, atau **`Next`**
  bila pertanyaannya belum yang terakhir), dan karena tombol itu ada `Enter` di baris opsi men-toggle
  baris tersorot alih-alih mengirim → jalur lama men-toggle **opsi 1** lalu berhenti: layar tak maju,
  marker tak dikosongkan, `MAX_CHAIN_STEPS` habis, `failures` naik — persis gejala "hanya bisa dipilih
  satu" + hang yang dilaporkan; (4) kolom bebas hanya bisa dicapai lewat **navigasi**, dan panah pun
  **satu keystroke per `send-keys`** (terukur: empat panah dalam satu pemanggilan = satu perpindahan —
  jebakan burst ADR-0085 tak berhenti di teks). Perbaikannya empat. **(1)** Jawaban **selalu daftar**
  di penyimpanan (`LeadDecision.choices`/`select`), `choice`/`choiceIndex` tinggal turunan
  `choices[0]`, dan `toDecisionView` **menurunkan balik** untuk baris pra-migrasi — riwayat lama
  terbaca tanpa backfill. `resolveChoice` **tak disentuh**; `resolveChoices` memanggilnya per item
  (satu definisi — kelas bug SPEC-431/448/475/481), dan `optionActionHint` hanya berlaku saat
  pilihannya **tepat satu**. **(2)** Model **`LeadFlow`** (LOCAL-only, migration tulis tangan, ikut
  `PG_ORDER`, tanpa FK) berstatus `menunggu`/`sebagian`/`selesai`/`dibatalkan`, dipasang di
  `decide()` — choke point tunggal yang sama yang memegang gerbang SPEC-479. **Setiap** keputusan
  punya alur; yang tak berantai ditutup seketika, yang ber-`chain` terbuka sampai
  `POST /lead/flows/:id/submit`, dan `flowId` ke alur tertutup ditolak **409**. Endpoint tetap
  **sinkron** — lead yang menjawab, operator tetap pembatal. **(3)** `lead.flowTtlMin` (default 60,
  kolom `Json`) + penyapu yang **menumpang tick lead** (tanpa timer baru). **(4)**
  `answerMultiSelectDialog`: toggle per opsi (satu karakter, lalu **dibuktikan** kotaknya berubah) →
  navigasi ke kolom bebas (satu panah per pemanggilan, dibuktikan lewat `❯`) → prosa ber-`goalChunks`
  → navigasi ke tombol kirim → `Enter`; fail-closed di tiap langkah, dan `sendToPane` karena itu
  menerima `choices` sebagai **data** (pintu override operator ikut sembuh). Validasi berlapis dua:
  bentuk `select` mustahil ditolak **400** di pintu masuk, jumlah di luar `min`/`max` **membatalkan
  seluruh pilihan** (bukan memangkasnya) tanpa menulis ulang `kind` (SPEC-432). **Gotcha paling
  mahal:** `dialogKey` untuk layar multi **wajib membuang penanda `☐/☒` tab strip** — mencentang satu
  opsi sudah membalik tab yang tampil jadi `☒` tanpa satu pun pertanyaan berpindah, dan kunci yang
  ikut berubah membaca layar yang **MACET** sebagai layar yang **MAJU**, cacat yang sama persis yang
  SPEC-474 tutup untuk label kolom bebas. UI: `DecisionRow` menampilkan semua label terpilih, Timpa
  jadi **radio/checkbox** (DS `Radio` baru), plus kartu "Rantai keputusan". MCP hanya dapat tambahan
  **aditif** (`multi`/`minChoices`/`maxChoices` di `hanoman_lead_ask`) — protokol berantai butuh
  submit, dan membukanya tanpa itu hanya melahirkan alur menggantung.
- **Scope verifikasi per sesi** (SPEC-376/ADR-0080): `verifyScope` (`changed` default | `full`) —
  knob `Setting.verifyScope` (kolom `Json`, **tanpa migration**) + override saat Start. Sesi
  `changed` menguji **berkas yang berubah saja**: `pnpm vitest --run --changed "$HANOMAN_BASE_SHA"`
  atau `vitest related`, typecheck **per paket** (bukan `pnpm -r typecheck`), lint per berkas, dan
  build penuh / boot-server+curl hanya bila memang relevan. Alasannya sumber daya: beberapa sesi
  berjalan bersamaan di satu mesin (di repo ini satu suite penuh = 258 berkas test + 6 proses `tsc`).
  Akarnya **lubang di kontrak prompt** — `runner/src/prompt.ts` tak pernah menyebut scope verifikasi,
  jadi agen jatuh ke DoD repo target. Mewujud lewat **klausa prompt** (hanya flow ber-fase `Execute`
  — flow dokumen tak punya test) + **env** `HANOMAN_BASE_SHA`/`HANOMAN_VERIFY_SCOPE`; `baseSha`
  wajib lewat env karena worktree lahir `--detach` (tak ada `main`, `HEAD~1` salah). **Bukan**
  guardrail deny — ADR-0037 tetap utuh, dan agen boleh memperluas scope untuk perubahan berdampak
  luas asal menyebut alasannya. **Empat gotcha:** `--changed` menyalakan `passWithNoTests` sehingga
  nol test **terlihat hijau**; `--changed` di tingkat root WAJIB disertai **`--no-file-parallelism`**
  bila set-nya menyentuh test server — run root tak menghormati `fileParallelism: false` milik project
  server dan test server berbagi **satu berkas DB** (`<db>.test.db` per checkout sejak ADR-0086 —
  aman dari worktree tetangga, tapi tetap satu berkas untuk semua berkas test di paket itu), terukur
  di SPEC-397 set yang SAMA memberi **181 gagal
  palsu** paralel vs **736 lulus** serial, dengan bentuk kegagalan yang menyesatkan seperti regresi
  sync; env sesi dipasang sebagai **prefix shell** di depan argv sehingga
  tak pernah tercetak `/bin/echo` — buktinya harus dibaca dari DALAM proses (`fake-agent-env.sh`);
  dan untuk perubahan di modul INTI `--changed` memang mendekati suite penuh (terukur di SPEC-376
  sendiri: menyentuh `shared/src/{enums,entities,dto}.ts` → 217 berkas / 1589 test / 177 dtk) —
  itu blast radius yang sebenarnya, penghematan datang dari perubahan berdaun. `sync-ws.test.ts`
  terbukti **non-deterministik** (gagal 2× di run campur-project, lulus sendirian, lulus bersama
  tetangga server, lulus saat set yang sama diulang) — jalankan ulang terisolasi DAN ulangi
  set yang sama sebelum menyalahkan perubahanmu.
- **Klausa gaya kode di setiap prompt agen** (SPEC-543/**ADR-0108**, memperluas POLA ADR-0080;
  ADR-0037 & ADR-0098 utuh): satu konstanta **`CODE_STYLE_CLAUSE`** (`runner/src/code-style.ts`,
  tetangga `verify-scope.ts`) — rapi & mengikuti idiom sekitarnya · jangan komentar yang **mengulang**
  kode · komentar hanya untuk yang tak terbaca dari kode (alasan/why, trade-off, workaround
  ber-rujukan SPEC/ADR, invariant) · tanpa pembatas seksi/header berhias/narasi langkah demi langkah ·
  tanpa kode mati. **Tanpa `Setting`, tanpa skema, tanpa override per sesi** — beda sadar dari
  ADR-0080, yang punya knob karena ada keadaan di mana `full` benar; di sini tak ada. Dipasang di
  **enam** permukaan: empat builder prompt backlog/goal (digerbangi **`writesCode(flow)` yang sudah
  ada**, bukan daftar flow yang disalin), **tiga pintu konflik** yang merakit prompt-nya *inline di
  route* sehingga tak terjangkau gerbang itu, `agentPromptOf`, `leadPrompt`, dan `changelogPrompt`.
  **Empat hal yang mudah dirusak:** (1) gerbangnya hidup **di dalam teks** klausa (baris pertama
  "berlaku setiap kali kamu menulis atau mengubah kode") — itulah yang membuat SATU konstanta bisa
  dipakai prompt yang keluarannya bukan kode; varian kedua = kelas bug SPEC-431/448/475/481 dalam
  bentuk teks; (2) **`agentRosterBlock` codex sengaja tak menerimanya** (roster ditempel ke prompt
  sesi yang sudah membawanya), sementara subagent `claude --agents` punya konteks **terpisah** dan
  harus membawanya sendiri; (3) klausa **tak boleh memuat nama perintah** — prompt hidup di ARGV,
  jadi ia jadi muatan `pkill -f` sesi tetangga (SPEC-402), dijaga test; (4) bukti "terkirim" dibaca
  dari **pane tmux sesi sungguhan** (`session-launch.test.ts`, claude & codex), bukan dari
  `startPrompt()` — yang dijaga spec ini justru call site yang lupa memanggil builder-nya.
- **"Belum mulai" ≠ `baseSha IS NULL`** (SPEC-431, tanpa ADR — QA, mempersempit ADR-0072): checker
  `backlog` (SPEC-295) dan denyut lead (SPEC-409) memilih pekerjaan lewat **satu** predikat bersama
  `UNSTARTED_SPEC_WHERE` (`services/scheduler/queue.ts`) = **`baseSha: null` DAN `stage: not "done"`**.
  `baseSha` sendirian menjawab pertanyaan yang **berbeda** — "pernahkah hanoman membuatkan worktree
  untuk item ini" — dan kolomnya baru ada sejak ADR-0030, jadi item yang tuntas tanpa pernah diluncurkan
  hanoman (selesai pra-ADR-0030, ditandai selesai manual lewat `PATCH /specs/:id {stage}`, atau
  dikerjakan di checkout lain) permanen tak terbedakan dari item yang belum pernah disentuh. Terukur di
  DB produksi: **27 `Spec` `done` ber-`baseSha` null → 27 dari 29 baris antrean → 6 sesi tmux sungguhan
  lahir di atas pekerjaan yang sudah selesai**. `startedAt` (SPEC-408) **bukan** penggantinya: ia ditulis
  di titik cekik yang SAMA dengan `baseSha`, jadi null untuk 27 item yang sama — menukar proksi dengan
  proksi tak memperbaiki apa pun; `stage` adalah satu-satunya pernyataan tentang pekerjaannya sendiri.
  Yang membuat bug ini mahal: `startSpecSession` menghitung `isContinue = stage === "done"`, jadi item
  `done` justru masuk jalur reopen SPEC-172 — worktree + branch baru dan `baseSha`/`headSha`/`startedAt`
  **ditulis ulang** (stempel ADR-0090 milik item lama jadi bohong). **Gerbang kedua wajib di governor**
  (`isDone` dep, tepat sebelum `launch`): memperbaiki checker saja meninggalkan baris `queued` basi yang
  tetap akan meluncur, dan tak menutup balapan "operator menyelesaikan item selagi ia mengantre"; item
  itu **ditutup `done` + `note`** (bukan dihapus — `enqueue` ber-`update:{}` tak boleh menghidupkannya
  lagi) tanpa memakan slot. Gerbangnya sengaja **bukan** di `startSpecSession`: reopen manual item `done`
  memang fitur, yang dilarang cuma otomasi memasukinya sendiri.
- **Backlog boleh saling bergantung** (SPEC-447/ADR-0093): `Spec.dependsOn` (kolom `Json?`, array id
  spec **satu project**) menahan peluncuran sampai tiap dependency `stage = done` **DAN** commit-nya
  (`headSha`) sudah ada di branch basis si dependent (`branchFrom ?? "HEAD"`) — merged adalah **nilai
  turunan** git (`merge-base --is-ancestor`, memo 15 dtk), bukan kolom (ADR-0019). Yang membuatnya
  penting bukan urutan melainkan ADR-0002: sesi lahir `--detach` dari `branchFrom`, jadi dependent
  yang lahir lebih dulu **secara fisik tak memuat** pekerjaan dependency-nya. Satu resolver
  `services/spec-deps.ts` dipakai TIGA pembaca (gerbang `startSpecSession`, gerbang governor,
  dekorasi `liveSpecs` → `blockedBy`) — menyalin predikatnya adalah kelas bug SPEC-431. **Empat
  gotcha:** dependency yang **tak punya jejak kerja sama sekali** adalah **SIAP** — dan sejak SPEC-475
  "jejak kerja" berarti `headSha` **?? tip branch sesinya** (`hanoman/<sessionIdForSpec(id)>`, ADR-0032),
  bukan kolom `headSha` sendirian: kolom itu kosong pada **~76 %** item `done` ber-worktree, sehingga
  membacanya begitu saja membuat alasan `unmerged` **tak pernah menyala sekali pun** (0 dari 56 baris
  antrean di DB hidup) dan rantai backlog diluncurkan **6 detik** sesudah dependency-nya `done`, ±8,5
  jam sebelum merge-nya; git yang tak bisa menjawab dibaca
  **belum merged** (fail-closed); `"dependsOn"` **wajib** di `FIELDS.spec` atau client kehilangan
  urutannya dan meluncurkan pekerjaan yang di hub terblokir; dan `GovernorDeps.blockers` sengaja
  **wajib** (bukan opsional) supaya gerbang otomasi tak bisa lupa dipasang. Item terblokir tetap
  `queued` + `note` (bukan `failed` — pemblokirnya akan selesai, dan `enqueue` ber-`update:{}` tak
  bisa menghidupkan baris yang sudah ditutup) dan **tak memakan slot**; denyut lead menyaringnya
  sebelum membeli giliran agen (gerbang aktionabilitas SPEC-432). `force` **hanya** untuk jalur
  manusia (`POST /terminal/sessions`, 409 tanpa itu); otomasi tak punya jalan paksa. `dependsOn`
  sengaja **di luar** gerbang edit SPEC-186 — ia menggerbangi peluncuran berikutnya, bukan konten
  sesi berjalan; dan `DELETE /specs/:id` mencabutnya dari dependent agar tak ada yang terkunci
  `missing` selamanya.
- **`Spec.headSha` punya SATU penulis dan TIGA jalur yang memicunya** (SPEC-475,
  `services/spec-head.ts` → `recordHeadSha()`): `DELETE /terminal/sessions/:id`,
  `scheduler/reconcile.ts`, dan overlay stage-live `live-specs.ts`. Setiap jalur yang mempersist
  `stage = "done"` **wajib** memanggilnya — bukan opsional, dan jangan pernah menyalin isinya.
  Sampai SPEC-475 hanya jalur DELETE yang menulis kolom itu, sementara penyelesaian **otonom** tak
  pernah melewatinya (pane sesi sukses tak mati sendiri, SPEC-433; `integrate-main` lead melepas pane
  lewat `killSession` LANGSUNG demi worktree utuh, SPEC-451; item yang di-Start manual tak punya baris
  antrean sehingga `reconcile` tak menyentuhnya) → **159 dari 210** item `done` ber-worktree kosong
  ujungnya, gerbang dependency ADR-0093 kehilangan buktinya, dan rentang review ADR-0030 jatuh ke
  fallback worktree. Ini pengulangan **ketiga** pola SPEC-431/448 "satu definisi, N call site", dengan
  satu perbedaan yang membuatnya lebih licin: yang berbeda antar-jalur bukan **predikat** melainkan
  **efek samping** — dan efek samping tak punya tipe yang bisa memaksanya konsisten seperti
  `GovernorDeps.blockers`. `null` **tak pernah** ditulis: HEAD yang tak terbaca (worktree lenyap, repo
  rusak) tak boleh MENGHAPUS ujung yang sudah tercatat — itu menukar "belum ter-merge" jadi "siap"
  persis di titik paling berbahaya.
- **Custom agent — persona global & per project** (SPEC-450/ADR-**0094**): entitas `CustomAgent`
  (migration tulis tangan, **ikut sync**) dengan `projectId` null = **global**, terisi = milik satu
  project; agen project **menimpa** global bernama sama (dan agen project yang **dimatikan**
  menyembunyikan global itu — begitulah cara mematikan agen global di satu project). `id`
  **deterministik** `"<projectId|global>:<name>"` dan `name` **immutable**: baris ini menyeberang
  changefeed yang **tak punya operasi hapus**, jadi id acak membuat dua mesin melahirkan dua baris
  yang lalu bertemu di satu objek JSON **berkunci nama** dan salah satunya hilang tanpa jejak.
  **Nol berkas ditulis ke worktree.** Sesi **claude** lahir dengan `--agents "$(cat <file>)"`
  (mekanisme native — custom agent jadi **subagent sungguhan**; JSON di berkas tmpdir karena tmux
  membatasi SATU command ±16 KB, kelas kegagalan SPEC-223); sesi **codex** menerima blok **roster**
  yang ditempel ke akhir prompt sesi dan mengadopsi peran **inline** (tak ada proses kedua → risiko
  loop di codex **struktural nol**). Keduanya dirakit di titik cekik **`createSession`** lewat
  `registerCustomAgentSource` (cermin `registerSessionHooks`) dengan cache **sinkron** — Prisma
  async, `createSession` tidak — yang di-invalidasi tiap mutasi route & sync; gagal baca → daftar
  kosong. Sesi ber-`opts.command` (shell mentah) tak menerima apa pun. **Anti-loop tiga lapis, dua
  pertama yang menjamin:** graf mention wajib **asiklik** (409 + jalur siklusnya), lalu `Task`
  **diturunkan dari `mentions`** sehingga agen daun **tak punya alat** memanggil siapa pun (dan
  `Task` yang diketik operator DICABUT), lalu anggaran hop `MENTION_MAX_HOPS = 3` di prosa —
  `DEFAULT_AGENT_TOOLS`/`MENTION_MAX_HOPS` **konstanta modul, bukan konfigurasi** (pola
  `LEAD_ACTIONS`). **Tujuh gotcha:** (1) ketiga permukaan **gagal-senyap** sehingga verifikasi
  berbasis exit code **lulus palsu** — `--agents` ber-JSON rusak keluar exit 0 dengan NOL agen,
  nama tool tak dikenal dibuang tanpa pesan (`Glob`/`Grep`/`TodoWrite` terukur hilang), dan codex
  menerima kunci `-c` tak dikenal tanpa keluhan; verifikasi harus **menanyai agen apa yang
  benar-benar ia miliki** (kelas jebakan `paneText.includes("/goal")`, ADR-0085); (2) memeriksa graf
  **global saja tidak cukup** — validasi wajib jalan atas global **dan setiap project**; (3)
  `@@unique([projectId,name])` **tidak** mencegah dua agen global bernama sama (NULL saling berbeda
  di indeks unik SQLite) — yang mencegahnya PK deterministik; (4) `--agents` **tak boleh** ikut
  `.map(sq)` seperti flag lain atau claude menerima literal `$(cat …)` sebagai definisi agen; (5)
  membiarkan `tools` kosong juga tak boleh — agen tanpa `tools` mewarisi SEMUA tool termasuk `Task`
  dan lapis 2 lenyap; (6) nama tool yang dibuang senyap **aman** karena membuang hanya mengurangi
  kemampuan; (7) `"customAgent"` wajib ikut `PG_ORDER` + seluruh kolomnya di `FIELDS.customAgent`.
  Domain capability **baru `agents`**, dipetakan **menurut method** (kelas bug SPEC-405). **Bukan**
  titik spawn agen baru — `services/lead/brain.ts` tetap satu-satunya di luar `pty.ts` (SPEC-448).
- **Form Custom Agent berbasis katalog + `runtime`** (SPEC-484/ADR-**0101**, memperluas 0094 & 0074):
  `tools`/`model`/`mention` memakai **kontrol pilihan** bersumber API — `GET /api/custom-agents/catalog`
  untuk tools/model/runtime, `GET /custom-agents?projectId=` (yang sudah dipanggil panel) untuk mention;
  dua sumber untuk satu daftar adalah cara dua daftar mulai berbeda. Kolom baru **`runtime`**
  (`claude`|`codex`|**null = ikut sesi induk**) adalah **PENYARING** di `agentDefsFor(projectId, agent)`,
  **bukan** pemilih proses: melahirkan codex dari dalam sesi claude adalah titik spawn **ketiga**, dan
  tiap titik spawn membayar ulang seluruh pelajaran SPEC-448. Nullable **tanpa default** → **tak ada
  backfill**, baris lama berperilaku persis seperti sebelumnya; alternatif "wajib claude|codex +
  backfill ke claude" ditolak karena akan **mencabut seluruh roster dari sesi codex** tanpa ada yang
  memintanya. Katalog tool = pintasan `*` + `DEFAULT_AGENT_TOOLS` + satu entri **`mcp__<server>__*`
  per server MCP** yang ditemukan di `~/.claude.json` (global + `projects[<repoDir>]`),
  `<repoDir>/.mcp.json`, dan `~/.codex/config.toml` — semuanya **gagal-terbuka**; nama tool MCP yang
  sebenarnya hanya bisa didapat dengan **menyambung** ke server (= proses baru, ditolak ADR-0094).
  Katalog bawaannya **persis `DEFAULT_AGENT_TOOLS`**, bukan daftar kedua: menawarkan nama yang belum
  diukur berarti menawarkan pilihan yang **tidak melakukan apa-apa** (M4 membuang `TodoWrite` senyap).
  **Lima gotcha:** (1) `runtime` wajib masuk `FIELDS.customAgent` — kolom terlewat menyeberang sebagai
  **default palsu tanpa error**; (2) `tools` punya **TIGA** nilai berbeda (`null` default · `[]` tanpa
  tool · `["*"]` semua) dan `["*"]` **di-expand di `agentDefsFor` sebelum `resolveTools`** —
  meneruskannya membuat claude membuangnya senyap, menerjemahkannya jadi `null` mencabut lapis 2
  anti-loop, jadi `runner/src/custom-agents.ts` **tak pernah melihat `"*"`**; (3) `"*"` bercampur nama
  lain **ditolak 400**, bukan digabung; (4) validasi katalog **keras** tapi **hanya atas field yang ada
  di payload** (tanpa itu `PATCH {enabled}` mengunci setiap baris warisan), dengan `model` memakai
  **runtime EFEKTIF** — `?? null` membuat `PATCH {model}` pada agen codex lolos untuk model claude;
  (5) `agent` yang dipakai penyaring wajib `agentForDefs` milik `createSession`, bukan `Setting.agent`
  (sesi bisa lahir dengan override per-request — kelas bug SPEC-377). UI: komponen DS **`MultiSelect`**
  (inline, `role="option"` — bukan `<span>` di dalam `<label>` seperti `Checkbox`/`Switch`), chip ⚠
  untuk nilai lama di luar katalog, dan **Simpan terkunci** selama chip itu ada.
- **Telegram = kanal ke session operator tmux, BUKAN runtime agen kedua** (SPEC-476/ADR-0096): satu
  private chat/user allowlisted → satu id session `tg-<hash>` durable; natural text, command, dan
  callback di-steer ke pane yang sama, action produk hanya lewat `/api` ber-AgentToken/capability/
  correlation/audit. Gateway = satu long-poll `getUpdates` in-process dari `server.ts`, tanpa webhook,
  worker, Redis, tool bus, shell executor, atau spawn per pesan. Offset+dedupe+binding+outbox+memory+
  confirmation+audit adalah model SQLite LOCAL-only. **Crash policy mengikat:** state batas
  `received→dispatching` / `pending→sending` menjadi `uncertain` dan TIDAK diretry otomatis — update
  yang sama tak pernah masuk pane dua kali. Bot token hanya env gateway dan tak pernah masuk session;
  AgentToken masuk env session, bukan prompt. Reply Telegram HANYA dari amplop eksplisit tersanitasi,
  **jangan pernah** dari raw PTY/capture-pane (teks tanpa ANSI pun dapat memuat reasoning/command echo/
  secret). Aksi sulit dibatalkan membutuhkan confirmation inline single-use sebagai kondisi tambahan
  token gateway; capability/pagar route existing tetap menang. Personality memakai `CustomAgent`,
  memory+summary dikurasi session yang sama, dan claude/codex mewarisi `sessionAgentDefaults()`.
  **Kredensialnya tak lagi env-only** sejak SPEC-477/ADR-0097 — lihat butir berikut.
- **Kredensial Telegram = entri config terenkripsi, bukan `.env`** (SPEC-477/ADR-0097, mengamandemen
  ADR-0096; memperluas ADR-0049 & ADR-0065): keempat nilai (`HANOMAN_TELEGRAM_BOT_TOKEN` ·
  `_AGENT_TOKEN` · `_ALLOWED_USER_IDS` · `_TARGET_CHAT_ID`) menjadi entri **`CONFIG_REGISTRY` grup
  `telegram`**, **bukan** store kredensial kedua — resolver ADR-0049 (**DB → env → default** +
  `sourceOf()`) sudah persis semantik "DB kosong → pakai `.env` → tandai deprecated", jadi fallback
  dan penanda deprecated didapat **tanpa satu baris kode fallback**. `kind` menentukan masking,
  **`category` menentukan pagar tulis** (allowlist `string` tapi `credential`: harus terbaca kembali,
  tetap terpagari). Enkripsi at-rest berlaku untuk **semua** `kind: "secret"` (`services/secret-box.ts`,
  AES-256-GCM `node:crypto`, kunci `<HANOMAN_HOME>/secret.key` mode `0600` dibuat otomatis;
  `HANOMAN_SECRET_KEY` override **opsional** — mewajibkannya menghidupkan lagi ketergantungan `.env`
  yang justru dicabut). Batasnya di `setConfig`/`loadConfig` → **cache memegang plaintext, DB memegang
  ciphertext**, sehingga tak satu pun pemakai `effectiveStr`/`rawDbValue` berubah; baris tanpa prefix
  `enc:v1:` = plaintext lama, naik kelas saat ditulis ulang → **tanpa migration**, dan gagal-dekripsi
  = **absen** (fail-soft, boot tak mati). Tiga endpoint `/telegram/{settings,test,credentials}`
  **COOKIE_ONLY** + `PUT`/`DELETE /config` kategori `credential` menolak `req.agent` — jalur nyata,
  bukan hipotetis: AgentToken gateway Telegram **wajib** memegang `settings:write`, jadi tanpa itu
  sesi operator bisa menulis ulang kredensialnya sendiri lewat percakapan (pagar di **handler**, sebab
  `capabilityForRoute` tak pernah melihat `body.key`). Berlaku-tanpa-restart lewat
  `reloadTelegramGateway()` dari `applyConfigSideEffect` + `PUT /settings` (hanya bila blok `telegram`
  berubah). **Tiga gotcha mengikat:** (1) `loadConfig()` **wajib** mendahului
  `installTelegramGateway` di `server.ts` — urutan lama membuat gateway lahir dengan cache config
  kosong dan diam-diam jatuh ke env, kegagalan **senyap yang tampak benar** — **tapi wajib di dalam
  `try/catch`**: dulu ia fire-and-forget, di posisi barunya lemparan yang sama jadi `listen gagal` →
  `process.exit(1)` seluruh orchestrator (terbukti in-vivo saat smoke, `P2021`); (2) chat id
  channel/supergroup **NEGATIF** → `^\d+$` menolak persis kasus "Channel ID" yang diminta, sedangkan
  allowlist **user** id tetap non-negatif (dua pola, jangan disatukan); (3) Test Connection memakai
  **klien sekali pakai** ber-`AbortSignal` 10 dtk — klien gateway memegang `AbortController` loop
  `getUpdates`-nya, jadi menumpang di sana menukar "uji koneksi" dengan "putuskan polling". Nilai dari
  `.env` **tak divalidasi pola** (validasi = gerbang tulis, bukan gerbang baca), dan bot token
  **tetap tak pernah masuk sesi** (ADR-0096 gotcha 4 utuh).
- **Sesi operator Telegram punya runtime/model/effort sendiri** (SPEC-492, tanpa ADR — ADR-0096,
  ADR-0061, ADR-0074, ADR-0081 **ditegakkan**): blok opt-in `Setting.telegram.engine` bertipe
  **`zAgentEngine`** — bentuk `{enabled, agent, model, effort}` yang kini punya **satu** definisi di
  `shared/src/agent-engine.ts` dan dipakai `lead.engine` sekaligus (`zLeadEngine` = alias). Bentuknya
  **wajib** hidup di modul daun: `entities.ts` sudah meng-import `./telegram`, jadi mendefinisikannya
  di entities lalu meng-import balik menutup siklus modul dan `TELEGRAM_DEFAULTS =
  zTelegramSettings.parse({})` (top level) membaca binding yang masih **TDZ** → `ReferenceError`
  sebelum satu route pun terdaftar. Resolvernya `telegramAgentDefaults()` (cermin
  `leadAgentDefaults()`): mati → `sessionAgentDefaults()`, hidup → nilai engine + `coerceCodexEffort`.
  **Gotcha yang menentukan seluruh spec:** `TelegramChat.agent/model/effort` **membekukan** default
  saat chat pertama menyapa — `ensureChat` ber-`update:{userId}` dan **tak ada penulis lain**
  (`patchChat`/`PATCH …/context` hanya menerima empat field lain), jadi menukar `defaults` di
  `productionFactory` SENDIRIAN memberi setelan ber-**nol efek** untuk setiap chat yang sudah ada
  (terukur: instalasi hidup punya 1 baris, sudah beku di `claude · claude-opus-5 · xhigh`) — kelas
  SPEC-487. Resolver karena itu dibaca ulang di **tiap kelahiran sesi**, dipakai juga untuk
  **`ensureCodexTrust`** (gotcha SPEC-377/ADR-0081), lalu dicerminkan ke baris chat
  (`setChatEngine`). Permukaan keduanya **command yang dicegat coordinator** — `/engine`,
  `/engine off`, `/engine restart`, `/runtime`, `/model`, `/effort` — yang **tak pernah** menyentuh
  pane: ia soal transport, agen tak bisa mengubah model proses yang menjalankan dirinya sendiri,
  giliran agen terukur 14–95 dtk, dan ia harus bekerja justru saat agennya macet; balasannya
  diantre `kind: "gateway-control"` (di luar enum reply — `dedupeKey` outbox `chat:update:kind`,
  SPEC-491) dan gateway melewati progress generiknya (`outcome: "control"`). Parser
  (`services/telegram/engine-command.ts`) **murni** dan **fail-closed**: yang tak dikenali kembali
  `null` → jalur lama persis. **Sengaja TIDAK mengetik `/model` ke pane hidup** (ADR-0061 mencabut
  matrix per-fase karena itu; SPEC-487 mengukur pesan liarnya) — jalurnya `/engine restart`, dan
  konteks selamat lewat ringkasan + curated memory. `PUT /settings` **tak lagi** me-reload gateway
  bila hanya `engine` yang berubah (`telegramReloadNeeded`): reload memanggil `getMe()` dan bisa
  menjatuhkan `readiness` ke `error` gara-gara satu dropdown digeser.
- **Kehadiran gateway Telegram = indikator typing, denyutnya long-poll adaptif** (SPEC-493/**ADR-0104**,
  mengamandemen ADR-0096 §5; ADR-0024 **ditegakkan**): kedua varian teks `gateway-progress`
  **dihapus** — 7 update pernah menghasilkan 7 pesan robot. Penggantinya `sendChatAction` "typing…"
  yang **sesaat**: nyala saat update di-dispatch, di-arm ulang **sesudah tiap chunk** `flushOutbox()`
  (Telegram MENGHAPUS status typing tiap ada pesan masuk), dan **tidak** sesudah chunk terakhir
  balasan final — Telegram tak punya API stop-typing, jadi menghentikannya = membiarkan timernya
  habis. `Setting.telegram.progress` tetap saklarnya, sekarang atas typing; mati = **nol** panggilan
  API. `gateway-failure` **TETAP** pesan teks (kegagalan harus terbaca, bukan indikator yang hilang
  diam-diam). Denyut ~4 detik didapat **tanpa timer baru**: timeout `getUpdates` turun 25 → **4
  detik** selama ada `TelegramUpdate` `dispatched` tanpa balasan final (`store.chatsAwaitingReply`,
  nol kolom baru) — jeda kirim balasan **10,8/11,3/11,9 detik** yang terukur ikut hilang karena
  `flushOutbox()` kini dijangkau tiap ≤4 detik. **Enam gotcha:** (1) `retry_after` hidup di **BADAN**
  respons 429 dan `call()` dulu melempar sebelum membacanya → cooldown akan selamanya memakai default
  **dengan test hijau**; (2) umur menunggu wajib berpagar (`TYPING_MAX_WAIT_MS` 10 mnt) — update
  yang sesinya mati mengendap `dispatched` selamanya dan akan mengunci long-poll di 4 detik
  selamanya; (3) arm pasca-chunk **memaksa**, refresh **ter-throttle** (3 dtk) — tertukar berarti
  diam persis saat paling dibutuhkan, atau banjir saat update beruntun; (4) poll adaptif **tetap
  hidup** saat `progress` mati (flag itu menggerbangi suara, bukan latensi); (5) kosakata kind
  (`TELEGRAM_FINAL_REPLY_KINDS`) duduk di `protocol.ts` — dua pemakainya gateway **dan** store, dan
  menaruhnya di gateway = siklus import; (6) `decision`/`confirmation` **final** (giliran kembali ke
  manusia). Seluruh state typing in-memory di `services/telegram/typing.ts` dan **tak satu pun
  method-nya bisa melempar** — jalur at-most-once update/outbox tak tersentuh.
- Stage bergerak **maju** hanya lewat fase yang dilaporkan sesi; **mundur** hanya lewat aksi human eksplisit `PATCH /specs/:id { stage }` (backward-only, ADR-0027). `executing` **tertahan** (tak jadi `done`) selama plan `docs/superpowers/plans/**` masih punya `- [ ]` (ADR-0029).
- Biaya bersifat **estimasi dan tidak menggerakkan apa pun** (ADR-0012): tak ada `dailyBudget`/budget flag. Indikator limit dibaca dari OAuth usage API Anthropic (`services/limits.ts`), bukan parsing output terminal.
- **Jangan pernah menjalankan run/sesi di working tree utama** — selalu worktree terpisah. Jangan menyentuh worktree sesi lain.

## Aturan Keamanan

- **Markdown repository tidak tepercaya** (SPEC-759): seluruh preview Docs/PRD/backlog/sesi/Review/
  IDE/Git Graph/changelog/Dokumentasi AI Agent bertemu di `src/src/ds/markdown.tsx`.
  `marked.parse()` hanya boleh dipanggil di titik cekik itu dan hasilnya wajib melewati DOMPurify
  ber-allowlist HTML eksplisit sebelum `dangerouslySetInnerHTML`; SVG/MathML, tag aktif, event/style,
  `data-*`/`aria-*`, serta scheme selain relatif/`http:`/`https:` (`mailto:` khusus `href`) dibuang.
  Checkbox GFM wajib `disabled`, kelas hanya task-list/`language-*`, dan kegagalan parse/sanitasi
  jatuh ke `<pre>` ter-escape. Jangan membuat renderer Markdown kedua.
- Auth (ADR-0028): login email/password menggerbangi **seluruh `/api`** (gate `onRequest`, 401 tanpa sesi, termasuk upgrade WebSocket `/api/terminal`). Publik hanya `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
- **Agent token — akses AI agent** (SPEC-257/ADR-0065, diperkeras SPEC-761): jalur auth kedua memakai `Authorization: Bearer`; query credential dicabut. Capability per-domain default-deny; `/auth`, token/device/sync/webhook dan config sensitif cookie-only. Hanya `sessions:write` dapat memberi launch approval, yang diperiksa ulang di launcher; eksekusi production berada di rootless OS sandbox.
- Password: `crypto.scrypt` (stdlib) + salt acak + `timingSafeEqual`; tak pernah dikembalikan ke client. Sesi: token opaque 256-bit di cookie `httpOnly`; DB menyimpan `sha256(token)`, revocable. Login di-throttle per IP; error selalu generic.
- **Dua peran user** (SPEC-617/ADR-0110, diperkeras SPEC-761/ADR-0117): `admin` atau `client` scoped. Klien digerbangi allowlist deny-by-default `client-access.ts`; project asing 404; disable ditegakkan saat login dan lookup; admin terakhir dijaga; proyeksi portal adalah allowlist field. **Ingress lebih dulu:** public host hanya static/health/Help, control host menolak Help dan berada di access proxy. Bootstrap meminta token console 0600 one-time 15 menit dan create atomik; tidak ada lagi jendela first-user-wins.
- **Guardrail perintah berbahaya DICABUT sepenuhnya** (SPEC-197, ADR-0037): sesi jalan `--dangerously-skip-permissions` tanpa hook deny apa pun — agen dipercaya penuh, setara developer yang menjalankan `claude` di mesinnya sendiri. `runner/src/safety.ts` sudah dihapus. **Jangan hidupkan kembali tanpa ADR baru.**
- **Boundary agen production** (SPEC-761/ADR-0117): API/worker non-root; setiap sesi dan agen one-shot lewat `services/session-sandbox.ts` ke Podman rootless dengan root read-only, caps none, resource limit, narrow mount, credential read-only, dan internal network via egress proxy. Permission bypass berada di dalam boundary; worktree memisahkan Git saja. `Spec.launchApprovedAt/By` LOCAL-only dan final launcher hanya menerima approval cookie admin atau `sessions:write`.
- **Worktree hanya boundary Git** (ADR-0037 diamandemen ADR-0117): sesi di `.worktrees/<id>`; boundary keamanan production adalah rootless Podman dengan mount/secret/egress minimum.
- Kredensial Claude (Keychain macOS / `~/.claude/.credentials.json` / env `CLAUDE_CODE_OAUTH_TOKEN`|`ANTHROPIC_API_KEY`) dan private key VPS (`Vps.keyPath`, file di server) **tak pernah ke client maupun DB**.

## Aturan Data & Skema

- **Tujuh model inti** (SQLite via Prisma 6, ADR-0086): `Project`, `Spec`, `Setting`, `Notification`, `User`, `Session`, `Vps`. Tidak ada `Run` maupun `Trigger` — di-drop saat pindah ke sesi interaktif (ADR-0024). Model pendukung mencakup `DeviceToken`, **`AgentToken`** (kredensial AI agent + capability, SPEC-257/ADR-0065, server-local), `SessionResult`, sync (`SyncLog`/`SyncOutbox`/`SyncState`/`LocalBinding`/`RuntimeConfig`), Help Center (`Ticket`/`TicketAttachment`), **`ClientProjectAccess`** (akses akun klien → project, SPEC-617/ADR-0110 — LOCAL-only, tapi **wajib** di `PG_ORDER`), VPS compliance (`VpsAuditSnapshot`/`VpsItemState`), dan **`CustomAgent`** (katalog persona agen global & per project, SPEC-450/ADR-0094 — **disync**). **Error monitoring (`ErrorGroup`/`ErrorEvent`/`SourceMapArtifact`) dan `ProjectLink` sudah dicabut** — SPEC-384/ADR-0092, pemantauan pindah ke Uptrace.
- Enum stage/source/priority disimpan sebagai **`String` + divalidasi zod** di `@hanoman/shared` (`enums.ts`), bukan enum Prisma.
- `Project.id` (slug) **kekal**, tak ada endpoint rename; `repoDir` OPSIONAL & tak disync. **`LocalBinding`** (`projectId → repoDir`, per-mesin, LOCAL-ONLY) meng-override path; `resolveRepoDir = binding ?? Project.repoDir` dipakai **seluruh** jalur baca (spawn/IDE/coverage/branches/specs/docs).
- `docStatus`/`coverage`/**Docs**/**PRD** **bukan kolom & tidak dipersist** — docs live dari disk via `git ls-files`, coverage diturunkan tiap `toProjectView` (ADR-0018), PRD = dokumen `docs/prd/<slug>.md` (ADR-0041). Tabel `DocFile` sudah di-drop (ADR-0011).
- **Jangan ubah skema tanpa migration + ADR.** Menambah model: hand-write `migration.sql` + `migrate deploy` (bukan `migrate dev` yang me-reset). Jalankan `prisma generate` sesudah merge yang membawa model baru. **DB test tak perlu disiapkan manual** sejak ADR-0086 — `server/test/global-setup.ts` menghapus `<db>.test.db` lalu `migrate deploy` tiap run. Model baru **wajib** ikut `PG_ORDER` di `cli/src/commands/migrate-pg.ts`; test DMMF akan merah kalau lupa.
- **Fitur yang tak didukung SQLite dan karena itu tak boleh masuk skema:** scalar list (`String[]` non-relasi), tipe native `@db.*`, `Decimal`, `Bytes`, `mode: "insensitive"` pada filter (`LIKE` SQLite sudah case-insensitive ASCII). Skema juga **tak memakai `@map`** sama sekali — properti itu yang membuat tool migrasi Postgres bisa memakai baris `SELECT *` langsung sebagai data `createMany`; jangan merusaknya.
- DB dijaga kosong untuk pemakaian nyata (tanpa demo seed). Test memakai berkas `<db>.test.db`, bukan `DATABASE_URL` dev — vitest **menolak jalan** bila keduanya sama.

## Aturan Dokumentasi & Alur

- **SoT sebagai konvensi** (ADR-0023, supersedes ADR-0001): `internal/docs/**` tetap Source of Truth — diperbarui dalam **commit yang sama** & ter-link di index (`internal/docs/README.md`). Tapi guardrail/Stop hook/gate Execute yang menegakkannya **dicabut** (SPEC-160). `hanoman docs scan` tetap ada sebagai laporan coverage read-only. **Jangan menambahkan gate kembali tanpa ADR baru.**
- **Nomor SPEC & ADR unik & imutable**; ADR usang tidak dihapus — ditandai statusnya. Sibling worktree bisa mereservasi nomor yang sama — **enumerasi lintas semua branch** sebelum mengklaim nomor (ADR-0021).
- **Dokumen audit berumur, ADR tidak** (SPEC-386/ADR-0083): laporan
  `internal/docs/research/audit-<spec>-<slug>.md` hidup sampai eskalasinya diputuskan (ADR-0076) dan
  spec turunannya tuntas, lalu **dihapus berikut entri indexnya**. Tiga syarat: temuannya sudah punya
  **jejak permanen** (ADR, baris di doc SoT, atau kode ter-commit); **rujukan masuk ikut dibereskan** —
  doc permanen kerap menaut dokumen auditnya, dan melewatkannya meninggalkan link mati di doc yang
  justru dimaksudkan abadi (di SPEC-386 ada empat: ADR-0062/0064/0081 + `frontend-implementation.md`);
  dan index **tidak** menyimpan abstrak audit. **Struktur index sejak SPEC-386:**
  `internal/docs/README.md` memuat **satu baris per ADR** (nomor · judul · penanda status), sedangkan
  **narasi** tiap keputusan hidup di sub-index `internal/docs/adr/README.md` — ADR baru wajib ditaut di
  **keduanya**. Reachability aman karena coverage memakai BFS graf link (`linkedSetFrom`), bukan daftar
  datar, jadi doc yang hanya ter-link lewat sub-index tetap terhitung `linked`. Alasan pemisahan: index
  dibaca **setiap** sesi agen; sebelum SPEC-386 94% isinya (46,6 KB) adalah changelog ADR + abstrak
  audit, sekarang ±9 KB.
- **Alur fitur:** spec → plan → execute. **Alur QA:** audit → keputusan → (spec → plan)? → execute — temuan kecil langsung execute, Spec & Plan ditandai `skipped`; keputusan dielicit lewat prompt & diambil agen (ADR-0020/0040). **Alur audit-only** (SPEC-237/ADR-0057): audit → laporan (dokumen), berhenti; tanpa perbaikan, promotable ke Finding QA.
- Prompt sesi memetakan fase → skill superpowers: Brainstorm→brainstorming, Audit→systematic-debugging, Plan→writing-plans, Execute→executing-plans + TDD + verification-before-completion.
- Ikuti design system di `internal/docs/design-system/**` (editorial, bone paper, brass accent).
- **Unduh dokumen** (SPEC-361/ADR-0078): setiap pratinjau Markdown (`SpecDocsModal` — dipakai Backlog **dan** Terminal, PRD, Docs SoT, IDE) punya tombol `.md` & `.pdf`. Mekanismenya query `?download=md|pdf` pada endpoint dokumen yang **sudah ada** — jangan bikin endpoint ekspor baru; nilai lain/absen mengembalikan JSON lama utuh. PDF dirender `server/src/services/doc-export.ts` (`marked.lexer` → `pdfkit`, standard-14 font, `--external:pdfkit` di esbuild). **Gotcha wajib:** pdfkit **tidak melempar** untuk glyph di luar WinAnsi — ia mencetak mojibake senyap (`→` jadi `!'`, emoji jadi `Ø<ß‰`), jadi semua teks harus lewat `toWinAnsi()`; dan pdfkit **mewariskan opsi** di sepanjang rantai `continued`, jadi flag seperti `strike` wajib eksplisit boolean atau satu `~~coret~~` mencoret sisa paragraf.
- **Pratinjau dokumen tak menggulir ke samping & setinggi ruang yang ada** (SPEC-363, tanpa ADR — memperbaiki SPEC-361/ADR-0078): `.hn-md` memasang `overflow-wrap: anywhere` (**bukan** `break-word` — hanya `anywhere` yang mengecilkan *min-content*, dan min-content itulah yang membuat rantai inline `code` tanpa spasi & tabel lebar mendorong container), `table-layout: fixed`, dan `pre` ber-`white-space: pre-wrap`. Terukur atas **353 `.md` nyata**: 33 dokumen menggulir horizontal → 0, 187 dokumen ber-`pre` → 0 (harga +12,5% tinggi konten). Tinggi pane diturunkan dari viewport lewat rantai flex (`Modal fillHeight` opt-in + `flex: 1 1 0` di root layar Docs/IDE), bukan `62vh`/`620` tetap. **Dua gotcha wajib.** (1) `flex-basis` di item terluar **harus `0`**, bukan `auto`: pembungkus `<main>` memakai `min-height: 100%` (SPEC-351), jadi basis `auto` membuat item memakai tinggi ISI-nya dan justru menumbuhkan halaman — terukur pane 6000 px + halaman ikut menggulir; `LIST_SCREEN_STYLE` (basis `auto`) karena itu **tak** bisa dipakai apa adanya di sini. (2) di pdfkit, `doc.text(str, x, y, { width })` **menyalakan pembungkus baris yang memanggil `addPage()` sendiri — walau `lineBreak: false`**; karena renderer menaruh teks di koordinat eksplisit sambil membukukan `doc.y` sendiri, setiap pemakaian `width` di posisi eksplisit melahirkan halaman kosong (footer bernomor → satu halaman kosong PER halaman, dan nomornya ikut tercetak di halaman kosong itu; penanda butir daftar → `doc.y = top` jadi koordinat halaman basi, 5 dari 12 halaman PRD kosong — rantai DUA mata, dan matriks 2×2 membuktikan memutus salah satu saja sudah cukup). Blok kode digambar **bersegmen** — satu `rect` latar per halaman — dan hanya pindah halaman bila bloknya memang muat di halaman kosong (dulu satu `rect` 2126,6 pt menabrak footer). Hasil: `api-contract.md` 42→18 halaman, PRD hardening-vps 12→7 tanpa halaman kosong.
- **Kartu yang berisi pane bergulir wajib `<Card fill>`, bukan `style`** (SPEC-393, tanpa ADR —
  memperbaiki SPEC-363): `Card` **selalu** menyisipkan satu pembungkus `<div>` di sekitar
  `children`, dan pembungkus itu `display: block` kecuali prop **`fill`** dipasang — `fill` yang
  menyetel `display:flex`+`flexDirection:column`+`flex:1 1 auto`+`minHeight:0` pada **dua-duanya**
  (div terluar *dan* pembungkus anak). SPEC-363 memasang rantainya lewat `style`, yang hanya
  mengenai div terluar, jadi pembungkus anak memutus rantai: `flex`/`minHeight` di pane jadi
  **inert**, pane tumbuh setinggi isinya, dan karena `Card` ber-`overflow: hidden` isinya
  **terpotong tanpa scroller mana pun** — Docs & IDE Explorer tak bisa digulir sama sekali.
  Terukur di Chrome (viewport 1512×813, `<main>` 757 px): pane 11 830 px di dalam kartu 701 px →
  **11 184 px hilang**, dan `clientHeight === scrollHeight` di pane membuktikan ia tak pernah
  menggulir melainkan hanya tumbuh. **Jebakan test:** kontrak style SPEC-363 memeriksa PANE-nya
  (`flex: 1 1 auto`, `overflow: auto`, tanpa px/vh) dan itu tetap benar sepanjang bug — yang salah
  induknya. Karena itu `src/test/scroll-chain.test.tsx` **menaiki rantai leluhur** pane dan
  menuntut tiap mata rantai meneruskan tinggi (`display` flex/grid + `minHeight: 0`); jsdom tak
  melayout, jadi hanya kontrak itu yang bisa dijaga di test. Kontrol kerjanya sejak 2026-07-10:
  `ProjectsScreen.tsx` `<Card padding={0} fill>`; `DocPreviewModal` aman karena rantainya
  `Modal fillHeight` → `modal-body`, tanpa `Card`. **Sweep dua lapis** (54 `Card` dienumerasi →
  9 kandidat → 4 tanpa `fill`, lalu detektor gejala "terpotong & tak terjangkau" di Chrome)
  menemukan korban keempat yang **tak dikeluhkan**: modal berkas Git Graph (kartu ber-`maxHeight:
  86vh`), 11 162 px hilang. `ReviewScreen`/`BranchesPanel` aman **justru karena** pane-nya masih
  ber-`maxHeight` tetap — pane berbatas sendiri tak bergantung pada rantai. **Gotcha kedua:**
  `fill` juga menyetel `flex: 1 1 auto`, jadi di modal yang dipusatkan overlay flex ber-arah
  **baris** ia melebarkan panel (terukur 900 → 1464 px) — kembalikan `flex: "0 1 auto"` lewat
  `style` (di-spread sesudah `fill`); kartu grid item (Docs/IDE) tak kena.
- **Aksi preview `.md` di IDE & Review** (SPEC-385, tanpa ADR — memperluas ADR-0078 + preseden
  SPEC-240/363): empat permukaan yang dulu menampilkan `.md` sebagai `<pre>` mentah kini punya aksi
  preview — pane **diff** Explorer, modal berkas **Git Graph**, dan **Review** (backlog *dan* sesi
  PRD) — sementara IDE mode file mendapat ruang baca lebar di samping toggle inline SPEC-240 yang
  **tetap ada**. Satu komponen DS `ds/DocPreviewModal.tsx` (`Modal fillHeight` + `MarkdownView` +
  `DocDownload` opsional) yang **tak menyentuh api client**; gerbang seragam `isMarkdownPath(path)`
  (predikat pindah dari const lokal `IdeScreen` ke `ds/markdown.tsx`) **dan** non-biner **dan**
  `content !== null`. **Git Graph memakai TAB `preview`, bukan modal** — permukaannya sudah modal,
  jadi modal bertumpuk membuat Escape ambigu. Tombol IDE berlabel **"Preview lebar"** karena toggle
  SPEC-240 sudah memakai kata "Preview". Parity unduh ADR-0078 diwujudkan dengan menempelkan
  `?download=md|pdf` ke **lima endpoint yang sudah ada** (`/specs/:id/review/*`,
  `/terminal/sessions/:id/review/*`, `/projects/:id/file-diff`, `/projects/:id/commit/:sha/file`,
  `/projects/:id/compare/file`) lewat `sendReviewDownload` — **tanpa endpoint/skema/migration/ADR
  baru**; yang dikirim `ReviewFile.content` (isi **sesudah** perubahan, sama dengan yang dirender),
  dan biner atau `content === null` → **404** (bukan PDF kosong yang menyesatkan). `shared/src/api.ts`
  sengaja **tak** disentuh — `paths.download()` sudah generik, dan menyentuh modul inti meledakkan
  blast radius `vitest --changed` (ADR-0080).
- **Setiap task execute selesai:** centang checklist di file plan (`docs/superpowers/plans/**`, `- [ ]` → `- [x]`), lalu jalankan **test yang tersentuh perubahan itu** (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA"` atau sebut path test-nya). Bila task menyentuh endpoint, **test API-nya secara nyata di local** sekali di akhir — boot server (`pnpm dev` atau `node server/dist/server.js`) dan curl endpoint yang tersentuh, jangan hanya andalkan unit test. Fix sampai hijau sebelum lanjut.
- TypeScript strict; test untuk setiap logika orchestrasi (trigger, queue, worktree, guardrail). Sesi menjalankan test **yang tersentuh perubahannya** dan typecheck **paket yang tersentuh** (`pnpm --filter ./server typecheck`) — bukan suite penuh, bukan `pnpm -r typecheck` (SPEC-376/ADR-0080). Suite penuh (`vitest run --no-file-parallelism`) adalah langkah **manusia** sebelum merge. Hindari env prod bocor (`env -u NODE_ENV -u DATABASE_URL`).
- Definition of done: test yang tersentuh hijau · docs tersentuh diperbarui + ter-link · diff bersih di worktree, siap push ke target branch.
