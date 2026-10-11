# ADR-0214 — Setup awal tetap dua langkah: wizard lalu akun pertama, dengan nomor langkah yang jujur

- Status: Accepted · **menegaskan [0139](0139-hardening-opsional-dan-wizard-setup.md)** (wizard dua langkah, akun lahir di `AuthScreen`); tidak mengubah invariannya
- Tanggal: 2026-10-12
- SPEC: — (tindak lanjut audit UI/UX 2026-10, butir 8 "Akun pertama di AuthScreen vs wizard")
- Terkait: 0117 (token setup), 0139 (wizard, satu jalur pembuatan akun, sentinel restart 76) · `frontend-implementation.md` § 3N

## Konteks

Audit UI/UX 2026-10 bertanya apakah akun pertama digabung ke wizard satu layar. Setup sudah satu layar
sejak 3N, tetapi tetap berupa dua layar berurutan: `SetupWizard` (Peruntukan, pengakuan risiko, Lanjutan
hardening) lalu `AuthScreen` (akun). Keduanya memasang nomor langkah ("setup 1/2", "setup 2/2").

Empat fakta membentuk keputusan:

1. **Hanya ada satu jalur pembuatan akun**: `POST /api/auth/setup` beserta aturan setup token, limiter, dan
   409 (0139). Form akun di dalam wizard berarti jalur kedua, atau wizard memanggil `setup` sendiri: dua
   tempat untuk aturan yang sekarang berada di satu tempat.
2. **Apply wizard di bawah supervisor memulai ulang server** (`routes/setup.ts`, `restart: "self"`; server
   keluar 50 ms sesudah respons, supervisor menghidupkannya lagi). Akun tidak boleh dibuat di layar yang
   sama dengan commit yang memulai ulang server, karena submit bisa jatuh di tengah restart.
3. **Wizard bisa dibuka ulang dari Pengaturan tanpa akun sama sekali** (mode diulang, tombol Batal).
   Akun tidak berlaku di sana. Kalau digabung, mode itu kehilangan artinya.
4. **Peruntukan dan hardening tidak butuh kredensial; akun butuh.** Dua tombol commit dengan konsekuensi
   berbeda (apply memulai ulang server, akun membuat sesi masuk) tidak cocok dalam satu form.

Yang tidak beres ada pada nomor langkah, bukan pada pemisahan layarnya (lihat Keputusan 2 dan 3).

## Keputusan

1. **Tetap dua langkah, dua layar berurutan: wizard, lalu akun.** Tidak digabung menjadi satu form, dan
   akun tidak menjadi langkah ketiga (0139 tetap berlaku).
2. **Satu aturan untuk nomor langkah.** Nomor hanya tampil bila wizard benar-benar dijawab di sesi browser
   ini:
   - `SetupWizard` pada setup pertama: `hanoman · setup 1/2`.
   - `AuthScreen` dengan `setupStep={2}`: `hanoman · setup 2/2`.
   - `AuthScreen` tanpa `setupStep` (misalnya wizard sudah dijawab di sesi lalu dan akun belum ada): `hanoman · setup`, tanpa nomor.
   - `SetupWizard` diulang dari Pengaturan: tanpa nomor.
   Sumber kebenaran untuk "wizard dijawab di sesi ini" adalah state `setupDone` di `App`, bukan `setupStatus`.
3. **Penerapan.** `App.tsx` saat ini menurunkan `setupStep` dari `setupStatus?.needed === false`. Itu salah
   dengan dua cara: (a) `setupStatus` tidak diambil ulang sesudah `onDone`, jadi `needed` tetap `true` dan
   "2/2" tidak pernah tampil di alur normal; (b) bila wizard dijawab di sesi lain dan akun belum ada,
   `needed` bernilai `false` dan "2/2" tampil tanpa wizard. Perbaikannya satu baris:
   `setupStep={setupDone ? 2 : undefined}` pada pemanggilan `AuthScreen` di `App.tsx` (sekarang sekitar baris
   1571). Commit ADR ini tidak menyentuh `App.tsx`; baris itu tercatat sebagai tindak lanjut di Konsekuensi.

## Alternatif yang ditolak

- **Satu form** (peruntukan, akun, dan setup token dalam satu layar). Dua commit dengan konsekuensi
  berbeda, jalur akun ganda, dan mode Pengaturan kehilangan artinya.
- **Akun sebagai langkah 3/3.** Ditolak sejak 0139: langkah tambahan tidak menambah keputusan, dan
  "3/3" akan berbohong untuk instance yang wizard-nya sudah dijawab.
- **Menyimpan "wizard dijawab" di `localStorage`.** Itu state per browser. Penomoran harus berasal dari
  state app yang sudah ada.

## Konsekuensi

- Operator tetap melihat urutan peruntukan → keamanan → akun, dan nomornya tidak berbohong.
- Tindak lanjut yang belum ada di commit ini: baris `setupStep` di `App.tsx` (Keputusan 3). Sampai
  diterapkan, "2/2" tetap tidak tampil di alur normal. Tidak ada kerusakan fungsional.
- Di bawah supervisor, `SetupWizard` pindah ke akun segera setelah apply tanpa menunggu server kembali.
  Submit akun yang jatuh di jendela restart menampilkan "Tidak bisa terhubung ke server" dan bisa dicoba
  lagi. Risiko ini diterima. Perbaikannya (menunggu `/setup/status` sebelum `onDone`) bukan bagian
  keputusan ini.
- Wizard yang belum selesai tetap tidak terlindungi (0139): urutan amannya tetap menyelesaikan di
  `localhost` sebelum menyambungkan domain atau tunnel.

## Invarian

1. Akun pertama lahir hanya di `AuthScreen`, lewat `api.setup`.
2. Nomor langkah tidak pernah diklaim tanpa wizard dijawab di sesi itu.
