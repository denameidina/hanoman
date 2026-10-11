# ADR-0209 — Terminal: rail sesi dan pane fokus sebagai default, grid opsional

- Status: Diterima
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · Fase 3E (tanpa nomor SPEC; keputusan dari audit)
- Terkait: **0118** (workspace kanonik per akun tak berubah; mode fokus/grid tidak masuk workspace), **0115** (mode tampilan dan pilihan papan tombol sebagai `ui-state` per browser), **0016** (sesi tetap hidup di tmux), **0177** (dikte suara tetap di dock composer), **0205** (hub Sesi), **0202** (tak ada API baru, jadi tak ada keputusan MCP).

## Konteks

Terminal berbasis grid `rows × cols` sejak awal. Audit mencatat toolbar dengan sembilan kontrol berbobot sama, header
sel yang penuh ikon ambigu, dan keyboard trap: semua tombol diteruskan ke pty tanpa jalan keluar yang terlihat
(`TerminalPane.tsx:486-498`). Di ponsel, papan tombol khusus yang terbuka memakan sekitar sepertiga layar (komentar
di `TerminalScreen.tsx`). Usulan audit: rail sesi bertanda status plus satu pane fokus, dengan grid sebagai opsi.

## Keputusan

### 1. Default: Fokus (rail sesi + satu pane)

Mode tampilan disimpan di ui-state `terminal.view` (kunci `hn.ui.v1.terminal.view`), dengan default `focus`. Nilai rusak
di storage jatuh ke Fokus.

- **Rail** (`SessionRail` di `TerminalRail.tsx`) mengurutkan sesi dengan `sortRail`: *butuh keputusan* → *berjalan* →
  *gagal* → *selesai*. Di dalam grup "butuh keputusan", yang paling lama menunggu tampil lebih dulu. Grup lain
  mempertahankan urutan masuk, sehingga baris tak melompat tiap frame WebSocket.
- Tiap baris berisi tombol fokus (roving tabindex, `aria-current`), `StatusPill`, waktu relatif yang diperbarui tiap
  30 dtk, dan menu ⋯ (`OverflowActions`). Aksi tak pernah ada di dalam tombol klik baris.
- **Pane fokus** memasang satu `TerminalPane`, sehingga satu sesi tetap satu attach tmux.

### 2. Grid opsional

Toggle **Fokus | Grid** memilih mode. Grid memakai workspace kanonik ADR-0118 tanpa perubahan. Deep link
(`focusSession` dari notifikasi atau palet), sesi baru, ambil backlog, dan riwayat membuka sesi di fokus **dan**
menempatkannya di grid, sehingga susunan grid tetap utuh.

### 3. Toolbar maksimal enam kontrol

Toolbar: **Sesi baru** (primer) · **Buka…** · **Fokus | Grid** · **Tampilan** · **Layar penuh**. Kontrol susunan grid
(tab grup, `+ Kolom`, `+ Baris`) hanya tampil di mode grid, dan di layar sempit masuk menu **Atur grid**.

### 4. Tutup sesi selalu dikonfirmasi

"Tutup" dari rail atau pane fokus lewat `useConfirm` dan menyebut nama sesinya. Sel grid tetap punya tombol × sendiri.

### 5. Ponsel: laci rail, papan tombol tertutup

- Di bawah 768 px, rail menjadi laci (`Modal`) yang dibuka dari "Sesi · N". Memilih sesi di laci menutupnya dan membuka
  sesi itu. Toolbar tetap satu baris.
- **Papan tombol khusus tertutup secara default di ponsel**: `usePersistedState("terminal", "keys", coarse && !mobile)`.
  Tablet sentuh tetap terbuka. Pilihan yang sudah tersimpan (`hn.ui.v1.terminal.keys`) selalu menang atas default.
- Tinggi pane dijaga `min-height: calc(55dvh + 168px)` di `terminal.css`, sehingga xterm mendapat sekitar 55% viewport
  dalam keadaan default.

### 6. Keluar fokus terminal: Ctrl+Shift+Esc

`isFocusEscape` (`terminal-chrome.ts`) melepas **fokus keyboard** dari xterm. Ini bukan mode tampilan. Tombol teks
"Keluar fokus terminal · Ctrl+Shift+Esc" tampil di pane selama fokus berada di dalam terminal. Tab dan Esc tetap
diteruskan ke sesi selama fokus di sana.

## Alternatif yang ditolak

1. **Grid tetap sebagai default.** Ditolak: sembilan kontrol di toolbar dan sel yang sempit di ponsel. Usulan audit
   juga menetapkan fokus sebagai default.
2. **Esc sebagai jalan keluar fokus.** Ditolak: Esc polos adalah tombol yang paling sering dipakai TUI agen
   (`terminal-chrome.ts`).
3. **Ctrl polos sebagai jalan keluar.** Ditolak: Ctrl+C dan Ctrl+V polos adalah milik TUI (SIGINT dan literal), sesuai
   komentar di `terminal-clipboard.ts`.
4. **Mode fokus/grid disimpan di workspace server.** Ditolak: ini tampilan per browser. Workspace kanonik (ADR-0118)
   hanya menyimpan koordinat sesi.
5. **Papan tombol terbuka secara default di ponsel.** Ditolak: papan itu memakan sepertiga layar (komentar kode).

## Konsekuensi & gotcha

- Status "Selesai" di rail hanya diketahui untuk sesi yang pernah dibuka di pane (verdict dari frame fase). Sesi lain
  tampil "Berjalan" sampai dibuka. Status "Putus" hanya ada di riwayat, bukan di daftar hidup. Ini keterbatasan yang
  sudah tercatat di frontend-implementation § 3E.
- Suite grid (`terminal-screen`, `terminal-screen-memo`, `terminal-cleanups`) memasang `terminal.view = "grid"` secara
  eksplisit.
- jsdom tak mengukur tinggi. Kontrak CSS untuk ponsel diikat di `terminal-css-contract.test.ts`. Angka nyatanya
  adalah verifikasi visual di 390×844, yang belum tercatat di audit.
- Tak ada API baru, sehingga tak ada keputusan MCP.

## Bukti

- Commit: `e5d44eac` (rail, `TerminalRail.tsx`, `terminal-rail.ts`, default Fokus), `56eb30cd` (terminal ponsel
  ringkas), `fce3210e` (Ctrl+Shift+Esc di `terminal-chrome.ts`, Fase 1).
- Berkas: `src/src/screens/TerminalScreen.tsx` (`view`, `keysOpen`, `FocusView`), `src/src/screens/TerminalRail.tsx`,
  `src/src/screens/terminal-rail.ts` (`RAIL_RANK`, `sortRail`, `railStatus`), `src/src/screens/TerminalPane.tsx`
  (dock ringkas, tombol keluar fokus), `src/src/screens/terminal-chrome.ts` (`isFocusEscape`),
  `src/src/screens/styles/terminal.css`.
- Tes: `src/test/terminal-focus.test.tsx`, `src/test/terminal-rail.test.ts`, `src/test/terminal-pane.test.tsx`,
  `src/test/terminal-css-contract.test.ts`.
- Dokumen: [frontend-implementation § Fase 3E](../frontend/frontend-implementation.md),
  [design-system § Kontras, konfirmasi, dan error](../design-system/design-system.md).
