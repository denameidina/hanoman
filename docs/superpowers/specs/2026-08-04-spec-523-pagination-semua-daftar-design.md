# SPEC-523 — Pagination pada semua daftar

**Tanggal:** 2026-08-04 · **Sumber:** brief · **Prioritas:** sedang
**ADR baru:** ADR-0107 (memperluas [ADR-0038](../../../internal/docs/adr/0038-paginasi-di-response-layer.md))

## Masalah

Sebagian daftar utama dashboard memuat seluruh baris sekaligus atau memakai plafon hardcode,
sehingga data lama tak terjangkau dan render melambat saat data tumbuh.

Pola paginasinya **sudah ada** dan sudah diputuskan: amplop `Paginated<T>` =
`{ items, total, page, pageSize }` + query `page`/`limit`, dipotong di **layer response**
(ADR-0038), dengan `serverPage()` + `<Pager>` di design system (`src/src/ds/kit.tsx`).
Yang belum ada adalah **jangkauannya**: pola itu baru dipakai dua daftar dari belasan.

Pekerjaan ini karena itu **meratakan pola yang sudah ada**, bukan menemukan pola baru.

## Audit — keadaan terukur sebelum implementasi

Constraint brief mensyaratkan audit dulu. Dijalankan atas `server/src/routes/**`,
`src/src/screens/**`, dan DB instalasi hidup (`~/.hanoman/hanoman.db`, 2026-08-04).

### Sudah berhalaman penuh (server + `Pager`)

| Daftar | Endpoint | Bukti |
|---|---|---|
| Backlog | `GET /specs` | `specs.ts:93` `paginate(...)`; `BacklogScreen.tsx:774` `serverPage` |
| Project | `GET /projects` | `projects.ts:29` `paginate(...)`; `ProjectsScreen.tsx:127` `<Pager>` |

### Server sudah, UI belum memakainya

| Daftar | Cacat | Bukti |
|---|---|---|
| Tiket | memanggil tanpa `page`/`limit` → **seluruh baris** dimuat | `TriageScreen.tsx:326` |
| Changelog | memanggil `{limit: 10}` **tanpa `page`** → item ke-11 dst **permanen tak terjangkau** | `ChangelogPanel.tsx:30` |
| Sesi/history | amplop lengkap, tapi UI memakai "muat lebih" (append), bukan `Pager` | `SessionHistoryModal.tsx:40,62` |

### Belum berhalaman sama sekali

| Daftar | Cacat | Baris di DB hidup |
|---|---|---|
| **Notifikasi** | `take: 50` hardcode, tanpa `page`/`limit`/`total` | **287** → 237 (82 %) tak terjangkau |
| **Lead decisions/flows** | `take`/`skip` (bukan `page`/`limit`), balasan `{items}` **tanpa `total`** | **393** decisions |
| **Scheduler** | `queue` penuh ikut di dalam `GET /scheduler/state`, difilter jadi 3 daftar di klien | **56** |
| **GitHub issues** | `{items}` polos | 9 |

Bukti: `notifications.ts` `notificationsFeed()` `take: 50`; `lead.ts:71,86` +
`lead/trail.ts:88` / `lead/flow.ts:95` `take: Math.min(f.take ?? 50, 200)`;
`scheduler.ts:39` `queue` utuh, `SchedulerScreen.tsx:268-271` filter klien;
`github-issues.ts:59-63` `findMany` tanpa batas.

### Tak berlaku seperti tertulis di objective

| Disebut objective | Keadaan sebenarnya |
|---|---|
| **Error** | Modul error monitoring **dicabut** ADR-0092 / SPEC-384. `grep "/errors"` di seluruh `server/src/routes` → kosong. Tak ada yang bisa dihalamankan. |
| **PRD / docs** | `GET /projects/:id/docs` mengembalikan **pohon** (`{coverage, tree: DocCat[]}`, `services/scan.ts:9`) untuk file-tree + skor coverage — bukan daftar rata. `GET /prds` = daftar dokumen di direktori, dikelompokkan per project di UI. Memenggal pohon memutus navigasinya. |
| **Git graph** | Premis brief ("limit hardcode 200") **usang**. SPEC-351 sudah menggantinya dengan **jendela tumbuh**: `GitGraph.tsx:276` menaikkan `limit` 200 tiap kali, dipicu `IntersectionObserver` (`moreRef`, baris 164). Seluruh riwayat sudah terjangkau; 200 kini ukuran langkah, bukan plafon. |

## Keputusan

### K1 — Satu amplop, satu paginator, tanpa pola baru

Setiap daftar utama menerima `page`/`limit` dan mengembalikan `Paginated<T>`.
Tanpa `limit` → perilaku lama dipertahankan (ADR-0038: "tanpa limit → seluruh item"),
kecuali notifikasi (lihat K2) yang plafon lamanya memang disengaja.

UI memakai `serverPage()` + `<Pager>` dari `ds/kit.tsx` apa adanya. **Tidak ada komponen
paginator baru** — design system sudah punya satu, dan menambah yang kedua persis
melahirkan inkonsistensi yang mau dihapus objective ini.

### K2 — Notifikasi: bell tetap live, arsip yang berhalaman

Notifikasi punya satu permukaan: dropdown bell 320 px yang datanya **didorong WebSocket siar**
tiap 3 detik (`services/events.ts` grup `notifications`), bukan HTTP. Menambah `page`/`limit`
ke `GET /notifications` sendirian karena itu **tidak** memberi bell halaman.

- `notificationsFeed()` **tetap** `take: 50` bila dipanggil tanpa argumen → frame WS tak berubah
  bentuk daftarnya. Menyiarkan 287 baris tiap 3 detik adalah regresi biaya, bukan perbaikan.
- Ia ditambah `total` (hitungan penuh) → bell bisa mengatakan "50 dari 287" alih-alih berbohong
  bahwa 50 itu semuanya.
- `GET /notifications?page&limit` memakai `skip`/`take` DB + `count()` → amplop `Paginated`
  ditambah `unread`.
- Permukaan baru: **modal "Semua notifikasi"** ber-`Pager`, dibuka dari kaki dropdown bell.
  Cermin `SessionHistoryModal`. Bell tak jadi dua-sumber-data; halaman 2+ hidup di modal.

`skip`/`take` di query DB **sah** di sini: notifikasi adalah baris mati tanpa overlay —
larangan ADR-0038 mengikat `GET /specs` yang overlay-nya bergantung set penuh, bukan semua daftar.

### K3 — Scheduler: antrean jadi endpoint daftar sendiri

`GET /scheduler/state` **berhenti** mengirim `queue` penuh. Ia mengirim `queueCounts`
(`{queued, launched, done, failed}`) yang dihitung server.

Endpoint baru `GET /scheduler/queue?status&page&limit` → `Paginated<SchedulerQueueItemView>`.
`SchedulerScreen` mengambil tiga daftar berhalaman terpisah (antrean / selesai / gagal),
masing-masing ber-`Pager`.

Ini **perubahan kontrak yang menghapus field** — disengaja dan dicatat di ADR + api-contract.
Alternatif "kirim `queue` yang dipotong diam-diam" ditolak: daftar terpotong yang tampak utuh
persis kelas bug yang sudah menggigit repo ini berulang kali (SPEC-431/451/475).
`state.sessions` tetap dihitung server dari query DB, bukan dari array yang dikirim,
jadi ia tak ikut terpengaruh.

Konsumen `state.queue` hanya `SchedulerScreen.tsx:268-271` dan `server/test/scheduler.route.test.ts`.

### K4 — Lead: `page`/`limit` ditambahkan, `take`/`skip` tidak dicabut

`GET /lead/decisions` & `GET /lead/flows` menerima `page`/`limit` **selain** `take`/`skip`
dan mengembalikan `Paginated<T>` (menambah `total`/`page`/`pageSize`; `items` tetap).
Aditif → pemanggil internal (`runChain`, `decide`) dan agen ber-token tak ada yang patah.

`listDecisions`/`listFlows` mengembalikan `{ rows, total }`; `total` dari `count()` dengan
`where` yang sama. `LeadScreen` mendapat `Pager` untuk kedua daftar.

Bila **keduanya** dikirim, `page`/`limit` menang — bentuk baru adalah kontrak yang dituju;
`take`/`skip` bertahan hanya sebagai kompatibilitas.

### K5 — Git graph: jendela dipertahankan, sisa dinyatakan

Graph **tidak** dikonversi ke halaman diskrit. Lane dihitung dari daftar commit **kontigu**
(`git-graph-render.ts` `computeLanes`); halaman diskrit memutus tautan induk–anak di batas
halaman (commit induk di halaman berikutnya kehilangan garisnya) dan mencabut auto-scroll SPEC-351.

Yang ditambahkan: `total` (`git rev-list --count` atas ref yang sama dengan `listGraph`) →
UI menuliskan "N dari T commit" di baris muat-lebih, sehingga plafon yang tak terlihat
tak lagi terbaca sebagai "riwayat habis".

Ini **pengecualian sadar** dari K1, dinyatakan di ADR-0107 berikut alasannya — bukan daftar
yang kelewat.

### K6 — Sesi/history: muat-lebih → `Pager`

`SessionHistoryModal` mengganti tombol "Muat lebih" (append) dengan `<Pager>`: halaman
**mengganti** isi. Servernya sudah beramplop penuh — perubahan murni di UI.

### K7 — Daftar yang tak berlaku dinyatakan, bukan didiamkan

Error (dicabut ADR-0092), PRD/docs (pohon, bukan daftar rata), dan git graph (pengecualian K5)
ditulis eksplisit di ADR-0107. Objective menyebut sepuluh daftar; tiga di antaranya tak bisa
dipenuhi apa adanya, dan alasannya harus terbaca supaya audit berikutnya tak "memperbaikinya".

## Acceptance criteria (EARS)

**Kontrak amplop**
- AC-1 — THE SYSTEM SHALL menjawab setiap endpoint daftar utama (`/specs`, `/projects`,
  `/tickets`, `/notifications`, `/terminal/history`, `/scheduler/queue`, `/lead/decisions`,
  `/lead/flows`, `/projects/:id/changelog`, `/projects/:id/github/issues`) dengan amplop
  `{ items, total, page, pageSize }`.
- AC-2 — WHEN permintaan membawa `page` dan `limit`, THE SYSTEM SHALL mengembalikan paling
  banyak `limit` item dan `total` yang menghitung **seluruh** baris tersaring, bukan halaman itu.
- AC-3 — IF `page` melampaui halaman terakhir, THEN THE SYSTEM SHALL mengembalikan `items: []`
  dengan `total` yang tetap benar (bukan galat).

**Notifikasi**
- AC-4 — WHEN `GET /notifications` dipanggil **tanpa** `limit`, THE SYSTEM SHALL mengembalikan
  50 notifikasi terbaru — persis seperti sebelum perubahan ini.
- AC-5 — THE SYSTEM SHALL menyertakan `total` (hitungan penuh) pada frame siar WebSocket
  `notifications` maupun pada balasan HTTP.
- AC-6 — THE SYSTEM SHALL menghitung `unread` dari seluruh baris belum terbaca, tak pernah
  dari halaman yang sedang ditampilkan.
- AC-7 — WHEN operator membuka "Semua notifikasi" dan menekan halaman berikutnya, THE SYSTEM
  SHALL **mengganti** isi daftar dengan halaman itu.

**Scheduler**
- AC-8 — THE SYSTEM SHALL mengembalikan `queueCounts` per status pada `GET /scheduler/state`
  dan tidak lagi mengembalikan `queue`.
- AC-9 — WHEN `GET /scheduler/queue` dipanggil dengan `status`, THE SYSTEM SHALL menyaring
  di query DB, bukan di klien.

**Lead**
- AC-10 — WHEN permintaan `GET /lead/decisions` atau `/lead/flows` membawa `take`/`skip` saja,
  THE SYSTEM SHALL berperilaku persis seperti sebelum perubahan ini.
- AC-11 — IF permintaan membawa `page`/`limit` **dan** `take`/`skip`, THEN THE SYSTEM SHALL
  memakai `page`/`limit`.

**Git graph — pengecualian yang dinyatakan**
- AC-12 — THE SYSTEM SHALL mempertahankan jendela tumbuh SPEC-351 pada git graph dan tidak
  memecahnya jadi halaman diskrit.
- AC-13 — THE SYSTEM SHALL menyertakan `total` commit terjangkau pada balasan graph, dan UI
  SHALL menampilkan "N dari T commit" di baris muat-lebih.

**Perilaku UI bersama**
- AC-14 — WHILE `total ≤ pageSize`, THE SYSTEM SHALL tidak merender kontrol halaman.
- AC-15 — WHEN operator mengubah filter sebuah daftar, THE SYSTEM SHALL kembali ke halaman 1.
- AC-16 — THE SYSTEM SHALL memakai komponen `Pager` design system pada setiap daftar berhalaman —
  tak ada paginator kedua.

## Bentuk perubahan

### Server

| Berkas | Perubahan |
|---|---|
| `services/notifications.ts` | `notificationsFeed(p?)` → `{items, unread, total, page, pageSize}`; tanpa `p` → `take: 50` seperti sekarang |
| `routes/notifications.ts` | teruskan `page`/`limit` dari query |
| `routes/scheduler.ts` | `state`: `queue` → `queueCounts`; endpoint baru `GET /scheduler/queue` |
| `services/scheduler/queue.ts` | `listQueue` ber-filter/`skip`/`take` + `countQueue` |
| `routes/lead.ts` | `page`/`limit` → amplop `Paginated` untuk `decisions` & `flows` |
| `services/lead/trail.ts`, `services/lead/flow.ts` | kembalikan `{rows, total}` |
| `routes/github-issues.ts` | `page`/`limit` → amplop `Paginated` |
| `routes/ide.ts` + `services/git-ide.ts` | `listGraph` mengembalikan `total` di samping `{commits, current}` |

### Shared

| Berkas | Perubahan |
|---|---|
| `dto.ts` | `zSchedulerState`: `queue` → `queueCounts`; bentuk feed notifikasi (+`total`) |
| `api.ts` | path `schedulerQueue` |

### Web

| Berkas | Perubahan |
|---|---|
| `notifications/NotificationsArchiveModal.tsx` | **baru** — daftar ber-`Pager` |
| `notifications/NotificationBell.tsx` | kaki "Lihat semua (T)" → modal |
| `notifications/NotificationsContext.tsx` | teruskan `total` |
| `screens/TriageScreen.tsx` | `page` state + `<Pager>` untuk tiket **dan** issue GitHub |
| `screens/ChangelogPanel.tsx` | `page` state + `<Pager>` |
| `screens/SchedulerScreen.tsx` | tiga daftar berhalaman dari endpoint baru |
| `screens/LeadScreen.tsx` | `<Pager>` untuk keputusan & rantai |
| `screens/SessionHistoryModal.tsx` | muat-lebih → `<Pager>` |
| `screens/GitGraph.tsx` | label "N dari T commit" |
| `api/client.ts` | metode/params yang menyertainya |

## Test

TDD per daftar — test merah dulu, lalu implementasi.

**Server (`server/test/`)**
- `pagination-contract.test.ts` **baru**: satu test yang menembak setiap endpoint daftar utama
  dengan `?page=1&limit=1` dan menegakkan amplop `{items, total, page, pageSize}` **serta**
  `items.length <= 1`. Daftar endpointnya konstanta di berkas test — daftar baru yang lupa
  dihalamankan tak lolos diam-diam.
- `notifications.route.test.ts`: tanpa `limit` → 50 teratas + `total` penuh (frame WS tak berubah);
  dengan `page=2&limit=10` → potongan yang benar; `unread` dihitung dari set penuh, bukan halaman.
- `scheduler.route.test.ts`: `state` tak lagi punya `queue`, punya `queueCounts` yang benar;
  `GET /scheduler/queue?status=queued` berhalaman & tersaring.
- `lead.route.test.ts`: `page`/`limit` → amplop + `total`; `take`/`skip` lama masih jalan;
  keduanya dikirim → `page`/`limit` menang.
- `github-issues.route.test.ts`: amplop + `total`.
- `ide.route.test.ts`: `graph` membawa `total` ≥ `commits.length`.

**Web (`src/test/`)** — ingat: `env -u NODE_ENV` (memori repo).
- `NotificationsArchiveModal.test.tsx`: klik halaman → fetch `page` naik, isi **berganti**.
- `TriageScreen` / `ChangelogPanel` / `SchedulerScreen` / `LeadScreen` / `SessionHistoryModal`:
  `Pager` terender saat `total > pageSize`, klik memanggil API dengan `page` yang benar,
  isi berganti (bukan bertambah).

**Kontrol negatif yang wajib ada:** untuk `ChangelogPanel`, test yang gagal pada kode hari ini
karena `page` tak pernah dikirim — bukan sekadar test yang lulus di kedua sisi.

## Docs yang tersentuh (commit yang sama)

- `internal/docs/adr/0107-paginasi-seragam-daftar-dashboard.md` — **baru**
- `internal/docs/architecture/api-contract.md` — notifications, scheduler, lead, github issues, graph
- `internal/docs/README.md` + `internal/docs/adr/README.md` — tautan ADR-0107
- `docs/agent-integration.md` — bila menyebut bentuk daftar yang berubah

## Non-goal

- Filter/pencarian baru di daftar mana pun (paginasi saja).
- Mengubah `GET /specs` atau `GET /projects` — sudah benar sejak ADR-0038.
- Menghalamankan pohon docs, webhook deliveries, telegram audit, session-results,
  custom agents, VPS checklist — bukan "daftar utama dashboard".
- Infinite scroll di daftar mana pun selain git graph yang sudah punya.
- Plafon `limit` server-side (`paginate()` hari ini tak berbatas). Dicatat sebagai *ponytail*:
  bila agen mulai meminta `limit=999999`, jepit di `paginate()` — satu tempat, tanpa ADR baru.
