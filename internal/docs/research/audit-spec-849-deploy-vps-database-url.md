# Audit SPEC-849 — runbook VPS masih menjanjikan pagar `DATABASE_URL` yang sudah tak ada

Sumber: QA · GitHub issue [denameidina/hanoman#4](https://github.com/denameidina/hanoman/issues/4)
(pelapor @RamaAditya49). Severity: major. Doc-of-record perbaikan — Spec & Plan `skipped`
(temuan docs-only, akar tunggal, diff kecil; ADR-0020/0040).

## Ringkasan

Kontrak resolusi DB hanoman diubah pada **amandemen ADR-0086 (2026-07-30)**: hard-fail **pindah**
dari `DATABASE_URL` ke `HANOMAN_DATABASE_URL`, sementara `DATABASE_URL` non-`file:` **diabaikan
dengan peringatan** dan hanoman jatuh ke `$HANOMAN_HOME/hanoman.db`. Amandemen itu merambat ke
**kode** dan ke **`operations/npm-readme.md`**, tetapi **tidak** ke doc turunan lain yang
mengulang kontrak yang sama. Empat berkas karena itu masih menjanjikan pagar yang tak ada, dan
runbook produksi adalah yang paling mahal di antaranya.

Ini bukan bug kode: `runner/src/paths.ts` benar dan sudah dipagari `runner/test/paths.test.ts`.

## Perilaku sebenarnya (dibaca dari implementasi, bukan dari docs)

Presedensi di `runner/src/paths.ts:34-49` — `HANOMAN_DATABASE_URL` → `DATABASE_URL` → `<home>/hanoman.db`:

| Env | Nilai | Akibat |
|---|---|---|
| `HANOMAN_DATABASE_URL` | non-`file:` | **melempar** (`paths.ts:37-42`), pesan menyebut `migrate-from-postgres` |
| `HANOMAN_DATABASE_URL` | `file:…` | dipakai, menang atas `DATABASE_URL` |
| `DATABASE_URL` | non-`file:` (mis. `postgresql://…`) | **diabaikan** → `file:$HANOMAN_HOME/hanoman.db`, disertai notice (`paths.ts:47`, `dbUrlNotice` `:65-75`) |
| `DATABASE_URL` | `file:…` | dipakai; path relatif di-resolve relatif ke direktori `schema.prisma`, **bukan** cwd (`:51-55`) |
| tak satu pun | — | `file:$HANOMAN_HOME/hanoman.db` |

`dbUrlNotice()` dicetak di **tiga** titik masuk, jadi pengabaian tak pernah senyap:
`cli/src/commands/start.ts:222-224` (stderr), `cli/src/commands/doctor.ts:118-120` (stdout),
`server/src/db.ts:17-18` (`console.warn`, untuk jalur `node dist/server.js` langsung). Notice
mencetak **hanya skema** URL-nya, bukan URL-nya, karena URL DB biasanya memuat kredensial
(`paths.ts:63`, dipagari `paths.test.ts:69-73`).

Target eksplisit selalu menang dan **melewati resolusi env sepenuhnya**:
`hanoman start --db <file>` (`start.ts:219`) dan `hanoman migrate-from-postgres --to <file>`
(`migrate-pg.ts:147`). Konsekuensi yang relevan untuk runbook: dengan `--to`, target migrasi tak
bergantung pada env sama sekali — termasuk tak terpengaruh `HANOMAN_DATABASE_URL` yang salah.

## Temuan

### F1 — `operations/deploy-vps.md:93-95` menyatakan kontrak yang salah (confirmed)

> `DATABASE_URL` tidak perlu: default adalah `$HANOMAN_HOME/hanoman.db`. Bila diisi, hanya URL
> SQLite `file:` yang sah.

"Hanya yang sah" terbaca sebagai "yang lain ditolak". Yang terjadi: nilai lain **diterima
lingkungannya, diabaikan isinya**, dan boot lanjut ke berkas default. Runbook juga tak menyebut
`HANOMAN_DATABASE_URL` sama sekali — knob milik hanoman yang justru satu-satunya yang gagal keras.

Ini sisa dari versi sebelum SPEC-761. Versi `0b50bc59` masih memuat kedua klaim yang dikutip issue
secara harfiah — `deploy-vps.md:88` ("`DATABASE_URL` di environment masih menunjuk Postgres →
perintahnya melempar. Itu disengaja") dan `:111`. SPEC-761 menulis ulang runbook dan menjatuhkan
klaim `:88`, tetapi meninggalkan `:111` dalam bentuk yang lebih pendek dan tetap salah.

### F2 — `architecture/stack.md:52-53` masih memuat klaim lama apa adanya (confirmed)

> `DATABASE_URL` yang bukan `file:` **melempar** dan menunjuk `hanoman migrate-from-postgres`.

Salah sejak amandemen 2026-07-30. Ini doc arsitektur yang dibaca lebih dulu daripada runbook.

### F3 — `internal/skills/hanoman/SKILL.md:62` mengulang klaim yang sama (confirmed)

Kalimat identik F2. Skill project dibaca agen **sebelum** doc mana pun (kontrak `AGENTS.md`), jadi
klaim salah di sini merambat ke tiap sesi.

### F4 — `internal/skills/hanoman-devops/SKILL.md:113-114` mendiagnosis gejala yang tak bisa terjadi (confirmed)

- `:113` menautkan pesan galat "`DATABASE_URL harus URL SQLite file:` saat boot" ke `DATABASE_URL`.
  String itu tak ada lagi; satu-satunya pesan sejenis berbunyi `HANOMAN_DATABASE_URL harus URL
  SQLite \`file:\`…` (`paths.ts:39`).
- `:114` menyatakan `migrate-from-postgres` melempar sebelum menyentuh apa pun bila `DATABASE_URL`
  masih Postgres. Tidak — `migrate-pg.ts:147` memanggil `resolveDbUrl`, yang mengabaikannya dan
  memberi `<home>/hanoman.db` sebagai target. Operator yang mengandalkan entri ini justru
  kehilangan satu-satunya sinyal bahwa migrasi menarget berkas default, bukan yang ia maksud.

### F5 — runbook migrasi produksi (`deploy-vps.md` §6) tak menganjurkan `--to` (confirmed)

Ketiga perintah contoh mengandalkan target implisit dari env. Karena `DATABASE_URL` asing kini
diabaikan diam-diam-tapi-berisik, "target implisit" berarti "apa pun yang `resolveHome` putuskan
saat itu". Pada data produksi (akun rekan & tiket nyata) target yang ambigu adalah biaya yang tak
perlu dibayar — `--to` menghapus seluruh pertanyaannya.

### F6 — `operations/production.md:28` menyebut presedensi separuh (minor, confirmed)

`--db <file>` disebut "menang atas `DATABASE_URL`" saja. Ia juga menang atas
`HANOMAN_DATABASE_URL` (`start.ts:219` memakai `opts.db` tanpa memanggil `resolveDbUrl` sama
sekali). Tidak salah, tetapi terbaca sebagai "kecuali knob yang satu lagi" — ambiguitas dari
keluarga yang sama, jadi diselesaikan di commit yang sama.

## Skenario gagal yang dijanjikan runbook tapi tak terjadi

1. Service atau shell operator masih mewarisi `DATABASE_URL=postgresql://old-host/hanoman`.
2. Operator membaca runbook dan menyimpulkan proses akan **berhenti** bila konfigurasi lama tersisa.
3. hanoman justru boot/migrasi ke `$HANOMAN_HOME/hanoman.db` sesudah mencetak notice.
4. Instance tampak kosong. Tanpa runbook yang menyebut notice itu, gejalanya terbaca sebagai
   "data hilang" — padahal datanya masih utuh di Postgres dan pulihnya satu perintah.

## Yang TIDAK rusak (kontrol negatif)

- `runner/src/paths.ts` — benar, dan `runner/test/paths.test.ts:20-77` sudah memagari kedua sisi
  kontrak (pengabaian `DATABASE_URL`, lemparan `HANOMAN_DATABASE_URL`, notice, non-kebocoran
  kredensial).
- `adr/0086-sqlite-satu-satunya-provider.md:13-42` dan `adr/README.md:49` — amandemen tercatat
  benar. Butir 5 asli di `:100` sengaja dibiarkan: ADR imutable, amandemennya yang berlaku.
- `operations/npm-readme.md:88-89,111-113` — akurat; tabel env dan kotak "Punya `DATABASE_URL`
  untuk project lain?" sudah menggambarkan perilaku nyata. Doc ini yang jadi acuan penyelarasan.

## Akar masalah

Amandemen ADR-0086 mengubah kontrak yang **diulang** di lima tempat, dan hanya menyentuh dua
(kode + `npm-readme.md`). Tak ada mekanisme yang memaksa doc turunan ikut; guardrail SoT memang
sudah dicabut secara sadar (SPEC-160/ADR-0023) dan **tidak** dihidupkan kembali di sini —
menambahkan gate prosa akan melawan ADR itu tanpa ADR baru. Penawarnya konvensional: satu commit
yang menyelaraskan seluruh pengulangan, dengan `npm-readme.md` + `paths.test.ts` sebagai acuan.

## Perbaikan

Docs-only, tanpa perubahan kode, skema, endpoint, maupun ADR baru.

1. `operations/deploy-vps.md` §2 — ganti kalimat DB dengan penjelasan tiga jalur: `DATABASE_URL`
   non-`file:` diabaikan + notice + fallback `$HANOMAN_HOME/hanoman.db`; `HANOMAN_DATABASE_URL`
   sebagai knob hanoman yang gagal keras bila non-`file:`; `--db`/`--to` sebagai target eksplisit.
2. `operations/deploy-vps.md` §6 — contoh migrasi memakai `--to` eksplisit.
3. `architecture/stack.md` — koreksi klaim "melempar".
4. `internal/skills/hanoman/SKILL.md` — koreksi klaim yang sama.
5. `internal/skills/hanoman-devops/SKILL.md` — koreksi dua entri diagnosis dan tambahkan entri
   untuk baris notice, yang sampai kini tak punya entri troubleshoot sama sekali.
6. `operations/production.md` — `--db` menang atas **kedua** env.

## Verifikasi

Perubahannya docs-only (nol berkas kode), jadi `vitest --changed` tak punya berkas test untuk
dijalankan — dan "no test files" **terlihat hijau** karena `--changed` menyalakan
`passWithNoTests`. Bukti yang dipakai karena itu bukan itu:

1. **Setiap klaim runbook dieksekusi terhadap implementasinya.** `runner/src/paths.ts` diimpor apa
   adanya (node type-stripping, tanpa `node_modules`) dan sembilan klaim diuji satu per satu:
   `DATABASE_URL` Postgres → `file:$HANOMAN_HOME/hanoman.db` tanpa melempar · notice ada · notice
   mencetak skema saja (`s3cret`/host tak muncul) · notice membawa kedua jalan keluar ·
   `HANOMAN_DATABASE_URL` non-`file:` melempar dan menyebut `migrate-from-postgres` ·
   `HANOMAN_DATABASE_URL` menang · default tanpa env · path relatif relatif ke direktori
   `schema.prisma` · notice senyap saat `HANOMAN_DATABASE_URL` diisi. **9/9 cocok.**
2. **Integritas index**, dijalankan dengan port 1:1 `cli/src/commands/docs-index.ts` +
   `shared/src/coverage.ts` (BFS transitif dari `README.md`): `index ok` — audit ini reachable, nol
   dangling.
3. **Seluruh link relatif** di berkas docs yang berubah resolve ke berkas yang ada.

## Acceptance criteria

- [x] `deploy-vps.md` tidak lagi menyatakan `DATABASE_URL` Postgres akan melempar.
- [x] Runbook menjelaskan fallback ke `$HANOMAN_HOME/hanoman.db` dan notice yang muncul.
- [x] Runbook menyebut `HANOMAN_DATABASE_URL` sebagai knob milik hanoman yang gagal keras bila non-`file:`.
- [x] Contoh migrasi produksi menganjurkan `--to` eksplisit ketika target harus tidak ambigu.
- [x] Penjelasan konsisten dengan `operations/npm-readme.md` dan test `resolveDbUrl`/`dbUrlNotice`.
