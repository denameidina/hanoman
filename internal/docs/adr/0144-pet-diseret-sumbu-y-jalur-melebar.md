# ADR-0144 — Pet yang diseret: sumbu Y di jalur pet, tiga mode fisika di mesin murni, dan jalur yang melebar hanya selagi terangkat

Tanggal: 2026-08-23 · Status: diterima · Sumber: spec `docs/superpowers/specs/2026-08-23-spec-905-pet-diseret-design.md`
Mengamandemen ADR-0140 keputusan 5 (mesin berkeliaran) dan butir DOM-nya (kepemilikan `transform`);
menegakkan ADR-0039 (tanpa channel realtime baru), ADR-0024, ADR-0037, dan grammar SPEC-648
(transform/opacity saja, tanpa rAF).

## Konteks

Pet SPEC-585/648/ADR-0140 hidup di jalur `position: fixed` setinggi **satu sel** di tepi bawah, dan
satu-satunya penulis posisinya adalah `stepWalk` — pada **satu sumbu**. Masukan manusia yang ada
(`hovered`, `panelOpen`) hanya bisa **menjeda**; tak ada satu pun jalur gestur yang menulis `x`.
SPEC-904 menambahkan baris atlas `held`, `falling`, dan `dizzy` yang sengaja dibiarkan **tanpa
pemakai** ("dipakai backlog penerus"). Sementara itu tiga keluhan operator menumpuk: pet berdiri
±67 % waktu tenangnya (`STAND_MS = [4000, 12000]` vs `WALK_MS = [2000, 6000]`), pet tak bisa
dipindahkan dengan tangan, dan hover hanya melambai **sekali** karena `onAnimationEnd` melepas
`oneShot` tanpa melihat apakah pointer masih menempel.

## Keputusan

1. **Sumbu Y dan tiga mode masuk ke mesin MURNI, bukan ke komponen.** `PetWalkMode` bertambah
   `held` | `falling` | `dizzy`, `PetWalkState` bertambah `y` (px di atas lantai jalur) dan
   `parkedX`, `PetMove` menjadi `{ x, y, durationMs, ease }`. Keadaan seret masuk sebagai **masukan**
   (`dragging`, `pointerX`, `pointerY`, `laneHeight`, `petHeight`) dan keluar sebagai keadaan + baris
   + perpindahan — pola ADR-0140 apa adanya. `pet-walk.ts` tetap tanpa timer, tanpa DOM, tanpa
   `Date.now()`. Ketiga cabang seret duduk di **kepala** `stepWalk`, di atas `anchored()`: fisika
   tak boleh diinterupsi pergantian pose, dan sebuah `waiting` yang muncul di tengah jatuh tak boleh
   menelan jatuhnya.
2. **`parkedX` adalah titik jangkar; predikat `anchored()` TIDAK berubah.** Ia tetap
   `!roam || reduced || tier === "mobile"`; yang berganti hanya tempat yang dituju cabang itu —
   `state.parkedX ?? home`. **Seret nyala di SEMUA tier, termasuk mobile.** `anchored()` melarang
   gerak **otonom** (mahal di baterai, mengganggu di layar sempit, dilarang `prefers-reduced-motion`);
   mengangkat pet dengan jari adalah manipulasi langsung yang **diminta manusia**. Tanpa `parkedX`,
   justru tiga golongan yang paling ingin **menempatkan** pet — pengguna "Diam di pojok",
   `prefers-reduced-motion`, dan mobile — yang pet-nya melompat balik ke pojok begitu dilepas,
   sehingga seret jadi sia-sia persis di sana. Cabang "pulang ke pojok untuk pose perhatian" tak
   pernah bertemu `parkedX`: cabang terjangkar sudah `return` lebih dulu. **Tanpa persistensi antar-muat
   halaman** — `parkedX` hidup di state komponen, tak ada kunci storage baru.
3. **Rasio berkeliaran dibalik.** `STAND_MS` `[4000, 12000] → [1200, 4500]`, `WALK_MS`
   `[2000, 6000] → [5000, 14000]`: siklus tenang rata-rata dari 8 dtk berdiri + 4 dtk jalan (±33 %
   berjalan) menjadi 2,85 dtk berdiri + 9,5 dtk jalan (**±72 % berjalan**). `WALK_PX_PER_S` tetap
   40 — yang kurang adalah **durasi**nya, bukan lajunya; menaikkan laju akan mengubah karakter
   berjalan yang sudah lolos Gate 2. `MIN_WALK_PX`, `LANE_MARGIN`, dan `walkTo` yang menghitung ulang
   durasi dari jarak **sesudah** clamp tak disentuh, jadi jalur sempit memperpendek langkah sendiri.
4. **Jalur melebar HANYA selagi `held`/`falling`,** ke `top: max(0px, var(--safe-top))`. Tepi
   **bawah**nya tak bergerak sama sekali, jadi sprite (`bottom: 0`), panel (`bottom: cellH + gap`),
   dan gelembung tak bergeser satu piksel pun saat ia melebar. `pointer-events: none` di jalur tak
   disentuh. **Alasannya BUKAN clipping** — lihat Konsekuensi: terukur, `pet-root` ber-`overflow:
   visible` dan sprite 300 px di atas jalur tetap tergambar **dan** tetap dijawab
   `elementFromPoint`. Yang dibeli pelebaran itu adalah **plafon angkat yang bisa diukur dari CSS-nya
   sendiri**: `var(--safe-top)` hanya bisa dihormati dengan mengukur elemen yang memakainya, karena
   `getComputedStyle(...).getPropertyValue("--safe-top")` mengembalikan token `env(...)` yang belum
   di-resolve. Ia juga menjaga hit-test tetap benar bila kelak sebuah ancestor memperoleh
   `transform`/`contain`.
5. **Satu properti `transform` untuk kedua sumbu, selalu — juga saat `y = 0`.** Actor menulis
   `translate(<x>px, <-y>px)`; daftar properti yang di-transisi tak boleh berganti di tengah rantai
   berjalan → diangkat → jatuh → mendarat. `move.durationMs === 0` tetap berarti `transition: none`,
   jalur "potong" yang sudah ada dan yang dipakai setiap potongan. `ease` hanya dua nilai:
   `linear` untuk jalan kaki (lajunya memang tetap) dan `fall` = **token `--ease-fall`**
   (`cubic-bezier(0.55, 0.085, 0.68, 0.53)`, easeInQuad) — **percepatan, bukan linear**; `--ease-out`
   bergerak ke arah sebaliknya. Ia token DS, bukan kurva harfiah di komponen: gerbang token yang ada
   (`pet-mount.test.tsx`) memeriksa warna & bayangan, **bukan easing**, jadi nilai harfiah akan lolos
   senyap dan luput dari tema yang mengubah kurva gerak. Durasi jatuh
   `max(FALL_MIN_MS 220, y / FALL_PX_PER_S 240 × 1000)`. Konsekuensi yang tak terbaca dari kodenya:
   `cut()` menyempit dari `mode !== "stand"` menjadi `walk|home` — memotong transisi pet yang sedang
   jatuh sama dengan **menghapus jatuhnya**; dan `land()` **selalu** memancarkan `y → 0`, termasuk di
   jalur `reduced` yang tak pernah melewati `falling`, karena komponen menyimpan `move` terakhir
   sehingga `move: null` akan meninggalkan sprite **di udara**.
6. **`dizzy` dikembalikan ke pose lewat `until` mesin, BUKAN lewat `thenOf`.** Manifest menulis
   `dizzy → then: "idle"`, dan rantai itu **berbohong** saat pose mesinnya `working`/`waiting`: pet
   akan berdiri diam padahal ada sesi berjalan. Durasinya tetap datang dari manifest
   (`durationMs("dizzy")` = 8 kolom / 8 fps = 1000 ms), bukan konstanta kedua yang bisa drift dari
   `pet.json`. Sesudah pusing pet mendapat jadwal **berdiri** baru, bukan langsung jalan lagi.
   `prefers-reduced-motion` melewati `falling` **dan** `dizzy`: jatuhnya seketika.
7. **Lambaian menetap; keputusan lanjut/berhenti hanya diambil di `animationend`.** Hover yang masih
   menempel memulai putaran berikutnya **di batas putaran**, jadi lambaian tak pernah terpotong di
   tengah — dan lepas hover pun tak memotongnya. `oneShot.id` wajib **penghitung naik**, bukan
   `Date.now()`: `key` React pada `<img>` adalah `${row}:${id}`, dan dua putaran yang selesai di
   milidetik yang sama memberi `key` identik sehingga animasinya **tak restart** dan lambaian berhenti
   diam-diam. `wave` tetap `loop: false` di manifest (SPEC-904) — `loop: true` membuat animasinya
   `infinite` sehingga `animationend` tak pernah menyala. Gerbang barunya `isHandled(mode)`:
   melambai sambil diangkat/jatuh/pusing sama berbohongnya dengan melambai sambil tidur.

## Konsekuensi

- **Terukur di Chrome headless lewat CDP, 2026-08-23**, pada dua viewport.
  **1280×800:** rantai baris `walk-left` → `held` → `falling` → `dizzy` → `idle` tanpa satu pun baris
  menyelip. Jalur **139 → 800 px** (`top` 661 → 0) hanya selagi `held`/`falling`, kembali ke 139 px
  tepat saat mendarat; `pointer-events: none` di setiap langkah. Plafon angkat berhenti persis di
  **661 px = 800 − 139**. Jatuh 300 px → `transform 1.25s cubic-bezier(0.55, 0.085, 0.68, 0.53)`
  dengan Y **298,7 → 280,9 → 0** (monoton, tak pernah menyusul balik) dan `transition: none` selama
  diseret; `var(--ease-fall)` terbukti **resolve** di jalur nyata — `getComputedStyle` mengembalikan
  `transform 1.25s cubic-bezier(0.55, 0.085, 0.68, 0.53)`, bukan `initial` (token yang tak ter-import
  akan membuat transisinya batal **tanpa satu pun error**, dan jatuhnya jadi seketika). Sesudah pusing pet berdiri di **x 888,0** — tempat ia dilepas — sementara pojoknya ada di
  1136; ia **tidak** melompat balik. Satu langkah jalan yang teramati: `transform 12,992s linear`
  = 519,7 px, konsisten dengan `WALK_MS` baru.
  **390×844 (emulasi ponsel, `<meta name="viewport">` sama dengan `src/index.html`):** rantai
  identik, jalur **119 → 844 px**, plafon **725 px = 844 − 119**, dan pet yang dijatuhkan di x 64
  **tetap** di 64 alih-alih kembali ke rumahnya di 264 — `parkedX` bekerja justru di tier yang
  `anchored()`-nya menyala.
  Di kedua viewport `document.elementFromPoint(innerWidth/2, innerHeight/2)` mengembalikan konten
  dashboard **di setiap langkah, termasuk selagi jalur melebar**.
- **Premis "sprite yang diangkat akan terpotong jalur" TERBANTAH.** Kontrol negatif: jalur dibiarkan
  setinggi satu sel, sprite digeser 300 px ke atas — `pet-root` mengukur `overflow: visible`, sprite
  tergambar, dan `elementFromPoint` di titik tengah tombol 44 px mengembalikan **`pet-hit`**. Jalur
  tetap dilebarkan, tetapi dengan alasan keputusan 4, bukan alasan yang ditulis brief. Dicatat supaya
  pembaca berikutnya tak menghabiskan waktu mencari clipping yang tak pernah ada.
  (Catatan harness: pengukuran yang sama di 390×844 mengembalikan `null` semata-mata karena
  `translate(400px, …)` menaruh tombolnya **di luar** viewport selebar 390 px — artefak probe, bukan
  perbedaan perilaku.)
- **Dua jebakan jsdom yang membuat test seret hijau palsu**, terukur di `jsdom ^24` / `vitest 2.1.9`.
  (1) `globalThis.PointerEvent` **tak ada**, jadi `fireEvent.pointerDown(el, { clientX: 10 })` jatuh
  ke `Event` polos dan handler menerima **`clientX === null`, `clientY === null`,
  `pointerId === null`** — seluruh test seret "lulus" tanpa menggerakkan apa pun. Penawarnya
  `new MouseEvent("pointerdown", { clientX, clientY, bubbles: true })` + `pointerId` lewat
  `Object.defineProperty`. (2) `setPointerCapture`/`releasePointerCapture`/`hasPointerCapture`
  **tak ada** — komponen memanggilnya opsional (`el.setPointerCapture?.(id)`), tanpa itu setiap test
  seret melempar `TypeError`. Konsekuensi ketiga yang menyelamatkan seluruh matematikanya: koordinat
  seret dihitung sebagai **selisih** (`dx = clientX − currentX()`, `dy = clientY + y`), bukan dari
  `getBoundingClientRect()` — rect nol jsdom hilang dengan sendirinya pada aritmetika selisih, jadi
  rumus yang sama benar di browser dan bisa di-assert di test.
- **`touch-action` & `user-select` hidup di kelas `.hn-pet-hit` (`app.css`), bukan inline.** jsdom
  **menjatuhkan keduanya dari `CSSStyleDeclaration` secara senyap**, sehingga versi inline berarti
  tak ada satu pun test yang bisa membuktikannya ada. `cursor` tetap inline karena ia berganti
  `grab`/`grabbing`. Permukaan tap tetap **44×44 px** (SPEC-763) — tak ada pelebaran badan pet, dan
  konsekuensi yang diterima: sapuan vertikal yang dimulai tepat di atas tombol itu menjadi seret,
  bukan gulir halaman.
- Nol dependency baru, nol endpoint, nol perubahan skema, nol channel realtime. Atlas, `pet.json`,
  `anchor.baseline`, `character.h`, pemilihan frame (`--row` + `steps(8)`), `POSE_ROW`, dan `PetPose`
  tak disentuh: `held`/`falling`/`dizzy` tetap **bukan** pose.
