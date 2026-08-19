# ADR-0130 — Kuota obrolan portal: ember (project × tipe × periode), satuannya sesi yang lahir

- Status: accepted
- Tanggal: 2026-08-19
- Konteks: SPEC-854
- Menegakkan: [ADR-0129](0129-mesin-chat-portal-klien.md) (mesin chat portal) ·
  [ADR-0110](0110-portal-klien-read-only.md) (scope per project) ·
  [ADR-0086](0086-sqlite-satu-satunya-provider.md) (SQLite satu berkas, single-process)
- Tidak mencabut apa pun.

## Konteks

Satu giliran obrolan portal = satu proses agen penuh. Tanpa batas, sebuah project bisa menghabiskan
kuota langganan yang sama dengan sesi pekerja — dan tak seorang pun akan tahu sampai sesi kerja
gagal. Brief menyebut tiga cara menembusnya secara eksplisit, dan ketiganya harus tertutup **by
construction**, bukan oleh kesopanan klien: membuka banyak tab, memulai ulang, dan memakai beberapa
akun klien di project yang sama.

## Keputusan

### 1. Ember = (project × tipe × periode), bukan (akun × …)

Beberapa akun klien di project yang sama **berbagi satu jatah**. Kalau embernya per akun, mengundang
satu akun lagi ke project adalah penggandaan jatah gratis — dan operator memang rutin mengundang
lebih dari satu orang per project (`ClientProjectAccess` adalah tabel join, bukan kolom).

Brainstorming dan pertanyaan punya ember **terpisah**: keduanya berbeda ongkos dan berbeda tujuan,
dan jatah brainstorming yang habis tak boleh ikut membungkam pertanyaan sehari-hari.

### 2. Satuannya sesi yang LAHIR, bukan pesan yang terkirim

Membuka tab kedua, memuat ulang halaman, atau membuka sesi lama tak melahirkan sesi baru — jadi tak
menambah pemakaian apa pun. Yang bisa habis hanyalah **memulai** percakapan. Ini menutup dua dari
tiga cara di brief tanpa satu baris kode anti-abuse: keduanya bukan operasi yang dihitung.

Konsekuensi yang diterima sadar: satu sesi bisa berisi banyak giliran, jadi jatah tidak membatasi
total ongkos secara ketat. Yang membatasi ongkos per giliran adalah `timeoutSec`, dan yang
membatasi panjang pesan adalah `MAX_PESAN`.

### 3. `periodKey` dibekukan di baris sesi saat lahir

`"YYYY-MM"` UTC, ditulis sekali di `PortalChatSession.periodKey` dan tak pernah dihitung ulang saat
dibaca. Dua alasan:

- **Bisa diuji.** Perilaku sesudah reset diuji dengan menyisipkan baris ber-`periodKey` bulan lain,
  bukan dengan memalsukan jam mesin.
- **Stabil.** UTC, bukan waktu mesin: tanggal reset yang dilihat klien harus sama di hub dan di
  instance lokal.

### 4. Baris sesi ITU SENDIRI adalah buku besarnya

Tak ada tabel penghitung kedua. Penghitung terpisah adalah dua sumber kebenaran yang cepat atau
lambat menyimpang — dan yang menyimpang di sini berarti jatah yang salah, tanpa cara memeriksanya.
`quotaView` menghitung dengan `count()` atas indeks `[projectId, type, periodKey]` yang memang ada
untuk itu.

### 5. Pemeriksaan + penulisan dalam satu `$transaction`

SQLite menyerialkan tulisan dan server hanoman single-process (ADR-0086), jadi ini cukup untuk
menutup dua permintaan yang tiba bersamaan. Asumsinya **dinyatakan terbuka** di kode, cermin
`help-ratelimit`: ganti ke penghitung bersama kalau suatu hari ada lebih dari satu proses.

### 6. Jatah `0` berarti TERTUTUP, bukan tak terbatas

`0` adalah nilai yang paling mudah diketik operator yang ingin mematikan satu tipe sesi saja. Ia
karena itu harus berarti "tak boleh sama sekali"; menafsirkannya sebagai tak terbatas adalah
kegagalan fail-open yang persis kebalikan dari maksud pengetiknya.

### 7. Jatah habis dijawab kalimat biasa, bukan pesan galat

`409` dengan badan `{ pesan, kuota }`, di mana `pesan` datang dari `TEKS_TETAP.kuotaHabis` dan
`kuota` memuat sisa jatah kedua ember + tanggal reset. Statusnya tetap 409 supaya klien HTTP tak
menganggapnya sesi yang lahir, tetapi **yang dibaca manusia adalah kalimat**, bukan kode. Di portal,
sisa jatah juga terlihat **sebelum** klien menekan apa pun — tombol tipe yang jatahnya habis
menonaktifkan diri, dan bannernya menyebut tanggal reset dalam tanggal panjang ("1 September 2026").

### 8. Nilainya di `Setting.portalChat`, tanpa migration

Kolom `Setting.data` bertipe `Json`, jadi blok ini menyusul pola `scheduler`/`goal`/`conflict`/
`lead`: `.default()` di `zSetting` membuat baris Setting lama tetap parse tanpa backfill. Blok ini
**tak punya field `agent`** — lihat ADR-0129 gotcha 5.

## Konsekuensi

- Operator membaca angka jatah yang **sama** dengan yang dilihat klien: permukaan operator
  menyertakan `quotaView` yang sama, bukan hitungan kedua.
- Jatah adalah pagar ongkos, bukan akunting: pemakaiannya tetap menumpang langganan yang sama
  dengan sesi pekerja (cermin ADR-0091 OQ-1).

## Gotcha

1. **`sisa` dijepit di nol.** Operator boleh menurunkan jatah di tengah periode, dan sesi yang
   sudah lahir tak dibatalkan. Tanpa jepitan itu klien melihat angka minus, yang terbaca sebagai
   utang alih-alih sebagai habis.
2. **Kuota diperiksa saat MULAI, bukan saat kirim.** Sesi yang sudah lahir tetap bisa dilanjutkan
   sampai selesai walau jatah bulan itu sesudahnya habis — memutus percakapan di tengah adalah
   kegagalan produk yang lebih buruk daripada satu sesi berlebih.
3. **Jangan memindahkan penghitung ke tabel sendiri** tanpa ADR baru. Yang membuat kuota ini
   jujur adalah bahwa yang dihitung dan yang dibatasi adalah **baris yang sama**.
