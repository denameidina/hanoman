# Onboarding

Operator baru harus bisa memantau dalam < 10 menit.

1. **Wizard setup awal** (SPEC-884/ADR-0139, hanya pada pemakaian pertama): peruntukan instance
   (device sendiri / diakses orang lain) lalu keamanan (hardening — **default mati**, dan tak bisa
   dinyalakan selama prasyaratnya masih merah). Bisa dibuka lagi kapan saja di **Settings → Setup
   awal**; jalur itu tak pernah menyentuh akun.
2. Buat akun pertama / masuk (email + password; SPEC-169). **Setup token hanya diminta bila
   hardening menyala** — di instalasi biasa cukup email + password.
3. Tambah project: **from-scratch** (pilih folder → hanoman `git init` repo → tombol **Scaffold docs**, atau auto-start bila `autoScaffold` on → sesi interaktif brainstorm ide → objective → seluruh doc index; fase Brainstorm dijawab di Terminal) atau **existing** (pilih folder lokal atau clone dari URL git → CTA-nya langsung memulai sesi **reverse docs** yang menyusun Source of Truth dari kode dan membuka Terminal; fase Wawancara dijawab di sana. Gagal mulai → project tetap ada dan tombol **Reverse docs** di layar project mengulanginya, SPEC-848).
4. Buka backlog, mulai sesi untuk sebuah item (atau ambil dari Terminal).
5. Pantau di Overview & Terminal; review & rebase/merge branch saat backlog `done`.

## Telegram (opsional · SPEC-476/ADR-0096 · kredensial SPEC-477/ADR-0097)

Seluruhnya dari dashboard — tanpa mengedit `.env`, tanpa restart.

1. Buat satu bot di BotFather; salin token-nya.
2. Di Settings → Akses AI Agent, hidupkan master switch dan buat AgentToken dengan capability yang
   ditampilkan kartu status Telegram; salin plaintext-nya sekali itu.
3. Di Settings → Telegram, kartu **Kredensial**, isi Bot token, AgentToken gateway, Allowlist user id
   (numeric user id private-chat yang diizinkan), dan Chat / Channel ID target — lalu **Simpan**.
   Bot token & AgentToken disimpan terenkripsi dan tak pernah ditampilkan kembali utuh. **Simpan
   menolak (400)** bila AgentToken-nya tak dikenal, sudah dicabut, atau capability-nya kurang —
   yang diminta adalah **plaintext `hnm_agt_…`** yang hanya muncul sekali saat token diterbitkan,
   bukan hash-nya (SPEC-491).
4. Tekan **Test Connection** sampai hijau, lalu nyalakan gateway. Berlaku seketika. Perhatikan
   **dua** baris hasilnya: yang atas menguji jalur **keluar** (bot token), yang bawah jalur
   **masuk**. Selama baris jalur masuk masih kuning, pesan Telegram tak akan pernah tertangkap —
   apa pun warna baris atasnya (SPEC-491).
5. Kirim `/status`. Chat diikat ke satu session operator tmux dan pesan berikutnya kembali ke session
   yang sama. Token tidak pernah diisikan atau ditampilkan di Telegram.

Instance lama yang masih memakai `HANOMAN_TELEGRAM_*` di `.env` tetap bekerja: nilai dari env dipakai
selama field-nya kosong, ditandai **`dari .env · deprecated`**. Isi field-nya untuk memindahkannya;
tombol **Hapus kredensial** mengosongkan baris DB (dan mengembalikan `.env` bila masih terisi).
