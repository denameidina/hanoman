# Overview "Koran Pagi" — desain

Tanggal: 2026-10-13 · Status: disetujui (brainstorming) · Berikutnya: implementation plan

## Tujuan

Merombak layar Overview dari daftar status-saat-ini menjadi halaman depan surat kabar yang
memuat metrik kinerja hari ini, tanpa kehilangan fungsi pusat-aksinya (menjawab sesi yang
menunggu, melihat project bermasalah). Arah visual: **A — Koran Pagi** (editorial broadsheet),
selaras design system bone paper + brass.

## Keputusan yang sudah diambil

| Topik | Keputusan |
|---|---|
| Ide yang masuk | Semua: Denyut armada, meteran bottleneck, ekonomi token, prakiraan bensin, sungai spec, peta panas, headline koran, rekor/streak |
| Bagian operasional | Dilebur ke metrik (Denyut menggantikan daftar "Sesi berjalan"; "Perlu perhatian" jadi kotak Koreksi; daftar project jadi Indeks Project) |
| Rentang waktu | Hari ini + delta vs kemarin. Peta panas 7 hari, sungai (median) 7 hari, rekor 90 hari |
| Penyaluran data | Pendekatan 1: grup snapshot WS ke-12 `overview` + perekam di memori (data perekam hilang saat restart) |
| Tata letak | A — Koran Pagi |

## 1. Data & server

### Modul

- `server/src/services/overview-metrics.ts`: fungsi murni `computeOverview(now, sources) → OverviewDTO`
  plus pengumpul sumber dari Prisma. "Hari" = mulai 00.00 waktu lokal mesin. Setiap angka harian
  dihitung untuk hari ini dan kemarin.
- `server/src/services/overview-recorder.ts`: perekam di memori dengan timer sendiri (10 dtk, `.unref`).
  Ia membaca sesi (`listSessionsAsync`) dan limit secara mandiri, bukan menumpang loop siar: loop itu
  hanya hidup selama ada dashboard terbuka, padahal menit menunggu justru menumpuk saat tak ada.

### Definisi panel

| Panel | Sumber | Definisi |
|---|---|---|
| Mendarat | `Spec.doneAt` | jumlah spec dengan `doneAt` di hari itu |
| Tumbang | `SessionHistory` | sesi dengan `endedAt` di hari itu dan `exitCode ≠ 0`. Baris `endedReason = "reconciled"` tidak dihitung, karena hasilnya tak diketahui |
| Sungai spec | `Spec.createdAt / startedAt / doneAt` | jumlah dibuat, mulai, dan selesai hari ini. Median lead time (createdAt→doneAt) dan cycle time (startedAt→doneAt) dari spec yang selesai dalam 7 hari terakhir |
| Ekonomi token | `AgentInvocation` | Σ input, output, dan cached hari ini. Cache hit = cached ÷ (input + cached). Token per spec mendarat = Σ token ÷ mendarat (null bila 0). Agen paling boros = `agentName` dengan Σ token terbesar. Label: "token agen tercatat" |
| Bottleneck | perekam | Σ menit episode menunggu yang beririsan dengan hari itu, dan persentasenya terhadap Σ menit sesi hidup hari itu |
| Bensin | perekam (sampel limit) | regresi linear `usedPct` pada sampel 60 menit terakhir, diproyeksikan ke 100%, dibandingkan dengan `resetsAt` → `habisAt` atau "aman sampai reset". Untuk Claude dan Codex (bila aktif) |
| Peta panas | `SessionHistory` | menit sesi hidup per sel hari × jam, 7 hari terakhir (sesi yang masih hidup dihitung sampai `now`) |
| Rekor | `SessionHistory` + `Spec.doneAt` | streak hari berturut-turut tanpa sesi tumbang (berakhir hari ini), rekor streak, dan rekor spec mendarat per hari, semuanya dalam jendela 90 hari. "Rekor baru hari ini" hanya bila ada hari sebelumnya yang pernah mendaratkan spec |
| Headline | `headline(dto)` | template deterministik, tanpa LLM. Memilih 2–3 fakta paling menonjol menurut prioritas: tumbang > 0 → menunggu > 30 menit → rekor baru → bensin habis sebelum reset → mendarat. Fallback: "Hari yang tenang." |

### Perekam di memori

- **Episode menunggu.** Dibuka saat sesi pertama kali terlihat menunggu (awal = `decisionAt`).
  Ditutup saat penanda menunggu hilang atau sesinya lenyap dari snapshot. Maksimal 2.000 episode;
  yang tertua dipangkas.
- **Sampel limit.** `usedPct` per window tiap 30 detik, disimpan 2 jam.
- **`recordingSince`.** Waktu perekam mulai, dikirim di DTO agar panel bisa menulis "tercatat sejak 09.12".
- Episode yang melewati 00.00 dipotong per hari.

### Penyaluran

- Kontrak `zOverview` di `shared/src/dto.ts`.
- Grup snapshot ke-12 `overview` di `/api/events/ws`, dihitung tiap 30 detik, dikirim hanya bila
  digest berubah.
- `GET /api/overview` untuk muat awal.
- Tool MCP `hanoman_overview_get` (ADR-0202).

### Batasan yang diakui

- `AgentInvocation` hanya mencakup subagen dan agen fase, bukan seluruh percakapan sesi utama.
  Total token karena itu parsial dan diberi label demikian.
- Tidak ada data biaya mata uang di sistem, jadi tidak ditampilkan.
- Data bottleneck dan bensin hilang saat server restart (disepakati; pendekatan permanen = ADR terpisah nanti).

## 2. Frontend

`OverviewScreen.tsx` menjadi kerangka koran, dan panel dipecah ke `src/src/screens/overview/`.
Semua panel menerima props murni (`OverviewDTO` dan snapshot `sessions`). Tidak ada panel yang
mengambil data sendiri. Data `overview` diterima di `App.tsx` seperti grup snapshot lain.

| Komponen | Isi |
|---|---|
| `Masthead` | "Kabar Hanoman", tanggal panjang, "Edisi langsung · HH.MM", jumlah project |
| `Headline` | kalimat serif besar; angka kunci diwarnai (clay = buruk, leaf = baik). Di bawahnya CTA "Jawab sesi yang menunggu" / "Buka backlog" seperti sekarang |
| `Koreksi` | kotak kecil bergaya ralat koran, berisi project `broken`/`drift` (pengganti "Perlu perhatian"). Hanya muncul bila ada |
| `Denyut` | panel gelap (`--term-*`), satu baris EKG per sesi hidup |
| `Bottleneck` | menit menunggu, bar persentase, `Delta` |
| `SungaiSpec` | diagram aliran SVG dibuat→jalan→selesai, plus lead/cycle time |
| `Rekor` | streak dan rekor |
| `Bensin` | %, garis proyeksi, garis reset, label "habis ±HH.MM" atau "aman sampai reset"; tab Claude/Codex. Menggantikan `LimitWindows` di layar ini (badge Shell tetap memakai `LimitWindows`) |
| `EkonomiToken` | total, cache %, token/spec, agen paling boros |
| `PetaPanas` | grid 7×24 dengan intensitas brass, tooltip "Sel 14.00 · 38 menit" |
| `IndeksProject` | daftar project lama (cakupan, status dokumen, item terbuka, brief/qa/prioritas tinggi) bergaya tabel bursa saham |
| `Delta` | penanda ↑/↓ vs kemarin, dipakai bersama |

### Denyut

- Satu SVG jejak per baris, dianimasikan dengan CSS murni (`@keyframes`), tanpa `requestAnimationFrame`.
- Ritme mengikuti **keadaan**, bukan `activityAt`: field itu tak ada di `SessionDTO`, dan menambahkannya
  membuat frame `sessions` (frame terbesar dashboard) terkirim tiap detik. Tiga tempo dipilih stabil
  dari id sesi supaya baris tak berdetak serempak.
- Sesi yang menunggu: garis datar putus-putus clay, label "menunggumu Nm · jawab".
- Klik baris membuka sesi di Terminal (perilaku `LiveRow` sekarang).
- `prefers-reduced-motion` membuat garis statis. Browser sendiri menjeda animasi CSS di tab tersembunyi.
- Maksimal 8 baris, sisanya "+N lainnya".

### Tata letak

- ≥1100px: tiga kolom `1.4fr 1fr 1fr`. Kiri: Denyut, Bottleneck. Tengah: Sungai, Rekor. Kanan: Bensin, Token.
  Lalu Peta Panas dan Indeks Project selebar penuh.
- 720–1100px: dua kolom.
- <720px: satu kolom dengan urutan Headline → Denyut → Bottleneck → Bensin → sisanya.
- Warna dari token `src/src/ds/tokens`. Angka dan headline memakai IBM Plex Serif; label kecil uppercase.

### State

- Sebelum `overview` tiba: kerangka tipis per panel.
- Panel `null` (sumber gagal): kalimat datar, bukan angka.
- Data nol: kalimat datar, mis. "Belum ada agen tercatat hari ini."
- Tanpa project: empty state lama ("Buat project pertama") dipertahankan.

## 3. Error handling, test, docs

### Error handling

- `computeOverview` tidak melempar. Kegagalan satu sumber membuat panelnya `null`, alasannya
  dicatat di log, dan grup tetap disiarkan.
- Buffer perekam dibatasi (lihat di atas).
- Pergantian hari terjadi alami karena `now` adalah parameter.
- Proyeksi bensin hanya tampil dengan ≥4 sampel dan kemiringan > 0. Bila tidak, tampil "laju stabil".

### Test (TDD)

- `server/test/overview-metrics.test.ts`: mendarat dan tumbang (termasuk pengecualian `reconciled`),
  median lead/cycle time, cache hit, streak dan rekor, potongan episode di tengah malam, proyeksi
  bensin sebelum/sesudah reset, prioritas headline, panel `null` saat sumber gagal.
- `server/test/overview-recorder.test.ts`: episode dibuka/ditutup dari urutan snapshot, sesi
  lenyap, pemangkasan buffer.
- Route dan WS: `GET /api/overview` lolos `zOverview`; grup `overview` tersiar dan digest mencegah
  kiriman ulang yang identik.
- MCP: `hanoman_overview_get` terdaftar dan memanggil endpoint yang benar.
- `src/test/overview-screen.test.tsx`: Headline dan Delta tampil; Denyut menandai sesi menunggu dan
  klik membuka Terminal; reduced-motion statis; empty state tetap; Koreksi hanya muncul bila ada
  `broken`/`drift`.
- Verifikasi akhir: boot server lokal, `curl /api/overview`, cek tampilan di browser.

### Docs (commit yang sama dengan implementasi)

- SPEC baru di backlog hanoman dan ADR baru: grup `overview`, perekam di memori dan konsekuensinya
  saat restart, headline berbasis template.
- Perbarui `internal/docs/architecture/stack.md` (sebelas → dua belas grup),
  `internal/docs/frontend/frontend-implementation.md`, `internal/docs/frontend/ui-ux-audit-2026-10.md`,
  dan `CLAUDE.md` (sebutan "sebelas grup"). Tautkan di `internal/docs/README.md`.

## Di luar scope

Penyimpanan permanen episode menunggu dan sampel limit, pemilih rentang waktu, biaya mata uang,
headline buatan LLM, filter per project.
