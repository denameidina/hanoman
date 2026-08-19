# Release doc (detail) — hanoman

Detail rilis: bagaimana versi dikenali, bagaimana kode sampai ke instance yang berjalan, dan apa yang
harus benar sebelum itu terjadi. Dokumen ini **kanonik**; [entrypoints/rd.md](../entrypoints/rd.md)
adalah pintu masuk ringkasnya.

Jejak "kenapa → bagaimana" tetap berlaku: [business/brd](../business/brd.md) → produk
([entrypoints/prd](../entrypoints/prd.md), [requirements/prd](prd.md)) → arsitektur
([architecture/**](../architecture/stack.md)).

## Identitas versi

hanoman **tidak punya field `version`** — `package.json` root sengaja tanpa nomor versi. Identitas
sebuah build adalah **git SHA** ([ADR-0048](../adr/0048-auto-update-deteksi-read-only.md)):

- `scripts/stamp-build.mjs` menanam `runningBuildSha` ke `server/dist/build-info.json` saat `pnpm build`.
- Server membacanya runtime; bila absen (dev), ia jatuh ke SHA checkout.
- Badge update muncul bila `runningBuildSha ≠ checkoutSha` (kode di disk lebih baru dari app yang jalan)
  **atau** origin di depan checkout.

Server **read-only** soal update: ia hanya mendeteksi dan menampilkan perintah untuk disalin operator.
Ia tak pernah menjalankan `git pull`, `pnpm build`, atau restart sendiri — working tree yang dipakai
sesi agen tak boleh tersentuh, dan build tak boleh menimpa `dist` yang sedang disajikan. Satu-satunya
akses jaringannya, `git fetch`, digerbangi `HANOMAN_UPDATE_FETCH=1` dan di-throttle 5 menit.

## Kanal & branch

- **`main`** — target integrasi. Semua pekerjaan mendarat di sini.
- **`hanoman/spec-<n>`** — satu branch per backlog item; branch adalah properti backlog
  ([ADR-0032](../adr/0032-branch-adalah-properti-backlog-item.md)).
- **`prd/<slug>`**, **`hanoman/<audit-id>`**, **`scaffold-docs`**, **`reverse-docs`** — branch flow
  project-level.
- Integrasi (rebase/merge) **dipicu manual** dari dashboard, tidak otomatis
  ([ADR-0031](../adr/0031-rebase-merge-backlog.md)).

Branch yang sudah ter-merge dibersihkan lewat tab Branches, dengan lima kunci proteksi dan tanpa
`--force` ([ADR-0077](../adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md)).

## Kriteria rilis

Sebelum sebuah perubahan boleh masuk `main`:

1. **Test yang tersentuh hijau** — dijalankan sesi (`vitest --run --changed "$HANOMAN_BASE_SHA"` atau
   path test-nya langsung) plus typecheck **per paket**
   ([ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md)).
   Jebakan yang harus disadari: `--changed` menyalakan `passWithNoTests`, jadi **nol test terlihat
   hijau** — pastikan test-nya memang berjalan.
2. **Suite penuh** (`vitest run --no-file-parallelism`) — langkah **manusia** sebelum merge, bukan tugas
   sesi. Sejak [ADR-0126](../adr/0126-gerbang-validasi-sebelum-publish.md) ia **juga** dijalankan CI
   (`.github/workflows/validate.yml`) pada tiap pull request dan push ke `main`, lewat satu perintah
   `pnpm validate` = `pnpm db:generate` → `pnpm typecheck` → `pnpm test`. Job `publish` di
   `release.yml` ber-`needs: validate`, jadi commit yang merah tak bisa terbit ke npm.
3. **Docs tersentuh diperbarui & ter-link** di [internal/docs/README.md](../README.md); ADR baru ditaut
   di index utama **dan** sub-index [adr/README.md](../adr/README.md) (SPEC-386).
4. **Migration additif.** Instance hub produksi memuat data pengguna sungguhan — tak pernah
   full-overwrite. Model baru ditulis tangan sebagai `migration.sql` lalu `migrate deploy` per DB, bukan
   `migrate dev` (yang me-reset saat ada drift worktree).
5. **Diff bersih di worktree**, siap push ke target branch.

## Prosedur deploy

Urutan yang benar-benar dipakai (detail di [deploy-vps](../operations/deploy-vps.md); untuk prod di
samping dev pada mesin dev, lihat [production](../operations/production.md)):

```
git pull --ff-only
pnpm install                 # dependency baru sering terlewat; postinstall men-generate Prisma Client
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./server exec prisma generate   # redundan sejak ADR-0126, dibiarkan untuk --ignore-scripts
pnpm build                   # verifikasi exit 0 secara eksplisit
systemctl restart hanoman
```

**Gotcha yang pernah menggigit:** `set -e` tidak menangkap build yang gagal di dalam pipe — bila
kegagalan itu lolos, `restart` menyajikan `dist` basi tanpa satu pun pesan error. Periksa exit code
build sendiri, jangan mengandalkan `set -e`.

Sesudah deploy pertama, jalankan `POST /auth/setup` **segera** — endpoint itu terbuka sampai akun
pertama dibuat ([ADR-0028](../adr/0028-auth-sesi-opaque-di-db.md)).

## Rollback

Checkout SHA sebelumnya → `pnpm build` → restart. Karena migration **additif**, rollback kode tidak
menuntut rollback skema: kolom/tabel baru dibiarkan menganggur dan tak mengganggu kode lama. Rollback
skema hanya perlu bila sebuah migration menghapus atau mengubah bentuk kolom yang sudah dipakai — hal
yang menuntut ADR tersendiri sejak awal.

## Yang tidak ada

- Tak ada pipeline CI yang men-deploy; deploy adalah tindakan operator. CI hanya **memvalidasi**
  (`validate.yml`) dan **menerbitkan paket npm** dari tag `v*` (`release.yml`,
  [ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md) ·
  [ADR-0126](../adr/0126-gerbang-validasi-sebelum-publish.md)).
- Tak ada self-update, self-restart, maupun supervisor auto-heal — menghidupkannya butuh ADR baru
  ([ADR-0048](../adr/0048-auto-update-deteksi-read-only.md)).
- Distribusi publik = paket npm `hanoman` itu sendiri ([ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md));
  `hanoman-sdk` dicabut bersama error monitoring ([ADR-0092](../adr/0092-cabut-error-monitoring-sdk-cross-audit.md)).
