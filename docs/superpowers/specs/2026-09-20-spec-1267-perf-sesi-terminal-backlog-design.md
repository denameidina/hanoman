# SPEC-1267 — Perf sesi terminal di backlog (rancangan)

## Konteks & keputusan

**Masalah.** Terminal di Backlog terasa delay saat sesi agen berjalan. Audit baca-kode (belum diprofil) menunjuk satu jalur: grup siar `specs` (`server/src/services/events.ts:70`, `everyTicks: 1`) memanggil `liveSpecs()` (`services/live-specs.ts:23`) yang `findMany` seluruh tabel Spec tanpa `select` (estimasi 3,8 MB/frame, 1069 baris lokal), di-`JSON.stringify` tiap detik untuk dedup, lalu `sessionPhasesBySpec()` → `listPanes()` sinkron (`execFileSync tmux`, 80-916 ms per komentar SPEC-878) di event loop yang sama dengan output PTY. Klien: `App.tsx:984` menaikkan `dataVersion` di setiap frame `specs`, yang memicu `api.listSpecs()` ulang di BacklogScreen (dep `dataVersion`, baris ~992), ProjectsScreen, PrdScreen.

**Fakta terverifikasi di kode (fase ini).**
- Kontrak WS: `shared/src/dto.ts:816` `{ t: "specs"; specs: Spec[] }` (penuh). `presence` membawa `hubVersion` (dto.ts:833) — mekanisme kompat klien lama/baru sudah ada untuk presence, bukan untuk specs.
- Klien membaca `payload`, `objective`, `sourceHistory` dari state `backlog` (yang diisi frame WS): `BacklogScreen.tsx:164,249,391`, `ChangeSourceDialog.tsx:32`, `App.tsx:1277-1303` (`spec.objective`). Jadi membuang field itu dari frame TIDAK aman tanpa jalur muat-detail per item.
- BacklogScreen sudah menimpa item hasil fetch dengan `backlogById.get(id) ?? s` (baris ~996), yaitu frame WS mengalahkan hasil HTTP — ini harus dibalik/dijaga saat frame jadi ringkas, kalau tidak field detail hilang.
- Tidak ada perubahan skema DB; hanya kontrak WS + perilaku klien.

**Prinsip keputusan.** Urutan kerja mengikuti brief: langkah 0 (baseline) wajib mendahului klaim apa pun; langkah 1-2 dulu (murah, dampak terbesar); langkah 3 sesudahnya; 4-6 hanya bila angka sesudah 1-3 masih menunjukkan masalah (YAGNI). Tak menyentuh: coalescing PTY 16 ms/cap 64 KB, satu WS events ref-count, IMMEDIATE_PER_MIN/MAX_INFLIGHT, dedup siaran (dipertahankan, diganti hash).

**Alternatif frame `specs` (langkah 1).**
- A. Frame ringkas (tanpa payload/sourceHistory/objective) untuk semua spec; detail via HTTP `GET /specs/:id` saat dibuka. Terkecil, tapi mengubah semantik state `backlog` klien (perlu audit ~8 call-site di atas).
- B. Hanya spec non-done (+ hitungan/ringkasan done). Memotong ~99% baris (1056/1069 done), field penuh tetap untuk yang aktif; done dimuat lewat HTTP berpaginasi (sudah ada). Perubahan kontrak lebih kecil.
- C. Diff per baris (`version`). Paling hemat tapi paling kompleks (resync, urutan, reconnect).
- **Rekomendasi: B + ringkas objective/payload hanya untuk baris done bila masih dibutuhkan; dedup memakai hash `max(updatedAt)+count+sum(version)` dari query agregat murah** (bukan stringify penuh). C ditunda. Kompat: bidang baru opsional di frame + versi kontrak (`specsFrame: 2`) sehingga klien lama tetap menerima frame penuh bila server melihat klien lama (perlu penanda dari klien; lihat keputusan #1).

**Dedup klien (langkah 2).** `setDataVersion` naik hanya bila hash isi frame berubah (bandingkan `(id,version,updatedAt)` bukan referensi); BacklogScreen refetch di-debounce sekali dan tidak per frame; hapus langganan `sessions` ganda di `TerminalScreen.tsx:98` (pakai prop App); `presence` di-dedup di server (S10: `lastSeenAt` device lokal berubah tiap build, `presence/view.ts:40`) dan klien.

**Langkah 3.** `sessionPhasesBySpec`/`liveDecisions` → async memakai `listPanesShared` (memo 1 dtk, `presence/snapshot.ts:35`); reconcile/reaper/lead → `getSessionAsync`/`listSessionsAsync` (`pty.ts:510` sudah ada); route WS terminal (`routes/terminal.ts:558`, `pty.ts:1444`) → async; satukan pembacaan berkas fase `pollPhases`/`paneComplete`. Risiko: `liveSpecs` write-through CAS dan semantik "hanya maju" tak boleh berubah — test perilaku yang ada jadi jaring pengaman.

**Langkah 4-6 (bersyarat).** Grup siar paralel dengan isolasi galat (bukan `await` serial `events.ts:231-244`); attach klien baru memakai `g.last`; kadens specs 1→3 dtk hanya bila hash-dedup belum cukup (perilaku terlihat: board lebih lambat 2 dtk). Backpressure `bufferedAmount` untuk terminal (drop/coalesce vs tunda). Klien terminal: WebGL+fallback DOM, cursorBlink hanya pane fokus, jeda parse pane tersembunyi, `React.memo`, ticker PhaseStrip bersama, timer 100 ms bersyarat, debounce ResizeObserver.

**Pengukuran (langkah 0 & 7).** Instrumen sementara/opsional di `__tick`: durasi `g.build()` per grup, `monitorEventLoopDelay` (p50/p99/max), ukuran frame (mentah & deflate) per grup, frame `specs`/menit, GET /specs per menit (DevTools). Skenario: 1 vs 4 pane terminal, backlog lokal 1069 baris, DB terpisah (bukan `~/.hanoman` produksi). Instrumen diaktifkan env (mis. `HANOMAN_EVENTS_PROFILE=1`), nol biaya saat mati.

**Docs tersentuh (saat Execute).** `internal/docs/architecture/stack.md`, `internal/skills/hanoman/SKILL.md` (kontrak frame `specs`), `api-contract.md` bila ada; ADR baru bila kontrak frame berubah (amandemen ADR-0039/0145).

## Keputusan (dijawab manusia)

1. **Frame `specs` = A.** Semua spec dikirim dalam bentuk ringkas (tanpa `payload`, `sourceHistory`, `objective`); detail dimuat via HTTP. Dedup siaran memakai hash `max(updatedAt)+count+sum(version)` dari query agregat, bukan `JSON.stringify` penuh. B dan C tidak dipakai.
2. **Kompatibilitas = tanpa.** Kontrak diubah serentak; server dan klien satu paket npm. Tak ada penanda kapabilitas atau versi frame. Catatan risiko untuk fase Spec: klien lama yang tersambung ke server baru (mis. instance remote lewat hub dengan versi berbeda) akan menerima frame ringkas; fase Spec harus menuliskan dampak ini di ADR amandemen ADR-0039/0145 dan ambang versi minimum bila diperlukan.
3. **Detail di klien.** `GET /specs/:id` saat item dibuka (dialog, Change Source, backlink audit `App.tsx:1277-1303`, `BacklogScreen.tsx:164,249,391`) plus `listSpecs` paginasi untuk daftar. `backlogById` tidak boleh menimpa hasil HTTP dengan item frame ringkas (`BacklogScreen.tsx` ~996); merge hanya untuk field ringkas (stage, status, version, updatedAt).
4. **Kadens `specs` 1 dtk menjadi 3 dtk** hanya bila angka ukur sesudah langkah 1-3 masih buruk.
5. **Instrumen** `HANOMAN_EVENTS_PROFILE=1` dipasang dan dipertahankan sebagai diagnostik (nol biaya saat mati).
6. **Cakupan Execute** = langkah 0-7 seluruhnya (termasuk backpressure, klien terminal, dan verifikasi akhir baseline vs sesudah).

## Objective

**Objective (satu, terukur).** Di Backlog dengan 4 pane terminal aktif dan DB lokal 1069 spec, terminal tetap responsif: jalur siaran periodik tidak lagi memblokir event loop dan frame `specs` kecil serta hanya lahir saat isinya berubah, dibuktikan oleh angka baseline (langkah 0) versus sesudah (langkah 7), diukur di skenario, DB, dan mesin yang sama dengan instrumen `HANOMAN_EVENTS_PROFILE=1`.

**Kriteria sukses** (tiap butir dapat dicentang oleh angka atau test; "baseline" = hasil langkah 0 yang dicatat sebelum perubahan kode):

1. **Ukuran frame `specs`**: frame ringkas (tanpa `payload`/`sourceHistory`/`objective`) untuk 1069 spec <= 5% ukuran frame baseline (baseline estimasi 3,8 MB), mentah dan terkompresi deflate; test kontrak memastikan ketiga field itu tidak ada di frame.
2. **Frame hanya saat berubah**: pada DB diam 60 dtk, frame `specs` = 0 (baseline ~60/menit); mengubah satu spec melahirkan tepat satu frame. Dedup memakai hash `max(updatedAt)+count+sum(version)`, bukan `JSON.stringify` penuh; test: hash tak berubah tanpa perubahan, berubah bila update/tambah/hapus satu baris.
3. **Nol tmux sinkron di jalur periodik**: tak ada `execFileSync`/`readFileSync`/`statSync`/`readdirSync` di jalur `specs`/`notifications` siaran, reconcile scheduler, reaper, lead pulse, dan pembukaan WS terminal; diverifikasi grep + test yang gagal bila jalur memakai varian sinkron.
4. **Event loop**: `monitorEventLoopDelay` saat 4 pane aktif menampilkan p99 dan max lebih rendah dari baseline; target p99 <= 50 ms dan max <= 100 ms (baseline dicatat di langkah 0; bila baseline sudah di bawah ambang, kriteria = tidak memburuk). Durasi `g.build()` grup `specs` p95 <= 20 ms.
5. **Klien tanpa refetch/re-render per frame tak berubah**: dalam 60 dtk tanpa perubahan data, `GET /specs` = 0 (baseline ~60/menit) dan `dataVersion` tidak naik; test unit atas fungsi dedup klien (id, version, updatedAt sama = tanpa naik).
6. **Detail via HTTP, tanpa regresi**: dialog, Change Source, audit backlink (`App.tsx:1277-1303`), dan `BacklogScreen.tsx:164,249,391` memuat detail lewat `GET /specs/:id`; `backlogById` tidak menimpa hasil HTTP dengan item frame ringkas (test merge hanya field ringkas).
7. **Langganan `sessions` tunggal dan `presence` terdedup**: satu pemrosesan frame `sessions` di klien; frame `presence` tidak lahir bila hanya `lastSeenAt` device lokal yang berubah.
8. **Terminal**: kadens `specs` 1 dtk -> 3 dtk hanya bila kriteria 4 belum tercapai setelah langkah 1-3 (keputusan #4); backpressure `bufferedAmount` pada kirim terminal tanpa memutus coalescing PTY 16 ms/cap 64 KB; klien terminal (WebGL fallback DOM, cursorBlink pane fokus, pane tersembunyi dijeda, `React.memo`, ticker PhaseStrip bersama, timer 100 ms bersyarat, debounce+dedup resize) menurunkan CPU renderer 4 pane dibanding baseline di profil Chrome.
9. **Bukti akhir**: tabel baseline vs sesudah (durasi build per grup, lag event loop, frame `specs`/menit, GET /specs/menit, ukuran frame, CPU renderer 1 vs 4 pane) tercatat; tak ada klaim perbaikan tanpa angka pasangan.
10. **Invarian terjaga**: coalescing PTY 16 ms/cap 64 KB, satu WS events ref-count, IMMEDIATE_PER_MIN/MAX_INFLIGHT, dan dedup siaran tetap; tak ada perubahan skema DB; test tersentuh hijau (`pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism`, DB terisolasi) dan API nyata dicoba di local (boot server, curl `GET /specs`, `GET /specs/:id`).
11. **Docs**: `internal/docs/architecture/stack.md`, `internal/skills/hanoman/SKILL.md`, dan ADR baru (amandemen ADR-0039/0145, memuat dampak klien lama tanpa kompatibilitas, keputusan #2) diperbarui di commit yang sama dan ditautkan di `internal/docs/README.md`.

**Di luar objective**: diff per baris (C), penanda kapabilitas/versi frame, perubahan skema DB, PTY coalescing.

---

# Spec

## S0 — Temuan fase Spec yang mengubah rancangan

Empat fakta dibaca ulang dari kode di base `44440e8b` dan **membatalkan asumsi** yang dipegang fase
sebelumnya. Semuanya berjangkar, bukan ingatan.

**S0.1 — `liveSpecs()` bukan pembaca; ia MESIN kemajuan stage.** `services/live-specs.ts:22-64`
melakukan empat hal dalam satu fungsi: `findMany` set penuh (baris 23), overlay stage dari berkas
fase (33-42), **write-through CAS + `notifySynced`** (48-60), dan **`recordCompletion`** — notifikasi
`done` (62). `routes/specs.ts:93` dan grup siar `events.ts:70` memanggil fungsi yang **sama** supaya
push & pull tak drift (SPEC-199). Konsekuensi yang tak terlihat dari brief: **kemajuan stage backlog
dan notifikasi `done` lahir dari tick siar 1 dtk itu sendiri.** Kalau frame `specs` didedup dengan
hash DB (`max(updatedAt)+count+sum(version)`) lalu `liveSpecs()` **dilewati** saat hash tak berubah,
berkas fase yang berubah di disk **tak akan pernah** menaikkan stage — hash DB tak bergerak karena
yang berubah ada di luar DB. Backlog berhenti maju dan `done` berhenti bernotifikasi, senyap.
Karena itu dedup **tidak boleh** memagari overlay; ia hanya boleh memagari **pembacaan set penuh**
(§S2.1).

**S0.2 — `GET /specs/:id` tidak ada.** Route yang ada (`routes/specs.ts`): `GET /specs`,
`POST /specs`, `POST /specs/batch`, `PATCH /specs/:id`, `POST /specs/:id/source|done|integrate`,
`GET|POST|DELETE /specs/:id/attachments*`, `GET /specs/:id/docs*`, `GET /specs/:id/escalation`,
`GET /specs/:id/review*`, `DELETE /specs/:id`. Keputusan #3 ("detail via `GET /specs/:id`")
karenanya **menambah endpoint baru**, bukan memakai yang ada; `internal/skills/hanoman/SKILL.md:572`
menyatakan ketiadaannya secara eksplisit dan **wajib dikoreksi** di commit yang sama.

**S0.3 — Paginasi DB untuk specs dilarang ADR-0038.** `GET /specs` memuat set penuh scope
project/source ke memori **dengan sengaja**, karena overlay + write-through + notifikasi `done`
harus berjalan atas set penuh; `skip`/`take` di query DB dilarang selama overlay bergantung set
penuh. "listSpecs paginasi" pada keputusan #3 berarti **paginasi di layer response yang sudah ada**
(`paginate()`, `routes/specs.ts:94`) — bukan paginasi DB baru. Biaya memori per request tak
berkurang; yang berkurang adalah **byte di kawat** dan **frekuensi**.

**S0.3a — pemanggil `listSpecs` di klien, lengkap (mengoreksi brief).** Hanya tiga, dan
`ProjectsScreen`/`PrdScreen` **tidak** termasuk (keduanya memang me-refetch pada `dataVersion`,
tetapi daftar miliknya sendiri, bukan `GET /specs`): `App.tsx:941` — `api.listSpecs()` **tanpa
`page`/`limit`**, yaitu full-fetch ±3,8 MB yang mengisi state `backlog`; `BacklogScreen.tsx:975-981`
— berpaginasi kecuali di view board; `TerminalScreen.tsx:587` — picker, `startable: true`.
Deklarasinya `src/src/api/client.ts:271` (`Paginated<Spec>`). Jadi keputusan #3 opsi B menyentuh
tiga call-site dan satu tipe, bukan lima layar.

**S0.4 — merge klien menimpa hasil HTTP tanpa syarat.** `BacklogScreen.tsx:997-1000`:
`data.items.map((s) => backlogById.get(s.id) ?? s)` — item frame WS **menggantikan seluruh objek**
hasil `listSpecs`. Dengan frame ringkas, baris daftar kehilangan `objective` yang dirender di
`BacklogScreen.tsx:656` dan `:695` (subjudul grid & list, **tiap baris**, bukan hanya detail).
Pemakai tiga field itu di klien, lengkap: `App.tsx:1277,1279,1293,1303` (`objective`, backlink
audit), `BacklogScreen.tsx:164,249` (`payload`), `:391,395` (`sourceHistory`), `:443,656,695`
(`objective`), `ChangeSourceDialog.tsx:32,47` (`payload`). `portal/ClientPortal.tsx:230` memakai
API portal sendiri dan **tidak** tersentuh.

**S0.5 — I/O sinkron di jalur periodik tak hanya tmux.** Selain `listPanes()` (`pty.ts:310`
`execFileSync`) lewat `sessionPhasesBySpec()` (`pty.ts:1212`), jalur grup `specs` juga menyentuh
`session-phases.ts:41` (`readFileSync` berkas fase), `:176` (`readdirSync` direktori plan), `:179`
(`readFileSync` tiap berkas plan untuk gerbang `- [ ]` SPEC-173), dan — bila ada `dependsOn` —
`spec-deps.ts:160` → `tipper`/`merger` → `pty.ts:602` `execFileSync("git", …)` (ber-cache `tipCache`,
tetapi cache miss memblokir). Kriteria sukses #3 karena itu mencakup **git sinkron**, bukan hanya
tmux.

**S0.6 — dedup presence mustahil cocok by construction.** `presence/view.ts:40` menyetel
`lastSeenAt: new Date(now).toISOString()` untuk device lokal pada **setiap** build; signature
`JSON.stringify` (`events.ts:239`) karenanya selalu berbeda dan frame `presence` lahir tiap 3 dtk
selamanya. Nilainya sendiri tak salah (device lokal memang terlihat sekarang) — yang salah adalah
memasukkannya ke **signature**.

**S0.7 — frame di-`JSON.stringify` dua kali.** `events.ts:239` menstringifikasi untuk signature,
`events.ts:210` (`broadcast`) menstringifikasi **objek yang sama** lagi untuk dikirim. Untuk frame
3,8 MB itu dua lintasan penuh per detik.

## S1 — Arsitektur sesudah

```
                       ┌─────────────────────── event loop server ───────────────────────┐
tick 1 dtk  ──────────►│ __tick()                                                        │
                       │   ├─ specsGroup.build()          ── async, tanpa I/O sinkron ──► │
                       │   │    ├─ liveOverlayTick()   O(sesi hidup)   ← SELALU jalan    │
                       │   │    │     listPanesShared() (memo 1 dtk, async)              │
                       │   │    │     readPhasesAsync / planOpenAsync                    │
                       │   │    │     write-through CAS + notifySynced + recordCompletion│
                       │   │    └─ specsDigest()  O(1) agregat DB                        │
                       │   │          berubah? → findMany(select ringkas) → frame        │
                       │   │          tak berubah? → 0 byte, 0 frame                     │
                       │   ├─ grup lain … (dibangun paralel, terisolasi galat)           │
                       │   └─ signature dihitung SEKALI, dipakai ulang saat broadcast    │
                       └─────────────────────────────────────────────────────────────────┘
        WS /api/events/ws                                   WS /terminal/**/ws
        frame {t:"specs", specs: SpecSlim[]}                byte PTY (coalesce 16 ms)
                 │                                                   │  ← backpressure
                 ▼                                                   ▼     bufferedAmount
   App.tsx: setBacklog(slim) + dataVersion naik HANYA bila digest isi berubah
                 │
                 ├─ BacklogScreen: items = mergeSlim(httpItem, slimItem)   (bukan ganti objek)
                 └─ buka detail → GET /specs/:id  (payload/objective/sourceHistory penuh)
```

Tiga pemisahan yang menjadi tulang perubahan:

1. **Kemajuan stage dipisahkan dari penyajian daftar.** `liveSpecs()` dipecah menjadi
   `liveOverlayTick()` (efek: maju stage + notif, berbiaya O(jumlah sesi hidup) — 0–4 di mesin
   nyata) dan `listSpecsLive()` (penyajian: `findMany` set penuh + overlay baca-saja + `decorateBlocked`).
   `GET /specs` memanggil keduanya berurutan sehingga **perilakunya tak berubah satu bit pun**
   (SPEC-199 utuh); grup siar memanggil `liveOverlayTick()` tiap tick dan `findMany` ringkas
   **hanya** saat digest berubah.
2. **Frame kawat dipisahkan dari objek domain.** `Spec` (penuh) tetap bentuk HTTP; `SpecSlim`
   adalah bentuk **kawat siar** baru di `shared`.
3. **Fakta transport dipisahkan dari fakta penyajian.** `bufferedAmount` menjadi gerbang kirim
   terminal; `lastSeenAt` lokal dikeluarkan dari signature, bukan dari payload.

## S2 — Komponen

### S2.1 `server/src/services/live-specs.ts` — pecah dua

| Fungsi | Tanggung jawab | Biaya | Pemanggil |
|---|---|---|---|
| `liveOverlayTick(): Promise<void>` | Baca pane (async, memo), turunkan stage live, CAS write-through, `notifySynced`, `recordCompletion` | O(sesi hidup); `findMany({where:{id:{in: liveIds}}})` | grup siar tiap tick; `GET /specs` sebelum penyajian |
| `listSpecsLive(filter): Promise<Spec[]>` | `findMany` set penuh + overlay **baca-saja** + `decorateBlocked` | O(baris) | `GET /specs` |
| `listSpecsSlim(): Promise<SpecSlim[]>` | `findMany({select: …})` tanpa 3 field berat + overlay baca-saja + `decorateBlocked` | O(baris), hanya saat digest berubah | grup siar |
| `specsDigest(): Promise<string>` | `prisma.spec.aggregate({_count, _max:{updatedAt}, _sum:{version}})` + `liveSignature()` | O(1) query agregat | grup siar tiap tick |

`liveSignature()` adalah bagian **non-DB** digest: untuk tiap sesi hidup, `specId` + nama fase aktif
+ (bila fase terakhir `done`) `mtimeMs`+`size` berkas plan yang digerbangi `stageForRun` (SPEC-173).
Tanpa komponen berkas plan itu, centang `- [ ]` terakhir yang membuka `done` tak akan melahirkan
frame sampai ada perubahan lain — regresi yang tak boleh terjadi.

`liveSpecs()` lama **dipertahankan sebagai komposisi** `liveOverlayTick()` + `listSpecsLive()` agar
test perilaku yang ada (`server/test/specs.route.test.ts`, termasuk *"advances + persists off-page
specs even when paginated"*) menjadi jaring pengaman tanpa ditulis ulang.

### S2.2 `server/src/services/pty.ts` + `session-phases.ts` — varian async

- `sessionPhasesBySpecAsync(): Promise<Map<…>>` di atas `listPanesShared()` (`presence/snapshot.ts:39`,
  memo 1 dtk) menggantikan `sessionPhasesBySpec()` **di jalur periodik**. Versi sinkron tetap ada
  hanya untuk pemanggil non-periodik yang belum dimigrasikan; bila tak tersisa satu pun, ia dihapus.
- `readPhases`/gerbang plan (`session-phases.ts:41,176,179`) mendapat pasangan `fs/promises` +
  **memo per tick** berkunci `(path, mtimeMs, size)`. `pollPhases` (`pty.ts:1340`) dan `paneComplete`
  (`pty.ts:1320`) membaca berkas fase yang **sama** dua kali per tick 500 ms → satu pembacaan, dua
  pembaca.
- `liveDecisions`/`scanDecisions` (`pty.ts:491`) + `statSync` per pane → varian async di atas memo
  yang sama; dipakai `notificationsFeed()`.
- `getSessionAsync` (`pty.ts:510`) sudah ada: dipakai oleh `routes/terminal.ts:558`, `pty.ts:1444`
  (buka/reconnect WS), `scheduler/reconcile.ts:74`, `scheduler/engine.ts:40`,
  `worktree-project.ts:10` (reaper), `lead/engine.ts:127` (pulse).
- `spec-deps.ts:160` `tipper`/`merger` (`pty.ts:602` `execFileSync("git")`): di jalur siar,
  `decorateBlocked` dipanggil **hanya** di dalam `listSpecsSlim()` — yaitu hanya saat digest berubah,
  bukan tiap detik. `tipCache` yang sudah ada menanggung sisanya.

### S2.3 `server/src/services/events.ts` — siar

- **Signature sekali jalan.** `__tick()` menstringifikasi satu kali dan meneruskan string itu ke
  `broadcast(msg, s, cookieOnly)` (S0.7).
- **Signature ternormalisasi per grup.** `Group` mendapat `sig?: (msg) => string` opsional. Grup
  `presence` memakainya untuk **mengeluarkan `lastSeenAt` device lokal** dari signature (S0.6);
  payload yang dikirim tetap utuh. Grup `specs` memakainya untuk memakai `specsDigest()` alih-alih
  `JSON.stringify` frame.
- **Build paralel & terisolasi.** Loop `for … await` (`events.ts:231-244`) → `Promise.allSettled`
  atas grup yang jatuh tempo; satu grup gagal tak menahan yang lain. Urutan **broadcast** tetap
  deterministik (urutan `GROUPS`) supaya klien tak melihat urutan frame berubah-ubah.
- **`attach()` memakai `g.last`.** Bila `g.last` tak kosong dan loop hidup, kirim string itu apa
  adanya; bila kosong (klien pertama sesudah `stopLoop`), bangun. Kebasian terbatas pada
  `everyTicks` grup — tak lebih basi daripada tick berikutnya.
- **Kadens `specs`.** Tetap `everyTicks: 1`. Dinaikkan ke `3` **hanya** bila angka langkah 7
  menunjukkan kriteria #4 belum tercapai (keputusan #4); knob `HANOMAN_EVENTS_TICK_MS` tak disentuh.
- **Instrumen `HANOMAN_EVENTS_PROFILE=1`** (keputusan #5): per tick mencatat durasi `g.build()` per
  grup, ukuran frame mentah, apakah frame lahir, dan `monitorEventLoopDelay` (p50/p99/max, direset
  per interval laporan 10 dtk). Mati = nol alokasi, nol `hrtime` (gerbang boolean modul-level).

### S2.4 `shared/src/entities.ts` — `SpecListItem` & `SpecSlim`

Dua bentuk baru, **dirantai** dari `zSpec` dengan `.omit()` — bukan ditulis ulang — sehingga kolom
baru di `zSpec` terbawa otomatis dan tak ada peluang tiga definisi berselisih:

```ts
export const zSpecListItem = zSpec.omit({ payload: true, sourceHistory: true });   // GET /specs
export const zSpecSlim     = zSpecListItem.omit({ objective: true });              // frame WS
```

`objective` **ditahan** di `SpecListItem` karena tiap baris grid/list merendernya
(`BacklogScreen.tsx:656,695`); ia dibuang di `SpecSlim` karena kriteria sukses #1 menguncinya dan
karena baris daftar tak pernah merender dari frame WS (frame hanya di-*merge* ke item HTTP, §S2.6).

### S2.5 `server/src/routes/specs.ts` — `GET /specs/:id` baru + `GET /specs` dilangsingkan

Satu route baru (§S3.2). `GET /specs` mempertahankan envelope, filter, dan urutan ADR-0038, tetapi
`items`-nya dipetakan ke `SpecListItem` **setelah** `filterSpecs()` — bukan sebelum, karena
`filterSpecs` mencari `q` di `s.objective` (`routes/specs.ts:80`) dan pemetaan yang terlalu dini
akan mematikan pencarian secara senyap. `payload` dan `sourceHistory` dibuang di titik serialisasi
itu saja; `liveSpecs()`/`listSpecsLive()` tetap memuat baris penuh dari DB sehingga overlay,
write-through, dan notifikasi `done` tak tersentuh.

### S2.6a Klien — dampak `GET /specs` yang dilangsingkan

`SpecListParams`/`listSpecs` (`src/src/api/client.ts:271`) menjadi `Paginated<SpecListItem>`. Tiga
pemanggilnya (§S0.3a) tak ada yang membaca `payload`/`sourceHistory` dari hasil daftar; yang
membacanya adalah dialog detail, Change Source, dan riwayat konversi — ketiganya pindah ke
`GET /specs/:id` (§S2.6). State `backlog` di `App.tsx` karenanya bertipe `SpecSlim[]` saat datang
dari frame WS dan `SpecListItem[]` saat datang dari `load()` awal; keduanya disatukan sebagai
`SpecSlim` (irisan terkecil) supaya tak ada pembaca yang bisa bergantung pada `objective` yang
kadang ada kadang tidak.

### S2.6 Klien

| Berkas | Perubahan |
|---|---|
| `App.tsx:984` | `if (m.t === "specs") { setBacklog(m.specs); if (specsDigestOf(m.specs) !== lastDigest.current) { lastDigest.current = …; setDataVersion(v=>v+1); } }` — `specsDigestOf` murni atas `(id, stage, version, updatedAt)`, diuji unit |
| `App.tsx:1277-1303` | backlink audit `await api.getSpec(id)` untuk `objective`, bukan dari state `backlog` |
| `BacklogScreen.tsx:997-1000` | `mergeSlim(httpItem, slimItem)` — hanya field ringkas yang ditimpa; `payload`/`objective`/`sourceHistory` dari HTTP dipertahankan |
| `BacklogScreen.tsx:164,249,391,443` | detail dialog memuat `api.getSpec(id)` saat dibuka |
| `ChangeSourceDialog.tsx:32,47` | menerima spec penuh dari pemanggil (hasil `getSpec`), bukan dari state backlog |
| `TerminalScreen.tsx:98` | langganan `sessions` kedua dihapus; memakai prop dari `App` |
| `TerminalScreen.tsx:514-533` | pane tersembunyi: `write` ditahan di ring buffer; saat tampil, buffer dikuras, dan bila ring meluap → `resync` (§S4.4) |
| `TerminalScreen.tsx:520-527,779` | `React.memo` Cell/TerminalPane + handler stabil (`useCallback`/`useRef`); satu ticker 1 dtk bersama untuk seluruh `PhaseStrip` (context), bukan satu interval per sel |
| `TerminalPane.tsx:97-112` | `WebglAddon` dengan fallback DOM saat `loadAddon` melempar atau konteks hilang; `cursorBlink` hanya pane fokus |
| `TerminalPane.tsx:232` | interval 100 ms hanya hidup saat ada prediksi pending |
| `TerminalPane.tsx:522-528` | `ResizeObserver` di-debounce 100 ms + pesan `resize` didedup terhadap `{cols,rows}` terakhir yang dikirim |

## S3 — Kontrak data & API

### S3.1 Frame WS `specs` (kontrak BERUBAH)

Sebelum (`shared/src/dto.ts:816`):
```ts
| { t: "specs"; specs: Spec[] }
```
Sesudah:
```ts
| { t: "specs"; specs: SpecSlim[] }
```
`SpecSlim` = seluruh field `Spec` **kecuali** `payload`, `objective`, `sourceHistory`. Field turunan
`dependsOn` dan `blockedBy` **tetap** (kecil, dan dipakai board untuk badge terblokir).

Tanpa lapis kompatibilitas (keputusan #2): tak ada `specsFrame: 2`, tak ada penanda kapabilitas,
tak ada frame ganda. Dampak yang **wajib** tertulis di ADR baru:
- Klien lama + server baru (tab yang belum di-reload sesudah update, atau instance remote lewat hub
  berversi lain): subjudul/objective, badge payload, dan riwayat konversi kosong di layar Backlog —
  **tanpa error**, jadi ia tak terdiagnosis dari dalam dashboard. Penawar yang **sudah ada** adalah
  `ReloadBadge`/`trackServerVersion` (SPEC-868); ADR mencatatnya sebagai satu-satunya jalur keluar.
- Klien baru + server lama: `specs[i].objective` `undefined` di tempat yang sama. Parse tak gagal
  (`zSpecSlim` tak menuntut field yang dibuang), jadi gejalanya identik.

### S3.2 `GET /specs/:id` (BARU)

```
GET /specs/:id                            -> 200 Spec | 404 { error }
#   Spec PENUH (zSpec) termasuk payload/objective/sourceHistory, dependsOn, blockedBy.
#   Overlay stage-live diterapkan BACA-SAJA untuk item ini (stage yang tampil = stage yang sama
#   dengan yang dilihat GET /specs); write-through & notifikasi `done` TIDAK dijalankan di sini —
#   keduanya tetap milik jalur periodik (liveOverlayTick), supaya satu GET detail tak bisa
#   menggerakkan state backlog. Capability `backlog:read` (turunan prefix /specs per method,
#   tanpa peta baru — pola yang sama dengan /specs/:id/escalation).
```

### S3.3 `GET /specs` (kontrak BERUBAH — keputusan #3 opsi B)

Envelope `{items,total,page,pageSize}`, seluruh parameter query, semantik filter atas stage **live**,
dan larangan paginasi DB (ADR-0038) **tidak** berubah. Yang berubah hanya bentuk elemen `items`:

```
GET /specs?project=&source=&q=&stage=&priority=&startable=&dateField=&from=&to=&page=&limit=
   -> { items: SpecListItem[], total, page, pageSize }
#   SpecListItem = Spec TANPA `payload` dan `sourceHistory`. `objective` TETAP ADA — tiap baris
#   grid/list merendernya sebagai subjudul (BacklogScreen.tsx:656,695) dan `q` mencarinya.
#   Pemetaan terjadi SESUDAH filterSpecs() supaya pencarian `q` atas objective tak mati senyap.
#   Overlay + write-through + notifikasi `done` tetap berjalan atas baris PENUH di dalam liveSpecs.
#   Detail (payload, sourceHistory) dimuat per item lewat GET /specs/:id.
```

Dampak: full-fetch `App.tsx:941` (tanpa `page`/`limit`) turun dari ±3,8 MB menjadi ±0,3 MB pada DB
1069 baris (estimasi baseline: `payload` 2,64 MB + `sourceHistory` 0,17 MB dibuang, `objective`
0,85 MB ditahan — angka final wajib diukur di langkah 0/7, bukan dikutip dari sini). Tanpa
pelangsingan ini, kriteria sukses #5 hanya memindahkan muatan dari kanal WS ke kanal HTTP.

### S3.4 Frame WS `presence` (TIDAK berubah bentuknya)

Payload identik. Yang berubah hanya **signature dedup** di server (§S2.3) — perubahan perilaku, bukan
perubahan kontrak.

### S3.5 Digest dedup `specs`

```
specsDigest() = sha1( `${count}:${maxUpdatedAtMs}:${sumVersion}` + "|" + liveSignature() )
liveSignature() = sesi hidup diurut specId, tiap entri:
                  `${specId}:${faseAktif}` + (fase akhir "done" ? `:${planMtimeMs}:${planSize}` : "")
```
Tiga komponen DB mendeteksi: ubah baris (`updatedAt`+`version`), tambah baris (`count`), hapus baris
(`count`, dan `sumVersion` turun). Tumbukan yang mungkin — satu baris ditambah dan satu dihapus di
milidetik yang sama dengan `sum(version)` kebetulan sama — **tidak** menghasilkan frame; ia hilang
sampai perubahan berikutnya. Risiko diterima secara eksplisit: probabilitasnya butuh dua tulisan di
milidetik yang sama, dan tick berikutnya yang menyentuh baris mana pun memperbaikinya.

## S4 — Penanganan galat

| Kondisi | Perilaku |
|---|---|
| `listPanesShared()` menolak (tmux mati) | `sessionPhasesBySpecAsync()` mengembalikan peta **kosong** — persis kelunakan `pty.ts:1214-1218` hari ini: overlay forward-only, jadi peta kosong berarti "stage DB apa adanya", tak ada stage mundur, tak ada sesi dinyatakan berakhir |
| `specsDigest()` melempar (DB terkunci) | Grup dianggap **berubah** → frame dibangun. Fail-open: lebih baik satu frame berlebih daripada board beku |
| `liveOverlayTick()` melempar | Ditangkap di dalam `build()`; frame tetap dibangun dari state DB. Log sekali lewat gerbang `g.failing` yang sudah ada (`events.ts:234`) |
| Satu grup gagal di `Promise.allSettled` | Grup lain tetap disiarkan; `g.failing` menekan banjir log, pemulihan tetap mencetak `siar dashboard pulih` |
| `GET /specs/:id` id tak ada | `404 { error: "spec tak ditemukan" }` — bentuk galat yang sama dengan `PATCH /specs/:id` |
| Klien memanggil `getSpec` untuk item yang baru dihapus | `404` → dialog ditutup + toast, **bukan** layar kosong; daftar disegarkan dari `dataVersion` berikutnya |
| `WebglAddon` gagal dimuat / konteks WebGL hilang saat runtime | `dispose()` addon, jatuh ke renderer DOM, sekali per pane, tanpa toast — kegagalan grafis tak boleh jadi kegagalan terminal |
| `bufferedAmount` melewati plafon **1 MB** di kirim terminal | Byte baru **digabung** ke buffer tertunda; bila buffer tertunda melewati capnya, byte **terlama dibuang** dan pane ditandai `resync`. Delay berbatas ditukar dengan layar yang bisa melompat — keluhan asli SPEC-1267 adalah delay, dan `capture-pane` membuat layar selalu bisa dibenarkan. Coalescing PTY 16 ms/cap 64 KB **tak disentuh** |
| Pane tersembunyi, ring buffer **256 KB** meluap | Pane ditandai `resync`; saat ditampilkan, layar diisi ulang dari `capture-pane`/scrollback attach yang sudah ada alih-alih memutar buffer yang bolong. Ring dibuat **256 KB per pane** — cermin cap coalescing PTY yang sudah ada — supaya memori tetap konstan di mesin yang ADR-0161 akui bisa Mac mini 8 GB |
| `perMessageDeflate` (`app.ts:143-148`) | **Tidak disentuh** di langkah 1-6. Level 6 dan threshold tetap, untuk kanal events maupun frame terminal. Baik menurunkan level global maupun mematikannya untuk terminal mengorbankan hasil terukur SPEC-812 (aliran PTY 26× kompresibel, 966 → 36 kbit/dtk) demi tebakan. Ia baru boleh disentuh bila profil langkah 7 menunjukkan deflate benar-benar muncul sebagai biaya — dan perubahannya butuh pasangan angka sendiri |
| Klien lama menerima frame ringkas | Tak ada galat; lihat §S3.1 — gejala senyap, penawarnya `ReloadBadge` |

## S5 — Acceptance criteria (EARS)

Satu baris = satu hal yang dapat dicentang test atau angka. Penomoran AC-S mengikat ke kriteria
sukses fase Objective (#n).

**Frame `specs` (#1, #2)**
- AC-S1 — THE SYSTEM SHALL menyiarkan frame `specs` yang **tak memuat** field `payload`, `objective`,
  maupun `sourceHistory` pada satu pun elemen. *(test kontrak atas frame hasil `build()`)*
- AC-S2 — WHEN frame `specs` untuk 1069 spec disiarkan, THE SYSTEM SHALL menghasilkan muatan
  **≤ 5 %** ukuran frame baseline langkah 0, diukur mentah dan sesudah deflate. *(angka pasangan)*
- AC-S3 — WHILE isi tabel `Spec` dan berkas fase sesi tidak berubah, THE SYSTEM SHALL **tidak**
  melahirkan satu pun frame `specs` selama 60 dtk. *(hitung frame; baseline ≈ 60)*
- AC-S4 — WHEN satu baris `Spec` diubah, ditambah, atau dihapus, THE SYSTEM SHALL melahirkan **tepat
  satu** frame `specs` pada tick berikutnya. *(test `specsDigest` + test integrasi siar)*
- AC-S5 — THE SYSTEM SHALL menurunkan dedup grup `specs` dari `count` + `max(updatedAt)` +
  `sum(version)` + signature sesi hidup, dan SHALL NOT memakai `JSON.stringify` atas frame `specs`
  untuk tujuan dedup.

**Kemajuan stage tetap hidup (#10 — invarian yang paling mudah pecah)**
- AC-S6 — WHILE frame `specs` tidak lahir karena digest tak berubah, THE SYSTEM SHALL tetap
  menjalankan overlay stage-live, write-through CAS, `notifySynced`, dan `recordCompletion` pada
  setiap tick. *(test: sesi hidup + berkas fase maju → baris DB naik stage walau frame tak lahir)*
- AC-S7 — WHEN berkas plan sebuah sesi berhenti memuat `- [ ]` sehingga `stageForRun` membuka
  `done`, THE SYSTEM SHALL melahirkan frame `specs` pada tick berikutnya. *(komponen `planMtime` di
  `liveSignature`)*
- AC-S8 — WHEN `GET /specs` dipanggil, THE SYSTEM SHALL menghasilkan stage, notifikasi, dan
  persistensi yang **identik** dengan sebelum perubahan. *(test lama `advances + persists off-page
  specs even when paginated` hijau tanpa diubah)*

**Nol I/O sinkron di jalur periodik (#3)**
- AC-S9 — THE SYSTEM SHALL tidak memanggil `execFileSync`, `readFileSync`, `statSync`, maupun
  `readdirSync` pada jalur build grup `specs`, build grup `notifications`, reconcile scheduler,
  reaper worktree, lead pulse, maupun pembukaan/penyambungan-ulang WS terminal. *(test yang menyadap
  varian sinkron lalu menjalankan jalur itu, + grep)*
- AC-S10 — THE SYSTEM SHALL membangun `sessionPhasesBySpec` periodik di atas `listPanesShared()`
  sehingga presence, capacity, dan specs berbagi **satu** `tmux list-panes` per 1 dtk.
- AC-S11 — THE SYSTEM SHALL membaca setiap berkas fase **sekali** per tick 500 ms, dibagi
  `pollPhases` dan `paneComplete`. *(test: dua pemanggil, satu pembacaan)*
- AC-S12 — IF `tmux list-panes` gagal, THEN THE SYSTEM SHALL memperlakukan peta fase sebagai kosong
  dan SHALL NOT memundurkan stage mana pun maupun menyatakan sesi berakhir.

**Event loop & siar (#4)**
- AC-S13 — WHILE 4 pane terminal aktif, THE SYSTEM SHALL menunjukkan `monitorEventLoopDelay` p99 dan
  max **lebih rendah** dari baseline langkah 0; target p99 ≤ 50 ms dan max ≤ 100 ms, dan IF baseline
  sudah di bawah ambang itu, THEN kriterianya adalah **tidak memburuk**.
- AC-S14 — THE SYSTEM SHALL menyelesaikan `build()` grup `specs` dengan p95 ≤ 20 ms.
- AC-S15 — THE SYSTEM SHALL membangun grup yang jatuh tempo secara paralel dan terisolasi, sehingga
  satu grup yang melempar tidak menahan maupun membatalkan siaran grup lain. *(test: grup palsu
  melempar → grup lain tetap terkirim)*
- AC-S16 — WHEN klien baru terpasang saat loop hidup, THE SYSTEM SHALL mengirim snapshot dari
  `g.last` dan SHALL NOT membangun ulang grup itu.
- AC-S17 — THE SYSTEM SHALL menstringifikasi setiap frame **satu kali** per tick untuk dedup dan
  pengiriman.
- AC-S18 — WHERE `HANOMAN_EVENTS_PROFILE=1`, THE SYSTEM SHALL mencatat durasi build per grup, ukuran
  frame, apakah frame lahir, dan lag event loop; WHILE knob itu tak disetel, THE SYSTEM SHALL tidak
  mengambil satu pun pengukuran waktu.

**Klien tanpa refetch/re-render sia-sia (#5, #6, #7)**
- AC-S19 — WHILE isi frame `specs` tidak berubah, THE SYSTEM SHALL tidak menaikkan `dataVersion` dan
  SHALL NOT memanggil `GET /specs`. *(test unit fungsi digest klien + hitung request DevTools 60 dtk)*
- AC-S20 — WHEN daftar backlog dirender, THE SYSTEM SHALL menggabungkan item frame ringkas ke item
  hasil HTTP **hanya pada field ringkas**, dan SHALL NOT mengosongkan `payload`, `objective`, maupun
  `sourceHistory` yang berasal dari HTTP. *(test `mergeSlim`)*
- AC-S20a — THE SYSTEM SHALL menjawab `GET /specs` dengan `items` yang **tak memuat** `payload`
  maupun `sourceHistory`, dan yang **tetap memuat** `objective`. *(test kontrak route)*
- AC-S20b — WHEN `GET /specs?q=<kata>` dipanggil dan `<kata>` hanya muncul di `objective` sebuah
  spec, THE SYSTEM SHALL tetap memulangkan spec itu. *(pagar terhadap pemetaan yang terlalu dini —
  kegagalannya senyap)*
- AC-S20c — WHEN `GET /specs` dipanggil, THE SYSTEM SHALL menjalankan overlay, write-through, dan
  notifikasi `done` atas baris **penuh**, tak terpengaruh pelangsingan respons. *(AC-S8 berlaku
  tanpa perubahan)*
- AC-S21 — WHEN dialog detail backlog, Change Source, atau backlink audit dibuka, THE SYSTEM SHALL
  memuat spec penuh lewat `GET /specs/:id`.
- AC-S21a — THE SYSTEM SHALL menerapkan overlay stage-live **baca-saja** pada `GET /specs/:id`
  sehingga stage yang tampil di dialog sama dengan stage di baris daftarnya, dan SHALL NOT
  menjalankan write-through maupun notifikasi `done` dari route itu. *(test: sesi hidup berfase
  lebih maju → stage di respons maju, tetapi baris DB tak berubah dan nol notifikasi lahir)*
- AC-S22 — IF `GET /specs/:id` menjawab 404, THEN THE SYSTEM SHALL menutup dialog dan memberi toast,
  bukan menampilkan formulir kosong.
- AC-S23 — THE SYSTEM SHALL memproses frame `sessions` di **satu** tempat saja di klien.
- AC-S24 — WHILE hanya `lastSeenAt` device lokal yang berubah, THE SYSTEM SHALL tidak melahirkan
  frame `presence`; dan frame `presence` yang lahir SHALL tetap memuat `lastSeenAt` lokal yang
  mutakhir. *(dua assert: dedup ya, payload tak dipangkas)*

**Terminal (#8)**
- AC-S25 — WHEN `bufferedAmount` socket terminal melewati **1 MB**, THE SYSTEM SHALL menggabungkan
  byte keluaran ke buffer tertunda alih-alih terus mengantre, dan SHALL NOT mengubah coalescing PTY
  16 ms/cap 64 KB.
- AC-S25a — IF buffer tertunda itu sendiri melewati capnya, THEN THE SYSTEM SHALL membuang byte
  **terlama** dan menandai pane `resync`, sehingga delay kirim tetap berbatas sekalipun klien atau
  tunnel melambat tanpa batas. *(test: penulis lebih cepat dari pembaca → `bufferedAmount` tak
  tumbuh monoton)*
- AC-S26 — WHILE sebuah pane tersembunyi, THE SYSTEM SHALL tidak menulis maupun mem-parse keluaran
  ke instance xterm-nya, dan SHALL menahannya di ring buffer **256 KB** per pane; WHEN pane itu
  ditampilkan kembali, THE SYSTEM SHALL memulihkan layarnya utuh.
- AC-S26a — IF ring buffer pane tersembunyi meluap, THEN THE SYSTEM SHALL memulihkan layar dari
  `capture-pane`/scrollback attach yang sudah ada dan SHALL NOT memutar buffer yang bolong.
- AC-S26b — THE SYSTEM SHALL menjaga memori penahan pane tersembunyi **konstan** terhadap lama
  penyembunyian. *(pagar ADR-0161: mesin bisa Mac mini 8 GB)*
- AC-S27 — THE SYSTEM SHALL memakai renderer WebGL; IF WebGL tak tersedia atau konteksnya hilang,
  THEN THE SYSTEM SHALL jatuh ke renderer DOM tanpa memutus sesi.
- AC-S28 — THE SYSTEM SHALL menyalakan `cursorBlink` hanya pada pane yang sedang fokus.
- AC-S29 — THE SYSTEM SHALL memakai **satu** ticker 1 dtk untuk seluruh `PhaseStrip`, dan SHALL
  menjalankan timer 100 ms `TerminalPane` hanya WHILE ada prediksi yang tertunda.
- AC-S30 — THE SYSTEM SHALL men-debounce `ResizeObserver` dan SHALL NOT mengirim pesan `resize`
  ber-`{cols,rows}` yang sama dengan yang terakhir dikirim.
- AC-S31 — WHILE 4 pane aktif, THE SYSTEM SHALL menunjukkan CPU renderer lebih rendah dari baseline
  langkah 0 di profil Chrome yang sama.

**Bukti, invarian, docs (#9, #10, #11)**
- AC-S32 — THE SYSTEM SHALL disertai tabel baseline-versus-sesudah (durasi build per grup, lag event
  loop, frame `specs`/menit, `GET /specs`/menit, ukuran frame, CPU renderer 1 vs 4 pane) yang diukur
  pada skenario, DB, dan mesin yang sama; dan tak satu pun klaim perbaikan SHALL dibuat tanpa
  pasangan angkanya.
- AC-S33 — THE SYSTEM SHALL mempertahankan kuota `IMMEDIATE_PER_MIN`/`MAX_INFLIGHT`, satu WS events
  ber-ref-count, dan dedup siaran; dan SHALL NOT mengubah skema DB.
- AC-S33a — THE SYSTEM SHALL membiarkan konfigurasi `perMessageDeflate` (`app.ts:143-148`) apa
  adanya sampai profil langkah 7 menunjukkan deflate sebagai biaya nyata; dan IF ia kelak diubah,
  THEN perubahan itu SHALL dibawa pasangan angkanya sendiri terhadap hasil terukur SPEC-812.
- AC-S34 — THE SYSTEM SHALL menghidupkan kembali nol guardrail/poller/queue yang dicabut ADR-0024
  dan ADR-0039.
- AC-S35 — THE SYSTEM SHALL memperbarui `internal/docs/architecture/stack.md`,
  `internal/docs/architecture/api-contract.md` (route `GET /specs/:id` + kontrak frame `specs`),
  `internal/skills/hanoman/SKILL.md` (termasuk koreksi klaim "`GET /specs/:id` tidak ada" di
  baris 572 dan daftar sebelas grup di baris 85), dan ADR baru (amandemen ADR-0039/0145) di commit
  yang sama, tertaut dari `internal/docs/README.md`.

## S6 — Urutan pendaratan (untuk fase Plan)

0. Instrumen + baseline (AC-S18, AC-S32 sisi "sebelum").
1. `SpecSlim` + pecah `liveSpecs` + digest + frame ringkas (AC-S1…S8).
2. `GET /specs/:id` + `mergeSlim` + digest klien + langganan `sessions` tunggal (AC-S19…S23).
3. Async penuh jalur periodik (AC-S9…S12).
4. Siar paralel + `g.last` + stringify sekali + dedup presence (AC-S15…S17, S24).
5. Backpressure + kompresi (AC-S25).
6. Klien terminal (AC-S26…S31).
7. Ukur ulang + docs + ADR (AC-S32…S35).


## S7 — Keputusan fase Spec (dijawab manusia)

Ketujuh keputusan terbuka fase ini ditutup; seluruhnya sesuai rekomendasi. Sudah dirambatkan ke
§S2-§S5 di atas — daftar ini rekaman, bukan sumber kedua.

| # | Keputusan | Mendarat di |
|---|---|---|
| 1 | **Pecah `liveSpecs()`** menjadi `liveOverlayTick()` (efek, O(sesi hidup), tiap tick) + `listSpecsSlim()`/`listSpecsLive()` (penyajian, hanya saat digest berubah). `liveSpecs()` lama dipertahankan sebagai **komposisi** keduanya agar test SPEC-199/ADR-0038 yang ada tetap jadi pagar. | §S2.1, AC-S6…S8 |
| 2 | **`GET /specs/:id` memakai overlay stage-live baca-saja** — tanpa write-through, tanpa notifikasi `done`. Stage di dialog tak pernah berbeda dari stage di barisnya; satu GET detail tak bisa menggerakkan state backlog. | §S3.2, AC-S21a |
| 3 | **`GET /specs` dilangsingkan** (opsi B): `items` membuang `payload` + `sourceHistory`, **menahan** `objective`. Pemetaan sesudah `filterSpecs()`. Tiga call-site klien menyesuaikan (§S0.3a) — bukan `ProjectsScreen`/`PrdScreen`, yang tak memanggil `listSpecs`. | §S2.5, §S2.6a, §S3.3, AC-S20a…c |
| 4 | **Pane tersembunyi: ring 256 KB + resync `capture-pane` saat meluap.** Memori konstan dipilih di atas scrollback utuh (ADR-0161: mesin bisa Mac mini 8 GB). | §S4, AC-S26…S26b |
| 5 | **Backpressure: drop byte terlama + penanda resync, plafon `bufferedAmount` 1 MB.** Delay berbatas dipilih di atas byte utuh — keluhan aslinya delay, dan `capture-pane` selalu bisa membenarkan layar. | §S4, AC-S25, AC-S25a |
| 6 | **`perMessageDeflate` tidak diubah** sampai profil langkah 7 membuktikan deflate muncul sebagai biaya. Menurunkan level atau mematikannya untuk terminal mengorbankan hasil terukur SPEC-812 demi tebakan. | §S4, AC-S33a |
| 7 | **Kompatibilitas: ADR cukup mencatat** dampak klien lama; penawarnya `ReloadBadge`/`trackServerVersion` (SPEC-868). Ambang versi ditolak karena melanggar keputusan #2 fase Brainstorm yang sudah dikunci. | §S3.1, AC-S35 |

Dua konsekuensi keputusan #3 yang wajib dibawa fase Plan sebagai task tersendiri, karena keduanya
gagal **senyap** bila terlewat:

- **`q` mencari di `objective`** (`routes/specs.ts:80`). Memetakan `items` ke `SpecListItem`
  sebelum `filterSpecs()` akan mematikan pencarian tanpa satu pun error — AC-S20b adalah pagarnya.
- **State `backlog` klien menjadi `SpecSlim`** (irisan terkecil dari frame WS dan `load()` awal).
  Tanpa penyatuan tipe itu, `objective` kadang ada (sesudah `load()`) kadang tidak (sesudah frame
  WS pertama), dan pembaca yang bergantung padanya baru rusak beberapa detik setelah halaman dibuka
  — kelas bug yang paling mahal didiagnosis.

## Keputusan terbuka

-
