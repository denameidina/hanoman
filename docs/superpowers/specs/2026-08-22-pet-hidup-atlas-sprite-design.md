# Pet hidup — atlas sprite dari Codex, renderer frame, dan berkeliaran di tepi bawah (spec A)

Tanggal: 2026-08-22 · Sumber: brainstorm enhancement pet · Prioritas: sedang · Backlog **SPEC-896**
(project `hanoman`); ADR berikutnya **0140** (verifikasi ulang saat execute — nomor ADR pernah
tabrakan antar-sesi).

Spec pertama dari program **"Pet hidup"** (A→B→C→D, lihat §13). Ia mengganti fondasi visual pet
SPEC-585/648 — sticker raster yang digoyang CSS — dengan **karakter beranimasi frame** yang
berkeliaran di tepi bawah dashboard, seperti Codex Pets dan `/buddy` Claude Code. Kontrak status
(`derivePetState`, tujuh pose, prioritas total) **tidak berubah**; yang berubah adalah bagaimana pose
itu diwujudkan dan di mana pet berada.

## 1. Masalah

SPEC-585 memberi pet pose yang benar, SPEC-648 memberi irama idle per pose — tetapi keduanya hanya
bisa **menggoyang satu gambar diam**. Napas, lambaian, dan lompatan semuanya `transform` atas sticker
yang sama; tak ada kedipan, tak ada langkah, tak ada ekor yang benar-benar bergerak. Operator
membacanya sebagai "gambar yang bergoyang", bukan makhluk. Referensi yang dituju:

- **Codex Pets** — sprite sheet 8 kolom × 9 baris (`idle, running-right, running-left, waving,
  jumping, failed, waiting, running, review`), sel 192×208, mengambang di desktop, bereaksi ke
  mouse & status.
- **Claude Code `/buddy`** — pet ASCII yang bereaksi ke alur kerja dan bicara lewat gelembung.

Semua aset maskot hanoman adalah **raster WebP hasil AI tanpa source/layer animasi**
(`internal/assets/illustration/README.md`), jadi tak ada yang bisa "dihidupkan" dari yang ada;
frame baru harus dibuat.

## 2. Hasil yang dituju

Pet Hanoman berjalan, berdiri, mengetik, bertanya, merayakan, dan melambai lewat **frame nyata**
dari satu atlas WebP; berkeliaran di tepi bawah dashboard pada desktop, diam di pojok pada mobile;
tetap mencerminkan tujuh pose SPEC-585 dan tetap memenuhi reduced-motion, a11y, dan gerbang tap
SPEC-763. Atlasnya **dapat dibuat ulang** dari prompt yang dikomit lewat pipeline yang menjaga
karakter tetap konsisten, warna tetap utuh, dan frame tetap terregistrasi.

## 3. Keputusan yang mengikat

1. **Renderer sprite sheet, bukan rig vektor / Rive.** Frame nyata paling dekat dengan referensi
   dan dengan ilustrasi maskot yang ada; rig SVG berarti menggambar ulang karakter di kode, Rive
   butuh animator + runtime. Engine perilaku dipisah dari renderer (§6–7) sehingga renderer bisa
   diganti tanpa menyentuh perilaku.
2. **Gambar dibuat Codex (GPT Image), di-spawn dari pipeline.** `codex exec` non-interaktif dengan
   referensi terlampir (`-i`) sudah terbukti menghasilkan 8 frame koheren dalam satu lembar
   (§4). Tak ada API image-gen dipanggil hanoman sendiri; Codex adalah alat bantu pengembang
   seperti `cwebp` untuk `build-web.mjs`, dan turunannya **dikomit**.
3. **Gaya: proporsi pet (chibi) dalam bahasa sticker STK.** Dipilih dari empat varian yang diuji
   bergerak pada 96–160 px (sticker gen-1, sticker gerak besar, pixel-art 64 px, proporsi pet):
   kepala ±2,5 head unit, mata satu yang ekspresif, ekor besar sebagai bagian paling ekspresif,
   kostum/profil/jamang Anoman tetap. Ini **bertentangan** dengan "don't use chibi inflation" di
   `internal/docs/brand/illustration/03-mascot-system.md` → diamandemen lewat ADR-0140 sebagai band
   **"pet" 80–128 px, hanya untuk pet dashboard**, dengan alasan keterbacaan di 96 px dan ekspresi
   ekor/mata. Gate 2 brand tetap berlaku lewat artefak `qa/`.
4. **Berkeliaran di tepi bawah** (pilihan pemilik produk, dengan risiko yang disadari): hit area
   berpindah, dan tap nyasar di mobile (SPEC-763) dicegah dengan **memaksa diam di pojok pada tier
   mobile**. `walk-left` **digambar terpisah** — profil asimetris tak boleh dicerminkan (aturan
   brand "never mirror"; trik Codex `running-left = mirror` terlarang di sini).
5. **Kontrak status tak disentuh.** `derivePetState`, `PetPose`, prioritas, headline, target,
   `PET_TRANSIENT_MS`, `hanoman.pet.hidden`, pegangan buntut — semua tetap. Pose hanya dipetakan ke
   baris atlas.

## 4. Temuan terukur dari uji (2026-08-22, scratchpad `pet-style-trial`)

Uji dilakukan dengan `codex-cli 0.147.0`, model `gpt-5.6-sol`, 1–3 menit per lembar. Yang tak
terbaca dari referensi mana pun dan karena itu **dikunci ke pipeline**:

- **Model tidak menaati grid sel.** Diminta 4×2 sel 384×512, bbox karakter per sel bergeser ke kiri
  sepanjang baris (97→95→61→26 px; pada pixel-art satu sprite menyeberang batas sel). Memotong per
  grid = jitter dan terpotong. Sprite harus **dideteksi dari celah transparan**.
- **Jangkar kaki saja tidak cukup.** Ujung ekor yang turun mendekati kaki ikut masuk bbox kaki dan
  menggeser jangkar sampai ±15 px (terlihat sebagai badan berbayang di onion-skin; rasio tepi
  goyah 0,567). **Registrasi** — cari offset (±24 px) dan skala (±8 %) yang meminimalkan XOR mask di
  wilayah statis (baris ≥ 45 % tinggi, kolom ≥ tepi kiri kaki − 12 → ekor dikecualikan) —
  menurunkan rasio ke 0,145 dan residu statis ke 0,01–0,03 pada lembar yang sama.
- **Prompt gerak besar mengurangi kepatuhan tubuh bawah.** Tinggi sprite bervariasi 420–442 px
  (sticker) dan 316–340 px (pet) walau diminta mengunci kaki; residu pasca-registrasi 0,03–0,07
  (sticker) dan 0,10–0,19 (pet). Yang tersisa adalah **perbedaan bentuk**, bukan posisi — hanya
  **pin** (tempel wilayah statis frame 1 ke frame 2–8) yang bisa membekukannya.
- **Latar magenta merusak warna.** `remove_chroma_key.py --despill` milik skill imagegen Codex
  memotong kanal merah saat men-despill magenta: emas jamang jadi olive, kain merah kusam. Kunci
  warna harus **hijau `#00FF00`** (palet Anoman nyaris tanpa hijau; itu pun default di dokumen
  skill Codex sendiri) dan penghapusan latar dilakukan **pipeline kita** dari gambar mentah, dengan
  *unmix* hanya di pita tepi (interior tak disentuh).
- **Pixel-art tidak tercapai tanpa kuantisasi.** Diminta "16-bit pixel art", model memberi
  ilustrasi resolusi tinggi yang dipikselkan; pixel 64 px logis hanya tercapai lewat
  `resize(NEAREST)` di pipeline. Tidak dipakai (gaya dikunci ke proporsi pet), dicatat agar tak
  diulang.
- **Biaya byte.** Strip 8 frame 1536×208 WebP: 100 KB (sticker q90), 134 KB (pet q90), 34 KB
  (pixel lossless). 10 baris pet ≈ 1,3 MB pada q90 → anggaran atlas **≤ 1 MB** dicapai dengan q80–85
  dan diukur `atlas.py --check`.

Artefak yang disetujui sudah dipindahkan ke rumah finalnya: `internal/assets/pet/rows/idle.png`
(strip teregistrasi), `ref/anoman-pet-model.png` (frame 1 = model sheet), `prompts/idle.md`,
`prototype/{register,chroma_key}.py` (benih skrip §5), dan `raw/` (gitignore).

## 5. Aset & pipeline

### 5.1 Keluarga aset `internal/assets/pet/`

```
internal/assets/pet/
  README.md                      cara regenerasi per baris, gerbang QA, anggaran, review manusia
  prompts/common.md              blok bersama: subjek, gaya, layout, registrasi, latar hijau
  prompts/<key>.md               deskripsi 8 frame per baris
  ref/anoman-pet-model.png       model sheet — dilampirkan ke SETIAP generasi agar karakter identik
  rows/<key>.png                 strip 8 frame 1536×208 hasil registrasi+pin — master yang dikomit
  hnm-pet-anoman-atlas-v01.webp  turunan yang dikomit (pola web/ SPEC-585: runner CI tanpa Codex/cwebp)
  pet.json                       manifest (§5.3); memuat hash rows/ untuk cek kesegaran (pola web/manifest.json)
  qa/                            contact sheet, onion-skin, GIF per baris — bukti review manusia (Gate 2)
  raw/                           keluaran mentah Codex — .gitignore, dapat dibuat ulang dari prompts/
```

Atlas **tidak** masuk `illustration-registry.ts` (glob eager `illustration/web/` adalah katalog
ilustrasi statis); ia di-import `pet-sprite.ts` lewat Vite `?url` (hash, cache panjang) bersama
`pet.json`. `verify.mjs` ilustrasi tetap 41 ID; pet punya `verify.py` sendiri.

### 5.2 Skrip `internal/scripts/pet/` (Python 3 + Pillow + numpy; pola `export-whatsapp-stickers.py`)

| skrip | masuk → keluar | aturan yang dikunci |
|---|---|---|
| `gen.py <key> [--retry]` | `prompts/common.md` + `prompts/<key>.md` + `ref/*` → `codex exec --skip-git-repo-check -s workspace-write -C <tmp> -i ref/anoman-pet-model.png -i rows/idle.png …` → `raw/<key>.png` | kanvas 1536×1024, grid 4×2; "tubuh bawah dikunci"; latar hijau; Codex diminta **hanya menyimpan PNG mentah** (tanpa key sendiri); gagal bila Codex tak ada → pesan seperti `build-web.mjs` untuk `cwebp` |
| `key.py` | `raw/<key>.png` → RGBA | key disampel dari tepi kanvas; ramp jarak RGB `lo=40, hi=110`; unmix hanya di pita parsial |
| `register.py <key> [--no-pin]` | RGBA → `rows/<key>.png` + `rows/<key>.report.json` | deteksi celah (min gap 12/8 px, sprite ≥ 40×80); skala ke frame 1 = **168 px** (`character.h`, menyisakan 34 px ruang ekor/lompat — 192 px terbukti menumpahkan ekor f7–f8); **mode per baris** dari `petlib.ROWS`: `stand` = registrasi offset ±24 & skala 0,92–1,08 di wilayah baris ≥ 45 % & kolom ≥ kaki−12 (kaki = run kolom **paling kanan** di 8 % baris terbawah — bbox polos tertarik ekor) lalu **pin** feather 6 px; `walk` = registrasi dx di wilayah atas (≤ 55 %), kaki terendah menapak baseline; `jump` = dx wilayah atas, ketinggian lompat relatif tanah baris lembar dipertahankan; tiap frame **di-clip ke selnya** dan tumpahan dihitung; sel 192×208, jangkar kaki x 0,62, baseline 202 |
| `atlas.py [--check]` | `rows/*.png` + urutan manifest → `hnm-pet-anoman-atlas-v01.webp` + `pet.json` | q80–85, alpha utuh, `--check` gagal bila baris/dimensi/hash/anggaran ≤ 1 MB meleset |
| `qa.py <key>` | gerbang + artefak `qa/` | **gagal** bila sprite ≠ 8, sprite menyentuh tepi lembar, tumpahan sel > 0 px, residu pra-pin > **0,15** (`stand`; idle yang disetujui mengukur 0,03–0,07 begitu ekor dikeluarkan dari wilayah) / **0,30** (`walk`/`jump`, wilayah atas), atau alpha hilang; tulis contact sheet, onion-skin, GIF |
| `verify.py` | artefak yang dikomit | baris manifest = baris atlas, sel 192×208, hash `rows/` segar, ukuran ≤ 1 MB; dipanggil test |

`pin` hanya untuk baris `stand` (idle, working, waiting, blocked, review, docs, wave) — baris
`walk`/`jump` kakinya memang bergerak. Logika bersama hidup di `petlib.py` (+ `common.py`: pemuat
dan lokasi aset, dapat dialihkan lewat `HANOMAN_PET_ASSETS` untuk test); CLI-nya tipis.
`test-petlib.py` menguji pustaka atas lembar sintetis (bentuk digambar Pillow): chroma key
mempertahankan warna interior, deteksi 8 sprite dari grid longgar + baris lembar, sprite di tepi
terdeteksi, kaki mengabaikan ekor, pemulihan offset/skala yang diketahui, pin membekukan wilayah
statis (residu pasca-pin ≈ 0) tanpa menyentuh kolom ekor, `walk` menapak & `jump` melayang,
tolak ≠ 8 sprite, rakit atlas + manifest, tolak strip salah ukuran.

### 5.3 Kontrak `pet.json`

```json
{ "id": "PET-001", "version": 1, "cell": { "w": 192, "h": 208 }, "columns": 8,
  "anchor": { "x": 0.62, "baseline": 202 },
  "character": { "h": 168 },
  "rows": [
    { "key": "idle",         "fps": 6,  "loop": true },
    { "key": "walk-right",   "fps": 10, "loop": true,  "dir": "right" },
    { "key": "walk-left",    "fps": 10, "loop": true,  "dir": "left" },
    { "key": "working",      "fps": 8,  "loop": true },
    { "key": "waiting",      "fps": 6,  "loop": true },
    { "key": "blocked",      "fps": 4,  "loop": true },
    { "key": "review",       "fps": 6,  "loop": true },
    { "key": "shipped",      "fps": 10, "loop": false, "then": "idle" },
    { "key": "docs-updated", "fps": 6,  "loop": true },
    { "key": "wave",         "fps": 10, "loop": false, "then": "idle" } ],
  "sources": { "idle": "<sha256 rows/idle.png>" } }
```

Indeks baris = urutan array (8 frame tiap baris; 10 baris → atlas 1536×2080). `character.h` = tinggi
karakter berdiri di dalam sel (frontend menskalakan dari sini, bukan dari tinggi sel). `sources`
memuat satu entri per `key` baris — hash `rows/<key>.png` saat atlas dirakit — supaya `verify.py`
tahu atlas basi. Validasi di frontend ditulis tangan (`parsePetManifest`): `zod` hanya dependency
`shared` dan tak bisa di-resolve dari paket `src`. Isi baris mengikuti
kosakata brand (emosi lewat mata/alis, kepala, gestur, ekor; tanpa wajah emoji, tanpa slapstick):

| baris | isi frame | dipakai oleh |
|---|---|---|
| `idle` | napas, kedip di frame 4, ekor mengayun (strip yang disetujui) | pose `ready`; `then` untuk one-shot |
| `walk-right` / `walk-left` | siklus langkah 8 frame, kaki bergerak, ekor mengikuti | mesin berkeliaran |
| `working` | mengetik/memindai — tangan bergerak, mata fokus | pose `working` |
| `waiting` | pose bertanya: tangan terangkat, menatap penonton, kedip | pose `waiting` |
| `blocked` | berat: bahu & ekor turun, napas lambat | pose `blocked` |
| `review` | condong mengamati, kepala miring | pose `review` |
| `shipped` | lompat + kibasan ekor, satu kali | pose `shipped` (transient) |
| `docs-updated` | membawa lontar/gulungan (MPS-08 carry knowledge) | pose `docs-updated` |
| `wave` | melambai, satu kali | reaksi hover/klik |

## 6. Renderer

Grammar SPEC-648 dipertahankan: tiap pemilik `transform` adalah elemen sendiri, keyframe hanya
menulis `transform`/`opacity`, tanpa JS per frame, tanpa rAF/interval.

```
pet-root     fixed · left:0 right:0 · bottom: max(safe-bottom, 0) · tinggi 1 sel × s · pointer-events:none · z 80
└─ pet-actor   transform: translateX(var(--x)) · transition: transform <segmen> linear       ← §7
   ├─ pet-stage   role=status aria-live=polite · hn-pet-reveal (tetap)
   │  ├─ pet-reactor   hover/klik (tetap)
   │  │  └─ pet-viewport   overflow:hidden · width 192s · height 208s
   │  │     └─ pet-rowshift   height 208s · transform: translateY(calc(var(--row) * -100%))
   │  │        └─ img.hn-pet-atlas   width 1536s · animation: hn-pet-frames var(--dur) steps(8,end) <count> <fill>
   │  ├─ span.hn-sr-only   kalimat status
   │  └─ button.hit   44×44 di kaki · pointer-events:auto
   └─ panel   popover (tetap) · dijangkar ke pet, di-clamp viewport
```

- `@keyframes hn-pet-frames { to { transform: translateX(-100%) } }` — `-100%` lebar img = 8 sel,
  jadi bebas skala dan bebas `var()` di keyframe. Durasi `8 / fps` dtk dari manifest.
- Baris `loop:false`: `animation-iteration-count: 1; animation-fill-mode: forwards`, `animationend`
  (difilter `animationName === "hn-pet-frames"` dan baris yang sedang aktif) → baris `then`.
  Pergantian baris one-shot memakai `key` React pada img agar animasi mulai dari frame 1.
- `pet-sprite.ts` (murni): `parsePetManifest` (validator tangan), `rowOf`, `rowIndex(key)`,
  `durationMs(key)` = `columns / fps × 1000`, `POSE_ROW: Record<PetPose, PetRowKey>` (identitas
  kecuali `ready → idle`), `thenOf(key)`; `PET_MANIFEST` dan `PET_ATLAS_URL` sebagai konstanta.
- Skala `s` = tinggi karakter / `character.h`: **112 px** desktop & tablet, **96 px** mobile
  (`useResponsiveTier`); sel di layar = `cell × s` (≈128×139 px desktop).
- `will-change: transform` pada `pet-actor` dan img; atlas satu `<img>` dengan `decoding="async"`.
- `SIZE`/`HIT` SPEC-763 tetap 44 px di kaki sprite (jangkar x 0,62, baseline 202 dari manifest).
- Tumpukan `seen`/`StickerIllustration`/`POSE_ART`/`pet-motion.ts` **dicabut** beserta keyframe
  idle/pose SPEC-648 (`hn-pet-idle-*`, `hn-pet-pose-*`, `hn-pet-celebrate`); `hn-pet-reveal`,
  `hn-pet-click`, `hn-pet-panel-*` tetap. Token `--dur-pet-*` dicabut bila tak ada pemakai lain.

## 7. Mesin berkeliaran (`pet-walk.ts`, murni)

`step(state, input, rng): { state, row, move? }` dengan
`state = { x, facing, mode: "stand" | "walk" | "home", until }`,
`input = { now, currentX, laneWidth, petWidth, pose, hovered, panelOpen, documentHidden, roam, reduced, tier }`
(`currentX` = posisi aktual yang dibaca komponen dari `getBoundingClientRect()` hanya pada
peristiwa — jsdom memberi rect nol → jatuh ke posisi keadaan; `hovered` = pointer hover ∨ fokus
keyboard pada `button.hit`),
`move = { x, durationMs }` (diterjemahkan komponen ke `--x` + `transition-duration`).

| kondisi | perilaku |
|---|---|
| `tier === "mobile"` ∨ `reduced` ∨ `!roam` | di **rumah** (`x = laneWidth − petWidth − margin`), menghadap kanan, `durationMs = 0` |
| pose tenang: `ready`, `working`, `review`, `docs-updated` | bergantian **berdiri 4–12 dtk** (baris pose) dan **jalan 2–6 dtk** @ 40 px/dtk ke target acak dalam `[margin, laneWidth − petWidth − margin]`; baris `walk-right`/`walk-left` sesuai arah; sampai → berdiri |
| pose perhatian: `waiting`, `blocked` | `mode: "home"` — jalan pulang ke pojok kanan bila belum di sana, lalu berdiri memutar baris pose; kabar penting selalu di tempat yang sama |
| `shipped` | berhenti di tempat, baris `shipped` sekali → `idle` (lewat `then`), lalu aturan tenang |
| `hovered` ∨ `panelOpen` ∨ `documentHidden` | berhenti (transisi dipotong di posisi saat ini); masuk hover → `wave` sekali lalu baris pose |
| resize (`laneWidth` berubah) | `x` di-clamp; transisi yang sedang berjalan dipotong |

Pergantian pose di tengah langkah tidak memutus langkah kecuali pose perhatian (pulang) atau
`shipped` (berhenti). `rng` disuntikkan (`() => number` di [0,1)); komponen memakai
`Math.random`, test memakai seed. Durasi & kecepatan adalah konstanta bernama di modul
(`WALK_PX_PER_S = 40`, `STAND_MS = [4000, 12000]`, `WALK_MS = [2000, 6000]`, `LANE_MARGIN = 16`).

Penjadwalan di komponen: **satu** `setTimeout` pada `state.until` + `transitionend` pada
`pet-actor` (difilter `propertyName === "transform"`) + `visibilitychange` + `resize` (debounce).
Tanpa interval. Posisi aktual saat dipotong dibaca sekali dari `getBoundingClientRect()` pada
peristiwa potong, bukan per frame.

## 8. Interaksi & preferensi

- Klik = toggle panel (tetap) + `wave` + berhenti. Escape/klik-luar menutup (tetap).
- Panel dijangkar ke `x` pet: `left = clamp(petCenter − panelW/2, 12 + safe-left, vw − panelW − 12 − safe-right)`,
  `transform-origin: bottom center`; dihitung sekali saat buka (pet berhenti selama panel terbuka).
- Tombol ketiga di panel: **"Diam di pojok" / "Berkeliaran"** → `hanoman.pet.roam` (`"1"`/`"0"`,
  default `"1"`; `loadPetRoam`/`savePetRoam` di `pet-state.ts`, pola `hanoman.pet.hidden`). Di tier
  mobile tombol disembunyikan dan nilainya diabaikan (dipaksa diam).
- `hanoman.pet.hidden`, pegangan buntut 44 px, `Sembunyikan`, `Buka Terminal/Backlog` tidak berubah.
- Jalur `pointer-events: none`; hanya `button.hit`, pegangan, dan panel yang `auto`. Gerbang SPEC-763
  diperluas: kontrol di bawah **seluruh** jalur tetap menerima tap, dibuktikan `elementFromPoint`.

## 9. Aksesibilitas & reduced motion

- Atlas memuat 80 frame, jadi ia tak bisa membawa `alt` bermakna: `<img alt="" aria-hidden="true">`,
  dan kalimat status (`Hanoman ${POSE_LABEL[pose]} · ${headline}`) hidup di `<span class="hn-sr-only">`
  **di dalam** region `role="status" aria-live="polite"`. Ini mengganti keputusan SPEC-585 "alt di
  gambar" dan dicatat di `frontend-implementation.md`. Tetap satu sumber kalimat.
- `prefers-reduced-motion`: `animation: none` pada img (frame 1 baris pose terlihat statis),
  `transition: none` pada actor/reactor, pet di rumah, tanpa `wave`; pegangan, Escape, klik-luar,
  `inert` panel tetap seperti SPEC-648. Nilai persis di-assert (`"none"`), bukan asymmetric matcher.
- Tab order: tombol di akhir DOM (tetap). Fokus keyboard pada tombol menghentikan pet seperti hover.

## 10. Kinerja & anggaran

- Satu `<img>` ≤ 1 MB, hash Vite, di-decode sekali; gerak = `transform` di compositor; React
  merender hanya saat pose/baris/mode berubah.
- Tak ada channel WS/poll baru; sumber data tetap `sessions`/`backlog`/`notifications` SPEC-585.
- Atlas dimuat biasa dengan `decoding="async"` (tanpa preload, tanpa `loading="lazy"` — elemen
  `fixed` selalu "terlihat"); tak perlu gerbang `img.complete`: viewport tak berlatar, jadi sebelum
  termuat tak ada apa pun yang tergambar, bukan kotak kosong.

## 11. Pengujian

- `src/test/pet-walk.test.ts` — tabel §7 dengan `rng` seeded: rumah pada mobile/reduced/`roam=0`;
  bergantian berdiri/jalan dalam batas; arah = baris; pulang pada `waiting`/`blocked`; berhenti pada
  hover/panel/hidden; clamp saat resize; tak pernah `walk-*` saat reduced.
- `src/test/pet-sprite.test.ts` — `pet.json` nyata lolos zod; `rowIndex`, `durationMs = 8000/fps`,
  `thenOf`; `POSE_ROW` mencakup tujuh pose.
- `src/test/hanoman-pet.test.tsx` — struktur viewport/rowshift/img; `--row` & `animation`
  (`hn-pet-frames`, `steps(8, end)`, durasi); one-shot `wave` → `animationend` → baris pose; reduced
  nilai persis; panel di-clamp; toggle roam bertahan lintas remount; kalimat status berubah; hit 44
  px; test a11y/persistensi/pointer containment lama tetap hijau (disesuaikan ke struktur baru).
- Kontrak CSS (pola SPEC-648): `hn-pet-frames` hanya `transform`; keyframe SPEC-648 yang dicabut
  tak lagi ada.
- `internal/scripts/pet/test-*.py` — §5.2.
- Harness CDP sekali pakai (pola memori `hanoman-browser-smoke-via-cdp`, tanpa server/DB): atlas
  nyata; `getComputedStyle(img).transform` berubah antar frame; `pet-actor` berpindah; di 390×844
  pet di rumah; di 1280×800 `elementFromPoint` atas kontrol di bawah jalur mengenai kontrol.

Dijalankan `env -u NODE_ENV pnpm vitest --run <path>` (prod bikin RTL `act` gagal); Python
`python3 -m pytest internal/scripts/pet` atau `python3 internal/scripts/pet/test-register.py`.

## 12. Docs & ADR (commit yang sama)

- **ADR-0140** — "Pet dashboard sebagai sprite beranimasi: aset dibuat AI lewat Codex, pipeline
  registrasi, renderer frame, berkeliaran di tepi bawah; amandemen band pet pada sistem maskot."
  Menegakkan ADR-0039 (tanpa realtime baru), mengamandemen konvensi SPEC-585/648 (tanpa ADR) menjadi
  keputusan arsitektur karena kini ada keluarga aset, pipeline, dan skrip baru.
- `internal/docs/frontend/frontend-implementation.md` — seksi "Pet Hanoman" ditulis ulang: atlas,
  manifest, DOM, mesin berkeliaran, preferensi, a11y baru.
- `internal/docs/design-system/design-system.md` — band pet + grammar sprite (`steps`, satu img).
- `internal/docs/brand/illustration/03-mascot-system.md` — band "pet" 80–128 px (§3.3).
- `internal/assets/pet/README.md` — regenerasi per baris, gerbang, review manusia.
- `internal/docs/README.md` — tautan semua yang di atas.

## 13. Roadmap program (di luar spec ini, dicatat agar tak hilang)

Backlog sudah dibuat berantai (`dependsOn`, ADR-0093 — tiap item menunggu pendahulunya selesai
**dan** ter-merge): **SPEC-896** (A, spec ini) → **SPEC-897** (B) → **SPEC-898** (C) → **SPEC-899** (D).
Urutan berantai adalah keputusan pemilik produk 2026-08-22 (satu per satu), menggantikan catatan
sebelumnya bahwa D bisa paralel dengan B/C.

| # | spec | isi | butuh |
|---|---|---|---|
| **B** | SPEC-897 · Pet jujur & lengkap | kondisi **terputus** (ekspos status koneksi dari `api/events.ts` — hari ini nol; pet membeku di data basi saat WS putus/backoff 10 dtk/tab hidden), **lencana hitungan**, **panel multi-kondisi** (semua kondisi aktif + aksi per baris, bukan hanya puncak prioritas), pose `deciding` dan **tidur** (2 baris atlas lewat pipeline A) | tanpa ADR |
| **C** | SPEC-898 · Pet bicara | **gelembung** ber-template saat pose berubah (transient & waiting saja, agar tak mengulang Toast), **rekap "selama kamu pergi"** saat tab aktif lagi (`visibilitychange`), **urgensi menurut umur** (perlu `decisionAt` di payload sesi — `TerminalSession` tak punya stempel waktu), pose **thanks** (STK-007) saat dielus | ADR kecil bila `decisionAt` masuk payload |
| **D** | SPEC-899 · Inbox keputusan | `GET /sessions/:id/dialog` + `POST /sessions/:id/dialog/answer` membungkus `server/src/services/tui-dialog.ts` (parser + `answerChoiceDialog`/`answerMultiSelectDialog` yang sudah dipakai lead); panel pet menampilkan pertanyaan + opsi dan menjawab tanpa membuka terminal | ADR (endpoint baru) |

## 14. Di luar scope

Gelembung, lencana, terputus, tidur, inbox, drag bebas, suara, teks LLM, pet di portal klien,
pet per project, tema gelap (aplikasi belum punya), mirror sprite, Rive/Lottie, rAF.

## 15. Struktur berkas

| berkas | perubahan |
|---|---|
| `internal/assets/pet/**` | keluarga aset baru (§5.1); `rows/idle.png`, `ref/`, `prompts/idle.md` sudah ada |
| `internal/scripts/pet/{petlib,common,gen,key,register,atlas,qa,verify}.py` + `test-petlib.py` | pipeline (§5.2); `internal/assets/pet/prototype/` dihapus (digantikan `petlib.py`) |
| `src/src/screens/pet-sprite.ts` | manifest zod, `POSE_ROW`, durasi, `then` |
| `src/src/screens/pet-walk.ts` | mesin berkeliaran murni |
| `src/src/screens/pet-state.ts` | + `loadPetRoam`/`savePetRoam`, `PET_ROAM_KEY` |
| `src/src/screens/HanomanPet.tsx` | renderer sprite, actor, panel berjangkar, toggle roam |
| `src/src/screens/pet-motion.ts` | dicabut |
| `src/src/app.css`, `src/src/ds/tokens/effects.css` | `hn-pet-frames`; cabut keyframe/token SPEC-648 yang tak dipakai |
| `src/test/pet-walk.test.ts`, `pet-sprite.test.ts`, `hanoman-pet.test.tsx`, `pet-motion.test.ts` (dicabut) | §11 |
| docs & ADR | §12 |
