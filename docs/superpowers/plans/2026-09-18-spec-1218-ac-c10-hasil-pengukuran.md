# AC-C10 · Hasil pengukuran relay 4 stream/RTT 200 ms — SPEC-1218

**Tanggal jalan:** 2026-09-18 · **Sesi:** eksekusi Task 17 plan `2026-09-18-spec-1218-tampilan-identik-turunan-c-plan.md`.
**Skrip:** `server/scripts/relay-8gb-measurement.ts`.

## Metode

Bukan mock murni: server Fastify nyata (`buildApp()`) di-boot in-process, DB SQLite terisolasi
(`HANOMAN_HOME`/`DATABASE_URL` khusus sesi, dimigrasikan `prisma migrate deploy` sebelum boot —
bukan DB dev/produksi pribadi). Empat koneksi WebSocket **nyata** dibuka lewat `app.injectWS` ke
`GET /api/devices/:deviceId/relay/terminal/sessions/:n/ws`, lewat tiket sekali-pakai
`relay:<deviceId>:terminal:<n>` yang diterbitkan `POST /api/ws-tickets` — jalur yang PERSIS sama
dipakai `TerminalPane` mode=remote sungguhan (AC-C1-C9), bukan endpoint uji-khusus.

**Simulasi RTT 200 ms:** sisi device adalah `RelaySocket` palsu (pola sama dengan
`server/test/devices-relay.wshandler.test.ts`) yang membungkus SETIAP frame dengan
`setTimeout(rtt/2)` sebelum diproses — baik arah hub→device (`open`, `credit`) maupun device→hub
(`opened`, `data`, `close`) lewat `attachRelaySocket(...).onMessage`. Jadi satu putaran
kredit-habis → frame `credit` → kredit terisi benar memakan ~200 ms, bukan cuma satu arah. **Bukan**
`tc`/proxy TCP eksternal — dicatat di sini sesuai permintaan plan, supaya pembaca tak menyangka
200 ms itu diukur di kabel jaringan sungguhan.

Device sisi hub mendorong frame `data` 512 byte tiap 20 ms (≈50 fps/stream), dibatasi kredit lokal
yang disimulasikan sendiri (turun tiap kirim, naik saat menerima frame `credit` dari hub) — bukan
mengabaikan backpressor.

## Run singkat verifikasi (60 dtk, DI MESIN INI — bukan Mac mini 8 GB)

```
node --loader tsx tidak dipakai (deprecated); dipakai langsung:
server/node_modules/.bin/tsx server/scripts/relay-8gb-measurement.ts --duration 60 --streams 4 --rtt 200
```

Selesai bersih, nol crash, CSV 241 baris (60 detik × 4 stream + header) benar-benar tercatat.

| Metrik | Nilai teramati |
|---|---|
| Stream terbuka | 4/4 |
| RSS puncak (proses tsx, termasuk Prisma/V8 runtime) | 206.0 MB (t≈12s, sebelum GC) |
| RSS di akhir (t=60s, sesudah GC menstabil) | 63.0 MB |
| CPU user kumulatif di akhir (60 dtk wall) | 310.3 ms (≈0.5% dari satu core) |
| CPU sys kumulatif di akhir | 70.3 ms |
| `bufferedAmount` teramati | selalu 0 (lihat catatan keterbatasan di bawah) |
| Frame `data` terkirim per stream sebelum plateau | 897 (≈459 KB/stream), berhenti bertambah mulai t≈19s |
| Verdict plafon S0b pada run kecil ini | **tak dilanggar** — jauh di bawah 6 stream/256 KiB kredit/1 MiB bufferedAmount/12.000 frame-menit |

## Temuan nyata: resync-close (§10) benar terpicu, bukan bug skrip

Frame `framesSent` berhenti bertambah sekitar t≈19s, bukan crash. Penyebabnya nyata dan terjadi di
`server/src/services/relay/hub.ts` (`onClientFrame`, cabang `data`): begitu kredit sebuah stream
turun di bawah `RELAY_CREDIT_REFILL_BELOW` (64 KiB) untuk PERTAMA kalinya, hub mengisi ulang kredit
lalu — karena `lastResyncAt` dimulai `0` sehingga syarat `Date.now() - lastResyncAt >= 5_000` (
`RELAY_RESYNC_MIN_MS`) langsung terpenuhi — segera menutup socket BROWSER dengan `4009 "resync"`
dan menandai `s.closed = true`. Sesudah itu setiap frame `data` lanjutan dari device DIABAIKAN hub
(`if (!s || s.closed) return;`), sehingga device (skrip ini) menghabiskan satu batch kredit terakhir
lalu berhenti — TANPA menerima instruksi untuk berhenti, sebab hub tak mengirim frame `close` ke
device dalam cabang ini (hanya menutup sisi browser).

Ini **bukan pelanggaran plafon**, melainkan mekanisme resync yang memang dirancang §10 ADR-0165:
klien produksi (`TerminalPane`) diharapkan mendeteksi close 4009 lalu membuka ulang stream. Skrip
pengukuran ini SENGAJA tidak mengimplementasikan reconnect-on-resync (di luar skop "verifikasi
cepat 60 dtk" — reconnect loop akan menjadi pengukuran yang beda), sehingga throughput per-stream
di run ini pada praktiknya hanya representatif untuk ~19 detik pertama per siklus resync, bukan
untuk 60 detik penuh tanpa jeda. **Run 10 menit di Mac mini (Task 17 Step 4) harus memakai skrip
yang menambahkan reconnect-on-4009 bila ingin mengukur throughput sinambung** — dicatat sebagai
prasyarat sebelum run penuh, bukan diklaim sudah ditangani di sini.

## Keterbatasan diketahui

- `bufferedAmount` selalu 0: socket `app.injectWS` (light-my-request, in-process, bukan TCP
  sungguhan) tak mengekspos backlog kernel nyata seperti browser sungguhan — metrik ini TAK bisa
  divalidasi lewat harness in-process ini. Run Mac mini 8 GB (langkah manusia) sebaiknya memakai
  koneksi WS TCP sungguhan (klien `ws` npm ke server yang benar-benar `listen()`) supaya
  `bufferedAmount` berarti.
- RSS/CPU di atas mengukur SATU proses Node yang menjalankan server + 4 "device" simulasi + skrip
  sekaligus (bukan proses server terpisah dari proses beban) — representatif untuk profil memori
  kasar, bukan isolasi sempurna server-vs-klien yang akan dilihat di Mac mini nyata (hub dan device
  berjalan di mesin/proses berbeda).

## Yang masih perlu dilakukan manusia sebelum rilis (Task 17 Step 4 — LANGKAH MANUSIA)

Run penuh 10 menit di Mac mini 8 GB **belum dijalankan** — di luar jangkauan sesi eksekusi ini
(perangkat fisik, bukan sesuatu yang bisa dilakukan agen). Sebelum plafon S0b dianggap final:

1. Perbaiki/perpanjang skrip ini dengan reconnect-on-4009 (lihat temuan di atas) supaya run 10 menit
   benar mengukur beban sinambung, bukan cuma ~19 detik per stream lalu diam.
2. Jalankan di Mac mini 8 GB sungguhan: `tsx server/scripts/relay-8gb-measurement.ts --duration 600 --streams 4 --rtt 200`.
3. Catat CPU/RSS puncak & rata-rata, `bufferedAmount` maksimum (pakai WS TCP sungguhan, bukan
   `injectWS`, supaya metrik ini valid), dan apakah plafon S0b dilanggar.
4. Bila dilanggar: amandemen `internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md`
   §10 dengan angka baru + alasan. Bila tidak: catat "plafon awal S0b lulus pengukuran 8 GB, tak
   diamandemen" di berkas ini.

**Verdict run kecil ini secara eksplisit BUKAN pengganti run 10 menit** — angka di atas nyata dan
diamati, tapi skalanya (60 dtk, ~19 dtk efektif per stream, 4 dari 6 plafon stream, satu mesin
dev/CI) tak cukup memvalidasi plafon produksi.
