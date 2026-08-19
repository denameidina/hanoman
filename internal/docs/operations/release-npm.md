# Merilis paket npm `hanoman`

Menerbitkan versi baru `hanoman` ke registry npm publik. Mekanismenya **trusted publishing (OIDC)**
lewat `.github/workflows/release.yml` — tak ada token penerbit yang pernah tersimpan di mesin mana
pun. Keputusan & alasannya: [ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md),
termasuk amandemen 2026-07-30 yang memindahkan publish dari tangan manusia ke CI.

## Sekali di awal (urutannya mengikat)

Dua mekanisme non-interaktif npm sama-sama mengandaikan paketnya **sudah ada**: GAT hanya bisa
di-scope ke paket yang sudah terbit, dan trusted publisher dikonfigurasi **per paket** di halaman
setelan paket. Jadi versi pertama tak bisa diotomasi.

1. ~~**Terbitkan `0.1.0` sekali secara berautentikasi**~~ — **SUDAH DILAKUKAN 2026-07-30.**
   `hanoman@0.1.0` terbit dari `build-info.sha` `6d1867f`. Publish memerlukan salah satu dari:
   ```sh
   npm profile enable-2fa auth-only   # OTP hanya untuk login/setelan akun, BUKAN untuk publish
   # ATAU: Granular Access Token ber-"bypass 2FA" (kredensial di disk — lihat ADR-0087)
   npm whoami                         # harus membalas nama akun sebelum publish
   pnpm release && cd dist-npm && npm publish --access public
   ```
   `npm publish` **ditolak 403** bila 2FA akun `disabled` **dan** tak ada GAT ber-bypass — npm
   menuntut salah satunya. Cek modenya dengan `npm profile get` (baris `two-factor auth`).
2. ~~**Daftarkan trusted publisher**~~ — **SUDAH: terbukti jalan sejak `v0.1.6`, dikonfirmasi lagi
   `v0.1.7` (run `30633124072`, publish OIDC hijau tanpa sentuhan manual).** Sebelum itu ia belum
   terdaftar, dan itulah yang membuat
   tag `v0.1.3` gagal publish (lihat "Kalau publish gagal"); `0.1.3` akhirnya terbit **manual**
   dari mesin dev, jadi tag `v0.1.3` tetap merah. Terulang persis pada `v0.1.5`
   (run `30597896875`, `E404 PUT` sesudah provenance ditandatangani) — `0.1.5` juga terbit manual.
   Kalau konfigurasi ini hilang/berubah, **setiap** tag akan merah lagi dan rilis balik manual. Butuh akun ber-2FA: GAT bypass-2FA ditolak
   `npm trust` bahkan untuk **membaca** konfigurasinya (`403 GET /-/package/hanoman/trust`) — npm
   sengaja tak mengizinkan kredensial statis memasang penggantinya sendiri. Login dulu
   (`npm login`) lalu:
   ```sh
   npx npm@11.15.0 trust github hanoman --repo denameidina/hanoman \
     --file release.yml --env release --allow-publish
   ```
   `npm trust` baru ada di npm ≥ 11.15.0 (`npx` menghindari upgrade npm global). Alternatif web:
   npmjs.com → paket `hanoman` → Settings → *Trusted publishing* → GitHub Actions dengan nilai yang
   sama. Registry hanya menerima **satu** konfigurasi per paket.
3. **Gerbang manusianya — DICABUT 2026-07-31 atas keputusan pemilik repo.** Sempat terpasang
   2026-07-30 (`required_reviewers` = `denameidina`), lalu dilepas supaya rilis jalan tanpa henti:
   sejak `0.1.7`, **mendorong tag `v*` = menerbitkan ke npm, titik**. Artinya siapa pun yang bisa
   mendorong tag ke repo ini — **termasuk sesi agen** — bisa menerbitkan rilis. Hanya ketiga pagar
   mekanis di tabel bawah yang tersisa. Environment `release` **tetap ada dan tetap dirujuk
   workflow**: ia bagian dari identitas OIDC yang didaftarkan langkah 2 (`--env release`), bukan
   pagar. Memasangnya kembali:
   ```sh
   echo '{"wait_timer":0,"reviewers":[{"type":"User","id":20722334}]}' \
     | gh api -X PUT repos/denameidina/hanoman/environments/release --input -
   ```

## Tiap rilis

```sh
# 1. Bump versi — SATU sumber, di root package.json
npm version 0.2.0 --no-git-tag-version    # atau sunting "version" langsung
# 2. Commit + merge ke main lewat alur biasa
# 3. Dorong tag yang COCOK dengan versi itu — dari commit yang SUDAH ada di main
git tag v0.2.0 && git push origin v0.2.0
```

Langkah 2 **ditegakkan mesin sejak SPEC-851**, bukan lagi konvensi: tag pada commit yang belum
masuk `main` menggagalkan run sebelum toolchain, install, build, dan OIDC. Kalau tag terlanjur
didorong dari branch yang belum merge, urutannya merge dulu, lalu tag **nomor versi berikutnya**
dari commit yang sudah ada di `main` — jangan memindahkan tag yang sama.

Workflow lalu menjalankan **dua job**: `validate` (`.github/workflows/validate.yml` lewat
`workflow_call`) → `publish` yang ber-`needs: validate`. Job `publish` memeriksa commit ada di
`main` → tag == `version` → `pnpm install --frozen-lockfile` → `pnpm release` → **memasang
tarball hasil rakitan dan menjalankan `hanoman --version`** → `npm publish --provenance`.

Job `validate` menjalankan **`pnpm validate`** = `pnpm db:generate` → `pnpm typecheck` (seluruh
paket) → `pnpm test` (`vitest run --no-file-parallelism`) — perintah yang sama persis dengan yang
dijalankan manusia di local ([ADR-0128](../adr/0128-gerbang-validasi-sebelum-publish.md)). Sampai
2026-08-19 gerbang ini **tak ada sama sekali**: jalur rilis tak pernah memanggil `vitest` maupun
`tsc`, dan karena server & CLI dibundel esbuild (yang tak melakukan type checking), build hijau
bukan pernyataan apa pun tentang kesehatan kode yang diterbitkan. Bukti & reproduksinya di
[issue #1](https://github.com/denameidina/hanoman/issues/1).

Versi hidup di root `package.json` dan ditanam ke `dist/build-info.json` oleh
`scripts/stamp-build.mjs`. **Jangan** menyunting `dist-npm/package.json` — ia di-*generate*
`packageJsonFor()` setiap pack.

## Pagar yang tak bergantung penilaian siapa pun

| Pagar | Kegagalan yang dicegah |
|---|---|
| Job `publish` ber-`needs: validate` | menerbitkan commit yang test/typecheck-nya merah |
| Trigger hanya tag `v*` | publish tak sengaja dari push biasa ke main |
| Commit tag wajib ancestor `origin/main` | menerbitkan kode yang tak pernah direview/merge (SPEC-851) |
| Tag harus == `version` root | menerbitkan nomor versi salah — dan nomor terbit **tak bisa dipakai ulang** |
| Tarball dipasang & `hanoman --version` diuji | menerbitkan paket yang tak bisa dijalankan |
| `repository.url` dijaga `cli/test/pack.test.ts` | publish ditolak OIDC/provenance karena URL tak cocok |
| ~~Environment `release` + reviewer~~ | ~~rilis tanpa persetujuan manusia~~ — **dicabut 2026-07-31**, tak ada lagi gerbang manusia |

`hanoman doctor` **tidak** dipakai di CI: ia menuntut `git`, `tmux`, dan CLI agen yang memang tak
ada di runner, jadi ia akan exit 1 karena alasan yang tak relevan dengan kesehatan paket. Job
`validate` **memang** memasang `tmux` dan mengisi identitas git — bukan untuk `doctor`, melainkan
karena test sesi terminal men-spawn pane tmux sungguhan ([ADR-0016](../adr/0016-sesi-terminal-hidup-di-tmux.md)) dan
test worktree menjalankan `git commit`.

## Kalau publish gagal

- **`commit … BELUM masuk 'origin/main'`** (SPEC-851) — tagnya lahir dari commit yang belum merge.
  Bukan bug workflow. Merge dulu, lalu tag nomor berikutnya dari commit yang sudah di `main`.
- **`riwayat git masih dangkal (shallow)`** — `fetch-depth: 0` hilang dari `actions/checkout` di
  `release.yml`. Gerbangnya sengaja **fail closed** di sini: di repo dangkal `merge-base` menolak
  commit yang sebenarnya ADA di `main`, jadi menjawab dari riwayat terpotong berarti memblokir
  rilis sah sambil menuduh commit yang benar. Kembalikan `fetch-depth: 0`; dijaga
  `cli/test/release-ancestry.test.ts`.
- **`ref rilis 'origin/main' tak ada di clone ini`** — langkah `git fetch --no-tags origin
  +refs/heads/main:refs/remotes/origin/main` hilang. `actions/checkout` pada push bertag hanya
  mengambil refspec tag itu; `origin/main` tak pernah lahir sendiri, bahkan dengan `fetch-depth: 0`.
- **Job `validate` merah** — publish tak pernah berjalan, dan itu maksudnya. Reproduksi di local
  dengan perintah yang sama: `pnpm install --frozen-lockfile && pnpm validate`. Kalau merahnya
  ramai dengan `Property 'dmmf' does not exist` atau `Cannot read properties of undefined (reading
  'datamodel')`, itu Prisma Client yang belum di-generate — `pnpm db:generate`, bukan regresi kode.
- **`repository.url` tak cocok** — trusted publishing & `--provenance` membandingkannya dengan repo
  pembangun **persis**. Nilainya `REPO_URL` di `cli/src/release/pack.ts`; bandingkan dengan
  `git remote get-url origin` (bentuknya `git+<url>`).
- **OIDC ditolak** — periksa `permissions: id-token: write` masih ada, dan nama berkas workflow di
  setelan trusted publisher npm cocok (`release.yml`, bukan path lengkap).
- **npm runner terlalu tua** — workflow menjalankan `npm i -g npm@latest` lebih dulu justru untuk
  ini; trusted publishing menuntut npm yang cukup baru.
- **Versi sudah terbit** — npm menolak menimpa. Bump ke versi berikutnya; jangan mencoba
  `--force`. Unpublish hanya mungkin dalam 72 jam dan **tetap** memblokir nama+versi itu selamanya.
- **`ENEEDAUTH — This command requires you to be logged in`** padahal token baru saja dipasang:
  baris di `~/.npmrc` **wajib** berawalan `//` → `//registry.npmjs.org/:_authToken=…`. Tanpa `//`
  npm tak mengenalinya sebagai kredensial registry, dan pesannya terbaca seperti "token
  salah/kedaluwarsa" padahal tokennya sehat. Periksa bentuknya tanpa membocorkan nilainya:
  `sed 's/\(_authToken=\).*/\1<DISENSOR>/' ~/.npmrc`.
- **Paket terbit kehilangan dependency** (`0.1.3` terbit tanpa `prisma` → mati saat start dengan
  "`prisma generate` gagal"; sudah di-`npm deprecate`). Yang membuatnya lolos: **tarball yang
  di-smoke-test sehat, yang dikirim tidak.** `npm i -g --prefix <dir> <tarball>` yang dijalankan
  dengan **cwd di dalam `dist-npm/`** menulis ulang `dist-npm/package.json` — membuang `prisma`,
  menaikkan `@prisma/client`. Jadi smoke test itu sendiri yang mencemari paket, sesudah artefak
  sehat dirakit. **Smoke test tarball selalu dari cwd LAIN.** Sejak `0.1.4` ada gerbang
  `prepublishOnly` → `hanoman __verify` (`verifyPackedDeps`, dipagari test) yang membatalkan publish
  bila dependency wajib hilang — diletakkan di situ, bukan di `__pack`, karena mutasinya terjadi
  **sesudah** pack. Kalau ia menyala: jangan sunting `dist-npm/package.json`, rakit ulang
  (`pnpm release`).
- **`E404 Not Found - PUT https://registry.npmjs.org/hanoman` dari workflow** = trusted publisher
  belum/tak cocok dikonfigurasi, **bukan** paket hilang dan bukan bug paket. Saat handshake OIDC tak
  cocok, registry memperlakukan klien sebagai **anonim**, dan anonim tak boleh `PUT` → 404, bukan
  403 (npm/cli#9088). Sangat menyesatkan: seluruh langkah sebelumnya hijau, provenance bahkan sudah
  **ditandatangani dan masuk transparency log** — bukti OIDC token BERHASIL dicetak, jadi sisi
  GitHub-nya sehat dan yang kurang selalu di sisi npm. Terjadi pada `v0.1.3`, tag pertama repo ini
  (0.1.0–0.1.2 terbit manual lewat GAT, jadi jalur OIDC belum pernah teruji). Perbaikannya = langkah
  2 di atas; tag tak perlu dibuat ulang, cukup `gh run rerun <id> --failed`.
- **`404` / `npm view` gagal tepat sesudah publish sukses** — itu propagasi replika-baca registry,
  bukan publish yang gagal. Terukur ±5 detik. Tunggu, jangan publish ulang.
- **`P3005 — The database schema is not empty` saat `hanoman` boot** = berkas DB tujuan sudah punya
  tabel tanpa riwayat migrasi (terjadi nyata: `~/.hanoman/hanoman.db` sisa prototipe hanoman lama,
  tabel `runs`/`meta`, nol baris). Sejak `0.1.2` hanoman menerjemahkannya jadi petunjuk yang bisa
  dikerjakan (`migrateFailureHint`, dipagari test); isi berkas lama tak pernah diubah.
- **Terminal sesi BLANK padahal pane tmux hidup dan terisi** = `spawn-helper` node-pty terpasang
  tanpa bit exec. Bukan bug kita: tarball `node-pty@1.1.0` mengirim SEMUA `prebuilds/*/spawn-helper`
  dengan mode `0644` (`tar tvf` → `-rw-r--r--`), lalu `posix_spawnp` gagal EACCES. **pnpm memulihkan
  bit itu, npm tidak** — jadi bug ini tak pernah terlihat di `pnpm dev` dan hanya menghantam
  instalasi npm. Kegagalannya senyap total: WebSocket tersambung, pane hidup, nol byte mengalir.
  Sejak `0.1.3` diperbaiki saat start (`repairSpawnHelper`, dipagari test). Bila node-pty naik versi,
  **periksa ulang mode di tarballnya** sebelum menganggap pagar ini usang.
  **Kambuh 2026-08-14 dan diperbaiki lagi di `0.1.34`:** penawarnya dulu hanya dipanggil
  `hanoman start` (`cli/src/commands/start.ts`), sementara instalasi nyata bisa menjalankan
  **`node .../hanoman/dist/server.js` langsung** — pola yang dipakai unit launchd/systemd yang
  menunjuk bundle server. Jalur itu melewati CLI sepenuhnya, jadi setiap `npm i -g hanoman`
  mengembalikan `prebuilds/darwin-arm64/spawn-helper` ke `-rw-r--r--` dan terminal kembali hitam
  total padahal pane tmux berisi belasan KB teks dan REST-nya 200. Sejak `0.1.34` implementasinya
  hidup di `runner/src/spawn-helper.ts` dan dipasang di **`spawnPty` (`server/src/services/pty.ts`)** —
  satu-satunya tempat proses ini meng-exec node-pty, jadi tak ada jalur boot yang bisa melewatinya;
  hasilnya di-memo (`ensureSpawnHelperOnce`) supaya tetap beberapa `stat` sekali seumur proses.
  `hanoman start` tetap memanggilnya lebih awal, hanya agar operator melihat laporannya sebelum
  server lahir. **Jangan** memindahkannya kembali ke jalur perintah tertentu.
- **`npm token create` tak bisa membuat GAT di npm 11.6.2** (hanya token klasik
  `--read-only`/`--cidr`), dan `npm i -g npm@latest` menolak jalan di node `v24.11.1` (menuntut
  `^24.15.0`). Sampai node dinaikkan, GAT harus dibuat dari npmjs.com.

## Yang sengaja TIDAK dilakukan

- `pnpm release` **tak pernah** memanggil `npm publish` — tak ada jalur publish dari mesin dev
  (ADR-0087).
- Tak ada Granular Access Token ber-bypass-2FA di mesin mana pun: ia adalah kredensial penerbit di
  berkas yang bisa dibaca proses apa pun di mesin itu, termasuk sesi agen.
- Tak ada publish dari branch — hanya dari tag.

## Mencabut `hanoman-sdk` dari npm (SPEC-384 · [ADR-0092](../adr/0092-cabut-error-monitoring-sdk-cross-audit.md))

Paket `hanoman-sdk` dicabut bersama error monitoring. Menghapus `sdk/` dari repo **tidak**
mencabutnya dari registry — selama masih terbit, siapa pun bisa `npm i hanoman-sdk` dan mendapat SDK
yang tak punya server tujuan. Ini **tindakan manusia** (akun ber-2FA butuh `--otp`), bukan bagian
dari sesi agen:

```bash
# 1. Coba unpublish. npm hanya mengizinkannya dalam 72 jam sejak publish; `hanoman-sdk@0.1.0`
#    terbit 2026-07-21, jadi ini kemungkinan besar DITOLAK. Jalankan tetap — kalau berhasil, selesai.
npm unpublish hanoman-sdk --force --otp=<kode>

# 2. Ditolak karena lewat jendela → deprecate. Inilah jalur yang sebenarnya diharapkan.
npm deprecate hanoman-sdk \
  "Dicabut (SPEC-384). Pemantauan error hanoman pindah ke Uptrace; paket ini tak punya server tujuan lagi." \
  --otp=<kode>
```

Verifikasi: `npm view hanoman-sdk` — field `deprecated` terisi, atau paket 404 bila unpublish berhasil.

> Ini **tidak** menyentuh paket `hanoman` itu sendiri, yang tetap terbit dan didukung.
