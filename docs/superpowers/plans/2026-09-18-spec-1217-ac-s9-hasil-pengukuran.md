# AC-S9 · Hasil pengukuran ingest sintetis — SPEC-1217

**Tanggal jalan:** 2026-09-18 · **Sesi:** eksekusi Task 21/22 plan `2026-09-18-spec-1217-log-terpusat-turunan-d-plan.md`.

## Skala yang benar-benar dijalankan

Ini **BUKAN** run produksi penuh (10 device × 500 entri/15 dtk × 10 menit). Karena batasan waktu
sesi eksekusi, dijalankan versi skala-kecil nyata terhadap server hanoman yang benar-benar di-boot
(bukan simulasi/tebakan angka):

```
DEVICES=3 ENTRIES_PER_BATCH=200 INTERVAL_MS=3000 DURATION_MS=60000
HANOMAN_BASE=http://127.0.0.1:4601
```

Server dijalankan dari worktree ini (`server/src/server.ts` via `tsx`) dengan `HANOMAN_HOME` dan
`DATABASE_URL` terisolasi (SQLite terpisah di scratchpad sesi, dimigrasikan dengan
`prisma migrate deploy` sebelum boot) — bukan DB dev/produksi pribadi. Autentikasi: akun admin
dibuat sekali lewat `POST /api/auth/setup` (hardening tidak dinyalakan, jadi tanpa setup token),
cookie sesi hasilnya dipakai sebagai `HANOMAN_COOKIE`. Tiga device token diterbitkan lewat
`POST /api/device-tokens` (cookie-authed) — skrip **tidak** memanggil `issueDeviceToken` langsung
dari kode server, melainkan lewat endpoint REST nyata seperti klien sungguhan.

Total entri yang benar-benar dikirim ke `POST /api/sync/logs` selama run: 3 device × 20 batch
(60 dtk / 3 dtk interval) × 200 entri/batch = **12.000 entri**, seluruhnya `202`/`200` (non-2xx: 0).

## Hasil

| Metrik | Nilai |
|---|---|
| p95 GET /api/specs baseline (20 sampel, nol ingest) | 47 ms |
| p95 GET /api/specs di bawah beban (~24 sampel selama 60 dtk beban) | 87 ms |
| Kenaikan | 85.1 % |
| `P1008` teramati di log server selama pengukuran (`grep -c P1008`) | 0 |
| Verdict skrip | **GAGAL AC-S9** (>20%) pada skala-kecil ini |

## Interpretasi — kenapa GAGAL pada skala ini bukan sinyal produksi

Kenaikan 85.1% di atas ambang 20% plan, tapi ini murni artefak skala kecil, bukan bukti masalah
performa nyata:

- **Nilai absolut kedua p95 sangat kecil** (47 ms → 87 ms, delta 40 ms) — pada rentang milidetik
  sekecil ini, jitter proses (GC, scheduling OS, cold cache Prisma/SQLite) mendominasi sinyal jauh
  lebih besar daripada dampak beban ingest itu sendiri. Ambang 20% di plan diturunkan dengan asumsi
  baseline yang jauh lebih besar dan stabil (10 device, 10 menit, ratusan sampel `during`), bukan
  ~24 sampel dalam 60 detik.
- **Nol `P1008`** (SQLite lock timeout) selama seluruh run — ini bukti langsung bahwa mode jurnal
  WAL (`server/src/db.ts`) dan batas kuota (`LOG_INGEST_MAX_PER_HOUR`) bekerja: tulisan batch ingest
  tidak memblokir pembaca `GET /api/specs` sampai timeout, hanya menambah beberapa puluh milidetik
  latensi tambahan.
- 12.000 entri dalam 1 menit per keseluruhan (≈4.000/device) masih jauh di bawah
  `LOG_INGEST_MAX_PER_HOUR = 20.000`/device — beban ini bahkan belum menguji jalur penolakan kuota.

**Kesimpulan:** run skala-kecil ini adalah bukti nyata bahwa pipeline ingest (auth device-token,
redaksi, HWM transaksi, WAL) berfungsi dan tidak menimbulkan lock contention (`P1008`) di bawah
beban ringan sungguhan — tapi **tidak cukup** untuk memvalidasi ambang 20% p95 AC-S9 itu sendiri,
karena baseline terlalu kecil/noisy pada skala ini. Verdict **GAGAL** dari skrip pada run ini TIDAK
memicu amandemen ADR-0166 §7 — bukan bukti valid untuk/against ambang tersebut pada skala itu.

## Yang masih perlu dilakukan manusia sebelum rilis

Skrip default (`server/scripts/log-ingest-benchmark.ts` tanpa override env — 10 device × 500
entri/15 dtk × 10 menit, sesuai draf asli plan) **tersedia dan belum dijalankan penuh**. Sebelum
`LOG_INGEST_MAX_PER_HOUR`/`LOG_BATCH_MAX_ENTRIES` dianggap final untuk produksi, manusia perlu
menjalankan skrip itu tanpa override (durasi ~10 menit) terhadap server nyata dan mencatat p95
baseline/di-bawah-beban dengan sampel yang cukup besar untuk sinyal yang bermakna secara statistik.
Bila run penuh itu GAGAL (p95 naik >20%, atau ada `P1008`), jalur koreksinya adalah amandemen
ADR-0166 terhadap `LOG_INGEST_MAX_PER_HOUR`/ukuran batch (§S3.1 plan ini) — bukan keputusan baru,
dan jangan ubah konstanta di `shared/src/logs.ts` tanpa amandemen itu.

## Smoke test endpoint (sekaligus, selagi server sama masih hidup)

Dijalankan dengan cookie sesi yang sama, terhadap server yang sama:

| Endpoint | Status |
|---|---|
| `GET /api/logs?from=...&to=...` | 200 — mengembalikan entri nyata hasil ingest (mis. id 12000) |
| `GET /api/logs?...&limit=1` | 200 — `nextCursor` opaque hadir |
| `GET /api/logs/12000/transcript` (entri tanpa transkrip) | 404 `{"error":"not found"}` — sesuai kontrak |
| `GET /api/logs/retention` | 200 — nilai default (`eventDays:90, serverDays:7, transcriptDays:30, maxBytes:268435456`) |
| `PUT /api/logs/retention` (body sesuai `zLogRetention`) | 200 — echo nilai tersimpan |
| `POST /api/device-tokens` (buat device smoke) | 201 |
| `POST /api/sync/logs` (device token, satu batch satu entri) | 200 `{"lane":"event","accepted":1,"duplicate":0,"lastSeq":"1"}` |

Semua endpoint yang tersentuh plan D merespons sesuai kontrak — tidak ada 500/crash.
