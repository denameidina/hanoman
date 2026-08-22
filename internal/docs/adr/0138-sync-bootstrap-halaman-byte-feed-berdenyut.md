# ADR-0138 — Bootstrap sync, halaman ber-anggaran byte, dan feed yang berhenti berdenyut

Status: accepted · SPEC-885 · 2026-08-22

## Konteks

Instalasi `hanoman` baru yang dikonfigurasi sebagai client sync tidak pernah selesai menarik data
dari hub. Keluhan yang sampai ke operator: "sync semua datanya lama."

Pengukuran membantah kata "lama". Yang terjadi adalah **mandek permanen dan senyap**, ditambah
**kehilangan data diam-diam** — dan keduanya bukan regresi kode sync melainkan akibat susulan dari
retensi change-feed ([ADR-0131](0131-retensi-change-feed-sync.md), SPEC-857), yang mengubah bentuk
feed tanpa mengubah pembacanya.

Hub produksi `hanoman.nafanesia.id` (`/srv/hanoman-prod/hanoman.db`), terukur 2026-08-22. DB 19,3 MB,
`journal_mode=wal`, `MAX(seq) = 126.834` sementara feed hanya menyisakan 3.637 baris — retensi bekerja
persis seperti dirancang.

| | |
|---|---|
| Keadaan yang sebenarnya dibutuhkan client | **889 record** (724 spec, 80 sessionResult, 37 tiket, 16 lampiran, 14 project, 9 vps, 9 issue) |
| Yang harus dilewatinya untuk sampai ke sana | **3.637 baris feed / 7,9 MB** |
| `vps` | **2.469 baris untuk 9 record** — 274×, 4,0 MB, 51% byte feed dan 68% barisnya |
| Halaman kedua yang diminta client sejak kursor 0 | **2,51 MB** |
| Jendela 500-baris yang melewati 2 MB | **348** |
| Spec ber-`seq` LEBIH KECIL daripada baris project induknya | **510 dari 728**, 508 di halaman berbeda |
| Spec yang induknya tak ada di feed sama sekali | **0** |

### A1 — Client baru mandek, tidak melambat

`fetchTransport` memasang `maxResponseBytes: 2 MB`; saat terlampaui `safeRequest` memanggil
`response.destroy(new Error("outbound response terlalu besar"))`. Pull melempar → `tick()`
menelannya (`catch { /* offline */ }`, nol log) → halaman yang sama diminta ulang tiap 15 detik,
selamanya. Client berhenti di **500 dari 3.637** tanpa satu pun jejak. Tombol "Tarik ulang" menabrak
dinding yang sama dan hanya menghasilkan toast `Gagal sync` tanpa sebab, jadi satu-satunya jalur
pemulihan yang dimiliki operator pun tertutup.

Penyebab strukturalnya: `pull()` memotong per **jumlah baris** (`limit = 500`) sedangkan client
memotong per **byte**. Baris feed berkisar 100 B–29 KB, jadi dua satuan itu tak pernah bisa sepakat,
dan yang menentukan bukan salah satunya melainkan kebetulan komposisi halaman.

### A2 — 70% spec hilang senyap, bahkan setelah A1 dibuka

Retensi menyimpan hanya baris **terakhir** per `(entity, recordId)` di luar jendela 7 hari. Baris
**penciptaan** induk karena itu lenyap, dan yang tersisa adalah baris terakhirnya — yang `seq`-nya
bisa jauh lebih besar daripada `seq` anaknya.

`syncOnce` menangani anak-mendahului-induk dengan `deferred` + pass ulang, tetapi hanya **di dalam
satu halaman**. Satu putaran penuh tanpa kemajuan → `console.warn("…dilewati")`, `dropped++`, lalu
`setCursor` **tetap dijalankan**. Baris itu tertinggal di belakang kursor dan tak akan pernah
ditarik lagi.

Ini kelas kegagalan SPEC-382 yang terbuka kembali lewat pintu baru: kontrak apply tidak berubah,
tetapi retensi menghapus properti yang diam-diam diandalkannya — dulu baris penciptaan induk selalu
ber-`seq` lebih kecil daripada anaknya, dan itu benar sampai baris itu dipangkas.

### A3 — Feed yang berdenyut

`runHealth()` memanggil `notifySynced("vps", …)` di **setiap** polling 5 menit. ADR-0131 menyebut
ini eksplisit di "Yang tidak diubah" dan menyerahkannya sebagai optimasi terpisah.

### A4 — Laju dipatok timer

`syncOnce` melakukan **satu** pull per tick 15 detik. 8 halaman = 2 menit, dan hampir sepanjang waktu
itu jaringan serta CPU menganggur.

## Keputusan

### 1. Halaman `pull` dipotong per anggaran byte, dan kursor tak pernah melewati apa yang dikirim

`pull()` tetap mengambil `take: limit`, lalu memangkas hasilnya sampai `PULL_MAX_BYTES` (1 MB —
separuh cap client, sisanya headroom amplop JSON). Respons dapat field aditif **`hasMore`**; hub tahu
persis karena ia yang memangkas, bukan menebak dari `records.length === limit`.

> **Invarian — jangan dilanggar tanpa ADR baru:** kursor menunjuk baris **terakhir yang benar-benar
> dikirim**, bukan baris terakhir yang dibaca. Kursor yang menunjuk lebih jauh meninggalkan baris di
> belakangnya, dan baris di belakang kursor tak akan pernah ditarik lagi (akar SPEC-382).

**Minimal satu baris selalu dikirim**, supaya satu record raksasa tak bisa membekukan feed di
tempatnya; `MAX_SYNC_RECORD_BYTES` (1 MB) di sisi client yang menjaga batas atasnya.

Sisi client menaikkan `maxResponseBytes` ke **8 MB**. Ini bukan duplikasi anggaran hub — hub yang
sudah membawa keputusan ini memotong di 1 MB dan tak akan pernah menyentuhnya. Ia dinaikkan untuk
**hub yang belum naik versi**, yang tetap mengirim 500 baris apa adanya. Urutan rilis tetap
hub-duluan ([ADR-0135](0135-penanda-project-ditangani-hanoman-client.md)), tapi kombinasi
client-baru/hub-lama justru yang dialami setiap orang yang baru `npm i -g hanoman`, dan ia harus
sembuh tanpa menunggu siapa pun.

### 2. `syncOnce` menguras feed sampai habis; `deferred` hidup lintas halaman

`syncOnce` melingkar (tarik → terapkan → ulangi selama `hasMore`), dibatasi `MAX_DRAIN_PAGES = 500`
sebagai jaring pengaman, lalu drain outbox sekali di akhir. `deferred` hidup sepanjang lingkaran itu
dan di-retry sesudah tiap halaman. Karena `induk_tak_ada_di_feed = 0`, ini menyelamatkan **510 dari
510**.

Pembuangan record hanya sah **setelah seluruh feed habis**. Di titik itu `console.warn` + `dropped++`
menjadi pernyataan jujur alih-alih artefak paginasi.

Hub lama tak mengirim `hasMore`; client memperlakukan halaman tak kosong sebagai "mungkin masih ada",
dan berhenti saat kursor tak lagi maju.

> **Yang sengaja TIDAK dilakukan:** menahan kursor di depan record yang gagal. Itu livelock yang
> ditutup [ADR-0082](0082-kontrak-apply-changefeed-record-tertunda.md), dan di sini justru fatal —
> induknya ada di halaman **berikutnya**, jadi kursor yang menolak maju menjamin ia tak pernah tiba.

### 3. `GET /api/sync/bootstrap` mengirim keadaan tabel dalam urutan dependensi

Hub membaca **tabel**, bukan feed, lewat `snapshot()` yang sama (satu-satunya jalur proyeksi
`FIELDS`, jadi tak ada bentuk kedua yang bisa menyimpang saat kolom baru ikut menyeberang). Urutan
topologis diturunkan dari `PARENTS`: `project` → `spec`/`ticket`/`customAgent`/`githubIssue` →
`ticketAttachment` → `sessionResult`. Berhalaman dengan anggaran byte yang sama.

Hasil: **3.637 baris / 7,9 MB → 889 record / ~2,5 MB**, dan urutan FK benar *by construction* alih-alih
diperbaiki retry.

**Kursor diambil SEBELUM satu tabel pun dibaca, dan urutan itu yang harus dipertahankan.** Akibatnya
baris yang dibaca sesudahnya boleh lebih baru daripada kursornya, sehingga client yang memutar ulang
feed `> cursor` bisa sesaat menulis versi lama di atas versi baru — `upsertLocal` menulis apa adanya
dan tak melihat urutan versi. Itu konvergen: seluruh baris diputar berurutan dan berakhir di puncak
yang benar. Kebalikannya **tidak** aman — kursor yang diambil sesudah membaca membuat tulisan yang
masuk di sela pembacaan ber-`seq` lebih kecil daripada kursor, jadi ia tak pernah ditarik dan
hilangnya permanen.

Paginasinya sengaja bukan snapshot berkonsistensi: record yang lahir di antara dua halaman dan
ber-id lebih kecil dari kursor terlewat di sini, lalu dijemput drain feed sesudahnya. Konvergensi
tidak bergantung pada bootstrap yang lengkap — hanya pada kursornya yang tak pernah melewati
kenyataan.

**Tombstone tidak ikut**, sengaja: record yang sudah dihapus cukup absen dari snapshot, dan kursor =
puncak berarti tak ada baris `op: "delete"` lama yang akan ditarik.

**Bootstrap bukan sekadar lebih cepat — ia satu-satunya jalur yang LENGKAP.** Terukur saat spec ini
diverifikasi terhadap salinan DB hub produksi: client yang memakai bootstrap mendarat di **727 spec,
14 project, 9 vps, 37 tiket — cocok persis dengan hub**, dalam 930 ms. Client yang jatuh ke drain
feed murni (mensimulasikan hub lama) mendarat di **698 spec** dan membuang 7 tiket, meski seluruh
3.712 baris feed terterapkan dan kursornya sampai di puncak.

Sebabnya bukan drain-nya, melainkan feed itu sendiri. `renameProjectCore`
([ADR-0064](0064-project-id-renameable.md), SPEC-255) memindahkan anak sebuah project secara
**borongan** dan hanya menerbitkan baris feed untuk record **project**-nya. Jadi baris feed terakhir
`SPEC-150` (seq 8456) masih menyebut `projectId = base.tumbuh.ai` sementara tabelnya sudah
`erp-tumbuh-ai`, dan id lama itu kemudian menerima tombstone (seq 124457). Penerima yang memutar feed
dengan benar akan **cascade-menghapus** spec-spec itu — dan ia benar menurut feed, sekaligus salah
menurut kenyataan.

Feed karena itu **lossy melewati rename project**, dan tak ada perbaikan pada `syncOnce` yang bisa
menutupnya: informasinya memang tak pernah ditulis. Sebelum ADR ini hal itu tak pernah terlihat
karena client baru bahkan tak sampai ke halaman kedua. Menerbitkan ulang baris anak saat rename
adalah perbaikan tersendiri di luar lingkup SPEC-885; yang ditegakkan di sini adalah bahwa jalur
fallback (hub lama → 404 → drain feed) **konvergen tetapi tidak lengkap**, dan bahwa jalur yang benar
untuk instalasi baru adalah bootstrap.

Client memakainya hanya bila `cursor === "0"` **dan outbox kosong**. Syarat kedua yang penting:
"Tarik ulang" memundurkan kursor ke 0 di mesin yang bisa saja punya suntingan lokal belum terkirim,
dan outbox kosong adalah bukti tak ada yang bisa ditimpa. Hub lama menjawab 404 → jatuh ke drain feed
biasa.

### 4. `runHealth` menerbitkan saat health berubah, plus denyut berjangka

Yang dibandingkan **hanya `health`**. `runHealth` juga selalu menulis `lastSeenAt: new Date()`, dan
`lastSeenAt` ada di `FIELDS.vps` — jadi membandingkan seluruh snapshot akan selalu "berubah" dan
denyut 5 menit itu justru yang sedang dicabut.

Tapi `lastSeenAt` yang berhenti menyeberang akan mendarat basi selamanya di tiap client tanpa satu pun
error — kelas gagal-senyap [ADR-0090](0090-stempel-waktu-backlog-created-started.md)/[ADR-0093](0093-dependency-antar-backlog.md)/[ADR-0105](0105-changelog-per-project.md).
Karena itu ditambah denyut berjangka `PUBLISH_HEARTBEAT_MS` (1 jam): 12 baris/hari/vps alih-alih 288,
dan `lastSeenAt` akurat dalam ±1 jam. Pelacaknya kolom **lokal** `Vps.lastPublishedAt` — migration
aditif, **tak** masuk `FIELDS`, cermin `repoDir`/`keyPath`/`components`.

`lastSeenAt` sendiri tetap ditulis di **setiap** sapuan, di luar cabang bersyarat: memangkas
penerbitan tak boleh ikut memangkas pembaruan lokal "terakhir terlihat hidup" yang dibaca dashboard.

`runAudit` **tidak disentuh**: `AUDIT_MS = 24 jam` dan `auditSweep` melewati VPS yang `lastAuditAt`-nya
< 24 jam, jadi ia paling banyak 1 baris/hari/vps — itu bukan denyut.

### 5. gzip di dua route, bukan plugin global; dekompresi opt-in ber-cap ganda

Hub memampatkan dengan `zlib.gzipSync` **di dalam** `/sync/pull` dan `/sync/bootstrap` saat client
mengirim `accept-encoding: gzip`, dan menyetel `vary: accept-encoding` **tanpa syarat** — termasuk
pada balasan polos, karena menyetelnya hanya di cabang gzip adalah cara klasik meracuni cache
perantara.

`safeRequest` men-decompress hanya bila **dua** syarat terpenuhi: pemanggil meminta
(`acceptEncoding: "gzip"`) **dan** balasannya memang ber-gzip. Peer yang mengirim `content-encoding:
gzip` tanpa diminta tak boleh mengubah bentuk body bagi pemanggil yang tak siap menerimanya.

**Dua cap, bukan satu.** `maxResponseBytes` menghitung byte kabel, dan itu berhenti cukup begitu
dekompresi menyala: 40 MB nol mampat jadi ~40 KB dan lolos cap kabel mana pun. `maxDecodedBytes`
(default = `maxResponseBytes`) mematikan stream saat keluaran gunzip melewatinya.

Opt-in per panggilan karena `safe-outbound-request.ts` juga melayani webhook keluar
([ADR-0100](0100-webhook-keluar-peristiwa.md)) di balik penjaga SSRF, dan tak satu pun pemanggil itu
meminta dekompresi.

## Konsekuensi

- Client baru menyelesaikan tarikan awal dalam ~3 request, bukan mandek di 500 dari 3.637.
- Client yang tertinggal jauh (>7 hari) ikut sembuh: keputusan 1 & 2 berlaku untuk jarak berapa pun,
  bukan hanya instalasi baru.
- Feed `vps` berhenti tumbuh. 2.469 baris lama tetap ada sampai `pruneSyncFeed` menyapunya (tersusul
  + lewat 7 hari, ADR-0131) — tak perlu tindakan manual.
- Penghematan −4,0 MB itu datang dari segelintir VPS dan akan **tumbuh**: `runHealth` `return false`
  sebelum publish bila SSH gagal, jadi hanya ~1–2 dari 9 VPS yang benar-benar berdenyut hari ini.
- Kegagalan pull tak lagi senyap: dicatat sekali pada transisi sehat→gagal dan sekali saat pulih.
  Yang membuat insiden ini butuh investigasi penuh untuk sekadar dikenali bukan cap byte-nya,
  melainkan `catch { }` kosong yang membuat mandek total tak bisa dibedakan dari sepi.
- `SafeRequestOptions` bertambah dua field opsional; seluruh pemanggil lain tak berubah perilakunya.

## Alternatif yang ditolak

- **Menahan kursor pada record yang gagal diterapkan.** Livelock ADR-0082, dan di sini fatal: induknya
  ada di halaman berikutnya yang takkan pernah ditarik.
- **Tabel `SyncDeferred` durable.** Drain yang utuh sudah menyelesaikan 510 dari 510; tabel baru
  berarti permukaan gagal baru untuk masalah yang sudah habis.
- **Membuang `lastSeenAt` dari `FIELDS.vps`.** Menghemat satu kolom dengan cara menghilangkan nilai
  yang memang harus dilihat sama oleh semua mesin.
- **Membuat `lastSeenAt` sendiri berkadensi per jam.** Menghemat satu kolom dengan cara mengubah arti
  kolom yang dibaca dashboard — biaya yang salah tempat.
- **`@fastify/compress`.** Belum jadi dependency, menambahkannya menyentuh daftar `--external` di
  skrip build esbuild, dan ia memasang hook di seluruh lifecycle — untuk dua endpoint mesin-ke-mesin
  yang payload-nya sudah dibatasi 1 MB dan sudah utuh di memori.
- **Menaikkan `limit` baris `pull` alih-alih memotong per byte.** Satuannya yang salah, bukan
  angkanya: berapa pun `limit` dipilih, komposisi halaman tetap yang menentukan ukurannya.
- **Batching apply dalam satu `$transaction`.** 889 record × ~1 ms ≈ 1 detik — di bawah kebisingan
  dibanding keputusan mana pun di atas, dan ia menabrak `deferred`: satu record gagal membatalkan
  seluruh batch, sehingga fallback per-record tetap harus ada.
