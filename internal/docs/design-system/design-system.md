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
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-sprite-hidup-spec-585--spec-648--pet-hidup-a-adr-0140).
Model sheet serta template sosial tetap frontend-addressable melalui registry tetapi
tidak dipaksakan masuk instrument panel operasional. Motif tanpa makna status selalu dekoratif.

### Grammar motion Pet Hanoman (SPEC-648 · sprite: Pet hidup A, ADR-0140)

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
katalog `--dur-pet-*` SPEC-648 dicabut bersama keyframe `hn-pet-idle-*`/`hn-pet-pose-*`.

Pemilik `transform` tetap terpisah per elemen — actor untuk perpindahan berkeliaran, stage untuk
reveal, reactor untuk hover/klik, rowshift untuk baris, img untuk frame. Keyframe hanya boleh
mengubah `transform` dan/atau `opacity`; tidak boleh menganimasikan layout, memakai timer denyut,
atau merender React per-frame.

Hover hanya berupa pendekatan kecil, klik berupa squash/pantul one-shot, dan kartu ringkasan
mempunyai enter/exit sendiri. Semua amplitudo tetap kecil agar terminal menjadi fokus utama. Pada
`prefers-reduced-motion: reduce`, setiap animation **dan** transition dimatikan (`none`), pet diam
di pojok, selector hover tidak berlaku, dan keadaan akhir tetap terbaca penuh. Kontrak DOM,
lifecycle panel, mesin berkeliaran, dan pengujiannya dijelaskan di
[frontend-implementation](../frontend/frontend-implementation.md#pet-hanoman-status-sesi-sebagai-sprite-hidup-spec-585--spec-648--pet-hidup-a-adr-0140).

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
