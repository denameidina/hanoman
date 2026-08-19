# ADR-0124 — Lampiran multi-berkas per backlog: materialisasi ke direktori sesi, directive aktif, LOCAL-only

Status: accepted · 2026-08-19

## Konteks

Backlog item (`Spec`) hanya membawa teks. Ketiga bentuk payload — `brief`, `qa`, `goal` — adalah
string, dan itulah seluruh konteks yang menyeberang dari manusia ke sesi agen. Satu-satunya jalur
lampiran yang ada di hanoman berdiri di pintu yang **berbeda**: `TicketAttachment` (SPEC-253 ·
[ADR-0062](0062-help-center-tiket-publik-triase.md)) melayani Help Center — pintu **publik dan
anonim** — dan hanya menerima `image/png|jpeg|webp`.

Akibatnya backlog yang lahir langsung dari percakapan manusia (`source` brief/qa/goal) tak punya
jalur lampiran sama sekali. Screenshot bug, mockup UI, log error, contoh CSV, atau PDF spesifikasi
harus ditempel sebagai teks ke payload atau hilang. Sesi agen memulai fase Brainstorm/Audit dengan
konteks **lebih miskin** daripada yang dipegang manusia saat memfilekan item — persis kebalikan
dari premis hanoman, yaitu agen bekerja terhadap sumber kebenaran yang sama dengan manusia.

Dua kendala membentuk keputusan di bawah, dan keduanya baru terlihat setelah menelusuri jalur
sesi apa adanya:

1. **Prompt sesi ditulis SEKALI.** Ia dirakit di `createSession` lalu ditulis ke berkas yang
   di-`cat` saat pane lahir (SPEC-223). Fase bukan proses melainkan giliran di dalam satu sesi
   (ADR-0024) — tak ada runner yang menyuntikkan giliran berikutnya. Jadi daftar lampiran yang
   disematkan ke prompt **basi** begitu operator menambah lampiran berikutnya, dan requirement
   "lampiran yang datang belakangan harus terbaca fase berikutnya" tak bisa dipenuhi prompt saja.
2. **Sandbox produksi hanya mem-mount tiga hal.** `sandboxArgv` (`services/session-sandbox.ts`)
   memasang worktree, phase file, prompt file, dan credential dir — tak ada yang lain.
   `HANOMAN_UPLOAD_DIR` **tak terjangkau** dari dalam sesi produksi. Path absolut ke upload dir
   karena itu akan bekerja di mesin dev dan diam-diam mati di produksi.

## Keputusan

### 1. Model `SpecAttachment` sendiri — bukan memakai ulang `TicketAttachment`

```prisma
model SpecAttachment {
  id         String   @id @default(cuid())
  specId     String
  projectId  String   // denormal — kuota & isolasi per project (cermin TicketAttachment)
  filename   String
  mimeType   String
  size       Int
  storageKey String   // opaque uuid+ext di HANOMAN_UPLOAD_DIR
  createdAt  DateTime @default(now())
  spec       Spec     @relation(fields: [specId], references: [id], onDelete: Cascade)

  @@index([specId])
}
```

Tiket dan backlog adalah **dua domain dengan aturan sync yang berbeda** (§2) dan dua tingkat
kepercayaan yang berbeda (§4). Menumpangkan backlog ke `TicketAttachment` berarti satu tabel
dengan dua FK nullable dan setiap konsumennya harus memutuskan cabang mana yang berlaku — persis
bentuk yang membuat aturan bisa bocor lintas domain tanpa satu pun error.

Berkas biner tetap di `HANOMAN_UPLOAD_DIR` (server-local, di luar repoDir), `storageKey` opaque,
nama asli disanitasi dan hanya untuk tampilan.

### 2. LOCAL-only: TANPA kolom `version` — lampiran backlog tak menyeberang sync

Tanpa `version`, entitas tak pernah masuk changefeed (cermin `LeadFlow`, `WebhookEndpoint`,
`Changelog`). Alasannya berurutan, dan urutannya mengikat:

1. **Byte tetap server-local** (keputusan yang diwarisi dari ADR-0062). Metadata yang menyeberang
   tanpa byte-nya menghasilkan keadaan terburuk dari ketiga pilihan: klien melihat lampiran yang
   tak bisa ia buka, dan agen di mesin itu membaca manifest yang menunjuk berkas yang tak ada.
   `TicketAttachment` lolos dari itu hanya karena ia membeli **fetch-through**
   (`readUploadOrFetch` → `GET /api/sync/attachments/:storageKey`, SPEC-272 ·
   [ADR-0068](0068-lampiran-tiket-masuk-record-sync.md)) — permukaan hub yang harus ikut diperluas
   dan divalidasi ulang (endpoint itu sengaja memvalidasi `storageKey` **milik `TicketAttachment`**
   agar tak jadi pembaca berkas arbitrer di upload dir).
2. **Entitas sync baru menuntut hub di-upgrade lebih dulu.** Hub yang lebih tua menolak entitas
   yang tak dikenalnya, dan push mengendap sebagai 500 yang tertelan senyap — kelas kegagalan yang
   sudah terukur saat kolom `spec.manualDone` lahir ([ADR-0120](0120-tandai-backlog-selesai-manual.md)).
   Fitur yang nilainya lokal tak layak membayar ketergantungan rilis itu.
3. **Nilainya memang lokal.** Sesi agen lahir di mesin yang memegang berkasnya; itulah seluruh
   gunanya fitur ini.

Konsekuensi dinyatakan, bukan disembunyikan: **lampiran hanya terlihat di mesin tempat ia
diunggah.** Jalur bila kelak ia perlu menyeberang sudah jelas — tambah `version` + `updatedAt`,
daftarkan entitas di `DELEGATE`/`FIELDS`/`DATE_FIELDS`/`PARENTS`, dan perluas
`/api/sync/attachments/:storageKey` agar juga menerima `storageKey` milik `SpecAttachment` — dan
itu ADR berikutnya, bukan ini.

### 3. Materialisasi ke `<repoDir>/.worktrees/.attachments/<sessionId>/`, direkonsiliasi penuh

Ini yang menjawab kedua kendala di Konteks sekaligus.

```
<repoDir>/.worktrees/.attachments/<sessionId>/
    INDEX.md                       ← manifest, dibaca ulang agen tiap fase
    keluhan-user.png
    error-2026-08-19.log
```

Letaknya **sekamar dengan `.phases` dan `.decisions`**: di dalam `.worktrees` yang sudah
`.gitignore`, tetapi **di luar** worktree sesi. Konsekuensinya persis yang diinginkan — `git add -A`
milik agen tak mungkin men-stage lampiran ke branch mana pun, dan direktorinya selamat saat
worktree dibangun ulang untuk melanjutkan sesi ([ADR-0084](0084-melanjutkan-sesi-backlog.md)).

**Rekonsiliasi penuh, bukan tambal.** Setiap penulisan menyalin ulang seluruh set dari DB dan
**membuang berkas yang tak lagi punya baris**. Tanpa itu "hapus lampiran" hanya berarti "hilang
dari dashboard" sementara agen masih membacanya — kelas kegagalan yang sama dengan stage yang
maju tanpa faktanya ikut berubah. Ia dipanggil di empat titik: unggah, hapus lampiran, hapus
`Spec`, dan kelahiran sesi.

`SandboxInput` bertambah satu mount **read-only** untuk direktori ini. Tanpa itu fitur ini bekerja
di dev dan mati senyap di produksi (kendala 2). Sesi juga menerima `HANOMAN_ATTACHMENTS_DIR` lewat
jalur env yang sama dengan `HANOMAN_PHASE_FILE`.

### 4. Directive AKTIF dengan path absolut — kebalikan sadar dari perlakuan lampiran tiket

`TicketAttachment` dibingkai `UNTRUSTED_TICKET_DATA_BEGIN/END`, dilarang diikuti sebagai instruksi,
dan **sengaja tak diberi path host** (SPEC-761). Itu benar untuk tiket: asalnya publik dan anonim,
jadi nama berkasnya adalah masukan penyerang.

Lampiran backlog berbeda **secara asal**, bukan secara derajat: ia diunggah operator yang sudah
lolos gate cookie atau agent token ber-`backlog:write` — sumber kepercayaan yang **sama persis**
dengan `Spec.objective` dan `Spec.payload`, yang sudah masuk prompt apa adanya sejak sesi pertama
hanoman. Karena itu di sini directive-nya aktif dan path-nya absolut, memenuhi maksud asli SPEC-286
yang untuk tiket sudah dicabut SPEC-761.

Klausa dipasang di **keempat** pembangun prompt sesi backlog (`startPrompt`, `resumePrompt`,
`continuePrompt`, `startGoalPrompt`) dan memuat tiga hal: daftar lampiran dengan path absolut,
perintah membacanya sebelum fase pertama, dan perintah **membaca ulang `INDEX.md` di awal setiap
fase** — dengan penegasan bahwa daftar di prompt adalah keadaan saat sesi lahir, bukan keadaan
tetap. Poin ketiga itulah yang membuat lampiran yang datang belakangan terbaca.

### 5. Tipe diterima: pasangan mimeType ↔ ekstensi, bukan salah satunya

| mimeType | ekstensi | gerbang |
|---|---|---|
| `image/png` `image/jpeg` `image/webp` | `.png` `.jpg` `.jpeg` `.webp` | magic bytes + decode/re-encode `sharp` |
| `application/pdf` | `.pdf` | magic bytes |
| `text/markdown` | `.md` | UTF-8 sah, tanpa byte NUL |
| `text/plain` | `.txt` `.log` | idem |
| `application/json` | `.json` | idem |
| `text/csv` | `.csv` | idem |

Tipe teks sengaja **tidak** disniff `file-type` — pustaka itu memang tak mengenali teks polos, dan
menuntutnya berarti menolak semua `.md`. Gerbang penggantinya "terdekode UTF-8 & tak memuat NUL",
yang menolak biner yang menyamar sebagai `.txt`.

Batas: **10 MB/berkas**, **10 lampiran/backlog**, **40 MB/backlog**. Registrasi
`@fastify/multipart` global (5 MB/12 berkas, milik lampiran gambar SPEC-816) **tidak** dinaikkan;
batas route ini dipasang per-request, pola yang sudah dipakai `POST /projects/:id/upload`
([ADR-0121](0121-operasi-berkas-ide-explorer.md)).

### 6. API di bawah capability `backlog`; **tidak** masuk katalog MCP

```
GET    /api/specs/:id/attachments            backlog:read
POST   /api/specs/:id/attachments            backlog:write   (multipart, N berkas per request)
GET    /api/specs/:id/attachments/:attId     backlog:read    (byte)
DELETE /api/specs/:id/attachments/:attId     backlog:write
```

`capabilityForRoute` sudah memetakan `top === "specs"` → `rw("backlog")`, dan `rw()` menurunkan
read/write **dari method** — jadi keempatnya masuk domain yang benar tanpa satu baris pun
perubahan di peta capability, dan 403-nya tetap membawa field `need`. Itu properti struktural
yang diuji, bukan kebetulan yang dibiarkan.

**Tidak dipajang di katalog MCP**, dinyatakan eksplisit sesuai preseden
[ADR-0099](0099-mcp-server-hanoman.md): katalog MCP memuat tool yang bisa dipakai agen **tanpa**
manusia. Unggah lampiran adalah tindakan manusia menurut definisinya — berkasnya lahir dari disk
manusia, bukan dari model — dan tool MCP berbentuk JSON sehingga byte biner tak punya representasi
di sana. REST-nya tetap terjangkau agent token yang memegang capability-nya; yang tak dipajang
adalah **tool**-nya, cermin `sessions:write` yang juga tak punya tool.

Multi-unggah bersifat parsial: berkas yang ditolak **tidak** menggagalkan yang lain (pola
`intakeTicket`). Respons memuat `saved[]` dan `rejected[{ filename, reason }]` — penolakan yang
senyap adalah kelas kegagalan tersendiri.

## Konsekuensi

- Lampiran **tidak** menyeberang sync (§2). Item yang sama di mesin lain tampil tanpa lampiran.
- `DELETE /specs/:id` kini harus menghapus **tiga** hal: baris (cascade DB), berkas di upload dir,
  dan direktori materialisasi. Cascade DB saja meninggalkan byte yatim.
- Sesi yang lahir sebelum spec ini tak punya klausa lampiran di prompt-nya; ia mendapatkannya saat
  sesi dilanjutkan/dilahirkan ulang, bukan di tengah giliran.
- `upload-pipeline.ts` kini melayani dua domain, jadi `ticketBytes` berganti nama jadi
  `parentBytes`. Nama lama akan berbohong di call site backlog.

## Alternatif yang ditolak

- **Menyematkan daftar lampiran ke prompt saja.** Gagal memenuhi requirement inti: prompt ditulis
  sekali, jadi lampiran yang datang di tengah sesi tak pernah terlihat.
- **Menyuntikkan teks ke PTY saat lampiran bertambah.** Menulis ke stdin sesi berarti mengetik di
  tengah giliran agen — merusak input yang sedang disusunnya, dan tak ada titik aman yang bisa
  dideteksi dari luar.
- **Menaruh materialisasi DI DALAM worktree.** `git add -A` milik agen akan men-stage-nya ke branch
  sesi, dan lampiran ikut ter-push ke `hanoman/<id>`.
- **Menunjuk langsung ke `HANOMAN_UPLOAD_DIR`.** Tak terjangkau dari sandbox produksi (kendala 2),
  dan membuka seluruh upload dir — termasuk lampiran tiket project lain — ke sesi mana pun.
- **Memakai ulang `TicketAttachment` dengan `specId` nullable** (§1).
