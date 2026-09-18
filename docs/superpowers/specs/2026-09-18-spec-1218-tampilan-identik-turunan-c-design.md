# SPEC-1218 — Tampilan identik: mirror terminal/fase/dokumen/IDE klien di hub lewat stream relay dengan backpressure

**Tanggal:** 2026-09-18 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `ba53e304` (rilis sesudah SPEC-1215 turunan A, SPEC-1216 turunan B, dan SPEC-1217 turunan D
semuanya merge ke `main`; sesi ini fast-forward merge `main` sebelum mulai karena `HANOMAN_BASE_SHA`
lama, `61bc006c`, mendahului merge B/D)
**Fase penulis bagian ini:** Brainstorm (1/5)
**Design-of-record (terkunci, tidak diulang di sini):**
[spec SPEC-1215 §K7–K8, §S0a/S0b, §S4.1–S4.2, §S4.5–S4.6, §S4.11, §S9 (AC-C1…AC-C10), §S10](2026-09-14-spec-1215-hub-orkestrasi-klien-design.md) ·
[ADR-0165 §1/§2/§9/§10](../../../internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md)

## Konteks & keputusan

### Ini adalah turunan C dari payung SPEC-1215, bukan desain baru

SPEC-1215 sudah melewati fase Spec penuh dan menetapkan arsitektur, kontrak, dan 45 AC (EARS) untuk
seluruh payung "hub mengorkestrasi klien" (A fondasi kanal · B orkestrasi · C tampilan identik · D log
terpusat). Fase Plan SPEC-1215 (§S13) memfilekan C sebagai backlog terpisah **SPEC-1218**, ber-`dependsOn`
`[SPEC-1215, SPEC-1216]`. Backlog ini ADALAH turunan C. Kontraknya (frame stream, kredit, resync,
geometry, plafon, principal `remote` di `/events/ws`, kontrak frontend `InstanceContext` remote) sudah
dikunci di fase Spec SPEC-1215 — brainstorm ini **tidak mendesain ulang**. Ia merujuk, mengonfirmasi
turunan A dan B benar sudah merge, memetakan kontrak yang terkunci ke keadaan kode saat ini, dan mencatat
apa yang benar-benar tersisa untuk dikerjakan turunan C. Setiap perubahan atas keputusan yang sudah
dikunci (K1–K12 SPEC-1215, §1–§10 ADR-0165) hanya sah lewat amandemen ADR-0165, bukan lewat spec/plan
SPEC-1218.

### Verifikasi: turunan A dan B benar sudah merge ke base ini

`docs/superpowers/plans/` memuat plan bercentang penuh untuk turunan A
(`2026-09-15-spec-1215-a-fondasi-kanal-relay.md`) dan turunan B
(`2026-09-18-spec-1216-orkestrasi-hub-relay-plan.md`). `git log` menunjukkan commit turunan B
(`0dd46986` brainstorm … `1ae7c275` AC-B1 top `devices` COOKIE_ONLY) dan turunan D
(`fd7ea4db` … `20e44245`, ditutup `ba53e304` "cabut penanda DIRANCANG bagian D" dan `053d22b8` merge ke
`main`) sudah menjadi leluhur `HEAD`. `internal/docs/frontend/frontend-implementation.md:45-52`
mengonfirmasi eksplisit di prosa: *"Kendali & tampilan klien dari hub — turunan A + B + D mendarat …
tampilan identik — stream, resize, backpressure §S10 — tetap DIRANCANG untuk SPEC-1218 (turunan C)."*

Diperiksa langsung di kode (bukan diasumsikan dari commit message):

| Kontrak A/B (SPEC-1215 §S8) | Bukti di kode saat ini |
|---|---|
| `createApi({base})` + `InstanceContext` | `src/src/api/client.ts` (`createApi`), `src/src/api/instance.tsx` (`InstanceProvider`, `useInstance`, `useApi`, `useWsTarget`) — **sudah lengkap**, termasuk `useWsTarget` yang sudah memulangkan `ticketTarget: relay:<deviceId>:events\|terminal:<id>` persis bentuk S4.4 |
| Route HTTP `/api/devices/:deviceId/relay/*` | `server/src/routes/devices-relay.ts` — hanya `handler` (HTTP), **komentar di berkas eksplisit**: `requestRelay()`/`RelayError` sudah dipetakan ke 503/409/413/429/502/504 |
| `launchPrincipal` remote + `force` 403 | `server/src/services/launch-authority.ts:8-15` — cabang `remote` sudah ada dan mengembalikan `remote:<email>@<hubOrigin>` |
| Gerbang `remote-session`/`confirm-required` | `server/src/routes/specs.ts`, `startSpecSession` — sudah membaca presence lintas instance (turunan B) |
| `RemoteControlPanel` + tiga toggle lajur log | `src/src/screens/RemoteControlPanel.tsx` — mendarat turunan A+D |
| `ClientsScreen` target picker | `src/src/screens/ClientsScreen.tsx` — sudah ada (turunan B), **belum** ada tombol "Buka" ke `RemoteInstanceView` (itu C) |
| `POST /api/ws-tickets` | `server/src/routes/ws-tickets.ts` — `targetSchema` hanya menerima `"events"` atau `terminal:<id>` **lokal**; **tak ada** cabang `relay:<deviceId>:…` |
| `admitBrowserWs`/`WsPrincipal` | `server/src/services/ws-admission.ts:14` — `WsPrincipal.kind` = `"user" \| "agent" \| "device" \| "test"`, **belum ada `"remote"`** |
| `events.ts` grup langganan | `GROUPS` (baris 52) tak punya cabang filter per-principal `remote`; `attach()` tak menerima parameter grup |

Kesimpulan: **fondasi kanal, orkestrasi HTTP, dan kontrak frontend `InstanceContext`/`useWsTarget` sudah
berdiri dan teruji.** Yang belum ada — dan itulah isi turunan C — adalah **jalur WS** di atas fondasi itu:
`wsHandler` di route relay hub, tiket `relay:<deviceId>:events|terminal:<id>`, principal `remote` di
gate WS hub, dispatcher klien yang menjalankan `open`/stream (hari ini menjawab setiap `open` dengan
`close 4502` — placeholder eksplisit dari turunan A, komentar `// opened/geometry/data/close = stream,
milik SPEC-1218` di `relay/hub.ts:88` dan `relay/dispatcher.ts:134`), kredit/resync/geometry/plafon
stream, grup terbatas `/events/ws` untuk `remote`, komponen frontend `RemoteInstanceView`/`RemoteBanner`
yang memakai `InstanceContext` remote, dan pengukuran CPU/RSS/`bufferedAmount` di Mac mini 8 GB.

### Pemetaan AC-C1…AC-C10 (SPEC-1215 §S9) ke keadaan kode — apa yang masih kosong

Diperiksa satu per satu di kode (bukan diasumsikan):

1. **AC-C1 (K7, layar identik + banner).** Tak ada `RemoteInstanceView`/`RemoteBanner` di
   `src/src` (`find … -iname "*Remote*"` hanya memulangkan `RemoteControlPanel.tsx`). `TerminalPane`,
   `SpecDocsModal`, dan panel IDE baca-saja tak punya jejak `useInstance`/`InstanceContext`/`useWsTarget`
   (`grep` kosong) — mereka masih memakai `api` singleton langsung. Pekerjaan murni-baru turunan C:
   memasang `useApi()`/`useWsTarget()` di komponen yang **sudah ada** (nol salinan UI, sesuai K7), plus
   dua komponen baru (`RemoteInstanceView`, `RemoteBanner`) dan tombol "Buka" di `ClientsScreen`.
2. **AC-C2/AC-C3 (resize dibuang, mode baca-saja).** `TerminalPane.tsx` hari ini mengirim `resize` tanpa
   syarat instance (belum tahu tentang mode remote). Dispatcher klien (`relay/dispatcher.ts`) belum
   punya cabang `data`/`in` untuk stream — seluruh percabangan buang-`resize`/buang-`in`-saat-`read`
   adalah kode baru di jalur `open` yang saat ini belum diimplementasikan (lihat poin 4).
3. **AC-C4/AC-C5/AC-C6 (kredit, plafon 6 stream/4 inflight, tutup ≤2 dtk tanpa penonton).**
   `relay/hub.ts` **belum** punya struktur `streams`/`credit`/`inflight` per device — hanya komentar
   penanda baris 88. Konstanta pendukungnya (`RELAY_MAX_STREAMS`, `RELAY_CREDIT_INITIAL`,
   `RELAY_CREDIT_REFILL_BELOW`, `RELAY_SOCKET_MAX_BUFFERED`, `RELAY_RESYNC_MIN_MS`,
   `RELAY_IDLE_STREAM_CLOSE_MS`) sudah didefinisikan `shared/src/relay.ts` sejak turunan A (dipakai
   S4.1) — tinggal dikonsumsi.
4. **AC-C7 (tolak `protocol` tak cocok, peringatkan `version` beda).** `PresenceDeviceView.control.state`
   sudah punya varian `"protocol-mismatch"` (turunan A, `AC-A9`, disetel dari `hello` di socket relay
   Bearer) — tapi itu untuk socket **relay** device, bukan untuk keputusan hub **membuka tampilan**.
   Turunan C perlu membaca `control.protocol`/`control.version` di `RemoteInstanceView` sebelum
   merender, sesuai S4.11.
5. **AC-C8 (listener `injectWS` lewat `onOpen`).** Ini **sudah dipraktikkan** turunan A di jalur `req`
   (spike S0a, koreksi S1 poin 5) — tapi jalur `open`/stream turunan C adalah pemanggilan `injectWS`
   **baru**, yang wajib mengulang pola `onOpen` yang sama persis (bukan sekali pasang, dua jalur kode).
   Test regresi 0/2 → 2/2 dari S0a harus direplikasi untuk jalur stream ini secara terpisah.
6. **AC-C9 (grup `/events/ws` terbatas untuk `remote`).** `events.ts` `attach()` (baris 261) menerima
   `{ maySubscribe? }` saja — **tak ada** parameter grup/principal untuk membatasi `sessions`,
   `leadAsks`, `cleanups`, topik `git`. `ws-admission.ts` juga belum tahu principal `"remote"`
   (poin 8 di bawah), jadi `canSubscribeTopic(principal, topic)` yang disebut S3 komponen belum berupa
   fungsi yang menilai kasus itu.
7. **AC-C10 (pengukuran 8 GB).** Belum ada skrip pengukuran untuk turunan C — pola preseden sudah ada
   di turunan D (`server/test/…` skrip ingest sintetis AC-S9, commit `20e44245`) sebagai contoh bentuk
   "skrip + hasil dicatat" yang harus ditiru untuk resep S0b (4 stream, RTT 200 ms, 10 menit,
   `process.cpuUsage()`/`memoryUsage().rss`/`bufferedAmount` per detik).
8. **Prasyarat lintas-AC: `wsHandler` route relay + tiket + principal `remote`.**
   - `POST /api/ws-tickets`: `targetSchema` (`ws-tickets.ts:6`) hanya menerima `"events"` atau
     `terminal:<id>` **lokal**; perlu cabang `relay:<deviceId>:events|terminal:<id>` — hanya `req.user`
     (S4.4: *"hanya `req.user` (agent → 403 lewat default cookie-only; test principal di
     `NODE_ENV=test`)"*).
   - `ws-admission.ts` `WsPrincipal.kind`: perlu tambah `"remote"`, dipakai `admitBrowserWs` cabang
     baru dan `revalidateWsPrincipal`.
   - `devices-relay.ts`: route sudah `app.route({...})` — S4.4 minta ia jadi "satu route `GET` ber-
     `handler` + `wsHandler`, didukung plugin `@fastify/websocket`" (S1 poin 12). Ini perubahan pada
     route yang **sudah ada**, bukan route kedua.
   - `relay/dispatcher.ts` klien: jalur `open` (baris 134) perlu diganti dari placeholder `close 4502`
     menjadi `app.injectWS(path, {headers}, {onOpen})` sungguhan dengan kredit/potongan/buang-frame.

Tidak ada temuan yang bertentangan dengan kontrak SPEC-1215/ADR-0165 — keadaan kode persis seperti yang
diantisipasi §S8 ("A dan B dieksekusi; C menyusul jalur WS/stream + frontend mirror + pengukuran").

### Keputusan yang dikunci dan dikonfirmasi berlaku apa adanya (rujukan, bukan re-desain)

- **Frame socket relay stream** (`open`/`opened`/`data`/`credit`/`geometry`/`close`, batas
  `≤32 KiB`/potongan, rakitan `≤1 MiB`) dan **kode tutup** (`4004`/`4009`/`4401`/`4403`/`4409`/`4502`
  untuk stream, `1008`/`1009`/`4000`/`4001`/`4003`/`1001` untuk socket relay) — SPEC-1215 §S4.2.
- **Route hub `GET|POST|… /api/devices/:deviceId/relay/*`** kini juga `wsHandler`, dan
  **`POST /api/ws-tickets`** menerima target `relay:<deviceId>:events|terminal:<id>` khusus `req.user`
  — SPEC-1215 §S4.4.
- **Dispatcher `open`**: allowlist + grant sama seperti `req`; kredit → `data` terpotong; buang `resize`
  selalu; buang `in`/`diag` saat `mode:"read"`; `geometry` dikirim dari `list-panes` yang sudah dipoll;
  audit `remote.stream` per `open` — SPEC-1215 §S4.5.
- **Kontrak frontend S4.11**: `TerminalPane` mode remote (URL/tiket dari `useWsTarget`, tak pernah
  `resize`, `geometry` → `term.resize`, tanpa `sessions:write` → `onData` tak dikirim + penanda
  baca-saja, close `4009` ditangani `retry()` yang sudah ada); `SpecDocsModal`/panel IDE baca pakai
  `useApi()` tanpa render aksi tulis; `ClientsScreen` tombol **Buka** → `RemoteInstanceView` (tab
  Terminal/Dokumen/IDE) + `RemoteBanner` "Sedang melihat klien X · vN" + peringatan versi + penanda
  baca-saja.
- **Backpressure K8/§10 ADR-0165**: stream on-demand (hidup hanya selama penonton), kredit byte per
  stream (awal 256 KiB, isi ulang saat `bufferedAmount` browser < 64 KiB), terminal **membuang**
  keluaran saat kredit habis lalu resync `4009` ≤1×/5 dtk, events menyimpan snapshot **terbaru** per
  grup/kunci, plafon 6 stream / 4 inflight / frame ≤32 KiB / `bufferedAmount` relay ≤1 MiB / 12.000
  frame/menit — **angka awal, bukan kalibrasi**; boleh diamandemen ADR-0165 berdasar hasil pengukuran
  S0b/AC-C10, tak boleh diam-diam.
- **Principal `remote` pada `/events/ws`**: hanya grup `sessions`, `leadAsks`, `cleanups`, topik `git`
  (butuh `ide:read`); grup `cookieOnly` tak pernah terkirim — SPEC-1215 §S4.6, ADR-0165 §6.
- **Di luar lingkup C** (mewarisi "Di luar lingkup" SPEC-1215 + batas turunan): shipper/spool/ingest/
  pencarian log (D, sudah mendarat); auto-dispatch scheduler/lead ke klien; mirror seluruh dashboard di
  luar Terminal/fase/dokumen/IDE baca; RBAC per user; unggahan lampiran, unduhan review, aksi IDE tulis
  (tetap di luar seluruh payung, ADR-0165 §Plafon).

### Constraint tambahan brief ini yang selaras dengan yang sudah dikunci

Brief menegaskan seluruh permukaan yang harus ada di layar mirror (`TerminalPane` baca selalu/tulis
dengan `sessions:write`/tak pernah `resize`/menerapkan frame `geometry`, chip fase, `SpecDocsModal`,
panel IDE baca-saja, banner + penanda baca-saja + penolakan protocol mismatch) — ini **persis** AC-C1,
AC-C2, AC-C3, AC-C7, tanpa tambahan cakupan. Belakangnya (`wsHandler` relay + tiket, dispatcher stream
lewat `injectWS({onOpen})` dengan pemotongan ≤32 KiB, kredit per stream, resync 4009 ≤1×/5 dtk, events
snapshot terbaru per grup, plafon 6/4/4409, tutup ≤2 dtk tanpa penonton, principal remote di
`admitBrowserWs`, audit `remote.stream`/`relay.stream`, pengukuran Mac mini 8 GB via amandemen ADR-0165)
— ini persis AC-C4…AC-C10 plus prasyarat WS di atas. Tidak ada elemen brief yang menambah keputusan di
luar S4.1–S4.11/S9/S10 yang sudah dikunci; brief adalah ringkasan operasional atas kontrak yang sama,
bukan spesifikasi baru.

### Dependensi backlog

Backlog SPEC-1218 di DB memuat `dependsOn: [SPEC-1215, SPEC-1216]`. Keduanya sudah `done`/ter-merge ke
`main` (diverifikasi §Verifikasi di atas: plan A dan B bercentang penuh, commit turunan D juga sudah
merge lebih dulu meski tak jadi dependency formal), sehingga gerbang dependency (ADR-0093) tidak menahan
peluncuran sesi ini. Tidak ada dependensi lain yang belum terpenuhi.

### Tidak ada keputusan terbuka yang butuh input manusia di fase ini

Seluruh keputusan bentuk (frame stream, kredit/plafon, kode tutup, kontrak frontend `InstanceContext`
remote, grup langganan `remote` di `/events/ws`, resep pengukuran 8 GB) sudah dikunci di fase Spec
SPEC-1215 dan dikonfirmasi berlaku tanpa kontradiksi terhadap keadaan kode saat ini. Satu-satunya angka
yang secara eksplisit "belum final" adalah plafon backpressure (S4.1) — tapi jalan keluarnya juga sudah
dikunci: ukur di Mac mini 8 GB (S0b/AC-C10), amandemen ADR-0165 bila anggaran dilanggar. Itu bukan
keputusan desain terbuka, melainkan langkah verifikasi wajib yang sudah punya kriteria lulus/gagal
tertulis. Fase Objective berikutnya menurunkan kriteria sukses terukur dari AC-C1…AC-C10 di atas; fase
Spec berikutnya (bila perlu koreksi kecil sekelas S1 SPEC-1215) mencatatnya sebagai koreksi, bukan
desain baru.

## Objective

**Fase penulis bagian ini:** Objective (2/5)

### Objective (tunggal, terukur)

Menutup seluruh titik kosong kode yang dipetakan di fase Brainstorm — `wsHandler` di route relay hub,
tiket `relay:<deviceId>:events|terminal:<id>`, principal `remote` di gate WS hub, dispatcher stream
`open`/`opened`/`data`/`credit`/`geometry`/`close` lewat `injectWS({onOpen})`, grup `/events/ws`
terbatas untuk `remote`, komponen frontend `RemoteInstanceView`/`RemoteBanner` memakai `InstanceContext`
remote di komponen yang **sudah ada** (`TerminalPane`, `SpecDocsModal`, panel IDE baca), dan pengukuran
CPU/RSS/`bufferedAmount` di Mac mini 8 GB — sehingga **AC-C1…AC-C10 (SPEC-1215 §S9) lulus sebagai test
kontrak/otomatis yang dapat dijalankan ulang**, bukan diverifikasi manual/anekdot, dan `internal/docs`
yang tersentuh (termasuk pencabutan penanda DIRANCANG di
`internal/docs/frontend/frontend-implementation.md:52`) diperbarui dalam commit yang sama dengan kode.

Objective ini tidak menambah cakupan di luar AC-C1…C10 yang sudah dikunci SPEC-1215 §S9 — ia hanya
menurunkannya menjadi kriteria yang bisa dicentang test, sesuai batas turunan C yang dikonfirmasi di
bagian Konteks & keputusan di atas (satu-satunya angka "belum final" — plafon backpressure S4.1 —
punya jalan keluar tertulis: ukur di Mac mini 8 GB per S0b/AC-C10, amandemen ADR-0165 bila anggaran
dilanggar; itu bukan cakupan tambahan, melainkan bagian dari AC-C10 itu sendiri).

### Kriteria sukses (satu baris = satu AC, dapat dicentang oleh test)

| # | AC | Kriteria sukses terukur |
|---|---|---|
| SC1 | AC-C1 | Test frontend: membuka klien X (`ClientsScreen` → tombol "Buka") merender `RemoteInstanceView` yang me-mount `TerminalPane`, chip fase, `SpecDocsModal`, dan panel IDE baca-saja **dari berkas sumber yang sama** dipakai layar lokal (diuji lewat import path/identity komponen, bukan salinan), semuanya di dalam `InstanceContext` remote (`useInstance().kind === "remote"`), disertai `RemoteBanner` bertuliskan "Sedang melihat klien X · vN". |
| SC2 | AC-C2 | Test: `TerminalPane` dalam mode remote **tak pernah** mengirim frame `resize` (spy pada pengiriman socket, disimulasikan resize kontainer); dispatcher klien (`relay/dispatcher.ts`) membuang **setiap** frame `resize` masuk dari hub pada jalur `open`, untuk mode `read` maupun `write`. |
| SC3 | AC-C3 | Test: stream dibuka tanpa grant `sessions:write` → dispatcher klien membuang setiap frame `in` (dibuktikan: keystroke terkirim dari hub tak pernah sampai ke pty klien), dan `TerminalPane` merender penanda baca-saja (dicek lewat snapshot/`getByText` atau atribut ARIA). |
| SC4 | AC-C4 | Test: kredit stream terminal disetel habis (0) → keluaran pty berikutnya **dibuang** (tak pernah dibuffer, dicek: setelah kredit pulih tak ada replay backlog), dan `credit` refill memicu resync **paling banyak** 1× per jendela 5 dtk (dua refill berurutan < 5 dtk → resync kedua ditekan, dibuktikan hitungan frame `data`/`geometry` terkirim). |
| SC5 | AC-C5 | Test: membuka stream ke-7 pada device yang sudah punya 6 stream aktif ditutup **`4409`**; permintaan ke-5 saat sudah ada 4 request inflight ditolak/ditunda (plafon 4 inflight per device); setiap frame relay yang dikirim `> 32 KiB` (`RELAY_PART_MAX_BYTES`) dipotong sebelum kirim (dicek ukuran tiap frame `data`/`res` di socket relay). |
| SC6 | AC-C6 | Test: penonton terakhir sebuah stream terputus (komponen unmount / tab ditutup) → `injectWS` milik stream itu ditutup dalam **≤ 2 dtk** (fake timers, dicek pemanggilan `close`/`destroy` pada objek `injectWS` yang dipasang `onOpen`). |
| SC7 | AC-C7 | Test: `control.protocol` device tak cocok dengan hub → hub menolak membuka tampilan (respons/gate eksplisit, bukan render kosong); `control.protocol` cocok tapi `control.version` beda → `RemoteBanner` merender peringatan versi, tampilan tetap terbuka. |
| SC8 | AC-C8 | Test regresi jalur stream baru: frame yang dikirim route secara **sinkron** saat attach (scrollback, `alt`, `phase`) sampai ke hub — direplikasi sebagai kasus terpisah dari S0a (0/2 → 2/2), membuktikan listener `injectWS` jalur `open` dipasang lewat `onOpen`, bukan sesudahnya. |
| SC9 | AC-C9 | Test: principal `remote` yang subscribe `/events/ws` hanya menerima payload grup `sessions`, `leadAsks`, `cleanups`, dan topik `git` (hanya bila grant memuat `ide:read`, dibuktikan dengan dan tanpa grant itu); grup `cookieOnly` **tak pernah** terkirim ke principal `remote` (dicek: nol frame grup itu di seluruh transkrip test). |
| SC10 | AC-C10 | Skrip pengukuran (pola `server/test/…` AC-S9 SPEC-1217) menjalankan 4 stream terminal dari agen sibuk dengan RTT 200 ms selama durasi tetap di Mac mini 8 GB, mencatat `process.cpuUsage()`/`memoryUsage().rss`/`bufferedAmount` per detik per stream; hasil dan kelulusan/pelanggaran anggaran S0b dicatat sebagai amandemen ADR-0165 §9/§10 (bukan asersi tanpa angka). |
| SC11 | Constraint brief | `internal/docs` yang tersentuh diperbarui dan ditautkan di `internal/docs/README.md`; penanda DIRANCANG di `internal/docs/frontend/frontend-implementation.md:52` ("tampilan identik … tetap DIRANCANG untuk SPEC-1218 (turunan C)") dicabut — **dalam commit yang sama** dengan kode fase Execute. |

### Cara verifikasi (ringkas, bukan rencana — didetailkan di fase Plan)

Seluruh SC di atas diverifikasi lewat **test otomatis** (`pnpm vitest --run` pada berkas yang tersentuh,
`--no-file-parallelism` untuk set yang menyentuh test server per `CLAUDE.md`) plus satu **smoke manual**
di akhir Execute: boot dua instance lokal (hub + klien), buka klien dari hub via `RemoteInstanceView`,
dan buktikan nyata TerminalPane menerima output live, buang `resize`, dan banner protocol-mismatch —
bukan hanya lulus mock. SC10 (pengukuran 8 GB) diverifikasi lewat skrip yang benar-benar dijalankan di
mesin nyata dan hasilnya dicatat, bukan diklaim. Tak ada SC yang dianggap terpenuhi oleh klaim tanpa
bukti test/pengukuran yang benar-benar dijalankan.
