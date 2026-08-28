# Hanoman Pet — Sehari-hari

Paket 30 stiker statis WhatsApp dari pet Hanoman dengan copy Indonesia untuk percakapan sehari-hari,
profesional, tegas, kaget, dan penyemangat.

## Isi copy

- Sehari-hari: Pagi!, Halo!, Siap!, Oke!, Gas!, OTW, Bentar ya, Makasih!, Sama-sama, Maaf ya.
- Profesional: Baik, dipahami; Siap dikerjakan; Sedang diproses; Mohon ditinjau; Perlu revisi;
  Sudah selesai; Sudah dikirim; Terima kasih.
- Tegas: Serius.; Ini penting; Tolong fokus; Cek lagi; Jangan lupa.
- Reaksi dan semangat: Hah?!; Serius?!; Waduh...; Tenang...; Mantap!; Yes!; Semangat!.

Setiap stiker berupa WebP transparan 512×512 px dan berukuran di bawah 100 KB. `tray-icon.png`
adalah ikon paket 96×96 px. Berkas mentah dapat diimpor lewat pembuat stiker; distribusi sebagai
aplikasi native tetap membutuhkan integrasi contoh Android atau iOS WhatsApp.

`masters/` menyimpan 30 PNG tanpa teks hasil ImageGen; `id-text/` adalah turunan siap impor,
`proof/` berisi lembar kontak dan pemeriksaan 96 px, sedangkan `manifest.json` mencatat ukuran serta
SHA-256 tiap berkas. Regenerasi turunan tanpa menghapus master:

```bash
python3 internal/scripts/export-whatsapp-stickers.py --pack pet --font <IBMPlexSans-Bold.ttf>
```

Label memakai IBM Plex Sans Bold berlisensi SIL Open Font License 1.1. Exporter membutuhkan berkas
font lokal dan tidak membundel binarinya.
