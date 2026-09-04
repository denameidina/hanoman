# ADR-0160 — Navigasi dashboard lewat URL (react-router) + layar dimuat malas

- Status: Accepted
- Tanggal: 2026-09-05
- SPEC: audit menyeluruh 2026-09-05 (tanpa nomor SPEC; keputusan manusia langsung di sesi)
- Terkait: **mengamandemen [0115](0115-state-tampilan-dashboard-persisten.md)** (alternatif "router +
  query string" yang dulu ditolak kini diterima atas permintaan pengguna; janji "halaman terakhir
  dipulihkan" tetap ditegakkan) dan **[0071](0071-link-ticket-triase-deeplink-sharetoken.md)** (hash
  `#spec=`/`#changelog=` bukan lagi bentuk kanonik, tetapi tetap dibaca); menegakkan 0039/0145 (tak ada
  perubahan transport data), 0110 (portal klien tetap di luar router), 0117 (ingress: path baru hanya
  hidup di host control, host publik tetap cuma `/help/*`).

## Konteks

Sejak lahir, dashboard berpindah halaman lewat state `section` di `App.tsx` (`HN_NAV` di
`ds/shell.tsx`). Konsekuensinya nyata: tombol Kembali/Maju browser tak berbuat apa-apa, tak ada URL
yang bisa dibagikan untuk sebuah halaman, dan deep-link harus diakali lewat hash fragment yang
di-parse sekali saat mount (ADR-0071). ADR-0115 menambal separuhnya (halaman terakhir dipulihkan dari
storage) dan **menolak** router "eksplisit oleh pengguna untuk backlog ini". Pada audit 2026-09-05
pengguna meminta sebaliknya: "buat project ini menggunakan router".

Audit yang sama mengukur bundle web: **satu chunk 3,8 MB (935 KB gzip)**, nol `React.lazy`. xterm,
highlight.js (seluruh bahasa), marked, git graph, VPS, dan Settings 98 KB diunduh hanya untuk membuka
Overview.

## Keputusan

### 1. URL adalah state navigasi

`react-router-dom` v7 (`BrowserRouter`) dipasang **di dalam `App`** (`App` = `<BrowserRouter><AppInner/>`),
bukan di `main.tsx`: sebelas berkas test me-mount `<App />` telanjang, dan `/help/*`
(`PublicHelpApp`) memang hidup di luar router dashboard. `section` **diturunkan** dari `pathname`
lewat modul murni `src/src/routes.ts` (`parseRoute`/`routePath`, dikunci `routes.test.ts`):

| path | section | catatan |
|---|---|---|
| `/<key>` | key `HN_NAV` | `/backlog`, `/settings`, … |
| `/projects/<projectId>` | `project` (transien) | id ikut di URL → refresh mendarat di project yang sama |
| `/backlog/<specId>` | `backlog` + SpecDetail terbuka | pengganti `#spec=<id>` |
| `/changelog/<projectId>[/<clId>]` | `changelog` | pengganti `#changelog=<p>[&cl=<id>]` |
| `/review/<spec\|session>/<id>` | `review` (transien) | judul dicari dari backlog, jatuh ke id |
| `/` atau path tak dikenal | — | dialihkan (`replace`) ke halaman terakhir yang tersimpan |

Semua `setSection(key)` di App kini `navigate(routePath({section:key}))`; `Shell`'s `onNavigate`
tak berubah bentuk. Klik sidebar = pushState, tombol Kembali browser = kembali ke halaman sebelumnya.

### 2. ADR-0115 tetap ditegakkan, bukan dicabut

`app.section` masih ditulis ke storage setiap rute `HN_NAV` dibuka, dan **hanya dibaca saat URL tak
menunjuk halaman** (`/`, bookmark lama, key mati `runs`/`triggers`). Jadi tab baru tetap mendarat di
halaman terakhir, sementara refresh di `/backlog` tinggal di `/backlog` — dua janji yang dulu
dianggap saling meniadakan. Seluruh state tampilan lain (filter, halaman, scroll) tak tersentuh:
mereka berkunci per layar, bukan per URL.

### 3. Hash lama dialihkan, bukan sekadar dibaca

Efek mount membaca `#spec=` / `#changelog=` lalu `navigate(..., {replace:true})` ke path barunya —
link yang sudah beredar di email tiket dan Telegram tetap membuka layar yang benar, dan URL yang
terlihat pengguna langsung bentuk kanonik. Builder `specDeepLink`/`changelogDeepLink` di
`screens/deeplink.ts` kini memancarkan path (`absoluteRouteUrl`), parser hash-nya tetap ada.

### 4. Layar dimuat malas

Dua belas layar (`Dalang`, `Tim`, `Triase`, `Terminal`, `IDE`, `VPS`, `Scheduler`, `Lead`, `Docs`,
`Changelog`, `Review`, `Settings`) menjadi `React.lazy` dengan Suspense di `gate()`; Overview,
Projects, Backlog, dan PRD tetap eager (jalur pertama tiap sesi; `PrdScreen` berbagi modul dengan
`NewPrdModal` yang dipakai App). Vendor yang jarang berubah dipisah `manualChunks` (react,
xterm, highlight, markdown) supaya cache browser bertahan lintas rilis hanoman, dan highlight.js
dipangkas ke `lib/core` + bahasa yang memang dipetakan `langOf`.

## Alternatif yang ditolak

- **Router di `main.tsx` membungkus segalanya.** Memaksa sebelas test App membungkus `<MemoryRouter>`
  sendiri dan menyeret `/help/*` ke dalam router yang tak ia butuhkan.
- **Route object tree (`createBrowserRouter` + `<Outlet>`) dengan satu komponen per halaman.**
  Bentuk yang lebih "idiomatis", tetapi menulis ulang 1.500 baris `App.tsx` yang cabang
  `section === …`-nya juga dijaga test kontrak (`changelog-nav.test.tsx`). Pemetaan path ⇄ section
  memberi 100 % manfaat pengguna dengan diff yang bisa di-review; migrasi ke route tree bisa
  menyusul per layar.
- **Hash router (`/#/backlog`).** Menghindari fallback server, tetapi fallback itu sudah ada sejak
  SPEC-253 (`setNotFoundHandler` → `index.html`, Vite `historyApiFallback`), dan URL ber-hash tak
  bisa diberi `Content-Security-Policy`/ingress per path.

## Konsekuensi & gotcha

- **URL kini state bersama antar-test**: vitest memakai satu jsdom per berkas, jadi test yang
  mendarat di `/backlog/SPEC-1` mewariskan path itu ke test berikutnya. `src/test/setup.ts`
  me-`replaceState` ke `/` sebelum tiap test — cermin `localStorage.clear()` ADR-0115.
- Path baru **tak butuh perubahan server**: semua non-`/api` sudah dijawab `index.html`. Host publik
  (ADR-0117) tetap hanya mengizinkan `/help/*`; `/backlog` di host publik = `denied`, sebagaimana
  sebelumnya `/` di sana.
- `review` di URL tanpa `title`: refresh di `/review/session/<id>` menampilkan id sebagai judul.
  Diterima — judul sesi tak punya sumber selain state yang memang hilang saat refresh.
- Layar malas yang chunk-nya gagal diunduh (deploy baru di tengah sesi, SPEC-868) melempar di
  Suspense; `ReloadBadge` yang sudah ada adalah penawarnya. Tak ada error boundary khusus di sini —
  `StateBlock` "Memuat halaman…" adalah satu-satunya fallback.
- Test App yang membuka layar malas harus memakai `findBy*`/`waitFor`, bukan `getBy*` langsung
  sesudah klik — sebelum ini layar dirender sinkron.
