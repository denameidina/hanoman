# Glosarium UI hanoman

Status: **berlaku** sejak Audit UI/UX 2026-10 · Fase 2D. Sumber istilah: [audit § Glosarium copy](ui-ux-audit-2026-10.md#4-glosarium-copy-usulan).
Dokumen ini adalah kontrak untuk teks yang tampil ke operator. Kode penegaknya: `src/test/glossary-guard.test.ts`
(pemindai AST) dan `src/src/lib/labels.ts` / `src/src/lib/time-format.ts` (satu tempat untuk label dan waktu relatif).

## Istilah baku

| Konsep | Istilah baku | Hindari | Catatan |
|---|---|---|---|
| Perangkat terpasang atau jarak jauh | **Perangkat** | Device, Mesin, Klien, hub | `hub` masih ada di copy sinkronisasi dan konflik (utang Fase 3, lihat di bawah). |
| Portal pelanggan | **Klien** | Client, Portal | Layar Klien; tab "Portal" di Settings tetap istilah produk. |
| Satu entri backlog | **Item** | SpecSlim, Spec | `Spec` tetap dipakai untuk `SPEC-nnn` dan untuk tahap spesifikasi. Nama tipe `SpecSlim` di kode bukan teks tampil. |
| Dokumen project | **Dokumen** | SoT, Docs · SoT | `SoT` (source of truth) tetap istilah internal di docs/ADR, bukan copy layar. |
| Hapus permanen | **Hapus** | Buang (untuk data) | Selalu lewat `useConfirm` dengan nama objek dan dampaknya. |
| Lepas dari daftar | **Lepas** | Hapus | Dipakai bila data tetap ada di tempat lain (mis. tautan, binding). |
| Ubah isi | **Edit** | Ubah | Kata kerja tombol. |
| Batas sesi | **Batas sesi** | cap | |
| Basi sebagai status | keadaan konkret: "dimuat 5 menit lalu", "data lama" | basi | `basi` tak pernah jadi label status. |
| Pengecekan dokumen OK | **Sesuai standar** | on-convention | |
| Retry | **Coba lagi** (galat), **Kirim ulang** (pengiriman) | Retry | Istilah teknis di kutipan kode dikecualikan. |
| Nilai enum | label dari `lib/labels.ts` | nilai mentah | Lihat "Enum" di bawah. |
| Waktu relatif | "baru saja", "5 menit lalu", "2 jam lalu", "kemarin", "3 hari lalu", lalu tanggal ("4 Okt") | "5m lalu", "5 mnt", "2j lalu", "baru saja lalu" | Lihat "Waktu relatif" di bawah. |

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
- Jangan menyalin peta ke berkas layar. Bila nama lama dibutuhkan, re-export dari berkas itu (`export { X } from "../lib/labels"`), seperti `screens/qa/qa-ui.ts` dan `screens/DalangStage.tsx`.
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
| `screens/AutoMergeCard.tsx` | "… menyisakan setelan basi." | Redesign Backlog · auto-merge |
| `screens/DocsWorkspace.tsx` | eyebrow "Cakupan SoT" | Redesign Docs |
| `screens/LogsPanel.tsx` | `aria-label="Device"` | Di luar wilayah Fase 2D (copy, bukan label dedupe) |
| `screens/PhasePlanPreview.tsx` | "Pratinjau ini memakai Setting hub ini…" | Keputusan istilah server pusat |
| `screens/ReconcileModal.tsx` | "Hub …" (4 kalimat) | Keputusan istilah server pusat |
| `screens/SettingsScreen.tsx` | "… SoT, ADR, plan, kode, riwayat git …" | Redesign Settings · lead |
| `screens/SyncButton.tsx` | "Instance ini hub", "… ke hub …" | Keputusan istilah server pusat |
| `screens/WebhookDocs.tsx` | "bisa basi", "Retry, pengiriman ganda…", "… retry setelah …" | Keputusan "Retry" → "Kirim ulang" |
| `ds/shell.tsx` | nav "Docs · SoT" | Berkas milik agen 3A (shell) |

Sisa di luar pemindai (bukan wilayah Fase 2D, tercatat untuk Fase 3):

- `notifications/NotificationBell.tsx`, `notifications/NotificationsArchiveModal.tsx`: waktu relatif sendiri (`5m lalu`, `2j lalu`). Ganti ke `relativeTime`.
- `portal/labels.ts`: peta kategori dan prioritas klien (`Prioritas tinggi`) masih berdiri sendiri. Pusatkan bila portal masuk cakupan.
- `screens/VpsChecklist.tsx`: enum mentah di tooltip baris (`${item.mode} · severity ${item.severity}`) dan lencana. Peta `VPS_ITEM_STATUS_LABEL` dan `VPS_SEVERITY_LABEL` sudah ada di `lib/labels.ts`, tinggal dipakai.
- `screens/SpecDocsModal.tsx` (`KIND_LABEL`), `screens/SettingsScreen.tsx` (`GROUP_LABEL`, `SOURCE_WORD`, `APPLY_WORD`), `screens/RemoteControlPanel.tsx` (`RELAY_LABEL`): peta lokal yang belum dipindah.

## Keputusan terbuka

- **Istilah server pusat.** `hub` dipakai di copy sinkronisasi dan konflik. Pilihan: "server pusat" (sudah dipakai di `RemoteControlPanel`) atau "Instance". Diputuskan sebelum Fase 3 Triase/Konflik.
- **"Retry".** Pilihan: "Coba lagi" untuk galat, "Kirim ulang" untuk pengiriman webhook.
- **Istilah "effort".** Dipertahankan sebagai istilah teknis (`Tanpa effort`, nilai effort per runtime). Belum dibahas sebagai copy.
