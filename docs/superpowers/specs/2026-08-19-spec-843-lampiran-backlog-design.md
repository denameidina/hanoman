# SPEC-843 · Lampiran multi-berkas per backlog sebagai konteks agen

Tanggal: 2026-08-19 · Flow: feature · Doc-of-record: ADR-0124

## Masalah

Backlog item (`Spec`) hanya membawa teks: payload `brief`/`qa`/`goal`. Satu-satunya jalur lampiran
di hanoman ada di Help Center (`TicketAttachment`, SPEC-253/ADR-0062) — dan itu pintu **publik**,
bukan pintu operator. Backlog yang lahir langsung dari percakapan manusia tak punya jalur itu sama
sekali: screenshot bug, mockup UI, log error, contoh CSV, atau PDF spesifikasi harus ditempel
sebagai teks ke payload atau hilang. Sesi agen karena itu memulai fase pertamanya dengan konteks
yang lebih miskin daripada yang dipegang manusia saat memfilekan item.

Yang dikejar spec ini bukan "ada tombol unggah", melainkan **lampiran benar-benar dibaca agen** —
termasuk lampiran yang datang setelah sesi berjalan.

## Keputusan bentuk

### 1. Model `SpecAttachment` — LOCAL-only, tanpa `version`

```prisma
model SpecAttachment {
  id         String   @id @default(cuid())
  specId     String
  projectId  String   // denormal — kuota & isolasi per project (cermin TicketAttachment)
  filename   String   // nama asli tersanitasi (display saja)
  mimeType   String
  size       Int
  storageKey String   // nama berkas opaque di HANOMAN_UPLOAD_DIR (uuid+ext)
  createdAt  DateTime @default(now())
  spec       Spec     @relation(fields: [specId], references: [id], onDelete: Cascade)

  @@index([specId])
}
```

**Tidak ikut sync**, sengaja — tanpa kolom `version`, jadi ia tak pernah masuk changefeed (cermin
`LeadFlow`, `WebhookEndpoint`, `Changelog`). Alasannya tiga, dan urutannya mengikat:

1. Constraint spec ini menetapkan **byte tetap server-local**. Metadata yang menyeberang tanpa
   byte-nya menghasilkan keadaan paling buruk dari ketiga pilihan: klien melihat lampiran yang
   tak bisa ia buka, dan agennya melihat manifest yang menunjuk berkas yang tak ada di mesin itu.
   `TicketAttachment` menghindari itu dengan fetch-through (`readUploadOrFetch` →
   `GET /api/sync/attachments/:storageKey`) — permukaan hub yang harus ikut diperluas, dan itu
   scope tersendiri.
2. Entitas sync baru **menuntut hub di-upgrade lebih dulu**: hub yang lebih tua menolak entitas
   yang tak dikenalnya dan push mengendap sebagai 500 yang tertelan senyap (kelas kegagalan yang
   sudah terukur saat `spec.manualDone` lahir). Fitur yang nilainya lokal tak layak membayar
   ketergantungan rilis itu.
3. Nilai fitur ini memang lokal: sesi agen lahir di mesin yang sama dengan berkasnya.

Konsekuensi yang dinyatakan, bukan disembunyikan: lampiran hanya terlihat di mesin tempat ia
diunggah. Bila kelak ia perlu menyeberang, jalurnya sudah jelas (tambah `version`+`updatedAt`,
daftarkan entitas, perluas `/api/sync/attachments` agar juga memvalidasi `SpecAttachment`) —
dan itu ADR berikutnya, bukan ini.

### 2. Tipe & batas

| mimeType | ekstensi | perlakuan |
|---|---|---|
| `image/png` `image/jpeg` `image/webp` | `.png` `.jpg`/`.jpeg` `.webp` | decode+re-encode sharp (buang metadata & payload tempelan) |
| `application/pdf` | `.pdf` | sniff magic bytes |
| `text/markdown` | `.md` | wajib UTF-8 sah, tanpa byte NUL |
| `text/plain` | `.txt` `.log` | idem |
| `application/json` | `.json` | idem |
| `text/csv` | `.csv` | idem |

Gerbangnya **pasangan** mimeType ↔ ekstensi, bukan salah satunya: `.md` ber-mime `image/png`
ditolak, begitu pula sebaliknya. Berkas ber-magic-bytes (gambar, pdf) tetap disniff `file-type`
dan harus cocok dengan mime yang diklaim klien — jalur yang sudah terbukti di `upload-pipeline.ts`.
Tipe teks sengaja **tidak** disniff (`file-type` memang tak mengenali teks polos); gerbangnya
"terdekode UTF-8 & tak memuat NUL", yang menolak biner menyamar sebagai `.txt`.

Batas: **10 MB/berkas**, **10 lampiran/backlog**, **40 MB/backlog**. Batas `@fastify/multipart`
global (5 MB/12 berkas, milik lampiran gambar SPEC-816) dinaikkan **per-request** di route ini
saja — pola yang sudah dipakai `POST /projects/:id/upload` (ADR-0121).

Nama berkas disanitasi (`safeFilename`, sudah ada); `storageKey` tetap opaque uuid+ext.

### 3. Materialisasi: satu direktori manifest per sesi

Inilah inti fiturnya. Prompt sesi ditulis **sekali** saat sesi lahir, jadi daftar lampiran yang
disematkan ke prompt akan basi begitu operator menambah lampiran ke-empat. Karena itu prompt tidak
menjadi satu-satunya kanal: server memelihara **direktori materialisasi** yang selalu mencerminkan
keadaan DB, dan prompt memerintahkan agen membacanya ulang di awal setiap fase.

```
<repoDir>/.worktrees/.attachments/<sessionId>/
    INDEX.md                       ← manifest terbaca manusia+agen
    keluhan-user.png
    error-2026-08-19.log
```

Letaknya **sekamar dengan `.phases` dan `.decisions`**: di dalam `.worktrees` yang sudah
`.gitignore`, **di luar** worktree sesi — jadi `git add -A` milik agen tak mungkin men-stage-nya,
dan ia selamat dari worktree yang dibangun ulang saat sesi dilanjutkan.

Rekonsiliasi **penuh**, bukan tambal: setiap penulisan menyalin ulang set lampiran dari DB lalu
**membuang berkas yang tak lagi ada barisnya**. Lampiran yang dihapus operator karena itu hilang
juga dari pandangan agen — tanpa itu "hapus" hanya berarti "hilang dari dashboard".

Dipanggil di empat titik: unggah, hapus lampiran, hapus Spec, dan kelahiran sesi.

Sandbox produksi (`session-sandbox.ts`) hanya mem-mount worktree + phase file + prompt file, jadi
`SandboxInput` bertambah satu mount **read-only** untuk direktori ini. Tanpa itu fiturnya bekerja
di dev dan diam-diam mati di produksi.

Sesi juga menerima `HANOMAN_ATTACHMENTS_DIR` (jalur yang sama dengan `HANOMAN_PHASE_FILE`).

### 4. Klausa prompt — directive AKTIF, bukan data tak tepercaya

`TicketAttachment` dibingkai `UNTRUSTED_TICKET_DATA_BEGIN/END` dengan larangan mengikuti
instruksi di dalamnya, dan sengaja **tidak** memberi path host (SPEC-761). Itu benar untuk tiket:
asalnya publik dan anonim.

Lampiran backlog berbeda **secara asal**: ia diunggah operator yang sudah lolos gate cookie atau
agent token ber-`backlog:write` — sumber kepercayaan yang sama dengan `Spec.objective` dan
`payload`, yang sudah masuk prompt apa adanya sejak awal. Karena itu di sini directive-nya
**aktif** dan path-nya **absolut**, mengikuti maksud asli SPEC-286.

Klausa dipasang di keempat pembangun prompt sesi backlog (`startPrompt`, `resumePrompt`,
`continuePrompt`, `startGoalPrompt`) dan berisi: daftar lampiran + path absolut + tipe + ukuran,
perintah membaca sebelum fase pertama, dan perintah **membaca ulang `INDEX.md` di awal setiap
fase** karena daftar di prompt adalah keadaan saat sesi lahir, bukan keadaan tetap.

### 5. API — di bawah capability `backlog`, tak masuk katalog MCP

```
GET    /api/specs/:id/attachments            backlog:read
POST   /api/specs/:id/attachments            backlog:write   (multipart, N berkas sekaligus)
GET    /api/specs/:id/attachments/:attId     backlog:read    (byte)
DELETE /api/specs/:id/attachments/:attId     backlog:write
```

`capabilityForRoute` sudah memetakan `top === "specs"` → `rw("backlog")`, jadi keempatnya masuk
domain yang benar **tanpa perubahan** dan 403-nya tetap membawa field `need`. Itu properti
struktural yang memang diinginkan, dan diuji.

**Tidak masuk katalog MCP** — dinyatakan eksplisit. Preseden ADR-0099: katalog MCP menampilkan
tool yang bisa dipakai agen tanpa manusia. Unggah lampiran adalah **tindakan manusia** (berkas
lahir dari disk manusia, bukan dari model), dan tool MCP berbentuk JSON sehingga byte biner tak
punya representasi di sana. REST-nya tetap terjangkau agent token yang punya capability-nya —
yang tak dipajang adalah **tool**-nya, seperti `sessions:write` yang tak punya tool.

Multi-unggah: satu request membawa N berkas; berkas yang ditolak **tidak** menggagalkan yang lain
(pola `intakeTicket`) — respons memuat `saved[]` dan `rejected[{filename, reason}]`.

### 6. UI

Komponen `SpecAttachments` dipakai dua tempat:

- **`NewSpecModal`** — berkas di-*stage* di memori; diunggah setelah `POST /specs` berhasil
  (lampiran butuh `specId`, dan model draft tak sepadan biayanya). Gagal unggah → toast, item
  tetap ada.
- **Detail backlog (`BacklogScreen`)** — daftar hidup, unggah & hapus kapan saja, termasuk selagi
  sesi berjalan.

Keduanya: drag & drop + file picker, thumbnail untuk gambar, ikon+nama untuk dokumen, ukuran,
tombol unduh & hapus. Mengikuti design system (bone paper, brass accent, editorial) lewat komponen
`ds` yang sudah ada — tak ada primitif baru.

## Modul

| Berkas | Tanggung jawab |
|---|---|
| `server/src/services/upload-pipeline.ts` | +`processDocumentUpload` & `commitToStorage` bersama; `ticketBytes` → `parentBytes` (pipeline dipakai dua domain) |
| `server/src/services/spec-attachment.ts` | domain: allowlist, kuota per Spec, baris DB, hapus |
| `server/src/services/spec-attachment-dir.ts` | materialisasi + `INDEX.md` + rekonsiliasi |
| `server/src/routes/specs.ts` | empat endpoint (tipis) |
| `runner/src/prompt.ts` | `attachmentClause` di empat pembangun prompt |
| `server/src/services/session-launch.ts` | materialisasi + env + kirim daftar ke prompt |
| `server/src/services/session-sandbox.ts` | mount `:ro` |
| `src/src/screens/SpecAttachments.tsx` | UI dipakai dua tempat |

## Test

1. Unggah multi-berkas dalam satu request (gambar + dokumen) → semua tersimpan.
2. Penolakan tipe (ekstensi tak diizinkan, mime↔ekstensi tak cocok, biner menyamar `.txt`).
3. Penolakan ukuran per-berkas dan batas jumlah per backlog; berkas lain di request yang sama tetap masuk.
4. Cascade: `DELETE /specs/:id` → baris hilang **dan** berkas fisik + direktori materialisasi hilang.
5. Materialisasi rekonsiliasi: tambah → muncul, hapus → berkas materialisasi ikut hilang, `INDEX.md` akurat.
6. Daftar lampiran benar-benar sampai ke prompt fase — di `startPrompt`, `resumePrompt`, dan `startGoalPrompt`.
7. Gate capability: `backlog:read` cukup untuk daftar/unduh, tak cukup untuk unggah/hapus (403 ber-`need`).

## Yang sengaja TIDAK dikerjakan

- Sync lampiran ke hub (§1).
- Tool MCP untuk lampiran (§5).
- Menggeser/memakai ulang `TicketAttachment` — dua domain, dua aturan sync.
- Pratinjau isi dokumen di dashboard (unduh sudah cukup).
