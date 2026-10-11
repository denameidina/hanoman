# ADR-0200 — `instance:admin`: pasang pembaruan dan restart instance lewat agent token, dengan "jawab dulu, mati kemudian"

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
SPEC: —
**Mengamandemen SPEC-405 / ADR-0088** (`POST /update/apply` cookie-only) dan **ADR-0099 §4/ADR-0155** (tool yang me-restart/memasang tak hadir); membalik larangan "tak ada tool pemasang pembaruan" di `mcp-catalog.team.test.ts`
Terkait: ADR-0087 (paket npm global + supervisor) · ADR-0139 (`requestConfigRestart`) · ADR-0155 (akses `danger`) · ADR-0199 (sync UI) · ADR-0201 (Help Center publik)

## Konteks

`POST /update/apply` memasang `hanoman@latest` lewat supervisor `hanoman start` lalu me-restart proses;
`POST /restart` me-restart tanpa memasang. Keduanya dua langkah (`confirm:true`, 409 `confirm-required`
membawa jumlah sesi hidup) dan hanya sah bila ada supervisor. Sejak SPEC-405 keduanya cookie-only karena
prefix `/update` dipetakan `GLOBAL_READ` untuk method baca — tulisannya sengaja ditolak, dan `/restart`
jatuh ke `null` (cookie-only). Pemilik repo meminta keduanya dibungkus.

## Keputusan

1. **Satu capability baru, akses `danger`, domain `instance`: `instance:admin`** (`risk: "exec"` —
   memasang paket npm adalah eksekusi kode dari registry, dan restart memutus semua koneksi). Opt-in,
   tak diimplikasikan capability apa pun; tes memastikan token berisi `settings:write`, `sessions:spawn`,
   `vps:exec`, `ide:git`, `backlog:lifecycle` dst. tetap 403 dengan `need: "instance:admin"`.
2. **Pemetaan menurut method + panjang segmen**: `POST /update/apply` dan `POST /restart` →
   `instance:admin`. `GET /update` tetap `GLOBAL_READ` (status; `hanoman_update_status`), method lain di
   `/update/*`, `GET /restart`, `/restart/*` tetap `COOKIE_ONLY`.
3. **Tool (mode `danger`, hanya muncul dengan `--danger`)**: `hanoman_update_apply` dan
   `hanoman_instance_restart`. Parameter `confirm` **wajib** di skema; `confirm:false` (atau nilai bukan
   boolean `true`) dikirim apa adanya sebagai `{confirm:false}` sehingga server menjawab 409
   `confirm-required` dengan angka sesi hidup/versi — dibaca agen sebagai laporan, tak mengubah apa pun.
   `cli/src/mcp/errors.ts` kini menerjemahkan 409 berkode itu (`confirm-required`, `unsupervised`,
   `up-to-date`) ke kalimat yang menyebut angkanya dan menegaskan proses TIDAK berhenti.
4. **Wajib menjawab dulu sebelum proses mati.** Dulu `requestRestartForUpdate()` dipanggil di dalam
   handler dan timer 250 ms mulai berdetak SEBELUM balasan mengalir. Kini handler memasang
   `afterReplyFlushed(reply.raw, …)` (`services/restart.ts`): exit dijadwalkan hanya sesudah `finish`
   (balasan 202 selesai ditulis ke socket), atau `close` (peminta sudah pergi, tak ada yang bisa dijawab),
   atau plafon 5 detik (klien menggantung; `confirm:true` sudah diberikan, restart tak boleh tertahan
   selamanya). Sekali jalan, listener dilepas. Jeda 250 ms sesudah `finish` tetap dipertahankan karena
   `finish` hanya berarti byte diserahkan ke kernel. Ini menjamin URUTAN; ia tak menjamin klien membaca
   balasannya (jaringan bisa putus) — karena itu pemanggil tetap harus memeriksa `hanoman_update_status`
   sesudah koneksi pulih.
5. **Supervisor tetap syarat.** Tanpa `HANOMAN_SUPERVISOR`, kedua route menjawab 409 `unsupervised` dan
   tidak keluar — capability bukan izin mematikan proses tanpa penerus (SPEC-405).

## Konsekuensi

- `hanoman_update_status` tak lagi bisa menyatakan "tak ada tool untuk memasang"; deskripsinya diperbarui.
- Tes lama `tak ada tool yang memasang pembaruan` diganti: tepat satu tool tulis di `/update*`, bermode
  `danger`, bercapability `instance:admin`.
- Dokumen agen (`docs/agent-integration.md`) mencantumkan keduanya di §3, §5, §8 dan tabel tool.
- Risiko yang diterima pemilik: agen ber-`instance:admin` dapat memasang versi baru dari registry tanpa
  manusia di terminal. Mitigasi: opt-in per token, hanya dengan supervisor, dua langkah `confirm`, tingkat
  `--danger`, dan 202 dikirim sebelum exit.

## Tambahan: `GET /agent-integration.md`

Route publik (PUBLIC di `app.ts`) ini kini dipetakan `GLOBAL_READ` untuk method baca dan dibungkus
`hanoman_agent_guide` (read, tanpa capability). Naskahnya ±30 KB sedangkan balasan tool dibatasi 24 KB,
jadi tool membacanya BERPOTONG (`offset`/`limit`, `nextOffset` null di akhir).

## Penerimaan

- [x] Token tanpa `instance:admin` — apa pun capability lainnya — 403 `need: instance:admin`, tak ada exit.
- [x] `confirm:false` melapor 409 tanpa efek; `confirm:true` → 202 lalu exit (75 untuk update).
- [x] Exit dijadwalkan lewat `afterReplyFlushed` (tes unit finish/close/plafon + tes route).
- [x] Uji nyata di server lokal: 202 diterima klien, proses keluar sesudahnya.
