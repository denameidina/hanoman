# Katalog model runtime

Permintaan: dukung Claude Fable 5.1 dan GPT-6 Astra, serta temukan model berikutnya tanpa rilis Hanoman.

## Keputusan

Katalog bawaan tetap fallback. Server menemukan model lewat CLI yang dipakai sesi: Codex
`debug models` dan Claude stream-json control `initialize`, tanpa pesan pengguna/inferensi.
Keduanya telah diprobe lokal: Fable = `claude-fable-5-1`, Astra = `gpt-6-astra`.
Metadata model/effort berasal dari respons, bukan penebakan versi/nama. Claude dapat
mengembalikan alias dan resolvedModel; keduanya dikenali, dengan ID resolved sebagai pilihan utama.

Pemeriksaan saat startup dan setiap 5 menit, satu pemeriksaan aktif, timeout 20 detik,
stdout maksimal 4 MiB. Dalam Podman gunakan boundary/credential/proxy sesi yang sama.
Kegagalan per provider mempertahankan snapshot sebelumnya dan menampilkan status degraded.
Cache terakhir disimpan LOCAL-only di HANOMAN_HOME; tidak disync, tidak menyimpan akun/token.
Katalog dibagikan lewat GET /api/models (admin cookie) dan grup models di WebSocket yang sama.
Semua pemakai katalog shared membaca snapshot runtime: Settings, Start, terminal, custom agents,
effort validation, Telegram. Pembaruan katalog tidak mengganti setting atau sesi berjalan.
Daftar bawaan menjaga instalasi offline tetap dapat memilih model; ketersediaan aktual tetap
ditentukan CLI dan akun. Refresh bukan jaminan model dirilis langsung tersedia ke semua akun.

## Acceptance

- WHEN katalog CLI menambahkan ID model baru, THE semua picker SHALL menawarkan ID itu tanpa rebuild.
- WHEN metadata effort berubah, THE UI dan validasi custom agent SHALL memakai metadata yang sama.
- WHEN salah satu probe gagal, THE provider lain SHALL tetap diperbarui dan katalog lama SHALL tetap terbaca.
- WHEN banyak pembaca meminta katalog, THE server SHALL menjalankan maksimal satu siklus discovery.
- THE probe SHALL tidak mengirim pesan inference, menjalankan hooks/MCP proyek, atau mengirim akun ke browser.
- THE default global dan sesi berjalan SHALL tidak berubah karena discovery.

## Alternatif

API models langsung memerlukan autentikasi berbeda dari langganan CLI dan tidak mencerminkan
model yang runtime itu dukung. Feed eksternal kurasi menciptakan sumber kedua yang harus dirawat.
CLI adalah sumber paling dekat dengan sesi; perubahan protokol CLI kelak tetap mungkin perlu adapter.
