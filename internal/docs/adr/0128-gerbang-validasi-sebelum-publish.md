# ADR-0128 — Gerbang validasi sebelum publish, dan bootstrap Prisma Client di postinstall

Status: accepted · 2026-08-19

## Konteks

Sejak [ADR-0087](0087-distribusi-npm-global-satu-perintah.md) (diamandemen 2026-07-30) paket
`hanoman` terbit dari `.github/workflows/release.yml` pada tag `v*` lewat trusted publishing OIDC.
Workflow itu adalah **satu-satunya** berkas di `.github/workflows/` — repo tak punya workflow
validasi sama sekali. Jalur rilisnya: cek tag == versi → `pnpm install --frozen-lockfile` →
`pnpm release` → pasang tarball & `hanoman --version` → `npm publish --provenance`. Tak satu pun
langkah itu memanggil `vitest` atau `tsc`.

Ini tak terlihat karena dua sebab yang saling menutupi:

1. **`pnpm release` = build, bukan verifikasi.** Server dan CLI dibundel **esbuild** dengan
   `--external:@prisma/client`. esbuild tak melakukan type checking dan tak pernah menyentuh
   Prisma Client, jadi build hijau adalah pernyataan tentang bundling — bukan tentang test maupun
   kontrak TypeScript.
2. **Checkout bersih tidak punya Prisma Client.** Skema hanoman ada di
   `server/prisma/schema.prisma`; postinstall `@prisma/client` hanya mencari lokasi default, tak
   menemukannya, lalu **menyerah dengan peringatan** (`We could not find your Prisma schema in the
   default locations`). Tak ada postinstall workspace yang menutupinya, jadi `pnpm install
   --frozen-lockfile` menghasilkan checkout yang test dan typecheck-nya sudah merah sejak menit
   nol — dan merahnya terbaca seperti regresi kode, bukan seperti langkah bootstrap yang hilang.

Terukur pada `da3967af`: sesudah install bersih, `cli/test/migrate-pg.test.ts` gagal **saat
collect** (`Cannot read properties of undefined (reading 'datamodel')`, vitest melaporkan
`0 test`), `pnpm --filter ./cli typecheck` exit 2, `pnpm --filter ./server typecheck` exit 2 dengan
12 error. Satu `prisma generate --schema prisma/schema.prisma` membuat semuanya hijau. Dilaporkan
sebagai issue [#1](https://github.com/denameidina/hanoman/issues/1).

## Keputusan

1. **Bootstrap Prisma Client jadi bagian dari `pnpm install`.** `postinstall` paket `server`
   menjalankan `prisma generate --schema prisma/schema.prisma` sesudah perbaikan mode
   `spawn-helper` node-pty. Skema disebut **eksplisit** — mekanisme yang gagal justru mekanisme
   "cari sendiri di lokasi default".
2. **Generate itu FATAL bila gagal**, berbeda dari paket terbit yang sengaja `|| true`
   (ADR-0087). Alasannya asimetris: di paket terbit ada jaring kedua (`ensurePrismaClient`
   memeriksa ulang saat `hanoman start`, dengan mengonstruksi `PrismaClient` — bukan `existsSync`);
   di workspace dev tak ada jaring apa pun, dan kegagalan senyap di situlah pokok masalahnya.
   Urutan di dalam script karena itu penting: `chmod` non-fatal **lebih dulu**, `prisma generate`
   **terakhir**, supaya exit code script adalah exit code generate.
3. **Satu jalur validasi bernama: `pnpm validate`** = `pnpm db:generate` → `pnpm typecheck`
   (`-r`, seluruh paket) → `pnpm test` (`vitest run --no-file-parallelism`). `db:generate` diulang
   di sini walau postinstall sudah melakukannya — postinstall **bisa dilewati**
   (`--ignore-scripts`, sebagian CI), dan jalur validasi yang mengandaikan langkah tersembunyi
   bukan jalur validasi. Pola dua lapis yang sama dengan ADR-0087.
4. **Workflow `validate.yml` dengan tiga pemicu: `pull_request`, `push: main`, dan
   `workflow_call`.** Ia menjalankan `pnpm validate`, tak lebih — supaya CI menempuh **persis**
   jalur yang ditempuh manusia di local.
5. **`release.yml` memanggil `validate.yml`, bukan menyalin langkahnya**, dan job `publish`
   ber-`needs: validate`. Menyalin akan menghasilkan dua definisi yang menyimpang tanpa ada yang
   merah — kelas kegagalan yang sama dengan yang ADR ini perbaiki.
6. **Gerbangnya dipagari test**, bukan konvensi: `cli/test/release-gate.test.ts` membaca
   `.github/workflows/*.yml` dan kedua `package.json`, lalu menuntut postinstall men-generate
   client, `validate` memanggil typecheck **dan** test, suite root tetap `--no-file-parallelism`,
   `release.yml` memanggil `validate.yml`, `publish` ber-`needs: validate`, dan `npm publish`
   tetap muncul tepat sekali. Berkas konfigurasi rusak **tanpa suara** — sebuah langkah yang
   terhapus tak menggagalkan apa pun, ia hanya membuat publish lewat begitu saja. Pola yang sama
   dengan `RUNTIME_DEPS`/`REQUIRED_ARTIFACTS` (ADR-0087) dan naskah agen (SPEC-489).
7. **Prasyarat DMMF jadi assertion bernama.** `cli/test/migrate-pg.test.ts` membaca
   `Prisma.dmmf?.datamodel?.models ?? []` alih-alih meledak saat collect, dengan satu test yang
   namanya menyebut perbaikannya (`pnpm db:generate`). Sebelum ini kegagalannya melaporkan
   `no tests` — dan `--changed` menyalakan `passWithNoTests` (ADR-0080), jadi berkas yang gagal
   collect punya **dua** cara terlihat hijau.

## Konsekuensi

- **Rilis kini bisa diblokir CI.** Itu maksudnya, dan harganya nyata: suite yang gagal karena
  lingkungan runner menahan publish. Mitigasinya dipasang di `validate.yml` sebagai langkah
  eksplisit — `tmux` (dituntut test sesi terminal, ADR-0016), identitas git (dituntut test
  worktree), `HANOMAN_HOME` diarahkan ke dalam workspace runner (berkas DB test diturunkan dari
  `HANOMAN_HOME`, bukan dari checkout — SPEC-479), dan `HANOMAN_UPDATE_FETCH=0` supaya validasi
  tak pernah bergantung pada jaringan. Urutan pemicunya sendiri adalah mitigasi: `pull_request` dan
  `push: main` menjalankan definisi yang **sama** jauh sebelum tag pertama didorong, jadi kegagalan
  lingkungan runner muncul di PR — bukan pertama kali pada sebuah rilis.
- **Waktu CI naik** dari ±3 menit jadi suite serial penuh. Serial tak bisa ditawar: set yang sama
  memberi **181 gagal palsu paralel vs 736 lulus serial** (SPEC-397/ADR-0080), jadi menukarnya
  dengan kecepatan berarti menukar gerbang ini dengan gerbang yang orang matikan.
- **`pnpm -r typecheck` sah di CI, tetap terlarang sebagai rutinitas sesi.** ADR-0080 **tidak**
  dicabut: larangannya adalah tentang mesin dev yang menjalankan beberapa sesi sekaligus, bukan
  tentang runner yang memang berdiri sendiri.
- **`pnpm install` jadi sedikit lebih lambat** (±180 ms untuk generate) dan **gagal keras** bila
  skema rusak. Keduanya diterima: skema rusak yang lolos install adalah skema rusak yang muncul
  lagi sebagai belasan error tsc tanpa penyebab yang terbaca.
- Prosedur deploy VPS ([rd](../requirements/rd.md), [deploy-vps](../operations/deploy-vps.md))
  tetap menyebut `prisma generate` eksplisit. Kini redundan, sengaja dibiarkan: deploy berjalan di
  mesin yang bisa saja memasang dengan `--ignore-scripts`.

## Alternatif yang ditolak

- **Menyalin langkah validasi ke `release.yml`.** Ditolak: dua definisi menyimpang diam-diam, dan
  yang menyimpang selalu yang jarang dijalankan (rilis).
- **Job publish `needs:` hasil workflow lain lewat status check commit.** Tak bisa: `needs:`
  hanya lintas job dalam satu run, dan status check dari run `push: main` bukan run yang sama
  dengan run tag. `workflow_call` adalah satu-satunya cara memakai definisi yang sama pada commit
  yang sama.
- **Hanya menjalankan test CLI + typecheck (batas minimum acceptance criteria issue).** Ditolak:
  test server adalah permukaan terbesar repo ini, dan gerbang yang melewatkannya membiarkan celah
  yang sama setengah terbuka.
- **`prisma generate` sebagai langkah CI saja, tanpa postinstall.** Ditolak: itu memperbaiki CI
  dan meninggalkan checkout bersih tetap merah — persis separuh masalah yang dilaporkan.
- **Root `postinstall` alih-alih `server`.** Ditolak: skema milik paket `server`, dan postinstall
  paket workspace sudah terbukti berjalan pada `pnpm install` (yang memperbaiki `spawn-helper`).
