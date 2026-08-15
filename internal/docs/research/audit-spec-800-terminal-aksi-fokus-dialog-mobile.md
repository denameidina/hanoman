# Audit SPEC-800 — halaman Terminal: aksi tak terjangkau, ketikan hilang, dialog claude mati (desktop & mobile)

- **Sumber**: finding QA SPEC-800 · severity `major` · prioritas `tinggi`
- **Tanggal**: 2026-08-15
- **Menyentuh (dugaan Execute)**: `src/src/screens/TerminalPane.tsx` · `src/src/screens/TerminalScreen.tsx` ·
  `src/src/app.css` · `src/src/ds/**` (bila kontrol overflow dinaikkan ke DS)
- **Keputusan fase**: **Spec dan Plan DIJALANKAN**, tidak dilewati. Alasannya di §7.
- **ADR**: tidak ada ADR baru yang dibutuhkan sejauh audit ini. ADR-0014 (PTY di proses API),
  ADR-0016 (sesi hidup di tmux), ADR-0115 (state tampilan persisten), ADR-0117 (revalidasi
  principal WS), kontrak responsive SPEC-763, dan temuan SPEC-452 **ditegakkan**, bukan diamandemen.

---

## 1. Enam keluhan, empat mekanisme

Finding ini menyebut enam gejala. Audit menemukan bahwa gejala 1 & 6 berbagi satu akar, gejala 3 & 4
berbagi satu akar, dan gejala 2 serta 5 punya akarnya sendiri. Empat mekanisme, bukan enam:

| # | Gejala yang dilaporkan | Akar |
|---|---|---|
| 1 | Aksi terdesak/terpotong saat viewport sempit, tak ada "More" | **M1** aksi tanpa ember overflow, di dalam kotak ber-`overflow: hidden` |
| 6 | Mobile terlalu ramai tombol, pane kebagian sisa | **M1** (bentuk vertikalnya) |
| 2 | Intermiten tak responsif saat mengetik | **M2** socket mati diam-diam; tak ada `onclose`, tak ada sambung ulang |
| 3 | Dialog claude: tak bisa scroll, panah tak memindah sorotan | **M3** wheel milik tmux → copy-mode menawan keyboard pane |
| 4 | Mobile: opsi dialog tak bisa di-tap, tak ada kontrol naik/turun | **M3** + tak ada papan tombol layar |
| 5 | Mobile: terminal terlalu kecil | **M4** `fontSize` konstanta, tanpa kontrol, tanpa persistensi |

---

## 2. M1 — aksi tak punya ember overflow, dan kotaknya memotong

### 2.1 Header sel memotong, bukan membungkus

`TerminalScreen.tsx:386-390` membungkus tiap sel grid dengan:

```tsx
<div key={id ?? `empty-${idx}`} data-terminal-cell-index={idx} style={{
  minHeight: 0, minWidth: 0, …, overflow: "hidden",
}}>
```

`overflow: "hidden"` itulah yang mengubah "terdesak" menjadi "tidak dapat dipilih sama sekali":
apa pun yang melewati tepi kanan sel bukan hanya tak terbaca, ia **tak bisa diklik** — persis
jebakan pengukuran yang sudah tercatat pada audit responsive sebelumnya (`scrollWidth <= clientWidth`
LULUS justru karena kontennya dipotong).

Isi header sel (`Cell`, `TerminalScreen.tsx:697-778`) pada sesi ber-spec: ilustrasi state (34px) ·
label (`flex: 1`) · pil status · petunjuk clipboard · dokumen · review · integrate · layar penuh ·
`lepas` · `×`. Delapan di antaranya kontrol, dan tiap kontrol `.hn-terminal-action` ber-`min-width:
28px` (`app.css:356-368`), dinaikkan menjadi `var(--touch-target)` = 44px pada pointer kasar/mobile
(`app.css:377-381`). Lebar minimum yang tak bisa ditawar karena itu **≈ 8 × 28 + 7 × 8 gap + 34 =
314px** (desktop) atau **≈ 8 × 44 + 7 × 8 + 34 = 442px** (pointer kasar) — sebelum label sesi
mendapat satu piksel pun.

Katup pelepasnya cuma satu, dan ia hanya menyala di mobile:

```css
@media (max-width: 767px) { .hn-terminal-cell-header { flex-wrap: wrap; } }
```

Di 768–1199px (tablet, jendela desktop yang diperkecil, grid 2–4 kolom) tak ada `flex-wrap` dan tak
ada scroller: header tetap satu baris, isinya lebih lebar dari selnya, dan sisanya **dipotong oleh
`overflow: hidden` sel**. Grid 4 kolom pada 1440px memberi tiap sel ~340px — di bawah 442px dan
tepat di ambang 314px. Inilah bentuk terukur keluhan #1.

### 2.2 Toolbar layar tidak memotong — ia memakan tinggi

Toolbar halaman (`TerminalScreen.tsx:278-321`) punya `flexWrap: "wrap"`, jadi ia **tidak** terpotong;
ia membungkus. Harganya vertikal, dan itulah keluhan #6. Kontrol yang mengelilingi satu pane di
mobile:

- `GroupTabs`: tab grup + `✎` + `×` + `+` → **4**
- toolbar: `+ Kolom`, `+ Baris`, `Select` project, `Ambil backlog`, `Riwayat`, `Terminal biasa`,
  `Sesi baru`, maximize → **8**
- baris panel mobile (`TerminalScreen.tsx:345-358`): tab panel + `Hapus kolom` + `Hapus baris` → **3**
- header sel: sampai **9** elemen (8 kontrol)

**≈ 24 kontrol** mengelilingi satu pane di layar 390px, semuanya wajib ≥44px tinggi karena aturan
pointer kasar (`app.css:284-293`). Tidak ada satu pun yang bisa disembunyikan operator. Sisa untuk
output terminal adalah apa pun yang tersisa — keluhan #6 apa adanya.

### 2.3 Yang TIDAK menjadi penyebab

- Bukan `flex-shrink` tab (SPEC-763 sudah memperbaikinya; `.hn-tabs` menggulir).
- Bukan tinggi root (SPEC-767 sudah mengikat root ke rantai flex Shell).
- Bukan `all: "unset"` (SPEC-763; `.hn-terminal-action` sudah reset eksplisit per properti).

Yang tersisa memang **ketiadaan ember overflow**: tak ada satu pun tempat di halaman Terminal tempat
aksi yang tidak muat boleh pergi. `LocalOverflow` dan `ResponsiveToolbar` sudah ada di DS
(`ds/responsive.tsx:142-152`) tapi halaman Terminal tak memakai keduanya, dan keduanya adalah
**scroller**, bukan menu — scroller tak menolong di dalam kotak ber-`overflow: hidden`.

---

## 3. M2 — socket terminal bisa mati, dan klien tak pernah tahu

`TerminalPane.tsx:52-92` memasang `onopen` dan `onmessage`. **Tidak ada `onclose`. Tidak ada
`onerror`. Tidak ada sambung ulang.** Jalur kirimnya:

```ts
let pendingInput = "";
const sendInput = (d: string) => {
  if (ws?.readyState === WebSocket.OPEN) send({ t: "in", d });
  else pendingInput += d;                       // ← dikuras HANYA di ws.onopen
};
```

`pendingInput` dikuras satu kali saja, di `ws.onopen` (`TerminalPane.tsx:66-71`). Sesudah socket
tertutup, `onopen` tak akan pernah terpanggil lagi, jadi setiap karakter berikutnya masuk ke buffer
yang tak punya pembaca. Dari kursi operator: layar terakhir masih terpampang, kursor masih berkedip
(`cursorBlink: true`), tak ada pesan apa pun — **dan ketikan tidak masuk ke pane**. Itu persis kalimat
keluhan #2, termasuk kata "intermiten".

Server menutup socket terminal di **lima** tempat (`server/src/routes/terminal.ts:462-495`):

| Baris | Kode close | Pemicu |
|---|---|---|
| 471 | 4004 `not found` | sesi tmux lenyap |
| 475 | 1008 `connection limit` | kuota koneksi per principal |
| 481 | 1008 `rate limit`/1009 | `WsMessageGuard` (kini 6 000/menit, SPEC-771) |
| 483 | 1008 `session revoked` | revalidasi principal **per frame** |
| 491 | 1008 `session revoked` | revalidasi principal **tiap 60 detik** |

Plus semua penutupan yang tak berasal dari policy: **restart server** (dan hanoman memang
me-restart dirinya sendiri saat update, SPEC-405), laptop tidur, jaringan mobile pindah sel, tab
di-background. Sesi tmux selamat dari semuanya (ADR-0016) — itu justru intinya — tetapi pane di
browser tidak, dan tak ada apa pun yang memberi tahu operator maupun menyambung ulang.

SPEC-771 menutup **satu** pemicu (kuota 120/menit) dan menambahkan buffer untuk celah
`CONNECTING`. Ia tidak menutup **kelas**-nya: buffer itu justru yang membuat kegagalannya senyap
setelah socket mati.

**Hipotesis yang terbantah.** "Render ulang/polling me-remount xterm dan mencuri fokus":

- effect `TerminalPane` hanya bergantung `[sessionId]`; `onExit`/`onPhases` lewat ref
  (`TerminalPane.tsx:18-24`) — frame `sessions` (siar 1 dtk) tak pernah mengganti listener input;
- pane ber-`key={session.id}` (`TerminalScreen.tsx:793`), dan sel ber-`key` id sesi
  (`TerminalScreen.tsx:386`) — memindahkan sesi antar-sel memindah subtree, tak me-remount;
- percabangan kondisional di `Cell` (`PhaseStrip`, pil status) menempati slot tetap, jadi tak
  merekonstruksi tetangganya;
- `mousedown` di dalam elemen xterm **selalu** memanggil `this.focus()`
  (`@xterm/xterm/src/browser/CoreBrowserTerminal.ts:779-781`), bahkan saat mouse-reporting aktif —
  jadi klik ke pane memang selalu mengembalikan fokus.

Yang tersisa sebagai penjelasan yang bisa dibuktikan adalah socket mati tanpa kabar. Catatan kecil
yang ikut ditemukan: host pane punya `padding: 8` (`TerminalPane.tsx:161`) sementara listener
`mousedown` xterm duduk di elemen `.xterm` di dalamnya — klik pada pita 8px itu tidak memfokuskan
apa pun.

---

## 4. M3 — wheel adalah milik tmux, dan copy-mode menawan keyboard

Dua fakta yang, digabung, menjelaskan keluhan #3 seluruhnya.

**Fakta A — xterm menyerahkan wheel begitu ada protokol mouse aktif.** `@xterm/xterm` 6.0.0,
`src/browser/Viewport.ts:65-70`:

```ts
// Don't handle mouse wheel if wheel events are supported by the current mouse prototcol
this._register(coreMouseService.onProtocolChange(type => {
  this._scrollableElement.updateOptions({
    handleMouseWheel: !(type & CoreMouseEventType.WHEEL)
  });
}));
```

Scrollback lokal xterm karena itu **berhenti bisa digulir wheel** selama protokol mouse aktif —
akar yang sama dengan matinya seleksi teks pada SPEC-511, hanya cabang lain dari pohon yang sama.

**Fakta B — tmux memang sengaja mengambil wheel itu, dan membawanya ke copy-mode.** `pty.ts:404-416`
menyalakannya, dan komentarnya sendiri menyatakan rantainya:

```
// `mouse on` membuat tmux mengaktifkan mouse-reporting di terminal klien, jadi wheel di
// xterm.js diteruskan → tmux → copy-mode → scroll riwayat ke atas/bawah.
```

Copy-mode tmux **menawan keyboard pane**: selama pane berada di dalamnya, panah menggerakkan kursor
salin, dan **tak satu pun keystroke sampai ke claude**. Keluar hanya lewat `q`/`Escape` (atau
menggulir kembali sampai dasar).

Sekarang baca kembali langkah repro #3 sesuai urutan yang ditulis pelapor:

> b. Coba scroll isi pane. **c.** Coba tekan panah atas/bawah untuk memindah sorotan.

Langkah (b) memasukkan pane ke copy-mode. Langkah (c) karena itu **wajib** gagal — sorotan dialog
tak bergerak, karena panahnya tak pernah sampai ke claude. Dan bila dialog claude menyalakan
mouse-reporting-nya sendiri, cabang yang satunya menyala: wheel diteruskan ke claude, claude
mengabaikannya, dan pane "tidak bisa di-scroll". Kedua cabang bermuara pada satu kekurangan yang
sama di sisi hanoman: **operator tak punya satu pun jalur gulir maupun navigasi yang tidak melewati
mouse-mode**.

Yang dimiliki hanoman hari ini cuma satu, dan hanya untuk sentuh: handler `touchstart`/`touchmove`
SPEC-771 (`TerminalPane.tsx:110-138`) yang memanggil `term.scrollLines`. Tidak ada padanannya untuk
wheel, tidak ada tombol gulir, dan tidak ada cara mengirim `Escape`/`q` selain punya keyboard fisik.

**Kosakata input yang terbukti** sudah terdokumentasi in-vivo di audit SPEC-452 (claude 2.1.220):
dialog `AskUserQuestion` adalah daftar Ink dengan footer `Enter to select · ↑/↓ to navigate ·
Esc to cancel`; **burst >1 karakter ditelan bulat-bulat**, sedangkan **satu digit sebagai keystroke
tersendiri langsung memilih baris bernomor itu**. Papan tombol layar apa pun yang dibangun untuk
SPEC-800 karena itu wajib mengirim **satu keystroke per tekan**, bukan string gabungan.

### 4.1 Mengapa mobile (#4) terkunci total

Di mobile ketiga jalan keluar itu tertutup sekaligus:

- **tap tidak memilih.** xterm tidak menerjemahkan sentuhan menjadi laporan mouse — `sendEvent`
  hanya dipasang untuk `mousedown`/`mouseup`/`mousemove`/`wheel`
  (`CoreBrowserTerminal.ts:731-772`). Tap karena itu tak pernah menjadi klik yang bisa dibaca dialog.
- **tak ada panah.** Keyboard virtual iOS/Android tidak menyediakan `↑`/`↓`, `Esc`, maupun `Tab`.
- **tak ada tombol layar.** Halaman Terminal tak punya satu pun kontrol yang mengirim keystroke.

Jadi kalimat "pengguna terkunci, tidak dapat menjawab dialog sama sekali" **akurat secara harfiah**:
pada mobile tak ada satu pun jalur yang bisa menggerakkan sorotan dialog claude.

Jalur perbaikan yang tersedia sepenuhnya lewat API publik xterm 6 (diverifikasi di
`typings/xterm.d.ts`): `attachCustomWheelEventHandler` (1094), `scrollLines` (1211),
`scrollToBottom` (1227), `options.fontSize` yang boleh ditulis (871-876),
`buffer.active` (841) + `translateToString` (1632) untuk membaca baris yang di-tap.

---

## 5. M4 — ukuran font terminal adalah konstanta

`TerminalPane.tsx:30-42` melahirkan xterm dengan:

```ts
const term = new Terminal({
  fontFamily: token("--font-mono", "monospace"),
  fontSize: 13, cursorBlink: true,
  …
```

`13` tidak berasal dari token, tidak bisa diubah operator, dan tidak tersimpan di mana pun. Pada
ponsel angka itu jatuh ke ~7px lebar per kolom; dengan `FitAddon` mengisi lebar sel, hasilnya
banyak kolom berhuruf kecil — persis keluhan #5. Mekanisme persistensinya sudah ada dan sudah
dipakai halaman ini (`usePersistedState("terminal", "project", …)`, `TerminalScreen.tsx:43`;
SPEC-740 · ADR-0115), jadi menaikkan ukuran font menjadi state tampilan persisten **tidak menuntut
skema, migration, maupun endpoint baru**.

Catatan invariant SPEC-740 yang berlaku di sini: nilai disimpan **beserta kuncinya**, dan setiap
perubahan ukuran wajib diikuti `fit()` + frame `resize` ke server, karena `cols`/`rows` PTY adalah
turunan dari ukuran font.

---

## 6. Feedback loop merah

Baseline berkas yang akan tersentuh — **hijau** sebelum perubahan apa pun (bukan asumsi, dijalankan):

```bash
cd src && env -u NODE_ENV -u DATABASE_URL ../node_modules/.bin/vitest --run \
  test/terminal-pane.test.tsx test/terminal-screen.test.tsx \
  test/responsive-no-squeeze.test.tsx test/responsive-touch-targets.test.ts
# → 4 berkas lulus, 81 test lulus
```

Test merah yang harus ditulis lebih dulu (jsdom tak punya layout engine, jadi seperti SPEC-763 yang
diikat adalah **mekanismenya**, bukan pikselnya):

1. header sel merender kontrol overflow saat aksinya lebih banyak dari yang muat, dan seluruh aksi
   terjangkau lewat panel overflow itu;
2. `TerminalPane` menyambung ulang sesudah `onclose` dan **menguras** input yang mengantre selama
   putus (hari ini: buffer tak pernah dikuras lagi);
3. wheel di atas pane memanggil `term.scrollLines` alih-alih diteruskan sebagai laporan mouse;
4. papan tombol layar mengirim **satu keystroke per tekan** (`\x1b[A`, `\x1b[B`, `\r`, `\x1b`) —
   mengikat pelajaran SPEC-452 agar tak lahir kembali sebagai burst;
5. tap pada baris dialog bernomor mengirim **satu digit**, dan tidak mengirim apa pun di layar biasa;
6. ukuran font terminal tersimpan lewat `usePersistedState` dan perubahannya memicu `fit()` +
   frame `resize`.

---

## 7. Keputusan fase: Spec & Plan DIJALANKAN

Temuan ini **tidak** memenuhi syarat "diff kecil, akar jelas" yang membolehkan Spec/Plan dilewati:

- ia menambah **mekanisme interaksi baru** yang belum pernah ada di produk (papan tombol layar yang
  mengirim keystroke ke PTY, deteksi mode dialog, tap-untuk-memilih) — bentuknya perlu diputuskan
  sebelum ditulis, bukan sesudah;
- ia menyentuh **empat mekanisme berbeda** pada dua berkas terpanas halaman Terminal;
- ia bersinggungan dengan invariant yang sudah dibayar mahal: SPEC-452 (satu keystroke per tekan),
  SPEC-511 (mouse-mode mematikan seleksi), SPEC-763 (item tak boleh menyusut di bawah kontennya),
  SPEC-740 (nilai disimpan beserta kuncinya), ADR-0016 (tmux adalah source of truth);
- sambung-ulang WS mengubah **perilaku runtime** jalur yang baru saja dikeraskan SPEC-761/ADR-0117 —
  sambung ulang tak boleh menjadi badai koneksi maupun jalan pintas admission.

Karena itu: `Audit done` → **Spec** → **Plan** → **Execute**.

## 8. Batas audit

- Reproduksi dilakukan dengan pembacaan kode, sumber `@xterm/xterm` 6.0.0 yang benar-benar
  terpasang, dokumen audit in-vivo SPEC-452/511/771, dan baseline test yang dijalankan. **Tidak**
  dilakukan sesi `claude` berbayar baru untuk memunculkan dialog: kosakata dialognya sudah terukur
  dan tercatat pada SPEC-452, dan mekanisme wheel/copy-mode terbaca dari sumber xterm serta komentar
  `pty.ts` sendiri.
- Karena itu satu hal tetap **belum terukur**: apakah dialog claude 2.1.x menyalakan
  mouse-reporting-nya sendiri (wheel diteruskan ke claude) atau tidak (wheel → copy-mode tmux).
  Perbaikan yang dipilih sengaja **tidak bergantung pada jawabannya** — jalur gulir dan navigasi yang
  dibangun melewati mouse-mode sepenuhnya, jadi ia benar pada kedua cabang.
