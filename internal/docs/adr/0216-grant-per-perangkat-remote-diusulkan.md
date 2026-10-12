# ADR-0216 — Grant per perangkat remote: analisis, batas, dan opsi

- Status: **Diterima — opsi C** (keputusan pemilik repo 2026-10-12; diwujudkan di [ADR-0217](0217-permintaan-tingkat-akses-perangkat-remote-disetujui-lokal.md)). Opsi D sudah diterapkan di UI (§ Penerapan opsi D). Opsi B tidak diambil.
- Tanggal: 2026-10-12
- SPEC: — (Audit UI/UX 2026-10, keputusan terbuka nomor 11)
- Terkait: **melanjutkan** [ADR-0210](0210-perangkat-tingkat-akses-lihat-kerja-tulis.md) §5 (batas "bukan grant per perangkat remote"). Bersandar pada [ADR-0165](0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) §3/§4/§5/§7, [ADR-0197](0197-mcp-kendali-jarak-jauh-relay-log-presence.md), [ADR-0202](0202-keputusan-mcp-wajib-untuk-setiap-api-baru.md), [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) (approval peluncuran), dan [ADR-0147](0147-kanal-presence-di-socket-sync.md) (presence).

## Konteks

Layar Perangkat (ADR-0210) menampilkan satu selektor Lihat · Kerja · Tulis untuk grant **mesin ini**. Brief menanyakan grant per perangkat remote. Telusuran model data dan auth menemukan hal berikut. Semuanya dari kode, bukan dari uji runtime.

1. **Grant ditulis hanya untuk mesin ini.** Grant berada di `Setting.data.remoteControl` (kolom Json baris `Setting` id 1, tanpa tabel grant). `PUT /api/remote-control` menulisnya lewat `updateRemoteControl` (`server/src/services/remote-control.ts`). Route itu tak punya parameter perangkat.
2. **Tingkat perangkat remote dideklarasikan oleh perangkat itu sendiri.** Socket relay perangkat X mengirim `hello.capabilities` dari `Setting.remoteControl` miliknya (`server/src/services/relay/client.ts`). Hub menyimpannya di memori sebagai `Link.control` (`relay/hub.ts`, `relayControlFor`), lalu presence menampilkannya sebagai `control` (`services/presence/view.ts`). Nilai itu hilang saat socket putus atau hub restart.
3. **Hub tidak menegakkan tingkat X.** Titik di hub hanya memeriksa keberadaan. `server/src/routes/devices-relay.ts` (REST) memeriksa `deviceToken` ada dan `revokedAt` null, lalu `requestRelay` menjawab 503 bila offline. Cabang WS memeriksa `relayControlFor` non-null. `services/ws-admission.ts` `revalidateWsPrincipal`, cabang `remote`, memeriksa `relayControlFor !== null`. Tidak ada satu pun yang membaca `capabilities`.
4. **Tingkat ditegakkan di perangkat X.** `services/relay/gate.ts` `admitRemoteRequest` memanggil `checkAgentCapability` terhadap grant X. `services/relay/dispatcher.ts` `handleOpen` memakai `remoteCapabilityFor` dan `relayRouteAllowed`. Allowlist `RELAY_ROUTES` (`shared/src/relay.ts`) membatasi permukaannya. Semuanya memakai grant lokal X.
5. **Model data tak punya tempat per perangkat.** `DeviceToken` berisi `{id, userId, name, tokenHash, createdAt, lastSeenAt, revokedAt}`, tanpa kolom tingkat. `Setting` adalah satu baris Json.

**Koreksi terhadap premis brief:** di hub **tidak ada** titik yang sudah memeriksa tingkat akses perangkat remote. Titik itu ada di perangkat remote sendiri (butir 4).

**Gotcha:** `PUT /api/settings` menyusun ulang `data` dari daftar kunci yang dipertahankan (`server/src/routes/settings.ts`: `remoteControl`, `logShipping`, `logRetention`). Kunci Setting baru harus masuk daftar itu dan `zSettings` (`shared/src/entities.ts`). Jika tidak, PUT /settings membuangnya.

## Masalah yang menghalangi wujud yang aman

**Jalur "hub mengatur grant X" hanya ada lewat relay**, yaitu meneruskan `PUT /api/remote-control` ke X. Jalur itu tidak bisa dibuat aman:

- **Bertentangan dengan ADR-0165 §4.** Grant bersifat LOCAL-only. Opsi "grant di-sync dari hub" sudah ditolak, karena hub akan bisa menyalakan RCE di setiap klien.
- **Melanggar syarat "perangkat remote tak bisa menaikkan hak sendiri".** Aktor di relay adalah **klaim hub** yang tak bisa diverifikasi X (ADR-0165 §3). X tak punya cara membedakan operator hub yang berhak dari yang tidak.
- **Membuka route baru di allowlist relay.** Agen hub yang memegang `relay:exec` (danger, ADR-0197) ikut mencapainya.

Karena itu tidak ada perubahan kode. Brief meminta berhenti bila tak bisa dibuat aman.

## Opsi

**A. Relay `PUT /remote-control` ke perangkat X.** Ditolak, lihat di atas.

**B. Pembatas di hub, disimpan di Setting.** Hub menyimpan `remoteDevices[deviceId].capabilities`. Tingkat efektif = grant X ∩ batas hub. Penegakan terpusat di `devices-relay.ts` (REST dan WS). Tanpa skema baru dan tanpa mengubah X.
- Kelemahan: hanya mempersempit, tidak memberi. Ada dua sumber kebenaran (grant X dan batas hub). Label "Lihat/Kerja/Tulis" menyesatkan kecuali diberi nama "Batasi server ini".
- Bertabrakan dengan "default tetap paling ketat". Perangkat tanpa entri harus memakai salah satu dari dua pilihan. (1) Tanpa batas tambahan, yaitu perilaku sekarang: StartSessionModal, "Lihat (baca saja)", dan relay agen tetap berjalan. (2) Lihat, yang memutus alur tulis yang sudah berjalan tanpa migrasi. Keduanya butuh keputusan pemilik.

**C. Permintaan tingkat dengan persetujuan lokal.** Hub mengirim permintaan lewat relay ke X. X menyimpannya di Setting (`remoteControlRequests`, antrean kecil dengan batas dan kedaluwarsa). Operator lokal X menyetujui atau menolak di kartu RemoteAccessCard. Persetujuan memanggil `PUT /remote-control` yang sudah ada, sehingga pagar ADR-0197 tetap berlaku. Polanya meniru approval peluncuran (ADR-0117).
- Tak ada grant yang berpindah tanpa tangan lokal. Permintaan itu sendiri tidak mengubah apa pun.
- Biaya: route baru di X. Route permintaan bisa dijangkau relay. Route persetujuan COOKIE_ONLY dengan alasan "gerbang keputusan manusia" (ADR-0202 #2). Perlu perluasan allowlist relay, UI persetujuan di X, dan degradasi antarversi (ADR-0087): X yang lebih lama menjawab 404 untuk route baru.

**D. Status quo, ditambah tampilan tingkat yang dideklarasikan.** Di baris Perangkat, tampilkan `tierOf(control.capabilities)` (`src/src/screens/remote-access-tier.ts`) sebagai teks baca-saja, misalnya "Izin yang dilaporkan perangkat ini ke server ini". Pengubahan tetap di perangkat itu. Tanpa API baru dan tanpa risiko keamanan baru.

**Temuan terkait (dari kode, belum diuji runtime).** `openBlockReason` di `src/src/screens/ClientsScreen.tsx` hanya memeriksa `d.control` (ada atau tidak), bukan tingkatnya. Perangkat yang mendeklarasikan `enabled: true, capabilities: []` tetap menampilkan "Lihat (baca saja)" aktif. Permintaannya kemudian ditolak X dengan 403 `capability required`. Opsi D perlu memperbaiki ini.

## Keputusan yang diminta

1. Pilih jalur. Rekomendasi: **D** sekarang, lalu **C** bila pemilik ingin mengatur dari hub dengan persetujuan lokal. **B** hanya bila pemilik menerima semantik "batasi". A tidak dipertimbangkan lagi.
2. Jika B: nilai default untuk perangkat tanpa entri. Rekomendasi: tanpa batas tambahan, dicatat sebagai pengecualian eksplisit terhadap "default paling ketat".
3. Jika C: masa berlaku permintaan (rekomendasi 24 jam) dan batas antrean (rekomendasi 10).

## Dampak MCP (ADR-0202)

Analisis ini tidak menambah API, sehingga tidak ada keputusan MCP baru. Setiap opsi B atau C yang menambah route wajib punya keputusan MCP dalam commit yang sama. B dapat berupa tool danger di balik `remote:control`. Persetujuan C tetap COOKIE_ONLY dengan alasan spesifik.

## Konsekuensi

- Analisis tidak mengubah skema, kode, atau kontrak. Penerapan opsi D (§ Penerapan opsi D) hanya mengubah UI: tanpa endpoint, tanpa kolom, dan tanpa perubahan `shared`.
- ADR-0210 §5 tetap berlaku sebagai keadaan sekarang untuk pengubahan grant. Yang berubah: perangkat remote kini tampil dengan tingkat yang dilaporkannya, dan baca-saja.
- Setiap implementasi B atau C perlu tes negatif (perangkat remote tak bisa mengubah grant sendiri, dan PUT /remote-control lewat relay tetap ditolak allowlist) serta tes positif (batas hub memangkas relay, dan persetujuan berlaku lewat pagar yang ada).

## Penerapan opsi D

Dicatat setelah keputusan pemilik untuk opsi D. Opsi B dan C tidak diterapkan.

- **Baris "Tingkat akses" per perangkat remote** (`src/src/screens/ClientsScreen.tsx`, `ReportedAccessLine`): tingkat yang dilaporkan perangkat itu lewat `control` (hello relay), dengan penanda "Diatur di perangkat itu" dan penjelasan bahwa pengubahnya hanya di perangkat itu. Tanpa tombol ubah. Perangkat lokal tidak mendapat baris ini karena izinnya sudah di kartu di bawah daftar.
- **Pemetaan keadaan** (`reportedAccessOf`, murni): Lihat/Kerja/Tulis dari `tierOf`; grant di luar tiga tingkat = Khusus, dengan rincian; `capabilities` kosong = Nonaktif; tanpa `control` = Tidak diketahui; `protocol-mismatch` = Tidak diketahui dengan alasan berbeda. Tanpa `control` tidak dianggap Nonaktif, karena server tak bisa membedakan kendali yang dimatikan dari relay yang belum tersambung.
- **Perbaikan `openBlockReason`** (bug yang dicatat di § Opsi): kini memeriksa `sessions:read`, syarat minimum yang dibutuhkan "Lihat (baca saja)" (terminal dan WS baca-saja menuntutnya; setiap tingkat memuatnya). Perangkat dengan `capabilities: []` (kendali aktif, tanpa grant) dan perangkat tanpa `sessions:read` kini menonaktifkan tombol dengan alasan. Sebelumnya tombol tetap aktif lalu ditolak 403.
- **Copy** di `src/src/lib/labels.ts` (`REPORTED_ACCESS_*`, `OPEN_BLOCK_*`) dan baris glosarium "Izin yang dilaporkan perangkat remote".
- **Tes**: `src/test/clients-remote-access.test.tsx` (16 tes: pemetaan keadaan, alasan tombol per cabang, dan baris tanpa kontrol ubah).

Batas yang tersisa:

- Tingkat yang tampil adalah laporan dari perangkat, bukan nilai yang dijamin server. Laporan itu hilang saat socket relay putus atau hub restart (§ Konteks butir 2). Ini sengaja: UI tidak menyimpannya.
- Tombol hanya memeriksa `sessions:read`. Tab Dokumen dan IDE di `RemoteInstanceView` masih memerlukan `backlog:read` dan `ide:read`, dan gagal sendiri bila perangkat tak memberinya. Pemeriksaan per tab tidak ada di berkas ini.
- Tidak ada endpoint, kolom, atau kontrak baru, jadi tidak ada keputusan MCP baru (ADR-0202).
- Keputusan **B** (batas di hub) dan **C** (permintaan tingkat dengan persetujuan lokal) tetap milik pemilik repo.

## Bukti

- Kode: butir Konteks 1–5 dan temuan `openBlockReason`, dengan berkas dan fungsi yang disebut di atas.
- Tes server yang berkaitan dengan remote-control dan relay dijalankan sebelum analisis: 8 berkas, 211 tes lulus (`server/test/{remote-control.route,remote-control.relay,relay-gate,relay-hub.route,relay-hub,relay-client,admin-surface.route,agent-capabilities}.test.ts`, dengan `TEST_DATABASE_URL` terisolasi). `shared/src/relay.test.ts` dan `src/src/screens/RemoteControlPanel.test.tsx` tidak dijalankan.
- Typecheck: `shared` dan `src` lulus. `server` gagal dengan dua galat TS2300 `SpecReview` di `src/services/spec-review.ts`. Berkas itu termodifikasi sesi lain yang belum di-commit di worktree yang sama, dan bukan bagian dari analisis ini.
