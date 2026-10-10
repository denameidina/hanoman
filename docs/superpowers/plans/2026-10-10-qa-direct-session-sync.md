# QA Direct Session and Sync Implementation Plan

**Goal:** Kerjakan temuan tanpa backlog dan sinkronkan QA beserta byte dua arah.
**Architecture:** Route QA memanggil admission gate, membuat worktree dan prompt konteks. Transfer byte dipanggil sesudah sync record. UI memakai client API dan callback fokus Terminal.
**Tech Stack:** Fastify, Prisma SQLite, React, TypeScript, Vitest.
**Spec:** ../specs/2026-10-10-qa-direct-session-sync.md

## Global Constraints
Tidak membuat Spec untuk sesi langsung; tanpa skema baru; izin launch wajib; test DB terisolasi; scope test hanya yang tersentuh.

## Review Focus
Izin token; report/finding scope; lampiran belum tersedia; retry klik serentak; unduhan gagal tidak menghalangi yang lain.

### Task 1: Sesi QA
- [x] Tambahkan service `server/src/services/qa-session.ts` dan route QA session; tes route dengan launcher mock, DB nyata, repo sementara.
- [x] Gunakan id hashed deterministik, admission sebelum worktree, branch qa, reuse worktree; materialisasi konteks/lampiran di sesi.
- [x] Tambahkan path/client API dan UI Kerjakan langsung dengan busy/error dan callback fokus Terminal.

### Task 2: Sync byte dan UI
- [x] Tambahkan `downloadPendingQaBytes()` batch 5 dengan cursor bergilir, panggil dari syncOnce setelah upload.
- [x] Tes unduh otomatis, integrity, retry, batch/fairness dan offline.
- [x] Tombol sync QA memuat ulang daftar/detail; tes klik launch serta sync.

### Task 3: Verifikasi dan docs
- [x] Perbarui panduan QA, ADR-0175 dan index.
- [x] Jalankan test tersentuh serial dengan TEST_DATABASE_URL terisolasi, typecheck server/web/shared, dan boot/curl endpoint nyata.

## Bukti verifikasi

- 11 berkas test terkait: 114/114 lulus. Setelah memperbaiki rotasi retry unggahan, 5 berkas yang terdampak dijalankan ulang: 52/52 lulus (termasuk satu test fairness baru).
- Typecheck server, frontend dan shared lulus. `git diff --check` bersih.
- Dua instance HTTP lokal dengan database/upload dir terpisah: hub→client langkah uji, temuan dan lampiran terunduh otomatis; client→hub perubahan langkah/temuan dan lampiran terunggah. SHA-256 byte cocok di kedua sisi.
- Endpoint sesi nyata melalui curl: repo belum terikat menjawab 400 needsBind. Setelah repo sementara diikat, peluncuran memakai executable agen simulasi lokal: worktree dan branch QA lahir, klik ulang memakai pane tmux yang sama, tidak ada Spec, penutupan terminal diterima. Tidak memanggil model berbayar atau mengubah instance production.
