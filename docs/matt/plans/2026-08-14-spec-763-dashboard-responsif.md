# SPEC-763 — Dashboard responsif · Implementation Plan

> Kerjakan task berurutan. Setiap kotak wajib menjadi `- [x]` setelah implementasi dan buktinya
> benar-benar selesai. Detail desain: [design doc](../specs/2026-08-14-spec-763-dashboard-responsif-design.md).

**Goal:** Seluruh dashboard, auth/setup, Help Center, dan portal klien mempunyai feature parity
penuh pada mobile, tablet, dan desktop tanpa horizontal scroll tingkat halaman.

**Architecture:** Satu sistem responsif di design system menyediakan tier, safe-area/dynamic
viewport, target sentuh, Shell drawer/rail/sidebar, Modal, toolbar, local overflow, dan panel
selector. Screen existing bermigrasi per keluarga layout; tidak ada screen mobile, data flow,
endpoint, atau state persisten kedua.

**Tech stack:** React 18 + TypeScript, CSS media queries, Testing Library, Vitest, xterm.js.

## Global constraints

- Breakpoint persis: mobile `<768px`, tablet `768–1199px`, desktop `≥1200px`.
- Navigation drawer mobile, rail tablet, sidebar desktop 248px; seluruh `HN_NAV` tetap tersedia.
- Tidak boleh menyembunyikan data, status, field penting, kontrol, atau aksi.
- Target sentuh minimum 44×44px; keyboard/focus/ARIA dan reduced-motion tetap benar.
- Dynamic viewport, safe-area, serta virtual keyboard tidak boleh menutup kontrol aktif.
- Horizontal overflow hanya lokal untuk terminal, kode, diff, graph, board, dan tabel.
- State ADR-0115, WebSocket realtime, tmux, resize xterm, dan perilaku desktop tetap utuh.
- Tidak ada endpoint, skema, migration, atau screen mobile duplikat.
- Verifikasi hanya berkas/paket yang berubah; suite/lint/build penuh tidak dijalankan rutin.
- Docs Source of Truth diperbarui dan tetap terjangkau dari `internal/docs/README.md`.

---

### Task 1 — Fondasi tier, viewport, touch, dan panel responsif

**Blocked by:** None — dapat dimulai langsung.

**What it delivers:** Seluruh screen dapat memakai satu vocabulary responsive untuk tier,
safe-area, dynamic viewport, toolbar, local overflow, dan pemilih panel tanpa menyalin aturan.

- [x] Tulis test gagal untuk boundary 767/768/1199/1200 dan perubahan media query yang
  memperbarui tier presentasi tanpa mempersist lebar viewport.
- [x] Tulis test gagal `ResponsivePanels` yang membuktikan selector mencapai semua panel,
  panel nonaktif tetap mounted, dan mode lebar memakai panel yang sama.
- [x] Implementasikan token/query tier, safe-area, `100dvh` dengan fallback, gutter responsif,
  target sentuh, reduced-motion global, `ResponsiveToolbar`, `LocalOverflow`, dan
  `ResponsivePanels`.
- [x] Jalankan test fondasi, pastikan siklus red → green benar, lalu typecheck paket web.

---

### Task 2 — Shell drawer/rail/sidebar dan Modal aksesibel

**Blocked by:** Task 1 — memakai tier, viewport, dan target sentuh bersama.

**What it delivers:** Operator dapat menavigasi dan memakai dialog pada mobile, tablet, maupun
desktop; seluruh utility topbar dan aksi tetap terjangkau dengan keyboard dan touch.

- [x] Tulis test gagal Shell untuk nav semantic, parity 13 `HN_NAV`, drawer open/close,
  `aria-expanded`, Escape, close setelah navigasi, focus trap/restore, rail tablet, dan sidebar
  desktop 248px.
- [x] Implementasikan satu struktur Shell yang menjadi drawer mobile, rail tablet, dan sidebar
  desktop; buat topbar/action/search/status/account wrap tanpa overflow halaman.
- [x] Tulis test gagal Modal untuk `role=dialog`, accessible title, focus trap/restore,
  `closeOnEscape`, body/footer yang tetap terjangkau, serta target close 44px.
- [x] Implementasikan lifecycle fokus Modal, ukuran dynamic viewport/safe-area, footer wrap,
  popover viewport clamp, dan keyboard semantics primitive interaktif/tabs.
- [x] Jalankan test Shell/Modal/design-system terkait dan typecheck paket web.

---

### Task 3 — Overview, table/list/board, row aksi, dan form padat

**Blocked by:** Task 1 dan Task 2 — memakai toolbar, local overflow, dan chrome final.

**What it delivers:** Overview, Projects, detail project, Backlog, Scheduler, Lead, VPS, dan
Changelog tetap lengkap tanpa memaksa halaman melebar.

- [x] Tulis test gagal Projects mobile yang membuktikan setiap field dan aksi row tetap ada,
  row dapat dioperasikan lewat keyboard, dan tabel/row tidak menjadi overflow halaman.
- [x] Tulis test gagal Backlog yang membuktikan toolbar/filter/view dapat diakses, grid menyusut,
  board tetap local-horizontal, dan semua `SpecActions` tersedia sebagai jalur non-drag.
- [x] Adaptasikan KPI/grid/metadata, pseudo-table/list rows, toolbar/filter, action groups, dan
  modal form di Overview, Projects, Project detail, Backlog, Scheduler, Lead, VPS, dan Changelog.
- [x] Pertahankan tabel webhook/MCP serta board di scroller lokal bersama; ubah interactive row
  menjadi semantic keyboard control tanpa mengubah callback.
- [x] Jalankan test keluarga list/table/board/form yang berkaitan dan typecheck paket web.

---

### Task 4 — Master/detail PRD, Triase, Docs, Review, dan Spec Docs

**Blocked by:** Task 1 dan Task 2 — memakai `ResponsivePanels` dan Modal final.

**What it delivers:** Pada mobile operator dapat berpindah antara daftar/tree dan detail/dokumen,
sementara layar lebar mempertahankan split-pane serta state selection existing.

- [x] Tulis test gagal selector panel untuk PRD, Docs, Review, dan Spec Docs: semua panel dapat
  dicapai, memilih item membuka detail, kembali ke master bekerja, dan selection tidak hilang.
- [x] Adaptasikan PRD, Triase, Docs, Review, dan Spec Docs ke panel selector mobile serta
  split-pane tablet/desktop yang sesuai tanpa fetch/state kedua.
- [x] Pertahankan rantai `Card fill`, scroll restoration, preview/edit/download, Markdown
  sanitizer, dan local overflow code/diff.
- [x] Jalankan test screen, scroll-chain, preview, dan state persisten yang berkaitan lalu
  typecheck paket web.

---

### Task 5 — Workspace IDE, Git Graph, dan Terminal

**Blocked by:** Task 1–2 — memakai panel selector, local overflow, viewport, dan target sentuh.

**What it delivers:** Workspace kompleks dapat dioperasikan dari ponsel tanpa mengubah workspace
desktop, koneksi realtime, atau jalur resize xterm.

- [x] Tulis test gagal IDE/Git Graph untuk selector Files/Viewer dan Graph/Detail, seluruh aksi
  touch yang sebelumnya hanya lewat klik-kanan, serta local overflow code/diff/graph.
- [x] Implementasikan panel responsif IDE, Review viewer yang dipakai IDE, Git Graph detail,
  menu aksi touch, dan overlay graph yang terikat safe-area.
- [x] Tulis test gagal Terminal untuk selector sesi/panel mobile, parity tray/grid controls/
  phase/docs/close/fullscreen, workspace desktop yang tidak berubah, dan pane nonaktif tetap mounted.
- [x] Implementasikan mode panel mobile Terminal, tinggi `dvh`, safe-area fullscreen, semantic
  action controls, serta focus policy yang tidak membuka virtual keyboard sebelum touch.
- [x] Buktikan `ResizeObserver → FitAddon → resize WS` tetap berjalan sesudah panel/viewport berubah.
- [x] Jalankan test IDE/Git Graph/Terminal yang berkaitan dan typecheck paket web.

---

### Task 6 — Settings, auth/setup, Help Center, portal klien, dan Pet Hanoman

**Blocked by:** Task 1–2 — memakai viewport, modal, toolbar, target sentuh, dan safe-area bersama.

**What it delivers:** Semua permukaan di luar workspace utama mempunyai scroll, focus, data, dan
aksi yang sama pada mobile, tablet, dan desktop.

- [x] Tulis test gagal Settings untuk section picker mobile, row/form satu kolom, dan seluruh
  section tetap dapat dijangkau tanpa mengubah state tab persisten.
- [x] Tulis test gagal Auth/Help/portal untuk dynamic viewport, satu scroller tegak, header/tab/
  row yang wrap, keyboard Space/Enter, serta seluruh metadata dan aksi modal tetap ada.
- [x] Tulis test gagal Pet untuk handle 44px, safe-area offset, panel viewport clamp, dan
  reduced-motion tanpa kehilangan status/action.
- [x] Implementasikan adaptasi Settings, AuthScreen, PublicHelpApp, ClientPortal/TicketForm, dan
  HanomanPet tanpa mengubah API maupun state domain.
- [x] Jalankan test permukaan tersebut, portal scroll-chain, Pet motion, dan typecheck paket web.

---

### Task 7 — Source of Truth, review dua sumbu, dan verifikasi viewport

**Blocked by:** Task 1–6 — seluruh keluarga layout harus stabil.

**What it delivers:** Kontrak responsive terdokumentasi, seluruh checklist terbukti, dan diff
siap dikirim dengan bukti yang sebanding dengan blast radius frontend.

- [x] Perbarui design system dan frontend implementation sebagai SoT; tautan keduanya di
  `internal/docs/README.md` tetap benar dan menyebut kontrak SPEC-763.
- [x] Jalankan test related/changed hanya untuk berkas yang berubah dan pastikan test benar-benar
  dieksekusi, lalu typecheck hanya paket web.
- [x] Verifikasi browser pada 390×844, 768×1024, 1024×768, dan 1440×900 untuk setiap keluarga:
  shell, modal/form, table/list/board, master-detail, workspace kompleks, auth/help/portal, dan Pet.
- [x] Pastikan `scrollWidth <= clientWidth` di tingkat halaman; pastikan overflow yang diizinkan
  berada di scroller lokal dan seluruh aksi utama dapat dijangkau.
- [x] Jalankan `git diff --check`, audit state/WS/xterm/desktop parity, dan ubah seluruh kotak
  plan menjadi `- [x]` hanya sesudah buktinya ada.
- [x] Jalankan `mattpocock-skills:code-review` dua sumbu terhadap fixed point awal sesi, perbaiki
  seluruh temuan, lalu ulangi verifikasi terarah yang terdampak.

> Bukti browser CLI (2026-08-14): Chrome headless menyapu 13 layar HN_NAV pada 390×844,
> 768×1024, 1024×768, dan 1440×900, ditambah Auth, Help Center, dan portal klien. Semua root
> halaman menghasilkan nol pelanggaran `scrollWidth > clientWidth`, nol target sentuh di bawah
> 44×44 pada mobile/tablet, modal tetap di dalam viewport dengan fokus awal di dialog, drawer
> mengembalikan fokus, dan board mempertahankan overflow lokal `auto` (1768 px) tanpa mendorong
> halaman. Sweep pertama menemukan pager 28 px, opener project 41 px, row Overview 39 px, dan
> chip tray Terminal 17 px; semuanya diperbaiki dan sweep penuh berikutnya lulus.
