# Audit SPEC-868 — "tombol Pilih folder tidak terlihat": tab basi, bukan regresi picker

**Laporan.** Fitur pilih folder dari device dilaporkan **belum tersedia** di Edit project, padahal
SPEC-858 sudah `done` dan ikut di v0.1.53. Severity `major`. Dugaan brief: bukan regresi kode,
melainkan instance yang menjalankan build lama. **Dugaan itu benar, dan penyebab presisinya lebih
sempit dari "instance lama": servernya sudah baru — yang lama adalah JavaScript di tab yang sudah
terbuka.**

Doc ini adalah **doc-of-record** perbaikan SPEC-868 (Spec & Plan `skipped`, ADR-0020/0040): temuannya
berconfidence tinggi dan diff-nya kecil.

## Ringkasan putusan

| Dugaan | Putusan |
|---|---|
| Regresi kode (tombol hilang) | **GUGUR** — kodenya utuh di HEAD |
| Tombol tersembunyi di viewport sempit/mobile | **GUGUR** — diukur di browser nyata 390/430/768/1440px |
| Picker tak terbuka saat diklik (modal bersarang) | **GUGUR** — terbuka di atas modal Edit, tombolnya bisa di-hit |
| Bundle lama tersaji server | **GUGUR** — kedua instance menyajikan tombolnya |
| **Tab yang sudah terbuka menjalankan JS pra-update** | **DITEGAKKAN** — lihat linimasa |

Tak ada baris kode SPEC-858 yang diubah. Yang ditambahkan adalah **pemberitahu muat-ulang** untuk
keadaan yang membuat laporan ini mustahil didiagnosis dari dalam dashboard.

## Bukti 1 — jalur kodenya hidup

`src/test/edit-project-folder-picker.test.tsx` → **3/3 lulus** di HEAD.

## Bukti 2 — kedua instance MENYAJIKAN tombolnya

Bundle yang benar-benar dilayani, di-grep langsung (bukan dibaca dari repo):

| Instance | Bundle | `Path (mesin ini)` diikuti tombol? |
|---|---|---|
| `http://localhost:8787` | `assets/index-C-zYP4Lu.js` | ya |
| `https://hanoman.nafanesia.id` | `assets/index-fCgQsVLZ.js` | ya |

Keduanya memuat potongan yang sama: `Fe` (`Input`) ber-`flex:1,minWidth:0` bersebelahan dengan
`B`/`P` (`Button`) `size:"sm", variant:"secondary", leftIcon:"folder-open"` berbunyi `"Pilih folder"`,
lalu `FolderPicker` ber-`onPick`. Header keduanya `cache-control: public, max-age=0` + `etag` —
**muat ulang selalu mengambil yang segar**, jadi cache HTTP bukan tersangka.

## Bukti 3 — browser nyata, empat lebar

Chrome headless (CDP, tanpa dependensi baru), `EditProjectModal` asli + `ds/styles.css` + `app.css`:

| Viewport | Tombol | Rect | Terpotong? | `elementFromPoint` |
|---|---|---|---|---|
| 390×844 | ada | 112×44 @ x=263 | tidak (−14px dari tepi body) | kena |
| 430×932 | ada | 112×44 @ x=303 | tidak | kena |
| 768×1024 | ada | 112×30 | tidak | kena |
| 1440×900 | ada | 112×30 | tidak | kena |

`whiteSpace: nowrap`, `visibility: visible`, `opacity: 1`, dan body modal **tak perlu digulir** untuk
mencapainya (`bottom - bodyBottom` = −176px di mobile). Klik pada 390 dan 1440: `FolderPicker`
terbuka — overlay kedua muncul (`overlays` 1→2), `position: fixed`, dan ia **tampil di atas** modal
Edit meski dirender sebagai keturunan panelnya; tombol "Pilih folder ini" hit-test bersih. Bersarang
di dalam `<Modal>` **tidak** mematikannya di sini (beda dari jebakan `{dialog}` `useConfirm`
ADR-0127, yang soal focus trap + `modalStack`, bukan soal paint).

## Bukti 4 — linimasa: baru, tapi baru saja

`9262fbb4` (SPEC-858) mendarat **20 Agu 20:30 WIB**. `git merge-base --is-ancestor`: **v0.1.52 TIDAK
memuatnya**, v0.1.53 memuat.

| Peristiwa | Waktu (WIB) |
|---|---|
| v0.1.52 terbit (tanpa SPEC-858) | 20 Agu 19:58 |
| `9262fbb4` SPEC-858 masuk main | 20 Agu 20:30 |
| tarball `hanoman-0.1.52` masuk mesin ini | 20 Agu 20:04 |
| v0.1.53 terbit ke npm | 21 Agu 05:43 |
| **tarball `hanoman-0.1.53` masuk mesin ini** | **21 Agu 05:56:58** |
| **VPS menyajikan bundle 0.1.53** (`last-modified`) | **21 Agu 06:46:47** |
| **SPEC-868 dilaporkan** | **21 Agu 06:56:25** |

Sumber waktu instal lokal: `~/.npm/_cacache/index-v5` (field `time` per entri tarball) — bukan mtime
berkas, yang sudah tertimpa update berikutnya. Sumber waktu VPS: header `last-modified` bundle.

Jadi di **kedua** instance, versi pembawa tombol itu baru berumur **59 menit** (lokal) dan **10
menit** (VPS) saat laporan ditulis — keduanya di dalam rentang satu kali duduk di depan dashboard.
Tab yang dibuka sebelum restart tetap menjalankan bundle lama sampai halamannya dimuat ulang.

## Akar masalah

**`view` frontend tak pernah tahu versi build-nya sendiri, dan satu-satunya sinyal versi yang ia
punya justru padam tepat saat ia jadi basi.**

- Frontend disajikan dari paket yang sama dengan server. `POST /api/update/apply` (ADR-0088) membuat
  server keluar `75`, supervisor memasang versi baru lalu menjalankannya ulang — sejak detik itu
  `index.html` + bundle ber-hash yang dilayani sudah berganti.
- Tab yang sudah ter-load tak memuat ulang apa pun. Ia terus polling `/api/*` dengan sukses (API
  kompatibel mundur), jadi **tak ada yang rusak** — pengguna cuma tak punya UI yang baru dirilis.
- `UpdateStatus.currentVersion` (versi proses server) sudah tiba di browser tiap frame WS grup
  `update`. Tapi `UpdateBadge` dirender **hanya saat `updateAvailable`** — dan tepat sesudah update
  terpasang nilai itu kembali `false`. **Tab paling basi justru yang paling terlihat "terkini".**

## Perbaikan

Perbandingan yang kurang, bukan data yang kurang — seluruh masukannya sudah sampai di browser.

`src/src/api/update.ts`

- `trackServerVersion(prev, currentVersion)` — reducer murni: frame pertama menetapkan versi tab ini
  (`boot`); `currentVersion` yang berbeda sesudahnya berarti server sudah di-restart ke versi lain →
  `restartedTo`. Versi kosong (dev/bundle belum ter-stamp) tak pernah dihitung drift, server yang
  kembali ke `boot` menghapus status basi, dan `prev` dipulangkan **apa adanya** saat tak berubah —
  `getSnapshot` `useSyncExternalStore` wajib referensial stabil sementara frame `update` datang tiap
  kali status registry di-recompute.
- `useServerRestartedTo()` membaca drift dari store yang sama dengan `useUpdate()` (satu WS,
  ref-count) — nol koneksi baru.
- `reloadPage()` diekspor tersendiri semata supaya bisa dipatok dari test; `location` milik jsdom tak
  bisa diganti dengan bersih.

`src/src/screens/UpdateIndicator.tsx` → `ReloadBadge`, dipasang di slot topbar yang sama dengan
`UpdateBadge` (`ds/shell.tsx`). Ia pasangan arah sebaliknya: `UpdateBadge` = "server ketinggalan
npm", `ReloadBadge` = "tab ini ketinggalan server". Keduanya hampir tak pernah muncul bersamaan.
Label panjang/ringkas mengikuti kontrak topbar mobile SPEC-763.

**Nol endpoint, kolom, field sync, maupun perubahan build** — karena itu tanpa ADR (preseden
SPEC-867).

### Yang sengaja TIDAK dilakukan

- **Tak ada auto-reload.** Memuat ulang halaman tanpa diminta bisa membuang apa yang sedang diketik
  operator. Ajakan, bukan tindakan.
- **Tak ada versi build yang ditanam ke bundle frontend.** Itu menuntut `define` Vite + perubahan
  pemaketan rilis, sementara "versi server berubah selagi tab ini hidup" sudah menutup persis mode
  gagal yang terukur: tab yang dibuka **sesudah** restart memang sudah segar.
- **Tak ada picker kedua.** Jalur SPEC-858 tak disentuh.

## Penawar operator

Bila sebuah fitur yang sudah dirilis "tidak ada" di dashboard: **muat ulang halaman lebih dulu**
(bundle-nya `max-age=0`, satu refresh cukup), baru curigai versi. Untuk memastikan versi server:
popover pil update memuat baris `terpasang <versi> · tersedia <versi>`.

## Test

| Berkas | Menjaga |
|---|---|
| `src/test/update-version-drift.test.ts` | reducer drift: frame pertama, drift, stabilitas referensi, versi kosong, rollback, restart kedua |
| `src/test/reload-badge.test.tsx` | badge diam saat sejalan; muncul + menyebut versi; judul menjelaskan "versi lama"; klik memuat ulang |
| `src/test/shell-reload-badge.test.tsx` | rantai penuh frame WS → store → topbar (menjaga agar perbaikannya tak terpasang mati) |
| `src/test/edit-project-folder-picker.test.tsx` | SPEC-858 tetap hidup (kontrol negatif) |
