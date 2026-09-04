# ADR-0071 — Link ticket triase: deep-link backlog (hash SPA) + token bagikan status publik

- Status: Accepted — **bagian 1 diamandemen [0160](0160-navigasi-dashboard-router-url.md)** (2026-09-05): URL kanonik backlog kini `/backlog/<id>` (router); hash `#spec=` tetap dibaca saat mount lalu dialihkan. Bagian 2–3 tak berubah.
- Tanggal: 2026-07-22
- SPEC: 293
- Terkait: **memperluas 0062** (Help Center tiket publik + triase→backlog), 0018/0019 (nilai
  turunan), 0044 (kunci opaque hash-at-rest), 0066 (tiket masuk record-sync).

## Konteks

Detail triase (dashboard) menampilkan tautan backlog sebagai **badge statis** `→ <specId>`
tanpa aksi. Tiga kebutuhan muncul (SPEC-293, keputusan manusia 2026-07-22):

1. Buka backlog tertaut di tab baru + salin link-nya.
2. Status "sudah selesai dikerjakan?" turunan otomatis dari stage backlog, tampil di dashboard.
3. Link **publik** status tiket yang bisa dibagikan operator ke pelapor.

Kendala: SPA hanoman **tak punya routing URL** (section = React state). Kunci akses tiket
disimpan **hash-at-rest** (ADR-0044) → dashboard tak bisa merekonstruksi URL status publik.

## Keputusan

### 1. Deep-link backlog lewat hash fragment (bukan router penuh)
URL kanonik satu backlog = `${origin}${pathname}#spec=<SPEC-ID>`. `App` mem-parse
`location.hash` **saat mount**: `#spec=<id>` → `section="backlog"` + buka `SpecDetail` item itu,
lalu hash dibersihkan. Buka-di-tab-baru = `window.open(url)` (mount segar membaca hash). Alasan
hash (bukan path router): additive, nol perubahan server (SPA sudah di-serve untuk semua non-/api),
tak menyentuh 6 section lain. Ini **bukan** sistem routing umum — sengaja satu kapabilitas sempit.

### 2. `publicStatus` jadi satu sumber kebenaran di `shared`
Fungsi `publicStatus(ticketStatus, specStage)` dipindah ke `shared/src/ticket-status.ts` agar
server (`ticket.ts`, `help.ts`) dan klien (badge dashboard) memakai pemetaan yang sama —
menghindari status kembar yang bisa basi (ADR-0018/0019).

### 3. `Ticket.shareToken` — token opaque yang bisa dibagikan
Kolom baru `shareToken String? @unique` (opaque `hnm_shr_…`), **terpisah** dari
`accessKeyHash` pelapor. Di-generate saat `createTicket` (tiket baru) dan **di-backfill lazily**
saat `GET /tickets/:id` untuk tiket lama (idempoten; tanpa `notifySynced` → tak menambah entri
feed sync; bump `updatedAt` sekali-per-tiket dapat diterima). Route publik
`GET /api/help/:slug/tickets/:key` mencocokkan `accessKeyHash: hash(key)` **ATAU**
`shareToken: key` (kunci asli pelapor tetap valid). `GET /tickets/:id` mengembalikan
`publicStatusUrl` absolut untuk tombol dashboard.

Kenapa token baru, bukan menyimpan plaintext kunci pelapor: menjaga postur hash-at-rest kunci
asli tetap utuh; token bagikan adalah kapabilitas eksplisit milik operator, data yang diekspos
(judul + status turunan) berrisiko rendah dan memang sudah dipegang pelapor via email.

## Konsekuensi

- Migration **additif** (`shareToken` nullable) — aman untuk semua node (VPS hub live).
- Route publik menerima dua bentuk kunci; keduanya scoped ke `slug` (isolasi tetap).
- Tak ada router SPA umum yang diperkenalkan — hanya hook hash `#spec=` sekali-mount. Bila kelak
  butuh deep-link section lain, generalisasikan lewat ADR terpisah.
- `publicStatus` kini di `shared`; perubahan wording status wajib satu tempat.
</content>
