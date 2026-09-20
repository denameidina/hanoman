# SPEC-1267 baseline dan hasil ukur

Skrip ukur: DB SQLite terpisah (`HANOMAN_HOME` sementara), 1069 baris Spec (1056 `done`, payload ~2,5 KB,
objective 800 B, sourceHistory 1 entri), 20 iterasi per pengukuran, Node 24, mesin dev sama.
Ukuran sisi peramban (DevTools, profil CPU renderer 1 vs 4 pane) tidak dapat diambil dari sesi agen
tanpa peramban interaktif; instrumen server tersedia lewat `HANOMAN_EVENTS_PROFILE=1`.

## Sebelum (base 44440e8b)

| Pengukuran | p50 | max (20 run, termasuk warmup) | Byte mentah | deflate level 6 |
|---|---|---|---|---|
| `liveSpecs()` = build grup `specs` | 45,0 ms | 2167,7 ms | 4.399.661 | 1.097.968 |

Frame `specs` dilahirkan ulang tiap detik saat ada perubahan, `JSON.stringify` penuh tiap tick untuk dedup,
dan klien menaikkan `dataVersion` (refetch `GET /specs`) di setiap frame.
