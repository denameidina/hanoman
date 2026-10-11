# Design system — hanoman

Estetika **editorial instrument-panel**: bone paper hangat, ink text, satu aksen **brass** (gold-leaf wayang). Font IBM Plex (Serif display, Sans UI, Mono data/label). Hairline 1px, radius kontrol 5px / kartu 12px. Semantik earthy (leaf/amber/clay). Satu permukaan gelap: terminal log.

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
- `.hn-ide-head` + `.hn-ide-toolbar` adalah baris kepala layar IDE: strip tab `flex: 0 0 auto` di
  samping toolbar ber-**basis dinyatakan** `flex: 1 1 480px`, yang turun ke barisnya sendiri dan
  menggulir saat ruangnya kurang. Basis `auto` membuat pecah-baris ditentukan lebar isi, dan dengan
  itu bentuk kepala berubah hanya karena label tab aktif ditebalkan atau nama project bertambah
  panjang (SPEC-879).
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
   fokus dari terminal (handler di `TerminalPane.tsx`, teks hint di sebelahnya).
6. **Target sentuh pilihan.** Checkbox dan radio DS (`.hn-choice-target` / `.hn-choice-control`,
   `ds/components/forms.tsx`) mendapat area 44×44 pada `(pointer: coarse), (max-width: 767px)`
   (`app.css`). Checkbox/radio native tetap 24×24 di desktop; itu disengaja.

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
| `Tabs` + `TabPanel` | `children` = `TabPanel` anak langsung | Tab punya `id` dan `aria-controls` (hanya bila ada panelnya). Panel tak aktif tetap di DOM dengan `hidden`. Keyboard tak berubah. |

**Feedback yang diubah.** `Badge` dan `StatusPill` mendapat `variant="dot"` (titik status + teks, tanpa latar;
titik `aria-hidden`, maknanya selalu ikut sebagai teks). `ProgressBar`: `aria-*` berjalan ke elemen
`role="progressbar"` (track), `label` string menjadi nama aksesibel bila tak ada `aria-label`, dan `valueText`
menjadi `aria-valuetext`. `Callout`: `err` → `role="alert"`, `warn` dan `ok` → `role="status"`, `info` dan
`brass` → `role="note"`; prop `role` eksplisit tetap menang. `LiveConnectionBadge` kini selalu merender
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
(default `label`). Item `tone: "danger"` memakai `--clay-600` (6,45:1 di kartu). Panel tetap **dialog**
(sheet Modal), bukan `role="menu"`: pemakai dan test mencari item sebagai `button` di dalam dialog, dan
mengganti role memutus ~11 berkas test sekaligus. Menu ARIA penuh adalah tindak lanjut terpisah.

**CSS yang dipindah ke kelas.** `[style*=…]` sudah tak ada di `app.css`; anak ber-flex inline yang
dulu dikenali selektor itu kini membawa `hn-grow` (`flex: 1 1 0%`, identik dengan inline `flex: 1`).
Header `Card` (`.hn-card-header`) menyusun dirinya lewat kelas, sehingga `align-items` di mobile
tak lagi butuh `!important`. `!important` yang dihapus: outline `:focus-visible` (role tab/checkbox/radio/
switch, `.hn-select select`, `.hn-textarea-core`), karena tak ada gaya inline yang bersaing. Sisanya
(`.hn-modal-*`, `.hn-viewport-popover`, `.hn-project-*`, `.hn-backlog-*`, `.hn-portal-*`, `.hn-setting-*`,
`.hn-dense-row`, `.hn-grid-mobile`, `.hn-touch-target`) **masih perlu `!important`** karena menimpa layout
inline di TSX; menghapusnya berarti memindahkan layout inline itu ke kelas (Fase 2E).

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
2. `g` hanya menuju layar yang tampil di sidebar. Layar bergerbang yang mati tak pernah dituju.
3. Tombol topbar "Cari" membuka palet dan menunjukkan `⌘K` (Mac) atau `Ctrl K` (lainnya). Di mobile dan
   pointer kasar ia menjadi ikon ≥44px dan petunjuknya disembunyikan.
4. Project switcher topbar hanya tampil di layar yang membaca filter project (Backlog, Tim, PRD). Scope
   aktif ditampilkan di breadcrumb sebagai `project: <nama>`.
5. Hasil palet dikelompokkan: Riwayat dan Menunggu kamu, Aksi, Pindah ke saat kueri kosong; Backlog dan
   Project hanya saat diketik, dipangkas delapan per grup.

## Form, Modal, Toast — Fase 2B (Audit UI/UX 2026-10)

Fase 2B menutup bagian a11y fondasi untuk form dan overlay. Kontrak di bawah berlaku untuk pemakai baru;
pemakai lama tetap berjalan tanpa perubahan kecuali yang disebut sebagai perubahan perilaku.

**Field: label dipisah dari hint.** `<Field label hint error>` merender `<label htmlFor>` yang menunjuk
*kontrol pemilik* — kontrol pertama di dalamnya (`Input`, `Select`, `HnTextarea`, atau pemicu `MultiSelect`).
Hint dan error ditautkan lewat `aria-describedby`. `error` menyalakan `aria-invalid` pada kontrol dan
tampil dengan `role="alert"`. `id` dan `aria-describedby` yang dipasang pemanggil langsung **menang** atas
tautan otomatis. Elemen `<input>`/`<textarea>` native di dalam Field tak ikut ditautkan: beri `aria-label`.

**Input · Select · HnTextarea.** Ketiganya menerima `invalid` (border error + `aria-invalid`), `aria-invalid`,
dan `aria-describedby`. `HnTextarea` kini menggabungkan `onFocus`/`onBlur` pemanggil, tak lagi menimpanya.
Fokus digambar sekali oleh pembungkus (border + ring): outline bawaan `input:focus-visible` dimatikan untuk
kelas `hn-input-core` / `hn-textarea-core` di `app.css`, karena gaya inline tak bisa mengalahkan `!important`.

**Checkbox · Radio · RadioGroup.** Area sentuh checkbox dan radio 24×24 (kotak yang tampak tetap 18px);
di layar sentuh tetap 44×44 lewat `.hn-choice-target`. Pilihan tunggal sebagai grup memakai `RadioGroup`:

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
- Wadah `role="status"` (polite) selalu ada di DOM, walau kosong. Toast `tone="err"` membawa `role="alert"` assertive.
  Konsekuensi untuk tes: `getByRole("alert")` kini juga menangkap toast galat; pilih alert berdasarkan teks.

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
dipulihkan. **Pet Hanoman** — maskot persisten di tepi bawah dashboard yang pose-nya turunan status sesi &
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
