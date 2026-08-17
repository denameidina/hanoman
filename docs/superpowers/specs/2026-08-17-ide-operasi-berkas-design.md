# IDE Explorer — buat, unggah, rename, dan hapus berkas

Status: design · 2026-08-17 · flow `feature` (brief) · backlog id: **belum dialokasikan** ·
ADR baru: **ADR-0121** (nomor diverifikasi ulang saat execute — lihat Risiko)

## Masalah

IDE Explorer hanoman hari ini hanya bisa **membaca** repo dan **menyunting berkas yang sudah
ada**. Permukaan tulisnya tepat satu endpoint:

- `PUT /api/projects/:id/file` — menimpa isi berkas teks yang path-nya sudah diketahui
  (`routes/ide.ts:103`). Ia memang membuat folder induk yang belum ada
  (`safe-repo-path.ts:146` `writeRepoFileAtomic` → `ensureRepoParents`), tetapi hanya sebagai
  efek samping penulisan berkas — tak ada pintu untuk **menyebut** path baru dari UI.

Akibatnya tiga pekerjaan paling biasa di sebuah IDE tak punya jalur sama sekali:

- **Memasukkan berkas dari mesin operator** (aset, fixture, dump, screenshot, folder contoh).
  Satu-satunya jalan hari ini adalah menyuruh agen membuatnya di sesi terminal — yang berarti
  isi berkas harus diketikkan ulang lewat prompt, dan berkas biner mustahil.
- **Membuat berkas/folder baru** tanpa lebih dulu memilih berkas lain.
- **Rename & hapus.** `grep` seluruh `server/src/routes/ide.ts` untuk `unlink|rm|rename` →
  kosong. Berkas yang salah nama atau salah tempat hanya bisa dibereskan lewat sesi agen atau
  shell di mesin server.

Batasannya bukan keputusan yang pernah diambil — ia sisa dari IDE yang lahir sebagai **viewer
diff** (SPEC-182/234). Lampiran gambar sesi terminal (SPEC-816) sudah membuktikan pola unggah
multipart-nya bisa hidup di hanoman; yang belum ada adalah pintunya di sisi repo.

## Objective

Operator bisa mengelola isi checkout project dari Explorer sebagaimana ia mengelolanya di IDE
biasa: membuat berkas dan folder, menyeret berkas **atau folder** dari mesinnya ke pohon,
mengganti nama, dan menghapus — dengan folder yang sedang dipilih sebagai tujuan, tanpa
membuka sesi agen dan tanpa akses shell ke mesin server.

Isolasi tetap sebagaimana adanya: operasi ini menyentuh **checkout project** (`repoDir` hasil
`resolveRepoDir`, ADR-0013/SPEC-213), bukan worktree sesi mana pun.

## Keputusan

### 1. Dua permukaan, bukan empat endpoint ad-hoc

Semua operasi struktural bertemu di satu path `entry`; unggah berdiri sendiri karena
transportnya berbeda (multipart, berkas biner, banyak berkas sekaligus).

```
POST   /api/projects/:id/entry     { path, kind: "file" | "dir" }   buat
PATCH  /api/projects/:id/entry     { from, to }                     rename / pindah
DELETE /api/projects/:id/entry?path=<rel>                           hapus (rekursif untuk folder)
POST   /api/projects/:id/upload    multipart/form-data              unggah N berkas
```

Satu path untuk tiga operasi struktural karena ketiganya berbagi seluruh penjaga path yang
sama; memecahnya jadi `/mkdir`, `/rename`, `/delete` hanya menyalin gerbang yang sama tiga
kali — kelas bug yang berulang di repo ini (SPEC-431/448/475: predikat yang sama hidup di
beberapa tempat lalu berpisah diam-diam).

### 2. Logikanya di service murni `services/repo-fs.ts`

Route hanya me-resolve project → `repoDir` dan menerjemahkan hasil ke kode HTTP. Seluruh
manipulasi berkas hidup di `services/repo-fs.ts` yang tak menyentuh Prisma maupun tmux,
sehingga bisa dites atas direktori sementara tanpa DB — persis pola `branch-cleanup.ts`
(SPEC-360) dan `git-ide.ts`.

Ekspor:

| Fungsi | Kembali |
|---|---|
| `entryKind(repoDir, rel)` | `"file" \| "dir" \| null` |
| `createEntry(repoDir, rel, kind)` | `{ path }` · throw `EntryExistsError` bila sudah ada |
| `renameEntry(repoDir, from, to)` | `{ from, to }` |
| `deleteEntry(repoDir, rel)` | `{ path, kind }` |
| `writeUpload(repoDir, rel, buf, { overwrite })` | `"written" \| "exists"` |

Penjaga path **tidak ditulis ulang**: ketiganya memakai `resolveRepoEntry` /
`assertSafeRepoPathSync` / `writeRepoFileAtomic` dari `safe-repo-path.ts`, ditambah larangan
`.git` yang sudah dirumuskan `repoAbsPath` (`git-ide.ts:16`). Yang diwarisi apa adanya, dan
dinyatakan di sini supaya tak dikira lupa:

- path absolut, kosong, ber-`..`, atau ber-NUL → ditolak (`components()`);
- komponen mana pun yang berupa **symlink** → ditolak. Konsekuensinya jujur: berkas symlink
  di dalam repo **tak bisa** dihapus atau di-rename lewat IDE. Melonggarkannya berarti
  membuka jalan keluar dari root, dan itu bukan harga yang sepadan untuk kasus langka ini;
- penulisan selalu atomic (tulis ke `.tmp` lalu `rename`), jadi berkas tak pernah setengah
  jadi bila koneksi putus.

### 3. Folder kosong ditulis dengan `.gitkeep`

Pohon Explorer dibangun dari `git ls-files --cached --others --exclude-standard`
(`git-ide.ts:28`) — daftar **berkas**. git sendiri tak melacak direktori kosong. Jadi folder
yang dibuat tanpa isi tak akan terlihat di pohon, tak akan bertahan di commit, dan akan hilang
begitu operator me-refresh — folder hantu.

`createEntry(…, "dir")` karena itu menulis `<folder>/.gitkeep` kosong. Ini konvensi git yang
sudah dikenal, terlihat di pohon, dan selamat menyeberang commit. Operator yang tak
menginginkannya bisa menghapus `.gitkeep` lewat pintu hapus yang sama.

`.gitignore` project bisa membuat folder baru tetap tak terlihat (`--exclude-standard`). Itu
perilaku yang benar — folder yang di-ignore memang bukan bagian dari pohon kerja — dan
responsnya tetap 201, jadi UI menampilkan toast sukses; ketiadaannya di pohon bukan kegagalan.

### 4. Unggah: manifest lebih dulu, berkas menyusul

`POST /api/projects/:id/upload`, `multipart/form-data`, dibaca dengan `req.parts()` sebagai
stream (bukan `req.files()` yang memuat semuanya lebih dulu).

Urutan part **ditentukan pengirim** dan busboy memancarkannya berurutan, jadi kontraknya:

1. field `dir` — folder tujuan relatif terhadap root repo, `""` = root;
2. field `overwrite` — `"1"` untuk menimpa; selain itu berkas yang bentrok dilewati;
3. field `manifest` — JSON array path relatif, **urutannya sama persis** dengan urutan part
   berkas sesudahnya. Inilah yang membawa struktur folder dari `webkitRelativePath`;
4. N part berkas.

Manifest dipakai alih-alih `filename` part karena nama berkas multipart yang mengandung `/`
tak punya jaminan lintas implementasi; array eksplisit membuat pasangannya deterministik.
Bila `manifest` tak ada, path jatuh ke `part.filename` (unggah berkas tunggal tetap bekerja
tanpa manifest). Jumlah entri manifest ≠ jumlah part berkas → **400**.

Path final tiap berkas = `dir` + `/` + entri manifest, dinormalkan lalu dilewatkan penjaga
path yang sama.

**Batas, per-request, bukan global.** Registrasi `@fastify/multipart` di `app.ts:127`
(5 MB/berkas, 12 berkas) melayani lampiran gambar dan **tidak diubah**; route ini menyebut
batasnya sendiri lewat `req.parts({ limits })`:

| Batas | Nilai | Alasan |
|---|---|---|
| `fileSize` | 100 MB | permintaan operator |
| `files` | 1000 | permintaan operator |
| `fields` | 10 | `dir`, `overwrite`, `manifest` + kelonggaran |
| `fieldSize` | 1 MB | manifest 1000 path tak muat di default 20 kB |
| total badan | 2 GB | dijaga penghitung di route, bukan oleh multipart |

`throwFileSizeLimit: false` yang sudah berlaku berarti berkas oversize datang **ter-truncate**
dengan `part.file.truncated === true`, bukan sebagai error — jadi ia dilewati per-berkas, tak
menggagalkan seluruh unggahan (pola `terminal.ts:479`).

Tiap part **di-stream** ke berkas `.tmp` di direktori tujuan lalu di-`rename` (jalur atomic yang
sama dengan `writeRepoFileAtomic`), bukan dikumpulkan dengan `part.toBuffer()` seperti lampiran
gambar 5 MB: pada batas 100 MB × 1000 berkas, memuat berkas penuh di RAM adalah cara termudah
membuat instance 8 GB kehabisan memori. Berkas yang ter-truncate dibuang `.tmp`-nya tanpa pernah
di-`rename`, jadi target tak pernah tersentuh oleh unggahan yang gagal.

**Tak ada allowlist MIME.** Ini repo kode: `.ts`, `.png`, `.pdf`, `.woff2`, arsip fixture —
semuanya sah. Yang membatasi adalah path, ukuran, dan otorisasi, bukan tipe.

### 5. Bentrok: lewati diam-diam, laporkan di badan

Unggahan **tak pernah** menimpa kecuali `overwrite` diminta eksplisit. Statusnya tetap **200**
selama badannya sah; kegagalan per-berkas hidup di daftar, bukan di kode HTTP — pola
`POST /projects/:id/branches/delete` (SPEC-360).

```json
{ "written": ["src/ds/a.ts"],
  "skipped": [{ "path": "src/ds/b.ts", "reason": "exists" }] }
```

`reason` ∈ `exists` · `too-large` (part ter-truncate) · `budget` (total 2 GB terlampaui;
sisanya tak dibaca) · `denied` (ditolak penjaga path — `.git`, symlink, traversal).

UI menampilkan daftar `exists` di satu modal dengan tombol **Timpa semua**, yang mengirim ulang
**hanya berkas yang bentrok** dengan `overwrite=1`. Ini alasan operasional untuk memilih
"lewati" sebagai default: unggah folder besar ke checkout yang punya perubahan belum
di-commit tak boleh menghapus kerja itu tanpa satu pun pertanyaan.

`POST /entry` sebaliknya **409** saat path sudah ada — di sana tabrakan berarti operator salah
menyebut nama, bukan satu berkas dari seribu.

### 6. Otorisasi: `ide:write`, tanpa gerbang sesi aktif

`"entry"` dan `"upload"` masuk `IDE_SUBS` (`agent-capabilities.ts:7`) → `capabilityForRoute`
menurunkannya jadi `ide:read`/`ide:write` **dari method**, jadi tak ada pengulangan kelas bug
SPEC-405 (prefix yang dipetakan tanpa melihat method). `GET` tak dipakai di sini; `POST`,
`PATCH`, dan `DELETE` semuanya menuntut `ide:write` — capability yang **sudah** memberi hak
menimpa isi berkas apa pun lewat `PUT /file`.

Menghapus berkas memang lebih merusak daripada menimpanya, dan itulah isi ADR-0121: yang
menjaga bukan capability terpisah melainkan **konfirmasi di UI** plus fakta bahwa targetnya
checkout project, bukan worktree sesi.

Gerbang sesi aktif (`activeSessions()`, pola `POST /git`) **tidak** dipasang, dengan alasan
yang sama yang membuat `PUT /file` bebas darinya sejak awal (`routes/ide.ts:102`): ini bukan
operasi git dan tak memindahkan HEAD; sesi hidup di `.worktrees/<id>` yang terpisah dan tak
terpengaruh. Memasangnya akan mematikan seluruh fitur ini di project yang sedang dikerjakan —
justru saat ia paling dibutuhkan.

### 7. Explorer: folder jadi target yang bisa dipilih

`TreeRow` (`screens/file-tree.tsx:30`) dipakai bersama Review, jadi kemampuan barunya **opsional**:
prop `dirSelected?: string` dan `onSelectDir?: (p: string) => void`. Tanpa keduanya perilakunya
identik dengan hari ini — chevron buka/tutup, klik baris folder hanya toggle.

Dengan keduanya: chevron tetap toggle, klik **nama folder** memilihnya sebagai tujuan dan
menandainya (latar `--brass-100`, sama seperti berkas terpilih).

Pane Files dapat satu baris aksi di bawah header yang sudah ada:

```
[+ File]  [+ Folder]  [↑ Unggah]  [↑ Folder]        → src/ds
```

- Label kanan menyatakan tujuan (`→ root` bila tak ada folder terpilih). Tanpa itu tujuan jadi
  keadaan tersembunyi — kelas kesalahan yang sama dengan sesi mendarat di sel yang salah.
- **Unggah** = `<input type="file" multiple>`; **Unggah Folder** = `<input type="file" webkitdirectory>`.
  `webkitRelativePath` tiap berkas jadi entri manifest. Browser tanpa `webkitdirectory`
  (Firefox lama, sebagian browser mobile) tak menampilkan tombol kedua — dideteksi dari
  `"webkitdirectory" in HTMLInputElement.prototype`, bukan dari user-agent.
- **Drop** berkas atau folder ke pane pohon = unggah ke tujuan yang sama. Folder yang di-drop
  dibaca lewat `DataTransferItem.webkitGetAsEntry()` secara rekursif; item yang bukan berkas
  maupun direktori diabaikan.
- **Rename** & **Hapus** bekerja atas seleksi yang sedang aktif — berkas *atau* folder — dan
  muncul sebagai aksi di baris yang sama, nonaktif saat tak ada seleksi.

Konfirmasi hapus: berkas cukup satu modal ya/tidak lewat `ConfirmDialog` apa adanya; **folder**
menuntut operator mengetik ulang nama foldernya, karena penghapusannya rekursif dan tak ada undo
di sisi hanoman — yang belum di-commit hilang. `ConfirmDialog` (`ds/ConfirmDialog.tsx`) belum
punya mekanisme itu, jadi ia mendapat satu prop opsional `requireText?: string`: bila diisi,
modal menampilkan satu `Input` dan tombol konfirmasi tetap nonaktif sampai isinya sama persis.
Tanpa prop itu perilakunya tak berubah sedikit pun bagi empat pemakainya yang sekarang.

Setiap operasi yang sukses memanggil `reloadTree()` **dan** `reloadStatus()`, supaya bagian
Staged/Changed langsung mencerminkan berkas baru; berkas yang sedang dibuka dan ikut terhapus
mengosongkan seleksi.

### 8. Kontrak error

| Keadaan | Kode | Badan |
|---|---|---|
| project tak ada | 404 | `{ error: "not found" }` |
| project tanpa checkout lokal | 400 | `{ error: "project tidak punya repoDir" }` |
| path ditolak penjaga (`..`, `.git`, symlink, absolut) | 400 | `{ error: <pesan penjaga> }` |
| `POST /entry` path sudah ada | 409 | `{ error: "sudah ada" }` |
| `PATCH /entry` `from` tak ada | 404 | `{ error: "not found" }` |
| `PATCH /entry` `to` sudah ada | 409 | `{ error: "sudah ada" }` |
| `PATCH /entry` `to` di dalam `from` | 400 | `{ error: "tujuan di dalam sumber" }` |
| `DELETE /entry` path tak ada | 404 | `{ error: "not found" }` |
| manifest ≠ jumlah berkas | 400 | `{ error: "manifest tak cocok dengan berkas" }` |
| berkas oversize / bentrok / ditolak | 200 | masuk `skipped`, unggahan lain tetap jalan |

## Yang sengaja TIDAK dikerjakan

- **Tanpa undo/trash.** Hapus adalah hapus. Perlindungannya konfirmasi + git (berkas yang sudah
  ter-commit selalu bisa dipulihkan lewat Git Graph).
- **Tanpa git add/stage otomatis.** Berkas baru muncul sebagai untracked di bagian Changed; siapa
  yang meng-commit tetap urusan sesi agen atau operator lewat pintu git yang sudah ada.
- **Tanpa unggah ke worktree sesi.** Targetnya selalu checkout project.
- **Tanpa edit berkas biner.** Unggah menimpa; menyuntingnya tetap di luar cakupan IDE.
- **Tanpa unzip di server.** Arsip mendarat sebagai berkas apa adanya.

## Acceptance criteria

Bentuk EARS (`internal/docs/requirements/acceptance-criteria-ears-standard.md`).

**Buat**
- AC-1 · When operator menekan "+ File" dengan folder `src/ds` terpilih dan mengisi nama `Baru.tsx`,
  the system shall membuat `src/ds/Baru.tsx` kosong dan menampilkannya di pohon.
- AC-2 · When operator menekan "+ Folder", the system shall membuat direktori itu **beserta**
  `.gitkeep` di dalamnya.
- AC-3 · If path yang diminta sudah ada, then the system shall menjawab 409 dan tak menyentuh disk.

**Unggah**
- AC-4 · When operator mengunggah folder berisi sub-direktori, the system shall menulis ulang
  struktur itu di bawah folder tujuan.
- AC-5 · If sebuah berkas sudah ada dan `overwrite` tak diminta, then the system shall
  melewatinya, menyebutnya di `skipped` dengan `reason: "exists"`, dan tetap menulis sisanya.
- AC-6 · When operator memilih "Timpa semua", the system shall mengirim ulang **hanya** berkas
  yang bentrok dan menimpanya.
- AC-7 · If sebuah berkas melebihi 100 MB, then the system shall melewatinya
  (`reason: "too-large"`) tanpa menggagalkan berkas lain.
- AC-8 · If total badan melewati 2 GB, then the system shall berhenti membaca dan menandai
  sisanya `reason: "budget"`.

**Rename & hapus**
- AC-9 · When operator me-rename berkas terpilih, the system shall memindahkannya dan
  memindahkan seleksi viewer ke path baru.
- AC-10 · When operator menghapus folder sesudah mengetik ulang namanya, the system shall
  menghapus folder itu berikut isinya.
- AC-11 · If berkas yang sedang dibuka terhapus, then the system shall mengosongkan pane viewer.

**Keamanan & otorisasi**
- AC-12 · If path memuat `..`, komponen `.git`, atau symlink, then the system shall menolak
  dengan 400 pada keempat endpoint, tanpa menyentuh disk.
- AC-13 · Agent token tanpa `ide:write` shall menerima 403 `{ need: "ide:write" }` pada keempat
  endpoint; dengan `ide:write` shall diterima.
- AC-14 · Project dengan sesi aktif shall tetap menerima keempat operasi (tanpa 409).

## Test

**Server**
- `server/test/repo-fs.test.ts` (baru) — service murni atas `mkdtemp`: buat berkas/folder +
  `.gitkeep`, bentrok, rename termasuk `to` di dalam `from`, hapus rekursif, traversal `..`,
  komponen `.git`, symlink, atomicity (`.tmp` tak tertinggal saat gagal).
- `server/test/ide.route.test.ts` (tambah) — keempat endpoint: kode error tabel §8, unggah
  multipart dengan manifest (termasuk manifest tak cocok), `skipped` per alasan, `overwrite`,
  dan AC-14 (sesi aktif tak memblokir).
- `server/test/agent-capabilities.test.ts` (tambah) — `entry`/`upload` → `ide:write`, dan
  `GET` di keempatnya tak pernah lolos hanya karena prefix-nya `projects`.

**Frontend**
- `src/test/ide-file-ops.test.tsx` (baru) — tujuan mengikuti folder terpilih & label `→ …`,
  konfirmasi hapus folder menuntut nama diketik ulang, modal bentrok mengirim ulang hanya yang
  bentrok, seleksi kosong sesudah berkas terbuka dihapus.
- `src/test/api-client.test.ts` (tambah) — bentuk FormData: urutan `dir` → `overwrite` →
  `manifest` → berkas.
- `src/test/confirm-dialog.test.tsx` (tambah) — `requireText` mengunci tombol konfirmasi sampai
  teksnya cocok, dan tanpa prop itu dialog lama tetap bisa dikonfirmasi seketika.

Dijalankan dengan `pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism` dan
`TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (AGENTS.md · SPEC-479). Keempat endpoint
di-curl sekali di akhir terhadap server lokal yang benar-benar boot.

## Docs yang tersentuh

- `internal/docs/architecture/api-contract.md` — empat endpoint, bentuk multipart, tabel error.
- `internal/docs/adr/0121-operasi-berkas-ide-explorer.md` — ADR baru.
- `internal/docs/README.md` — entri index untuk ADR-0121 + satu baris di bagian architecture.

## Risiko

- **Nomor ADR bisa bentrok.** Worktree paralel mengalokasikan nomor dari `internal/docs/adr/`
  yang sama; 0120 adalah yang tertinggi saat spec ini ditulis. Verifikasi ulang tepat sebelum
  menulis berkasnya.
- **Unggahan besar menahan disk, bukan RAM.** Karena part di-stream (§4), yang bisa habis adalah
  ruang disk checkout, bukan memori. Batas 2 GB per request adalah pagarnya; berkas `.tmp` yang
  tertinggal karena koneksi putus dibersihkan di blok `finally` route, bukan oleh penyapu latar.
- **`webkitGetAsEntry` bukan standar.** Drop **folder** karena itu bisa tak bekerja di sebagian
  browser; drop **berkas** (`DataTransfer.files`) selalu bekerja dan jadi jalur mundurnya.
