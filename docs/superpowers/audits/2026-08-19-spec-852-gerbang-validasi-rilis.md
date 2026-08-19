# Audit SPEC-852 — CI dapat publish saat test/typecheck merah & Prisma Client belum di-generate

Sumber: GitHub issue [denameidina/hanoman#1](https://github.com/denameidina/hanoman/issues/1)
(pelapor @RamaAditya49) · severity major · 2026-08-19
Doc-of-record: audit ini + [ADR-0126](../../../internal/docs/adr/0126-gerbang-validasi-sebelum-publish.md)
(Spec & Plan sengaja `skipped` — akar masalah tunggal, remedinya sudah diresepkan acceptance
criteria issue-nya sendiri).

## Ringkasan

Dua celah **independen** bertemu di satu titik: paket `hanoman` bisa terbit ke npm dari commit yang
test dan kontrak TypeScript-nya merah.

1. **Bootstrap.** `pnpm install --frozen-lockfile` di checkout bersih **tidak** menghasilkan Prisma
   Client. Skema hanoman ada di `server/prisma/schema.prisma`; postinstall `@prisma/client` hanya
   mencari lokasi default, tak menemukannya, lalu menyerah dengan peringatan. Tak ada satu pun
   postinstall workspace yang menutupi itu.
2. **Gerbang.** Repo tak punya workflow validasi sama sekali — `.github/workflows/` berisi tepat
   satu berkas, `release.yml`, dan jalurnya `install → pnpm release → smoke --version → publish`.
   Tak ada `prisma generate`, tak ada vitest, tak ada tsc di mana pun.

Keduanya saling menyembunyikan: karena build server & CLI memakai **esbuild** (`--external:@prisma/client`),
build tetap hijau tanpa Prisma Client dan tanpa typecheck — jadi "release hijau" bukan bukti apa pun
tentang kesehatan kode yang diterbitkan.

## Bukti terukur (worktree `spec-852`, base `da3967af`, 2026-08-19)

Checkout bersih, `node_modules` belum ada:

```
$ pnpm install --frozen-lockfile
…
.../node_modules/@prisma/client postinstall: prisma:warn We could not find your Prisma schema
  in the default locations (see: https://pris.ly/d/prisma-schema-location).
  If you have a Prisma schema file in a custom path, you will need to run
  `prisma generate --schema=./path/to/your/schema.prisma` to generate Prisma Client.
server postinstall$ chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true
Done in 6.6s
exit=0
```

Peringatan itu adalah akar masalahnya, tercetak oleh Prisma sendiri. Akibat langsungnya:

```
$ pnpm --filter ./cli exec vitest run test/migrate-pg.test.ts
FAIL test/migrate-pg.test.ts
TypeError: Cannot read properties of undefined (reading 'datamodel')
 ❯ test/migrate-pg.test.ts:7:28   const models = Prisma.dmmf.datamodel.models;
Test Files 1 failed (1) · Tests no tests

$ pnpm --filter ./cli typecheck
test/migrate-pg.test.ts(7,23): error TS2339: Property 'dmmf' does not exist on type 'typeof Prisma'.
Exit status 2

$ pnpm --filter ./server typecheck
test/webhook-catalog-dmmf.test.ts(6,31): error TS2339: Property 'dmmf' does not exist on type 'typeof Prisma'.
… (12 error, semua turunan client yang belum di-generate)
Exit status 2
```

Sesudah satu perintah bootstrap, semuanya hijau — membuktikan tak ada regresi kode di baliknya:

```
$ pnpm --filter ./server exec prisma generate --schema prisma/schema.prisma
✔ Generated Prisma Client (v6.19.3)
$ pnpm --filter ./cli exec vitest run test/migrate-pg.test.ts
✓ test/migrate-pg.test.ts (21 tests) · Test Files 1 passed (1)
```

Sisi gerbangnya dibaca langsung dari berkas, bukan disimpulkan:

- `.github/workflows/release.yml` — satu-satunya workflow di repo. Langkahnya: cek tag == versi →
  `pnpm install --frozen-lockfile` → `pnpm release` → pasang tarball & `hanoman --version` →
  `npm publish --provenance`.
- `package.json` — `release` = `build && build:cli && __pack && npm pack --dry-run`. Tak satu pun
  memanggil `tsc` atau `vitest`; `test` & `typecheck` adalah script terpisah yang tak pernah
  dipanggil CI.
- `server/package.json` — `postinstall` hanya `chmod +x` untuk `spawn-helper` node-pty (ADR-0087).
- `cli/test/migrate-pg.test.ts:7` & `server/test/webhook-catalog-dmmf.test.ts:6` membaca
  `Prisma.dmmf`, jadi client hasil generate memang prasyarat test — bukan kenyamanan.

## Kenapa gejalanya "senyap"

`Prisma.dmmf` undefined menggagalkan berkas test **saat collect**, sehingga vitest melaporkan
`0 test` / `no tests`. Digabung dengan `--changed` yang menyalakan `passWithNoTests` (AGENTS.md),
kelas kegagalan ini punya dua cara terlihat hijau sekaligus. Pesannya sendiri
(`Cannot read properties of undefined (reading 'datamodel')`) tak menyebut Prisma, tak menyebut
`prisma generate`, dan terbaca seperti bug di kode migrator.

## Keputusan pasca-audit

**Spec & Plan dilewati.** Akar masalahnya tunggal dan terbukti dengan reproduksi dua arah
(merah tanpa generate, hijau sesudahnya); bentuk perbaikannya sudah ditetapkan acceptance criteria
issue-nya sendiri; tak ada percabangan pada data model, kontrak API, atau scope. Yang berubah adalah
konfigurasi build/CI, satu baris postinstall, dan pagar test — bukan perilaku produk.

## Perbaikan yang dikerjakan

| # | AC issue | Perbaikan |
|---|---|---|
| 1 | Bootstrap mekanis dari checkout bersih | `server` postinstall menjalankan `prisma generate --schema prisma/schema.prisma` (fatal, bukan `\|\| true`) + script root `db:generate` sebagai jalan keluar eksplisit |
| 2 | CI menjalankan CLI tests + CLI typecheck + server typecheck sebelum pack/publish | `.github/workflows/validate.yml` (`pull_request`, `push:main`, `workflow_call`) menjalankan `pnpm validate` = `pnpm -r typecheck` + `pnpm test` |
| 3 | Test server di CI memakai `--no-file-parallelism` | root `test` sudah `vitest run --no-file-parallelism`; dipagari test agar tak bisa dilepas diam-diam |
| 4 | Kegagalan menghentikan workflow sebelum `npm publish` | `release.yml` memanggil `validate.yml` lewat `workflow_call` dan job `publish` ber-`needs: validate` |
| 5 | Regresi yang membuktikan `Prisma.dmmf.datamodel.models` tersedia | assertion bernama di `cli/test/migrate-pg.test.ts` + `cli/test/release-gate.test.ts` yang membaca berkas workflow & manifest |

## Risiko & trade-off yang diterima sadar

- **Rilis kini bisa diblokir CI.** Itu memang maksudnya, tapi konsekuensinya nyata: suite yang gagal
  karena lingkungan runner (bukan regresi) menahan publish. Mitigasinya di `validate.yml` —
  `tmux` dipasang eksplisit, identitas git diisi, `HANOMAN_HOME` diarahkan ke direktori runner —
  supaya kegagalan lingkungan jadi kegagalan yang bisa dibaca, bukan misteri.
- **Waktu CI naik** dari ±3 menit jadi suite serial penuh. Serial itu wajib (ADR-0080/SPEC-397:
  set yang sama memberi 181 gagal palsu paralel vs 736 lulus serial), jadi ini harga yang tak bisa
  ditawar tanpa membuang keandalannya.
- **`postinstall` server jadi fatal** bila `prisma generate` gagal. Berbeda dari paket terbit, yang
  sengaja `|| true` karena `ensurePrismaClient` memeriksa ulang saat start (ADR-0087). Di workspace
  dev tak ada jaring itu, dan justru kegagalan senyap yang jadi pokok issue ini.

## Verifikasi yang dijalankan

Semua dari worktree `spec-852`, scope perubahan (bukan suite penuh — itu tugas manusia sebelum
merge, dan sejak spec ini juga tugas CI):

- **AC#1, checkout bersih.** Salinan worktree tanpa `node_modules`/`.git` → `pnpm install
  --frozen-lockfile` → log memperlihatkan `server postinstall: ✔ Generated Prisma Client (v6.19.3)`.
  Tanpa satu pun langkah manual.
- **AC#5, siklus merah–hijau nyata.** Keadaan rusak direproduksi dengan menimpa
  `.prisma/client/index.js` dengan stub yang Prisma sendiri pasang saat generate dilewati
  (`Prisma.dmmf === undefined`, keadaan yang sama persis dengan sesudah install bersih di
  `da3967af`). Hasilnya: `× prasyarat Prisma Client > DMMF ter-generate — jalankan `pnpm db:generate`
  bila kosong` + 20 test lain **tetap berjalan** — sebelumnya nol test berjalan dan vitest melaporkan
  `no tests`. Sesudah `pnpm db:generate`: 22/22 lulus.
- **Pagar gerbang.** `cli/test/release-gate.test.ts` merah lebih dulu (`ENOENT … validate.yml`),
  hijau sesudah implementasi: 10/10.
- **Test scope perubahan.** `TEST_DATABASE_URL=… pnpm vitest --run --changed "$HANOMAN_BASE_SHA"
  --no-file-parallelism` → **2 berkas, 32 test lulus** (bukan "no test files").
- **Typecheck.** Kelima paket, dijalankan **berurutan** (bukan `-r`, yang menyalakan lima tsc
  sekaligus di mesin bersama): `shared` `runner` `src` `cli` `server` semuanya exit 0 — jadi langkah
  `pnpm typecheck` di CI hijau pada commit ini, bukan merah sejak hari pertama.
- **Kedua workflow parse sebagai YAML sah** (js-yaml), dan wiring-nya terbaca dari hasil parse:
  `jobs = [validate, publish]`, `validate.uses = ./.github/workflows/validate.yml`,
  `publish.needs = validate`, `publish.environment = release`, `permissions` OIDC utuh.
- **Integritas index SoT.** `hanoman docs index --check` → `index ok`.

**Yang TIDAK diverifikasi dari sesi ini, dan tak bisa:** suite penuh pada runner ubuntu GitHub.
Mitigasinya struktural, bukan harapan — `validate.yml` berjalan pada `pull_request` dan `push: main`
dengan definisi yang sama, jadi kegagalan lingkungan runner muncul di PR pertama, bukan pertama kali
pada sebuah rilis.
