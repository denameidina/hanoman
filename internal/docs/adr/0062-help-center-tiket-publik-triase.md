# ADR-0062 — Help Center: model tiket + endpoint publik ber-scope-project + jembatan triase→backlog

**Status:** accepted · **Tanggal:** 2026-07-20 · **Spec:** SPEC-253
**Amandemen:** SPEC-352 (2026-07-28) — keputusan honeypot **tidak** dibalik, tapi field-nya berganti
nama `hp` → `hc_trap` (+ `autocomplete="new-password"`) karena `hp` diisi autofill browser untuk
pelapor sungguhan, dan rate-limit per-IP kini short-circuit. Bukti detailnya dulu hidup di dokumen
audit SPEC-352; dokumen itu dipensiunkan di SPEC-386 ([ADR-0083](0083-retensi-dokumen-audit.md)) —
ringkasan temuannya ada di ledger ADR itu, naskah penuhnya di riwayat git.
**Terkait:** **ADR-0060** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md)) (pola endpoint publik ber-scope-project + jembatan ke Spec — SPEC-253 menutup jalur **manusia → backlog**, ADR-0060 menutup **mesin → backlog**),
[ADR-0028](0028-auth-sesi-opaque-di-db.md) (auth sesi menggerbangi `/api`),
[ADR-0044](0044-device-token-machine-identity.md) (kunci hash-at-rest, pola verifikasi),
[ADR-0033](0033-notifikasi-backlog-selesai.md) (Notification reuse), [ADR-0039](0039-realtime-lewat-websocket-siar.md) (siar dashboard, sisanya polling),
[ADR-0018](0018-coverage-nilai-turunan.md)/[ADR-0019](0019-sha-disimpan-diff-diturunkan.md) (nilai turunan > state kembar), [ADR-0041](0041-prd-sebagai-dokumen-flow-project-level.md) (PRD sumber fitur ini)

## Konteks

PRD `docs/prd/help-center-per-project.md` meminta **Help Center per project**: link publik siap-sebar (`/help/<projectId>`) berisi form lapor keluhan + halaman cek status; keluhan masuk sebagai **tiket** ke **antrean triase**; tim internal **menerima → backlog (`Spec`)** atau **menolak**; pelapor mengecek **status publik terpetakan otomatis**. Empat fakta arsitektur mengikat desain:

1. **Auth menggerbangi seluruh `/api`** (ADR-0028): 401 tanpa sesi. Halaman/submit/status Help Center dipanggil pengguna akhir **tanpa** cookie → butuh **pengecualian sah** yang diotorisasi bukan-cookie.
2. **Menambah kemampuan tiket = menambah model** yang **wajib lewat migration + ADR**.
3. **Dashboard SPA tanpa routing URL** — error monitoring (ADR-0060) tak pernah butuh halaman publik (murni ingest SDK). Help Center adalah **halaman HTML publik pertama** yang harus URL-addressable.
4. **hanoman belum punya penyimpanan berkas maupun infra email** — dua kapabilitas baru yang diminta lampiran & link status (PRD Open Q1/Q3).

## Keputusan

### 1. Dua model baru + satu kolom `Project` (migration)

- **`Ticket`** — tiket keluhan per project: `number` (nomor pendek human-readable per project), `category`, `title`, `detail`, `reporterEmail`, `status` (`new|accepted|rejected`), `accessKeyHash` (**@unique**, kunci opaque cek-status hash-at-rest), `specId?` (tautan Spec hasil promosi). Unik `(projectId, number)`; index `(projectId, createdAt)`; FK `Project` cascade.
- **`TicketAttachment`** — lampiran gambar: `filename`, `mimeType`, `size`, `storageKey` (nama opaque di disk), `projectId` (denormal, isolasi). FK `Ticket` cascade.
- **`Project.helpEnabled`** (Boolean, default false) — flag opt-in additive.

Model **server-local** (seperti `ErrorGroup`/`Notification`): **tanpa** `version`/sync — volume rendah, satu workspace; tautan ke `Spec` (yang tersync) tetap satu-arah soft-link. `status`/`category` disimpan `String` (bukan enum Prisma), divalidasi `zTicketStatus`/`zTicketCategory` di `@hanoman/shared` — konsisten data-model. Migration hand-written + `migrate deploy` per DB.

### 2. Endpoint publik `/api/help/*` sebagai pengecualian sah gate `/api`

`GET /api/help/:slug` (info), `POST /api/help/:slug/tickets` (submit multipart), `GET /api/help/:slug/tickets/:key` (status) di-**bypass** gate cookie lewat prefix `if (path.startsWith("/api/help")) return;` di `app.ts` — **cermin `/api/ingest`** (ADR-0060). Otorisasi non-cookie: **submit/info** oleh `Project.helpEnabled` (nonaktif/project asing → 404 generik, tak enumerasi); **status** oleh **kunci opaque** (`hnm_tkt_<hex>`, hash-at-rest sha256, plaintext ditampilkan **sekali** di layar; lookup by hash, diverifikasi milik slug — 404 tanpa membocorkan). **Same-origin** (hanoman menyajikan SPA + API) → **tanpa CORS/OPTIONS** (beda dari ingest lintas-situs).

### 3. Halaman publik lewat routing SPA (bukan HTML server-rendered)

`main.tsx` men-mount `PublicHelpApp` saat `location.pathname` diawali `/help/` — tanpa `AuthProvider`/Shell/login. Fallback SPA `index.html` **sudah ada** (prod `setNotFoundHandler`; dev Vite historyApiFallback) → **nol perubahan server untuk menyajikan halaman**; hanya gate `/api/help` yang ditambah. Rute publik: `/help/:slug` (form) & `/help/:slug/status/:key` (status).

### 4. Kapabilitas file storage baru (server-local)

Lampiran hidup di `HANOMAN_UPLOAD_DIR` (default `$HANOMAN_HOME/uploads` sejak SPEC-761/SPEC-846; `<server>/data/uploads` saat ADR ini ditulis — **di luar `repoDir`**, **tak disync**; sejalan `Vps.keyPath` yang juga berkas di server, tak pernah di DB). Multipart via **`@fastify/multipart`** (dependensi pertama di repo). Batas: **≤3 berkas**, **≤5MB/berkas**, mime `image/png|jpeg|webp`; berkas invalid **di-skip** (submit sisanya tetap jadi, AC PRD; `throwFileSizeLimit:false` + validasi per-part di route). Penyajian **hanya ber-auth** (`GET /api/tickets/:id/attachments/:attId`, di belakang gate); halaman status publik **tidak** menampilkan lampiran balik (lebih tipis & aman).

### 5. Jembatan tiket → `Spec` (source baru `help`) reuse jalur existing

`zSpecSource += "help"` (String+zod, **tanpa migration** — cermin `audit` SPEC-237); `flowForSource("help") = "feature"` (pipeline penuh). `POST /tickets/:id/accept` (cermin errors/escalate): buat `Spec` source `help`, payload **brief-shaped** (context = detail + kategori + pelapor + jumlah lampiran + backlink `Dari tiket Help Center #<n>`), `priority` dari keputusan tim saat triase (default `sedang`), retry P2002. Set tiket `accepted` + `specId` (tautan dua arah). Idempoten: sudah promoted → 200 `{ alreadyPromoted }`. `reject` → `rejected` tanpa Spec. Lampiran **tak** disalin (biner) — developer melihatnya di triase lewat backlink.

### 6. Status publik diturunkan, bukan disimpan ganda

`publicStatus(ticketStatus, spec.stage?)` (fungsi murni, selaras ADR-0018/0019): `new→"Sedang ditinjau"`, `rejected→"Ditutup"`, `accepted`+stage `executing→"Sedang dikerjakan"`, `done→"Selesai"`, selainnya `"Diterima"`. Tanpa istilah/stage internal, tanpa data project/backlog lain.

### 7. Notifikasi & realtime reuse pola existing

Tiket **baru** → `Notification { type:"ticket", key:"ticket:<id>" }` (dedup idempoten; `type` enum diperluas `+ticket`), tersiar lewat grup `notifications` WS existing (ADR-0039). **Setiap** tiket baru menotifikasi (beda dari error yang hanya grup baru) — volume manusiawi, dijaga rate-limit. Area **Triase** = **HTTP polling** (pola `ErrorsScreen`, silent 5s), bukan kanal WS baru.

### 8. Ketahanan: rate-limit + honeypot + retensi — tanpa infrastruktur baru

Rate-limit token-bucket **in-memory** per IP (default 5/min) **dan** per project (default 20/min) → 429 (cermin `error-ingest`; sejak SPEC-352 **short-circuit**, agar IP yang jatahnya habis tak menguras bucket project bersama). Honeypot `hc_trap` terisi → 200 sukses palsu tanpa tiket (+ jejak log; bernama `hp` sampai SPEC-352). Caps `title ≤ 200`/`detail ≤ 10_000`/`email ≤ 200`. Retensi **opportunistic-on-write**: submit memangkas tiket `rejected` tua (default 90 hari, ber-`specId` dikecualikan) + hapus berkasnya — **tanpa scheduler global baru**.

### 9. Email transaksional DITUNDA

v1 menampilkan **nomor + link status berkode di layar** setelah submit (best-effort, PRD tak menggerbangi alur). Tanpa infra SMTP — keputusan email = pasca-v1 (PRD Open Q3).

## Konsekuensi

- Skema tumbuh dari sembilan model → **sebelas** (+`Ticket`, +`TicketAttachment`); satu kolom `Project` additive. Migration hand-written + `migrate deploy` per DB (termasuk `hanoman_test`).
- `accessKeyHash` **tak pernah** ke client/log; `ProjectView` mengekspos `helpEnabled`. Kunci opaque semi-rahasia (di link pelapor) — batasnya rate-limit + 404 generik, bukan kerahasiaan kuat.
- Dependensi baru `@fastify/multipart` (major 8, Fastify 4). Upload dir server-local perlu didokumentasikan di deploy (backup/retensi terpisah dari git).
- Rute publik pertama di SPA — bundle dashboard melayani `/help/*`. Refaktor code-split pasca-MVP bila perlu.
- PII lampiran/isi disimpan apa adanya (scrub pasca-MVP). Email, verifikasi email, dedup otomatis, reopen tiket "Selesai", branding lanjutan, alasan penolakan ke pelapor = **pasca-v1** (Non-goals/Open questions PRD).

## Alternatif yang ditolak

- **HTML server-rendered untuk halaman publik** — menghindari routing SPA, tapi menduplikasi styling DS & menambah jalur render server. Ditolak: routing SPA reuse komponen/DS, dan fallback `index.html` sudah ada (keputusan operator brainstorm).
- **Objek storage (S3-sejenis) untuk lampiran** — lebih portabel lintas mesin, tapi menambah dependensi/kredensial eksternal untuk satu workspace MVP. Ditolak demi thin path (local FS server, cermin `Vps.keyPath`).
- **`Ticket` = `Spec` langsung** — melanggar "backlog hanya terisi saat dipromosikan" (backlog kebanjiran keluhan mentah/spam). Ditolak: tiket entitas terpisah, promosi = keputusan manusia.
- **Kunci opaque + model token terpisah (rotate/expire)** — lebih future-proof tapi menambah model & kompleksitas untuk keuntungan kecil di MVP. Ditolak (cermin keputusan DSN ADR-0060).
- **Kanal WebSocket khusus triase / enum Prisma untuk status** — melanggar ADR-0039 & konvensi String+zod data-model. Ditolak.
- **Email menggerbangi alur v1** — menambah infra SMTP di jalur kritis. Ditolak: link tampil di layar (PRD).

## Acceptance (EARS)

- **AC-1** — WHEN operator mengaktifkan Help Center project, THE server SHALL menyediakan link publik stabil terikat `Project.id`; WHILE nonaktif, submit untuknya ditolak (404) tanpa menghapus tiket lama.
- **AC-2** — WHEN pengguna submit keluhan valid ke `/api/help/:slug/tickets` (project aktif), THE server SHALL membuat `Ticket` (+lampiran gambar valid) & mengembalikan nomor + link status berkode; field wajib kosong/kategori invalid → 400 tanpa tiket.
- **AC-3** — WHERE submit mengisi honeypot ATAU melampaui rate-limit per IP/project, THE server SHALL menolak (200 palsu / 429) tanpa membuat tiket & tanpa memengaruhi project lain.
- **AC-4** — WHEN tiket baru masuk, THE server SHALL membuat satu `Notification` type `ticket` (dedup `key`) & menaikkan badge "belum ditinjau" di inbox triase (polling).
- **AC-5** — WHEN operator **menerima** tiket, THE server SHALL membuat `Spec` source `help` prefilled + menandai tiket `accepted` + tautan dua arah; terima kedua tak membuat Spec dobel. **Tolak** → tiket `rejected` tanpa Spec.
- **AC-6** — WHEN pelapor membuka kunci/link valid, THE server SHALL menampilkan status publik terpetakan otomatis (tiket + stage Spec), tanpa istilah internal / data project lain; kunci invalid/salah-slug → 404 tanpa membocorkan.
- **AC-7** — THE query tiket/lampiran SHALL selalu ber-scope `projectId` (isolasi antar-project); `accessKeyHash` tak pernah ke client; lampiran disajikan hanya ber-auth.
