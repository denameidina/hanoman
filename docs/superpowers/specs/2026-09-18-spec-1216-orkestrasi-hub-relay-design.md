# SPEC-1216 — Orkestrasi dari hub: aksi sesi lewat relay, gerbang satu sesi lintas instance, target Start

**Tanggal:** 2026-09-18 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `61bc006c` (rilis 0.6.0, sesudah SPEC-1215 turunan A merge di `c507df84`)
**Fase penulis bagian ini:** Brainstorm (1/5)
**Design-of-record (terkunci, tidak diulang di sini):**
[spec SPEC-1215 §S4.4, §S4.6, §S4.11, §S5, §S6, §S9 (AC-B1…AC-B11)](2026-09-14-spec-1215-hub-orkestrasi-klien-design.md) ·
[ADR-0165 §6/§8/§9](../../../internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md)

## Konteks & keputusan

### Ini adalah turunan B dari payung SPEC-1215, bukan desain baru

SPEC-1215 sudah melewati fase Spec penuh dan menetapkan arsitektur, kontrak, dan 45 AC (EARS) untuk
seluruh payung "hub mengorkestrasi klien" (A fondasi kanal · B orkestrasi · C tampilan identik ·
D log terpusat). Fase Plan SPEC-1215 (§S13) memutuskan sesi itu hanya mengeksekusi **A**, dan
memfilekan B/C/D sebagai backlog terpisah ber-`dependsOn` SPEC-1215. Backlog ini (**SPEC-1216**) ADALAH
turunan B. Karena kontraknya sudah dikunci di fase Spec SPEC-1215, brainstorm ini **tidak mendesain
ulang** — ia merujuk, mengonfirmasi turunan A benar sudah merge, memetakan kontrak yang terkunci ke
keadaan kode saat ini, dan mencatat apa yang benar-benar tersisa untuk dikerjakan turunan B. Setiap
perubahan atas keputusan yang sudah dikunci (K1–K12 di SPEC-1215, §1–§10 di ADR-0165) hanya sah lewat
amandemen ADR-0165, bukan lewat spec/plan SPEC-1216.

### Verifikasi: turunan A benar sudah merge ke base ini

`git log` menunjukkan seluruh 16 task plan
`docs/superpowers/plans/2026-09-15-spec-1215-a-fondasi-kanal-relay.md` sudah dicentang dan ter-commit
(`5b25a5eb` … `c1c59de5`), diikuti `docs(spec-1215): cabut penanda DIRANCANG bagian turunan A`
(`6e589085`) dan rilis `chore(release): 0.5.0 — fondasi kanal relay hub ↔ klien (SPEC-1215 A)`
(`c507df84`), yang sudah menjadi leluhur base `61bc006c` sesi ini. Diperiksa langsung di kode (bukan
diasumsikan dari commit message):

| Kontrak A (SPEC-1215 §S8) | Bukti di kode saat ini |
|---|---|
| Skema `shared` relay/logs | `shared/src/relay.ts` (`REMOTE_CAPABILITIES`, `relayRouteAllowed`, `remoteCapabilityFor`) |
| Migration `LogEntry`/`LogCursor` | ada, dipakai `appendEvent` (`server/src/services/logs/event-log.ts`) |
| Gate principal `remote` + rahasia proses | `server/src/services/relay/{gate,secret}.ts` |
| `/remote-control` + `RemoteControlPanel` | `server/src/routes/remote-control.ts` + `server/src/services/remote-control.ts` |
| Relay client (klien) `req`/`res` lewat `app.inject` | `server/src/services/relay/dispatcher.ts` (`createRelayDispatcher`) — sudah menjalankan `req`, memotong respons, mengaudit `remote.request` |
| Relay hub — registry + `requestRelay()` | `server/src/services/relay/hub.ts` — **sudah mengekspor `requestRelay()`** dan `attachRelaySocket`, dengan komentar eksplisit di berkas: *"Route HTTP yang memakai `requestRelay` lahir di SPEC-1216 — di turunan A ia diekspor dan dibuktikan lewat test."* |
| Pencabutan seketika | `server/src/services/device-sockets.ts` (`registerDeviceSocket`, dipakai `attachRelaySocket`) |
| Frame `capacity` + `control`/`capacity` di presence | `server/src/services/presence/{registry,view,sender}.ts` (`recordCapacity`, `capacityFor`) |

Kesimpulan: **fondasi kanal (socket, gate, dispatcher `req`, registry, audit) sudah berdiri dan
teruji.** Yang belum ada — dan itulah isi turunan B — adalah **permukaan HTTP di hub** yang memanggil
`requestRelay()`, perluasan gerbang peluncuran/penyelesaian untuk membaca presence lintas instance, dan
frontend (`createApi`/`InstanceContext`/dialog Start/aksi sesi remote).

### Pemetaan AC-B1…AC-B11 (SPEC-1215 §S9) ke keadaan kode — apa yang masih kosong

Diperiksa satu per satu di kode (bukan diasumsikan):

1. **AC-B1/B2/B9 (route HTTP `/api/devices/:deviceId/relay/*` + parity kontrak).** Belum ada
   `server/src/routes/devices-relay.ts` — `find`/`grep` di `server/src/routes` tak menemukannya.
   `requestRelay()` di `hub.ts` sudah siap dipanggil, tinggal dibungkus route `COOKIE_ONLY` top
   `devices` (S4.4) yang menerjemahkan HTTP masuk → frame `req` → jawaban HTTP, plus mapping galat
   503/409/413/415/429/502/504 (S4.4).
2. **AC-B3 (`force` remote → 403).** `launchPrincipal()` (`server/src/services/launch-authority.ts:10`)
   hari ini hanya mengenal `source.user`/`source.agent` — **belum ada cabang `remote`**. Ini persis yang
   ADR-0165 §6 dan spec §S4.6 minta ditambahkan turunan B.
3. **AC-B4/B5/B6 (satu sesi lintas instance, gerbang `remote-session`/`confirm-required`).**
   `presence/registry.ts` hari ini hanya punya `recordPresence`/`presenceEntries`/`recordCapacity`/
   `capacityFor`/`dropPresence` — **tak ada `recentlyOffline`** dan tak ada pembacaan presence di
   `startSpecSession`/`POST /specs/:id/done`. `routes/specs.ts:351` sudah punya bentuk balasan
   `409 confirm-required` untuk gerbang **lokal** (ADR-0120) yang jadi pola untuk diperluas ke presence
   lintas instance — bukan ditulis ulang.
4. **AC-B7/B8 (target default dialog Start + alasan tak terpilih).** Belum ada di frontend; ini bagian
   S4.11 (`StartSessionModal` pemilih target) yang menunggu `createApi`/`InstanceContext` (poin
   berikutnya) berdiri lebih dulu.
5. **AC-B10 (offline/timeout/413 → 503/504/413 tanpa nulis state lokal).** Mengikuti bentuk error
   `RelayError` yang sudah ada di `hub.ts` (`offline`/`protocol-mismatch`/`busy`/`timeout`/`too-large`/
   `protocol`) — pemetaan ke kode HTTP tinggal dilakukan di route baru.
6. **AC-B11 (spec-404 → `syncOnce` sekali lalu ulang).** Belum ada — ini logika baru di dispatcher
   klien (`relay/dispatcher.ts`) yang saat ini hanya menjalankan `app.inject` apa adanya tanpa retry.
7. **`createApi({base})` + `InstanceContext` (S4.11, dipindah dari turunan C ke B — S1 poin 7 spec
   SPEC-1215).** `src/src/api/client.ts` hari ini mengekspor `export const api = createApi()`? — perlu
   diverifikasi persis di fase Spec, tapi `grep` awal menunjukkan **belum ada** `createApi({base})`
   sebagai pabrik maupun `src/src/api/instance.tsx`. Ini murni pekerjaan frontend baru turunan B.

Tidak ada temuan yang bertentangan dengan kontrak SPEC-1215/ADR-0165 — keadaan kode persis seperti yang
diantisipasi S8 ("A saja dieksekusi; B menyusul route HTTP + gerbang + frontend").

### Keputusan yang dikunci dan dikonfirmasi berlaku apa adanya (rujukan, bukan re-desain)

- **Kontrak route** (`GET|POST|PUT|PATCH|DELETE /api/devices/:deviceId/relay/*`, `COOKIE_ONLY`, top
  capability `devices`) dan pemetaan galat hub (`404 unknown-device` · `503 offline` ·
  `409 protocol-mismatch` · `413 too-large` · `415 unsupported-media` · `429 busy` · `502 protocol` ·
  `504 timeout`) — SPEC-1215 §S4.4.
- **Perubahan route yang ada** (`POST /terminal/sessions` gerbang `remote-session`/`confirm-required` +
  `force` 403 + `launchPrincipal` `remote:<email>@<hubOrigin>`; `startSpecSession` membaca presence;
  `POST /specs/:id/done` gerbang presence + `by` beraktor remote; `PUT /settings` mempertahankan tiga
  kunci; `DELETE /device-tokens/:id` sudah selesai di A) — SPEC-1215 §S4.6.
- **Kontrak frontend** (`createApi({base})`, `InstanceContext`, `useApi`/`useWsTarget`, mode remote
  `TerminalPane`/`SpecDocsModal`/panel IDE baca, `StartSessionModal` target default + alasan tak
  terpilih + tanpa "Mulai tetap" (force) di target remote, aksi sesi remote memakai komponen yang sudah
  ada) — SPEC-1215 §S4.11.
- **Aliran utama "Start dari hub"** dan **tabel galat** (S6) berlaku apa adanya sebagai kontrak yang
  diimplementasikan, termasuk residu yang diterima secara eksplisit (jendela balapan ≤ tick presence
  3 dtk, tanpa kunci terdistribusi — ADR-0024/0086) dan invarian ADR-0165 §8: **presence hanya boleh
  menolak atau mengusulkan, tak pernah meluluskan**; ketiadaan sesi di presence bukan izin.
- **Di luar lingkup B** (mewarisi "Di luar lingkup" SPEC-1215 + batas turunan): stream terminal/events
  jarak jauh (`wsHandler`, tiket, kredit/resync/geometry) — itu turunan C (SPEC-1218); shipper/spool/
  ingest/pencarian log — turunan D (SPEC-1217); auto-dispatch scheduler/lead ke klien; mirror seluruh
  dashboard; RBAC per user.

### Constraint tambahan brief ini yang selaras dengan yang sudah dikunci

Brief menegaskan: presence/`handledBy` hanya boleh menolak/mengusulkan (persis ADR-0165 §8); tanpa
auto-dispatch (persis §9); tanpa Redis/queue/worker/Docker (ADR-0024/0086, sudah ditegakkan turunan A,
tak ada perubahan); rilis hub dulu (K12, sudah pola turunan A: server dulu, dashboard menyusul
kompatibel); update `internal/docs` + cabut penanda DIRANCANG bagian B dalam commit yang sama —
penanda ini sudah teridentifikasi persis satu titik:
`internal/docs/frontend/frontend-implementation.md:47` — *"`RemoteControlPanel` … mendarat di turunan A
tanpa toggle lajur log (SPEC-1217); sisanya DIRANCANG untuk SPEC-1216/SPEC-1218."* — frasa
"SPEC-1216" di situ dicabut saat Execute turunan B mendarat (bagian SPEC-1218/C tetap DIRANCANG sampai
turunan C).

### Dependensi backlog

Backlog SPEC-1216 di DB (dicek lewat brief) memuat `dependsOn: SPEC-1215` — sudah `done`/ter-merge
sehingga gerbang dependency (ADR-0093) tidak menahan. Tidak ada dependensi lain yang belum terpenuhi.

### Tidak ada keputusan terbuka yang butuh input manusia di fase ini

Seluruh keputusan bentuk (kontrak API, gerbang, capability, alasan penolakan target) sudah dikunci di
fase Spec SPEC-1215 dan dikonfirmasi berlaku tanpa kontradiksi terhadap keadaan kode saat ini. Fase
Objective berikutnya menurunkan kriteria sukses terukur dari AC-B1…AC-B11 di atas; fase Spec berikutnya
(bila perlu koreksi kecil sekelas S1 SPEC-1215) mencatatnya sebagai koreksi, bukan desain baru.

## Objective

**Fase penulis bagian ini:** Objective (2/5)

### Objective (tunggal, terukur)

Menutup seluruh titik kosong kode yang dipetakan di fase Brainstorm (route HTTP relay, gerbang satu
sesi lintas instance, `launchPrincipal` remote, retry `syncOnce`, `createApi`/`InstanceContext`, dialog
Start bertarget) sehingga **AC-B1…AC-B11 (SPEC-1215 §S9) lulus sebagai test kontrak/otomatis yang dapat
dijalankan ulang** — bukan diverifikasi manual/anekdot — dan `internal/docs` yang tersentuh (termasuk
pencabutan penanda DIRANCANG di `internal/docs/frontend/frontend-implementation.md:47`) diperbarui
dalam commit yang sama dengan kode.

Objective ini tidak menambah cakupan di luar AC-B1…B11 yang sudah dikunci SPEC-1215 §S9 — ia hanya
menurunkannya menjadi kriteria yang bisa dicentang test, sesuai batas turunan B yang dikonfirmasi di
bagian Konteks & keputusan di atas.

### Kriteria sukses (satu baris = satu AC, dapat dicentang oleh test)

| # | AC | Kriteria sukses terukur |
|---|---|---|
| SC1 | AC-B1, AC-B9 | Test kontrak baru memanggil `POST /api/devices/:deviceId/relay/terminal/sessions {spec}` pada device ber-grant `sessions:spawn` → klien menjalankan `POST /api/terminal/sessions` lewat `app.inject` dengan body sama, worktree lahir di mesin **klien** (bukan hub); pola yang sama (route relay → route klien, status/body klien diteruskan apa adanya) dibuktikan lulus untuk steer, interrupt, jawab dialog, dan tandai selesai. |
| SC2 | AC-B2 | Test kontrak menjalankan start/steer/interrupt/jawab-dialog/tandai-selesai atas fixture **identik** dua jalur — cookie lokal vs relay — lalu meng-assert kolom `Spec`, berkas fase, id sesi, dan path worktree **sama persis**; satu-satunya beda yang lulus assert adalah prefix aktor (`launchApprovedBy`, `manualDone.by`). |
| SC3 | AC-B3 | Test unit/integrasi: request relay dengan `force: true` dijawab **403** sebelum `approveLaunch` dipanggil (dibuktikan lewat spy/mock tak terpanggil), untuk cabang principal `remote` baru di `launch-authority.ts`. |
| SC4 | AC-B4 | Test: start relay ke device yang sudah punya sesi hidup untuk SPEC yang sama memulangkan id sesi **yang ada** (bukan sesi baru); tak ada pane kedua tercipta (dicek lewat count sesi/tmux pane sebelum-sesudah). |
| SC5 | AC-B5 | Test: presence hub menunjukkan sesi `working`/`waiting` SPEC X di device D → `startSpecSession` SPEC X di hub (aktor manusia maupun scheduler) dan start relay ke device selain D dijawab **409** dengan body persis `{deviceId, name, sessionId}`. |
| SC6 | AC-B6 | Test: device yang terakhir tercatat mengerjakan SPEC X sudah tak ada di presence (punah) → `startSpecSession` dan `POST /specs/:id/done` di hub dijawab **409 confirm-required**; hanya berhasil saat request menyertakan `confirmRemote: true` / `confirm: true`. |
| SC7 | AC-B7 | Test frontend (dialog Start): untuk backlog ber-`handledBy`, target default terpilih = device `handledBy` pertama yang online ∩ ber-`sessions:spawn` ∩ kapasitas tak penuh; tanpa kandidat memenuhi → default jatuh ke "hub ini"; **tak ada** peluncuran terjadi tanpa klik manusia (dicek: tak ada pemanggilan API start otomatis saat dialog dibuka). |
| SC8 | AC-B8 | Test frontend: device offline / tanpa grant `sessions:spawn` / kapasitas penuh / berprotokol lain tampil di dialog Start sebagai **tak terpilih** disertai alasan spesifik per kondisi; status online/offline dialog mengikuti siklus presence ≤ 90 dtk (test memakai fixture presence dengan `lastSeenAt` melewati ambang). |
| SC9 | AC-B10 | Test: relay offline / timeout / respons > 1 MiB dijawab hub berturut-turut **503**/**504**/**413** dengan `kind: "relay"`; dibuktikan **tak ada** tulisan state lokal (Session/Spec/dsb.) selain baris log `relay.request` (diff DB before/after kosong di luar tabel log). |
| SC10 | AC-B11 | Test dispatcher klien: relay start dijawab klien 404 `spec not found` → klien menjalankan **tepat satu** `syncOnce` lalu mengulang **tepat satu kali** sebelum meneruskan jawaban akhir (dibuktikan lewat spy/count pemanggilan `syncOnce` dan `app.inject`). |
| SC11 | Constraint brief | `internal/docs` yang tersentuh diperbarui dan ditautkan di `internal/docs/README.md`, serta frasa "SPEC-1216" di penanda DIRANCANG `internal/docs/frontend/frontend-implementation.md:47` dicabut — **dalam commit yang sama** dengan kode fase Execute. |

### Cara verifikasi (ringkas, bukan rencana — didetailkan di fase Plan)

Seluruh SC di atas diverifikasi lewat **test otomatis** (`pnpm vitest --run` pada berkas yang tersentuh,
`--no-file-parallelism` untuk set yang menyentuh test server per `CLAUDE.md`) plus satu **smoke manual**
di akhir Execute: boot server, curl `/api/devices/:deviceId/relay/terminal/sessions` end-to-end antara
dua instance lokal (hub + klien) untuk membuktikan SC1/SC2 nyata, bukan hanya lulus mock. Tak ada SC
yang dianggap terpenuhi oleh klaim tanpa bukti test/curl yang benar-benar dijalankan.

## Spec teknis (fase Spec 3/5)

**Fase penulis bagian ini:** Spec (3/5)

> Bagian ini **tidak mengunci kontrak baru**. Kontraknya sudah dikunci spec SPEC-1215 §S4.4/§S4.5/
> §S4.6/§S4.11/§S5/§S6/§S9 dan ADR-0165 §6/§8/§9. Yang dikunci di sini adalah **cara mendaratkannya di
> kode yang benar-benar ada di base `61bc006c`**: berkas, tanda tangan fungsi, urutan gerbang, dan
> bentuk test. Setiap angka/kosakata yang berselisih dengan SPEC-1215/ADR-0165 adalah salah tulis di
> sini, bukan keputusan baru — koreksinya lewat amandemen ADR-0165.

### T1. Arsitektur turunan B di atas fondasi A

```
Browser hub ──cookie──▶ HUB Fastify
  StartSessionModal (target picker)        routes/devices-relay.ts   (BARU, COOKIE_ONLY, top "devices")
  aksi sesi via InstanceContext remote  │    └─ requestRelay()  ← sudah ada (A, hub.ts:99)
  createApi({base})                     │  services/presence/registry.ts  + recentlyOffline (BARU)
                                        │  services/session-launch.ts     + gerbang presence (BARU)
                                        │  routes/specs.ts  POST /specs/:id/done + gerbang presence
                                        ▼  services/logs/event-log.ts     ← audit relay.request (A)
                         WS /api/sync/relay/ws  (A)
KLIEN Fastify
  services/relay/dispatcher.ts  + retry spec-404 → syncNow() sekali (BARU)
  app.ts gate `remote` (A) → routes/terminal.ts  + force 403 (BARU)
  services/launch-authority.ts  + cabang principal `remote` (BARU)
  startSpecSession apa adanya → worktree LAHIR DI KLIEN
```

Tiga invarian yang menyandera bentuk di atas:

1. **Gerbang presence hanya berarti di hub.** `presence/registry.ts` di klien hanya pernah diisi
   `recordPresence(LOCAL_DEVICE_ID, …)` oleh `presenceView()`; peta device remote hanya terisi di
   handler `/api/sync/ws` yang cuma hidup di hub. Karena itu gerbang ditanam **di dalam**
   `startSpecSession` (satu jalur untuk route manual, governor scheduler, dan denyut lead) **tanpa**
   flag "saya hub" — di klien ia terbukti no-op karena tak ada entri device ≠ `local`. Test menegakkan
   ini, bukan komentar.
2. **Presence tak pernah meluluskan** (ADR-0165 §8). Gerbang hanya menambah cabang **penolakan**;
   tak ada jalur baru yang melewati `assertLaunchApproved`, gerbang dependency, atau
   `withSessionAdmission`.
3. **Worktree lahir di klien** karena hub tak pernah memanggil `startSpecSession` untuk target remote —
   ia hanya meneruskan HTTP. Itu sifat `requestRelay` + `app.inject`, bukan sesuatu yang route baru
   boleh "optimalkan".

### T2. Komponen (berkas yang lahir/berubah di turunan B)

| Berkas | Perubahan | AC |
|---|---|---|
| `server/src/routes/devices-relay.ts` (baru) | route `GET|POST|PUT|PATCH|DELETE /devices/:deviceId/relay/*`; pemetaan `RelayError` → status; audit `relay.request` | B1, B9, B10 |
| `server/src/services/agent-capabilities.ts` | top `devices` **eksplisit** `COOKIE_ONLY` (hari ini jatuh ke `null` → cookie-only secara kebetulan; dijadikan baris + test) | B1 |
| `server/src/services/launch-authority.ts` | `launchPrincipal` mengenal `source.remote` | B1, B2 |
| `server/src/routes/terminal.ts` | `force` dari `req.remote` → 403 sebelum `approveLaunch`; `confirmRemote` diteruskan; `LaunchError` baru → 409 | B3, B5, B6 |
| `server/src/services/session-launch.ts` | `LaunchError` kind `remote-session`/`confirm-required` + payload `remoteSession`; gerbang presence | B4, B5, B6 |
| `server/src/services/presence/registry.ts` | `recordRecentlyOffline`/`recentlyOffline(specId)` (memori, ≤ 24 jam) diisi dari `dropPresence`/sapuan `presenceEntries` | B6 |
| `server/src/services/presence/remote-session.ts` (baru) | fungsi murni `remoteSessionVerdict()` — satu-satunya tempat presence dibaca sebagai gerbang | B5, B6 |
| `server/src/routes/specs.ts` | `POST /specs/:id/done`: gerbang presence lapis kedua + `by` aktor remote | B6, B9 |
| `server/src/services/relay/dispatcher.ts` | retry spec-404 → satu `syncOnce` lalu satu ulang | B11 |
| `server/src/services/relay/client.ts` | menyuntik `syncOnce: () => syncNow()` ke dispatcher | B11 |
| `src/src/api/client.ts` | `createApi({ base })` + `export const api = createApi()` | B7, B9 |
| `src/src/api/instance.tsx` (baru) | `InstanceContext`, `useInstance`, `useApi`, `useWsTarget` | B7, B9 |
| `src/src/api/start-targets.ts` (baru) | fungsi murni `startTargets(view, handledBy)` → kandidat + alasan | B7, B8 |
| `src/src/App.tsx` (`StartSessionModal`) | pemilih target, default, alasan tak terpilih, tanpa force di target remote, 409 `remote-session`/`confirm-required` | B7, B8 |

Tak ada perubahan skema Prisma, tak ada migration, tak ada konstanta `shared` baru selain tipe.

### T3. Kontrak — route relay hub (`routes/devices-relay.ts`)

```ts
// didaftarkan di scope /api yang sudah ada; lima method, satu handler
app.route({ method: ["GET","POST","PUT","PATCH","DELETE"], url: "/devices/:deviceId/relay/*", handler })

// 1. principal: COOKIE_ONLY. req.user wajib; req.agent/req.remote → 403 (jatuh dari gate app.ts)
// 2. device: prisma.deviceToken.findFirst({ where: { id, revokedAt: null } })
//    tak ada / dicabut                         → 404 { error, relay: "unknown-device" }
// 3. content-type non-JSON pada method bertubuh → 415 { error, relay: "unsupported-media" }
// 4. path  = "/api/" + params["*"]              (tanpa "..", ≤ 2048 — zRelayPath shared, A)
//    query = req.raw.url setelah "?" (≤ 2048)
//    body  = req.body apa adanya (JSON), undefined untuk GET/DELETE tanpa tubuh
// 5. actor = { hubOrigin, userId: req.user.id, email: req.user.email }
//    hubOrigin = req.headers.origin ?? `${req.protocol}://${req.headers.host}` (≤ 200)
// 6. timeout = RELAY_SPAWN_TIMEOUT_MS bila (POST && path === "/api/terminal/sessions")
//              selain itu RELAY_REQ_TIMEOUT_MS
// 7. requestRelay(deviceId, { method, path, query, body, actor }, { timeoutMs })
// 8. sukses → reply.code(res.status)
//               .header("content-type", res.contentType ?? "application/json")
//               .header("x-hanoman-device", deviceId).send(res.body)   // body TEKS apa adanya
```

Pemetaan `RelayError.kind` → status (satu tabel, dipakai test tabel-driven):

| `kind` | status | body |
|---|---|---|
| `offline` | 503 | `{ error, relay:"offline", presence: "online"|"offline" }` (dari `presenceView`/registry) |
| `protocol-mismatch` | 409 | `{ error, relay:"protocol-mismatch" }` |
| `too-large` | 413 | `{ error, relay:"too-large" }` |
| `busy` | 429 | `{ error, relay:"busy" }` |
| `protocol` | 502 | `{ error, relay:"protocol" }` |
| `timeout` | 504 | `{ error, relay:"timeout" }` — `sendCancel` sudah dilakukan `hub.ts:112` |

Audit (hub, `deviceId: "local"`, lajur `event`): `appendEvent({ kind: "relay.request", level: status ≥ 500 ? "error" : status ≥ 400 ? "warn" : "info", msg: "<METHOD> <path> → <status>", specId?, data: { deviceId, actor: { userId, email }, method, path, status, ms } })`. `specId` diisi bila path memuat `/specs/:id` atau body memuat `spec`. Audit ditulis **untuk setiap hasil**, termasuk 404/503/504 — dan itu satu-satunya tulisan state yang boleh terjadi di jalur galat (AC-B10).

Catatan yang mengikat: route ini **tak** menyentuh Prisma selain `deviceToken.findFirst` (baca) dan
`logEntry.create` (audit). Test AC-B10 membuktikannya dengan snapshot `count()` seluruh model non-log
sebelum/sesudah.

### T4. Kontrak — principal, `force`, dan gerbang satu sesi

**`launchPrincipal` (klien).**

```ts
type PrincipalSource = {
  user?: { id: string; email: string } | null;
  agent?: { id: string; capabilities: string[] } | null;
  remote?: { actor: RelayActor; capabilities: string[] } | null;   // = req.remote (gate A)
};
// urutan: user → remote → agent
// remote ber-`sessions:spawn` → `remote:<email>@<hubOrigin>`; tanpa itu → null (tak ada approval)
```

`req.remote` sudah dideklarasikan `services/relay/gate.ts:11`, jadi `launchPrincipal(req)` tetap
dipanggil dengan `req` yang sama di `routes/terminal.ts:99`.

**`force` (klien).** `routes/terminal.ts:88` diperluas: `if ((req.agent || req.remote) && parsed.data.force)`
→ 403, tetap **sebelum** `approveLaunch`. Alasannya bukan gaya: 403 sesudah approval meninggalkan
`launchApprovedBy` atas peluncuran yang ditolak (pelajaran ADR-0161 yang sudah tertulis di komentar
baris itu).

**Gerbang presence (hub) — `remoteSessionVerdict()` murni.**

```ts
type RemoteSessionVerdict =
  | { kind: "ok" }
  | { kind: "remote-session";   remote: { deviceId: string; name: string; sessionId: string } }
  | { kind: "confirm-required"; remote: { deviceId: string; name: string; sessionId: string | null; offline: true } };

remoteSessionVerdict(input: {
  specId: string;
  devices: PresenceDeviceView[];      // presenceView() — sudah memuat name, online, sessions
  recentlyOffline: { deviceId: string; name: string; specId: string; sessionId: string | null; at: number }[];
  lastResultDeviceId: { deviceId: string; name: string } | null;  // SessionResult.deviceId terakhir, Spec.stage ≠ done
  now: number;
}): RemoteSessionVerdict
```

Urutan penilaian (mengikat):
1. sesi `working|waiting` untuk `specId` di device `deviceId !== LOCAL_DEVICE_ID` → `remote-session`
   (device pertama menurut urutan `presenceView`, yang sudah `createdAt asc`);
2. entri `recentlyOffline` untuk `specId` ber-umur ≤ 24 jam → `confirm-required`;
3. `lastResultDeviceId` ≠ null dan device itu tak online → `confirm-required` (`sessionId: null`);
4. selain itu `ok`. **`ok` bukan izin** — pemanggil tetap menjalankan seluruh gerbang lain.

`recentlyOffline` hidup di `presence/registry.ts` sebagai peta memori (prinsip ADR-0148, tanpa baris
DB): diisi saat sebuah device punah — baik lewat `dropPresence()` (socket sync tutup) maupun lewat
sapuan ambang di `presenceEntries()` — dengan sesi `working|waiting` terakhirnya; entri kedaluwarsa
24 jam dibuang saat dibaca. Restart hub mengosongkannya; poin 3 adalah jaring untuk kasus itu.

**Penempatan di `startSpecSession`** (`session-launch.ts`, di dalam `withSessionAdmission`):
SESUDAH `const pane = await getSessionAsync(id)` dan cabang re-attach, SEBELUM gerbang dependency
`blockersForSpec` dan `killSession`. Alasan: pane hidup lokal = re-attach (AC-B4 di klien), dan
penolakan tak boleh meninggalkan efek.

```ts
// opts aditif: confirmRemote?: boolean — HANYA jalur manusia yang memasoknya, cermin `force`
if (!pane) {
  const v = remoteSessionVerdict({ … });
  if (v.kind === "remote-session") throw new LaunchError(msg, "remote-session", [], v.remote);
  if (v.kind === "confirm-required" && !opts.confirmRemote)
    throw new LaunchError(msg, "confirm-required", [], v.remote);
}
```

- `opts.force` **tidak** melewatkan gerbang ini: `force` milik gerbang dependency ADR-0093, dan `force`
  dari remote sudah 403 lebih dulu.
- Governor scheduler & denyut lead tak pernah mengirim `confirmRemote` → item itu dilewati apa adanya
  (`LaunchError` sudah jalur kegagalan yang mereka pahami).

`LaunchError` bertambah dua `kind` dan satu field opsional; `blockers` tetap di posisi ketiga agar
pemanggil lama tak berubah.

**Route mapping (hub, `routes/terminal.ts`):**

```
kind "remote-session"    → 409 { error: "remote-session",   remoteSession: { deviceId, name, sessionId } }
kind "confirm-required"  → 409 { error: "confirm-required", remoteSession: { deviceId, name, sessionId, offline: true } }
```

**`POST /specs/:id/done` (`routes/specs.ts:338`).** Sesudah cek pane lokal yang sudah ada
(`live && confirm !== true` → 409), ditambah lapis kedua dengan `remoteSessionVerdict` yang sama:
verdict ≠ `ok` dan `confirm !== true` → `409 { error: "confirm-required", session: { id: sessionId, deviceId, name } }`.
`by` = `req.user?.email ?? (req.remote ? \`remote:${req.remote.actor.email}@${req.remote.actor.hubOrigin}\` : "system")`.

### T5. Kontrak — retry spec-404 di dispatcher klien

`createRelayDispatcher` menerima opsi baru `syncOnce?: () => Promise<unknown>` (default `() => syncNow()`,
disuntik `relay/client.ts:77`). Di `handleReq`, sesudah `inject` pertama:

```
retry HANYA bila SEMUA benar:
  f.method === "POST" ∧ f.path === "/api/terminal/sessions" ∧ body memuat `spec`
  ∧ res.statusCode === 404 ∧ body JSON ber-`error === "spec not found"`
maka: await syncOnce() (galat ditelan) → inject KEDUA dengan argumen identik → respons kedua yang diteruskan
```

Tepat satu `syncOnce` dan tepat satu pengulangan per frame `req`; `entry.cancelled` dihormati sebelum
dan sesudah `syncOnce`. Audit `remote.request` dicatat untuk hasil **akhir** dengan `data.retried: true`;
percobaan pertama dicatat `level: "info"`, `data.attempt: 1` agar jejak 404-nya tak hilang.

### T6. Kontrak frontend

**`createApi({ base })` (`src/src/api/client.ts`).** Objek `api` (164 metode, `client.ts:190`) dipindah
utuh ke dalam `export function createApi(o: { base?: string } = {})`; `export const api = createApi()`
dipertahankan untuk 61 importir (koreksi S1 butir 13). Satu-satunya perubahan perilaku ada di **tiga**
tempat pemanggil `fetch` (`client.ts:156`, `:167`, `:330`), yang semuanya melewati:

```ts
const base = o.base ?? "/api";
const rebase = (u: string) => (u.startsWith("/api/") || u === "/api" ? base + u.slice(4) : u);
```

Diffnya besar tetapi mekanis (indentasi + tiga baris); test `instance.test.tsx` membuktikan rebase atas
sampel metode `j`, `jUpload`, dan `getAgentDoc` dengan `fetch` di-mock.

**`InstanceContext` (`src/src/api/instance.tsx`, baru).**

```ts
type Instance =
  | { kind: "local" }
  | { kind: "remote"; deviceId: string; name: string; version: string; protocol: number;
      capabilities: RemoteCapability[] };
useInstance(): Instance
useApi(): ReturnType<typeof createApi>        // memo per deviceId; local → `api`
useWsTarget(local: "events" | `terminal:${string}`): { url: string; ticketTarget: string }
// remote → { url: `/api/devices/${deviceId}/relay/…`, ticketTarget: `relay:${deviceId}:${local}` }
```

`useWsTarget` mendarat di B sebagai kontrak murni (diuji), konsumennya (`TerminalPane`) milik turunan C.
Tanpa provider, `useInstance()` = `{ kind: "local" }` — 61 importir lama tak berubah.

**`startTargets()` (`src/src/api/start-targets.ts`, baru; murni, diuji tabel).**

```ts
startTargets(view: PresenceView, handledBy: HandledByEntry[]):
  { deviceId: string; name: string; eligible: boolean; reason?: TargetReason }[]
type TargetReason = "offline" | "control-off" | "protocol-mismatch" | "no-spawn" | "capacity-full";
```

- urutan: "hub ini" (`LOCAL_DEVICE_ID`) lebih dulu, lalu device `handledBy` sesuai urutannya, lalu
  device lain;
- `eligible` = `online` ∧ `control?.state === "available"` ∧ `capabilities` memuat `sessions:spawn`
  ∧ kapasitas tak penuh; `reason` mengambil **kondisi pertama yang gagal** menurut urutan di atas;
- kapasitas penuh = `capacity` ada dan (`!enabled` ∨ `liveAgentCount >= maxConcurrent` ∨
  `loadStatus === "unavailable"` ∨ (`loadPerCore !== null` ∧ `loadPerCore > maxLoadPerCore`));
  `capacity === null` **bukan** alasan menolak (angka belum tiba ≠ penuh) — presence tak pernah
  meluluskan, tapi ia juga tak boleh mengarang kepenuhan;
- `online` datang apa adanya dari `presenceView` (ambang `PRESENCE_OFFLINE_MS` 90 dtk, AC-B8).

**`StartSessionModal` (`src/src/App.tsx:87`).**
- baris pemilih target di atas pemilih model; **default** = kandidat `handledBy` pertama yang
  `eligible`, selain itu "hub ini". Pemilihan default hanya mengubah state — tak ada `api.startSession`
  yang dipanggil saat dialog dibuka (AC-B7, diuji dengan hitungan pemanggilan `fetch`);
- target tak terpilih tetap dirender (disabled) beserta `reason` dalam bahasa manusia;
- target remote → `useApi()` remote; tombol **"Mulai tetap" (force) tak dirender** (permintaannya akan
  dijawab 403 oleh klien, jadi merendernya = menawarkan kegagalan);
- `409 error:"remote-session"` → aksi "Sambung ke sesi di `<name>`" (membuka sesi yang disebut
  `remoteSession.sessionId` di device itu), bukan tombol coba lagi;
- `409 error:"confirm-required"` → konfirmasi dua langkah; klik kedua mengirim ulang body yang sama
  ber-`confirmRemote: true`;
- `409` kapasitas/`blocked` yang sudah ada (`zLaunchRejection`, `App.tsx:210`) tak berubah bentuknya —
  cabang baru dibedakan dari `detail.error`, bukan dari status.

### T7. Penanganan galat (delta atas SPEC-1215 §S6)

| Kondisi | Perilaku | Jejak |
|---|---|---|
| Device tak ada / dicabut | `404 relay:"unknown-device"` | `relay.request` warn |
| Grant mati / klien lama / offline | `503 relay:"offline"` + `presence` | `relay.request` warn |
| Timeout 30/120 dtk | `504`; `cancel` terkirim; **efek yang sudah jalan tak dibatalkan** dan muncul di presence berikutnya | `relay.request` error |
| Respons > 1 MiB | klien menjawab `502 relay-response-too-large` (A); hub memetakan rakitan > 1 MiB → `413 relay:"too-large"` | `relay.request` warn |
| `force` dari remote | `403` sebelum `approveLaunch`; `launchApprovedBy` tak tersentuh | `remote.request` warn |
| Presence: sesi hidup di device lain | `409 remote-session` di hub, **tak ada** frame relay terkirim | `launch.rejected` (SPEC-1217) |
| Presence: device punah ≤ 24 jam | `409 confirm-required`; scheduler melewati item | idem |
| Spec belum ter-pull di klien | satu `syncOnce` → satu ulang; masih 404 → diteruskan apa adanya | `remote.request` |
| `syncOnce` melempar | galat ditelan, pengulangan tetap dijalankan sekali | `remote.request` |
| Dialog Start tanpa kandidat | default "hub ini"; peluncuran tetap butuh klik | — |

### T8. Acceptance criteria (EARS) — turunan B

Sama nomornya dengan SPEC-1215 §S9 (sumber kebenaran); yang ditambahkan di sini adalah **titik ukur**
yang membuat tiap AC bisa dicentang test.

- **AC-B1** — WHEN operator hub ber-cookie mengirim `POST /api/devices/:d/relay/terminal/sessions {spec}`
  ke device ber-grant `sessions:spawn`, THE klien SHALL menjalankan `POST /api/terminal/sessions` lewat
  `app.inject` dengan body yang sama, dan worktree SHALL lahir di mesin klien. *Ukur:* `inject` klien
  dispy → argumen identik; `startSpecSession` klien terpanggil; hub nol pemanggilan `startSpecSession`.
- **AC-B2** — THE test kontrak SHALL menjalankan start, steer, interrupt, jawab dialog, dan tandai
  selesai atas fixture identik lewat cookie lokal dan lewat relay, lalu membuktikan kolom `Spec`,
  berkas fase, id sesi, dan path worktree identik; satu-satunya beda `launchApprovedBy` dan
  `manualDone.by` (prefix `remote:`).
- **AC-B3** — IF request relay membawa `force: true`, THEN THE klien SHALL menjawab `403` dan
  `approveLaunch` SHALL tak terpanggil (spy) serta `Spec.launchApprovedBy` SHALL tetap `null`.
- **AC-B4** — WHEN klien sudah punya pane hidup untuk SPEC itu, THE start relay SHALL memulangkan id
  sesi yang sama dan jumlah pane SHALL tak bertambah.
- **AC-B5** — IF presence hub menunjukkan sesi `working|waiting` untuk SPEC X di device D, THEN setiap
  `startSpecSession` SPEC X di hub (manusia maupun scheduler) dan start relay ke device ≠ D SHALL
  ditolak `409 { error:"remote-session", remoteSession:{deviceId,name,sessionId} }`, dan **nol frame
  `req`** SHALL terkirim ke socket relay.
- **AC-B6** — IF device yang terakhir tercatat mengerjakan SPEC X sudah punah dari presence, THEN start
  dan `POST /specs/:id/done` di hub SHALL menjawab `409 confirm-required` dan SHALL berhasil hanya
  dengan `confirmRemote: true` / `confirm: true`; jalur scheduler SHALL tak pernah memasoknya.
- **AC-B7** — WHEN dialog Start dibuka untuk backlog yang project-nya ber-`handledBy`, THE dialog SHALL
  memilih default = device `handledBy` pertama yang online ∧ `sessions:spawn` ∧ kapasitas tak penuh
  (tanpa kandidat → "hub ini"), AND THE dialog SHALL tak memanggil satu pun endpoint start sebelum
  klik manusia.
- **AC-B8** — WHILE device offline, tanpa grant/`sessions:spawn`, berkapasitas penuh, atau berprotokol
  lain, THE dialog Start SHALL menampilkannya tak terpilih beserta alasan spesifiknya; status
  online/offline SHALL mengikuti `PRESENCE_OFFLINE_MS` (90 dtk).
- **AC-B9** — WHEN operator hub menekan steer/interrupt/jawab dialog/tandai selesai pada sesi klien,
  THE hub SHALL merutekannya ke route klien yang sama dan meneruskan status, `content-type`, dan body
  klien apa adanya (+ header `x-hanoman-device`).
- **AC-B10** — IF relay offline, timeout, atau respons melebihi 1 MiB, THEN THE hub SHALL menjawab
  `503`/`504`/`413` ber-`relay` kind, AND jumlah baris seluruh model non-log SHALL identik
  sebelum/sesudah, dengan tepat satu baris `relay.request` bertambah.
- **AC-B11** — IF klien menjawab `404 spec not found` untuk start relay, THEN THE klien SHALL memanggil
  `syncOnce` **tepat sekali** dan `app.inject` **tepat dua kali** sebelum meneruskan jawaban akhir.

### T9. Rencana verifikasi

Test (TDD, mengikuti §S10 SPEC-1215, path konkret):

- `server/test/devices-relay.route.test.ts` — tabel 404/415/503/409/413/429/502/504, header
  `x-hanoman-device`, timeout 120 dtk khusus `POST …/terminal/sessions`, audit `relay.request`,
  diff `count()` model non-log (AC-B1/B9/B10).
- `server/test/relay-contract.test.ts` — dua jalur (cookie lokal vs relay) atas fixture identik
  (AC-B2), termasuk `force` 403 (AC-B3) dan re-attach (AC-B4).
- `server/test/remote-session-gate.test.ts` — `remoteSessionVerdict` tabel murni + integrasi
  `startSpecSession`/`POST /specs/:id/done`, jalur scheduler, `confirmRemote`/`confirm`,
  `recentlyOffline` kedaluwarsa (AC-B5/B6).
- `server/test/relay-dispatcher.spec404.test.ts` — hitungan `syncOnce`/`inject` (AC-B11).
- `src/test/instance.test.tsx` — `createApi` rebase (tiga call-site `fetch`), `useApi`, `useWsTarget`.
- `src/test/start-session-target.test.tsx` — `startTargets` tabel + default + alasan + nol fetch saat
  dialog dibuka + force tak dirender + 409 `remote-session`/`confirm-required` (AC-B7/B8).

Resep run (mesin bersesi banyak, `CLAUDE.md` + SPEC-479):

```
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism <paths>
```

Smoke API nyata sekali di akhir Execute (dua `HANOMAN_HOME`, dua port, klien ber-`SYNC_SERVER_URL`):
`PUT /api/remote-control` → `POST /api/devices/:d/relay/terminal/sessions` → `…/steer` →
`POST /api/devices/:d/relay/specs/:id/done`, ditambah satu start ganda untuk membuktikan
`409 remote-session` nyata.

### T10. Docs yang tersentuh

- **Fase ini:** spec ini + entri indeks `internal/docs/README.md`.
- **Saat Execute (commit yang sama dengan kode):**
  - `internal/docs/architecture/api-contract.md` — cabut "Belum dilayani" untuk
    `/devices/:deviceId/relay/*` dan perubahan `POST /terminal/sessions` & `POST /specs/:id/done`
    (baris 1417–1418); tambahkan `devices` ke daftar top non-delegatable;
  - `internal/docs/frontend/frontend-implementation.md:47` — cabut frasa "SPEC-1216" dari penanda
    DIRANCANG (bagian SPEC-1218 tetap);
  - `internal/docs/adr/0165-*.md` §6/§8/§9 + `adr/README.md` + amandemen ADR-0117/0120/0135/0147/0148/0161
    — ubah "menyusul SPEC-1216" menjadi "mendarat";
  - `internal/docs/security/threat-model.md:150` — turunan B masuk daftar yang sudah mendarat;
  - `internal/docs/architecture/stack.md` — diagram/penanda turunan.

### T11. Batas & residu (mewarisi §S12, tanpa tambahan baru)

Jendela balapan ≤ 3 dtk antar-start lintas device; start langsung di klien Y untuk SPEC yang hidup di
klien X tak tercegah; aktor di klien adalah klaim hub; timeout relay tak membatalkan efek yang sudah
terjadi. `recentlyOffline` hilang saat hub restart — jaringnya `SessionResult.deviceId` terakhir, dan
itu memang hanya mengusulkan konfirmasi, tak pernah meluluskan.
