# ADR-0087 — Distribusi hanoman sebagai paket npm global: satu perintah `hanoman`, update dari registry

- Status: Accepted
- Tanggal: 2026-07-30
- SPEC: SPEC-398 (hanoman production level lewat `npm i -g hanoman`)
- Terkait: **bergantung pada [0086](0086-sqlite-satu-satunya-provider.md)** (paket npm tak bisa
  membawa Postgres); **mengubah mekanisme [0048](0048-auto-update-deteksi-read-only.md) tanpa
  membalik keputusannya** — deteksi update pindah dari `git fetch` ke registry npm dan tetap
  **read-only**; memakai pola paket publik **0063** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md)); **tidak
  menyentuh** [0016](0016-sesi-terminal-hidup-di-tmux.md) (sesi tetap di tmux),
  [0028](0028-auth-sesi-opaque-di-db.md) (bind `127.0.0.1` + proxy TLS), maupun
  [0037](0037-cabut-guardrail-safety.md).

> ## Amandemen 2026-07-30 — publish pindah ke CI lewat trusted publishing (OIDC)
>
> Butir 6 di bawah berbunyi "**`npm publish` tetap tindakan manusia** — tak ada script yang
> memanggilnya". Butir itu **diamandemen, bukan dicabut**: publish kini dijalankan
> `.github/workflows/release.yml` saat tag `v*` didorong, memakai **trusted publishing** npm
> (OIDC) sehingga tak ada kredensial penerbit yang pernah ada di mesin mana pun.
>
> **Kenapa CI, bukan token di mesin dev.** Satu-satunya cara lain untuk publish non-interaktif
> adalah Granular Access Token ber-"bypass 2FA" (`npm publish` tanpa itu tetap meminta OTP). Token
> semacam itu hidup di `~/.npmrc` — berkas yang **bisa dibaca proses mana pun di mesin itu,
> termasuk sesi agen**, dan yang bisa menerbitkan paket apa pun milik akun itu. Docs npm sendiri
> menyarankan menghapus GAT-bypass dan pindah ke trust relationship. OIDC tak menyimpan rahasia:
> npm memverifikasi bahwa yang meminta publish memang workflow itu di repo itu.
>
> **Di mana gerbang manusianya sekarang, dengan jujur.** Ia pindah dari "manusia mengetik
> `npm publish`" menjadi "manusia mendorong tag `v*`". Itu **bukan** jaminan yang sama kuat: agen
> yang punya akses push juga bisa membuat tag. Yang benar-benar menggerbangi adalah
> **GitHub Environment `release`** yang dirujuk workflow itu — beri ia *Required reviewers* dan
> publish menunggu persetujuan manusia. Tanpa reviewer, environment itu tak memagari apa pun, dan
> ADR ini tak berpura-pura sebaliknya.
>
> **Amandemen 2026-07-31 — *Required reviewers* DICABUT (keputusan pemilik repo).** Sejak rilis
> `0.1.7`, environment `release` tak lagi punya reviewer: mendorong tag `v*` langsung menerbitkan ke
> npm tanpa henti. Konsekuensinya persis seperti yang ditulis paragraf di atas — **siapa pun yang
> bisa mendorong tag ke repo ini, termasuk sesi agen, bisa menerbitkan rilis**. Yang tersisa hanya
> ketiga pagar mekanis di bawah; tak ada lagi gerbang manusia di jalur publish. Alasannya kecepatan
> rilis, bukan penilaian ulang atas risikonya. Environment `release` itu sendiri **tetap ada dan
> tetap dirujuk workflow** — bukan karena memagari, tapi karena trusted publisher npm dikonfigurasi
> dengan `--env release`; melepasnya dari workflow akan mengembalikan `E404 PUT` yang menghantam
> `v0.1.3`/`v0.1.5`. Memulihkan gerbangnya = pasang kembali *Required reviewers*
> (`gh api -X PUT repos/denameidina/hanoman/environments/release`).
>
> **Pagar yang tak bergantung penilaian siapa pun:** (a) workflow hanya menembak pada tag
> `v*`; (b) tag yang tak cocok dengan `version` di root `package.json` **menggagalkan** run sebelum
> menyentuh registry — nomor versi yang salah terbit tak bisa dipakai ulang; (c) tarball hasil
> rakitan **dipasang dan dijalankan** (`hanoman --version` harus sama dengan versi tag) sebelum
> publish; (d) **sejak SPEC-851**, commit yang ditag wajib sudah menjadi ancestor `origin/main`.
> `hanoman doctor` sengaja tak dipakai di CI: ia menuntut tmux & CLI agen yang memang tak
> ada di runner, jadi ia akan gagal karena alasan yang tak relevan.
>
> **Amandemen 2026-08-19 (SPEC-851) — pagar keempat: asal-usul commit.** Ketiga pagar di atas
> semuanya menilai *artefaknya* (nomor versinya benar, ia bisa dijalankan); tak satu pun menilai
> dari mana kodenya datang. Sesudah *Required reviewers* dicabut, itu berarti tag pada branch
> eksperimen mana pun bisa menerbitkan paket yang isinya tak pernah masuk `main` — dan diverifikasi
> hidup bahwa memang tak ada pagar lain yang menahannya (`rulesets: []`, `protection_rules: []`,
> `deployment_branch_policy: null`). Workflow kini memanggil `scripts/assert-release-ancestry.sh`
> tepat sesudah checkout, sebelum toolchain/install/build/OIDC. **Ini bukan pengganti gerbang
> manusia** — ia menjawab pertanyaan lain ("kode ini sudah masuk branch rilis?"), bukan "manusia
> menyetujui rilis ini?"; keputusan 2026-07-31 tetap berdiri. Dua gotcha yang membuatnya bekerja:
> `actions/checkout` butuh `fetch-depth: 0` karena di repo dangkal `merge-base` menolak commit yang
> sebenarnya ADA di `main` (skripnya karena itu **fail closed** pada repo dangkal, dengan alasan
> "riwayat kurang" alih-alih menuduh commitnya), dan `origin/main` tetap harus di-fetch sendiri —
> checkout pada push bertag hanya mengambil refspec tag itu.
>
> **Konsekuensi berantai yang wajib:** `packageJsonFor()` sekarang menyertakan
> `repository.url`. Trusted publishing **dan** `--provenance` membandingkan nilai itu dengan repo
> pembangun **persis**; tanpa ia, publish dari workflow ditolak. Kegagalannya hanya muncul di CI,
> jauh dari tempat nilainya ditulis, jadi ia dipagari test di `cli/test/pack.test.ts`.
>
> **Urutan yang tak bisa dibalik:** trusted publisher dikonfigurasi **per paket** di npmjs.com,
> dan GAT hanya bisa di-scope ke paket yang **sudah ada**. Karena itu `0.1.0` tetap harus
> diterbitkan sekali secara berautentikasi; baru sesudah nama terklaim, workflow ini bisa
> dipercaya. Runbook: [operations/release-npm](../operations/release-npm.md).
>
> ### Keadaan nyata 2026-07-30: `0.1.0` terbit lewat GAT ber-bypass-2FA
>
> `hanoman@0.1.0` **sudah terbit** (26 berkas, 1,1 MB, `build-info.sha` `6d1867f`), diverifikasi
> lewat install bersih dari registry → `hanoman --version` `0.1.0` → `doctor` 7/7 → boot penuh
> (`/api/health` ok, dashboard + bundle HTTP 200, migrasi diterapkan otomatis).
>
> Jalannya **bukan** yang direkomendasikan ADR ini, dan itu dicatat apa adanya: 2FA akun dalam
> keadaan `disabled`, sementara npm menuntut "2FA enabled **atau** GAT ber-bypass-2FA" untuk
> publish — jadi publish interaktif pun ditolak `403`. Operator memilih sadar untuk **membuat GAT
> ber-bypass-2FA permanen di mesin dev**, sesudah paparannya disampaikan: token itu bisa
> menerbitkan **paket apa pun** milik akun itu, dan ia hidup di `~/.npmrc` — terbaca proses apa pun
> di mesin yang **juga menjalankan sesi agen**. Alternatif yang ditolak: `npm profile enable-2fa
> auth-only`, yang memberi hasil praktis sama (publish tanpa OTP, karena `auth-only` hanya menuntut
> OTP untuk login & perubahan setelan akun) **tanpa** kredensial penerbit di disk.
>
> Konsekuensinya: paparan itu **masih terbuka** sampai dua langkah ini dikerjakan — (a) daftarkan
> trusted publisher supaya rilis berikutnya lewat OIDC tanpa token, (b) rotasi token ini ke yang
> ber-scope hanya paket `hanoman` (kini mungkin, karena paketnya sudah ada). Sampai itu terjadi,
> anggap kredensial penerbit npm sebagai **ter-ekspos ke setiap sesi agen di mesin itu**.
>
> **Gotcha yang memakan waktu dan tak berbunyi seperti penyebabnya:** baris token di `~/.npmrc`
> **wajib** berawalan `//` (`//registry.npmjs.org/:_authToken=…`). Tanpa `//`, npm tak mengenalinya
> sebagai kredensial registry dan membalas `ENEEDAUTH — This command requires you to be logged in`,
> yang terbaca seperti "token salah/kedaluwarsa" padahal tokennya sehat. Juga: `npm token create`
> di npm **11.6.2 tak bisa** membuat GAT (hanya token klasik `--read-only`/`--cidr`), dan
> `npm i -g npm@latest` menolak jalan di node `v24.11.1` karena menuntut `^24.15.0` — jadi GAT harus
> dibuat dari web sampai node dinaikkan.

## Konteks

Sampai SPEC-398, satu-satunya cara menjalankan hanoman adalah checkout git: `pnpm install` →
`docker compose up` → `prisma migrate deploy` → `pnpm build` → `node server/dist/server.js`. Enam
langkah, satu di antaranya menuntut Docker (dicabut ADR-0086), dan semuanya menganggap ada working
tree. Konsekuensi yang lebih dalam dari sekadar ketidaknyamanan: **identitas versi = SHA git** dan
**"instance" = working tree**, sehingga update berarti `git pull && pnpm build && pnpm prod`
(`PULL_CMD` di `services/update.ts`, SPEC-214).

Objective SPEC-398: `npm i -g hanoman` → `hanoman` → jalan; dan update yang mudah.

## Keputusan

**hanoman diterbitkan sebagai paket npm global bernama `hanoman`. `hanoman` tanpa argumen
menjalankan hanoman. Update adalah perintah CLI, bukan tombol di dashboard.**

1. **`hanoman` telanjang = `hanoman start`** (dulu mencetak help; help pindah ke `--help`), yang
   melakukan tiga hal: resolve home & DB (ADR-0086) → `prisma migrate deploy` → spawn bundle server.
   Perintah lengkapnya:

   ```
   hanoman [start]                      --port --host --db --no-migrate
   hanoman doctor                       prasyarat non-npm (exit 1 bila yang wajib absen)
   hanoman update [--check]             banding versi vs registry; `npm i -g hanoman@latest`
   hanoman migrate-from-postgres --from <url> [--to <file>] [--dry-run] [--force]
   hanoman docs scan|index|link         (tidak berubah)
   ```

2. **Server hidup sebagai proses ANAK, bukan import.** `start` men-`spawn` `node dist/server.js`
   dengan `NODE_ENV=production` + env terhitung (`DATABASE_URL`, `HANOMAN_HOME`, `HANOMAN_WEB_DIR`).
   Sinyal, exit code, dan flag node-nya jadi bersih, dan sesi tmux tetap selamat dari restart
   (ADR-0016 tak tersentuh).
3. **Dua layout dikenali satu fungsi murni** `resolveLayout(distDir, exists)`: paket npm
   (`dist/`, `prisma/`, `web/` bersebelahan) dan checkout repo (`cli/dist`, `server/prisma`,
   `src/dist`). Tanpa ini, mengembangkan hanoman dari checkout dan menjalankan yang terpasang jadi
   dua kode berbeda.
4. **Aset dashboard ikut di dalam paket, di `web/`**, dipilih `pickWebDir()` dengan urutan
   `HANOMAN_WEB_DIR` → `<dist>/../web` → `<dist>/../../src/dist`. Aset absen bukan fatal: API tetap
   jalan, dashboard-nya saja yang tak ada, dan `doctor` melaporkannya sebagai peringatan.
5. **`prisma` (CLI) ikut menjadi dependency runtime**, supaya `migrate deploy` tersedia di instalasi
   global. Itu harga ±40 MB, diterima sadar sebagai ganti mengarang runner migrasi sendiri.
6. **Staging rilis terpisah: `dist-npm/`, dirakit `hanoman __pack`.** Workspace tidak dipublikasikan.
   `pnpm release` = build + pack + `npm pack --dry-run`; **`npm publish` tetap tindakan manusia** —
   tak ada script yang memanggilnya. → **Diamandemen 2026-07-30** (lihat blok di atas): publish
   dijalankan workflow rilis pada tag `v*` lewat OIDC. `pnpm release` sendiri **tetap** tak pernah
   memanggil `npm publish`, jadi tak ada jalur publish dari mesin dev.
7. **Identitas versi pindah dari SHA git ke semver**, satu sumber: `version` di root `package.json`,
   ditanam ke `dist/build-info.json` oleh `scripts/stamp-build.mjs`. `services/update.ts` membaca
   `GET <registry>/hanoman/latest` dan membandingkan dengan `compareSemver()`.
8. **`hanoman doctor` melaporkan prasyarat yang npm tak bisa bawa**: node ≥ 20, `git`, `tmux`,
   `claude`/`codex` (minimal satu), izin tulis home, dan keberadaan aset web.

### Kenapa `hanoman update` di CLI, bukan `POST /api/update/apply`

Server hanoman **adalah** yang akan ditimpa update. Endpoint yang menjalankan `npm i -g hanoman@latest`
memasang paket baru di bawah proses yang sedang mengeksekusinya, lalu harus mematikan dirinya sendiri
untuk memakainya — sementara sesi agen berjalan di tmux dan operator tak pernah meminta sesinya
diputus. Karena itu ADR-0048 tetap berlaku apa adanya: **dashboard mendeteksi, tak pernah memasang.**
Yang berubah hanya sumber kebenarannya, dari `git fetch` (yang tak punya arti apa pun di instalasi
`npm i -g` — tak ada repo git di sana) menjadi registry npm.

Jaringan tetap **hanya di satu tempat** dan tetap digerbangi knob `HANOMAN_UPDATE_FETCH` yang sudah
ada (test memaksa `0` → nol jaringan), TTL 5 menit, gagal → `registry.status = "unavailable"`
(fail-safe, tak pernah melempar).

### Kenapa `doctor` melaporkan prasyarat alih-alih memasangnya

`git`, `tmux`, dan CLI agen adalah **inti produk**, bukan detail instalasi: sesi jalan di worktree
terisolasi (ADR-0002) di dalam tmux (ADR-0016) dan yang mengerjakan backlog adalah `claude`/`codex`.
Memasangnya diam-diam berarti hanoman memasang perangkat lunak yang tak diminta; menyembunyikannya
berarti kegagalannya muncul jauh nanti, di dalam pane tmux yang tak dibaca siapa pun. Melaporkannya
dengan exit code adalah jalan tengah yang bisa dipakai skrip.

## Konsekuensi

- **Instalasi jadi satu perintah, dan update jadi satu perintah.** `npm i -g hanoman` → `hanoman`.
  `hanoman update` lalu restart supervisor (mis. `systemctl restart hanoman`).
- **`HANOMAN_HOME` menjadi akar data** (DB SQLite, key SSH, transkrip sesi). Dua instance di satu
  mesin dipisah dengan `HANOMAN_HOME` + `--port` yang berbeda — bukan lagi dengan dua database.
- **Ukuran terpasang ±100 MB**, didominasi `prisma` CLI + engine dan `node-pty`. Disebut apa adanya
  di README paket; alternatif embedded-postgres justru lebih besar.
- **Runbook VPS berubah bentuk**: dari `git pull && pnpm install && migrate && build` menjadi
  `npm i -g hanoman@latest` + restart. Deploy dari checkout tetap mungkin (`resolveLayout` mengenali
  layout repo), tetapi bukan lagi jalur yang didokumentasikan sebagai default.
- **Publish belum terjadi.** Nama `hanoman` diverifikasi bebas di registry (404) per 2026-07-30;
  paket dirakit & diuji dari staging, penerbitannya keputusan manusia.
- **Tak ada perubahan pada mesin sesi.** `pty.ts`, agen, mode goal, sync, dan UI selain panel update
  tak tersentuh.

### Gotcha pemblokir: `@prisma/client` dari npm adalah STUB

Paket `@prisma/client` yang datang dari registry **tidak berisi client** — kodenya baru ada setelah
`prisma generate`. Gejalanya di instalasi `npm i -g` nyata: migrasi **berhasil**, lalu server mati
seketika dengan `@prisma/client did not initialize yet`. Dua lapis penangkalnya sengaja dipasang
keduanya:

1. `postinstall: "prisma generate --schema prisma/schema.prisma || true"` di paket — non-fatal supaya
   kegagalan generate tak membatalkan instalasi.
2. Pemeriksaan ulang saat `start` (`ensurePrismaClient`), karena postinstall **bisa dilewati**
   (`--ignore-scripts`, sebagian CI, sebagian setup npm global).

Pemeriksaannya **langsung** — mencoba mengonstruksi `PrismaClient` dan menangkap kegagalannya —
bukan menebak dari keberadaan berkas: berkas stub `default.js` memang **ada** justru saat client
belum di-generate, jadi `existsSync` akan selalu berkata "sudah siap". Ini kelas jebakan yang sama
dengan verifikasi palsu di ADR-0085: cek yang tak bisa membedakan berhasil dari gagal.

### Yang dijaga test murni, bukan disiplin

Daftar yang bisa salah tanpa suara dipisah ke fungsi murni supaya ada yang menjaganya:

- `RUNTIME_DEPS` — harus memuat **setiap** `--external:` di build server, plus `prisma` (untuk
  `migrate deploy`) dan `pg` (untuk `migrate-from-postgres`). Dependency yang terlewat tidak membuat
  build gagal; ia membuat paket terbit lalu mati saat `import`.
- `REQUIRED_ARTIFACTS` — tujuh berkas yang harus ada di `dist-npm/`. Aset web atau migrasi yang
  lupa ikut menghasilkan paket yang "berhasil dirakit" dan rusak saat dipakai.
- `parseStartArgs`, `resolveLayout`, `doctorReport`, `compareSemver`, `packageJsonFor`, `copyPlan` —
  semuanya murni, dites tanpa filesystem/jaringan/tmux.

## Alternatif yang ditolak

- **`POST /api/update/apply` yang memasang lalu me-restart dirinya sendiri.** Memutus sesi tmux yang
  sedang berjalan tanpa diminta, dan mengubah server jadi pemasang perangkat lunak. Ditolak — ADR-0048
  dipertahankan.
- **Self-update lewat git checkout dari dalam paket** (`git pull` di direktori instalasi npm).
  Instalasi npm bukan repo git; membuatnya menjadi repo git berarti mempertahankan model lama sambil
  berpura-pura sudah pindah.
- **Mempublikasikan seluruh workspace (paket `@hanoman/*`).** Konsumen tak butuh satu pun paket
  internal secara terpisah, dan itu memaksa merawat kontrak publik untuk enam paket alih-alih satu.
  Yang diterbitkan adalah satu paket self-contained berisi dua bundle esbuild.
- **Membundel `prisma` CLI dengan esbuild alih-alih menjadikannya dependency.** CLI prisma memuat
  engine binari dan berkas skema saat runtime; membundelnya berarti menebak internal-nya setiap versi.
- **Menulis runner migrasi sendiri** (baca `migrations/**` lalu eksekusi SQL-nya). Menghemat ±40 MB
  dengan mengarang ulang bagian Prisma yang justru paling tak boleh salah: tabel `_prisma_migrations`,
  checksum, dan urutan. Ditolak.
- **`hanoman start` mengimpor server ke dalam prosesnya sendiri** alih-alih spawn. Menghemat satu
  proses, dengan menukarnya jadi satu proses yang menangani sinyal, exit code, dan flag node untuk
  dua peran sekaligus.
