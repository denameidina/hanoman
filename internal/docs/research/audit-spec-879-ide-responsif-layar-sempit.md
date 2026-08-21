# Audit SPEC-879 — IDE di layar sempit: toolbar, panel Explorer, dan tabel Graph/Branches/Worktrees

Tanggal: 2026-08-21 · Base: `90725baa` · Sumber: brief SPEC-879

Layar IDE (`src/src/screens/IdeScreen.tsx`) dibangun untuk desktop lebar dan tak pernah ikut sapuan
responsive 2026-08-14. Audit ini mengukurnya di 390/820/1100px pada keempat tabnya, dengan repo
hanoman sungguhan sebagai data (7 branch, 2 worktree, 8 000+ commit).

## Empat kelas cacat, bukan satu invariant

Sapuan sebelumnya sudah membuktikan bahwa invariant halaman `scrollWidth <= clientWidth` **lulus
justru karena kontennya dipotong**: `<main>` memang `overflow-x: hidden` menurut SPEC-763. Di audit
ini halaman **tak pernah** menggulir samping — di ke-16 kombinasi, sebelum maupun sesudah perbaikan
— dan itu bagian dari masalahnya, bukan bukti kesehatan.

Probe karena itu memisahkan empat hal:

| kelas | definisi | sah? |
| --- | --- | --- |
| `overlap` | teks keluar dari **kotaknya sendiri** yang `overflow: visible`, dan rect-nya memotong rect saudaranya | tidak pernah |
| `silentClip` | teks terpotong **leluhur** ber-`overflow: hidden` — sesudah pemotongan oleh kotaknya sendiri diperhitungkan — dan leluhur itu tak ber-`text-overflow: ellipsis` | tidak pernah |
| `needsScroll` | sama, tetapi ada leluhur (atau kotaknya sendiri) ber-`overflow-x: auto` yang **benar-benar bisa** digulir | sah untuk graph, diff, kode |
| `zeroBox` | elemen bertext dengan lebar atau tinggi **0** | tidak pernah |

Dua pembedaan itu yang membuat angkanya berarti. **Ellipsis yang dipasang elemen pada dirinya
sendiri bukan pelanggaran** — tanpa pengecualian ini setiap subject commit terhitung "terpotong"
(149 di 820px) dan angkanya jadi bising. **Konten yang terjangkau lewat scroller hidup juga bukan
pelanggaran** — tanpa pengecualian ini setiap perbaikan yang memindahkan overflow ke scroller lokal
terbaca seperti regresi.

Harness: Chrome headless disetir CDP dari Node, nol dependensi baru; instance hanoman terisolasi
(`HANOMAN_HOME` + `DATABASE_URL` sendiri, aset dari `src/dist`). Tiga viewport ber-pointer kasar
(390×844, 820×1180, 1100×800) plus satu kontrol negatif 1100px ber-pointer halus. **Project dipilih
eksplisit** di tiap run: daftar project diurutkan `createdAt desc`, jadi project yang lahir belakangan
diam-diam menggeser default dan angkanya jadi tak sebanding antar-run.

## Hasil

| tab@viewport | baris kepala | silentClip | zeroBox | needsScroll | target sentuh <44 |
| --- | --- | --- | --- | --- | --- |
| explorer@390 | 3 → **2** | 0 → 0 | 0 → 0 | 0 → 3 | 0 → 0 |
| graph@390 | 3 → **2** | **200 → 0** | **200 → 0** | 0 → 793 | **200 → 0** |
| branches@390 | 3 → **2** | 0 → 0 | 0 → 0 | **12 → 3** | 0 → 0 |
| worktrees@390 | 3 → **2** | 0 → 0 | 0 → 0 | **5 → 3** | 0 → 0 |
| explorer@820 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| graph@820 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| branches@820 | 2 → 2 | 0 → 0 | 0 → 0 | **1 → 0** | 0 → 0 |
| worktrees@820 | 2 → 2 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| explorer@1100 | 2 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | 39 → 39 · pointer halus |
| graph@1100 | 2 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | 435 → 435 · pointer halus |
| branches@1100 | 2 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | 27 → 27 · pointer halus |
| worktrees@1100 | 2 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | 17 → 17 · pointer halus |
| semua@1100 pointer kasar | 2 → **1** | 0 → 0 | 0 → 0 | 0 → 0 | **0 → 0** |

`needsScroll` yang naik adalah perbaikannya, bukan kemundurannya: di 390px toolbar IDE (3) dan baris
commit (793) kini hidup di scroller lokal yang **terbukti bisa digulir** — `ide-graph-rows` terukur
`content 600 > box 360`. Angka target sentuh 39/435/27/17 di 1100px pointer **halus** bukan regresi:
aturan 44px digerbangi `@media (pointer: coarse), (max-width: 767px)` menurut SPEC-763, dan pada
pointer kasar di viewport yang sama angkanya **nol**.

## Akar 1 — `flex-wrap` memutus baris SEBELUM menyusut

`<Tabs>` dan toolbar duduk dalam satu baris `justify-content: space-between` ber-`flex-wrap`,
keduanya `flex: 0 1 auto`. Yang menentukan kapan barisnya pecah adalah **hypothetical main size**,
yaitu `flex-basis` — dengan basis `auto` itu berarti **lebar isi**. Jadi memberi salah satu item
kemampuan menyusut tak pernah menolong: begitu jumlah lebar isi melewati baris, seluruh toolbar
turun.

Akibatnya bentuk kepala ditentukan **isinya**, bukan layout-nya. Dua pengukuran memperlihatkannya
pada viewport yang identik:

- tab Explorer memberi kepala **satu** baris sementara tab Worktrees memberi **dua**, semata karena
  label tab aktif dirender `font-weight: 600`;
- menambahkan satu project bernama `probe-diff` ke instance membuat **keempat** tab jadi dua baris
  di 1100px — lebar `<select>` native mengikuti opsi terpanjangnya.

Di 390px toolbar sendiri (dua `Select` + tiga tombol ≈ 570px) membungkus jadi dua baris → kepala
**tiga** baris, 154px dari 844px sebelum satu berkas pun terlihat.

**Perbaikan** — `.hn-ide-head` / `.hn-ide-toolbar` di `app.css`. Basis toolbar **dinyatakan**
(`flex: 1 1 480px`), memindahkan keputusan dari "kebetulan selebar apa isinya" ke "berapa ruang yang
toolbar minta di samping tab": ≥480px ia tetap satu baris, kurang dari itu ia turun ke barisnya
sendiri dan **menggulir** di sana (`flex-wrap: nowrap` + `overflow-x: auto`, itemnya `flex: 0 0 auto`
supaya scroller-nya hidup — cermin papan tombol terminal SPEC-800). Empat tab adalah navigasi IDE,
jadi merekalah yang `flex: 0 0 auto`. Rata kanan lewat `margin-inline-start: auto` pada anak pertama,
**bukan** `justify-content: flex-end` — di kontainer yang menggulir, flex-end membuat awal konten tak
terjangkau.

Hasilnya satu aturan tanpa media query untuk ketiga tier: 1 baris di 1100px (semua kontrol terlihat),
2 baris di 820px (semua kontrol terlihat), 2 baris di 390px (toolbar menggulir).

## Akar 2 — scroller lokal Git Graph mati karena anaknya blok

`<LocalOverflow>` membungkus **seluruh** `<Card>`. Anaknya satu `<div>` blok, dan blok selalu selebar
induknya — jadi scroller itu tak pernah punya konten lebih lebar untuk digulir: terukur di 390px
`content = 362`, `box = 362`, `canScroll: false`. Ini kelas cacat "overflow-scroller tanpa item
`flex: 0 0 auto`" dari SPEC-763, dalam bentuk blok.

Karena scroller-nya mati, barisnya yang membayar. Baris commit adalah flex dengan kolom lebar tetap
(SVG lane, ⋮ 44px, author 88px, tanggal 40px) plus satu kolom `flex: 1; min-width: 0` berisi pill ref
+ subject. Di 390px kolom itu runtuh: **200 tombol subject terukur `0×44`** — bukan terpotong,
hilang — pill ref-nya (`flex: 0 0 auto`) meluber **menimpa kolom author**, dan tanggal terpotong 3px
oleh kartu.

**Perbaikan** — `<LocalOverflow data-testid="ide-graph-rows">` pindah ke **dalam** kartu, membungkus
hanya region baris, dengan anak ber-`min-width: maxLanes * LANE_W + GRAPH_ROW_MIN` (460). Widget
cari, kontrol tampilan, chip stash, dan baris penutup tetap di luar; yang terakhir adalah sentinel
`IntersectionObserver` SPEC-351 yang menempel pada `<main>` yang menggulir tegak.

`GRAPH_ROW_MIN` saja **tak cukup**, dan itu baru terlihat setelah diukur ulang: pill ref memakan
kolom fleksibel lebih dulu, jadi baris HEAD (dua pill panjang) menyisakan **24px** untuk subject-nya.
`SUBJECT_MIN` (160) memberi lantai; baris yang pill-nya panjang karena itu **melebihi**
`GRAPH_ROW_MIN` dan scroller-nya ikut melebar mengikuti (terukur `content 600 > box 360`), bukan
memeras subject.

## Akar 3 — baris Branches/Worktrees hanya terjangkau dengan menggulir, tanpa satu pun tanda

Baris kedua panel adalah flex satu baris tanpa `flex-wrap`. Di 390px kontennya 724px (Branches) dan
553px (Worktrees) di dalam kotak 360px: daftarnya **memang** menggulir mendatar, tetapi yang
tertinggal di luar layar adalah **tombol Hapus tiap baris** (terukur 193–364px di luar) dan kolom
pesan commit terakhir. Tak ada scrollbar terlihat, tak ada tanda potong — barisnya sekadar berhenti.
Di 820px Branches masih menyisakan 18px, cukup untuk memotong "Hapus".

Ini kasus di mana menggulir mendatar **bukan** jawabannya: barisnya bisa reflow. Perbaikannya
`className="hn-dense-row"` + `flexWrap: "wrap"` — konvensi yang sudah ada memberi nama
branch/worktree lebar minimum `min(220px, 100%)` di mobile, dan `flexWrap` dipasang inline di **semua
tier** karena yang bocor di 820px cuma 18px: membungkus satu tombol ke baris kedua jauh lebih baik
daripada memotongnya. Kolom meta mendapat `margin-left: auto` supaya tetap rata kanan sesudah
membungkus. Di ≥1200px barisnya muat, jadi wrap tak pernah aktif dan bentuk desktop tak berubah.

## Akar 4 — checkbox mentah membesar jadi kotak biru 44×44

Kontrol tampilan Git Graph (`remote`, `tag`, `muted merge`) memakai `<input type="checkbox">`
telanjang; aturan mobile `input { min-width/min-height: var(--touch-target) }` merentangkannya jadi
kotak biru 44×44 di 390px **dan** 820px. `Checkbox` design system menaruh kotak 18×18 **di dalam**
area sentuh 44×44 — itu yang sudah dipakai `BranchesPanel` dan tampil benar di tangkapan yang sama.
Perbaikannya penggantian langsung, sekaligus membuat asosiasi labelnya eksplisit (`role="checkbox"`).

## Yang ternyata sudah benar — kontrol negatif

- **Explorer bersih di ketiga viewport.** `ResponsivePanels` memang satu-panel-per-waktu di 390px
  (`data-split="false"`), ambang master/detail di 820px benar (`data-split="true"`, masterWidth 300),
  dan pohon file menggulir sendiri (225px memuat 1 144px). Yang diperbaiki hanya label tujuan
  ADR-0121: spacer `<span style={{flex:1}}/>` diganti label yang menyerap sisa lebar sendiri, jadi ia
  terlihat secara konstruksi — terukur 41 → **241px** di 390px.
- **Diff tak pernah menggulir samping.** `DiffView` sudah `white-space: pre-wrap` + `word-break`;
  diukur pada repo ber-working-tree kotor: `pageX = 0`, `silentClip = 0`, pane viewer menggulir tegak
  sendiri (620px isi di kotak 436px).
- **Pratinjau kode menggulir di kotaknya sendiri.** `<pre>` dan `code.hljs` sama-sama
  `overflow-x: auto`; 160 baris panjang terhitung `needsScroll`, **nol** `silentClip`.
- **`all: "unset"`** tak dipakai satu pun berkas IDE — dijaga test supaya tetap begitu.
- **Target sentuh** nol pelanggaran di setiap viewport ber-pointer kasar, sebelum maupun sesudah.

## Perubahan

Seluruhnya di call site IDE + `app.css`; `ResponsivePanels`, `Tabs`, dan `Card` **tak disentuh**,
jadi tak ada pemakai lain yang bisa teregresi. Kontrak yang ditegakkan tanpa diubah: rantai flex
Explorer (SPEC-363), `Card fill` (SPEC-393), `<main>` menggulir untuk auto-load graph (SPEC-351),
label tujuan wajib terlihat (ADR-0121), `<main>` ber-`overflow-x: hidden` (SPEC-763). Digerbangi
`src/test/ide-responsive.test.tsx`.
