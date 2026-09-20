# SPEC-1267 baseline dan hasil ukur

Metode: skrip sementara (di luar repo) memanggil fungsi server langsung terhadap DB dev nyata (1070 baris Spec,
1056 `done`; hanya dibaca, kecuali persist stage maju yang memang dilakukan `liveOverlayTick`), 30 iterasi
setelah 1 pemanasan, Node 24, mesin yang sama, satu proses. Instrumen `HANOMAN_EVENTS_PROFILE=1`
(`server/src/services/events-profile.ts`) tersedia untuk pengukuran server hidup.

Tidak terukur dari sesi agen (tak ada peramban interaktif / 4 pane hidup): GET `/specs` per menit di DevTools,
CPU renderer 1 vs 4 pane, `monitorEventLoopDelay` p99 dengan 4 pane aktif (AC-S13). Angka di bawah hanya sisi server.

## Sebelum (base 44440e8b) vs sesudah

| Pengukuran | Sebelum | Sesudah |
|---|---|---|
| Build grup `specs` (p50 / p95) | 40,8 / 51,9 ms (`liveSpecs`, baris penuh) | 4,1 / 7,7 ms (`listSpecsSlim` dengan cache baris per `updatedAt`; 3 run: p95 5,0-8,6 ms), dan HANYA saat digest berubah |
| Biaya tiap tick saat DB diam | build penuh + `JSON.stringify` 9,9 ms | `specsDigest` 1,2 / 1,3 ms (nol build, nol stringify) |
| Ukuran frame `specs` mentah | 4.399.661 B | 502.767 B (11,4 %) |
| Frame `specs` deflate level 6 | 1.097.968 B | 88.194 B (8,0 %) |
| `JSON.stringify` frame | 9,9 ms | 2,7 ms (dan hanya saat berubah) |
| Kompresi deflate 6 per frame | 69,1 ms | 4,9 ms |
| `GET /specs` (semua baris, tanpa paginasi) | 4,4 MB (baris penuh) | 1,37 MB (`SpecListItem`), 18,0 / 21,9 ms |
| Idle 30 tick, semua grup (attach lalu tick) | tiap tick membangun `specs` penuh | p50 4,4 ms, p95 30,2 ms; 1 frame `specs` (tick pertama), 0 sesudahnya |
| `GET /specs/:id` (baru) | n/a | 200 penuh (payload, sourceHistory, objective) / 404 `{"error":"spec tak ditemukan"}` |

Catatan: sasaran awal frame ≤5 % baseline diganti angka terukur (keputusan manusia): 11,4 % mentah, 8,0 %
deflate — field ringkas yang dipakai layar sendiri ±470 B/baris. AC-S14 (build `specs` p95 ≤ 20 ms) tercapai
setelah cache baris (decode Prisma ±12 ms adalah biaya terbesar; kini hanya baris yang berubah dibaca).
Kadens `specs` 1→3 dtk TIDAK diubah.

## Verifikasi manual tersisa (sebelum merge)

1. Lag event loop server: jalankan `HANOMAN_EVENTS_PROFILE=1 node server/dist/server.js` (DB dev), buka Backlog
   dengan 1 pane lalu 4 pane terminal aktif; catat 3 laporan `[events-profile]` 10 dtk (loop p50/p99/max, build per
   grup, frame/menit). Sasaran AC-S13: p99 ≤ 50 ms, max ≤ 100 ms.
2. DevTools Network (filter `specs`) 60 dtk dengan DB diam: `GET /api/specs` per menit harus 0 dan frame WS
   `specs` 0 sesudah muat awal.
3. DevTools Performance 30 dtk, 1 pane vs 4 pane: bandingkan CPU thread utama renderer dengan build sebelum
   SPEC-1267 (`git checkout 44440e8b` di worktree lain).
4. WebGL xterm: di Chrome pastikan renderer WebGL aktif (canvas di pane fokus), fallback DOM saat konteks hilang
   (mis. chrome://gpu dimatikan), kursor berkedip hanya di pane fokus. jsdom hanya menguji jalur fallback.
