# Glosarium UI hanoman

Status: **berlaku** sejak Audit UI/UX 2026-10 · Fase 2D. Sumber istilah: [audit § Glosarium copy](ui-ux-audit-2026-10.md#4-glosarium-copy-usulan).
Dokumen ini adalah kontrak untuk teks yang tampil ke operator. Kode penegaknya: `src/test/glossary-guard.test.ts`
(pemindai AST) dan `src/src/lib/labels.ts` / `src/src/lib/time-format.ts` (satu tempat untuk label dan waktu relatif).

## Istilah baku

| Konsep | Istilah baku | Hindari | Catatan |
|---|---|---|---|
| Perangkat terpasang atau jarak jauh | **Perangkat** | Device, Mesin, Klien, hub | `hub` masih ada di copy sinkronisasi dan konflik (utang Fase 3, lihat di bawah). |
| Portal pelanggan | **Klien** | Client, Portal | Layar Klien; tab "Portal" di Settings tetap istilah produk. |
| Layar takeover orkestrasi | **Dalang Hanoman** (judul); **Buka panggung** (aksi palet) | Dalang sinematik, panggung orkestrasi | Layar gelap penuh tanpa Shell (ADR-0208, dipulihkan sinematik ADR-0219). Satu-satunya layar gelap penuh. |
| Kartu project di Dalang | **Wayang** | Puppet, Avatar | Hidup = sesi berjalan (benang emas). Redup = tanpa sesi, tertulis "tersandar di debog". |
| Sesi yang menunggu keputusanmu | **Menunggu jawabanmu** (aksi **Jawab**) | Blocked, Perlu input | Tampil di atas layar Dalang dan di Overview. |
| Satu entri backlog | **Item** | SpecSlim, Spec | `Spec` tetap dipakai untuk `SPEC-nnn` dan untuk tahap spesifikasi. Nama tipe `SpecSlim` di kode bukan teks tampil. |
| Dokumen project | **Dokumen** | SoT, Docs · SoT | `SoT` (source of truth) tetap istilah internal di docs/ADR, bukan copy layar. |
| Hapus permanen | **Hapus** | Buang (untuk data) | Selalu lewat `useConfirm` dengan nama objek dan dampaknya. |
| Lepas dari daftar | **Lepas** | Hapus | Dipakai bila data tetap ada di tempat lain (mis. tautan, binding). |
| Ubah isi | **Edit** | Ubah | Kata kerja tombol. |
| Batas sesi | **Batas sesi** | cap | |
| Izin yang dilaporkan perangkat remote | **Tingkat akses** (baris), **Diatur di perangkat itu** (penanda baca-saja) | Atur dari sini, Ubah di sini | Klien · Perangkat. Hanya dibaca: pengubahnya ada di perangkat itu (ADR-0216 opsi D). Keadaannya Lihat/Kerja/Tulis, Khusus, Nonaktif, atau Tidak diketahui. Label di `lib/labels.ts` (`REPORTED_ACCESS_*`). |
| Basi sebagai status | keadaan konkret: "dimuat 5 menit lalu", "data lama" | basi | `basi` tak pernah jadi label status. |
| Pengecekan dokumen OK | **Sesuai standar** | on-convention | |
| Retry | **Coba lagi** (galat), **Kirim ulang** (pengiriman) | Retry | Istilah teknis di kutipan kode dikecualikan. |
| Nilai enum | label dari `lib/labels.ts` | nilai mentah | Lihat "Enum" di bawah. |
| Waktu relatif | "baru saja", "5 menit lalu", "2 jam lalu", "kemarin", "3 hari lalu", lalu tanggal ("4 Okt") | "5m lalu", "5 mnt", "2j lalu", "baru saja lalu" | Lihat "Waktu relatif" di bawah. |
| Mode tampilan terminal | **Fokus** (satu pane + daftar sesi), **Grid** (beberapa pane) | Split, Tabs, Panel | Default Fokus sejak Fase 3E. Pilihan tersimpan per browser. |
| Dukungan pembaca layar terminal | **Mode pembaca layar** (opsi, default mati) | Screen reader mode, Mode SR, Aksesibilitas penuh | Opsi xterm `screenReaderMode`; tersimpan per browser (`hn.ui.v1.terminal.sr`). Belum diuji dengan VoiceOver/NVDA (Audit UI/UX 2026-10 · keputusan 15). |
| Buka sesi lain | **Buka…** (menu: Ambil backlog, Riwayat sesi, Terminal biasa) | Impor, Attach | Pemicu bertulisan di toolbar Terminal; di ponsel ikon ber-label "Buka…" (nama aksesibel sama). |
| Laporan dari klien (tiket) | **Keluhan** (tab "Keluhan saya", tombol "Lapor masalah") | Laporan & keluhan, Help desk, Tiket, Bug | Di layar Klien dan Help Center. Kategori "Ada masalah" untuk `bug`. |
| Obrolan klien | **Tanya & ide** (tab di Klien) | Obrolan, Chat | Sesi chat milik project, bukan milik satu keluhan. |
| Pemilik konflik sinkron | **server pusat** | hub, Instance, Pusat | Diputuskan di Fase 3L. Dipakai di copy konflik dan sinkronisasi. |
| Item yang pernah punya worktree | **Ber-worktree** (filter Backlog) | Belum ditinjau | Predikat `baseSha` terisi: hanoman pernah membuatkan worktree. Bukan status tinjau, dan worktree yang sudah dihapus tetap terhitung (ADR-0214). |
| Item yang menunggu jawabanmu, atau item selesai yang belum kamu tandai | **Perlu ditinjau** (filter Backlog) | Belum ditinjau, Menunggu review | Predikat gabungan (gelombang 7 dan ADR-0218): (a) sesi item menunggu jawaban manusia, kondisi yang sama dengan "Menunggu jawabanmu" di Overview; (b) item selesai yang pernah dikerjakan dan belum punya penanda "Sudah ditinjau". Bukan status tinjau diff (`screens/backlog-worktree.ts`). |
| Item selesai yang sudah diperiksa | **Sudah ditinjau** (penanda; tombol **Tandai ditinjau** / **Batalkan tanda ditinjau**) | Disetujui, Lulus review, Approved | Penanda yang ditulis operator (`Spec.reviewedAt`, ADR-0218). Bukan persetujuan dan bukan hasil integrasi; integrasi tidak menandainya. Tombol ada di bar Review dan di menu item Backlog. |
| Ref IDE yang menampilkan berkas di disk (termasuk yang belum di-commit) | **Belum di-commit** (pilihan ref, dengan tooltip) | · working tree · | Pilihan pertama di selector ref IDE. Tooltip menjelaskan isinya. |
| Toggle berkas dan folder yang `.gitignore` sembunyikan (IDE) | **Diabaikan git** | Tersembunyi, Cabang tersembunyi | Bukan cabang: yang tampil berkas atau folder yang diabaikan git. Tooltip ikut menjelaskan. |
| Keadaan proyek di "Aktivitas terbaru" (Overview) | **Berjalan** (`PROJECT_ACTIVITY_LABEL`) | idle, `running · <flow>`, Diam | Hanya proyek yang sesinya berjalan dan tak sedang di "Perlu perhatian". Proyek idle tak tampil di seksi ini (daftar Project memuatnya). Teks `activity` dari server tak tampil mentah; nama flow ikut di kolom aktivitas. |
| Pil versi di topbar | **Versi hanoman** (tooltip dan nama aksesibel) | Versi terpasang, v0.0.0 | Hanya untuk versi semver nyata: `0.0.0` dan bentuk empat bagian tak tampil. Pil "Update · x.y.z" tetap tampil apa pun versi jalannya. |
| Pil limit yang belum terbaca (topbar) | **Limit —** | — (strip tanpa kata) | Kata "Limit" ikut tampil supaya strip tak dibaca sebagai angka yang rusak. Nama aksesibelnya "Limit Claude, belum terbaca". |
| Papan tombol khusus di dock Terminal | **Esc, Tab, panah** (tooltip menambah Enter) | Tombol khusus | Nama tombol menyebut isi papannya, bukan kata kerja. |

## Aturan voice

- Bahasa Indonesia untuk seluruh UI. Kata Inggris hanya untuk nama produk/istilah teknis yang sudah baku (`Goal`, `QA`, `PRD`, `Scaffold`, `Help Center`, `Claude Code`).
- Tombol = kata kerja + objek ("Simpan perubahan", "Hapus sesi"), bukan "OK".
- "tidak" bukan "tak" di teks baru. (Pengecualian: tak dipertahankan di copy lama sampai layarnya diredesain.)
- Galat = apa yang gagal + langkah berikutnya: "Gagal menyimpan: server menolak nama yang kosong. Isi nama, lalu simpan lagi."
- Sentence case. Judul dan badge tidak diakhiri titik.
- Jangan tampilkan enum mentah (`from-scratch`, `wontfix`, `blocker`, `priority`). Nilai tak dikenal tetap dirapikan lewat `labelOf`, bukan dibiarkan mentah.
- Daftar yang gagal dimuat tampil sebagai galat, bukan sebagai "Belum ada …".
- Placeholder berisi contoh nilai, bukan pengulangan label (aturan di `design-system.md`, SPEC-490).

## Enum: pakai `lib/labels.ts`

Setiap enum yang tampil punya satu peta di `src/src/lib/labels.ts`, bertipe dari `@hanoman/shared`:

```ts
import { labelOf, PRIORITY_LABEL, FLOW_LABEL } from "../lib/labels";

<Badge>{PRIORITY_LABEL.tinggi}</Badge>          // nilai yang sudah pasti ada di tipe
<Badge>{labelOf(FLOW_LABEL, s.flow)}</Badge>    // nilai dari server: aman terhadap nilai tak dikenal
```

- `Record<Union, string>` memaksa peta lengkap: enum baru di shared gagal di typecheck sampai ia diberi label.
- `labelOf(map, value)` tak pernah melempar. Nilai kosong/null → `—`. Nilai tak dikenal → `humanize` (`no_effort` → `No effort`). Properti bawaan objek (`constructor`) tidak pernah lolos sebagai label.
- Jangan menyalin peta ke berkas layar. Bila nama lama dibutuhkan, re-export dari berkas itu (`export { X } from "../lib/labels"`), seperti `screens/qa/qa-ui.ts`. (`screens/DalangStage.tsx` yang dulu juga begitu sudah dihapus di Fase 2E.)
- Label yang sengaja huruf kecil (aria phrase, kalimat di dalam teks) dicatat di komentar peta, mis. `PHASE_STATUS_LABEL`, `QUEUE_STATUS_LABEL`, `LEAD_*`.
- Nilai yang sama punya kata yang sama di mana pun: `SEVERITY_LABEL` memakai kata QA; `FLOW_LABEL` satu sumber untuk Dalang, Overview, dan Settings orkestrasi.

## Waktu relatif: pakai `lib/time-format.ts`

```ts
import { relativeTime } from "../lib/time-format";

{relativeTime(s.startedAt, now) || "—"}   // kosong bila masukan tak valid; fallback di layar
```

- Satu fungsi untuk seluruh dashboard. Jangan merakit "N menit lalu" di layar atau menempel " lalu" di luar fungsi.
- Urutan: di bawah 1 menit "baru saja" (termasuk stempel masa depan kecil); di bawah 1 jam "N menit lalu"; di bawah 24 jam "N jam lalu"; hari kalender sebelumnya "kemarin"; sampai 6 hari "N hari lalu"; selebihnya tanggal (`absoluteDate`: "4 Okt", atau "4 Okt 2025" bila beda tahun).
- `untilLabel` ("N menit lagi") di `sched-lead-shared.tsx` adalah arah berlawanan dan belum dipusatkan.

## Penjaga: `glossary-guard.test.ts`

Pemindai membaca AST TypeScript dari `src/src/screens/**`, `portal/**`, `public/**`, `palette/**`, dan `ds/shell.tsx`. Yang diperiksa hanya teks yang tampil (string literal, potongan template, teks JSX). Komentar, identifier, import, dan kunci objek tidak ikut.

Istilah terlarang (aturan `RULES`): `Device`, `SpecSlim`, `on-convention`, `basi`, `hub`, `SoT`, `retry`, dan waktu relatif yang dirakit manual (`N menit lalu`, `baru saja lalu`, atau string `" lalu"`).

Pengecualian ada di `ALLOWLIST` per berkas dengan `fragment` (potongan unik teks) dan `reason` yang wajib diawali kategorinya:

- **SAH**: kutipan kode contoh, atau pemakaian yang memang benar.
- **UTANG Fase 3**: copy yang tercatat dan menunggu redesign layarnya. Entri dihapus begitu copy-nya diganti; test "allowlist tak basi" menggagalkan entri yang sudah tak cocok.

Test sanity memastikan pemindai benar-benar membaca lebih dari 100 berkas dan lebih dari 1000 teks tampil. Pemindai yang diam-diam kosong tak boleh memberi gejala "semua bersih".

Menambah istilah terlarang: tambahkan ke `RULES` dengan `word(...)` (kata utuh) dan `saran`, jalankan test, lalu tangani hasilnya (ganti copy, atau tambah allowlist dengan alasan).

## Utang copy untuk Fase 3

Daftar ini sama dengan allowlist `UTANG Fase 3`. Setiap baris dihapus dari allowlist saat copy-nya diganti.

| Berkas | Copy | Mengapa belum |
|---|---|---|
| `screens/LogsPanel.tsx` | `aria-label="Device"` | Di luar wilayah Fase 2D (copy, bukan label dedupe) |
| `screens/PhasePlanPreview.tsx` | "Pratinjau ini memakai Setting hub ini…" | Keputusan istilah server pusat |
| `screens/SyncButton.tsx` | "Instance ini hub", "… ke hub …" | Keputusan istilah server pusat |
| `screens/WebhookDocs.tsx` | "bisa basi", "Retry, pengiriman ganda…", "… retry setelah …" | Keputusan "Retry" → "Kirim ulang" |
| `ds/shell.tsx` | nav "Docs · SoT" | Berkas milik agen 3A (shell) |

Sisa di luar pemindai (bukan wilayah Fase 2D, tercatat untuk Fase 3):

- `portal/labels.ts` sudah menjadi satu-satunya peta kosakata Klien dan Help Center (Fase 3M); status tiket klien dipetakan di `portal/ticket-timeline.ts`.
- `screens/VpsChecklist.tsx`: peta `MODE_LABEL` (Otomatis/Audit/Info) masih lokal. Pindahkan ke `lib/labels.ts`. Tooltip dan lencana sudah memakai `VPS_SEVERITY_LABEL` dan `VPS_ITEM_STATUS_LABEL` (Fase 3J).
- `screens/SpecDocsModal.tsx` (`KIND_LABEL`), `screens/settings/Advanced.tsx` (`GROUP_LABEL`, `SOURCE_WORD`, `APPLY_WORD`; pindah dari `SettingsScreen.tsx` di Fase 3C), `screens/RemoteControlPanel.tsx` (`RELAY_LABEL`): peta lokal yang belum dipindah.

## Keputusan terbuka

- **Istilah server pusat — DIPUTUSKAN (Fase 3L).** "server pusat" (sudah dipakai di `RemoteControlPanel`) dipakai di copy konflik (`ReconcileModal`). Copy sinkronisasi di `SyncButton.tsx` masih memakai "hub" sampai layar Sinkronisasi diredesain.
- **"Retry".** Pilihan: "Coba lagi" untuk galat, "Kirim ulang" untuk pengiriman webhook.
- **Istilah "effort".** Dipertahankan sebagai istilah teknis (`Tanpa effort`, nilai effort per runtime). Belum dibahas sebagai copy.
- **"Perlu ditinjau" vs "Menunggu jawabanmu".** Filter Backlog (gelombang 7) dan Overview memakai kondisi sesi yang sama dan dua kata. Label filter mengikuti permintaan ("Perlu ditinjau"); aturan "nilai yang sama, kata yang sama" menyarankan satu kata. Belum diputuskan pemilik produk.
- **Nama layar Overview: tegangan belum diputuskan.** Nav dan judul topbar memakai "Overview" (Inggris, bukan istilah baku). Crumb topbar menulis "ringkasan workspace", dan judul `PageHeader` "Hari ini" tetap ada di DOM tetapi disembunyikan secara visual (tinjauan segar). Tiga nama untuk satu layar. "Ringkasan" dan "Hari ini" belum istilah baku, jadi tidak dipakai sebagai acuan. Sampai pemilik produk memilih satu nama, nav, topbar, crumb, dan judul dibiarkan apa adanya.
- **Label nav "Overview", "Projects", "Settings" (`ds/shell.tsx`, `App.tsx`).** Masih bahasa Inggris. "Overview" bukan istilah baku glosarium, jadi tak diganti tanpa keputusan pemilik produk. Judul "Hari ini" di layar Overview kini disembunyikan secara visual (tinjauan segar), supaya topbar dan layar tak bertumpuk.
