# SPEC-763 — Dashboard responsif di mobile, tablet, dan desktop

## Objective

Seluruh web Hanoman adaptif pada mobile (`<768px`), tablet (`768–1199px`), dan desktop
(`≥1200px`) tanpa kehilangan data, status, kontrol, atau aksi. Navigasi berubah dari drawer di
mobile, menjadi rail ringkas di tablet, lalu sidebar 248px di desktop. Daftar/detail dan workspace
kompleks memakai pemilih panel pada mobile lalu kembali menjadi split-pane saat ruang cukup.
Halaman tidak menggulir horizontal; terminal, kode, diff, graph, board, dan tabel boleh mempunyai
overflow lokal yang jelas.

## Konteks terukur

Kontrak frontend saat ini masih desktop-first:

- `Shell` selalu merender sidebar 248px dan topbar satu baris. Tiga belas entri `HN_NAV`, dua
  section transien (`project` dan `review`), serta utility global harus berbagi ruang yang pada
  viewport 390px tidak tersedia.
- `#root` memakai `height: 100vh; overflow: hidden`; tidak ada dynamic viewport, safe-area, atau
  kontrak virtual keyboard. Tidak ada media query layout responsif.
- primitive `Button`, `IconButton`, `Input`, `Select`, `Pager`, dan close Modal banyak memakai
  target 28–38px. `Modal` belum mempunyai semantics dialog, focus trap, restore focus, atau
  ukuran berbasis `dvh`.
- PRD, Docs, IDE, Review, Spec Docs, Git Graph, dan Settings memakai grid split tetap. Terminal
  mempertahankan grid `rows × cols` pada semua lebar dan tingginya dihitung dari `100vh`.
- Projects adalah pseudo-table lima kolom tanpa overflow lokal. Backlog board, tabel webhook/MCP,
  kode, diff, graph, dan xterm sudah mempunyai overflow lokal yang harus dipertahankan.
- state pilihan/filter/panel sudah persisten lewat ADR-0115; WebSocket, tmux, dan `ResizeObserver`
  xterm sudah menjadi jalur runtime yang benar. Responsiveness tidak boleh mengganti jalur itu.

Audit seluruh permukaan menemukan keluarga layout berikut: Shell/chrome; modal/form; overview dan
grid ringkasan; tabel/list/board; master-detail; workspace kompleks; auth/setup; Help Center publik;
portal klien; Pet Hanoman. Ini satu perubahan lintas-potong dengan kontrak bersama, bukan kumpulan
screen mobile independen.

## Pendekatan

### Dipilih — primitive responsif bersama lalu migrasi per keluarga layout

Token dan CSS mendefinisikan tiga tier, gutter, safe-area, dynamic viewport, target sentuh, dan
overflow halaman. `Shell`, `Modal`, toolbar, local-overflow, serta panel selector menjadi seam
bersama. Screen hanya menyatakan keluarga layout dan panelnya; media query/primitive yang sama
menentukan susunannya.

Pendekatan ini menjaga satu tree komponen, satu state ADR-0115, satu koneksi realtime, dan satu
xterm. Perubahan dapat dipecah menjadi tracer bullet per keluarga sambil tetap memakai kontrak
yang sama.

### Ditolak — override CSS global tanpa primitive

Ini paling sedikit menyentuh JSX, tetapi mayoritas grid hidup sebagai inline style. Override
`!important` per selector akan mengikat stylesheet ke struktur privat tiap screen, sulit diuji,
dan mengulangi keputusan panel/overflow di banyak tempat.

### Ditolak — screen mobile terpisah

Duplikasi screen akan menggandakan data-fetch, state persisten, aksi, dan koneksi realtime. Parity
akan hanyut setiap kali screen desktop mendapat field atau kontrol baru; ini juga bertentangan
dengan constraint brief.

## Sistem responsif bersama

### Tier dan token

Satu modul responsif mendeklarasikan batas yang sama untuk CSS dan logika presentasi:

- `mobile`: lebar `<768px`;
- `tablet`: lebar `768–1199px`;
- `desktop`: lebar `≥1200px`.

Token CSS mencakup gutter konten per tier, lebar sidebar/rail, tinggi kontrol minimum 44px,
`env(safe-area-inset-*)`, dan dynamic viewport. `100vh` tetap fallback, lalu `100dvh` menjadi nilai
efektif. Akar dan `Shell.main` menahan `overflow-x`; elemen yang memang perlu menggulir mendatar
memakai wrapper local-overflow eksplisit.

`prefers-reduced-motion: reduce` mematikan animation dan transition dekoratif secara global.
Status, focus, dan perubahan panel tetap terbaca tanpa bergantung pada motion.

### Shell dan navigasi

`Shell` merender satu struktur navigasi yang berubah bentuk:

- mobile: sidebar menjadi drawer overlay. Tombol menu mempunyai `aria-expanded` dan
  `aria-controls`; drawer berlabel, memerangkap fokus, menutup lewat Escape/backdrop/pilihan nav,
  lalu mengembalikan fokus ke pemicu;
- tablet: rail 72px mempertahankan semua ikon. Label tetap menjadi accessible name dan tersedia
  sebagai tooltip/title;
- desktop: sidebar 248px dan wordmark existing tetap utuh.

Item nav menjadi `button`, bukan `div onClick`, sehingga Enter/Space, focus ring, dan active state
berlaku pada ketiga tier. Topbar boleh membungkus menjadi beberapa baris di mobile; title,
breadcrumb, search, update, notifikasi, dua indikator limit, page action, dan account tetap dapat
dijangkau. Tidak ada utility yang dihilangkan. Konten memakai gutter responsif dan `min-width: 0`.

### Modal, form, dan popover

`Modal` menjadi dialog modal yang benar: `role="dialog"`, `aria-modal`, hubungan title, initial
focus, focus trap, Escape sesuai `closeOnEscape`, backdrop close, dan restore focus. Pada mobile,
panel mengisi ruang dynamic viewport di dalam safe-area; header/footer tetap terlihat dan body
menjadi satu-satunya scroller. Footer dan action group boleh wrap.

Primitive interaktif memiliki hit area minimum 44×44px pada mobile/coarse pointer tanpa mengubah
kepadatan visual desktop. Checkbox, radio, switch, tabs, interactive rows, dan menu aksi mempunyai
keyboard semantics. Tabs dapat menggulir lokal sebagai navigasi kontrol, mempunyai roving focus,
dan mendukung Arrow/Home/End. Popover dibatasi terhadap viewport dan safe-area.

### Panel selector

`ResponsivePanels` adalah primitive untuk master-detail dan workspace kompleks. Ia menerima daftar
panel bernama, panel aktif, dan callback perubahan. Pada mobile hanya panel aktif terlihat, tetapi
panel lain tetap mounted agar draft, selection, WebSocket, dan xterm tidak lahir ulang. Memilih
item pada panel master memindahkan panel aktif ke detail; kontrol **Kembali/Daftar** mengembalikan
akses ke master. Pada tablet/desktop, panel yang muat kembali menjadi split tanpa mengubah state.

State domain tetap milik screen dan ADR-0115. Primitive tidak menyimpan data atau selection baru;
ia hanya mengadaptasi presentasi. Field panel aktif dipersist hanya pada screen yang memang sudah
memiliki state panel/tab, sehingga perubahan viewport sendiri tidak menimpa preferensi domain.

`ResponsiveToolbar` membungkus filter dan action tanpa memotongnya. `LocalOverflow` memberi satu
scroller eksplisit untuk tabel, board, code, diff, graph, dan terminal. Kedua primitive tidak
melakukan fetch maupun mengubah kontrak API.

## Adaptasi per keluarga layout

| keluarga | mobile | tablet | desktop |
|---|---|---|---|
| Overview dan detail project | KPI 1–2 kolom; panel dan metadata ditumpuk; aksi wrap | KPI 2 kolom | layout existing |
| Projects/list padat | row menjadi kartu bertumpuk dengan seluruh field dan aksi | tabel/grid berada dalam local overflow atau kolom lebih renggang | pseudo-table existing |
| Backlog | toolbar wrap; grid minimum 100%; list stack; board tetap local horizontal dengan semua `SpecActions` | grid/list menyesuaikan; board lokal | tiga view existing |
| PRD, Triase, Docs, Review, Spec Docs | pemilih **Daftar/Detail** atau **Tree/Dokumen** | split bila lebar konten cukup; selain itu selector | split-pane existing |
| IDE | pemilih **Files/Viewer**; mode preview/source/edit tetap ada | split dua panel dengan rail | split 300px + viewer |
| Git Graph | pemilih **Graph/Detail**; menu aksi eksplisit untuk touch; graph/diff lokal | detail dapat ditumpuk | split graph + detail 340px |
| Terminal | satu panel sesi aktif dengan selector; tray, grid controls, phase, docs, close, fullscreen tetap tersedia | grid dipadatkan/ditumpuk tanpa mengubah layout tersimpan | grid `rows × cols` existing |
| VPS, Scheduler, Lead, Changelog | row/form/action ditumpuk atau wrap; seluruh aksi tetap tampil | dua kolom bila muat | layout existing |
| Settings | section picker/horizontal tab; `SettingRow` dan form satu kolom | rail section ringkas + content | sidebar section 196px |
| Auth/setup dan Help Center | `dvh`, safe-area, satu scroller, form satu kolom | centered card | centered card existing |
| Portal klien | header/tab/action wrap; row menjadi kartu; detail list satu kolom | row fleksibel | layout existing |
| Pet Hanoman | offset safe-area, handle 44px, panel dibatasi viewport; tidak menutup kontrol | ukuran normal | posisi existing |

Board drag tetap hanya shortcut; `SpecActions` adalah jalur touch/keyboard authoritative. Git Graph
yang saat ini mengandalkan klik-kanan mendapat tombol menu per commit/ref agar aksi yang sama dapat
dibuka di layar sentuh. Terminal tidak mengubah struktur workspace di localStorage saat masuk mode
mobile: selector hanya menentukan panel yang terlihat. `ResizeObserver → FitAddon → resize WS`
tetap menjadi satu jalur resize xterm; auto-focus xterm tidak membuka virtual keyboard sampai
operator benar-benar menyentuh terminal pada coarse pointer.

## Overflow, viewport, dan safe-area

Tidak ada container tingkat halaman yang boleh mempunyai `scrollWidth > clientWidth`. Shell,
portal, auth, dan Help Center masing-masing mempunyai satu scroller tegak yang jelas. Flex/grid
child yang memuat teks panjang memakai `min-width: 0` dan wrapping/ellipsis sesuai arti data.

Overflow mendatar hanya sah di container berlabel lokal untuk:

- xterm/terminal;
- source code dan diff;
- Git Graph;
- backlog board;
- tabel data atau dokumentasi yang tidak dapat dipadatkan tanpa kehilangan arti.

Modal, fullscreen terminal, toast, popover, dan Pet menghormati safe-area. Tinggi memakai dynamic
viewport sehingga browser chrome dan virtual keyboard tidak menutup footer/action. Perubahan
ukuran viewport memicu reflow; tidak ada timer atau ukuran layar yang dipersist.

## Aksesibilitas dan feature parity

Setiap tier merender data, status, field penting, dan aksi yang sama. Adaptasi yang sah hanya:

- mengubah urutan visual;
- mengganti split-pane menjadi selector;
- membungkus toolbar/aksi;
- mengubah tabel menjadi kartu atau local scroller;
- merapatkan label visual sambil mempertahankan accessible name.

Navigasi, tabs, drawer, modal, interactive row, dan menu dapat dipakai dengan keyboard. Focus
visible tidak diklip oleh overflow. Dialog dan drawer mengembalikan fokus. Target sentuh minimum
44×44px. Status tidak hanya dibedakan oleh warna atau motion. `prefers-reduced-motion` tidak
menghapus informasi.

## Data dan runtime

Tidak ada endpoint, DTO, skema, migration, atau kanal realtime baru. Semua fetch, WebSocket,
`usePersistedState`, localStorage terminal, tmux, review, dan aksi existing tetap dipakai. Screen
tidak di-duplikasi. Tidak diperlukan ADR baru karena keputusan ini menambah kontrak presentasi pada
design system dan frontend implementation tanpa mengubah arsitektur data atau server.

## Seam TDD dan rencana bukti

Seam publik yang disepakati untuk test-first:

1. **Shell/navigation** — semua `HN_NAV` tersedia; mobile toggle membuka/menutup drawer, Escape dan
   navigasi menutupnya, fokus kembali; nav semantic keyboard; tier boundary 767/768/1199/1200.
2. **Modal/primitive** — semantics dialog, label, focus trap/restore, close contract, footer/body
   scroll, dan touch-target class berlaku dari primitive bersama.
3. **ResponsivePanels** — mobile mengaktifkan tepat satu panel tanpa unmount, item master membuka
   detail, dan mode lebar memperlihatkan split yang sama.
4. **Tabel/board/list** — Projects mempertahankan seluruh metadata/aksi di mobile; Backlog board
   tetap mempunyai scroller lokal dan jalur aksi non-drag.
5. **Workspace kompleks** — PRD/Docs/IDE/Review/Git Graph/Terminal memiliki selector yang mencapai
   setiap panel; xterm tetap menerima resize dari `ResizeObserver`.
6. **Permukaan tepi** — Auth/setup, portal, Help Center, Settings, VPS, dan Pet mempertahankan aksi
   serta kontrak scroll/focus.

Vitest/jsdom menguji perilaku, semantics, state, dan rantai scroller; ia tidak menghitung layout
pixel. Karena itu verifikasi browser dilakukan sekali di akhir pada `390×844`, `768×1024`,
`1024×768`, dan `1440×900`. Untuk setiap keluarga layout, bukti memeriksa tidak ada overflow
halaman, seluruh aksi utama dapat dijangkau, focus order benar, panel lokal dapat discroll, dan
resize terminal tetap terjadi. Overflow lokal yang diizinkan diperiksa pada containernya, bukan
dianggap kegagalan halaman.

## Acceptance criteria

- WHERE viewport lebih sempit dari 768px, THE SYSTEM SHALL menampilkan navigation drawer berisi
  seluruh `HN_NAV` dan SHALL tidak menyisakan sidebar tetap.
- WHERE viewport berada pada 768–1199px, THE SYSTEM SHALL menampilkan navigation rail ringkas yang
  mempertahankan accessible name seluruh item.
- WHERE viewport sedikitnya 1200px, THE SYSTEM SHALL mempertahankan sidebar 248px dan perilaku
  desktop existing.
- WHEN drawer atau Modal dibuka, THE SYSTEM SHALL memindahkan fokus ke dalamnya, menahan fokus,
  mendukung Escape sesuai kontrak, dan mengembalikan fokus ke pemicu saat ditutup.
- WHERE perangkat memakai mobile/coarse pointer, THE SYSTEM SHALL menyediakan target sentuh
  minimum 44×44px untuk seluruh kontrol interaktif.
- WHERE daftar/detail atau workspace kompleks ditampilkan pada mobile, THE SYSTEM SHALL menyediakan
  pemilih panel yang mencapai setiap panel tanpa menghapus state atau fitur panel lain.
- WHEN viewport kembali lebar, THE SYSTEM SHALL mengembalikan split-pane tanpa mereset selection,
  draft, posisi scroll, workspace terminal, atau state persisten ADR-0115.
- THE SYSTEM SHALL mempertahankan seluruh data, status, kontrol, field penting, dan aksi di semua
  tier; THE SYSTEM SHALL tidak menggunakan visibility sebagai pengganti feature parity.
- THE SYSTEM SHALL mencegah horizontal scroll tingkat halaman pada Shell, auth/setup, Help Center,
  dan portal klien.
- WHERE terminal, kode, diff, graph, board, atau tabel membutuhkan lebar intrinsik, THE SYSTEM SHALL
  membatasi overflow pada scroller lokal yang dapat dioperasikan.
- WHEN dynamic viewport atau virtual keyboard berubah, THE SYSTEM SHALL menjaga kontrol/footer
  aktif tetap dapat dicapai dan SHALL me-resize xterm melalui jalur existing.
- WHERE safe-area tersedia, THE SYSTEM SHALL menjauhkan drawer, modal, toast, fullscreen terminal,
  popover, dan Pet dari inset perangkat.
- WHERE `prefers-reduced-motion: reduce` aktif, THE SYSTEM SHALL menonaktifkan motion dekoratif
  tanpa menghilangkan status, focus, atau perubahan panel.
- THE SYSTEM SHALL mempertahankan WebSocket realtime, tmux, resize xterm, state persisten ADR-0115,
  serta perilaku desktop existing tanpa endpoint, skema, migration, atau screen mobile duplikat.
- WHEN perubahan diverifikasi, THE SYSTEM SHALL membuktikan keluarga shell, modal/form,
  table/list/board, master-detail, workspace kompleks, auth/help/portal, dan Pet pada 390×844,
  768×1024, 1024×768, dan 1440×900.

## Non-goals

- redesign visual di luar grammar editorial instrument-panel;
- perubahan navigasi URL/router;
- perubahan API/server/database;
- mengganti xterm, tmux, atau WebSocket;
- mempersist ukuran viewport atau membuat layout mobile kedua;
- menghapus fitur desktop demi memuat layar kecil.
