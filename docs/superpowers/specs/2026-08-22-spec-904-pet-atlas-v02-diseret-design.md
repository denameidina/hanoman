# SPEC-904 — Pet hidup E: atlas v02, baris `held`/`falling`/`dizzy`, dan `wave` yang bisa diulang

Tanggal: 2026-08-22 · Sumber: backlog SPEC-904 (brief operator) · Program: Pet hidup E
(penerus SPEC-896 A / 897 B / 898 C / 899 D) · ADR: **amandemen ADR-0140** (tanpa ADR baru)

## 1. Konteks

Pet berkeliaran di tepi bawah, bicara, dan menjawab dialog sesi (A–D selesai). Permintaan operator
berikutnya adalah pet yang bisa **diseret**: terangkat saat ditarik, turun perlahan saat dilepas,
pusing sesaat ketika mendarat, lalu berdiri lagi. Atlas PET-001 v01 (13 baris × 8 kolom, sel
192×208) tak punya satu pun baris untuk itu, dan operator memilih **baris sprite sungguhan**, bukan
tipuan transform CSS. Backlog ini karena itu murni soal **aset + manifest**; interaksi seretnya
dikerjakan backlog penerus.

Pipeline-nya sudah ada dan sudah berdarah: ADR-0140 + `internal/scripts/pet/petlib.py`
(codex imagegen → despill/key → deteksi celah grid → registrasi → pin), dengan jebakan terukur yang
tercatat di `internal/assets/pet/README.md`.

## 2. Yang diukur lebih dulu (dan yang membaliknya)

Tiga pengukuran dilakukan **sebelum** desain dikunci, karena masing-masing membalik asumsi brief.

### 2.1 Plafon atlas 1 MB tak bisa menampung 16 baris pada kualitas mana pun yang layak

Atlas dirakit ulang dari `rows/` setiap kali, jadi menurunkan `quality` menurunkan **seluruh** baris —
termasuk 13 yang sudah lolos review manusia. Diukur atas 13 baris nyata + 3 baris terberat yang ada
(`waiting`, `shipped`, `deciding`) sebagai stand-in, dan sekali lagi dengan 3 baris teringan
(`blocked`, `docs-updated`, `sleep`):

| quality | 16 baris (stand-in berat) | 16 baris (stand-in ringan) |
|---|---|---|
| 76 (v01) | 1 191 960 B | 1 131 194 B |
| 60 | 1 081 404 B | 1 025 150 B |
| 40 | 946 588 B | 895 774 B |
| 20 | 784 084 B | 737 776 B |
| 1 | 553 398 B | 512 474 B |

**Kualitas WebP adalah tuas yang lemah di sini**: q76 → q20 hanya −34 %, karena atlas ini didominasi
kanal alpha (dikode lossless) di atas seni datar berkontur tegas. Untuk turun ke bawah 1 MB butuh
±q45 — kualitas jauh di bawah yang di-review. `alpha_quality=60` pada q76 memberi 976 678 B, tetapi
sisanya hanya 24 KB: persis situasi "satu regenerasi baris rutin menembus plafon" yang README aset
pakai untuk menolak q78 dan memilih q76.

Yang juga membalik premis plafonnya: alasan README menahannya adalah "satu `<img>` yang di-decode di
setiap halaman". Biaya decode itu **piksel, bukan byte** — 1536×3328×4 = 19,5 MiB RGBA pada 16 baris
vs 15,8 MiB pada 13. Menurunkan `quality` **tak menurunkan angka itu sama sekali**.

**Keputusan:** `ATLAS_BUDGET` naik 1 000 000 → **1 300 000 B**, `quality` tetap **76**. 16 baris @ q76
= +25,4 % vs v01 — di dalam batas +40 % yang ditetapkan brief backlog ini, dengan sisa ±108 KB untuk
satu regenerasi baris rutin. Ini **amandemen ADR-0140** dan mencabut kalimat "jangan menaikkan
plafon" di README aset, digantikan alasan terukur di atas.

### 2.2 Sambungan `wave` memang patah — dan bentuk "loop sejati" dilarang constraint

Langkah antar-frame strip `wave` yang dikomit (XOR mask ÷ massa frame 1), termasuk sambungan 8→1:

```
1→2:0,163  2→3:0,077  3→4:0,098  4→5:0,091  5→6:0,067  6→7:0,201  7→8:0,028  8→1:0,031
```

Dua frame **nyaris kembar** di sambungan (0,028 dan 0,031) mengapit dua **hentakan** (0,163 tangan
naik, 0,201 tangan turun). Diulang, itu terbaca sebagai pompa naik-turun dengan jeda ±200 ms, bukan
lambaian beruntun.

Bentuk yang benar-benar melambai tanpa henti saat diulang menuntut tangan tetap di atas pada frame 1
dan 8, yaitu `loop: true`. Itu **tidak bisa dipakai**: `HanomanPet.tsx` membersihkan `oneShot` di
`onAnimationEnd`, dan `loop: true` menghasilkan animasi `infinite` sehingga `animationend` tak pernah
menyala — pet akan melambai selamanya sesudah satu hover. Constraint backlog melarang menyentuh
perilaku komponen. Selain itu pindah `idle → wave` dan `wave → idle` akan jadi dua lompatan tangan.

**Keputusan:** `wave` **diregenerasi**, manifestnya **tak berubah** (`fps 10, loop false, then idle`).
Frame 1 tetap pose istirahat (sambungan ke/dari `idle` tetap bersih); **frame 8 dibuat satu langkah
rata SEBELUM frame 1**, bukan salinannya; naik-turun tangan diratakan sehingga tak ada langkah yang
melonjak. Target terukur: kedelapan langkah (termasuk 8→1) berada di dalam pita **0,04–0,12**, tanpa
satu pun langkah < 0,04 (frame kembar) atau > 0,15 (hentakan).

### 2.3 Setiap baris diskalakan sehingga bbox frame 1 = 168 px — termasuk baris yang tak berdiri

Diukur atas ketigabelas strip yang dikomit: bbox frame 1 **selalu** `h=168`, `bottom=202`. Itu
konstruksi `build_strip` (`f = STAND_H / ref_h`), bukan kebetulan — termasuk untuk `sleep` yang
**duduk** (w=118, h=168). Konsekuensinya untuk backlog ini: baris `falling` yang badannya meringkuk
akan **diperbesar** sampai setinggi pet berdiri kalau digambar sebagai bola kecil. Naskah `falling`
karena itu meminta badan **meringkuk tetapi terentang tegak** (lutut ditarik ke dada, **ekor
terangkat tinggi**), sehingga rentang vertikal gambarnya sebanding dengan pose berdiri dan skalanya
tak melonjak.

## 3. Keputusan desain

### 3.1 Atlas v02 menggantikan v01 (v01 dibuang, tidak disimpan berdampingan)

Nama berkas naik ke `hnm-pet-anoman-atlas-v02.webp` dan **v01 dihapus dari repo**. Alasan naik versi:
`pet.json` juga naik ke `version: 2`, dan berkas atlas adalah turunan yang di-`import` bundler dengan
`?url` — nama yang ikut berubah membuat mustahil ada build yang memuat manifest v2 di atas piksel v1.
Alasan **dibuang, bukan berdampingan**: v01 adalah turunan murni dari `rows/` + `petlib.ROWS`; ia
tidak bisa dirakit ulang dari state repo mana pun sesudah `ROWS` bertambah, jadi menyimpannya berarti
menyimpan 950 KB yang tak punya pembaca dan tak bisa diverifikasi `verify.py`. Riwayat git yang
menyimpannya.

### 3.2 Tiga baris baru — hanya di EKOR

| idx | key | fps | loop | then | mode petlib |
|---|---|---|---|---|---|
| 13 | `held` | 8 | true | — | `float` |
| 14 | `falling` | 8 | true | — | `float` |
| 15 | `dizzy` | 8 | false | `idle` | `stand` |

Menyisipkan di tengah menggeser indeks baris dan mematahkan `--row` semua pose lama **tanpa satu pun
error** — presedennya SPEC-897 (`deciding`, `sleep`) dan SPEC-898 (`thanks`), keduanya di ekor.
`anchor.baseline` (202) dan `character.h` (168) **tidak berubah**: keduanya dibagi seluruh atlas, dan
mengubahnya membuat setiap pose lama melompat sesaat saat berganti baris.

`dizzy` `loop: false` + `then: "idle"` mengikuti kontrak manifest butir (b) brief dan sekaligus
menceritakan narasinya: pusing **sesaat** lalu berdiri lagi. Konsekuensinya frame 8 wajib pose
istirahat (sama seperti `shipped`/`wave`/`thanks`).

Ketiganya **bukan pose**: `POSE_ROW`, `PetPose`, dan `pet-walk.ts` tak disentuh. Mereka hanya bisa
dipilih lewat jalur `oneShot`/baris eksplisit yang dibangun backlog penerus — sama seperti `wave` dan
`thanks`.

### 3.3 Mode registrasi baru `float` — untuk baris yang tak menapak tanah

`petlib.build_strip` punya tiga mode: `stand` (registrasi di wilayah BAWAH + pin), `walk` (registrasi
wilayah ATAS, `dy` dipaksa sehingga piksel terendah menapak baseline), `jump` (registrasi wilayah
ATAS, `dy` dari busur lompat terukur). Tak satu pun benar untuk `held` dan `falling`:

- `held` tergantung dari atas — yang **statis** adalah kepala/torso (titik cengkeraman), yang
  **bergerak** adalah kaki & ekor yang menjuntai. Memaksa piksel terendah ke baseline (`walk`) akan
  mendorong seluruh badan naik-turun mengikuti ayunan kaki.
- `falling` tak punya tanah sama sekali; busur `jump` diturunkan dari "tanah per baris lembar" yang
  di sini tak bermakna.

`float` karena itu berarti: **registrasi di wilayah ATAS** (seperti `walk`/`jump`), **`dy` diambil
apa adanya dari registrasi** (seperti `stand`), **tanpa pin**. Yang menyenangkan: `region_for` sudah
mengembalikan wilayah atas untuk setiap mode non-`stand`, `build_strip` hanya menimpa `dy` di cabang
`walk`/`jump`, dan `pin` default `mode == "stand"`. Jadi mode ini lahir dari **satu entri baru di
`RESIDUAL_GATE`** plus komentar — bukan cabang baru di alur.

Gerbang residu `float` **dikalibrasi dari angka nyata sesudah generasi pertama**, mengikuti preseden
komentar `RESIDUAL_GATE` yang sudah ada (yang dikalibrasi ulang atas sepuluh baris nyata, bukan atas
`idle` saja). Nilai awal **0,35** — sedikit di atas `walk` (0,30) karena anggota badan yang menjuntai
menyapu lebih luas daripada langkah kaki; angka final dicatat di komentar beserta ukurannya.

### 3.4 `PET_ROW_KEYS` dan validator manifest

`PET_ROW_KEYS` bertambah tiga di ekor dengan komentar preseden seperti SPEC-897/898. `parsePetManifest`
**tidak diubah sama sekali**: ia sudah gagal keras kalau `rows.length !== PET_ROW_KEYS.length` dan
kalau `rows[i].key` tak sama dengan `PET_ROW_KEYS[i]` — jadi menambah kunci di TS tanpa merakit ulang
atlas, atau sebaliknya, mustahil lolos senyap. Itu memang gerbang yang diminta butir (d).

## 4. Naskah generasi (`prompts/<key>.md`) dan jebakan yang mengancamnya

Naskah baru mengikuti bentuk yang sudah ada: satu paragraf per baris, di atas `prompts/common.md`.
Tiga jebakan terukur harus dijawab di dalam naskah, bukan di kode:

1. **`detect_sprites` membuang blob kecil yang terpisah.** Pemisahan kolom terjadi pada celah
   transparan ≥ 8 px, dan bbox yang lebih kecil dari 40×80 px **dibuang tanpa suara** — sebuah bintang
   pusing yang melayang 8 px di samping kepala akan hilang dari strip, atau (kalau cukup besar)
   membuat jumlah sprite ≠ 8 dan menggagalkan `register.py`. Naskah `dizzy` karena itu meminta
   bintang/spiral **menyentuh atau menumpang jamang**, selalu di dalam rentang horizontal kepala.
2. **Pin membekukan kotak dan memakan anggota badan yang keluar kotak** (memori SPEC-896). Jalur
   rekonstruksi morfologis `_moving_parts` sudah menanganinya dan **tak diubah**; `dizzy` memakai
   `stand` + pin seperti `waiting`/`wave` yang naskahnya juga menggerakkan tangan.
3. **Koreksi lewat `--note` membuat model MELUPAKAN batasan yang sudah dipenuhi** (pelajaran `thanks`,
   tiga generasi). Setiap `--note` percobaan berikutnya mengulang **seluruh** batasan, bukan hanya
   yang baru gagal.

Ringkas isi naskah:

- **`held`** (8 frame, loop): tergantung dari atas seolah dijepit dari belakang tengkuk/kain, profil
  menghadap kanan, kepala & bahu **diam di posisi yang sama di kedelapan frame**; kaki menjuntai dan
  berayun pelan kiri-kanan (amplitudo kecil, langkah rata, frame 8 menyambung ke frame 1); ekor panjang
  menggantung dan mengayun berlawanan fase dengan kaki; satu mata terlihat **membelalak** (lingkaran
  besar, alis naik), mulut kecil terbuka. Tanpa tangan penculik, tanpa tali, tanpa prop.
- **`falling`** (8 frame, loop): jatuh perlahan — badan meringkuk **tegak**, lutut ditarik ke dada,
  kedua lengan memeluk lutut, **ekor terangkat tinggi** melengkung di atas punggung (ini yang menjaga
  rentang vertikalnya sebanding dengan pose berdiri; lihat §2.3). Kepala & torso diam; yang bergerak
  hanya ujung ekor yang bergetar pelan dan kain yang melambai naik, dalam langkah rata yang menyambung
  8→1. Tak ada garis kecepatan, tak ada awan debu.
- **`dizzy`** (8 frame, sekali putar → `idle`): **kaki tertanam di baseline** dan sarung diam; yang
  bergoyang hanya torso di atas pinggang, bahu, dan kepala. Frame 1 pose istirahat (sama seperti
  `idle` frame 1). Frame 2–6: kepala terkulai berputar satu lingkaran penuh, mata jadi spiral, dua-tiga
  bintang kecil emas mengitari jamang **menempel padanya**, badan sempoyongan kiri-kanan dalam langkah
  rata. Frame 7: bintang memudar, kepala tegak lagi. Frame 8: kembali ke pose istirahat.
- **`wave`** (regenerasi, lihat §2.2): frame 1 istirahat; f2 tangan setinggi pinggul; f3 setinggi bahu;
  f4–f6 melambai di samping kepala (kiri–kanan–kiri); f7 turun ke bahu; **f8 setinggi pinggul — SATU
  langkah sebelum frame 1, bukan salinannya**. Ekor satu kibasan kecil di f4–f5.

## 5. Dampak berkas

| berkas | perubahan |
|---|---|
| `internal/scripts/pet/petlib.py` | `ROWS` +3 di ekor · mode `float` di `RESIDUAL_GATE` + komentar · `ATLAS_BUDGET` 1 000 000 → 1 300 000 · `manifest()["version"]` 1 → 2 |
| `internal/scripts/pet/atlas.py` | nama atlas → v02 · komentar `encode()` diperbarui dengan angka §2.1 |
| `internal/scripts/pet/verify.py` | nama atlas → v02 |
| `internal/scripts/pet/test-petlib.py` | test mode `float` (kepala sejajar, dasar TIDAK dipaksa ke baseline, tanpa `residual_post`) · `version: 2` · 16 baris |
| `internal/assets/pet/prompts/{held,falling,dizzy}.md` | baru |
| `internal/assets/pet/prompts/wave.md` | diperbarui (sambungan rata) |
| `internal/assets/pet/rows/{held,falling,dizzy,wave}.png` + `.report.json` | dibuat/diregenerasi |
| `internal/assets/pet/qa/{held,falling,dizzy,wave}{.gif,-contact.png,-onion.png}` | dibuat/diregenerasi |
| `internal/assets/pet/hnm-pet-anoman-atlas-v02.webp` | baru (v01 **dihapus**) |
| `internal/assets/pet/pet.json` | `version: 2` · +3 baris · `sources` +3 & hash `wave` berubah |
| `internal/assets/pet/README.md` | tabel isi → v02 · pengukuran §2.1/§2.2/§2.3 · catatan review Gate 2 baris baru |
| `src/src/screens/pet-sprite.ts` | `PET_ROW_KEYS` +3 di ekor · import atlas → v02 |
| `src/test/pet-sprite.test.ts` | 16 baris · `version: 2` · indeks & kontrak tiga baris baru |
| `src/test/pet-mount.test.tsx` | asersi nama berkas atlas → v02 |
| `internal/docs/adr/0140-…md` | amandemen: mode `float`, plafon 1,3 MB, v02 |
| `internal/docs/frontend/frontend-implementation.md` | blok "Atlas & manifest" → 16 baris, v02, plafon baru |
| `internal/docs/design-system/design-system.md` | angka baris atlas bila disebut |
| `internal/docs/README.md` | ringkasan entri yang tersentuh |

## 6. Verifikasi

1. `python3 internal/scripts/pet/test-petlib.py` — hijau, termasuk test mode `float` yang baru.
2. Per baris: `register.py` (8 sprite, tumpahan 0) → `qa.py` (gerbang residu) → artefak `qa/`.
3. `atlas.py` lalu `atlas.py --check` lalu `verify.py` — atlas segar, hash `rows/` cocok, ≤ plafon.
4. **Review mata (Gate 2, tak tergantikan gerbang mesin).** Memori SPEC-897 mencatat `qa.py` LOLOS
   sambil `sleep` memunculkan ornamen ekor kedua yang berkedip. Butir (e) brief meminta atlas
   ditinjau dengan **merender tiap baris berdampingan**; artefaknya (contact sheet seluruh 16 baris +
   GIF per baris baru) dilampirkan di ringkasan sesi.
5. `pnpm vitest --run src/test/pet-sprite.test.ts src/test/pet-mount.test.tsx …` — murni frontend,
   `--no-file-parallelism` tak diperlukan (tak ada test server di set ini).
6. `pnpm --filter ./src typecheck`.

Tak ada endpoint, skema, atau migrasi yang tersentuh — jadi tak ada boot server + curl.

## 7. Di luar cakupan

- Interaksi seret itu sendiri (pointer, fisika jatuh, transisi `held → falling → dizzy → idle`) dan
  pemutaran `wave` berulang selama hover: **backlog penerus**.
- `HanomanPet.tsx` dan `pet-walk.ts` tak disentuh selain penambahan kunci baris (tak ada satu pun
  perubahan perilaku).
- Menaikkan `character.h`/`anchor.baseline`, mengubah ukuran sel, atau menyusun ulang baris lama.
