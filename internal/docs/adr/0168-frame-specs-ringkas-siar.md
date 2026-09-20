# ADR-0168 — Frame siar `specs` ringkas, hanya lahir saat digest berubah; detail lewat `GET /specs/:id`

**Status:** diterima · 2026-09-20 · SPEC-1267.
**Mengamandemen** [0039](0039-realtime-lewat-websocket-siar.md) & [0145](0145-langganan-berparameter-events-ws.md)
(isi dan kadens grup `specs`), [0038](0038-paginasi-di-response-layer.md) (bentuk respons `GET /specs`).
**Menegakkan** [0107](0107-paginasi-seragam-daftar-dashboard.md) (envelope + filter sebelum paginasi),
[0158](0158-urutan-backlog-numerik.md), [0024](0024-sesi-interaktif-menggantikan-run.md) (tanpa timer/queue baru).
Design-of-record: [spec](../../../docs/superpowers/specs/2026-09-20-spec-1267-perf-sesi-terminal-backlog-design.md),
[plan & baseline](../../../docs/superpowers/plans/2026-09-20-spec-1267-perf-sesi-terminal-backlog-baseline.md).

## Konteks

Terminal di Backlog terasa berat karena satu jalur yang bertemu di event loop dan thread utama yang sama
dengan aliran PTY. Grup siar `specs` memuat SELURUH tabel `Spec` (1070 baris di DB dev; 4,40 MB per frame
dengan `payload`, `objective`, `sourceHistory`), di-`JSON.stringify` penuh tiap detik hanya untuk dedup, dan
klien menaikkan `dataVersion` (refetch `GET /specs`, render ulang) di SETIAP frame tanpa membandingkan isi.
`sessionPhasesBySpec`, `scanDecisions`, reconcile scheduler, reaper, denyut lead, dan attach WS terminal
memakai `execFileSync` tmux dan `readFileSync` di jalur periodik (terukur SPEC-878 sampai 916 ms/panggilan).

## Keputusan

1. **Frame `specs` = `SpecSlim[]`**: `Spec` tanpa `payload`, `objective`, `sourceHistory`, ditambah `version` dan
   `updatedAt` (kolom DB) untuk dedup klien. Tanpa lapis kompatibilitas klien lama: klien lama tak menampilkan
   `objective` dari frame (gejala senyap; penawarnya `ReloadBadge`/`trackServerVersion`, SPEC-868).
2. **`GET /specs` → `SpecListItem[]`** (tanpa `payload`/`sourceHistory`; `objective` tetap, karena `?q=` mencocokkannya);
   `filterSpecs` berjalan sebelum keluar. **`GET /specs/:id` baru** = `Spec` penuh dengan overlay stage baca-saja
   (404 `{"error":"spec tak ditemukan"}`).
3. **`liveSpecs()` dipecah**: `liveOverlayTick()` (efek: persist stage maju + notifikasi; jalan TIAP tick siar) dan
   penyajian `listSpecsSlim`/`listSpecsItems`/`listSpecsLive` (hanya saat `specsDigest()` berubah:
   `count:max(updatedAt):sum(version)` + `liveSignature()` dari fase sesi hidup dan gerbang plan `- [ ]`).
4. **Siar**: `Group.pre/gate/sig`; grup jatuh tempo dibangun PARALEL terisolasi (`Promise.all`, kegagalan satu grup tak
   menahan yang lain) dan disiarkan berurutan; `attach` klien baru memakai `g.last` (nol build ulang); dedup presence
   mengabaikan `lastSeenAt` device lokal.
5. **Nol I/O sinkron di jalur periodik**: `sessionPhasesBySpecAsync`/`liveDecisionsAsync` di atas `listPanesShared`
   (memo 1 dtk), berkas fase dimemo per `(path, mtimeMs, size)`, `getSessionAsync`/`listSessionsAsync` di reconcile
   scheduler, reaper, denyut lead; route WS terminal memakai `attachAsync` dan menahan frame masuk sampai attach siap.
6. **Backpressure terminal**: `bufferedAmount` di atas 1 MiB menahan frame; antrean di atas 256 KiB membuang frame
   `data` terlama (frame kontrol tak pernah) lalu mengirim layar penuh (`capture-pane`). `perMessageDeflate`
   TIDAK diubah (AC-S33a).
7. **Klien**: `dataVersion` naik hanya bila `specsDigestOf` berubah; `BacklogScreen` menggabungkan daftar HTTP dengan
   frame lewat `mergeSlim` (siar menimpa kolom ringan) dan memuat detail lewat `getSpec`; TerminalScreen memakai satu
   langganan `sessions` milik App; optimasi terminal di sisi klien tercatat di dok frontend.

## Konsekuensi

- Ukuran frame `specs` 4,40 MB → 0,50 MB mentah (11%), 1,10 MB → 88 KB deflate (8%); target awal ≤5% tidak
  tercapai karena field ringkas yang dipakai layar (title, stage, tanggal, baseSha, …) sendiri ±470 B/baris.
- Status stage tersaji dari `GET /specs/:id` bisa selangkah lebih maju dari DB (overlay baca-saja); persist tetap milik tick siar.
- Overlay stage kini membaca daftar pane dari memo 1 dtk: kemajuan fase yang baru terjadi terlihat ≤1 dtk kemudian.
