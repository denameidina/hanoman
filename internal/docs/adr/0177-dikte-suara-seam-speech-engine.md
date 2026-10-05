# ADR-0177 — Dikte suara di terminal sesi: seam `SpeechEngine`, Web Speech dulu

- Status: Accepted
- Tanggal: 2026-10-05
- Spec: [2026-10-05-voice-input-design](../../../docs/superpowers/specs/2026-10-05-voice-input-design.md)

## Konteks

Operator mengetik prompt panjang ke `claude` di terminal sesi terus-menerus. Dibutuhkan input suara
(speech-to-text) di pane sesi aktif: klik mic, bicara, teks masuk ke composer.

## Keputusan

- **Seam `SpeechEngine`** (`src/src/screens/speech-engine.ts`): `start/stop` + `onInterim/onFinal/onError/onEnd`.
  UI (`useVoiceInput`, `VoiceControls`) hanya mengenal antarmuka ini.
- **MVP = Web Speech API** (`web-speech-engine.ts`): nol server, nol biaya, nol dependensi paket. Jalur
  **Whisper** (server/lokal) menyusul sebagai implementasi kedua tanpa mengubah UI; pemilihan engine lewat
  `Setting` server akan butuh migration + ADR sendiri dan **tidak** termasuk keputusan ini.
- **Teks masuk composer, tanpa Enter otomatis.** Sesi berjalan `--dangerously-skip-permissions` (ADR-0037):
  salah dengar tak boleh langsung dieksekusi. Composer mengirim delta ke baris prompt pty (tanpa `\r`),
  sehingga teks tampak di prompt `claude`, Enter tetap milik operator.
- **Hanya hasil final yang masuk composer.** Interim berubah-ubah dan composer mengirim delta berbasis
  backspace; mengirim interim akan mengacak baris pty. Interim hanya pratinjau di `VoiceControls`.
- **Toggle**, bahasa default `id-ID`, disimpan per perangkat di `localStorage` (`hanoman.voice.lang`).
- Status mic kembali idle saat engine melapor `end`, bukan saat `stop()`: potongan final terakhir bisa
  tiba sesudah `stop()`.

## Konsekuensi

- **Privasi:** di Chrome/Edge, Web Speech mengirim audio ke server penyedia browser (Google/Microsoft).
  Satu-satunya jalur data keluar baru; dicatat di tooltip tombol. Whisper lokal kelak menjadi opsi tanpa
  data keluar.
- Browser tanpa Web Speech (mis. Firefox): tombol tidak dirender. Konteks bukan HTTPS/localhost: pesan galat.
- Kualitas istilah teknis berbahasa Inggris di tengah kalimat Indonesia terbatas (satu bahasa per rekaman).
- Tanpa perubahan skema/API; tanpa migration.
