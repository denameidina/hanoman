# Model Discovery Implementation Plan

> Eksekusi inline di worktree terisolasi, mengikuti kontrak otonomi ADR-0035.

**Goal:** Model baru terdeteksi tanpa rilis Hanoman.
**Architecture:** Snapshot shared, probe CLI berbatas, cache lokal, distribusi HTTP + WebSocket.
**Tech Stack:** TypeScript, Node child_process, Fastify, React.
**Spec:** [model-discovery](../specs/2026-09-05-model-discovery.md)

## Batas

TTL 5 menit, timeout 20 detik, batas stdout 4 MiB. Nol inference dan perubahan default.
Test server serial dengan TEST_DATABASE_URL terisolasi; typecheck paket yang tersentuh.

## Task 1 — Kontrak shared dan parser

- [x] Test katalog menemukan model asing, effort metadata, label/alias Claude, hidden Codex.
- [x] Implement snapshot runtime dan fallback Fable 5.1/Astra di shared; parser allowlist di server.
- [x] Jalankan test shared dan parser.

## Task 2 — Discovery dan distribusi

- [x] Implement probe Claude initialize dan Codex debug models dengan timeout/output limit.
- [x] Cache last-good LOCAL-only; coalesce refresh, kegagalan provider independen.
- [x] Startup/timer di server.ts, GET /models, frame models cookie-only.
- [x] Test refresh gagal/berhasil, konkurensi, cleanup dan boundary.

## Task 3 — Konsumen dan verifikasi

- [x] Terima snapshot ke registry shared sebelum mengirim event ke subscriber UI.
- [x] Settings menghitung options saat render; custom agent mengikuti snapshot; effort per model.
- [x] Test pembaruan model/effort tanpa remount serta validasi server.
- [x] Update docs SoT/index; typecheck shared/server/web; boot server terisolasi + curl.
- [x] Review diff dan siapkan hasil untuk commit, tanpa integrasi ke main atau publish.

## Bukti akhir

2026-09-05: **27 berkas / 268 test lulus**, scope server/shared/UI yang tersentuh.
Typecheck server, shared, web lulus. `hanoman docs index --check`: index ok.
Server nyata di loopback port 18971 dengan HANOMAN_HOME/DB/socket tmux terpisah:
`/api/models` tanpa login 401; setelah setup/login katalog Claude dan Codex keduanya
`source: cli`, tanpa error, memuat Fable 5.1 dan Astra beserta effort.
`/api/custom-agents/catalog` memuat kedua model; `/api/settings` tetap Opus 5/xhigh
dan GPT-5.6 Sol/xhigh. Server uji dihentikan lewat PID terverifikasi.

Lingkungan verifikasi: Node 25 memerlukan `NODE_OPTIONS=--no-experimental-webstorage`
agar native localStorage tidak menimpa DOM test. Satu run awal keliru memakai DB test
default; seluruh run berikutnya memakai TEST_DATABASE_URL sementara terisolasi.
PATH worktree menunjuk instalasi Codex npm lama yang rusak; probe nyata memakai
`HANOMAN_CODEX_BIN=/Users/denameidina/.bun/bin/codex` yang valid, tanpa mengubah instalasi.
