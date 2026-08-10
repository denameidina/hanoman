# SPEC-646 — Cronjob per project di scheduler

**Tanggal:** 2026-08-11 · **Sumber:** brief · **Prioritas:** tinggi
**ADR baru:** 0112 (nomor diverifikasi ulang tepat sebelum push)

## Objective

Tiap project punya daftar cronjob-nya sendiri di panel scheduler. Satu cron menyimpan nama, jadwal,
prompt bebas, knob sesi (runtime/model/effort seperti sesi manual), dan status aktif/nonaktif. Saat
jatuh tempo, engine scheduler membuka sesi agen di worktree project itu dengan prompt tersebut —
tunduk pada cap concurrency, antrean, dan rem darurat Pause yang sudah ada. Tiap eksekusi tercatat
sebagai riwayat run dan memunculkan notifikasi.

## Konteks

Scheduler hari ini (ADR-0072, SPEC-294/295/297/298/299) berbentuk **checker berbasis cadence**:
`sources.backlog` & `sources.triase` berjalan tiap N menit, memindai baris `Spec`, lalu
meng-`enqueue` ke `SchedulerQueueItem`. ADR-0072 secara eksplisit menunda jadwal jam tertentu
("Konsekuensi: cadence hanya interval menit, HH:MM harian ditunda").

Dua hal karena itu tak punya tempat sama sekali hari ini:

1. **Jadwal jam tertentu** — "cek error produksi tiap pagi 07:00", "audit docs tiap Senin 09:00".
2. **Pekerjaan yang bukan sebuah `Spec`** — checker rutin tak punya backlog item; justru
   keluarannya-lah yang mungkin melahirkan backlog item.

Yang ADR-0072 sudah sediakan dan **wajib dipakai ulang**, bukan diduplikasi: satu loop `setInterval`
yang di-start hanya dari `server.ts`, governor ber-cap yang menghitung sesi hidup dari
`pty.listSessions()`, rem darurat `Setting.scheduler.paused`, dan master switch
`Setting.scheduler.enabled`.

## Bentuk keputusan

### 1. Unit peluncuran: sesi project-level ber-id deterministik, bukan `Spec`

`SchedulerQueueItem.specId` adalah kolom **NOT NULL @unique** dan sekaligus kunci idempotensi
"satu sesi per spec" (ADR-0072 keputusan 2). Cron tak punya `Spec` — memaksakannya ke tabel itu
berarti melonggarkan kunci yang justru menjadikannya benar.

Sesi cron karena itu adalah **sesi project-level**, cermin `reverse`/`prd`/`breakdown`:

- id sesi **deterministik**: `cron-<cronId>` (huruf kecil, non-`[a-z0-9_-]` → `_`)
- cwd: worktree isolasi `<repoDir>/.worktrees/cron-<cronId>`, lahir `--detach` dari `HEAD`
- **tanpa `flow`** → tanpa phase file, tanpa stage machine, tanpa plan berkotak. Sesi cron tak
  menggerakkan backlog item mana pun; kalau ia menemukan masalah, ia membuat backlog baru lewat
  `POST /api/specs` seperti agen lain.

Id deterministik itu **satu-satunya** mekanisme "satu sesi per unit kerja" yang dibutuhkan:
`getSession("cron-<id>")` yang hidup = jatuh tempo berikutnya dilewati dengan alasan tercatat.
Tak ada penghitung, tak ada `Set` memori, tak ada kolom "sedang jalan" yang bisa basi setelah crash.

### 2. Skema: dua tabel LOCAL-ONLY

```prisma
model SchedulerCron {
  id        String    @id @default(cuid())
  projectId String
  name      String
  expr      String                       // cron 5-field, zona waktu LOKAL SERVER
  prompt    String
  agent     String?                      // null = warisi default sesi
  model     String?
  effort    String?
  enabled   Boolean   @default(false)    // default aman: cron baru lahir nonaktif
  nextRunAt DateTime?                    // jadwal berikutnya, durable
  lastRunAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@index([projectId])
  @@index([enabled])
}

model SchedulerCronRun {
  id        String    @id @default(cuid())
  cronId    String
  projectId String
  dueAt     DateTime                     // jatuh tempo yang diklaim baris ini
  startedAt DateTime?                    // saat sesinya benar-benar dibuka
  status    String    @default("queued") // queued | launched | skipped | failed
  sessionId String?
  note      String?                      // alasan skipped/failed
  manual    Boolean   @default(false)    // dari tombol "Jalankan sekarang"
  createdAt DateTime  @default(now())

  @@unique([cronId, dueAt])
  @@index([cronId, dueAt])
  @@index([status])
}
```

Keduanya **LOCAL-ONLY**, cermin `SchedulerQueueItem`/`RuntimeConfig`: tak masuk whitelist `FIELDS`
di `services/sync.ts` (union `Entity` eksplisit, jadi tak ada perubahan di sana), tanpa kolom
`version`. Jadwal itu properti **mesin ini** — worktree, tmux, dan cap concurrency-nya lokal.

`@@unique([cronId, dueAt])` adalah kunci idempotensi: satu jatuh tempo bisa diklaim **paling banyak
sekali**, apa pun yang terjadi pada tick, restart, atau dua tick yang balapan. Insert kedua kena
P2002 dan diabaikan.

**`agent`/`model`/`effort` nullable, bukan blok `zAgentEngine`.** `zAgentEngine` (SPEC-492) membawa
`enabled` sebagai gerbang *blok* — di sini gerbangnya sudah ada per baris (`SchedulerCron.enabled`),
dan dua boolean bernama `enabled` di satu bentuk adalah jebakan. Nullable = "warisi", diresolusi
`terminalAgentDefaults({agent, model, effort})` — **fungsi yang sama** yang dipakai form "Sesi baru"
(SPEC-517), sehingga knob cron tak bisa berselisih dengan knob sesi manual.

### 3. Jadwal: `expr` satu-satunya kebenaran, preset diturunkan

Kolom yang disimpan hanya **`expr`** (cron 5-field). Preset UI (setiap hari / hari kerja / mingguan /
tiap N jam + HH:MM) diturunkan bolak-balik oleh fungsi **murni** di
`shared/src/cron-expr.ts`:

| Preset | expr |
|---|---|
| setiap hari, `HH:MM` | `M H * * *` |
| hari kerja, `HH:MM` | `M H * * 1-5` |
| mingguan (hari D), `HH:MM` | `M H * * D` |
| tiap N jam, menit M | `M */N * * *` |

`exprToPreset(expr)` mengenali keempat bentuk itu **persis**; apa pun yang lain → `null`, dan form
jatuh ke kolom cron expression lanjutan. Menyimpan preset **dan** expr sebagai dua kolom akan
melahirkan drift yang tak punya arbiter; menyimpan preset saja menutup kasus lanjutan yang diminta
brief.

**Parser ditulis sendiri, bukan dependensi baru.** Alasannya bukan penghematan: preview "jalan
berikutnya" harus dihitung di **browser** sementara jadwal dihitung di **server**, dan satu-satunya
cara menjamin keduanya sepakat adalah satu modul murni di `@hanoman/shared` yang keduanya impor.
Dukungan field: `*`, `n`, `a-b`, `a,b,c`, `*/n`, `a-b/n` untuk menit/jam/tanggal/bulan/hari-pekan.
Aturan Vixie: bila **tanggal dan hari-pekan** sama-sama dibatasi, keduanya di-OR.

`nextRun(spec, after)` beriterasi **hari** (≤ 366) lalu jam×menit di hari yang cocok, membangun
`new Date(y, mo, d, h, mi)` — waktu **lokal**, bukan UTC. Invarian yang diuji: hasilnya selalu
`> after`. Itu yang membuatnya aman DST: lompat maju menormalkan jam yang tak ada ke depan (tetap
`> after`, jadi tetap maju), dan jam ganda saat mundur dipilih yang pertama (satu kali jalan).
Membangun tanggal dari komponen UTC lalu menggesernya justru yang akan salah dua kali setahun.

### 4. Eksekusi: satu materialisasi, satu drain, di tick yang sudah ada

Tick `services/scheduler/engine.ts` bertambah **satu langkah**, dan tak ada timer kedua:

```
tick(now):
  cfg = getScheduler()
  if !cfg.enabled: return                     ← seluruh fitur cron ikut mati
  jalankan checker source yang jatuh tempo
  reconcile() + scanDecisions()
  sweepCronDue(now)                           ← BARU: materialisasi jatuh tempo + kedaluwarsa
  if cfg.paused: return                       ← rem darurat, tak ada peluncuran baru
  drain(cfg, deps)                            ← drain cron LALU antrean spec, satu anggaran slot
```

**`sweepCronDue(now)` berjalan sebelum gerbang `paused`, dan itu disengaja.** Pause adalah rem
peluncuran, bukan penghapus antrean (ADR-0072 keputusan 4): jatuh tempo yang lewat selama jeda tetap
tercatat, dan melanjutkan jeda dalam grace tetap menjalankannya. Yang tak berjalan hanyalah
`drain`.

`sweepCronDue` untuk tiap cron `enabled` ber-`nextRunAt <= now`:

1. Majukan `nextRunAt` ke jatuh tempo **terbaru yang ≤ now**, hitung berapa yang dilompati.
2. Buat **satu** baris `SchedulerCronRun` untuk jatuh tempo terbaru itu (P2002 → sudah ada, lewati).
3. Bila `now - dueAt > GRACE_MS` → langsung `skipped` ber-alasan; kalau tidak → `queued`.
4. Setel `nextRunAt` = `nextRun(expr, now)`.

Inilah jawaban "jangan menembak burst run tertunggak setelah restart": jatuh tempo yang dilompati
**tak pernah menjadi baris antrean**, ia menjadi angka di dalam alasan satu baris `skipped`
("terlewat 17 jatuh tempo — scheduler tak berjalan"). Server mati semalam lalu hidup pukul 10:00 →
satu baris `skipped`, nol sesi.

Baris `queued` yang **belum** terluncurkan sampai grace habis juga jadi `skipped` di sweep
berikutnya, membawa alasan terakhir yang menghalanginya (mis. "cap penuh"). Itu yang membuat "cap
penuh" jadi hasil yang tercatat alih-alih baris yang menggantung selamanya: jatuh tempo pukul 07:00
tak boleh diam-diam berjalan pukul 15:00.

### 5. Drain: cron lebih dulu, satu anggaran slot, gerbang yang sama

`governor.drain()` sekarang membelanjakan `slots = maxConcurrent - liveCount()` untuk **dua**
konsumen. Cron didahulukan karena jatuh temponya punya makna waktu (terlambat = kehilangan makna),
sedangkan baris antrean spec tak punya tenggat dan tak kehilangan apa pun dengan menunggu satu tick.
Jumlah cron dibatasi operator dan kecil; ia tak bisa melaparkan antrean secara struktural.

Urutan gerbang per baris `queued` (semuanya membaca ulang dari DB tepat sebelum peluncuran, pola
`isDone`/`blockers` SPEC-431/447):

| Gerbang | Bila gagal |
|---|---|
| cron masih ada & `enabled` | `skipped` — "cron dinonaktifkan/dihapus" |
| `Project.schedulerOptIn` | `skipped` — "project belum di-opt-in scheduler" |
| sesi `cron-<id>` masih hidup | `skipped` — "sesi cron sebelumnya masih berjalan" |
| slot tersedia | tetap `queued`, note "cap penuh" (kedaluwarsa lewat grace) |
| `startCronSession` sukses | `failed` + pesan galat (mis. project belum di-bind) |

Sukses → `launched` + `sessionId` + `startedAt`, `slots--`, `SchedulerCron.lastRunAt = now`.

Cron **tunduk `Project.schedulerOptIn`.** ADR-0072 menyatakan "scheduler hanya menyentuh project
yang di-opt-in", dan sebuah cron yang membuka sesi adalah persis scheduler menyentuh project itu.
Bahaya nyatanya bukan gerbangnya melainkan **kesenyapannya** — itu ditutup dua arah: alasan masuk
riwayat run, dan panel cron menampilkan lencana peringatan + tombol opt-in inline saat project-nya
belum di-opt-in.

### 6. Peluncuran: `startCronSession`, sejajar `startSpecSession`

`server/src/services/scheduler/cron-session.ts` memegang satu fungsi, cermin `session-launch.ts`:

```
startCronSession(cron) → { id }
  repoDir = resolveRepoDir(cron.projectId)        // null → lempar (governor → failed)
  { agent, model, effort } = terminalAgentDefaults(cron)
  if agent === "codex": ensureCodexTrust(repoDir) // dari agen HASIL resolusi (SPEC-377/383)
  worktree = <repoDir>/.worktrees/cron-<id>, dipakai ulang bila masih sah (SPEC-394)
  createSession(projectId, worktree, { id, agent, model, effort, prompt: cronPrompt(...) })
```

`cronPrompt(project, cron)` di `runner/src/prompt.ts` merangkai: konteks project · **instruksi
operator apa adanya** · catatan bahwa temuan dilaporkan sebagai backlog lewat `POST /api/specs` ·
`CODE_STYLE_CLAUSE` (klausanya menggerbangi dirinya sendiri di baris pertama — ADR-0108 — jadi ia
aman di prompt yang mungkin tak menulis kode) · catatan worktree detached. Instruksi operator tak
pernah diparafrase.

### 7. REST

Semua di bawah `/api/scheduler/crons`, sehingga **capability-nya turunan peta yang sudah ada** —
kecuali satu baris baru yang justru penting:

```
GET    /api/scheduler/crons?projectId=&page=&limit=   → Paginated<SchedulerCronView>
POST   /api/scheduler/crons                           → 201 cron
PATCH  /api/scheduler/crons/:id                       → cron (partial)
DELETE /api/scheduler/crons/:id                       → 204
POST   /api/scheduler/crons/:id/run                   → 201 SchedulerCronRunView (manual)
GET    /api/scheduler/crons/:id/runs?page=&limit=     → Paginated<SchedulerCronRunView>
```

**`capabilityForRoute` mendapat cabang `seg[1] === "crons"` → `COOKIE_ONLY`.** Prefix `scheduler`
hari ini dipetakan ke `settings` menurut method, dan itu benar untuk knob. Sebuah cron **bukan**
knob: ia adalah `POST /terminal/sessions` yang ditunda. Membiarkannya di `settings:write` berarti
setiap agent token pemegang `settings:write` bisa menjadwalkan sesi agen tanpa batas di project mana
pun — persis kelas eskalasi yang ditutup SPEC-405 untuk `/update/apply` dan ADR-0097/0100 untuk
kredensial Telegram/webhook. ADR-0099 sudah menetapkan bahwa MCP **tak** mengekspos tool yang
mengeksekusi; cron adalah eksekusi.

`POST /:id/run` **tidak** melahirkan sesi langsung. Ia membuat baris run `manual: true` ber-`dueAt =
now`, dan tick berikutnya (≤10 dtk) yang meluncurkannya lewat governor. Itu satu-satunya cara
"jalankan sekarang" tetap tunduk cap, Pause, dan master switch tanpa menyalin gerbangnya (kelas bug
SPEC-431/448/475/481). Karena itu endpoint ini menolak dengan **409** saat scheduler mati/dijeda
atau saat cron itu sudah punya run `queued` — penolakan eksplisit, bukan tombol yang diam.

Validasi `POST`/`PATCH` di `zCreateCron`/`zPatchCron` (`@hanoman/shared`): `expr` wajib lolos
`parseCron` (400 dengan pesan), `prompt` wajib tak kosong, `projectId` wajib ada.

### 8. Notifikasi

Tiap baris run yang mencapai keadaan terminal menerbitkan satu notifikasi ber-`type: "cron"` dan
`key: cron:<cronId>:<dueAt ISO>` — kunci yang **stabil lintas restart**, jadi tick berulang tak bisa
menduplikasinya (P2002 diabaikan, pola `recordCompletion`). Termasuk `skipped`: justru itulah yang
paling perlu dibaca operator ("cek pagi tak jalan karena cap penuh").

### 9. UI

Panel baru `src/src/screens/SchedulerCrons.tsx`, dipasang di `SchedulerScreen` — **tanpa entri
`HN_NAV` baru**, jadi jebakan "key nav tanpa cabang `App.tsx`" (SPEC-519) tak tersentuh.

- Pemilih project di kepala panel; daftar cron per project: nama, deskripsi jadwal
  (`describeCron`), lencana aktif/nonaktif, run terakhir, run berikutnya.
- Form tambah/ubah (modal): nama · preset jadwal + `HH:MM` (atau hari pekan / tiap N jam) ·
  toggle "cron expression lanjutan" · prompt · runtime/model/effort (katalog dari
  `session-runtime.ts`, sumber yang sama dengan picker Start) · aktif/nonaktif. Preview **"jalan
  berikutnya"** dihitung langsung dari `nextRun` sembari mengetik, dirender di zona waktu lokal.
- Tombol "Jalankan sekarang" per baris; daftar riwayat run berhalaman (`Pager` + `serverPage`,
  ADR-0107) dengan waktu jatuh tempo, waktu mulai, sesi, hasil, alasan.
- Lencana peringatan + tombol opt-in inline bila `!project.schedulerOptIn`.

`nextRunAt` yang ditampilkan di **daftar** datang dari server (instan otoritatif, dirender di zona
lokal browser); preview di **form** dihitung lokal karena ia menggambarkan expr yang belum tersimpan.
Keduanya memakai modul murni yang sama.

## Yang sengaja TIDAK dikerjakan

- **Rekonsiliasi hasil sesi cron.** Baris run berhenti di `launched`; nasib sesinya terbaca di
  Terminal & riwayat sesi (ADR-0079). "sukses/gagal" di brief adalah hasil **dispatch** — itu yang
  dibuktikan oleh contoh alasannya sendiri ("cap penuh").
- **Retry.** Cermin `markFailed` governor hari ini: gagal ditandai, tidak diulang. Jatuh tempo
  berikutnya adalah percobaan berikutnya.
- **Cron lintas project dalam satu baris.** Satu cron milik satu project; worktree dan opt-in
  keduanya per project.
- **Zona waktu per cron.** Brief menyebut "zona waktu lokal server". Kolom tz akan menuntut
  konversi di parser dan di UI sekaligus, dan tak ada yang memintanya.

## Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Parser cron sendiri salah di kasus pinggir | Modul murni + test tabel (preset round-trip, `*/n`, rentang, OR dom/dow, batas bulan, monotonisitas `> after`) |
| Cron menyumbat cap dan melaparkan antrean backlog | Satu anggaran slot bersama; baris `queued` kedaluwarsa lewat grace alih-alih menahan tempat |
| Sesi cron menumpuk | Id sesi deterministik = satu sesi per cron secara struktural |
| Worktree cron menumpuk di disk | `DELETE /terminal/sessions/:id` menghapusnya lewat `ownsWorktree` (SPEC-362), sama seperti reverse/prd |
| Operator menyalakan cron di project yang belum opt-in | Alasan tercatat di riwayat + lencana & tombol opt-in di panel |

## Test yang wajib ada

**shared** — `cron-expr.test.ts`: parse valid/invalid, `nextRun` untuk keempat preset, `*/n`,
rentang & daftar, OR dom↔dow, akhir bulan, monotonisitas, `presetToExpr`/`exprToPreset` round-trip,
`describeCron`.

**server**
- `scheduler-cron-sweep.test.ts` — materialisasi satu jatuh tempo; tick berulang tak menduplikasi;
  jatuh tempo tertunggak jadi **satu** `skipped` bukan burst; `queued` kedaluwarsa lewat grace;
  sweep tetap jalan saat `paused`, tak jalan saat `enabled=false`.
- `scheduler-cron-drain.test.ts` — cron menghabiskan slot lebih dulu; cap penuh → tetap `queued`
  ber-note; sesi cron hidup → `skipped`; project tanpa opt-in → `skipped`; cron nonaktif →
  `skipped`; launch melempar → `failed`.
- `scheduler-cron.route.test.ts` — CRUD, validasi `expr`, run-now membuat baris manual, 409 saat
  scheduler mati/dijeda dan saat sudah ada run `queued`, amplop paginasi riwayat.
- `scheduler-cron-capability.test.ts` — `capabilityForRoute` menjawab `COOKIE_ONLY` untuk seluruh
  `/scheduler/crons*` di semua method, sementara `/scheduler/config` tetap `settings:*`.

**web** — `SchedulerCrons.test.tsx`: render daftar, preview "jalan berikutnya", preset ↔ expr di
form, lencana project belum opt-in, paginasi riwayat run.

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0112-cronjob-per-project-scheduler.md` (baru)
- `internal/docs/README.md` — tautan ADR 0112
- `internal/docs/adr/README.md` — narasi ADR 0112
- `internal/docs/architecture/api-contract.md` — enam endpoint baru
- `internal/docs/architecture/data-model.md` — `SchedulerCron` + `SchedulerCronRun`
