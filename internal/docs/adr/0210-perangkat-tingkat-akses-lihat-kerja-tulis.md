# ADR-0210 — Perangkat: selektor tingkat akses Lihat · Kerja · Tulis di atas grant kendali lokal

- Status: Diterima
- Tanggal: 2026-10-11
- SPEC: Audit UI/UX 2026-10 · Fase 3G (tanpa nomor SPEC; keputusan dari audit)
- Lanjutan: [ADR-0216](0216-grant-per-perangkat-remote-diusulkan.md) (Diusulkan) menganalisis grant per perangkat remote yang belum tercakup di sini (§5). ADR ini tidak berubah.
- Terkait: **memetakan** grant kendali jarak jauh lokal dari **0165** §4 (grant LOCAL-only di `Setting.data.remoteControl`) dan **0197** (`remote:read` / `remote:control`) tanpa mengubah kontraknya. Menegakkan **0147** (daftar perangkat dan presence), **0110** (portal klien tetap terpisah), **0115** (tingkat adalah izin di server, bukan preferensi tampilan), dan **0202** (API tak berubah, jadi tak ada keputusan MCP baru).

## Konteks

Tab Perangkat di Klien memuat daftar switch grant, satu per kapabilitas. Audit mencatat "lima switch grant (Tulis/Mulai
sesi satu klik)" dan "mematikan Lihat menghapus semua grant tanpa peringatan". Padahal grant di server bertingkat
secara implisit: Tulis berisi Kerja, dan Kerja berisi Lihat. Pengguna tak punya cara membaca hubungan itu dari
daftar switch.

## Keputusan

### 1. Satu selektor, tiga tingkat

Selektor `RadioGroup` (DS) dengan label "Tingkat akses" menggantikan daftar switch grant. Tingkatnya bertingkat
(`src/src/screens/remote-access-tier.ts`, `TIER_GRANTS`):

| Tingkat | Grant | Yang bisa dilakukan server pusat |
|---|---|---|
| **Lihat** | `sessions:read`, `backlog:read`, `ide:read` | melihat sesi, backlog, dan IDE; hanya baca |
| **Kerja** | Lihat + `backlog:write`, `sessions:spawn` | memulai sesi agen dan menandai item selesai |
| **Tulis** | Kerja + `sessions:write` | mengetik ke terminal, menghentikan sesi, menjawab dialog agen |

### 2. Pemetaan murni dengan kasus "Khusus"

`tierOf(caps)` mengembalikan tingkat yang persis cocok. Daftar grant yang tidak cocok dengan satu tingkat (mis.
`sessions:write` tanpa `sessions:spawn`) tampil sebagai **Khusus**, dengan rincian grant yang bisa dilipat. Opsi
"Khusus" di selektor hanya tampil dan tidak bisa dipilih. Tanpa grant sama sekali berarti "kosong". Master switch
aktif/nonaktif tetap terpisah (`toggleMaster`).

### 3. Konfirmasi di tempat yang berisiko

- Naik ke tingkat yang menambah grant berisiko (`backlog:write`, `sessions:spawn`, `sessions:write`), dan setiap
  penurunan yang mencabut grant, lewat `useConfirm`. Dialognya menampilkan kalimat dampak per grant (`GRANT_IMPACT`).
- Naik ke Lihat saja tidak memunculkan dialog.

### 4. API tidak berubah

Selektor hanya menerjemahkan. Ia memanggil `PUT /api/remote-control` dengan daftar grant yang sama seperti sebelumnya.
Invarian server "grant tulis butuh `sessions:read`" dijaga oleh pemetaan, bukan oleh balasan 400.

### 5. Batas: grant lokal, bukan per perangkat remote

Selektor mengatur **izin server pusat untuk perangkat ini**, yaitu grant lokal. Layar ini tidak punya selektor untuk
perangkat remote. Keputusan grant per perangkat remote tetap terbuka (audit, keputusan terbuka nomor 11).

### 6. Letak

- Tab **Perangkat** di Klien: kartu "Izin server pusat untuk perangkat ini" (`RemoteAccessCard`).
- Pengaturan › Kendali jarak jauh: panel yang sama (`RemoteControlPanel`), ditambah tiga toggle lajur log.

## Alternatif yang ditolak

1. **Lima switch grant tetap.** Ditolak: audit mencatat switch "Tulis" dan "Mulai sesi" bisa diaktifkan dalam satu klik,
   dan mematikan Lihat menghapus semua grant tanpa peringatan.
2. **Field `tier` baru di server.** Ditolak: itu menambah kontrak API, sehingga ADR-0202 terpicu dan butuh keputusan MCP
   baru, padahal pemetaannya bisa murni di klien dan diuji langsung.
3. **Tingkat disimpan sebagai preferensi `ui-state`.** Ditolak: tingkat adalah izin yang berlaku di server
   (`Setting.data.remoteControl`), bukan preferensi tampilan (ADR-0115).
4. **Grant per perangkat remote sekarang.** Ditunda: ADR-0165 menjadikan grant LOCAL-only, dan API hanya mengelola grant
   lokal. Membukanya menyentuh ADR-0165 §4 dan jalur relay, jadi perlu ADR sendiri.

## Konsekuensi & gotcha

- Agen (MCP) memakai grant yang sama: `remote:read` untuk membaca, `remote:control` (danger) untuk mengubah, dan grant
  yang diberikan agen harus ⊆ capability pemanggil (ADR-0197). Selektor di UI tidak mengubah aturan itu.
- `GRANT_IMPACT` berbicara dari sisi server pusat. Mengubah kalimatnya berarti mengubah dialog konfirmasi.
- Tingkat "Khusus" hanya informatif. Jika server membawa grant di luar tiga tingkat, pengguna melihat rincian dan bisa
  menimpanya dengan memilih tingkat, dengan konfirmasi bila perlu.
- Tes: `src/test/remote-access-tier.test.ts` (pemetaan, `tierOf`, `grantDiff`, `needsConfirm`),
  `src/test/clients-screen.test.tsx`, `src/src/screens/RemoteControlPanel.test.tsx`.

## Bukti

- Commit: `e5d44eac` (redesign Klien: `remote-access-tier.ts`, `RemoteControlPanel.tsx`, `ClientsScreen.tsx`),
  `fce3210e` (perbaikan P0 dan quick win Fase 1, yang juga menyentuh `RemoteControlPanel.tsx`).
- Berkas: `src/src/screens/remote-access-tier.ts`, `src/src/screens/RemoteControlPanel.tsx` (`RemoteAccessSection`,
  `RemoteAccessCard`, `RemoteControlPanel`), `src/src/screens/ClientsScreen.tsx` (tab Perangkat · Akun · Log).
- Dokumen: [frontend-implementation § Fase 3G](../frontend/frontend-implementation.md),
  [ADR-0165](0165-kendali-jarak-jauh-hub-lewat-socket-relay.md), [ADR-0197](0197-mcp-kendali-jarak-jauh-relay-log-presence.md).
