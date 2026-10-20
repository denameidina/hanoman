# Lead sebagai sesi interaktif + gerbang server — desain

Tanggal: 2026-10-20 · Status: disetujui (brainstorming) · Berikutnya: implementation plan (satu SPEC, fase berurutan)

## Tujuan

Menjadikan hanoman-lead pemimpin yang **memeriksa dulu sebelum memutuskan**, **mengelola resource**,
**mengambil backlog dengan aturan**, **memutuskan nasib setiap sesi yang selesai (termasuk merge)**,
dan **hidup sebagai sesi yang bisa dilihat serta di-steer manusia**.

## Masalah (bukti 2026-10-20)

| Keluhan | Akar di kode | Bukti |
|---|---|---|
| Memutuskan tanpa cek | Lead = panggilan sekali-jalan `codex exec`/`claude -p` (`server/src/services/lead/brain.ts:42-60`). "Kumpulkan bukti" hanya kalimat prompt (`prompt.ts:55-56`); dilarang menjawab "tidak tahu" (`prompt.ts:57-59`). Server hanya memverifikasi syarat `integrate-main` dan keberadaan berkas rujukan (`verdict.ts:51`). | Lead memilih sendiri "bootstrap director sementara" di staging (SPEC-1450, 06:07). |
| Tak mengelola resource | Tak ada pembacaan kuota Claude/Codex/Antigravity maupun beban host di `services/lead/`. `maxConcurrent: 2` hanya membatasi proses brain, bukan sesi kerja. Gerbang ADR-0161 tak dipakai lead. | 06:56 lead mengurutkan 7 backlog crm-tumbuh-ai → 7 diluncurkan dalam 30 dtk → 7 gagal "berakhir sebelum done (gagal/limit)". |
| Ambil backlog seenaknya | `orderReadyWork` (`pulse.ts:379-421`) mengambil semua yang tak terblokir; LLM hanya menulis urutan, lalu semuanya di-enqueue. | Idem. |
| Tak memutuskan merge | `integrate-main` (`apply.ts:130-174`) hanya ditawarkan pada plan-bersih + pane hidup; sesi gagal/berhenti tak pernah sampai ke keputusan. Tanpa review/rebase; bila jalan, tanpa persetujuan manusia; syarat hijau bisa dimatikan (`apply.ts:155-157`). | — |
| Tak ada sesi lead | Lead tanpa pane (`brain.ts:14-21`); hanya baris jejak + notifikasi. State `deciding`/`queued`/`lastReadySig` in-memory, hilang saat restart. | — |

## Keputusan yang sudah diambil

| Topik | Keputusan |
|---|---|
| Bentuk | Lead = **sesi interaktif di tmux** + **gerbang deterministik di server** yang tak bisa dilewati lead. |
| Granularitas | **Satu sesi per proyek**: `lead-<proyek>`, cwd = repo proyek. |
| Wewenang | **Mode per tindakan per proyek**: `auto` / `ask` / `off`. Default: answer=auto, start-session=auto, integrate=ask, stop/resume=auto. |
| Ambil backlog | **Server menentukan jatah, lead memilih isinya** — wajib alasan + bukti per backlog. |
| Jalur lama | **Semua pemicu menjadi event di inbox DB** sesi lead; brain sekali-panggil dicabut di SPEC yang sama. Lead mati/pause → pertanyaan jatuh ke manusia (ADR-0167). |
| Pengantaran | **Pendekatan A**: server menyuntik event ke pane saat lead diam; lead bertindak lewat `hanoman_lead_act` yang digerbangi; sesi dirotasi. |
| Keputusan bersamaan | Batch + prioritas kelas + investigasi paralel via subagent + tenggat per event → manusia. Lead-pembantu kedua = YAGNI (dicatat sebagai jalan keluar). |

## Koreksi pasca-penelusuran kode (2026-10-20, sebelum plan)

Penelusuran sambungan untuk plan menemukan lima hal yang mengubah detail (bukan arah) desain:

1. **Seam otak = `DecideDeps.think`.** `decide()` (`server/src/services/lead/decide.ts`) sudah
   choke point tunggal ketiga pintu (kontrak, deteksi, denyut). Sesi lead MENGGANTIKAN `think`
   (`thinkViaSession`): prompt yang sama (`leadPrompt`) ditulis ke `LeadEvent`, lead menjawab dengan
   bentuk `zLeadVerdict`, dan seluruh mesin rantai dialog / jejak / notifikasi / `applyAction` tetap
   dipakai apa adanya. `runGated` + `LeadBusyError` + knob `maxConcurrent`/`queueWaitSec` dicabut.
2. **Lead bertindak lewat HTTP ber-token sesi, bukan MCP operator.** Sesi tak otomatis punya MCP
   hanoman. Setiap pane sudah membawa `HANOMAN_SESSION_ID` + `HANOMAN_EVENT_TOKEN` (HMAC per sesi,
   ADR-0146). Lead memakai `/api/lead-pane/brief` (situasi: jatah, sesi hidup, limit, backlog siap,
   inbox) dan `/api/lead-pane/act`, diautentikasi HMAC persis seperti `/api/session-events` —
   bypass di `app.ts`, peta capability `COOKIE_ONLY` (peniruan identitas sesi bukan capability).
   Tool MCP `hanoman_lead_act` dari §3 **tidak dibuat**; tool MCP untuk manusia/agen tetap
   (inbox, approvals, decide, session start/stop/rotate).
3. **Nama berkas gerbang = `guard.ts`.** `lead/gate.ts` sudah ada (gerbang konkurensi brain) dan
   dihapus bersama brain.
4. **Tak ada `baseBranch`/perintah test di `Project`.** Ditambahkan sebagai setelan lead **per
   proyek** di `Setting.lead.projects[<id>]`: `targetBranch` (default `main`) dan `verifyCommand`
   (default kosong). `verifyCommand` kosong → `integrate` SELALU `butuh-izin` dengan laporan gerbang
   "tak ada perintah verifikasi" (tak pernah auto tanpa bukti test).
5. **Realtime memakai topik `lead` yang sudah ada** (`events-topics.ts`), bukan grup baru:
   `LeadStatusView` diperluas dengan `inbox`, `approvals`, `sessions`. Telegram belum punya tombol
   keputusan (hanya `tgcf:` konfirmasi destruktif di `gateway.ts`) → ditambah callback
   `tgla:<approvalId>:approve|deny`.

Jenis sesi baru `lead` (`SESSION_KINDS`, `sessionKind()`), `launchClass: "terminal"` supaya tak
memakan slot backlog; worktree baca `<repo>/.worktrees/lead-<proyek>` di HEAD target (CLAUDE.md:
tak ada run di working tree utama), di-refresh tiap rotasi.

## 1. Arsitektur

```
 pemicu ──► LeadEvent (DB, inbox per proyek)
  • hook ask dari sesi pekerja        │
  • sesi pekerja selesai / gagal      ▼
  • denyut (hanya bila jatah ≥ 1)   courier (server)
  • permintaan manusia              ── pane lead-<proyek> diam & tak diambil alih?
  • approval ditolak/kedaluwarsa       └► suntik BATCH event (ringkas + eventId)
                                               │
 tmux: lead-<proyek> (claude/codex, cwd = repo) ◄── manusia attach / steer
   cek dulu via MCP: status, limits, queue, spec/plan, diff, git log
   (subagent paralel untuk beberapa pertanyaan independen)
   lalu ► hanoman_lead_act {eventId, action, target, reason, evidence[]}
                                               │
                                     gerbang (server, deterministik)
                         ┌──── ditolak + alasan terstruktur → balik ke lead
                         ├──── butuh-izin → LeadApproval → UI + Telegram + pane
                         └──── lolos / disetujui → eksekutor yang ada
                               (scheduler enqueue, integrate, answer, stop, resume)
```

### Unit baru (`server/src/services/lead/`)

- **`inbox.ts`** — tulis/klaim/tutup `LeadEvent`. Urutan dalam batch per prioritas kelas:
  1. pertanyaan dari sesi pekerja yang sedang **tertahan**
  2. sesi selesai/gagal
  3. permintaan manusia / approval ditolak
  4. denyut

  Denyut tak pernah menahan jawaban pertanyaan. Event `delivered` yang tak dijawab dalam
  `deliverTimeoutSec` dikembalikan ke `open`.
- **`courier.ts`** — memantau pane lead. Suntik batch saat lead diam (sinyal hook Stop) dan pane tak
  `takenOver`. Event yang masuk selama lead bekerja ikut batch berikutnya.
- **`lead-session.ts`** — buka/rotasi/tutup `lead-<proyek>` mengikuti pola `startCronSession`
  (`scheduler/cron-session.ts`); **tidak memakan slot backlog**. Rotasi setelah `rotateAfterEvents`
  event atau saat konteks penuh; sesi baru dibuka dengan ringkasan keputusan terakhir dari DB.
- **`gate.ts`** (tulis ulang) — seluruh aturan objektif per tindakan (§2).
- **`budget.ts`** — `launchBudget(project)` (§2).
- **`authority.ts`** — mode per tindakan per proyek.

### Dicabut / dipakai ulang

- Dicabut: `brain.ts`, pemanggilan LLM di `decide.ts`, state in-memory
  `deciding`, `lastReadySig`.
- Dipakai ulang: `LeadDecision`/`LeadFlow` (ditulis oleh `hanoman_lead_act`), `applyAction` dan
  eksekutornya, gerbang host ADR-0161/0170, `limits.ts`/`codex-limits.ts`/`antigravity-limits.ts`,
  `session_steer`, notifikasi keputusan Telegram (0.9.31), pause per proyek.

### Keputusan bersamaan

- Satu `eventId` per event; satu `hanoman_lead_act` per event. Jawaban pertama langsung sampai ke
  sesi pekerja tanpa menunggu batch selesai.
- Prompt sistem lead menyuruh memakai subagent (runtime claude: tool Agent) untuk mengumpulkan bukti
  beberapa pertanyaan independen secara paralel; keputusan tetap ditulis lead sendiri.
- Tiap pertanyaan pekerja punya tenggat `answerSlaSec` (default 300). Lewat tenggat → jalur ADR-0167
  (manusia via Telegram + UI), event `late`; jawaban lead yang datang belakangan ditolak gerbang
  (`event-closed`). Tak ada jawaban ganda.
- Satu lead per proyek melihat pertanyaan yang berbenturan dalam satu batch (mis. dua sesi yang
  sama-sama mau menimpa build staging — SPEC-1450 vs SPEC-1454).

## 2. Gerbang

Urutan pemeriksaan tiap `hanoman_lead_act`:

1. Event masih terbuka dan belum diambil manusia → bila tidak, `ditolak: event-closed`.
2. Mode wewenang tindakan: `off` → ditolak; `ask` → `butuh-izin` (setelah aturan objektif lolos);
   `auto` → lanjut.
3. Aturan objektif tindakan.

Hasil: `lolos` (dieksekusi), `butuh-izin` (membuat `LeadApproval`), atau `ditolak` + alasan
terstruktur `{code, detail}` yang dibaca lead.

### Jatah peluncuran — `launchBudget(project)`

`min` dari:

- **Slot scheduler**: `maxConcurrent − liveAgentCount`.
- **Host** ADR-0161/0170: beban per core + memori; ditolak = 0.
- **Kuota engine** yang akan dipakai sesi (dari service limits): jendela terpakai ≥ `quotaStopPct`
  (default 85) → 0. **Data limit tak terbaca → 0** (gagal aman).
- **Ramp**: paling banyak `rampStep` (default 1) sesi baru dari lead yang belum melewati
  `rampProbeMin` (default 10) menit tanpa gagal.
- **Pemutus beruntun**: `failStreak` (default 2) kegagalan sesi beruntun di satu proyek → 0 + pause
  proyek otomatis + notifikasi.

Jatah disuntikkan ke setiap event denyut agar lead tahu batasnya sejak awal.

### Per tindakan

| Tindakan | Ditolak bila | Catatan |
|---|---|---|
| `start-session` (ambil backlog) | jatah 0; spec belum `ready` atau tanpa plan/AC; blocker dependensi (ADR-0093); sesi sudah ada; `reason` kosong; `evidence[]` tak merujuk spec/plan | Denyut hanya dikirim bila jatah ≥ 1 **dan** ada backlog siap. Lead tak lagi diminta mengurutkan seluruh daftar. |
| `answer-session` | sesi sudah tak menunggu; tenggat lewat / sudah ke manusia | Opsi yang menyentuh **daftar sensitif** (`LEAD_FORBIDDEN` + kata kunci: produksi, kredensial, akun, hapus data, migrasi produksi, deploy) dipaksa `butuh-izin`. |
| `integrate` (merge) | plan masih ada `- [ ]`; worktree kotor; konflik terhadap `project.baseBranch` (bukan `main` terpatok); **test yang dijalankan ulang server** merah; integrasi lain sedang berjalan di proyek yang sama | Default mode `ask`. `requireGreenBeforeIntegrate` tak bisa dimatikan untuk jalur lead. |
| `resume-session` / `stop-session` | sesi tak ada / sudah dalam keadaan target | — |
| `request-review` | sesi tak selesai | Membuka review atas branch sesi lewat jalur `session_review` yang ada. |
| `escalate` | — | Selalu lolos; menutup event ke manusia. |

### Sesi selesai/gagal selalu jadi event

- Selesai → pilihan: `integrate`, `request-review`, `resume-session` (lanjutkan), `stop-session`, `none`.
- Gagal → pilihan: `resume-session`, `stop-session`, `escalate`.

Tak ada lagi sesi yang menggantung tanpa keputusan.

## 3. Kontrol manusia & data

### Sesi lead di layar

- `lead-<proyek>` tampil di daftar sesi dan LeadScreen dengan label **Lead**; bisa di-attach seperti
  sesi pekerja, diketik langsung, atau via `hanoman_session_steer`.
- Saat manusia mengetik/mengambil alih → courier berhenti menyuntik (`takenOver`); lanjut saat
  dilepas atau setelah 2 menit tanpa ketikan.
- LeadScreen per proyek: **Mulai / Hentikan / Rotasi sesi**, **Pause** (event tetap ditampung,
  pertanyaan pekerja ke manusia), **mode wewenang** per tindakan.

### Antrean izin

- `butuh-izin` → kartu LeadScreen + pesan Telegram dengan tombol Setujui/Tolak (pola notifikasi
  keputusan Telegram 0.9.31). Kartu: tindakan, target, alasan lead, bukti, laporan gerbang; merge
  menyertakan ringkasan diff + hasil test.
- Setujui → eksekutor jalan. Tolak (opsional dengan catatan) → event `rejected` ke sesi lead.

### Inbox terlihat

LeadScreen menampilkan event menunggu/diproses/terlambat beserta umur dan tenggat; manusia dapat
menjawab event mana pun sendiri (event tertutup untuk lead).

### Data (migration + ADR)

- **`LeadEvent`**: `id`, `projectId`, `kind` (`ask` | `session-ended` | `pulse` | `human` |
  `rejected` | `integrate-failed`), `priority`, `payload` (JSON), `status` (`open` | `delivered` |
  `done` | `late` | `human`), `sessionId?`, `specId?`, `deadlineAt?`, `deliveredAt?`, `closedAt?`,
  `decisionId?`, `createdAt`. Indeks `(projectId, status, priority, createdAt)`.
- **`LeadApproval`**: `id`, `eventId`, `projectId`, `action`, `target`, `reason`, `evidence` (JSON),
  `gateReport` (JSON), `status` (`pending` | `approved` | `rejected` | `expired`), `decidedBy?`,
  `decidedAt?`, `note?`, `createdAt`. Indeks `(projectId, status)`.
- **`LeadDecision`** + kolom `eventId?`.
- **Setting `lead`** diperluas per proyek: `authority{}`, `quotaStopPct`, `rampStep`, `rampProbeMin`,
  `failStreak`, `answerSlaSec`, `deliverTimeoutSec`, `rotateAfterEvents`, `approvalTtlMin`,
  engine/model sesi lead. Dicabut: `maxConcurrent`,
  `queueWaitSec`, `timeoutSec` (milik brain).

### Realtime

Grup snapshot `lead` di `/api/events/ws`: inbox, approval, status sesi lead. Tanpa polling.

### API & MCP (aturan #7, ADR-0202)

| Tool | Tingkat / capability |
|---|---|
| `hanoman_lead_act` | `--danger`, `lead:write` |
| `hanoman_lead_inbox` | `lead:read` |
| `hanoman_lead_approvals_list` | `lead:read` |
| `hanoman_lead_approval_decide` | `--danger`, `lead:approve` (capability baru) |
| `hanoman_lead_session_start` / `_stop` / `_rotate` | `--danger`, `lead:write` |
| `hanoman_lead_ask` | tetap; kini menulis event `human` ke inbox |

## 4. Kegagalan, migrasi, pengujian

### Kegagalan

| Kejadian | Perilaku |
|---|---|
| Sesi lead crash / pane hilang | Event `delivered` → `open`; buka ulang dengan backoff 1/2/5 menit; 3× gagal → pause proyek + Telegram. Selama itu pertanyaan pekerja ke manusia. |
| Lead diam terlalu lama (tak ada `act`/Stop dalam `deliverTimeoutSec`, default 600) | Event dikembalikan; percobaan kedua → rotasi sesi. |
| Act pada event tertutup | `ditolak: event-closed`. |
| Restart server | Inbox & approval di DB; courier membaca ulang keadaan pane dari tmux (ADR-0016). |
| Kuota habis | Jatah 0 → denyut tak dikirim; pertanyaan pekerja tetap diantar. Kuota lead sendiri habis → diperlakukan seperti crash. |
| Test integrasi merah di server | Merge ditolak; event `integrate-failed` ke lead (resume + steer pekerja, atau eskalasi). |
| Approval tak dijawab | Kedaluwarsa setelah `approvalTtlMin` (default 1440) → event `rejected`. Tindakan tak pernah jalan sendiri. |

### Migrasi & rollout

1. Migration Prisma (`LeadEvent`, `LeadApproval`, `LeadDecision.eventId`) + **ADR baru** yang
   menggantikan bagian "brain sekali-panggil" ADR-0091/0146/0223 dan mengamandemen ADR-0167.
2. Tanpa flag transisi: brain dicabut dalam SPEC yang sama. Proyek yang sudah opt-in langsung
   memakai sesi lead setelah rilis; knob lama yang dicabut diabaikan saat Setting `lead` dibaca
   (tak perlu migrasi data Setting).
3. Docs dalam commit yang sama: `internal/docs/architecture/{stack,data-model,api-contract}.md`,
   `internal/docs/requirements/frd.md`, `internal/docs/frontend/glossary.md`,
   `internal/skills/hanoman/SKILL.md`, `CLAUDE.md` (kalimat grup snapshot), tautan di
   `internal/docs/README.md`.

### Pengujian

- **Unit** (vitest, `--no-file-parallelism`, `TEST_DATABASE_URL` sekali-pakai):
  - `launchBudget`: kombinasi slot/host/kuota, limit tak terbaca = 0, ramp, pemutus beruntun.
  - `gate`: tiap tindakan × tiap alasan tolak, kata kunci sensitif, mode wewenang.
  - `inbox`: prioritas, batch, tenggat → `late`/`human`, klaim ganda.
  - `courier`: pane diam / sibuk / `takenOver`.
- **Integrasi**:
  - `session-ended` → act `integrate` → approval → setujui → merge di repo git sementara; varian
    test hijau dan merah.
  - Regresi kasus 2026-10-20: 7 backlog siap, jatah 1 → 1 diluncurkan; kedua menunggu probe;
    2 gagal → pause.
- **Nyata lokal**: boot server, curl `/lead/act`, `/lead/inbox`, `/lead/approvals/:id`,
  `/lead/session/*`; buka satu sesi lead sungguhan di proyek uji dan amati event tersuntik ke pane.

## Implementasi: satu SPEC, fase berurutan

Satu SPEC, satu plan, satu branch, dirilis sekali. Fase hanya urutan kerja di dalam plan; tiap fase
ditutup dengan test yang tersentuh hijau sebelum fase berikutnya dimulai.

1. **Data & ADR** — migration `LeadEvent`/`LeadApproval`/`LeadDecision.eventId`, perluasan Setting
   `lead`, ADR baru.
2. **Gerbang & jatah** — `budget.ts`, `gate.ts`, `authority.ts`, pengetatan `integrate`
   (test dijalankan ulang server, `baseBranch`), daftar sensitif.
3. **Inbox & approval** — `inbox.ts` (prioritas, batch, tenggat → manusia), `LeadApproval` +
   Telegram Setujui/Tolak, sesi selesai/gagal selalu jadi event.
4. **Sesi lead** — `lead-session.ts` (buka/rotasi/backoff), `courier.ts` (suntik saat diam,
   `takenOver`), prompt sistem lead, `hanoman_lead_act`.
5. **API, MCP, realtime, UI** — route baru + tool MCP (ADR-0202), grup snapshot `lead`, LeadScreen
   (sesi, inbox, antrean izin, mode wewenang).
6. **Pencabutan brain** — hapus `brain.ts`, LLM di `decide.ts`, state in-memory, knob lama; ubah
   `hanoman_lead_ask` menulis event `human`.
7. **Docs & verifikasi nyata** — docs SoT tersentuh, boot server + curl endpoint baru, satu sesi
   lead sungguhan di proyek uji, skenario regresi 7 backlog.

## Di luar scope

- Lead-pembantu kedua per proyek (jalan keluar bila tenggat sering terlewat).
- Satu lead global lintas proyek.
- Rebase otomatis oleh lead (tetap lewat sesi pekerja yang di-resume).
