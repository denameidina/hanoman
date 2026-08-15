# SPEC-804 — Tandai backlog selesai (done) manual dari dashboard

Status: design · 2026-08-15 · flow `feature` (brief) · ADR baru: **0120**

## Masalah

Stage backlog hanya bergerak sebagai turunan sesi yang berjalan. `PATCH /specs/:id {stage}`
sengaja **backward-only** (SPEC-167) — cermin terbalik guard forward-only `advanceStage` —
sehingga operator bisa memundurkan item, tetapi tak punya satu pun jalan memajukannya ke
`done`.

Akibatnya item yang sudah beres **di luar sesi** menggantung di stage lama:

- dikerjakan langsung di checkout tanpa lewat hanoman,
- sudah ter-merge lewat PR di luar dashboard,
- ternyata sudah tercakup item lain.

Item seperti itu mengotori daftar backlog **dan** filter `startable` — dan tak berhenti di
tampilan: checker scheduler `UNSTARTED_SPEC_WHERE` (`baseSha = null ∧ stage ≠ done`,
SPEC-431) akan terus mengantrekannya, dan denyut hanoman-lead membaca predikat yang sama.
Satu-satunya jalan keluar hari ini adalah **menghapus** item — yang membuang riwayat,
`dependsOn`, dan id SPEC-nnn-nya.

## Objective

Operator bisa menandai satu item backlog sebagai selesai langsung dari dashboard tanpa
menjalankan sesi. Aksinya ada di daftar backlog dan di detail item, meminta konfirmasi, dan
menyimpan jejak siapa/kapan plus alasan singkat opsional. Sesudah ditandai, item keluar dari
filter `startable`, tampil dengan status selesai yang **sama** dengan item yang selesai lewat
sesi, dan perubahannya ikut notifikasi + sync seperti perubahan backlog lainnya. Endpoint
API-nya tersedia agar agen bisa melakukan hal yang sama.

## Keputusan

### 1. Operasi khusus `POST /specs/:id/done`, bukan field `PATCH /specs/:id`

`PATCH /specs/:id {stage}` **tetap backward-only**. Melonggarkannya berarti setiap stage bisa
dimajukan ke mana pun, dan seluruh alasan "kemajuan hanya berasal dari fase sesi" (ADR-0008)
runtuh — bersama guard CAS di `advanceStage`, `reconcile`, dan `liveSpecs` yang semuanya
dibangun di atas invariant itu. Yang dibutuhkan spec ini adalah satu lompatan ke **satu** stage
terminal, dengan gerbang & jejaknya sendiri.

Preseden bentuk ini sudah dua kali ditetapkan: ADR-0064 (rename `Project.id`) dan ADR-0109
(`POST /specs/:id/source`) — keduanya perubahan yang punya gerbang & efek samping sendiri, dan
keduanya sengaja tidak ditumpuk ke PATCH.

```
POST /api/specs/:id/done   { reason?: string (≤ 280), confirm?: boolean }  -> Spec
```

- **Capability**: `backlog:write` — turunan `top === "specs"` di `capabilityForRoute`, **tanpa
  perubahan peta**. Method `POST` sudah menurunkannya lewat `rw()`, jadi tak ada pengulangan
  kelas bug SPEC-405 (prefix yang dipetakan tanpa melihat method).
- **404** `not found` — spec tak ada.
- **409** `{ error: "backlog item sudah selesai" }` — stage sudah `done`. No-op adalah bug
  klien; menerimanya diam-diam berarti menulis jejak manual di atas penyelesaian yang bukan
  manual (pola `POST /specs/:id/source` yang menolak "source tak berubah").
- **409** `{ error: "confirm-required", session: { id, agent } }` — ada sesi tmux **hidup**
  untuk item ini dan `confirm !== true`. Dua langkah, cermin `POST /update/apply` (ADR-0088).
  Dengan `confirm: true` operasi diteruskan; sesinya **tidak** dibunuh — menutup sesi adalah
  tindakan operator yang terpisah dan punya konsekuensi worktree sendiri (ADR-0116).
- **200** — baris `Spec` yang sudah diperbarui.

Deteksi sesi hidup memakai `listSessions().find(s => s.specId === id && !s.exited)` — bukan
`getSession(sessionIdForSpec(id))`. Sesi backlog memang ber-id deterministik, tetapi yang
ditanya di sini adalah "adakah pane yang mengaku mengerjakan item ini", dan itu properti
`specId` pane, bukan tebakan atas namanya.

### 2. Jejak = satu kolom `Spec.manualDone Json?`

```
manualDone = { at: "2026-08-15T…Z", by: "dena@nafanesia.id", reason?: "sudah ter-merge lewat PR #12" }
```

Satu kolom, bukan tiga skalar (`doneBy`/`doneMarkedAt`/`doneNote`). Ketiga fakta itu **satu
peristiwa**; tiga kolom nullable bisa drift (dua terisi, satu null) tanpa tipe apa pun yang
memaksanya konsisten — kelas kegagalan senyap yang sudah berulang di repo ini
(ADR-0090/0093/0094/0105). Preseden kolom `Json?` di model yang sama: `payload`, `dependsOn`,
`autoMerge`, `sourceHistory`.

**`doneAt` (ADR-0105) tak disentuh maknanya.** Ia tetap "selesai PERTAMA", tetap tulis-sekali,
tetap ditulis **hanya** di dalam `recordCompletion()`. `manualDone.at` menjawab pertanyaan yang
berbeda — "kapan operator menandai" — sehingga keduanya tak pernah bersaing. Perbedaannya
terlihat persis pada kasus reopen: item yang selesai lewat sesi, dibuka lagi, lalu ditandai
manual punya `doneAt` lama **dan** `manualDone.at` baru, dan keduanya benar.

`manualDone` **ditimpa** setiap penandaan manual berikutnya (bukan array): ia menjelaskan
keadaan yang BERLAKU, bukan riwayat. Riwayat transisi stage sudah punya rumahnya sendiri —
`SessionResult` (ADR-0047), yang juga ditulis jalur ini.

Migration aditif satu baris, tanpa backfill (tak ada sumber jejak manual di masa lalu — sebelum
spec ini jalurnya memang tak ada):

```sql
ALTER TABLE "Spec" ADD COLUMN "manualDone" JSONB;
```

- Masuk `FIELDS.spec` + `JSON_FIELDS` sync. **Bukan** `DATE_FIELDS` — `at` hidup di dalam JSON,
  kolomnya sendiri bukan `DateTime` (cermin `sourceHistory`).
- Masuk `WEBHOOK_ENTITIES.spec.fields`: penerima harus bisa membedakan "selesai lewat sesi" dari
  "ditandai manusia" tanpa mendiff dua amplop. Peristiwa yang terpancar tetap
  `spec.stage_changed` (turunan `changed: ["stage"]` menggantikan `spec.updated`).
- Masuk `zSpec` (`.nullable().default(null)`, cermin `autoMerge`) supaya UI bisa merendernya.

### 3. Satu titik cekik `services/spec-complete.ts`

```ts
completeSpecManually(specId, { by, reason }): Promise<Result>
```

Urutannya, satu fungsi, satu call site (route):

1. CAS `prisma.spec.updateMany({ where: { id, stage: { not: "done" } }, data: { stage: "done", manualDone } })`
   — `count === 0` berarti sesi/overlay menyelesaikannya lebih dulu di bawah kita → 409, bukan
   penulisan ganda. Tap Prisma ADR-0100 memancarkan `spec.stage_changed` dari sini
   (`updateMany` sudah ditap — ia jalur perubahan stage paling sering lewat `liveSpecs`).
2. `recordCompletion(specId, title, projectId)` — stempel `doneAt` (tulis-sekali) + notifikasi
   `done:<specId>`. **Bukan disalin**: ini fungsi yang sudah dipanggil ketiga jalur persist
   `done`, dan menyalin bookkeeping-nya ke call site adalah kelas bug SPEC-431/448/475.
3. `recordSessionResult({ projectId, specId, oldStage, newStage: "done", status: "done", author })`
   — activity log ADR-0047. `commitSha`/`branch` null: memang tak ada.
4. `notifySynced("spec", id)` — sadar-peran (client antre push, hub publish ke feed).

### 4. Stage live tak menimpanya — dan itu dibuktikan, bukan diasumsikan

Overlay `liveSpecs` forward-only (`STAGES.indexOf(next) <= indexOf(current)` → biarkan) dan
`done` adalah stage terakhir, jadi tulisan manual durable meski sesi item itu masih melaporkan
`executing`. Ini yang diminta batasan "jangan sekadar menulis kolom DB yang lalu ditimpa
penurunan stage" — dan karena ia bergantung pada satu perbandingan indeks di berkas lain, ia
dikunci test: item dengan sesi hidup berfase `Execute active`, ditandai manual, tetap `done`
sesudah `GET /specs` dibaca.

### 5. Penyelesaian manual dilewati sweep auto-merge

Kandidat sweep ADR-0103 adalah notifikasi `done:<specId>` dalam 24 jam — baris yang ditulis
`recordCompletion`, yang kini juga dipanggil jalur manual. Tanpa gerbang, setiap item yang
ditandai manual jadi kandidat merge:

- item yang **tak pernah** punya sesi: `sourceTip(repoDir, "hanoman/spec-nnn")` null → sesudah
  grace 15 menit lahir notifikasi "branch kerja belum ter-push" — bising, dan salah;
- item yang punya branch sesi lama yang **ditinggalkan**: branch-nya ada → sweep **me-merge
  pekerjaan setengah jadi** ke default branch. Ini bahaya nyata, bukan kosmetik.

"Ditandai selesai manual" berarti pekerjaannya beres di luar sesi; tak ada yang perlu di-merge.
`settleOne` karena itu early-return `false` saat `spec.manualDone` terisi — di baris yang sama
dengan gerbang `spec.stage !== "done"` yang sudah ada, jadi tak ada kelas biaya baru (keduanya
sama-sama diulang tiap tick selama window 24 jam, sebelum satu pun panggilan git).

Item yang selesai lewat sesi lalu dibuka-ulang lalu ditandai manual juga ikut dilewati. Tak ada
yang hilang: gotcha 1 ADR-0103 sudah menetapkan reopen-lalu-selesai-lagi tak di-auto-merge
ulang.

### 6. UI

**Detail item** (`SpecDetail`, blok "Ubah status"): aksi **"Tandai selesai"** untuk item
`stage !== "done"`, di atas `Select` revert yang sudah ada — satu blok, dua arah. Membuka dialog
konfirmasi berisi:

- kalimat konsekuensi (item keluar dari daftar siap-kerja, stage-nya sama dengan item yang
  selesai lewat sesi, kode/commit tak disentuh),
- `Textarea` alasan singkat **opsional** (≤ 280),
- peringatan **bila ada sesi hidup**, dengan tombol berbunyi "Tandai selesai — sesi tetap
  berjalan". Peringatan itu datang dari respons `409 confirm-required` server, bukan dari
  tebakan klien: daftar sesi di klien bisa basi, dan yang menggerbangi tetap server.

Item yang sudah `done` dan punya `manualDone` menampilkan baris jejak
**"Ditandai selesai oleh `<by>` · `<at>`"** + alasan, sejajar blok "Jejak konversi type".

**Daftar backlog** (`SpecActions` — dipakai card, list, dan board sekaligus): `IconButton`
`circle-check` "Tandai selesai" untuk item non-`done`, membuka dialog yang sama. Satu komponen
dialog dipakai kedua permukaan; menyalinnya berarti dua kalimat konfirmasi yang bisa berselisih.

**Filter `startable`** sudah mengecualikan `stage === "done"` di `filterSpecs` — tanpa perubahan
kode, dikunci test supaya "keluar dari startable" jadi janji yang diuji, bukan kebetulan.

### 7. Di luar scope (dinyatakan)

- **Tool MCP.** ADR-0099 sengaja tak mengekspos tool yang mengeksekusi atau memindahkan stage
  (`PATCH stage` disebut eksplisit dalam daftar yang ditiadakan). Endpoint REST + agent token
  sudah memenuhi "agen bisa melakukan hal yang sama"; menambah tool MCP memperluas permukaan
  tulis yang ADR itu justru batasi.
- **Menandai selesai massal.** Objective menyebut "satu item".
- **Membunuh sesi yang sedang berjalan.** Punya konsekuensi worktree sendiri (ADR-0116); tombol
  Tutup sesi sudah ada di Terminal.

## Dampak pada perilaku yang sudah ada

| Permukaan | Perilaku sesudah item ditandai manual |
|---|---|
| `GET /specs?startable=true` | item hilang (gerbang `stage !== "done"` yang sudah ada) |
| Checker backlog scheduler | tak lagi mengantrekan (`UNSTARTED_SPEC_WHERE`, SPEC-431) |
| Denyut hanoman-lead | sama, predikat yang sama |
| Gerbang `dependsOn` (ADR-0093) | dependent-nya jadi **siap** — `blockersFor` sudah memperlakukan "tak ada jejak kerja" sebagai siap, dan komentarnya sudah menyebut "selesai manual" |
| Sweep auto-merge (ADR-0103) | **dilewati** (keputusan 5) |
| Notifikasi | baris `done:<specId>` seperti item yang selesai lewat sesi |
| Sync | `notifySynced("spec", id)` → push/publish; `manualDone` ikut menyeberang |
| Webhook | `spec.stage_changed` dengan `manualDone` di `after` |
| Changelog (ADR-0105) | ikut, karena `doneAt` terstempel `recordCompletion` |
| Revert stage (SPEC-167) | tetap bisa memundurkan; `manualDone` **tidak** dikosongkan — ia fakta historis, cermin `doneAt` |

## Test

Server:

- `spec-done.route.test.ts` — 404 · 409 sudah selesai · 409 `confirm-required` saat sesi hidup ·
  200 dengan `confirm` · alasan > 280 ditolak 400 · alasan kosong/absen sah · `manualDone`
  terisi `{at,by}` · `doneAt` terstempel · notifikasi `done:` lahir · `SessionResult` lahir
  ber-`author` · capability `backlog:write` (bukan cookie-only).
- `spec-complete.service.test.ts` — CAS: penyelesaian konkuren → tak menulis dua kali;
  `doneAt` yang sudah ada tak bergeser (write-once ADR-0105).
- `live-specs-manual-done.test.ts` — item ditandai manual dengan sesi hidup berfase
  `Execute active` tetap `done` sesudah `liveSpecs()`.
- `auto-merge.service.test.ts` (tambahan) — kandidat ber-`manualDone` tak pernah mencapai
  `integrate`, dan tak menulis notifikasi `automerge:`.
- `spec-done-at.test.ts` (tambahan) — `manualDone` ada di `__FIELDS.spec`, ada di `JSON_FIELDS`,
  **tidak** ada di `__DATE_FIELDS.spec`.
- `specs.route.test.ts` (tambahan) — `startable=true` membuang item yang ditandai manual.

Frontend:

- `backlog-mark-done.test.tsx` — tombol muncul untuk item non-`done` & hilang untuk `done`;
  dialog mengirim `reason`; respons `409 confirm-required` memunculkan peringatan sesi hidup
  lalu kirim ulang dengan `confirm: true`; jejak "Ditandai selesai oleh …" terender.
- `api-client.test.ts` (tambahan) — `markSpecDone` memanggil `POST /specs/:id/done`.

## Berkas yang tersentuh

```
server/prisma/schema.prisma                       + Spec.manualDone
server/prisma/migrations/20260815…_spec_manual_done/migration.sql
shared/src/entities.ts                            + zManualDone, zSpec.manualDone
shared/src/dto.ts                                 + zMarkSpecDone
shared/src/webhook.ts                             + manualDone di fields + sample
server/src/services/sync.ts                       + FIELDS.spec, JSON_FIELDS
server/src/services/spec-complete.ts              (baru)
server/src/routes/specs.ts                        + POST /specs/:id/done
server/src/services/auto-merge.ts                 + gerbang manualDone
src/src/api/client.ts                             + markSpecDone
src/src/App.tsx                                   + markDone handler
src/src/screens/BacklogScreen.tsx                 + aksi & dialog
src/src/screens/MarkDoneDialog.tsx                (baru)
internal/docs/architecture/api-contract.md        endpoint
internal/docs/architecture/data-model.md          kolom
internal/docs/adr/0120-*.md                       (baru)
internal/docs/adr/README.md                       narasi
internal/docs/README.md                           link ADR
internal/skills/hanoman/SKILL.md                  aturan arsitektur
docs/agent-integration.md                         endpoint untuk agen
```
