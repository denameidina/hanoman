# ADR-0131 — Retensi change-feed sync, dan kegagalan memuat yang tak boleh senyap

Status: accepted · 2026-08-20

## Konteks

Mesin record-sync ([ADR-0045](0045-sync-record-version-stamp.md), SPEC-213) menulis satu baris
`SyncLog` ber-**snapshot penuh** untuk setiap tulisan tersync, dan `seq`-nya adalah kursor global
yang dipakai klien untuk menarik perubahan. Sejak dibangun, **tak ada satu pun jalur yang membuang
baris feed** — bukan karena diputuskan begitu, tapi karena tak pernah ada yang menuliskannya.
`services/retention.ts` sudah menyapu tiket, sesi, delivery webhook, dan session result; `SyncLog`
tak terdaftar di sana.

Yang terjadi di hub produksi (`hanoman.nafanesia.id`), terukur 2026-08-20:

| Isi | Baris | Ukuran |
|---|---|---|
| `SyncLog` entity `vps` | 121.222 | **213,6 MB** |
| `SyncLog` entity `spec` | 2.656 | 9,8 MB |
| seluruh tabel `Spec` | 697 | 2 MB |

**83% isi database adalah snapshot health VPS yang sudah tersusul.** Sumbernya `pollHealth()` di
`services/vps-audit.ts`, yang memanggil `notifySynced("vps", …)` di **setiap** polling (tiap 5
menit per VPS, 16 project). Sejak 2026-07-14 itu ~3.275 baris/hari, masing-masing ~1,8 KB.

Akibatnya bukan sekadar boros disk. Hub berjalan di `journal_mode=delete` (rollback journal, bukan
WAL), jadi **setiap tulisan mengambil kunci eksklusif atas seluruh berkas** dan memblokir semua
pembaca. Feed yang membengkak mencekik pembacaan sampai timeout:

```
Aug 20 11:09:23  P1008  Socket timeout (the database failed to respond
                        to a query within the configured timeout)
```

Berulang sejak 2026-08-17. Yang ikut jadi korban adalah `GET /specs` — dan di situlah kegagalannya
menjadi **tak terlihat**, karena ia ditelan di dua tempat sekaligus:

- `src/src/screens/BacklogScreen.tsx` — `p?.then(…).catch(() => { })`. `data` bertahan pada muatan
  terakhir yang berhasil, jadi layar menyajikan jumlah **basi** seolah itu kebenaran.
- `server/src/services/events.ts` — `try { msg = await g.build(); } catch { continue; }`. Grup
  `specs` di-recompute tiap detik, jadi hub sakit melahirkan penelanan senyap 86.400×/hari tanpa
  satu pun jejak di journal.

Gejala yang sampai ke operator karena itu bukan "server lambat" melainkan **"backlog saya
berkurang"**: sebagian refetch gagal, sisanya lolos, dan angka di layar berubah-ubah — padahal
empat snapshot berturut-turut membuktikan barisnya hanya bertambah (605 → 642 → 695 → 697) dan
sepanjang riwayat feed hanya ada **4** operasi `delete` untuk entity `spec`.

## Keputusan

**1. `SyncLog` masuk retensi terpusat, dengan satu invarian yang menjaga kebenaran sync.**

`pruneSyncFeed()` di `services/retention.ts` (bukan modul/engine baru — `startRetentionSweep()`
sudah ada dan inilah rumahnya) membuang baris yang **sudah tersusul** DAN sudah lewat jendela
`RETENTION_DAYS.syncFeed` (7 hari).

> **Invarian — jangan dilanggar tanpa ADR baru:** baris **terbaru per (`entity`, `recordId`) tak
> pernah dipangkas.**

Invarian itulah yang membuat pemangkasan aman. `pull()` membaca `seq > cursor` **tanpa syarat
kontiguitas** — tak ada deteksi lubang nomor seq (`feedHole` menandai record yang gagal
*divalidasi*, bukan seq yang hilang) — sehingga klien yang tertinggal sejauh apa pun tetap
**konvergen** selama versi terakhir tiap record masih ada di feed. Yang hilang bagi klien lambat
hanyalah versi antara, yang memang tak pernah ia butuhkan.

**2. Pemangkasan feed sengaja tak tunduk pada jatah `batchSize`.**

Jatah itu melindungi penghapusan yang menyentuh **berkas** (transkrip, lampiran). Feed adalah
hapus-baris murni dan harus bisa mengejar tunggakan: dengan jatah 100/hari, 121.222 baris butuh
**1.210 hari** untuk habis. Karena itu ia dilaporkan sebagai field sendiri, `RetentionReport.feedPruned`.

**3. Kegagalan memuat tak boleh menyamar sebagai data.**

- BacklogScreen menandai jumlahnya **`· basi`** (beserta `role="status"` dan warna amber) dan
  men-toast operator **sekali pada transisi sehat→gagal** — digerbangi ref, karena refetch ikut
  tiap frame siar WS dan toast per-kegagalan akan jadi hujan toast saat hub sakit.
- Siar dashboard mencatat kegagalan build frame sekali saat mulai gagal dan sekali saat pulih.

**4. `journal_mode=WAL` disetel di kode, bukan dengan tangan.**

Di `delete` — default SQLite — penulis memblokir pembaca; di WAL tidak. Itulah yang mengubah
pembacaan `Spec` dari `database is locked` menjadi 4 ms selagi service berjalan saat hub dipindah ke
WAL pada 2026-08-20. Ukuran feed adalah lapis pertama insiden ini; mode jurnal adalah lapis kedua,
dan retensi saja tak menyentuhnya.

Peralihan itu semula dijalankan dengan tangan pada satu berkas di satu host, jadi ia tak berlaku ke
mana pun: setiap instalasi lain (`~/.hanoman/hanoman.db` bawaan paket npm global, ADR-0086) tetap
`delete`, dan hub sendiri diam-diam kembali ke `delete` bila DB-nya dipulihkan dari backup pra-2026-08-20
atau dibuat ulang. Karena itu pragma kini disetel di `server/src/db.ts`, satu-satunya tempat klien
Prisma lahir (ADR-0100) dan jalur yang sama-sama dilewati `hanoman` CLI maupun `node dist/server.js`.
Mode jurnal tersimpan di **header berkas**, jadi sekali disetel ia berlaku untuk setiap proses yang
membuka DB itu — termasuk `prisma migrate`. Kegagalannya tak fatal: koneksi lain yang sedang menulis
menolak peralihan mode sementara, dan boot berikutnya mencobanya lagi.

Konsekuensinya satu guard ikut dipersempit. `server/test/webhook-no-raw-writes.test.ts` melarang
`$executeRaw`/`$queryRaw` di seluruh `server/src` karena tap webhook tak bisa melihat SQL mentah dan
pelanggarannya gagal **senyap**. Yang sebenarnya dijaga aturan itu adalah raw yang **menulis model
terlacak**; `PRAGMA` tak menyentuh satu baris model pun. Guard-nya kini menolak raw apa pun yang
bukan pragma **dan** yang berada di luar berkas yang disebut namanya — jadi ia masih menangkap
`$executeRawUnsafe("DELETE FROM Spec")` sekalipun ditulis di dalam `db.ts`.

## Konsekuensi

- DB hub 258 MB → **18,3 MB** setelah pemangkasan + `VACUUM`; `integrity_check: ok`, 697 spec utuh.
- Feed kini berbatas: ukurannya konvergen ke "satu baris per record + tulisan 7 hari terakhir".
- Klien sync yang tertinggal >7 hari kehilangan versi *antara*, tak pernah versi *terakhir* —
  konvergensi tetap dijamin, dan `backfillFeed()` tetap jadi jalur pemulihan bila feed dipangkas
  lebih agresif suatu saat.
- Operator kini melihat perbedaan antara "backlog memang segitu" dan "layar gagal disegarkan".
  Angka tanpa penanda kembali bisa dipercaya.
- Setiap DB yang dibuka hanoman berpindah ke WAL saat boot pertama, bukan hanya hub. Backup yang
  terdokumentasi (`sqlite3 ".backup"`, [deploy-vps](../operations/deploy-vps.md) §7) tetap benar
  karena ia backup online yang ikut membaca WAL; menyalin `hanoman.db` dengan `cp` mentah **tidak**
  — di WAL commit terbaru bisa masih berada di berkas `-wal`. `server/test/global-setup.ts` sudah
  menghapus `-wal`/`-shm` bersama berkas DB, jadi DB test tetap lahir bersih tiap run.
- Yang **tidak** diubah: `pollHealth()` tetap memanggil `notifySynced("vps", …)` tiap polling.
  Retensi membatasi akibatnya, jadi menahan publikasi saat health tak berubah adalah optimasi
  terpisah — bukan syarat kebenaran, dan tak perlu ikut di sini.

## Alternatif yang ditolak

- **Kumpulkan seluruh seq yang dipertahankan lalu `deleteMany({ seq: { notIn } })`.** Daftarnya
  tumbuh sebesar jumlah record (ribuan) dan menabrak batas variabel SQLite. Bentuk `groupBy` +
  `deleteMany` ber-grup meniru `pruneHistory()` webhook ([ADR-0100](0100-webhook-keluar.md)) dan
  tiap query hanya membawa tiga predikat konstan.
- **Buang baris `vps` saja.** Memperbaiki gejala hari ini dan membiarkan entity berikutnya
  mengulanginya. Aturan "tersusul + lewat jendela" berlaku seragam dan tak perlu tahu entity apa
  yang sedang rakus.
- **Modul/engine retensi tersendiri untuk feed.** `startRetentionSweep()` sudah ada; timer kedua
  hanya menambah permukaan tanpa menambah kemampuan.
- **Batasi feed dengan "simpan N terakhir" seperti histori webhook.** N per record tak menjawab
  entity yang punya satu record tapi ribuan tulisan (justru kasus `vps`), sedangkan jendela waktu
  menjawab keduanya.
- **Cukup setel WAL di hub dan catat langkahnya di runbook.** Itu yang sudah terjadi, dan justru
  bentuk kegagalannya: keputusan yang hidup hanya di runbook tak berlaku untuk instalasi yang tak
  membaca runbook itu, dan tak bertahan melewati satu restore pun.
- **Biarkan `.catch(() => { })` dan cukup perbaiki servernya.** Menghapus penyebab hari ini tanpa
  menghapus kelas kegagalannya: kegagalan muat apa pun di masa depan akan kembali menyamar sebagai
  data, dan justru penyamaran itu yang membuat insiden ini butuh investigasi penuh untuk dikenali.
