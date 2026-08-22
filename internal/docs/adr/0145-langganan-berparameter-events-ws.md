# ADR-0145 — Data realtime berparameter lewat langganan di `/events/ws`, bukan polling klien

**Status:** aktif (SPEC-908). **Mengamandemen [ADR-0039](0039-realtime-lewat-websocket-siar.md)** —
kanal siar tak lagi read-only, dan snapshot global bukan lagi satu-satunya bentuk frame.
**Menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) (tak ada queue/scheduler/worker
baru), [0087](0087-distribusi-npm-global-satu-perintah.md) (dashboard boleh lebih baru daripada server),
[0107](0107-paginasi-seragam-daftar-dashboard.md) (`limit` = plafon), [0115](0115-state-tampilan-dashboard-persisten.md),
[0134](0134-pengakuan-pengiriman-input-terminal.md) (socket terbuka ≠ fakta pengiriman),
[0014](0014-pty-terminal-di-proses-api.md)/[0016](0016-sesi-terminal-hidup-di-tmux.md) (kanal PTY tak disentuh).

## Konteks

ADR-0039 memindahkan polling dashboard dari klien ke server lewat satu WebSocket siar
(`GET /api/events/ws`, hub `services/events.ts`). Yang tercakup di sana **delapan grup snapshot
GLOBAL tanpa parameter**: `sessions`, `specs`, `notifications`, `cleanups`, `vps`, `limits`,
`codexLimits`, `update`.

Empat layar dashboard tak pernah ikut dan sampai SPEC-908 masih men-poll sendiri: Scheduler
(5 000 ms, plus empat seksi antrean yang disegarkan lewat penanda `nonce`), Triage (5 000 ms),
Lead (5 000 ms, tiga panggilan sekaligus), GitGraph (4 000 ms, tiga panggilan sekaligus). Tiap tab
membayarnya sendiri.

Akarnya bukan kelalaian melainkan batas desain ADR-0039, dan ada tiga:

1. Muatan keempat layar itu **fungsi dari parameter klien** (projectId, filter status/`q`, nomor
   halaman, opsi graph). `GROUPS` menghitung **satu** snapshot dan menyiarkan **string yang sama**
   ke semua klien.
2. Kanalnya **read-only secara harfiah**: `routes/events.ts` tak pernah memasang
   `socket.on("message")`, dan `Client` yang disimpan hub hanya `{send, close}` — **tak ada state
   per-koneksi** di mana pun.
3. Skip "tak ada yang butuh" bekerja di **level loop** (`stopLoop()` saat klien terakhir lepas),
   bukan per-grup.

## Keputusan

Kanal `/api/events/ws` menerima **satu** jenis frame masuk, dan hub menyimpan **state langganan
per-klien**.

- **Frame masuk tunggal** `{t:"sub", subs:[{topic, params}]}`, semantik **ganti-penuh**: frame ini
  mengganti seluruh himpunan langganan klien. Karena itu tak ada frame `unsubscribe` yang bisa
  hilang, dan re-kirim saat reconnect identik dengan pemasangan pertama (idempoten by construction).
- **Lima topik**, masing-masing = satu muatan yang dimuat sebuah layar dalam **satu** tarikan,
  cermin `load()`-nya: `schedulerState`, `schedulerQueue`, `tickets`, `lead`, `git`. Nama topik
  **identik** dengan `t` frame keluarnya — satu-ke-satu, jadi tak ada peta kedua yang bisa
  berselisih. `lead` dan `git` sengaja **dibundel** (status+decisions+flows, graph+status+stashes):
  keduanya hari ini satu `Promise.all` yang menyetel tiga state sekaligus, dan tiga frame terpisah
  akan menampilkan campuran dua generasi data yang hari ini tak mungkin terjadi.
- **`key` dihitung KEDUA sisi** lewat fungsi murni `subKey(topic, params)` di `@hanoman/shared`.
  Kalau id datang dari klien, dua tab berparameter identik menerima frame yang **berbeda byte** dan
  dedup signature ADR-0039 hilang; dengan kunci turunan-parameter keduanya menerima string yang
  sama persis — satu `build`, satu `JSON.stringify`.

### Alternatif yang ditolak

- **Invalidasi/versi** — server menyiarkan "domain X berubah, versi V", klien memuat ulang query
  berparameternya sendiri sekali lewat HTTP. Lebih murah dan menjaga kanal tetap read-only, tetapi
  menyisakan satu round-trip HTTP di tiap perubahan dan **menggandakan sumber kebenaran bentuk
  muatan** (versi dihitung di satu tempat, datanya di tempat lain — dua hal yang bisa berselisih
  diam-diam). Untuk domain termahal (git per project) versinya praktis **sama mahalnya dengan
  datanya**: menentukan "apakah graph berubah" berarti membaca HEAD + seluruh ref + status kotor,
  yaitu hampir seluruh `ideStatus`.
- **Invalidasi murni tanpa frame masuk**, versi git diturunkan dari mtime `.git/**` — ditolak
  karena biayanya tumbuh mengikuti **jumlah project terdaftar**, bukan yang ditonton; mtime
  `.git/index` berubah karena `git status` yang kita jalankan sendiri sehingga berisiko **loop
  muat-ulang**; dan keadaan kotor/bersih working tree **tak tertangkap sama sekali** oleh mtime ref.

## Pagar biaya

Constraint SPEC-908 melarang menaikkan biaya per-tick secara buta. Tujuh pagar, dan dua terakhir
lahir dari review keamanan yang **mengukur** jalurnya:

1. **Hanya parameter yang benar-benar ada pelanggannya yang dihitung.** Entri lahir dari frame
   `sub` dan **mati saat pelanggan terakhirnya lepas**. Langganan hidup hanya selama layarnya
   ter-mount, dan satu tab hanya membuka satu layar.
2. **Dedup signature dipertahankan** — mekanisme `Group.last` yang sudah ada, per entri.
3. **Satu hitungan untuk N klien**, konsekuensi `key` turunan-parameter.
4. **Kadens per-topik**, semuanya ≤ kadens polling yang digantikannya: `schedulerState` 2 dtk ·
   `schedulerQueue` 3 dtk · `tickets` 3 dtk · `lead` 4 dtk · `git` 4 dtk (dulu 5/5/5/5/4 dtk).
5. **Tak pernah memblokir event loop.** `runEntry` di-tick di `__tick()` yang sama tetapi **tidak
   di-`await`**, dan semua `build` wajib async — `listSessions()` ber-`execFileSync` (terukur
   6,28 ms sampai 916 ms saat mesin sibuk) diganti `listSessionsAsync` di jalur ini, sekaligus di
   `GET /scheduler/state` dan `GET /lead/status`.
6. **`MAX_INFLIGHT` = 4 build serentak di seluruh hub.** `e.inflight` sendirian hanya men-dedup DI
   DALAM satu entri, dan entri baru selalu lahir `inflight:false`; terukur, **32 `buildGitLive`
   serentak (5 spawn git masing-masing) menahan event loop 505 ms** — event loop yang sama yang
   melayani PTY terminal, kelas regresi SPEC-812/878.
7. **Jatah 30 build-di-luar-jadwal per menit per klien.** Semantik ganti-penuh membuat tiap frame
   `sub` bisa memperkenalkan 16 kunci "baru" lagi, sehingga kuota 120 frame/menit terukur menjadi
   **1 920 build/menit dari satu socket** (≈160 fork `git`/dtk). Entri yang kehabisan jatah **tidak
   hilang** — ia menunggu slot `everyTicks`-nya seperti entri lain.

## Permukaan masuk

- **Hanya principal cookie yang boleh berlangganan** (`canSubscribeTopics`, `kind === "user"`; plus
  `"test"` di bawah `NODE_ENV=test`). Alasannya bukan kehati-hatian umum: `/events/ws` dipetakan ke
  capability **`GLOBAL_READ`** untuk agent token (ADR-0065), sementara topik langganan menyentuh
  domain `support`, `lead`, dan `ide` — tanpa gerbang ini satu agent token ber-read global
  memperoleh baca ke tiga domain yang tak diberikan kepadanya. Dashboard satu-satunya konsumen,
  jadi nol fungsi hilang. Kedelapan grup lama tetap dilayani untuk principal mana pun.
- **Batas bentuk:** `MAX_WS_MESSAGE_BYTES` 64 KiB (frame lebih besar → close 1009), `subs` ≤ 16,
  parameter zod `.strict()` (kunci asing ditolak, bukan diabaikan), `limit` dijepit ke plafon yang
  sama dengan route HTTP-nya (ADR-0107 — untuk `git` plafon topik justru lebih ketat daripada
  route HTTP yang tak punya batas atas sama sekali), `WsMessageGuard` 120 frame/menit.
- **Topik tak dikenal dilewati PER-ENTRI**, bukan menjatuhkan frame: dashboard boleh lebih baru
  daripada server (ADR-0087), jadi frame yang memuat topik masa depan tetap memasang topik yang
  dikenal.
- **Auth tak dilonggarkan:** `admitBrowserWs` + `revalidateWsPrincipal` 60 dtk apa adanya.
- Portal klien (`User.role === "client"`) tertutup **di lapisan lain** — allowlist `clientRouteAllowed`
  menolak `/api/events/ws` **dan** `/api/ws-tickets` sebelum upgrade. `canSubscribeTopics` sendiri
  **tidak** membedakan role, jadi kalau allowlist itu suatu hari membuka `events`, satu akun klien
  langsung memperoleh baca ke `tickets`/`lead`/`git` lintas project. Dicatat di komentar fungsinya.

## Degradasi

Server mengirim `{t:"hello", topics}` saat attach. **Server lama tak mengirim frame ini sama
sekali — ketiadaannya itulah sinyalnya** (ADR-0087). Klien menyalakan `setInterval` fallback hanya
pada dua keadaan yang bisa **dibuktikan**:

1. `hello` sudah tiba **dan** topiknya tak ada di dalamnya → server ini memang tak punya.
2. Socket belum pernah mengantar satu frame pun selama 15 dtk → WS terhalang (proxy yang menolak
   upgrade) padahal HTTP hidup.

Selama WS sehat: **nol `setInterval` dan nol request HTTP berkala**. Saat WS putus sesaat tak ada
polling — reconnect ber-backoff yang sudah ada memulihkan data lewat muatan-pertama-seketika, dan
operator melihat `LiveConnectionBadge` sesudah grace 6 dtk. `paused` (tab tersembunyi; socket
ditutup **atas permintaan kita**) bukan gangguan dan tak pernah memunculkan indikator.

## Konsekuensi

- **Satu definisi per muatan.** Body enam route diekstrak ke service (`scheduler/state.ts`,
  `scheduler/queue.ts`, `tickets-list.ts`, `lead/views.ts`, `git-ide.ts`, `repo-dir.ts`) dan
  dipanggil route **dan** hub. Menyalin serializer ke call site kedua adalah kelas bug
  SPEC-431/448/475.
- **`GraphCommit`/`RepoStatus`/`Stash` pindah ke `@hanoman/shared`** — ketiganya dulu dideklarasikan
  KEMBAR di `services/git-ide.ts` dan `api/client.ts` tanpa ikatan tipe apa pun.
- **`WireMsg` disempitkan pada `t`-nya.** Sebelumnya `{ t: string; … }`, sehingga `t` salah ketik
  lolos typecheck server lalu jatuh senyap di klien (`m.t === …` tak pernah cocok) — dan migrasi ini
  menambah enam varian di bawah tipe yang sama.
- **Penanda `nonce` SPEC-523 dicabut**: tiap `QueueSection` berlangganan (status, halaman)-nya
  sendiri.
- **Endpoint HTTP tak ada yang dihapus** — MCP, agent token, portal klien, dan dashboard lama
  memakainya; ia juga tetap jalur muat awal dan fallback.
- **Kuota koneksi tak naik**: semua langganan multipleks di socket `/events/ws` yang sudah ada.

## Plafon yang diketahui

- **`buildTicketsPage` masih memuat seluruh tabel `Ticket`** lalu menyaring `q` di memori
  (`findMany` tanpa `take`). Amplifikasi terburuknya sudah ditutup — `q` yang menyuapi kunci
  langganan di-debounce 400 ms, jadi mengetik tak lagi melahirkan satu entri (satu scan) per huruf —
  tetapi biaya steady-state tetap satu scan per 3 dtk selama layar Triase terbuka, dan skalanya
  ikut jumlah tiket. Memindahkan `q` ke `where` dengan `take`/`skip` adalah perbaikan terpisah;
  ia **mengubah semantik pencarian** (`LIKE` SQLite case-insensitive hanya untuk ASCII, wildcard
  `%`/`_` di dalam `q` jadi bermakna, dan pencarian tak lagi menjangkau batas antara judul dan
  email), jadi ia butuh keputusannya sendiri.
- Satu layar Scheduler membuka **lima** langganan (state + empat seksi antrean). Plafon 16 memberi
  ruang; frame `sub` yang ter-coalesce di microtask menjaga jumlah frame masuk tetap satu.
- `WsMessageGuard` memakai jendela **fixed**, bukan sliding, dan `POST /api/ws-tickets` tak
  dibatasi laju — jadi 120 frame/menit adalah polisi tidur, bukan plafon keras. Yang benar-benar
  mengikat kerja adalah pagar 6 & 7 di atas.
