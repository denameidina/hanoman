# SPEC-947 — Tim: eskalasi kartu ke backlog hanoman

Tanggal: 2026-08-25
Status: disetujui
Induk: [Tim — papan kanban manusia, linimasa, dan overview lintas project](2026-08-25-tim-kanban-gantt-design.md) (item **C** dari lima)
Sebelumnya: [SPEC-945 — Fondasi Tim](2026-08-25-spec-945-fondasi-tim-design.md) (item **A**) · [SPEC-946 — Papan Tim](2026-08-25-spec-946-papan-tim-design.md) (item **B**)
ADR yang lahir dari spec ini: **ADR-0152**

## Ruang lingkup

Item **C**: satu-satunya jembatan papan tim ke dunia agen. Sebagian tugas manusia ternyata pekerjaan
koding yang seharusnya dikerjakan sesi hanoman; hari ini operator harus memfilekan backlog item
manual lalu mengingat-ingat kaitannya sendiri.

Yang mendarat di sini:

- `POST /api/tasks/:id/escalate` — membuat `Spec` dari kartu dan mengisi `task.specId`.
- `DELETE /api/tasks/:id/escalate` — melepas tautan untuk salah-eskalasi.
- `EscalateDialog.tsx` — operator memilih **source** (`brief` default · `qa` · `audit`), **prioritas**,
  dan **project** bila kartunya belum punya.
- Aksi di kartu: **Eskalasi** saat belum tertaut, **Lepas tautan** saat tertaut (termasuk saat
  tautannya putus).

**Tidak** disentuh di sini: cermin stage di kartu (`spec: { id, stage, priority }` dari join
`specId → Spec.stage`) sudah mendarat utuh di SPEC-945 (`services/tasks-list.ts`) dan lencananya
sudah dirender SPEC-946 (`team-board.tsx`), termasuk keadaan "tautan putus". Item C hanya menambah
**aksi**-nya. Tak satu kolom pun ditambahkan ke `Task`, `Spec`, maupun `Member` — nol migration.

## Masalah

`Task.specId` sudah ada sejak SPEC-945, tetapi **tak ada satu jalur pun yang bisa mengisinya**: ia
sengaja absen dari `zCreateTask` dan `zPatchTask` (ADR-0150 keputusan 5) supaya kartu tak bisa
mengaku tertaut pada `Spec` yang tak pernah menyetujuinya. Kolom itu menunggu satu operasi khusus,
dan inilah operasi itu.

## Keputusan yang mengunci bentuk

| Pertanyaan | Keputusan |
|---|---|
| Bentuk operasi | Operasi khusus `POST`/`DELETE …/escalate`, bukan field `zPatchTask` |
| Idempotensi | Lewat `task.specId`, persis `acceptTicket()` — `created: false` untuk panggilan kedua |
| Task tanpa project | `400` bernama, dan dialog mendahuluinya dengan memaksa pilih project |
| Project dari body | Ditulis **balik** ke `task.projectId` saat kartu belum punya; `400` bila berselisih |
| Source | Tiga: `brief` (default) · `qa` · `audit`. Bukan enam |
| Teks kartu | **Tanpa** penanda `UNTRUSTED_*` |
| Stage | Tak pernah ditulis balik ke `Task` |
| Tautan putus | `POST` membuat `Spec` baru (self-healing); UI menawarkan lepas tautan |

### 1. Operasi khusus, bukan field patch

Preseden repo ini sudah menetapkan bentuknya: `POST /tickets/:id/accept` + `/unlink` (ADR-0062),
`POST /github-issues/:id/accept` (ADR-0095), `POST /specs/:id/source` (ADR-0109), `POST
/specs/:id/done` (ADR-0120). Semuanya punya gerbang & efek sampingnya sendiri, dan semuanya berada
di luar skema patch entity-nya.

`specId` karena itu tetap absen dari `zCreateTask`/`zPatchTask` — tak berubah sedikit pun.

### 2. Idempoten lewat `task.specId`

Cermin `acceptTicket()`: kartu yang sudah tertaut mengembalikan `Spec` yang **sama** dengan
`created: false` dan **HTTP 200**, bukan membuat yang kedua. Panggilan pertama menjawab `201`.

Klien papan bisa mengirim dua kali karena sebab yang paling biasa: klik ganda, atau frame WS yang
memperbarui kartu tepat sebelum jawaban pertama mendarat.

### 3. Retry `P2002` ≤3× di sekitar `nextSpecId`

`nextSpecId(repoDir)` membaca max id lalu menambah satu — TOCTOU murni bila dua eskalasi berjalan
bersamaan (SPEC-197). Ini call site `prisma.spec.create` **kelima** di server; keempat yang lain
(`POST /specs`, `POST /specs/batch`, `acceptTicket`, `acceptGithubIssue`) sudah memakai pola yang
sama, dan menyimpangkan yang kelima berarti satu-satunya yang menjawab `500` untuk keadaan yang
keempat lainnya tangani.

### 4. Task tanpa project ditolak dengan NAMA, dan dialog mendahuluinya

`nextSpecId(repoDir)` butuh repo — `specFloorFrom(listRepoDocs(repoDir))` adalah lantai kedua nomor
SPEC di samping baris DB, dan tanpa repoDir instance kedua mencetak ulang nomor yang sudah dipakai
sebuah dokumen. `repoDir` milik project (`resolveRepoDir(projectId)`), dan `Task.projectId` boleh
`null` (ADR-0150 keputusan 3).

Server menjawab `400 { error: "task tanpa project tak bisa dieskalasi" }`. **Dialog memaksa memilih
project lebih dulu** — tombol kirim mati sampai ada yang dipilih, dengan kalimat yang menyebut
sebabnya. Menolak dengan diam adalah kelas bug SPEC-546.

`repoDir` yang `null` (project ada tapi belum dipetakan ke folder) **tidak** ditolak: itu keadaan
sah untuk project from-scratch, dan `nextSpecId(null)` memang punya perilaku lantai-140-nya sendiri.
Yang ditolak hanya ketiadaan **project**.

### 5. Project dari body ditulis balik ke kartu

Body membawa `projectId?` — dipakai persis untuk kartu tanpa project. Sesudah eskalasi kartu itu
**ikut pindah** ke project tersebut (`task.projectId` diisi), karena kartu yang mengaku "tanpa
project" sambil menunjuk `Spec` di dalam sebuah project adalah kebenaran kedua yang langsung drift:
papan menyaring per-project, dan kartu itu takkan muncul di papan project yang backlog item-nya
sedang dikerjakan.

Bila kartu **sudah** punya project dan body menyebut project **lain** → `400 { error, projectId }`.
Mengabaikannya diam-diam berarti operator menekan "eskalasi ke project X" dan mendapat `Spec` di
project Y tanpa satu pun tanda. Body yang menyebut project yang **sama** diterima (idempoten).

### 6. Tiga source, bukan enam

`zSpecSource` punya enam anggota. Yang ditawarkan dialog tiga:

- `brief` (**default**) — pekerjaan fitur, bentuk payload `brief`.
- `qa` — temuan, bentuk payload `qa`.
- `audit` — pemeriksaan dulu sebelum diputuskan, bentuk payload `brief`.

`goal` dan `no_effort` memakai bentuk `goal` yang mewajibkan `goal` + `done` — dua kalimat yang
hanya operator bisa tulis, dan menurunkannya dari judul kartu berarti mengarang. `help` milik tiket
Help Center dan lencananya menjanjikan asal-usul yang bukan ini. Enum-nya karena itu **eksplisit
tiga**, ditolak `400` di luar itu — bukan `zSpecSource` yang disaring belakangan.

Tak ada pemetaan otomatis dari kartu manusia ke source: berbeda dari tiket yang punya `category`
(SPEC-291) dan issue GitHub yang punya label (SPEC-471), kartu tim tak membawa sinyal apa pun.
Operator yang memilih.

### 7. Bentuk payload mengikuti source, `severity` diturunkan dari prioritas

`zCreateSpec.superRefine` menolak payload yang bentuknya tak cocok source (SPEC-197/546), dan
`deriveSpecFields` membaca bentuk itu. Jalur ini tak lewat `zCreateSpec` (ia menulis Prisma
langsung, seperti keempat call site lain), tetapi baris yang lahir **wajib** lolos boundary mana pun
yang kelak membacanya — `zSpec`, `zPatchSpec`, `zChangeSpecSource`, dan validasi sync.

- `qa` → `{ severity, steps, expected, actual, env: "", constraints: "" }`
- `brief`/`audit` → `{ context, outcome: "", constraints: "", priority }`

`priority` ikut di payload brief karena **`zBriefPayload` mewajibkannya** (`zQaPayload` tidak) —
cermin `acceptGithubIssue`. `severity` diturunkan lewat `severityFromPriority(priority)` dari
`shared/src/spec-source.ts`, **bukan** dihardcode `"major"` seperti dua call site lama: prioritas di
sini datang dari operator di dialog yang sama, jadi menuliskan `major` untuk kartu berprioritas
rendah membuang satu-satunya informasi yang baru saja diberikan. Konversinya sengaja lossy dan sudah
dinyatakan ADR-0109.

### 8. Teks kartu TIDAK dibungkus penanda untrusted

Pembungkus `UNTRUSTED_TICKET_DATA_BEGIN/END` di `acceptTicket()` ada karena tiket Help Center datang
dari **publik**. Kartu tim ditulis anggota tim di dalam dashboard ber-auth — route ini `COOKIE_ONLY`
dua arah (ADR-0110 + ADR-0065, nol entri baru). Memperlakukannya sebagai racun melatih agen
mengabaikan konteks yang justru sengaja diberikan.

Yang ikut ke payload adalah konteks yang dipunyai kartu dan tak dipunyai `Spec`: detail, kolom,
prioritas kartu, assignee (namanya, bukan id), dan rentang tanggal. Plus backlink ke kartunya.

### 9. Stage tak pernah ditulis balik ke `Task`

Menegakkan ADR-0150 keputusan 4 tanpa satu baris baru: cermin `spec: { id, stage, priority }`
dihitung saat baca oleh `buildTasksPage`, dan route eskalasi tak menyentuhnya. Yang dikembalikan
`POST` adalah `taskView(row, spec)` — hasil hitung yang sama, dari `Spec` yang baru saja dibuat.

### 10. Tautan putus: `POST` menyembuhkan, `DELETE` membersihkan

`specId` terisi + `Spec`-nya tak ada = tautan putus (ADR-0150 keputusan 5). Dua jalur:

- `POST` menemukan `specId` terisi tapi `findUnique` kosong → **lanjut membuat `Spec` baru** dan
  menimpa `specId`. Cermin `acceptGithubIssue` (`if (spec) return …`), bukan `acceptTicket` yang
  memakai `spec!` dan karena itu akan mengembalikan `undefined` sebagai `Spec`.
- `DELETE` mengosongkan `specId` apa pun keadaannya, **idempoten** — `200` juga bila sudah `null`.
  Cermin `POST /tickets/:id/unlink`. Non-destruktif: `Spec`-nya dibiarkan, dihapus manual dari
  Backlog bila memang salah.

UI kartu menawarkan **lepas tautan** pada tautan putus, bukan eskalasi ulang: keadaan itu perlu
dilihat operator dulu. Jalur penyembuhan di server tetap ada supaya API tak punya keadaan buntu.

### 11. `launchApprovedBy` diisi operator

`launchPrincipal(req)` (SPEC-761), cermin `POST /tickets/:id/accept`. Tanpa itu `Spec` hasil
eskalasi tak bisa diluncurkan tanpa persetujuan kedua, padahal operator yang menekannya persis
principal yang dibutuhkan.

### 12. Realtime & sync: dua `notifySynced`, nol pendaftaran baru

`notifySynced("spec", …)` **dan** `notifySynced("task", …)`. Keduanya sudah terdaftar di `SYNCED`
sejak SPEC-945/ADR-0150, dan `specId` sudah ada di `FIELDS.task` — tak ada satu pun entri baru di
`sync.ts`. Topik siar `tasks` ikut memancarkan cermin barunya karena `buildTasksPage` adalah
serializer yang sama.

## Arsitektur

```
shared/src/team.ts          + zEscalateTask, ESCALATE_SOURCES, EscalateTaskInput
server/src/services/
  task-escalate.ts          + escalateTask()  — inti, sejajar ticket-accept.ts & github-accept.ts
server/src/routes/tasks.ts  + POST/DELETE /tasks/:id/escalate  (route tipis: parse, 4xx, panggil)
src/src/api/client.ts       + escalateTask(), unlinkTaskSpec()
src/src/screens/
  EscalateDialog.tsx        + dialog (project bila perlu · source · prioritas)
  team-board.tsx            ~ kartu: aksi Eskalasi / Lepas tautan
  TeamScreen.tsx            ~ memegang state dialog + toast
```

`escalateTask()` dipisah dari route dengan alasan yang sama seperti `acceptTicket()`: ia inti yang
akan dipanggil ulang oleh jalur lain (scheduler, lead) tanpa lewat HTTP. Route tetap tipis.

### Kontrak

```
POST /api/tasks/:id/escalate   { source, priority, projectId? }
  -> 201 { created: true,  spec, task }   kartu belum tertaut
  -> 200 { created: false, spec, task }   kartu sudah tertaut ke Spec yang ada
  -> 400 { error }                        task tanpa project & body tanpa projectId
  -> 400 { error, projectId }             body menyebut project lain / project tak ada
  -> 400 { error }                        source di luar tiga / priority di luar kosakata
  -> 404                                  id kartu tak ada

DELETE /api/tasks/:id/escalate
  -> 200 TaskView    (specId: null). Idempoten. Spec TIDAK dihapus.
  -> 404             id kartu tak ada
```

`task` pada respons `POST` adalah `TaskView` penuh — papan memperbaruinya seketika tanpa menunggu
frame WS berikutnya, dan cermin `spec`-nya sudah terisi.

### UI

**Kartu** (`team-board.tsx`) — satu baris, tepat di bawah baris assignee/tanggal:

- `specId` kosong → tombol ghost kecil **`Eskalasi`** (`aria-label` memuat judul, cermin dua Select
  yang sudah ada supaya papan berisi banyak kartu tetap punya nama unik).
- `specId` terisi → lencana yang **sudah ada** (`SPEC-nnn · stage` / `tautan putus`) + tombol ghost
  **`Lepas tautan`**.

Aksi eksplisit, bukan menu: drag mati di keyboard dan layar sentuh, dan alasan itu pula yang sudah
melahirkan dua Select di kartu (SPEC-946).

**Dialog** (`EscalateDialog.tsx`):

- **Project** — hanya dirender bila `task.projectId` null. Tombol kirim mati sampai terisi, dengan
  kalimat sebab: *"Nomor SPEC diambil dari repo project, jadi kartu tanpa project belum bisa
  dieskalasi."*
- **Source** — tiga opsi, label & ikon dari `sourceMeta()` (`source-meta.ts`), bukan literal baru:
  label yang disalin pasti berselisih dengan lencananya di Backlog.
- **Prioritas** — `PRIO_OPTS` yang sudah ada, **prefilled dari `task.priority`**. Kartu sudah
  membawa prioritas; memaksa operator memilih ulang dari nol adalah pertanyaan yang jawabannya
  sudah ada di layar.

Sesudah sukses: toast menyebut nomor SPEC yang lahir, dialog tutup, papan menyegarkan.

## Penanganan galat

| Keadaan | Perilaku |
|---|---|
| Eskalasi ganda | `200 created:false`, `Spec` yang sama |
| Kartu tanpa project | `400` bernama; dialog mendahului dengan gerbang project |
| Project di body ≠ project kartu | `400 { error, projectId }` |
| Project di body tak ada | `400 { error, projectId }` (cermin `refProblem`) |
| `nextSpecId` TOCTOU | retry `P2002` ≤3×, bukan `500` |
| `specId` menunjuk `Spec` terhapus | `POST` membuat baru; `DELETE` mengosongkan |
| `DELETE` pada kartu tak tertaut | `200`, bukan `404` — idempoten |
| Kartu terhapus di mesin lain | `404` |
| `PATCH` memindahkan kartu TERTAUT ke project lain | `400 { error, specId, projectId }` — pintu tulis kedua, ADR-0152 kep. 13 |
| Kartu tertaut tanpa project (dari sync) | eskalasi ulang memulihkannya ke `spec.projectId`, ADR-0152 kep. 14 |
| Jaringan gagal di dialog | Toast galat, dialog **tetap terbuka** dengan isian utuh |

## Test

**Murni** (`shared/src/team.test.ts`): `zEscalateTask` — default `brief`/`sedang`, tolak source
keempat, tolak prioritas di luar kosakata, `projectId` opsional.

**Server** (`server/test/tasks-escalate.route.test.ts`):

- membuat `Spec`, mengisi `task.specId`, `Spec.projectId` = project kartu;
- idempoten: panggilan kedua `200 created:false` dengan id `Spec` yang sama, dan `prisma.spec.count`
  tetap 1;
- kartu tanpa project → `400`; dengan `projectId` di body → `201` **dan `task.projectId` terisi**;
- body menyebut project lain → `400`, `task` tak berubah;
- bentuk payload per source (`qa` punya `severity`, `brief`/`audit` punya `context` + `priority`) —
  di-assert lewat `payloadMatchesSource(source, spec.payload)`, predikat yang sama dengan boundary;
- `severity` mengikuti prioritas, bukan konstanta;
- teks payload **tidak** memuat `UNTRUSTED_`;
- `launchApprovedBy` terisi, `launchApprovedAt` non-null;
- `DELETE` mengosongkan `specId`, `Spec` **masih ada**, panggilan kedua tetap `200`;
- `specId` menunjuk `Spec` terhapus → `POST` membuat yang baru, `GET /tasks` merender `spec: null`
  sebelum dan `spec` terisi sesudah;
- `404` untuk id kartu yang tak ada, pada kedua method.

**UI** (`src/test/team-escalate.test.tsx`, jsdom):

- kartu tanpa `specId` merender tombol Eskalasi; kartu ber-`specId` merender Lepas tautan;
- dialog pada kartu tanpa project: tombol kirim **disabled** sampai project dipilih — unit test
  aturan takkan menangkap gerbang yang hanya hidup di JSX (pelajaran SPEC-946: `from`/`to` tertukar
  lolos unit test aturannya sendiri);
- submit memanggil `api.escalateTask` dengan `{ source, priority, projectId }` yang benar;
- prioritas prefilled dari kartu;
- galat API → dialog tetap terbuka.

## Dokumen yang tersentuh

- `internal/docs/adr/0152-eskalasi-kartu-tim-ke-backlog.md` (baru) + `internal/docs/adr/README.md`
- `internal/docs/architecture/api-contract.md` — blok Papan tim
- `internal/docs/README.md` — index
- `internal/skills/hanoman/SKILL.md` — paragraf Papan Tim
