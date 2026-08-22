# ADR-0115 — State tampilan dashboard persisten di storage, berkunci per layar

- Status: Accepted
- Tanggal: 2026-08-13
- SPEC: SPEC-740
- Terkait: **diamandemen sebagian oleh [0118](0118-workspace-terminal-kanonik-per-user.md)** untuk
  mapping kerja Terminal; **menegakkan** [0107](0107-paginasi-seragam-daftar-dashboard.md) (yang dipulihkan `page`,
  tak pernah `limit`) dan [0071](0071-link-ticket-triase-deeplink-sharetoken.md) (deep-link hash
  tetap menang atas state yang dipulihkan); **tidak** mencabut apa pun. Tak menyentuh
  [0038](0038-paginasi-di-response-layer.md), skema, maupun kontrak API — ini murni state klien.

## Konteks

Dashboard hanoman berpindah halaman lewat state `section` di `App.tsx` (`HN_NAV` di
`src/src/ds/shell.tsx`), bukan router URL. Tiap layar di-unmount begitu pengguna pindah, jadi seluruh
`useState`-nya hilang: tab stage, filter source/priority/status, kata kunci pencarian, rentang
tanggal, nomor halaman, posisi scroll, baris terpilih, drawer terbuka, sub-tab aktif.

Keluhan nyata: menyetel filter di Backlog → pindah ke Triase → balik ke Backlog, semua filter sudah
reset dan daftar harus disaring ulang dari nol. Hal yang sama terjadi saat refresh browser — dan
refresh **selalu** melempar balik ke Overview, karena `section` sendiri lahir dengan default
`"overview"`.

`localStorage` sebelum spec ini dipakai **dua** tempat saja — workspace grid Terminal
(`screens/terminal-workspace.ts`, kunci `hanoman.terminal.workspace`) dan flag sembunyikan Pet
(`screens/pet-state.ts`). Tak ada abstraksi bersama; keduanya menulis `try { … } catch { … }`
sendiri-sendiri. Tanpa satu mekanisme, layar ke-14 akan menambah tambalan ketiga.

## Keputusan

**Satu modul bersama `src/src/ui-state/`**, dipakai semua layar:

| berkas | isi | React? |
|---|---|---|
| `store.ts` | kunci, baca/tulis, guard bentuk, prune versi lama, pub/sub reset | tidak |
| `hooks.ts` | `usePersistedState`, `useScrollRestore` | ya |
| `ResetViewButton.tsx` | lencana "N filter aktif" + tombol "Reset tampilan" | ya |
| `index.ts` | barrel | — |

`store.ts` bebas React supaya bisa diuji langsung — pola yang sama dengan
`terminal-layout.ts`/`terminal-workspace.ts`.

**Kunci `hn.ui.v1.<screen>[@<scope>].<field>`.** Prefix `hn.ui` menamai domain; `v1` adalah versi
bentuk nilai; `<screen>` bebas dari `HN_NAV` supaya state milik App (`section`, `projectId`) juga
punya rumah; `@<scope>` untuk state yang memang per project (Docs, IDE, Changelog). **Versi hidup di
dalam kunci, bukan di dalam nilai**: menaikkan `v1 → v2` membuat seluruh state lama tak terlihat
tanpa satu baris migrasi, dan `pruneUiState()` (sekali saat App mount) menyapu sisanya.

**Nilai rusak jatuh ke default, tak pernah melempar.** `readUiState` membungkus `getItem` **dan**
`JSON.parse` di `try` (mode privat melempar saat diakses, bukan saat ditulis), lalu menguji bentuk.
Guard bawaan = *bentuk sama dengan `fallback`*; union/enum menyebut `accept` eksplisit (`oneOf`),
field nullable menyebut `nullableStr`.

**`localStorage`, bukan `sessionStorage`** — syaratnya bertahan melewati buka-ulang browser, yang
`sessionStorage` tak penuhi.

**Bukan URL.** Keputusan pengguna: app tak punya routing URL dan menambahkannya adalah pekerjaan
lain. Link yang bisa dibagikan adalah backlog terpisah. Deep-link hash yang sudah ada (`#spec=`,
`#changelog=`, ADR-0071) tetap apa adanya dan **menang** atas state yang dipulihkan — ia berjalan
sebagai effect sesudah mount, setelah nilai awal dibaca dari storage.

**Reset lewat pub/sub.** Menghapus kunci saja tak cukup: komponen yang sedang ter-mount memegang
nilainya di `useState`. `resetUiState(screen)` menghapus kunci ber-prefix itu lalu memancarkan
peristiwa; setiap `usePersistedState` yang kuncinya cocok kembali ke nilai awal. Satu panggilan, nol
prop drilling, dan layar baru ikut dapat perilakunya. `ResetViewButton` sekaligus merender lencana
**"N filter aktif"** — memenuhi syarat "filter yang dipulihkan harus terlihat menyala", supaya daftar
yang tampak kosong tak disalahartikan sebagai data kosong.

**Scroll dipulihkan sesudah konten ada.** `useScrollRestore` menyimpan `scrollTop` (dikoalesir per
frame) dan memulihkannya setelah `ready` lewat loop `requestAnimationFrame` **berbatas**, berhenti
begitu `scrollHeight - clientHeight` cukup menampung nilai tersimpan. Dipasang di **dua** tempat:
`<main>` milik `Shell` (berkunci section aktif — tiap halaman, termasuk yang belum ada, dapat
pemulihan scroll dari satu titik) dan container daftar Backlog/Projects/Triase.

## Cakupan

Semua entri `HN_NAV`. Overview dinyatakan **tak punya state tampilan**, supaya "tidak dikerjakan" tak
terbaca sebagai "terlewat".

| screen | scope | field |
|---|---|---|
| `app` | — | `section` (guard `NAV_KEYS`), `projectId`, `projectFilter` |
| overview | — | *tak ada state tampilan* |
| projects | — | `q` (search topbar, state-nya di App), `page`, scroll daftar |
| prd | — | `status`, `sel` (slug PRD terpilih) |
| backlog | — | `tab`, `view`, `q`, `stage`, `prio`, `dateField`, `from`, `to`, `page`, `detailId`, scroll |
| triage | — | `tab`, `project`, `status`, `q`, `page`, `openId`, scroll |
| scheduler | — | `queue-<status>-page` (tiga seksi), `cronRunsPage`, `cronProject`, `cronOpenRuns` |
| lead | — | `filter`, `decPage`, `flowPage` |
| terminal | — | `project`; mapping grid dipindah ke server per user oleh ADR-0118 |
| ide | project | `tab`, `viewRef`, `selected`, `selKind`, `mdView`, `stagedView`, `changedView`, `diffTab` |
| vps | — | `detailId` |
| docs | project | `selected` |
| changelog | project | `q`, `page`, `selectedId` |
| settings | — | `tab` |

**Sengaja tidak** dipersist: draft editor (`draft`, `form`, `mode: "edit"`), state
`busy`/`loading`/`error`, data itu sendiri, dan section `project`/`review`. Tak ada data sensitif dan
tak ada payload besar yang masuk storage: hanya nilai filter, angka halaman, offset scroll, dan
id/path terpilih. Entri yang menyimpan objek (`sel` PRD, `selectedId` Changelog, `detailId` VPS)
menyimpan **id/slug**-nya saja lalu meresolusi ulang dari daftar hidup.

## Alternatif yang ditolak

- **Router + query string.** Memberi link yang bisa dibagikan, tapi mengubah bentuk navigasi seluruh
  app dan tak memenuhi "bertahan setelah buka-ulang browser" tanpa storage juga. Ditolak eksplisit
  oleh pengguna untuk backlog ini.
- **Satu blob JSON per layar** (`hn.ui.v1.backlog = {...}`). Lebih sedikit kunci, tapi menambah field
  berarti memigrasi bentuk blob, dan satu field rusak menjatuhkan seluruh layar ke default. Kunci
  per-field membuat kerusakan berskop satu nilai.
- **State tampilan murni di server per user.** Menambah kolom/tabel + endpoint untuk filter, scroll,
  fullscreen, atau panel aktif tetap ditolak. ADR-0118 kemudian mengecualikan mapping kerja Terminal:
  grup/grid/`sessionId` adalah orientasi sesi lintas perangkat, bukan presentasi satu browser.

## Konsekuensi & gotcha

1. **`usePersistedState` menyimpan nilai BESERTA kuncinya.** Saat scope project berganti, effect
   penulis akan menyimpan nilai project **lama** di bawah kunci project **baru** bila nilai dan kunci
   disimpan terpisah. Sinkronisasinya karena itu dilakukan **saat render**
   (`if (snap.key !== key) setSnap(…)`), bukan di effect.
2. **Pemulihan scroll wajib membisukan penulisnya.** Menyetel `scrollTop` memancarkan event `scroll`;
   percobaan pertama (konten masih pendek) akan menulis balik nilai **terpotong** dan menghapus
   posisi aslinya sebelum konten sempat tumbuh. Karena itu ada penanda `restoring`, dan loop rAF
   **berbatas** (`RESTORE_FRAMES = 20`) supaya daftar yang memang lebih pendek tak jadi loop abadi.
3. **`section` yang dipulihkan digerbangi `NAV_KEYS`.** `project`/`review` bergantung pada state
   transien (`proj`/`review`) yang tak ikut dipulihkan — memulihkannya berarti mendarat di layar
   kosong; key mati (`runs`/`triggers`, SPEC-162) membuat App merender kosong berikut sidebar-nya
   (gotcha SPEC-519).
4. **`limit` tak pernah dipulihkan, hanya `page`.** `limit` tanpa `page` berperilaku sebagai
   **PLAFON** (SPEC-523 · ADR-0107), jadi memulihkannya diam-diam mengubah ukuran halaman.
5. **`src/test/setup.ts` wajib mengosongkan `localStorage` tiap test.** vitest memakai satu jsdom per
   berkas; tanpa itu test pertama yang menyetel filter mewariskannya ke test berikutnya di berkas
   yang sama, dan kegagalannya terbaca seperti regresi komponen.
6. **`ResetViewButton` mengimpor komponen DS dari berkasnya langsung**, bukan dari barrel `../ds`:
   barrel itu mengekspor `Shell`, dan `Shell` mengimpor `useScrollRestore` dari modul ini — lewat
   barrel keduanya jadi lingkaran impor yang mati saat inisialisasi modul. Dengan alasan yang sama
   `shell.tsx` mengimpor dari `../ui-state/hooks`, bukan `../ui-state`.
7. **Reset berskop satu layar.** State yang dipakai sebuah layar tapi dimiliki App (`projectFilter` di
   Backlog) di luar jangkauan `resetUiState(screen)` — layar menanganinya lewat prop `onReset`.
8. **`useEffect(() => setPage(1), [filter])` MEMBATALKAN `page` yang dipersistensi.** Effect
   ber-dependensi juga menyala saat **mount**, jadi pola "ganti penyaring → halaman 1" yang ditulis
   tanpa pagar menghapus nomor halaman tersimpan setiap layar dibuka — barisnya tetap ada di tabel
   Cakupan, tetapi janjinya tak pernah bisa ditepati dan tak ada satu pun error yang muncul.
   Pakai **`useResetOnChange(key, reset)`** (`ui-state/hooks.ts`): ia membandingkan penyaring yang
   SEDANG ditampilkan dengan yang baru dan menjalankan `reset` hanya saat keduanya berbeda. `key`
   disatukan pemanggil (`JSON.stringify([...])`) supaya panjang dep array-nya konstan. Dipasang di
   keempat layar yang `page`-nya persisten — Lead, Triase, Projects, Backlog (SPEC-908); layar
   dengan `page` transien (`SessionHistoryModal`, `PortalChatPanel`, `ClientPortal`) tak terdampak
   dan sengaja dibiarkan memakai `useEffect` biasa.
9. **Penyaring ber-debounce wajib DI-SEED dari nilai yang dipulihkan.** `BacklogScreen` menurunkan
   `dq` dari `q` lewat `setTimeout` 250 ms. Lahir dari string kosong, `dq` menyusul sesudah mount
   dan gotcha #8 menyala lagi lewat pintu belakang: halaman tersimpan selamat dari mount, lalu
   dihapus seperempat detik kemudian. Sebelum itu layar juga sempat menyajikan hasil **tanpa**
   filter yang sedang menyala. Karena itu `React.useState(() => q.trim())`, bukan `useState("")`.

## Yang tidak berubah (dengan amandemen ADR-0118)

Implementasi SPEC-740 sendiri tidak mengubah skema atau API. Flag Pet tetap pada kuncinya. Sejak
SPEC-786/ADR-0118, `hanoman.terminal.workspace` dipertahankan hanya sebagai input migrasi satu kali;
mapping kanonik pindah ke server per user, sementara state presentasional Terminal tetap lokal.
