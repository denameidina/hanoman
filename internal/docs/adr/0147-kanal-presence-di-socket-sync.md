# ADR-0147 — Presence sesi lintas device: arah naik di socket sync yang sudah ada

**Status:** aktif (SPEC-919) · 2026-08-24.
**Mengamandemen [ADR-0046](0046-kanal-ws-sync-terpisah.md)** — `GET /api/sync/ws` tak lagi satu arah:
hub kini membaca satu jenis frame dari klien.
**Menegakkan** [0043](0043-sync-arsitektur-hub-client-server-to-server.md) (peran ditentukan
konfigurasi), [0044](0044-device-token-machine-identity.md) &
[0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) (Bearer header, query
credential ditolak), [0024](0024-sesi-interaktif-menggantikan-run.md) (nol queue/worker/scheduler
baru), [0039](0039-realtime-lewat-websocket-siar.md)/[0145](0145-langganan-berparameter-events-ws.md)
(grup GLOBAL vs topik berparameter), [0135](0135-penanda-project-ditangani-hanoman-client.md)
(penanda device yang MANUAL, kontras dengan yang LIVE di sini).
Berpasangan dengan [ADR-0148](0148-status-hidup-tidak-disync.md), yang memutuskan di mana keadaan
itu disimpan.

## Konteks

Sync antar-instance memindahkan **record** — Project, Spec, Ticket, SessionResult — lewat
change-feed `SyncLog` (ADR-0045). Sesi agen **tak pernah** ikut, dan itu bukan kelalaian: komentar
`SessionHistory` di `server/prisma/schema.prisma` menuliskan alasannya — "sesi hidup di tmux mesin
ini dan transkripnya berkas di disk mesin ini; menyiarkannya ke hub akan mengirim baris yang
menunjuk berkas yang tak ada di sana".

Akibatnya hub buta terhadap pekerjaan di mesin lain. `GET /terminal/sessions` membaca tmux pada
mesin tempat server itu berjalan, dan tak ada satu pun kolom yang menyimpan "sesi ini hidup di
device mana". Spec ber-stage `executing` di hub bisa sedang dikerjakan sesi hidup di laptop lain
tanpa satu jejak pun.

Tiga bahan sudah ada dan belum pernah disambung: identitas device (`DeviceToken{name,lastSeenAt}`),
bentuk status per sesi (`SessionInfo` + bit `decision` SPEC-903), dan — yang menentukan —
**socket persisten klien→hub yang sudah dipegang klien**: `sync-client.ts` membuka
`ws://<hub>/api/sync/ws` ber-`Authorization: Bearer`, lengkap dengan reconnect. Yang kurang hanya
arah naiknya: klien tak pernah mengirim satu frame pun ke atasnya, dan hub tak pernah memasang
`socket.on("message")` di sana.

## Keputusan

### 1. Satu jenis frame masuk di `/api/sync/ws`, bukan kanal kedua

```
{ t: "presence", v: 1, sessions: PresenceSession[] }
```

Semantik **ganti-penuh**: frame membawa seluruh daftar sesi mesin itu, jadi sesi yang tak disebut
memang sudah tidak ada. Tak ada frame "hapus" yang bisa hilang, dan re-kirim saat reconnect
identik dengan pengiriman pertama — idempoten *by construction*. Ini cermin persis apa yang
ADR-0145 lakukan pada `/events/ws`.

**Alasan yang menentukan bukan hemat koneksi, melainkan kompatibilitas mundur yang tak perlu
ditulis:** hub versi lama **tak memasang `socket.on("message")` sama sekali**, jadi frame dari
klien versi baru jatuh ke lantai tanpa satu pun error dan sync-nya jalan terus. Constraint "hub
lama harus mengabaikan kanal ini tanpa merusak sync" karena itu terpenuhi oleh bentuknya, bukan
oleh kode penanganan versi yang harus kita tulis, uji, dan rawat.

`deviceId` **selalu** diambil dari `req.wsPrincipal.id` — token yang sudah diverifikasi — dan
**tak pernah** dari payload. Satu device tak bisa mengaku device lain. Klien memang tak tahu
`deviceId`-nya sendiri (ia hanya memegang token plaintext), dan itu justru sifat yang benar.

### 2. Alternatif yang ditolak

- **`POST /api/sync/presence` berkala.** Status berumur detik lewat HTTP berarti polling keluar
  dari setiap klien selamanya. Requirement melarang polling baru, dan kanal persisten memang yang
  diminta.
- **Kanal `/api/sync/presence/ws` terpisah.** ADR-0046 memisahkan `/sync/ws` dari `/events/ws`
  karena **otorisasinya berbeda** (device token vs cookie) dan payloadnya berbeda. Di sini
  otorisasinya **identik** — device token yang sama, principal yang sama, `revalidateWsPrincipal`
  60 detik yang sama. Yang dipisahkan hanya jumlah socket; yang ditambahkan adalah penanganan
  `404` pada upgrade, backoff kedua, kuota koneksi kedua, dan jalur auth kedua.
- **Menyiarkan `SessionHistory`/`SessionInfo` apa adanya.** Keduanya membawa `cwd` dan path
  transkrip — persis alasan `SessionHistory` dibuat LOCAL-only.

### 3. Muatan sengaja ringkas, dan `.strict()` yang menegakkannya

`{ sessionId, projectId, specId?, flow?, phase?, agent, status, startedAt }`. Tak ada scrollback,
tak ada cuplikan pane, **tak ada `cwd`**, tak ada path berkas apa pun. Skemanya zod `.strict()`:
kunci asing **ditolak**, bukan diabaikan — jadi "tak ada isi terminal" adalah properti yang
dijaga test, bukan janji.

Kosakata status memakai bit yang **sudah ada**, bukan yang ketiga: `waiting` adalah
`SessionInfo.decision` apa adanya (SPEC-903/ADR-0143), `exited` adalah `pane_dead`. Presedensinya
`exited > waiting > working`.

**Judul spec, nama project, dan stage tidak dikirim.** Hub sudah memegang baris `Spec` dan
`Project` yang menyeberang sync, jadi ia me-*resolve* sendiri dari `specId`/`projectId`. Ini
kebalikan sadar dari `HandledByEntry` (ADR-0135) yang **harus** menyimpan snapshot `name`: di sana
penerimanya client yang tak punya katalog device, di sini penerimanya hub yang justru pemiliknya.

`startedAt` butuh sumber yang tak ada di `SessionInfo`, jadi `#{session_created}` ditambahkan ke
`FMT` — persis cara `#{window_activity}` masuk di SPEC-903: **nol invokasi tmux tambahan**, satu
field lagi di panggilan yang sama, ditaruh di **ujung** supaya posisi kolom lama tak bergeser.
Ia mendarat di `Pane`, **bukan** `SessionInfo`: cermin `activityAt`/`eventHook`, ia bahan
presence, bukan bagian DTO yang disiarkan ke dashboard.

### 4. Kegagalan kanal status tak boleh menjatuhkan sync

Socket yang sama mengangkut changefeed sync, jadi handler `message` seluruhnya di dalam
`try/catch` dan **semua kegagalan dibuang tanpa menutup socket**:

- frame rusak atau tak lolos `zPresenceFrame` → diabaikan;
- verdict `WsMessageGuard` (`PRESENCE_MAX_FRAMES_PER_MIN` = 60) → **diabaikan**, bukan
  diterjemahkan jadi `close 1008/1009` seperti di `/events/ws`; di sana socket-nya milik dashboard;
- `MAX_PRESENCE_SESSIONS` = 100 dipotong **di sisi pengirim**, karena 64 KiB `maxPayload` plugin
  WebSocket ditegakkan oleh `ws` **sebelum** handler kita sempat mengabaikan apa pun. 100 × ±200 B
  ≈ 20 KB memberi margin 3×.

Pengirim di klien (`presence/sender.ts`) menerima `send` sebagai **argumen**, bukan mengimpor
socket: modul itu tak memegang socket dan karena itu tak bisa menutupnya — properti yang terbaca
dari tipenya, bukan dari disiplin pemanggil.

### 5. Reconnect ber-backoff menggantikan ketukan datar

1 s → 2 → 4 → 8 → 16 → 30 s (plafon), jitter ±20 %, direset saat `open`. Yang lama
`setTimeout(connectWs, 3000)` mengetuk hub mati 20×/menit selamanya — dan **timernya tak pernah
dibatalkan**: `stopSyncClient()` menyetel `started=false` tetapi ketukan yang tertunda tetap jalan,
sehingga `applySyncConfig()` (stop lalu start) meninggalkan satu socket yatim yang menyambung
memakai token **lama**. Timer kini disimpan dan dibersihkan.

### 6. Jalan ke layar: grup siar ke-10, nol polling baru

`services/events.ts` mendapat grup **GLOBAL** ke-10 `presence` (kadens 3 detik, dedup signature
yang sudah ada). Grup, bukan topik berlangganan ADR-0145: muatannya **tak berparameter** — satu
snapshot yang sama untuk semua penonton, persis kriteria kedelapan grup lama. `attach()` mengirim
snapshot penuh tiap connect, jadi layar terisi seketika tanpa satu request pun.

`GET /api/presence` **COOKIE_ONLY** (non-delegatable ke agent token: ia memaparkan peta pekerjaan
lintas mesin) ada hanya sebagai **muat awal + fallback**, konvensi yang sama yang ADR-0145
pertahankan untuk enam route-nya. Ia dipanggil dari `ClientsScreen`, **bukan** dari `load()` App —
`load()` adalah efek yang dijalankan setiap test yang me-mount App, dan menambah satu panggilan
`api` di sana mematahkan **20 test ber-mock parsial sekaligus** (terukur; kelas jebakan SPEC-884).
Layar yang membutuhkannya yang membayarnya.

### 7. Gerbang `enabled`

`enabled` = **hub ini punya ≥1 baris `DeviceToken` yang belum dicabut.**

| Instance | `enabled` | Yang terlihat |
|---|---|---|
| solo (tanpa sync, tanpa device token) | `false` | **nol perubahan** — nav "Klien" tak muncul, penanda tak muncul |
| hub dengan klien terdaftar | `true` | halaman Klien + penanda device di Backlog & Projects |
| client (punya `SYNC_SERVER_URL`) | `false` | nol perubahan; ia mengirim, tak menerima |

Ini yang mendamaikan "penanda di layar yang sudah ada" dengan "instance tanpa sync berperilaku
persis seperti sekarang". Predikatnya paling dekat dengan "instalasi ini memang punya lebih dari
satu mesin", dan ia gratis — satu `count`. Ujung terakhirnya ada di komponen: peta presence yang
kosong membuat `PresenceChip` merender **nol elemen**.

Gerbang nav-nya `NavItem.gate` + context `NavGate`, bukan prop: `Shell` dirender di belasan cabang
`App` dan menambah prop ke semuanya adalah undangan bagi cabang yang terlewat. Default context
kosong = entri bergerbang **tersembunyi**.

### 8. Hub ikut masuk registry yang sama

Mesin tempat hub berjalan juga punya sesi, dan penandanya harus seragam. Karena itu sesi lokal
masuk lewat **pintu yang sama** (`recordPresence`) dengan device remote, memakai `deviceId`
sintetis `"local"` dan nama `os.hostname()`. Konsekuensinya bukan kosmetik: `statusAt` dihitung di
**satu** tempat untuk semua device (lihat ADR-0148 §3), dan tak ada rumus kedua yang bisa
berselisih.

`activeSpecs` di App tetap ada dan tetap berarti hal **lain** — "ada sesi di MESIN INI yang bisa
dibuka". Ia menggerbangi tombol, bukan penanda.

## Konsekuensi

**Baik.** Hub menjawab "apa yang sedang dikerjakan, di mana" tanpa satu tabel, satu kolom, atau
satu endpoint polling baru. Kompatibilitas dua arah gratis. Backoff yang lahir di sini juga
memperbaiki perilaku sync itu sendiri terhadap hub yang mati.

**Buruk.** `/api/sync/ws` kini punya dua tanggung jawab (turun: changefeed; naik: presence). Ia
tetap satu socket dengan satu otorisasi, tapi siapa pun yang menyentuhnya wajib menjaga aturan
"kegagalan presence tak pernah menutup socket". Klien juga membayar satu `tmux list-panes`
asinkron per 3 detik walau tak ada dashboard yang terbuka — ±20 spawn/menit, di bawah 60/menit
yang sudah dibayar loop siar saat dashboard terbuka.

## Plafon yang diketahui

- **Arah data satu arah, klien → hub.** Client tak bisa menampilkan sesi hub maupun sesi client
  lain. Mengirim agregat balik ke tiap client menggandakan permukaan (fan-out hub→N client,
  otorisasi per-client, kuota) untuk kebutuhan yang tak diminta.
- **Menempel/menonton terminal sesi klien dari hub ada DI LUAR** keputusan ini: itu butuh relay WS
  lintas instance dan gerbang auth sendiri.
- **Presence murni informasional.** Ia tak menggerbangi start sesi, worktree, auto-merge,
  scheduler, maupun lead — dan tak boleh mulai dibaca oleh jalur eksekusi tanpa ADR baru (batas
  yang sama dengan ADR-0135 §6).
- `WsMessageGuard` memakai jendela **fixed**, bukan sliding — 60 frame/menit adalah polisi tidur,
  bukan plafon keras. Yang benar-benar mengikat adalah `MAX_PRESENCE_SESSIONS` dan `maxPayload`.
- **Kegagalan `build()` saat `attach()` ditelan tanpa satu baris log** (`events.ts`, `catch { continue; }`)
  — sifat lama yang berlaku untuk **semua** grup, tetapi presence mewarisi konsekuensinya penuh:
  `presenceView()` menyentuh Prisma, jadi satu kedipan DB tepat saat sebuah tab attach membuat tab
  itu tak menerima snapshot pertamanya, dan dedup `Group.last` kemudian **menahan** frame berikutnya
  selama isinya tak berubah. Di hub yang sepi tab itu bisa diam lama. Yang menutup kelasnya bukan
  ADR ini melainkan membuat `attach` mencatat kegagalannya seperti `__tick` sudah lakukan —
  perbaikan terpisah, dan sengaja tak diselundupkan ke sini. Sementara itu `events.route.test.ts`
  mengunci bahwa `presence` memang ada di snapshot attach pada jalur sehat.
- **Gerbang `cookieOnly` hidup di `events.ts`, bukan di peta capability.** `capabilityForRoute` tak
  punya cabang untuk `/api/ws-tickets` sehingga ia jatuh ke default cookie-only — itu yang menahan
  agent token hari ini, dan itu **ketiadaan entri**, bukan keputusan. Karena itu grupnya digerbangi
  sendiri; kalau cabang `ws-tickets` kelak lahir, presence tetap tertutup.
