# SPEC-1215 — Hub mengorkestrasi klien hanoman: kendali sesi jarak jauh, tampilan identik, dan log terpusat

**Tanggal:** 2026-09-14 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `67478d09` · **Fase penulis bagian ini:** Brainstorm (1/5), Objective (2/5)

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
