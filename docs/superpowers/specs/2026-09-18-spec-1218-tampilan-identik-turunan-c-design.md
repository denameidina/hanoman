# SPEC-1218 — Tampilan identik: mirror terminal/fase/dokumen/IDE klien di hub lewat stream relay dengan backpressure

**Tanggal:** 2026-09-18 · **Flow:** feature · **Prioritas:** sedang · **Sumber:** brief
**Base:** `ba53e304` (rilis sesudah SPEC-1215 turunan A, SPEC-1216 turunan B, dan SPEC-1217 turunan D
semuanya merge ke `main`; sesi ini fast-forward merge `main` sebelum mulai karena `HANOMAN_BASE_SHA`
lama, `61bc006c`, mendahului merge B/D)
**Fase penulis bagian ini:** Spec (3/5)
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

## Spec teknis (fase Spec 3/5)

**Fase penulis bagian ini:** Spec (3/5)

> Bagian ini **tidak mengunci kontrak baru**. Frame stream, kredit, kode tutup, kontrak frontend
> `InstanceContext` remote, grup `/events/ws` untuk `remote`, dan resep pengukuran 8 GB sudah dikunci
> spec SPEC-1215 §S4.1–§S4.2/§S4.5–§S4.6/§S4.11/§S9/§S10 dan ADR-0165 §2/§6/§9/§10. Yang dikunci di sini
> adalah **cara mendaratkannya di kode yang benar-benar ada di base `ba53e304`**: berkas, tanda tangan
> fungsi, urutan gerbang, dan bentuk test — diverifikasi baris demi baris terhadap kode saat ini
> (`devices-relay.ts`, `ws-tickets.ts`, `ws-admission.ts`, `relay/dispatcher.ts`, `relay/hub.ts`,
> `relay/gate.ts`, `relay/client.ts`, `services/events.ts`, `services/pty.ts`, `api/instance.tsx`,
> `TerminalPane.tsx`). Setiap angka/kosakata yang berselisih dengan SPEC-1215/ADR-0165 adalah salah tulis
> di sini, bukan keputusan baru — koreksinya lewat amandemen ADR-0165.

### T1. Arsitektur turunan C di atas fondasi A+B

```
Browser hub ──cookie+tiket──▶ HUB Fastify
  ClientsScreen tombol "Buka"              routes/devices-relay.ts
    → RemoteInstanceView (InstanceProvider   ├─ handler HTTP (B, apa adanya)
      kind:"remote")                          └─ wsHandler (BARU) — upgrade browser,
  TerminalPane/SpecDocsModal/panel IDE            kirim `open` ke link relay device,
    baca useApi()/useWsTarget() (A/B, BARU dipakai) jembatani opened/data/credit/geometry/close
  RemoteBanner (BARU)                       routes/ws-tickets.ts + cabang `relay:<deviceId>:…` (BARU)
                                             services/ws-admission.ts + WsPrincipal "remote" (BARU)
                                             services/relay/hub.ts + peta stream per device (BARU)
                         WS Bearer /api/sync/relay/ws (A)
KLIEN Fastify
  services/relay/dispatcher.ts
    onMessage `open`  → gate (mirror admitRemoteRequest) → app.injectWS(path,{headers},{onOpen}) (BARU)
    onMessage `credit`/`close` → kredit & penutupan stream (BARU)
    onOpen    → forward opened/data/geometry/close ke hub, buang resize selalu, buang in/diag mode read
  services/pty.ts + `paneGeometry(id)` dari `list-panes` (kolom FMT baru, BARU)
  services/events.ts attach() + parameter grup (BARU, dipakai gate `remote` /events/ws)
```

Tiga invarian yang menyandera bentuk di atas (mengikat, bukan gaya):

1. **Stream tak punya katalog operasi kedua** — persis prinsip `req`/`res` A/B. `open` menunjuk path
   route WS yang **sudah ada** (`/api/terminal/sessions/:id/ws`, `/api/events/ws`); dispatcher menjalankannya
   lewat `injectWS`, bukan menulis handler pty/events kedua.
2. **Kredit dan plafon hidup di hub** (K8/§10): hub-lah yang tahu `bufferedAmount` socket **browser**,
   sinyal yang menentukan kapan boleh mengirim `credit` ke klien. Klien hanya patuh pada kredit yang
   diterimanya — ia tak menghitung `bufferedAmount` browser sendiri.
3. **`resize` dari hub tak pernah mencapai pty** — dua lapis: `TerminalPane` mode remote tak pernah
   mengirimnya (frontend), dan dispatcher membuangnya bila tetap datang (backstop server, defense in
   depth — bukan duplikasi keputusan).

### T2. Komponen (berkas yang lahir/berubah di turunan C)

| Berkas | Perubahan | AC |
|---|---|---|
| `shared/src/relay.ts` | **tak berubah** — `RELAY_MAX_STREAMS`/`RELAY_CREDIT_*`/`RELAY_SOCKET_MAX_BUFFERED`/`RELAY_RESYNC_MIN_MS`/`RELAY_IDLE_STREAM_CLOSE_MS`/`zHubToClientFrame`(`open`/`data`/`credit`/`close`)/`zClientToHubFrame`(`opened`/`geometry`/`data`) sudah lengkap sejak A; hanya **dikonsumsi** | — |
| `server/src/routes/ws-tickets.ts` | `targetSchema` bertambah cabang `relay:<deviceId>:events` \| `relay:<deviceId>:terminal:<id>`; hanya `req.user` (agent → 403 default; `allowTestPrincipal` tetap) | prasyarat C1–C9 |
| `server/src/services/ws-admission.ts` | `WsTarget` bertambah `` `relay:${string}:${"events" | `terminal:${string}`}` ``; `WsPrincipal.kind` bertambah `"remote"`; `admitBrowserWs` menerima target itu dan memulangkan `{kind:"remote", id: deviceId}`; `revalidateWsPrincipal` cabang `remote` = `relayControlFor(deviceId) !== null` | prasyarat C1–C9 |
| `server/src/routes/devices-relay.ts` | route yang sama bertambah `wsHandler`; membuka stream di `relay/hub.ts`, menutup `≤ 2 dtk` tanpa penonton | C1, C5, C6 |
| `server/src/services/relay/hub.ts` | peta `streams: Map<sid, StreamState>` per `Link`; `openStream`/`sendCredit`/`forwardToBrowser`/`closeStream`; plafon 6/4/12000-per-menit; resync `4009` ≤1×/5 dtk | C4, C5, C6, C9 |
| `server/src/services/relay/dispatcher.ts` | jalur `open` (baris 134) diganti: gate allowlist+capability (mirror `admitRemoteRequest`) → `app.injectWS` ber-`onOpen` → forward `data`/`opened`/`close`; buang `resize` selalu; buang `in`/`diag` bila `mode:"read"`; kredit lokal (berhenti kirim saat kredit 0, resume saat `credit` datang) | C2, C3, C4, C8 |
| `server/src/services/pty.ts` | `FMT` bertambah `#{pane_width}`/`#{pane_height}` di UJUNG (pola SPEC-919/ADR-0164); `paneGeometry(id): {cols,rows} \| null` murni dari `listPanes()` | C2 (geometry) |
| `server/src/services/events.ts` | `attach(c, { maySubscribe?, groups? })`: parameter `groups` (bila diisi) membatasi `GROUPS` yang dikirim SEGERA maupun di-`broadcast`, terlepas dari `cookieOnly` | C9 |
| `server/src/routes/events.ts` | principal `remote` dari `admitBrowserWs` → `attach(client, { maySubscribe: false, groups: remoteEventGroups(principal) })` | C9 |
| `src/src/screens/TerminalPane.tsx` | `mode?: "local" \| "remote"`; remote: `useApi()`/`useWsTarget()` untuk tiket+URL, **tak pernah** kirim `resize` (dua efek yang memanggilnya dipagari `mode !== "remote"`), `geometry` masuk → `term.resize(cols,rows)` + `fit` dilewati, tanpa `sessions:write` → `onData`/`sendInput` tak mengirim + `showKeys` disembunyikan, close `4009` → `retry()` yang sudah ada | C1, C2, C3, C7 |
| `src/src/screens/SpecDocsModal.tsx` | `useApi()` menggantikan import `api` langsung; tak ada aksi tulis dirender saat `useInstance().kind === "remote"` | C1 |
| `src/src/screens/IdeReadPanel.tsx` (baru, subset baca `IdeScreen.tsx`) | `useApi()` untuk `tree`/`file`/`workingStatus`/`fileDiff`/`graph`/`compare`; tak ada tombol tulis/commit | C1 |
| `src/src/screens/RemoteInstanceView.tsx` (baru) | `InstanceProvider` + tab Terminal/Dokumen/IDE + `RemoteBanner`; gerbang `control.protocol` sebelum render | C1, C7 |
| `src/src/screens/RemoteBanner.tsx` (baru) | "Sedang melihat klien X · vN" + penanda baca-saja + peringatan versi beda | C1, C7 |
| `src/src/screens/ClientsScreen.tsx` | tombol "Buka" per `DeviceCard` → `RemoteInstanceView`; disabled + alasan bila `control?.state === "protocol-mismatch"` | C1, C7 |
| `internal/docs/frontend/frontend-implementation.md:52` | cabut penanda DIRANCANG | SC11 |

Tak ada perubahan skema Prisma, tak ada migration.

### T3. Kontrak — `wsHandler` route relay hub + tiket + principal `remote`

```ts
// ws-tickets.ts — targetSchema, tambahan cabang
const relayTarget = /^relay:[^:]+:(events|terminal:[^:]+)$/;
const targetSchema = z.string().refine((v) =>
  v === "events" || v.startsWith("terminal:") || relayTarget.test(v));
// issueWsTicket tetap sama; hanya req.user yang boleh minta target relay:* (agent → 401 default cookie-only,
// gate app.ts sudah menolak req.agent di sini karena target ini tak pernah diminta agent legit)
```

```ts
// ws-admission.ts
export type WsTarget = "events" | "sync" | `terminal:${string}` | `relay:${string}:${"events" | `terminal:${string}`}`;
export type WsPrincipal = { kind: "user" | "agent" | "device" | "test" | "remote"; id: string };
// admitBrowserWs(req, target, allowedOrigins) — target relay:<deviceId>:<inner> sama origin/tiket
// flow dengan cabang lain; principal.kind "remote" tak dicocokkan ke req.user/req.agent (device sudah
// terverifikasi oleh consumeWsTicket + issuer req.user saat POST /ws-tickets)
```

```ts
// devices-relay.ts — route yang SAMA (baris 22 `app.route`) bertambah wsHandler
app.route({
  method: [...RELAY_METHODS] as any, url: "/devices/:deviceId/relay/*",
  handler /* apa adanya, B */,
  wsHandler: async (socket, req) => {
    // req.user wajib (COOKIE_ONLY top `devices`, sama gate B); tiket dikonsumsi admitBrowserWs
    // target relay:<deviceId>:events|terminal:<id> di preValidation (pola sama terminal.ts:544)
    const path = `/api/${(req.params as { "*"?: string })["*"] ?? ""}`;
    const mode = /* dari query ?mode=read|write, default "read" */;
    const actor: RelayActor = { hubOrigin, userId: req.user.id, email: req.user.email };
    const sid = await openStream(deviceId, { path, mode, actor }, socket); // relay/hub.ts, BARU
    if (!sid) { socket.close(4409, "stream limit"); return; }
    socket.on("message", (raw) => forwardBrowserFrame(deviceId, sid, raw));   // → `data` ke klien
    socket.on("close", () => closeStream(deviceId, sid));
  },
});
```

`preValidation` di atas HARUS tetap milik `app.route`, bukan handler baru — inilah "satu route
`GET`(implisit lewat upgrade)/`POST`/… ber-`handler` + `wsHandler`" yang dikunci S4.4. `@fastify/websocket`
11.3.0 sudah mendukung `wsHandler` bersanding `handler` di `app.route` (dibuktikan spike A pada route lain);
tak ada plugin kedua.

### T4. Kontrak — `relay/hub.ts` peta stream, kredit, plafon

```ts
type StreamState = {
  sid: string; browser: RelaySocket /* koneksi WS hub↔browser */;
  credit: number;              // byte tersisa boleh dikirim ke browser
  bufferedHigh: boolean;       // true saat browser bufferedAmount ≥ RELAY_SOCKET_MAX_BUFFERED
  lastResyncAt: number;        // throttle 4009 (RELAY_RESYNC_MIN_MS)
  idleTimer: NodeJS.Timeout;   // RELAY_IDLE_STREAM_CLOSE_MS tanpa penonton → close
};
// Link (hub.ts:23) bertambah `streams: Map<string, StreamState>`, `inflightOpens: number`.

function openStream(deviceId, req, browserSocket): string | null {
  // tolak (kembalikan null → pemanggil close 4409) bila:
  //   link.streams.size >= RELAY_MAX_STREAMS (6)   — plafon C5
  //   link.inflightOpens >= RELAY_MAX_INFLIGHT (4)  — permintaan open BELUM `opened`, plafon inflight
  // kirim { t:"open", sid, path, mode, actor } ke klien; credit awal RELAY_CREDIT_INITIAL (256 KiB)
}
function onClientFrame(deviceId, frame) {
  // "opened"  → inflightOpens--, kirim geometry awal ke browser bila ada
  // "data"    → decrement credit; forward ke browser; credit < RELAY_CREDIT_REFILL_BELOW (64 KiB)
  //             DAN bufferedAmount browser < RELAY_SOCKET_MAX_BUFFERED → kirim {t:"credit", sid, n}
  // "geometry"→ forward apa adanya (browser TerminalPane.term.resize)
  // "close"   → hapus stream, teruskan close code+reason ke browser socket
}
```

Backpressure C4: **kredit habis** → hub **membuang** frame `data` berikutnya dari klien (tak dibuffer,
tak diteruskan) sampai kredit terisi ulang; sesudah refill, hub mengirim `close 4009` ke socket **browser**
(bukan ke klien) — `TerminalPane`/`RemoteInstanceView` yang sudah punya `retry()` (pola SPEC-800 di
`TerminalPane.tsx:335`) menyambung ulang dan mendapat scrollback segar dari `pty.attach`. Throttle
`RELAY_RESYNC_MIN_MS` dihitung dari `lastResyncAt` per stream, bukan global.

Tutup **≤ 2 dtk tanpa penonton** (C6): saat socket **browser** tertutup, `openStream`'s pemanggil
langsung mengirim `{t:"close", sid, code:1000}` ke klien (yang menutup `injectWS`-nya sendiri di
`onClose` — lihat T5) — bukan menunggu `idleTimer`. `idleTimer` (`RELAY_IDLE_STREAM_CLOSE_MS`) adalah
jaring kedua untuk kasus browser lenyap tanpa event `close` bersih (mis. jaringan putus).

### T5. Kontrak — `relay/dispatcher.ts` jalur `open`, gate, kredit lokal

```ts
// jalur open menggantikan placeholder baris 134
async function handleOpen(f: RelayOpenFrame): Promise<void> {
  // 1. Gate — MIRROR admitRemoteRequest (gate.ts), TANPA raw HTTP: allowlist + capability atas f.path,
  //    grant = (await getSetting()).remoteControl, override = remoteCapabilityFor(method, path, f.mode)
  //    (WS terminal → "sessions:read" apa pun mode; WS events → tak ada override, checkAgentCapability biasa)
  if (!ok) { send({ t:"close", sid:f.sid, code:4403, reason:"capability required" }); return; }
  // 2. app.injectWS(path, { headers: { host, [RELAY_HEADER], [RELAY_ACTOR_HEADER] } }, { onOpen })
  //    — SAMA WAJIB lewat onOpen (ADR-0165 §2 spike): frame sinkron attach (scrollback/alt/phase,
  //    atau `hello`+snapshot GROUPS untuk /events/ws) HANYA sampai bila listener dipasang di onOpen.
  const stream = { credit: 0, mode: f.mode, sock: /* injectWS-returned ws-like */ null };
  streams.set(f.sid, stream);
  onOpen: (ws) => {
    send({ t:"opened", sid: f.sid, geometry: paneGeometryFor(f.path) });
    ws.on("message", (raw) => {
      const s = streams.get(f.sid); if (!s) return;
      const parts = splitUtf8(raw, RELAY_PART_MAX_BYTES);
      for (const part of parts) send({ t:"data", sid: f.sid, d: part, more: /* bukan bagian terakhir */ });
    });
    ws.on("close", (code, reason) => { streams.delete(f.sid); send({ t:"close", sid: f.sid, code, reason }); });
  }
}
function handleStreamData(f: RelayHubDataFrame): void {   // hub → klien, browser ketikan
  const s = streams.get(f.sid); if (!s) return;
  let m: { t?: string }; try { m = JSON.parse(f.d); } catch { return; }
  if (m.t === "resize") return;                                    // C2 — dibuang SELALU
  if ((m.t === "in" || m.t === "diag") && s.mode !== "write") return; // C3 — dibuang tanpa sessions:write
  s.sock.send(f.d);
}
function handleCredit(f): void { /* dipakai bila klien sendiri perlu tahu kreditnya sendiri — opsional,
  desain awal: kredit dihitung & ditegakkan SEPENUHNYA di hub (T4); klien tak menyimpan kreditnya sendiri
  kecuali untuk berhenti membaca lebih cepat dari yang bisa dikirim — lihat §Batas */ }
```

`f.mode` (`"read" | "write"`) berasal dari `open.mode` yang dikirim hub — hub menentukannya dari grant
`sessions:write` operator (bukan dari klaim browser): `mode:"write"` hanya dikirim bila
`grantsCapability(control.capabilities, "sessions:write")`. Audit: `remote.stream` per `open`
(`kind:"remote.stream"`, `data:{ actor, path, mode, sid }`), simetris `remote.request` T3/A.

`paneGeometryFor(path)`: bila `path` cocok `/api/terminal/sessions/:id/ws`, panggil
`paneGeometry(id)` (T2, `pty.ts`) — dikirim sekali di `opened`, lalu ulang tiap kali `listPanes()`
berikutnya (poll `sessions` events di klien, `everyTicks:1`) menunjukkan `cols`/`rows` berubah, memakai
peta stream aktif yang sama (tak ada poll baru — menumpang tick yang sudah ada, cermin larangan
"generator koneksi"/poll baru SPEC-761/ADR-0145).

### T6. Kontrak — `services/events.ts` grup terbatas untuk `remote`

```ts
export async function attach(c: Client, o: { maySubscribe?: boolean; groups?: Set<EventMsg["t"]> } = {}): Promise<void> {
  // ... sama, TAPI setiap `if (g.cookieOnly && !cookieClients.has(c))` menjadi:
  //   if (o.groups && !o.groups.has(msg.t)) continue;      // gate BARU, lebih ketat dari cookieOnly
  //   if (g.cookieOnly && !cookieClients.has(c)) continue;  // gate lama, tak berubah
}
function broadcast(msg, cookieOnly, remoteGroups: Iterable<Client>) { /* set klien remote dicek groups per-client, bukan global */ }
```

```ts
// routes/events.ts
if (principal.kind === "remote") {
  const groups = remoteEventGroups(/* grant capabilities dari relay/hub.ts relayControlFor-nya sendiri —
    TIDAK ADA: principal remote di HUB tak membawa capability korban, jadi `ide:read` diuji di gate
    KLIEN (T5) untuk jalur `req`/`open` /api/projects/*; grup `git` di /events/ws sendiri diputuskan
    di hub dari header actor + query `?ide=1` yang hanya dikirim frontend bila device grant `ide:read`
    (dibaca dari `PresenceDeviceView.control.capabilities`, sudah dikirim `hello` A) */);
  void attach(client, { maySubscribe: false, groups });
}
// remoteEventGroups(ideRead: boolean): Set<EventMsg["t"]> = new Set(["sessions","leadAsks","cleanups",
//   ...(ideRead ? ["git"] : [])])   — cookieOnly ("models","presence") TAK PERNAH masuk himpunan ini
```

Catatan konsistensi: ini WS `/events/ws` di **klien** (relay stream `open` path `events/ws`), bukan
`/events/ws` hub. `canSubscribeTopics(principal)` (ws-admission.ts:129) tetap `false` untuk `"remote"`
(default) — principal ini hanya boleh MENERIMA broadcast global yang di-filter `groups`, tak boleh
mengirim frame `sub` topik berparameter (di luar cakupan C, ADR-0165 §Plafon).

### T7. Kontrak frontend — `RemoteInstanceView`, `RemoteBanner`, komponen baca yang sudah ada

```tsx
// RemoteInstanceView.tsx (baru)
function RemoteInstanceView({ device, onClose }: { device: PresenceDeviceView; onClose: () => void }) {
  if (device.control?.state === "protocol-mismatch")           // AC-C7 gerbang, sebelum render apa pun
    return <StateBlock kind="error" title="Versi protokol tak cocok" .../>;
  const instance: Instance = { kind: "remote", deviceId: device.deviceId, name: device.name,
    version: device.control!.version, protocol: device.control!.protocol,
    capabilities: device.control!.capabilities };
  return (
    <InstanceProvider value={instance}>
      <RemoteBanner device={device} onClose={onClose} />
      <Tabs tabs={["Terminal","Dokumen","IDE"]} .../>
      {/* Terminal → TerminalPane mode="remote" sessionId=<id sesi presence>;
          Dokumen  → SpecDocsModal (useApi());
          IDE      → IdeReadPanel (useApi()) */}
    </InstanceProvider>
  );
}
```

```tsx
// RemoteBanner.tsx (baru)
function RemoteBanner({ device }: { device: PresenceDeviceView }) {
  const mismatchVersion = device.control!.version !== runningVersionLocal(); // dari api.getUpdateStatus() cache
  return (
    <div role="status" data-testid="remote-banner">
      Sedang melihat klien {device.name} · v{device.control!.version}
      <Badge tone="neutral">baca-saja</Badge>
      {mismatchVersion && <Badge tone="warn">versi hub berbeda dari klien</Badge>}
    </div>
  );
}
```

`TerminalPane` (perubahan minimal, bukan salinan): `connect()` (baris 231) memakai
`useWsTarget(`terminal:${sessionId}`)` bila `mode === "remote"` alih-alih `api.issueWsTicket` +
`paths.terminalWs` + `location.host` hardcoded; `ResizeObserver` (baris 490) dan efek `fontSize`/`showKeys`
(baris 531/547) melewati `send({t:"resize",…})` bila `mode==="remote"` (`fit.fit()` tetap jalan — layar
lokal xterm tetap menyesuaikan wrap, hanya frame ke server yang ditahan); frame masuk `t==="geometry"`
(baru di `onmessage`, baris 266) memanggil `term.resize(f.cols, f.rows)` langsung (bukan lewat `fit`).
`onData`/`sendKey`/`TerminalComposer` tak terpasang (showKeys default false untuk remote) bila
`!capabilities.includes("sessions:write")`. Tak ada duplikasi file: `mode` adalah prop baru, opsional,
default `"local"` — 100% pemanggil lama tak berubah bentuk.

### T8. Penanganan galat & kode tutup (delta atas SPEC-1215 §S6/§S4.2)

| Kondisi | Kode/Perilaku | Jejak |
|---|---|---|
| Stream ke-7 (plafon 6) | hub tutup socket browser `4409` sebelum `open` terkirim ke klien | — |
| `open` ke-5 masih inflight (plafon 4) | hub tunda **atau** tutup `4409` (Plan menentukan tunda vs tolak) | — |
| Kredit habis, frame `data` masuk | hub buang frame (tak diteruskan, tak dibuffer) | `relay.stream` (opsional) |
| Kredit terisi ulang sesudah buang | hub tutup socket browser `4009`; `TerminalPane.retry()` menyambung | — |
| Penonton terakhir lenyap | klien menutup `injectWS`-nya `≤ 2 dtk` (idle) atau langsung (hub kirim `close`) | `remote.stream` |
| Klien versi lama (`open` tak dikenal) | dispatcher lama menjawab `close 4502` (A, sudah ada — turunan C **menggantinya**, bukan menambah) | `remote.stream` |
| `control.protocol` beda | hub **menolak membuka** `RemoteInstanceView` (gate render, T7), bukan mengizinkan lalu gagal | — |
| `control.version` beda, protokol sama | `RemoteBanner` peringatan, tampilan tetap terbuka | — |
| Frame relay `> 32 KiB` (`RELAY_PART_MAX_BYTES`) | dipotong `splitUtf8` sebelum kirim (dispatcher & hub, dua arah) | — |
| Grant `sessions:read` dicabut selagi stream terbuka | `revalidateWsPrincipal`-setara di klien: `admitRemoteRequest`-mirror re-check per 60 dtk (pola `createPrincipalWatch`) → `close 4403` | `remote.stream` |
| Principal `remote` request grup `cookieOnly` (`/events/ws` klien) | tak pernah terkirim (T6) — bukan galat, senyap by construction | — |

Kode `1008`/`1009`/`4000`/`4001`/`4003`/`1001` (socket relay Bearer) dan `4004`/`4401` (sesi tmux
lenyap/ticket invalid, sudah ada) tak berubah.

### T9. Acceptance criteria (EARS) — turunan C

Sama nomornya dengan SPEC-1215 §S9 (sumber kebenaran); titik ukur di sini mencerminkan SC1..SC10 fase
Objective satu-satu, dipersempit ke fungsi/berkas konkret di atas.

- **AC-C1** — WHEN operator hub menekan "Buka" pada device ber-`control.state==="available"`, THE hub
  SHALL merender `RemoteInstanceView` yang me-mount `TerminalPane`/`SpecDocsModal`/`IdeReadPanel` —
  komponen **yang sama** dipakai layar lokal — di dalam `InstanceProvider` `kind:"remote"`, disertai
  `RemoteBanner`. *Ukur:* identitas modul (import path sama), `useInstance().kind`, teks banner.
- **AC-C2** — WHILE `TerminalPane` `mode==="remote"`, resize kontainer/font/showKeys SHALL tak pernah
  memanggil `send({t:"resize"})` (spy); dispatcher SHALL membuang setiap frame `resize` masuk pada
  jalur `open`, mode `read` maupun `write`.
- **AC-C3** — IF stream dibuka `mode:"read"` (tanpa `sessions:write`), THEN dispatcher SHALL membuang
  setiap frame `in`/`diag` (keystroke terkirim dari hub tak pernah sampai pty), AND `TerminalPane`
  SHALL merender penanda baca-saja.
- **AC-C4** — WHEN kredit stream disetel 0, THEN keluaran pty berikutnya SHALL dibuang (tak dibuffer,
  nol replay backlog sesudah pulih); dua refill kredit `<5 dtk` berturut-turut SHALL menghasilkan
  **paling banyak satu** `close 4009`.
- **AC-C5** — WHEN device sudah punya 6 stream aktif, stream ke-7 SHALL ditutup `4409`; permintaan
  `open` ke-5 saat 4 sudah inflight SHALL ditolak/ditunda; setiap frame `>32 KiB` SHALL dipotong
  sebelum kirim.
- **AC-C6** — WHEN penonton terakhir sebuah stream terputus, THE `injectWS` milik stream itu SHALL
  ditutup `≤2 dtk` (fake timers, spy `close`/`destroy`).
- **AC-C7** — IF `control.protocol` device tak cocok, THEN hub SHALL menolak merender
  `RemoteInstanceView` (gate eksplisit); IF `control.protocol` cocok tapi `control.version` beda, THEN
  `RemoteBanner` SHALL menampilkan peringatan versi dan tampilan SHALL tetap terbuka.
- **AC-C8** — Jalur `open` baru SHALL mereplikasi regresi S0a (frame sinkron attach sampai, 2/2, hanya
  lewat `onOpen`) sebagai kasus TERPISAH dari jalur `req`.
- **AC-C9** — Principal `remote` yang menyambung `/events/ws` (klien) SHALL hanya menerima grup
  `sessions`/`leadAsks`/`cleanups`/topik `git` (`git` hanya bila `ide:read`); grup `cookieOnly`
  (`models`, `presence`) SHALL nol frame di seluruh transkrip test.
- **AC-C10** — Skrip pengukuran 4 stream/RTT 200 ms/Mac mini 8 GB SHALL mencatat CPU/RSS/`bufferedAmount`
  per detik; hasil dan kelulusan/amandemen plafon SHALL dicatat di ADR-0165 §9/§10, bukan diklaim.

### T10. Rencana verifikasi

Test (TDD, path konkret, mengikuti resep `CLAUDE.md`/SPEC-479 untuk set yang menyentuh test server):

- `server/test/ws-tickets.relay-target.test.ts` — cabang `relay:<deviceId>:events|terminal:<id>`,
  hanya `req.user` (AC prasyarat).
- `server/test/ws-admission.remote.test.ts` — `admitBrowserWs` target relay, `revalidateWsPrincipal`
  `remote`.
- `server/test/devices-relay.wshandler.test.ts` — `injectWS` hub sisi browser: plafon 6/4 (AC-C5),
  tutup `≤2 dtk` tanpa penonton (AC-C6, fake timers), `4409`.
- `server/test/relay-hub.stream.test.ts` — kredit habis/isi ulang/resync ≤1×/5dtk (AC-C4), potong
  `>32 KiB` (AC-C5).
- `server/test/relay-dispatcher.stream.test.ts` — regresi `onOpen` jalur stream terpisah dari S0a
  (AC-C8), buang `resize` (AC-C2), buang `in`/`diag` mode read (AC-C3), gate capability `open` → 4403.
- `server/test/events.remote-groups.test.ts` — `attach({groups})` membatasi grup, `cookieOnly` nol
  frame (AC-C9).
- `src/test/TerminalPane.remote.test.tsx` — spy `send`: nol `resize` (AC-C2), `geometry` → `term.resize`,
  tanpa `sessions:write` → nol `onData` terkirim + penanda baca-saja (AC-C3).
- `src/test/RemoteInstanceView.test.tsx` — identitas modul (AC-C1), gate `protocol-mismatch` (AC-C7),
  banner versi beda.
- `server/test/relay-8gb-measurement.ts` (skrip, pola AC-S9 SPEC-1217) — dijalankan nyata di Mac mini
  8 GB, hasil dicatat sebagai amandemen ADR-0165 (AC-C10).

Resep run:

```
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS \
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism <paths>
```

Smoke manual sekali di akhir Execute (dua `HANOMAN_HOME`, dua port, hub + klien beneran): grant
`sessions:read` di klien → buka `RemoteInstanceView` dari hub → buktikan `TerminalPane` menerima
keluaran live, tak mengirim `resize`, dan `RemoteBanner` menolak protocol-mismatch nyata (matikan versi
protokol klien sementara, buktikan hub menolak render) — bukan hanya lulus mock.

### T11. Docs yang tersentuh

- **Fase ini:** spec ini + entri indeks `internal/docs/README.md`.
- **Saat Execute (commit yang sama dengan kode):**
  - `internal/docs/frontend/frontend-implementation.md:52` — cabut penanda DIRANCANG "tampilan
    identik … tetap DIRANCANG untuk SPEC-1218 (turunan C)" (SC11);
  - `internal/docs/architecture/api-contract.md` — tambahkan `wsHandler` di
    `/devices/:deviceId/relay/*` dan target tiket `relay:<deviceId>:…`;
  - `internal/docs/adr/0165-*.md` — ubah "Menyusul: stream, resize, dan §10 backpressure di SPEC-1218"
    menjadi "mendarat", plus catatan hasil pengukuran AC-C10 (§9/§10) bila plafon berubah;
  - `internal/docs/architecture/stack.md` — diagram/penanda turunan C mendarat;
  - `src/src/screens/ClientsScreen.tsx:9-11` — komentar berkas ("Tak ada isi terminal di sini …
    sengaja di luar lingkup") sudah basi sesudah C mendarat; diperbarui bersama kode (bukan doc, tapi
    dicatat di sini supaya Execute tak melewatkannya).

### T12. Batas & residu (mewarisi §S12 SPEC-1215, tanpa tambahan baru)

Auto-dispatch scheduler/lead ke klien, mirror seluruh dashboard di luar Terminal/fase/dokumen/IDE baca,
RBAC per user, unggahan lampiran/unduhan review/aksi IDE tulis lewat relay tetap di luar payung. Plafon
backpressure (6 stream/4 inflight/256 KiB kredit/64 KiB refill/1 MiB `bufferedAmount`/32 KiB per
frame/12.000 frame-menit) adalah **angka awal**, wajib diukur AC-C10 sebelum dianggap final; residu
lain (jendela balapan presence, aktor sebagai klaim hub, dll.) sudah dicatat ADR-0165 §Plafon dan tak
berubah oleh turunan ini.
