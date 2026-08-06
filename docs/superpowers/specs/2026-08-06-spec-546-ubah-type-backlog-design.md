# SPEC-546 — Ubah type/source backlog item

Tanggal: 2026-08-06 · Sumber: brief · Prioritas: sedang · ADR baru: **0109**

## Masalah

`Spec.source` ditetapkan sekali saat `POST /specs` dan tak pernah bisa diubah lagi —
`PATCH /specs/:id` hanya menerima `title`/`priority`/`payload`/`branchFrom`/`stage`/`dependsOn`/
`autoMerge`. Padahal type sering salah tebak di awal: laporan yang masuk sebagai `brief` ternyata
bug (`qa`), item Help Center (`help`) ternyata fitur baru (`brief`), item hasil triase sering
perlu digeser. Satu-satunya jalan hari ini adalah hapus lalu buat ulang — nomor SPEC hilang,
riwayat/notifikasi/dependency putus, dan jejak triase (yang menurut SPEC-520 hanya hidup di
prosa `payload`) ikut hilang.

## Koreksi scope

Objective backlog menyebut enam source (`brief`, `qa`, `audit`, `cross-audit`, `goal`, `help`).
**`cross-audit` sudah tidak ada** — dicabut SPEC-384/ADR-0092 bersama error monitoring, dan
`zSpecSource` hari ini berbunyi `["brief","qa","audit","help","goal"]`. Fitur ini karena itu
mencakup **lima** source, yakni seluruh isi `zSpecSource`. Tidak ada source baru diperkenalkan;
kalau kelak `zSpecSource` bertambah, konversi ikut mengenalnya tanpa perubahan kode karena
seluruh jalur ini berkunci pada enum + peta bentuk yang sama.

## Fakta yang mengikat desain

1. **Tiga bentuk payload melayani lima source.**
   `brief`/`audit`/`help` → `zBriefPayload {context, outcome, constraints, priority, fromAudit?}` ·
   `qa` → `zQaPayload {severity, steps, expected, actual, env, fromAudit?}` ·
   `goal` → `zGoalPayload {goal, done, constraints, priority}`.
   Jadi konversi terbagi dua kelas: **sebentuk** (brief↔audit↔help — payload tak berubah sama
   sekali) dan **beda bentuk** (menyeberang ke/dari qa atau goal).
2. **Ikatan source↔bentuk payload hidup di `zCreateSpec.superRefine`** (`shared/src/dto.ts:72`),
   inline. Konstrain SPEC-546 menuntut validasi konversi memakai skema yang sama — jadi
   predikatnya harus **diekstrak**, bukan disalin.
3. **`flowForSource()` (`shared/src/dto.ts:257`) satu-satunya peta source → flow.** Flow adalah
   nilai turunan, dibaca **saat sesi lahir** oleh ketiga pemanggil (`TerminalScreen`,
   `scheduler/engine.ts:69`, `lead/apply.ts:115`). Tak ada satu pun salinan `source` yang
   disimpan di tempat lain: `SchedulerQueueItem.source` adalah asal *checker*
   (`backlog`|`triase`), bukan source Spec. **Konsekuensinya: mengubah `source` otomatis
   mengubah flow — tak ada kombinasi source+flow mustahil yang bisa lahir dari data.** Yang bisa
   mustahil adalah *sejarahnya*: berkas fase sebuah sesi berisi nama fase `PIPELINES[flow lama]`.
4. **`source` sudah ada di `FIELDS.spec`** (`server/src/services/sync.ts:47`) → perubahan source
   merambat lewat feed sync apa adanya. Yang perlu diurus hanya kolom baru.
5. **`payload` sengaja TIDAK ada di `WEBHOOK_ENTITIES` `fields`** — allowlist itu pagar data
   sensitif. `source` ada di sana.
6. **Gerbang `editingContent` `PATCH /specs/:id`** = `stage !== "brainstorming" || baseSha !== null`
   → 409. `dependsOn`/`autoMerge` sengaja **di luar** gerbang itu karena menggerbangi peluncuran
   berikutnya / kerja sesudahnya, bukan konten yang sedang dikerjakan.
7. **`SOURCE_META` di `BacklogScreen` tak punya entri `help`** dan tab filter backlog tak punya
   pintu `help`. Item Help Center hari ini memakai lencana `feature brief` (fallback). Karena
   SPEC-546 menjadikan `help` tujuan konversi yang sah, lubang itu masuk scope.

## Keputusan

### D1 — Endpoint khusus `POST /specs/:id/source`, bukan field `PATCH`

`PATCH /specs/:id` sudah memikul lima gerbang berbeda (edit konten, revert stage ber-dry-run +
`confirmDelete`, branch, dependsOn, autoMerge) dan `source` punya gerbang yang **berbeda lagi**
(D2). Menumpuknya ke handler yang sama membuat kombinasi `{source, stage}` atau `{source, title}`
dalam satu request jadi pertanyaan yang harus dijawab pasal per pasal.

Preseden hanoman sudah ada dan persis sebentuk: **ADR-0064** memutuskan rename `Project.id`
sebagai **operasi khusus, bukan field PATCH**, karena ia punya gerbang & efek samping sendiri.
Konversi source adalah spesies yang sama.

```
POST /specs/:id/source
body: { source: <zSpecSource>, payload?: <brief|qa|goal payload> }
200 → Spec (bentuk sama dengan PATCH)
400 → payload tak cocok dengan source tujuan / source tak dikenal
404 → spec tak ada
409 → gerbang item yang sudah dimulai (D2)
```

Capability: `/specs/*` sudah dipetakan `agent-capabilities.ts:48` → `POST` = `backlog:write`.
Tanpa perubahan gate.

### D2 — Gerbang item yang sudah dimulai: **terkunci pada FLOW, bukan pada label**

| Keadaan item | Konversi |
|---|---|
| Belum dimulai (`stage === "brainstorming"` ∧ `baseSha === null`) | ke **source mana pun**, `payload` boleh diganti |
| Sudah dimulai | **hanya** bila `flowForSource(lama) === flowForSource(baru)`; `payload` **tak boleh** disertakan |

Hari ini kelompok se-flow satu-satunya adalah `{brief, help}` (keduanya → `feature`); `qa`,
`audit`, `goal` masing-masing flow sendiri.

Alasan (masuk ADR-0109):

- Yang dilindungi gerbang SPEC-186 adalah **pekerjaan yang sedang berjalan**, bukan label.
  Sebuah sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke `$HANOMAN_PHASE_FILE`.
  Memindahkan item ber-flow `feature` (Brainstorm→Objective→Spec→Plan→Execute) ke `goal`
  (dua fase) meninggalkan berkas fase yang **tak akan pernah** memuaskan `phasesComplete` flow
  barunya — persis "kombinasi yang mustahil" yang dilarang konstrain, dan bentuknya sama dengan
  kelas bug SPEC-433 (pil hijau yang secara struktural tak bisa muncul).
- Sebaliknya, `brief` → `help` **tak mengubah apa pun** yang dipegang sesi: flow sama, bentuk
  payload sama, prompt sama. Yang berpindah cuma lencana & tab. Menguncinya berarti menolak
  justru kasus yang paling sering disebut brief ("item dari Help Center ternyata fitur baru")
  hanya karena sesinya kebetulan sudah pernah jalan.
- `payload` tetap terkunci untuk item yang sudah dimulai — itu SPEC-186 apa adanya, dan karena
  konversi se-flow selalu se-bentuk, tak ada field yang perlu diisi operator.

### D3 — Jejak konversi: kolom `Spec.sourceHistory Json?` (append-only, **membawa payload lama**)

```jsonc
[{ "at": "2026-08-06T04:12:00.000Z", "from": "brief", "to": "qa",
   "by": "dena@nafanesia.id", "payload": { "context": "…", "outcome": "…", … } }]
```

- **Kolom, bukan turunan.** Aturan ADR-0090 bukan "selalu turunkan" melainkan *bisakah dihitung
  ulang dari sumber lain* — kapan sebuah baris berganti type tidak bisa.
- **`payload` bentuk lama ikut disimpan.** Ini yang membuat konversi beda-bentuk aman: field yang
  tak punya padanan (D4) tidak lenyap, ia pindah ke jejak. Janji objective ("tanpa kehilangan …
  riwayat") jadi harfiah, bukan kira-kira.
- **Tanpa cap.** Konversi adalah tindakan operator manual yang digerbangi D2; kolomnya cermin
  `dependsOn`/`payload` yang juga tak dibatasi. Cap yang diam-diam membuang justru mematahkan
  satu-satunya alasan kolom ini ada.
- Masuk **`FIELDS.spec`** (tanpa itu jejak konversi berhenti di satu mesin — kelas gagal-senyap
  ADR-0090/0093/0094/0105: `upsert` yang tak menyebut kolom **tetap berhasil**). **Bukan**
  `DATE_FIELDS`: `at` hidup di dalam JSON, kolomnya sendiri bukan `DateTime`.
- **Tidak** masuk `WEBHOOK_ENTITIES.fields`: ia membawa payload, dan `payload` memang sudah
  sengaja dikecualikan dari allowlist itu.
- Migration **additif** (`ALTER TABLE Spec ADD COLUMN sourceHistory JSONB` — nullable, tanpa
  default) → aman untuk hub produksi.

### D4 — Peta konversi payload: fungsi murni di `@hanoman/shared`, **field-ke-field, tak pernah menyambung prosa**

`convertPayload(to, payload) → { payload, dropped, missing }`

Bentuk **asal** dibaca dari payload-nya sendiri (`shapeOfPayload`), bukan dari `source` lama —
baris yang keduanya terlanjur berselisih (mis. datang lewat sync dari klien versi lama) tetap
dikonversi berdasar isi yang benar-benar ada.

| Dari → ke | Pemetaan | `dropped` (tak punya tujuan) |
|---|---|---|
| brief-shape → brief-shape | apa adanya | — |
| brief-shape → qa | `actual←context`, `expected←outcome`, `severity←sev(priority)`, `fromAudit` ikut | `constraints` |
| qa → brief-shape | `context←actual`, `outcome←expected`, `priority←prio(severity)`, `fromAudit` ikut | `steps`, `env` |
| brief-shape → goal | `goal←outcome ‖ context`, `constraints`, `priority` apa adanya | `context` (hanya bila `outcome` terisi), `fromAudit` |
| goal → brief-shape | `outcome←goal`, `constraints`, `priority` apa adanya | `done` |
| qa → goal | `goal←expected`, `priority←prio(severity)` | `steps`, `actual`, `env`, `fromAudit` |
| goal → qa | `expected←goal`, `severity←sev(priority)` | `done`, `constraints` |

`dropped` hanya memuat field yang **benar-benar terisi** — memperingatkan operator tentang field
kosong adalah kebisingan.

`missing` **dihitung**, bukan didaftar per-pasangan: field wajib bentuk tujuan (`SHAPE_REQUIRED`)
yang lahir kosong. `constraints` sengaja tak termasuk wajib — kosong itu keadaan normal untuk
brief maupun goal, dan menandainya "kurang" di tiap konversi jadi kebisingan; begitu pula
`severity`/`priority` yang selalu punya nilai turunan.

- `prio(severity)` = aturan yang **sudah** dipakai `deriveSpecFields`: `minor → sedang`, selain
  itu `tinggi`. `sev(priority)` inversnya: `tinggi → major`, selain itu `minor`.
  Peta itu 3→2 nilai, jadi `priority` **tidak** round-trip (`rendah → minor → sedang`).
  Ini dinyatakan, bukan disembunyikan: prosa yang round-trip, bukan prioritas.
- **Tak pernah menyambung dua field jadi satu.** Menyambung prosa membuat data yang tak bisa
  diurai lagi, dan operator toh ada di depan form. Yang tak punya padanan masuk `dropped`,
  diberitahukan di dialog, dan **utuh tersimpan di `sourceHistory`**.
- Satu definisi, dua pemakai: UI memakainya untuk **prefill form**, server memakainya sebagai
  **default saat `payload` tidak dikirim** (mis. panggilan agen lewat REST). Pola
  `resolveAutoMerge`/`flowForSource`.

### D5 — Validasi: satu predikat, dipakai `POST /specs` maupun konversi

Ekstrak dari `zCreateSpec.superRefine` menjadi fungsi murni di `@hanoman/shared`:

```ts
payloadShapeFor(source) : "brief" | "qa" | "goal"      // source → bentuk
shapeOfPayload(payload) : "brief" | "qa" | "goal"      // payload → bentuk
payloadMatchesSource(source, payload) : boolean
```

`zCreateSpec.superRefine` **ditulis ulang memanggilnya** (bukan disalin), `zChangeSpecSource`
memakai yang sama, dan server memakai `payloadMatchesSource` sekali lagi untuk kasus "payload
tidak dikirim, payload lama harus tetap cocok dengan source tujuan". Tak ada jalur validasi kedua
yang bisa melenceng.

### D6 — Nilai turunan ikut dihitung ulang; `author` **tidak** disentuh

Sesudah konversi server memanggil `deriveSpecFields(sourceBaru, payloadBaru, payloadBaru.priority
?? spec.priority)` — jadi `objective` & `priority` selalu cerminan bentuk yang berlaku (mis.
konversi ke `qa` memindahkan kendali prioritas ke `severity`).

`author` (`QA · …`, `Audit · …`, `Goal · …`) **tetap apa adanya**: ia menjawab *siapa yang
memfilekan item ini dan lewat pintu mana*, sebuah fakta historis — cermin `createdAt` ADR-0090
yang "tak pernah ditulis route". Lencana type yang terlihat operator adalah `SOURCE_META`, dan
itu memang berpindah.

### D7 — Notifikasi + peristiwa webhook

- `Notification` `type: "spec-source"`, `key: "source:<specId>:<n>"` (`n` = panjang
  `sourceHistory` sesudah append → unik & deterministik, kolom `key` `@unique`),
  `title: "<id> · type <lama> → <baru>"`.
- `WEBHOOK_ENTITIES` spec dapat `derived` kedua: **`spec.source_changed`** (`changed: ["source"]`)
  — menggantikan `spec.updated`, persis pola `spec.stage_changed` (ADR-0100 gotcha 3).

### D8 — UI

- **`ChangeSourceDialog`** (berkas sendiri, `src/src/screens/ChangeSourceDialog.tsx`): pilih
  source tujuan → form field bentuk tujuan ter-prefill `convertPayload` → panel peringatan
  menyebut `dropped` ("Batasan tidak punya padanan di QA — teks lamanya tersimpan di jejak
  konversi") → Simpan.
- Tombol **"Ubah type"** di `SpecDetail`, di samping "Edit". Untuk item yang sudah dimulai
  dialog hanya menawarkan source se-flow dan menyembunyikan formnya (D2).
- `SOURCE_META` dapat entri **`help`** (`label: "Help Center"`, ikon `life-buoy`, tone `info`)
  dan tab backlog dapat pintu **`{ value: "help", label: "Help Center" }`** — tanpa itu item
  hasil konversi ke `help` tampil sebagai "feature brief" dan tak punya tab.
- Sesudah sukses, App mengganti baris di state `backlog` (pola `editSpec`) → lencana, tab, dan
  filter ikut berubah tanpa reload.
- Blok "Jejak konversi" di `SpecDetail` (hanya bila `sourceHistory` terisi): daftar
  `lama → baru · tanggal · oleh`.

## Yang TIDAK dikerjakan

- Tidak menambah tool MCP baru (katalog 17 tool ADR-0099 tetap; konversi bukan operasi yang
  perlu dijangkau agen lewat MCP).
- Tidak mengubah `zSpecSource`, `flowForSource`, `PIPELINES`, atau `Flow` — tak ada flow baru.
- Tidak menyentuh `PATCH /specs/:id`.
- Tidak memindahkan artefak docs/worktree/branch apa pun: konversi murni soal baris DB.

## Rencana test

**shared (murni, cepat):**
- `payloadShapeFor`/`shapeOfPayload`/`payloadMatchesSource` untuk kelima source × tiga bentuk.
- `zCreateSpec` **tetap** menolak `source:"qa"` + payload brief sesudah refactor (regresi SPEC-197).
- `convertPayload`: satu kasus per pasangan bentuk (7 baris tabel D4), memeriksa payload hasil,
  `dropped`, dan `missing`.
- **Round-trip brief→qa→brief**: `context`/`outcome` identik; `constraints` kosong & terdaftar di
  `dropped`; `priority` bergeser sesuai peta 3→2 (diassert eksplisit, bukan diabaikan).
- Catatan pelaksana: rencana langkah-per-langkah yang berlaku ada di
  `docs/superpowers/plans/2026-08-06-spec-546-ubah-type-backlog.md`.
- `zChangeSpecSource` menolak payload yang tak cocok source tujuan.

**server:**
- Konversi item belum-dimulai brief→qa: 200, `source`/`payload`/`objective`/`priority` berubah,
  **`id` tetap**, `dependsOn`/`branchFrom`/`createdAt` tak tersentuh, `sourceHistory` bertambah
  satu entri berisi payload lama.
- Payload tak cocok source tujuan → 400.
- Payload **tidak dikirim** untuk konversi beda bentuk → server memakai `convertPayload`
  (hasilnya sah, bukan 400).
- Item **sudah dimulai** (`baseSha` terisi) → brief→qa **409**; brief→help **200**;
  brief→help **beserta `payload`** → 409.
- Notifikasi `spec-source` lahir; konversi kedua tidak bentrok `key`.
- `spec.source_changed` terpilih `eventTypeFor` untuk `changed: ["source"]`.
- Kontrak sync: `sourceHistory` ∈ `FIELDS.spec`, ∉ `DATE_FIELDS.spec`, ∉ `WEBHOOK_ENTITIES` spec
  `fields`.

**web:**
- `ChangeSourceDialog` merender field bentuk tujuan saat target diganti, memperlihatkan daftar
  `dropped`, dan mengirim payload hasil form.
- `SpecDetail` menampilkan tombol "Ubah type"; item yang sudah dimulai hanya menawarkan source
  se-flow.
- Lencana `help` + tab `help` ada.

Semua dijalankan dengan `--no-file-parallelism` dan `TEST_DATABASE_URL` terpisah.

## Docs yang tersentuh

- `internal/docs/adr/0109-ubah-source-backlog-item.md` (baru) + link di
  `internal/docs/README.md` **dan** `internal/docs/adr/README.md`.
- `internal/docs/architecture/api-contract.md` — endpoint baru.
- `internal/docs/architecture/data-model.md` — kolom `Spec.sourceHistory`.
- `internal/skills/hanoman/SKILL.md` — butir aturan arsitektur.
