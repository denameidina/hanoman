# SPEC-800 — Halaman Terminal: aksi terjangkau, ketikan tak hilang, dialog claude bisa dijawab

> Design doc · 2026-08-15 · sumber qa · prioritas tinggi
> Audit doc-of-record: [`internal/docs/research/audit-spec-800-terminal-aksi-fokus-dialog-mobile.md`](../../../internal/docs/research/audit-spec-800-terminal-aksi-fokus-dialog-mobile.md)
> **ADR baru: tidak ada.** ADR-0014, ADR-0016, ADR-0115, ADR-0117, dan kontrak responsive SPEC-763
> ditegakkan. Tidak ada perubahan skema, migration, endpoint, maupun payload WebSocket.

## Masalah

Audit menemukan enam gejala yang dilaporkan lahir dari **empat** mekanisme:

- **M1** — aksi halaman Terminal tak punya ember overflow. Header sel duduk di dalam kotak
  ber-`overflow: hidden`, dan satu-satunya katup (`flex-wrap`) hanya menyala ≤767px, jadi pada
  768–1199px dan pada grid multi-kolom aksi **dipotong dan tak bisa diklik**. Di mobile katup itu
  menyala tetapi harganya vertikal: ~24 kontrol ≥44px mengelilingi satu pane.
- **M2** — `TerminalPane` tak memasang `onclose`/`onerror` dan tak pernah menyambung ulang. Setiap
  penutupan socket (revalidasi principal per-frame & per-60-detik, kuota, restart server, jaringan)
  membuat `sendInput` menumpuk karakter di `pendingInput` yang tak punya pembaca — ketikan hilang
  tanpa satu tanda pun.
- **M3** — wheel adalah milik tmux. xterm 6 mematikan `handleMouseWheel`-nya sendiri begitu protokol
  mouse aktif, dan tmux `mouse on` (SPEC-209) membawa wheel ke copy-mode yang **menawan keyboard
  pane**. Di mobile tap tak pernah menjadi laporan mouse dan keyboard virtual tak punya `↑`/`↓`/`Esc`,
  jadi dialog `AskUserQuestion` claude tak bisa dijawab sama sekali.
- **M4** — `fontSize: 13` adalah konstanta di konstruktor xterm; tak ada kontrol, tak ada persistensi.

## Objective

Pada lebar berapa pun dan pada perangkat apa pun, operator (a) dapat memilih setiap aksi halaman
Terminal, (b) tidak kehilangan ketikan tanpa tanda, (c) dapat menjawab dialog pilihan claude, dan
(d) dapat membaca output dengan nyaman — dengan pane mendapat porsi layar terbesar di mobile.

## Keputusan arsitektur

### 1. Satu pola overflow di DS, dipakai dua tempat

Tambah komponen DS `OverflowActions` (`ds/components/ui.tsx`, diekspor lewat barrel):

```tsx
type OverflowItem = {
  key: string; label: string; icon?: string;
  onSelect: () => void; disabled?: boolean; title?: string; tone?: "default" | "danger";
};
<OverflowActions label="Aksi lain" items={items}>{extra}</OverflowActions>
```

Trigger = `IconButton` ikon `more-horizontal`; panel = `Modal` DS yang **sudah** menjadi bottom
sheet di mobile (`app.css` `.hn-modal-overlay { align-items: flex-end }`, `.hn-modal-panel` lebar
penuh). Memakai `Modal` — bukan popover terposisi — dipilih karena panel terposisi harus dihitung
terhadap tepi viewport dan safe-area, sementara `Modal` sudah membawa focus trap, `Escape`,
restorasi fokus, dan bentuk sheet mobile secara cuma-cuma. `children` opsional memberi tempat untuk
kontrol yang bukan sekadar aksi (pemilih project, penyetel ukuran font).

**Kenapa DS, bukan komponen lokal:** kedua pemakainya (header sel dan toolbar halaman) hidup di
berkas yang sama hari ini, tetapi "aksi yang tidak muat runtuh ke satu tombol" adalah kontrak
responsive yang sudah punya kerabat di DS (`ResponsiveToolbar`, `LocalOverflow`) dan keduanya
**scroller**, yang tak menolong di dalam kotak ber-`overflow: hidden`. Ember menu adalah keping yang
hilang dari kontrak itu.

### 2. Runtuhnya diputuskan lebar **kontainer**, bukan lebar viewport

Sel grid 4 kolom pada desktop 1440px lebih sempit daripada satu pane di ponsel 390px. Karena itu
header sel mengamati **lebarnya sendiri** lewat `ResizeObserver` dan menyerahkan keputusannya pada
satu fungsi murni di `screens/terminal-chrome.ts`:

```ts
export const HEADER_MIN_LABEL = 96;   // label sesi tak boleh menyusut di bawah ini
export function inlineActionCount(width: number, total: number, actionPx: number): number
```

Fungsi murni + observer tipis: jsdom tak punya layout engine, jadi yang diuji adalah aritmetikanya
(`inlineActionCount`) dan **perilaku** komponennya di bawah lebar yang disuntikkan lewat
`ResizeObserver` palsu — pola yang sama dengan test `TerminalPane` yang sudah ada.

`actionPx` mengikuti pointer: 28px (halus) / 44px (kasar), mencermin `app.css:356-381`. Aksi yang
tersisa selalu masuk ke `OverflowActions`, jadi **tak ada lebar** yang membuat sebuah aksi tak
terjangkau. Dua aksi paling sering dipakai (`Layar penuh`, `Tutup`) tetap inline pada lebar berapa
pun; sisanya runtuh lebih dulu.

### 3. Sambung ulang WebSocket: hak yang sama, bukan jalan pintas

`TerminalPane` memasang `onclose`/`onerror` dan menyambung ulang dengan backoff bertingkat
(500ms → 1s → 2s → 4s → 8s, plafon 8s, 12 percobaan ≈ 76 dtk) dengan aturan:

- **Tiket baru tiap percobaan.** `issueWsTicket` bersifat sekali pakai; sambung ulang menempuh
  jalur admission yang sama persis (ADR-0117) — tak ada pintu belakang.
- **Kode 4004 (`not found`) tidak disambung ulang.** Sesi tmux-nya sudah lenyap; menyambung ulang
  hanya menghasilkan badai 404.
- **Unmount membatalkan timer.** Pane yang dilepas tak boleh menghidupkan socket zombi.
- **`pendingInput` dikuras di setiap `onopen`**, bukan hanya yang pertama. Ini inti perbaikannya:
  buffer SPEC-771 berubah dari penyembunyi kegagalan menjadi penyelamat ketikan.
- **Keadaan terlihat.** Strip tipis di dalam pane: `menyambung ulang… (2/12)`, lalu
  `terputus — Sambungkan lagi` sebagai tombol saat percobaan habis. Diam adalah cacatnya; diam
  tidak boleh menjadi bagian dari perbaikannya.

Batas percobaan + backoff menjaga janji SPEC-761: satu pane tak boleh menjadi generator koneksi.

### 4. Papan tombol layar — satu keystroke per tekan

Komponen `TerminalKeys` di dalam pane, mengirim lewat jalur `sendInput` yang sama dengan ketikan:

| Tombol | Byte |
|---|---|
| `Esc` | `\x1b` |
| `Tab` | `\t` |
| `↑` `↓` `←` `→` | `\x1b[A` `\x1b[B` `\x1b[D` `\x1b[C` |
| `Enter` | `\r` |

**Invariant SPEC-452 ditegakkan di sini:** tiap tekan mengirim **tepat satu** panggilan `sendInput`
dengan satu keystroke. Dialog `AskUserQuestion` adalah daftar Ink yang menelan burst >1 karakter;
menggabungkan tombol (mis. "kirim `\x1b[B\x1b[B`") akan mengulang bug itu dari sisi lain.

`Esc` bukan sekadar kelengkapan: ia satu-satunya jalan keluar dari copy-mode tmux — akar keluhan #3
— dan di mobile keyboard virtual tak menyediakannya sama sekali.

Catatan yang sengaja dipertahankan: hanoman **tidak** mem-bind `Escape` browser untuk menutup
overlay (komentar `TerminalScreen.tsx:250-252`). `TerminalKeys` tidak melanggarnya — ia **mengirim**
`Escape` ke pane, bukan merebutnya dari TUI.

Default tampil: **menyala pada pointer kasar/mobile, mati pada desktop**, dan dapat ditoggle;
pilihannya persisten (§6).

### 5. Tap memilih opsi dialog — lewat kosakata yang sudah terbukti

xterm tidak menerjemahkan sentuhan menjadi laporan mouse, dan menyintesis laporan SGR sendiri berarti
menebak protokol mouse aktif dari API privat. Jalur yang dipilih memakai fakta yang **sudah terukur**
pada audit SPEC-452: **satu digit sebagai keystroke tersendiri langsung memilih baris bernomor itu**.

Fungsi murni di `screens/terminal-chrome.ts`:

```ts
export function dialogChoiceAt(lines: string[], row: number): string | null
```

- mengembalikan `null` kecuali layar memuat footer dialog Ink (`Enter to select` **dan** `to navigate`);
- mengembalikan digit baris yang di-tap bila baris itu cocok `^\s*[❯>*]?\s*(\d)\.\s`;
- mengembalikan `null` untuk baris lain — tap biasa tetap sekadar memfokuskan pane.

Gerbang footer itulah yang membuat mekanisme ini aman: pada layar kerja biasa (log, diff, daftar
bernomor apa pun) ia **tidak pernah** mengirim apa-apa. Batas satu digit (`\d`, bukan `\d+`) juga
disengaja — hotkey dialog claude hanya sampai `jumlah_opsi + 2` baris dan pengiriman multi-digit
akan menjadi burst yang ditelan.

Baris dibaca lewat API publik `term.buffer.active` + `translateToString`.

### 6. Ukuran font terminal = state tampilan persisten

`usePersistedState("terminal", "fontSize", <default tier>, isNum)` (SPEC-740 · ADR-0115), dijepit
`10..24`, defaultnya `13` pada desktop dan `15` pada mobile. Nilai tersimpan menang atas default
tier — operator yang sudah memilih tak boleh dipaksa berubah karena memutar layar.

`TerminalPane` menerima `fontSize` sebagai prop dan menerapkannya di effect **terpisah** dari effect
koneksi:

```ts
React.useEffect(() => { term.options.fontSize = fontSize; fit.fit(); send resize }, [fontSize])
```

Terminal **tidak** di-remount: remount berarti socket baru, tiket baru, dan layar kosong sampai tmux
menggambar ulang. `cols`/`rows` PTY adalah turunan ukuran font, jadi frame `resize` wajib menyusul —
tanpa itu tmux tetap menggambar untuk geometri lama.

Penyetelnya (`A−` / `A+` + label ukuran) tinggal di panel overflow, bukan di toolbar: ia kontrol yang
dipakai sekali lalu dilupakan, dan menaruhnya inline melawan tujuan #6.

### 7. Wheel: default SPEC-209 tak diganggu, `Shift` membuka jalur lokal

`attachCustomWheelEventHandler` dipasang dan mengembalikan `true` (teruskan) untuk wheel polos —
SPEC-209 tetap berlaku: wheel → tmux → copy-mode → riwayat 50 000 baris. Hanya `Shift+wheel` yang
dibelokkan ke `term.scrollLines()` lalu mengembalikan `false`, memberi satu jalur gulir yang
**tidak pernah** melewati mouse-mode dan karena itu tetap hidup saat dialog claude memegang mouse.

Mengubah default ditolak: scrollback dalam ada di tmux, bukan di buffer xterm, dan membelokkan wheel
polos akan menukar riwayat 50 000 baris dengan riwayat sisa yang kebetulan sempat mengalir ke klien.

### 8. Kepadatan mobile

- **Toolbar halaman (mobile):** inline hanya `Sesi baru` + maximize; `+ Kolom`, `+ Baris`,
  `Ambil backlog`, `Riwayat`, `Terminal biasa`, `Hapus kolom`, `Hapus baris`, pemilih project, dan
  penyetel ukuran font masuk ke satu `OverflowActions`.
- **Header sel:** dikendalikan §2.
- **Baris `Hapus kolom`/`Hapus baris` mobile** lenyap dari layar (pindah ke overflow); strip tab
  panel tetap, karena ia orientasi, bukan aksi.

Aksi tak ada yang dihapus, hanya dipindahkan — "semua aksi tetap dapat dipilih di lebar berapa pun".

## Acceptance criteria

1. **AC-1** Pada lebar kontainer berapa pun, setiap aksi header sel dapat dicapai: yang tak muat
   tampil di panel `OverflowActions`, dan `Layar penuh` + `Tutup` selalu inline.
2. **AC-2** Toolbar halaman di mobile menampilkan paling banyak dua kontrol inline; sisanya di
   panel overflow, dan tak satu pun aksi hilang.
3. **AC-3** Sesudah socket terminal tertutup, pane menyambung ulang (backoff bertingkat, tiket baru
   tiap percobaan, berhenti pada kode 4004 dan sesudah 12 percobaan), dan input yang diketik selama
   putus terkirim berurutan begitu socket terbuka lagi.
4. **AC-4** Keadaan koneksi terlihat: `menyambung ulang… (n/12)` selama mencoba, dan tombol
   `Sambungkan lagi` sesudah menyerah.
5. **AC-5** `TerminalKeys` mengirim `Esc`, `Tab`, `↑`, `↓`, `←`, `→`, `Enter` sebagai **satu**
   panggilan input berisi **satu** keystroke per tekan.
6. **AC-6** Papan tombol menyala secara default pada pointer kasar dan mati pada desktop; togglenya
   persisten lintas refresh.
7. **AC-7** Tap pada baris dialog bernomor mengirim satu digit; tap pada layar tanpa footer dialog
   tidak mengirim apa pun.
8. **AC-8** Ukuran font terminal dapat dinaikkan/diturunkan (10–24), tersimpan lintas refresh, dan
   perubahannya memicu `fit()` + frame `resize` **tanpa** me-remount pane/socket.
9. **AC-9** `Shift+wheel` menggulir scrollback xterm dan tidak diteruskan sebagai laporan mouse;
   wheel polos tetap diteruskan (SPEC-209 utuh).
10. **AC-10** Tak ada perubahan skema, migration, endpoint, atau payload WS; test terminal dan
    responsive yang sudah ada tetap hijau.

## Yang sengaja TIDAK dikerjakan

- **Menyintesis laporan mouse SGR dari sentuhan.** Menuntut pengetahuan protokol mouse aktif lewat
  API privat xterm; §5 mencapai hasil yang sama lewat kosakata yang sudah terukur.
- **Mendeteksi copy-mode tmux di server** (`#{pane_in_mode}` pada frame `sessions`). Menarik, tetapi
  menambah payload dan polling untuk sesuatu yang sudah diselesaikan tombol `Esc`. Dicatat sebagai
  kandidat lanjutan.
- **Memindahkan `fontSize` ke server per-user** (seperti SPEC-786 untuk workspace). Butuh skema +
  migration + ADR; ADR-0115 sudah menyatakan state presentasional tetap lokal.
- **Mengganti default wheel** — lihat §7.
