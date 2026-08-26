# ADR-0157 — Papan Tim & status instance terjangkau agen: domain capability `team`, dan tool untuk route `GLOBAL_READ`

Tanggal: 2026-08-26
Status: diterima
**Mengamandemen ADR-0150** ("papan tim adalah permukaan manusia, tertutup bagi agent token") dan **ADR-0065** (kosakata capability)
Melanjutkan **ADR-0155** (batas ada di capability, bukan di ketiadaan tool) · Terkait: ADR-0062/0095 (permukaan MASUK melahirkan backlog dengan capability permukaannya sendiri) · SPEC-405/ADR-0088 (prefix dipetakan tanpa melihat method) · ADR-0110 (`clientRouteAllowed` deny-by-default) · SPEC-947/ADR-0152 (eskalasi kartu)

## Konteks

Audit cakupan MCP sesudah ADR-0155 (258 route, 151 tool) menemukan dua kelompok yang tak punya
tool, dengan sebab yang sama sekali berbeda.

**Pertama, papan Tim.** `/api/tasks*` dan `/api/members*` tak punya entri di `capabilityForRoute`,
jadi keduanya jatuh ke `null` dan `checkAgentCapability` memperlakukannya seperti COOKIE_ONLY.
ADR-0150 menyebut ini keputusan, bukan kelalaian: papan tim adalah pekerjaan manusia. Yang berubah
sejak itu adalah pemakaiannya — kartu tim kini punya jalur resmi menjadi backlog item
(SPEC-947/ADR-0152), dan orang yang memelihara papan itu di praktik adalah agen yang juga menulis
backlognya. Tertutupnya bukan lagi batas yang menjaga apa pun; ia memaksa manusia menyalin kartu ke
backlog dengan tangan.

**Kedua, route `GLOBAL_READ`** — `GET /limits`, `/limits/codex`, `/update`, `/fs/browse`. Keempatnya
sudah terjangkau **setiap agent token yang sah**, tanpa satu pun capability dicentang, sejak
ADR-0065. Yang tak ada hanya tool-nya. Ini persis argumen ADR-0155 sekali lagi: menolak membungkusnya
tak menutup apa pun, ia hanya memaksa agen memakai `curl` tanpa skema — dan `fs/browse` adalah satu-
satunya cara mengetahui path absolut yang sah untuk `repoDir`, jadi tanpanya agen menebak.

Gerbang cakupan `server/test/mcp-coverage.test.ts` tak menangkap keduanya: ia `continue` pada `null`
DAN pada `GLOBAL_READ`. Route yang paling longgar justru yang paling mudah lolos dari gerbangnya.

## Keputusan

### 1. Domain capability BARU: `team`, mencakup `/api/tasks*` DAN `/api/members*`

`team:read` / `team:write` — akses biasa, tanpa pecahan `danger`. Kapabilitas ke-29 dan ke-30.

Satu domain untuk dua permukaan REST, bukan dua: kartu tanpa nama penanggung jawab hanyalah judul.
Memberi `tasks` tanpa `members` menghasilkan agen yang membaca `memberId` tapi tak bisa menyebut
siapa orangnya, dan sebaliknya menghasilkan direktori orang tanpa pekerjaan.

Domain TERSENDIRI, bukan menumpang `backlog`. Sebabnya bukan kerapian: `status` kartu milik MANUSIA
dan bebas dipindah, sementara `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024). Menumpangkan
keduanya berarti satu centang "Backlog — tulis" diam-diam membuka papan orang. Test route menjaga
sisi itu secara eksplisit — token ber-`backlog:write`+`sessions:write`+`projects:write` tetap 403 di
`/api/tasks`.

### 2. Eskalasi kartu tetap `team:write`, meski ia MELAHIRKAN backlog item

`POST /tasks/:id/escalate` membuat `Spec`. Godaannya adalah menuntut `backlog:write` juga —
`capabilityForRoute` hanya bisa mengembalikan satu, jadi itu berarti memindahkannya ke domain
backlog. Ditolak, dengan preseden yang sudah berdiri: `POST /tickets/:id/accept` juga melahirkan
`Spec` dan tetap `support:write` (ADR-0062), begitu pula issue GitHub (ADR-0095). **Permukaan MASUK
memegang capability permukaannya sendiri.**

Yang menahan konsekuensi terjauh bukan gerbang route melainkan `launchPrincipal`: token tanpa
`sessions:write` melahirkan `Spec` **tanpa** `launchApprovedAt`, jadi backlog buatan agen tak bisa
langsung dijalankan. Mekanisme itu sudah ada dan tak disentuh — yang ditambahkan hanya test yang
membuktikannya masih berlaku di jalur baru ini.

### 3. Penulis eskalasi bernama agen, bukan `system`

Fallback `author` di `routes/tasks.ts` mendapat cabang kedua: sesudah `req.user?.email`, bila
`req.agent` ada maka penulisnya `agent:<id token>`, dan barulah `system`.
Tanpa cabang kedua, setiap eskalasi lewat MCP menulis `Tim · system` dan asal-usul backlog tak bisa
ditelusuri persis pada jalur yang baru saja dibuka. `launchPrincipal` di baris berikutnya sudah
membedakan keduanya; penulisnya harus juga.

### 4. Sepuluh tool `team`, dua di antaranya `danger` — dan `danger`-nya ergonomi, bukan gerbang

Daftar/buat/ubah kartu, eskalasi, lepas tautan, daftar/buat/ubah anggota, plus dua penghapusan.
`hanoman_task_delete` & `hanoman_member_delete` bermode `danger` (hilang dari tingkat default)
sambil tetap menuntut `team:write` — domain ini tak punya pecahan `danger`, jadi keduanya masuk
daftar eksplisit `DESTRUCTIVE_BUT_WRITE` (ADR-0155), bukan diam-diam.

Dua sifat papan ini ditulis di deskripsi tool, bukan diserahkan ke dokumen terpisah: (a) `status`
kartu bukan `stage` backlog; (b) `specId` tak bisa dikarang lewat CRUD — tautan lahir hanya dari
eskalasi (ADR-0150 keputusan 5), dan test menjaga agar field itu tak pernah bocor ke skema.

**Tiga keadaan, bukan dua.** `undefined` (jangan sentuh) dan `null` (kosongkan) berbeda di Prisma,
dan route `PATCH /tasks/:id` sengaja mempertahankan bedanya supaya `PATCH {status}` tak menghapus
tanggal yang sudah diisi. Tool yang meruntuhkannya jadi dua keadaan membuat "kosongkan tanggal jatuh
tempo" mustahil lewat MCP. Isyaratnya **string kosong** → `null`, karena JSON Schema `type: "string"`
tak punya null yang bisa dikirim model dengan andal.

### 5. Empat tool untuk route `GLOBAL_READ`, dengan `capability: null` yang kini punya DUA arti

`hanoman_limits`, `hanoman_limits_codex`, `hanoman_update_status`, `hanoman_fs_browse`. Semuanya
mode `read`, jadi ikut terlihat di `--read-only`.

`capability: null` sebelumnya berarti "tool ini tak memanggil `/api` sama sekali" (`hanoman_about`).
Kini ia juga berarti "memanggil, tapi route-nya `GLOBAL_READ`". Arti kedua itu berbahaya bila tak
dijaga — sebuah tool bisa menyentuh route bergerbang sambil mengaku bebas capability, dan yang
menemukannya adalah 403 di lapangan. Karena itu assert baru: **setiap tool ber-`capability: null`
wajib menyentuh route yang `capabilityForRoute` nyatakan `GLOBAL_READ`.**

`POST /update/apply` tetap tanpa tool di tingkat mana pun, termasuk `--danger`: ia me-restart
instance, dan itu tetap tindakan manusia di dashboard (ADR-0088). Test menolak tool `/update` ber-
method selain GET.

### 6. Gerbang cakupan diperketat pada `GLOBAL_READ`

Assert kedua ditambahkan di `mcp-coverage.test.ts`: setiap route `GLOBAL_READ` wajib punya tool atau
terdaftar dikecualikan. Satu-satunya penghuni daftar kecuali dari kelompok ini adalah
`GET /events/ws` — kanal siar, bukan request-response; tool MCP tak punya bentuk untuk aliran yang
tak pernah selesai.

### 7. Yang TETAP tertutup

`/api/tasks*` & `/api/members*` tetap **tak** terdaftar di `clientRouteAllowed`: role `client`
(portal) tetap 403. Papan tim bukan permukaan klien, dan daftar itu deny-by-default sehingga tak ada
baris yang perlu ditulis untuk mempertahankannya.

## Konsekuensi

- Katalog **151 → 165 tool**. Tingkat mode: `--read-only` 62 → **68**, default 117 → **129**,
  `--danger` 151 → **165**.
- Capability **28 → 30**; grid Settings jadi **13 domain**. Tripwire jumlah di
  `agent-tokens.route.test.ts` dinaikkan bersamaan.
- **Aditif bagi token yang sudah terbit** — tak ada yang kehilangan hak. Tapi juga tak ada yang
  otomatis mendapat `team:*`: manusia harus mencentangnya, konsisten dengan ADR-0155 keputusan 4.
- `MCP_TOOL_SCHEMA_VERSION` tetap **1**: menambah tool bersifat aditif menurut kontraknya sendiri.
- Nol endpoint REST baru, nol migration, nol perubahan skema Prisma.
- Naskah publik `docs/agent-integration.md` bertambah baris domain `team` + paragraf `GLOBAL_READ`;
  test kontraknya (`agent-doc-contract.test.ts`) yang memaksanya.

## Yang TIDAK diputuskan di sini

- Membuka permukaan `COOKIE_ONLY` mana pun (crons, webhooks, portal, sync, presence,
  session-events). Semuanya tetap menuntut ADR-nya sendiri.
- Tool untuk `/api/session-results` (activity log) dan permukaan operator `/api/portal-chat*`.
  Keduanya juga jatuh ke `null` hari ini; keduanya butuh pertimbangan sendiri — yang kedua khususnya
  memuat percakapan klien.
- `team:danger`. Tak ada operasi di papan ini yang menjalankan sesuatu di luar proses hanoman;
  membuat pecahan `danger` tanpa operasi semacam itu hanya menambah kotak yang tak berarti.
