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
