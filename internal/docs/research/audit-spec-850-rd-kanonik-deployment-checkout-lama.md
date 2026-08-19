# Audit SPEC-850 — Release doc kanonik masih mendokumentasikan deployment checkout lama

- **Sumber**: finding QA SPEC-850 · severity `major` · prioritas `sedang` · GitHub issue
  [denameidina/hanoman#3](https://github.com/denameidina/hanoman/issues/3) (@RamaAditya49)
- **Tanggal**: 2026-08-19
- **Menyentuh (Execute)**: `internal/docs/requirements/rd.md` · `internal/docs/entrypoints/rd.md` ·
  `internal/docs/operations/production.md` · `internal/docs/README.md`
- **Keputusan fase**: **Spec dan Plan DILEWATI**. Tak ada kode, skema, endpoint, maupun kontrak yang
  berubah — akarnya satu dokumen yang tak ikut diperbarui saat SPEC-398/405 mendarat, dan koreksinya
  sudah tertulis lengkap di ADR-0087/0088 plus tiga runbook operasi yang aktif. Dokumen ini jadi
  doc-of-record perbaikan itu.
- **ADR**: tak ada ADR baru. [ADR-0087](../adr/0087-distribusi-npm-global-satu-perintah.md) dan
  [ADR-0088](../adr/0088-tombol-update-npm-restart-tersupervisi.md) **ditegakkan**, bukan diamandemen;
  [ADR-0048](../adr/0048-auto-update-deteksi-read-only.md) tetap dirujuk sebagai keadaan yang sudah
  diamandemen ADR-0088, bukan sebagai kontrak berjalan.

---

## 1. Gejala

`internal/docs/requirements/rd.md` menyatakan dirinya **kanonik** (baris 4) dan menjadi rujukan
release yang wajib dibaca agen lewat index Source of Truth. Isinya mendeskripsikan hanoman
sebagaimana ia ada **sebelum** SPEC-398 (distribusi npm global) dan SPEC-405 (tombol update
tersupervisi): identitas versi = SHA git, deploy = `git pull` dari checkout, dan penyangkalan
eksplisit atas fitur update yang justru sudah berjalan.

Bahayanya bukan "catatan historis yang basi". Status kanonik membuat dokumen ini **menang atas
ingatan dan kode** dalam kontrak agen (`AGENTS.md` aturan 1): agen yang membacanya bisa menolak
fitur update yang aktif, atau mengimplementasikan ulang mekanisme lama.

## 2. Bukti — tujuh kontradiksi terhadap kode aktif

Semuanya diperiksa terhadap berkas di worktree ini, bukan dari ingatan.

| # | Klaim `requirements/rd.md` | Keadaan nyata |
|---|---|---|
| F1 | `:13` "hanoman **tidak punya field `version`** — `package.json` root sengaja tanpa nomor versi" | `package.json:3` → `"version": "0.1.46"` |
| F1 | `:14` "Identitas sebuah build adalah **git SHA**" | `scripts/stamp-build.mjs:12-19` menanam `{version, sha, builtAt}`; komentarnya menyebut SPEC-398/ADR-0087 apa adanya: "versi = semver paket npm (sumber tunggal: root package.json)". SHA tetap ditanam, tapi untuk melacak build dev — bukan sebagai identitas |
| F1 | `:18` "Badge update muncul bila `runningBuildSha ≠ checkoutSha` **atau** origin di depan checkout" | `server/src/services/update.ts:27-28` → `available = registryStatus === "ok" && compareSemver(latestVersion, currentVersion) > 0`. Tak ada `checkoutSha`, tak ada `origin` |
| F2 | `:21-24` "Server **read-only** soal update … tak pernah … restart sendiri"; "Satu-satunya akses jaringannya, `git fetch`" | Separuh benar, separuh terbalik. Server memang tak memasang apa pun, dan jaringan memang masih satu tempat + digerbangi `HANOMAN_UPDATE_FETCH` (`services/update.ts:96`) — tapi jaringannya `GET <registry>/hanoman/latest` (`:99-104`), bukan `git fetch`; dan `POST /api/update/apply` (`server/src/routes/update.ts:15`) membuat server **keluar dengan `UPDATE_RESTART_EXIT = 75`** supaya CLI parent memasang lalu men-spawn ulang (ADR-0088) |
| F3 | `:26-37` "Kanal & branch" hanya menyebut branch integrasi | Dokumen rilis tak menyebut kanal rilis yang sebenarnya: tag `v*` → `.github/workflows/release.yml` → `npm publish --provenance` lewat trusted publishing (OIDC) |
| F5 | `:57-69` prosedur deploy = `git pull --ff-only` → `pnpm install` → `migrate deploy` → `generate` → `pnpm build` → `systemctl restart` | `README.md:141` "Pasang sebagai paket npm" → `npm i -g hanoman`; `internal/docs/operations/deploy-vps.md:56` `npm i -g hanoman` sebagai langkah instalasi VPS; ADR-0087 Konsekuensi: "Runbook VPS berubah bentuk: dari `git pull && pnpm install && migrate && build` menjadi `npm i -g hanoman@latest` + restart". Jalur checkout **masih sah** (`resolveLayout` mengenali layout repo) tapi ADR-0087 menyebutnya "bukan lagi jalur yang didokumentasikan sebagai default" |
| F6 | `:80` rollback = "Checkout SHA sebelumnya → `pnpm build` → restart" | Instalasi `npm i -g` bukan repo git — tak ada SHA untuk di-checkout. Rollback yang berlaku adalah memasang versi paket yang diketahui baik (`npm i -g hanoman@<versi>`). Aturan skema di kalimat berikutnya tetap benar |
| F7 | `:87` "Tak ada pipeline CI yang men-deploy" | Benar untuk *deploy*, menyesatkan untuk *rilis*: `.github/workflows/release.yml` **menerbitkan** paket pada tag `v*`, dan sejak amandemen 2026-07-31 ADR-0087 tak ada lagi gerbang manusia di jalur itu |
| F7 | `:88-89` "Tak ada self-update, self-restart, maupun supervisor auto-heal — menghidupkannya butuh ADR baru ([ADR-0048])" | ADR barunya sudah datang: **ADR-0088** memenuhi syarat yang ADR-0048 sendiri tetapkan ("butuh ADR baru + supervisor"). Supervisornya adalah `hanoman start` yang dibawa ADR-0087. `hanoman update` juga sudah ada di CLI (`cli/src/commands/update.ts`) |

## 3. Akar masalah

Bukan kelalaian satu commit. `requirements/rd.md` diisi jadi doc detail kanonik pada
`323a3fe9` (SPEC-386, cleanup docs) dengan menyalin keadaan **SPEC-214/ADR-0048** yang saat itu
memang mutakhir. SPEC-398 (ADR-0086/0087) dan SPEC-405 (ADR-0088) sesudahnya menulis keadaan barunya
ke tempat lain — ADR, `operations/release-npm.md`, `operations/npm-readme.md`,
`operations/deploy-vps.md`, `operations/production.md` — dan tak ada satu pun yang menyentuh kembali
`requirements/rd.md`. Sejak SPEC-160/ADR-0023 tak ada gate mekanis yang menangkap divergensi ini;
yang tersisa hanya konvensi "perbarui docs yang tersentuh dalam commit yang sama".

Konsekuensi bentuknya: dokumen ini **menduplikasi runbook** (prosedur deploy enam baris, prosedur
rollback) alih-alih menautkannya. Duplikat runbook selalu basi lebih cepat daripada runbook-nya.
Karena itu perbaikannya bukan sekadar menukar isi, tapi memindahkan detail prosedural ke tautan dan
menyisakan di `rd.md` hanya yang memang miliknya: **kontrak** rilis — identitas versi, kanal, kriteria,
bentuk deploy/update/rollback, dan batas yang sengaja tidak dilewati.

## 4. Dua temuan berdampingan (ikut diperbaiki)

Keduanya lahir dari akar yang sama dan langsung merusak kriteria penerimaan #6 ("link dan istilah
konsisten dengan ADR-0087/0088 serta docs operasi aktif") bila dibiarkan.

**T1 — `internal/docs/entrypoints/rd.md`.** `requirements/rd.md:4` menunjuk berkas ini sebagai "pintu
masuk ringkasnya", tetapi isinya menyebut kanal `develop` → build internal dan `main` → rilis
workspace (tagged). Branch `develop` **tidak ada** (`git branch -a --list '*develop*'` kosong), dan
kanal rilis yang sebenarnya — tag `v*` → npm — tak disebut sama sekali. Pintu masuk yang
mengontradiksi doc kanoniknya lebih buruk daripada tak ada pintu masuk.

**T2 — `internal/docs/operations/production.md:121-124`.** Masih menulis: "Deteksi saja — server tak
pernah memasang apa pun sendiri ([ADR-0048] **utuh**): instance yang me-`npm i` dirinya sendiri lalu
keluar akan memutus sesi tmux yang sedang berjalan tanpa peringatan." ADR-0088 membalik **kedua**
paruhnya secara eksplisit: (a) ADR-0048 tidak lagi utuh — ia diamandemen; (b) premis "memutus sesi
tmux" dinyatakan **tidak akurat**, karena `pty.ts` memakai `tmux new-session -d` sehingga tmux adalah
daemon terpisah dan yang putus hanya jembatan `tmux attach` + WebSocket yang sudah menyambung ulang
sendiri. `rd.md` akan menautkan `production.md`; menautkan halaman yang mengontradiksi ADR-0088
memindahkan cacatnya, bukan memperbaikinya.

## 5. Yang TIDAK berubah (diperiksa, tetap benar)

Supaya perbaikan tak menghapus hal yang masih berlaku:

- **Kriteria rilis** (`:39-55`) semuanya masih benar: scope verifikasi per sesi (ADR-0080), jebakan
  `passWithNoTests` pada `--changed`, docs ter-link, **migration additif**, diff bersih. Yang kurang
  hanya satu langkah baru — bump versi + tag harus cocok.
- **Kanal branch integrasi** (`:28-34`): `main` sebagai target, `hanoman/spec-<n>` sebagai properti
  backlog (ADR-0032), integrasi dipicu manual (ADR-0031), pembersihan branch (ADR-0077).
- **Aturan rollback skema** (`:81-83`): karena migration additif, rollback kode tidak menuntut
  rollback skema. Berlaku persis sama pada distribusi npm.
- **`POST /auth/setup` segera sesudah deploy pertama** (`:75-76`, ADR-0028).
- **Gotcha `set -e` pada pipe build** (`:71-73`) tetap benar **untuk jalur checkout**, yang masih ada
  sebagai jalur pengembangan (`operations/production.md` §"Prod dari checkout").
- **Server tetap tidak memasang apa pun.** Ini inti ADR-0048 yang ADR-0088 sengaja pertahankan —
  server hanya keluar dengan kode sentinel; yang `npm i -g` adalah CLI parent. Perbaikan tak boleh
  mengaburkannya jadi "server melakukan self-update".

## 6. Perbaikan (Execute)

Murni dokumentasi. Nol perubahan kode, skema, endpoint, atau payload.

1. **`internal/docs/requirements/rd.md`** — tulis ulang enam seksi terhadap ADR-0087/0088:
   identitas versi semver, kanal rilis (branch integrasi **dan** tag `v*` → npm), kriteria rilis
   (+ bump/tag), deploy sebagai `npm i -g hanoman` dengan checkout sebagai jalur pengembangan yang
   ditautkan, update lewat CLI **dan** dashboard sesuai pembagian ADR-0088, rollback ke versi paket,
   serta "Yang tidak ada" yang hanya menyangkal yang memang tak ada. Detail prosedural **ditautkan**
   ke `operations/release-npm.md`, `operations/npm-readme.md`, `operations/deploy-vps.md`, dan
   `operations/production.md` alih-alih diduplikasi.
2. **`internal/docs/entrypoints/rd.md`** — kanal dibetulkan ke `main` + tag `v*` → npm; `develop`
   dihapus.
3. **`internal/docs/operations/production.md`** — paragraf T2 diperbaiki: ADR-0048 disebut sebagai
   diamandemen ADR-0088, premis "memutus sesi tmux" dikoreksi, tombol dashboard disebut.
4. **`internal/docs/README.md`** — audit ini ditautkan di kategori `research`.

## 7. Kriteria penerimaan issue #3 → status

| Kriteria | Dipenuhi oleh |
|---|---|
| Tak ada lagi klaim root package tanpa `version` / build hanya ber-SHA | §6.1 — seksi "Identitas versi" ditulis ulang ke semver (F1) |
| Deploy utama = instalasi paket npm global, bukan checkout + `git pull` | §6.1 — seksi "Deploy" (F5) |
| Update dashboard/CLI + supervisor restart sesuai ADR-0088 | §6.1 — seksi "Update" (F2, F7) |
| Rollback pakai versi paket yang diketahui baik; rollback skema tetap additif | §6.1 — seksi "Rollback" (F6), aturan skema dipertahankan (§5) |
| "Yang tidak ada" tak lagi menyangkal artefak npm/self-update yang aktif | §6.1 — seksi terakhir (F7) |
| Link & istilah konsisten dengan ADR-0087/0088 dan docs operasi aktif | §6.1 (tautan menggantikan duplikat) + §6.2 (T1) + §6.3 (T2) |

## 8. Verifikasi

Dokumentasi murni, jadi buktinya bukan test runtime melainkan integritas index dan tautan:

- **Integritas index**: worktree ini tanpa `node_modules`, jadi `hanoman docs index --check`
  direplikasi persis dari sumbernya (`cli/src/commands/docs-index.ts` + `linkedSetFrom()` di
  `shared/src/coverage.ts` — BFS graf link dari `README.md`, lalu `dangling` dari `parseIndex`).
  Hasil: **208 doc di korpus, 208 reachable, 181 target langsung di index — `unlinked` dan `dangling`
  keduanya kosong**.
- **Tautan**: 222 tautan relatif di kelima berkas yang tersentuh di-resolve ke path nyata → **0 rusak**.
- **Test yang tersentuh: nol, dan itu diperiksa, bukan diasumsikan.** `grep -rn "requirements/rd"`
  menghasilkan satu hit (index itu sendiri). Test yang menyebut `internal/docs` semuanya bekerja di
  repo sintetis lewat `makeTempRepo()` (`server/test/factory.ts`) — tak satu pun membaca
  `internal/docs/**` milik checkout ini. Jadi "no test files" di sini adalah kesimpulan yang
  diverifikasi, bukan `passWithNoTests` yang diterima apa adanya.
