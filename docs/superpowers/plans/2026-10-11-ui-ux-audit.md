# Rencana: perbaikan & redesign hasil audit UI/UX (2026-10)

Sumber: `internal/docs/frontend/ui-ux-audit-2026-10.md`. Branch/worktree: `ui-ux-audit`.
Aturan: file dimiliki satu agen per gelombang; test yang tersentuh dijalankan per gelombang (bukan suite penuh); docs
yang tersentuh diperbarui dalam commit yang sama. Baseline gagal sebelum perubahan: lihat bagian Baseline.

## Baseline (sebelum perubahan)
- `cd src && pnpm vitest --run`: 7 gagal / 6 berkas (confirm-inventory bila dijalankan dari `src/`, placeholder-contract,
  git-graph-live, icon-registry, start-session-admission, terminal-history-button, terminal-screen). Dari root:
  `placeholder-contract` gagal (13 field tanpa placeholder + 2 echo) — sudah ada di main.
- `cd src && pnpm typecheck`: bersih.

## Fase 1 — perbaikan (P0 + quick win)
- [x] 1A token kontras, CSS, viewport, Dalang exit mobile (`ds/tokens/colors.css`, `app.css`, `index.html`)
- [x] 1B `App.tsx` digest snapshot WS, grid mobile, sign-out (`auth/AccountMenu.tsx`), notifikasi
- [x] 1C Backlog: hapus spec/lampiran dikonfirmasi, TaskModal busy guard, label konsisten
- [x] 1D Terminal: konfirmasi kill/buang, error tidak ditelan, diagnostik keluar dari panel, jalan keluar keyboard
- [x] 1E Klien + Settings: persist jujur, konfirmasi reset/hapus, `projectId` tab IDE, grant berisiko
- [x] 1F IDE + Docs + Skills: guard draft, Edit saat ref, native prompt/confirm → DS, keyboard
- [x] 1G Scheduler + Lead: input angka, konfirmasi, aria, form tidak hilang saat reload
- [x] 1H QA + Triase: konfirmasi, label Indonesia, empty/error, loading silent
- [x] 1I Projects + PRD + Tim: FolderPicker keyboard & validasi, empty/error, nama project di Tim
- [x] 1J Overview + Dalang + Review/Reconcile + Auth/Setup + Portal + VPS
- [x] 1K verifikasi gabungan: typecheck, test tersentuh, perbandingan baseline, commit

## Fase 2 — fondasi design system
- [x] 2A komponen DS: PageHeader, FilterBar, RowList, Stack/Inline, Text, hover CSS, StatusPill dot
- [x] 2B a11y DS: Field/Input/Select, Radio, Modal inert+h2, shell h1+skip link, Toast antrean + undo, Icon aria-hidden
- [x] 2C command palette + shortcut + notifikasi "Jawab"
- [x] 2D map label terpusat + glosarium copy + skeleton/loading
- [x] 2E pembersihan CSS: kelas `hn-*` mati dan Dalang lama dicabut, `!important` 45 → 30 (sisa dicatat), font tak lagi render-blocking. Layout inline yang tersisa belum dipindah (lihat frontend-implementation § Fase 2E)

## Fase 3 — redesign
- [x] 3A ADR IA baru (17 → 8 menu) + nav hub — ADR-0205; tanpa redirect (path section tak berubah, URL lama tetap hidup)
- [x] 3B Overview "Hari ini" + Dalang sebagai papan senyap (Fase 3B di frontend-implementation.md)
- [x] 3F Triase/Lead: kotak masuk keputusan — satu daftar tiket + issue, Terima/Tolak inline, J/K/A/R, toast Urungkan; Lead: mode Aktif/Jeda/Mati, Menunggu kamu sekali klik, riwayat gabungan, pengaturan dengan Simpan (Fase 3F di frontend-implementation.md)
- [x] 3I Scheduler sebagai tab hub Otonom: strip status (state, kapasitas, limit, Jeda/Lanjutkan, Hentikan dikonfirmasi); tab Antre · Berjalan · Riwayat (chip) · Cron (tabel/kartu + menu ⋯, form dua tab, zona server) · Setelan (draft + Simpan, orkestrasi accordion) (Fase 3I · Scheduler di frontend-implementation.md)
- [x] 3E Terminal: default Fokus (rail sesi + satu pane), Grid opsional, toolbar ≤ 6 kontrol, "Buka…" untuk Ambil backlog/Riwayat/Terminal biasa (Fase 3E · Terminal di frontend-implementation.md)
- [x] 3D Backlog/Tim: daftar utama ber-segmen tahap, papan sekunder, popover Filter, detail linier (Ringkasan → Jalankan → Review/dokumen/lampiran → Lanjutan → Zona berbahaya), skeleton muat pertama, urung prioritas; Tim: lensa Saya/Semua, kartu = judul + prioritas + penanggung jawab + menu Ubah tugas, header ≤6 kontrol, urung pindah/tugaskan (Fase 3 · Backlog & Tim (3D) di frontend-implementation.md)
- [x] 3C Settings: empat niat (Sesi harian · Agen & model · Integrasi & akses · Lanjutan tertutup), shell tipis + modul
  `screens/settings/**`, satu aturan simpan (`useSettingField`), override satu-bentuk, Telegram satu tempat, dokumentasi webhook
  dilipat, "Cari pengaturan", deep link `#bagian=` (Fase 3C di frontend-implementation.md; ADR IA Pengaturan belum ditulis)
- [x] 3H IDE "Perubahan dulu": empat tab (Perubahan · Riwayat · Cabang · Berkas), toolbar ≤6 kontrol, branch + worktree dalam satu daftar (CabangPanel), menu konteks pohon, pemisah panel keyboard (Fase 3 · IDE di frontend-implementation.md)
- [x] 3L QA: editor lembar kerja (header sticky, aksi utama kontekstual, ⋯ untuk ekspor/pratinjau/hapus), Info laporan
  ringkas + drawer, tab Langkah uji/Temuan selalu terlihat, status test case satu ketukan, temuan sebagai RowList dengan satu
  aksi per baris, dialog Tinjau dan ajukan, hasil Kirim semua per temuan, daftar laporan RowList (Fase 3 · QA di frontend-implementation.md)
- [x] 3L′ Review: kepala ringkas, daftar + viewer, bar keputusan sticky (Buka di Backlog / Terminal / IDE, `onGoto` opsional), Konflik sinkron hanya field berbeda (Fase 3 · Review, Auth, Portal, Onboarding di frontend-implementation.md)
- [x] 3M Portal: Beranda Klien (Keluhan saya · Progres pekerjaan · Tanya & ide), linimasa 4 langkah, sheet Lapor masalah dua langkah, Help Center memakai komponen bersama
- [x] 3N Onboarding: setup satu layar (Lanjutan tertutup, penomoran 1/2), AuthScreen 2/2 bila `setupStep` dikirim (butuh App.tsx)
- [x] 3K Skills: master-detail (daftar ringkas + chip lapis Global/Project/Plugin, editor dengan footer Simpan sticky dan konfirmasi pindah), tab Skill · Agen, modal agen tiga tab, bukti dilipat (Fase 3 · Projects, PRD, Docs, Skills di frontend-implementation.md)
- [x] 3P Projects · PRD · Docs: daftar diurut perhatian + chip hitungan, detail tiga pintu + Pengaturan lipat, PRD dengan indeks per status dan sheet "Jadikan backlog", Docs Baca|Edit dengan bar simpan sticky dan pohon role=tree (label 3P; 3I di rencana sudah milik Scheduler)
- [x] 3G Klien: tab Perangkat · Akun · Log; selektor tingkat Lihat/Kerja/Tulis (grant API tak berubah); banner brass sticky (Fase 3 · Klien & VPS di frontend-implementation.md)
- [x] 3J VPS: daftar ringkas dengan stepper dan Periksa; detail bertab Ringkasan · Checklist · Pemasangan · Akses; alur Pilih → Pratinjau → Terapkan (Fase 3 · Klien & VPS di frontend-implementation.md)
