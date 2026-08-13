# SPEC-740 — State tampilan tiap halaman bertahan lintas navigasi & refresh

> Design doc · 2026-08-13 · sumber brief · prioritas sedang
> ADR baru: **0115 — State tampilan dashboard persisten di storage, berkunci per layar**

## Masalah

Dashboard hanoman berpindah halaman lewat state `section` di `App.tsx` (`HN_NAV` di
`src/src/ds/shell.tsx`), bukan router URL. Tiap layar di-unmount begitu pengguna pindah,
jadi seluruh `useState` lokalnya hilang: tab stage, filter source/priority/status, kata
kunci pencarian, rentang tanggal, nomor halaman, posisi scroll, baris terpilih, drawer
terbuka, sub-tab aktif.

Keluhan nyata: menyetel filter di Backlog → pindah ke Triase → balik ke Backlog, semua
filter sudah reset dan daftar harus disaring ulang dari nol. Hal yang sama terjadi saat
refresh browser — dan refresh selalu melempar balik ke Overview karena `section` sendiri
lahir dengan default `"overview"`.

Verifikasi awal: `localStorage` hari ini dipakai **dua** tempat saja — workspace grid
Terminal (`screens/terminal-workspace.ts`, kunci `hanoman.terminal.workspace`) dan flag
sembunyikan Pet (`screens/pet-state.ts`). Tak ada abstraksi bersama; keduanya menulis
`try { … } catch { /* mode privat / kuota penuh */ }` sendiri-sendiri.

## Keputusan bentuk

### 1. Persistensi lewat storage, bukan URL

Ditetapkan oleh brief dan tidak diperdebatkan ulang di sini: app tak punya routing URL,
dan menambahkannya adalah pekerjaan yang berbeda (link yang bisa dibagikan → backlog
terpisah). Deep-link hash yang sudah ada (`#spec=`, `#changelog=`, ADR-0071) tetap
sebagaimana adanya dan **menang** atas state yang dipulihkan.

### 2. `localStorage`, bukan `sessionStorage`

Objektif menuntut state bertahan melewati **buka-ulang browser**. `sessionStorage` mati
saat tab ditutup, jadi ia gagal memenuhi syarat itu. Satu store untuk semua field —
membelah sebagian field ke `sessionStorage` hanya menambah aturan yang harus diingat
tiap layar baru.

### 3. Satu abstraksi, bukan tambalan per layar

Modul baru `src/src/ui-state/`:

| berkas | isi | React? |
|---|---|---|
| `store.ts` | kunci, baca/tulis, guard bentuk, prune versi lama, pub/sub reset | tidak |
| `hooks.ts` | `usePersistedState`, `useScrollRestore` | ya |
| `ResetViewButton.tsx` | lencana "N filter aktif" + tombol "Reset tampilan" | ya |
| `index.ts` | barrel | — |

`store.ts` sengaja bebas React/DOM-API-React supaya bisa diuji langsung — pola yang sama
dengan `terminal-layout.ts`/`terminal-workspace.ts`.

### 4. Bentuk kunci: `hn.ui.v1.<screen>[@<scope>].<field>`

- Prefix `hn.ui` menamai domain; `v1` adalah versi bentuk nilai.
- `<screen>` = nama layar (`backlog`, `triage`, `app`, …), bebas dari `HN_NAV` supaya
  state milik App (`section`, `projectId`) juga punya rumah.
- `@<scope>` opsional untuk state yang memang **per project** (Docs, IDE, Changelog):
  `hn.ui.v1.changelog@erp-tumbuh-ai.q`. Tanpa ini filter project A muncul saat membuka
  project B.
- `<field>` = nama field.

**Versi hidup di dalam kunci**, bukan di dalam nilai. Konsekuensinya: menaikkan `v1 → v2`
membuat seluruh state lama **tak terlihat** tanpa satu baris kode migrasi, dan
`pruneUiState()` (dipanggil sekali saat App mount) menyapu kunci `hn.ui.` yang versinya
bukan versi berjalan supaya storage tak tumbuh selamanya.

### 5. Nilai rusak jatuh ke default, tak pernah melempar

`readUiState(key, fallback, accept?)`:

1. `localStorage.getItem` di dalam `try` (mode privat melempar saat diakses).
2. `JSON.parse` di dalam `try` → gagal = fallback.
3. Guard bentuk. Default guard = **bentuk sama dengan `fallback`**: `typeof` cocok,
   array-ness cocok, `null` hanya sah bila fallback-nya `null`. Ini menutup kelas
   "`page` tersimpan sebagai `"abc"` lalu `Pager` menghitung `NaN`" tanpa tiap call site
   menulis guard sendiri.
4. `accept?: (v: unknown) => v is T` untuk union/enum (mis. `section` wajib salah satu
   key `HN_NAV`; `view` wajib `grid|list|board`).

Tulisan juga di dalam `try` (kuota penuh) — cermin dua call site yang sudah ada.

### 6. Reset: hapus storage **dan** kembalikan state di layar

Menghapus kunci saja tak cukup — komponen yang sedang ter-mount memegang nilainya di
`useState`. Store karena itu punya pub/sub mungil: `resetUiState(screen, scope?)`
menghapus semua kunci ber-prefix itu lalu memancarkan peristiwa; setiap
`usePersistedState` yang kuncinya cocok mengembalikan dirinya ke nilai awal. Satu
panggilan, nol prop drilling, dan layar baru ikut dapat perilakunya.

`<ResetViewButton screen scope active>` merender:
- lencana **`N filter aktif`** saat `active > 0` — memenuhi syarat "filter yang dipulihkan
  harus terlihat menyala", sehingga daftar yang tampak kosong tak disalahartikan sebagai
  data kosong;
- tombol ghost **Reset tampilan** (`rotate-ccw`).

`active` dihitung layar (hanya layar itu yang tahu default-nya).

### 7. Scroll dipulihkan sesudah konten ada

`useScrollRestore(screen, field, ready)` mengembalikan ref untuk dipasang ke elemen
bergulir. Ia:

- menyimpan `scrollTop` pada event `scroll` (dikoalesir lewat `requestAnimationFrame`);
- memulihkan **setelah `ready`** dengan loop rAF **berbatas** (maks. ~20 frame): tiap
  frame mencoba menyetel `scrollTop`, dan berhenti begitu `scrollHeight - clientHeight`
  sudah cukup untuk menampung nilai tersimpan. Tanpa loop ini posisi meleset karena tinggi
  konten belum final saat data baru selesai dimuat; dengan batas frame ia tak pernah jadi
  loop abadi pada daftar yang memang lebih pendek.

Dua tempat pemasangan:
- **`<main>` di `Shell`**, berkunci `section` aktif → tiap halaman (termasuk yang belum
  ada) dapat pemulihan scroll tingkat-halaman dari satu titik;
- **container daftar** (`LIST_SCROLL_STYLE`) di Backlog, Projects, dan Triase — di sanalah
  daftar panjang sebenarnya bergulir.

### 8. Sesuai kontrak paginasi yang sudah ada (SPEC-523 / ADR-0107)

Yang dipulihkan adalah **`page`**, bukan `limit`. `pageSize` tetap konstanta layar seperti
sekarang, jadi jebakan "`limit` tanpa `page` berperilaku sebagai PLAFON" tak tersentuh.
Efek `setPage(1)` saat filter berubah tetap ada dan tetap benar: ia hanya menyala saat
filter benar-benar berganti, bukan saat state dipulihkan (pemulihan terjadi di
inisialisasi, sebelum efek pertama membandingkan nilai).

## Cakupan layar

Semua entri `HN_NAV`. Yang tak punya state tampilan dinyatakan eksplisit agar "tidak
dikerjakan" tak terbaca sebagai "terlewat".

| screen | scope | field yang dijaga |
|---|---|---|
| `app` | — | `section` (guard: key `HN_NAV` saja), `projectId`, `projectFilter` |
| overview | — | *tak ada state tampilan* |
| projects | — | `q` (search topbar, state-nya di App), `page`, scroll daftar |
| prd | — | `status`, `sel` (slug PRD terpilih) |
| backlog | — | `tab`, `view`, `q`, `stage`, `prio`, `dateField`, `from`, `to`, `page`, `detailId`, scroll daftar |
| triage | — | `tab`, `project`, `status`, `q`, `page`, `openId`, scroll daftar |
| scheduler | — | `queue.<status>.page` (tiga seksi antrean), `cronProject`, `cronOpenRuns` |
| lead | — | `filter`, `decPage`, `flowPage` |
| terminal | — | `project` (workspace grid **sudah** persisten lewat kunci lamanya — tak disentuh) |
| ide | project | `tab`, `viewRef`, `selected`, `selKind`, `mdView`, `stagedView`, `changedView`, `diffTab` |
| vps | — | `detailId` (modal detail yang terbuka) |
| docs | project | `selected` (path dokumen) |
| changelog | project | `q`, `page`, `selectedId` |
| settings | — | `tab` (sub-tab) |

Yang **sengaja tidak** dipersist: draft editor (`draft`, `form`, `mode: "edit"`), state
`busy`/`loading`/`error`, isi data itu sendiri, dan section `project`/`review` (keduanya
bergantung pada state transien `proj`/`review` yang tak ikut dipulihkan — memulihkannya
berarti mendarat di layar kosong). Guard `section` yang hanya menerima key `HN_NAV`
menutup itu secara struktural.

Tak ada data sensitif dan tak ada payload besar yang masuk storage: yang disimpan hanya
nilai filter, angka halaman, offset scroll, dan id/path terpilih.

## Isolasi test

`src/test/setup.ts` mendapat `beforeEach(() => localStorage.clear())`. Tanpa itu state
yang baru saja jadi persisten **bocor antar-test di dalam satu berkas** (vitest memakai
satu jsdom per berkas): test pertama menyetel filter, test kedua merender layar yang sama
dan mewarisinya. Empat berkas test yang sudah memakai `localStorage` semuanya menyemai
nilainya **di dalam** test, jadi hook global ini tak mengubah artinya — hook `setupFiles`
berjalan sebelum hook tingkat-berkas.

Karena berkas ini dibaca setiap test web, verifikasi diperluas ke seluruh project `src`
(bukan hanya berkas yang berubah) — alasan disebutkan saat melapor.

## Test

**Store murni** (`src/test/ui-state.test.ts`)
- bentuk kunci, dengan & tanpa scope;
- simpan → muat round-trip;
- JSON rusak → default (tanpa melempar);
- tipe salah (`page: "abc"`, `q: 42`) → default;
- `accept` menolak nilai di luar union → default;
- versi kunci berubah → nilai lama tak terbaca; `pruneUiState()` membuangnya dan
  **tak menyentuh** kunci non-`hn.ui.` (`hanoman.terminal.workspace` tetap utuh);
- `resetUiState(screen)` hanya menghapus kunci layar itu (dan hanya scope-nya, bila diberi).

**Hook** (`src/test/ui-state-hooks.test.tsx`)
- `usePersistedState` bertahan lintas unmount/remount;
- peristiwa reset mengembalikan nilai awal pada komponen yang sedang ter-mount;
- `useScrollRestore` menulis `scrollTop` saat scroll dan memulihkannya setelah `ready`
  (elemen palsu ber-`scrollHeight`/`clientHeight` lewat `Object.defineProperty` —
  jsdom tak melakukan layout).

**Layar** (`src/test/screen-state-persist.test.tsx`)
- Backlog: setel q + stage + prioritas + halaman → unmount → remount → semuanya kembali,
  lencana "N filter aktif" tampil, "Reset tampilan" mengembalikan ke default;
- Triase: setel status + q → unmount → remount → kembali;
- App: `section` terakhir dipulihkan saat mount; nilai tak dikenal (`"runs"`) jatuh ke
  `overview`; hash `#spec=` menang atas section tersimpan.

Test web dijalankan dengan `env -u NODE_ENV`. Berkas test yang me-mock `api` sebagian
wajib menyebut `getMethodStatus` (SPEC-739).

## Yang tidak berubah

Tanpa perubahan skema Prisma, tanpa endpoint baru, tanpa perubahan kontrak API. Murni
state klien. `hanoman.terminal.workspace` dan flag Pet tetap pada kuncinya masing-masing —
memindahkannya ke namespace baru berarti kehilangan state pengguna yang sudah ada, dengan
imbalan nol.
