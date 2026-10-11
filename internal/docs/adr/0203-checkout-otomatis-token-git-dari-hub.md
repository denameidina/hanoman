# ADR-0203 — Checkout otomatis saat launch; token git dibawa dari hub

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
SPEC: —
Terkait: ADR-0043/0135 (checkout LOCAL-only) · ADR-0044/0199 (kanal mesin-ke-mesin ber-device-token) · ADR-0097 (config secret terenkripsi) · ADR-0116 (jangan blokir event loop) · ADR-0202 (keputusan MCP)

## Konteks

`Project.repoDir` dan `LocalBinding` sengaja LOCAL-only (ADR-0135), jadi project hasil sync
mendarat di device/VPS baru tanpa checkout, dan meluncurkan sesi gagal dengan `needs-bind`
sampai pengguna meng-clone dan mem-bind sendiri. Untuk repo private, clone itu sendiri butuh
login git (`gh auth login` / ssh key) di tiap mesin baru. `POST /projects/:id/clone` juga
menjalankan `git clone` lewat `spawnSync`, yang membekukan server selama clone berlangsung.

## Keputusan

1. **Launch tanpa binding meng-clone otomatis.** `startSpecSession` memanggil
   `cloneProjectCheckout` bila `resolveRepoDir` kosong dan project punya `gitRemote`, ke
   `$HANOMAN_HOME/projects/<id>`, memasang `LocalBinding`, lalu melanjutkan ke worktree.
   Tanpa `gitRemote` perilaku lama (`needs-bind`, HTTP 400) tetap. Kegagalan clone →
   `LaunchError kind "checkout"` (HTTP 422).
2. **Token = `GITHUB_TOKEN`** (RuntimeConfig, terenkripsi `secret.key` lokal, ADR-0097) bila ada
   di instance ini; bila tidak dan instance adalah client, diminta dari hub lewat
   `GET /api/sync/git-credential` (Bearer device-token, `cache-control: no-store`,
   `{ token: string | null }`). Client **tidak menyimpan ulang** token itu.
3. **Token hanya lewat env proses git.** `GIT_ASKPASS` menunjuk skrip statis tanpa rahasia;
   token ada di `HANOMAN_GIT_TOKEN` pada proses git anak. Tidak ada di URL remote, argv,
   `.git/config`, log, atau pesan galat (stderr di-redact). Dipakai hanya untuk
   `https://github.com/`; remote SSH GitHub diubah ke HTTPS hanya untuk operasi git hanoman.
   `credential.helper=` dikosongkan saat token dipakai agar keychain mesin tak menjawab lebih dulu.
4. **Clone asinkron dan ber-kunci per project.** `execFile` (bukan `spawnSync`), timeout 10 menit;
   panggilan bersamaan untuk satu project berbagi satu clone. Gagal → folder sisa dihapus.
5. **Folder tujuan tidak pernah ditimpa.** Folder berisi repo dengan remote yang sama dipakai
   ulang sebagai binding; folder berisi hal lain → `CheckoutError "occupied"`.
6. **Ref dasar yang hilang diambil.** Sebelum `addWorktree`, `fetchRefIfMissing` menjalankan
   `git fetch origin` bila `branchFrom` tak ada lokal maupun di `origin/*`. Best-effort: bila
   tetap tak resolve, `addWorktree` melempar dengan nama revisinya — tanpa fallback ke HEAD.
7. **`POST /projects/:id/clone` memakai service yang sama** (kontrak HTTP tidak berubah; `dir`
   tetap wajib). Tool MCP `hanoman_project_clone` tidak berubah.
8. **Keputusan MCP (ADR-0202):** `GET /sync/git-credential` masuk `UNWRAPPED` — Bearer
   device-token membawa rahasia; membungkusnya berarti menyerahkan token ke agen atau membuat
   tool yang pasti 401 (alasan sama dengan ADR-0199 butir 4). Agent token ditolak 401 di route
   itu (dikunci `instance-sync-gate.test.ts`). Agen sesi tidak pernah menerima token.

## Alternatif yang ditolak

- **Model `GitCredential` baru + sealed box per instance.** `GITHUB_TOKEN` dan UI Settings-nya
  sudah ada, dan topologi hub–client sudah mengautentikasi device token; lapisan kedua hanya
  menambah migration dan permukaan serangan.
- **Menyimpan token hub di client.** Pencabutan di hub tidak akan berlaku di client.
- **Status "cloning" di kanal `/api/events/ws`.** Butuh grup snapshot baru (ADR-0145); bukan
  syarat agar launch seamless. Launch menunggu clone di request, tetapi event loop bebas.

## Konsekuensi

- Tanpa perubahan skema dan tanpa migration.
- Hub offline + token lokal kosong + repo private → clone gagal dengan pesan yang menunjuk
  `GITHUB_TOKEN` di Settings atau koneksi ke hub.
- Setiap device token aktif bisa membaca `GITHUB_TOKEN` hub. Mencabut akses = mencabut device
  token atau menghapus `GITHUB_TOKEN` di hub. Gunakan fine-grained token yang dibatasi ke repo
  yang dipakai.
- Tombol "Jalankan git clone" di `MissingRepoCard.tsx` otomatis mendapat token dan perlindungan
  folder terisi tanpa perubahan frontend.

## Penerimaan

- [x] Launch tanpa binding + `gitRemote` → clone, binding terpasang, worktree lahir.
- [x] Clone gagal → `checkout`, `baseSha` tak tersentuh, tanpa binding, tanpa folder sisa.
- [x] Dua clone bersamaan untuk satu project menghasilkan satu clone.
- [x] Token tidak muncul di pesan galat; askpass tidak memuat token.
- [x] `GET /sync/git-credential`: 401 tanpa device token dan untuk agent token; `no-store`.
