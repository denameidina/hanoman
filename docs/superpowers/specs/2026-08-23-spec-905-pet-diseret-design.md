# Pet diseret — sumbu Y, jalur yang melebar sesaat, dan lambaian yang tak putus (spec F)

Tanggal: 2026-08-23 · Sumber: brief · Prioritas: sedang · Backlog **SPEC-905** (project `hanoman`)
· **ADR-0144** (lihat §9).

Spec keenam program "Pet hidup" (A→B→C→D→E→F). A memberi pet **tubuh** (atlas, pipeline aset, mesin
berkeliaran), B **kejujuran**, C **suara**, D **tangan**, E **tiga baris baru yang belum punya
pemakai** (`held`, `falling`, `dizzy`) plus `wave` yang aman diulang. F memakai kelimanya: pet bisa
**diangkat dengan tangan**, dijatuhkan, dan ia **berjalan jauh lebih sering** daripada berdiri.

## 1. Masalah

Tiga keluhan operator, dan ketiganya punya akar yang bisa ditunjuk barisnya.

1. **Pet lebih banyak diam daripada jalan.** `STAND_MS = [4000, 12000]` vs `WALK_MS = [2000, 6000]`
   (`src/src/screens/pet-walk.ts:10-11`). Rata-rata satu siklus tenang = 8 dtk berdiri + 4 dtk jalan
   → pet menghabiskan **±67 % waktu tenangnya berdiri**. Yang dibeli program Pet hidup A adalah
   sprite yang berjalan; angkanya membuat sprite itu jarang terlihat berjalan.
2. **Pet tak bisa dipindahkan.** Tak ada satu pun jalur gestur yang menulis posisi: `stepWalk`
   satu-satunya penulis `x`, dan satu-satunya masukan manusia ke sana adalah `hovered`/`panelOpen`
   yang hanya **menjeda**. Baris `held`/`falling`/`dizzy` sudah ada di atlas v02 sejak SPEC-904 dan
   **belum punya satu pun pemakai** (ADR-0140 amandemen: "dipakai backlog penerus").
3. **Hover melambai sekali lalu menyerah.** `playWave` memasang `oneShot` sekali
   (`HanomanPet.tsx:234-237`), dan `onAnimationEnd` pada `<img>` atlas menghapusnya tanpa melihat
   apakah pointer masih di atas pet (`HanomanPet.tsx:526-530`). Pointer yang berhenti di atas pet
   selama lima detik melihat satu lambaian lalu `idle`.

Satu kendala bentuk yang membuat #2 bukan sekadar "tambahkan `translateY`": jalur pet adalah
`position: fixed` di tepi bawah **setinggi persis satu sel** (`HanomanPet.tsx:322-325`), dan sprite
`position: absolute; left: 0; bottom: 0` di dalamnya. Mengangkat pet berarti menggerakkan sesuatu ke
**luar** kotak induknya.

## 2. Bukan masalahnya (yang diperiksa dan ditemukan tidak benar)

- **"Pet akan terpotong jalur."** Premis brief. `pet-root` **tidak** punya `overflow`, jadi nilainya
  `visible` dan sprite yang diangkat tetap tergambar. Yang benar-benar rusak bila jalur tetap
  setinggi satu sel ada dua, dan keduanya bukan soal gambar: (a) hit-test — tombol 44 px di kaki pet
  yang berada 300 px di atas jalur tetap bisa di-hit karena induknya tak meng-clip, tetapi tak ada
  yang menjamin itu bila kelak sebuah ancestor memperoleh `transform`/`contain`; dan (b) **plafon
  angkat**. Plafon itu dinyatakan di CSS (`var(--safe-top)`) dan satu-satunya cara membacanya tanpa
  memparsing string custom property adalah **mengukur elemen yang memakainya**. Jalur yang melebar
  sesaat memberi pengukuran itu gratis. Jadi jalur tetap melebar — dengan alasan yang berbeda dari
  yang ditulis brief, dan alasannya ditulis di komentar kode.
- **"Seret butuh listener di `document`."** Tidak. `setPointerCapture` mengarahkan seluruh
  `pointermove`/`pointerup`/`pointercancel` ke elemen yang menangkap, termasuk saat pointer keluar
  dari kotaknya. Handler cukup duduk di tombol 44 px yang sudah ada.

## 3. Dua fakta terukur yang menentukan bentuk test

Diukur di worktree ini (`jsdom ^24`, `vitest 2.1.9`), bukan diasumsikan:

1. **`globalThis.PointerEvent` tak ada di jsdom 24**, dan karena itu
   `fireEvent.pointerDown(el, { clientX: 10 })` jatuh ke `Event` polos: handler menerima
   **`clientX === null`, `clientY === null`, `pointerId === null`**. Test drag yang ditulis dengan
   `fireEvent.pointerDown` akan "lulus" sambil tak menggerakkan apa pun.
   **Penawarnya**: bangun `new MouseEvent("pointerdown", { clientX, clientY, bubbles: true })` dan
   tempelkan `pointerId` lewat `Object.defineProperty`, lalu `fireEvent(el, ev)`. Terukur: handler
   React menerima `["down",10,20,1] ["move",40,5] ["up",40,5] ["cancel"] ["click"]`.
2. **`Element.prototype.setPointerCapture` / `hasPointerCapture` / `releasePointerCapture` tak ada
   di jsdom 24** (`typeof === "undefined"`). Komponen wajib memanggilnya **opsional**
   (`el.setPointerCapture?.(id)`); panggilan tanpa penjaga melempar `TypeError` di setiap test.

Konsekuensi ketiga yang menyelamatkan seluruh matematika: **koordinat seret dihitung sebagai delta**,
bukan dari `getBoundingClientRect()`. jsdom memberi rect nol, dan rect nol pada aritmetika delta
**hilang dengan sendirinya** (§5.3) — jadi test bisa mengasersi posisi sungguhan.

## 4. Objective

- (a) Pet menghabiskan **mayoritas waktu tenangnya berjalan**, bukan berdiri.
- (b) Pet bisa **diseret** dengan Pointer Events pada sumbu X **dan** Y, di sentuh maupun tetikus,
  sampai batas atas viewport yang aman, tanpa lag menyusul.
- (c) Dilepas → **jatuh dengan percepatan** ke jalur → **pusing** sekali putar → kembali ke pose
  mesin, dan **X tempat ia dilepas menjadi posisi barunya**.
- (d) Berjalan → diangkat → jatuh → pusing → berdiri **tanpa satu pun lompatan posisi atau kedip
  frame**.
- (e) **Hover melambai berulang**; lepas hover menyelesaikan putaran berjalan lalu berhenti.
- (f) Klik/elus SPEC-898 tetap hidup; ambang kecil memisahkan klik dari seret.
- (g) Test: `pet-walk.test.ts`, `hanoman-pet.test.tsx`.
- (h) `internal/docs/frontend/frontend-implementation.md` §Pet + ADR baru, commit yang sama.

## 5. Desain

### 5.1 Angka baru (a)

```ts
// SPEC-905 · pet berjalan LEBIH SERING daripada berdiri. Rasionya disengaja, bukan selera:
// satu siklus tenang rata-rata kini 2,85 dtk berdiri + 9,5 dtk jalan (setelah clamp jalur ±7,5
// dtk), yaitu ±72 % berjalan — kebalikan dari ±33 % milik [4000,12000]/[2000,6000] milik ADR-0140.
export const STAND_MS: readonly [number, number] = [1200, 4500];
export const WALK_MS: readonly [number, number] = [5000, 14000];
```

`WALK_PX_PER_S` (40), `MIN_WALK_PX` (24), `LANE_MARGIN` (16), predikat `anchored()`, dan
pulang-ke-pojok untuk pose perhatian **tidak berubah**. `WALK_MS[1]` × 40 px/dtk = **560 px** jarak
yang diminta; `walkTo` sudah menghitung ulang durasi dari jarak **sesudah** clamp, jadi jalur sempit
memperpendek langkah dengan sendirinya dan tak ada perilaku baru yang perlu ditulis.

### 5.2 Mesin: tiga mode baru, tetap murni (b)(c)(d)

`pet-walk.ts` tetap **tanpa timer dan tanpa DOM**. Keadaan seret masuk sebagai masukan, keluar
sebagai keadaan + baris + perpindahan — pola yang sudah ada.

```ts
export type PetWalkMode = "stand" | "walk" | "home" | "held" | "falling" | "dizzy";
export type PetEase = "linear" | "fall";
export type PetWalkState = {
  x: number;
  y: number;              // px DI ATAS lantai jalur; 0 = menapak
  facing: PetFacing;
  mode: PetWalkMode;
  until: number;
  parkedX: number | null; // tempat manusia terakhir meletakkannya; null = belum pernah diseret
};
export type PetMove = { x: number; y: number; durationMs: number; ease: PetEase };
export type PetWalkInput = { /* … yang lama … */
  petHeight: number;      // untuk plafon angkat
  laneHeight: number;     // tinggi jalur yang boleh dipakai (sudah menghormati safe-area)
  dragging: boolean;
  pointerX: number;       // posisi yang DIMINTA untuk sudut kiri-bawah sprite, koordinat jalur
  pointerY: number;       // idem, px di atas lantai
};
```

`pointerX`/`pointerY` sengaja **bukan** posisi pointer mentah: pengurangan titik pegang adalah
aritmetika DOM dan hidup di komponen (§5.3); yang murni — clamp ke jalur dan ke plafon — hidup di
sini. `clampY(y, laneHeight, petHeight) = min(max(y, 0), max(0, laneHeight − petHeight))`.

Urutan cabang `stepWalk`, dengan **tiga cabang baru di kepala** karena fisika tak boleh diinterupsi
oleh pergantian pose:

| # | kondisi | keadaan | baris | perpindahan |
|---|---|---|---|---|
| 0a | `dragging` | `held`, `x = clampX(pointerX)`, `y = clampY(pointerY)`, `until = ∞` | `held` | `{x, y, 0, linear}` |
| 0b | `mode === "held"` ∧ `!dragging` | dilepas → `falling`, `y → 0`, `parkedX = x`, `until = now + fallMs` | `falling` | `{x, 0, fallMs, fall}` |
| 0c | `mode === "falling"`, `now < until` | tetap | `falling` | `null` |
| 0c′ | `mode === "falling"`, `now ≥ until` | mendarat → `dizzy`, `until = now + durationMs("dizzy")` | `dizzy` | `null` |
| 0d | `mode === "dizzy"`, `now < until` | tetap | `dizzy` | `null` |
| 0d′ | `mode === "dizzy"`, `now ≥ until` | `stand(x, now + between(rng, STAND_MS))` | baris pose | `null` |
| 1–6 | seperti ADR-0140 | | | |

- `fallMs = max(FALL_MIN_MS, round(y / FALL_PX_PER_S × 1000))`, **0** bila `y === 0` atau
  `input.reduced`. `FALL_PX_PER_S = 240` (turun ±1,7 dtk dari plafon 400 px — "jatuh ringan", bukan
  batu), `FALL_MIN_MS = 220` supaya jatuhan sependek 20 px tetap terbaca sebagai jatuh.
- `fallMs === 0` melewati `falling` dan langsung menilai pendaratan. `input.reduced` **juga
  melewati `dizzy`** — itulah isi "jatuh menjadi seketika dan `dizzy` dilewati".
- Durasi `dizzy` datang dari **manifest** (`durationMs("dizzy")` = 8 kolom / 8 fps = 1000 ms), bukan
  konstanta kedua yang bisa drift dari `pet.json`.
- **`thenOf("dizzy")` sengaja tidak dipakai.** Manifest menulis `then: "idle"`, dan rantai itu akan
  **berbohong** saat pose mesinnya `working`/`waiting`: pet akan berdiri diam sesudah pusing padahal
  ada sesi berjalan. Yang mengembalikan pet ke pose adalah `until` mesin — satu `setTimeout` yang
  sudah ada, tanpa mekanisme kedua. `then` tetap sah di manifest karena `wave`/`thanks`/`shipped`
  memakainya lewat `oneShot`.
- `moving` (dipakai `cut()`) menyempit dari `mode !== "stand"` menjadi
  `mode === "walk" || mode === "home"`. Tanpa itu, cabang jeda/pose akan "memotong transisi" pet yang
  sedang jatuh dan **menghapus jatuhnya**.

**`parkedX` — dan mengapa `anchored()` tetap tak berubah.** Predikatnya
(`!roam || reduced || tier === "mobile"`) **identik**; yang berubah hanya **titik** jangkarnya:

```ts
// 1 · terjangkar: berdiri di tempat manusia meletakkannya, atau di rumah bila belum pernah diseret.
if (anchored(input)) {
  const at = clampX(state.parkedX ?? home, laneWidth, petWidth);
  …
}
```

Tanpa ini, justru tiga golongan yang paling ingin **menempatkan** pet — pengguna "Diam di pojok",
`prefers-reduced-motion`, dan mobile — yang pet-nya melompat balik ke pojok begitu dilepas, sehingga
seret jadi sia-sia persis di sana. `parkedX` **tidak** menyentuh cabang 4 (pose perhatian pulang ke
pojok): cabang 1 sudah `return` lebih dulu saat terjangkar, jadi kedua aturan tak pernah bertemu.

**Seret dinyalakan di SEMUA tier, termasuk mobile.** `anchored()` melarang gerak **otonom** — yang
mahal di baterai, mengganggu di layar sempit, dan dilarang `prefers-reduced-motion`. Mengangkat pet
dengan jari adalah manipulasi langsung yang **diminta manusia**, bukan gerak yang terjadi padanya.
Konsekuensi yang diterima: sapuan vertikal yang dimulai tepat di atas tombol 44 px pet menjadi seret,
bukan gulir halaman. Itu permukaan 44×44 px di pojok, dan itulah arti `touch-action: none`.

**Posisi tidak persisten antar-muat halaman.** `parkedX` hidup di state komponen saja; muat ulang
mengembalikan pet ke pojok. Constraint brief, ditegakkan apa adanya — tak ada kunci storage baru.

### 5.3 Komponen: koordinat, jalur yang melebar, gestur (b)(d)(f)

**Aritmetika delta, bukan rect.** Pada `pointerdown` komponen menyimpan titik pegang:

```
dx = clientX − currentX()            // currentX() sudah dalam koordinat jalur
dy = clientY + walkRef.current.y     // y bertambah ke ATAS
```
lalu pada tiap `pointermove`: `pointerX = clientX − dx`, `pointerY = dy − clientY`. Kedua rumus itu
**murni selisih** terhadap posisi awal, jadi offset jalur (`root.left`, `root.bottom`) saling
menghilangkan dan tak pernah dibaca. Ini bukan penghematan gaya: ia yang membuat drag bisa
di-assert di jsdom, tempat `getBoundingClientRect()` memberi nol (§3).

**Plafon angkat.** `laneHeight()` membaca `rootRef.current.getBoundingClientRect().height` bila jalur
**sudah** melebar (`> cellH`), selain itu `window.innerHeight`. Jalur melebar pada render sesudah
`pointerdown`, jadi `pointermove` pertama sudah mengukur kotak yang benar; pada `pointerdown` sendiri
`y` masih 0 sehingga clamp-nya memang tak berpengaruh. Nilai itulah satu-satunya tempat
`var(--safe-top)` dihormati — dibaca dari elemen yang memakainya, bukan diparsing dari string custom
property (yang mengembalikan token `env(...)` yang belum di-resolve).

**Jalur melebar HANYA selagi terangkat:**

```ts
const lifted = walk.mode === "held" || walk.mode === "falling";
const root = {
  position: "fixed", left: 0, right: 0, bottom: "max(0px, var(--safe-bottom))",
  ...(lifted ? { top: "max(0px, var(--safe-top))" } : { height: cellH }),
  zIndex: 80, pointerEvents: "none",
};
```

Tepi **bawah** jalur tak bergerak sama sekali, jadi sprite (`bottom: 0`), panel
(`bottom: cellH + PANEL_GAP`), dan gelembung tak bergeser satu piksel pun saat jalur melebar —
itulah separuh dari janji "tanpa lompatan posisi" (d). `pointerEvents: "none"` di jalur tetap
berlaku; yang `auto` tetap hanya tombol 44 px, tombol gelembung, dan panel.

**Satu properti transform, selalu.** Actor berpindah dari `translateX(${x}px)` menjadi
`translate(${x}px, ${−y}px)` — **juga saat `y === 0`**, supaya tak pernah ada pergantian daftar
properti yang di-transisi di tengah rantai gerak. Transisinya
`transform ${durationMs}ms ${EASE_CSS[ease]}` dengan
`EASE_CSS = { linear: "linear", fall: "cubic-bezier(0.55, 0.085, 0.68, 0.53)" }` (easeInQuad —
percepatan, bukan linear). `durationMs === 0` tetap berarti `transition: "none"`, jalur yang sudah
ada dan yang dipakai setiap potongan: memotong jalan → mengangkat → mengikuti jari.

**Gestur.** Semua handler duduk di `button[data-testid="pet-hit"]` yang sudah ada:

| peristiwa | tindakan |
|---|---|
| `pointerdown` | `setPointerCapture?.(pointerId)`, catat `{id, dx, dy, x0, y0, moved:false}` |
| `pointermove` | belum `moved` ∧ `hypot(Δ) ≤ DRAG_SLOP_PX` → abaikan; melewati ambang → `moved = true`, tutup panel bila terbuka; lalu `setDrag({x, y})` |
| `pointerup` / `pointercancel` | `releasePointerCapture?.()`, `setDrag(null)`; bila `moved` → `swallowClickRef = true` |
| `click` | `swallowClickRef` menyala → dikonsumsi & di-reset, `reactAndToggle()` **tidak** dipanggil |

`DRAG_SLOP_PX = 6`. Di bawahnya gestur tetap klik → panel/`wave`/`thanks` SPEC-898 utuh; melewatinya
gestur menjadi seret dan `thanks` tak pernah terpicu (f). Tombolnya memperoleh
`touchAction: "none"`, `userSelect: "none"` + `WebkitUserSelect: "none"`, dan `cursor` berganti
`grab` → `grabbing` selagi `held`.

### 5.4 Lambaian yang menetap (e)

`onAnimationEnd` pada `<img>` atlas hari ini selalu `setOneShot(null)`. Ia menjadi:

```ts
if (oneShot) {
  if (oneShot.row === "wave" && hovered && canWave()) setOneShot((o) => ({ row: "wave", id: (o?.id ?? 0) + 1 }));
  else setOneShot(null);
  return;
}
```

`id` menjadi **penghitung naik**, bukan `Date.now()`: `key` React pada `<img>` adalah
`${displayRow}:${oneShot.id}`, dan dua putaran `wave` yang selesai di milidetik yang sama akan
memberi `key` identik sehingga animasinya **tak restart** — lambaian berhenti diam-diam. Ini juga
alasan `playThanks` ikut memakai penghitung yang sama.

`canWave()` = `!reduced ∧ pose ∉ {offline, sleeping} ∧ !dragging ∧ mode ∉ {held, falling, dizzy}`.
Melambai sambil diangkat atau sambil pusing sama berbohongnya dengan melambai sambil tidur.

Putaran berjalan **tidak pernah dipotong**: keputusan lanjut/berhenti hanya diambil di
`animationend`, yaitu tepat di batas putaran. `wave` sudah aman diulang sejak SPEC-904 (frame 8 satu
langkah sebelum frame 1) dan manifestnya tetap `loop: false` — `loop: true` akan membuat animasinya
`infinite` sehingga `animationend` tak pernah menyala dan `oneShot` tak pernah bisa dilepas.

## 6. Yang TIDAK berubah

`anchor.baseline`, `character.h`, `cell`, `columns`, pemilihan frame (`--row` + `steps(8)`),
`POSE_ROW`, `PetPose`, `pet-state.ts`, `pet-speech.ts`, `PetAnswer.tsx`, atlas & `pet.json`, seluruh
pipeline aset, `MIN_WALK_PX`, `LANE_MARGIN`, `WALK_PX_PER_S`, predikat `anchored()`, pulang-ke-pojok
pose perhatian, dan grammar SPEC-648 (transform/opacity saja, tanpa rAF). Tanpa endpoint, tanpa
skema, tanpa channel realtime, tanpa dependency baru.

## 7. Test

`src/test/pet-walk.test.ts` (murni):

1. `STAND_MS`/`WALK_MS` baru terpakai di jadwal berdiri & jarak jalan (rng deterministik `seq()` yang
   sudah ada).
2. `dragging` menang atas **anchored**, **jeda hover**, **pose perhatian**, dan **`sleeping`**:
   mode `held`, baris `held`, `move.durationMs === 0`.
3. `pointerY` di-clamp ke `[0, laneHeight − petHeight]`; `pointerX` ke `[LANE_MARGIN, homeX]`.
4. Lepas dari ketinggian → `falling` dengan `ease: "fall"` dan durasi
   `max(FALL_MIN_MS, y/FALL_PX_PER_S×1000)`; `parkedX` = x saat dilepas.
5. `falling` selesai → `dizzy` (`move === null`, `until = now + durationMs("dizzy")`) → pose mesin
   dengan jadwal berdiri baru, di **x tempat ia dilepas**.
6. Pergantian pose **di tengah** jatuh/pusing tak memotongnya.
7. `reduced`: lepas → mendarat seketika, `dizzy` **dilewati**.
8. Terjangkar sesudah pernah diseret berdiri di `parkedX`, bukan di `homeX`; sebelum pernah diseret
   tetap di `homeX` (test lama, tak berubah).

`src/test/hanoman-pet.test.tsx` (komponen), memakai helper `pointer()` §3:

9. Seret: `pointerdown` → `pointermove` melewati ambang → actor `transform: translate(x, −y)`,
   `transition: none`, `data-row="held"`, jalur mendapat `top` (melebar) dan tetap
   `pointer-events: none`.
10. Lepas → `data-row="falling"` + `transition: transform <fallMs>ms cubic-bezier(...)`;
    `transitionend` → `dizzy`; jalur menyusut kembali ke `height: cellH`.
11. Ambang: gerakan 4 px → tetap klik (panel terbuka); gerakan 40 px → panel **tidak** terbuka dan
    `thanks` tak terpicu oleh rentetan tiga seret.
12. Hover memutar `wave` **berulang**: dua `animationend` berturut-turut tetap `data-row="wave"`
    dengan `key` yang berbeda; sesudah `pointerleave`, `animationend` berikutnya kembali ke baris
    pose (dan **tidak** memotong di tengah putaran).
13. Test lama yang mengasersi `transform: translateX(...)` disesuaikan ke `translate(x, 0px)`.

**Verifikasi nyata sekali di akhir** (memori `hanoman-browser-smoke-via-cdp`): Chrome headless via
CDP pada 1280×800 **dan** 390×844 — seret sprite dengan `Input.dispatchMouseEvent`/`dispatchTouchEvent`,
baca `data-row`, `transform`, tinggi `pet-root`, dan buktikan `document.elementFromPoint` di tengah
dashboard **tetap** mengembalikan konten di bawah jalur selagi jalur melebar. Memori
`hanoman-spec897-pet-jujur-lengkap` mencatat qa mesin bisa lolos sementara animasinya berkedip; itu
sebabnya langkah ini bukan opsional.

## 8. Risiko

| risiko | penawar |
|---|---|
| `fireEvent.pointerDown` memberi `clientX: null` → test drag hijau palsu | helper `pointer()` berbasis `MouseEvent` (§3), dan test #9 mengasersi **angka posisi**, bukan sekadar `data-row` |
| `setPointerCapture` melempar di jsdom | dipanggil opsional; test #9/#10 membuktikan drag tetap jalan tanpa capture |
| Jalur yang melebar menelan klik dashboard | `pointer-events: none` tak disentuh; smoke §7 mengukur `elementFromPoint` selagi melebar |
| `cut()` menghapus jatuh | `moving` menyempit ke `walk`/`home`; test #6 mengunci |
| `key` `wave` bertabrakan → lambaian berhenti senyap | `id` penghitung naik; test #12 memeriksa `key`/restart, bukan hanya `data-row` |
| Seret di mobile merebut gulir | permukaan 44×44 px + ambang 6 px; ditulis sebagai keputusan, bukan efek samping |

## 9. ADR

**ADR-0144 — Pet yang diseret: sumbu Y di jalur pet, tiga mode fisika di mesin murni, dan jalur yang
melebar hanya selagi terangkat.** Mengamandemen ADR-0140 keputusan 5 (mesin berkeliaran) dan bentuk
jalur pada butir DOM; menegakkan ADR-0039 (tanpa channel realtime baru), ADR-0024, ADR-0037, dan
grammar SPEC-648.
