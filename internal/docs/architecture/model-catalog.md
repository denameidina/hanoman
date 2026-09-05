# Katalog model otomatis

Hanoman menemukan model dari CLI terpasang saat startup dan setiap **5 menit**. Katalog bawaan
memuat Claude Fable 5.1 (`claude-fable-5-1`) dan GPT-6 Astra (`gpt-6-astra`).
Model baru tidak memerlukan perubahan kode Hanoman selama protokol katalog CLI kompatibel.
Ketersediaan tetap bergantung pada akun, konfigurasi provider, dan versi CLI. Hanoman tidak
mengupgrade CLI, mengganti default tersimpan, atau mengubah sesi yang sudah berjalan.

## Sumber dan batas

- Claude: control request `initialize` di stream-json, mengambil hanya `models`.
  Tidak mengirim pesan user/inferensi; hooks dimatikan, MCP dikosongkan, cwd temp kosong.
  ID `resolvedModel` dan alias non-default dikenali; label/effort berasal dari metadata CLI.
- Codex: `codex debug models`, tanpa `--bundled`, mengambil slug, nama, effort dan minimum
  client bila diberikan. Entri `visibility: hide` tidak masuk hasil discovery.
- Biner memakai `HANOMAN_CLAUDE_BIN`/`HANOMAN_CODEX_BIN` efektif. Dalam Podman,
  probe memakai image, credential mount RO, network dan proxy sesi yang sama.
- Satu refresh aktif, provider diperiksa serial; timeout per proses **20 detik**, stdout
  maksimal **4 MiB**. CLI yang macet dihentikan per proses, tidak dengan pola nama.

Katalog CLI digabungkan dengan fallback bawaan (hasil CLI menang untuk ID sama).
Karena itu daftar adalah pilihan model, bukan bukti setiap model bisa dipakai akun tersebut.
Kegagalan satu provider tidak menghapus hasil terakhir atau menahan pembaruan provider lain.
`source: cli` berarti CLI mengembalikan katalog, bukan bukti refresh jaringan provider sukses:
CLI sendiri mungkin memakai cache internal atau katalog bundled-nya.

Cache `$HANOMAN_HOME/model-catalog.json` ditulis atomik, permission 0600, LOCAL-only.
Hanya field katalog yang disimpan; akun, token, prompt dan keluaran mentah CLI tidak ikut.
Cache rusak/absen memakai fallback; kegagalan write terlihat dalam status.

## Distribusi dan pemakai

`GET /api/models` hanya admin-cookie, mengembalikan snapshot tanpa memulai probe.
Frame `{t:"models",catalog}` menumpang WebSocket events yang sudah ada, cookie-only,
diperiksa untuk perubahan setiap 3 detik. Browser melakukan satu fetch saat pemakai pertama
mount dan menerima push berikutnya; response HTTP yang kalah cepat dari WS diabaikan.

`replaceModelCatalog` memasang binding katalog shared untuk pemakai lama sekaligus:
Settings, Start, New Terminal, cron, custom agent, validasi custom agent, pemilihan effort,
dan perintah Telegram. Metadata effort Claude juga per model bila CLI menyediakannya;
tanpa metadata tetap memakai daftar effort lama. Effort custom agent adalah string berbatas,
dengan keabsahan pasangan diperiksa terhadap katalog pada boundary route.

Settings menghitung opsi saat render dan menampilkan sumber, waktu pemeriksaan, serta error.
Default global tetap keputusan operator. Model Codex yang ditemukan runtime tidak
ditimpa oleh peta pensiun historis ketika settings dibaca.

## Verifikasi

Fixture model masa depan membuktikan penambahan ID/effort tanpa perubahan allowlist.
Test mencakup refresh concurrent, offline/recovery, cache, timeout, transport tanpa inference,
boundary Podman, pembaruan picker mounted, validasi custom agent, HTTP dan izin frame WS.
Probe lokal 2026-09-05 mengembalikan Fable 5.1 dan Astra beserta effort-nya.
Kontrak metadata Claude terdokumentasi pada
[referensi supportedModels](https://code.claude.com/docs/en/agent-sdk/typescript);
Hanoman menggunakan protokol CLI secara langsung, tanpa menambahkan SDK eksekusi.
