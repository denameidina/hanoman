# SPEC-908 — Data realtime dashboard berparameter lewat WebSocket berlangganan

**Tanggal:** 2026-08-23 · **Backlog:** SPEC-908 · **Prioritas:** sedang
**Mengamandemen:** ADR-0039 (satu WS siar, read-only, snapshot global tanpa parameter)
**Menegakkan:** ADR-0024 (tak ada queue/scheduler/worker baru), ADR-0087 (dashboard boleh lebih baru
daripada server), ADR-0107/ADR-0115 (plafon `limit`, state tampilan persisten), ADR-0134 (socket
terbuka ≠ fakta pengiriman), ADR-0014/0016 (isolasi & kanal PTY tak disentuh)

---

## 1. Konteks

SPEC-199/ADR-0039 memindahkan polling dashboard dari klien ke server: satu WebSocket siar
`GET /api/events/ws` (`server/src/routes/events.ts`, hub `server/src/services/events.ts`) dengan
**delapan grup snapshot GLOBAL tanpa parameter** — `sessions`, `specs`, `notifications`, `cleanups`,
`vps`, `limits`, `codexLimits`, `update`. Tipe wire-nya `EventMsg` (`shared/src/dto.ts:716`).

Empat layar dashboard **tidak** ikut dan sampai hari ini masih men-poll sendiri:

| Layar | Kadens | `setInterval` | Muatan |
|---|---|---|---|
| `SchedulerScreen.tsx` | 5 000 ms | `:313` | `getSchedulerState()` + bump `nonce` → 4× `QueueSection` memanggil `getSchedulerQueue({status,page,limit})` |
| `TriageScreen.tsx` | 5 000 ms | `:374` | `listTickets({project,status,q,page,limit})` |
| `LeadScreen.tsx` | 5 000 ms | `:310` | `Promise.all([getLeadStatus(), getLeadDecisions({projectId,page,limit}), getLeadFlows({…})])` |
| `GitGraph.tsx` | 4 000 ms | `:346` | `ideGraph(projectId, limit, {branches,showRemote,showTags})` + `ideStatus(projectId)` + `ideStashes(projectId)` |

**Akar kenapa keempatnya tertinggal**, dan ini bukan kelalaian melainkan batas desain ADR-0039:

1. Muatannya **fungsi dari parameter klien** (projectId, filter status/`q`, nomor halaman, opsi
   graph). `GROUPS` di `services/events.ts:32` adalah array statis yang menghitung **satu** snapshot
   dan menyiarkan **string yang sama** ke semua klien (`broadcast`, `:61`).
2. Kanal itu **read-only secara harfiah**: `routes/events.ts` tak pernah memasang
   `socket.on("message")` sama sekali (dibaca penuh, 28 baris) — frame masuk bukan "diabaikan",
   ia tak pernah dibaca. `Client` yang disimpan hub hanya `{send, close}`; **tak ada state
   per-koneksi** di mana pun.
3. Skip "tak ada yang butuh" bekerja di **level loop** (`stopLoop()` saat klien terakhir lepas),
   bukan per-grup. Tak ada mekanisme "grup X tak dipakai siapa pun".

Jadi migrasi ini memang butuh keputusan bentuk kanal, bukan sekadar memindahkan pemanggilan.

### Yang BUKAN scope

`setInterval` yang tersisa di **server** bukan polling data klien: governor scheduler/lead/
webhooks/auto-merge/reaper/retention (ADR-0024 melarang scheduler/queue baru, bukan timer
in-process ini), `sync-client.ts:473`, dan revalidasi principal WS 60 dtk di `routes/events.ts:22`,
`terminal.ts:542`, `sync.ts:157`. Loop tick 1 dtk di `services/events.ts` juga tetap polling di sisi
server karena sumbernya (tmux, berkas fase, git) tak bisa mendorong — yang dijanjikan ADR-0039
adalah **klien** tak lagi men-poll.

---

## 2. Keputusan: langganan berparameter, bukan invalidasi

Kanal `/api/events/ws` menerima **satu** jenis frame masuk yang memuat parameter layar, dan server
menyimpan **state langganan per-klien** lalu mengirim frame data untuk kombinasi parameter itu.

Alternatif yang dipertimbangkan dan **ditolak**:

- **Invalidasi/versi** — server menyiarkan "domain X berubah, versi V", klien memuat ulang query
  berparameternya sendiri sekali lewat HTTP. Lebih murah dan menjaga kanal tetap read-only, tetapi
  menyisakan satu round-trip HTTP di setiap perubahan dan **menggandakan sumber kebenaran bentuk
  muatan** (versi dihitung dari satu tempat, datanya dari tempat lain — dua hal yang bisa
  berselisih diam-diam). Untuk domain paling mahal (git per project) versinya praktis **sama
  mahalnya dengan datanya**: menghitung "apakah graph berubah" berarti membaca HEAD + seluruh ref +
  status kotor, yaitu hampir seluruh `ideStatus`.
- **Invalidasi murni tanpa frame masuk** (versi git diturunkan dari mtime `.git/**`) — ditolak
  karena biayanya tumbuh mengikuti **jumlah project terdaftar**, bukan yang ditonton; mtime
  `.git/index` berubah karena `git status` yang kita jalankan sendiri sehingga berisiko **loop
  muat-ulang**; dan keadaan kotor/bersih working tree **tak tertangkap sama sekali** oleh mtime ref.

Konsekuensi yang diterima: permukaan serangan kanal bertambah (bagian §6 menangani), dan biaya
per-tick server jadi fungsi parameter yang aktif (bagian §4 memagarinya).

---

## 3. Kontrak wire

### 3.1 Topik

Satu topik = satu muatan yang dimuat sebuah layar dalam **satu** tarikan, cermin `load()`-nya
hari ini. Nama topik **identik** dengan `t` frame keluarnya — satu-ke-satu, tak bisa berselisih.

```ts
// shared/src/dto.ts
export type EventTopic =
  | "schedulerState"    // SchedulerScreen.load()
  | "schedulerQueue"    // QueueSection (4 instance: queued/canceled/done/failed)
  | "tickets"           // TriageScreen.load()
  | "lead"              // LeadScreen.load()  — status + decisions + flows dalam satu frame
  | "git";              // GitGraph.load()    — graph + status + stashes dalam satu frame
```

`lead` dan `git` sengaja **dibundel**: keduanya hari ini satu `Promise.all` yang menyetel tiga state
sekaligus, dan memecahnya jadi tiga topik berarti tiga frame yang bisa mendarat terpisah — layar
akan menampilkan campuran dua generasi data yang hari ini tak mungkin terjadi.

### 3.2 Frame masuk (klien → server) — satu-satunya

```ts
export type EventsClientMsg = {
  t: "sub";
  subs: { topic: EventTopic; params: Record<string, unknown> }[];
};
```

**Semantik ganti-penuh**: setiap frame `sub` **mengganti seluruh** himpunan langganan klien itu.
Tak ada frame `unsubscribe` — tak ada yang bisa bocor, dan re-kirim saat reconnect adalah operasi
yang sama persis dengan pemasangan pertama (idempoten by construction).

### 3.3 Frame keluar (server → klien) — tambahan pada `EventMsg`

```ts
| { t: "hello"; topics: EventTopic[] }                                   // saat attach, SEBELUM snapshot grup
| { t: "schedulerState"; key: string; state: SchedulerStateView }
| { t: "schedulerQueue"; key: string; page: Paginated<SchedulerQueueItemView> }
| { t: "tickets";        key: string; page: Paginated<TicketView> & { unreviewed: number } }
| { t: "lead";           key: string; status: LeadStatusView;
                         decisions: Paginated<LeadDecisionView>;
                         flows: Paginated<LeadFlowView> }
| { t: "git";            key: string; graph: { commits: GraphCommit[]; current: string; total: number };
                         status: RepoStatus; stashes: Stash[] }
```

Bentuk muatannya **sama persis** dengan respons HTTP yang digantikannya (§5) — supaya `apply(frame)`
dan `load()` menyetel state yang identik.

### 3.4 `key` — kunci kanonik yang dihitung KEDUA sisi

```ts
// shared/src/dto.ts — fungsi murni, diuji langsung
export function subKey(topic: EventTopic, params: Record<string, unknown>): string;
```

`subKey` menyerialkan `topic` + parameter dengan **kunci terurut** dan nilai `undefined` dibuang.
Server menaruh hasilnya di frame; klien mencocokkan frame masuk dengan `subKey(topic, paramsSaya)`.

Kenapa bukan `id` yang dikarang klien: kalau id datang dari klien, dua tab yang berlangganan
parameter identik menerima frame yang **berbeda byte** sehingga hub harus menyerialkan per-klien —
dan dedup signature ADR-0039 hilang. Dengan `key` turunan-parameter, dua tab yang sama menerima
**string yang sama persis**: satu `build`, satu `JSON.stringify`, satu `send` per klien.

### 3.5 Validasi parameter

Satu skema zod per topik di `shared/src/dto.ts` (`zTopicParams`), dipakai **klien untuk membentuk**
dan **server untuk memvalidasi** — satu definisi:

| Topik | Parameter | Pagar |
|---|---|---|
| `schedulerState` | — | objek kosong `.strict()` |
| `schedulerQueue` | `status`, `page`, `limit` | `status` enum antrean; `page` 1…10 000; `limit` 1…`QUEUE_LIMIT_MAX` |
| `tickets` | `project?`, `status?`, `q?`, `page`, `limit` | string ≤ 200 char; `page`/`limit` sama seperti di atas |
| `lead` | `projectId?`, `decPage`, `decLimit`, `flowPage`, `flowLimit` | idem |
| `git` | `projectId`, `limit`, `branches?: string[]`, `showRemote`, `showTags` | `projectId` ≤ 120 char; `limit` 1…2 000; `branches` ≤ 32 entri × ≤ 200 char |

`limit` tetap **plafon** (ADR-0107): dijepit server ke batas yang sama dengan route HTTP-nya, bukan
dipercaya apa adanya.

---

## 4. Hub berlangganan di server

`services/events.ts` bertambah satu peta di samping `GROUPS` — `GROUPS` **tidak** disentuh:

```ts
type SubEntry = {
  topic: EventTopic;
  params: unknown;          // sudah tervalidasi
  key: string;
  clients: Set<Client>;
  everyTicks: number;
  tick: number;
  last: string;             // dedup signature, sama seperti Group.last
  inflight: boolean;
};
const entries = new Map<string, SubEntry>();   // key → entry
```

**Lima pagar biaya**, langsung menjawab constraint "jangan menaikkan biaya per-tick secara buta":

1. **Hanya parameter yang benar-benar ada pelanggannya yang dihitung.** Entri lahir dari frame `sub`
   dan **mati saat pelanggan terakhirnya lepas** (`clients.size === 0` → `entries.delete`). Langganan
   hidup hanya selama layarnya ter-mount, dan satu tab hanya membuka satu layar.
2. **Dedup signature dipertahankan.** `JSON.stringify(data)` dibanding `entry.last`; sama → tak ada
   frame. Persis mekanisme `Group.last` yang sudah ada.
3. **Satu hitungan untuk N klien.** Karena `key` turunan-parameter (§3.4), dua tab pada layar &
   filter yang sama berbagi **satu** entri.
4. **Kadens per-topik**, semuanya ≤ kadens polling hari ini:

   | Topik | Biaya `build` | Poll hari ini | Kadens baru |
   |---|---|---|---|
   | `schedulerState` | DB + tmux (async) | 5 000 ms | 2 000 ms |
   | `schedulerQueue` | 1 query ber-index | 5 000 ms | 3 000 ms |
   | `tickets` | scan tabel Ticket | 5 000 ms | 3 000 ms |
   | `lead` | DB N+1 + tmux + antrean | 5 000 ms | 4 000 ms |
   | `git` | 3 subprocess git | 4 000 ms | 4 000 ms |

5. **Tak pernah memblokir loop.** Entri di-tick di `__tick()` yang sama tetapi **tidak di-`await`**
   oleh loop grup: `void run(entry)` dengan penjaga `entry.inflight` sendiri. Satu `git log` yang
   lambat karena itu tak bisa menunda grup `sessions`/`specs` yang berkadens 1 dtk — dan `build`
   apa pun yang dipakai di sini **wajib async** (`listSessionsAsync`, bukan `listSessions`
   ber-`execFileSync`: 6,28 ms/panggilan memblokir event loop yang dibagi dengan PTY terminal,
   pelajaran terukur SPEC-479/SPEC-812). `build` yang melempar → dicatat `failing`, entri dilewati,
   **frame lama tak dihapus** (klien tak boleh di-blank saat gagal).

**Muatan pertama seketika.** Saat frame `sub` melahirkan entri baru, server mengirim muatannya
segera — dari `entry.last` bila entri sudah ada (nol biaya), atau lewat satu `build` di luar
jadwal bila belum. Tanpa ini, kembali dari tab tersembunyi (socket ditutup sengaja, lihat
`api/events.ts:77`) berarti layar diam sampai tick berikutnya.

**`detach(client)`** menyapu klien dari semua entri; `__reset()` mengosongkan `entries` (dipakai
test).

---

## 5. Satu definisi per muatan

Frame dan respons HTTP **tidak boleh** punya dua serializer. Body route yang sekarang inline
diekstrak ke service, lalu **route dan hub memanggil fungsi yang sama** — menyalinnya ke call site
kedua persis kelas bug SPEC-431/448/475.

| Muatan | Sekarang | Menjadi |
|---|---|---|
| state scheduler | inline `routes/scheduler.ts:58-83` | `services/scheduler/state.ts` → `buildSchedulerState()` |
| halaman antrean | inline `routes/scheduler.ts:86-98` | `services/scheduler/queue.ts` → `buildQueuePage(p)` |
| halaman tiket | inline `routes/tickets.ts:22-36` | `services/tickets-list.ts` → `buildTicketsPage(p)` |
| status lead | inline `routes/lead.ts:34-68` | `services/lead/views.ts` → `buildLeadStatus()` |
| decisions / flows | inline `routes/lead.ts:72-99` | `services/lead/views.ts` → `buildLeadDecisions(p)` / `buildLeadFlows(p)` |
| graph + status + stash | 3 route `routes/ide.ts:247-281` | `services/git-ide.ts` → `buildGitLive(p)` (komposisi, ketiga fungsi lama tetap) |

Efek samping yang disengaja: `buildSchedulerState()` dan `buildLeadStatus()` memakai
**`listSessionsAsync`**, sehingga dua route HTTP itu berhenti memblokir event loop juga.

---

## 6. Permukaan masuk & otorisasi

Kanal ini sekarang membaca input. Pagar:

1. **Hanya principal cookie yang boleh berlangganan.** `admitBrowserWs` mengembalikan
   `WsPrincipal { kind: "user"|"agent"|"device"|"test", id }`. Frame `sub` **hanya dilayani** untuk
   `kind === "user"` (dan `"test"` di bawah `NODE_ENV=test`); principal lain tetap menerima kedelapan
   grup lama dan frame `sub`-nya dibuang senyap. Alasannya bukan kehati-hatian umum: `/events/ws`
   dipetakan ke capability **`GLOBAL_READ`** untuk agent token (`capabilityForRoute`, ADR-0065),
   sementara topik baru menyentuh domain `support` (tiket), `lead`, dan `ide` — tanpa gerbang ini
   satu agent token ber-capability read global memperoleh baca ke tiga domain yang tak diberikan
   kepadanya. Dashboard adalah satu-satunya konsumen, jadi nol fungsi hilang.
2. **Batas bentuk.** `MAX_WS_MESSAGE_BYTES` (64 KiB, `services/ws-admission.ts:7`) ditegakkan pada
   frame masuk; `subs` ≤ 16 entri; parameter divalidasi `zTopicParams` `.strict()` (kunci asing
   ditolak, bukan diabaikan); topik tak dikenal **dilewati, bukan menjatuhkan seluruh frame** —
   ADR-0087 mengizinkan dashboard lebih baru daripada server, jadi frame yang memuat topik masa
   depan harus tetap memasang topik yang dikenal.
3. **Laju.** `WsMessageMeter` (`ws-admission.ts:227`) dipasang di route `events` seperti di terminal.
   Frame `sub` lahir dari perubahan filter/halaman manusia, bukan ketikan; kuota kecil sudah cukup.
4. **Nol pelonggaran auth.** `admitBrowserWs` + `revalidateWsPrincipal` 60 dtk tetap apa adanya;
   pencabutan sesi tetap menutup socket beserta semua langganannya.
5. **Parameter tak pernah jadi path/argv mentah.** `projectId` diresolusi lewat lookup project yang
   sama dengan route HTTP; `branches` diteruskan sebagai argv `execFile` (bukan shell) oleh
   `listGraph` yang sudah ada.

---

## 7. Klien

### 7.1 `api/events.ts` — langganan di atas socket yang SAMA

Tambahan, tanpa socket kedua (kuota `MAX_CONNECTIONS_PER_PRINCIPAL` = 8 tak boleh naik):

```ts
export function subscribeTopic<T>(topic, params, onData: (d: T) => void): () => void;
export function eventsTopics(): EventTopic[];              // dari frame `hello`, [] sebelum tiba
export function subscribeTopics(cb: (t: EventTopic[]) => void): () => void;
```

- `subscribeTopic` memakai `subscribe()` yang ada di dalamnya → socket dibuka/ditutup oleh ref-count
  yang sama.
- Himpunan langganan disimpan di modul, frame `sub` **dikirim ter-coalesce di microtask** (empat
  `QueueSection` yang mount bersamaan = satu frame) dan **dikirim ulang utuh di setiap `onopen`**.
- Frame masuk dicocokkan `msg.key === subKey(topic, params)`.

### 7.2 `useLiveTopic` — satu tempat untuk "kapan menyegarkan"

```ts
// src/src/api/live.ts
useLiveTopic({ topic, params, apply, refetch, pollMs });
```

- **Muat awal tetap HTTP** — layar memanggil `load()`-nya sendiri seperti sekarang. WS hanya
  menyegarkan.
- Frame tiba → `apply(frame)`, **tanpa** menyentuh `loading`/`error`. Sifat silent refresh yang ada
  hari ini dipertahankan by construction: `apply` tak punya akses ke keduanya.
- Filter/halaman/opsi dihormati **secara struktural**: `params` adalah state layar yang sedang
  aktif, dan `key` diturunkan darinya. Frame untuk halaman lain **tak cocok kunci** sehingga tak
  bisa mendarat. Perilaku yang dijaga SPEC-523 & SPEC-740 tak disentuh sama sekali.

### 7.3 Degradasi (ADR-0087: dashboard boleh lebih baru daripada server)

Server baru mengirim `{t:"hello", topics}` saat attach. Server lama **tak mengirim apa pun**
yang menyerupainya — itulah sinyalnya.

`useLiveTopic` menyalakan `setInterval(pollMs)` **hanya** pada dua keadaan yang bisa dibuktikan:

1. `hello` sudah tiba **dan** `topic` tak ada di dalamnya → server ini memang tak punya topiknya.
2. Socket belum pernah mengantar satu frame pun selama `FALLBACK_AFTER_MS` = 15 dtk → WS terhalang
   (proxy yang menolak upgrade) padahal HTTP hidup.

Selama WS sehat: **nol** `setInterval` dan **nol** request HTTP berkala. Saat WS putus sesaat,
tak ada polling — reconnect ber-backoff yang sudah ada (`api/events.ts:69`) memulihkan data lewat
muatan-pertama-seketika (§4).

### 7.4 Indikator koneksi mati

Satu komponen baru `ds`-compliant, mengamati `eventsStatus`/`subscribeStatus` yang **sudah ada**
(pola `useEventsStatus` di `screens/HanomanPet.tsx:63`) — tanpa channel, endpoint, atau poll baru:

- Tampil hanya saat `!connected && !paused` melewati grace **6 dtk** (menelan tiga percobaan
  reconnect; angka & alasan yang sama dengan `PET_OFFLINE_MS`).
- `paused` (tab tersembunyi, socket ditutup **atas permintaan kita**) **bukan** gangguan dan tak
  pernah memunculkan indikator.
- Bentuknya `Badge` design system (`ds/components/feedback.tsx:19`), tone peringatan, teks
  "koneksi terputus" + "menyambung ulang…", dipasang di header keempat layar.

---

## 8. Yang TIDAK berubah

- Kanal WS terminal (`services/pty.ts`), jalur ketikan & echo prediktif (SPEC-856/860/878/882) —
  nol perubahan. Pagar §4.5 (non-blocking, async-only) ada justru untuk melindunginya.
- Endpoint HTTP: **tak satu pun dihapus**. MCP, agent token, portal klien, dan dashboard versi lama
  memakainya.
- Delapan grup ADR-0039 yang ada, beserta kadens dan dedup-nya.
- Satu koneksi WS per tab; kuota per-user tetap 8.
- `usePersistedState`, reset halaman saat filter berubah, plafon `limit` (SPEC-523/740, ADR-0107/0115).

---

## 9. Test

**Server** (`server/test/events-subscriptions.test.ts` baru + suntingan yang ada):
- frame `sub` cacat / topik tak dikenal / `subs` melebihi 16 / kunci asing → ditolak per-entri,
  socket tetap hidup, topik yang sah tetap terpasang.
- principal `kind:"agent"` mengirim `sub` → tak ada entri yang lahir, kedelapan grup lama tetap tiba.
- dua klien parameter identik → `build` dipanggil **sekali**, frame byte-identik.
- entri tanpa pelanggan → `build` **tak pernah** dipanggil.
- dedup: `build` mengembalikan data sama → tak ada frame kedua.
- kadens per-topik dihormati; `build` lambat tak menunda grup `sessions`.
- `build` melempar → tak ada frame, entri bertahan, frame berikutnya normal.
- `detach` menghapus entri; `__reset` mengosongkan peta.
- frame `hello` tiba sebelum snapshot grup.

**Shared**: `subKey` stabil terhadap urutan kunci, membuang `undefined`, beda parameter → beda kunci.

**Klien** (`src/test/events-topics.test.ts` baru):
- `sub` terkirim sekali untuk empat langganan yang mount bersamaan (coalesce).
- `sub` dikirim ulang utuh setelah reconnect.
- frame ber-`key` lain diabaikan.
- `hello` memuat topik → **nol** `setInterval` (fake timers, majukan 30 dtk, `fetch` tak dipanggil).
- `hello` tanpa topik → interval fallback menyala di `pollMs`.
- socket bisu 15 dtk → fallback menyala.

**Layar** (menambah ke test yang ada — scout memastikan **tak satu pun** test sekarang menegakkan
kadens poll, jadi menghapus `setInterval` tidak akan memerahkan apa pun tanpa test baru):
- frame tiba → data ter-update **tanpa** `loading` pernah tampak.
- frame tiba saat berada di halaman 3 dengan filter aktif → tetap di halaman 3, filter utuh.
- `build` gagal / socket putus → data lama tetap terpampang, indikator muncul sesudah 6 dtk.

Test terminal & test keempat layar yang ada **harus tetap hijau**.

---

## 10. Docs

- **ADR baru** di `internal/docs/adr/` — mengamandemen ADR-0039 (kanal tak lagi read-only; grup
  global tetap; langganan berparameter berdampingan dengannya), menyebut ADR-0024, menegakkan
  ADR-0087/0107/0115/0134. Nomornya diambil setelah memeriksa tabrakan (memori: nomor ADR bertabrakan
  antar-sesi konkuren).
- `internal/docs/architecture/api-contract.md` §Events — frame masuk, topik, `key`, kadens,
  gerbang principal; catatan "Realtime area Triase = HTTP polling" (`:1365`) dan "hanoman-lead:
  semua HTTP polling" (`:1507`) **diperbarui**, bukan dibiarkan.
- `internal/docs/architecture/stack.md` — baris Realtime.
- `internal/docs/frontend/frontend-implementation.md` — `useLiveTopic`, degradasi, indikator.
- `internal/docs/README.md` — tautan ADR baru.

---

## 11. Risiko & gotcha

1. **`WireMsg` longgar menelan salah ketik.** `services/events.ts:20` mendeklarasikan
   `type WireMsg = { t: string; [k: string]: unknown }`, jadi `t` di `GROUPS` **tak pernah dicek**
   terhadap union `EventMsg`. Menambah lima `t` baru di bawah tipe itu berarti satu huruf salah lolos
   typecheck server dan jatuh senyap di klien. **Mitigasi wajib**: sempitkan tipe pembangun frame ke
   `EventMsg` sehingga `t` diikat kompilator. Ini juga menutup lubang yang sama untuk delapan grup lama.
2. **`listSessions()` sinkron.** Dipakai `routes/scheduler.ts:60` dan `routes/lead.ts:42`. Ekstraksi
   §5 mengubahnya ke `listSessionsAsync`; test route yang men-stub `listSessions` akan ikut berubah.
3. **`limit` yang tumbuh di GitGraph.** `more()` menaikkan `gopts.limit` → `key` berubah → entri lama
   mati, entri baru lahir dengan muatan-pertama-seketika. Benar, tetapi berarti entri git berumur
   pendek saat operator menggulir; plafon `limit` menjaganya berbatas.
4. **Tab tersembunyi.** `api/events.ts:77` menutup socket saat `document.hidden` — langganan ikut
   mati di server (perilaku yang diinginkan), dan dipasang ulang saat tab aktif lagi.
5. **`tickets` men-scan tabel penuh** (`routes/tickets.ts:27` `findMany` tanpa `take`, filter `q` di
   memori). Kadens 3 dtk **lebih sering** daripada 5 dtk hari ini; yang menahannya adalah entri hanya
   hidup selama layar Triase terbuka dan dedup lintas tab. Bila tabel tiket tumbuh besar, batas
   `take` di query adalah perbaikan terpisah — **tidak** dikerjakan di sini.
6. **Empat `QueueSection` = empat entri.** Satu layar Scheduler membuka lima langganan. Cap 16
   memberi ruang; frame `sub` yang ter-coalesce menjaga jumlah frame masuk tetap satu.
