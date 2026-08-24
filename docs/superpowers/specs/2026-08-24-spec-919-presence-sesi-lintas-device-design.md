# SPEC-919 — Hub melihat sesi yang sedang dikerjakan tiap klien

**Tanggal:** 2026-08-24 · **Flow:** feature · **Prioritas:** sedang
**ADR yang lahir:** ADR-0147 (transport), ADR-0148 (status hidup tidak disync)

## Objective

Dari dashboard hub, operator bisa melihat pekerjaan yang sedang berjalan di **semua** instance
hanoman miliknya — bukan hanya sesi di mesin tempat hub itu berjalan.

## Konteks terukur

Yang menyeberang sync hari ini hanya **record** (Project, Spec, Ticket, SessionResult, …) lewat
change-feed `SyncLog` (ADR-0045). Sesi agen **tak pernah** menyeberang, dan itu bukan kelalaian:
komentar `SessionHistory` di `server/prisma/schema.prisma:389-391` menuliskan alasannya —
"sesi hidup di tmux mesin ini dan transkripnya berkas di disk mesin ini; menyiarkannya ke hub
akan mengirim baris yang menunjuk berkas yang tak ada di sana".

Akibatnya hub buta: `GET /terminal/sessions` (`server/src/services/pty.ts:373`) membaca tmux pada
mesin tempat server itu berjalan, dan **tak ada satu pun kolom** yang menyimpan "sesi ini hidup di
device mana". Spec ber-stage `executing` di hub bisa saja sedang dikerjakan sesi hidup di laptop
lain tanpa jejak apa pun.

Tiga bahan sudah ada dan belum pernah disambung:

| Bahan | Jangkar | Yang belum ada |
|---|---|---|
| Identitas device | `DeviceToken{id,name,lastSeenAt,revokedAt}` `schema.prisma:345` | tak pernah dipakai untuk sesi |
| **Socket persisten klien→hub** | `sync-client.ts:447-464` → `ws://hub/api/sync/ws`, Bearer header | klien **tak pernah** mengirim satu frame pun ke atasnya |
| Bentuk status per sesi | `toSessionInfo` `pty.ts:364`, `decision`/`decisionAt` (SPEC-899/903) | fase hidup terpisah (`readPhases`, `session-phases.ts:39`) |

Sisi hub `GET /sync/ws` (`server/src/routes/sync.ts:141-162`) **tidak** memasang
`socket.on("message")` sama sekali — arahnya hub→klien saja (`broadcastSyncLog`,
`sync-hub.ts:11`).

## Keputusan arsitektur

### A. Transport — perluas socket sync yang sudah ada, jangan buka socket kedua (ADR-0147)

Klien sudah **memegang** WebSocket persisten ke hub, sudah ber-Bearer device token, sudah
reconnect. Yang kurang cuma arah naiknya. Frame masuk baru di atas socket itu:

```
{ t: "presence", v: 1, sessions: [ … ] }
```

Ini cermin persis apa yang ADR-0145 lakukan pada `/events/ws` — kanal siar read-only diberi
**satu** jenis frame masuk, bukan kanal kedua.

Alasan yang menentukan, dan bukan sekadar hemat koneksi: **hub versi lama tak memasang
`socket.on("message")`**, jadi frame dari klien versi baru **jatuh ke lantai tanpa satu pun
error** dan sync-nya jalan terus. Constraint "hub lama harus mengabaikan kanal ini tanpa merusak
sync" karena itu terpenuhi *by construction* — bukan oleh kode penanganan versi yang harus kita
tulis dan uji. Endpoint terpisah justru harus menangani `404` pada upgrade, backoff-nya sendiri,
kuota koneksi kedua, dan jalur auth kedua.

**Ditolak — `POST /api/sync/presence` berkala.** Status berumur detik lewat HTTP berarti polling
keluar dari tiap klien selamanya; requirement 6 melarang polling baru dan requirement 1 meminta
kanal persisten.

**Ditolak — kanal `/api/sync/presence/ws` terpisah** (bentuk yang dipakai ADR-0046 untuk
memisahkan sync dari `/events/ws`). Di sana pemisahan dibayar karena **otorisasinya berbeda**
(token vs cookie); di sini otorisasinya **identik** — device token yang sama, principal yang sama,
`revalidateWsPrincipal` yang sama. Tak ada yang dipisahkan kecuali jumlah socket.

**Pagar supaya kanal status tak bisa menjatuhkan sync** (constraint eksplisit):
- handler `message` seluruhnya di dalam `try/catch`; frame rusak/tak dikenal **dibuang senyap**,
  socket tak pernah ditutup karenanya;
- frame > `MAX_WS_MESSAGE_BYTES` (64 KiB) **diabaikan**, bukan `close 1009` seperti `/events/ws` —
  di sana socket-nya milik dashboard, di sini ia mengangkut changefeed sync;
- laju frame dibatasi (`PRESENCE_MAX_FRAMES_PER_MIN` = 60); kelebihannya dibuang, socket tetap;
- pengirim di sisi klien mem-*budget* dirinya sendiri: daftar sesi dipotong di
  `MAX_PRESENCE_SESSIONS` = 100 sebelum dikirim — 100 × ±200 B ≈ 20 KB, margin 3× di bawah
  `maxPayload` 64 KiB yang ditegakkan `ws` **sebelum** handler kita sempat mengabaikan apa pun.

**Reconnect ber-backoff** menggantikan `setTimeout(connectWs, 3000)` datar yang ada sekarang:
1 s → 2 → 4 → 8 → 16 → 30 s (plafon), jitter ±20 %, reset saat `open`. Ini juga menambal cacat
yang sudah ada di jalur itu: `stopSyncClient()` **tak membatalkan** timer reconnect yang tertunda,
sehingga `applySyncConfig()` (stop lalu start) meninggalkan satu socket yatim yang terhubung
memakai token **lama**. Timer disimpan dan dibersihkan.

### B. Penyimpanan di hub — registry di memori, nol tabel, nol kolom (ADR-0148)

Status hidup **tidak menyentuh Prisma sama sekali**. Bukan "tabel yang kebetulan tak masuk
`FIELDS`" — tak ada barisnya sejak awal, jadi ia **tak bisa** masuk `SyncLog` walau seseorang
kelak menambah entitas ke `SYNCED` tanpa membaca ADR ini.

Pelajaran yang membuat pilihan ini bukan selera: ADR-0131 mengukur `pollHealth()` menulis
`notifySynced("vps", …)` tiap 5 menit per VPS → **121.222 baris / 213,6 MB = 83 % isi DB hub**,
dan hub tercekik `P1008 Socket timeout`. Presence berdenyut **tiap 30 detik per device** — dua
orde lebih sering. Satu tabel "local-only" pun akan menulis ke berkas SQLite yang sama pada
kadens itu.

`services/presence/registry.ts` menyimpan `Map<deviceId, { sessions, lastFrameAt }>` — **tanpa**
nama device: nama sudah hidup di `DeviceToken` dan mengambilnya dari satu tempat saja meniadakan
pertanyaan "salinan mana yang benar sesudah rename".
Restart hub = registry kosong; klien mengisinya kembali dalam satu siklus reconnect (≤ 30 s).
Itu **fitur**, bukan kerugian: keadaan basi punah dengan sendirinya, persis yang diminta poin 3.

Satu-satunya yang tetap dibaca dari DB adalah **katalog device** — `DeviceToken` (nama, `lastSeenAt`,
`revokedAt`) — yang memang sudah persisten dan sudah ditulis tiap request sync ter-auth
(`device-token.ts:15`). "Terakhir terlihat" untuk device offline karena itu **tak butuh kolom
baru**. Kanal presence sendiri **tidak** menulis `lastSeenAt` per denyut.

**Ditolak — model `DevicePresence` local-only** (pola `LocalBinding`/`SyncState`). Ia
menyelesaikan masalah yang tak ada (bertahan restart, padahal restart memutus socket sehingga
barisnya basi sampai reconnect toh) dengan membayar harga yang persis dilarang ADR-0131.

### C. Hub ikut masuk registry yang sama — satu sumber kebenaran

Mesin tempat hub berjalan **juga** punya sesi. Requirement 5 minta penanda seragam "termasuk sesi
milik hub sendiri … supaya tak ada 'sumber kebenaran kedua'".

Karena itu registry menerima dua pemasok lewat **satu** pintu `recordPresence()`:

1. **device remote** — dari frame WS, `deviceId` selalu diambil dari **token yang sudah
   diverifikasi** (`req.wsPrincipal.id`), tak pernah dari payload;
2. **mesin lokal** — `refreshLocalPresence()` dipanggil dari build grup siar tiap tick, memakai
   `deviceId` sintetis `"local"` dan nama `os.hostname()`.

Karena keduanya lewat pintu yang sama, **`statusAt` dihitung di satu tempat**: registry
membandingkan status baru dengan status sebelumnya per `(deviceId, sessionId)` dan mencap waktu
hanya saat berubah. Kalau klien yang mengirim `statusAt`, "bekerja" tak punya stempel yang jujur
(aktivitas pane bergerak tiap detik → signature berubah tiap denyut → banjir frame).

### D. Muatan sengaja ringkas — nol byte layar

```ts
type PresenceSession = {
  sessionId: string;
  projectId: string;
  specId?: string;
  flow?: string;
  phase?: string;                                  // fase `active` dari readPhases()
  agent: "claude" | "codex";
  status: "working" | "waiting" | "exited";
  startedAt: string;                               // ISO
};
```

Kosakata status **memakai bit yang sudah ada**, bukan yang ketiga: `waiting` adalah
`SessionInfo.decision` apa adanya (SPEC-903/ADR-0143), `exited` adalah `pane_dead`. Urutan
turunannya `exited > waiting > working`.

**Judul spec, nama project, dan stage TIDAK dikirim** — hub sudah memegang baris `Spec` dan
`Project` yang menyeberang sync, jadi ia me-*resolve* sendiri dari `specId`/`projectId`. Ini beda
sadar dari `handledBy` (ADR-0135) yang **harus** menyimpan snapshot `name` karena `DeviceToken`
tak ikut `SYNCED`: di sana penerimanya client yang tak punya katalog device; di sini penerimanya
hub yang justru pemilik katalognya.

Skema zod `.strict()`: kunci asing **ditolak**, jadi scrollback/cuplikan pane tak bisa
diselundupkan lewat field tambahan tanpa mengubah kontrak yang dijaga test.

`startedAt` butuh sumber yang tak ada di `SessionInfo` hari ini → `#{session_created}` ditambahkan
ke `FMT` (`pty.ts:301`), persis cara `#{window_activity}` masuk di SPEC-903: **nol invokasi tmux
tambahan**, satu field lagi di panggilan yang sama. Ia diekspos sebagai `SessionInfo.startedAt?`
(aditif; `SessionInfo` tak pernah disync).

### E. Jalan ke layar — grup siar kesepuluh, nol polling baru

`services/events.ts` mendapat grup global ke-10, `presence`, `everyTicks: 3`:

```
{ t: "presence", enabled: boolean, devices: PresenceDeviceView[] }
```

Grup, bukan topik berlangganan (ADR-0145): muatannya **tak berparameter** — satu snapshot yang
sama untuk semua penonton, persis kriteria kedelapan grup lama. `attach()` mengirim snapshot penuh
tiap connect, jadi layar mendapat isinya seketika tanpa satu request HTTP pun.

`GET /api/presence` (cookie, admin) ada **hanya** sebagai muat-awal + fallback, konvensi yang sama
yang ADR-0145 pertahankan untuk enam route-nya. Tak ada yang men-poll-nya selama WS sehat.

### F. Gerbang tampilan — `enabled`

`enabled` = **hub ini punya ≥1 baris `DeviceToken` yang belum dicabut.**

| Instance | `enabled` | Yang terlihat |
|---|---|---|
| solo (tanpa sync, tanpa device token) | `false` | **nol perubahan** — nav "Klien" tak muncul, penanda tak muncul |
| hub dengan klien terdaftar | `true` | halaman Klien + penanda device di Backlog & Projects |
| client (punya `SYNC_SERVER_URL`) | `false` | nol perubahan; ia mengirim, tak menerima |

Ini yang mendamaikan requirement 4/5 dengan requirement 7. Requirement 7 melarang perubahan
tampilan pada instance yang tak berperan dalam sync; `enabled` adalah predikat yang paling dekat
dengan "instalasi ini memang punya lebih dari satu mesin", dan ia **gratis** (satu `count`).

**Plafon yang diketahui, dicatat sengaja:** data presence mengalir **satu arah, klien → hub**.
Client karena itu tak bisa menampilkan sesi hub maupun sesi client lain. Mengirim agregat balik ke
tiap client menggandakan permukaan (fan-out hub→N client, otorisasi per-client, kuota) untuk
kebutuhan yang tak diminta backlog ini.

## Komponen

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/presence.ts` | tipe wire, zod `.strict()`, konstanta batas, `presenceSignature()` |
| `server/src/services/presence/snapshot.ts` | `Pane[] → PresenceSession[]` (murni, tanpa I/O) |
| `server/src/services/presence/registry.ts` | peta di memori, `statusAt` transisi, ambang offline |
| `server/src/services/presence/view.ts` | gabung registry + `DeviceToken` + sesi lokal → `PresenceView` |
| `server/src/services/presence/sender.ts` | sisi klien: tick, dedup signature, denyut, `send()` disuntik |
| `server/src/routes/sync.ts` | `socket.on("message")` → `recordPresence(principal.id, …)` |
| `server/src/routes/presence.ts` | `GET /api/presence` (cookie) |
| `src/src/screens/ClientsScreen.tsx` | halaman "Klien" |
| `src/src/screens/PresenceChip.tsx` | penanda "dikerjakan di <device>" |

`sender.ts` menerima `send` sebagai argumen, bukan mengimpor socket — itu yang membuatnya bisa
diuji tanpa WebSocket sama sekali, dan yang membuat "kanal status tak boleh menjatuhkan sync"
terbaca dari tipenya.

## Aliran data

```
klien                                          hub
─────                                          ───
presence/sender.ts  ── tick 3 s ──┐
  listPanesAsync()                │
  snapshot.ts → PresenceSession[] │
  signature berubah? ATAU         │
  denyut 30 s jatuh tempo?        │
        └── ws.send({t:"presence"}) ──────────► routes/sync.ts  socket.on("message")
                                                 zod .strict() + cap byte + cap laju
                                                 recordPresence(principal.id, name, sessions)
                                                        │
  (hub juga memasok dirinya sendiri) ──────────► refreshLocalPresence()  ← events tick
                                                        │
                                                 presence/registry.ts  (Map, memori)
                                                        │  statusAt dicap saat status berubah
                                                        ▼
                                                 presence/view.ts + DeviceToken
                                                        │
                                                 events.ts grup `presence` (3 dtk, dedup)
                                                        │
                                                 ┌──────┴───────────────┐
                                          ClientsScreen        PresenceChip
                                                              (Backlog, Projects)
```

## Penanganan kegagalan

| Kejadian | Perilaku |
|---|---|
| hub lama (tak baca message) | frame diabaikan hub; sync jalan normal; hub tampil tanpa presence |
| klien lama menghadap hub baru | tak mengirim apa-apa; device tampil **offline** + `lastSeenAt` dari `DeviceToken` |
| socket putus | device langsung offline; sesinya lenyap dari view |
| socket half-open (denyut berhenti) | offline setelah `PRESENCE_OFFLINE_MS` = 90 s (3× denyut) |
| token dicabut saat socket hidup | `revalidateWsPrincipal` 60 s menutup socket (jalur yang sudah ada) → offline |
| frame rusak / kebesaran / terlalu sering | dibuang senyap, socket **tetap terbuka** |
| `tmux` mati di klien | snapshot `[]` → device online tanpa sesi (bukan offline palsu) |
| hub restart | registry kosong; terisi lagi ≤ 30 s lewat denyut/reconnect |

## Keamanan

- Auth = device token Bearer pada upgrade yang **sudah** ada; nol skema token baru, nol perubahan
  gerbang. Query credential tetap 401 (ADR-0117).
- `deviceId` **tak pernah** dari payload → satu device tak bisa mengaku device lain.
- Token tak pernah masuk log; `recordPresence` hanya menerima `deviceId` + nama.
- Payload `.strict()` + cap byte + cap laju + cap jumlah sesi.
- `GET /api/presence` cookie-only, **non-delegatable** ke agent token — ia memaparkan peta
  pekerjaan lintas mesin.
- Nol isi terminal, nol `cwd`, nol path berkas dikirim ke hub. (`cwd` sengaja **dibuang** dari
  muatan meski ada di `SessionInfo`: itulah bagian yang membuat `SessionHistory` local-only.)

## Rencana test

| # | Berkas | Yang dikunci |
|---|---|---|
| 1 | `shared/src/presence.test.ts` | `.strict()` menolak kunci asing (bukti "tak ada scrollback"), cap jumlah sesi, `presenceSignature` stabil terhadap urutan |
| 2 | `server/src/services/presence/snapshot.test.ts` | `Pane → PresenceSession`: fase `active`, presedensi `exited > waiting > working`, `cwd` tak ikut |
| 3 | `server/src/services/presence/registry.test.ts` | ganti-penuh, `statusAt` dicap **hanya** saat status berubah, offline lewat ambang, drop saat disconnect |
| 4 | `server/src/services/presence/view.test.ts` | gabung lokal+remote, `enabled` mati tanpa `DeviceToken`, device dicabut tak muncul, offline tetap membawa `lastSeenAt` |
| 5 | `server/src/services/presence/sender.test.ts` | kirim saat start, saat berubah, denyut saat tak berubah, **diam** saat tak berubah & belum jatuh tempo |
| 6 | `server/src/services/sync-client.backoff.test.ts` | delay tumbuh & di-cap, reset saat `open`, `stopSyncClient` membatalkan reconnect tertunda |
| 7 | `server/test/sync-ws-presence.test.ts` | route: frame sah tercatat; tanpa token → 401; frame rusak/kebesaran → socket **tetap hidup** |
| 8 | `src/test/clients-screen.test.tsx` | daftar device online/offline, sesi di bawahnya, klik baris SPEC → detail backlog |
| 9 | `src/test/presence-chip.test.tsx` | chip muncul di baris backlog & kartu project; **tak** muncul saat `enabled:false` |

## Docs yang tersentuh

`internal/docs/adr/0147-*.md` (baru) · `internal/docs/adr/0148-*.md` (baru) ·
`internal/docs/README.md` (index) · `internal/docs/architecture/api-contract.md` ·
`internal/docs/architecture/data-model.md` · `internal/docs/frontend/frontend-implementation.md` ·
`internal/skills/hanoman/SKILL.md`

## Di luar lingkup

- Menempel/menonton terminal sesi klien dari hub (butuh relay WS lintas instance + gerbang auth
  sendiri) — file terpisah.
- Mengalirkan presence balik hub → client.
- Menjadikan presence gerbang bagi start sesi, worktree, auto-merge, scheduler, atau lead. Ia
  **murni informasional**, cermin batas ADR-0135 §6.
