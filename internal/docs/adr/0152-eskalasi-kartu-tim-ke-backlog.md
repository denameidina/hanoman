# ADR-0152 — Eskalasi kartu papan tim ke backlog: operasi khusus, idempoten, dan tanpa pembungkus untrusted

- Status: berlaku
- Tanggal: 2026-08-25
- SPEC: SPEC-947
- Memperluas: ADR-0150 (fondasi papan tim — `Task.specId` yang sengaja tak bisa ditulis lewat CRUD)
- Menegakkan: ADR-0062 (accept tiket → Spec), ADR-0095 (accept issue GitHub), ADR-0109 (`payloadMatchesSource` & `severityFromPriority` satu definisi), ADR-0110 & ADR-0065 (deny-by-default dua arah), ADR-0090 (stage dihitung saat baca), ADR-0119 (tombstone)
- Tidak mencabut apa pun

## Konteks

`Task.specId` lahir bersama papan tim (ADR-0150 keputusan 5) tetapi **tak ada satu jalur pun yang
bisa mengisinya**: ia sengaja absen dari `zCreateTask` maupun `zPatchTask`, supaya kartu tak bisa
mengaku tertaut pada `Spec` yang tak pernah menyetujuinya. Kolom itu menunggu satu operasi khusus.

Kebutuhannya nyata: sebagian tugas manusia di papan ternyata pekerjaan koding yang seharusnya
dikerjakan sesi hanoman, dan hari ini operator memfilekan backlog item manual lalu mengingat-ingat
kaitannya sendiri.

ADR ini memutuskan operasi itu — permukaannya, idempotensinya, dan apa yang ikut ditulis.

## Keputusan

**1. Operasi khusus `POST`/`DELETE /api/tasks/:id/escalate`, bukan field `zPatchTask`.**

Preseden repo ini sudah menetapkan bentuknya: `POST /tickets/:id/accept` + `/unlink` (ADR-0062),
`POST /github-issues/:id/accept` (ADR-0095), `POST /specs/:id/source` (ADR-0109), `POST
/specs/:id/done` (ADR-0120). Semuanya punya gerbang & efek sampingnya sendiri, dan semuanya berada
di luar skema patch entity-nya.

`specId` karena itu tetap absen dari CRUD `Task` — tak berubah sedikit pun oleh ADR ini.

**2. Idempoten lewat `task.specId`.**

Cermin `acceptTicket()`: kartu yang sudah tertaut mengembalikan `Spec` yang **sama** dengan
`created: false` dan **HTTP 200**; panggilan pertama menjawab `201`. Klien papan bisa mengirim dua
kali karena sebab yang paling biasa — klik ganda, atau frame WS yang memperbarui kartu tepat
sebelum jawaban pertama mendarat.

**3. Retry `P2002` ≤3× di sekitar `nextSpecId`.**

`nextSpecId(repoDir)` membaca max id lalu menambah satu — TOCTOU murni bila dua eskalasi berjalan
bersamaan (SPEC-197). Ini call site `prisma.spec.create` **kelima** di server; keempat yang lain
sudah memakai pola yang sama, dan menyimpangkan yang kelima berarti satu-satunya yang menjawab
`500` untuk keadaan yang keempat lainnya tangani.

**4. Kartu tanpa project ditolak dengan NAMA, dan dialog mendahuluinya.**

`nextSpecId(repoDir)` butuh repo — `specFloorFrom(listRepoDocs(repoDir))` adalah lantai kedua nomor
SPEC di samping baris DB, dan tanpa repoDir instance kedua mencetak ulang nomor yang sudah dipakai
sebuah dokumen. `repoDir` milik project (`resolveRepoDir(projectId)`), dan `Task.projectId` boleh
`null` (ADR-0150 keputusan 3).

Server menjawab `400` dengan pesan yang menyebut sebabnya. Dialog **memaksa memilih project lebih
dulu** — tombol kirim mati sampai ada yang dipilih, dengan kalimat sebab yang **tertulis di layar**.
Tombol mati tanpa penjelasan adalah bentuk lain dari menolak dengan diam (kelas bug SPEC-546).

`repoDir` yang `null` — project ada tapi belum dipetakan ke folder — **tidak** ditolak: itu keadaan
sah untuk project from-scratch, dan `nextSpecId(null)` memang punya perilaku lantai-140-nya sendiri.
Yang ditolak hanya ketiadaan **project**.

**5. `projectId` di body ditulis BALIK ke kartu.**

Body membawa `projectId?`, dipakai persis untuk kartu tanpa project. Sesudah eskalasi kartu itu
**ikut pindah** ke project tersebut. Alasannya bukan kenyamanan: kartu yang mengaku "tanpa project"
sambil menunjuk `Spec` di dalam sebuah project adalah kebenaran kedua yang langsung drift — papan
menyaring per-project, jadi kartu itu takkan pernah muncul di papan project yang backlog item-nya
sedang dikerjakan.

Bila kartu **sudah** punya project dan body menyebut project **lain** → `400 { error, projectId }`.
Mengabaikannya diam-diam berarti operator menekan "eskalasi ke project X" dan mendapat `Spec` di
project Y tanpa satu pun tanda. Body yang menyebut project yang **sama** diterima.

**6. Tiga source, enum EKSPLISIT — bukan `zSpecSource` yang disaring belakangan.**

`brief` (default) · `qa` · `audit`. `goal` dan `no_effort` memakai bentuk payload `goal` yang
mewajibkan `goal` + `done` — dua kalimat yang hanya operator bisa tulis, dan menurunkannya dari
judul kartu berarti mengarang. `help` milik tiket Help Center dan lencananya menjanjikan asal-usul
yang bukan ini.

Enum eksplisit `ESCALATE_SOURCES` karena source **ketujuh** yang kelak ditambahkan ke `zSpecSource`
tak boleh diam-diam menjadi tujuan eskalasi.

Tak ada pemetaan otomatis dari kartu ke source: berbeda dari tiket yang punya `category`
(SPEC-291) dan issue GitHub yang punya label (SPEC-471), kartu tim tak membawa sinyal apa pun.
Operator yang memilih.

**7. Bentuk payload mengikuti source; `severity` DITURUNKAN dari prioritas.**

`zCreateSpec.superRefine` menolak payload yang bentuknya tak cocok source (SPEC-197/546), dan
`deriveSpecFields` membaca bentuk itu. Jalur ini menulis Prisma langsung seperti keempat call site
lain, tetapi baris yang lahir **wajib** lolos boundary mana pun yang kelak membacanya — `zSpec`,
`zPatchSpec`, `zChangeSpecSource`, dan validasi sync.

- `qa` → `{ severity, steps, expected, actual, env, constraints }`
- `brief`/`audit` → `{ context, outcome, constraints, priority }`

`priority` ikut di payload brief karena **`zBriefPayload` mewajibkannya** (`zQaPayload` tidak) —
cermin `acceptGithubIssue`. `severity` dihitung `severityFromPriority(priority)` (ADR-0109),
**bukan** dihardcode `"major"` seperti dua call site lama: prioritas di sini datang dari operator di
dialog yang sama, jadi menuliskan `major` untuk kartu berprioritas rendah membuang satu-satunya
informasi yang baru saja diberikan. Konversinya lossy dan sudah dinyatakan ADR-0109.

**8. Teks kartu TIDAK dibungkus penanda untrusted.**

Pembungkus `UNTRUSTED_TICKET_DATA_BEGIN/END` di `acceptTicket()` ada karena tiket Help Center datang
dari **publik**. Kartu tim ditulis anggota tim di dalam dashboard ber-auth — route ini `COOKIE_ONLY`
dua arah (keputusan 12). Memperlakukannya sebagai racun melatih agen mengabaikan konteks yang justru
sengaja diberikan.

Yang ikut ke payload adalah konteks yang dipunyai kartu dan tak dipunyai `Spec`: detail, kolom
papan, prioritas kartu, assignee (**namanya**, bukan id), rentang tanggal, dan backlink ke kartunya.

**9. Stage tak pernah ditulis balik ke `Task`.**

Menegakkan ADR-0150 keputusan 4 tanpa satu baris baru: cermin `spec: { id, stage, priority }`
dihitung saat baca oleh `buildTasksPage`, dan route eskalasi tak menyentuhnya. Yang dikembalikan
`POST` adalah `taskView(row, spec)` — hasil hitung yang sama, dari `Spec` yang baru saja dibuat,
sehingga papan tak perlu menunggu frame WS berikutnya untuk memperlihatkan lencananya.

**10. Tautan putus: `POST` menyembuhkan, `DELETE` membersihkan.**

`specId` terisi + `Spec`-nya tak ada = tautan putus (ADR-0150 keputusan 5).

- `POST` yang menemukan `specId` terisi tapi `findUnique` kosong **lanjut membuat `Spec` baru** dan
  menimpa `specId`. Cermin `acceptGithubIssue` (`if (spec) return …`), **bukan** `acceptTicket`
  yang memakai `spec!` — pola itu akan mengembalikan `undefined` sebagai `Spec` dan meledak di
  pemanggil, bukan di tempat sebabnya. API tak boleh punya keadaan buntu.
- `DELETE` mengosongkan `specId` apa pun keadaannya dan **idempoten**: kartu yang belum tertaut
  menjawab `200`, bukan `404` — "tak ada yang perlu dilepas" bukan galat. Cermin `POST
  /tickets/:id/unlink`, dan **non-destruktif**: `Spec`-nya dibiarkan, dihapus manual dari Backlog
  bila memang salah.

UI kartu menawarkan **lepas tautan** pada tautan putus, bukan eskalasi ulang: operator perlu
melihat keadaan itu dulu. Jalur penyembuhan di server tetap ada supaya API-nya sendiri konsisten.

**11. `launchApprovedBy` diisi operator.**

`launchPrincipal(req)` (SPEC-761), cermin `POST /tickets/:id/accept`. Tanpa itu `Spec` hasil
eskalasi tak bisa diluncurkan tanpa persetujuan kedua, padahal operator yang menekannya persis
principal yang dibutuhkan. Tanpa principal — jalur tanpa cookie — nilainya tetap `null` dan
`author` jatuh ke `Tim · system`: stempel yang tak ada tak boleh dikarang.

**12. Nol pendaftaran baru, dan itu KEPUTUSAN.**

Tak ada entri di `capabilityForRoute` maupun `clientRouteAllowed`: keduanya deny-by-default
(ADR-0065 · ADR-0110), jadi eskalasi tertutup bagi agent token **dan** role `client` tanpa satu
baris pun. Menambahkannya justru MEMBUKA.

Tak ada entri baru di `sync.ts`: `task` & `spec` sudah di `SYNCED`, dan `specId` sudah di
`FIELDS.task` sejak ADR-0150. Yang dipanggil hanya `notifySynced("spec", …)` **dan**
`notifySynced("task", …)` — keduanya, karena satu operasi mengubah dua baris.

Nol kolom, nol migration.

**13. `PATCH /tasks/:id` menegakkan invariant keputusan 5 — pintu tulis KEDUA ikut dijaga.**

Keputusan 5 menetapkan "kartu tertaut hidup di project `Spec`-nya", dan route eskalasi menjaganya.
`PATCH` menulis kolom yang **sama** tanpa mengetahuinya, jadi tanpa gerbang kedua invariant itu
hanya berlaku di satu pintu. Terukur: kartu ber-`specId` di `p1` di-`PATCH {projectId:"p2"}` →
`200`, dan `buildTasksPage` men-join `specId` **tanpa predikat project**, sehingga papan project
`p2` merender lencana `SPEC-nnn` milik backlog item `p1` — keputusan "siapa mengerjakan apa"
diambil dari lencana itu. `TaskModal` mengirim `projectId` di **setiap** simpan, jadi jaraknya satu
klik, bukan skenario API-only.

Kartu tertaut karena itu menjawab `400 { error, specId, projectId }` untuk `projectId` yang berbeda
— termasuk `null`. Pagarnya **lepas begitu tautannya dilepas**; kalau tidak, "salah-eskalasi" jadi
kandang. Kartu **tak** tertaut tetap bebas berpindah project seperti sebelumnya.

Ini kelas jebakan yang sama persis dengan dua jalur tulis `order` (ADR-0151): satu invariant, dua
handler, dan yang kedua tak pernah diberi tahu.

**14. Cabang idempoten MEMULIHKAN kartu tertaut yang project-nya kosong.**

Keadaan itu hanya bisa lahir dari sync atau dari baris yang sudah ada sebelum keputusan 13. Eskalasi
ulang mengembalikan kartu ke `spec.projectId` — **bukan** ke `opts.projectId` yang diminta
pemanggil: tautannya sudah menetapkan jawabannya, dan memakai project yang diminta akan memindahkan
kartu ke tempat yang `Spec`-nya tak pernah tinggali. Tanpa ini cabang idempoten menjawab `200`,
dialog menampilkan toast sukses, dan kartunya tidak bergerak — "diterima lalu tak terjadi apa-apa",
kelas yang ADR-0094 keputusan 2 larang. Bila project-nya sudah cocok, tak ada tulisan sama sekali.

## Konsekuensi

- **Kartu tanpa project BERPINDAH project saat dieskalasi.** Efek yang dinyatakan (keputusan 5),
  bukan tersembunyi: dialog menyebut project yang dipilih, dan `TaskView` yang dikembalikan `POST`
  membawa `projectId` barunya sehingga papan langsung memperlihatkannya.
- **`Spec` hasil eskalasi tak punya penanda asal-usul terstruktur.** Yang membedakannya hanya
  `author: "Tim · <email>"` dan backlink di `objective` + `payload`. Kolom `Task.specId` adalah
  satu-satunya tautan yang bisa di-query, dan arahnya satu — dari kartu ke `Spec`. Menambahkan
  arah balik berarti kolom di `Spec`, dan larangan itu (ADR-0150 keputusan 1) tetap berlaku.
- **Menghapus `Spec` meninggalkan tautan putus**, sesuai desain. Tak ada sweep pembersih: keadaan
  itu jujur, murah untuk ditampilkan, dan operator punya aksi untuk membereskannya.
- **Webhook keluar tetap tak memancarkan apa pun** untuk `task` (ADR-0150 keputusan 11 tak
  berubah). Eskalasi memancarkan event `spec` seperti biasa lewat jalur `Spec`-nya.
