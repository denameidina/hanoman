# ADR-0125 — Riwayat sesi mencatat **cara** sebuah baris ditutup; kelas hasilnya diturunkan

- Status: accepted
- Tanggal: 2026-08-19
- Konteks: SPEC-844 (GitHub issue denameidina/hanoman#9)
- Menegakkan: ADR-0079 (riwayat sesi LOCAL-only + transkrip berkas) · ADR-0016 (tmux sumber kebenaran sesi hidup) · ADR-0090 (kolom hanya untuk fakta yang tak bisa dihitung ulang) · ADR-0100 (katalog webhook menyetir tap & docs)
- Tidak mencabut apa pun. ADR-0011/0018 (docs & coverage sebagai nilai turunan) **ditegakkan**, bukan dibalik — lihat §1.

## Konteks

`SessionHistory` mencatat **kapan** sebuah baris berakhir, tak pernah **bagaimana**. Tiga akhir
yang secara struktural berbeda dipadatkan ke dua kolom nullable yang sama:

| akhir sesi | penulis | `endedAt` | `exitCode` |
|---|---|---|---|
| operator menutup sesi, pane **masih hidup** | `killSession()` → `finishSession()` | `now` | **`null`** |
| operator menutup sesi, pane sudah mati | `killSession()` → `finishSession()` | `now` | `p.code` |
| tmux lenyap di luar hanoman (reboot, `kill-server`, crash) | `reconcileHistory()` saat boot | `updatedAt` | **`null`** |

Baris 1 dan 3 **tak bisa dibedakan** dari data yang tersimpan, dan `statusOf()` memetakan keduanya
ke `selesai` hijau. Sesi yang terputus reboot karena itu disajikan sebagai penyelesaian sukses:
operator bisa serah-terima atau menutup pekerjaan berdasarkan sinyal yang salah, dan tak pernah
ditawari jalan pemulihan.

Karena keduanya identik di DB, **tak ada perbaikan murni-UI yang mungkin**: membalik pemetaan
`exitCode === null` akan salah melabeli setiap penutupan normal. `pty.ts:55` sudah menyatakan
premisnya — *"`exited` hanya berarti prosesnya mati, dan TUI agen tak pernah mati sendiri"* —
jadi `exitCode: null` adalah keadaan **normal** sesi sehat, bukan penanda anomali.

Terukur di DB hidup (806 baris, lihat `research/audit-spec-844-*.md`): **784 dari 797 baris
berakhir (98,4 %) dirender hijau tanpa satu pun bukti sukses**; hanya 13 memikul exit code (5×0,
2×1, 6×143). Dua puluh di antaranya hasil rekonsiliasi boot, dan **20 dari 20** berdurasi 0 ms
serta **20 dari 20** tanpa transkrip.

Ini pengulangan keempat kelas bug yang sama — **menilai keadaan dari ketiadaan sinyal, bukan dari
bukti** — sesudah SPEC-402 (pil "Selesai" grid Terminal), SPEC-433 (pil digerbangi `pane_dead`),
dan SPEC-451 (pintu keputusan lead digerbangi `exited`).

## Keputusan

### 1. Yang **disimpan** = cara baris ditutup. Kelas hasilnya **diturunkan**.

Dua kolom baru pada `SessionHistory`, keduanya nullable tanpa default:

- **`endedReason String?`** — `"closed"` (hanoman menutupnya lewat `killSession()`) atau
  `"reconciled"` (pane sudah lenyap saat boot; hasilnya **tak diketahui**). `null` = baris lahir
  sebelum kolom ini ada.
- **`reconciledAt DateTime?`** — kapan boot menemukan panenya lenyap. Hanya terisi bersama
  `"reconciled"`.

Issue menyarankan enum empat nilai `completed|failed|interrupted|reconciled_unknown` **di kolom**.
Ditolak sebagai bentuk penyimpanan: `completed`/`failed` **bisa dihitung ulang** dari `exitCode`
yang sudah tersimpan, dan menyimpan keduanya membuat dua sumber untuk satu fakta yang bisa
berselisih (ADR-0011/0018). Yang **tidak** bisa dihitung ulang adalah siapa yang menutup barisnya —
aturannya bukan "selalu turunkan" melainkan *bisakah dihitung ulang dari sumber lain*, arah yang
sama dengan ADR-0090 (`Spec.createdAt`).

Kosakata empat nilai itu tetap dikirimkan, sebagai hasil **turunan** satu fungsi murni
`sessionOutcome()` di `@hanoman/shared` — satu definisi untuk UI, test, dan prosa kontrak:

| `endedAt` | `endedReason` | `exitCode` | `sessionOutcome()` | badge |
|---|---|---|---|---|
| `null` | — | — | `running` | `berjalan` · neutral |
| terisi | `reconciled` | apa pun | **`interrupted`** | **`terputus`** · warn |
| terisi | `closed` / `null` | `null` atau `0` | `completed` | `selesai` · ok |
| terisi | `closed` / `null` | ≠ 0 | `failed` | `exit N` · err |

`exit 143` (SIGTERM, kelas SPEC-402) sengaja **tetap** `failed` dengan kodenya terlihat, bukan
dilebur jadi `interrupted`: kode yang tercetak lebih informatif daripada kategorinya.

### 2. `endedAt` baris rekonsiliasi adalah batas **BAWAH**, `reconciledAt` batas atasnya

Komentar lama mengklaim `updatedAt` = "waktu terbaik yang tersedia". Itu keliru dan terukur:
`services/session-history.ts` adalah satu-satunya penulis tabel ini dan ia hanya menulis saat
**lahir** dan **tutup**, jadi `updatedAt` baris berjalan sama dengan waktu lahirnya — **20 dari
20** baris rekonsiliasi ber-`endedAt − startedAt` = **0 ms**, sehingga sesi yang hidup 22 j 50 mnt
sampai reboot tercatat "0 dtk".

`endedAt` **tidak** dipindah ke waktu boot: itu akan mengarang klaim bahwa sesinya hidup selama
seluruh downtime. Ia tetap batas bawah yang jujur ("terakhir diketahui hidup"), `reconciledAt` jadi
batas atas, dan durasinya **tak dirender sama sekali** (`—`) — perluasan prinsip yang sudah ditulis
di `humanDuration`: *"Sesi yang belum ditutup tak punya durasi — jangan mengarang 0 dtk"*.

Konsekuensi `retention.ts` disengaja dan tak berbahaya: baris rekonsiliasi jadi kandidat purge
sedikit lebih awal (selisihnya jam, ambangnya 30 hari).

### 3. Backfill sekali jalan, berambang yang terukur

Baris lama tak bisa ditanyai, tapi jejaknya masih ada: `reconcileHistory` membaca `updatedAt`
**sebelum** update-nya sendiri, sementara `finishSession` menulis `endedAt = new Date()` **di
dalam** update yang sama. Terukur di DB hidup:

| kelompok | n | `updatedAt − endedAt` |
|---|---|---|
| tutup normal | 777 | **0 – 39 ms** |
| rekonsiliasi | 20 | **275 966 – 82 224 277 ms** |

Ambang **60 000 ms** duduk di tengah celah empat orde besaran itu. Arah salahnya fail-safe: yang
terlewat tetap terbaca persis seperti sebelum spec ini (`closed`), dan yang kelebihan menuntut
update `finishSession` mendarat > 60 dtk sesudah `endedAt` dihitung — mustahil, keduanya satu
pernyataan.

### 4. Baris terputus menjelaskan dirinya; CTA pemulihan memakai jalur yang sudah ada

Detail baris `interrupted` merender `Callout` warn yang menyatakan hasilnya tak diketahui, tak ada
exit code, dan transkripnya kemungkinan besar tak ada — `captureTranscript()` berjalan di dalam
`killSession()` dan di jalur ini tmux sudah lenyap. Metadata `Selesai` menjadi **`Terakhir terlihat
hidup`** dengan baris tambahan **`Terdeteksi mati`**.

Tak ada endpoint pemulihan baru: **"Mulai lagi"** (`restartableKind`, ADR-0079) sudah men-spawn
sesi baru berkonteks sama. Yang kurang cuma keterangan kenapa operator perlu menekannya.

### 5. Kontrak keluar ikut diperbaiki

`WEBHOOK_ENTITIES` entri `session` sebelumnya mendokumentasikan `session.ended` sebagai *"exitCode
… null berarti tak terbaca, misalnya tmux mati di luar hanoman"* — satu kalimat yang memancarkan
konflasi yang sama ke setiap integrator dan ke halaman dokumentasi in-app yang disetir katalog itu.
`endedReason` + `reconciledAt` masuk allowlist `fields`, prosanya ditulis ulang, dan
`derived.changed` tetap `["endedAt"]` (ketiga kolom selalu ditulis dalam satu `update`).

## Konsekuensi

- Sesi yang terputus reboot tak pernah lagi terbaca sukses, **untuk baris baru maupun 20 baris lama
  yang ter-backfill**. Baris yang lolos ambang backfill tetap terbaca seperti sebelumnya — data yang
  tak pernah dicatat tak bisa dipulihkan, dan mengarangnya lebih buruk daripada mengakuinya.
- Integrator webhook mendapat dua field baru dan prosa yang tak lagi menyatukan dua keadaan.
- `SessionHistory` tetap LOCAL-only: tak ada `version`, tak masuk `FIELDS`/`SYNCED`.

## Gotcha

1. **`endedReason` dibaca LONGGAR, bukan sebagai enum di boundary.** Kolomnya `String?`,
   `zSessionHistory` memakai `z.string().nullable()`, dan `sessionOutcome()` memperlakukan segala
   yang bukan `"reconciled"` sebagai `closed`. Menjadikannya enum ketat membuat 784 baris lama
   (`null`) gagal validasi di setiap pembacaan.
2. **`endedAt` baris rekonsiliasi bukan waktu berakhir.** Ia batas bawah. Setiap konsumen yang
   menghitung durasi darinya akan melaporkan angka yang jauh terlalu kecil — itulah bug "0 dtk"
   yang justru diperbaiki spec ini.
3. **Ambang 60 000 ms adalah backfill, BUKAN aturan render.** Memakainya sebagai aturan mengunci
   detail penyimpanan Prisma sebagai semantik produk; satu penulis baru yang menyentuh baris di
   tengah sesi meruntuhkannya diam-diam.
4. **Kolom baru wajib masuk `WEBHOOK_ENTITIES.fields`**, dijaga `webhook-catalog-dmmf.test.ts`:
   nama kolom yang salah ketik mengosongkan payload **tanpa satu pun error** (kelas ADR-0094).
5. **Baris `closed` sengaja TIDAK berubah.** Menutup sesi yang panenya masih hidup adalah cara
   **normal** sesi sehat berakhir — pane sesi sukses justru tak pernah mati (`pty.ts:55`). Melabeli
   ke-764 baris itu "terputus" menukar bug ini dengan kebalikannya yang 38× lebih besar.
6. **Backfill memakai `CAST(... AS INTEGER)`** karena Prisma menyimpan `DateTime` SQLite sebagai
   INTEGER milidetik. Bila representasinya kelak berbeda (teks ISO), `CAST` membuat selisihnya 0 →
   nol baris cocok → seluruh tabel jatuh ke `closed`, yaitu perilaku sebelum spec ini. Dibuktikan
   sebagai kontrol negatif saat migration ditulis.
