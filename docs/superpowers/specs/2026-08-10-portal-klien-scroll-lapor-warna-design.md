# SPEC-626 — Portal klien: scroll, kirim tiket dari portal, warna badge sesuai status

- Tanggal: 2026-08-10
- Backlog: SPEC-626 (source `brief`, prioritas tinggi)
- Melanjutkan: SPEC-617 · ADR-0110 (portal klien read-only, terbit di 0.1.24)

## Masalah

Tiga celah terpisah di permukaan yang sama, dengan satu benang merah: portal lahir sebagai
**pembaca**, dan tiap celahnya adalah konsekuensi dari asumsi itu.

1. **Scroll mati.** `src/src/app.css:5` menetapkan `#root { height: 100vh; overflow: hidden }` —
   benar untuk `Shell` operator yang mengelola scroll di panel dalamnya. `ClientPortal` sengaja
   TIDAK memakai `Shell` (fork di `App.tsx:1109`) dan pembungkusnya hanya `minHeight: 100%`
   (`ClientPortal.tsx:52`), jadi **tak satu pun** kontainer di portal bisa digulir. Begitu daftar
   lebih tinggi dari viewport, barisnya tak terjangkau sama sekali.
2. **Klien tak bisa melapor dari portal.** Satu-satunya jalur bikin tiket hari ini adalah halaman
   Help Center **publik** (`POST /api/help/:slug/tickets`) — multipart, honeypot `hc_trap`,
   rate-limit per IP, email diketik manual, digerbangi `project.helpEnabled`. Klien yang sudah
   login harus keluar dari portal dan mencari URL publik itu untuk mengeluh.
3. **Warna badge tiket seragam.** Badge tiket memakai `status="idle"` **hardcode** di dua tempat
   (`ClientPortal.tsx:122` baris daftar, `:157` modal detail) sementara teksnya `{t.status}` ikut
   berubah. Tiket `new`/`accepted`/`rejected` semuanya tampil abu-abu `--bone-200`/`--ink-500` yang
   sama: warnanya berbohong, cuma hurufnya yang jujur.

## Temuan yang mengubah bentuk solusi

**Yang dilihat klien bukan `new`/`accepted`/`rejected`.** `toPortalTicket()`
(`shared/src/portal.ts:47`) sudah memetakan status lewat `publicStatus()` (SPEC-293) sebelum
mengirimnya, jadi field `status` yang sampai ke `ClientPortal` berisi **kosakata klien**:

| status DB | stage spec tertaut | `publicStatus()` |
|---|---|---|
| `rejected` | — | `Ditutup` |
| `new` (atau apa pun selain accepted/rejected) | — | `Sedang ditinjau` |
| `accepted` | `done` | `Selesai` |
| `accepted` | `executing` | `Sedang dikerjakan` |
| `accepted` | lainnya/null | `Diterima` |

Konsekuensi: fungsi pemetaan warna harus berdomain **kosakata publik**, bukan status DB. Ia tetap
memenuhi syarat "tiap status tiket punya warna berbeda" karena pemetaannya injektif terhadap
ketiga status DB itu.

**Modal ternyata SUDAH bisa digulir.** `Modal` (`src/src/ds/kit.tsx:42`) memberi panelnya
`maxHeight: 88vh` + kolom flex, dan `modal-body` sudah `overflow: auto`. Overlay-nya
`position: fixed` sehingga `#root { overflow: hidden }` tak mengklipnya (`#root` tak membuat
containing block: tanpa `transform`/`filter`/`contain`). Jadi celah (1) hanya menyangkut badan
halaman. Yang perlu ditambah bukan perbaikan melainkan **pagar**: test yang mengunci scroller modal
supaya tak hilang diam-diam.

## Keputusan desain

### A. Scroll: portal punya rantai gulirnya sendiri, tanpa menyentuh operator

`ClientPortal` root jadi kolom flex setinggi viewport; header `FIXED_ROW_STYLE`; `<main>` memakai
`LIST_SCROLL_STYLE` — **konstanta design-system yang sudah dipakai layar operator**
(`src/src/ds/kit.tsx:142-144`), bukan angka baru:

```
<div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>   ← root portal
  <header style={FIXED_ROW_STYLE}>                                                          ← tetap terbaca
  <main style={LIST_SCROLL_STYLE}>                                                          ← yang menggulir
     <div style={{ maxWidth: var(--content-max), margin: "0 auto", padding }}>              ← lebar isi
```

`height: 100%` (bukan `100vh`) mengikuti idiom `Shell` (`ds/shell.tsx:86`). Perubahannya
seluruhnya di dalam `ClientPortal.tsx`; `app.css` dan `Shell` tak disentuh, jadi perilaku scroll
dashboard operator mustahil bergeser.

Header di LUAR scroller adalah keputusan, bukan efek samping: itulah yang membuat "header tetap
terbaca" saat daftar digulir.

**Alternatif yang ditolak:** melonggarkan `#root { overflow: hidden }` (mis. `overflow: auto`
global). Nol baris di portal, tapi mengubah kontrak scroll SETIAP layar operator sekaligus — persis
yang dilarang objective.

### B. Jalur tulis: SATU route, `POST /api/portal/projects/:id/tickets`

- **Allowlist dibuka setepat mungkin.** `clientRouteAllowed` tak berubah jadi "portal boleh tulis";
  ia menerima **satu bentuk path**: `POST` + segmen persis `portal/projects/<id>/tickets`.
  `POST …/backlog`, `PATCH …/tickets`, `POST …/tickets/<id>` semuanya tetap ditolak.
- **Satu pipeline, dua pintu.** Badan submit `help.ts` diangkat jadi service
  `services/ticket-intake.ts`: `parseTicketUpload(req)` (multipart → field + berkas, menegakkan
  ≤3 berkas / ≤5 MB / `image/png|jpeg|webp`, yang ditolak di-**skip** bukan membatalkan) dan
  `intakeTicket(...)` (createTicket → `notifySynced("ticket")` → lampiran (`saveUpload` +
  `notifySynced("ticketAttachment")`) → `recordNewTicket` → `pruneOldTickets`). `help.ts` dan
  `portal.ts` memanggil fungsi yang sama, jadi tiket dari kedua jalur **identik secara konstruksi**
  — bukan identik karena dua salinan kebetulan sepakat (kelas bug SPEC-431/448/475).
  Urutan INDUK-dulu-baru-ANAK (SPEC-382) ikut pindah utuh ke service.
- **Scope project** ditegakkan `hasProjectAccess()`; gagal → **404 generik** yang sama dengan route
  portal lain (bukan 403), supaya portal tak jadi alat enumerasi nama project.
- **`helpEnabled` TIDAK berlaku untuk jalur portal** (keputusan eksplisit yang diminta constraint).
  `helpEnabled` menjawab "boleh-kah orang asing tanpa login mengirim keluhan ke project ini" —
  pertanyaan tentang permukaan anonim. Klien portal sudah lewat dua gerbang yang lebih kuat: akun
  ber-password dan baris `ClientProjectAccess` yang diberikan operator satu per satu. Menyandera
  jalur itu pada knob publik berarti mematikan Help Center publik ikut membungkam klien yang
  memang sengaja diundang — konsekuensi yang tak diinginkan siapa pun. Dicatat di ADR + dipagari
  test (`helpEnabled: false` → portal tetap 201, publik tetap 404).
- **Honeypot dicabut untuk jalur ini** (tak ada bot ber-sesi login); **rate-limit tetap ada, per
  AKUN**: `portalTicketRateOk(userId, projectId)` di `help-ratelimit.ts` — bucket akun (default
  5/menit, `HANOMAN_PORTAL_TICKET_RATE_PER_MIN`) memakai `take()` yang sama, lalu bucket
  **per-project yang sama** dengan jalur publik, dengan short-circuit SPEC-352 dipertahankan
  (bucket project hanya dikuras kalau bucket akun lolos).
- **Email pelapor = `req.user!.email`**, tak pernah dari body.
- **Respons `201` = proyeksi `toPortalTicket`** — allowlist field yang sama dengan route baca, jadi
  `accessKeyHash`/`reporterEmail`/`shareToken` mustahil ikut. Kunci opaque pelapor **tidak**
  dikembalikan: klien memantau tiketnya di portal, bukan lewat link status publik.

**Alternatif yang ditolak:** menyuruh portal memanggil `POST /api/help/:slug/tickets` yang sudah
ada (allowlist memang sudah mengizinkannya). Nol route baru — tapi email jadi ketikan manual lagi,
`helpEnabled` tetap menyandera, rate-limit tetap per-IP, dan tiket dari klien terautentikasi tak
terbedakan dari kiriman anonim. Otentikasi yang sudah dipegang portal terbuang.

### C. Warna: dua fungsi murni di satu berkas, dipakai baris DAN modal

Berkas baru `src/src/portal/status-pill.ts` (murni, tanpa React, bisa dites langsung):

```ts
export function stagePill(stage: string): string      // stage backlog  → status StatusPill
export function ticketPill(publicStatus: string): string  // kosakata klien → status StatusPill
```

Keduanya **tabel + `?? "idle"`** — total secara konstruksi: nilai tak dikenal mendarat di `idle`
yang netral, bukan crash dan bukan warna yang menyesatkan.

| yang dilihat klien | status `StatusPill` | warna | alasan |
|---|---|---|---|
| `Sedang ditinjau` (`new`) | `queued` | wind | masuk antrean, belum ditriase |
| `Diterima` (`accepted`, belum jalan) | `awaiting` | amber (berdenyut) | diterima, menunggu giliran kerja |
| `Sedang dikerjakan` (`accepted` + `executing`) | `running` | brass (berdenyut) | sesi berjalan |
| `Selesai` (`accepted` + `done`) | `done` | leaf | tuntas |
| `Ditutup` (`rejected`) | `failed` | clay | tidak dilanjutkan |

Ketiga status DB karena itu berujung di tiga hue berbeda (wind · amber/brass/leaf · clay).

| stage backlog | label (sudah ada) | status `StatusPill` |
|---|---|---|
| `brainstorming`, `objective` | Dirumuskan | `queued` |
| `spec-ready` | Disiapkan | `queued` |
| `planned` | Direncanakan | `queued` |
| `executing` | Sedang dikerjakan | `running` |
| `done` | Selesai | `done` |
| *tak dikenal* | (labelnya sendiri) | `idle` |

`stageStatus()` lama sudah benar untuk keenam stage `zStage`, tapi **salah untuk yang tak dikenal**:
`else → "queued"` mewarnai stage asing sebagai "antre" — warna yang percaya diri tentang keadaan
yang tak diketahui. Tabel + `idle` membalikkan arah kegagalannya.

Nol warna baru ditambahkan; nol warna literal di `ClientPortal`. Kosakata teks tetap `STAGE_LABEL`
& `publicStatus` (SPEC-293).

### D. UI form di portal

Tombol **"Kirim keluhan"** di baris tab (terlihat dari kedua tab, bukan hanya Help desk) membuka
`Modal` berisi: **Project** (`Select`, isinya persis project yang boleh diakses, default = project
aktif) · **Kategori** (`Select`, dari `zTicketCategory.options`) · **Judul** · **Detail**
(`HnTextarea`) · **Lampiran gambar** (opsional, maks 3). Idiom form mengikuti `ChangeSourceDialog`
(`Field` + `Select` + `HnTextarea` + tombol di kanan bawah).

Sesudah 201: modal tertutup, tab pindah ke **Help desk**, daftar tiket **dimuat ulang** dari server
untuk project yang dikirimi (kalau berbeda dari yang aktif, project aktif ikut berpindah) — jadi
tiket baru langsung terlihat tanpa menebak bentuk barisnya di klien.

## Test (semuanya wajib merah sebelum fix)

| Apa | Di mana | Merah sebelum fix karena |
|---|---|---|
| Rantai gulir portal utuh & header di luar scroller | `src/test/portal-scroll.test.tsx` | hari ini **tak ada satu pun** leluhur ber-`overflow: auto/scroll` antara daftar dan root |
| Badan modal portal bisa digulir | idem | pagar (hijau hari ini — dicatat sebagai kontrak, bukan klaim perbaikan) |
| `ticketPill`/`stagePill` — tiap kosakata publik & tiap stage, plus yang tak dikenal → `idle` | `src/test/portal-status-pill.test.ts` | fungsinya belum ada |
| Kontrak: `publicStatus()` atas seluruh silang status×stage selalu punya pemetaan (tak pernah jatuh ke `idle`) | idem | idem — mengikat pemetaan ke SUMBER kosakatanya, bukan ke daftar hafalan |
| Baris daftar & modal memakai pill yang sama untuk tiket yang sama | `src/test/client-portal.test.tsx` | keduanya `idle` hardcode |
| `POST /portal/projects/:id/tickets` membuat tiket + notifikasi + feed sync | `server/test/portal-ticket.route.test.ts` | route belum ada |
| Project bukan haknya → 404 generik, nol tiket tercipta | idem | idem |
| Akun klien tanpa akses tak bisa menembus lewat id project | idem | idem |
| `helpEnabled: false` → portal 201, publik 404 | idem | idem |
| Rate-limit per akun (bukan per IP) | `server/test/help-ratelimit.test.ts` | fungsinya belum ada |
| Allowlist: hanya `POST …/projects/:id/tickets`; bentuk tulis lain tetap ditolak | `server/test/client-route-allowed.test.ts` | allowlist menolak semua tulis |
| `help.ts` tak berubah perilakunya sesudah refactor | `server/test/help.test.ts` (sudah ada) | jaring pengaman refactor |

## Docs yang tersentuh (commit yang sama)

- **ADR baru** — jalur tulis pertama di permukaan klien: amandemen ADR-0110 (satu route, bentuk
  path eksplisit), keputusan `helpEnabled`, rate-limit per akun, satu pipeline intake.
- `internal/docs/adr/0110-portal-klien-read-only.md` — tanda "diamandemen oleh" + koreksi kalimat
  "tak ada aksi tulis".
- `internal/docs/README.md` **dan** `internal/docs/adr/README.md` — entri ADR baru.
- `internal/docs/architecture/api-contract.md` — endpoint baru.
- `internal/docs/frontend/frontend-implementation.md` — tabel pemetaan status → `StatusPill` portal
  + rantai gulir portal.

## Yang sengaja TIDAK dikerjakan

- Halaman Help Center publik tak disentuh perilakunya (hanya kode intake-nya yang pindah berkas).
- Tak ada endpoint portal baru selain satu route tulis itu.
- Tak ada warna/token design-system baru.
- Klien tetap tak bisa membalas, menutup, atau mengubah tiket — portal tetap baca-saja selain
  satu pintu kirim ini.
