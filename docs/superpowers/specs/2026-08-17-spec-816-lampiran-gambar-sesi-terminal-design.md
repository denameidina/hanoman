# SPEC-816 — Lampiran gambar ke sesi terminal, lepas dari clipboard host

Status: design · 2026-08-17 · flow `feature` (brief) · ADR baru: **tidak ada**

## Masalah

Melampirkan gambar ke sesi terminal berhenti bekerja ketika sesi sudah panjang. Sesi baru
bisa lagi — dan hanya sesi baru itu. Paste teks tetap normal; yang gagal khusus gambar.

Investigasi memberi satu temuan yang menentukan bentuk perbaikannya: **hanoman tak pernah
berada di jalur gambar sama sekali.**

- `TerminalPane.tsx:171` menangani paste dengan `navigator.clipboard.readText()` — teks, dan
  hanya teks. Tak ada satu baris pun yang menyentuh `clipboardData.files`.
- Ctrl+V polos sengaja dilewatkan mentah ke tmux (`terminal-clipboard.ts:13`). Jadi satu-satunya
  cara gambar pernah masuk adalah **proses `claude` sendiri membaca clipboard mesin server**.
  Itu berhasil hanya karena operator kebetulan duduk di mesin yang sama. Dari HP atau tablet
  angkanya nol, selalu, dan itu bukan regresi melainkan ketiadaan fitur.

Karena jalurnya milik binary `claude` (terukur: 2.1.233), umur sesi menentukan nasib paste
tanpa satu pun tuas di sisi kita. Dua hipotesis pengganti sudah **dicoret dengan bukti**:

- **Kuota WebSocket.** `WsMessageGuard` (`ws-admission.ts:151`) berbasis jendela waktu dan
  mereset `count` tiap 60 dtk; 64 KB adalah batas per-pesan, bukan jatah yang habis seiring umur
  sesi. Sesi tua dan sesi baru menghadapi guard yang identik.
- **Penolakan `many-image` API** ([claude-code#34025](https://github.com/anthropics/claude-code/issues/34025):
  request dengan banyak gambar menuntut tiap gambar ≤ 2000 px). Nol dari 41 transkrip lokal
  mengandung error itu. Tidak berlaku di sini.

Sebaran paste gambar dalam transkrip memang condong ke awal sesi (paste terakhir di baris
707/1165, 79/1056, 12/1126), tetapi satu paste masih berhasil pada kedalaman 3,7 MB konteks —
**tak ada ambang ukuran yang bersih**. Itu korelasi, bukan akar, dan menambal tebakan di dalam
CLI orang lain bukan pekerjaan yang bisa diselesaikan repo ini.

Yang bisa diselesaikan repo ini: memberi hanoman jalur lampirannya **sendiri**, yang tak
menyentuh clipboard host sama sekali, sehingga umur sesi tak lagi jadi variabel.

## Objective

Operator bisa melampirkan gambar ke sesi terminal mana pun — baru maupun berumur seminggu —
dengan mem-paste atau menyeretnya ke pane. Berkasnya mendarat di penyimpanan server, dan
path-nya masuk ke prompt sesi sebagai teks biasa, siap dibaca agen dengan Read. Jalur ini
berlaku sama untuk sesi `claude` maupun `codex`, karena keduanya membaca berkas dari path.

## Keputusan

### 1. Berkas + path, bukan gambar inline

Yang bisa dikirim ke PTY hanyalah byte teks. Menyuntikkan blok image ke stdin CLI tidak
mungkin — CLI-lah yang menyusun blok image, dari clipboard atau dari berkas yang dibacanya.
Maka bentuknya sudah tertentu: **simpan berkas, kirim path**.

Konsekuensinya jujur disebut: agen membelanjakan satu panggilan Read untuk melihat gambarnya.
Itu harga yang dibayar untuk lampiran yang tak bergantung pada clipboard mesin server.

### 2. `POST /api/terminal/sessions/:id/attachments` (multipart)

```
POST /api/terminal/sessions/:id/attachments   multipart/form-data, field `file`
  -> 200 { path: string }     path absolut berkas di server
```

- **Capability**: `sessions:write`. `capabilityForRoute` sudah memetakan seluruh top-level
  `terminal` (dicatat di `routes/session-history.ts:5`), dan `POST` menurunkan cabang tulisnya.
  **Tanpa perubahan peta capability** — persis pola yang menghindari kelas bug SPEC-405 (prefix
  dipetakan tanpa melihat method).
- **404** `not found` — `getSession(id)` kosong. Sesi harus hidup: berkas yang path-nya tak
  pernah bisa diketik ke prompt mana pun adalah sampah sejak lahir.
- **415** `{ error: "tipe berkas tak didukung" }` — mime di luar `image/png`, `image/jpeg`,
  `image/webp`. Allowlist ini **persis kunci `EXT`** di `uploads.ts:11`; `image/gif` sengaja di
  luar karena `extFor` memetakannya ke `.bin`, dan berkas ber-ekstensi `.bin` tak dikenali
  sebagai gambar oleh pembacanya.
- **413** `{ error: "berkas melebihi 5 MB" }` — `@fastify/multipart` terdaftar dengan
  `throwFileSizeLimit: false` (`app.ts:126`), jadi berkas oversize datang **ter-truncate, bukan
  sebagai error**. Route wajib memeriksa `file.file.truncated` dan menolak; melewatkannya berarti
  menyimpan gambar rusak yang gagal dibaca agen tanpa satu pun tanda.

### 3. Penyimpanan per sesi, dihapus saat sesi ditutup

```
~/.hanoman/uploads/terminal/<sessionId>/<uuid>.png
```

Subdirektori itulah yang mencatat kepemilikan — **tak ada model Prisma baru, tak ada migration,
tak ada ADR**. Dua fungsi baru di `services/uploads.ts`, sejajar `saveUpload`/`deleteUpload`
yang sudah ada:

- `saveSessionUpload(sessionId, buf, mimeType) -> { path, size }` — `mkdir` rekursif mode
  `0o700`, berkas `0o600`, nama opaque `randomUUID() + extFor(mime)`, sama seperti `saveUpload`.
- `dropSessionUploads(sessionId)` — `rm -rf` direktori sesi, best-effort.

`sessionId` datang dari parameter URL, jadi ia **disanitasi sebelum menyentuh disk**: hanya
`[a-z0-9-]` diterima (id sesi lahir dari `randomUUID().slice(0,8)` atau `sessionIdForSpec`,
`pty.ts:159`), selebihnya 404. Ini yang membedakannya dari `storageKey` di `readUpload`, yang
tak pernah berasal dari input operator.

Penghapusan dipasang di **`killSession()`** (`pty.ts:865`) — satu-satunya pintu kematian sesi,
tempat `emitDeath` sudah berdiri, dan pasangan dari `createSession` sebagai satu-satunya pintu
kelahiran (`pty.ts:215`). Best-effort di dalam `try/catch`: kegagalan menghapus berkas tak boleh
menahan penutupan sesi, dengan alasan yang sama seperti `emitDeath` menelan galatnya sendiri.

`detachAll()` **tidak** menghapus apa pun — restart server melepas klien tmux tetapi membiarkan
sesi hidup (ADR-0016), dan lampirannya harus ikut selamat.

Konsekuensi yang diterima sadar: transkrip sesi lama menunjuk path yang sudah lenyap. Itu
pilihan yang diambil di atas alternatif "sapu 30 hari" agar disk tak menyimpan screenshot yang
tak lagi punya pembaca.

### 4. Paste & drop, tanpa tombol

Pane memasang dua jalur di elemen host:

- Event **`paste`** — `clipboardData.files` berisi gambar → `preventDefault()` + unggah.
  Selain gambar, jalur teks yang ada sekarang berjalan seperti biasa.
- Event **`dragover`/`drop`** — `dataTransfer.files` berisi gambar → `preventDefault()` + unggah.
  `dragover` wajib di-`preventDefault` juga; tanpa itu browser menolak drop-nya.

Sesudah unggah berhasil, pane mengirim `path + " "` lewat `sendInput` — **tanpa Enter**, agar
operator melanjutkan mengetik kalimatnya di sebelah path. `sendInput` sudah punya buffer
`pendingInput` yang dikuras di setiap `open` (`TerminalPane.tsx:103`), jadi lampiran yang
mendarat saat socket sedang menyambung ulang tidak hilang.

Pemilahan berkas dari sebuah `DataTransfer` diletakkan di **helper murni** di
`terminal-clipboard.ts` — pola yang sudah dipakai `clipboardIntent`: keputusan dapat diuji tanpa
DOM, efeknya (unggah, `sendInput`) tinggal di komponen.

**Tombol lampirkan tidak dibangun.** Akibatnya eksplisit: di HP dan tablet lampiran gambar tetap
tak tersedia, karena keyboard virtual tak menyediakan paste gambar yang andal dan tanpa file
picker tak ada jalur lain.

### 5. Pembajakan Cmd+V dicabut bila ia menelan event `paste`

`attachCustomKeyEventHandler` (`TerminalPane.tsx:165`) mengembalikan `false` untuk Cmd+V. Bila
xterm menerjemahkan itu menjadi `preventDefault()` pada keydown, browser **tak pernah
menerbitkan event `paste`**, dan jalur §4 mati sebelum sempat dipanggil.

Langkah **pertama** implementasi adalah membuktikan ini di browser sungguhan (smoke CDP, pola
`hanoman-browser-smoke-via-cdp`), bukan menyimpulkannya dari membaca kode. Bila terbukti
menelan:

- pembajakan keydown untuk `paste` dicabut dari `clipboardIntent` — Cmd+V kembali dilewatkan,
- **teks dan gambar sama-sama** ditangani event `paste` native.

Itu bukan sekadar syarat teknis fitur ini: ia juga melepas ketergantungan pada izin
`navigator.clipboard.readText`, yang di Safari dan di konteks non-secure menuntut prompt izin
atau gagal diam-diam. Jalur `copy` (Cmd+C) **tidak** disentuh — `writeText` tak punya masalah
yang sama dan SPEC-289 dibangun di atasnya.

### 6. Kegagalan tidak boleh diam

Setiap penolakan (415, 413, 404, jaringan) ditulis ke pane sebagai baris merah, mengikuti pola
`WebSocket admission gagal` (`TerminalPane.tsx:140`). Audit SPEC-800 §3 sudah menetapkan
kalimatnya: diam adalah cacatnya, dan diam tak boleh jadi bagian perbaikannya.

## Non-goals

- **Tombol lampirkan / file picker** — dan karenanya lampiran gambar dari HP & tablet.
- **Pengecilan resolusi.** Menghindari batas `many-image` (2000 px) butuh `sharp`, biner native
  yang memberatkan `npm i -g hanoman` di tiap platform (SPEC-398/ADR-0087). Batasnya juga tak
  terbukti mengenai instalasi ini.
- **Sesi `claude` CLI langsung di terminal operator.** Akarnya di dalam binary 2.1.233; repo ini
  tak punya tuasnya.
- **Sinkronisasi lampiran ke hub.** Berkas ini server-local, seperti seluruh isi
  `HANOMAN_UPLOAD_DIR` (`uploads.ts:2`).

## Uji

**Server** (`server/test/`, ingat `--no-file-parallelism` + `TEST_DATABASE_URL` sendiri):

- unggah png → 200, berkas ada di `uploads/terminal/<id>/`, `path` yang dikembalikan menunjuk
  berkas yang benar-benar terbaca;
- mime di luar allowlist → 415, tak ada berkas tertulis;
- berkas ter-truncate (`truncated === true`) → 413, tak ada berkas tertulis;
- sesi tak dikenal → 404; `sessionId` mengandung `../` atau `/` → 404, tanpa menyentuh disk;
- `killSession(id)` → direktori sesi lenyap; `detachAll()` → direktori **tetap ada**.

**Frontend** (`src/test/`):

- helper murni pemilah `DataTransfer`: png/jpeg/webp → daftar berkas; teks polos → kosong;
  campuran teks+gambar → gambar menang;
- `TerminalPane` mem-paste gambar → memanggil API sekali dan mengirim `path + " "` ke socket,
  tanpa `\r`;
- unggah gagal → baris merah muncul di pane.

**Live** (wajib per CLAUDE.md): boot server, `curl -F` sebuah png ke endpoint pada sesi tmux
nyata, pastikan path-nya muncul di prompt sesi, lalu tutup sesi dan pastikan direktorinya hilang.

## Docs tersentuh

`internal/docs/architecture/api-contract.md` (endpoint baru + kode galatnya),
`internal/docs/architecture/stack.md` (jalur lampiran sesi & tempat berkasnya hidup), dan satu
baris index di `internal/docs/README.md`. `internal/docs` tak punya direktori per-SPEC — halaman
SPEC hidup sebagai entri index yang menunjuk doc arsitektur/riset, pola yang sama dengan
SPEC-812. Satu commit bersama kodenya.
