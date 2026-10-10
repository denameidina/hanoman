# QA: sesi langsung dan sinkronisasi lengkap

## Kebutuhan
Temuan dapat dikerjakan tanpa membuat Spec. Opsi backlog yang ada tetap tersedia. Langkah uji, temuan, dan byte lampiran disinkronkan dua arah melalui hub yang sudah dikonfigurasi.

## Kontrak
- Tombol Kerjakan langsung membuka sesi agen default pada worktree `.worktrees/qa-<hash findingId>`, branch `qa/<hash findingId>`, dari HEAD project lokal. Sesi aktif dipakai ulang; worktree lama dipertahankan. Tidak ada Spec baru dan tidak ada perubahan status temuan otomatis.
- POST `/projects/:pid/qa/reports/:rid/findings/:fid/session` memerlukan qa:write serta principal berhak meluncurkan sesi. Laporan closed boleh. Temuan wontfix atau sudah terkait backlog ditolak 409 (gunakan sesi backlog).
- Prompt membawa metadata laporan, repro, expected/actual, langkah uji terkait, serta salinan lampiran laporan, temuan, dan test case terkait. Byte yang hilang dilaporkan dan peluncuran ditolak agar konteks tidak diam-diam hilang.
- Sesi deterministik lokal; riwayat/presence mengikuti mekanisme sesi yang ada. Hasil di-review/integrasikan melalui Terminal. QA tetap dinilai operator setelah retest.
- Record QA tetap memakai feed, konflik dan tombstone yang ada. Byte client→hub diunggah setelah metadata; hub→client diunduh otomatis maksimal 5 per siklus, hash/ukuran/mime diverifikasi. Gagal jaringan dicoba lagi, satu lampiran gagal tidak menghambat yang lain; lazy-fetch tetap fallback.
- Tombol Sinkronkan QA memakai syncNow dan memuat ulang laporan. Konfigurasi hub/token yang ada digunakan; tidak mengubah server production.

## Acceptance
1. Sesi langsung berhasil tanpa menambah Spec; klik berulang memakai sesi sama.
2. Repo belum terikat, scope id salah, token tanpa izin, atau lampiran hilang tidak meluncurkan sesi.
3. Prompt dan disk sesi memuat langkah uji dan lampiran dengan nama berkas aman.
4. Backlog tetap berfungsi; laporan closed bisa memulai sesi.
5. Sync mengunggah dan mengunduh byte, memverifikasi integritas, mencoba ulang kegagalan tanpa starving berkas lain.
6. UI membuka Terminal setelah peluncuran dan mempertahankan opsi backlog.
