# ADR-0211 — Ketersediaan chat di proyeksi project klien dan skor kepatuhan VPS di daftar

- Status: diterima (tindak lanjut audit UI/UX 2026-10, butir 1 dan 12)
- Tanggal: 2026-10-11
- SPEC: —
- Terkait: ADR-0110 (allowlist proyeksi portal, butir 5 — tempat keputusan paparan) · ADR-0129 / 0130 (chat portal dan gerbangnya) · ADR-0195 (`portal:read`) · ADR-0050 (keputusan N/A/attest per item) · ADR-0202 (keputusan MCP wajib)

## Konteks

Dua hal di layar yang sama-sama menebak keadaan dari jalur yang salah:

1. **Tab "Tanya & ide" di portal.** `ClientPortal` memanggil `GET /portal/projects/:id/chat/sessions?limit=1`
   hanya untuk tahu apakah chat menyala. Saat chat mati route itu menjawab 404, dan probe itu terulang
   setiap klien berganti project. Ketersediaan sebenarnya sudah diketahui server saat daftar project dibuat.
2. **Skor kepatuhan di daftar VPS.** `VpsView` tak memuat skor, sehingga baris menampilkan "Skor —" sampai
   checklist dibuka di sesi itu. Padahal skornya sudah tersimpan di snapshot audit.

## Keputusan

### 1. `chatEnabled` pada proyeksi project klien

- `PortalProject` mendapat `chatEnabled: boolean`. Nilainya `chatOpen(Setting.portalChat.enabled, akses project)`
  dari `services/portal-chat/gate.ts` — **gerbang yang sama** dengan semua route `/portal/projects/:id/chat*`.
  Route tetap menjaga gerbangnya sendiri; flag hanya dipakai UI.
- Allowlist ADR-0110 butir 5: flag ini **satu-satunya** setelan chat yang terpancar ke klien. Ia boolean
  ketersediaan — model, effort, batas waktu, dan kuota tidak ikut. Kuota tetap di `GET …/chat`, yang hanya
  dibaca setelah tab dibuka.
- `ClientPortal` membaca `chatEnabled` dari project aktif. Tab "Tanya & ide" tampil bila `true`. Tab `tanya`
  yang tertinggal dari project lain jatuh ke Keluhan, sehingga `ChatPanel` tak pernah merender ke route 404.
- Tanpa probe, tanpa perubahan skema.

### 2. `scoreTotal` pada `VpsView`

- Field aditif opsional `scoreTotal?: number | null`. Sumbernya **snapshot audit terbaru** per VPS ditambah
  keputusan N/A/attest terkini, dihitung oleh `latestScores()` di `vps/checklist.ts` — pemetaan probe yang
  sama dengan checklist (`probeFromResults`), jadi angka di daftar dan di checklist identik.
- Listing tidak menjalankan audit dan tidak membuka SSH. `null` = belum ada snapshot di mesin ini.
- `GET /vps` dan siaran grup `vps` memanggil satu fungsi, `listVpsWithScore()` (`services/vps-list.ts`).
- Tanpa kolom baru dan tanpa migrasi. Nilainya turunan dan tak ikut sync.
- Layar VPS: state skor lokal dihapus; baris membaca `scoreTotal`. Checklist yang selesai dimuat memanggil
  muat ulang daftar (`onScore`), sehingga N/A/attest yang baru ditandai ikut tampil di baris.
- `scoreAt` tidak ditambahkan. `lastAuditAt` sudah ada di `VpsView` dan menandai audit yang sama.

### 3. Keputusan MCP (ADR-0202)

- `hanoman_portal_projects` (`portal:read`, mode `read`, `shape: raw`): **tanpa tool baru**. Field
  `chatEnabled` ikut lewat `shape: raw`; deskripsi tool menyebut artinya.
- `hanoman_vps_list` (`vps:read`, mode `read`, `shape: raw`): **tanpa tool baru**. Field `scoreTotal` ikut;
  deskripsi menyebut bahwa listing tak menjalankan audit dan menunjuk `hanoman_vps_audit` untuk menyegarkan.
- Tak ada route baru. Gerbang `mcp-coverage` tetap hijau.

## Konsekuensi

- Kontrak aditif. Klien yang tak membaca field baru tak terganggu.
- Skor di daftar sama dengan skor checklist di mesin yang menjalankan audit itu sendiri. Snapshot tak ikut
  sync: di instance yang tak pernah mengaudit VPS tersebut, skornya "—", sama dengan checklist yang juga
  kosong di sana. Menyinkronkan snapshot adalah keputusan terpisah.
- Flag chat dibaca sekali per request daftar project (satu `getSetting`), tanpa cache baru.

## Alternatif yang ditolak

- **Probe tetap.** Satu request 404 setiap ganti project saat chat mati, dan ketersediaan disimpulkan dari
  kegagalan request, bukan dari data.
- **Klien membaca `portalChat.enabled` sendiri.** Settings adalah permukaan operator (ADR-0110).
- **Skor dari kolom `Vps.audit`** (ikut sync). Dicoba lalu ditolak: di mesin yang tak mengaudit sendiri,
  daftar akan menampilkan angka sementara checklist di mesin yang sama kosong, jadi dua layar menunjukkan
  dua angka untuk VPS yang sama.
- **Kolom `Vps.score` tersimpan.** Ditolak: nilainya bisa basi, karena N/A/attest yang ditandai sesudah audit
  mengubah skor tanpa audit ulang. Kolom baru juga berarti migrasi tanpa kebutuhan.

## Gotcha

1. `rows.map(toPortalProject)` meneruskan index sebagai argumen kedua. Sekarang argumen `chatEnabled` wajib,
   jadi pemanggilnya memakai lambda eksplisit.
2. Snapshot terbaru diambil dengan `distinct: ["vpsId"]` + `orderBy createdAt desc`. Test memakai dua audit
   berbeda hasil untuk membuktikan yang terbaru yang dibaca.
3. Listing VPS tak boleh memanggil audit atau SSH. Test memastikan jumlah snapshot tak bertambah saat `GET`.
