# ADR-0111 — Portal klien mengirim tiket help desk: satu route tulis, satu pipeline intake, lepas dari `helpEnabled`

- Status: accepted
- Tanggal: 2026-08-10
- Konteks: SPEC-626
- Mengamandemen: ADR-0110 (portal klien read-only) — permukaan klien tidak lagi baca-saja mutlak;
  ia punya **tepat satu** pintu tulis, dan sifat deny-by-default-nya justru dipertegas.
- Menegakkan: ADR-0062 (Help Center sebagai sumber tiket) · ADR-0066/0068 (tiket & lampiran masuk
  record-sync) · ADR-0038 (proyeksi di layer response) · ADR-0065 (portal tetap COOKIE_ONLY)
- Tidak mencabut apa pun.

## Konteks

Portal klien (SPEC-617/ADR-0110) lahir sebagai **pembaca**. Satu-satunya cara klien mengeluh adalah
halaman Help Center **publik**, `POST /api/help/:slug/tickets`: multipart, honeypot `hc_trap`,
rate-limit per IP, email diketik manual, dan hidup hanya bila `project.helpEnabled`. Klien yang
sudah login karena itu harus **keluar dari portal** dan mencari URL publik itu — otentikasi yang
baru saja ia lewati tak dipakai sama sekali, dan tiketnya masuk sebagai kiriman orang asing.

Menambahkannya bukan sekadar route baru: ADR-0110 menetapkan permukaan klien **deny-by-default**
lewat allowlist, dengan alasan yang masih berlaku sepenuhnya. Jadi pertanyaannya bukan "boleh-kah
portal menulis" melainkan **seberapa sempit lubangnya bisa dibuat**, dan bagaimana memastikan tiket
dari dua pintu tak pernah menyimpang.

## Keputusan

### 1. Satu route tulis, dibuka sebagai BENTUK PATH — bukan sebagai method

`POST /api/portal/projects/:id/tickets`. Allowlist `clientRouteAllowed` tidak berubah menjadi
"portal boleh POST"; ia menerima satu bentuk yang persis:

```ts
const isPortalTicketSubmit = (method: string, seg: string[]): boolean =>
  method === "POST" && seg.length === 4 && seg[1] === "projects" && seg[3] === "tickets";

if (top === "portal") return read || isPortalTicketSubmit(method, seg);
```

Selisihnya penting: melonggarkan **method** membuat setiap route portal yang lahir nanti ikut
terbuka tanpa seorang pun memutuskannya — persis arah kegagalan yang dibalik ADR-0110. Dengan
bentuk path, `POST …/backlog`, `POST …/tickets/:id`, dan `PATCH …/tickets` tetap tertutup, dan
route portal berikutnya tetap tertutup **secara default**.

Sifat baca-saja selebihnya karena itu tetap diuji **dua lapis terpisah** (ADR-0110 gotcha 7):
tabel route Fastify (`app.hasRoute`) untuk "hanya satu route tulis yang lahir di sini", dan
`clientRouteAllowed` sebagai fungsi murni untuk "bentuk tulis lain ditolak seandainya ada".

### 2. Satu pipeline intake, dua pintu

Badan submit `routes/help.ts` diangkat jadi `services/ticket-intake.ts`:

- `parseTicketUpload(req)` — multipart → field + lampiran, menegakkan ≤3 berkas / ≤5 MB /
  `image/png|jpeg|webp`; berkas yang ditolak **di-skip tanpa membatalkan submit**.
- `intakeTicket(...)` — `createTicket()` → `notifySynced("ticket")` → lampiran (`saveUpload` +
  `notifySynced("ticketAttachment")`) → `recordNewTicket()` → `pruneOldTickets()`.

Kedua route memanggil fungsi yang sama, jadi tiket dari portal identik di mata operator **secara
konstruksi** — bukan identik karena dua salinan kebetulan sepakat. Kelas bug "satu definisi, N call
site" sudah dibayar SPEC-431/448/475/481; efek samping (notifikasi, feed sync, urutan
INDUK-sebelum-ANAK SPEC-382) justru yang paling gampang menyimpang karena tak punya tipe pemaksa.

Yang berbeda antar-pintu hanya otorisasi dan asal `reporterEmail`.

### 3. Tiket dari portal TIDAK bergantung `project.helpEnabled`

Keputusan eksplisit, bukan efek samping. `helpEnabled` menjawab **"boleh-kah orang asing tanpa
login mengirim keluhan ke project ini"** — pertanyaan tentang permukaan anonim, dan satu-satunya
gerbang yang dipunyai permukaan itu. Klien portal sudah lewat dua gerbang yang lebih kuat: akun
ber-password (`User.role = "client"`, bisa dinonaktifkan) dan baris `ClientProjectAccess` yang
diberikan operator satu per satu.

Menyandera jalur portal pada knob itu berarti: mematikan Help Center publik — tindakan yang biasa
diambil untuk **menghentikan kiriman anonim** — ikut membungkam klien yang justru sengaja diundang.
Jalur publik tetap bergantung padanya, tak berubah sedikit pun.

### 4. Honeypot dicabut untuk jalur ini; rate-limit tetap ada, berbasis AKUN

`hc_trap` tak relevan untuk sesi ber-login: honeypot menebak "apakah ini bot", sedangkan portal
sudah tahu **siapa** pengirimnya. Rate-limit tetap perlu (satu akun yang kacau tetap bisa
membanjiri) tapi identitasnya akun, bukan IP — membatasi per IP menghukum satu kantor bersama-sama
dan tak menyentuh pelaku sebenarnya.

`portalTicketRateOk(userId, projectId)` memakai `take()` yang sama: bucket akun (default 5/menit,
`HANOMAN_PORTAL_TICKET_RATE_PER_MIN`) lalu bucket **per-project yang sama** dengan jalur publik,
supaya satu project punya satu atap laju masuk tiket. Short-circuit SPEC-352 dipertahankan:
percobaan yang sudah pasti ditolak jatah akun **tidak** ikut menguras bucket project yang dipakai
bersama pelapor publik.

Email pelapor diambil dari `req.user.email` dan tak pernah dari body — tak ada yang bisa mengaku
sebagai orang lain.

### 5. Respons = proyeksi `toPortalTicket`, tanpa kunci opaque

`201` mengembalikan `PortalTicket` — allowlist field yang sama dengan route baca, sehingga
`accessKeyHash`/`reporterEmail`/`shareToken` mustahil ikut bahkan bila kolom Prisma bertambah.
Kunci opaque pelapor sengaja **tidak** dikembalikan (berbeda dari jalur publik yang memang
memerlukannya sebagai satu-satunya cara pelapor anonim kembali): klien memantau tiketnya di portal,
bukan lewat link status publik.

Project yang bukan haknya dan project yang tak ada dijawab **404 generik yang sama** seperti route
portal lain — membedakannya menjadikan portal alat enumerasi nama project (ADR-0110 gotcha 6).

## Konsekuensi

- Permukaan klien tak lagi bisa dibaca sebagai "nol tulis". Yang berlaku sekarang: **satu** tulis
  yang disebut namanya, dan setiap tambahan berikutnya butuh keputusan yang sama eksplisitnya.
- Ada dua jalur setara membuat tiket. Keduanya wajib tetap melewati `intakeTicket()`; menambah
  langkah intake di satu route saja adalah bug, bukan variasi.
- `helpEnabled` kini menjawab pertanyaan yang lebih sempit dari sebelumnya: ia knob permukaan
  **anonim**, bukan sakelar help desk sebuah project.

## Alternatif yang ditolak

- **Portal memanggil `POST /api/help/:slug/tickets` yang sudah ada.** Nol route baru, dan allowlist
  ADR-0110 memang sudah mengizinkannya. Tapi email jadi ketikan manual lagi, `helpEnabled` tetap
  menyandera, rate-limit tetap per-IP, dan tiket klien terautentikasi tak terbedakan dari kiriman
  anonim. Otentikasi yang sudah dipegang portal terbuang percuma.
- **Membuka allowlist per-method (`portal` → semua POST).** Satu baris lebih pendek, tapi setiap
  route portal yang lahir nanti ikut terbuka tanpa seorang pun memutuskannya.
- **Menyalin badan submit `help.ts` ke `portal.ts`.** Terlihat aman karena kodenya pendek — dan
  itulah bentuk persis SPEC-431/448/475: dua penulis efek samping yang perlahan tak sepakat.
- **Menyertakan kunci opaque di respons portal.** Tak ada yang memakainya; setiap kredensial yang
  dikirim tanpa keperluan adalah kredensial yang bisa bocor.

## Gotcha

1. **Lubangnya bentuk PATH, bukan method.** Route portal baru — termasuk yang tulis — tetap
   tertutup sampai bentuknya ditambahkan di `isPortalTicketSubmit`.
2. **404, bukan 403, untuk project bukan haknya.** 403 memberi tahu bahwa project itu ada.
3. **`helpEnabled` sengaja tak digerbangi di jalur portal.** Kalau suatu hari terasa "kurang
   konsisten", baca §3 sebelum menyeragamkannya — keseragamannya justru bug.
4. **`parseTicketUpload` menguras stream multipart.** Gerbang yang murah (akses project,
   rate-limit) wajib dijalankan **sebelum** memanggilnya; membalikkannya berarti setiap penolakan
   tetap membayar biaya baca berkas.
5. **Bucket project dipakai BERSAMA jalur publik.** Itu disengaja (satu atap per project), dan
   short-circuit SPEC-352 adalah yang menjaga jalur portal tak jadi alat menguras jatah pelapor
   publik.
6. **Respons memakai proyeksi yang sama dengan route baca.** Jangan mengembalikan baris Prisma
   mentah "karena sudah lewat gerbang" — allowlist field adalah tempat keputusan itu (ADR-0110
   gotcha 5).
