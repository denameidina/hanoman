# SPEC-1267 — Perf sesi terminal di backlog (rancangan)

## Konteks & keputusan

**Masalah.** Terminal di Backlog terasa delay saat sesi agen berjalan. Audit baca-kode (belum diprofil) menunjuk satu jalur: grup siar `specs` (`server/src/services/events.ts:70`, `everyTicks: 1`) memanggil `liveSpecs()` (`services/live-specs.ts:23`) yang `findMany` seluruh tabel Spec tanpa `select` (estimasi 3,8 MB/frame, 1069 baris lokal), di-`JSON.stringify` tiap detik untuk dedup, lalu `sessionPhasesBySpec()` → `listPanes()` sinkron (`execFileSync tmux`, 80-916 ms per komentar SPEC-878) di event loop yang sama dengan output PTY. Klien: `App.tsx:984` menaikkan `dataVersion` di setiap frame `specs`, yang memicu `api.listSpecs()` ulang di BacklogScreen (dep `dataVersion`, baris ~992), ProjectsScreen, PrdScreen.

**Fakta terverifikasi di kode (fase ini).**
- Kontrak WS: `shared/src/dto.ts:816` `{ t: "specs"; specs: Spec[] }` (penuh). `presence` membawa `hubVersion` (dto.ts:833) — mekanisme kompat klien lama/baru sudah ada untuk presence, bukan untuk specs.
- Klien membaca `payload`, `objective`, `sourceHistory` dari state `backlog` (yang diisi frame WS): `BacklogScreen.tsx:164,249,391`, `ChangeSourceDialog.tsx:32`, `App.tsx:1277-1303` (`spec.objective`). Jadi membuang field itu dari frame TIDAK aman tanpa jalur muat-detail per item.
- BacklogScreen sudah menimpa item hasil fetch dengan `backlogById.get(id) ?? s` (baris ~996), yaitu frame WS mengalahkan hasil HTTP — ini harus dibalik/dijaga saat frame jadi ringkas, kalau tidak field detail hilang.
- Tidak ada perubahan skema DB; hanya kontrak WS + perilaku klien.

**Prinsip keputusan.** Urutan kerja mengikuti brief: langkah 0 (baseline) wajib mendahului klaim apa pun; langkah 1-2 dulu (murah, dampak terbesar); langkah 3 sesudahnya; 4-6 hanya bila angka sesudah 1-3 masih menunjukkan masalah (YAGNI). Tak menyentuh: coalescing PTY 16 ms/cap 64 KB, satu WS events ref-count, IMMEDIATE_PER_MIN/MAX_INFLIGHT, dedup siaran (dipertahankan, diganti hash).

**Alternatif frame `specs` (langkah 1).**
- A. Frame ringkas (tanpa payload/sourceHistory/objective) untuk semua spec; detail via HTTP `GET /specs/:id` saat dibuka. Terkecil, tapi mengubah semantik state `backlog` klien (perlu audit ~8 call-site di atas).
- B. Hanya spec non-done (+ hitungan/ringkasan done). Memotong ~99% baris (1056/1069 done), field penuh tetap untuk yang aktif; done dimuat lewat HTTP berpaginasi (sudah ada). Perubahan kontrak lebih kecil.
- C. Diff per baris (`version`). Paling hemat tapi paling kompleks (resync, urutan, reconnect).
- **Rekomendasi: B + ringkas objective/payload hanya untuk baris done bila masih dibutuhkan; dedup memakai hash `max(updatedAt)+count+sum(version)` dari query agregat murah** (bukan stringify penuh). C ditunda. Kompat: bidang baru opsional di frame + versi kontrak (`specsFrame: 2`) sehingga klien lama tetap menerima frame penuh bila server melihat klien lama (perlu penanda dari klien; lihat keputusan #1).

**Dedup klien (langkah 2).** `setDataVersion` naik hanya bila hash isi frame berubah (bandingkan `(id,version,updatedAt)` bukan referensi); BacklogScreen refetch di-debounce sekali dan tidak per frame; hapus langganan `sessions` ganda di `TerminalScreen.tsx:98` (pakai prop App); `presence` di-dedup di server (S10: `lastSeenAt` device lokal berubah tiap build, `presence/view.ts:40`) dan klien.

**Langkah 3.** `sessionPhasesBySpec`/`liveDecisions` → async memakai `listPanesShared` (memo 1 dtk, `presence/snapshot.ts:35`); reconcile/reaper/lead → `getSessionAsync`/`listSessionsAsync` (`pty.ts:510` sudah ada); route WS terminal (`routes/terminal.ts:558`, `pty.ts:1444`) → async; satukan pembacaan berkas fase `pollPhases`/`paneComplete`. Risiko: `liveSpecs` write-through CAS dan semantik "hanya maju" tak boleh berubah — test perilaku yang ada jadi jaring pengaman.

**Langkah 4-6 (bersyarat).** Grup siar paralel dengan isolasi galat (bukan `await` serial `events.ts:231-244`); attach klien baru memakai `g.last`; kadens specs 1→3 dtk hanya bila hash-dedup belum cukup (perilaku terlihat: board lebih lambat 2 dtk). Backpressure `bufferedAmount` untuk terminal (drop/coalesce vs tunda). Klien terminal: WebGL+fallback DOM, cursorBlink hanya pane fokus, jeda parse pane tersembunyi, `React.memo`, ticker PhaseStrip bersama, timer 100 ms bersyarat, debounce ResizeObserver.

**Pengukuran (langkah 0 & 7).** Instrumen sementara/opsional di `__tick`: durasi `g.build()` per grup, `monitorEventLoopDelay` (p50/p99/max), ukuran frame (mentah & deflate) per grup, frame `specs`/menit, GET /specs per menit (DevTools). Skenario: 1 vs 4 pane terminal, backlog lokal 1069 baris, DB terpisah (bukan `~/.hanoman` produksi). Instrumen diaktifkan env (mis. `HANOMAN_EVENTS_PROFILE=1`), nol biaya saat mati.

**Docs tersentuh (saat Execute).** `internal/docs/architecture/stack.md`, `internal/skills/hanoman/SKILL.md` (kontrak frame `specs`), `api-contract.md` bila ada; ADR baru bila kontrak frame berubah (amandemen ADR-0039/0145).

## Keputusan terbuka

Lihat laporan fase (nomor 1-4); dijawab hanoman sebelum fase Objective.
