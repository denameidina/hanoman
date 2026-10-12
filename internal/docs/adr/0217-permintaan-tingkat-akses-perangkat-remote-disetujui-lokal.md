# ADR-0217 — Permintaan tingkat akses ke perangkat remote, disetujui operator lokal (opsi C dari ADR-0216)

- Status: **diterima** — keputusan pemilik repo 2026-10-12: opsi C. Mewujudkan [ADR-0216](0216-grant-per-perangkat-remote-diusulkan.md) §Keputusan 1–3 dan mengubah status ADR-0216 menjadi "Diterima — opsi C".
- Tanggal: 2026-10-12
- SPEC: — (Audit UI/UX 2026-10, keputusan terbuka nomor 11)
- Terkait: **melanjutkan** [ADR-0216](0216-grant-per-perangkat-remote-diusulkan.md) (opsi C) dan [ADR-0210](0210-perangkat-tingkat-akses-lihat-kerja-tulis.md) §5. Bersandar pada [ADR-0165](0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) §3/§4/§5/§7, [ADR-0197](0197-mcp-kendali-jarak-jauh-relay-log-presence.md) (`relay:exec`/`remote:control` danger), [ADR-0202](0202-keputusan-mcp-wajib-untuk-setiap-api-baru.md) (keputusan MCP), dan [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) (pola persetujuan lokal).

## Konteks

ADR-0216 menganalisis grant per perangkat remote dan menyisakan tiga opsi untuk pemilik. Opsi A (relay `PUT /remote-control`) ditolak karena melanggar ADR-0165 §3/§4. Opsi B (pembatas di hub) menyisakan dua sumber kebenaran dan semantik "batasi". Opsi C (permintaan dengan persetujuan lokal) dipilih pemilik: hub boleh MEMINTA tingkat, tetapi grant baru lahir hanya dari tangan operator perangkat itu sendiri.

Kendala yang harus dijaga, dari ADR-0216 dan kode:
- Di perangkat tujuan, rute relay dijawab tanpa cookie (`app.ts` melewati gate cookie untuk `req.remote`); rute di luar allowlist `RELAY_ROUTES` ditolak (`relayRouteAllowed`); grant mati berarti socket relay tak pernah dibuka.
- Frame hello relay (`zHello`, `shared/src/relay.ts`) `.strict()` di hub lama: menambah field di hello akan membuat hub lama membuang seluruh hello dan menganggap perangkat offline. Maka kemampuan baru tak diumumkan lewat hello.
- Pemetaan capability `/devices/*` = `relay:exec` (danger) untuk SEMUA method; `/remote-control` = `remote:read`/`remote:control`.

## Keputusan

### 1. Permintaan hanya mengantre; grant tak pernah berubah karenanya

Hub mengirim lewat relay `POST /api/remote-control/access-requests` dengan body `{ tier }`, `tier ∈ { lihat, kerja, tulis }` (zod `.strict()`). Perangkat tujuan menyimpannya di **memori** (`services/remote-access-request.ts`) dengan status `pending` dan kedaluwarsa 10 menit. Tidak ada kolom, tabel, atau entri `Setting` baru, dan tanpa migrasi. Restart proses membuang antrean; itu aman karena tak ada yang berlaku sebelum disetujui. **Id permintaan acak** (`crypto.randomUUID()`), bukan penghitung: penghitung yang mulai dari nol setiap restart memakai ulang `ar1`, dan kartu lama bisa menyetujui permintaan yang tak dilihat operator (lihat §2, koreksi).

Pemetaan tingkat ke grant ada di `shared/src/relay.ts` (`REQUEST_TIER_GRANTS`) dan dipakai dua sisi: layar Perangkat (`remote-access-tier.ts`) dan penerapan persetujuan di server. Tingkat bertingkat: `lihat` ⊂ `kerja` ⊂ `tulis`, dan setiap tingkat memuat `sessions:read`, sehingga lolos `validateRemoteGrant`.

### 2. Persetujuan hanya dari sesi cookie lokal, dan menerapkan lewat jalur PUT yang ada

- `POST /api/remote-control/access-requests/:id/approve` dan `…/reject` (cookie-only). Handler menolak `req.remote` dan menuntut `req.user`. Relay tak bisa sampai ke sini karena rutenya di luar allowlist; agen dijawab `COOKIE_ONLY` oleh `capabilityForRoute`.
- Approve: (a) ambil keputusan secara atomik (`takeAccessRequest`: harus `pending` dan belum kedaluwarsa), (b) bila `Setting.remoteControl.enabled` mati → 409 dan permintaan kembali `pending`, (c) validasi `zRemoteControlPut` + `validateRemoteGrant`, lalu (d) panggil `updateRemoteControl` — fungsi yang sama dengan `PUT /api/remote-control` — dengan `enabled: true` dan grant tingkat. Bila (d) gagal, keputusan dikembalikan ke `pending`.
- Permintaan yang menurunkan tingkat juga memerlukan persetujuan. Tak ada jalan pintas.
- Persetujuan mengganti seluruh grant dengan tingkat yang diminta. Dialog konfirmasi di layar menyebut itu.
- **Body approve WAJIB `{ tier, from }`** (`zAccessRequestApprove`, `.strict()`): tingkat dan hub yang DILIHAT operator di kartu. Server mencocokkannya dengan permintaan tertunda (`takeAccessRequest(…, expect)`). Id yang tak ada, atau tingkat/hub yang tak cocok, → **409 "Permintaan berubah, periksa lagi"** tanpa mengubah keputusan atau grant. Body tanpa `tier`/`from` → 400.
- Kartu di layar mengirim `tier` dan `from` dari baris yang dikonfirmasi, dan menangani 409 dengan memuat ulang daftar. Pesan server dipakai bila ada, selain itu pesan baku di atas.

**Koreksi (2026-10-12, peninjauan keamanan).** Versi awal mengklaim "restart aman". Itu benar untuk grant, tetapi tidak untuk kartu: id `ar1` dipakai ulang setelah restart, sehingga persetujuan dengan id lama bisa menerapkan tingkat yang tak pernah dilihat operator. Diperbaiki dengan id acak dan pencocokan `tier`/`from` di atas. Id saja tidak cukup, karena id yang dipakai ulang bisa menunjuk permintaan lain. Tingkat dan hub memastikan yang diterapkan sama dengan yang dibaca operator.

**Gate saat master mati.** Untuk dua rute permintaan (`POST`/`GET` koleksi), relay yang masuk ke perangkat dengan `enabled: false` dijawab **403 `kendali jarak jauh mati`**, bukan 401 (`services/relay/gate.ts`). Hub meneruskan status apa adanya, dan klien membaca 401 sebagai sesi habis lalu melempar operator ke Login. Rute lain tetap 401. Sisi hub (`routes/device-access-requests.ts`) juga memetakan 401 yang datang dari perangkat ke **502 `device-unauthorized`** dengan alasan yang sama.

### 3. Identitas peminta dari kanal relay, bukan dari payload

`req.remote.actor` (klaim aktor di header relay yang diset hub dari principal-nya) menjadi `from` (= `hubOrigin`) dan `requestedBy` (= email). Body hanya membawa `tier`. Field lain ditolak 400.

### 4. Pembatas: satu tertunda, tiga per 10 menit, riwayat 10

- Satu permintaan tertunda (belum diputuskan dan belum kedaluwarsa) sekaligus. Relay = satu hub, jadi ini juga "maks 1 per hub peminta". Permintaan kedua → 409.
- `ACCESS_REQUEST_MAX_PER_WINDOW = 3` per `ACCESS_REQUEST_WINDOW_MS = 10 menit`. Permintaan ke-4 → 429 dengan `retry-after`.
- Kedaluwarsa `ACCESS_REQUEST_TTL_MS = 10 menit`. Brief memilih 10 menit; rekomendasi ADR-0216 (24 jam) tidak diambil.
- Riwayat dibatasi 10 entri. Yang tertua dibuang lebih dulu.

### 5. Allowlist relay diperluas HANYA untuk pesan ini

`RELAY_ROUTES` (`shared/src/relay.ts`) mendapat dua entri: `POST` dan `GET` untuk `/remote-control/access-requests` (koleksi). Persetujuan dan penolakan tetap di luar allowlist. Allowlist tetap deny-by-default. `isAccessRequestRoute` dipakai gate untuk rute ini saja: ia dijawab **tanpa** capability grant (permintaan tak mengubah apa pun, dan hub dengan grant kosong tetap boleh meminta Lihat). Cabang ini berada SETELAH `relayRouteAllowed` dan cek grant menyala.

### 6. Kompatibilitas antarversi tanpa mengubah hello

Hello tak berubah. Perangkat lama menolak rute baru di allowlist-nya dengan `403 relay route not allowed`. Hub memetakan galat itu ke `409 { relay: "unsupported-message" }` dengan pesan "perangkat ini belum mendukung permintaan tingkat akses; perbarui hanoman di perangkat itu". Itu bukan 403 yang membingungkan dan tidak memutus relay.

### 7. Sisi hub: dua endpoint, dua tool MCP, keduanya di bawah relay:exec

- `POST /api/devices/:deviceId/access-requests` (kirim) dan `GET /api/devices/:deviceId/access-requests` (status). Keduanya diteruskan lewat `requestRelay` (`routes/device-access-requests.ts`). Capability mengikuti `/devices/*` = `relay:exec`. Principal = cookie manusia atau agen ber-`relay:exec`.
- Keputusan MCP (ADR-0202): dua tool **dibuat**, bukan dikecualikan:
  - `hanoman_device_access_request` — danger, `relay:exec`, `POST /devices/:id/access-requests`.
  - `hanoman_device_access_requests` — danger, `relay:exec`, `GET /devices/:id/access-requests`. Mode danger, bukan read: `relay:exec` adalah satu capability untuk SEMUA method (ADR-0197), dan kontrak katalog menuntut capability danger bermode danger. Invariant test "GET ⇒ read" diberi pengecualian eksplisit untuk `relay:exec`, dengan rujukan ke ADR-0197.

### 8. Antarmuka

- **Hub (Klien › Perangkat):** tombol "Minta tingkat…" per perangkat remote. Mati dengan alasan bila offline, protokol tak cocok, atau kendali belum diizinkan. Panel memilih tingkat, mengirim, dan menampilkan status (menunggu persetujuan di perangkat itu, disetujui, ditolak, kedaluwarsa). Status dimuat saat dibuka dan setelah kirim, tanpa polling. Baris "Tingkat akses yang dilaporkan" (opsi D) tetap ada.
- **Perangkat ini (kartu RemoteAccessCard):** bagian "Permintaan dari server pusat" hanya memuat permintaan `pending`, dengan "Perangkat <hub> meminta tingkat <Kerja>", Setujui (lewat konfirmasi yang menyebut dampak tiap grant), dan Tolak. Setujui mati bila master kendali mati. Daftar dimuat ulang saat jendela kembali fokus, bukan polling (ADR-0039).

## Keputusan terhadap ADR-0165 §4 (grant LOCAL-only): tidak dilanggar, dan mengapa

ADR-0165 §4 menyatakan bahwa grant ditulis lewat `GET|PUT /api/remote-control` dan bahwa hub tak pernah bisa menulisnya. ADR ini tidak menambah penulis grant dari jaringan:
- Hub tak menulis grant. Ia hanya menaruh **permintaan** yang tak berlaku. Grant berubah hanya lewat `updateRemoteControl`, dan satu-satunya pemanggil baru-nya adalah `approve`, yang hanya bisa dipanggil sesi cookie lokal (`req.user` ada, `req.remote` tak ada).
- `setting` tetap tak masuk `SYNCED`. `PUT /api/settings` tetap tak menyentuh `remoteControl` (ADR-0165 §4).
- Relay `PUT /remote-control` tetap ditolak. Ini bukan opsi A.
- ADR-0165 §3 (principal `remote` hanya in-process) tak berubah. §5 (allowlist deny-by-default) tetap, dengan dua entri yang disebut eksplisit di atas. §7 (pencabutan seketika) tetap: approve memanggil `refreshRelayClient` melalui `updateRemoteControl`.

Yang berubah adalah tafsir "pengelolaannya lewat PUT": kini ada jalur kedua yang juga cookie-only, yaitu persetujuan. ADR-0165 §4 perlu dibaca bersama ADR ini.

## Alternatif yang ditolak

- **Opsi A (relay PUT):** ditolak ADR-0216. Hub menjadi pengubah grant tanpa tangan lokal.
- **Opsi B (pembatas hub):** tak dipilih pemilik.
- **Permintaan disimpan di `Setting` JSON:** butuh kunci baru di `zSettings` dan daftar kunci yang dipertahankan `PUT /settings` (gotcha ADR-0216). Memori cukup, karena permintaan hidup 10 menit dan tak perlu bertahan melewati restart.
- **Menambah field `features` di hello:** merusak hub lama (hello `.strict()`). Ditolak; deteksi dilakukan lewat jawaban 403 allowlist.
- **Mengecualikan tool dari MCP (UNWRAPPED/COOKIE_ONLY) untuk hub:** ADR-0202 mengutamakan tool. Permintaan tingkat berguna bagi agen operator, dan dampaknya dibatasi persetujuan lokal.

## Konsekuensi

**Baik.** Hub bisa meminta tingkat tanpa menyentuh grant perangkat tujuan. Persetujuan memakai pagar yang sudah ada (zod, validasi grant, `refreshRelayClient`, audit `grant.changed` beraktor cookie). Tanpa skema dan tanpa migrasi.

**Buruk.**
- Kartu persetujuan adalah permukaan baru yang bisa dibanjiri hub yang jebol. Dibatasi 1 tertunda dan 3 per 10 menit, tetapi operator yang lelah bisa menyetujui permintaan yang keliru. Dialog konfirmasi menyebut host dan dampak, tetapi host dan `requestedBy` adalah klaim hub yang tak bisa diverifikasi perangkat.
- Agen dengan `relay:exec` di hub bisa membuat permintaan. Ia tak bisa menyetujuinya.
- Antrean hanya di memori: restart menghapus permintaan yang belum diputuskan. Hub melihatnya sebagai kosong, dan operator harus meminta ulang.

## Residu & risiko keamanan yang tersisa

1. **Klaim identitas.** `from` dan `requestedBy` berasal dari hub. Perangkat percaya pada hub yang ia sambungi, sebagaimana ADR-0165 §3 mengatur. Operator yang tak memercayai hub-nya tak boleh menyalakan kendali.
2. **Rekayasa sosial atas operator.** Pembatas menurunkan volume, tidak menghilangkan kemungkinan persetujuan keliru. Dialog konfirmasi adalah lapis utamanya.
3. **Persetujuan mengganti grant.** Tingkat yang disetujui menggantikan seluruh grant, termasuk grant "Khusus" yang dibuat operator. Dialog menyebut ini; tak ada penggabungan.
4. **Antrean memori.** Tak bertahan lewat restart. Ini sengaja, dan dampaknya hanya permintaan yang perlu diulang.
5. **Bukti lintas versi.** Deteksi perangkat lama dibuktikan lewat mock 403 dan fakta allowlist, bukan lewat dua versi hanoman nyata yang saling bicara.
6. **Pagar permintaan.** Pembatas (1 tertunda, 3 per 10 menit) tidak menggantikan validasi. Hub yang berbohong tetap bisa mengirim sampai pembatas itu.

## Dampak MCP (ADR-0202)

- `hanoman_device_access_request`, `hanoman_device_access_requests`: tool danger di balik `relay:exec` (§7). Didaftarkan di `docs/agent-integration.md`.
- `/api/remote-control/access-requests` (POST/GET relay dan GET cookie) dan `…/:id/approve|reject`: `COOKIE_ONLY` di `capabilityForRoute`, dengan alasan "gerbang keputusan manusia" (persetujuan) dan "principal relay tanpa capability" (POST/GET). Tidak ada entri di `UNWRAPPED`.

## Bukti

- **Peninjauan keamanan (2026-10-12):** `remote-access-request.route.test.ts` (22 test) menambah: approve dengan tingkat atau hub yang tak dilihat → 409 "Permintaan berubah, periksa lagi" tanpa mengubah grant, dan body tanpa `tier`/`from` atau dengan field asing → 400; id berupa UUID dan tak dipakai ulang setelah restart (modul dimuat ulang); approve dengan id yang tak ada → 409; hub lain menerima 409 tanpa `request`; kendali mati → 403 `kendali jarak jauh mati` (relay end-to-end dan gate, PATCH tetap 401). `device-access-requests.route.test.ts` (11 test): 401 perangkat → 502 `device-unauthorized`. `remote-access-request.relay.test.ts` mengirim `tier`/`from` dari kartu. `spec-reviewed.route.test.ts` (15 test): sync dari peer versi lama mengosongkan `reviewedAt` untuk stage bukan-done, dan item done tak tersentuh (ADR-0218). Frontend `access-request.test.tsx` (11 test): approve mengirim `{tier, from}`; 409 memuat ulang daftar dan menampilkan pesan baku.
- **Server, sisi tujuan** (`server/test/remote-access-request.route.test.ts`, 22 test sesudah peninjauan): relay POST pending tanpa mengubah grant; permintaan kedua 409; relay tak bisa approve/reject (403 allowlist); POST cookie lokal ditolak; 400 untuk tingkat asing; relay GET difilter per hub; gate grant-free; setujui menerapkan tingkat lewat jalur PUT dan audit beraktor cookie; keputusan kedua 409; menurunkan tingkat butuh persetujuan; tolak tak mengubah grant; kendali mati → 409 dan permintaan kembali pending; kedaluwarsa 10 menit; agen `remote:control` → 403 `cookie session required`; rate limit 429 + jendela pulih; kontrak COOKIE_ONLY dan allowlist; galat DB di tengah persetujuan mengembalikan permintaan ke pending (regresi untuk jalur `getSetting` yang sempat berada di luar `try`).
- **Server, sisi hub** (`server/test/device-access-requests.route.test.ts`, 10 test): tanpa auth 401; perangkat tak dikenal 404; tingkat asing 400 sebelum relay; aktor cookie diteruskan; perangkat versi lama → 409 `unsupported-message`; 403 non-allowlist diteruskan apa adanya; offline 503, timeout 504; GET diteruskan; agen tanpa `relay:exec` 403, dengan 201.
- **Relay nyata, satu proses** (`server/test/remote-access-request.relay.test.ts`, 2 test): socket relay sungguhan. Hub meminta Kerja → pending di perangkat; grant tetap; relay lewat `…/relay/…/approve` ditolak 403; persetujuan lokal menerapkan Kerja dan relay dibuka ulang membawa `backlog:write`; perangkat offline → 503.
- **Shared** (`shared/src/relay.test.ts` +4 blok; `mcp-catalog.admin.test.ts` jumlah 22 → 24 dan invariant relay:exec): allowlist, `isAccessRequestRoute`, tingkat bertingkat lolos `validateRemoteGrant`, zod.
- **Regresi** (`mcp-coverage`, `mcp-capability`, `agent-capabilities`, `relay-gate`, `relay-hub`, `relay-dispatcher`, `relay-client`, `remote-control.*`, `devices-relay.*`, dan lainnya): lulus.
- **Frontend** (`src/test/access-request.test.tsx`, 10 test; plus `remote-access-tier`, `clients-remote-access`, `clients-screen`, `app-state-persist`, `RemoteControlPanel`): lulus.
- **Dua instance nyata (curl, port 8794 hub dan 8795 perangkat X, HOME terpisah, tmux socket khusus; dijalankan SEBELUM approve mewajibkan body `{tier, from}` dan sebelum galat 401/403 dipetakan ulang, jadi belum diulang setelah peninjauan keamanan):** perangkat X tersambung ke hub lewat device token dan relay sungguhan. Hasil: hub `POST /devices/:id/access-requests` → 201 pending; X `GET` menampilkannya; hub `GET` tetap menampilkan pending (grant X tak berubah); X menyetujui → 200, grant = Kerja (`sessions:read, backlog:read, ide:read, backlog:write, sessions:spawn`), relay X dibuka ulang, status di hub `approved`; permintaan kedua saat pending → 409; hub memanggil `…/relay/…/approve` dan `…/reject` → 403 `relay route not allowed`; kendali X mati lalu setujui → 409 dan tetap pending; agen ber-`remote:control` → 403 `cookie session required` di approve dan list (akses agen diaktifkan langsung di DB uji); tolak → grant tak berubah; permintaan ke-4 dalam 10 menit → 429 dari perangkat, diteruskan hub.
- **Yang TIDAK terbukti secara nyata:** perangkat versi lama (sebelum ADR-0217). Deteksi 409 `unsupported-message` dibuktikan lewat mock 403 `relay route not allowed` dan fakta allowlist, bukan dengan build lama. Header `retry-after` dari perangkat tak diteruskan hub (relay tak membawa header); pesan galat tetap utuh di body.
- Typecheck: `shared`, `server`, dan `src` exit 0 pada akhir pekerjaan. Indeks docs: `hanoman docs index --check` → `index ok`.
