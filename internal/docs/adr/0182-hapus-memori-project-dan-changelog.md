# ADR-0182 — Hapus memori project dan changelog

Tanggal: 2026-10-10 · Status: diterima (permintaan pengguna)

Menggantikan ADR-0178/0179/0181 dan bagian memori ADR-0180 serta changelog
ADR-0105. Kontrak sync opsional dan stempel `Spec.doneAt` tetap dipakai untuk
fungsi lain.

## Keputusan

Pengguna meminta penghapusan kedua fitur dan secara eksplisit memilih menghapus
juga tabel dan data lamanya. Hapus halaman/dashboard, link, setelan agen changelog,
API, tool MCP, capability memori, injeksi konteks memori, notifikasi/badge memori,
dan registrasi entitas sync memori. Riwayat percakapan Telegram adalah fitur kanal
Telegram tersendiri, bukan memori project; tidak termasuk penghapusan ini.

Migration baru menjatuhkan `MemoryEvent`, `MemoryLocalState`, `ProjectMemory`,
dan `Changelog`, serta kolom `AgentToken.projectIds` yang hanya dipakai memori.
Bersihkan payload memori dari SyncLog/SyncOutbox/SyncConflict/SyncTombstone,
notifikasi memori, capability memory pada token, serta Setting.data.changelog.
Migration lama dipertahankan sebagai sejarah; data fitur terhapus tidak dapat
kembali tanpa backup sebelum migration.

Tool MCP yang dihapus adalah `hanoman_memory_*` dan `hanoman_changelog_*`.
Skema tool naik ke versi 2 karena penghapusan bukan perubahan aditif. REST lama
menjawab 404; URL dashboard lama mengikuti fallback navigasi aplikasi.

## Operasi

Perubahan disiapkan dan diuji di worktree terisolasi dengan database test sendiri.
Tidak menjalankan migration pada database operator/produksi dalam sesi ini.
Saat versi baru dijalankan, migration deploy bawaan hanoman menerapkan penghapusan.
Update node yang saling sync ke versi yang sama; node lama tidak dapat memakai
lagi fitur yang dihapus. Jangan menghidupkan kembali record memori dari outbox lama.

## Penerimaan dan plan

- [x] Hapus seluruh akses frontend dan backend kedua fitur.
- [x] Hapus model/kolom dan buat migration yang menghapus data terkait tanpa
  mengganggu project, backlog, token lain, atau fungsi Telegram.
- [x] Verifikasi schema/migration, daftar tool MCP, endpoint 404, navigasi,
  sync dan sesi tanpa injeksi memori; test terarah dan typecheck paket tersentuh.
- [x] Perbarui docs aktif, tandai ADR fitur lama digantikan, dan validasi index.


## Verifikasi

- 483 test terarah lulus dalam beberapa run: 95 frontend; 185 shared/CLI dan
  kontrak capability/portal; 168 backend sesi/PTY/sync/token/pending/migration;
  35 event subscription/bootstrap/parent DMMF. Suite penuh tidak dijalankan.
- Typecheck `shared`, `runner`, `cli`, `server`, dan `src` lulus; index docs dan
  `git diff --check` bersih.
- Migration diuji terhadap fixture database lama yang berisi empat tabel fitur,
  payload sync, notifikasi, setelan, dan token. Data terkait terhapus; project,
  token dan capability `docs:read`, serta record sync lain tetap utuh.
- Server lokal memakai database dan HANOMAN_HOME sementara. Curl GET/POST
  memori/changelog = 404; GET projects/settings = 200.
- Test server memakai DB/socket tmux terisolasi dan env operator dibersihkan.
  Frontend di Node 25 memakai `--no-experimental-webstorage` agar localStorage
  JSDOM digunakan. Kegagalan cakupan MCP template Excel QA juga direproduksi di
  main; daftar pengecualian unduhan dilengkapi untuk `GET /qa/template.xlsx`,
  mengikuti pengecualian template Markdown/biner yang sudah ada.

Database operator/produksi belum dimigrasikan. Penghapusan data berlaku saat
migration versi ini diterapkan oleh proses deploy/start hanoman.
