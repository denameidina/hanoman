# ADR-0165 — Kendali jarak jauh hub → klien: socket relay kedua dari klien, route yang sudah ada, grant LOCAL-only

**Status:** diterima (SPEC-1215, fase Spec) · 2026-09-15 · **implementasi menyusul** lewat turunan
A (fondasi kanal), B (orkestrasi), dan C (tampilan identik). Sampai turunan itu mendarat, kode belum
memuat satu pun perilaku di bawah.
**Mengamandemen** [0046](0046-kanal-ws-sync-terpisah.md) & [0147](0147-kanal-presence-di-socket-sync.md)
(keluarga `/api/sync/*` mendapat socket kedua dan frame naik `capacity`),
[0148](0148-status-hidup-tidak-disync.md) & [0135](0135-penanda-project-ditangani-hanoman-client.md)
(presence/`handledBy` boleh dibaca jalur peluncuran — **hanya untuk menolak atau mengusulkan**),
[0065](0065-ai-agent-capability-agent-token.md) (principal ketiga yang dinilai peta capability:
`remote`), [0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) (launch approval
dari `remote`), [0161](0161-gerbang-peluncuran-sesi-cap-dan-sumber-daya.md) (`force` dari `remote`
ditolak), [0120](0120-tandai-backlog-selesai-manual.md) (gerbang sesi hidup membaca presence).
**Menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md)/[0086](0086-sqlite-satu-satunya-provider.md)
(tanpa queue/Redis/worker/Docker), [0015](0015-one-session-per-backlog.md) (satu backlog satu sesi),
[0039](0039-realtime-lewat-websocket-siar.md)/[0145](0145-langganan-berparameter-events-ws.md) (kanal
& route yang ada dipakai ulang), [0044](0044-device-token-machine-identity.md) (identitas device = token),
[0087](0087-distribusi-npm-global-satu-perintah.md) (degradasi antar-versi),
[0155](0155-mcp-cakupan-penuh-capability-danger.md) (`danger` tak diimplikasikan `:write`).
Berpasangan dengan [ADR-0166](0166-log-terpusat-ingest-satu-arah.md). Design-of-record:
[spec SPEC-1215](../../../docs/superpowers/specs/2026-09-14-spec-1215-hub-orkestrasi-klien-design.md).

## Konteks

Relasi hub ↔ klien hari ini hanya **data**: record lewat sync (ADR-0043/0045), penanda `handledBy`
(ADR-0135), dan presence sesi hidup (ADR-0147/0148). Hub bisa **melihat** sesi di mesin klien, tapi
tak bisa **bertindak**. Start/steer/interrupt/jawab dialog/tandai selesai harus dilakukan dari
dashboard klien itu sendiri, dan menonton terminalnya dinyatakan di luar lingkup oleh ADR-0147 §Plafon.

Tiga fakta kode membentuk keputusannya:

1. Klien sudah memegang socket persisten ber-Bearer ke hub (`sync-client.ts`), jadi arah koneksi yang
   menembus NAT sudah ada. Socket itu memikul changefeed sync, dan `maxPayload` 64 KiB dipasang
   app-wide (`app.ts:138-143`). Frame di atas batas itu menutup socket dengan `1009`.
2. Replay request in-process lewat `app.inject()` sudah menjadi preseden (`session-event-relay.ts:96`),
   dan `@fastify/websocket` 11.3.0 menyediakan `injectWS`.
3. Aksi jarak jauh adalah eksekusi agen di mesin orang lain — **RCE efektif**. Constraint menuntut
   opt-in per device (default mati), capability terpisah, audit beraktor, dan pencabutan seketika.

## Keputusan

### 1. Socket kedua `GET /api/sync/relay/ws`, dibuka klien hanya bila grant lokal menyala

Autentikasinya device token Bearer yang sama (bypass cookie gate prefix `/api/sync`, query token
ditolak). Kanal ini khusus mengangkut request aksi, respons, dan stream tampilan. Grant mati berarti
socket **tak pernah dibuka**. "Default mati" karena itu terbaca dari topologi, bukan dari handler
yang menolak.

Kanal dipisah dari socket sync karena memenuhi tiga kriteria yang ADR-0046 pakai untuk memisahkan
kanal. ADR-0147 menolak kanal kedua untuk presence justru karena kriteria itu tidak terpenuhi di sana:
- **muatan & domain kegagalannya berbeda:** stream terminal dan diff bisa ratusan KB, dan head-of-line
  blocking-nya tak boleh menahan changefeed;
- **otorisasinya berbeda:** relay butuh identitas device **dan** grant lokal **dan** aktor manusia hub;
- **opt-in struktural:** tanpa grant, tak ada jalur perintah sama sekali.

Satu relay per device; socket yang lebih baru menggantikan yang lama (`4000 replaced`). Kegagalan
relay — protokol, kuota, `1009` — **tak pernah** menutup socket sync (invarian ADR-0147 §4 dijaga
dengan memisahkan socket-nya).

### 2. Kontrak relay = REST dan WS yang sudah ada, dijalankan ulang di klien

Relay tidak punya katalog operasi. Hub mengirim `req` berisi method/path/body untuk route **yang
sudah ada**, dan dispatcher klien menjalankannya lewat `app.inject()`. Stream `open` dijalankan lewat
`app.injectWS()` terhadap `/api/terminal/sessions/:id/ws` atau `/api/events/ws`. Karena handler dan
gerbangnya sama — `startSpecSession` (ADR-0015/0084/0093/0117/0161), `completeSpecManually`
(ADR-0120), dialog `tui-dialog` (ADR-0142) — hasilnya identik dengan aksi lokal **by construction**.
Nol serializer kedua, nol jalur spawn kedua. Bentuk frame dan anggarannya ada di spec SPEC-1215
§Kontrak.

**Diverifikasi dengan spike, bukan diasumsikan** (fastify 5.12.1, `@fastify/websocket` 11.3.0,
ws 8.21.0, Node 24.11.1):
- `inject` dan `injectWS` melewati `onRequest` root (ingress), gate `/api`, dan `preValidation`,
  dalam urutan yang sama dengan request jaringan. Penolakan muncul sebagai
  `Unexpected server response: <status>`.
- `injectWS` **tak** membawa `Origin`, subprotocol tiket, maupun `host`. Karena itu `admitBrowserWs`
  butuh cabang `remote`, dan dispatcher wajib mengirim `host` = `controlHost(policy)` supaya
  `classifyIngress` tak menjawab 404 (host asing terukur 404).
- **Frame yang dikirim route secara sinkron saat attach hilang** bila listener dipasang sesudah
  `await injectWS(...)`: 0 dari 2 frame sampai, termasuk frame 18 byte. Lewat opsi `onOpen` atau
  sesudah `setImmediate`, keduanya sampai. `pty.attach` mengirim scrollback/`alt`/`phase` persis
  seperti itu, jadi **dispatcher wajib memasang listener lewat `onOpen`**.
- Frame server → klien-inject tak dibatasi (300 KiB sampai sebagai satu frame). Frame
  klien-inject → server tetap tunduk `maxPayload` (70 KiB → close `1009`). Dispatcher karena itu
  memotong muatan sebelum meneruskannya ke hub.

### 3. Principal `remote` hanya lahir in-process

Gate `/api` mendapat cabang yang menerima request relay hanya bila **keduanya** benar:
- header `x-hanoman-relay` sama (timing-safe) dengan rahasia acak 32 byte milik proses, yang tak
  pernah meninggalkan memori;
- `req.raw.socket` **bukan** `net.Socket`. Spike: `injectWS` → `undefined`, `inject` → `MockSocket`,
  jaringan → `Socket`.

Request jaringan yang membawa header itu, **bahkan dengan rahasia yang benar**, dijawab 401 (terukur,
WS dan HTTP). Aktor datang di header `x-hanoman-relay-actor` sebagai **klaim hub**
`{ hubOrigin, userId, email }`. Klien mencatatnya apa adanya; ia tak bisa memverifikasi manusia di
hub. Yang ia percaya adalah device token hub yang ia pasang sendiri.

### 4. Grant LOCAL-only di `Setting.data.remoteControl`, kosakata capability yang ada

`Setting.data.remoteControl = { enabled: false, capabilities: [] }` adalah kunci di kolom `Json` yang
sudah ada. **Tanpa migration.** `setting` tak ada di `SYNCED`, jadi hub tak bisa menyalakannya.
Pengelolaannya lewat `GET|PUT /api/remote-control` (**COOKIE_ONLY**), dan `PUT /api/settings`
**mempertahankan** nilai tersimpan kunci ini apa pun isi body-nya. Tanpa itu, agent token ber-
`settings:write` bisa menyalakan RCE ke mesinnya sendiri.

`capabilities ⊆ REMOTE_CAPABILITIES`:

| Toggle di klien | Capability | Yang dibuka |
|---|---|---|
| Lihat | `sessions:read` + `backlog:read` + `ide:read` | daftar sesi, fase, dialog, terminal baca-saja, dokumen & review sesi (`/specs/:id/docs|review` dipetakan `backlog`, bukan `docs`), IDE baca |
| Tulis terminal | `sessions:write` | input, steer, interrupt, jawab & ambil alih dialog |
| Mulai sesi | `sessions:spawn` | `POST /terminal/sessions` varian `spec` |
| Tandai selesai | `backlog:write` | **hanya** `POST /specs/:id/done` (lihat §5) |

Dinilai `checkAgentCapability` yang **sama** dengan agent token (fungsi murni). Satu pengecualian:
WS terminal ber-`mode:"read"` menuntut `sessions:read`, bukan `sessions:write`. Dispatcher membuang
frame `in`/`diag` sebelum mencapai route pada mode itu.

### 5. Allowlist route relay sebagai lapis kedua

Capability sendirian terlalu lebar untuk mesin orang lain. `backlog:write`, misalnya, juga memberi
`PATCH /specs`. Karena itu `relayRouteAllowed(method, path)`, fungsi murni yang diuji kontrak,
membatasi permukaan relay ke:
- sesi: `GET /terminal/sessions`, `GET|POST /terminal/sessions/:id/{phases,dialog,steer,interrupt,dialog/answer,dialog/takeover}`,
  `POST /terminal/sessions` (hanya body ber-`spec`), WS `/terminal/sessions/:id/ws`;
- dokumen & review: `GET /specs/:id/docs(/*)`, `GET /specs/:id/review(/*)`,
  `GET /terminal/sessions/:id/review(/*)`;
- IDE baca: `GET /projects/:id/{tree,file,working-status,file-diff,status,graph,compare,compare/file,commit/:sha,commit/:sha/file}`;
- `POST /specs/:id/done` dan WS `/events/ws`.

`archive`, unduhan, multipart, dan seluruh tulisan IDE **tak** masuk.

### 6. Penerapan gerbang yang ada pada `remote`

- **Approval & `force`.** `launchPrincipal` mengenal `remote` ber-`sessions:spawn` →
  `remote:<email>@<hubOrigin>`. Approval ADR-0117 tetap LOCAL-only, dan asalnya tetap cookie manusia
  (di hub). `force` dari `remote` → **403** sebelum `approveLaunch`, cabang yang sama dengan
  `req.agent`. Host berhak menolak (ADR-0161), dan operator hub tak merasakan beban mesin yang ia
  paksa.
- **Resize.** Frame `resize` dari hub **selalu dibuang**, apa pun mode-nya. Attachment tmux dipakai
  bersama (`terminal.ts:576`), jadi penonton jarak jauh akan menggeser layout operator lokal.
  Dispatcher mengirim frame relay `geometry {cols, rows}` milik pane, dan pane di hub merender ukuran
  itu.
- **Langganan.** Pada `/events/ws`, principal `remote` hanya menerima grup `sessions`, `leadAsks`,
  `cleanups`, dan topik `git` (bila `ide:read`). Grup `cookieOnly` tak pernah mengalir kepadanya.
- **Revalidasi.** `revalidateWsPrincipal(remote)` = grant masih menyala **dan** socket relay masih
  terbuka. Keduanya dibaca sinkron dari memori.

### 7. Pencabutan seketika, dari kedua sisi

- **Hub:** registry memori `deviceId → {sync, relay}`. `DELETE /device-tokens/:id` menutup keduanya
  dengan `1008` **sebelum** membalas, tak menunggu revalidasi 60 dtk.
- **Klien:** mematikan atau mengubah grant menutup socket relay dan setiap `injectWS` turunannya
  sebelum `PUT` membalas. Klien lalu membuka ulang dengan `hello` baru bila grant masih menyala.
- **Route relay di hub `COOKIE_ONLY`** (`capabilityForRoute` top `devices`). Tiket WS
  `relay:<deviceId>:…` hanya diterbitkan untuk `req.user`. Tanpa ini, agent token hub ber-
  `sessions:write` otomatis menjadi RCE ke setiap klien yang opt-in.

### 8. Satu sesi per backlog lintas instance: presence menolak atau mengusulkan, tak pernah meluluskan

- **Di klien:** terjamin oleh `startSpecSession` — pane hidup di-re-attach, jadi start relay untuk
  SPEC yang sudah hidup memulangkan id yang sama.
- **Di hub:** `startSpecSession` (manusia maupun scheduler) melempar `LaunchError("remote-session")`
  bila presence menunjukkan sesi `working|waiting` untuk SPEC itu di device lain. Route menjawab
  `409 { remoteSession: {deviceId, name, sessionId} }`, dan UI menawarkan "Sambung ke sesi di X".
- **Device yang punah** (tercatat di `recentlyOffline` memori ≤ 24 jam, atau `SessionResult.deviceId`
  terakhir sesudah hub restart) memberi `409 confirm-required`. Dua langkah seperti ADR-0120:
  `confirmRemote: true` untuk start, `confirm: true` untuk `POST /specs/:id/done`. Scheduler tak bisa
  mengonfirmasi, jadi ia melewati item itu.
- Presence tetap **tak pernah meluluskan** peluncuran. Ketiadaan sesi di presence bukan izin.

### 9. Kapasitas dan routing

Frame naik baru `{ t:"capacity", v:1, admission: LaunchStatus }` dikirim di socket **sync**, bukan
relay: angka ini berguna untuk semua klien, termasuk yang tak opt-in. Dikirim saat berubah dan
bersama denyut presence, disimpan di registry memori (prinsip ADR-0148). Hub lama membuangnya senyap
karena gagal `zPresenceFrame`. `PresenceDeviceView` bertambah `capacity` dan `control` (dari `hello`
relay).

Routing = **target default** dialog Start di hub: device pertama `handledBy` yang online, ber-
`sessions:spawn`, dan kapasitasnya tidak penuh; tanpa kandidat → hub lokal. Manusia yang menekan.
**Tak ada auto-dispatch** oleh scheduler atau lead hub.

### 10. Backpressure: klien 8 GB tak membayar penonton yang lambat

- Stream hanya hidup selama ada penonton.
- Kredit byte per stream: awal 256 KiB, diisi ulang hub saat `bufferedAmount` socket browser
  < 64 KiB.
- **Terminal membuang** keluaran saat kredit habis, lalu sesudah kredit pulih meminta resync: hub
  menutup socket browser `4009` → reconnect `TerminalPane` yang sudah ada → replay attach. Paling
  sering 1× per 5 dtk.
- **Events** menyimpan hanya frame terbaru per grup/kunci.

Plafon awal per device: 6 stream, 4 request inflight, respons ≤ 1 MiB, muatan per frame ≤ 32 KiB,
`bufferedAmount` socket relay ≤ 1 MiB (di atasnya semua stream dianggap tanpa kredit), 12 000
frame/menit. **Angka awal, bukan kalibrasi.** Plan wajib mengukurnya di Mac mini 8 GB (4 stream,
RTT 200 ms) dan boleh mengubahnya lewat amandemen ADR ini.

## Alternatif yang ditolak

- **Menumpang `/api/sync/ws`:** alasan §1, dan `1009` akan menjatuhkan changefeed.
- **Klien long-poll perintah lewat HTTP:** polling baru dari tiap klien (ADR-0039/0145).
- **Hub menyambung atau SSH ke klien:** melanggar NAT; klien bind loopback.
- **Katalog RPC khusus (`startSession`, `steer`, …):** protokol paralel yang pasti menyimpang dari
  REST dan menggandakan test kontrak (kelas SPEC-431/448/475).
- **Klien terus mendorong layar dan IDE-nya:** membebani mesin 8 GB tanpa penonton, dan mengekspor
  isi repo tanpa kebutuhan.
- **Dispatcher melekat langsung ke `pty.attach` tanpa `injectWS`:** melewati gerbang route. Seluruh
  admission, kuota, dan revalidasi harus ditulis ulang — persis jalur kedua yang §2 tolak.
- **Grant di-sync dari hub:** hub akan bisa menyalakan RCE ke setiap klien.

## Konsekuensi

**Baik.** Hub menjalankan siklus penuh satu backlog di klien opt-in tanpa satu handler bisnis baru.
Klien tanpa hub atau tanpa grant tak berubah sebaris perilaku pun. Pencabutan device token kini
benar-benar seketika, juga untuk socket sync.

**Buruk.**
- Blast radius hub bertambah: hub yang jebol memberi aksi di **semua** klien opt-in dalam batas
  grant masing-masing. Karena itu grant default mati, `force` ditolak, allowlist sempit, dan audit dua
  sisi.
- Principal ketiga di gate `/api` menambah satu cabang yang wajib dijaga test negatif.
- Dispatcher klien membawa satu jebakan yang tak terlihat dari tipe: listener `injectWS` wajib lewat
  `onOpen`.

## Plafon & residu yang diterima

- Jendela balapan sebesar tick presence (≤ 3 dtk) antara dua start lintas device. Tak ditutup dengan
  kunci terdistribusi (ADR-0024/0086).
- Start **langsung di klien Y** (bukan lewat hub) untuk SPEC yang hidup di klien X tak tercegah:
  presence hanya ada di hub. Aliran balik hub → klien di luar lingkup.
- Aktor di klien adalah **klaim** hub. Klien yang tak memercayai hub-nya tak boleh menyalakan grant.
- Unggahan lampiran, unduhan review, aksi IDE yang menulis, dan permukaan relay untuk agent
  token/MCP/Telegram di hub berada **di luar** ADR ini.
