# Voice input (speech-to-text) untuk terminal sesi — desain

Tanggal: 2026-10-05 · Status: menunggu review

## Tujuan

Operator bicara alih-alih mengetik di terminal sesi. Klik mic pada pane sesi aktif → bicara → teks
masuk ke composer → operator menekan Enter sendiri. Mengurangi lelah mengetik prompt panjang ke
`claude`.

## Keputusan (dikunci bersama operator)

| # | Keputusan | Pilihan |
|---|-----------|---------|
| K1 | Engine | **Hibrida**: MVP memakai Web Speech API bawaan browser; jalur Whisper menyusul lewat seam engine yang sama (di luar scope spec ini) |
| K2 | Tujuan teks | **Ke composer dulu**, tanpa Enter otomatis |
| K3 | Mode mic | **Toggle** (klik mulai, klik lagi berhenti) |
| K4 | Bahasa | Default **`id-ID`**, bisa diganti (mis. `en-US`) |

## Temuan kode yang membentuk desain

- `TerminalComposer` dirender hanya bila `showKeys && canWrite` (`src/src/screens/TerminalPane.tsx:838`),
  yaitu perangkat sentuh. Di desktop ia tidak ada.
- Composer **bukan** draf tertahan: teks di-debounce (`DEBOUNCE_MS = 350`) lalu dikirim ke baris prompt
  pty sebagai delta (backspace + sisa) **tanpa Enter**; Enter mengirim `\r`
  (`terminal-composer.ts`, `TerminalComposer.tsx`). "Ke composer dulu" aman karena tak ada Enter
  otomatis, tetapi teksnya langsung tampak di prompt `claude`.
- Karena delta memakai backspace, mengirim hasil *interim* (yang berubah-ubah) ke composer akan
  mengacak baris pty. Maka interim **tidak boleh** masuk composer.
- Belum ada kode speech/`getUserMedia`/`MediaRecorder` di `src/` maupun `server/`.

## Arsitektur

Tiga unit, masing-masing satu tanggung jawab:

1. **`speech-engine.ts`** (murni, tanpa DOM)
   Antarmuka engine + mesin-keadaan mic + penggabung transkrip.
   ```ts
   export type SpeechError =
     "not-allowed" | "no-speech" | "network" | "insecure-context" | "unsupported" | "other";
   export interface SpeechEngine {
     readonly supported: boolean;
     start(lang: string): void;
     stop(): void;
     onInterim(cb: (text: string) => void): void;
     onFinal(cb: (text: string) => void): void;
     onError(cb: (e: SpeechError) => void): void;
     onEnd(cb: () => void): void;   // engine berhenti (manual atau otomatis)
   }
   ```
   Fungsi murni `appendFinal(draft, finalText)`: menambahkan teks final dengan satu spasi pemisah,
   tanpa mengubah kapitalisasi, tanpa spasi ganda, abaikan teks kosong.
   Mesin-keadaan: `idle → listening → idle`, dengan `error` sebagai kondisi sementara.

2. **`web-speech-engine.ts`**
   Implementasi `SpeechEngine` di atas `SpeechRecognition`/`webkitSpeechRecognition`
   (`continuous = true`, `interimResults = true`). Memetakan `event.error` Web Speech
   (`not-allowed`, `service-not-allowed`, `no-speech`, `network`, dst.) ke `SpeechError`.
   `supported` false bila konstruktor tak ada. Mendeteksi `!window.isSecureContext` →
   `insecure-context` saat `start`.

3. **`VoiceButton.tsx`** + hook `use-voice-input.ts`
   Tombol mic di toolbar pane. Hook memegang engine, status, interim, galat, dan bahasa;
   menyalurkan teks final ke composer lewat callback `onFinalText`.

## Perilaku UI

- Tombol tampil hanya bila `canWrite` **dan** `engine.supported`. Pane baca-saja (remote/viewer)
  tak mendapat tombol. Browser tanpa dukungan (mis. Firefox): tombol tidak dirender.
- Klik pertama → `start(lang)`; klik kedua → `stop()`. Saat merekam: indikator merah berdenyut dan
  `aria-pressed="true"`; label `aria-label` "Mulai/Hentikan dikte suara".
- **Desktop:** saat mic aktif composer ikut ditampilkan (sebagai tempat hasil), lalu kembali
  tersembunyi bila kosong setelah mic berhenti. **Sentuh:** composer sudah tampil.
- **Alur teks:** hasil final → `appendFinal` ke teks composer → alur debounce composer yang ada
  mengirimnya ke pty. Hasil interim hanya ditampilkan sebagai pratinjau abu-abu di samping composer
  dan **tidak** menyentuh state composer/pty.
- **Tanpa Enter otomatis.** Operator menekan Enter (di composer atau terminal).
- Bahasa: `id-ID` default, disimpan per perangkat di `localStorage` (kunci `hanoman.voice.lang`),
  dibungkus try/catch (storage bisa gagal). Pemilih bahasa kecil di samping tombol (menu) dengan
  minimal `id-ID` dan `en-US`.
- Pilihan engine (Web Speech/Whisper) **belum** ada di Setting; baru ditambahkan saat jalur Whisper
  dibangun, sebagai `Setting` server (butuh migration + ADR sendiri).

## Penanganan galat

| Galat | Pesan singkat di samping tombol | Efek |
|-------|---------------------------------|------|
| `not-allowed` | "Izin mikrofon ditolak. Aktifkan di pengaturan browser." | kembali idle |
| `no-speech` | "Tidak ada suara terdengar." | kembali idle |
| `network` | "Layanan suara tak terjangkau." | kembali idle |
| `insecure-context` | "Mikrofon butuh HTTPS atau localhost." | kembali idle |
| `other` | "Dikte suara gagal." | kembali idle |

- Chrome menghentikan rekaman sendiri setelah jeda diam: `onEnd` mengembalikan UI ke idle (tak ada
  auto-restart pada MVP).
- Pane ditutup, sesi berpindah, atau komponen unmount → `stop()` dipanggil di cleanup.
- Pesan galat hilang otomatis atau saat klik berikutnya; tidak memblokir terminal.

## Privasi

Di Chrome/Edge, Web Speech API mengirim audio ke server penyedia browser (Google/Microsoft) untuk
transkripsi. Ini satu-satunya jalur data keluar baru dan bertentangan dengan citra "tanpa
dependensi eksternal" hanoman; maka dicatat di ADR dan di tooltip/keterangan tombol
("Audio diproses oleh layanan browser Anda"). Jalur Whisper lokal (whisper.cpp) kelak menjadi opsi
tanpa data keluar.

## Di luar scope

- Engine Whisper/Groq/OpenAI, Setting server untuk memilih engine, endpoint `POST /api/transcribe`.
- Auto-kirim (Enter otomatis) atau perintah suara "kirim".
- Push-to-talk, hotkey global, deteksi bahasa otomatis, campuran bahasa dalam satu rekaman.
- Dikte ke luar terminal (form lain di dashboard).

## Pengujian

- `speech-engine.test.ts` (murni): `appendFinal` (kosong, spasi ganda, draf berakhir spasi,
  kapitalisasi tak diubah), transisi mesin-keadaan, pemetaan galat.
- `web-speech-engine.test.ts`: `SpeechRecognition` palsu — `supported` false bila tak ada, pemetaan
  `event.error`, `insecure-context`, interim vs final, `onEnd`.
- `voice-button.test.tsx`: tombol tersembunyi bila `canWrite` false atau tak didukung; toggle
  start/stop; interim tidak mengubah teks composer; final menambah teks composer dan tidak
  mengirim `\r`; galat tampil lalu kembali idle; cleanup memanggil `stop()` saat unmount.
- Regresi: tes composer dan pane yang ada tetap hijau (`terminal-pane.test.tsx`,
  `terminal-composer*`). Jalankan dengan
  `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` dan
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"`.
- Tidak ada endpoint baru → tak ada tes API. Verifikasi manual di Chrome (desktop + tablet):
  rekam `id-ID`, cek teks muncul di composer dan di prompt `claude`, tak ada Enter otomatis.

## Dokumen yang diperbarui (commit yang sama dengan implementasi)

- `internal/docs/frontend/frontend-implementation.md` — bagian Terminal: tombol mic & alur composer.
- ADR baru **0177** — "Dikte suara lewat seam `SpeechEngine`; Web Speech dulu" (menimbang
  Web Speech vs Whisper, catatan privasi, alasan interim tak masuk composer).
- Tautan di `internal/docs/README.md`.
- Tidak ada perubahan skema, jadi tak ada migration.
