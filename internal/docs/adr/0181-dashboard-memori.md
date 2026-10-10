# 0181 — Dashboard Memori: halaman per project, topik revision, keadaan per mesin, allowlist di Settings

> **Digantikan untuk fitur memori project/changelog oleh [ADR-0182](0182-hapus-memori-project-dan-changelog.md).**
> Dokumen ini mempertahankan keputusan historis; fitur dan data terkait telah dihapus.
> Kontrak generik sync opsional dan `Spec.doneAt` tetap berlaku.

Tanggal: 2026-10-07 · Status: diterima · Melanjutkan [ADR-0178](0178-memori-project-bersama.md), [0179](0179-suntik-memori-sesi.md), [0180](0180-sync-memori-entitas-opsional.md) · Plan: [tahap 4](../../../docs/superpowers/plans/2026-10-07-shared-project-memory-stage4.md)

## Konteks

Tahap 1–3 membuat memori bisa diusulkan, disuntik, dan disinkron, tetapi review, pembatalan, hapus
permanen, dan allowlist project token hanya bisa lewat curl ber-cookie. Halaman project tidak punya tab:
QA/Backlog/Skills adalah halaman bernavigasi tersendiri yang ditautkan lewat `Door`.

## Keputusan

1. **Halaman bernavigasi `/memory[/<projectId>]`** (label "Memori", key `memory`, ikon `brain`, tepat
   sesudah QA), pola Workspace QA, plus `Door` "Memori" di detail project. Tiga tab: *Perlu review*
   (default bila ada isinya), *Aktif*, *Arsip* (`invalidated` + `rejected`). Aksi: setujui, tolak
   (alasan wajib), batalkan (alasan wajib), hapus permanen (konfirmasi), riwayat event, pencarian.
   Banner peringatan bila dua memori aktif menggantikan memori yang sama (konsekuensi ADR-0180).
2. **Keadaan per mesin di daftar.** `GET /api/memories` kini mengembalikan `local: { verdict,
   lastUsedAt, lastVerifiedAt, needsConfirm }` dari `MemoryLocalState` (satu kueri untuk seluruh
   halaman). Badge: *terverifikasi* / *usang di mesin ini* / *belum terverifikasi di mesin ini*.
   *Perlu dikonfirmasi* = `active` dan tak tersuntik (atau tak pernah sejak dibuat) ≥
   `MEMORY_CONFIRM_DAYS` = 90 hari — konstanta di shared, bukan knob runtime (YAGNI).
3. **Realtime lewat sidik, bukan daftar.** Topik berparameter `memory {projectId}` (ADR-0039 ·
   SPEC-908) membawa `revision` = `jumlah:updatedAt-terbaru` dari satu `aggregate`. Frame pertama
   menjadi garis dasar; frame berikutnya yang berbeda membuat layar menarik ulang lewat HTTP. Tiga
   daftar × pencarian tak perlu dipaketkan di WS, dan tak ada polling di layar.
4. **Badge & notifikasi.** `PendingCounts.memory` = jumlah `proposed` lintas project (badge nav).
   Notifikasi `type: "memory"` (dedup `memory:<id>`) hanya untuk usulan yang masuk review — memori yang
   auto-aktif tak butuh manusia. Klik notifikasi membuka `/memory/<projectId>`.
5. **Allowlist project di Settings → Akses AI Agent.** `MultiSelect` "Project yang diizinkan (memori)"
   saat membuat token, ringkasan `memori: <project…|tertutup>` di setiap baris token, dan editor
   "Atur project" (PATCH `projectIds`, kosong → `null`).

## Konsekuensi

- Badge menghitung lintas project; hitungan per project ada di tab halaman.
- Verifikasi visual di browser belum dilakukan di sesi pembuatannya (tak ada alat browser); perilaku
  dijaga test komponen + verifikasi nyata HTTP/WS.
