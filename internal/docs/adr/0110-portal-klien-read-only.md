# ADR-0110 — Portal klien read-only: peran `admin|client`, akses per project, gerbang deny-by-default

- Status: accepted
- Tanggal: 2026-08-10
- Konteks: SPEC-617
- Memperluas: ADR-0028 (auth sesi opaque) — sesi cookie kini membawa **peran**
- Menegakkan: ADR-0018/0019 (turunan vs tersimpan) · ADR-0038 (filter di layer response) ·
  ADR-0062 (Help Center sebagai sumber tiket) · ADR-0064 (FK `Project.id` merambat) ·
  ADR-0065 (agent token — tak berubah; klien adalah jalur cookie) · ADR-0086
- Tidak mencabut apa pun.

## Konteks

Klien/stakeholder sebuah project tak punya cara melihat progres tanpa diberi akses penuh dashboard
operator. Help Center per project (SPEC-253/ADR-0062) hanya jalur **mengirim** keluhan — tak ada
permukaan untuk **melihat** antrean backlog maupun status tiket yang sudah dikirim.

Penghalangnya bukan halaman yang belum dibuat, melainkan model akses. `User` hanya punya `email` +
`passwordHash`, dan seluruh aturan otorisasi cookie hidup di **satu baris** `app.ts`:

```ts
if (user) return; // cookie sesi = akses penuh (tak ada RBAC, konsisten model sekarang)
```

Siapa pun yang login melihat SELURUH project dan bisa menulis apa pun. Jadi kebutuhan ini bukan
sekadar layar baru; ia menuntut konsep peran dan pemetaan user→project.

## Keputusan

### 1. Dua peran di kolom `User.role`, default `"admin"`

`role String @default("admin")` + `disabled Boolean @default(false)`. Default `admin` bukan
kenyamanan melainkan **syarat migrasi**: hub produksi berisi akun rekan sungguhan, dan setiap baris
`User` yang sudah ada harus tetap punya akses penuh tanpa satu pun langkah backfill. Migrasi karena
itu murni additif (`ALTER TABLE … ADD COLUMN … DEFAULT 'admin'`; yang dilarang SQLite hanya
`DEFAULT CURRENT_TIMESTAMP`, ADR-0090).

Dua peran, bukan RBAC per-permission: yang dibutuhkan adalah satu garis antara *operator* dan
*pengamat*, dan permission-set yang bisa dirakit operator adalah permukaan konfigurasi yang jauh
lebih besar daripada masalahnya. Peran ketiga adalah ADR berikutnya, bukan generalisasi hari ini.

### 2. Pemetaan akses = tabel join `ClientProjectAccess`, LOCAL-only

`{ id, userId, projectId, createdAt }` ber-`@@unique([userId, projectId])`, relasi ke `User` dan
`Project` dengan `onDelete: Cascade` — dan `onUpdate: Cascade` bawaan Prisma membuat rename
`Project.id` (ADR-0064) merambat tanpa baris tambahan. Kolom `Json` berisi daftar id ditolak: SQLite
melarang scalar list, dan daftar dalam JSON tak punya FK sehingga project yang dihapus meninggalkan
akses hantu.

**LOCAL-only** — cermin `User`/`Session`/`DeviceToken`/`AgentToken`, yang tak pernah masuk `SYNCED`
(`services/sync.ts`): akun adalah kredensial per-instance, bukan pengetahuan bersama. Ia juga
**tidak** masuk `WEBHOOK_ENTITIES` (permukaan kredensial tak dipancarkan keluar — preseden
`/telegram/credentials`, ADR-0097). Tapi ia **wajib** masuk `PG_ORDER` sesudah `User` **dan**
`Project`; `cli/test/migrate-pg.test.ts` mengadu daftar itu ke DMMF.

### 3. Gerbang deny-by-default di `onRequest`, allowlist sebagai fungsi murni

```ts
if (user?.role === "client" && !clientRouteAllowed(req.method, path))
  return reply.code(403).send({ error: "portal klien: baca-saja" });
```

`clientRouteAllowed` (`services/client-access.ts`) adalah **allowlist**, bukan peta seperti
`capabilityForRoute`: `GET|HEAD /api/portal/**` · apa pun di `/api/help/**` · `POST /api/auth/logout`
· `POST /api/auth/change-password` · selain itu **tolak**. Denylist akan menyebar kewajiban ke setiap
route yang lahir nanti — kelas bug "satu definisi, N call site" yang sudah dibayar SPEC-431/448/475/481.
Dengan allowlist, domain baru **tertutup secara default** dan tak ada yang perlu diingat.

`/api/help/**` sengaja ikut terbuka: permukaan itu sudah publik tanpa login sama sekali, jadi
menolaknya membuat klien yang login punya hak **lebih sedikit** daripada pengunjung anonim.

Konsekuensi yang diinginkan: upgrade WebSocket `/api/terminal/**/ws` dan `/api/events/ws` melewati
hook yang sama, jadi klien tak bisa menyusup ke PTY maupun feed siar dashboard.

### 4. Namespace `/api/portal/*`, proyeksi allowlist-field

Lima GET (`projects`, `:id/backlog`, `:id/backlog/:specId`, `:id/tickets`, `:id/tickets/:ticketId`)
yang membaca **`liveSpecs()` dan `prisma.ticket` yang sama** dengan dashboard operator — tak ada
pipeline data kedua; yang berbeda hanya proyeksinya. Karena `liveSpecs()` yang dipakai, stage yang
dilihat klien adalah stage **live** yang sama dengan yang dilihat operator (ADR-0038), bukan kolom
DB yang basi.

`toPortalSpec`/`toPortalTicket` (`shared/src/portal.ts`) menyebut fieldnya satu per satu —
**bukan `Omit<>`**: kolom yang bertambah di Prisma nanti tak boleh ikut terkirim, dan `Omit<>` gagal
senyap persis pada kasus itu. Test mengadu kunci respons ke `PORTAL_*_KEYS`.

Yang dipancarkan: spec = `id·title·priority·stage·objective·createdAt·startedAt·doneAt`; tiket =
`id·number·category·title·status·createdAt` (+`detail` di endpoint detail). **Tidak** ikut:
`payload`, `author`, `baseSha`/`headSha`, `branchFrom`, `dependsOn`, `sourceHistory`,
`reporterEmail`, `shareToken`, `accessKeyHash`. Status tiket dihitung `publicStatus()` — kosakata
non-teknis yang sudah jadi satu sumber kebenaran sejak SPEC-293.

### 5. Kelola akun klien = `/api/client-accounts`, cookie-only, hanya menyentuh `role="client"`

Empat endpoint (list/create/patch/delete) yang **hanya** melihat baris berperan `client`. Akun
operator tetap dikelola `/auth/users`; memisahkannya membuat "undang rekan" dan "beri akses klien"
tak pernah tertukar, dan menutup jalan memutar mengubah kredensial admin lewat pintu klien.
`capabilityForRoute` memetakan `portal` **dan** `client-accounts` ke `COOKIE_ONLY` (preseden
`/agent-tokens`, ADR-0065): portal adalah permukaan sesi ber-scope akun, jadi tak ada capability
yang bisa berarti apa pun di sana.

## Konsekuensi

- Sesi cookie tak lagi setara. Setiap penambahan route wajib menganggap dirinya tertutup bagi klien
  sampai sengaja dibuka — itu memang defaultnya.
- Portal adalah permukaan yang harus tetap kecil. Menambah endpoint di bawah `/api/portal` berarti
  menambah data yang dilihat pihak di luar tim; proyeksi allowlist adalah tempat keputusan itu.
- Tak ada jalur signup publik, undangan lewat email, atau reset password mandiri oleh klien selain
  `change-password` dengan password lama.

## Alternatif yang ditolak

- **Menyaring di atas `/api/specs` & `/api/tickets` yang sudah ada.** Nol route baru, tapi setiap
  route baca — termasuk yang lahir bertahun-tahun sesudahnya — harus ikut dipikirkan, dan yang lupa
  gagal ke arah **terbuka**. Deny-by-default membalik arah kegagalannya.
- **Kolom `Json` berisi daftar project di `User`.** Tanpa FK: project yang dihapus meninggalkan
  akses hantu, dan rename `Project.id` tak merambat.
- **RBAC per-permission.** Permukaan konfigurasi yang jauh lebih besar daripada masalah yang ada.
- **Aplikasi portal terpisah (build/host sendiri).** Satu SPA sudah disajikan server yang sama;
  aplikasi kedua berarti dua bundle, dua deploy, dan dua tempat aturan auth bisa berselisih.

## Gotcha

1. **`role` default `"admin"`** — itulah yang membuat migrasi aman untuk hub produksi. Default
   `"client"` akan mengunci setiap operator yang ada di luar dashboardnya sendiri saat deploy.
2. **Letak gerbang: SEBELUM bypass `/api/sync` & `/api/help`.** Dengan begitu allowlist adalah
   pernyataan lengkap tentang apa yang boleh disentuh klien; menaruhnya sesudah cabang-cabang itu
   berarti urutan cabang jadi bagian dari aturan keamanan.
3. **Nonaktif ditegakkan di DUA titik** — `POST /auth/login` **dan** `lookupSession()`. Hanya
   menutup login berarti cookie yang sudah terbit tetap hidup sampai 7 hari: pencabutan yang tak
   mencabut apa pun hari ini. Reset password ikut memanggil `deleteUserSessions`.
4. **`DELETE /auth/users/:id` menjaga admin TERAKHIR, bukan user terakhir.** Sejak ada akun klien,
   "user terakhir" bisa terpenuhi oleh akun yang justru tak boleh melihat apa pun — dan workspace-nya
   terkunci tanpa satu pun operator.
5. **Proyeksi = allowlist field eksplisit, bukan `Omit<>`.** Kolom Prisma baru harus disebut untuk
   bisa terkirim, bukan disebut untuk bisa disembunyikan.
6. **Project bukan-miliknya dan project tak-ada dijawab 404 yang SAMA** (preseden Help Center
   ADR-0062). Membedakannya menjadikan portal alat enumerasi nama project. Id item juga tak boleh
   jadi jalan pintas: `…/p1/backlog/SPEC-2` milik project lain tetap 404.
7. **Di Fastify, hook `onRequest` ber-scope tak berjalan untuk path yang tak punya route** — 404
   lahir dari not-found handler di luar scope plugin. Karena itu "klien menembak path X → 404" tak
   membuktikan apa pun tentang gerbang, dan sifat baca-saja portal diuji dua lapis terpisah: tabel
   route Fastify (`app.hasRoute`) untuk "tak ada route tulis yang lahir di sini", dan
   `clientRouteAllowed` sebagai fungsi murni untuk "method tulis ditolak seandainya ada".
8. **`ClientProjectAccess` LOCAL-only tapi WAJIB di `PG_ORDER`** — dua daftar berbeda dengan aturan
   berbeda; yang pertama soal sync antar-mesin, yang kedua soal migrasi sekali-jalan dari Postgres.
