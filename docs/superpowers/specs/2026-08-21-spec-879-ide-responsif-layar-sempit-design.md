# SPEC-879 — IDE responsif di layar sempit: toolbar, panel Explorer, dan tabel Graph/Branches/Worktrees

Tanggal: 2026-08-21 · Prioritas: sedang · Sumber: brief

## Cara mengukurnya (dan kenapa probe lama tak cukup)

Sapuan responsive 2026-08-14 sudah membuktikan bahwa invariant halaman `scrollWidth <= clientWidth`
**lulus justru karena kontennya dipotong**: `<main>` memang `overflow-x: hidden` menurut kontrak
SPEC-763, jadi setiap probe yang memaafkan elemen ber-leluhur `overflow: hidden` akan menyatakan
layar yang tak terbaca sebagai bersih.

Probe SPEC-879 karena itu mengukur **empat** hal yang berbeda, bukan satu:

| kelas | definisi | sah? |
| --- | --- | --- |
| `overlap` | teks keluar dari **kotaknya sendiri** (kotak itu `overflow: visible`) dan rect-nya memotong rect saudaranya | tidak pernah |
| `silentClip` | teks terpotong **leluhur** ber-`overflow: hidden`, sesudah pemotongan oleh kotaknya sendiri diperhitungkan, dan leluhur itu tak ber-`text-overflow: ellipsis` | tidak pernah |
| `needsScroll` | sama seperti di atas, tapi ada leluhur ber-`overflow-x: auto` yang **benar-benar bisa** digulir | sah untuk graph/diff/kode |
| `zeroBox` | elemen bertext dengan lebar atau tinggi **0** | tidak pernah |

Ellipsis yang dipasang elemen pada dirinya sendiri (`overflow: hidden` + `text-overflow: ellipsis`)
**bukan** pelanggaran: itu pemotongan yang dinyatakan, teksnya tetap ada di `title`/detail, dan
sudah jadi perilaku desktop hari ini. Tanpa pembedaan ini setiap subject commit di Git Graph
terhitung "terpotong" (149 di 820px) dan angkanya jadi tak bermakna.

Harness: Chrome headless disetir CDP dari Node (nol dependensi baru),
instance hanoman terisolasi (`HANOMAN_HOME` + `DATABASE_URL` sendiri, aset dari `src/dist`), satu
project menunjuk checkout hanoman sungguhan (7 branch, 2 worktree, 8 000+ commit). Viewport
390×844, 820×1180, 1100×800 — masing-masing dengan **pointer kasar** (390/820/1100t) dan satu kontrol
negatif pointer halus (1100). Empat tab × tiap viewport = 12 tangkapan layar + `report.json`.

## Yang terukur di HEAD (`90725baa`)

| tab@viewport | baris kepala | overlap | silentClip | zeroBox | target sentuh <44 |
| --- | --- | --- | --- | --- | --- |
| explorer@390 | **3** | 0 | 0 | 0 | 0 |
| graph@390 | **3** | 0 | **200** | **200** | **200** |
| branches@390 | **3** | 0 | **12** | 0 | 0 |
| worktrees@390 | **3** | 0 | **4** | 0 | 0 |
| explorer@820 | 2 | 0 | 0 | 0 | 0 |
| graph@820 | 2 | 0 | 0 | 0 | 0 |
| branches@820 | 2 | 0 | **1** | 0 | 0 |
| worktrees@820 | 2 | 0 | 0 | 0 | 0 |
| explorer@1100 | 1 | 0 | 0 | 0 | 39 (pointer halus) |
| worktrees@1100 | **2** | 0 | 0 | 0 | 17 (pointer halus) |
| semua@1100t | 1 (kecuali worktrees **2**) | 0 | 0 | 0 | 0 |

Halaman **tak pernah** menggulir samping di ke-16 kombinasi (`scrollWidth - clientWidth = 0`) — dan
itu justru bagian dari masalahnya.

### Akar 1 — baris kepala tak punya pemilik sisa lebar

`<Tabs>` dan `toolbar` duduk dalam satu baris `justify-content: space-between` ber-`flex-wrap`
(`IdeScreen.tsx:317`). Keduanya `flex: 0 1 auto`, jadi tak ada yang mengambil sisa ruang dan tak ada
yang menyerap kekurangan: begitu jumlah lebarnya melewati baris, **seluruh toolbar** turun.

Di ~1100px keduanya hanya beda beberapa piksel dari batas — terukur pada viewport yang **sama**,
tab Explorer memberi kepala **1 baris** sementara tab Worktrees memberi **2 baris**, semata karena
label tab aktif dirender `font-weight: 600`. Kepala yang bentuknya ditentukan tab mana yang sedang
aktif bukan layout, itu kebetulan.

Di 390px toolbar sendiri (2 `Select` + 3 tombol ≈ 570px) membungkus jadi dua baris → kepala **3
baris**, memakan 154px dari 844px sebelum satu berkas pun terlihat.

### Akar 2 — `.hn-local-overflow` Git Graph adalah scroller mati

`GitGraph.tsx:392` membungkus seluruh `<Card>` dengan `<LocalOverflow>`. Anaknya satu `<div>`
**blok**, dan blok selalu selebar induknya — jadi scroller itu tak pernah punya konten lebih lebar
untuk digulir: terukur di 390px `content = 362`, `box = 362`, `canScroll: false`. Ini persis kelas
cacat "overflow-scroller tanpa item `flex: 0 0 auto`" dari SPEC-763, dalam bentuk blok.

Karena scroller-nya mati, barisnya yang membayar. Baris commit adalah flex dengan kolom lebar tetap
(SVG lane, ⋮ 44px, author 88px, tanggal 40px) plus satu kolom `flex: 1; min-width: 0` berisi pill ref
+ subject. Di 390px kolom fleksibel itu runtuh ke **0px**: 200 tombol subject terukur `0×44` — bukan
terpotong, **hilang**. Pill ref-nya `flex: 0 0 auto` sehingga ia meluber ke luar kotak induk dan
**menimpa kolom author** (terlihat langsung di tangkapan layar), dan tanggal terpotong 3px oleh kartu.

### Akar 3 — baris Branches/Worktrees hanya terjangkau dengan menggulir, tanpa satu pun tanda

Baris kedua panel adalah flex satu baris tanpa `flex-wrap`. Di 390px kontennya 724px (Branches) dan
553px (Worktrees) di dalam kotak 360px: daftar itu **memang** menggulir mendatar, tetapi yang
tertinggal di luar layar adalah **tombol Hapus tiap baris** (terukur 145–363px di luar) dan kolom
pesan commit terakhir. Tak ada scrollbar terlihat, tak ada tanda potong: barisnya sekadar berhenti.
Di 820px Branches masih menyisakan 17px — cukup untuk memotong "Hapus".

Ini kasus di mana menggulir mendatar **bukan** jawabannya: barisnya bisa reflow, dan design system
memang meminta baris aksi "turun menjadi satu kolom atau wrap".

### Akar 4 — checkbox mentah membesar jadi kotak biru 44×44

Kontrol tampilan Git Graph (`remote`, `tag`, `muted merge`) memakai `<input type="checkbox">`
telanjang. Aturan mobile `input { min-width: var(--touch-target); min-height: var(--touch-target) }`
merentangkannya jadi kotak biru 44×44 (terlihat di tangkapan 390px dan 820px). `Checkbox` design
system menaruh kotak 18×18 **di dalam** area sentuh 44×44 — itu yang dipakai `BranchesPanel` dan
yang tampil benar di tangkapan yang sama.

### Yang ternyata sudah benar (kontrol negatif, jangan diulang)

- **Explorer bersih di ketiga viewport**: `ResponsivePanels` memang satu-panel-per-waktu di 390px
  (`data-split="false"`), pohon file menggulir sendiri (`ide-tree-scroll` 225px memuat 1 144px), dan
  label tujuan `→ root` terlihat 41×17px di 390/820/1100. Ambang master/detail di 820px benar
  (`data-split="true"`, masterWidth 300).
- **Diff tak pernah menggulir samping**: `DiffView` sudah `white-space: pre-wrap` + `word-break`.
- **Target sentuh** nol pelanggaran di setiap viewport ber-pointer kasar, termasuk 1100t. Angka 39/436
  di 1100 pointer halus **bukan** regresi: aturan 44px digerbangi `@media (pointer: coarse),
  (max-width: 767px)` menurut SPEC-763, dan tab 38px dengan mouse memang sesuai kontrak.
- **`all: "unset"`** tak dipakai satu pun berkas IDE.

## Bentuk perbaikan

Semua memakai konvensi `app.css` yang sudah ada; satu nama kelas baru per permukaan baru, tak ada
mekanisme responsive kedua.

### 1. `.hn-ide-head` + `.hn-ide-toolbar` (app.css) — kepala punya pemilik sisa lebar

```css
.hn-ide-head { display:flex; align-items:center; flex-wrap:wrap; gap:12px; min-width:0 }
.hn-ide-head > .hn-tabs { flex:1 1 auto; min-width:0 }     /* strip tab menyerap & menggulir */
.hn-ide-toolbar { display:flex; align-items:center; flex:0 0 auto; flex-wrap:wrap; gap:10px;
                  min-width:0; max-width:100% }

@media (max-width: 767px) {
  .hn-ide-head > * { flex:1 1 100%; min-width:0 }           /* dua strip bertumpuk */
  .hn-ide-toolbar { flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden;
                    overscroll-behavior-inline:contain }
  .hn-ide-toolbar > * { flex:0 0 auto }                     /* scroller hidup, bukan menyusut */
}
```

Kenapa tab yang menyerap, bukan toolbar: toolbar berisi kontrol ber-lebar tetap yang tak boleh
menyusut, sementara `.hn-tabs` **sudah** scroller (`overflow-x: auto`). Memberi strip tab
`flex: 1 1 auto` berarti kekurangan beberapa piksel dibayar dengan menggulir strip tab, bukan dengan
menurunkan seluruh toolbar — kepala tetap satu baris di ~1100px apa pun tab yang aktif.

Di ≤767px toolbar jadi satu baris yang **menggulir**, cermin papan tombol terminal SPEC-800
(`.hn-terminal-keys`). Kepala jadi tepat dua baris; tak satu kontrol pun dihilangkan.

`IdeScreen.tsx` memakai `className="hn-ide-head"` pada baris kepala dan `className="hn-ide-toolbar"`
pada pembungkus toolbar; style inline yang digantikan kelas itu dibuang, `flex: "0 0 auto"` (rantai
SPEC-363) tetap inline karena ia milik call site.

### 2. Git Graph — scroller lokal pindah ke DALAM kartu, dan diberi lebar minimum

`<LocalOverflow>` tak lagi membungkus `<Card>`. Ia membungkus **hanya region baris** (baris
uncommitted + baris commit) di dalam kartu, dengan anak ber-`min-width` sehingga scroller-nya punya
konten yang lebih lebar untuk digulir:

```jsx
<LocalOverflow data-testid="ide-graph-rows">
  <div style={{ minWidth: maxLanes * LANE_W + GRAPH_ROW_MIN }}>…</div>
</LocalOverflow>
```

`GRAPH_ROW_MIN = 460` = subject minimum + author 88 + tanggal 40 + ⋮ 44 + gap/padding. Barisnya
karena itu tak pernah lebih sempit dari yang terbukti terbaca di 820px: nol `zeroBox`, nol pill yang
menimpa author, dan subject tetap memakai ellipsis-nya sendiri seperti di desktop.

Yang **tetap di luar** scroller: widget cari, kontrol tampilan, chip stash, dan baris penutup
`moreRef`. Baris penutup itu sentinel `IntersectionObserver` SPEC-351 — ia menempel pada `<main>`
yang menggulir tegak, dan menaruhnya di dalam scroller mendatar tak menambah apa pun kecuali risiko.
Kartu Git Graph tetap tumbuh mengikuti isi (tak ikut rantai flex) sesuai kontrak.

Baris widget cari mendapat `flex-wrap: wrap`; spacer hantu `<span style={{flex:1}}/>` diganti
`margin-left: auto` pada teks pintasan.

### 3. Baris Branches & Worktrees — reflow, bukan gulir

Baris di kedua panel memakai `className="hn-dense-row"` + `flexWrap: "wrap"`:

- `.hn-dense-row` (mobile) memberi anak ber-`flex: 1` — nama branch/worktree — lebar minimum
  `min(220px, 100%)`, jadi nama tak pernah diperas sampai 4 karakter per baris.
- `flexWrap: "wrap"` dipasang **inline di semua tier**, bukan hanya mobile: di 820px yang bocor
  hanya 17px, dan membungkus satu tombol ke baris kedua jauh lebih baik daripada memotongnya.
  Di ≥1200px barisnya muat, jadi wrap tak pernah aktif — bentuk desktop tak berubah.
- Kolom meta (pesan commit terakhir / ukuran · umur) mendapat `margin-left: auto` supaya tetap rata
  kanan setelah membungkus.

Hasilnya: nol elemen yang butuh gulir mendatar, tombol Hapus tiap baris terjangkau di 390px.

### 4. Checkbox Git Graph memakai `Checkbox` design system

Tiga `<input type="checkbox">` mentah di kontrol tampilan diganti `Checkbox` DS (`role="checkbox"`,
kotak 18×18 di dalam target 44×44). Label ikut pindah ke prop `label`, jadi asosiasinya eksplisit
dan tak lagi bergantung pada `<label>` yang membungkus.

### 5. Editor berkas tak lagi memaksa 560px

`textarea` mode edit memakai `minHeight: "clamp(240px, 50dvh, 560px)"` — di ponsel ia tak lagi
melebihi pane-nya sendiri, di desktop tingginya tak berubah. `resize: vertical` tetap.

### 6. Label tujuan Explorer (ADR-0121) berdiri sendiri

Spacer `<span style={{ flex: 1 }} />` dibuang; label `→ <dirSel>` menjadi
`flex: "1 1 auto"; min-width: 0; text-align: right` + ellipsis miliknya sendiri, dengan
`data-testid="ide-entry-dest"`. Ia menyerap sisa lebar di baris mana pun ia mendarat, jadi ia
terlihat di ketiga viewport secara konstruksi — bukan sebagai efek samping spacer yang boleh runtuh.

## Yang TIDAK berubah

- Rantai flex Explorer (SPEC-363) dan `Card fill` (SPEC-393) — `IdeScreen` tetap `flex: 1 1 0` hanya
  saat tab Explorer, kedua `Card` tetap `padding={0} fill`.
- Git Graph tetap tumbuh mengikuti isi dan bergantung pada `<main>` yang menggulir (SPEC-351).
- `<main>` tetap `overflow-x: hidden` (SPEC-763), satu-satunya page scroller.
- Modal/dialog IDE di luar cakupan.
- `ResponsivePanels`, `Tabs`, `Card` **tak disentuh** — perubahannya seluruhnya di call site IDE dan
  di `app.css`, jadi tak ada pemakai lain yang bisa teregresi.

## Test

Berkas baru `src/test/ide-responsive.test.tsx`. jsdom tak melayout, jadi yang diikat adalah
**mekanisme** yang membuat angka di atas berubah — pola yang sama dengan
`responsive-no-squeeze.test.tsx` dan `scroll-chain.test.tsx`:

1. `app.css` menyatakan `.hn-ide-head > .hn-tabs { flex: 1 1 auto; min-width: 0 }`.
2. Blok mobile `app.css` menyatakan `.hn-ide-toolbar` `flex-wrap: nowrap` + `overflow-x: auto`
   **dan** `.hn-ide-toolbar > * { flex: 0 0 auto }` — scroller tanpa aturan kedua adalah scroller mati.
3. `IdeScreen` merender kepala ber-`hn-ide-head` dengan `.hn-tabs` sebagai anak langsung, dan
   toolbar ber-`hn-ide-toolbar`.
4. Label tujuan ada, ber-`flex: 1 1 auto`, dan tak ada lagi spacer `flex: 1` kosong di baris aksi.
5. Git Graph: `ide-graph-rows` ada, ber-kelas `hn-local-overflow`, anaknya ber-`min-width` ≥ 460, dan
   `moreRef` (baris penutup SPEC-351) **di luar** scroller itu.
6. Git Graph tak lagi memakai `input[type="checkbox"]`; ketiga kontrol tampilan `role="checkbox"`.
7. Baris Branches & Worktrees ber-`hn-dense-row` dan `flex-wrap: wrap`; kolom meta `margin-left: auto`.
8. Tak ada `all: "unset"` di berkas IDE (pagar terhadap regresi kelas SPEC-763).

Test yang sudah ada dan wajib tetap hijau: `ide-screen`, `ide-file-ops`, `ide-worktrees-tab`,
`git-graph-view`, `branches-panel`, `worktrees-panel`, `scroll-chain`, `responsive-no-squeeze`.

## Bukti

Harness dijalankan dua kali dengan skrip yang identik (sebelum/sesudah). Yang dilaporkan:
`report.json` per kombinasi plus **12 tangkapan layar** (4 tab × 3 viewport) sesudah perbaikan,
berdampingan dengan 12 tangkapan sebelum. Angka target sesudah perbaikan:

- `overlap = 0`, `silentClip = 0`, `zeroBox = 0` di ke-12 kombinasi;
- baris kepala ≤ 2 di 390px, = 1 di ~1100px pada **keempat** tab;
- halaman `scrollWidth - clientWidth = 0`;
- `ide-graph-rows` hidup di 390px (`content > box`), `ide-tree-scroll` & `doc-preview-scroll` hidup;
- target sentuh <44px = 0 di setiap viewport ber-pointer kasar.

## Docs yang tersentuh

- `internal/docs/frontend/frontend-implementation.md` — kontrak responsive: keluarga IDE + tiga
  aturan barunya (kepala ber-pemilik sisa, scroller lokal wajib punya konten lebih lebar, baris
  tabel reflow sebelum menggulir).
- `internal/docs/design-system/design-system.md` — `.hn-ide-head`/`.hn-ide-toolbar` masuk kosakata
  layout bersama.
- `internal/docs/research/audit-spec-879-ide-responsif-layar-sempit.md` (baru) + tautannya di
  `internal/docs/README.md`.
