# ADR-0072 — Fondasi scheduler otonom: engine in-process, antrean durable, cap concurrency

- Status: Accepted — **diamandemen [0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md)**
  (2026-09-05, SPEC-1108): invarian poin 3 berbunyi "sesi hidup tak pernah melebihi cap" tetapi
  penegaknya hanya ada di `governor.drain()`, sedangkan jalur bersama poin 6 (`startSpecSession()`,
  dipakai POST manual & lead) tak pernah memeriksanya — dengan source scheduler mati, cap-nya tak
  menegakkan apa pun. Gerbang pindah ke jalur bersama itu, invarian dinyatakan ulang sebagai **sesi
  agen** (terminal/shell tetap dihitung, tak pernah ditolak), dan ditambah gerbang sumber daya
  berbasis load-per-core. Poin 5 (semua knob di Setting) & poin 6 tetap berlaku apa adanya.
- Tanggal: 2026-07-22
- SPEC: SPEC-294 (backlog fondasi dari breakdown PRD scheduler)
- Terkait: **membalik sebagian [0024](0024-sesi-interaktif-menggantikan-run.md)** (yang mencabut
  cron/worker/antrean durable & `maxConcurrent`), memperluas [0016](0016-sesi-terminal-hidup-di-tmux.md)
  (tmux = sumber kebenaran sesi), [0015](0015-one-session-per-backlog.md) (satu backlog satu sesi),
  [0025](0025-modul-vps-script-deterministik.md) (pola sweep in-process `vps-monitor`),
  [0049](0049-config-runtime-store-registry.md) (knob di Setting), [0045](0045-skema-sync-synclog-version-stamp.md)
  (whitelist FIELDS sync).

## Konteks

Semua pekerjaan hanoman (backlog, perbaikan error, tiket triase) diluncurkan **manual** oleh
operator (`POST /terminal/sessions`). PRD "Scheduler otonom" meminta subsistem yang menjadwalkan &
meluncurkan sendiri pekerjaan yang sudah eligible, dibatasi cap + antrean durable + rem darurat.

ADR-0024 dulu **sengaja mencabut** cron, worker headless, antrean durable (BullMQ/Redis), dan
`maxConcurrent` saat pindah ke sesi interaktif. PRD ini secara sadar **menghidupkan kembali sebagian**
— tetapi **tanpa** broker eksternal: engine tetap in-process, "antrean durable" = tabel DB hanoman
sendiri. Keputusan ini butuh ADR baru (PRD Open Q#2).

Backlog fondasi (SPEC-294) adalah **satu-satunya** pembawa migration & ADR dalam breakdown; lima
daun menggantung aditif pada kontrak yang diterbitkannya.

## Keputusan

1. **Engine in-process, bukan cron/worker.** Satu loop `setInterval` bergaya `vps-monitor.ts`
   (`services/scheduler/engine.ts`), di-`start` **hanya dari `server.ts`** dengan timer `.unref()`;
   `app.ts` tetap **bebas-timer** (test tak pernah menyalakan loop). Per tick: jalankan checker
   source yang `enabled` **dan** jatuh-tempo cadence, lalu **drain** antrean. Tetap **tanpa** cron,
   worker terpisah, webhook, atau message queue eksternal — konsisten semangat ADR-0024 kecuali
   pada tiga hal di bawah.

2. **Antrean durable = tabel DB, bukan broker.** `SchedulerQueueItem` (LOCAL-ONLY, cermin
   `SyncOutbox`/`RuntimeConfig` — tak disync) menahan kandidat peluncuran lintas-restart. Unit
   peluncuran **selalu sebuah `Spec`** (backlog sudah Spec; errors→escalate & triase→accept membuat
   Spec dulu), jadi kolom `specId @unique` sekaligus **kunci idempotensi satu-sesi-per-spec**
   (ADR-0015). Antrean **tak menduplikasi** `Spec.stage` / overlay sesi live: status live
   (running/done/failed) tetap diturunkan dari `pty.listSessions()` + `Spec.stage` + `Notification`.
   `status` antrean hanya `queued|launched|done|failed` (operasional).

3. **Cap concurrency = penerus `maxConcurrent`, dihitung dari tmux.** Governor menghitung sesi
   hidup **gabungan manual + scheduler** dari `pty.listSessions()` (bukan registry DB — tmux tetap
   satu-satunya sumber kebenaran, ADR-0016), lalu meluncurkan hanya selagi `live < cap`. **Invarian:
   sesi hidup tak pernah melebihi cap.** Drain terjadi saat slot kosong dalam **≤1 tick** dan —
   karena tick memoll `listSessions()` — segera setelah sesi mana pun berakhir, tanpa hook ke PTY
   (sesi scheduler bisa tak berpenonton, jadi poll-based lebih andal daripada callback attach).

4. **Rem darurat Pause.** Master switch `Setting.scheduler.paused`: saat aktif, tick **melewati
   drain** → tak ada peluncuran baru dalam ≤1 tick, item tetap di antrean. Master `enabled=false`
   membuat seluruh tick idle.

5. **Semua knob di Setting, default MATI.** `zSetting.scheduler` (enable+cadence per source, cap,
   autonomy, ambang errors) ditambah sebagai `.default(SCHEDULER_DEFAULTS)` → baris lama tetap
   parse. Opt-in per project = `Project.schedulerOptIn Boolean @default(false)` (pola `helpEnabled`),
   **tak** masuk whitelist `FIELDS` sync → tetap lokal per-instance (PRD Open Q#10). **Default aman:
   scheduler & semua source mati, tak ada project opt-in** sampai operator menyalakannya.

6. **Kontrak untuk daun.** Fondasi menerbitkan `registerSchedulerSource({id, check})`,
   `enqueue({specId,projectId,source,priority})`, dan marker "asal-scheduler"
   (`schedulerItemForSession`/`queueItemForSpec`) + endpoint `GET/PUT /api/scheduler/config` &
   `GET /api/scheduler/state`. Jalur peluncuran diseragamkan lewat `startSpecSession()` (diekstrak
   dari `routes/terminal.ts`) — dipakai POST manual & governor; governor menurunkan `flow`
   server-side via `flowForSource(spec.source)`.

## Konsekuensi

- **Positif:** subsistem otonom lahir tanpa dependensi runtime baru (nol Redis/BullMQ); antrean
  selamat dari restart; cap mencegah runaway usage; Pause instan; default mati = tak ada perubahan
  perilaku sampai operator opt-in; lima daun bisa fan-out paralel di atas kontrak stabil.
- **Negatif / batas:** cadence hanya interval menit (HH:MM harian ditunda); cap menghitung **semua**
  sesi hidup termasuk shell terminal (konservatif — bisa dipersempit ke sesi ber-flow kelak);
  `lastRun` cadence in-memory (reset saat restart → satu boot-pass, cermin `vps-monitor`); antrean
  bisa stall bila banyak sesi menahan slot menunggu keputusan (perilaku benar — perhatian manusia =
  bottleneck; indikator diserahkan panel daun #6).
- **Reversibilitas:** murni aditif (satu migration, satu tabel + satu kolom, blok Setting opsional).
  Mematikan `enabled` mengembalikan perilaku ADR-0024 sepenuhnya.
