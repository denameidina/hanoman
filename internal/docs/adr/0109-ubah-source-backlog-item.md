# ADR-0109 — Ubah type/source backlog item: operasi khusus, gerbang mengunci flow, jejak berpayload

- Status: accepted
- Tanggal: 2026-08-06
- Konteks: SPEC-546
- Menegakkan: ADR-0018/0019 (turunan vs tersimpan) · ADR-0038 · ADR-0045 · ADR-0064 · ADR-0090 · ADR-0100
- Tidak mencabut apa pun.

## Konteks

`Spec.source` ditetapkan sekali saat `POST /specs` dan tak pernah bisa diubah — `PATCH /specs/:id`
hanya menerima title/priority/payload/branchFrom/stage/dependsOn/autoMerge. Type sering salah
tebak di awal (laporan yang masuk sebagai `brief` ternyata bug; item Help Center ternyata fitur
baru), dan satu-satunya jalan hari ini adalah hapus lalu buat ulang: nomor SPEC hilang,
riwayat/notifikasi/dependency putus, dan jejak triase — yang menurut SPEC-520 hanya hidup di prosa
`payload` — ikut hilang.

Objective SPEC-546 menyebut enam source; **`cross-audit` sudah tak ada** (dicabut SPEC-384 /
ADR-0092 bersama error monitoring). Yang berlaku adalah `zSpecSource` =
`brief`·`qa`·`audit`·`help`·`goal`.

## Keputusan

### 1. Operasi khusus `POST /specs/:id/source`, bukan field `PATCH`

`PATCH /specs/:id` sudah memikul lima gerbang berbeda (edit konten SPEC-186, revert stage
ber-dry-run + `confirmDelete`, branch, `dependsOn`, `autoMerge`), dan `source` punya gerbang yang
berbeda lagi (butir 2). **ADR-0064** sudah menetapkan bentuk ini untuk perubahan sejenis: rename
`Project.id` adalah operasi khusus, bukan field PATCH, justru karena ia punya gerbang & efek
sampingnya sendiri. Konversi source adalah spesies yang sama.

Body: `{ source, payload? }`. `payload` **opsional** — tak dikirim berarti server memakai
`convertPayload`, sehingga panggilan agen lewat REST tetap menghasilkan baris yang sah alih-alih
400. Permintaan `source` yang sama dengan yang sekarang dijawab **400**: no-op yang diterima
diam-diam akan menulis baris jejak "brief → brief" yang mengotori satu-satunya alasan kolom jejak
itu ada. Capability tak berubah: `/specs/*` sudah dipetakan `backlog:read|write` per method
(`agent-capabilities.ts`).

### 2. Gerbang mengunci FLOW, bukan label

| Keadaan | Konversi |
|---|---|
| Belum dimulai (`stage === "brainstorming"` ∧ `baseSha === null`) | ke source mana pun; `payload` boleh diganti |
| Sudah dimulai | hanya bila `flowForSource(lama) === flowForSource(baru)`; `payload` ditolak |

Hari ini kelompok se-flow satu-satunya adalah `{brief, help}` (keduanya → `feature`); `qa`,
`audit`, `goal` masing-masing flow sendiri.

Alasannya: yang dilindungi gerbang SPEC-186 adalah **pekerjaan yang sedang berjalan**, bukan
label. Sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke `$HANOMAN_PHASE_FILE`;
memindahkan item ber-flow `feature` (lima fase) ke `goal` (dua fase) meninggalkan berkas fase yang
**tak akan pernah** memuaskan `phasesComplete` flow barunya — bentuk yang sama dengan kelas bug
SPEC-433, di mana sebuah keadaan secara struktural tak bisa tercapai. Sebaliknya `brief → help`
tak mengubah apa pun yang dipegang sesi: flow sama, bentuk payload sama, prompt sama. Menguncinya
berarti menolak justru kasus yang paling sering terjadi hanya karena sesinya kebetulan sudah
pernah jalan.

`payload` tetap terkunci untuk item yang sudah dimulai — itu SPEC-186 apa adanya. Karena konversi
se-flow selalu se-bentuk, tak ada field yang perlu diisi operator, jadi larangan itu tak memotong
apa pun.

### 3. `Spec.sourceHistory Json?` — kolom, append-only, **membawa payload lama**

`[{ at, from, to, by, payload }]`. Kolom, bukan turunan: aturan ADR-0090 bukan "selalu turunkan"
melainkan *bisakah dihitung ulang dari sumber lain* — kapan sebuah baris berganti type tidak bisa.

`payload` **bentuk lama disimpan utuh**, dan itulah kunci yang membuat konversi beda-bentuk aman:
field yang tak punya padanan di bentuk baru tidak lenyap, ia pindah ke jejak. Janji SPEC-546
("tanpa kehilangan riwayat") karena itu harfiah, bukan kira-kira.

**Tanpa cap.** Konversi adalah tindakan operator manual yang digerbangi butir 2; kolomnya cermin
`dependsOn`/`payload` yang juga tak dibatasi. Cap yang diam-diam membuang justru mematahkan
satu-satunya alasan kolom ini ada.

Migration **additif** (satu `ALTER TABLE "Spec" ADD COLUMN "sourceHistory" JSONB` nullable,
ditulis tangan, tanpa backfill — sebelum SPEC-546 konversi memang tak mungkin, jadi NULL berarti
persis "belum pernah dikonversi").

### 4. Peta konversi payload: field-ke-field, **tak pernah menyambung prosa**

`convertPayload(to, payload) → { payload, dropped, missing }`, MURNI, di `@hanoman/shared`.
Dipakai UI untuk prefill form **dan** server sebagai default — pola `resolveAutoMerge`/
`flowForSource`.

| Dari → ke | Pemetaan | `dropped` |
|---|---|---|
| brief-shape → brief-shape | apa adanya | — |
| brief-shape → qa | `actual←context`, `expected←outcome`, `severity←sev(priority)`, `fromAudit` ikut | `constraints` |
| qa → brief-shape | `context←actual`, `outcome←expected`, `priority←prio(severity)`, `fromAudit` ikut | `steps`, `env` |
| brief-shape → goal | `goal←outcome ‖ context`, `constraints`/`priority` apa adanya | `context` (hanya bila `outcome` terisi), `fromAudit` |
| goal → brief-shape | `outcome←goal`, `constraints`/`priority` apa adanya | `done` |
| qa → goal | `goal←expected`, `priority←prio(severity)` | `steps`, `actual`, `env`, `fromAudit` |
| goal → qa | `expected←goal`, `severity←sev(priority)` | `done`, `constraints` |

Menyambung dua field jadi satu membuat data yang tak bisa diurai lagi, sementara operator toh ada
di depan form. Field tanpa padanan masuk `dropped` (hanya yang benar-benar terisi — memperingatkan
soal field kosong itu kebisingan), diberitahukan di dialog, dan tersimpan utuh di `sourceHistory`.
`missing` **dihitung** dari `SHAPE_REQUIRED`, bukan didaftar per-pasangan.

`priority ↔ severity` memakai aturan yang **sudah** dipakai `deriveSpecFields`
(`minor → sedang`, selain itu `tinggi`) dan inversnya (`tinggi → major`, selain itu `minor`).
Peta itu 3→2 nilai, jadi **prioritas tidak round-trip** (`rendah → minor → sedang`). Dinyatakan
dan diuji, bukan disembunyikan; yang round-trip adalah prosanya.

### 5. Turunan dihitung ulang; `author` tidak disentuh

`deriveSpecFields(sourceBaru, payloadBaru, …)` dijalankan ulang → `objective` & `priority` selalu
cerminan bentuk yang berlaku (konversi ke `qa` memindahkan kendali prioritas ke `severity`;
konversi ke `goal` membuat objective = goal-nya). `author` (`QA · …`, `Audit · …`, `Goal · …`)
**tetap**: ia menjawab *siapa yang memfilekan item ini dan lewat pintu mana* — fakta historis,
cermin `createdAt` ADR-0090 yang tak pernah ditulis route. Lencana type yang dilihat operator
memang berpindah.

### 6. Jejak keluar: notifikasi + peristiwa webhook turunan

`Notification` `type: "spec-source"`, `key: "source:<specId>:<n>"` (n = panjang `sourceHistory`
sesudah append → unik & deterministik, pola `recordCompletion`). `WEBHOOK_ENTITIES` spec dapat
derived kedua **`spec.source_changed`** (`changed: ["source"]`) yang menggantikan `spec.updated` —
pola `spec.stage_changed` (ADR-0100).

## Gotcha wajib

1. **`sourceHistory` WAJIB masuk `FIELDS.spec`** — `upsert` yang tak menyebut sebuah kolom tetap
   berhasil, jadi kolom yang terlewat mendarat sebagai null palsu di tiap client tanpa satu pun
   error (kelas gagal-senyap ADR-0090/0093/0094/0105). Ia **bukan** `DATE_FIELDS`: `at` hidup di
   dalam JSON-nya, kolomnya sendiri bukan `DateTime`.
2. **`sourceHistory` TIDAK boleh masuk `WEBHOOK_ENTITIES.fields`** — ia membawa payload, dan
   `payload` memang sudah sengaja dikecualikan dari allowlist itu (pagar data sensitif).
3. **Predikat bentuk payload harus tetap SATU.** Ia kini di `shared/src/spec-source.ts` dan
   dipanggil `zCreateSpec.superRefine` maupun `zChangeSpecSource`. Menyalinnya kembali ke salah
   satu sisi mengembalikan kelas bug "satu definisi, N call site" (SPEC-431/448/475/481).
4. **Flow tak punya salinan yang perlu ikut diperbarui.** `flowForSource` dibaca *saat sesi lahir*
   oleh ketiga pemanggilnya (`TerminalScreen`, `scheduler/engine.ts`, `lead/apply.ts`), dan
   `SchedulerQueueItem.source` adalah asal *checker* (`backlog`|`triase`), bukan source Spec.
   Konversi karena itu otomatis mengubah flow — yang perlu dijaga hanya sejarah fase (butir 2).
5. **`convertPayload` mengambil bentuk dari PAYLOAD-nya, bukan dari `source` lama.** Baris yang
   `source` dan `payload`-nya sudah terlanjur berselisih (mis. datang dari klien versi lama lewat
   sync) tetap dikonversi berdasar isi yang benar-benar ada.
6. **Dialog UI mencerminkan gerbang server, bukan menggantikannya.** Server tetap menegakkan
   keduanya (`checkSourceChange` memeriksa bentuk payload lagi walau `zChangeSpecSource` sudah) —
   jalur non-HTTP tak boleh bisa menyelundupkan bentuk salah.
7. **`sourceHistory` masuk `zSpec` dengan `.default([])`**, jadi setiap literal `Spec` di test
   wajib menyebutnya (kolom DB-nya `Json?` → baris lama mengirim `null`; pemakai UI menulis
   `spec.sourceHistory ?? []`, cermin `blockedBy`).

## Alternatif yang ditolak

- **Field `source` di `PATCH /specs/:id`** — menumpuk gerbang yang berbeda ke handler yang sudah
  memikul lima; ADR-0064 sudah memutuskan arah sebaliknya untuk kasus sejenis.
- **Terkunci total sesudah item dimulai** — menolak `help → brief`, kasus yang paling sering
  disebut, padahal konversi itu tak menyentuh apa pun yang dipegang sesi.
- **Bebas sepenuhnya sesudah item dimulai** — meninggalkan berkas fase yang tak akan pernah
  memuaskan flow barunya (kelas SPEC-433).
- **Jejak lewat notifikasi saja** — notifikasi bisa dihapus operator dan tak menyeberang sync;
  jejak yang jadi dasar audit tak boleh bergantung pada baris yang boleh dibuang.
- **Menyambung prosa yang tak punya padanan ke satu field** — menghasilkan data yang tak bisa
  diurai lagi; `dropped` + `sourceHistory` menjawab kebutuhan yang sama tanpa merusak bentuk.
- **Cap jumlah entri jejak** — cap yang diam-diam membuang mematahkan janji audit yang jadi alasan
  kolomnya ada; konversi manual & digerbangi tak punya jalur pertumbuhan yang realistis.
