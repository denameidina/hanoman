# Audit SPEC-845 — purge riwayat menghapus berkas transkrip sebelum penghapusan DB commit

- **Sumber**: finding QA SPEC-845 · severity `major` · prioritas sedang · GitHub issue
  [denameidina/hanoman#8](https://github.com/denameidina/hanoman/issues/8) · pelapor @wulanrlestari
- **Tanggal**: 2026-08-19
- **Menyentuh (Execute)**: `server/src/services/session-history.ts` ·
  `server/src/services/transcript-store.ts` · `server/src/services/retention.ts` ·
  `server/src/routes/session-history.ts` · `server/src/server.ts` · test terkait ·
  `internal/docs/architecture/api-contract.md` · `internal/docs/adr/0125-*`
- **Keputusan fase**: **Spec dan Plan DILEWATI**. Akarnya satu urutan operasi, terbukti dua kali
  lewat reproduksi terukur (§1), dan premis yang menopangnya terbukti **salah** (§2) — perbaikannya
  jelas dan terkonsentrasi. Dokumen ini jadi doc-of-record.
- **ADR**: [ADR-0126](../adr/0126-durabilitas-penghapusan-transkrip-riwayat.md) — **mengamandemen
  ADR-0079 §5** (purge "ikut menghapus berkas transkripnya" kini punya urutan & aturan durabilitas
  yang mengikat). ADR-0018/0019 (nilai turunan) **ditegakkan**, ADR-0024 (tanpa worker/cron)
  **ditegakkan**.

---

## 1. Gejala dan bukti

Finding melaporkan `purgeHistory()` menghapus berkas transkrip lebih dulu, lalu baru
`deleteMany()`, tanpa transaksi maupun kompensasi. Kode `session-history.ts:102-113` memang
berbentuk itu. Yang belum ada di finding adalah **pengukurannya**, jadi keduanya direproduksi
sebagai test sungguhan terhadap DB dan filesystem nyata.

**Reproduksi #1 — kegagalan DB sesudah berkas hilang.** Satu baris `SessionHistory` ber-transkrip
diseed, `prisma.sessionHistory.deleteMany` diganti fungsi yang melempar `SQLITE_BUSY`, lalu
`purgeHistory({ projectId: "p9" })` dipanggil:

| Probe sesudah purge gagal | Hasil |
|---|---|
| `listHistory({projectId:"p9"}).total` | `1` — baris **hidup** |
| `getHistory(id).hasTranscript` | `true` — metadata mengaku punya transkrip |
| `transcriptOf(id)` | `null` — isinya tak ada |
| `readdirSync(transcriptDir())` | `[]` — berkasnya **lenyap permanen** |

Persis dampak yang dilaporkan: baris yang selamat menunjuk bukti yang sudah dihancurkan, dan
mengulang purge tak bisa mengembalikannya.

`SQLITE_BUSY` bukan hipotesis jauh di hanoman. Sejak ADR-0086 seluruh instance berbagi **satu
berkas** SQLite di `$HANOMAN_HOME`, ditulis bersamaan oleh sweep retensi, tap webhook, denyut lead,
engine scheduler, dan tiap request. Jendela yang sama juga terbuka lebar tanpa error apa pun: jalur
update sekali klik (ADR-0088) mematikan proses dengan `UPDATE_RESTART_EXIT = 75`, dan `SIGTERM`
di tengah loop `unlink` memberi hasil yang identik tanpa satu pun exception tercatat.

## 2. Akar — dan premis yang menopangnya ternyata salah

Komentar di `session-history.ts:107-108` menyatakan alasan urutannya:

> Berkas transkrip dihapus lebih dulu: baris yang hilang tanpa berkasnya akan meninggalkan sampah
> di disk yang tak seorang pun bisa menemukan lagi.

**Reproduksi #2 membuktikan urutan itu tidak menghasilkan sifat yang diklaimnya.** Satu sesi
`p9` yang masih **berjalan** (jadi `transcriptKey` masih `null` saat `findMany`) diselesaikan tepat
di jendela antara `findMany` dan `deleteMany` — persis yang dilakukan hook `onDeath` (ADR-0079 §3)
setiap kali sebuah sesi ditutup:

| Probe sesudah purge sukses | Hasil |
|---|---|
| `purged` | `1` |
| `listHistory({projectId:"p9"}).total` | `0` — baris terhapus |
| `readdirSync(transcriptDir())` | `['45d7673d-….log']` — **berkas yatim** |

Sebabnya struktural: `deleteMany({ where })` **menurunkan ulang** himpunannya saat dieksekusi,
sementara daftar `transcriptKey` diambil dari snapshot `findMany` sebelumnya. Setiap baris yang
masuk atau berubah di antara keduanya akan dihapus tanpa berkasnya pernah dikenal. Jadi urutan
sekarang:

- **tidak** mencegah berkas yatim — yatim tetap lahir lewat jendela yang sama; dan
- **menambah** mode gagal yang jauh lebih buruk: bukti hancur untuk baris yang selamat.

Ini adalah pertukaran satu arah. Dari dua kemungkinan urutan, hanya satu yang bisa menghancurkan
bukti, dan keduanya sama-sama bisa melahirkan yatim. Karena itu keputusannya bukan "pilih urutan
yang tak punya sisa", melainkan **pilih urutan yang sisanya bisa dipulihkan**: berkas yatim bisa
ditemukan kembali (selisih himpunan disk vs kolom `transcriptKey`), sedangkan byte yang sudah
di-`unlink` tidak bisa.

## 3. Cacat pendamping yang ikut terbuka

**(a) `deleteTranscript` menelan SEMUA error** (`transcript-store.ts:49-51` —
`.catch(() => {})`). `ENOENT` memang harus ditelan (itulah yang membuat operasi idempoten), tapi
`EACCES`/`EIO`/`EROFS` ikut hilang. Konsekuensinya purge **tak bisa** membedakan sukses penuh dari
sukses sebagian, walau urutannya sudah dibalik.

**(b) `retention.ts:36-40` memakai urutan yang sama**, per baris:
`if (row.transcriptKey) await removeTranscript(...)` lalu `prisma.sessionHistory.delete(...)`.
Jendelanya jauh lebih sempit (satu baris, bukan satu batch), tapi kelasnya identik — dan sweep
retensi jalan **tiap 24 jam tanpa manusia**, jadi ia justru jalur yang paling sering melewati
jendela itu. `server/test/retention.test.ts:29` mengunci urutan itu sebagai kontrak ("keeps the DB
row when filesystem deletion fails so a later sweep can retry"), pola yang sama dengan gotcha
SPEC-433/ADR-0107: test yang mengunci perilaku lama sebagai janji.

**(c) Tak ada yang bisa mendeteksi sisa.** Tidak ada satu pun jalur yang membaca isi
`transcriptDir()` — `server.ts:55` hanya memastikan direktorinya ada & ber-mode benar. Berkas yatim
dan `transcriptKey` menggantung sama-sama tak terlihat oleh siapa pun sampai seseorang membuka
transkrip dan mendapat 404.

## 4. Perbaikan

Opsi B dari finding (commit DB dulu, berkas dikumpulkan belakangan) dipilih di atas opsi A
(staging/trash + restore). Alasannya: opsi A menukar satu masalah durabilitas dengan masalah
durabilitas lain — direktori staging **itu sendiri** butuh pembersih dan catatan pemilik, dan
crash di antara `rename` dan commit meninggalkan berkas yang statusnya tak diketahui siapa pun.
Opsi B tak butuh catatan baru sama sekali: **kolom `transcriptKey` di tabel adalah manifes-nya**,
dan apa pun di direktori yang tak dirujuk kolom itu adalah sampah menurut definisi. Ini juga sikap
yang sama dengan `.trash` worktree di ADR-0116 ("isinya menurut konstruksi sampah, jadi 'bisa
disapu ulang' gratis tanpa tabel/kolom/migration") — **tanpa migration, tanpa kolom, tanpa tabel**.

1. **Urutan dibalik & dibatch.** `purgeHistory` memproses per potongan: `deleteMany` dengan
   `where: { id: { in: ids } }` — himpunan **eksplisit**, bukan `where` yang diturunkan ulang,
   sehingga tak ada baris yang bisa terhapus tanpa kuncinya dikenal — lalu berkasnya di-`unlink`
   **sesudah** potongan itu commit. Crash di titik mana pun menyisakan potongan-potongan yang
   selesai, satu potongan berkas yatim, dan sisa baris yang tinggal di-purge ulang.
2. **`deleteTranscript` hanya menelan `ENOENT`.** Sisanya dilempar, jadi kegagalan filesystem
   punya suara. Idempotensi (hapus dua kali = tak melempar) tetap.
3. **`reconcileTranscripts()`** — mark & sweep tanpa timer baru (ADR-0024): berkas di
   `transcriptDir()` yang tak dirujuk `transcriptKey` mana pun **dan** lebih tua dari masa tenggang
   dihapus; baris yang `transcriptKey`-nya menunjuk berkas hilang dibersihkan jadi `null` sehingga
   `hasTranscript` berhenti berbohong. Dipasang di dalam sweep retensi yang sudah ada.
4. **Route melaporkan kegagalan sebagian.** `DELETE /terminal/history` mengembalikan
   `{ purged, transcriptsDeleted, transcriptsFailed }` (aditif — `purged` tak berubah arti).

**Masa tenggang bukan hiasan.** `saveTranscript()` menulis berkas **sebelum** `finishSession()`
menulis `transcriptKey`-nya (`session-history.ts:49-56`). Di antara keduanya ada berkas hidup yang
belum dirujuk siapa pun; GC yang menyapu tanpa tenggang akan menghancurkannya — cacat yang persis
sama dengan yang sedang diperbaiki, dilahirkan kembali oleh perbaikannya. Karena itu hanya berkas
dengan `mtime` lebih tua dari `TRANSCRIPT_GC_GRACE_MS` yang boleh disentuh.

## 5. Acceptance criteria finding → tempat pembuktiannya

| Kriteria | Diwujudkan oleh |
|---|---|
| Kegagalan DB paksa tak pernah menghancurkan transkrip milik baris yang selamat | §4.1 — `unlink` sesudah commit; dikunci test injeksi kegagalan `deleteMany` |
| Crash/retry di tiap fase konvergen ke keadaan konsisten | §4.1 batching + §4.3 GC; yatim adalah satu-satunya sisa dan ia terkumpul |
| Purge idempoten | `deleteMany` atas himpunan eksplisit + `deleteTranscript` menelan `ENOENT` |
| Berkas yatim & metadata menggantung terdeteksi dan direkonsiliasi job maintenance | §4.3 di dalam sweep retensi |
| API membedakan sukses penuh dari kegagalan sebagian | §4.4 |
| Test menyuntikkan kegagalan filesystem **dan** DB | test baru di `session-history.service.test.ts` + `retention.test.ts` |

## 6. Yang sengaja TIDAK dikerjakan

- **Tak ada transaksi lintas filesystem + DB.** Tak bisa ada: `unlink` tidak ikut rollback SQLite.
  Yang bisa dijamin hanyalah arah kegagalannya, dan itulah yang dipilih.
- **Tak ada perintah CLI `hanoman` baru.** Job maintenance yang diminta finding sudah punya rumah:
  sweep retensi 24 jam di `server.ts`. Menambah timer atau proses kedua melanggar ADR-0024.
- **Tak ada perubahan skema/migration.** Manifesnya kolom yang sudah ada.
- **Streaming transkrip tak dihidupkan.** Tetap non-goal ponytail ADR-0079.

## 7. Catatan penomoran

ADR-0124 sudah dipakai worktree tetangga (`spec-843`, lampiran backlog konteks agen) yang belum
merge; audit ini mengambil **0125**. Kelas tabrakan yang sama sudah dicatat sebelumnya —
periksa `.worktrees/*/internal/docs/adr/` sebelum mengambil nomor.
