# FRD (detail) — hanoman

Spesifikasi fungsional per modul, ditulis **EARS** (lihat
[acceptance-criteria](acceptance-criteria-ears-standard.md)). Dokumen ini **kanonik**;
[entrypoints/frd.md](../entrypoints/frd.md) adalah pintu masuk ringkas — bila keduanya berselisih,
perbaiki dokumen ini dulu lalu sinkronkan entrypoint-nya.

Modul mengikuti layar nyata di `src/src/screens/`. Tiap klausa menyebut ADR/SPEC penopangnya; klausa
tanpa penopang tidak ditulis.

## Auth

- THE SYSTEM SHALL menggerbangi **seluruh** `/api` dengan sesi login (gate `onRequest`), termasuk
  upgrade WebSocket `/api/terminal` ([ADR-0028](../adr/0028-auth-sesi-opaque-di-db.md)).
- THE SYSTEM SHALL menyisakan hanya empat rute publik: `GET /health`, `GET /auth/status`,
  `POST /auth/login`, `POST /auth/setup`.
- WHEN belum ada satu pun user, THE SYSTEM SHALL mengizinkan `POST /auth/setup` membuat akun pertama;
  sesudah itu THE SYSTEM SHALL menolaknya dengan 409.
- THE SYSTEM SHALL menyimpan `sha256(token)` sesi di DB, tak pernah token mentahnya, dan SHALL mencabut
  sesi saat logout, ganti password, atau hapus user.
- IF permintaan membawa `Authorization: Bearer hnm_agt_…`, THEN THE SYSTEM SHALL menerapkan jalur auth
  kedua ber-capability per-domain, dan SHALL menolak (403) domain yang tak boleh didelegasikan
  (`/auth`, `/agent-tokens`, `/device-tokens`, `/sync`)
  ([ADR-0065](../adr/0065-ai-agent-capability-agent-token.md)).
- WHILE `Setting.agentAccessEnabled` mati, THE SYSTEM SHALL menolak semua agent token.

## Overview

- THE SYSTEM SHALL menampilkan KPI: sesi aktif, item perlu perhatian, coverage docs rata-rata, jumlah
  spec di backlog, dan indikator limit langganan.
- THE SYSTEM SHALL menyajikan dua indikator limit **terpisah** — claude (panggilan usage API live, cache
  30 detik) dan codex (snapshot rollout, `stale` bila > 12 jam) — tanpa menggabungkannya, karena
  kesegarannya berbeda ordo ([ADR-0074](../adr/0074-codex-sebagai-mesin-sesi.md)).
- THE SYSTEM SHALL menjadikan tiap baris panel deep-link ke bagian terkait.

## Projects

- WHEN project `from-scratch` dibuat dengan direktori dipilih, THE SYSTEM SHALL `git init` direktori itu
  dan membuat commit seed bila belum ada HEAD; IF gagal, THEN THE SYSTEM SHALL menolak (400) tanpa
  meninggalkan baris project ([ADR-0052](../adr/0052-scaffold-flow-from-ide.md)).
- WHEN project `existing` dibuat lewat CTA **Tambah/Clone → reverse-engineer docs** (kedua mode: folder
  lokal dan clone dari URL git), THE SYSTEM SHALL memulai **tepat satu** sesi `reverse` untuk project itu
  dan membuka Terminal; IF sesi gagal dimulai, THEN THE SYSTEM SHALL mempertahankan project, menampilkan
  penyebabnya, dan mendaratkan operator di layar detail project tempat aksi **Reverse docs** mengulanginya
  tanpa membuat project kedua (SPEC-848). Pada mode clone, sesi dimulai **sesudah** binding hasil clone
  terbaca.
- WHERE project punya path repo efektif, THE SYSTEM SHALL menawarkan aksi **Reverse docs** (`existing`) /
  **Scaffold docs** (`from-scratch`) di layar detail project, digerbangi `LocalBinding ?? Project.repoDir`
  — bukan `Project.repoDir` saja, yang menyembunyikannya dari project hasil clone
  ([ADR-0026](../adr/0026-reverse-docs-sesi-interaktif-project-level.md), SPEC-848).
- THE SYSTEM SHALL menurunkan path repo sebagai `resolveRepoDir = LocalBinding ?? Project.repoDir` di
  **seluruh** jalur baca (spawn, IDE, coverage, branches, specs, docs); `LocalBinding` bersifat per-mesin
  dan tidak ikut disinkronkan.
- WHEN operator me-rename `Project.id`, THE SYSTEM SHALL menjalankannya lewat operasi rename khusus yang
  memperbarui FK cascade, referensi longgar, dan merambatkannya lewat sync
  ([ADR-0064](../adr/0064-project-id-renameable.md)).
- IF sebuah project punya sesi tmux aktif, THEN THE SYSTEM SHALL menolak penghapusannya.

## PRD

- THE SYSTEM SHALL memperlakukan PRD sebagai **dokumen** `docs/prd/<slug>.md`, bukan entitas DB
  ([ADR-0041](../adr/0041-prd-sebagai-dokumen-flow-project-level.md)).
- WHEN operator membuat PRD baru, THE SYSTEM SHALL membuka sesi `flow:"prd"` project-level dengan project
  target dipilih di dalam modal.
- WHERE filter project bernilai "Semua project", THE SYSTEM SHALL membaca `GET /prds` lintas project dan
  mengelompokkan item per project; WHERE satu project terpilih, THE SYSTEM SHALL membaca
  `GET /projects/:id/prds`. Keduanya freshest-wins.
- WHEN sebuah PRD dipecah, THE SYSTEM SHALL menulis manifest `docs/prd/<slug>.breakdown.md` (prosa + satu
  blok json kanonik) dan menyediakan `POST /specs/batch` untuk memateralisasi N spec independen
  ([ADR-0069](../adr/0069-breakdown-prd-ke-backlog-paralel.md)).

## Backlog

- WHEN brief atau finding dibuat, THE SYSTEM SHALL memasukkannya sebagai spec pada tahap awal lifecycle.
- WHEN operator menekan Start, THE SYSTEM SHALL membuka sesi agen di worktree terisolasi
  `<repoDir>/.worktrees/<spec-id>` yang lahir `--detach` dari `branchFrom`, dan SHALL mencatat `baseSha`
  untuk rentang review ([ADR-0002](../adr/0002-git-worktree-isolation.md),
  [ADR-0030](../adr/0030-spec-menyimpan-base-head-sha.md)).
- WHEN Start berhasil, THE SYSTEM SHALL tetap berada di layar Backlog — perpindahan ke Terminal hanya
  lewat aksi eksplisit (SPEC-341).
- IF sesi untuk spec itu sudah hidup, THEN THE SYSTEM SHALL me-**re-attach**, bukan men-spawn sesi kedua
  ([ADR-0015](../adr/0015-one-session-per-backlog.md)).
- WHILE spec masih `brainstorming` dan belum pernah dijalankan, THE SYSTEM SHALL mengizinkan edit judul,
  prioritas, dan detail; IF sudah dimulai atau stage-nya maju, THEN THE SYSTEM SHALL menolak edit konten.
- THE SYSTEM SHALL memajukan stage **hanya** lewat fase yang dilaporkan sesi, dan SHALL memundurkannya
  hanya lewat `PATCH /specs/:id { stage }` eksplisit dari manusia
  ([ADR-0027](../adr/0027-revert-stage-backward-only.md)).
- WHEN operator membuka detail backlog, THE SYSTEM SHALL menampilkan kontrol status yang hanya
  menawarkan stage lebih awal, SHALL menjelaskan bahwa stage aktif dan stage ke depan hanya dapat
  dicapai lewat fase sesi, dan SHALL memperlihatkan konsekuensi target sebelum menyimpan (SPEC-744).
- IF perubahan stage akan menghapus artefak fase, THEN THE SYSTEM SHALL mempertahankan dry-run
  `pending` → konfirmasi `confirmDelete:true`; WHILE salah satu request berjalan, THE SYSTEM SHALL
  mencegah submit ganda (SPEC-744, [ADR-0027](../adr/0027-revert-stage-backward-only.md)).
- WHEN perubahan stage dari detail berhasil atau gagal, THE SYSTEM SHALL mempertahankan detail
  terbuka, menampilkan umpan balik, dan — pada keberhasilan — menyinkronkan stage bar detail serta
  daftar backlog ke nilai `Spec` terbaru (SPEC-744).
- WHILE plan di `docs/superpowers/plans/**` masih memuat `- [ ]`, THE SYSTEM SHALL menahan stage di
  `executing` dan tidak memajukannya ke `done`
  ([ADR-0029](../adr/0029-execute-done-butuh-plan-terceklist.md)).
- WHERE spec sudah `done`, THE SYSTEM SHALL menawarkan rebase/merge branch hasilnya ke target lokal
  maupun origin ([ADR-0031](../adr/0031-rebase-merge-backlog.md)).

## Terminal & sesi

- THE SYSTEM SHALL menjadikan **tmux satu-satunya sumber kebenaran pekerjaan berjalan** — tak ada baris
  `Run` di DB — dan sesi SHALL bertahan lintas restart API
  ([ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)).
- WHILE sesi berjalan, THE SYSTEM SHALL menerima steer, interupsi, dan penutupan dari terminal web.
- THE SYSTEM SHALL menyimpan identitas/nama/urutan grup, dimensi grid, urutan cell row-major, dan
  `sessionId` per cell sebagai `TerminalWorkspaceV1` kanonik **per akun admin** di server; akun lain
  SHALL tidak mewarisi mapping itu ([ADR-0118](../adr/0118-workspace-terminal-kanonik-per-user.md)).
- WHEN Terminal dibuka, THE SYSTEM SHALL memuat workspace server sebelum mengaktifkan write. Browser
  legacy SHALL menjadi seed hanya bila server belum punya workspace; browser tanpa legacy SHALL tidak
  menulis workspace kosong, dan cache lokal SHALL tidak pernah diunggah otomatis sesudah fetch gagal.
- WHEN dua tab/perangkat menyimpan revision yang sama, THE SYSTEM SHALL menerima paling banyak satu
  write dan SHALL menjawab write stale dengan `revision-conflict` + snapshot current. Klien MAY
  menerapkan ulang mutasinya tepat sekali, tetapi SHALL tidak melakukan last-write-wins diam-diam.
- THE SYSTEM SHALL me-refresh workspace lewat HTTP saat mount, focus/visible kembali, dan sesudah
  mutasi. Adaptasi desktop/tablet/mobile SHALL hanya mengubah proyeksi; grup, koordinat, dan pemetaan
  sesi kanonik SHALL tidak berubah karena viewport.
- THE SYSTEM SHALL merekonsiliasi `sessionId` yang hilang hanya setelah workspace server **dan** daftar
  tmux otoritatif berhasil dimuat. Kegagalan daftar tmux SHALL tidak dianggap sebagai daftar kosong.
- THE SYSTEM SHALL menurunkan fase aktif dari phase-file append-only yang ditulis sesi
  (`echo "<Fase> done" >> $HANOMAN_PHASE_FILE`), bukan dari proses terpisah per fase.
- THE SYSTEM SHALL menjalankan sesi dengan agen `claude` **atau** `codex` sesuai `Setting.agent`, dengan
  override per sesi backlog ([ADR-0074](../adr/0074-codex-sebagai-mesin-sesi.md)); setiap titik kelahiran
  sesi SHALL melewati `sessionAgentDefaults()`, kecuali tiga pintu konflik yang lewat
  `conflictSessionDefaults()` ([ADR-0081](../adr/0081-default-sesi-konflik-opt-in.md)).
- IF agen sesi adalah codex, THEN THE SYSTEM SHALL memastikan trust direktori lebih dulu
  (`ensureCodexTrust`) yang diturunkan dari agen **hasil** helper — tanpa itu sesi berhenti di layar
  trust tanpa manusia di pane.
- WHEN sesi lahir dan saat ia dibunuh, THE SYSTEM SHALL mencatat baris `SessionHistory` (LOCAL-only) dan
  SHALL meng-`capture-pane` transkripnya **sebelum** pane dibunuh
  ([ADR-0079](../adr/0079-history-sesi-terminal-store-lokal-plus-transkrip.md)).
- WHEN sesi ditutup, THE SYSTEM SHALL menghapus worktree-nya **hanya** bila cwd sesi benar-benar berada
  di dalam `<repoDir>/.worktrees/` (`ownsWorktree`) — bukan berdasarkan bentuk path.
- WHERE mode goal aktif, THE SYSTEM SHALL memasang gate `Stop` saat sesi lahir
  ([ADR-0073](../adr/0073-mode-goal-stop-hook-per-sesi.md)); ini **bukan** guardrail deny —
  [ADR-0037](../adr/0037-cabut-guardrail-safety.md) tetap berlaku.
- WHERE `verifyScope` bernilai `changed`, THE SYSTEM SHALL menyuruh sesi menguji berkas yang berubah saja
  lewat klausa prompt + env, dan SHALL tetap membiarkan agen memperluas scope untuk perubahan berdampak
  luas ([ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md)).
- THE SYSTEM SHALL menyertakan klausa gaya kode yang sama — satu konstanta, tanpa knob dan tanpa override
  per sesi — di setiap prompt agen yang dilahirkannya: sesi backlog & goal (digerbangi `writesCode`),
  ketiga pintu konflik rebase/merge, prompt custom agent `claude --agents`, prompt lead, dan prompt
  narator changelog ([ADR-0108](../adr/0108-klausa-gaya-kode-prompt-agen.md)).

## Review & integrate

- THE SYSTEM SHALL menurunkan diff review dari `spec.baseSha`, dan IF basis itu tak resolve, THEN
  THE SYSTEM SHALL memakai default repo yang benar-benar ada — tidak pernah literal `"main"`.
- WHEN integrasi dipicu, THE SYSTEM SHALL menjalankannya deterministik di worktree isolasi tanpa
  menyentuh working tree utama; IF timbul konflik, THEN THE SYSTEM SHALL menyerahkan worktree itu ke sesi
  agen ([ADR-0053](../adr/0053-git-graph-merge-worktree-isolasi-sesi-claude.md)).
- IF target merge lokal sedang di-checkout, THEN THE SYSTEM SHALL gagal aman dan menyarankan target
  origin, alih-alih memaksa update ref.
- WHERE sesi bersifat project-level (PRD), THE SYSTEM SHALL menyediakan review + integrate ber-skop
  **sesi**, bukan ber-skop `Spec`
  ([ADR-0054](../adr/0054-review-integrate-ber-skop-sesi-untuk-prd.md)).

## Docs SoT

- THE SYSTEM SHALL memindai docs **live dari filesystem** tiap request dan menurunkan coverage saat
  dibaca — bukan dari tabel ([ADR-0011](../adr/0011-docs-realtime-filesystem.md),
  [ADR-0018](../adr/0018-coverage-nilai-turunan.md)).
- THE SYSTEM SHALL menghitung sebuah kategori `linked` bila **seluruh** docnya reachable dari
  `internal/docs/README.md` lewat graf link — termasuk yang hanya reachable lewat **sub-index**
  (SPEC-386).
- THE SYSTEM SHALL menempatkan kategori di luar `docsDir` pada grup "Lainnya (tidak dinilai)"
  ([ADR-0013](../adr/0013-sot-coverage-scoped-to-docsdir.md)).
- WHERE sebuah pratinjau Markdown ditampilkan, THE SYSTEM SHALL menyediakan unduhan `.md` dan `.pdf`
  lewat query `?download=` pada endpoint dokumen yang sudah ada — tanpa endpoint ekspor baru
  ([ADR-0078](../adr/0078-unduh-dokumen-md-pdf.md)).
- IF berkas yang diminta biner atau isinya `null`, THEN THE SYSTEM SHALL membalas 404, bukan dokumen
  kosong yang menyesatkan (SPEC-385).

## IDE (Explorer & Git Graph)

- WHERE sebuah berkas `.md` ditampilkan sebagai teks mentah, THE SYSTEM SHALL menawarkan aksi preview
  ter-render (SPEC-385); di Git Graph aksi itu SHALL berupa **tab**, bukan modal bertumpuk, karena
  permukaannya sudah modal.
- THE SYSTEM SHALL memuat commit graph berhalaman (`PAGE` 200) dengan sinyal `hasMore` dan baris penutup,
  sehingga daftar yang habis terbedakan dari history yang terpotong (SPEC-351).
- WHILE tab terlihat, THE SYSTEM SHALL menyegarkan graph diam-diam agar perubahan asinkron (commit sesi,
  konflik yang diselesaikan) tampil tanpa refresh manual (SPEC-245).
- WHERE IDE memutasi working tree utama, THE SYSTEM SHALL menggerbanginya dengan pemeriksaan sesi + force
  ([ADR-0034](../adr/0034-ide-mutasi-working-tree-utama.md)).

## Branches

- THE SYSTEM SHALL menurunkan daftar branch tak terpakai langsung dari git (`git branch --merged`) dengan
  base `?base=` → `main` → `master` → branch aktif — tidak pernah hardcode `"main"`
  ([ADR-0077](../adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md)).
- THE SYSTEM SHALL menegakkan ulang lima kunci proteksi (`current`, `base`, `worktree`, `spec-open`,
  `session`) **di jalur tulis**, sehingga klien tak dapat menyelundupkan branch lewat body.
- THE SYSTEM SHALL menghapus branch tanpa `--force`.

## Help Desk & triase

- THE SYSTEM SHALL menyediakan halaman Help Center publik per project di luar gate `/api`.
- WHEN tiket diterima, THE SYSTEM SHALL memetakan kategorinya ke source backlog: `bug`→`qa`,
  `fitur`→`brief`, `pertanyaan`→`audit`, `lainnya`→`brief` (SPEC-291).
- WHERE tiket punya lampiran, THE SYSTEM SHALL menyuntikkan **direktif** `PERIKSA lampiran` berisi nama,
  mime, dan path ke `payload.context`, dan SHALL memateralisasi byte-nya lebih dulu agar path itu nyata
  ada saat agen membacanya (SPEC-286,
  [ADR-0082](../adr/0082-kontrak-apply-changefeed-record-tertunda.md)).
- THE SYSTEM SHALL menyediakan link status publik ber-`shareToken` opaque
  ([ADR-0071](../adr/0071-link-ticket-triase-deeplink-sharetoken.md)).

## Scheduler

- WHILE scheduler dinyalakan, THE SYSTEM SHALL menjalankan engine sweep **in-process** dengan antrean
  durable `SchedulerQueueItem` (idempoten lewat `specId @unique`)
  ([ADR-0072](../adr/0072-scheduler-fondasi-engine-antrean-durable-cap.md)).
- THE SYSTEM SHALL menolak men-drain antrean melewati cap `maxConcurrent` yang dihitung dari
  `pty.listSessions`.
- THE SYSTEM SHALL memasukkan ke antrean **hanya** backlog yang `baseSha` **dan** `stage`-nya
  menyatakan belum dikerjakan (`baseSha = null` ∧ `stage ≠ "done"`) — berlaku untuk checker `backlog`
  maupun denyut hanoman-lead (SPEC-431).
- IF sebuah item antrean menunjuk `Spec` ber-`stage = "done"` saat governor hendak meluncurkannya,
  THEN THE SYSTEM SHALL menutup item itu (`status:"done"` + alasan) **tanpa** meluncurkan sesi dan
  tanpa memakai slot concurrency.
- THE SYSTEM SHALL mempertahankan default **mati** untuk `Setting.scheduler` dan
  `Project.schedulerOptIn`.

## VPS

- THE SYSTEM SHALL menjalankan audit dan harden sebagai **skrip deterministik** lewat SSH+sudo, tanpa
  cron baru ([ADR-0025](../adr/0025-modul-vps-script-deterministik.md)).
- THE SYSTEM SHALL menilai kepatuhan atas checklist 232 item dengan penandaan N/A, attestasi manual, dan
  remediasi selektif ber-preview dry-run ([ADR-0050](../adr/0050-vps-compliance-katalog-scoring.md)).
- THE SYSTEM SHALL menjalankan Open Console sebagai ssh mentah di tmux **lokal**, bukan tmux remote
  ([ADR-0042](../adr/0042-vps-console-ssh-tmux-lokal.md)).
- THE SYSTEM SHALL tidak pernah mengirim private key VPS ke client maupun menyimpannya di DB.

## Settings

- THE SYSTEM SHALL menyusun tab "Model sesi" **bersumbu agen** — satu blok berjudul per agen, dengan
  badge agen yang dipakai sesi baru ([ADR-0081](../adr/0081-default-sesi-konflik-opt-in.md)).
- THE SYSTEM SHALL membaca katalog claude dari `MODELS`/`EFFORTS` di `@hanoman/shared`, sumber yang sama
  dengan picker Start — tanpa salinan lokal.
- THE SYSTEM SHALL menawarkan effort codex per **model** (`codexEfforts(model)`), sehingga kombinasi yang
  ditolak model tak pernah tampil (SPEC-339).
- WHILE blok `Setting.conflict` mati, THE SYSTEM SHALL menampilkan nilai warisannya, sehingga tak ada
  pertanyaan "lalu sesi konflik memakai apa".
- THE SYSTEM SHALL tidak menyediakan `dailyBudget` maupun `maxConcurrent` berbasis anggaran — biaya
  adalah estimasi ([ADR-0012](../adr/0012-cost-is-an-estimate-not-a-guardrail.md)).

## Telegram gateway

- WHILE `Setting.telegram.enabled` hidup dan readiness env/auth valid, THE SYSTEM SHALL menerima
  `message` dan `callback_query` private-chat melalui satu loop `getUpdates` in-process
  ([ADR-0096](../adr/0096-telegram-gateway-session-operator-persisten.md)).
- IF chat bukan private atau user id tidak ada di allowlist, THEN THE SYSTEM SHALL tidak membuat
  binding/session dan SHALL tidak menyimpan isi pesannya.
- WHEN satu chat mengirim natural text, command, atau callback berulang, THE SYSTEM SHALL mengirim
  semuanya ke satu session operator tmux deterministik yang sama, bukan men-spawn agen per pesan.
- WHEN API restart, THE SYSTEM SHALL mempertahankan pane tmux hidup; IF pane hilang, THEN update baru
  SHALL memulihkannya dengan personality, summary, memory, dan context durable terakhir.
- WHEN update id direplay, THE SYSTEM SHALL mengeksekusinya paling banyak sekali; outcome batas crash
  SHALL menjadi `uncertain` dan tidak diretry otomatis.
- THE SYSTEM SHALL menyediakan command minimum `/help`, `/status`, `/projects`, `/project`, `/backlog`,
  `/sessions`, `/use`, `/new`, `/stop`, `/memory`, `/personality`, dan `/skills`, namun SHALL tetap
  memperlakukan bahasa natural sebagai interface utama.
- THE SYSTEM SHALL menjalankan action produk hanya dari session melalui API Hanoman ber-AgentToken,
  capability, correlation, dan audit; gateway transport SHALL tidak menjadi shell executor/tool bus.
- IF action sulit dibatalkan diminta oleh token gateway, THEN THE SYSTEM SHALL meminta confirmation
  inline single-use yang cocok method/path/chat sebelum handler action berjalan.
- THE SYSTEM SHALL membentuk reply hanya dari amplop user-facing eksplisit; raw PTY, reasoning, ANSI,
  token, header, dan credential SHALL tidak pernah menjadi output Telegram.
- WHERE agent default Settings adalah claude atau codex, THE SYSTEM SHALL memakai helper default sesi,
  protocol, capability, memory, dan acceptance suite yang sama.
