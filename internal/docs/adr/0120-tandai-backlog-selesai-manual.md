# ADR-0120 — Tandai backlog selesai manual: operasi khusus, jejak `Spec.manualDone`, auto-merge dilewati

- Status: accepted
- Tanggal: 2026-08-15
- Konteks: SPEC-804
- Menegakkan: ADR-0008 (stage hanya maju, kemajuan dari fase sesi) · ADR-0045 · ADR-0047 (activity log) · ADR-0090 · ADR-0099 (batas permukaan MCP) · ADR-0100 · ADR-0105 (`doneAt` tulis-sekali)
- Mengamandemen: **ADR-0103** — kandidat sweep auto-merge kini disaring `manualDone`.
- Tidak mencabut apa pun.

## Konteks

Stage backlog hanya bergerak sebagai **turunan sesi yang berjalan**. `PATCH /specs/:id {stage}`
sengaja **backward-only** (SPEC-167) — cermin terbalik guard forward-only `advanceStage` — jadi
operator bisa memundurkan item, tapi tak punya satu pun jalan memajukannya ke `done`.

Akibatnya item yang sudah beres **di luar sesi** menggantung di stage lama: dikerjakan langsung di
checkout, sudah ter-merge lewat PR di luar dashboard, atau ternyata sudah tercakup item lain.

Ini bukan cuma soal tampilan. Item seperti itu terus dibaca sebagai pekerjaan yang belum dimulai
oleh checker backlog scheduler — predikat `UNSTARTED_SPEC_WHERE` (`baseSha = null ∧ stage ≠ done`,
SPEC-431) — dan oleh denyut hanoman-lead yang memakai predikat yang sama. Satu-satunya jalan keluar
hari ini adalah **menghapus** item, yang membuang id SPEC-nnn, riwayat, dan `dependsOn`-nya.

Ironisnya keadaan ini sudah lama diantisipasi kode: komentar `blockersFor` (SPEC-475) menyebut
"selesai manual" sebagai salah satu bentuk sah item `done` tanpa jejak kerja — jalurnya saja yang
tak pernah ada.

## Keputusan

### 1. Operasi khusus `POST /specs/:id/done`, bukan pelonggaran `PATCH`

```
POST /api/specs/:id/done   { reason?: string (≤ 280), confirm?: boolean }  -> Spec
```

`PATCH /specs/:id {stage}` **tetap backward-only**. Melonggarkannya jadi dua arah berarti setiap
stage bisa dimajukan ke mana pun, dan seluruh premis "kemajuan hanya berasal dari fase sesi"
(ADR-0008) runtuh — bersama ketiga guard CAS yang dibangun di atasnya (`advanceStage`,
`scheduler/reconcile`, `liveSpecs`). Yang dibutuhkan spec ini hanya **satu lompatan ke satu stage
terminal**, dengan gerbang & jejaknya sendiri.

Bentuk "operasi khusus" ini sudah dua kali ditetapkan untuk perubahan sejenis: **ADR-0064** (rename
`Project.id`) dan **ADR-0109** (`POST /specs/:id/source`) — keduanya punya gerbang & efek samping
sendiri, keduanya sengaja tidak ditumpuk ke PATCH.

Capability tak berubah: `/specs/*` sudah dipetakan `backlog:read|write` per method
(`agent-capabilities.ts`), jadi endpoint ini otomatis `backlog:write` dan agen bisa memakainya.

Kode respons:

| Keadaan | Respons |
|---|---|
| Spec tak ada | `404 { error: "not found" }` |
| Sudah `done` | `409 { error: "backlog item sudah selesai" }` |
| Ada sesi tmux **hidup** untuk item ini dan `confirm !== true` | `409 { error: "confirm-required", session: { id, agent } }` |
| CAS kalah (sesi/overlay menyelesaikannya lebih dulu) | `409 { error: "backlog item sudah selesai" }` |
| Berhasil | `200 Spec` |

No-op ditolak, bukan diterima diam-diam: menerimanya berarti menulis jejak manual di atas
penyelesaian yang bukan manual (pola ADR-0109 yang menolak "source tak berubah").

### 2. Konfirmasi dua langkah untuk sesi hidup — dan sesinya tidak dibunuh

Batasan spec menuntut item bersesi aktif tak boleh ditandai selesai diam-diam. Bentuknya **dua
langkah**, cermin `POST /update/apply` (ADR-0088): tanpa `confirm` server menjawab `409
confirm-required` berikut identitas sesinya; dengan `confirm: true` operasi diteruskan.

Sesinya **tidak** dihentikan. Menutup sesi punya konsekuensi worktree sendiri (ADR-0116) dan sudah
punya tombolnya di Terminal; menggabungkannya ke sini berarti satu tombol dengan dua akibat yang
tak bisa dipisah operator.

Gerbangnya membaca **`specId` pane** lewat `listSessions()`, bukan `getSession(sessionIdForSpec(id))`.
Id sesi backlog memang deterministik, tetapi yang ditanya di sini adalah "adakah pane yang mengaku
mengerjakan item ini" — itu properti pane, bukan tebakan atas namanya.

### 3. Jejak = satu kolom `Spec.manualDone Json?`

```json
{ "at": "2026-08-15T04:00:00.000Z", "by": "dena@nafanesia.id", "reason": "sudah ter-merge lewat PR #12" }
```

Satu kolom, **bukan** tiga skalar (`doneBy`/`doneMarkedAt`/`doneNote`). Ketiga fakta itu satu
peristiwa; tiga kolom nullable bisa drift (dua terisi, satu null) tanpa tipe apa pun yang memaksanya
konsisten — kelas kegagalan senyap yang sudah berulang di repo ini (ADR-0090/0093/0094/0105).
Preseden kolom `Json?` di model yang sama: `payload`, `dependsOn`, `autoMerge`, `sourceHistory`.

**`doneAt` (ADR-0105) tak berubah maknanya**: tetap "selesai PERTAMA", tetap tulis-sekali, tetap
ditulis **hanya** di dalam `recordCompletion()`. `manualDone.at` menjawab pertanyaan yang berbeda —
"kapan operator menandai" — sehingga keduanya tak pernah bersaing. Perbedaannya terlihat persis pada
reopen: item yang selesai lewat sesi, dibuka lagi, lalu ditandai manual punya `doneAt` lama **dan**
`manualDone.at` baru, dan keduanya benar.

`manualDone` **ditimpa** tiap penandaan berikutnya (bukan array): ia menjelaskan keadaan yang
BERLAKU. Riwayat transisi stage sudah punya rumahnya sendiri — `SessionResult` (ADR-0047), yang juga
ditulis jalur ini. Revert stage sengaja **tidak** mengosongkannya, cermin `doneAt`.

Migration aditif satu baris tanpa backfill: sebelum spec ini jalurnya memang tak ada, jadi tak ada
stempel lama yang bisa dipulihkan.

### 4. Satu titik cekik `services/spec-complete.ts`

`completeSpecManually(spec, { by, reason })` melakukan seluruhnya, dan route adalah satu-satunya
pemanggilnya:

1. CAS `updateMany({ where: { id, stage: { not: "done" } }, data: { stage: "done", manualDone } })`
   — `count === 0` berarti kalah balapan → 409, bukan penulisan ganda. Tap Prisma ADR-0100
   memancarkan `spec.stage_changed` dari sini.
2. `recordCompletion()` — `doneAt` + notifikasi `done:<specId>`.
3. `recordSessionResult()` — activity log ADR-0047, `commitSha`/`branch` null karena memang tak ada.
4. `notifySynced("spec", id)`.

Efek samping penyelesaian **tidak** disalin ke call site: itu kelas bug yang sudah tiga kali dibayar
repo ini (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`, SPEC-475 `headSha`).

### 5. Sweep auto-merge melewati penyelesaian manual

Kandidat sweep ADR-0103 adalah notifikasi `done:<specId>` dalam 24 jam — baris yang ditulis
`recordCompletion`, yang kini juga dipanggil jalur manual. Tanpa gerbang, setiap item yang ditandai
manual jadi kandidat merge:

- item yang **tak pernah** punya sesi: `sourceTip(repoDir, "hanoman/spec-nnn")` null → sesudah grace
  15 menit lahir notifikasi "branch kerja belum ter-push" — bising, dan salah;
- item yang punya branch sesi lama yang **ditinggalkan**: branch-nya ada → sweep **me-merge pekerjaan
  setengah jadi** ke default branch. Bahaya nyata, bukan kosmetik.

"Ditandai selesai manual" berarti pekerjaannya beres di luar sesi; tak ada yang perlu di-merge.
`settleOne` karena itu early-return `false` saat `spec.manualDone` terisi — **diam**, bukan
`report()`: tak ada yang perlu dilaporkan ke operator.

Item yang selesai lewat sesi lalu dibuka-ulang lalu ditandai manual juga ikut dilewati, dan tak ada
yang hilang: gotcha 1 ADR-0103 sudah menetapkan reopen-lalu-selesai-lagi tak di-auto-merge ulang.

### 6. Permukaan dashboard

Aksi ada di **dua tempat** dan memakai **satu** komponen dialog: `IconButton` "Tandai selesai" di
`SpecActions` (dipakai card, list, dan board sekaligus) dan tombol di blok "Ubah status" detail item
— satu blok, dua arah. Dialognya memuat kalimat konsekuensi, textarea alasan opsional, dan
peringatan sesi hidup yang datang dari **respons server**, bukan dari daftar sesi klien yang bisa
basi. Item ber-`manualDone` menampilkan baris jejak "Ditandai selesai manual · `by` · `at`" di
detail, sejajar blok "Jejak konversi type".

## Gotcha wajib

1. **`manualDone` wajib di `FIELDS.spec` DAN `JSON_FIELDS`, bukan `DATE_FIELDS`.** `upsert` yang tak
   menyebut sebuah kolom TETAP berhasil, jadi kolom yang terlewat mendarat sebagai null palsu di
   tiap client tanpa satu pun error (kelas ADR-0090/0093/0094/0105). Bukan `DATE_FIELDS` karena `at`
   hidup di dalam JSON-nya — kolomnya sendiri bukan `DateTime` (cermin `sourceHistory`).
2. **Kandidat sweep auto-merge adalah notifikasi `done:`, yang kini juga ditulis jalur manual.**
   Tanpa gerbang keputusan 5, item ber-branch sesi lama yang ditinggalkan di-merge setengah jadi.
3. **Durabilitas terhadap overlay stage-live bukan properti kode baru** melainkan konsekuensi guard
   forward-only `liveSpecs` (`STAGES.indexOf(next) <= indexOf(current)` → biarkan) dan fakta `done`
   adalah stage terakhir. Karena ia bergantung pada satu perbandingan indeks di berkas lain, ia
   **dikunci test**, bukan diasumsikan.
4. **Gerbang sesi hidup membaca `specId` pane** (`listSessions()`), bukan
   `getSession(sessionIdForSpec(id))` — id deterministik menjawab pertanyaan yang berbeda, dan pane
   MATI bukan sesi hidup.
5. **`manualDone` ditimpa, bukan array**, dan revert stage sengaja **tidak** mengosongkannya (cermin
   `doneAt`). Riwayat transisinya ada di `SessionResult`.

## Alternatif yang ditolak

- **Melonggarkan `PATCH /specs/:id {stage}` jadi dua arah.** Meruntuhkan ADR-0008 dan ketiga guard
  CAS persist stage demi satu transisi yang bisa punya endpoint sendiri.
- **Tiga kolom skalar untuk siapa/kapan/alasan.** Bisa drift tanpa tipe yang memaksanya konsisten.
- **Menyimpan alasan hanya di `SessionResult`.** Whitelist ADR-0047 sengaja ketat dan tak punya field
  alasan, dan UI harus men-join hanya untuk merender satu baris jejak.
- **Menambah tool MCP.** ADR-0099 sengaja meniadakan tool yang mengeksekusi atau memindahkan stage
  (`PATCH stage` disebut eksplisit). Endpoint REST + agent token sudah memenuhi kebutuhan agen.
- **Membunuh sesi yang berjalan saat item ditandai selesai.** Satu tombol dengan dua akibat yang tak
  bisa dipisah; penutupan sesi punya konsekuensi worktree sendiri (ADR-0116).

## Konsekuensi

| Permukaan | Perilaku sesudah item ditandai manual |
|---|---|
| `GET /specs?startable=true` | item hilang (gerbang `stage !== "done"` yang sudah ada) |
| Checker backlog scheduler | tak lagi mengantrekan (`UNSTARTED_SPEC_WHERE`, SPEC-431) |
| Denyut hanoman-lead | sama, predikat yang sama |
| Gerbang `dependsOn` (ADR-0093) | dependent-nya jadi **siap** — `blockersFor` sudah memperlakukan "tak ada jejak kerja" sebagai siap |
| Sweep auto-merge (ADR-0103) | **dilewati** |
| Notifikasi | baris `done:<specId>` seperti item yang selesai lewat sesi |
| Sync | `notifySynced("spec", id)`; `manualDone` ikut menyeberang |
| Webhook | `spec.stage_changed` dengan `manualDone` di `after` |
| Changelog (ADR-0105) | ikut, karena `doneAt` terstempel `recordCompletion` |
| Revert stage (SPEC-167) | tetap bisa memundurkan; `manualDone` tak dikosongkan |
