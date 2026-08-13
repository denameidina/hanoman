# SPEC-744 — Ubah status backlog dari halaman detail · Implementation Plan

> Kerjakan task berurutan. Setiap kotak wajib menjadi `- [x]` setelah implementasi dan buktinya
> benar-benar selesai. Detail desain: [design doc](../specs/2026-08-14-spec-744-ubah-status-backlog-detail-design.md).

**Goal:** Operator dapat memilih target stage mundur, memahami konsekuensinya, menyimpan dengan
aman, dan melihat hasilnya langsung di detail backlog.

**Architecture:** Perubahan tetap di jalur frontend existing: `SpecDetail` menyimpan draft target
dan state request, sementara `App.revertStage` tetap menjadi pemilik mutasi state backlog dan toast.
Kontrak server `PATCH /specs/:id` beserta dry-run `pending`/`confirmDelete` tidak berubah.

**Tech stack:** React 18 + TypeScript, Testing Library, Vitest.

## Global constraints

- Stage manual hanya backward-only; stage aktif dan stage ke depan bukan target sah.
- Memilih target tidak boleh mengirim request.
- `pending → confirmDelete:true` tetap dua request terpisah, dan mutasi baru terjadi di request
  yang dikonfirmasi.
- Detail induk tidak ditutup setelah sukses atau gagal.
- Satu operasi in-flight pada satu waktu; semua pemicu submit dikunci selama request.
- Tanpa endpoint, status bayangan, skema, migration, atau ADR baru.
- Docs Source of Truth diperbarui dalam commit yang sama.

---

### Task 1 — Pilih target dan simpan status tanpa meninggalkan detail

**Blocked by:** None — dapat dimulai langsung.

**What it delivers:** Operator memilih target mundur dari detail, membaca konsekuensi sebelum
menyimpan, lalu melihat stage terbaru pada detail yang sama untuk perubahan tanpa artefak.

- [x] Tambahkan test gagal yang membuktikan hanya target lebih awal yang ditawarkan, pemilihan belum
  memanggil callback, konsekuensi transisi tampil, dan tombol Simpan baru aktif sesudah pilihan sah.
- [x] Implementasikan draft target + panel konsekuensi + aksi **Simpan status** di kontrol stage.
- [x] Pertahankan detail terbuka sesudah respons `Spec`; reset draft dan biarkan prop dari state
  backlog menyegarkan stage bar serta daftar target.
- [x] Tambahkan bukti test sukses untuk alur non-destruktif dan stage paling awal tanpa target sah.

---

### Task 2 — Pertahankan confirmDelete dan cegah submit ganda

**Blocked by:** Task 1 — kontrol draft dan aksi Simpan harus tersedia.

**What it delivers:** Perubahan yang menghapus artefak tetap meminta konfirmasi dua langkah, semua
request terkunci dari submit ganda, dan kegagalan bisa dicoba ulang tanpa kehilangan konteks detail.

- [x] Tambahkan test gagal untuk respons `pending`, daftar `wouldDelete`, request kedua
  `confirmDelete:true`, detail yang tetap terbuka, dan tombol loading/disabled selama promise belum
  selesai.
- [x] Implementasikan satu state in-flight untuk submit awal dan konfirmasi; abaikan pemicu ulang
  sampai promise selesai.
- [x] Setelah konfirmasi sukses, tutup hanya dialog konfirmasi dan reset draft; setelah gagal,
  pertahankan detail serta target agar operator dapat mencoba lagi.
- [x] Jalankan test komponen terkait dan pastikan seluruh kasus Task 1–2 hijau.

---

### Task 3 — Source of Truth dan verifikasi akhir terarah

**Blocked by:** Task 1 dan Task 2 — perilaku final harus stabil sebelum didokumentasikan.

**What it delivers:** Kontrak frontend dan requirement backlog mencatat perilaku sebenarnya, serta
perubahan siap dikirim dengan bukti yang sebanding dengan blast radius-nya.

- [x] Perbarui requirement EARS backlog dan dokumentasi implementasi frontend; pastikan keduanya
  tetap terjangkau dari `internal/docs/README.md` dan tambahkan link hanya bila ada dokumen SoT baru.
- [x] Jalankan `src/test/revert-stage.test.tsx` dari root repo dan pastikan test benar-benar berjalan,
  bukan `no test files`.
- [x] Jalankan test related untuk berkas implementasi yang berubah jika ia menemukan test tambahan.
- [x] Jalankan typecheck hanya paket `src`; tidak menjalankan suite/lint/build penuh.
- [x] Jalankan `git diff --check`, audit semua kotak plan sudah `- [x]`, lalu review diff terhadap
  design doc dan acceptance criteria.
