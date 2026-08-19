# ADR-0125 — Durabilitas penghapusan transkrip riwayat: DB commit dulu, berkas disapu mark & sweep

- Status: accepted
- Tanggal: 2026-08-19
- Konteks: SPEC-845 · GitHub issue [denameidina/hanoman#8](https://github.com/denameidina/hanoman/issues/8) · audit [`research/audit-spec-845-…`](../research/audit-spec-845-purge-riwayat-menghapus-transkrip.md)
- Mengamandemen: **ADR-0079 §5** — "purge … ikut menghapus berkas transkripnya" kini punya **urutan** yang mengikat, bukan hanya kewajiban.
- Menegakkan: ADR-0018/0019 (nilai turunan tak disimpan — manifesnya kolom yang sudah ada) · ADR-0024 (tanpa queue/worker/cron; sapuan menumpang `setInterval` retensi yang sudah ada) · ADR-0086 (SQLite satu berkas, tulisan bisa `BUSY`) · ADR-0116 (sampah yang menurut konstruksi sampah tak butuh tabel)
- Tidak mencabut apa pun. Tanpa skema, tanpa migration, tanpa tabel/kolom/direktori baru.

## Konteks

`purgeHistory()` menghapus **berkas transkrip lebih dulu**, lalu `prisma.sessionHistory.deleteMany()`.
Di antara keduanya tak ada transaksi maupun kompensasi — dan tak bisa ada: `unlink` tidak ikut
rollback SQLite. Yang bisa dipilih hanyalah **arah kegagalannya**, dan arah yang dipilih ADR-0079
ternyata arah yang salah. Dua reproduksi terukur (audit §1–2):

| Skenario | Hasil terukur |
|---|---|
| `deleteMany` melempar sesudah berkas di-`unlink` | baris **hidup**, `hasTranscript: true`, `transcriptOf()` `null`, direktori kosong — bukti hancur permanen |
| sesi ditutup antara `findMany` dan `deleteMany` | baris terhapus, **berkas yatim** tetap lahir |

`SQLITE_BUSY` bukan hipotesis jauh: sejak ADR-0086 satu berkas DB ditulis bersamaan oleh sweep
retensi, tap webhook (ADR-0100), denyut lead (ADR-0091), engine scheduler (ADR-0072), dan tiap
request. Jendela yang sama juga terbuka tanpa error apa pun lewat `UPDATE_RESTART_EXIT = 75`
(ADR-0088) dan `SIGTERM` biasa.

Baris kedua tabel itulah yang menentukan keputusan. Komentar di kode membenarkan urutannya dengan
"baris yang hilang tanpa berkasnya akan meninggalkan sampah di disk yang tak seorang pun bisa
menemukan lagi" — tapi `deleteMany({ where })` **menurunkan ulang** himpunannya saat dieksekusi,
sementara daftar `transcriptKey` berasal dari snapshot `findMany` sebelumnya. Yatim lahir lewat
jendela itu **pada urutan mana pun**. Jadi urutan lama tidak membeli sifat yang diklaimnya; ia hanya
menambahkan mode gagal yang menghancurkan bukti.

## Keputusan

**1. Berkas dihapus SESUDAH penghapusan barisnya commit.** Dari dua urutan yang mungkin, hanya ini
yang sisanya **bisa dipulihkan**: berkas yatim ditemukan kembali sebagai selisih himpunan (isi
direktori vs kolom `transcriptKey`), sedangkan byte yang telanjur di-`unlink` untuk baris yang gagal
terhapus hilang selamanya. Aturannya berlaku di **dua** jalur penghapusan — `purgeHistory()` dan
sweep retensi (`services/retention.ts`), yang selama ini memakai bentuk yang sama per baris dan
justru paling sering melewati jendelanya (tiap 24 jam, tanpa manusia).

**2. Penghapusan menyebut himpunan id EKSPLISIT, per potongan.** `deleteMany({ where: { id: { in
… } } })` atas potongan 200 id yang keys-nya sudah di tangan, bukan `where` yang diturunkan ulang.
Tak ada baris yang bisa terhapus tanpa kuncinya dikenal, panjang klausa `IN` dan durasi kunci tulis
SQLite tetap wajar, dan crash di titik mana pun menyisakan keadaan yang konvergen: potongan yang
sudah selesai, satu potongan berkas yatim, sisa baris yang tinggal di-purge ulang. **Purge
idempoten** — pengulangan mengembalikan `purged: 0` tanpa melempar.

**3. `deleteTranscript` hanya menelan `ENOENT`.** Itulah yang membuat penghapusan idempoten, dan
purge memang berhak menemui berkas yang sudah lenyap. `EACCES`/`EIO`/`EROFS` dilempar: tanpa itu
purge melaporkan sukses penuh atas berkas yang sebenarnya masih ada di disk.

**4. `reconcileTranscripts()` — mark & sweep dua arah, di dalam sweep retensi.** Berkas `.log` yang
tak dirujuk `transcriptKey` mana pun **dan** lebih tua dari tenggang dihapus; baris yang
`transcriptKey`-nya menunjuk berkas hilang dikosongkan jadi `null` sehingga `hasTranscript` berhenti
berbohong. **Manifesnya kolom `transcriptKey` itu sendiri** — tak ada tabel, kolom, direktori
staging, atau timer baru (ADR-0018/0019 & ADR-0024 ditegakkan); sikap yang sama dengan `.trash`
worktree ADR-0116. Ia jalan di **setiap** sapuan termasuk saat jatah batch habis di tengah jalan,
karena yatim justru lahir dari penghapusan yang terpotong.

**5. `DELETE /terminal/history` melaporkan kegagalan sebagian.** `{ purged, transcriptsDeleted,
transcriptsFailed }`, aditif — `purged` tak berubah arti. Tetap `200`: barisnya memang terhapus
meski berkasnya tidak, dan `transcriptsFailed` yang menyatakan sukses **sebagian**.

## Konsekuensi

- **Sisa yang mungkin tinggal satu jenis: berkas yatim**, dan ia terkumpul otomatis dalam ≤24 jam.
  Metadata menggantung — gejala yang dilaporkan SPEC-845 — ikut sembuh di sapuan yang sama, termasuk
  kerusakan yang sudah telanjur terjadi di instance hidup sebelum perbaikan ini.
- **Kontrak retensi lama dibalik.** "Baris ditahan bila berkasnya gagal dihapus, supaya sapuan
  berikutnya bisa mencoba lagi" tidak berlaku lagi: baris terhapus, berkasnya jadi yatim. Test yang
  mengunci kontrak lama diperbarui — pola gotcha SPEC-433/ADR-0107 (test yang mengunci perilaku lama
  sebagai janji).
- **Tetap tak ada jaminan atomik lintas filesystem + DB.** Yang dijamin hanya arah kegagalannya.
- **ponytail:** `reconcileTranscripts()` memuat seluruh `transcriptKey` non-null ke satu `Set`.
  Dibatasi retensi 30 hari dan dua kolom mungil; kalau riwayat suatu saat dilepas dari retensi,
  ubah jadi streaming per-halaman di satu tempat itu.

## Alternatif yang ditolak

- **Staging/trash directory + restore bila DB gagal** (opsi A finding). Menukar satu masalah
  durabilitas dengan yang lain: direktori staging **itu sendiri** butuh pembersih dan catatan
  pemilik, dan crash antara `rename` dan commit meninggalkan berkas yang statusnya tak diketahui
  siapa pun. Opsi yang dipilih tak butuh catatan baru sama sekali.
- **Transaksi Prisma yang membungkus `unlink`.** Mustahil — `unlink` tak ikut rollback.
- **Perintah CLI `hanoman` baru untuk rekonsiliasi.** Job maintenance-nya sudah punya rumah; timer
  atau proses kedua melanggar ADR-0024.
- **Menghapus berkas dari daftar durable (tabel outbox).** Tabel yang mencatat apa yang direktori
  dan kolom `transcriptKey` sudah catat lebih baik — cermin alasan ADR-0116 menolak `WorktreeCleanup`.

## Gotcha

1. **Tenggang sapuan wajib.** `saveTranscript()` menulis berkas **sebelum** `finishSession()`
   menulis `transcriptKey`-nya, jadi selalu ada jendela berisi berkas hidup yang belum dirujuk baris
   mana pun. GC tanpa tenggang menghancurkannya — **cacat yang sama dengan yang ADR ini perbaiki,
   dilahirkan kembali oleh perbaikannya sendiri.** `TRANSCRIPT_GC_GRACE_MS = 1 jam` jauh melampaui
   jendela nyata (dua tulisan berurutan).
2. **Sapuan disaring ke `.log`** — satu-satunya bentuk yang `saveTranscript` hasilkan. Berkas asing
   yang kebetulan mendarat di `HANOMAN_TRANSCRIPT_DIR` tak pernah ikut tersapu.
3. **Test yang memanggil `runRetention()` WAJIB menyetel `HANOMAN_TRANSCRIPT_DIR`.** Sapuan kini
   menyentuh disk; tanpa direktori terisolasi ia menyapu `~/.hanoman/transcripts` milik instance
   sungguhan di mesin yang sama.
4. **`deleteMany` harus tetap menyebut `id`, bukan `where` asal.** Mengembalikannya ke `where`
   "supaya lebih ringkas" langsung menghidupkan lagi jendela baris-tanpa-kunci di §Konteks.
5. **`reconcileTranscripts` hidup di `session-history.ts`**, bukan modul GC sendiri: ia menyentuh
   tabel `SessionHistory`, dan berkas itu memang satu-satunya pemilik tabel tersebut.
