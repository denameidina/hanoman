# SPEC-648 — Animasi Pet Hanoman: maskot hidup, tetap tenang

Tanggal: 2026-08-11 · Sumber: brief · Prioritas: sedang

Tidak ada ADR baru. SPEC-585 dan aturan motion/reduced-motion di design system diperluas pada
lapisan presentasi; kontrak status, endpoint, skema, aset, serta mekanisme realtime tetap utuh.

## Objective

Ketujuh pose Pet Hanoman memiliki identitas idle yang berbeda dan teruji; perubahan pose, hover,
klik, panel ringkasan, serta kemunculan kembali memiliki gerak one-shot yang tenang; seluruh gerak
hanya memakai `transform`/`opacity`, tanpa dependency/aset/timer denyut atau perubahan kontrak
status; dan `prefers-reduced-motion` mematikan setiap animation/transition secara eksak tanpa
mengurangi keterbacaan maupun aksesibilitas.

## Konteks terukur

SPEC-585 sudah membangun fondasi yang benar:

- `derivePetState()` di `src/src/screens/pet-state.ts` adalah fungsi murni dengan urutan prioritas
  total untuk tujuh pose. Ia sudah teruji dan **tidak disentuh** oleh spec ini.
- `HanomanPet` dipasang sekali di `App`, memakai `StickerIllustration`, berada di `z-index: 80`, dan
  pembungkusnya `pointer-events: none`.
- `role="status" aria-live="polite"` membungkus gambar dan tombol overlay; gambar sengaja tidak
  dipindah ke dalam `<button>` agar alt perubahan pose tetap diumumkan screen reader.
- `prefers-reduced-motion` dibaca lewat `matchMedia`; ketiadaan `matchMedia` di jsdom berarti tidak
  ada preferensi reduce.
- Tidak ada library animasi dan kedelapan WebP sticker sudah ada di bundle lewat registry eager.

Yang belum memenuhi outcome SPEC-648:

- seluruh pose memakai animation yang sama, `hn-pet-breathe 4.5s`;
- perubahan pose hanya mengganti `opacity` selama `--dur-slow`;
- hover dan klik tidak mengubah bahasa tubuh;
- panel ringkasan langsung mount/unmount;
- pet yang dipanggil kembali setelah disembunyikan langsung menjentik ke layar.

## Pendekatan yang dipertimbangkan

### A. Layer compositor terpisah (dipilih)

Empat pembungkus memisahkan empat pemilik `transform`: reveal, reaksi interaksi, idle, dan lapisan
pose. Panel mempunyai animation sendiri. React hanya mengganti atribut/animation saat pose atau
interaksi diskret berubah; browser menginterpolasi frame di compositor.

Harga yang diterima: dua pembungkus DOM tambahan di dalam stage. Nilainya lebih besar karena dua
animasi yang sama-sama menulis `transform` pada satu elemen tidak dapat dikomposisikan secara aman.

### B. Satu wrapper, satu animation gabungan

DOM lebih pendek, tetapi idle, transisi pose, hover, dan klik saling mengganti `transform`. Setiap
kombinasi perlu keyframe baru dan penambahan satu interaksi akan melipatgandakan kombinasi itu.

### C. Web Animations API imperatif

Mampu mengorkestrasi sequence, tetapi menambah lifecycle/cancellation di JS, menyulitkan bukti
reduced-motion, dan tidak memberi manfaat untuk gerak yang semuanya bisa dinyatakan CSS.

## Arsitektur motion

Struktur stage menjadi:

```text
role=status · pet-stage (reveal)
├── pet-reactor (hover + click)
│   └── pet-idle (karakter pose)
│       └── pose layers (masuk + keluar)
└── button overlay transparan
```

Urutan layer menentukan kepemilikan transform:

| layer | tanggung jawab | pemicu |
|---|---|---|
| `pet-stage` | muncul saat mount/dipanggil kembali | mount setelah `hidden=false` |
| `pet-reactor` | mendekat halus saat hover; squash/pantul lebih tegas saat klik | CSS `:hover`; state one-shot klik |
| `pet-idle` | bahasa tubuh khas pose | hasil murni `motionForPose(view.pose)` |
| pose image | pose baru mengerut lalu memantul; pose lama mengecil dan lenyap | perubahan `view.pose` |

Setiap keyframe hanya menulis `transform` dan/atau `opacity`. Tidak ada `top`/`left`/`width`/`height`,
`filter`, pengukuran DOM, `requestAnimationFrame`, interval, atau render React per-frame.

## Katalog gerak per pose

Modul presentasi baru `src/src/screens/pet-motion.ts` memiliki fungsi murni
`motionForPose(pose)`. Ia tidak menentukan status; ia hanya memetakan `PetPose` yang sudah dipilih
`pet-state.ts` ke nama/keyframe dan shorthand animation.

| pose | karakter | keyframe idle | irama |
|---|---|---|---|
| `ready` | napas tenang, sedikit terangkat | `hn-pet-idle-ready` | paling tenang |
| `working` | bob kecil berirama | `hn-pet-idle-working` | paling giat, amplitudo tetap kecil |
| `waiting` | diam panjang lalu melambai/bergoyang singkat | `hn-pet-idle-waiting` | menarik perhatian berkala |
| `blocked` | turun berat lalu pulih lambat | `hn-pet-idle-blocked` | paling lambat dan berat |
| `review` | condong memperhatikan lalu kembali | `hn-pet-idle-review` | waspada tetapi tidak mendesak |
| `shipped` | flourish satu kali lalu idle lega | `hn-pet-celebrate` + `hn-pet-idle-shipped` | meriah sesaat, kemudian tenang |
| `docs-updated` | flutter kecil seperti lembar dibuka | `hn-pet-idle-docs` | ringan dan berkala |

Tujuh pose mempunyai tujuh identitas keyframe idle yang berbeda. `shipped` adalah satu-satunya
definisi berdua: flourish satu kali memakai fill mode `both`, lalu idle shipped mulai setelah
flourish selesai. Dengan demikian pose transient 45 detik tidak berpesta selama 45 detik.

Durasi tidak ditanam di call site. Token efek menambah durasi semantik
`--dur-pet-active`, `--dur-pet-attention`, `--dur-pet-calm`, `--dur-pet-heavy`, dan
`--dur-pet-flourish`; one-shot interaksi/transisi tetap memakai `--dur-base`/`--dur-slow`, dan
easing memakai `--ease-out`/`--ease-inout`. Token semantik membuat irama mudah dibaca dan mencegah
angka yang sama tersebar di TypeScript/CSS.

## Perubahan pose: bukan crossfade datar

Daftar `seen` SPEC-585 tetap dipakai agar pose yang sudah pernah dilihat dapat memainkan exit tanpa
memuat seluruh katalog sejak awal. Pada perubahan pose:

- pose baru mendapat `hn-pet-pose-in`: mulai mengecil/terkompresi dan transparan, melewati sedikit
  overshoot, lalu berhenti pada ukuran asli;
- pose lama mendapat `hn-pet-pose-out`: mengecil ringan dan transparan;
- pose aktif diberi z-index di atas pose keluar;
- opacity akhir tetap ditulis inline (`1` aktif, `0` tidak aktif) sebagai keadaan statis setelah
  animation dan sebagai fallback reduced-motion.

Kedua animation memakai `both`, sehingga tidak perlu timeout untuk membersihkan layer. Ketika pose
lama aktif lagi, perubahan shorthand dari exit ke enter memulai ulang sequence CSS-nya.

## Hover, klik, dan panel ringkasan

**Hover.** Selector hanya berlaku bila stage tidak reduced-motion. `pet-reactor` naik dan membesar
sedikit memakai transition `transform var(--dur-base) var(--ease-out)`. Tidak ada pelacakan posisi
pointer; "mendekat" berarti memasuki hit area maskot, sehingga tidak ada listener `pointermove`.

**Klik.** Klik tetap men-toggle panel dan sekaligus memasang animation `hn-pet-click` pada
`pet-reactor`. State boolean dilepas oleh `animationend`, bukan timer. Event difilter menurut
`animationName` agar animation anak yang bubble tidak mematikannya. Klik selama reaksi masih hidup
tidak membuat loop baru; satu reaksi yang sedang berjalan cukup menjadi feedback.

**Panel.** State semantik `open` dipisahkan dari `panelMounted`:

1. buka → mount dan jalankan `hn-pet-panel-in`;
2. tutup/Escape/klik luar → `open=false`, panel tetap mounted untuk `hn-pet-panel-out`;
3. `animationend` panel-out → unmount;
4. saat reduced-motion, tutup langsung unmount karena tidak akan ada `animationend`.

Selama animation keluar, panel `aria-hidden`, inert, dan `pointer-events: none`, sehingga tidak
meninggalkan kontrol yang dapat difokuskan di dalam bagian yang secara semantik sudah tertutup.
Animasi panel hanya opacity + `translateY`/scale; ukuran kartu dan alur flex tidak dianimasikan.

## Sembunyikan dan panggil kembali

Persistensi `hanoman.pet.hidden` dan handle buntut 28 px tidak berubah. Ketika handle ditekan,
branch pet di-mount kembali dan `pet-stage` menjalankan `hn-pet-reveal` (opacity + translate/scale).
Animation ini juga memberi entrance lembut pada mount pertama, tetapi tidak berulang saat pose atau
halaman berubah karena `HanomanPet` tetap dipasang sekali di `App`.

Menyembunyikan pet menutup serta melepas panel lebih dulu. Tidak ada exit pet yang menunda
penyimpanan preferensi; outcome hanya meminta kemunculan kembali tidak menjentik.

## Reduced motion

`usePrefersReducedMotion()` tetap sumber tunggal. Saat `true`:

- `pet-stage`, `pet-reactor`, `pet-idle`, setiap pose image, dan panel menulis `animation: none`
  secara inline;
- transition reactor dan pose menulis `transition: none` secara inline;
- selector hover dikecualikan lewat atribut `data-reduced-motion="true"`;
- klik tidak memasang state reaksi;
- panel keluar dilepas sinkron, bukan menunggu event yang tidak akan terjadi;
- pose aktif tetap opacity `1`, pose lain `0`, alt/role/status/tombol tetap sama.

Ini mematikan seluruh gerak, bukan memperlambatnya. Ketiadaan `matchMedia` tetap dibaca sebagai
`false`, mempertahankan kontrak jsdom SPEC-585.

## Aksesibilitas dan containment

- Struktur `role="status"` → gambar + tombol overlay tidak berubah.
- Hanya pose aktif yang mempunyai alt bermakna; layer lama tetap `decorative`/`aria-hidden`.
- Hit area, label tombol, `title`, Escape, klik-luar, dan callback `onOpen` tetap bekerja.
- Root tetap `pointer-events: none`; hanya handle, tombol overlay, dan panel yang `auto`.
- z-index root tetap 80 dan ukuran stage tetap 76 px, sehingga animasi tidak mengubah layout atau
  menutupi kontrol dashboard.

## Pengujian

### Unit murni — `src/test/pet-motion.test.ts`

- tabel tujuh pose → tujuh motion/keyframe yang tepat;
- semua identity idle unik;
- `shipped` mengandung flourish satu kali lalu idle shipped tertunda;
- semua shorthand memakai token `--dur-*` dan `--ease-*`, bukan durasi literal.

### Render — `src/test/hanoman-pet.test.tsx`

- render pose `working` memilih animation `working`, bukan `ready`;
- perubahan pose memberi pose baru animation masuk dan pose lama animation keluar, bukan
  `transition: opacity`;
- hover contract hadir pada class/atribut yang benar dan klik memasang reaction one-shot;
- panel memakai animation masuk; tutup memakai animation keluar lalu unmount pada `animationend`;
- unhide me-mount stage dengan animation reveal;
- reduced-motion meng-assert **nilai persis** `animation: none` dan `transition: none` pada setiap
  layer yang dapat bergerak, termasuk panel; tidak memakai asymmetric matcher di `toHaveStyle`;
- test a11y, navigasi, persistensi, dan pointer containment lama tetap hijau.

CSS keyframe juga dimasukkan ke parser CSSOM jsdom dan dijaga sebagai kontrak rule terparse: setiap
frame hanya memuat `transform`/`opacity` dan selector hover mengecualikan reduced-motion. Vitest
memang mengosongkan import CSS, jadi test membaca byte stylesheet nyata lalu menguji hasil
parser—bukan meng-grep teksnya. jsdom tidak menginterpolasi keyframe maupun `:hover`, sehingga
pemeriksaan CSSOM melengkapi test render.

## Berkas yang berubah

| berkas | perubahan |
|---|---|
| `src/src/screens/pet-motion.ts` | katalog presentasi murni pose → motion |
| `src/src/screens/HanomanPet.tsx` | layer compositor, lifecycle klik/panel, reduced-motion |
| `src/src/app.css` | keyframe idle, pose, reaksi, panel, reveal |
| `src/src/ds/tokens/effects.css` | token durasi semantik pet |
| `src/test/pet-motion.test.ts` | unit katalog motion |
| `src/test/hanoman-pet.test.tsx` | render/interaksi/reduced-motion |
| `internal/docs/design-system/design-system.md` | grammar motion dan token |
| `internal/docs/frontend/frontend-implementation.md` | implementasi/lifecycle SPEC-648 |
| `internal/docs/README.md` | deskripsi link SoT yang disentuh |

## Di luar scope

- tidak mengubah `PetPose`, prioritas, headline, target, atau `derivePetState()`;
- tidak menambah pose `STK-007`, aset, dependency, endpoint, skema, poll, atau channel WS;
- tidak melacak pointer berdasarkan jarak dan tidak memakai spring/physics runtime;
- tidak mengubah posisi, ukuran, z-index, atau kontrak hide persistence;
- tidak membuat ADR untuk keputusan presentasi yang tidak mengubah arsitektur.
