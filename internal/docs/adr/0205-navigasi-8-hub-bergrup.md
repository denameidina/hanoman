# ADR-0205 — Navigasi 8 hub bergrup

- Status: Accepted · **menimpa sebagian ADR-0160** (daftar menu sidebar; bentuk URL tetap berlaku)
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · Fase 3A (tanpa nomor SPEC; keputusan dari audit, lihat
  [ui-ux-audit-2026-10 § Usulan redesign 1](../frontend/ui-ux-audit-2026-10.md#1-ia-17-menu--8-tiga-grup))
- Terkait: **menimpa sebagian 0160** (bagian "daftar menu": `HN_NAV` tak lagi = sidebar); menegakkan
  **0160** (URL adalah state navigasi, path section tak berubah), **0115** (`app.section` terakhir tetap
  dipulihkan; ingatan tab per hub memakai kunci ui-state yang sama), **0071** (hash lama), **0110**
  (portal klien tetap di luar Shell), **0147/SPEC-919** (gerbang `clients`), **SPEC-961** (badge antrean).
  Tak ada API baru, jadi tak ada keputusan MCP baru (ADR-0202 tak terpicu).

## Konteks

Sidebar memuat **17 entri datar** (`HN_NAV`), dengan nama yang tumpang-tindih (Projects, PRD, Docs, IDE,
QA; Scheduler, Lead; VPS, Settings). Audit 2026-10 menilai IA 4/10 dan mencatat bahwa rail tablet
(72 px) tak muat tanpa gulir, sementara drawer mobile menampilkan 17 baris tanpa struktur. Pengguna
menemukan layar lewat ingatan nama, bukan lewat kelompok kerja.

ADR-0160 memutuskan **URL = state navigasi** dan memetakan path ke `section`. Keputusan itu benar dan
tetap dipertahankan. Yang ditimpa hanyalah asumsi bahwa **setiap section adalah satu entri sidebar**.

## Keputusan

### 1. Delapan hub dalam tiga grup

| Grup | Hub | Tab (section URL) |
|---|---|---|
| Kerja | Overview | Overview (`/overview`) |
| Kerja | Projects | Daftar (`/projects`) · PRD (`/prd`) · Docs (`/docs`) · QA (`/qa`) · Kode (`/ide`) |
| Kerja | Backlog | Spec (`/backlog`) · Tugas manusia (`/team`) |
| Kerja | Triase | Triase (`/triage`) |
| Kerja | Sesi | Terminal (`/terminal`) · Perangkat (`/clients`, gerbang `clients`) |
| Otomasi | Otonom | Scheduler (`/scheduler`) · Lead (`/lead`) |
| Sistem | Skills | Skills (`/skills`) |
| Sistem | Pengaturan | Pengaturan (`/settings`) · Server (VPS) (`/vps`) |

Definisi hidup di `src/src/nav-hubs.ts` (`HN_HUBS`, `HN_GROUPS`), murni dan diuji.

### 2. URL tidak berubah; tidak ada redirect

Setiap tab adalah section yang sudah ada. Tautan lama (email tiket, Telegram, bookmark, `/review/…`,
`/projects/<id>`) tetap membuka layar yang sama, sehingga **tak ada redirect**. Tak ada path baru.

### 3. Dua konsep dipisah di `ds/shell.tsx`

- **`HN_NAV`** = semua rute yang valid. `parseRoute`, palet, dan shortcut `g` tetap membacanya.
- **`HN_HUBS`** = isi sidebar.
- **`PALETTE_ONLY_SECTIONS`** = `dalang`. Panggung keluar dari sidebar; ia dibuka lewat palet
  ("Buka panggung"), `g d`, dan baris bantuan shortcut. Tak ada section yang tak punya tempat: test
  `nav-hubs.test.ts` menegakkannya.

### 4. Tab dibaca dari URL (`SectionTabs`)

`ds/section-tabs.tsx` memakai `Tabs` DS (`role="tablist"`), dan tab terpilih **diturunkan dari
`section`**. Klik tab hanya memanggil navigasi. Tab bergerbang disembunyikan, dan tiap tab membawa angka
antrean sendiri. Bar tidak tampil bila hub hanya punya satu tab yang tampil (Overview, Triase, Skills,
atau Sesi tanpa `clients`).

Bar dipasang di `App.tsx` pada tiap layar anak hub, lewat satu elemen `hubTabs`.

### 5. Klik hub mengingat tab terakhir

Klik hub membuka tab terakhir yang dibuka di hub itu. Ingatan disimpan di ui-state
(`hn.ui.v1.nav.lastTab`, hub key → section) dan **hanya ditulis oleh `Shell`**. Jika tab itu sudah tak
tampil (gerbang mati), klik jatuh ke `default` hub.

### 6. Route turunan bukan tab

`project` (detail, milik Projects) dan `review` (milik Backlog) tetap hidup lewat URL, tetapi tak pernah
tampil sebagai tab. Induknya terpilih, sehingga detail project menampilkan tab "Daftar" dan review
menampilkan tab "Spec".

### 7. Crumb "Hub › Tab" dan sidebar yang berbeda per tier

- Topbar menampilkan `Projects › PRD` di baris mono di atas judul. Deskripsi layar tetap ada setelahnya.
  Hub satu layar tak punya crumb.
- Tablet: 8 ikon, label grup disembunyikan, dan grup dipisah garis tipis. Tak ada gulir.
- Mobile: drawer menampilkan tiga grup berlabel. Setiap grup adalah `role="group"` dengan nama yang
  dibacakan.

## Alternatif yang ditolak

- **Route bersarang** (`/projects/prd`). Mengubah URL dan memutus setiap deep link ADR-0160 serta
  tautan yang sudah beredar. Ditolak.
- **Tab sebagai state lokal** tanpa URL. Melanggar ADR-0160: tombol Kembali browser dan tautan
  bersama tak lagi bekerja.
- **Sidebar akordeon** atau dropdown per hub. Tak muat di rail 72 px dan menyembunyikan isi dari
  pembaca layar yang memindai.
- **Ingatan tab di `App`.** `Shell` yang memegang `active` dan menjadi satu-satunya penulis ingatan itu,
  sehingga tak ada dua salinan yang bisa basi.

## Konsekuensi & gotcha

- **Section baru** wajib masuk `HN_NAV` **dan** satu hub (atau `PALETTE_ONLY_SECTIONS` secara sadar).
  `nav-hubs.test.ts` gagal bila ada yang yatim.
- **Layar anak hub baru** yang butuh bar tab memanggil `{hubTabs}` di Shell-nya. Yang lupa tetap
  berfungsi, hanya tanpa bar tab. Hub satu layar tidak butuh apa pun.
- **Review sesi PRD** (`kind=session`) berasal dari Terminal, tetapi tampil di bawah hub Backlog, bukan
  Sesi. Diterima: review tak punya hub sendiri, dan kembalinya tetap ke Terminal.
- **Dalang** tidak lagi terlihat di sidebar. Pengguna yang mencari panggung lewat menu tak akan
  menemukannya. Penawarnya adalah palet dan `?` (ditambahkan di fase ini) dan tombol di Overview (belum
  ada, lihat di bawah).
- **Overview belum punya tombol "Buka panggung".** Overview adalah milik fase 2F. Aksi itu hanya ada di
  palet dan bantuan shortcut.
- **Crumb** untuk tab bernama sama dengan hub (Pengaturan › Pengaturan) terbaca berulang. Diterima demi
  konsistensi "Hub › Tab".
