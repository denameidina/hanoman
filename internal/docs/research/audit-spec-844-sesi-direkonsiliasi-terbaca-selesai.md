# Audit SPEC-844 — sesi yang direkonsiliasi saat boot terbaca sebagai "selesai" hijau

**Tanggal:** 2026-08-19 · **Sumber:** GitHub issue [denameidina/hanoman#9](https://github.com/denameidina/hanoman/issues/9)
(@wulanrlestari) · **Severity pelapor:** Moderate · **Flow:** qa

**Putusan:** Spec → Plan → Execute **penuh** + **ADR baru** — perbaikannya menuntut kolom baru
(`SessionHistory`), migration, dan perubahan kontrak keluar (DTO + katalog webhook). Lihat
§Keputusan.

## Gejala yang dilaporkan

Sesi yang mati bersama tmux di luar hanoman (reboot, `tmux kill-server`, crash host) ditutup
`reconcileHistory()` saat boot berikutnya, lalu **dirender hijau `selesai`** di Riwayat sesi —
seolah pekerjaannya tuntas. Operator bisa serah-terima atau menutup pekerjaan berdasarkan sinyal
sukses palsu, dan tak pernah ditawari jalan pemulihan.

## Akar masalah

`SessionHistory` mencatat **kapan** sebuah baris berakhir, tak pernah **bagaimana**. Tiga
akhir yang secara struktural berbeda dipadatkan ke dalam dua kolom nullable yang sama:

| akhir sesi | penulis | `endedAt` | `exitCode` | dirender hari ini |
|---|---|---|---|---|
| operator menutup sesi, pane **masih hidup** | `killSession()` → `finishSession()` | `now` | **`null`** | `selesai` (hijau) |
| operator menutup sesi, pane sudah mati | `killSession()` → `finishSession()` | `now` | `p.code` | `selesai` / `exit N` |
| tmux lenyap di luar hanoman | `reconcileHistory()` saat boot | `updatedAt` | **`null`** | `selesai` (hijau) |

Baris 1 dan 3 **tak bisa dibedakan** dari data yang tersimpan. Karena itu tak ada perbaikan
murni-UI yang mungkin: `statusOf()` (`SessionHistoryModal.tsx:21-24`) memetakan
`exitCode === null` → `{ label: "selesai", tone: "ok" }`, dan tone `ok` = `--leaf-600` (hijau,
`ds/components/feedback.tsx:15`). Membalik pemetaan itu menjadi "terputus" akan salah melabeli
**seluruh** penutupan normal, yang jauh lebih banyak.

`pty.ts:55` sudah menyatakan premisnya: *"`exited` hanya berarti prosesnya mati, dan TUI agen tak
pernah mati sendiri"* — jadi `exitCode: null` adalah keadaan **normal** untuk sesi yang sehat
(`killSession` mengirim `exitCode: p.exited ? p.code : null`), bukan penanda anomali.

### Kelas bug yang sama, ketiga kalinya

`pty.ts:63-66` (SPEC-402) sudah mengeja aturannya untuk grid Terminal yang hidup: *"Tanpa ini UI
cuma punya `exited` dan melabeli agen yang dihentikan di tengah kerja sebagai 'Selesai' hijau"*.
SPEC-433 mengulanginya untuk pil "Selesai", SPEC-451 untuk pintu keputusan lead. Tabel riwayat
adalah permukaan keempat yang belum ikut: **menilai keadaan dari ketiadaan sinyal, bukan dari
bukti**.

## Bukti terukur (DB hidup `~/.hanoman/hanoman.db`, 806 baris)

```
total                     806
berjalan (endedAt null)     9
ended + exitCode NULL     784   ← seluruhnya hijau "selesai"
ended + exitCode 0          5
ended + exitCode ≠ 0        8   (2× exit 1, 6× exit 143 — kelas SPEC-402)
```

**784 dari 797 baris yang berakhir (98,4 %) dirender hijau tanpa satu pun bukti sukses.** Hanya
13 baris di seluruh instalasi yang benar-benar memikul exit code.

### Baris rekonsiliasi bisa dipisahkan, dan pemisahannya bersih

`reconcileHistory()` membaca `updatedAt` **sebelum** update-nya sendiri, jadi sesudah rekonsiliasi
`updatedAt − endedAt` = jarak antara lahirnya baris dan boot yang menemukannya. `finishSession()`
menulis `endedAt = new Date()` di dalam update yang sama, jadi jaraknya nol. Terukur:

| kelompok | n | `updatedAt − endedAt` |
|---|---|---|
| tutup normal | 777 | **0 – 39 ms** |
| rekonsiliasi | **20** | **275 966 – 82 224 277 ms** (4,6 mnt – 22 j 50 mnt) |

Empat orde besaran memisahkannya, tanpa satu pun baris di antara 39 ms dan 4,6 menit.

### Cacat kedua: `endedAt = updatedAt` adalah waktu **LAHIR**, bukan "waktu terbaik yang tersedia"

Komentar `session-history.ts:127` mengklaim `updatedAt` = waktu terbaik yang tersedia. Itu keliru
untuk kasus yang justru selalu terjadi: `session-history.ts` adalah satu-satunya penulis tabel ini
dan ia hanya menulis pada **lahir** dan **tutup**, jadi untuk baris yang masih berjalan
`updatedAt == createdAt ≈ startedAt`. Terukur pada **20 dari 20** baris rekonsiliasi:
`endedAt − startedAt` = **0 ms**, tanpa kecuali.

Akibatnya sebuah sesi yang hidup 22 jam 50 menit sampai reboot tercatat:

```
sid 3c71012d · kind terminal
mulai           2026-08-16 06:36:44
endedAt         2026-08-16 06:36:44   → Durasi "0 dtk"
direkonsiliasi  2026-08-17 05:27:08   (tak tersimpan di mana pun)
status          selesai (hijau)
transkrip       tidak ada
```

Tiga baris backlog nyata ikut di dalamnya (`spec-751`, `spec-752`, `spec-753`, direkonsiliasi
2026-08-14 08:10:50) — persis skenario "operator serah-terima berdasarkan sinyal sukses palsu"
yang dilaporkan.

### Cacat ketiga: baris rekonsiliasi tak punya transkrip sama sekali

**20 dari 20** ber-`transcriptKey` null. Wajar — `captureTranscript()` berjalan di dalam
`killSession()` **sebelum** `tmux kill-session`, dan pada jalur ini tmux sudah tak ada. Jadi
justru baris yang paling butuh diperiksa manusia adalah baris yang paling sedikit menyimpan
bukti, dan UI tak mengatakannya: pesan yang muncul berbunyi *"sesi ini ditutup sebelum fitur
riwayat ada, atau panenya tak menyisakan keluaran"* — dua sebab yang keduanya salah di sini.

### Kontrak keluar ikut membawa konflasi yang sama

`shared/src/webhook.ts:147-149` mendokumentasikan `session.ended` sebagai *"`exitCode` bukan 0
berarti pane mati gagal; null berarti tak terbaca, misalnya tmux mati di luar hanoman"* — satu
kalimat yang menyatukan dua keadaan berbeda dan diteruskan apa adanya ke setiap integrator serta
ke halaman dokumentasi in-app yang disetir katalog itu.

## Hipotesis yang dibantah

- **"Cukup perbaiki `statusOf()`."** Terbantah oleh tabel di §Akar masalah: 764 penutupan normal
  memakai `exitCode: null` yang sama. Perbaikan murni-UI menukar bug ini dengan kebalikannya.
- **"Pakai saja heuristik `updatedAt − endedAt` di UI."** Ia bekerja untuk baris yang sudah ada
  (§Bukti), tapi menjadikannya kontrak berarti mengunci detail penyimpanan Prisma sebagai
  semantik produk; satu penulis baru yang menyentuh baris di tengah sesi meruntuhkannya diam-diam.
  Sah sebagai **backfill sekali jalan**, bukan sebagai aturan render.
- **"`exitCode: 143` menutupi kasusnya."** Tidak. 143 lahir saat pane **mati** dan hanoman-lah
  yang menutup barisnya (SPEC-402); reboot tak meninggalkan pane untuk dibaca.

## Keputusan: Spec → Plan → Execute penuh, dengan ADR baru

Perbaikan yang benar menuntut kolom baru pada `SessionHistory` (CLAUDE.md: *"Jangan ubah skema
tanpa migration + ADR"*), menyentuh kontrak lintas paket (`zSessionHistory`, katalog webhook), dan
memuat satu keputusan yang perlu dicatat: **apa yang disimpan** (cara sebuah baris ditutup) versus
**apa yang diturunkan** (kelas hasilnya) — arah yang sama dengan ADR-0090 dan berlawanan dengan
ADR-0011/0018. Karena itu ia tidak masuk cabang "temuan kecil, langsung Execute".

Rancangannya di `docs/superpowers/specs/2026-08-19-spec-844-akhir-sesi-riwayat-design.md`.
