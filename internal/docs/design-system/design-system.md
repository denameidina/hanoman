# Design system — hanoman

Estetika **editorial instrument-panel**: bone paper hangat, ink text, satu aksen **brass** (gold-leaf wayang). Font IBM Plex (Serif display, Sans UI, Mono data/label). Hairline 1px, radius kontrol 5px / kartu 12px. Semantik earthy (leaf/amber/clay). Dua permukaan gelap: terminal log dan panel Dalang ([ADR-0208](../adr/0208-dalang-papan-senyap-pengecualian-gelap.md)), keduanya memakai token `--term-*`.

Detail token & komponen ada di paket design system terpisah (Hanoman Design System). Frontend wajib memakai token & komponennya — jangan menciptakan warna/tipografi baru.

## Sistem responsif bersama (SPEC-763)

Hanoman memakai satu struktur komponen untuk seluruh ukuran layar; tidak ada salinan screen mobile.
Tiga tier presentasinya bersifat kontrak:

| tier | lebar viewport | chrome |
|---|---:|---|
| mobile | `<768px` | navigation drawer; konten satu kolom; master/detail dan workspace memakai pemilih panel |
| tablet | `768–1199px` | navigation rail 72px; split-pane dipakai bila ruangnya memadai |
| desktop | `≥1200px` | sidebar 248px; perilaku split-pane desktop |

Boundary hidup di `ds/responsive.tsx` (`responsiveTier`/`useResponsiveTier`) dan token layout hidup
di `ds/tokens/spacing.css`. Media query CSS dan hook JS wajib memakai batas yang sama: mobile
berakhir di 767px, tablet di 1199px. Lebar viewport adalah state presentasi sementara dan **tidak
boleh dipersist** bersama state tampilan ADR-0115.

Primitive bersama:

- `ResponsivePanels` mempertahankan instance panel dan selection yang sama: mobile menampilkan satu
  panel lewat `Tabs`, layar lebar menampilkan panel-panel itu sebagai split-pane. `splitAt` menentukan
  apakah tablet sudah split atau masih memakai pemilih; pergantian viewport tidak boleh mereset data,
  editor, pilihan item, atau workspace. Ketika panel aktif berganti pada mode selector, fokus pindah
  ke region aktif; grid satu panel selalu memakai lebar penuh.
- `ResponsiveToolbar` membungkus kontrol secara alami; `LocalOverflow` menjadi pemilik overflow
  mendatar untuk tabel, kode, diff, graph, board, dan terminal. Shell/page sendiri selalu
  `min-width:0` dan `overflow-x:hidden` — overflow lokal tidak boleh merambat ke halaman. `LocalOverflow`
  wajib membungkus konten yang punya lebar intrinsik: anak **blok** selalu selebar induknya, jadi
  scroller yang membungkusnya tak pernah punya konten lebih lebar untuk digulir (SPEC-879).
- **Papan kolom** (`.hn-bl-board`, `.hn-tm-board`): kolom Backlog bertetap lebar (`flex: 0 0 248px`); kolom Tim
  lentur (`flex: 1 1 220px; min-width: 200px`) agar empat kolom muat di 1280 tanpa terpotong; di tablet (768–1199)
  kolomnya berbagi lebar (`flex: 1 1 0; min-width: 150px`) agar empat kolom muat di 768 (4×150 + 3×8 ≤ 656 px
  konten), karena 4×200 meluap di 820 dan kolom "Selesai" terpotong tanpa penanda. Kolom yang bertetap
  lebar hanya tersusun mendatar bila papannya `display: flex`; papan itu sendiri menggulir mendatar (`overflow-x: auto`).
  Di ponsel kolom menumpuk satu kolom. Dikunci `src/test/board-layout-css.test.ts` (tiap kolom bertetap lebar
  wajib punya papan induk flex/grid).
- `.hn-ide-head` + `.hn-ide-toolbar` adalah baris kepala layar IDE: strip tab `flex: 0 0 auto` di
  samping toolbar ber-**basis dinyatakan** `flex: 1 1 480px`. Basis itu, bukan lebar isi (`auto`), yang
  memutuskan pecah-baris, sehingga bentuk kepala tak berubah hanya karena label tab aktif ditebalkan atau
  nama project bertambah panjang (dasar SPEC-879, tetap berlaku). **Toolbar IDE tidak lagi menggulir**:
  ini membalik aturan SPEC-879 untuk toolbar. Di `ide.css`, `.hn-ide-head > .hn-ide-toolbar` memakai
  `flex-wrap: wrap; overflow: visible`, sehingga kontrolnya membungkus di dalam toolbar dan tak ada
  scroller mendatar yang menyembunyikan selector cabang (Audit UI/UX 2026-10, QA P1). Selector project dan
  ref boleh menyusut (`min-width: 0`, `flex: 1 1 140px`, maksimum 320 px dan 220 px, teks dipotong ellipsis
  dengan `title` berisi nama lengkap). Di ponsel (≤ 767 px) project mengambil baris penuh sendiri, dan ref
  serta tombol mengalir di bawahnya. Override ini hidup di `ide.css`, bukan `app.css`, karena `app.css`
  masih memuat `nowrap` dan `overflow-x: auto` untuk toolbar yang sama; selektor dua kelasnya menang tanpa
  bergantung urutan pemuatan.
- **Pet Hanoman duduk di alur layout, tak pernah melayang** ([ADR-0206](../adr/0206-pet-footer-sidebar-default-per-tier.md), menggantikan sebagian [ADR-0144](../adr/0144-pet-diseret-sumbu-y-jalur-melebar.md)). Pet dibuat sekali di `App` dan disalurkan lewat
  `PetDockContext`; `Shell` menaruhnya di slot-nya. Desktop (≥1200): **footer sidebar** (`.hn-shell-dock`, di
  bawah daftar hub, `margin-top: auto`). Tablet dan ponsel: **lajur di bawah `<main>`** (`.hn-shell-lane`),
  sehingga area gulir berakhir di atasnya dan tak ada kontrol yang tertutup. Di lajur itu pet selalu duduk
  sebagai **chip** setinggi 56 px, rata kanan (tombol bangkitkan 44 px); dibangkitkan, sprite-nya melayang di
  atas lajur sebagai overlay sementara dan lajur tetap 56 px. Slot kosong (`:empty`) tak memesan ruang. Overlay
  yang disengaja: gelembung bicara, panel status, dan sprite yang dibangkitkan di tablet/ponsel; semuanya
  sementara dan ditutup Esc atau klik di luar (sprite tablet/ponsel juga, kecuali Esc saat panel terbuka,
  yang menutup panel dulu). Pet yang diseret boleh melayang saat diangkat; lajurnya tak pernah melebar. Lebar jalur hanya dari ukuran slot
  (root pet, `width: 100%`): belum terukur = 0, dan pet tak dirender; tanpa fallback ke lebar viewport. Desktop
  pendek (≤ 760 px tinggi, `PET_COMPACT_QUERY`) menciutkan pet ke chip sampai dibangkitkan, sementara, tanpa
  menyimpan preferensi, supaya 8 hub + footer muat tanpa gulir di 661 px.
- **Default per tier, dan pilihan eksplisit.** Preferensi `hn.ui.v1.pet.enabled` (`ui-state/pet-pref.ts`;
  `null` = belum dipilih): desktop tampil, tablet dan ponsel **mati** (lajur 0). Palet "Tampilkan Hanoman" dan
  "Sembunyikan Hanoman" menulisnya. "Sembunyikan" di panel pet menciutkan ke chip di desktop dan mematikan
  pet di tablet/ponsel. Pengaturan › Sesi harian punya baris "Tampilkan Hanoman (pet)" (Default · Tampilkan ·
  Sembunyikan) yang membaca dan menulis preferensi yang sama lewat `usePetEnabled()`. Preferensi ini per browser
  dan tak pernah disimpan ke server.
- **Tak ada sinyal penting yang hanya ada di pet.** Keputusan sesi tetap sampai lewat notifikasi `decision`
  (toast dan bell dengan aksi "Jawab"), layar Terminal (`awaiting`), dan "Jawab sesi yang menunggu" di palet.
  Dalang (layar penuh tanpa Shell, [ADR-0208](../adr/0208-dalang-papan-senyap-pengecualian-gelap.md)) tak punya slot, sehingga pet tak tampil di sana.
- `--pet-h` hanya dipublikasikan (tinggi sel) untuk satu hal: bar `position: fixed` di ponsel (aksi QA) yang
  ikut naik di atas lajur. `.hn-shell-main` tak lagi memesan ruang pet. Dokumen (`html`/`body`) tak pernah
  menggulir: satu-satunya scroller adalah `.hn-shell-main` atau scroller 100dvh milik permukaan mandiri.
- `--page-gutter-x/y`, `--sidebar-w`, `--touch-target`, dan `--safe-*` adalah token lintas-screen.
  Semua kontrol utama memiliki area sentuh minimum 44×44px pada pointer kasar/mobile, meskipun
  kepadatan visual desktop boleh tetap lebih kecil.

Root aplikasi memakai fallback `100vh` lalu `100dvh`; permukaan mandiri Auth, Help Center, dan
portal klien memiliki scroller tegak berbatas `100dvh`. Overlay tetap dijangkau ketika browser
chrome, notch, atau keyboard virtual mengubah viewport: Modal menjadi sheet pada mobile, menghormati
`env(safe-area-inset-*)`, badan dialog menggulir, footer membungkus, dan fokus dikurung lalu
dikembalikan ke pemicu. Pet/Toast/fullscreen juga memakai safe-area. Semua animasi dan transition
mati melalui query global `prefers-reduced-motion: reduce` tanpa menghilangkan status atau aksi.

Navigation, tab, row, serta action memakai elemen native `button`/`select` atau pola ARIA yang setara.
Drawer dan Modal wajib punya label, state expanded/open, Escape, focus trap, serta focus restore.
Konfirmasi destruktif memakai dialog aplikasi (`ConfirmDialog` lewat `useConfirm`), tak pernah dialog
native browser: ia menyebut nama objeknya, dampaknya sebagai daftar terstruktur, dan label aksi yang
eksplisit (bukan "OK"), memakai ikon yang cocok dengan aksinya alih-alih memaksa ikon hapus, dan
mematikan cancel/confirm/close/Escape selama mutasinya berjalan sehingga submit ganda mustahil.
Konten di belakang drawer menjadi `inert`. Popover topbar memakai `usePopoverFocus`: fokus masuk,
Escape/outside-click menutup, fokus kembali, dan menu mendukung Arrow/Home/End.
Target responsif bukan menyederhanakan fitur: data, status, field penting, dan aksi yang tersedia di
desktop wajib tetap dapat dicapai di tablet/mobile; yang berubah hanya susunan dan cara berpindah panel.

**Topbar ponsel (Audit UI/UX 2026-10 · P2).** Satu baris 44 px di dalam padding 6 px (topbar 56 px): menu,
judul (ellipsis), cari (ikon, membuka palet ⌘K), notifikasi, akun. Lencana sekunder (update, batas) dan crumb
(deskripsi layar) disembunyikan. Baris kedua 40 px hanya ada bila layar memakainya: pilihan project, kotak cari
layar, dan aksi halaman (`.hn-shell-subrow`). Bar tab hub (`SectionTabs`) satu baris yang menggulir dengan fade,
di atas konten. Di rail tablet, badge hitungan absolut di pojok ikon dan ikon nav tak menyusut (`flex: 0 0 auto`).

**Topbar tablet (QA run3 · P2).** Judul dan alat satu baris (alat `nowrap`); lencana update dan batas memakai bentuk
pendek; crumb dan judul di semua tier satu baris dengan elipsis. Baris kedua (project, cari, aksi) hanya bila layar
memakainya, dan menggulir mendatar sendiri. Target: ≤ 64 px tanpa baris kedua, +40 px dengan baris kedua.

**Topbar desktop (QA run4 · P2).** Alat topbar tak pernah membungkus (`flex-wrap: nowrap` di semua tier; dulu
`wrap` di desktop memindahkan avatar Akun ke baris kedua di /review dan topbar jadi 79 px). Yang menyusut adalah
crumb/judul dan baris kedua (project, cari, aksi) dengan elipsis; tombol dan lencana alat utuh. Topbar 56 px di
semua rute. Dikunci `src/test/responsive-chrome-css.test.ts`.
**Daftar hub yang meluap** diberi cue gulir (`data-cue-start/end` di `.hn-shell-nav`, dihitung di `shell.tsx`), dan hub
aktif digulir ke layar saat pindah layar.

## Kontras, konfirmasi, dan error (Audit UI/UX 2026-10 · Fase 1)

Fase 1 [audit UI/UX](../frontend/ui-ux-audit-2026-10.md) menutup token yang gagal WCAG AA dan
menetapkan aturan perilaku yang dulu dilanggar diam-diam. Nilai token dibaca dari
`src/src/ds/tokens/colors.css`; rasio di komentar berkas itu dihitung dari hex, bukan diukur di browser.

| token | nilai | alasan |
|---|---|---|
| `--text-subtle` | `#776853` (dulu `ink-400` `#90826c`) | 5,31:1 di kartu `#fffdf8`, 5,00:1 di page `#faf6ec`, 4,55:1 di panel `#f2ebdc`. Dipakai sebagai teks sekunder. |
| `--amber-700` | `#8f5a0f` (baru) | Teks warning: 5,68:1 di kartu, 4,86:1 di panel, 4,80:1 di tint `--amber-100`. |
| `--status-warn` | `var(--amber-700)` | Dipakai sebagai teks. Tint tetap `--amber-100`. |
| `--amber-600` | `#b3771a` (tak berubah) | Hanya **fill** (titik, border). 3,7:1 di kartu; komentar `colors.css` melarangnya sebagai teks. |
| `--border-strong` | `var(--ink-400)` (dulu `bone-400`) | Batas kontrol (input, checkbox, tombol secondary). `bone-400` 1,51:1 di kartu; `ink-400` 3,69:1 kartu, 3,48:1 page, 3,16:1 panel. WCAG 1.4.11 minimal 3:1. |
| `--border-focus` | `var(--brass-600)` (dulu `brass-500`) | `brass-500` 2,99:1 di page. `brass-600` 4,83:1 kartu, 4,55:1 page, 4,14:1 panel, 3,60:1 di `--term-bg` (fokus di panel Dalang gelap). |
| `--accent-on` | `var(--ink-900)` | Teks dan ikon tombol primer di atas `--accent` (brass-500): 5,74:1. Override putih di `app.css` (≈3,2:1) dihapus. Tombol danger tetap `#fff` lewat inline style di `ds/components/forms.tsx`. |

Alias untuk nama yang dipakai TSX tetapi dulu tak terdefinisi (jatuh diam-diam ke `currentColor`):
`--brass` → `brass-600`, `--danger` → `clay-600`, `--line` → `--border-hair`.

Aturan:

1. **Aksi destruktif memakai `useConfirm`.** Hapus, reset, kill sesi, buang ketikan, sign-out, dan
   "Timpa" wajib lewat `ConfirmDialog` dengan nama objek, daftar dampak (`impact`, daftar bebas), dan
   label aksi eksplisit (`confirmLabel`; default "Hapus"). Lihat juga bagian responsif di atas.
   `window.confirm`, `window.prompt`, dan `window.alert` native tidak dipakai di layar; input nama
   memakai `Modal` design system.
2. **Tanpa `.catch(() => {})` kosong.** Kegagalan ditampilkan lewat `src/src/lib/report-error.ts`:
   `errorMessage(err, fallback)` menormalkan pesan galat, dan `failureMessage(action, err)` menghasilkan
   `Gagal <aksi>: <alasan>` untuk toast `err` dan blok error inline. Satu-satunya pengecualian adalah
   akses `localStorage`. Daftar yang gagal dimuat tampil sebagai error, bukan sebagai empty state
   ("Belum ada …"); pembedaan ini wajib di setiap daftar.
3. **Viewport.** `src/index.html` memakai `viewport-fit=cover`. Tanpa itu `env(safe-area-inset-*)`
   bernilai 0 dan token `--safe-*` tidak aktif.
4. **Landmark shell.** `Shell` merender tautan "Lewati ke konten" sebagai elemen pertama yang muncul
   saat difokus, dan judul layar sebagai `<h1>` dengan `margin: 0`.
5. **Keluar fokus terminal.** Pane terminal meneruskan semua tombol ke pty. `Ctrl+Shift+Esc` melepas
   fokus **keyboard** dari terminal (handler di `TerminalPane.tsx`, teks hint di sebelahnya). Ini bukan mode
   tampilan Fokus | Grid ([ADR-0209](../adr/0209-terminal-rail-sesi-fokus-default.md)).
6. **Target sentuh pilihan.** Checkbox dan radio DS (`.hn-choice-target` / `.hn-choice-control`,
   `ds/components/forms.tsx`) mendapat area 24×24 di desktop dan 44×44 pada `(pointer: coarse), (max-width: 767px)`
   (`app.css`). Checkbox/radio `input` mentah (Triase, PRD, VPS, Agent access, setup) digambar sendiri 16 px
   dengan padding transparan sebagai area klik: 24×24 di desktop, 44×44 di pointer kasar. Input file minimal
   24 px, 44 px di pointer kasar. Kotak native tak bisa dibesarkan dengan width/height (Chrome dan Safari
   mengabaikannya), jadi area kliknya lewat padding, bukan ukuran kotak.
   Switch (`role=switch`, `ds/components/forms.css`) punya area 24 px tinggi di desktop dan 44 px di pointer kasar;
   track 40×22 tetap digambar di tengahnya. Input berkas di Help Center disembunyikan (tetap fokusabel) dan
   tombol tampaknya "Pilih berkas" memakai gaya tombol DS (`.hn-public-file-btn`, `portal/portal.css`).

## Primitif layout (Audit UI/UX 2026-10 · Fase 2A)

Primitif ini menggantikan layout inline yang diaudit (1.416 `style={{` di `screens/`) dengan satu pola.
Kontraknya: **susunan dan hover/fokus lewat kelas `hn-*` di `app.css`**; inline hanya boleh berisi nilai
token (`var(--space-*)`, `var(--text-*)`). `hover` dengan `useState` dilarang untuk baris dan item menu.
Sumber: `ds/components/layout.tsx`, `skeleton.tsx`, dan bagian yang diubah di `feedback.tsx`, `ui.tsx`,
`live.tsx`, `surfaces.tsx`. Ekspor dari `ds/index.ts`.

| Primitif | API inti | Catatan |
|---|---|---|
| `PageHeader` | `title`, `eyebrow?`, `description?`, `actions?` | Judul = `<h2>`; shell memegang `<h1>`. Eyebrow hanya untuk level seksi. |
| `FilterBar` | `label`, `search?` (wajib `placeholder` berisi contoh), `chips?` (`{key,label,onRemove}`), `filters?` (isi popover "Filter"), `onReset?`, `actions?` | Reset muncul hanya bila ada filter/pencarian aktif. Popover memakai `usePopoverFocus` (Escape, fokus kembali). |
| `RowList` + `DenseRow` | `label` · `onClick?` / `href?` / `selected?` / `actions?` | Baris klik = `<button>`, baris tautan = `<a>`, baris biasa = `<div>`. Aksi selalu di luar elemen klik (tak ada tombol di dalam tombol). `aria-current` untuk terpilih. |
| `Stack` / `Inline` | `gap` (0–12, skala spacing), `align?`, `wrap?` (Inline) | Gap = `var(--space-N)`. `Inline` membungkus secara default. |
| `Text` | `size` 11 \| 12 \| 13 \| 14 \| 16, `tone` body \| muted \| subtle \| strong | Ukuran di luar skala token tak bisa diketik. |
| `Skeleton` / `SkeletonList` | `height?`, `radius?` / `rows?`, `label?` | `SkeletonList` = `role="status"` + `aria-busy`; blok skeleton `aria-hidden`. Shimmer mati di `prefers-reduced-motion`. |
| `Tabs` + `TabPanel` | `children` = `TabPanel` anak langsung | Tab punya `id` dan `aria-controls` (hanya bila ada panelnya). Panel tak aktif tetap di DOM dengan `hidden`. Keyboard tak berubah. Strip yang meluap menandai tepi yang masih menyimpan tab (`data-fade-start` / `data-fade-end`, gradasi lewat mask di `app.css`) dan memakai scroll-snap per tab. |

**Feedback yang diubah.** `Badge` dan `StatusPill` mendapat `variant="dot"` (titik status + teks, tanpa latar;
titik `aria-hidden`, maknanya selalu ikut sebagai teks). `ProgressBar`: `aria-*` berjalan ke elemen
`role="progressbar"` (track), `label` string menjadi nama aksesibel bila tak ada `aria-label`, dan `valueText`
menjadi `aria-valuetext`. `Callout`: `err` dan `danger` → `role="alert"`, `warn` dan `ok` → `role="status"`, `info` dan
`brass` → `role="note"`; prop `role` eksplisit tetap menang.

**Varian `danger`.** `ProgressBar` dan `Callout` menerima `tone="danger"`, nama kanonik lintas DS (sama dengan
`Button`, `ConfirmDialog`, dan `Field`). Warnanya token `--status-err` (= `--clay-600`): isian untuk ProgressBar,
dan teks `--clay-600` di atas `--status-err-tint` dengan batas `--clay-500` untuk Callout. `err` tetap jalan dan
memakai nilai serta role yang sama. Warna tone kedua komponen kini hidup di `ds/components/feedback.css` lewat
`data-tone` (isian: `.hn-progress-fill`; akar Callout: `.hn-callout`), bukan style inline. Lebar isian ProgressBar
tetap inline karena nilainya dinamis. `LiveConnectionBadge` kini selalu merender
wilayah `role="status"` (aria-live polite) dan hanya isinya yang berubah.

**Token teks yang lolos 4,5:1 (dihitung dari hex).** Warna teks di atas tint memakai token ini; token
fill (`--amber-600`, `--brass-600`, `--wind-600`, `--clay-600` sebagai titik/batas) tak pernah jadi teks.

| pasangan (teks di atas latar) | rasio | keputusan |
|---|---:|---|
| `--amber-700` di atas `--amber-100` | 4,80 | teks warning (`--status-warn`) |
| `--brass-700` di atas `--brass-100` | 5,45 | teks running, badge brass, angka tab |
| `--wind-700` di atas `--wind-100` | 6,42 | teks queued/scanning |
| `--amber-600` di atas `--amber-100` | 3,13 | **gagal sebagai teks**; hanya fill |
| `--brass-600` di atas `--brass-100` | 3,96 | **gagal sebagai teks** |
| `--wind-600` di atas `--wind-100` | 4,47 | **gagal sebagai teks** (selisih 0,03) |

**Menu aksi (`OverflowActions`).** Pemicu wajib `label` (nama aksesibelnya); `title?` mengganti judul dialog
(default `label`). Item `tone: "danger"` memakai `--clay-600` (6,45:1 di kartu). Panel tetap `Modal` (dialog
ber-focus-trap, bentuk sheet di ponsel), dan **di dalamnya item tersusun sebagai menu ARIA**:

- Pemicu: `aria-haspopup="menu"` + `aria-expanded` (`"dialog"` bila hanya `children`, tanpa item).
- Daftar: `role="menu"` ber-`aria-label` dari `title` (atau `label`); tiap item `role="menuitem"` (`<button>`).
- Roving tabindex: hanya satu item `tabIndex=0`; fokus awal di item itu (`data-initial-focus`).
- ↑/↓ berputar dan melewati item `disabled`; Home/End ke ujung; satu huruf memindahkan ke item berawalan huruf itu.
- Esc (dari `Modal`) dan Tab dari item menutup panel; fokus kembali ke pemicu. Shift+Tab menutup kecuali
  ada `children`, lalu fokus masuk ke kontrol itu. Memilih item menutup panel tanpa mengembalikan fokus
  (aksinya sering membuka dialog lain).
- `children` (unduhan, slider, dsb.) dirender **di luar** `role="menu"`: ARIA tak mengizinkan input di dalam menu.

Test: `overflow-actions.test.tsx` (kontrak menu) dan `ds-feedback-a11y.test.tsx`. Pemakai yang mencari item
memakai `getByRole("menuitem", { name })`. Berkas pemakainya tersebar di `test/` dan `src/screens/`.

**CSS yang dipindah ke kelas.** `[style*=…]` sudah tak ada di `app.css`; anak ber-flex inline yang
dulu dikenali selektor itu kini membawa `hn-grow` (`flex: 1 1 0%`, identik dengan inline `flex: 1`).
Header `Card` (`.hn-card-header`) menyusun dirinya lewat kelas, sehingga `align-items` di mobile
tak lagi butuh `!important`. `!important` yang dihapus: outline `:focus-visible` (role tab/checkbox/radio/
switch, `.hn-select select`, `.hn-textarea-core`), karena tak ada gaya inline yang bersaing. Fase 2E
mencabut kelas mati (`.hn-project-*`, `.hn-backlog-*`, `.hn-team-*`, `.hn-vps-*`, `.hn-dlg-*` lama). Sisanya
(`.hn-modal-*`, `.hn-viewport-popover`, `.hn-portal-*`, `.hn-setting-*`, `.hn-picker-*`, `.hn-dense-row`,
`.hn-grid-mobile`, `.hn-stack-mobile`, `.hn-touch-target`) **masih perlu `!important`**: menimpa layout inline di
TSX atau kaskade `settings.css`. Penyebab per kelompok ada di frontend-implementation.md § Fase 2E. Menghapusnya
berarti memindahkan layout inline itu ke kelas.

Test: `src/test/ds-layout-primitives.test.tsx`, `ds-feedback-a11y.test.tsx`, `ds-css-contract.test.ts`,
serta `use-live-topic.test.tsx` (wilayah live) dan `overflow-actions.test.tsx`.

## Palet perintah dan shortcut (Audit UI/UX 2026-10 · Fase 2C)

Aturan interaksi global. Implementasi dan rincian berkas di
[frontend-implementation](../frontend/frontend-implementation.md#audit-uiux-2026-10--fase-2c--palet-perintah--shortcut).

| Tombol | Aksi | Catatan |
|---|---|---|
| ⌘K / Ctrl K | Buka atau tutup palet perintah | Tak aktif di dalam terminal (`.xterm`); Ctrl+K milik readline shell |
| `g` lalu huruf | Pindah layar | Jendela 1 dtk. o Overview · d Dalang · p Projects · r PRD · b Backlog · m Tim · q QA · e Triase · j Scheduler · l Lead · t Terminal · i IDE · a Skills · v VPS · k Klien · f Docs · s Settings |
| `/` | Fokus kotak cari topbar | Bila layar tak punya kotak cari, palet yang terbuka |
| `?` | Bantuan shortcut | Daftar yang sama dengan yang bekerja (dibangkitkan dari peta) |
| Esc | Tutup palet atau dialog | Fokus kembali ke pemicu |
| ↑ ↓ Enter | Pilih dan jalankan di palet | Perintah nonaktif dilewati |
| Ctrl+Shift+Esc | Lepas fokus dari terminal | Tetap milik terminal; tak dipakai shortcut lain |

Aturan:

1. Shortcut huruf tunggal (`g`, `/`, `?`) tak pernah aktif saat fokus di input, textarea, select,
   contenteditable, atau terminal, saat dialog modal terbuka, atau bersama Ctrl/⌘/Alt.
2. `g` menuju layar mana pun di `HN_NAV` (termasuk Dalang yang kini di luar sidebar). Layar bergerbang yang mati tak pernah dituju.
3. Tombol topbar "Cari" membuka palet dan menunjukkan `⌘K` (Mac) atau `Ctrl K` (lainnya). Di mobile dan
   pointer kasar ia menjadi ikon ≥44px dan petunjuknya disembunyikan.
4. Project switcher topbar hanya tampil di layar yang membaca filter project (Backlog, Tim, PRD). Scope
   aktif ditampilkan di breadcrumb sebagai `project: <nama>`.
5. Hasil palet dikelompokkan: Riwayat dan Menunggu kamu, Aksi, Pindah ke saat kueri kosong; Backlog dan
   Project hanya saat diketik, dipangkas delapan per grup.

## Navigasi hub (Audit UI/UX 2026-10 · Fase 3A)

Rincian berkas di [frontend-implementation](../frontend/frontend-implementation.md#audit-uiux-2026-10--fase-3a--navigasi-8-hub-bergrup-adr-0205).
Keputusan di [ADR-0205](../adr/0205-navigasi-8-hub-bergrup.md).

| Elemen | Aturan |
|---|---|
| Sidebar (desktop) | Delapan hub dalam tiga grup berlabel: **Kerja** (Overview, Projects, Backlog, Triase, Sesi) · **Otomasi** (Otonom) · **Sistem** (Skills, Pengaturan). Item aktif = hub yang memuat layar |
| Rail (tablet) | Ikon saja. Label grup disembunyikan, dan grup dipisah garis tipis. Tak ada gulir |
| Drawer (mobile) | Tiga grup berlabel. Menutup sesudah navigasi |
| Klik hub | Membuka tab terakhir yang dibuka di hub itu. Tanpa riwayat, tab pertama yang tampil |
| Bar tab | Di atas konten layar anak hub. `role="tablist"` dengan URL sebagai sumber kebenaran. Tampil bila ada dua tab atau lebih yang tampil |
| Angka antrean | Hub menjumlahkan antrean tab-tabnya. Tiap tab menampilkan angkanya sendiri. Nol tak dirender |
| Crumb | `Hub › Tab` di atas judul, hanya untuk hub bertab banyak. Deskripsi layar tetap di belakangnya |
| Layar turunan | Detail project tampil di bawah Projects, dan review di bawah Backlog. Keduanya tak pernah jadi tab |
| Di luar sidebar | Dalang ([ADR-0208](../adr/0208-dalang-papan-senyap-pengecualian-gelap.md)): palet "Buka panggung", `g d`, dan bantuan `?` |

Aturan:

1. Tab adalah **section URL**, bukan state lokal. Pindah tab = navigasi, sehingga Kembali browser dan tautan bersama tetap bekerja.
2. Hub baru masuk `HN_HUBS` dan lolos `nav-hubs.test.ts`. Section tanpa hub harus dicatat sebagai palet-saja secara sadar, atau test gagal.
3. Hub satu layar (Overview, Triase, Skills) tak punya bar tab maupun crumb. Jangan memaksakan tab untuk hub yang belum punya dua layar.

## Form, Modal, Toast — Fase 2B (Audit UI/UX 2026-10)

Fase 2B menutup bagian a11y fondasi untuk form dan overlay. Kontrak di bawah berlaku untuk pemakai baru;
pemakai lama tetap berjalan tanpa perubahan kecuali yang disebut sebagai perubahan perilaku.

**Field: label dipisah dari hint.** `<Field label hint error>` merender `<label htmlFor>` yang menunjuk
*kontrol pemilik* — kontrol pertama di dalamnya (`Input`, `Select`, `HnTextarea`, atau pemicu `MultiSelect`).
Hint dan error ditautkan lewat `aria-describedby`. `error` menyalakan `aria-invalid` pada kontrol dan
tampil dengan `role="alert"`. `id` dan `aria-describedby` yang dipasang pemanggil langsung **menang** atas
tautan otomatis. Elemen `<input>`/`<textarea>` native di dalam Field tak ikut ditautkan: beri `aria-label`.

**Field · varian danger.** `<Field tone="danger">` menyalakan keadaan invalid **tanpa pesan**: label berwarna
`--status-err` (aturan `.hn-field[data-tone="danger"]` di `forms.css`), dan kontrol di dalamnya menerima
`aria-invalid` serta border `--status-err`, persis seperti `invalid` pada Input, Select, dan HnTextarea. Pesan
tetap lewat `error` (`role="alert"`); tone hanya mengatur tampilan dan tautan. Karena tone danger memasang
`aria-invalid`, pakai hanya bila kontrolnya memang tak valid, dan letakkan penjelasannya di `error` atau `hint`.

**Input · Select · HnTextarea.** Ketiganya menerima `invalid` (border error + `aria-invalid`), `aria-invalid`,
dan `aria-describedby`. `HnTextarea` kini menggabungkan `onFocus`/`onBlur` pemanggil, tak lagi menimpanya.
Fokus digambar sekali oleh pembungkus (border + ring): outline bawaan `input:focus-visible` dimatikan untuk
kelas `hn-input-core` / `hn-textarea-core` di `app.css`, karena gaya inline tak bisa mengalahkan `!important`.

**Checkbox · Radio · RadioGroup.** Area sentuh checkbox dan radio 24×24 (kotak yang tampak tetap 18px);
di layar sentuh tetap 44×44 lewat `.hn-choice-target`. Pilihan tunggal sebagai grup memakai `RadioGroup` (contoh: selektor tingkat akses Perangkat Lihat · Kerja · Tulis, [ADR-0210](../adr/0210-perangkat-tingkat-akses-lihat-kerja-tulis.md)):

```tsx
<RadioGroup aria-label="Mode" value={mode} onChange={(v) => setMode(v)}>
  <Radio value="a" label="A" />
  <Radio value="b" label="B" description="penjelasan singkat" />
</RadioGroup>
```

`RadioGroup` merender `role="radiogroup"` dengan nama dari `label` (terlihat) atau `aria-label`. Hanya satu
item yang tabbable (roving tabindex): yang terpilih, atau item aktif pertama bila belum ada pilihan. ↑/↓/←/→
memindahkan fokus **dan** memilih, berputar di ujung dan melewati item `disabled`; Home/End ke ujung.
Spasi/Enter memilih item yang fokus. Radio tanpa grup (`checked` + `onChange`) tetap bekerja seperti dulu.

**Radio · varian danger.** `<RadioGroup tone="danger">` (atau `<Radio tone="danger">` tanpa grup) mewarnai cincin,
titik, dan label dengan `--status-err` / `--clay-600`. Warnanya lewat `forms.css` (`data-tone="danger"` di `<label>`),
bukan inline. Tone grup berlaku ke tiap Radio, kecuali Radio itu memberi tone sendiri. Keadaan terpilih dan
keyboard tak berubah. Cincin dan titik kini memakai kelas `.hn-radio-ring` / `.hn-radio-dot`, dan keadaan terpilih
dibaca dari `aria-checked` pada elemen `role="radio"`.

**Modal.** Judul dirender sebagai `<h2>` dan dirujuk `aria-labelledby`. Saat terbuka, saudara dari setiap
leluhur panel diberi `inert` ke anak `body`, sehingga fokus dan pembaca layar tak masuk ke belakang modal.
Penghitungan per elemen menjaga modal bertumpuk: latar baru dilepas ketika modal terakhir tertutup. Wadah
toast (`data-hn-toast-host`) dikecualikan agar tetap diumumkan. Fokus awal: elemen ber-`data-initial-focus`,
lalu `autofocus`, lalu isian pertama, lalu tombol pertama. Saat tutup, fokus kembali ke pemicu.
`dismissible={false}` mematikan Escape, klik latar, dan tombol ×; × juga mati bila tak ada `onClose`.

**ConfirmDialog · useConfirm.** Aksi `tone="danger"` (default) memulai fokus di **Batal**, sehingga Enter
tak mengonfirmasi penghapusan. Aksi bukan-danger memulai fokus di konfirmasi. Dengan `requireText`, fokus
jatuh ke isiannya. Selama `busy` dialog terkunci: Batal, konfirmasi, ×, Escape, klik latar, dan isian
ketik-ulang mati. Daftar dampak tetap `<ul>`.

**Toast: antrean, aksi, live region.**

```tsx
const [toast, showToast] = useToast();
showToast("Entri dibuang", "ok", undefined, { action: { label: "Urungkan", onAction: undo } });
<ToastHost toast={toast} />   // satu tempat per layar; <Toast toast={toast} /> lama tetap jalan
```

- `show(message, tone?, icon?, opts?)`; `opts = { action?: { label, onAction }, duration? }`.
- Maksimal `TOAST_VISIBLE` (3) terlihat sekaligus; sisanya menunggu slot kosong. Timer tiap toast mulai saat ia terlihat.
- Durasi 2,6 dtk; 7 dtk bila ada aksi; `duration` menimpa keduanya. Kursor atau fokus di dalam toast menjeda timer.
- Toast keputusan (`notifications/`) membawa aksi **Jawab** (7 dtk): membuka Terminal terfokus ke sesinya dan menandai notifikasinya terbaca. Tak tampil bila sesi itu sudah ditonton di Terminal.
- Wadah `role="status"` (polite) selalu ada di DOM, walau kosong. Toast `tone="err"` membawa `role="alert"` assertive.
  Konsekuensi untuk tes: `getByRole("alert")` kini juga menangkap toast galat; pilih alert berdasarkan teks.

**Button · varian danger (Audit UI/UX 2026-10).** Dua varian merah resmi, warnanya di `forms.css`
(`.hn-btn-danger*`), bukan inline:

- `variant="danger"`: solid (fill `--clay-600`, teks putih). Untuk aksi merusak utama, mis. konfirmasi hapus.
- `variant="danger-outline"`: teks `--clay-600`, border `--clay-500`, hover memakai tint galat (`--status-err-tint`).
  Untuk aksi merusak sekunder: `Hapus`, `Reset`, `Hapus log` di pengaturan.

Kedua varian mendapat cincin fokus DS (`--border-focus`) lewat `:focus-visible`, sama seperti semua varian
Button dan IconButton: tak ada lagi `outline: none` inline di sana (Audit 2026-10 · Z11). Cincin global
`button:focus-visible` (app.css) digambar 2 px di luar border, jadi ia bertumpu di latar halaman atau kartu
(≥ 4,1:1: 4,55 di page, 4,83 di kartu, 4,14 di panel), bukan di isian tombol. Klik mouse tak memicu
`:focus-visible`, jadi tombol tak bercincin sesudah diklik. Jangan menulis `style={{ color: "var(--clay-600)" }}`
atau `className` merah di atas `variant="secondary"`: kelas itu kalah oleh warna inline dan tak pernah merah.
Aksi merusak sekunder memakai `variant="danger-outline"`.

**Icon.** `Icon` tanpa `aria-label`, `aria-labelledby`, atau `title` mendapat `aria-hidden="true"` (dekoratif).
Dengan nama, ia `role="img"` dan tak disembunyikan. Caller tetap bisa menimpa lewat `aria-hidden` eksplisit.

**Ekspor barrel.** `RadioGroup` (dan `Radio`) ada di `ds/components/forms.tsx`; `ToastHost`, `ToastQueue`,
`ToastOptions`, `ToastAction`, dan `TOAST_VISIBLE` ada di `ds/kit.tsx`. Barrel `ds/index.ts` perlu
mengekspornya agar layar bisa mengimpornya dari `ds`.

## Ikon (SPEC-906)

Semua ikon dipanggil lewat `Icon` (`src/src/ds/icon.tsx`) dengan nama **kebab-case**, tak pernah
dengan mengimpor komponen lucide langsung — itu yang membuat `data-icon={name}` selalu ada dan
kontrak ikon bisa diuji tanpa menyentuh internal lucide (ADR-0127).

Lookup-nya melihat peta `icons` lucide, lalu **peta alias `LEGACY`** di berkas yang sama. Sebabnya
bukan gaya: lucide 0.400 memberi banyak ikon nama kanonik baru (`AlertTriangle` → `TriangleAlert`,
`XCircle` → `CircleX`, `TerminalSquare` → `SquareTerminal`) dan menyimpan nama lamanya **hanya
sebagai alias di level modul** — peta `icons` memuat yang kanonik saja. Selama lookup-nya `icons`,
lima belas nama lama yang masih dipakai di UI ini jatuh ke `Circle` di ±123 call site, termasuk ikon
**setiap toast error** (`x-circle`), spinner **setiap tombol loading** (`loader-2`), dan menu
overflow (`more-horizontal`): ikon hilang, layout utuh, **nol error**, jadi tak ada yang
menyadarinya.

`LEGACY` dipetakan tangan, bukan `import * as lucide` yang juga akan menangkap semua alias:
namespace dinamis memaksa Rollup membangun objek berisi ~2 000 getter — **+20 KB gzip terukur**
(859 → 879 KB) untuk hasil yang identik. Peta itu sekaligus daftar utang migrasi; mengosongkannya
berarti mengganti nama di call site, dan dua di antaranya **tertukar**: `check-circle` =
`circle-check-big` (tebal), `check-circle-2` = `circle-check` (tipis).

Nama yang tak dikenal keduanya tetap dirender sebagai lingkaran kosong — kali ini disertai
`console.warn` sekali per nama di dev, supaya salah ketik berikutnya tak ikut senyap. Penjaganya
`src/test/icon.test.tsx`.

## Ilustrasi produk

Katalog authoritative berada di `internal/assets/illustration/inventory.json`: **41 master WebP**
dalam sepuluh family. Frontend tidak memakai filename secara langsung. Semua artwork dipanggil lewat
ID katalog (`HRO-001`, `PST-002`, dan seterusnya) pada komponen `Illustration` dari design system;
registry-nya hidup di `src/src/ds/illustration-registry.ts` dan diuji setara 41/41 dengan inventory.
Yang di-bundle registry adalah turunan web terkompres di `internal/assets/illustration/web/`, bukan
masternya — lihat [frontend-implementation](../frontend/frontend-implementation.md#pipeline-illustration-assets).

API komponen:

- `Illustration` menerima seluruh `IllustrationId`, memakai alt default dari intent katalog,
  lazy-load + decode async, aspect ratio katalog, dan `contain` secara default. `priority` hanya untuk
  artwork above-the-fold; `fit`, `style`, `className`, dan `sizes` boleh ditentukan caller.
- `ProductStateIllustration`, `MascotIllustration`, `StickerIllustration`, dan `SpotIllustration`
  membatasi ID secara type-level ke family-nya. Pakai wrapper ini bila family sudah diketahui.
- `decorative` wajib untuk artwork yang hanya mengulang title/status yang sudah terbaca. Bentuk ini
  merender `alt=""` + `aria-hidden="true"`; artwork informatif mempertahankan alt katalog atau alt
  yang sengaja ditulis caller.
- `StateBlock` menerima `illustration` opsional sebagai pengganti tile ikon. Keadaan loading tetap
  memakai spinner; filtered-empty sederhana tak perlu gambar besar.

Penempatan mengikuti kegunaan, bukan kewajiban memajang semuanya. Enam product-state dipakai pada
onboarding, backlog sungguh kosong, sesi aktif, menunggu keputusan, sukses, dan error yang bisa
dipulihkan. **Pet Hanoman** — maskot persisten di footer sidebar (desktop) atau lajur di bawah konten (tablet dan ponsel, default mati; [ADR-0206](../adr/0206-pet-footer-sidebar-default-per-tier.md)) yang pose-nya turunan status sesi &
backlog, bukan hiasan — memakai band ilustrasi tersendiri: **pet** 80–128 px, ±2,5 head unit,
digambar sebagai atlas sprite PET-001 (`internal/assets/pet/`, ADR-0140) dan bukan lagi family
`sticker` (`STK-001…008`, yang tetap di katalog untuk pemakaian lain). Tabel
status → pose beserta urutan prioritasnya ada di
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-sprite-hidup-spec-585--spec-648--pet-hidup-a-adr-0140--pet-hidup-b-spec-897--pet-hidup-c-spec-898-adr-0141--pet-hidup-d-spec-899-adr-0142--pet-hidup-e-spec-904--pet-hidup-f-spec-905-adr-0144).
Derivatif **Hanoman Pet — Sehari-hari** di `internal/assets/pet/whatsapp/` memakai identitas yang
sama untuk 30 reaksi WhatsApp statis. Ia delivery eksternal, bukan state/motion dashboard, bukan
aset frontend registry, dan tidak memperluas katalog `STK-001…008`.
Model sheet serta template sosial tetap frontend-addressable melalui registry tetapi
tidak dipaksakan masuk instrument panel operasional. Motif tanpa makna status selalu dekoratif.

### Grammar motion Pet Hanoman (SPEC-648 · sprite: Pet hidup A, ADR-0140 · diseret: Pet hidup F, ADR-0144)

Motion Pet adalah bahasa status, bukan hiasan yang sama untuk semua artwork — tetapi sejak Pet hidup
A identitas tiap pose **digambar sebagai frame**, bukan disusun dari transform di atas satu raster.
Sumbernya satu atlas WebP v02 (sel 192×208, 8 kolom, 16 baris) plus manifest `pet.json`; artwork-nya
dibuat lewat pipeline `internal/scripts/pet/` dan direview di `internal/assets/pet/qa/`.

Grammar render: satu `<img>` atlas di dalam viewport ber-`overflow: hidden`; baris dipilih
`--row` pada pembungkus (`translateY(calc(var(--row) * -100%))`), frame diputar
`@keyframes hn-pet-frames { to { transform: translateX(-100%) } }` dengan `steps(8, end)`. Frame
**tidak** memakai token durasi: satu putaran = `columns / fps` dari manifest, jadi tempo animasi
adalah properti aset, bukan properti tema. Token `--dur-base`/`--dur-slow` dan
`--ease-out`/`--ease-inout` tetap dipakai one-shot interaksi/transisi (hover, klik, panel, reveal);
katalog `--dur-pet-*` SPEC-648 dicabut bersama keyframe `hn-pet-idle-*`/`hn-pet-pose-*`. Sejak
ADR-0144 ada **satu** kurva gerak tambahan, `--ease-fall` (easeInQuad), dipakai HANYA saat pet yang
dilepas jatuh ke jalur: perpindahan berkeliaran `linear` karena lajunya memang tetap, sedangkan
jatuh harus **mempercepat**, dan `--ease-out` bergerak ke arah sebaliknya. Ia token seperti yang
lain — bukan `cubic-bezier` harfiah di komponen — supaya tema yang mengubah kurva gerak ikut
menyentuh pet.

Pemilik `transform` tetap terpisah per elemen — actor untuk perpindahan berkeliaran, stage untuk
reveal, reactor untuk hover/klik, rowshift untuk baris, img untuk frame. Keyframe hanya boleh
mengubah `transform` dan/atau `opacity`; tidak boleh menganimasikan layout, memakai timer denyut,
atau merender React per-frame.

Hover hanya berupa pendekatan kecil, klik berupa squash/pantul one-shot, dan kartu ringkasan
mempunyai enter/exit sendiri. Semua amplitudo tetap kecil agar terminal menjadi fokus utama. Pada
`prefers-reduced-motion: reduce`, setiap animation **dan** transition dimatikan (`none`), pet tak
berkeliaran, selector hover tidak berlaku, dan keadaan akhir tetap terbaca penuh. **Menyeret pet
tetap boleh di sana** (ADR-0144): ia manipulasi langsung yang diminta manusia, bukan gerak yang
terjadi padanya — yang dimatikan adalah jatuhnya (seketika) dan pusingnya (dilewati). Tempat pet
berhenti karena itu bukan selalu pojok: ia berdiri di tempat terakhir manusia meletakkannya, atau
di pojok bila belum pernah diseret. Kontrak DOM,
lifecycle panel, mesin berkeliaran, dan pengujiannya dijelaskan di
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-sprite-hidup-spec-585--spec-648--pet-hidup-a-adr-0140--pet-hidup-b-spec-897--pet-hidup-c-spec-898-adr-0141--pet-hidup-d-spec-899-adr-0142--pet-hidup-e-spec-904--pet-hidup-f-spec-905-adr-0144).

## Klien, Help Center, dan sheet dua langkah (Audit UI/UX 2026-10 · Fase 3M)

Rincian di [frontend-implementation § Fase 3 · Review, Auth, Portal, Onboarding](../frontend/frontend-implementation.md#audit-uiux-2026-10--fase-3--review-auth-portal-onboarding-3l--3m--3n).

| Pola | Aturan |
|---|---|
| Linimasa keluhan | `TicketTimeline` + `ticketTimeline()` (`portal/`). Empat langkah Diterima → Ditinjau → Dikerjakan → Selesai. Jangan menyalin pemetaan status ke layar. |
| Sheet dua langkah | `Modal` dengan `footer`; penanda `langkah n dari N` di eyebrow; Lanjut nonaktif wajib menyebut alasannya. |
| Bar keputusan | Sticky di bawah (`.hn-review-decide`), tiga aksi maksimum, aksi utama satu. Aksi yang hanya berpindah layar memakai `onGoto` atau tautan. |
| Input klien/publik | Teks minimal 16 px (`Input size="lg"`, `.hn-portal-textarea`, `.hn-public-input`) agar iOS tidak men-zoom. |
| Konflik sinkron | Hanya field yang berbeda yang ditampilkan; desktop dua kolom, mobile bertumpuk. |

## Placeholder: contoh nilai, bukan pengulangan label (SPEC-490)

Label, hint, dan placeholder menjawab tiga pertanyaan berbeda — jangan salah satu
mengerjakan pekerjaan yang lain:

| elemen | menjawab |
|---|---|
| `Field label` / `aria-label` | *field ini apa* — **wajib**, tak pernah digantikan placeholder |
| `Field hint` | *aturannya apa* (opsional: batasan & konsekuensi) |
| `placeholder` | *isinya kelihatan seperti apa* |

1. Placeholder berisi **contoh nilai nyata**, diawali `mis. ` bila nilainya bebas
   (`mis. erp-tumbuh-ai`), atau **bentuk formatnya apa adanya** bila formatnya terikat
   (`~/.ssh/id_ed25519`, `https://github.com/org/repo.git`, `-1001234567890`, `22`,
   `••••••••`).
2. **Bukan** pengulangan label (`Cari backlog…` untuk label "Cari backlog") dan **bukan**
   instruksi (`Ceritakan apa yang terjadi…`). Instruksi tempatnya di `hint`.
3. Placeholder tak pernah menggantikan label — ia hilang begitu diketik.
4. Field yang nilainya **sudah ada** boleh memakai placeholder sebagai penanda keadaan
   (`••••1234`, `biarkan kosong = pertahankan`); itu lebih berguna daripada contoh.

**Berlaku untuk** input teks (termasuk `password`/`number`/`email`/`search`),
`textarea`/`HnTextarea`, dan kolom cari combobox (`MultiSelect.searchPlaceholder` —
`placeholder`-nya adalah label tombol, bukan petunjuk kolom).

**Di luar aturan, dengan alasan:** `<Select>` native (selalu menampilkan opsi terpilih;
keadaan belum-memilih dilayani opsi pertama yang eksplisit — `Pilih branch…`), `type="date"`
dan kerabatnya (browser **mengabaikan** `placeholder` dan merender widget bawaan), serta
checkbox/radio/file. Field yang sah tak punya placeholder ditandai di call site-nya:

    {/* placeholder-exempt: <alasan> */}

Ditegakkan `src/test/placeholder-contract.test.ts` — lihat
[frontend-implementation](../frontend/frontend-implementation.md).
