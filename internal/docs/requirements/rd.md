# Release doc (detail) — hanoman

Detail rilis: bagaimana versi dikenali, bagaimana kode sampai ke instance yang berjalan, dan apa yang
harus benar sebelum itu terjadi. Dokumen ini **kanonik**; [entrypoints/rd.md](../entrypoints/rd.md)
adalah pintu masuk ringkasnya.

Jejak "kenapa → bagaimana" tetap berlaku: [business/brd](../business/brd.md) → produk
([entrypoints/prd](../entrypoints/prd.md), [requirements/prd](prd.md)) → arsitektur
([architecture/**](../architecture/stack.md)).

Yang ditulis di sini adalah **kontrak** rilis. Prosedur langkah-demi-langkahnya sengaja hidup di satu
tempat saja, yaitu runbook operasi yang ditautkan tiap seksi — runbook yang diduplikasi selalu basi
lebih cepat daripada runbook-nya sendiri.

## Identitas versi

hanoman didistribusikan sebagai **paket npm global** `hanoman`
([ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md)), dan identitas sebuah rilis adalah
**semver**, bukan SHA git:

- **Satu sumber**: field `version` di root `package.json`.
- `scripts/stamp-build.mjs` menanamnya ke `dist/build-info.json` saat `pnpm build`, bersama SHA git —
  SHA tetap ada, tetapi hanya untuk melacak build dev, bukan sebagai identitas rilis.
- Server membacanya runtime dan membandingkannya dengan `GET <registry>/hanoman/latest` lewat
  `compareSemver()`. Badge update muncul bila versi registry lebih tinggi dari versi yang berjalan.
- Registry bisa diarahkan `HANOMAN_NPM_REGISTRY`; jaringannya digerbangi `HANOMAN_UPDATE_FETCH`,
  di-throttle 5 menit, dan gagal → `registry.status = "unavailable"` tanpa pernah melempar.

Ini menggantikan mekanisme SHA git milik SPEC-214/[ADR-0048](../adr/0048-auto-update-deteksi-read-only.md):
instalasi `npm i -g` bukan repo git, jadi tak ada checkout maupun `origin` yang bisa dibandingkan.

## Kanal & branch

Kanal integrasi:

- **`main`** — target integrasi. Semua pekerjaan mendarat di sini.
- **`hanoman/spec-<n>`** — satu branch per backlog item; branch adalah properti backlog
  ([ADR-0032](../adr/0032-branch-adalah-properti-backlog-item.md)).
- **`prd/<slug>`**, **`hanoman/<audit-id>`**, **`scaffold-docs`**, **`reverse-docs`** — branch flow
  project-level.
- Integrasi (rebase/merge) **dipicu manual** dari dashboard, tidak otomatis
  ([ADR-0031](../adr/0031-rebase-merge-backlog.md)).

Branch yang sudah ter-merge dibersihkan lewat tab Branches, dengan lima kunci proteksi dan tanpa
`--force` ([ADR-0077](../adr/0077-hapus-branch-tak-terpakai-pagar-per-branch.md)).

Kanal rilis:

- **Tag `v<semver>`** adalah satu-satunya pemicu rilis. `.github/workflows/release.yml` menerbitkan
  paket ke npm lewat **trusted publishing** (OIDC) — tak ada kredensial penerbit yang pernah ada di
  mesin mana pun. Tak ada publish dari branch, dan tak ada jalur publish dari mesin dev (`pnpm release`
  merakit `dist-npm/` lalu berhenti; ia tak pernah memanggil `npm publish`).
- Sejak amandemen 2026-07-31 ADR-0087, environment `release` **tak lagi punya reviewer**: siapa pun
  yang bisa mendorong tag `v*` — termasuk sesi agen — bisa menerbitkan rilis. Yang tersisa adalah
  pagar mekanis di kriteria di bawah. Environment itu tetap dirujuk workflow karena ia bagian dari
  identitas OIDC, bukan karena ia memagari.

Prosedur & mode kegagalannya: [operations/release-npm](../operations/release-npm.md).

## Kriteria rilis

Sebelum sebuah perubahan boleh masuk `main`:

1. **Test yang tersentuh hijau** — dijalankan sesi (`vitest --run --changed "$HANOMAN_BASE_SHA"` atau
   path test-nya langsung) plus typecheck **per paket**
   ([ADR-0080](../adr/0080-scope-verifikasi-per-sesi.md)).
   Jebakan yang harus disadari: `--changed` menyalakan `passWithNoTests`, jadi **nol test terlihat
   hijau** — pastikan test-nya memang berjalan.
2. **Suite penuh** (`vitest run --no-file-parallelism`) — langkah **manusia** sebelum merge, bukan tugas
   sesi dan bukan job CI. Di local jalurnya satu perintah, `pnpm validate` = `pnpm db:generate` →
   `pnpm typecheck` → `pnpm test`. Sejak amandemen
   [ADR-0128](../adr/0128-gerbang-validasi-sebelum-publish.md) tanggal 2026-08-20,
   `.github/workflows/validate.yml` hanya menjalankan job `typecheck` pada pull request, push ke
   `main`, dan rilis. Job `publish` di `release.yml` tetap ber-`needs: validate`, jadi kontrak
   TypeScript yang merah tetap tidak bisa terbit ke npm; kesehatan suite test menjadi tanggung
   jawab verifikasi local sebelum merge.
3. **Docs tersentuh diperbarui & ter-link** di [internal/docs/README.md](../README.md); ADR baru ditaut
   di index utama **dan** sub-index [adr/README.md](../adr/README.md) (SPEC-386).
4. **Migration additif.** Instance hub produksi memuat data pengguna sungguhan — tak pernah
   full-overwrite. Model baru ditulis tangan sebagai `migration.sql` lalu `migrate deploy` per DB, bukan
   `migrate dev` (yang me-reset saat ada drift worktree).
5. **Diff bersih di worktree**, siap push ke target branch.

Sebelum sebuah versi boleh terbit, pagar mekanis di workflow rilis harus lolos — dan tak satu pun
bergantung pada penilaian siapa pun (di luar trigger tag `v*` itu sendiri, daftar lengkap beserta
mode kegagalannya ada di [operations/release-npm](../operations/release-npm.md)):

6. **Versi di-bump di root `package.json`, dan tag harus cocok dengan nilainya.** Tag yang tak cocok
   menggagalkan run sebelum registry tersentuh. Nomor versi yang salah terbit **tak bisa dipakai
   ulang**; unpublish hanya mungkin dalam 72 jam dan tetap memblokir nama+versi itu selamanya.
7. **Tarball hasil rakitan dipasang dan dijalankan** — `hanoman --version` harus sama dengan versi tag.
   Ini yang mencegah paket "berhasil dirakit" tapi mati saat start. (`hanoman doctor` sengaja **tidak**
   dipakai di CI: ia menuntut `git`, `tmux`, dan CLI agen yang memang tak ada di runner.)
8. **`repository.url` cocok persis dengan repo pembangun**, dijaga `cli/test/pack.test.ts` — trusted
   publishing dan `--provenance` menolak publish tanpa itu, dan kegagalannya hanya muncul di CI.

## Deploy

Jalur utama adalah **instalasi paket npm global**, bukan checkout:

```sh
npm i -g hanoman
hanoman doctor               # prasyarat yang npm tak bisa bawa: node ≥20, git, tmux, claude/codex
hanoman                      # = `hanoman start`: migrate deploy → spawn server + dashboard
```

`hanoman` telanjang adalah supervisor: ia me-resolve home & DB (`$HANOMAN_HOME`, default
`~/.hanoman`), menerapkan `prisma migrate deploy`, lalu men-**spawn** `node dist/server.js` sebagai
proses **anak** dan menunggunya. Di bawah systemd, `ExecStart=/usr/bin/env hanoman` berarti
supervisornya adalah CLI ini.

- Runbook VPS publik (topologi split public/control, systemd non-root, TLS, sandbox agen):
  [operations/deploy-vps](../operations/deploy-vps.md).
- Prod di samping dev pada mesin dev, dan **jalur checkout** yang masih sah untuk mengembangkan
  hanoman: [operations/production](../operations/production.md). `resolveLayout()` mengenali dua
  layout (paket npm dan checkout repo), jadi checkout tetap bisa dijalankan — ia bukan lagi jalur
  default, dan gotcha-nya berbeda (mis. `set -e` tidak menangkap `pnpm build` yang gagal di dalam
  pipe, sehingga restart menyajikan `dist` basi tanpa satu pun pesan error).
- Referensi env & konfigurasi yang dibaca instance: [operations/npm-readme](../operations/npm-readme.md).

Sesudah deploy pertama, jalankan `POST /auth/setup` **segera** — endpoint itu terbuka sampai akun
pertama dibuat ([ADR-0028](../adr/0028-auth-sesi-opaque-di-db.md)).

## Update

Dua jalur, satu mekanisme pemasangan.

**Dari terminal:**

```sh
hanoman update               # npm i -g hanoman@latest --prefer-online
systemctl restart hanoman    # atau matikan & jalankan ulang `hanoman`
```

`hanoman update --check` hanya melaporkan perintahnya tanpa memasang apa pun; registry yang tak
terjangkau membuatnya exit 1 alih-alih memasang buta.

**Dari dashboard** (SPEC-405 · [ADR-0088](../adr/0088-tombol-update-npm-restart-tersupervisi.md)):
badge Update → **Pasang & mulai ulang** → konfirmasi.

Yang penting soal pembagian kerjanya, karena ia mudah salah dibaca sebagai "server melakukan
self-update": **server tetap tidak memasang apa pun.** `POST /api/update/apply` hanya membuat proses
server **keluar dengan kode sentinel `UPDATE_RESTART_EXIT = 75`**. Yang menjalankan
`npm i -g hanoman@latest --prefer-online` → `prisma generate` → `migrate deploy` → spawn ulang adalah
**CLI parent `hanoman start`**. Inti ADR-0048 karena itu tetap berdiri — server menyatakan "aku minta
diganti", pemasangnya proses lain yang memang hidup justru untuk itu — sementara syarat yang ADR-0048
sendiri tetapkan untuk membuka pintunya ("ADR baru + supervisor") dipenuhi ADR-0088.

Empat batas yang mengikat:

- **Supervised-only.** Endpoint & tombol hanya sah bila `process.env.HANOMAN_SUPERVISOR === "1"`, yang
  hanya disuntikkan `serverEnv()` di `cli/src/commands/start.ts`, dan diekspor ke klien sebagai
  `UpdateStatus.canApply`. Di `pnpm dev`, bundle server telanjang, atau supervisor pihak ketiga yang
  memanggil `dist/server.js` langsung, panel tetap read-only dan hanya menampilkan perintah untuk
  disalin.
- **Dua langkah, satu endpoint.** Tanpa `confirm` ia dry-run: `409 confirm-required` + jumlah sesi
  hidup + `from`/`to`. Sesi hidup **tidak memblokir** apa pun — manusia yang memutuskan.
- **Sesi selamat.** `pty.ts` memakai `tmux new-session -d`, jadi tmux adalah daemon terpisah
  ([ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)); yang putus saat restart hanya jembatan
  `tmux attach` + WebSocket-nya, dan klien menyambung ulang ber-backoff.
- **Install gagal tak fatal** (versi lama dijalankan ulang + alasan dicetak); **migrasi gagal fatal**
  (menjalankan bundle baru di atas skema lama menukar downtime dengan kesalahan data); jatah
  `MAX_UPDATE_RESTARTS = 5` per proses, dan saat habis alasannya dicetak.

Proses CLI supervisor sendiri **tetap kode versi lama** sampai `hanoman` dijalankan ulang manusia.
Semua fitur produk hidup di server/web/migrasi, jadi ini tak berpengaruh dalam pemakaian normal.

## Rollback

Rollback kode = **memasang versi paket yang diketahui baik**, lalu restart:

```sh
npm i -g hanoman@<versi-baik>
systemctl restart hanoman
```

Karena migration **additif**, rollback kode tidak menuntut rollback skema: kolom/tabel baru dibiarkan
menganggur dan tak mengganggu kode lama. Rollback skema hanya perlu bila sebuah migration menghapus
atau mengubah bentuk kolom yang sudah dipakai — hal yang menuntut ADR tersendiri sejak awal.

Versi yang terbit rusak **tidak** ditarik dengan unpublish (jendelanya 72 jam, dan nama+versi itu
tetap terblokir selamanya): terbitkan versi berikutnya dan `npm deprecate` yang rusak — persis yang
dilakukan pada `0.1.3`. Di VPS publik, rollback yang aman adalah menutup ingress publik sambil
**mempertahankan** boundary keamanan; jangan pernah rollback ke konfigurasi root, control host publik,
query token, atau sandbox `off` ([operations/deploy-vps](../operations/deploy-vps.md)).

## Yang tidak ada

- **Tak ada pipeline CI yang men-deploy.** Deploy dan update instance adalah tindakan operator; yang
  dilakukan CI hanyalah **typecheck** tiap pull request & push `main` (`validate.yml`) lalu
  **menerbitkan** paket pada tag `v*` (`release.yml`, ber-`needs: validate` sejak
  [ADR-0128](../adr/0128-gerbang-validasi-sebelum-publish.md)).
- **Tak ada supervisor auto-heal.** `hanoman start` me-restart server hanya sebagai jawaban atas exit
  sentinel `75` yang dipicu manusia lewat tombol update, dengan jatah `MAX_UPDATE_RESTARTS = 5` — bukan
  sebagai pemulihan crash. Menjaga proses tetap hidup adalah tugas systemd (`Restart=on-failure`).
- **Tak ada self-update lewat git.** Instalasi `npm i -g` bukan repo git, dan menjadikannya repo git
  berarti mempertahankan model lama sambil berpura-pura sudah pindah (ADR-0087, alternatif yang
  ditolak).
- **Tak ada paket lain yang diterbitkan.** Yang publik adalah satu paket self-contained `hanoman`;
  workspace `@hanoman/*` tidak dipublikasikan, dan `hanoman-sdk` dicabut bersama error monitoring
  ([ADR-0092](../adr/0092-cabut-error-monitoring-sdk-cross-audit.md)).
