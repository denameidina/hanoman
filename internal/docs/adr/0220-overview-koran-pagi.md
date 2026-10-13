# ADR-0220 · Overview "Koran Pagi": grup siar `overview`, perekam memori, headline template

Status: diterima · 2026-10-13 · Mengamandemen susunan Overview Fase 3B (Audit UI/UX 2026-10)

## Konteks

Overview Fase 3B hanya menampilkan keadaan saat ini (sesi berjalan, project bermasalah, limit).
Operator tak punya jawaban untuk "bagaimana hari ini berjalan?": berapa spec selesai, berapa sesi
gagal, berapa lama agen menunggu jawabannya, kapan limit habis. Data untuk sebagian besar pertanyaan
itu sudah tersimpan (`Spec.doneAt`, `SessionHistory`, `AgentInvocation`), tapi dua fakta tidak:
lamanya episode menunggu (`decisionAt` lenyap begitu dijawab) dan riwayat `usedPct` limit.

## Keputusan

1. **Grup snapshot GLOBAL ke-12 `overview`** di `/api/events/ws`, `everyTicks: 30`, dedup dengan
   `generatedAt` dikosongkan. Tidak `cookieOnly`: muatannya agregat angka tanpa id/judul (preseden
   `pending`, SPEC-961). Muat untuk agen: `GET /api/overview` (`GLOBAL_READ`) dan tool MCP
   `hanoman_overview_get` (ADR-0202). Dashboard tidak memanggil route itu (ADR-0039).
2. **Perekam di memori** (`overview-recorder.ts`) dengan timer sendiri 10 dtk (`.unref`), bukan
   loop siar yang hanya hidup saat ada klien. Episode menunggu (maks 2.000) dan sampel limit
   (2 jam, jarak ≥25 dtk) **hilang saat restart**. `recordingSince` dikirim supaya UI jujur.
   Penyimpanan permanen ditunda ke ADR terpisah bila angkanya terbukti perlu bertahan.
3. **Perhitungan murni** di `overview-metrics.ts`. Hari = 00.00 lokal mesin. Sesi agen = kind
   `spec|reverse|prd|scaffold|breakdown|telegram`. Tumbang = `sessionOutcome() === "failed"`.
4. **Headline template deterministik, tanpa LLM**: prioritas tumbang → menunggu ≥30 menit → rekor
   baru → bensin habis sebelum reset → spec mendarat, maks tiga fakta, fallback "Hari yang tenang.".
5. **Denyut** (EKG armada) memakai frame `sessions` yang sudah ada dan animasi CSS murni. Ia tidak
   mengikuti `activityAt`: menambahkannya ke `SessionDTO` membuat frame terbesar dashboard
   terkirim tiap detik.

## Konsekuensi

- Tiga `findMany` ringan per 30 dtk per instance saat ada klien (jendela 90 hari untuk Spec dan
  SessionHistory, dua hari untuk AgentInvocation), dan satu `tmux list-panes` asinkron tiap 10 dtk
  untuk perekam, walau tanpa klien. Tak ada indeks khusus kolom tanggal di `Spec`/`SessionHistory`;
  query-nya karena itu memindai tabel. Indeks ditambahkan lewat migration + ADR terpisah bila
  terukur perlu.
- Attach klien baru dalam 30 dtk pertama loop siar membangun frame `overview` segar (grup belum
  punya `g.last`), seperti grup berkadens panjang lain (`limits`, `codexLimits`).
- Token hanya parsial (AgentInvocation); UI melabelinya "token agen tercatat". Biaya mata uang
  tidak ditampilkan karena tak ada datanya.
- Fase 3B "tanpa KPI strip, tanpa hero" untuk Overview dibatalkan oleh susunan koran ini; aturan
  Fase 3B lain tetap berlaku.
