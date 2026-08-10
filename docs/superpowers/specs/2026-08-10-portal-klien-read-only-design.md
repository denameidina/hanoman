# SPEC-617 · Portal klien read-only: backlog + help desk per project

Tanggal: 2026-08-10 · Sumber: brief (prioritas sedang) · ADR baru: **wajib** (perubahan skema)

## Masalah

Klien/stakeholder sebuah project tak punya cara melihat progres tanpa diberi akses penuh dashboard
operator. Help Center per project (SPEC-253/ADR-0062) hanya jalur **mengirim** keluhan — tak ada
permukaan untuk **melihat** antrean backlog maupun status tiket yang sudah dikirim.

Penghalangnya bukan halaman yang belum dibuat, melainkan model akses: `User`
(`server/prisma/schema.prisma:191`) hanya punya `email` + `passwordHash`, dan `app.ts:120`
menuliskan aturannya dalam satu baris — `if (user) return; // cookie sesi = akses penuh (tak ada
RBAC)`. Siapa pun yang login melihat SELURUH project dan bisa menulis apa pun.

## Keputusan pokok

Tiga percabangan diputuskan operator di awal sesi (dicatat di sini supaya tak dilitigasi ulang):

1. **Permukaan API = namespace `/api/portal/*`**, bukan penyaringan di atas `/api/specs` &
   `/api/tickets`. Klien memanggil route baca-saja yang memancarkan DTO sempit; sisa `/api`
   **ditolak 403 secara default** untuk `role=client`.
2. **Tiket yang terlihat = seluruh tiket project yang ditugaskan, tanpa `reporterEmail`.**
3. **Detail backlog = metadata + `objective` saja** — tanpa `payload`, `author`, `baseSha`,
   `headSha`, `branchFrom`, `dependsOn`, `sourceHistory`.

Alasan (1) yang menentukan: penyaringan-di-tempat menyebar kewajiban ke **setiap route baca yang
sudah ada dan yang lahir nanti** — kelas bug "satu definisi, N call site" yang sudah dibayar repo
ini empat kali (SPEC-431/448/475/481). Deny-by-default membalik defaultnya: route baru **tertutup**
bagi klien sampai seseorang sengaja menaruhnya di allowlist. Constraint "jangan bikin pipeline data
kedua" tetap dipenuhi — portal membaca `liveSpecs()` dan `prisma.ticket` yang sama, hanya
proyeksinya yang berbeda; tak ada tabel, kolom turunan, maupun jalur ingest baru.

## Arsitektur

### 1. Skema (migration + ADR)

```prisma
model User {
  …
  role     String  @default("admin")   // "admin" | "client"
  disabled Boolean @default(false)
  projectAccess ClientProjectAccess[]
}

model ClientProjectAccess {
  id        String   @id @default(cuid())
  userId    String
  projectId String
  createdAt DateTime @default(now())
  user    User    @relation(fields: [userId],    references: [id], onDelete: Cascade)
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  @@unique([userId, projectId])
}
```

- `role` default **`"admin"`** — itulah yang membuat migrasi aman untuk hub produksi: setiap baris
  `User` yang sudah ada otomatis admin, nol akses terputus, nol backfill manual.
- Tabel join, bukan kolom `Json`: SQLite melarang scalar list, dan relasi ke `Project` memberi
  `onDelete: Cascade` gratis. Prisma memakai `onUpdate: Cascade` sebagai default, jadi rename
  `Project.id` (ADR-0064) merambat tanpa baris tambahan.
- **LOCAL-only**: `User`/`Session`/`DeviceToken`/`AgentToken` tak pernah masuk `SYNCED`
  (`server/src/services/sync.ts:16`) — akun adalah kredensial per-instance. `ClientProjectAccess`
  mengikuti; tak masuk `FIELDS` maupun `WEBHOOK_ENTITIES` (katalog webhook tak boleh membawa
  permukaan kredensial, preseden `/telegram/credentials` ADR-0097).
- `ClientProjectAccess` **wajib** masuk `PG_ORDER` (`cli/src/commands/migrate-pg.ts`) sesudah
  `User` **dan** `Project` — `cli/test/migrate-pg.test.ts` mengadu daftarnya ke DMMF.
- Migration ditulis tangan lalu `migrate deploy` (bukan `migrate dev` yang me-reset).
  `ALTER TABLE … ADD COLUMN … DEFAULT 'admin'` sah di SQLite (yang dilarang hanya
  `DEFAULT CURRENT_TIMESTAMP`, ADR-0090).

### 2. Gerbang server — satu baris yang selama ini tanpa syarat

`app.ts` hook `onRequest`, **tepat sesudah cek `PUBLIC`** dan **sebelum** semua bypass lain
(`/api/sync`, `/api/help`):

```ts
if (user?.role === "client" && !clientRouteAllowed(req.method, path))
  return reply.code(403).send({ error: "portal klien: baca-saja" });
```

Letaknya sengaja paling awal: dengan begitu allowlist adalah **pernyataan lengkap** tentang apa yang
boleh disentuh klien, tak ada urutan-cabang yang harus diingat pembaca berikutnya.

`clientRouteAllowed(method, path)` — fungsi **murni** di
`server/src/services/client-access.ts`, cermin `capabilityForRoute` (SPEC-257/ADR-0065):

| aturan | alasan |
|---|---|
| `GET`/`HEAD` di bawah `/api/portal/**` → boleh | permukaan portal |
| method lain di bawah `/api/portal/**` → tolak | read-only ditegakkan oleh **bentuk**, bukan sekadar oleh ketiadaan route |
| apa pun di bawah `/api/help/**` → boleh | permukaan itu sudah publik tanpa login; menolaknya justru membuat klien yang login **lebih sedikit** haknya daripada pengunjung anonim |
| `POST /api/auth/logout`, `POST /api/auth/change-password` → boleh | klien harus bisa keluar & mengganti kredensial awal yang dibuatkan admin |
| selain itu → tolak | deny-by-default |

Konsekuensi yang memang diinginkan: upgrade WebSocket `/api/terminal/**/ws` dan `/api/events/ws`
lewat hook yang sama, jadi klien tak bisa menyusup ke PTY maupun feed siar dashboard.

### 3. Route portal (`server/src/routes/portal.ts`)

Semua GET, semua ber-scope akses. Project yang tak ditugaskan → **404 generik**, sama apakah
project itu ada atau tidak (preseden Help Center: "404 generik … tak membocorkan project").

```
GET /api/portal/projects                     → [{ id, name }]
GET /api/portal/projects/:id/backlog         → { items: PortalSpec[], total, page, … }
GET /api/portal/projects/:id/backlog/:specId → PortalSpec
GET /api/portal/projects/:id/tickets         → { items: PortalTicket[], total, page, … }
GET /api/portal/projects/:id/tickets/:tid    → PortalTicket & { detail }
```

DTO (di `shared/src/portal.ts`, dipakai server **dan** web):

```ts
type PortalProject = { id, name };
type PortalSpec    = { id, title, priority, stage, objective, createdAt, startedAt, doneAt };
type PortalTicket  = { id, number, category, title, status, createdAt };  // status = publicStatus()
```

- `toPortalSpec` / `toPortalTicket` adalah **fungsi murni allowlist-field** — mengubahnya satu-satunya
  cara sebuah kolom baru bisa sampai ke klien, dan itu ditegakkan test (bukan `Omit<>`, yang gagal
  senyap saat kolom bertambah).
- Backlog dibaca lewat `liveSpecs({ project })` yang sudah ada → stage yang dilihat klien adalah
  stage **live** yang sama dengan yang dilihat operator, bukan kolom DB yang basi (ADR-0038).
- Status tiket memakai `publicStatus(ticket.status, spec?.stage)` dari `@hanoman/shared` — kosakata
  non-teknis yang sudah jadi satu sumber kebenaran sejak SPEC-293.
- Paginasi lewat `paginate()` yang sudah ada (ADR-0107).

### 4. Kelola akun klien (`server/src/routes/client-accounts.ts`)

Permukaan kredensial → **COOKIE_ONLY** di `capabilityForRoute` (preseden `/agent-tokens`,
`/telegram/credentials`), jadi agent token mana pun ditolak 403. Klien ditolak oleh gerbang di §2.

```
GET    /api/client-accounts            → [{ id, email, disabled, createdAt, projects: string[] }]
POST   /api/client-accounts            → { email, password, projects[] }
PATCH  /api/client-accounts/:id        → { projects?, disabled?, password? }
DELETE /api/client-accounts/:id
```

Semuanya hanya menyentuh baris ber-`role="client"` — akun operator tetap dikelola `/auth/users`
yang sudah ada, permukaannya tak berubah bentuk.

Dua pagar yang ikut lahir di `routes/auth.ts`:

- `DELETE /auth/users/:id` sekarang menolak menghapus **admin terakhir**, bukan "user terakhir".
  Tanpa itu, adanya satu akun klien membuat admin terakhir bisa dihapus dan workspace tersisa hanya
  bisa dimasuki akun yang tak boleh melihat apa pun.
- `POST /auth/users` menulis `role: "admin"` eksplisit (perilaku hari ini, kini dinyatakan).

Nonaktif berlaku di **dua** titik, bukan satu: `POST /auth/login` menolak (pesan generik, tak
membedakan dari password salah) **dan** `lookupSession` mengembalikan `null`. Hanya menutup login
berarti sesi cookie yang sudah terbit tetap hidup sampai 7 hari — pencabutan yang tak mencabut.
Sesi milik akun yang dinonaktifkan/dihapus/di-reset password ikut dihapus (`deleteUserSessions`).

### 5. Frontend

`UserView` bertambah `role` → `App.tsx` bercabang tepat sesudah gerbang auth yang sudah ada:

```tsx
if (!auth.user) return <AuthScreen … />;
if (auth.user.role === "client") return <ClientPortal user={auth.user} onLoggedOut={onLoggedOut} />;
```

`ClientPortal` (`src/src/portal/`) **tidak memakai `<Shell>`** — sidebar `HN_NAV` adalah navigasi
operator; memakainya berarti klien melihat daftar Terminal/VPS/Settings yang selamanya 403. Chrome
sendiri yang minimal: wordmark, nama akun + logout, daftar project, dan per project dua daftar
(Backlog · Help desk) plus detail baca-saja. Mengikuti design system (bone paper, brass accent,
komponen `ds/*` yang sudah ada); tak ada satu pun tombol tulis.

Panggilan API lewat `src/src/api/portal.ts` (terpisah dari `api/client.ts` 39 KB) — permukaan
klien punya berkasnya sendiri sehingga tak ada endpoint operator yang tak sengaja terjangkau.

Layar admin: `src/src/screens/ClientAccessPanel.tsx`, dipasang sebagai tab di Settings (satu import
+ satu entri tab — `SettingsScreen.tsx` sudah 80 KB, jadi isinya tinggal di berkasnya sendiri).

## Test yang membuktikan penegakan

Bukan "ada test", melainkan test yang gagal kalau penegakannya dicabut:

1. **Murni, tanpa harness** — `clientRouteAllowed` atas matriks method × path: setiap prefix
   `/api/*` yang dikenal `capabilityForRoute` ditolak untuk klien kecuali yang di allowlist.
   Enumerasinya diambil dari daftar prefix itu, jadi domain baru yang lupa dipikirkan tetap
   tertutup (dan test tetap hijau — deny-by-default memang begitu bentuknya).
2. **Route, DB nyata** — klien menembak `POST /api/specs`, `PATCH /api/specs/:id`,
   `DELETE /api/specs/:id`, `POST /api/terminal/sessions`, `GET /api/settings`, `GET /api/vps`,
   `GET /api/notifications`, `GET /api/tickets` → **403**; admin di route yang sama → normal.
3. **Scope project** — klien menembak `/api/portal/projects/<milik-orang-lain>/backlog` → **404**,
   dan project yang tak ada pun 404 (tak terbedakan).
4. **Kebocoran field** — respons portal diadu ke daftar kunci yang diizinkan: kunci di luar daftar
   → merah. Ini yang menangkap kolom baru yang ikut terbawa tanpa ada yang sadar.
5. **Nonaktif** — sesi yang sudah terbit mati begitu akun dinonaktifkan (`lookupSession` → null).
6. **Admin terakhir** — `DELETE /auth/users/:id` menolak menghapus admin terakhir walau ada akun
   klien.
7. **DMMF/PG_ORDER** — `ClientProjectAccess` ada di `PG_ORDER` sesudah `User` & `Project`.

## Yang sengaja TIDAK dikerjakan

- Tak ada jalur signup publik, reset password lewat email, atau undangan — admin yang membuat akun
  (constraint brief).
- Tak ada akses klien ke lampiran tiket, dokumen internal, review diff, changelog, notifikasi.
- Tak ada RBAC umum (per-permission). Hanya dua peran; menambah peran ketiga adalah ADR berikutnya.
- Tak ada perubahan pada agent token/capability: klien adalah jalur **cookie**, dan `/api/portal`
  dipetakan `capabilityForRoute` ke `COOKIE_ONLY` supaya agent token tak ikut membacanya.
- Akun operator tetap dikelola `/auth/users`; tak ada UI baru untuknya.
