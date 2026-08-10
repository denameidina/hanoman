# ADR-0112 — Cronjob per project di scheduler: sesi ber-id deterministik, satu jatuh tempo satu baris, anggaran slot bersama

- Status: Accepted
- Tanggal: 2026-08-11
- SPEC: SPEC-646
- Terkait: **memperluas [0072](0072-scheduler-fondasi-engine-antrean-durable-cap.md)** (menjawab batas
  yang dinyatakannya sendiri — "cadence hanya interval menit, HH:MM harian ditunda"),
  menegakkan [0015](0015-one-session-per-backlog.md) (satu sesi per unit kerja),
  [0016](0016-sesi-terminal-hidup-di-tmux.md) (tmux sumber kebenaran sesi),
  [0024](0024-sesi-interaktif-menggantikan-run.md) (tanpa cron OS/worker/queue eksternal),
  [0045](0045-skema-sync-synclog-version-stamp.md) (whitelist `FIELDS`),
  [0065](0065-ai-agent-capability-agent-token.md) (capability per-domain),
  [0107](0107-paginasi-seragam-daftar-dashboard.md) (amplop paginasi),
  [0108](0108-klausa-gaya-kode-prompt-agen.md) (klausa gaya kode di prompt agen).
  Pola tabel-merangkap-antrean-dan-riwayat mengikuti [0100](0100-webhook-keluar-peristiwa.md).

## Konteks

Scheduler hari ini berbentuk **checker berbasis cadence**: `sources.backlog` & `sources.triase`
berjalan tiap N menit, memindai baris `Spec`, lalu meng-`enqueue` ke `SchedulerQueueItem`. ADR-0072
menunda jadwal jam tertentu secara eksplisit di bagian Konsekuensinya.

Dua hal karena itu tak punya tempat sama sekali:

1. **Jadwal jam tertentu** — "cek error produksi tiap pagi 07:00", "audit docs tiap Senin 09:00".
2. **Pekerjaan yang bukan sebuah `Spec`** — pemeriksaan rutin tak punya backlog item; justru
   keluarannya yang mungkin melahirkan backlog item.

Yang sudah tersedia dan wajib dipakai ulang, bukan diduplikasi: satu loop `setInterval` yang
di-`start` hanya dari `server.ts`, governor ber-cap yang menghitung sesi hidup dari
`pty.listSessions()`, rem darurat `Setting.scheduler.paused`, dan master `Setting.scheduler.enabled`.

## Keputusan

1. **Unit peluncuran = sesi project-level ber-id DETERMINISTIK, bukan `Spec`.**
   `SchedulerQueueItem.specId` adalah kolom NOT NULL `@unique` yang sekaligus kunci idempotensi
   "satu sesi per spec" (ADR-0072 keputusan 2); memaksakan cron ke tabel itu berarti melonggarkan
   kunci yang menjadikannya benar. Sesi cron karena itu cermin `reverse`/`prd`/`breakdown`: id
   `cron-<cronId>`, cwd worktree isolasi `<repoDir>/.worktrees/cron-<cronId>` yang lahir `--detach`
   dari `HEAD`, dan **tanpa `flow`** — tak ada fase, tak ada plan berkotak, tak ada stage yang
   digerakkan. Id deterministik itu **adalah** mekanisme "satu sesi per unit kerja" (ADR-0015):
   `getSession("cron-<id>")` yang hidup adalah satu-satunya bukti yang dibutuhkan, dan bukti itu
   selamat dari restart tanpa satu pun kolom yang bisa basi.

2. **Dua tabel LOCAL-ONLY.** `SchedulerCron` (nama · `expr` · prompt · knob sesi nullable ·
   `enabled` · `nextRunAt`/`lastRunAt`) dan `SchedulerCronRun` (`dueAt` · `startedAt` · `status` ·
   `sessionId` · `note` · `manual`). Keduanya cermin `SchedulerQueueItem`: tak masuk whitelist
   `FIELDS` sync, tanpa kolom `version` — jadwal adalah properti **mesin ini**, karena worktree,
   tmux, dan cap concurrency-nya lokal. `SchedulerCronRun` merangkap **antrean dan riwayat** dalam
   satu tabel (pola `WebhookDelivery`, ADR-0100), dan **`@@unique([cronId, dueAt])`** adalah kunci
   idempotensinya: satu jatuh tempo bisa diklaim paling banyak sekali, apa pun yang terjadi pada
   tick, restart, atau dua tick yang balapan.

   Knob sesi disimpan sebagai **tiga kolom nullable** (`agent`/`model`/`effort`), bukan blok
   `zAgentEngine`: blok itu membawa `enabled` sendiri, dan dua boolean bernama sama dalam satu
   bentuk adalah jebakan. `null` = warisi, diresolusi **`terminalAgentDefaults()`** — fungsi yang
   sama yang dipakai form "Sesi baru" (SPEC-517), sehingga knob cron tak bisa berselisih dengan knob
   sesi manual.

3. **`expr` satu-satunya kebenaran jadwal; preset DITURUNKAN.** Preset UI (setiap hari · hari kerja ·
   mingguan · tiap N jam, plus HH:MM) dipetakan bolak-balik oleh fungsi murni `presetToExpr` /
   `exprToPreset`; apa pun di luar keempat bentuk itu jatuh ke kolom cron expression lanjutan.
   Menyimpan preset sebagai kolom kedua di samping `expr` akan melahirkan drift yang tak punya
   arbiter; menyimpan preset saja menutup kasus lanjutan.

   Parser ditulis sendiri di **`shared/src/cron-expr.ts`**, bukan dependensi baru. Alasannya bukan
   penghematan: preview "jalan berikutnya" dihitung di **browser** sementara jadwal dihitung di
   **server**, dan satu-satunya cara menjamin keduanya sepakat adalah satu modul murni yang
   keduanya impor. Dukungan field `*`, `n`, `a-b`, `a,b,c`, `*/n`, `a-b/n`; aturan Vixie (tanggal
   dan hari-pekan sama-sama dibatasi → di-OR) berlaku.

4. **Materialisasi jatuh tempo di tick yang SUDAH ada, sebelum gerbang Pause.** `sweepCronDue(now)`
   menjadi satu langkah tambahan di `engine.tick` — **tanpa timer kedua**. Ia berjalan sesudah
   `reconcile`/`scanDecisions` dan **sebelum** `if (cfg.paused) return`, karena Pause adalah rem
   PELUNCURAN, bukan penghapus antrean (ADR-0072 keputusan 4): jatuh tempo yang lewat selama jeda
   tetap tercatat, dan melanjutkan jeda dalam grace tetap menjalankannya. Master `enabled=false`
   sudah memulangkan tick lebih dulu, jadi seluruh fitur cron ikut mati di sana.

5. **Jatuh tempo tertunggak jadi SATU baris, tak pernah burst.** Sweep memajukan `nextRunAt` ke jatuh
   tempo **terbaru yang ≤ now** sambil menghitung berapa yang dilompati, lalu membuat **satu** baris
   untuk jatuh tempo terbaru itu. Yang dilompati tak pernah menjadi baris antrean — ia menjadi angka
   di dalam alasan (`terlewat N jatuh tempo — scheduler tak berjalan`). Server mati semalam lalu
   hidup lewat grace → satu baris `skipped`, nol sesi.

6. **`GRACE_MS` (30 menit) menjawab dua pertanyaan dengan satu angka, dan itu disengaja.**
   "Server mati saat jatuh tempo" dan "cap penuh saat jatuh tempo" adalah keterlambatan yang sama
   dari sudut pandang operator: jadwal pukul 07:00 kehilangan maknanya bila berjalan pukul 09:00,
   apa pun sebabnya. Jatuh tempo yang lahir sudah lewat grace langsung `skipped`; baris `queued` yang
   tak terluncurkan sampai grace habis ditutup `skipped` membawa alasan TERAKHIR yang menghalanginya.
   **"Tertunggak" ≠ "terlambat":** jatuh tempo terbaru tetap dinilai dengan grace yang sama seperti
   jatuh tempo biasa — yang dilarang burst-nya, bukan menjalankan yang masih segar.

7. **Cron memakai ANGGARAN SLOT YANG SAMA, dan dibelanjakan lebih dulu.** `drain()` memanggil
   `deps.drainCrons(slots)` sebelum loop antrean spec, lalu melanjutkan dengan sisanya. Cron
   didahulukan karena jatuh temponya punya makna waktu (terlambat = kehilangan makna), sedangkan
   baris antrean spec tak punya tenggat dan tak kehilangan apa pun dengan menunggu satu tick.
   `drainCrons` dipanggil **juga saat `slots <= 0`**, supaya baris yang jatuh tempo mendapat catatan
   "cap penuh" alih-alih menggantung tanpa penjelasan sampai kedaluwarsa. Semua gerbang membaca
   ULANG dari DB tepat sebelum peluncuran (pola `isDone` SPEC-431 / `blockers` SPEC-447).

8. **Cron tetap tunduk `Project.schedulerOptIn`.** ADR-0072 keputusan 5 menyatakan scheduler hanya
   menyentuh project yang di-opt-in, dan sebuah cron yang membuka sesi adalah persis itu. Bahaya
   nyatanya bukan gerbangnya melainkan **kesenyapannya** — ditutup dua arah: alasannya masuk riwayat
   run (`project belum di-opt-in scheduler`), dan panel cron menampilkan lencana peringatan berikut
   tombol opt-in inline saat project-nya belum di-opt-in (pola lencana "antre" SPEC-479).

9. **`/scheduler/crons*` COOKIE_ONLY.** Prefix `scheduler` dipetakan ke `settings` menurut method,
   dan itu benar untuk knob. Sebuah cron **bukan** knob: ia `POST /terminal/sessions` yang ditunda —
   membuat hanoman membuka sesi agen di worktree project, berulang, tanpa manusia di pane.
   Membiarkannya di `settings:write` berarti setiap agent token pemegangnya bisa menjadwalkan sesi
   tanpa batas di project mana pun, persis kelas eskalasi yang ditutup SPEC-405 untuk
   `/update/apply` dan ADR-0097/0100 untuk permukaan kredensial. ADR-0099 sudah menetapkan bahwa MCP
   tak mengekspos tool yang mengeksekusi; cron adalah eksekusi.

10. **"Jalankan sekarang" = baris run manual, bukan spawn langsung.** `POST /scheduler/crons/:id/run`
    membuat baris `dueAt = now`, `manual = true`, dan tick berikutnya (≤10 dtk) yang meluncurkannya
    lewat governor. Itu satu-satunya cara tombol uji coba tetap tunduk cap, Pause, dan master switch
    tanpa menyalin gerbangnya ke route — kelas bug SPEC-431/448/475/481. Karena itu penolakannya
    **eksplisit 409** (scheduler mati · dijeda · sudah ada run menunggu), bukan tombol yang diam.

## Konsekuensi

- **Positif:** batas ADR-0072 terjawab tanpa subsistem kedua — nol timer baru, nol dependensi
  runtime baru, nol broker. Idempotensi bersifat struktural (kunci unik DB + id sesi deterministik),
  bukan disiplin call site. Temuan pemeriksaan rutin masuk antrean kerja sebagai backlog lewat
  `POST /api/specs`, bukan hilang di log sesi.
- **Batas yang dipilih sadar:**
  - Baris run berhenti di `launched`. "Sukses/gagal" yang dimaksud brief adalah hasil **dispatch** —
    contoh alasannya sendiri ("cap penuh") membuktikannya. Nasib sesinya terbaca di Terminal dan
    riwayat sesi (ADR-0079).
  - **Tanpa retry** (cermin `markFailed` governor): gagal ditandai, tidak diulang. Jatuh tempo
    berikutnya adalah percobaan berikutnya.
  - **Tanpa zona waktu per cron.** Jadwal memakai zona waktu lokal server. Kolom tz akan menuntut
    konversi di parser dan UI sekaligus, dan tak ada yang memintanya.
  - Satu cron milik satu project; worktree dan opt-in keduanya per project.
- **Reversibilitas:** aditif murni (satu migration, dua tabel, satu cabang capability, satu langkah
  tick). Menghapus semua baris `SchedulerCron` mengembalikan perilaku ADR-0072 sepenuhnya.

## Gotcha wajib

1. **`PG_ORDER` wajib memuat kedua model.** `cli/test/migrate-pg.test.ts` menuntut himpunannya sama
   persis dengan DMMF — satu-satunya gerbangnya. `SchedulerCron` ditulis SEBELUM `SchedulerCronRun`
   agar urutan tabel mencerminkan arah tautannya (tanpa FK, cermin `SchedulerQueueItem`/`LeadDecision`).
2. **`GovernorDeps.drainCrons` WAJIB, bukan opsional.** Tipe wajib adalah jaminan kompilasi bahwa
   jalurnya tak pernah lupa dipasang — alasan yang sama dengan `blockers` (SPEC-447). Terukur saat
   implementasi: satu literal deps **tanpa anotasi tipe** di `scheduler-engine.test.ts` lolos tsc dan
   gagal sebagai `launches === 0`, karena `deps.drainCrons` yang `undefined` melempar lalu ditelan
   `catch` di `tick`. Field opsional akan mengubah kegagalan itu jadi permanen dan senyap.
3. **`nextRunAt` BUKAN kunci idempotensi — barisnya yang kunci.** `nextRunAt` bisa gagal ditulis
   sementara run-nya sudah lahir (atau sebaliknya); yang menjamin "satu jatuh tempo satu sesi" adalah
   `@@unique([cronId, dueAt])`. Sweep karena itu menulis barisnya dengan `try`/`catch` dan
   memperlakukan P2002 sebagai jalur normal, bukan galat.
4. **`ensureCodexTrust` diturunkan dari agen HASIL `terminalAgentDefaults`, bukan `Setting.agent`.**
   Keduanya bisa berbeda sejak SPEC-517, dan membaca yang salah membuat sesi mentok di layar trust
   codex tanpa manusia di pane (SPEC-377/383).
5. **`sweepCronDue` jalan SEBELUM gerbang `paused`.** Memindahkannya ke bawah membuat Pause
   *menghapus* jatuh tempo alih-alih menahannya — kebalikan dari arti rem darurat.
6. **Sweep memanggil `nextRun` dengan acuan `nextRunAt - 1 ms`.** `nextRun` mencari yang **strictly**
   setelah acuannya; tanpa pengurangan itu jatuh tempo yang persis sama dengan `nextRunAt` terlewat
   diam-diam setiap kali.
7. **Kandidat jadwal dibangun `new Date(y, mo, d, h, mi)` — komponen LOKAL, bukan geseran dari UTC.**
   Itulah yang membuatnya aman DST: jam lokal yang tak ada (lompat maju) dinormalkan JS ke depan dan
   tetap lolos gerbang `> after`, sementara jam ganda (mundur) memberi kemunculan pertama sehingga
   jadwalnya jalan sekali. Invarian yang diuji bukan "jam persisnya" melainkan **`hasil > after`**.
