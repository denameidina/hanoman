# Checkout otomatis & kredensial git lintas device — design

Tanggal: 2026-10-11 · Status: direvisi setelah verifikasi kode (lihat "Revisi")

## Masalah

Menjalankan sesi di project server/client tidak seamless di device atau VPS lain:

1. Sync hanya membawa metadata project. `Project.repoDir` dan `LocalBinding` sengaja LOCAL-only
   (ADR-0135, `server/src/services/sync.ts:61-70`), jadi project hasil sync mendarat tanpa checkout
   dan sesi gagal sampai ada binding manual (`server/src/services/local-binding.ts:27-32`).
2. Clone membutuhkan akses git. Di mesin baru belum ada `gh auth`/ssh key, sehingga clone repo
   private gagal sampai pengguna login manual.
3. `POST /projects/:id/clone` berjalan sinkron (`spawnSync`) di request HTTP dan memblokir event loop.

## Tujuan

Di device/VPS baru yang sudah terhubung ke hub, meluncurkan sesi untuk project mana pun langsung
jalan: hanoman meng-clone repo sendiri dengan token yang dibawa dari hub, memasang binding, lalu
membuat worktree. Tanpa login git manual.

## Di luar scope

- Setup per worktree (`.env`, install deps, port dev server).
- Melanjutkan sesi/worktree lintas device.
- Penyedia git selain GitHub.
- Memberi token ke agen sesi (hanya hanoman yang memakainya, di luar proses agen).
- Status "cloning" lewat `/api/events/ws` (butuh grup snapshot baru, ADR-0145): launch menunggu clone
  di request, tetapi clone berjalan asinkron terhadap event loop.

## Keputusan

| # | Keputusan | Alasan |
|---|---|---|
| 1 | Auto-clone saat launch bila binding kosong dan project punya `gitRemote` | Pilihan pengguna; nol klik tambahan |
| 2 | Lokasi clone `$HANOMAN_HOME/projects/<slug>` | Satu root yang dikelola hanoman; binding manual tetap menang |
| 3 | Token = `GITHUB_TOKEN` lokal (RuntimeConfig, terenkripsi), lalu hub via `GET /sync/git-credential` | `GITHUB_TOKEN` + UI Settings sudah ada; topologi hub–client sudah mengautentikasi device token |
| 4 | Client tidak menyimpan ulang token hub | Pencabutan di hub langsung berlaku; tanpa model/migration baru |
| 5 | Clone memakai `execFile` asinkron, satu clone per project | Clone lama; `spawnSync` membekukan server (pelajaran SPEC-742) |
| 6 | Agen sesi tidak menerima token | Menghindari eskalasi (ADR-0199 butir 4) |

## Rancangan

### 1. Alur launch (`session-launch.ts`)

Saat `resolveRepoDir` tidak menemukan binding:

1. Tanpa `gitRemote` → `LaunchError needs-bind` (perilaku lama dipertahankan).
2. `cloneProjectCheckout(projectId)`: token dari `resolveGitToken()`; `git clone` ke
   `$HANOMAN_HOME/projects/<slug>` dengan `GIT_ASKPASS` env-only. Remote SSH GitHub diubah ke
   HTTPS hanya untuk operasi git hanoman. Token hanya dipakai untuk `https://github.com/`.
3. Pasang `LocalBinding`, lanjut ke `addWorktree`.
4. `git fetch origin` best-effort bila `branchFrom` tak ada lokal maupun di `origin/*`. Bila tetap
   tak resolve, `addWorktree` melempar dengan nama revisinya — tanpa fallback diam-diam ke HEAD.

Kunci per project: panggilan bersamaan menghasilkan satu clone. Clone gagal → folder sisa dihapus,
tanpa binding. Folder tujuan berisi repo dengan remote yang sama dipakai ulang; folder berisi hal
lain tidak pernah ditimpa. Kegagalan clone → `LaunchError kind "checkout"` (HTTP 422).

### 2. Token

- Hub: pengguna mengisi `GITHUB_TOKEN` di Settings (sudah ada). Tidak ada penyimpanan baru.
- Client: `GET /api/sync/git-credential` (Bearer device token, TLS) → `{ token: string | null }`,
  `cache-control: no-store`. Dipanggil hanya saat clone/fetch dan token lokal kosong.
- Pencabutan: hapus `GITHUB_TOKEN` di hub, atau cabut device token client.
- Token tidak muncul di URL remote, `.git/config`, argv, log, atau galat (stderr git di-redact).

### 3. UI

Tidak berubah. Tombol "Jalankan git clone" sudah ada di `src/src/screens/MissingRepoCard.tsx`
dan memanggil `POST /projects/:id/clone`, yang kini memakai service yang sama (token, kunci,
penolakan folder terisi).

### 4. Galat

| Kondisi | Hasil |
|---|---|
| `gitRemote` kosong | `needs-bind` (400) |
| Tanpa token dan git tak punya akses | `checkout` (422), pesan menunjuk `GITHUB_TOKEN` / hubungkan ke hub |
| Token ditolak (401/403) | `checkout` (422): "token GitHub ditolak atau tanpa akses ke <remote>" |
| Folder tujuan terisi hal lain | `checkout`, tidak menimpa |
| Clone terputus / gagal | `checkout`, folder sisa dihapus |
| `branchFrom` tak ada setelah fetch | galat `worktree` dari `addWorktree` (menyebut revisi) |
| Launch bersamaan | satu clone, lainnya menunggu |

## Kontrak & dokumen (satu commit yang sama)

- Tanpa perubahan skema Prisma, tanpa migration.
- ADR-0203; `GET /sync/git-credential` dicatat di `UNWRAPPED` mcp-coverage (kanal mesin-ke-mesin,
  ADR-0199 butir 4) dan di `internal/docs/architecture/api-contract.md`; tautan di `internal/docs/README.md`.
- Tool MCP `hanoman_project_clone` tidak berubah (parameter `dir` tetap wajib).

## Test

Lihat `docs/superpowers/plans/2026-10-11-checkout-otomatis.md`: unit helper askpass, resolusi
token, service clone (reuse, occupied, gagal, konkurensi, redaksi token), integrasi
`startSpecSession`, route clone, gate agent token 401, dan uji nyata curl di lokal.

## Revisi (hasil verifikasi kode)

Draf pertama mengusulkan model `GitCredential`, migration, halaman "Akses Git", status cloning di
kanal events, dan sealed box per instance. Verifikasi menunjukkan:
`GITHUB_TOKEN` sudah ada sebagai config secret terenkripsi dengan UI-nya
(`shared/src/config-registry.ts:42`); tombol clone sudah ada di `MissingRepoCard.tsx`; sync berjalan
hub–client dengan device token sehingga lapisan enkripsi kedua tidak perlu. Semuanya dihapus.
