# ADR-0149 — Ubah type lintas-alur: reset eksplisit menggantikan kunci flow

**Status:** aktif · 2026-08-25.
**Mengamandemen [ADR-0109](0109-ubah-source-backlog-item.md)** — item yang sudah dimulai tak
lagi terkunci pada source se-flow; ia boleh pindah ke mana pun, dengan syarat dikembalikan ke
`brainstorming`.
**Menegakkan** [0008](0008-stage-mirrors-run.md) (kemajuan hanya dari fase sesi — ditembus lewat
pintu eksplisit kedua, cermin revert stage SPEC-167), [0116](0116-penutupan-sesi-asinkron-worktree-trash.md)
(worktree dilepas ke `.trash`, bukan `rm` sinkron), [0077](0077-hapus-branch-tak-terpakai-pagar-per-branch.md)
(kunci `spec-open` — alasan urutan operasi di sini mengikat).

## Konteks

ADR-0109 mengunci **flow, bukan label**: item backlog yang sudah pernah dikerjakan sesi hanya boleh
pindah ke source dengan flow yang sama. Diagnosisnya benar dan masih berlaku — sesi menulis nama
fase `PIPELINES[flow]` ke berkas fase, jadi item ber-flow `feature` (lima fase) yang pindah ke
`goal` (dua fase) meninggalkan berkas yang **tak akan pernah** memuaskan `phasesComplete` flow
barunya. Itu bentuk SPEC-433: keadaan yang secara struktural tak bisa tercapai.

Yang tak diperiksa waktu itu adalah **berapa banyak item yang jadi buntu**. Peta source → flow
(`shared/src/dto.ts`) menempatkan empat dari enam source sendirian di flow-nya:

| source | flow | teman se-flow |
|---|---|---|
| brief | feature | help |
| help | feature | brief |
| qa | qa | — |
| audit | audit | — |
| goal | goal | — |
| no_effort | no_effort | — |

Untuk item `qa`, `audit`, `goal`, dan `no_effort` yang sudah dimulai, himpunan tujuan yang sah
adalah **himpunan kosong**. Dan penolakan itu tak punya suara: tombol "Ubah type" dirender tanpa
syarat, sementara `ChangeSourceDialog` menjawab daftar kosong dengan `return null`. Operator
menekan tombol dan **tak terjadi apa-apa** — tanpa modal, tanpa pesan, tanpa toast.

Terukur di DB produksi operator (2026-08-25): 251 item `qa`, 44 `audit`, 10 `goal`, 2 `no_effort`,
seluruhnya `done`. **307 item** dengan tombol yang mati total, dan sebelas item `brainstorming`
plus pasangan `brief`/`help` sebagai satu-satunya yang berfungsi.

Jadi ada dua cacat bertumpuk: kebijakan yang terlalu ketat, dan penyampaian yang bisu. Yang kedua
membuat yang pertama tak pernah terlaporkan sebagai keluhan kebijakan — ia sampai ke kami sebagai
"kok tombolnya tidak jalan".

## Keputusan

Perpindahan **lintas-alur diizinkan**, dengan konsekuensi yang dinyatakan di muka: item kembali ke
tahap `brainstorming`, dan jejak sesi lamanya dibuang — dokumen fase, worktree, dan branch lokal.

Obat ADR-0109 yang diganti, bukan diagnosisnya. Berkas fase yang tak akan pernah cocok memang
masalah; ia bisa **dibuang**, dan itu jauh lebih murah daripada menutup seluruh pintu.

Bentuknya dua fase, cermin `confirmDelete` revert stage (SPEC-167):

1. Request tanpa `confirmReset` → `{ pending: true, wouldDelete, worktree, branch }`, **nol
   mutasi**. Konfirmasi diminta walau ketiga daftar itu kosong: yang disetujui bukan cuma
   penghapusan, melainkan mundurnya stage.
2. Request dengan `confirmReset: true` → dieksekusi.

Gerbang `checkSourceChange` karenanya berhenti menjawab boleh/tidak dan mulai menjawab **rencana**
(`reset: boolean`). Ia tetap murni; efek sampingnya hidup di `server/src/services/spec-reset.ts`.

### Yang TIDAK berubah

Perpindahan **se-alur** pada item berjalan (`brief ↔ help`) tetap in-place: tanpa reset, tanpa
konfirmasi, tanpa penghapusan, dan isinya tetap tak ikut berpindah. Itu kasus yang paling sering
terjadi dan sudah benar sejak ADR-0109. Item yang belum pernah dimulai juga tak tersentuh.

## Konsekuensi

**Urutan operasi mengikat**, dan tiap langkah punya alasannya sendiri:

1. dokumen fase dulu — dibaca lewat repoDir, tak bergantung worktree;
2. worktree dilepas **sebelum** branch dihapus — git menolak menghapus branch yang di-checkout
   sebuah worktree;
3. `git worktree prune` di antaranya — `trashWorktree` (ADR-0116) hanya me-*rename*, registrasi di
   `.git/worktrees/` tetap hidup, dan selama itu branch masih terhitung ter-checkout;
4. branch dihapus **sebelum** baris DB berubah — kunci `spec-open` (ADR-0077) menyala untuk backlog
   yang belum selesai, jadi sesudah stage jadi `brainstorming` tak ada lagi jalur yang mau
   membuangnya.

**`baseSha` ikut dikosongkan**, bersama `headSha` dan `startedAt`. Ia bukan sekadar catatan:
`session-launch.ts` memakainya sebagai penanda *resume*, dan `PATCH /specs/:id` sebagai kunci edit
konten (SPEC-186). Meninggalkannya berarti item yang "sudah kembali ke brainstorming" tetap
melanjutkan worktree lama dan tetap tak bisa diedit isinya — reset yang cuma kelihatan.

**Sesi hidup menolak operasi** dengan 409 `session-live`, bukan menutup sesinya sendiri. Melepas
worktree di bawah agen yang sedang mengetik adalah kelas bug "worktree pruned mid-run"; keputusan
menutup sesi tetap milik operator. Deteksinya lewat properti `specId` pane (pola
`POST /specs/:id/done`), bukan tebakan atas nama sesi.

**Branch remote tidak pernah disentuh.** Penghapusan terbatas pada branch lokal.

**Jalur penghapusan branch sengaja bukan `deleteBranches`.** Gerbang di `branch-cleanup.ts`
dirancang untuk pembersihan massal tak-terarah, tempat operator tak melihat satu per satu apa yang
dibuang — dan salah satu kuncinya justru menyala untuk item yang sedang dikembalikan ke backlog.
Di sini operator menunjuk satu branch dan sudah menyetujui daftarnya.

**Webhook:** reset mengubah `source` dan `stage` dalam satu update, dan `eventTypeFor` hanya
memancarkan satu jenis. Urutan `derived` dibalik supaya `spec.source_changed` menang atas
`spec.stage_changed` — perpindahan type-lah yang menyebabkan stage mundur, dan penerima yang cuma
diberi tahu "stage berpindah" akan mengira item ini di-revert manual.

**Penghapusan tak bisa dibatalkan.** Commit yang belum ter-merge di branch sesi hilang. Itu
diterima secara sadar; mitigasinya adalah daftar konkret di layar konfirmasi dan worktree yang
lewat `.trash`.

## Alternatif yang ditolak

**Tetap melarang, perbaiki umpan baliknya saja** (tombol disabled + alasan). Menyelesaikan gejala
bisu, tapi membiarkan 307 item tanpa jalan sama sekali. Keluhan yang muncul berikutnya akan
persis keluhan kebijakan yang sama.

**Izinkan lintas-alur tanpa reset.** Mengembalikan persis kelas bug yang melahirkan ADR-0109:
berkas fase yang tak akan pernah memuaskan `phasesComplete`, tanpa satu pun error yang menunjuk
sebabnya.

**Tutup sesi hidup secara otomatis** sebagai bagian dari operasi. Satu klik lebih sedikit, dengan
imbalan memotong kerja agen yang sedang berjalan — harga yang salah untuk penghematan itu.
