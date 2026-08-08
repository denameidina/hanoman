# Pet Hanoman di dashboard — cermin hidup status sesi (SPEC-585)

Tanggal: 2026-08-08 · Sumber: brief SPEC-585 · Prioritas: sedang

## Masalah

Status sesi hari ini hanya terbaca sebagai teks dan lencana kecil. Sinyal yang paling sering
dibutuhkan operator — *"lagi jalan apa nggak, butuh saya apa nggak"* — adalah sinyal **sekilas**,
dan sekilas bukan yang dilayani angka. hanoman sudah punya maskot dengan delapan pose resmi dan
sudah punya semua datanya; yang belum ada adalah yang menyatukan keduanya.

## Hasil yang dituju

Satu widget "Pet Hanoman" yang selalu hadir di sudut dashboard, pose-nya cermin keadaan sesi &
backlog nyata, dan bisa ditanya "kenapa kamu begitu" dengan satu klik.

## Keputusan yang mengikat

### 1. Aset: pakai katalog yang sudah ada, jangan salin

`src/src/ds/illustration-registry.ts` **sudah** mendaftarkan kedelapan pose sticker sebagai
`STK-001…008` (family `sticker`), dan glob-nya **eager** atas seluruh `internal/assets/illustration/web/`.
Konsekuensi terukur: kedelapan turunan web (39–55 KB, maks 768 px, q78) **sudah ikut ke
`src/dist/assets` dan ke tarball npm hari ini**, dipakai atau tidak. Memakainya untuk pet karena itu
menambah **0 byte** ke paket.

Brief menyebut `internal/assets/illustration/whatsapp/text-free/*.webp`. Berkas itu adalah **turunan
512 px dari master yang sama** (commit `e4e0d27`, dirakit `internal/scripts/export-whatsapp-stickers.py`),
bukan sumber terpisah. Menyalinnya ke lokasi aset frontend berarti menaruh ~250 KB salinan kedua di
samping turunan yang sudah ada — persis yang dilarang constraint. Jadi: **pet memanggil ID katalog**,
tak pernah filename, sesuai aturan `frontend-implementation.md` ("raw filename di luar registry adalah
drift bug").

| pose brief | ID katalog | file turunan web |
|---|---|---|
| `hanoman-ready` | `STK-001` | `hnm-ill-sticker-ready-1x1-master-v01.webp` |
| `hanoman-working` | `STK-002` | `hnm-ill-sticker-working-1x1-master-v01.webp` |
| `hanoman-waiting` | `STK-003` | `hnm-ill-sticker-waiting-1x1-master-v01.webp` |
| `hanoman-blocked` | `STK-004` | `hnm-ill-sticker-blocked-1x1-master-v01.webp` |
| `hanoman-shipped` | `STK-005` | `hnm-ill-sticker-shipped-1x1-master-v01.webp` |
| `hanoman-review` | `STK-006` | `hnm-ill-sticker-review-1x1-master-v01.webp` |
| `hanoman-docs-updated` | `STK-008` | `hnm-ill-sticker-docs-updated-1x1-master-v01.webp` |

`STK-007` (`thanks`) **sengaja tak dipakai**: ia ungkapan terima kasih, bukan keadaan mesin. Katalog
boleh lebih besar dari pet.

### 2. Tempat mount: satu kali di `App`, bukan di dalam `Shell`

`App.tsx` punya **satu** titik return; `{screen}` (hasil cabang `section === …`) dirender di sana
bersama modal-modalnya. Pet dipasang sebagai saudara `{screen}` di dalam `NotificationsProvider`.

Alasannya menentukan, bukan selera:

- **Tidak pernah remount saat pindah halaman.** `<Shell>` ditulis ulang di tiap cabang `section`;
  memasang pet di dalamnya membuat ia lahir kembali tiap navigasi — animasi idle mulai dari nol dan
  keadaan transient (`shipped`) hilang persis saat operator pindah layar untuk melihat hasilnya.
- **Akses langsung ke sumber datanya.** `sessions`, `backlog`, `setSection`, `setFocusSession`,
  `setProjectFilter` semuanya hidup di `App`. Dari dalam `Shell` semua itu harus dijahit lewat prop
  baru di **sembilan** call site.
- Pet adalah overlay `position: fixed`, jadi ia tak butuh berada di dalam tata letak `Shell`.

Penempatan: sudut **kanan-bawah**, `z-index: 80` — di bawah header (90), overlay terminal fullscreen
(100), Modal (150), dan Toast (200), sehingga secara struktural tak bisa menutupi kontrol mana pun.
Toast duduk di **tengah**-bawah, jadi tak bertabrakan. Pembungkusnya `pointer-events: none`,
tombolnya sendiri `pointer-events: auto` — area kosong di sekitar pet tetap milik konten di bawahnya.

### 3. Sumber kebenaran: yang sudah didorong WS siar, tanpa endpoint & tanpa poll baru

Ketiganya sudah ada di `App` dan sudah didorong `GET /events/ws` (ADR-0039):

| sumber | dari | dipakai untuk |
|---|---|---|
| `sessions: TerminalSession[]` | frame `sessions` | `exited`, `exitCode`, `decision`, `deciding`, `specId` |
| `backlog: Spec[]` | frame `specs` | `stage`, `blockedBy`, `source`, `title` |
| `useNotifications().items` | frame `notifications` | `type` + `createdAt` untuk keadaan transient |

Tak ada channel baru, tak ada `setInterval`, tak ada kenaikan frekuensi. Pet ikut denyut yang sudah
berjalan.

**Kosakata sesi disalin persis dari `TerminalScreen`** (`awaiting = !exited && decision`,
`deciding` menang atas `awaiting`, `failed = exited && !!exitCode`). Pet yang memakai rumus berbeda
akan mengatakan hal yang berlawanan dengan sel Terminal di layar yang sama.

### 4. Tujuh keadaan, satu urutan prioritas total

Fungsi murni `derivePetState({ sessions, backlog, notifications, now })` mengembalikan
`{ pose, headline, detail, action, transientUntil }`. Kandidat dievaluasi dari atas; yang pertama
menyala menang. Urutan ini **satu-satunya** mekanisme anti-kedip — tak ada timer dwell tambahan.

| # | pose | menyala saat |
|---|---|---|
| 1 | `blocked` | ada sesi **gagal** (`exited && exitCode` bukan 0/undefined) — **atau** tak ada sesi hidup **dan** ada backlog ber-`blockedBy` tak kosong |
| 2 | `waiting` | ada sesi hidup ber-`decision` yang **tidak** sedang dilayani lead (`!deciding`) |
| 3 | `shipped` | notifikasi `done`/`automerge` yang backlog-nya **bukan** `source: "audit"`, masih di dalam window transient |
| 4 | `docs-updated` | notifikasi `done` untuk backlog ber-`source: "audit"`, masih di dalam window transient |
| 5 | `working` | ada sesi hidup yang backlog-nya **belum** `done` |
| 6 | `review` | ada sesi terdaftar yang backlog-nya sudah `stage: "done"`, atau sesi tanpa spec yang keluar dengan sukses |
| 7 | `ready` | lantai — selalu benar |

Empat keputusan di dalam tabel itu yang perlu dijelaskan:

**(a) `blocked` karena dependency digerbangi "tak ada sesi hidup".** `blockedBy` adalah keadaan
normal dan berumur panjang di project yang memakai `dependsOn` (ADR-0093) — 17 spec berantai di
`raciklaba.id`. Kalau ia menyalakan pose peringkat 1 tanpa syarat, pet **terkunci** di `blocked`
selamanya dan tak pernah lagi memberi tahu apa pun. Backlog yang menunggu giliran tidak sedang
meminta apa-apa dari manusia; sesi yang **gagal** meminta. Jadi disjungsi keduanya sengaja tak
setara.

**(b) `waiting` mengecualikan `deciding`.** Sesi yang sedang disusunkan keputusannya oleh
hanoman-lead terlihat identik dengan sesi yang mandek menunggu manusia (diam, marker terisi) —
komentar `TerminalSession.deciding` di `api/client.ts` menyatakannya. Membacanya sebagai "butuh
kamu" adalah alarm palsu.

**(c) Transient menang atas `working`/`review`/`ready`, kalah dari `blocked`/`waiting`.** Kabar baik
yang baru masuk lebih informatif daripada keadaan mapan, tetapi perayaan tak boleh menutupi
permintaan tolong. Window transient **45 detik**, dihitung dari `notification.createdAt`.

**(d) `review` memakai `stage === "done"` sebagai proksi "pekerjaan selesai".** Agen adalah TUI
interaktif: pada jalur sukses pane **tak pernah mati** (SPEC-433), jadi `exited` sendirian adalah
gerbang yang nyaris tak pernah menyala — kelas bug SPEC-475 ("lapis nol kali menyala"). Yang
tersedia global dan memang bergerak adalah `Spec.stage`, yang diturunkan server dari bukti yang
sama (fase terminal + plan terceklist, ADR-0029). Karena itu pula `working` **mengecualikan** sesi
ber-spec `done`: sesi yang panenya hidup di atas backlog yang sudah selesai bukan sedang bekerja,
ia sedang menunggu dilihat.

Keadaan transient tak butuh timer berdenyut: komponen menjadwalkan **satu** `setTimeout` tepat pada
`transientUntil` untuk memicu hitung ulang, lalu tak ada apa-apa lagi.

### 5. Animasi: CSS transform, dimatikan `prefers-reduced-motion`

- **Idle** — satu keyframe `hn-pet-breathe` di `app.css` (skala + geser vertikal halus, ~4,5 dtk,
  `alternate`). Hanya `transform`/`opacity`, jadi ia hidup di compositor dan tak menyentuh main
  thread maupun memicu render React.
- **Transisi pose** — pose yang **pernah muncul** dirender bertumpuk absolut, opasitasnya
  `pose === p ? 1 : 0` dengan `transition: opacity`. Crossfade dikerjakan CSS, nol timer, nol state
  tambahan; dan karena hanya pose yang benar-benar pernah terjadi yang masuk DOM, byte yang diambil
  browser tumbuh mengikuti pemakaian alih-alih memuat kedelapannya di muka.
- **Reduced motion** — dibaca `window.matchMedia("(prefers-reduced-motion: reduce)")` di JS (hook
  yang ikut mendengarkan perubahan), lalu `animation` dan `transition` **tak dipasang sama sekali**.
  Sengaja di JS, bukan `@media` di CSS: gaya di repo ini memang inline (lihat `Toast`), dan hanya
  bentuk ini yang bisa diuji. `matchMedia` yang tak ada (jsdom) dibaca sebagai "tak ada preferensi".

### 6. Interaksi minimal

Pet adalah `<button>`. Klik membuka popover kecil (kartu DS, hairline + `--shadow-lg`):

- **Baris 1** — `headline`: mis. `SPEC-547 · sedang berjalan`, `Menunggu jawabanmu · SPEC-547`,
  `3 backlog siap dikerjakan`.
- **Baris 2** — `detail`: judul backlog + stage, atau hitungan kondisi lain yang ikut menyala.
- **Aksi** — satu tombol ke tempat kejadian: `Buka Terminal` (menyetel `focusSession` ke sesi yang
  dimaksud) atau `Buka Backlog`, lewat callback yang dipasang `App`.
- **Sembunyikan** — tombol kedua.

Escape dan klik di luar menutup popover.

### 7. Sembunyikan yang bertahan: `localStorage`, bukan setting server

Kunci `hanoman.pet.hidden`, mengikuti pola `hanoman.terminal.workspace` (`screens/terminal-workspace.ts`)
— preferensi per-browser, tanpa skema, tanpa endpoint, tanpa round-trip.

Disembunyikan **tidak berarti lenyap**: pet menyusut jadi satu pegangan bundar 28 px ber-`Mark`
buntut, opasitas rendah sampai di-hover. Tanpa itu operator yang menyembunyikannya tak punya jalan
kembali selain membersihkan `localStorage`.

### 8. Aksesibilitas

- Pembungkus `role="status" aria-live="polite"`; `<img>` membawa **alt bermakna** berisi kalimat
  status (`"Hanoman sedang bekerja — SPEC-547"`), bukan `decorative`. Brief memintanya terbaca
  sebagai status, dan alt itulah teks yang dibacakan saat live region berubah. Tak ada teks
  tersembunyi kembar — satu sumber kalimat.
- Pose yang sedang tak tampil `aria-hidden`, supaya live region tak membacakan tujuh kalimat.
- Pembungkus `pointer-events: none` (§2) menutup "menutupi kontrol" secara struktural.
- Tombol duduk di akhir DOM, jadi urutan tab konten tak berubah.

### 9. Tema terang & gelap

Aplikasi hari ini **tak punya tema gelap**: nol `prefers-color-scheme`, nol `data-theme` di seluruh
`src/`; satu-satunya permukaan gelap adalah terminal (`--term-bg`). Yang bisa dan harus dijamin:
aset transparan tanpa latar yang dipanggang, dan chrome pet seluruhnya memakai token semantik
(`--surface-card`, `--border-hair`, `--brass-*`, `--shadow-*`) — tak satu pun warna atau bayangan
literal. Dengan begitu pet benar di bone paper hari ini dan ikut berubah sendiri bila tema gelap
lahir nanti.

## Yang sengaja tidak dikerjakan

- **Tanpa ADR.** Tak ada keputusan arsitektur yang dicabut atau diamandemen: nol perubahan skema,
  nol endpoint, nol mekanisme realtime baru. Pemetaan pose adalah **konvensi design system**, dan
  rumahnya `internal/docs/frontend/frontend-implementation.md` yang memang sudah memuat tabel
  penempatan `PST-*` sejenis.
- **Tanpa `STK-007` (`thanks`)** — bukan keadaan mesin.
- **Tanpa fase sesi di headline.** `ProjectView.session.phase` hanya dimuat sekali saat login
  (state `projects` di `App` tak didorong WS), jadi ia bisa basi berjam-jam. `Spec.stage` didorong
  live dan menjawab pertanyaan yang sama.
- **Tanpa deep-link pose per project.** Pet berskop workspace; ia tak mengikuti `projectFilter`,
  karena ia hadir di semua halaman termasuk yang tak punya filter.

## Struktur & pengujian

| berkas | isi |
|---|---|
| `src/src/screens/pet-state.ts` | murni: `PetPose`, `POSE_ART`, `derivePetState`, `PET_TRANSIENT_MS` |
| `src/src/screens/HanomanPet.tsx` | render, popover, `localStorage`, reduced-motion, timeout transient |
| `src/src/app.css` | `@keyframes hn-pet-breathe` |
| `src/src/App.tsx` | mount tunggal + callback navigasi |

- `src/test/pet-state.test.ts` — tiap pose, **tabel prioritas saat bertabrakan**, peluruhan
  transient, gerbang dependency-blocked, `deciding` menekan `waiting`, `working` vs `review`,
  lantai `ready`.
- `src/test/hanoman-pet.test.tsx` — pose dasar merender ID katalog yang benar, alt bermakna +
  `role="status"`, reduced-motion menghilangkan `animation`/`transition`, toggle sembunyikan
  bertahan lintas remount, popover memuat headline & aksi.

Keduanya murni frontend (tanpa DB), dijalankan dengan `env -u NODE_ENV` (prod bikin RTL `act` gagal).

## Docs yang tersentuh

- `internal/docs/frontend/frontend-implementation.md` — subseksi "Pet Hanoman": tabel status → pose,
  urutan prioritas, sumber data, penempatan, a11y, persistensi.
- `internal/docs/design-system/design-system.md` — bagian "Ilustrasi produk" kini mencatat family
  `sticker` sebagai family yang **ditempatkan**, bukan sekadar terdaftar.
- `internal/docs/README.md` — keduanya sudah ter-link; index diperiksa tetap utuh.
