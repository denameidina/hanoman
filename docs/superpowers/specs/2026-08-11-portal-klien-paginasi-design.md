# SPEC-647 — Pagination di portal klien (daftar backlog & tiket)

- Tanggal: 2026-08-11
- Backlog: SPEC-647 (source `brief`, prioritas sedang)
- Menerapkan: ADR-0107 (paginasi seragam) ke permukaan portal ADR-0110/0111. **Tanpa ADR baru.**

## Masalah

ADR-0107 (SPEC-523) menyeragamkan paginasi **seluruh daftar utama dashboard operator**. Portal
klien lahir sesudahnya (SPEC-617, ADR-0110) dan tak ikut terjaring — bukan karena servernya
belum siap, melainkan karena **kliennya tak pernah meminta halaman**:

- `server/src/routes/portal.ts:44` & `:62` sudah membaca `page`/`limit` dan membalas `paginate()`
  → amplop `Paginated`. Kontraknya lengkap.
- `src/src/api/portal.ts:16` & `:18` memanggil kedua endpoint itu **tanpa query sama sekali**.
- `server/src/services/paginate.ts`: tanpa `limit`, `pageSize = total` → satu respons memuat
  **seluruh** baris.
- `ClientPortal.tsx:110` & `:128` me-`map` seluruh `items` ke DOM sekaligus.

Jadi bentuk hari ini: server berhalaman, klien meminta "semua", UI merender semuanya. Begitu
backlog atau tiket sebuah project tumbuh, layar klien jadi daftar tanpa ujung dan render melambat
— masalah yang identik dengan yang sudah dibereskan di sisi operator.

## Temuan yang mengubah bentuk solusi

**1. Angka di tab akan berbohong kalau ikut dipenggal.** `ClientPortal.tsx:99-100` mengisi
`count` tab dari `backlog.length` / `tickets.length`. Begitu `items` cuma satu halaman, angka itu
berubah dari "jumlah pekerjaan" menjadi "jumlah baris yang kebetulan tampil" — persis kelas
kebohongan yang ADR-0107 tolak untuk lencana bell ("`unread` selalu dihitung dari seluruh baris,
tak pernah dari halaman yang diminta"). Sumbernya wajib `total` dari amplop, dan itu satu-satunya
alasan **kedua** daftar tetap dimuat bersama meski hanya satu yang tampak.

**2. `limit` tanpa `page` adalah plafon, bukan halaman.** Jebakan terukur SPEC-523 (changelog:
item ke-11 permanen tak terjangkau). Pencegahannya di sini **struktural**, bukan disiplin:
`api/portal.ts` menerima satu argumen `{page, limit}` yang tak bisa dikirim setengah, dan satu
helper yang selalu memancarkan kedua parameter.

**3. Kirim keluhan dari halaman 2 akan menyembunyikan tiketnya sendiri.** `onSent`
(`ClientPortal.tsx:154`) memuat ulang daftar tiket. Tiket baru duduk paling atas (`orderBy
createdAt desc`), jadi memuat ulang **di halaman yang sedang aktif** membuat tiket yang baru
dikirim tak terlihat kalau klien sedang di halaman 2 — regresi baru yang lahir bersama paginasi.
Pengiriman karena itu memaksa halaman tiket kembali ke 1.

**4. Respons yang datang terlambat bisa menimpa halaman yang lebih baru.** Klik halaman
beruntun melahirkan dua `Promise.all` yang tak dijamin selesai berurutan. Hari ini portal tak
punya penjaga apa pun (`loadLists` langsung `setState`). Dengan paginasi, kelas bug itu jadi
mudah dipicu: baris halaman 3 terpampang sementara Pager berkata halaman 4.

**5. `GET /portal/projects` satu-satunya daftar portal yang belum beramplop.** Ia membalas
`{ items }` polos. Ia **bukan** daftar yang ditelusuri melainkan **pemilih**: kalau project
terpilih jatuh dari halaman, kontrol halaman justru mematahkan syarat "perpindahan halaman
mempertahankan project terpilih".

## Keputusan

### D1 — Klien mengirim `page` **dan** `limit`, sebagai satu argumen yang tak terpisah

`src/src/api/portal.ts`:

```ts
export type PortalPage = { page: number; limit: number };
const q = ({ page, limit }: PortalPage) => `?page=${page}&limit=${limit}`;

listBacklog: (id: string, pg: PortalPage) => get<Paginated<PortalSpec>>(`${p(id)}/backlog${q(pg)}`),
listTickets: (id: string, pg: PortalPage) => get<Paginated<PortalTicket>>(`${p(id)}/tickets${q(pg)}`),
```

Argumen wajib (bukan opsional) dan satu objek: tak ada bentuk panggilan yang mengirim `limit`
sendirian, dan tak ada call site yang bisa lupa. Tak ada endpoint baru, tak ada kontrak baru.

### D2 — Ukuran halaman 20, konstanta di layar

`const PORTAL_PAGE = 20` di `ClientPortal.tsx` — cermin `TICKET_PAGE` di `TriageScreen`
(SPEC-523). Baris portal sekompak baris triase, jadi tak ada alasan memakai angka lain.

### D3 — Satu nomor halaman per daftar; reset ke 1 saat project **atau** tab berganti

```
bPage / tPage  →  state terpisah, keduanya di-reset oleh satu effect [active, tab]
```

Alasan dua state, bukan satu yang dibagi: dengan satu nomor bersama, daftar yang tak tampak ikut
diminta di halaman yang mungkin tak dimilikinya, dan tab yang baru dibuka sempat merender
keadaan kosong palsu sebelum reset-nya berlaku. Reset lewat **effect** (idiom `TriageScreen`
`useEffect(() => setPage(1), [filter…])`) supaya jalur mana pun yang mengganti project — klik
pemilih, default saat pertama memuat, pindah project sesudah kirim tiket — tak bisa melewatkannya.

### D4 — Angka di tab = `total`, bukan `items.length`

`backlog`/`tickets` disimpan sebagai `{ items, total }`. Tab memakai `total`; Pager memakai
`total`. Lencana yang mengecil saat klien membuka halaman 2 adalah kebohongan (ADR-0107).

### D5 — `Pager` design system, penempatan mengikuti layar operator

Helper lokal `PortalPager` (cermin `TicketPager` di `TriageScreen`) yang memanggil `serverPage()`
+ `Pager` dari `src/src/ds`, diletakkan **di bawah** `Card` daftar dalam pembungkus ber-border
radius — idiom `BacklogScreen.tsx:868`. Tanpa `FIXED_ROW_STYLE`: portal hanya punya **satu**
scroller (`<main>`, SPEC-626) dan tak memakai rantai flex per-daftar seperti layar operator, jadi
properti flex di sana inert. Konsekuensi yang disengaja: Pager portal ikut menggulir bersama
daftarnya, di ujung daftar.

Keadaan kosong dan halaman terakhir sudah bawaan DS: `Pager` mengembalikan `null` saat
`total === 0` (jadi `StateBlock` kosong tetap sendirian) dan `PagerBtn` men-disable
Sebelumnya/Berikutnya di ujung (`page <= 1`, `page >= pageCount`) — tak ada tombol yang
menggantung aktif. `flexWrap: "wrap"` bawaan `Pager` yang menjaganya tetap enak di layar sempit.

### D6 — Kirim keluhan memaksa halaman tiket ke 1

`onSent` menyetel `tPage = 1` sebelum memuat ulang. Untuk project yang sama, muat ulang dipicu
lewat penghitung `reload` (idiom `syncNonce` `BacklogScreen`) supaya `setTPage(1)` + `setReload`
di render yang sama menghasilkan **satu** fetch, bukan dua.

### D7 — Respons basi tak boleh menimpa halaman yang lebih baru

`loadLists` memegang nomor urut di `useRef`; hanya respons dengan nomor terbaru yang boleh
`setState`. Tiga baris, dan ia menutup kelas bug "baris halaman 3 di bawah Pager halaman 4"
yang justru baru bisa dipicu sesudah paginasi ada.

### D8 — `GET /portal/projects` ikut beramplop `paginate()`, UI tetap meminta daftar penuh

Server memakai `paginate(rows.map(toPortalProject), page, limit)` — pola yang **sama**, bukan pola
sendiri; tanpa query ia membalas seluruh baris (`pageSize = total`), jadi satu-satunya perubahan
yang dirasakan pemanggil hari ini adalah tambahan `total`/`page`/`pageSize`.

**Pemilih project sengaja tak diberi kontrol halaman** — dinyatakan di sini supaya audit
berikutnya tak "memperbaikinya": ia bukan daftar yang ditelusuri, dan project terpilih yang jatuh
dari halaman justru mematahkan syarat "perpindahan halaman mempertahankan project terpilih".
Amplopnya ada supaya klien dengan puluhan project punya jalan keluar tanpa kontrak baru.

## Yang **tidak** dikerjakan

- **Tak ada perubahan server pada backlog/tiket portal.** Keduanya sudah menerima `page`/`limit`
  dan membalas `Paginated`; menyentuhnya berarti mengubah kontrak yang sudah benar.
- **Tak ada ADR baru** — ADR-0107 diterapkan, bukan diamandemen; ADR-0110/0111 (scope project
  ditegakkan server, satu-satunya route tulis) utuh: paginasi tak menambah satu pun route.
- **Tak ada polling.** Portal memuat saat konteks berganti; menambahkan denyut bukan isi objective.
- **Tak ada pemilih ukuran halaman.** Satu angka, seperti triase.

## Bentuk perubahan

| berkas | perubahan |
|---|---|
| `src/src/api/portal.ts` | tipe `PortalPage` + helper query; `listBacklog`/`listTickets` wajib ber-`{page,limit}` |
| `src/src/portal/ClientPortal.tsx` | `PORTAL_PAGE`, state `{items,total}` × 2, `bPage`/`tPage` + reset, `PortalPager`, urutan respons, `onSent` → halaman 1 |
| `server/src/routes/portal.ts` | `GET /portal/projects` → `paginate()` |
| `server/test/portal.route.test.ts` | amplop projects; page/limit backlog & tiket dihormati (pemenggalan + halaman terakhir + di luar batas) |
| `src/test/client-portal.test.tsx` | test render pemenggalan: jumlah baris + query per klik halaman + reset konteks + angka tab = total |
| `internal/docs/architecture/api-contract.md` | amplop `GET /portal/projects` |
| `internal/docs/frontend/frontend-implementation.md` | bagian portal: paginasi, angka tab = `total`, pengecualian pemilih project |

## Test yang membuktikan (bukan sekadar kehadiran tombol)

Brief menyebut alasannya eksplisit: **nol test render adalah cara bug ini lolos pertama kali.**

Server (`portal.route.test.ts`, cookie klien sungguhan lewat `app.inject`):
1. `?page=1&limit=2` atas 5 spec → `items.length === 2`, `total === 5`, `page === 1`, `pageSize === 2`.
2. `?page=3&limit=2` → 1 baris (halaman terakhir), dan id-nya **bukan** id halaman 1.
3. `?page=9&limit=2` → `items: []` tapi `total` tetap 5 — halaman di luar batas bukan galat.
4. Hal yang sama untuk `/tickets`.
5. `GET /portal/projects` beramplop `Paginated` dan menghormati `limit`.

Klien (`client-portal.test.tsx`, mock `portalApi` mengembalikan halaman berbeda per `page`):
6. Halaman 1 dari 25 spec merender **20 baris**, bukan 25 — dihitung dari DOM.
7. Klik "Halaman 2" → `listBacklog` dipanggil dengan `{page: 2, limit: 20}` (kedua parameter ada),
   dan baris yang tampil adalah baris halaman 2.
8. Klik halaman **tidak** mengganti project maupun tab.
9. Ganti tab → halaman kembali ke 1 (query berikutnya `page: 1`). Ganti project → sama.
10. Angka di tab = `total` (25), bukan jumlah baris (20).
11. Kirim keluhan dari halaman 2 → tiket dimuat ulang di halaman 1.
