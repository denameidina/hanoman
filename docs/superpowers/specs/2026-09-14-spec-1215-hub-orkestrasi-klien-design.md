# SPEC-1215 — Hub mengorkestrasi klien hanoman: kendali sesi jarak jauh, tampilan identik, dan log terpusat

**Tanggal:** 2026-09-14 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `67478d09` · **Fase penulis bagian ini:** Brainstorm (1/5), Objective (2/5), Spec (3/5)
**ADR:** [0165 — kendali jarak jauh lewat socket relay](../../../internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) ·
[0166 — log terpusat](../../../internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md)

## Objective

**Operator hub dapat menjalankan siklus penuh satu backlog di klien opt-in yang online — start,
steer, interrupt, jawab `AskUserQuestion`, tandai selesai, ditonton live (terminal/fase/dokumen/
IDE), dan diaudit-log di hub — dengan hasil setiap aksi identik dengan dilakukan lokal di klien
itu (route/handler yang sama, worktree tetap lahir di klien), dan tanpa satu aksi pun menembus
klien yang grant lokalnya mati.**

Objective ini menaungi keempat backlog turunan (A fondasi kanal · B orkestrasi · C tampilan
identik · D log terpusat) yang direkomendasikan fase Brainstorm — turunan boleh dikerjakan/
dirilis bertahap, tapi kriteria sukses di bawah berlaku untuk payung SPEC-1215 secara utuh.

### Kriteria sukses (terukur)

1. **Orkestrasi = identik-lokal.** Start/steer/interrupt/jawab `AskUserQuestion`/tandai selesai
   dari hub pada satu klien opt-in online menghasilkan state DB, berkas fase, dan worktree yang
   **sama** dengan aksi yang sama dijalankan langsung di klien — dibuktikan lewat test kontrak
   yang menjalankan route yang sama (`app.inject`/`injectWS`), nol serializer atau jalur spawn
   kedua.
2. **Satu sesi per backlog bertahan lintas instance.** Start dari hub ke klien X yang sudah
   punya sesi hidup untuk SPEC yang sama tidak melahirkan sesi kedua di klien mana pun; hub
   menyambung ke sesi yang ada atau menolak `409` dengan opsi "Sambung ke sesi di X".
3. **Routing & kapasitas terlihat sebelum menekan Start.** Dialog Start di hub mengusulkan
   klien target sesuai mapping SPEC-880 — hanya di antara klien online, grant `sessions:spawn`
   menyala, dan kapasitas tersedia (`launchStatus()`) — tanpa auto-dispatch; status
   online/offline tiap klien termutakhirkan dalam siklus presence yang berlaku (≤ 90 dtk).
4. **Tampilan live memakai komponen dashboard yang sama, bukan salinan.** Membuka klien X di hub
   menampilkan terminal PTY (baca selalu, tulis hanya dengan grant `sessions:write`, resize dari
   hub tak pernah menggeser layar operator lokal), chip fase, dokumen hasil sesi, dan IDE
   status/diff baca-saja — dengan banner "Sedang melihat klien X" yang tidak pernah salah
   tampil sebagai tampilan lokal.
5. **Log terpusat tercari dan tanpa duplikat.** Log server, event sesi (mulai/fase/selesai/
   gagal), transkrip/riwayat sesi (opt-in), dan audit aksi jarak jauh dari klien opt-in muncul
   di pencarian log hub tersaring per klien/project/SPEC/rentang waktu; pengiriman ulang sesudah
   klien offline tidak pernah menghasilkan baris duplikat (unique index per `(deviceId, lajur,
   seq)`, nol pelanggaran di test); retensi diatur lewat knob `Setting` dan disapu otomatis.
6. **Default mati, opt-in eksplisit, tercabut seketika.** Klien mana pun yang grant lokalnya
   belum dinyalakan cookie manusia di klien itu tidak menerima satu pun request/aksi dari hub —
   dibuktikan lewat socket relay yang memang tak pernah terbuka, bukan sekadar handler yang
   menolak. Mencabut device token menutup socket sync **dan** relay klien itu seketika, tanpa
   menunggu revalidasi berkala.
7. **Klien mandiri tak terdampak.** Klien yang tak terhubung ke hub, atau belum opt-in, tetap
   menjalankan seluruh fitur lokalnya (start, terminal, sync) tanpa perubahan perilaku maupun
   regresi pada test yang sudah ada.

## Konteks & keputusan

### Objective (ringkas)

1. **Orkestrasi.** Operator di dashboard hub memilih klien yang terhubung, lalu menjalankan aksi atas
   backlog/sesi di klien itu: start/lanjutkan sesi, steer, interrupt, jawab `AskUserQuestion`, tandai
   selesai. Hasilnya harus sama dengan aksi lokal, dan worktree tetap lahir di mesin klien. Hub
   mengusulkan target sesuai mapping SPEC-880, serta menampilkan online/offline dan kapasitas.
2. **Tampilan identik.** Hub membuka tampilan live klien — terminal PTY (baca, tulis bila diizinkan),
   chip fase, dokumen hasil sesi, IDE/git status/diff — dengan komponen yang sama, cukup berganti
   konteks "sedang melihat klien X".
3. **Log terpusat.** Log server klien, event sesi, transkrip/riwayat, dan audit aksi jarak jauh
   sampai ke hub dan bisa dicari per klien/project/SPEC/rentang waktu, dengan retensi yang bisa
   diatur. Log yang terkumpul selama offline dikirim ulang tanpa duplikat.

### Keadaan hari ini — dibaca dari kode, bukan dari ingatan

| Bahan | Jangkar | Arti bagi backlog ini |
|---|---|---|
| Socket persisten klien→hub ber-Bearer device token + backoff 1→30 dtk | `server/src/services/sync-client.ts:466-483`, `server/src/routes/sync.ts:143-183` | Pola koneksi dari arah klien (tembus NAT) sudah ada. Arah naiknya baru dipakai `presence` (ADR-0147). |
| Frame masuk sync hanya `zPresenceFrame` `.strict()` ber-`t: literal("presence")` | `shared/src/presence.ts:51-55` | Jenis frame baru dengan `t` lain dibuang senyap oleh hub versi lama. |
| `maxPayload` 64 KiB + `perMessageDeflate` dipasang sekali untuk semua route WS | `server/src/app.ts:136-141` | Frame > 64 KiB ditutup `1009`. Kalau terjadi di socket sync, changefeed ikut putus. |
| Cabut device token hanya menyetel `revokedAt`; socket mati lewat revalidasi berkala | `server/src/routes/device-tokens.ts:25-27`, `server/src/routes/sync.ts:179-180` | Belum ada pemutusan **seketika**. Constraint menuntutnya. |
| `WsPrincipal = user\|agent\|device\|test` | `server/src/services/ws-admission.ts:14` | Belum ada principal untuk aksi yang datang dari hub. |
| Gerbang `/api`: `/api/sync*` di-bypass cookie gate lalu dijaga device token; agent token dinilai `checkAgentCapability` | `server/src/app.ts:183-204` | Mesin capability per route (`capabilityForRoute`, fungsi murni) bisa dipakai ulang untuk menilai aksi jarak jauh. |
| Replay request in-process lewat `app.inject()` ber-token turunan | `server/src/services/session-event-relay.ts:96` | Preseden persis untuk "jalankan route yang sama di klien tanpa lompatan jaringan". |
| `@fastify/websocket` 11.3.0 menyediakan `injectWS` | `node_modules/.pnpm/@fastify+websocket@11.3.0/.../types/index.d.ts:40` (checkout utama) | Route WS yang ada (terminal, events) bisa dijalankan in-process juga. |
| Semua WS terminal berbagi satu attachment; `resize` dari klien mana pun menggeser pty | `server/src/routes/terminal.ts:568-576`, `server/src/services/pty.ts:128` | Penonton jarak jauh yang me-resize ikut mengubah layout operator lokal. |
| `launchPrincipal` hanya mengenal `user` & `agent sessions:write`; agen yang mengirim `force` ditolak 403 | `server/src/services/launch-authority.ts:10-15`, `server/src/routes/terminal.ts:88-89` | Aksi start dari hub butuh aturan approval (ADR-0117) dan aturan `force` (ADR-0161) yang eksplisit. |
| Angka kapasitas (`liveAgentCount`, `maxConcurrent`, `loadPerCore`, …) sudah dihitung | `server/src/services/session-admission.ts:14` (`launchStatus`) | "Kapasitas klien" cukup memakai angka ini, tanpa metrik baru. |
| Grup siar `presence` `cookieOnly` | `server/src/services/events.ts:49-50,92` | Pola gerbang grup per principal sudah ada. |
| `SYNCED` = 10 entitas; **tanpa** `setting`, `sessionHistory`, maupun log | `server/src/services/sync.ts:20` | Opt-in yang disimpan di `Setting` tak bisa dinyalakan hub lewat sync. Log tak punya jalur ke hub. |
| Fastify `logger: false`; log server = **59** panggilan `console.*` (non-test) | `server/src/app.ts:105` | Belum ada berkas log. Satu titik sadap (`console`) sudah mencakup semuanya. |
| Retensi berupa konstanta, bukan knob | `server/src/services/retention.ts:6-9` | "Retensi yang dapat diatur" berarti knob baru di `Setting`. |
| Dashboard: `j(url)` fetch same-origin; `api` singleton diimpor 35 modul; URL WS dari `location.host + paths.*` | `src/src/api/client.ts:154-161,189`, `src/src/screens/TerminalPane.tsx:234-235`, `src/src/api/events.ts:128` | Belum ada konsep "instance lain". Titik sambung satu-satunya adalah basis URL. |
| Prisma 6.19 di SQLite: `createMany` ada, **`skipDuplicates` tidak didukung** | `server/package.json:20,34`; dokumentasi Prisma (`createMany`/`createManyAndReturn` remarks) | Dedup ingest log tak bisa bersandar pada `skipDuplicates`. |

Batas yang dipasang ADR sebelumnya dan sengaja **dibuka** backlog ini, masing-masing lewat ADR baru:
ADR-0147 §Plafon ("menonton terminal klien dari hub ada DI LUAR"), ADR-0148 §Batas & ADR-0135 §6
(presence/`handledBy` tak boleh dibaca jalur eksekusi), ADR-0079 (transkrip tak pernah menyeberang
ke hub).

### D — Dekomposisi: satu payung, empat backlog turunan

Backlog ini memuat tiga subsistem yang berbagi satu fondasi. Satu plan implementasi akan terlalu
besar untuk diverifikasi, jadi rekomendasi untuk fase Spec/Plan (constraint mengizinkannya):

| Turunan | Isi | Bergantung pada |
|---|---|---|
| **A · Fondasi kanal relay** | socket relay klien→hub (K1), kontrak tunnel (K2), grant opt-in + principal `remote` (K3), pemutusan seketika (K4), audit lokal, frame `capacity` (K6) | — |
| **B · Orkestrasi** | aksi dari hub, pemilih target (K6), pagar satu sesi lintas instance (K5) | A |
| **C · Tampilan identik** | `InstanceContext` + `createApi` (K7), relay stream terminal/events + backpressure (K8) | A |
| **D · Log terpusat** | tiga lajur, spool klien, ingest satu arah, redaksi, penyimpanan + pencarian + retensi di hub (K9–K10) | lajur audit butuh A; lajur lain bisa paralel |

Urutan rilis mengikuti preseden ADR-0135: **hub dulu** (K12).

### K1 — Transport: socket kedua dari klien `GET /api/sync/relay/ws`, bukan menumpang `/api/sync/ws`

**Keputusan.** Klien yang grant-nya menyala membuka socket kedua ke hub, di bawah prefix
`/api/sync/*`, dengan autentikasi device token yang sama. Socket ini khusus mengangkut request aksi,
respons, dan stream tampilan.

**Alasan — tiga-tiganya kriteria yang dipakai ADR-0046 untuk memisahkan kanal:**
1. **Opt-in yang struktural.** Grant mati berarti socket **tak pernah dibuka**. Tak ada jalur perintah
   sama sekali, bukan sekadar handler yang menolak — "default mati" terbaca dari topologinya.
2. **Muatan dan domain kegagalannya berbeda.** Stream terminal dan diff IDE bisa ratusan KB. Di socket
   sync, satu frame yang melewati `maxPayload` 64 KiB (`app.ts:140`) menutup socket beserta
   changefeed-nya. Aturan ADR-0147 §4 ("kegagalan kanal status tak pernah menutup socket") tak bisa
   dijaga untuk RPC dan stream. Head-of-line blocking diff besar juga akan menahan changefeed.
3. **Otorisasinya berbeda.** Sync = identitas device. Relay = identitas device **dan** grant lokal
   klien **dan** aktor manusia di hub. ADR-0147 menolak kanal kedua untuk presence justru karena di
   sana otorisasinya identik — di sini tidak.

**Yang dipakai ulang, bukan ditulis ulang:** bypass cookie gate + penegakan device token per route
(`app.ts:183`), klasifikasi ingress host control (ADR-0117), `verifyDeviceToken`, kuota
`openWsConnection`, `WsMessageGuard`, backoff ber-jitter dari `sync-client.ts` (ADR-0147 §5), dan
`perMessageDeflate` yang sudah app-wide.

**Ditolak:**
- *Menumpang `/api/sync/ws`* — alasan 1–3 di atas.
- *Klien long-poll perintah lewat HTTP* — polling baru dari tiap klien, dilarang ADR-0039/0145.
- *Hub menyambung langsung/SSH ke klien* — melanggar constraint NAT.
- *Klien terus mendorong seluruh keadaan (layar, IDE) ke hub* — membebani Mac mini 8 GB tanpa ada
  yang menonton, dan mengekspor isi repo tanpa kebutuhan. Stream hanya hidup selama ada penonton
  (cermin pagar 1 ADR-0145).

### K2 — Kontrak relay = REST dan WS yang sudah ada, ditunnel; bukan katalog operasi baru

**Keputusan.** Relay tidak mendefinisikan operasi `startSession`/`steer`/…. Ia mengangkut request
ke route yang **sudah ada** di klien:

```
hub → klien  { t:"req",  id, method, path, body?, actor }
klien → hub  { t:"res",  id, status, body, seq?, end? }        // body besar dipotong per anggaran byte
hub → klien  { t:"open", sid, path, mode:"read"|"write", actor } // path = route WS yang ada
kedua arah   { t:"data", sid, d }   { t:"credit", sid, n }   { t:"close", sid, code }
klien → hub  { t:"hello", protocol, version, grant }
```

Klien menjalankan `req` lewat `app.inject()` (preseden `session-event-relay.ts:96`) dan `open` lewat
`app.injectWS()` terhadap `/api/terminal/sessions/:id/ws` atau `/api/events/ws`.

**Alasan.** "Hasil sama seperti lokal" terpenuhi **by construction**: handler yang sama,
`startSpecSession` dengan seluruh gerbangnya (ADR-0015/0084/0093/0117/0161), `completeSpecManually`
(ADR-0120), dispatch dialog `tui-dialog` (ADR-0142). Tak ada serializer kedua yang bisa menyimpang —
kelas bug SPEC-431/448/475. Cocok juga dengan constraint "reuse jalur yang ada ketimbang protokol
paralel".

**Ditolak:**
- *Katalog RPC khusus* — protokol paralel yang pasti menyimpang dari REST dan menggandakan test kontrak.
- *Proxy HTTP mentah ke port klien* — klien bind loopback; jalan ini menambah lompatan jaringan dan
  mengaburkan identitas di gerbang.

### K3 — Grant LOCAL-only di klien, principal `remote`, kosakata capability dipakai ulang

- **Penyimpanan.** `Setting.remoteControl = { enabled: false, capabilities: [] }` (kolom Json, butuh
  migration + ADR). `Setting` tak ada di `SYNCED` (`sync.ts:20`), jadi hub tak bisa menyalakannya
  lewat sync. Route pengelolanya `COOKIE_ONLY` di klien, sehingga agent token maupun principal
  `remote` tak bisa menaikkan hak sendiri (cermin `/agent-tokens`, ADR-0065 §5).
- **Kosakata.** Subset katalog capability yang ada, dinilai `checkAgentCapability`/`capabilityForRoute`
  yang sama dengan agent token. Permukaan `COOKIE_ONLY` tetap tak terjangkau.

  | Kebutuhan constraint | Capability |
  |---|---|
  | lihat (daftar sesi, fase, dialog, riwayat, terminal baca-saja) | `sessions:read` |
  | tulis terminal (input, steer, interrupt, jawab dialog) | `sessions:write` |
  | start/lanjutkan sesi | `sessions:spawn` (akses `danger`, ADR-0155) |
  | IDE/git status/diff/berkas baca-saja | `ide:read` |
  | dokumen hasil sesi | `docs:read` |
  | tandai selesai | `backlog:write` |

- **Terminal baca-saja** tanpa mengubah kontrak route: peta hari ini menaruh WS terminal di
  `sessions:write` (ADR-0065). Karena itu dispatcher relay membuka stream `mode:"read"` dan
  **membuang frame `in`/`resize` sebelum** mencapai `injectWS`. `resize` dari hub **tak pernah**
  diteruskan, sekalipun `mode:"write"`: attachment dipakai bersama (`terminal.ts:576`), jadi penonton
  jarak jauh akan mengubah layout operator lokal. Hub merender ukuran milik klien.
- **Principal tak bisa dipalsukan dari jaringan.** Principal `remote` hanya dipasang dispatcher relay
  in-process, ditandai rahasia per proses (pola token turunan `session-event-token`). Request jaringan
  yang meniru tandanya ditolak.
- **Aktor.** `{ kind: "hub", deviceLink, userId, email }`, dicatat sebagai klaim hub. Hub sendiri
  mencatat aktor yang ia autentikasi (K9, lajur `event`).
- **Approval & `force`.** `launchPrincipal` diperluas: `remote` + `sessions:spawn` boleh memberi launch
  approval. Invarian ADR-0117 #1 tetap utuh karena asalnya cookie manusia di hub, bukan input publik.
  `force` dari `remote` **ditolak 403**: host berhak menolak (ADR-0161), dan operator hub tak
  merasakan beban Mac mini 8 GB yang ia paksa. Angka penolakan tetap ditampilkan di hub.
- **Topik berparameter** (`git` untuk IDE): `canSubscribeTopics` diperluas ke `remote` dengan cek
  capability per topik. Grup `cookieOnly` tetap tertutup.

### K4 — Pemutusan seketika, dari kedua sisi

- **Hub:** registry memori `deviceId → socket sync + relay`. Pencabutan device token menutup keduanya
  dengan `1008` **pada saat itu juga**, tanpa menunggu revalidasi berkala.
- **Klien:** mematikan grant menutup socket relay dan membatalkan semua stream saat itu juga.
- **Route relay di hub `COOKIE_ONLY`.** Kalau tidak, agent token hub ber-`sessions:write` otomatis
  menjadi RCE ke setiap klien yang opt-in.

### K5 — Satu sesi per backlog lintas instance

- **Di klien:** terjamin by construction — `startSpecSession` memeriksa pane hidup lebih dulu lalu
  re-attach (ADR-0161 §1).
- **Di hub:** presence boleh dibaca sebagai gerbang **tolak/alihkan saja, tak pernah meluluskan**
  (amandemen ADR-0148 §Batas & ADR-0135 §6). Start lokal di hub atau start ke device Y ditolak
  `409 remote-session { deviceId, name, sessionId }` bila presence menunjukkan sesi hidup untuk SPEC
  itu di device X. UI lalu menawarkan "Sambung ke sesi di X".
- **Device offline** (presence punah > 90 dtk) yang terakhir tercatat mengerjakan SPEC itu
  (`SessionResult.deviceId`, stage berjalan) → `409 confirm-required`, dua langkah seperti ADR-0120,
  bukan diam.
- **Tandai selesai di hub:** gerbang sesi hidup ADR-0120 hari ini hanya membaca `listSessions()` lokal.
  Ia diperluas membaca presence dengan dua langkah yang sama.
- **Residu yang diterima:** jendela balapan sebesar tick presence (≤ 3 dtk). Dicatat, tidak ditutup
  dengan kunci terdistribusi (tanpa Redis/queue, ADR-0024/0086).

### K6 — Kapasitas dan routing

- **Kapasitas:** frame baru `{ t:"capacity", v:1, admission }` di socket **sync** (bukan relay), berisi
  angka `launchStatus()`. Informasi ini berguna untuk semua klien terpasang, termasuk yang tak
  opt-in. Disimpan di registry memori (prinsip ADR-0148); hub lama membuangnya senyap (`t` bukan
  `"presence"`).
- **Ketersediaan kendali** (grant + capability) diambil dari `hello` relay, bukan dari frame kapasitas.
- **Routing = target default di dialog Start hub, manusia yang menekan.** Target default:
  `handledBy` ∩ online ∩ grant memuat `sessions:spawn` ∩ kapasitas tersedia. Tanpa kandidat → hub
  lokal.
- **Tidak ada auto-dispatch** oleh scheduler/lead hub ke klien di backlog ini: "manusia terakhir yang
  memutuskan", ADR-0161 §5 (otomasi tak pernah memaksa), dan RCE di mesin orang lain. Kandidat
  backlog lanjutan.

### K7 — Tampilan identik lewat `InstanceContext`, bukan salinan UI

- **Frontend.** `createApi(base)` menjadi pabrik; `api = createApi("")` tetap untuk mode lokal,
  sehingga 35 importir tak tersentuh. `InstanceContext = local | remote(deviceId, name)` menyediakan
  `useApi()` dan `wsUrl(path)`.
- **Mode remote di hub.** Request dipetakan ke `/api/devices/:deviceId/relay/<path>` (HTTP) dan
  `/api/devices/:deviceId/relay/ws` ber-tiket admission `remote:<deviceId>:<path>`. Bentuk final
  kontrak API diputuskan di fase Spec.
- **Layar yang dimigrasi hanya yang diminta objective:** pane Terminal + `PhaseStrip`, dokumen hasil
  sesi (`SpecDocsModal`/docs), IDE baca-saja (status/diff/tree/berkas). Seluruh dashboard **tidak**
  di-mirror (YAGNI).
- **Kejujuran tampilan.** Banner "Sedang melihat klien X · vN". Penanda baca-saja bila tanpa
  `sessions:write`. Hub menolak mirror bila `protocol` di `hello` tak cocok, dan memperingatkan bila
  hanya `version` yang berbeda (preseden degradasi ADR-0087/0145).
- **Transparansi di klien.** Panel Settings "Kendali jarak jauh" menampilkan grant, status socket, dan
  audit terbaru, supaya operator klien bisa melihat apa yang dilakukan hub di mesinnya.

### K8 — Backpressure: klien 8 GB tak boleh membayar untuk penonton yang lambat

- **Stream on-demand:** hanya selama penonton terpasang.
- **Kredit per stream:** hub memberi jendela byte, dan klien berhenti meneruskan saat kredit habis.
  - Terminal **membuang** keluaran yang tertahan lalu resync lewat replay attach (tmux menggambar
    ulang layar) — tak pernah buffer tak berbatas.
  - Events hanya menyimpan snapshot **terbaru** per grup (semantiknya memang ganti-penuh).
- **Batching:** coalescing 16 ms jalur pty (SPEC-812) dipertahankan. Frame relay ≤ 64 KiB, di bawah
  `maxPayload`.
- **Plafon per device:** stream serentak, request inflight (cermin `MAX_INFLIGHT` = 4, ADR-0145), dan
  anggaran byte per potongan respons (cermin `PULL_MAX_BYTES`, ADR-0138).
- **Angka awal bukan kalibrasi.** Plan wajib mengukur CPU/RSS relay di mesin 8 GB dengan ≥ 4 stream
  terminal (pelajaran ADR-0161: `os.freemem()` menyesatkan di macOS).

### K9 — Log terpusat: ingest satu arah lewat jalur HTTP sync, bukan entitas `SYNCED`

- **Bukan `SYNCED`.** Pull sync membagikan record hub ke **setiap** klien, sehingga log klien A akan
  mendarat di klien B. Masuk `SYNCED` juga berarti tujuh daftar literal harus bergerak bersama, dan
  feed membengkak seperti kasus ADR-0131.
- **Bukan socket relay.** Log harus mengalir tanpa grant kendali, dan semantik outbox HTTP sudah ada.
- **Jalur:** `POST /api/sync/logs` ber-Bearer device token, gzip dengan dekompresi ber-cap ganda dan
  anggaran byte (ADR-0138), dikuras dari tick sync klien yang sudah ada (`sync-client.ts:511`).

**Tiga lajur**, satu ruang `seq` per `(device, lajur)`:

| Lajur | Isi | Sumber (titik cekik) | Penyimpanan di klien | Default |
|---|---|---|---|---|
| `event` | sesi lahir/fase/selesai/gagal/ditolak gerbang + audit aksi jarak jauh | `registerSessionHooks` (ADR-0079 §3), perubahan berkas fase, `recordSessionResult`, `LaunchAdmissionError`, dispatcher relay | tabel LOCAL-only berkadens rendah | **menyala** saat terpasang ke hub — kelas metadata, setara presence/`SessionResult` yang sudah menyeberang |
| `server` | keluaran `console.*` + galat tak tertangkap | satu sadapan `console` saat boot | spool NDJSON bersegmen di `$HANOMAN_HOME/log-spool/`, **nol tulisan SQLite per baris** (ADR-0131/0148) | **mati**, opt-in lokal |
| `transcript` | berkas transkrip saat sesi ditutup + metadata riwayat | `transcript-store` (ADR-0079 §4) | berkas yang sudah ada | **mati**, opt-in lokal (amandemen ADR-0079) |

**Dedup tanpa `skipDuplicates`** (tak didukung SQLite):
- Hub memegang `LogCursor(deviceId, lajur, lastSeq)` dan menerima hanya `seq > lastSeq`, dalam
  **satu transaksi** bersama insert.
- Klien memajukan kursor lokal hanya sesudah ack hub.
- Crash di antara commit hub dan tulis kursor klien → kirim ulang → ditolak high-water mark → nol
  duplikat.
- Unique index `(deviceId, lajur, seq)` tetap dipasang sebagai jaring pengaman.

**Offline:** spool berbatas byte. Saat penuh, yang dibuang lebih dulu adalah lajur `server` (terlama),
dan lajur `event` paling akhir. Setiap pembuangan meninggalkan penanda celah, bukan hilang senyap
(pelajaran ADR-0131 §3).

### K10 — Redaksi, penyimpanan hub, pencarian, retensi

- **Redaksi di klien sebelum data menyentuh spool/pengiriman**, lalu diulang di ingest hub sebagai
  lapis kedua. Fungsi murni diuji korpus (preseden lapis-lapis ADR-0129):
  - **pola:** header `Bearer`, `hnm_agt_…`, `sk-ant-…`, `ghp_`/`github_pat_`, `AKIA…`, `xox?-…`, blok
    PEM, JWT, baris `KEY=value` bernama rahasia;
  - **nilai yang diketahui proses:** device token plaintext, nilai env bernama rahasia.
  - Redaktor yang melempar → entri **dibuang** dengan penanda (gagal-tertutup).
- **Hub:**
  - tabel `LogEntry(deviceId, lane, seq, ts, level, kind, projectId?, specId?, sessionId?, msg, data)`
    dengan index `(ts)`, `(deviceId,ts)`, `(projectId,ts)`, `(specId,ts)`, plus `LogCursor`;
  - transkrip sebagai berkas di `$HANOMAN_HOME/remote-transcripts/<deviceId>/` + baris penunjuk;
  - log hub sendiri masuk pintu yang sama dengan `deviceId` `local` (cermin ADR-0147 §8).
- **Pencarian:** `GET /api/logs?device&project&spec&lane&level&from&to&q&cursor&limit`, `COOKIE_ONLY`,
  rentang waktu wajib dan berplafon, `q` = `LIKE` pada `msg`. Tanpa FTS: raw SQL dilarang guard
  `webhook-no-raw-writes`. Paginasi seragam ADR-0107.
- **Retensi:** knob `Setting.logRetention` (hari per lajur + plafon byte total), disapu
  `startRetentionSweep()` yang sudah ada (bukan timer baru, ADR-0131 §2), baris dan berkas dalam
  batch.

### K11 — Klien mandiri tetap penuh

Tanpa hub atau tanpa grant: tak ada socket relay dan tak ada pengiriman log. Spool berbatas, dan
seluruh fitur lokal tak berubah. Hub mati tak pernah memblokir peluncuran, terminal, maupun sync lokal
di klien. Pengiriman log dan relay adalah fire-and-forget di belakang backoff.

### K12 — Kompatibilitas rilis: hub dulu

| Kombinasi | Perilaku |
|---|---|
| klien baru → hub lama | upgrade relay `404` → klien mundur ke interval panjang dan menandai "hub tak mendukung"; `/sync/logs` `404` → spool tetap berbatas dan dicoba jarang; frame `capacity` dibuang senyap |
| klien lama → hub baru | device tampil "kendali jarak jauh: tak tersedia (versi klien)"; tak ada log |

### Invarian yang dijaga

1. Tak ada perintah dari hub yang bisa menyentuh klien tanpa grant **lokal** yang dinyalakan cookie
   manusia di klien itu.
2. Aksi jarak jauh melewati route dan gerbang yang **sama** dengan aksi lokal — nol jalur spawn kedua
   (ADR-0117 invarian 2).
3. Presence/`handledBy` hanya boleh **menolak atau mengusulkan**, tak pernah meluncurkan.
4. Kegagalan relay atau ingest log tak pernah menutup socket sync, dan tak pernah memblokir
   pekerjaan lokal.
5. Tanpa Redis/queue/worker/Docker. Keadaan hidup di memori (ADR-0148); data tahan-lama di SQLite per
   instance atau berkas di `$HANOMAN_HOME`.

### Wajib diverifikasi di Spec/Plan (default sudah diputuskan di atas)

- **`injectWS` melewati gerbang.** Pastikan ia melewati `onRequest` dan `preValidation`
  (`admitBrowserWs` menuntut Origin + tiket sekali pakai), dan cabang admission untuk principal
  in-process tak membuka jalur dari jaringan. Perlu spike sebelum plan dikunci.
- **Kalibrasi plafon K8** (kredit, stream serentak, anggaran byte) di mesin 8 GB.
- **Volume lajur `server` di hub** saat banyak klien menyalakannya: ukuran baris per menit dan dampak
  pada `GET /specs` di WAL.
- **Nomor ADR** dialokasikan saat Spec, sesudah memeriksa semua branch/worktree. Hari ini maksimum
  `0164` di `main` dan `worktree-orkestrasi-subagent-fase`.

### Dampak docs (dikerjakan fase berikutnya, dalam commit implementasi)

- **ADR baru:**
  - kanal relay & kendali jarak jauh (K1–K8);
  - log terpusat (K9–K10).
- **Amandemen:**
  - ADR-0046 & 0147 — keluarga `/api/sync/*`;
  - ADR-0148 & 0135 — gerbang tolak/usul;
  - ADR-0079 — transkrip menyeberang bila opt-in;
  - ADR-0065 & 0155 — principal `remote`;
  - ADR-0117 — approval dari `remote`;
  - ADR-0161 — `force` remote ditolak;
  - ADR-0120 — gerbang sesi hidup lintas instance.
- **Architecture/security/frontend/skill:** `architecture/stack.md`, `architecture/api-contract.md`,
  `architecture/data-model.md`, `security/threat-model.md` (aktor "hub terhadap klien", blast radius
  hub → semua klien opt-in), `frontend/frontend-implementation.md`, `internal/skills/hanoman/SKILL.md`,
  dan index `internal/docs/README.md`.

### Di luar lingkup

- Auto-dispatch backlog ke klien oleh scheduler atau hanoman-lead hub.
- Mirror seluruh dashboard; aksi IDE yang menulis (commit, merge, rebase, hapus branch/worktree).
- Aliran balik hub → klien (klien melihat sesi klien lain).
- Permukaan relay untuk agent token/MCP/Telegram di hub.
- Transkrip streaming selama sesi berjalan — tampilan live sudah dilayani mirror terminal.
- RBAC per user di hub (tetap tanpa RBAC, ADR-0065).

---

## Spec teknis (fase Spec 3/5)

> Bagian ini **mengunci** arsitektur dan kontrak. Bila berselisih dengan "Konteks & keputusan" di
> atas, yang berlaku bagian ini; setiap koreksi dicatat di S1. Keputusan arsitektural dituliskan di
> [ADR-0165](../../../internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md) (relay &
> kendali, turunan A/B/C) dan [ADR-0166](../../../internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md)
> (log, turunan A/D). Doc SoT yang tersentuh diberi penanda **dirancang**, dan penanda itu dicabut
> Execute saat turunannya mendarat.

### S0. Titik verifikasi yang tadinya terbuka — ditutup

**(a) `injectWS` terhadap gerbang.** Diukur dengan spike atas fastify 5.12.1 +
`@fastify/websocket` 11.3.0 + ws 8.21.0 + Node 24.11.1. App tiruannya mereplikasi urutan `app.ts`:
`onRequest` root untuk ingress, gate `onRequest` di scope `/api`, dan `preValidation` di route WS.

| Kasus | Hasil terukur |
|---|---|
| `injectWS` ber-header rahasia | lolos `onRequest` root → gate → `preValidation`, **urutan sama** dengan jaringan. `origin`/subprotocol **absen**, `host` absen kecuali dikirim |
| `injectWS` tanpa rahasia | ditolak gate: `Error("Unexpected server response: 401")` |
| `injectWS` ber-`host` asing | ditolak hook ingress root: `… 404` |
| `inject` HTTP | 200. `req.raw.socket` = `MockSocket`, `host` default `localhost:80` |
| `req.raw.socket` pada `injectWS` / jaringan | `undefined` / `Socket` (`net.Socket`) |
| Jaringan nyata **dengan rahasia yang benar** | WS `unexpected-response 401`, HTTP `401`: penanda in-process menahan walau rahasia bocor |
| Frame server → klien-inject 200–300 KiB | sampai utuh (klien-inject `maxPayload: 0`), satu frame maupun potongan 16 KiB |
| Frame klien-inject → server 70 KiB | socket ditutup `1009`: `maxPayload` 64 KiB server tetap berlaku |
| **Route mengirim frame SINKRON di handler** (pola `pty.attach`: scrollback, `alt`, `phase`), listener dipasang sesudah `await injectWS()` | **0/2 frame sampai**, termasuk frame 18 byte |
| Sama, listener lewat opsi `onOpen` / pengiriman sesudah `setImmediate` | 2/2 dan 3/3 frame sampai (18 B + 200 KiB + 40 B) |

Kesimpulan yang mengikat kontrak:
1. Gerbang **tidak** dilewati. `admitBrowserWs` butuh cabang `remote` eksplisit, dan dispatcher wajib
   mengirim `host` = `controlHost(policy) ?? "127.0.0.1"`.
2. Penanda in-process = rahasia proses **dan** `!(raw.socket instanceof net.Socket)`.
3. Listener `injectWS` **wajib** dipasang lewat `onOpen` (AC-C8).
4. Dispatcher memotong muatan sebelum meneruskannya ke hub.

**(b) Plafon backpressure untuk mesin 8 GB — angka awal + cara ukur.** Angka ada di S4.1. Cara ukurnya
wajib dijalankan Plan/Execute turunan C (S10): Mac mini 8 GB, hub dan klien ber-`HANOMAN_HOME`
terpisah, 4 sesi agen sibuk, 4 tab mirror, RTT 200 ms disuntik di jembatan (pola SPEC-856), 10 menit.
Setiap detik dicatat `process.cpuUsage()` dan `memoryUsage().rss` proses server klien, serta
`bufferedAmount` socket relay. Tekanan memori dibaca dari `memory_pressure`/`vm_stat`, bukan
`os.freemem()` (pelajaran ADR-0161). Anggaran lulus awal:
- CPU tambahan ≤ 5 % satu core per stream;
- RSS ≤ +50 MB;
- `bufferedAmount` ≤ 1 MiB.

Kalibrasi mengubah angka lewat amandemen ADR-0165, bukan diam-diam.

**(c) Volume lajur `server` di hub.**
- **Terukur di mesin klien ini:** `~/.hanoman/hanoman-launchd.log` berisi **15 546 baris / 1,8 MB**
  untuk 2026-08-14 → 2026-09-14 (31 hari), ±500 baris/hari, ±58 KB/hari.
- **Contoh burst yang ikut terukur:** baris `sync: push … tak dijawab hub (status 502)` berulang per
  tick. Karena itu klien menggabungkan baris identik beruntun dalam 60 dtk (`data.repeat`).
- **Proyeksi hub:** 10 klien × 500/hari × retensi `serverDays` 7 = ±35 000 baris. Itu seperempat
  121 222 baris `SyncLog` yang mencekik hub di ADR-0131, dengan baris jauh lebih kecil.
- **Pagarnya:**
  - satu transaksi per batch pada tick sync, bukan per baris;
  - kuota 20 000 entri/jam per device;
  - plafon byte total.
- Plan wajib mengukur p95 `GET /specs` di bawah ingest sintetis (S10).

**(d) Nomor ADR.** Diperiksa di `git ls-tree` untuk `main`, `worktree-orkestrasi-subagent-fase`, dan
`origin/main`, di ketiga worktree (`git worktree list`), dan `git ls-remote --heads origin` (hanya dua
branch). Maksimum **0164**; `git grep 'ADR-016[5-9]'` kosong di ketiga ref. Dialokasikan
**ADR-0165** (relay & kendali) dan **ADR-0166** (log terpusat).

### S1. Koreksi atas Konteks & keputusan (ditemukan saat mengunci kontrak)

1. **Grant tak butuh migration.** `Setting` = satu kolom `data Json` (`schema.prisma`, model
   `Setting`), jadi `remoteControl`/`logShipping`/`logRetention` adalah kunci `zSetting`, tanpa
   migration. Migration hanya untuk `LogEntry`/`LogCursor` (S4.10). ADR tetap diperlukan (0165/0166).
2. **"Dokumen hasil sesi" = `backlog:read`, bukan `docs:read`.** `GET /specs/:id/docs(/*)` dan
   `/specs/:id/review` jatuh ke `rw("backlog")` (`agent-capabilities.ts:84-92`). `REMOTE_CAPABILITIES`
   karena itu memuat `backlog:read` dan tidak memuat `docs:read`.
3. **`backlog:write` terlalu lebar untuk "tandai selesai"** (ia juga membuka `PATCH /specs`, lampiran,
   dll.). Maka ada lapis kedua: allowlist route relay (S4.5). Relay hanya menjangkau
   `POST /specs/:id/done`.
4. **`PUT /settings` wajib mempertahankan tiga kunci baru.** Tanpanya agent token ber-`settings:write`
   bisa menyalakan RCE ke mesinnya sendiri atau memendekkan retensi audit.
5. **Listener `injectWS` lewat `onOpen`** (S0a). Tak disebut Brainstorm; tanpa ini mirror terminal
   kosong sampai keluaran berikutnya.
6. **`registerSessionHooks` satu slot** (`pty.ts:532`, `hooks = h`). Pendaftar kedua (tap log)
   **mematikan riwayat sesi** tanpa error. Hook dibuat aditif.
7. **`createApi` + `InstanceContext` pindah ke turunan B.** Aksi steer/interrupt/jawab/selesai dari hub
   membutuhkannya; C membangun tampilan di atasnya.
8. **Tabel log dimiliki turunan A**, bukan D, karena audit `remote.*` lahir di A. D menambah
   pengiriman, ingest, dan pencarian.
9. **Resize.** Pane tak pernah menerima ukuran pty (`resize` hanya arah klien → server,
   `TerminalPane.tsx:260`). Relay menambah frame `geometry` yang **hanya** dikirim dispatcher; route
   terminal tak berubah.
10. **Resync terminal memakai reconnect `TerminalPane` yang sudah ada** (close ≠ 4004 → `retry()`,
    `TerminalPane.tsx:319-335`), dengan hub menutup socket browser `4009`. Tak ada frame reset baru.
11. **`seq` = jam logis hibrida, kolom `BigInt`.** Autoincrement lokal reset saat instal ulang
    ber-token sama, dan `Int` Prisma 32 bit.
12. **Route relay hub = satu route `GET` ber-`handler` + `wsHandler`**, didukung plugin
    (`@fastify/websocket/index.js:156-159`), ditambah method tulis. Tak ada dua pola path yang
    berbenturan.
13. Modul `src/src/api/client.ts` diimpor **61** berkas di `src/src` (grep pola impor hari ini; Brainstorm
    menyebut 35). Justru karena itu `export const api = createApi()` dipertahankan.

### S2. Arsitektur

```
 Browser operator hub
   │ cookie · /api/devices/:d/relay/*  (HTTP)  · tiket relay:<d>:terminal:<id>|events (WS)
   ▼
 HUB  Fastify ───────────────────────────────────────────────────────────────────────────────
   ├─ routes/devices-relay.ts   COOKIE_ONLY → RelayHub.request()/openStream()
   ├─ services/relay/hub.ts     registry deviceId → {relaySocket, hello, inflight, streams, credit}
   ├─ services/device-sockets.ts registry deviceId → {sync, relay}  ← DELETE /device-tokens menutup
   ├─ routes/sync.ts            /sync/ws (presence + capacity) · /sync/relay/ws · /sync/logs
   ├─ services/presence/*       + control (dari hello) + capacity + recentlyOffline (memori)
   ├─ services/logs/ingest.ts   redaksi lapis 2 → txn(high-water mark) → LogEntry · berkas transkrip
   ├─ routes/logs.ts            GET /logs · /logs/:id/transcript · /logs/retention (COOKIE_ONLY)
   └─ session-launch.ts         + LaunchError("remote-session") (presence menolak, tak meluluskan)
        ▲ WS /api/sync/relay/ws  (Bearer device, dibuka HANYA bila grant lokal menyala)
        ▲ WS /api/sync/ws        (changefeed ↓ · presence + capacity ↑)
        ▲ HTTP POST /api/sync/logs (tick sync)
 KLIEN Fastify (di belakang NAT) ─────────────────────────────────────────────────────────────
   ├─ services/relay/client.ts      connect/backoff/hello · grant berubah → tutup & buka ulang
   ├─ services/relay/dispatcher.ts  allowlist + grant → app.inject() / app.injectWS({onOpen})
   │                                kredit · potong ≤32 KiB · buang resize (dan in saat mode read) · geometry
   ├─ app.ts gate /api              cabang `remote` (rahasia proses ∧ bukan net.Socket) → capability
   ├─ routes/remote-control.ts      GET|PUT grant + logShipping + status + audit (COOKIE_ONLY)
   ├─ services/logs/event-tap.ts    session.* · launch.rejected · remote.* · grant.changed → LogEntry local
   ├─ services/logs/console-tap.ts  (lajur server, opt-in) → spool NDJSON $HANOMAN_HOME/log-spool/server
   └─ services/logs/shipper.ts      per lajur: batch → POST /sync/logs → ack → LogCursor("local")
```

### S3. Komponen

| Modul (baru/berubah) | Tanggung jawab | Turunan |
|---|---|---|
| `shared/src/relay.ts` (baru) | konstanta S4.1, zod frame relay `.strict()`, `RelayActor`, `REMOTE_CAPABILITIES`, `relayRouteAllowed()`, `remoteCapabilityFor()` (fungsi murni) | A |
| `shared/src/logs.ts` (baru) | `LOG_LANES`, zod batch/entri, `LogEntryView`, `nextSeq()` HLC murni, konstanta log | A (skema) / D |
| `shared/src/redact.ts` (baru) | `redactText(text, known)` murni + korpus test | D |
| `shared/src/presence.ts` | `zCapacityFrame`; `PresenceDeviceView.control/capacity` (aditif) | A |
| `shared/src/entities.ts` | `zSetting.remoteControl/logShipping/logRetention` | A (dua pertama), D (retensi) |
| `server/prisma/schema.prisma` + migration `20260915120000_log_terpusat` | `LogEntry`, `LogCursor` | A |
| `server/src/app.ts` | gate cabang `remote` (S4.5); daftar route baru | A |
| `server/src/services/agent-capabilities.ts` | top `devices`/`remote-control`/`logs` → COOKIE_ONLY | A/B/D |
| `server/src/services/ws-admission.ts` | `WsPrincipal.kind` + `remote`; `admitBrowserWs` cabang remote & target `relay:*`; `revalidateWsPrincipal(remote)`; `canSubscribeTopic(principal, topic)` | A/C |
| `server/src/services/device-sockets.ts` (baru) | registry socket per device + `closeDeviceSockets(id, 1008)` | A |
| `server/src/routes/device-tokens.ts` | cabut → tutup socket sebelum 204 | A |
| `server/src/routes/sync.ts` | `/sync/ws` menerima `capacity`; `/sync/relay/ws`; `/sync/logs` | A / D |
| `server/src/services/relay/{client,dispatcher,hub}.ts` (baru) | S2 | A (req/res), C (stream) |
| `server/src/routes/remote-control.ts` (baru) | S4.5 | A |
| `server/src/routes/devices-relay.ts` (baru) | HTTP relay (B), `wsHandler` (C) | B/C |
| `server/src/routes/ws-tickets.ts` | target `relay:<deviceId>:events|terminal:<id>` hanya `req.user` | C |
| `server/src/services/launch-authority.ts` · `routes/terminal.ts` · `services/session-launch.ts` | `remote` principal, `force` 403, `confirmRemote`, `LaunchError("remote-session")` | B |
| `server/src/routes/specs.ts` (`/specs/:id/done`) | gerbang presence dua langkah; `by` aktor remote | B |
| `server/src/services/presence/{registry,view,sender}.ts` | `recentlyOffline`, `control`, `capacity`; snapshot sesi dipakai bersama tap fase | A/B/D |
| `server/src/services/pty.ts` | hook sesi aditif | A |
| `server/src/services/events.ts` | `attach(c, {groups})`: grup terbatas untuk `remote` | C |
| `server/src/services/logs/{event-tap,console-tap,spool,shipper,ingest,search,retention}.ts` (baru) | S4.7–S4.8 | A (event-tap) / D |
| `server/src/services/retention.ts` | panggil `pruneLogs()` di sapuan yang sama | D |
| `src/src/api/client.ts` · `src/src/api/instance.tsx` (baru) | `createApi({base})`, `InstanceContext`, `useApi`, `useWsTarget` | B |
| `TerminalPane`, `SpecDocsModal`, panel IDE baca, `StartSessionModal`, `ClientsScreen` | mode remote (S4.11) | B/C |
| `RemoteInstanceView`, `RemoteBanner`, `LogsPanel`, `RemoteControlPanel` (baru) | S4.11 | B/C/D/A |

### S4. Kontrak

#### S4.1 Konstanta awal (`shared/src/relay.ts`, `shared/src/logs.ts`)

| Konstanta | Nilai | Cermin/alasan |
|---|---|---|
| `RELAY_PROTOCOL` | `1` | ditolak bila beda; `version` beda → peringatan |
| `RELAY_PART_MAX_BYTES` | 32 KiB | ½ `maxPayload` (pola `PRESENCE_MAX_FRAME_BYTES`) |
| `RELAY_MAX_STREAMS` | 6 per device | < `MAX_CONNECTIONS_PER_PRINCIPAL` 8 |
| `RELAY_MAX_INFLIGHT` | 4 per device | `MAX_INFLIGHT` ADR-0145 |
| `RELAY_RESPONSE_MAX_BYTES` · `RELAY_REASSEMBLY_MAX_BYTES` | 1 MiB · 1 MiB | `PULL_MAX_BYTES` ADR-0138; scrollback ≤ 320 KiB muat |
| `RELAY_REQUEST_BODY_MAX_BYTES` | 32 KiB | body aksi JSON kecil |
| `RELAY_CREDIT_INITIAL` · `RELAY_CREDIT_REFILL_BELOW` | 256 KiB · 64 KiB `bufferedAmount` browser | |
| `RELAY_SOCKET_MAX_BUFFERED` | 1 MiB | di atasnya seluruh stream device dianggap tanpa kredit |
| `RELAY_RESYNC_MIN_MS` | 5 000 | |
| `RELAY_REQ_TIMEOUT_MS` · `RELAY_SPAWN_TIMEOUT_MS` · `RELAY_OPEN_TIMEOUT_MS` | 30 000 · 120 000 · 10 000 | pembuatan worktree bisa > 30 dtk |
| `RELAY_MAX_FRAMES_PER_MIN` | 12 000 | 20 frame/dtk × 6 stream + ruang |
| `RELAY_IDLE_STREAM_CLOSE_MS` | 2 000 | stream tanpa penonton ditutup |
| `RELAY_UNSUPPORTED_RETRY_MS` | 30 × 60 000 | hub lama (upgrade 404) |
| `LOG_BATCH_MAX_ENTRIES` · `LOG_BODY_MAX_BYTES` · `LOG_DECODED_MAX_BYTES` | 500 · 1 MiB · 2 MiB | ADR-0138 cap ganda |
| `LOG_MSG_MAX_BYTES` · `LOG_DATA_MAX_BYTES` · `LOG_TRANSCRIPT_MAX_BYTES` | 4 KiB · 8 KiB · 1 MiB | `MAX_TRANSCRIPT_BYTES` yang ada |
| `LOG_SPOOL_MAX_BYTES` · `LOG_SPOOL_SEGMENT_BYTES` | 64 MiB · 1 MiB | |
| `LOG_LOCAL_PENDING_MAX_ROWS` | 50 000 | |
| `LOG_REPEAT_WINDOW_MS` | 60 000 | |
| `LOG_INGEST_MAX_PER_HOUR` | 20 000 per device | |
| `LOG_SEARCH_MAX_RANGE_DAYS` · `LOG_SEARCH_MAX_LIMIT` | 31 · 200 | |
| `LOG_RETENTION_DEFAULTS` | `{eventDays:90, serverDays:7, transcriptDays:30, maxBytes:268435456}` | |

#### S4.2 Frame socket relay `GET /api/sync/relay/ws`

Semua frame JSON teks, zod `.strict()` di kedua sisi. Frame yang tak lolos **dibuang**; hanya
pelanggaran `WsMessageGuard` atau `maxPayload` yang menutup socket relay (tak pernah socket sync).

```ts
type RelayActor = { hubOrigin: string; userId: string; email: string };   // KLAIM hub
// hub → klien
{ t:"welcome", v:1, protocol:1, version:string }
{ t:"req",    id:string/*≤64*/, method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE",
              path:string/*^/api/, ≤2048, tanpa ".."*/, query?:string/*≤2048*/, body?:unknown/*≤32 KiB*/,
              actor:RelayActor }
{ t:"cancel", id }
{ t:"open",   sid:string/*≤64*/, path:string, mode:"read"|"write", actor:RelayActor }
{ t:"data",   sid, d:string/*≤32 KiB, frame browser apa adanya*/ }
{ t:"credit", sid, n:number/*1..4 MiB*/ }
{ t:"close",  sid, code:number, reason?:string/*≤120*/ }
// klien → hub
{ t:"hello",  v:1, protocol:1, version:string, capabilities:RemoteCapability[] }
{ t:"res",    id, status?:number, contentType?:string, part:string/*≤32 KiB*/, end:boolean }  // status+contentType wajib di part pertama
{ t:"opened", sid, geometry?:{ cols:number, rows:number } }
{ t:"geometry", sid, cols:number, rows:number }
{ t:"data",   sid, d:string/*≤32 KiB*/, more?:true }      // more = potongan lanjutan; hub merakit ≤1 MiB
{ t:"close",  sid, code:number, reason?:string }
```

- **Kode tutup stream:** `1000` normal · `4004` sesi tak ada (diteruskan dari route) · `4009` resync ·
  `4401` admission route menolak · `4403` capability/allowlist · `4409` batas stream · `4502` galat
  dalam.
- **Kode tutup socket relay:** `1008` token dicabut/laju · `1009` frame > 64 KiB · `4000` digantikan ·
  `4001` protokol tak cocok · `4003` grant berubah (klien) · `1001` shutdown.

#### S4.3 Socket sync & presence (aditif)

```ts
// klien → hub di /api/sync/ws, di samping presence
zCapacityFrame = { t:"capacity", v:1, admission: LaunchStatus }.strict()
// dikirim saat signature berubah (tick snapshot 3 dtk) + bersama denyut presence 30 dtk
PresenceDeviceView += {
  control: { state:"available"|"protocol-mismatch", protocol:number, version:string,
             capabilities:RemoteCapability[], since:string } | null,   // null = tak ada socket relay
  capacity: LaunchStatus | null,
}
```

Hub lama: `zPresenceFrame.safeParse` gagal → frame `capacity` dibuang. Dashboard lama mengabaikan
field baru.

#### S4.4 Route hub baru

```
GET    /api/sync/relay/ws                         # Bearer device token; query token → 401; satu per device
                                                   # (baru menggantikan lama, 4000); openWsConnection(device)
GET|POST|PUT|PATCH|DELETE /api/devices/:deviceId/relay/*   # COOKIE_ONLY (top "devices")
  # HTTP: diteruskan sebagai `req` ke `/api/<*>` + query, body JSON apa adanya; status, content-type,
  #   dan body klien diteruskan apa adanya + header `x-hanoman-device`.
  #   Galat asal hub (body { error, relay }):
  #   404 relay:"unknown-device"      DeviceToken tak ada/dicabut
  #   503 relay:"offline"             socket relay tak terbuka (grant mati, klien lama, offline) + presence:"online"|"offline"
  #   409 relay:"protocol-mismatch"
  #   413 relay:"too-large"           body > 32 KiB, atau respons > 1 MiB
  #   415 relay:"unsupported-media"   non-JSON (multipart/unggahan)
  #   429 relay:"busy"                inflight > 4
  #   502 relay:"protocol"            frame klien rusak
  #   504 relay:"timeout"             30 dtk (120 dtk untuk POST …/terminal/sessions) → hub kirim `cancel`
  # WS (wsHandler route GET yang sama): admitBrowserWs(req, `relay:${deviceId}:${target}`),
  #   target = "events" (dari */events/ws) | `terminal:${id}` (dari */terminal/sessions/:id/ws).
  #   Hub kirim `open` → tunggu `opened` ≤10 dtk (tidak → close 1011). `close` klien → kode sama ke browser.
POST   /api/ws-tickets { target: "relay:<deviceId>:events" | "relay:<deviceId>:terminal:<sessionId>" }
  # hanya req.user (agent → 403 lewat default cookie-only; test principal di NODE_ENV=test)
POST   /api/sync/logs                             # S4.7 (device token)
GET    /api/logs · GET /api/logs/:id/transcript · GET|PUT /api/logs/retention   # S4.8 (COOKIE_ONLY)
```

Hub mencatat `relay.request` (method, path, status, ms) dan `relay.stream` (path, mode, bytes,
dropped, resyncs, ms) di `LogEntry` `deviceId:"local"`, beraktor cookie `{userId, email}` dan
`data.deviceId`.

#### S4.5 Route & gate klien

```
GET  /api/remote-control                           # COOKIE_ONLY (top "remote-control")
  → { control:{ enabled, capabilities }, logs:{ event, server, transcript },
      relay:{ state:"off"|"connecting"|"open"|"backoff"|"unsupported"|"rejected", since:string|null,
              hubOrigin:string|null, lastClose:{ code, reason }|null },
      shipping:{ event|server|transcript: { pending:number, lastAckAt:string|null, lastError:string|null } },
      audit: LogEntryView[] }                      # 50 terbaru: remote.* · grant.changed · remote.link
PUT  /api/remote-control { control?:{ enabled, capabilities }, logs?:{ event, server, transcript } }
  → view di atas · 400 capability ∉ REMOTE_CAPABILITIES, atau capability tulis tanpa sessions:read
  # efek sinkron sebelum balas: grant berubah → socket relay + seluruh injectWS ditutup (4003),
  # lalu dibuka ulang dengan hello baru bila masih menyala; logs.server mati → sadapan console dilepas.
```

**Gate `remote` di `app.ts`** diletakkan di awal hook gate `/api`, sebelum bypass `/api/sync` dan
cabang cookie:

```
if (headers["x-hanoman-relay"] !== undefined) {
  if (!inProcess(req) || !timingSafeEqual(header, RELAY_SECRET)) → 401            // AC-A6
  req.remote = { actor: parse(x-hanoman-relay-actor), capabilities: grant.capabilities,
                 mode: x-hanoman-relay-mode ?? "write" }
  if (!grant.enabled) → 401
  if (!relayRouteAllowed(method, path, body)) → 403 { error:"relay route not allowed" }
  verdict = checkAgentCapability(caps, method, path) — kecuali WS terminal mode read → sessions:read
  verdict gagal → 403 { error:"capability required", need }
}
```

`relayRouteAllowed` (murni, diuji tabel positif **dan** negatif):
- **sesi:** `GET /terminal/sessions`; `GET /terminal/sessions/:id/{phases,dialog}`;
  `POST /terminal/sessions/:id/{steer,interrupt,dialog/answer,dialog/takeover}`;
  `POST /terminal/sessions` **hanya** body ber-`spec` (varian shell/project → 403); WS
  `/terminal/sessions/:id/ws`.
- **dokumen & review:** `GET /specs/:id/docs`, `GET /specs/:id/docs/*`, `GET /specs/:id/review(/*)`,
  `GET /terminal/sessions/:id/review(/*)` — **tanpa** query `download`.
- **IDE baca:** `GET /projects/:id/{tree,file,working-status,file-diff,status,graph,graph/search,compare,compare/file,commit/:sha,commit/:sha/file}`.
- **lain-lain:** `POST /specs/:id/done`, WS `/events/ws`.
- **Tidak termasuk:** segala hal lain — `archive`, `upload`, `entry`, `PUT /file`, `git`,
  `DELETE /terminal/sessions/:id`, `PATCH|DELETE /specs`, lampiran, `integrate`, `settings`, dan
  seluruh top COOKIE_ONLY.

Dispatcher menjalankan request:
- **`req`** → `app.inject({ method, url: path + query, headers })`. Header yang dikirim: `host`,
  `x-hanoman-relay`, `-actor` (base64url JSON), `content-type: application/json`, dan `payload`.
  Respons dipotong jadi `res` ≤ 32 KiB per part; di atas 1 MiB → `res {status:502, part:"{\"error\":\"relay-response-too-large\"}", end:true}`.
- **`open`** → `app.injectWS(path, { headers: {…, "x-hanoman-relay-mode": mode} }, { onOpen })`:
  - frame route → kredit → `data` (dipotong, `more`);
  - frame hub → buang `resize` selalu, buang `in`/`diag` bila `mode:"read"`, sisanya `ws.send(d)`;
  - geometry pane dibaca dari `list-panes` yang sudah dipoll (lebar/tinggi pane), `geometry` dikirim
    saat berubah.
- **Spec 404 saat start:** satu `syncOnce` lalu ulang sekali.
- **Audit:** setiap `req`/`open` → `appendEvent(remote.request|remote.stream)`.

#### S4.6 Perubahan route yang ada

| Route | Perubahan |
|---|---|
| `POST /terminal/sessions` | `force` dari `req.remote` → 403 sebelum `approveLaunch`. `launchPrincipal`: `remote` ber-`sessions:spawn` → `remote:<email>@<hubOrigin>`. Body aditif `confirmRemote?: boolean`. `LaunchError("remote-session")` → `409 { error:"remote-session", remoteSession:{deviceId,name,sessionId} }`; varian offline → `409 { error:"confirm-required", remoteSession:{deviceId,name,sessionId:null,offline:true} }` |
| `startSpecSession` (semua pemanggil) | gerbang presence di hub: sesi `working|waiting` untuk spec di device ≠ local → `remote-session`. `recentlyOffline` (≤ 24 jam) atau `SessionResult.deviceId` terakhir (≠ null, `Spec.stage` belum `done`) → `confirm-required` kecuali `confirmRemote`. Scheduler tak pernah mengirim `confirmRemote` |
| `POST /specs/:id/done` | live check + presence device lain → `409 confirm-required { session:{ id, deviceId, name } }`. `by` = `req.user.email` atau `remote:<email>@<hubOrigin>` |
| `PUT /settings` | tiga kunci baru dibaca dari baris tersimpan, bukan body |
| `DELETE /device-tokens/:id` | `closeDeviceSockets(id, 1008, "token revoked")` sebelum `204` |
| `GET /sync/ws` | union `presence` \| `capacity`; `socket.on("close")` → `recentlyOffline` diisi dari sesi terakhir |
| `GET /events/ws`, `GET /terminal/sessions/:id/ws` | `admitBrowserWs` cabang remote; `/events/ws` remote → grup `sessions`,`leadAsks`,`cleanups` + topik `git` (butuh `ide:read`) |
| `registerSessionHooks` | aditif (Set); riwayat & tap log sama-sama menembak |

#### S4.7 Ingest log `POST /api/sync/logs` (device token)

```ts
// headers: authorization Bearer · content-type application/json · content-encoding gzip (opsional)
zLogBatch = { v:1, lane:"event"|"server"|"transcript", attempt:number/*≥1*/,
              entries: LogWireEntry[] /*1..500, seq naik ketat*/ }.strict()
LogWireEntry = { seq:number/*safe int, HLC*/, ts:string/*ISO*/, level:"debug"|"info"|"warn"|"error",
                 kind:string/*≤80*/, msg:string/*≤4 KiB*/, projectId?:string, specId?:string,
                 sessionId?:string/*≤200*/, data?:Record<string,unknown>/*≤8 KiB JSON*/,
                 transcript?:string/*hanya lane transcript, ≤1 MiB*/ }.strict()
// 200 { lane, accepted, duplicate, lastSeq }
// 400 skema · 401 token · 413 body mentah >1 MiB atau terdekompresi >2 MiB · 415 encoding asing
// 429 { error, retryAfterSec } kuota 20 000 entri/jam per device
```

Urutan hub:
1. gunzip ber-`maxOutputLength`;
2. zod;
3. redaksi lapis 2;
4. tulis berkas transkrip (`tmp` + `rename`) ke `remote-transcripts/<deviceId>/<seq>.txt`;
5. `$transaction`: baca `LogCursor` → saring `seq > cursor` → `createMany` → `upsert` kursor ke seq
   maks;
6. bila `attempt === 1 && duplicate > 0` → entri `log.gap reason:"seq-regression"`.

Klien (shipper, dipanggil sesudah `syncOnce` pada tick yang ada):
- per lajur, ≤ 4 batch/tick, sumber `event`/`transcript` = `LogEntry local seq > LogCursor(local)`,
  `server` = segmen spool;
- **200** → kursor := `max(cursor, min(lastSeq, maxSeqTerkirim))`, segmen yang habis dihapus;
- **400** → `log.gap reason:"rejected"` + kursor maju;
- **404** → tunda 30 mnt;
- **413** → belah batch;
- **429** → tunda `retryAfterSec`;
- **5xx/jaringan** → ulang di tick berikutnya dengan `attempt + 1`.

`nextSeq(last, now) = max(last + 1, now × 1000)`. Nilai `last` saat boot = `max(seq)` baris local
(event/transcript) atau ekor segmen spool terbaru, dibatasi bawah `LogCursor`.

Kind lajur `event`:
- `session.start`, `session.phase {from,to}`, `session.end {exitCode, endedReason}`;
- `session.result {status, oldStage, newStage}`;
- `launch.rejected {kind, admission?}`;
- `remote.request`, `remote.stream`, `remote.link {state, code}`, `grant.changed {from, to, by}`;
- `relay.request`, `relay.stream` (hub);
- `log.gap {lost, reason, fromSeq, toSeq}`.

#### S4.8 Pencarian & retensi di hub (COOKIE_ONLY, top `logs`)

```
GET /api/logs?from=ISO&to=ISO[&device=<deviceId|local>][&project][&spec][&session]
             [&lane=event,server,transcript][&level=info|warn|error][&kind=<prefix>][&q=≤200][&cursor][&limit≤200]
  → { items: LogEntryView[], nextCursor: string|null, limit }
  # from/to wajib, to-from ≤ 31 hari (400); urut ts desc, id desc; cursor opaque base64url {ts,id}
  # TANPA total — pengecualian keempat ADR-0107 (COUNT atas tabel log per halaman; lihat ADR-0166 §7)
LogEntryView = { id, deviceId, deviceName, lane, seq:string, ts, receivedAt, level, kind,
                 projectId|null, specId|null, sessionId|null, msg, data|null, hasTranscript }
GET /api/logs/:id/transcript → text/plain; charset=utf-8 · 404 (bukan lajur transcript / berkas hilang)
GET /api/logs/retention → LogRetention · PUT /api/logs/retention LogRetention → 200 | 400 (rentang)
  # LogRetention = { eventDays 1..365, serverDays 1..365, transcriptDays 1..365, maxBytes 16 MiB..4 GiB }
```

Sapuan: `runRetention()` memanggil `pruneLogs(now, setting.logRetention)`.
1. `deleteMany` per lajur `ts < cutoff` dalam potongan 5 000 id.
2. Selama `aggregate _sum.bytes > maxBytes`, hapus terlama per potongan.
3. Hapus berkas transkrip baris yang terhapus.
4. `reconcileRemoteTranscripts()` memungut berkas tanpa baris.

Di klien, baris `local` yang sudah di-ack dan lewat umur ikut disapu fungsi yang sama.

#### S4.9 Kunci `Setting.data` (tanpa migration)

```ts
remoteControl: z.object({ enabled: z.boolean().default(false),
  capabilities: z.array(z.enum(REMOTE_CAPABILITIES)).default([]) }).default({}),
  // REMOTE_CAPABILITIES = ["sessions:read","sessions:write","sessions:spawn","backlog:read","backlog:write","ide:read"]
logShipping: z.object({ event: z.boolean().default(true), server: z.boolean().default(false),
  transcript: z.boolean().default(false) }).default({}),
logRetention: z.object({ eventDays: z.number().int().min(1).max(365).default(90),
  serverDays: …default(7), transcriptDays: …default(30),
  maxBytes: z.number().int().min(16 * 1024 ** 2).max(4 * 1024 ** 3).default(256 * 1024 ** 2) }).default({}),
```

#### S4.10 Skema data + rencana migration (turunan A)

```prisma
/// SPEC-1215 · ADR-0166 · LOCAL-only per instance; BUKAN entitas sync.
model LogEntry {
  id            Int      @id @default(autoincrement())
  deviceId      String   // DeviceToken.id pengirim, atau "local" (instance ini)
  lane          String   // event | server | transcript (zod shared)
  seq           BigInt   // HLC per (deviceId, lane); Int Prisma 32 bit tak cukup
  ts            DateTime
  receivedAt    DateTime @default(now())
  level         String
  kind          String
  projectId     String?  // tanpa FK (konvensi SessionResult)
  specId        String?
  sessionId     String?
  msg           String
  data          Json?
  transcriptKey String?  // hub: remote-transcripts/<deviceId>/<seq>.txt · klien: kunci transcript-store
  bytes         Int      // msg + data + transkrip, untuk plafon maxBytes
  @@unique([deviceId, lane, seq])
  @@index([ts])
  @@index([deviceId, ts])
  @@index([projectId, ts])
  @@index([specId, ts])
  @@index([lane, ts])
}
model LogCursor {
  deviceId  String   // hub: pengirim · klien: "local" (sudah di-ack hub)
  lane      String
  seq       BigInt
  updatedAt DateTime @updatedAt
  @@id([deviceId, lane])
}
```

- **Migration** `server/prisma/migrations/20260915120000_log_terpusat/migration.sql`: `CREATE TABLE`
  ×2 + indeks, nol backfill, dan tak menyentuh tabel lain. Timestamp sesudah migration terakhir
  `20260914120000_agent_invocation_phase`.
- **Wajib dikecualikan eksplisit:** `SYNCED`/`FIELDS`, `PG_ORDER` dan daftar model
  `migrate-from-postgres` (tabel tak ada di Postgres lama), serta `WEBHOOK_ENTITIES`. Test DMMF yang
  mencocokkan daftar model harus diperbarui, bukan dilemahkan.

#### S4.11 Kontrak frontend

- **`createApi({ base? })`** (`src/src/api/client.ts`): setiap URL `paths.*` berprefiks `/api` diganti
  `base` (`/api/devices/<deviceId>/relay`). `export const api = createApi()` tak berubah bagi 61
  importir.
- **`InstanceContext`** (`src/src/api/instance.tsx`):
  `{ kind:"local" } | { kind:"remote", deviceId, name, version, protocol, capabilities }`. Menyediakan
  `useInstance()`, `useApi()`, dan `useWsTarget(localTarget)` → `{ url, ticketTarget }`
  (`relay:<deviceId>:<target>`).
- **`TerminalPane` mode remote:**
  - URL/tiket dari `useWsTarget`;
  - **tak pernah** mengirim `resize`; frame `{t:"geometry"}` → `term.resize(cols, rows)`;
  - tanpa `sessions:write` → `onData` tak dikirim + penanda "baca-saja";
  - close `4009` ditangani `retry()` yang sudah ada.
- **`SpecDocsModal`, panel IDE baca (tree/file/working-status/file-diff/status/graph/compare):**
  `useApi()`; aksi tulis **tak dirender** saat remote.
- **`ClientsScreen`:**
  - kartu device menampilkan `control` (tersedia / kendali mati / versi) dan `capacity`
    (`liveAgentCount/maxConcurrent`, `loadPerCore`);
  - tombol **Buka** → `RemoteInstanceView` (tab Terminal/Dokumen/IDE) di dalam `InstanceContext`
    remote, dengan `RemoteBanner` "Sedang melihat klien X · vN" (+ peringatan versi, penanda
    baca-saja);
  - tab **Log** → `LogsPanel`.
- **`StartSessionModal` (hub):**
  - pemilih target berisi "hub ini" + device (default §K6; alasan tak terpilih ditampilkan);
  - target remote → `useApi` remote, "Mulai tetap" (force) **tak dirender**;
  - `409 remote-session` → aksi "Sambung ke sesi di X"; `409 confirm-required` → konfirmasi dua
    langkah.
- **Aksi sesi remote** (steer, interrupt, jawab dialog, tandai selesai) memakai komponen yang sudah
  ada di dalam `InstanceContext` remote. Tak ada salinan UI.
- **`RemoteControlPanel`** (Settings klien): empat toggle (Lihat / Tulis terminal / Mulai sesi / Tandai
  selesai), tiga toggle lajur log, status relay & pengiriman, audit terbaru.

### S5. Aliran utama

1. **Start dari hub.**
   1. Operator membuka Start di hub, dengan target default klien X (ber-`sessions:spawn`, online,
      kapasitas cukup).
   2. `POST /api/devices/X/relay/terminal/sessions {spec,…}` → gerbang presence hub (sesi hidup di
      device lain → 409).
   3. Hub mengirim `req`; klien lolos allowlist + grant → `app.inject(POST /api/terminal/sessions)` →
      `startSpecSession` apa adanya (approval `remote:…`, gerbang cap/beban, worktree di klien).
   4. `res 201 {id}` → hub meneruskannya, lalu mencatat `relay.request` dan (di klien)
      `remote.request`.
   5. Frame presence berikutnya memuat sesinya.
2. **Menonton terminal.**
   1. Tab mirror meminta tiket `relay:X:terminal:<id>` → WS ke hub → `open` → dispatcher
      `injectWS({onOpen})` → scrollback/`alt`/`phase` → `data` (dipotong) → hub merakit → browser.
   2. Kredit habis → keluaran dibuang. Kredit pulih ≥ 5 dtk sejak resync terakhir → hub menutup
      browser `4009` → pane menyambung ulang → replay.
   3. Tab ditutup → hub `close` → dispatcher menutup `injectWS` ≤ 2 dtk.
3. **Log offline → online.**
   1. Tap event menulis `LogEntry local`; sadapan console menulis spool.
   2. Hub mati → shipper gagal, kursor diam.
   3. Hub pulih → batch dikirim ulang (`attempt+1`) → hub menyaring `seq > cursor` → nol duplikat →
      kursor klien maju.
4. **Pencabutan.** `DELETE /device-tokens/:id` → `closeDeviceSockets` (sync + relay, 1008) → 204.
   Reconnect klien ditolak 401 → backoff.

### S6. Penanganan galat

| Kondisi | Perilaku | Jejak |
|---|---|---|
| Grant mati / klien lama / offline | relay HTTP `503 relay:"offline"`, kartu device "kendali mati/tak tersedia" | — |
| `hello.protocol` beda | socket relay `4001`; `control.state="protocol-mismatch"`; mirror ditolak | `remote.link` |
| Hub lama (upgrade relay 404) | `relay.state="unsupported"`, coba lagi ≥ 30 mnt | `remote.link` |
| Request relay > 32 KiB / respons > 1 MiB | `413 relay:"too-large"` | `relay.request` warn |
| Inflight > 4 / stream > 6 | `429 relay:"busy"` / close `4409` | warn |
| Timeout 30/120 dtk | `504`, hub kirim `cancel`; klien membatalkan penantian. Efek yang sudah jalan (mis. sesi lahir) **tak** dibatalkan dan terlihat di presence | `relay.request` error |
| Frame relay rusak | dibuang; berulang melewati guard → socket relay `1008`, sync tetap | `remote.link` |
| Header relay dari jaringan | `401` | — (tak mencapai route) |
| Capability/allowlist gagal | `403 {need}` / `403 relay route not allowed` | `remote.request` warn |
| `force` dari remote | `403` sebelum approval | `remote.request` warn |
| Presence: sesi hidup di device lain | `409 remote-session` | `launch.rejected` |
| Presence: device punah baru-baru ini | `409 confirm-required` | `launch.rejected` |
| Spec belum ter-pull di klien | `syncOnce` sekali lalu ulang; masih 404 → diteruskan | `remote.request` |
| Kredit habis | keluaran terminal dibuang, events disimpan terbaru per kunci; resync ≤ 1×/5 dtk | `remote.stream.dropped/resyncs` |
| `bufferedAmount` socket relay > 1 MiB | seluruh stream device tanpa kredit sampai turun | idem |
| Ingest 400/404/413/429/5xx | S4.7 | `log.gap` untuk 400 |
| Spool penuh | buang `server` terlama → `transcript` → `event` | `log.gap spool-full` |
| Redaktor melempar | entri dibuang | `log.gap redaction-failed` |
| Berkas transkrip hilang sebelum dikirim | entri dikirim `data.missing:true`, tanpa `transcript` | — |
| Transaksi ingest gagal | `500`; berkas transkrip yang sudah ditulis jadi yatim → dipungut sapuan | — |

### S7. Keamanan (ringkas; model lengkap di `security/threat-model.md` §Kendali jarak jauh)

- **Aktor baru "hub terhadap klien".** Blast radius hub jebol = aksi dalam batas grant di **setiap**
  klien opt-in. Pagarnya:
  - grant default mati, dinyalakan cookie lokal;
  - capability `danger` terpisah;
  - allowlist sempit; `force` ditolak;
  - audit dua sisi; pencabutan seketika dari kedua ujung.
- **Principal `remote` tak bisa dipalsukan dari jaringan** (S0a, AC-A6). Rahasia proses tak pernah
  ditulis ke disk/log/env anak.
- **Rahasia di log** disaring dua lapis, gagal-tertutup. Transkrip dan log server default mati.
- **Tak ada kredensial di URL relay.** Tiket WS sekali pakai tetap berlaku; route relay dan
  `/remote-control`/`/logs` COOKIE_ONLY.

### S8. Turunan

| Turunan | Isi | Butuh | AC |
|---|---|---|---|
| **A · Fondasi kanal** | skema `shared` relay/logs; migration `LogEntry`/`LogCursor`; tap event lokal + hook aditif; `/remote-control` + `RemoteControlPanel`; relay client/dispatcher (req/res) + gate `remote` + allowlist; hub `/sync/relay/ws` + registry + pencabutan seketika; frame `capacity` + `control`/`capacity` di presence | — | AC-A1…A12, AC-M1…M2 |
| **B · Orkestrasi** | route HTTP `/devices/:d/relay/*`; gerbang `remote-session`/`confirm-required` (start & done); `launchPrincipal`/`force`; spec-404 → `syncOnce`; `createApi` + `InstanceContext`; target Start + aksi sesi remote di layar Klien | A | AC-B1…B11 |
| **C · Tampilan identik** | `wsHandler` relay + tiket; stream terminal/events; kredit/resync/geometry/plafon; `TerminalPane`/`SpecDocsModal`/IDE baca di `InstanceContext`; `RemoteInstanceView` + banner; pengukuran 8 GB | A, B | AC-C1…C10 |
| **D · Log terpusat** | shipper; spool + sadapan console; lajur transcript; redaksi; ingest + kuota; pencarian + retensi + `LogsPanel` | A | AC-D1…D10 |

- **Urutan:** A → (B ∥ D) → C. Rilis **hub dulu** per turunan (K12).
- **Mandiri-hijau:** setiap turunan meninggalkan pohon hijau dan bisa di-merge sendiri. Penanda
  **dirancang** di doc SoT dicabut hanya untuk bagian yang turunannya mendarat.
- **Backlog turunan tidak dibuat di DB pada fase ini.** Itu bukan konvensi fase Spec, dan SPEC-1215
  masih dipegang sesi ini (satu backlog satu sesi, ADR-0015). Memfilekan A–D sekarang membuka jalan dua
  sesi mengerjakan kontrak yang sama. Turunan dipakai sebagai **irisan plan** berurutan. Bila Plan
  menilai satu sesi terlalu besar, B–D difilekan saat itu dengan spec ini sebagai design-of-record.

### S9. Acceptance criteria (EARS)

Kriteria sukses Objective dirujuk sebagai (K1)…(K7).

**Turunan A — fondasi kanal**
- **AC-A1** (K6) — WHILE `Setting.remoteControl.enabled` bernilai `false`, THE klien SHALL tak pernah
  mengirim upgrade ke `/api/sync/relay/ws`, dibuktikan test yang menghitung nol upgrade ke hub palsu.
- **AC-A2** — WHEN operator klien bercookie menyalakan grant lewat `PUT /api/remote-control`, THE
  klien SHALL membuka socket relay dan mengirim `hello` berisi capability grant dalam ≤ 5 dtk selama
  hub terjangkau.
- **AC-A3** (K6) — IF `PUT /api/settings` membawa `remoteControl`/`logShipping`/`logRetention`, THEN
  THE server SHALL mempertahankan nilai tersimpan. IF principal non-cookie memanggil
  `/api/remote-control`, THEN THE server SHALL menjawab 403.
- **AC-A4** (K6) — WHEN device token dicabut di hub, THE hub SHALL menutup socket sync **dan** relay
  device itu dengan `1008` sebelum `DELETE /device-tokens/:id` membalas `204`.
- **AC-A5** (K6) — WHEN operator klien mematikan grant atau mengubah capability-nya, THE klien SHALL
  menutup socket relay dan setiap `injectWS` turunannya sebelum `PUT` membalas.
- **AC-A6** — IF request jaringan membawa header `x-hanoman-relay` (termasuk dengan rahasia yang benar),
  THEN THE gate SHALL menjawab 401 untuk HTTP maupun upgrade WS.
- **AC-A7** — IF `req`/`open` menyasar route di luar `relayRouteAllowed` atau capability di luar grant,
  THEN THE klien SHALL menjawab 403 tanpa menjalankan handler route itu.
- **AC-A8** — THE klien SHALL mencatat setiap `req`/`open` jarak jauh sebagai `LogEntry` lajur `event`
  (`remote.request`/`remote.stream`) berisi aktor klaim hub, method/path, status, dan durasi.
- **AC-A9** — WHEN hub menerima `hello` ber-`protocol` ≠ `RELAY_PROTOCOL`, THE hub SHALL menutup socket
  relay `4001` dan menampilkan `control.state = "protocol-mismatch"`.
- **AC-A10** (K3) — WHILE socket sync terbuka, THE klien SHALL mengirim frame `capacity` saat angka
  `launchStatus()` berubah dan bersama denyut presence. THE hub versi sebelumnya SHALL tetap sync normal.
- **AC-A11** — IF socket relay ditolak, gagal protokol, atau melanggar kuota/ukuran, THEN socket sync
  device yang sama SHALL tetap terbuka dan changefeed tetap mengalir.
- **AC-A12** — IF upgrade relay dijawab 404, THEN THE klien SHALL menandai `relay.state = "unsupported"`
  dan tak mencoba lagi sebelum 30 mnt.

**Turunan B — orkestrasi**
- **AC-B1** (K1) — WHEN operator hub memanggil `POST /api/devices/:d/relay/terminal/sessions {spec}` untuk
  klien ber-grant `sessions:spawn`, THE klien SHALL menjalankan `POST /api/terminal/sessions` lewat
  `app.inject` dengan body yang sama, dan worktree SHALL lahir di mesin klien.
- **AC-B2** (K1) — THE test kontrak SHALL menjalankan start, steer, interrupt, jawab dialog, dan tandai
  selesai atas fixture identik lewat cookie lokal dan lewat relay, lalu membuktikan kolom `Spec`,
  berkas fase, id sesi, dan path worktree identik. Beda yang diizinkan hanya prefix aktor
  (`launchApprovedBy`, `manualDone.by`).
- **AC-B3** — IF request relay membawa `force: true`, THEN THE klien SHALL menjawab 403 sebelum
  `approveLaunch`.
- **AC-B4** (K2) — WHEN klien sudah punya sesi hidup untuk SPEC itu, THE start relay SHALL memulangkan
  id sesi yang ada tanpa pane kedua.
- **AC-B5** (K2) — IF presence hub menunjukkan sesi `working|waiting` untuk SPEC X di device D, THEN
  setiap `startSpecSession` SPEC X di hub (manusia maupun scheduler) dan start relay ke device selain D
  SHALL ditolak `409 remote-session {deviceId, name, sessionId}`.
- **AC-B6** — IF device yang terakhir tercatat mengerjakan SPEC X sudah punah dari presence, THEN start
  dan `POST /specs/:id/done` di hub SHALL menjawab `409 confirm-required` dan hanya berhasil dengan
  `confirmRemote: true` / `confirm: true`.
- **AC-B7** (K3) — WHEN dialog Start dibuka di hub untuk backlog ber-`handledBy`, THE dialog SHALL
  memilih default target = device `handledBy` pertama yang online, ber-`sessions:spawn`, dan
  kapasitasnya tak penuh (tanpa kandidat → "hub ini"). THE hub SHALL tak meluncurkan apa pun tanpa klik
  manusia.
- **AC-B8** (K3) — WHILE device offline, tanpa grant, berkapasitas penuh, atau berprotokol lain, THE
  dialog Start SHALL menampilkannya tak terpilih beserta alasannya. Status online/offline mengikuti
  siklus presence ≤ 90 dtk.
- **AC-B9** (K1) — WHEN operator hub menekan steer/interrupt/jawab dialog/tandai selesai pada sesi
  klien, THE hub SHALL merutekannya ke route klien yang sama dan meneruskan status serta body klien
  apa adanya.
- **AC-B10** — IF relay offline, timeout, atau respons melebihi 1 MiB, THEN THE hub SHALL menjawab
  503/504/413 ber-`relay` kind tanpa menulis state lokal selain log `relay.request`.
- **AC-B11** — IF klien menjawab 404 `spec not found` untuk start relay, THEN THE klien SHALL
  menjalankan satu `syncOnce` lalu mengulang sekali sebelum meneruskan jawabannya.

**Turunan C — tampilan identik**
- **AC-C1** (K4) — WHEN operator membuka klien X di hub, THE layar SHALL merender modul `TerminalPane`,
  chip fase, `SpecDocsModal`, dan panel IDE baca yang sama (satu berkas sumber, tanpa salinan) di
  dalam `InstanceContext` remote, disertai banner "Sedang melihat klien X · vN".
- **AC-C2** (K4) — WHILE `InstanceContext` remote, THE `TerminalPane` SHALL tak pernah mengirim frame
  `resize`, dan THE dispatcher klien SHALL membuang setiap `resize` dari hub dalam mode apa pun.
- **AC-C3** (K4) — WHERE grant tak memuat `sessions:write`, THE dispatcher SHALL membuang frame `in`,
  dan THE pane SHALL menampilkan penanda baca-saja.
- **AC-C4** — WHILE kredit sebuah stream terminal habis, THE klien SHALL membuang keluaran alih-alih
  menahannya, dan sesudah kredit pulih SHALL memicu resync paling sering 1× per 5 dtk.
- **AC-C5** — THE klien SHALL membatasi 6 stream serentak dan 4 request inflight per device, dengan
  setiap frame relay ≤ 64 KiB. Stream ke-7 SHALL ditutup `4409`.
- **AC-C6** — WHEN penonton terakhir sebuah stream pergi, THE klien SHALL menutup `injectWS`-nya dalam
  ≤ 2 dtk.
- **AC-C7** (K4) — IF `hello.protocol` tak cocok, THEN THE hub SHALL menolak membuka tampilan. IF hanya
  `version` berbeda, THEN THE banner SHALL memperingatkan.
- **AC-C8** — THE dispatcher SHALL memasang listener `injectWS` lewat `onOpen`, sehingga frame yang
  dikirim route secara sinkron saat attach (scrollback, `alt`, `phase`) sampai ke hub. Test regresi
  mereproduksi 0/2 → 2/2 dari S0a.
- **AC-C9** — THE principal `remote` pada `/events/ws` SHALL hanya menerima grup `sessions`, `leadAsks`,
  `cleanups` dan topik `git` (bila `ide:read`). Grup `cookieOnly` SHALL tak pernah terkirim.
- **AC-C10** — WHILE 4 stream terminal dari agen sibuk aktif dengan RTT 200 ms, THE proses server klien
  di Mac mini 8 GB SHALL tetap dalam anggaran S0b. Hasil ukur dicatat di ADR-0165.

**Turunan D — log terpusat**
- **AC-D1** (K5) — WHILE klien terhubung ke hub, THE klien SHALL mengirim lajur `event` pada tick sync.
  Lajur `server` dan `transcript` SHALL mati sampai dinyalakan cookie lokal.
- **AC-D2** (K5) — WHEN batch yang sama dikirim ulang, THE hub SHALL menyisipkan nol baris baru dan
  membalas `duplicate` = jumlah entri. Unique `(deviceId, lane, seq)` SHALL tak pernah dilanggar di
  test, termasuk simulasi crash di antara commit hub dan kursor klien.
- **AC-D3** (K5) — WHILE klien offline, THE klien SHALL menampung entri dalam batas S4.1. Bila penuh,
  lajur `server` terlama SHALL dibuang lebih dulu dengan entri `log.gap`.
- **AC-D4** — THE klien SHALL meredaksi `msg`/`data`/transkrip sebelum spool atau pengiriman, dan THE
  hub SHALL meredaksi ulang saat ingest. IF redaktor melempar, THEN entri SHALL dibuang dan diganti
  `log.gap reason:"redaction-failed"`.
- **AC-D5** (K5) — WHEN operator hub memanggil `GET /api/logs` dengan `from`/`to` ≤ 31 hari dan
  penyaring device/project/spec/lane/level/q, THE hub SHALL mengembalikan entri terurut `ts desc`
  berpaginasi kursor ≤ 200/halaman. Rentang absen atau > 31 hari SHALL dijawab 400.
- **AC-D6** (K5) — THE sapuan retensi harian SHALL menghapus entri melewati `logRetention.<lane>Days`
  dan, selama total `bytes` > `maxBytes`, entri terlama. Baris dihapus lebih dulu, berkas transkrip
  sesudahnya, dan yatim dipungut.
- **AC-D7** — IF ingest melampaui 20 000 entri/jam per device, THEN THE hub SHALL menjawab `429
  retryAfterSec`, dan THE klien SHALL menunda lajur itu tanpa menghentikan sync.
- **AC-D8** (K5) — THE hub SHALL mencatat setiap aksi relay (`relay.request`/`relay.stream`) beraktor
  cookie hub, dan THE pencarian per SPEC SHALL menampilkannya bersama `remote.*` milik klien tujuan.
- **AC-D9** — IF `POST /api/sync/logs` dijawab 404, THEN THE klien SHALL menunda pengiriman 30 mnt
  dengan spool tetap berbatas.
- **AC-D10** — WHERE lajur `server` menyala, THE sadapan `console` SHALL meneruskan keluaran asli ke
  stdout/stderr tanpa perubahan, dan baris identik beruntun dalam 60 dtk SHALL digabung
  (`data.repeat`).

**Klien mandiri**
- **AC-M1** (K7) — WHERE `SYNC_SERVER_URL` kosong, THE instance SHALL tak memasang sadapan console, tak
  membuka relay, dan tak menjalankan shipper. Suite yang sudah ada SHALL hijau tanpa perubahan
  ekspektasi.
- **AC-M2** (K7) — IF hub tak terjangkau, THEN peluncuran, terminal, dan sync lokal klien SHALL berjalan
  tanpa menunggu relay atau shipper (keduanya fire-and-forget di belakang backoff).

### S10. Rencana verifikasi

**Test per turunan (TDD).**
- **`shared`:**
  - `relay.test.ts`: frame `.strict()`, batas byte, tabel `relayRouteAllowed` positif/negatif;
  - `logs.test.ts`: `nextSeq` monoton termasuk jam mundur dan restart;
  - `redact.test.ts`: korpus pola + nilai diketahui + lempar → buang;
  - `presence.test.ts`: `zCapacityFrame`.
- **Server A:**
  - `relay-gate.test.ts`: `listen()` nyata, header + rahasia benar → 401 WS & HTTP; in-process lolos;
    403 `need`; WS terminal `mode:read` = `sessions:read`;
  - `relay-dispatcher.test.ts`: listener `onOpen` → scrollback/`alt`/`phase` sampai; `resize` dibuang;
    `in` dibuang saat read; pemotongan > 32 KiB;
  - `relay-hub.route.test.ts`: 4001, 4000, guard menutup relay bukan sync;
  - `device-token-revoke.test.ts`;
  - `remote-control.route.test.ts`: COOKIE_ONLY + `PUT /settings` mempertahankan;
  - `session-hooks.additive.test.ts`;
  - `sync-capacity.test.ts`.
- **Server B:**
  - `relay-contract.test.ts` (AC-B2);
  - `remote-session-gate.test.ts`: hidup → 409; punah → konfirmasi; scheduler melewati;
  - `devices-relay.route.test.ts`: 404/503/409/413/415/429/504 + `cancel`;
  - `force` 403; spec-404 → `syncOnce` sekali.
- **Server C:** `relay-stream.test.ts` — kredit → buang, resync 4009 berjarak, 4409, grup `remote`,
  `geometry`, tutup ≤ 2 dtk tanpa penonton.
- **Server D:**
  - `log-ingest.route.test.ts`: kirim ulang, gzip cap 413, 429, seq naik, berkas-sebelum-baris,
    redaksi lapis 2, `seq-regression`;
  - `log-shipper.test.ts`: ack, crash-kirim-ulang, 400/404/413;
  - `log-spool.test.ts`: segmen, urutan buang, `log.gap`, `repeat`;
  - `logs.route.test.ts`: rentang wajib, penyaring, kursor stabil;
  - `retention-logs.test.ts`.
- **Frontend (RTL):**
  - `instance.test.tsx`: prefix `createApi`, URL WS & tiket;
  - `TerminalPane.remote.test.tsx`: nol `resize`, `geometry`, baca-saja;
  - `StartSessionModal.target.test.tsx`;
  - `ClientsScreen.control.test.tsx`;
  - `LogsPanel.test.tsx`;
  - `RemoteControlPanel.test.tsx`.

Resep run di mesin bersesi banyak: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <paths>`.

**Pengukuran.**
- **(C)** Resep S0b.
- **(D)** Ingest sintetis 10 device × batch 500 entri tiap 15 dtk selama 10 mnt ke hub dev
  ber-`HANOMAN_HOME` terpisah. Ukur p95 `GET /specs` (baseline vs selama) dan jumlah `P1008`. Lulus
  bila p95 naik ≤ 20 % dan nol `P1008`. Bila gagal, turunkan `LOG_INGEST_MAX_PER_HOUR`/ukuran batch
  lewat amandemen ADR-0166.

**API nyata (sekali di akhir tiap turunan).** Boot hub + klien (dua `HANOMAN_HOME`, dua port, klien
ber-`SYNC_SERVER_URL` ke hub), lalu curl:
- `PUT /api/remote-control`;
- `GET /api/presence` (`control`/`capacity`);
- `POST /api/devices/:d/relay/terminal/sessions`;
- `POST /api/devices/:d/relay/terminal/sessions/:id/steer`;
- `POST /api/sync/logs` dua kali identik → `duplicate`;
- `GET /api/logs`;
- `DELETE /api/device-tokens/:id` → socket tertutup.

### S11. Docs yang tersentuh

- **Fase ini (commit yang sama):**
  - spec ini;
  - ADR-0165 & ADR-0166 (baru);
  - amandemen berpenanda *dirancang* di ADR-0046, 0065, 0079, 0117, 0120, 0135, 0147, 0148, 0161;
  - `architecture/api-contract.md` §Kendali jarak jauh & log terpusat;
  - `architecture/data-model.md` (`Setting` + `LogEntry`/`LogCursor`);
  - `architecture/stack.md`;
  - `security/threat-model.md` §Kendali jarak jauh;
  - `frontend/frontend-implementation.md`;
  - `adr/README.md`;
  - `internal/docs/README.md`.
- **Saat Execute tiap turunan:**
  - cabut penanda *dirancang* bagian yang mendarat;
  - daftar non-delegatable `api-contract.md` §Agent tokens (+`/devices`, `/remote-control`, `/logs`);
  - `docs/agent-integration.md` (daftar cookie-only, kontrak dengan test katalog);
  - `internal/skills/hanoman/SKILL.md` (butir realtime/presence);
  - `data-model.md` baris "model pendukung";
  - diagram `stack.md`;
  - `operations/deploy-vps.md` (proxy wajib meneruskan upgrade `/api/sync/relay/ws`, sama dengan
    `/api/sync/ws`).

### S12. Batas & residu yang diterima

- Jendela balapan ≤ 3 dtk antar-start lintas device (presence), tanpa kunci terdistribusi.
- Start langsung di klien Y untuk SPEC yang hidup di klien X tak tercegah (presence hanya ada di hub).
- Aktor di klien adalah klaim hub.
- Jam klien yang mundur melewati selisih seq → entri terbaca duplikat. Terlihat sebagai
  `log.gap seq-regression`, tidak senyap.
- Timeout relay tak membatalkan efek yang sudah terjadi di klien. Presence dan log menjadi sumber
  kebenaran sesudahnya.
- Angka S4.1 adalah angka awal. Kalibrasi C/D bisa mengubahnya lewat amandemen ADR.
