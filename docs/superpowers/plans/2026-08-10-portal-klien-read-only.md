# SPEC-617 · Portal klien read-only — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri klien/stakeholder sebuah project satu halaman baca-saja di balik login — daftar backlog + daftar tiket help desk project yang ditugaskan admin — dengan read-only & scope project ditegakkan di server, bukan disembunyikan di UI.

**Architecture:** `User` dapat kolom `role` (default `"admin"`, jadi migrasi tak memutus akun yang sudah ada) + `disabled`; tabel join `ClientProjectAccess` memetakan user↔project. Gerbang `onRequest` di `server/src/app.ts` — satu-satunya tempat "cookie = akses penuh" pernah ditulis tanpa syarat — memanggil fungsi murni `clientRouteAllowed()`: `role=client` hanya boleh `GET /api/portal/**`, `/api/help/**`, logout, dan change-password; sisanya **403 deny-by-default**. Route `/api/portal/*` membaca `liveSpecs()` dan `prisma.ticket` yang sama dengan dashboard operator lalu memancarkan DTO sempit hasil fungsi proyeksi allowlist-field. Frontend bercabang di `App.tsx` tepat sesudah gerbang auth: `role=client` → `<ClientPortal>` (tanpa `<Shell>` operator).

**Tech Stack:** Fastify + Prisma 6 (SQLite) · React 18 + TypeScript (Vite) · zod (`@hanoman/shared`) · vitest + @testing-library/react.

## Global Constraints

- **Bahasa:** komentar, pesan galat, dan teks UI dalam **bahasa Indonesia**, mengikuti berkas di sekitarnya.
- **TypeScript strict.** Tak ada `any` baru kecuali mencontoh pola yang sudah ada di berkas itu.
- **Migration additif & hand-written**, lalu `migrate deploy` — **jangan** `prisma migrate dev` (me-reset saat ada drift worktree tetangga). SQLite melarang `ADD COLUMN … DEFAULT CURRENT_TIMESTAMP`; `DEFAULT 'admin'` / `DEFAULT 0` sah.
- **Test wajib** `--no-file-parallelism` **dan** `TEST_DATABASE_URL` terisolasi:
  `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism <path…>`
  (`pnpm vitest` mati oleh proxy rtk di mesin ini → pakai `./node_modules/.bin/vitest`; jalankan dari **root repo**, bukan subdirektori paket).
- **Test web** wajib `env -u NODE_ENV` (env sesi bisa `NODE_ENV=production` → RTL `act` gagal massal).
- **Design system:** `internal/docs/design-system/**` — editorial, bone paper, brass accent. Pakai komponen `src/src/ds` yang sudah ada (`Card`, `Button`, `StatusPill`, `StateBlock`, `Tabs`, `Input`, `Modal`); jangan bikin komponen dasar baru.
- **SPEC-490:** setiap `<Input>`/`<HnTextarea>` teks WAJIB punya `placeholder` berisi **contoh nilai** — ada test kontrak yang memindai JSX (`src/test/helpers/form-fields.ts`).
- **Kredensial tak pernah kembali ke klien:** `passwordHash` tak boleh masuk response mana pun.
- Nomor ADR: **0110** (0109 tertinggi saat plan ditulis). **Enumerasi ulang lintas semua branch & worktree tepat sebelum push** — worktree tetangga bisa merebut nomor di tengah jalan.

---

### Task 1: Skema — `User.role`/`User.disabled` + `ClientProjectAccess`

**Files:**
- Modify: `server/prisma/schema.prisma` (model `Project` ±line 10-32, model `User` ±line 191-199)
- Create: `server/prisma/migrations/20260810000000_client_portal_access/migration.sql`
- Modify: `cli/src/commands/migrate-pg.ts:22` (`PG_ORDER`)
- Modify: `shared/src/dto.ts:444` (`UserView`)
- Test: `server/test/client-access-schema.test.ts`

**Interfaces:**
- Consumes: —
- Produces: kolom Prisma `User.role: string`, `User.disabled: boolean`, model `ClientProjectAccess { id, userId, projectId, createdAt }` dengan `@@unique([userId, projectId])`; tipe `UserRole = "admin" | "client"` dan `UserView = { id, email, role, createdAt }` di `@hanoman/shared`.

- [x] **Step 1: Tulis test skema yang gagal**

Buat `server/test/client-access-schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.user.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("skema portal klien (SPEC-617)", () => {
  // Default 'admin' adalah yang membuat migrasi aman untuk hub produksi: setiap baris User yang
  // sudah ada otomatis admin, nol akses terputus, nol backfill manual.
  it("User.role default 'admin' dan User.disabled default false", () => {
    const cols = new Map(models.get("User")!.fields.map((f) => [f.name, f]));
    expect(cols.get("role")!.default).toBe("admin");
    expect(cols.get("disabled")!.default).toBe(false);
  });

  it("baris User tanpa menyebut role lahir sebagai admin yang aktif", async () => {
    const u = await prisma.user.create({ data: { email: "a@b.co", passwordHash: "x:y" } });
    expect(u.role).toBe("admin");
    expect(u.disabled).toBe(false);
  });

  it("ClientProjectAccess unik per (userId, projectId)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
    const u = await prisma.user.create({ data: { email: "c@b.co", passwordHash: "x:y", role: "client" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p1" } });
    await expect(prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p1" } }))
      .rejects.toThrow();
  });

  it("akses ikut terhapus saat user maupun project dihapus (cascade)", async () => {
    await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
    const u = await prisma.user.create({ data: { email: "d@b.co", passwordHash: "x:y", role: "client" } });
    await prisma.clientProjectAccess.create({ data: { userId: u.id, projectId: "p2" } });
    await prisma.project.delete({ where: { id: "p2" } });
    expect(await prisma.clientProjectAccess.count()).toBe(0);
  });

  // Model baru yang lupa masuk PG_ORDER = migrasi dari Postgres diam-diam melewatkan tabelnya.
  it("ClientProjectAccess ada di PG_ORDER sesudah User dan Project", () => {
    expect(PG_ORDER).toContain("ClientProjectAccess");
    expect(PG_ORDER.indexOf("ClientProjectAccess")).toBeGreaterThan(PG_ORDER.indexOf("User"));
    expect(PG_ORDER.indexOf("ClientProjectAccess")).toBeGreaterThan(PG_ORDER.indexOf("Project"));
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-access-schema.test.ts
```
Expected: FAIL — `prisma.clientProjectAccess` undefined / `cols.get("role")` undefined.

- [x] **Step 3: Ubah `server/prisma/schema.prisma`**

Pada model `Project`, tambahkan relasi (sesudah baris `changelogs   Changelog[]`):

```prisma
  clientAccess ClientProjectAccess[] // SPEC-617 · akun klien yang boleh melihat project ini
```

Ganti model `User` menjadi:

```prisma
// SPEC-169 · auth. passwordHash = scrypt "<saltHex>:<hashHex>".
// SPEC-617 · ADR-0110 · dua peran: `admin` (operator, akses penuh seperti sebelumnya) dan
// `client` (portal baca-saja ber-scope project). Default `"admin"` DISENGAJA: itulah yang
// membuat migrasi aman untuk instance yang sudah berjalan — setiap baris lama otomatis admin,
// tak ada akses yang putus dan tak ada backfill manual.
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  role         String    @default("admin")
  // SPEC-617 · nonaktif = ditolak di login DAN di lookupSession; hanya menutup login berarti
  // cookie yang sudah terbit tetap hidup sampai 7 hari (pencabutan yang tak mencabut).
  disabled     Boolean   @default(false)
  createdAt    DateTime  @default(now())
  sessions     Session[]
  deviceTokens DeviceToken[]
  projectAccess ClientProjectAccess[]
}

// SPEC-617 · ADR-0110 · project yang boleh dilihat sebuah akun klien. Tabel join, bukan kolom
// Json: SQLite melarang scalar list, dan relasi memberi cascade delete gratis di kedua sisi.
// LOCAL-only — cermin User/Session/AgentToken, tak pernah masuk SYNCED (services/sync.ts).
model ClientProjectAccess {
  id        String   @id @default(cuid())
  userId    String
  projectId String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([userId, projectId])
}
```

- [x] **Step 4: Tulis migration SQL**

Buat `server/prisma/migrations/20260810000000_client_portal_access/migration.sql`:

```sql
-- SPEC-617 · ADR-0110 · peran user + pemetaan akun klien → project.
-- Additif & aman untuk DB yang sudah berjalan: user lama mendapat role 'admin' lewat DEFAULT,
-- jadi tak ada akses yang putus. (SQLite hanya melarang DEFAULT CURRENT_TIMESTAMP.)
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE "User" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ClientProjectAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientProjectAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ClientProjectAccess_userId_projectId_key" ON "ClientProjectAccess"("userId", "projectId");
```

- [x] **Step 5: Tambahkan `ClientProjectAccess` ke `PG_ORDER`**

Di `cli/src/commands/migrate-pg.ts`, ganti baris `"User", "Session", "DeviceToken", "AgentToken",` menjadi:

```ts
  // SPEC-617 · ADR-0110 · ClientProjectAccess sesudah User DAN Project (FK ke keduanya).
  "User", "ClientProjectAccess", "Session", "DeviceToken", "AgentToken",
```

- [x] **Step 6: Perluas `UserView` di `shared/src/dto.ts`**

Ganti blok auth (`shared/src/dto.ts:438-445`):

```ts
// SPEC-169 · auth. Password min 8 saat dibuat/diubah; login menerima min 1 (validasi asli lewat
// verify hash, error selalu generic).
// SPEC-617 · ADR-0110 · dua peran. `admin` = perilaku lama persis (akses penuh lewat cookie);
// `client` = portal baca-saja ber-scope project (gerbang di server/src/services/client-access.ts).
export const USER_ROLES = ["admin", "client"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const zUserRole = z.enum(USER_ROLES);
export const zLogin = z.object({ email: z.string().email(), password: z.string().min(1) });
export const zSignup = z.object({ email: z.string().email(), password: z.string().min(8) });
export const zChangePassword = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(8) });
export type UserView = { id: string; email: string; role: UserRole; createdAt: string };
export type AuthStatus = { needsSetup: boolean; user: UserView | null };
```

- [x] **Step 7: Regenerate client + terapkan migration + jalankan test**

```bash
./node_modules/.bin/prisma generate --schema server/prisma/schema.prisma
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-access-schema.test.ts cli/test/migrate-pg.test.ts
```
Expected: PASS semua.

- [x] **Step 8: Perbaiki call site `UserView` yang kini kurang `role`**

`server/src/routes/auth.ts:6` — `view()` harus menyertakan `role`:

```ts
const view = (u: { id: string; email: string; role: string; createdAt: Date }): UserView =>
  ({ id: u.id, email: u.email, role: u.role as UserView["role"], createdAt: u.createdAt.toISOString() });
```

Jalankan typecheck:

```bash
pnpm --filter ./server typecheck && pnpm --filter ./shared typecheck
```
Expected: nol error.

- [x] **Step 9: Commit**

```bash
git add server/prisma shared/src/dto.ts cli/src/commands/migrate-pg.ts server/src/routes/auth.ts server/test/client-access-schema.test.ts
git commit -m "feat(spec-617): peran user + tabel akses klien→project (migration additif)"
```


### Task 2: `clientRouteAllowed()` — allowlist murni

**Files:**
- Create: `server/src/services/client-access.ts`
- Test: `server/test/client-route-allowed.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `clientRouteAllowed(method: string, path: string): boolean` — `path` sudah tanpa query, memuat prefix `/api`. Juga `clientProjectIds(userId: string): Promise<string[]>` dan `hasProjectAccess(userId: string, projectId: string): Promise<boolean>`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/client-route-allowed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { clientRouteAllowed } from "../src/services/client-access";

describe("clientRouteAllowed (SPEC-617)", () => {
  it("portal boleh dibaca", () => {
    expect(clientRouteAllowed("GET", "/api/portal/projects")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/portal/projects/p1/backlog")).toBe(true);
    expect(clientRouteAllowed("HEAD", "/api/portal/projects/p1/tickets")).toBe(true);
  });

  // Read-only ditegakkan oleh BENTUK, bukan sekadar oleh ketiadaan route tulis: route portal
  // yang suatu hari ditambahkan tanpa dipikirkan tetap tertutup.
  it("portal TIDAK boleh ditulis", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"])
      expect(clientRouteAllowed(m, "/api/portal/projects/p1/backlog"), m).toBe(false);
  });

  it("Help Center tetap terbuka — permukaan itu sudah publik tanpa login", () => {
    expect(clientRouteAllowed("GET", "/api/help/proj")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/help/proj/tickets")).toBe(true);
  });

  it("keluar & ganti password sendiri boleh; sisa /auth tidak", () => {
    expect(clientRouteAllowed("POST", "/api/auth/logout")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/auth/change-password")).toBe(true);
    expect(clientRouteAllowed("GET", "/api/auth/users")).toBe(false);
    expect(clientRouteAllowed("POST", "/api/auth/users")).toBe(false);
    expect(clientRouteAllowed("DELETE", "/api/auth/users/x")).toBe(false);
  });

  // Deny-by-default: daftar ini bukan denylist yang harus dirawat, melainkan bukti bahwa
  // permukaan operator memang tertutup. Domain baru otomatis ikut tertutup.
  it("seluruh permukaan operator tertutup", () => {
    const paths = [
      "/api/specs", "/api/specs/SPEC-1", "/api/projects", "/api/projects/p1/docs",
      "/api/tickets", "/api/terminal/sessions", "/api/terminal/sessions/s1/ws",
      "/api/events/ws", "/api/settings", "/api/vps", "/api/notifications",
      "/api/agent-tokens", "/api/device-tokens", "/api/sync/pull", "/api/sync/now",
      "/api/lead/decisions", "/api/scheduler", "/api/webhooks", "/api/client-accounts",
      "/api/changelog", "/api/custom-agents", "/api/github-issues", "/api/telegram/settings",
      "/api/config", "/api/fs", "/api/limits", "/api/update/apply", "/api/ide",
      "/api/session-results", "/api/docs", "/api/codex/version", "/api/prds",
    ];
    for (const p of paths)
      for (const m of ["GET", "POST", "PATCH", "DELETE"])
        expect(clientRouteAllowed(m, p), `${m} ${p}`).toBe(false);
  });

  it("tak bisa ditipu path traversal atau prefix mirip", () => {
    expect(clientRouteAllowed("GET", "/api/portalx/secrets")).toBe(false);
    expect(clientRouteAllowed("GET", "/api/portal/../specs")).toBe(false);
    expect(clientRouteAllowed("GET", "/api/helpdesk/secrets")).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-route-allowed.test.ts
```
Expected: FAIL — modul `client-access` tak ada.

- [x] **Step 3: Implementasi**

Buat `server/src/services/client-access.ts`:

```ts
import { prisma } from "../db";

// SPEC-617 · ADR-0110 · allowlist permukaan untuk `User.role === "client"`. Cermin
// `capabilityForRoute` (SPEC-257/ADR-0065), tapi berbentuk **allowlist** bukan peta: route baru
// tertutup bagi klien sampai seseorang sengaja menaruhnya di sini. Denylist akan menyebar
// kewajiban ke setiap route yang lahir nanti — kelas bug "satu definisi, N call site".
// `path` = req.url tanpa query, memuat prefix `/api`.

const segments = (path: string) =>
  path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);

export function clientRouteAllowed(method: string, path: string): boolean {
  const seg = segments(path);
  // `..` tak pernah muncul di route sah; menolaknya di sini menutup normalisasi path yang
  // berbeda antara gate dan router.
  if (seg.includes("..")) return false;
  const top = seg[0] ?? "";
  const read = method === "GET" || method === "HEAD";

  if (top === "portal") return read;
  // Help Center sudah publik tanpa login (app.ts mem-bypass gate untuknya). Menolaknya di sini
  // membuat klien yang login justru punya hak LEBIH SEDIKIT daripada pengunjung anonim.
  if (top === "help") return true;
  if (top === "auth") {
    const sub = seg[1] ?? "";
    return method === "POST" && (sub === "logout" || sub === "change-password");
  }
  return false;
}

/** Id project yang boleh dilihat sebuah akun klien. Urut naik supaya respons stabil. */
export async function clientProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.clientProjectAccess.findMany({
    where: { userId }, select: { projectId: true }, orderBy: { projectId: "asc" },
  });
  return rows.map((r) => r.projectId);
}

export async function hasProjectAccess(userId: string, projectId: string): Promise<boolean> {
  return (await prisma.clientProjectAccess.count({ where: { userId, projectId } })) > 0;
}
```

- [x] **Step 4: Jalankan — harus lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-route-allowed.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/client-access.ts server/test/client-route-allowed.test.ts
git commit -m "feat(spec-617): allowlist route klien (deny-by-default, fungsi murni)"
```


### Task 3: Gerbang server — role di sesi, nonaktif mencabut, 403 untuk klien

**Files:**
- Modify: `server/src/services/auth.ts:7-9` (tipe) dan `:39-47` (`lookupSession`)
- Modify: `server/src/routes/auth.ts:31-43` (`POST /auth/login`)
- Modify: `server/src/app.ts:102-137` (hook `onRequest`)
- Test: `server/test/client-gate.test.ts`

**Interfaces:**
- Consumes: `clientRouteAllowed` (Task 2), `UserView.role` (Task 1)
- Produces: `req.user.role` terisi di setiap request ber-cookie; klien menerima `403 { error: "portal klien: baca-saja" }` di luar allowlist.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/client-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0];

async function login(email: string, password: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  expect(r.statusCode).toBe(200);
  return cookieOf(r);
}

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  const c = await prisma.user.create({
    data: { email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  return { adminCookie: await login("admin@x.co", "password1"), clientCookie: await login("klien@x.co", "password2") };
}

describe("gerbang role client (SPEC-617)", () => {
  it("klien ditolak 403 di seluruh route tulis", async () => {
    const { clientCookie: cookie } = await seed();
    const writes: [string, string, unknown?][] = [
      ["POST", "/api/specs", { project: "p1", title: "x", source: "brief", payload: {} }],
      ["PATCH", "/api/specs/SPEC-1", { stage: "done" }],
      ["DELETE", "/api/specs/SPEC-1"],
      ["POST", "/api/terminal/sessions", { project: "p1" }],
      ["POST", "/api/projects", { id: "z", name: "Z", desc: "", kind: "existing" }],
      ["PUT", "/api/settings", {}],
      ["POST", "/api/tickets/t1/accept", {}],
      ["POST", "/api/lead/decisions", {}],
      ["POST", "/api/client-accounts", { email: "e@f.co", password: "password3", projects: [] }],
    ];
    for (const [method, url, payload] of writes) {
      const r = await app.inject({ method: method as "POST", url, headers: { cookie }, payload: payload as object });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("klien ditolak 403 di route baca internal", async () => {
    const { clientCookie: cookie } = await seed();
    for (const url of ["/api/specs", "/api/projects", "/api/tickets", "/api/settings",
      "/api/vps", "/api/notifications", "/api/agent-tokens", "/api/session-results",
      "/api/scheduler", "/api/webhooks", "/api/auth/users", "/api/client-accounts"]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).toMatchObject({ error: expect.any(String) });
    }
  });

  it("admin tetap normal di route yang sama", async () => {
    const { adminCookie: cookie } = await seed();
    for (const url of ["/api/specs", "/api/projects", "/api/tickets", "/api/notifications"])
      expect((await app.inject({ method: "GET", url, headers: { cookie } })).statusCode, url).toBe(200);
  });

  it("klien boleh keluar dan mengganti password sendiri", async () => {
    const { clientCookie: cookie } = await seed();
    expect((await app.inject({
      method: "POST", url: "/api/auth/change-password", headers: { cookie },
      payload: { currentPassword: "password2", newPassword: "password9" } })).statusCode).toBe(200);
  });

  it("/api/auth/status tetap menjawab & membawa role", async () => {
    const { clientCookie: cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/auth/status", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ email: "klien@x.co", role: "client" });
  });

  // Hanya menutup login berarti cookie yang sudah terbit hidup sampai 7 hari — pencabutan
  // yang tak mencabut.
  it("menonaktifkan akun mematikan sesi yang SUDAH terbit, bukan cuma login berikutnya", async () => {
    const { clientCookie: cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).statusCode).not.toBe(401);
    await prisma.user.updateMany({ where: { email: "klien@x.co" }, data: { disabled: true } });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "klien@x.co", password: "password2" } })).statusCode).toBe(401);
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-gate.test.ts
```
Expected: FAIL — klien masih 200/404 di route operator (belum ada gerbang).

- [x] **Step 3: `lookupSession` membawa role & menolak akun nonaktif**

Di `server/src/services/auth.ts`, ganti isi `lookupSession`:

```ts
export async function lookupSession(token: string) {
  const s = await prisma.session.findUnique({ where: { id: sessionId(token) }, include: { user: true } });
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  // SPEC-617 · nonaktif ditegakkan DI SINI, bukan hanya di login: sesi yang sudah terbit hidup
  // 7 hari, jadi menutup login saja adalah pencabutan yang tak mencabut apa pun hari ini.
  if (s.user.disabled) return null;
  return {
    id: s.user.id, email: s.user.email,
    role: s.user.role as UserView["role"],
    createdAt: s.user.createdAt.toISOString(),
  };
}
```

- [x] **Step 4: `POST /auth/login` menolak akun nonaktif**

Di `server/src/routes/auth.ts`, ganti cek kredensial:

```ts
    const user = await prisma.user.findUnique({ where: { email: p.data.email } });
    // SPEC-617 · akun nonaktif ditolak dengan pesan yang SAMA seperti password salah —
    // membedakannya membocorkan keberadaan akun (standar keamanan: error selalu generic).
    if (!user || user.disabled || !(await auth.verifyPassword(p.data.password, user.passwordHash))) {
      auth.noteLoginFail(req.ip);
      return reply.code(401).send({ error: "email atau password salah" });
    }
```

- [x] **Step 5: Pasang gerbang di `server/src/app.ts`**

Tambahkan import:

```ts
import { clientRouteAllowed } from "./services/client-access";
```

Di hook `onRequest`, sisipkan tepat SESUDAH `if (PUBLIC.has(...)) return;` dan SEBELUM cabang `/api/sync`:

```ts
        // SPEC-617 · ADR-0110 · satu-satunya tempat "cookie = akses penuh" pernah ditulis tanpa
        // syarat. Letaknya paling awal DISENGAJA: dengan begitu allowlist adalah pernyataan
        // LENGKAP tentang apa yang boleh disentuh klien — tak ada urutan cabang (sync/help) yang
        // harus diingat pembaca berikutnya. Deny-by-default: route baru tertutup sampai sengaja
        // dibuka.
        if (user?.role === "client" && !clientRouteAllowed(req.method, path))
          return reply.code(403).send({ error: "portal klien: baca-saja" });
```

- [x] **Step 6: Jalankan test**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-gate.test.ts server/test/auth-routes.test.ts server/test/agent-gate.test.ts server/test/app.test.ts
```
Expected: PASS. (Test `/api/portal/*` di dalamnya masih 404 — route-nya lahir di Task 5; 404 ≠ 401/403, jadi assert-nya sudah benar sekarang.)

- [x] **Step 7: Commit**

```bash
git add server/src/services/auth.ts server/src/routes/auth.ts server/src/app.ts server/test/client-gate.test.ts
git commit -m "feat(spec-617): gerbang role client di onRequest + nonaktif mencabut sesi hidup"
```


### Task 4: DTO & proyeksi portal (murni, di `@hanoman/shared`)

**Files:**
- Create: `shared/src/portal.ts`
- Create: `shared/src/portal.test.ts`
- Modify: `shared/src/index.ts` (barrel)

**Interfaces:**
- Consumes: `publicStatus()` dari `shared/src/ticket-status.ts`
- Produces:
  - `type PortalProject = { id: string; name: string }`
  - `type PortalSpec = { id, title, priority, stage, objective, createdAt, startedAt, doneAt }` (tanggal ISO string / null)
  - `type PortalTicket = { id, number, category, title, status, createdAt }`
  - `type PortalTicketDetail = PortalTicket & { detail: string }`
  - `toPortalProject`, `toPortalSpec`, `toPortalTicket`, `toPortalTicketDetail`
  - `PORTAL_SPEC_KEYS`, `PORTAL_TICKET_KEYS`, `PORTAL_PROJECT_KEYS` (untuk test kebocoran)

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/portal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toPortalProject, toPortalSpec, toPortalTicket, toPortalTicketDetail,
  PORTAL_PROJECT_KEYS, PORTAL_SPEC_KEYS, PORTAL_TICKET_KEYS,
} from "./portal";

const SPEC_ROW = {
  id: "SPEC-1", projectId: "p1", title: "Judul", source: "brief", stage: "executing",
  priority: "tinggi", author: "operator@internal.co", objective: "Hasil yang dikejar",
  payload: { context: "catatan internal", outcome: "rahasia" },
  branchFrom: "main", baseSha: "abc123", headSha: "def456", version: 3,
  createdAt: new Date("2026-08-01T00:00:00Z"), startedAt: new Date("2026-08-02T00:00:00Z"),
  doneAt: null, dependsOn: ["SPEC-0"], autoMerge: { mode: "off" }, sourceHistory: [],
  updatedAt: new Date("2026-08-03T00:00:00Z"),
};

const TICKET_ROW = {
  id: "t1", projectId: "p1", number: 7, category: "bug", title: "Tombol mati",
  detail: "langkah repro", reporterEmail: "pelapor@luar.co", status: "accepted",
  accessKeyHash: "hash", shareToken: "tok", specId: "SPEC-1",
  createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-02T00:00:00Z"),
};

describe("proyeksi portal (SPEC-617)", () => {
  // Allowlist eksplisit, bukan Omit<>: kolom baru di Prisma TIDAK boleh diam-diam ikut terkirim.
  it("spec hanya memancarkan kunci yang diizinkan", () => {
    const out = toPortalSpec(SPEC_ROW);
    expect(Object.keys(out).sort()).toEqual([...PORTAL_SPEC_KEYS].sort());
  });

  it("spec tak membawa payload, author, sha, branch, dependency, riwayat", () => {
    const out = toPortalSpec(SPEC_ROW) as Record<string, unknown>;
    for (const k of ["payload", "author", "baseSha", "headSha", "branchFrom", "dependsOn",
      "sourceHistory", "autoMerge", "version", "source", "projectId", "updatedAt"])
      expect(out[k], k).toBeUndefined();
  });

  it("spec memakai stage & tanggal apa adanya (ISO string / null)", () => {
    expect(toPortalSpec(SPEC_ROW)).toEqual({
      id: "SPEC-1", title: "Judul", priority: "tinggi", stage: "executing",
      objective: "Hasil yang dikejar",
      createdAt: "2026-08-01T00:00:00.000Z", startedAt: "2026-08-02T00:00:00.000Z", doneAt: null,
    });
  });

  // Email pelapor tak pernah menyeberang — keputusan operator saat brainstorm.
  it("tiket tak membawa reporterEmail, detail, shareToken, accessKeyHash, specId", () => {
    const out = toPortalTicket(TICKET_ROW, null) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());
    for (const k of ["reporterEmail", "detail", "shareToken", "accessKeyHash", "specId", "projectId"])
      expect(out[k], k).toBeUndefined();
  });

  // Status memakai kosakata publik yang sudah ada (SPEC-293) — tanpa istilah stage internal.
  it("status tiket diturunkan publicStatus(status, stage spec)", () => {
    expect(toPortalTicket(TICKET_ROW, "done").status).toBe("Selesai");
    expect(toPortalTicket(TICKET_ROW, "executing").status).toBe("Sedang dikerjakan");
    expect(toPortalTicket({ ...TICKET_ROW, status: "new" }, null).status).toBe("Sedang ditinjau");
    expect(toPortalTicket({ ...TICKET_ROW, status: "rejected" }, null).status).toBe("Ditutup");
  });

  it("detail tiket menambahkan tepat satu kunci: detail", () => {
    const out = toPortalTicketDetail(TICKET_ROW, null);
    expect(Object.keys(out).sort()).toEqual([...PORTAL_TICKET_KEYS, "detail"].sort());
    expect(out.detail).toBe("langkah repro");
  });

  it("project hanya id & nama", () => {
    const out = toPortalProject({ id: "p1", name: "P1", desc: "rahasia", kind: "existing", repoDir: "/tmp/x" });
    expect(Object.keys(out).sort()).toEqual([...PORTAL_PROJECT_KEYS].sort());
    expect(out).toEqual({ id: "p1", name: "P1" });
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/portal.test.ts
```
Expected: FAIL — `./portal` tak ada.

- [x] **Step 3: Implementasi**

Buat `shared/src/portal.ts`:

```ts
import { publicStatus } from "./ticket-status";

// SPEC-617 · ADR-0110 · proyeksi baris DB → apa yang boleh dibaca akun klien.
// Allowlist field EKSPLISIT, bukan `Omit<>`: kolom yang bertambah di Prisma nanti tak akan
// diam-diam ikut terkirim, dan test mengadu kunci hasilnya ke daftar ini.

export const PORTAL_PROJECT_KEYS = ["id", "name"] as const;
export const PORTAL_SPEC_KEYS =
  ["id", "title", "priority", "stage", "objective", "createdAt", "startedAt", "doneAt"] as const;
export const PORTAL_TICKET_KEYS =
  ["id", "number", "category", "title", "status", "createdAt"] as const;

export type PortalProject = { id: string; name: string };
export type PortalSpec = {
  id: string; title: string; priority: string; stage: string; objective: string;
  createdAt: string; startedAt: string | null; doneAt: string | null;
};
export type PortalTicket = {
  id: string; number: number; category: string; title: string; status: string; createdAt: string;
};
export type PortalTicketDetail = PortalTicket & { detail: string };

const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : (typeof d === "string" ? d : d.toISOString());

export function toPortalProject(p: { id: string; name: string }): PortalProject {
  return { id: p.id, name: p.name };
}

export function toPortalSpec(s: {
  id: string; title: string; priority: string; stage: string; objective: string;
  createdAt: Date | string; startedAt: Date | string | null; doneAt: Date | string | null;
}): PortalSpec {
  return {
    id: s.id, title: s.title, priority: s.priority, stage: s.stage, objective: s.objective,
    createdAt: iso(s.createdAt)!, startedAt: iso(s.startedAt), doneAt: iso(s.doneAt),
  };
}

/** `specStage` = stage Spec tertaut (null bila tiket belum jadi backlog). */
export function toPortalTicket(t: {
  id: string; number: number; category: string; title: string; status: string;
  createdAt: Date | string;
}, specStage: string | null): PortalTicket {
  return {
    id: t.id, number: t.number, category: t.category, title: t.title,
    status: publicStatus(t.status, specStage), createdAt: iso(t.createdAt)!,
  };
}

export function toPortalTicketDetail(
  t: Parameters<typeof toPortalTicket>[0] & { detail: string },
  specStage: string | null,
): PortalTicketDetail {
  return { ...toPortalTicket(t, specStage), detail: t.detail };
}
```

- [x] **Step 4: Ekspor dari barrel**

Di `shared/src/index.ts`, tambahkan sesudah `export * from "./ticket-status";`:

```ts
export * from "./portal";
```

- [x] **Step 5: Jalankan — harus lulus**

```bash
./node_modules/.bin/vitest --run --no-file-parallelism shared/src/portal.test.ts && pnpm --filter ./shared typecheck
```
Expected: PASS + nol error typecheck.

- [x] **Step 6: Commit**

```bash
git add shared/src/portal.ts shared/src/portal.test.ts shared/src/index.ts
git commit -m "feat(spec-617): DTO & proyeksi allowlist-field portal klien"
```


### Task 5: Route `/api/portal/*`

**Files:**
- Create: `server/src/routes/portal.ts`
- Modify: `server/src/app.ts` (import + register)
- Modify: `server/src/services/agent-capabilities.ts:19` (`portal` → COOKIE_ONLY)
- Test: `server/test/portal.route.test.ts`

**Interfaces:**
- Consumes: `clientProjectIds`, `hasProjectAccess` (Task 2); `toPortalProject`/`toPortalSpec`/`toPortalTicket`/`toPortalTicketDetail` (Task 4); `liveSpecs` (`server/src/services/live-specs.ts`); `paginate` (`server/src/services/paginate.ts`)
- Produces: lima endpoint GET di bawah `/api/portal`.

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/portal.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { PORTAL_SPEC_KEYS, PORTAL_TICKET_KEYS } from "@hanoman/shared";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.ticket.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async (email: string, password: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }));

async function seed() {
  for (const id of ["p1", "p2"])
    await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
  await prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "Punya klien", source: "brief", stage: "executing",
    priority: "tinggi", author: "op@internal.co", objective: "hasil",
    payload: { context: "rahasia internal" }, baseSha: "abc", headSha: "def", branchFrom: "main" } });
  await prisma.spec.create({ data: {
    id: "SPEC-2", projectId: "p2", title: "Bukan punya klien", source: "brief", stage: "done",
    priority: "rendah", author: "op@internal.co", objective: "x" } });
  await prisma.ticket.create({ data: {
    id: "t1", projectId: "p1", number: 1, category: "bug", title: "Tombol mati",
    detail: "repro", reporterEmail: "pelapor@luar.co", status: "accepted",
    accessKeyHash: "h1", specId: "SPEC-1" } });
  await prisma.ticket.create({ data: {
    id: "t2", projectId: "p2", number: 1, category: "bug", title: "Tiket project lain",
    detail: "repro", reporterEmail: "pelapor@luar.co", status: "new", accessKeyHash: "h2" } });

  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  const c = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  return { cookie: await login("klien@x.co", "password2"), adminCookie: await login("admin@x.co", "password1") };
}

describe("GET /api/portal (SPEC-617)", () => {
  it("daftar project hanya yang ditugaskan", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ items: [{ id: "p1", name: "P1" }] });
  });

  it("backlog project sendiri: hanya field yang diizinkan", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(1);
    expect(Object.keys(body.items[0]).sort()).toEqual([...PORTAL_SPEC_KEYS].sort());
    expect(JSON.stringify(body)).not.toContain("rahasia internal");
    expect(JSON.stringify(body)).not.toContain("op@internal.co");
  });

  it("tiket project sendiri: tanpa email pelapor, status kosakata publik", async () => {
    const { cookie } = await seed();
    const r = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(1);
    expect(Object.keys(body.items[0]).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());
    expect(body.items[0].status).toBe("Sedang dikerjakan");   // spec tertaut stage=executing
    expect(JSON.stringify(body)).not.toContain("pelapor@luar.co");
  });

  it("detail backlog & tiket bisa dibuka baca-saja", async () => {
    const { cookie } = await seed();
    const s = await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog/SPEC-1", headers: { cookie } });
    expect(s.statusCode).toBe(200);
    expect(s.json()).toMatchObject({ id: "SPEC-1", title: "Punya klien", objective: "hasil" });
    const t = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets/t1", headers: { cookie } });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({ id: "t1", detail: "repro" });
    expect(t.json()).not.toHaveProperty("reporterEmail");
  });

  // Project yang ada tapi bukan miliknya dan project yang tak ada TAK BOLEH terbedakan —
  // preseden Help Center (404 generik, tak membocorkan project).
  it("project yang bukan miliknya → 404, tak terbedakan dari yang tak ada", async () => {
    const { cookie } = await seed();
    for (const url of [
      "/api/portal/projects/p2/backlog", "/api/portal/projects/hantu/backlog",
      "/api/portal/projects/p2/tickets", "/api/portal/projects/hantu/tickets",
      "/api/portal/projects/p2/backlog/SPEC-2", "/api/portal/projects/p2/tickets/t2",
    ]) {
      const r = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(r.statusCode, url).toBe(404);
    }
  });

  it("item project lain tak bisa ditarik lewat id di project sendiri", async () => {
    const { cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog/SPEC-2", headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets/t2", headers: { cookie } })).statusCode).toBe(404);
  });

  it("klien tanpa keterikatan tak melihat apa pun", async () => {
    await seed();
    await prisma.user.create({ data: { email: "sepi@x.co", passwordHash: await hashPassword("password3"), role: "client" } });
    const cookie = await login("sepi@x.co", "password3");
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toEqual({ items: [] });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects/p1/backlog", headers: { cookie } })).statusCode).toBe(404);
  });

  it("tanpa sesi → 401", async () => {
    await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects" })).statusCode).toBe(401);
  });

  // Admin memang punya cookie penuh; portal bukan permukaan rahasia, tapi scope-nya tetap
  // ditegakkan lewat ClientProjectAccess-nya sendiri (admin tak punya baris akses → kosong).
  it("admin memakai portal → daftar mengikuti akses miliknya sendiri (kosong)", async () => {
    const { adminCookie: cookie } = await seed();
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie } })).json())
      .toEqual({ items: [] });
  });

  it("portal tak bisa disentuh agent token (cookie-only)", async () => {
    const { capabilityForRoute } = await import("../src/services/agent-capabilities");
    expect(capabilityForRoute("GET", "/api/portal/projects")).toBe("COOKIE_ONLY");
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/portal.route.test.ts
```
Expected: FAIL — 404 di mana-mana (route belum ada).

- [x] **Step 3: Implementasi route**

Buat `server/src/routes/portal.ts`:

```ts
// SPEC-617 · ADR-0110 · permukaan BACA-SAJA untuk akun klien. Sumber datanya sama persis dengan
// dashboard operator — `liveSpecs()` (stage live, ADR-0038) dan `prisma.ticket` — hanya
// proyeksinya yang sempit; tak ada pipeline data kedua. Gerbang read-only ada di app.ts
// (services/client-access.ts); berkas ini menegakkan SCOPE PROJECT.
import type { FastifyInstance } from "fastify";
import {
  toPortalProject, toPortalSpec, toPortalTicket, toPortalTicketDetail,
} from "@hanoman/shared";
import { prisma } from "../db";
import { liveSpecs } from "../services/live-specs";
import { paginate } from "../services/paginate";
import { clientProjectIds, hasProjectAccess } from "../services/client-access";

// Project yang tak ditugaskan dan project yang tak ada menjawab hal yang SAMA: menjawab beda
// membuat portal jadi alat enumerasi nama project (preseden Help Center, ADR-0062).
const NOT_FOUND = { error: "not found" };

export default async function (app: FastifyInstance) {
  app.get("/portal/projects", async (req) => {
    const ids = await clientProjectIds(req.user!.id);
    const rows = await prisma.project.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    return { items: rows.map(toPortalProject) };
  });

  app.get("/portal/projects/:id/backlog", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const specs = await liveSpecs({ project: id });
    return paginate(specs.map(toPortalSpec), page, limit);
  });

  app.get("/portal/projects/:id/backlog/:specId", async (req, reply) => {
    const { id, specId } = req.params as { id: string; specId: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    // Dibaca dari set live project itu, bukan findUnique: dengan begitu stage yang dilihat klien
    // sama dengan yang dilihat operator, dan spec milik project lain tak bisa ditarik lewat id.
    const spec = (await liveSpecs({ project: id })).find((s) => s.id === specId);
    if (!spec) return reply.code(404).send(NOT_FOUND);
    return toPortalSpec(spec);
  });

  app.get("/portal/projects/:id/tickets", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const { page, limit } = req.query as { page?: string; limit?: string };
    const rows = await prisma.ticket.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" } });
    const stages = await specStages(rows.map((t) => t.specId));
    return paginate(rows.map((t) => toPortalTicket(t, stages.get(t.specId ?? "") ?? null)), page, limit);
  });

  app.get("/portal/projects/:id/tickets/:ticketId", async (req, reply) => {
    const { id, ticketId } = req.params as { id: string; ticketId: string };
    if (!(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    const t = await prisma.ticket.findUnique({ where: { id: ticketId } });
    // Tiket milik project lain dijawab 404 yang sama — id tiket tak boleh jadi jalan pintas
    // melewati scope project.
    if (!t || t.projectId !== id) return reply.code(404).send(NOT_FOUND);
    const stages = await specStages([t.specId]);
    return toPortalTicketDetail(t, stages.get(t.specId ?? "") ?? null);
  });
}

/** Stage Spec tertaut untuk sekumpulan tiket — satu query, bukan N+1. */
async function specStages(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return new Map();
  const rows = await prisma.spec.findMany({ where: { id: { in: wanted } }, select: { id: true, stage: true } });
  return new Map(rows.map((r) => [r.id, r.stage]));
}
```

- [x] **Step 4: Daftarkan route + petakan capability**

Di `server/src/app.ts`, tambahkan import bersama import route lain:

```ts
import portal from "./routes/portal";
```

dan daftarkan sesudah `await api.register(changelog);`:

```ts
    await api.register(portal);       // SPEC-617 · ADR-0110 · portal klien baca-saja (cookie-only)
```

Di `server/src/services/agent-capabilities.ts`, tambahkan pada blok "tak-boleh-didelegasikan":

```ts
  // SPEC-617 · ADR-0110 · portal klien adalah permukaan SESI COOKIE ber-scope akun (respons
  // bergantung `req.user`), jadi tak ada capability yang bisa berarti apa pun di sana.
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "portal" || top === "client-accounts") return "COOKIE_ONLY";
```

- [x] **Step 5: Jalankan test**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/portal.route.test.ts server/test/client-gate.test.ts server/test/agent-capabilities.test.ts server/test/mcp-capability.test.ts
```
Expected: PASS semua.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/portal.ts server/src/app.ts server/src/services/agent-capabilities.ts server/test/portal.route.test.ts
git commit -m "feat(spec-617): route /api/portal baca-saja ber-scope project"
```


### Task 6: Kelola akun klien (`/api/client-accounts`) + pagar admin terakhir

**Files:**
- Create: `server/src/routes/client-accounts.ts`
- Modify: `server/src/app.ts` (import + register)
- Modify: `server/src/routes/auth.ts:52-71` (`POST /auth/users`, `DELETE /auth/users/:id`)
- Modify: `shared/src/dto.ts` (zod + view type)
- Test: `server/test/client-accounts.route.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `deleteUserSessions` (`server/src/services/auth.ts`)
- Produces:
  - `zCreateClientAccount = { email, password, projects: string[] }`
  - `zUpdateClientAccount = { projects?, disabled?, password? }`
  - `type ClientAccountView = { id, email, disabled, createdAt, projects: string[] }`

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/client-accounts.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async (email: string, password: string) =>
  cookieOf(await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } }));

async function seedAdmin() {
  for (const id of ["p1", "p2"])
    await prisma.project.create({ data: { id, name: id.toUpperCase(), desc: "", kind: "existing" } });
  await prisma.user.create({ data: { email: "admin@x.co", passwordHash: await hashPassword("password1") } });
  return login("admin@x.co", "password1");
}

describe("kelola akun klien (SPEC-617)", () => {
  it("buat → daftar → ubah akses → nonaktifkan → hapus", async () => {
    const cookie = await seedAdmin();

    let r = await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: ["p1"] } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ email: "klien@x.co", disabled: false, projects: ["p1"] });
    expect(r.json()).not.toHaveProperty("passwordHash");
    const id = r.json().id;

    // Akun yang lahir dari sini SELALU berperan client — form admin tak boleh jadi jalan
    // membuat operator baru tanpa sadar.
    expect((await prisma.user.findUnique({ where: { id } }))!.role).toBe("client");

    r = await app.inject({ method: "GET", url: "/api/client-accounts", headers: { cookie } });
    expect(r.json().items).toHaveLength(1);
    expect(r.json().items[0]).toMatchObject({ email: "klien@x.co", projects: ["p1"] });

    r = await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie },
      payload: { projects: ["p1", "p2"] } });
    expect(r.json().projects).toEqual(["p1", "p2"]);

    // Nonaktif = akses dicabut sekarang juga, bukan saat token kedaluwarsa.
    const clientCookie = await login("klien@x.co", "password2");
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(200);
    r = await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie }, payload: { disabled: true } });
    expect(r.json().disabled).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(401);

    expect((await app.inject({ method: "DELETE", url: `/api/client-accounts/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect(await prisma.user.count({ where: { role: "client" } })).toBe(0);
    expect(await prisma.clientProjectAccess.count()).toBe(0);
  });

  it("reset password mencabut sesi lama", async () => {
    const cookie = await seedAdmin();
    const id = (await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: ["p1"] } })).json().id;
    const clientCookie = await login("klien@x.co", "password2");
    await app.inject({ method: "PATCH", url: `/api/client-accounts/${id}`, headers: { cookie }, payload: { password: "password9" } });
    expect((await app.inject({ method: "GET", url: "/api/portal/projects", headers: { cookie: clientCookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "klien@x.co", password: "password9" } })).statusCode).toBe(200);
  });

  it("email dipakai → 409; project tak dikenal → 400", async () => {
    const cookie = await seedAdmin();
    await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: [] } });
    expect((await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password3", projects: [] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "lain@x.co", password: "password3", projects: ["hantu"] } })).statusCode).toBe(400);
  });

  // Akun operator tak boleh bisa disentuh lewat pintu ini — kalau bisa, "kelola akses klien"
  // diam-diam jadi permukaan mengubah kredensial admin.
  it("akun admin tak terlihat & tak bisa disentuh dari endpoint ini", async () => {
    const cookie = await seedAdmin();
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
    expect((await app.inject({ method: "GET", url: "/api/client-accounts", headers: { cookie } })).json().items).toEqual([]);
    expect((await app.inject({ method: "PATCH", url: `/api/client-accounts/${admin.id}`, headers: { cookie }, payload: { disabled: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/client-accounts/${admin.id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  // Tanpa pagar ini, adanya satu akun klien membuat admin TERAKHIR bisa dihapus dan workspace
  // tersisa hanya bisa dimasuki akun yang tak boleh melihat apa pun.
  it("DELETE /auth/users menolak menghapus admin terakhir walau ada akun klien", async () => {
    const cookie = await seedAdmin();
    await app.inject({ method: "POST", url: "/api/client-accounts", headers: { cookie },
      payload: { email: "klien@x.co", password: "password2", projects: [] } });
    const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
    const r = await app.inject({ method: "DELETE", url: `/api/auth/users/${admin.id}`, headers: { cookie } });
    expect(r.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { role: "admin" } })).toBe(1);
  });

  it("POST /auth/users tetap melahirkan admin", async () => {
    const cookie = await seedAdmin();
    const r = await app.inject({ method: "POST", url: "/api/auth/users", headers: { cookie },
      payload: { email: "op2@x.co", password: "password4" } });
    expect(r.json()).toMatchObject({ email: "op2@x.co", role: "admin" });
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-accounts.route.test.ts
```
Expected: FAIL — 404 (route belum ada).

- [x] **Step 3: Tambahkan zod & tipe di `shared/src/dto.ts`**

Tepat sesudah blok `AuthStatus` yang diubah di Task 1:

```ts
// SPEC-617 · ADR-0110 · kelola akun klien. Permukaan KREDENSIAL — cookie-only, tak pernah
// terjangkau agent token (services/agent-capabilities.ts). `projects` = daftar id project yang
// boleh dilihat; array kosong sah (akun ada, belum melihat apa pun).
export const zCreateClientAccount = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  projects: z.array(z.string().min(1)).default([]),
});
export const zUpdateClientAccount = z.object({
  projects: z.array(z.string().min(1)),
  disabled: z.boolean(),
  password: z.string().min(8),
}).partial();
export type ClientAccountView = {
  id: string; email: string; disabled: boolean; createdAt: string; projects: string[];
};
```

- [x] **Step 4: Implementasi route**

Buat `server/src/routes/client-accounts.ts`:

```ts
// SPEC-617 · ADR-0110 · kelola akun klien (cookie-only, admin). Hanya menyentuh baris
// ber-`role="client"` — akun operator tetap dikelola /auth/users, jadi pintu ini tak pernah bisa
// jadi jalan memutar mengubah kredensial admin.
import type { FastifyInstance } from "fastify";
import { zCreateClientAccount, zUpdateClientAccount, type ClientAccountView } from "@hanoman/shared";
import { prisma } from "../db";
import { hashPassword, deleteUserSessions } from "../services/auth";

type Row = { id: string; email: string; disabled: boolean; createdAt: Date;
  projectAccess: { projectId: string }[] };

const view = (u: Row): ClientAccountView => ({
  id: u.id, email: u.email, disabled: u.disabled, createdAt: u.createdAt.toISOString(),
  projects: u.projectAccess.map((a) => a.projectId).sort(),
});

const load = (id: string) => prisma.user.findFirst({
  where: { id, role: "client" },
  include: { projectAccess: { select: { projectId: true } } },
});

/** Ganti seluruh daftar akses jadi `projects`. Project tak dikenal → null (pemanggil → 400). */
async function setAccess(userId: string, projects: string[]): Promise<string[] | null> {
  const ids = [...new Set(projects)];
  const known = await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (known.length !== ids.length) return null;
  await prisma.clientProjectAccess.deleteMany({ where: { userId, projectId: { notIn: ids } } });
  for (const projectId of ids)
    await prisma.clientProjectAccess.upsert({
      where: { userId_projectId: { userId, projectId } },
      update: {}, create: { userId, projectId },
    });
  return ids;
}

export default async function (app: FastifyInstance) {
  app.get("/client-accounts", async () => {
    const rows = await prisma.user.findMany({
      where: { role: "client" }, orderBy: { createdAt: "asc" },
      include: { projectAccess: { select: { projectId: true } } },
    });
    return { items: rows.map(view) };
  });

  app.post("/client-accounts", async (req, reply) => {
    const p = zCreateClientAccount.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (await prisma.user.findUnique({ where: { email: p.data.email } }))
      return reply.code(409).send({ error: "email dipakai" });
    const user = await prisma.user.create({
      data: { email: p.data.email, passwordHash: await hashPassword(p.data.password), role: "client" },
    });
    if ((await setAccess(user.id, p.data.projects)) === null) {
      await prisma.user.delete({ where: { id: user.id } });
      return reply.code(400).send({ error: "ada project yang tidak dikenal" });
    }
    return reply.code(201).send(view((await load(user.id))!));
  });

  app.patch("/client-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zUpdateClientAccount.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (!(await load(id))) return reply.code(404).send({ error: "not found" });

    if (p.data.projects && (await setAccess(id, p.data.projects)) === null)
      return reply.code(400).send({ error: "ada project yang tidak dikenal" });
    if (p.data.disabled !== undefined)
      await prisma.user.update({ where: { id }, data: { disabled: p.data.disabled } });
    if (p.data.password)
      await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(p.data.password) } });
    // Nonaktif & reset password harus berlaku SEKARANG: sesi yang sudah terbit hidup 7 hari.
    if (p.data.disabled || p.data.password) await deleteUserSessions(id);
    return view((await load(id))!);
  });

  app.delete("/client-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await load(id))) return reply.code(404).send({ error: "not found" });
    await prisma.user.delete({ where: { id } });   // sesi & akses ikut cascade
    return reply.code(204).send();
  });
}
```

- [x] **Step 5: Daftarkan route**

Di `server/src/app.ts`:

```ts
import clientAccounts from "./routes/client-accounts";
```

dan sesudah `await api.register(portal);`:

```ts
    await api.register(clientAccounts); // SPEC-617 · ADR-0110 · kelola akun klien (cookie-only)
```

- [x] **Step 6: Pagar admin terakhir di `server/src/routes/auth.ts`**

Ganti `POST /auth/users` (bagian `prisma.user.create`) dan `DELETE /auth/users/:id`:

```ts
    const user = await prisma.user.create({
      // SPEC-617 · pintu ini melahirkan OPERATOR. Akun klien punya pintunya sendiri
      // (/api/client-accounts) supaya "undang rekan" dan "beri akses klien" tak pernah tertukar.
      data: { email: p.data.email, passwordHash: await auth.hashPassword(p.data.password), role: "admin" },
    });
```

```ts
  app.delete<{ Params: { id: string } }>("/auth/users/:id", async (req, reply) => {
    // SPEC-617 · yang dijaga adalah admin TERAKHIR, bukan user terakhir: sejak ada akun klien,
    // "user terakhir" bisa terpenuhi oleh akun yang justru tak boleh melihat apa pun — dan
    // workspace-nya terkunci tanpa satu pun operator.
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return reply.code(204).send();
    if (target.role === "admin" && (await prisma.user.count({ where: { role: "admin" } })) <= 1)
      return reply.code(400).send({ error: "tak bisa hapus admin terakhir" });
    await prisma.user.deleteMany({ where: { id: req.params.id } });
    return reply.code(204).send();
  });
```

- [x] **Step 7: Jalankan test**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-accounts.route.test.ts server/test/auth-routes.test.ts server/test/client-gate.test.ts && pnpm --filter ./server typecheck
```
Expected: PASS + nol error typecheck.

- [x] **Step 8: Commit**

```bash
git add server/src/routes/client-accounts.ts server/src/routes/auth.ts server/src/app.ts shared/src/dto.ts server/test/client-accounts.route.test.ts
git commit -m "feat(spec-617): endpoint kelola akun klien + pagar admin terakhir"
```


### Task 7: Portal klien di dashboard (frontend)

**Files:**
- Create: `src/src/api/portal.ts`
- Create: `src/src/portal/ClientPortal.tsx`
- Modify: `src/src/App.tsx:1102-1104` (percabangan sesudah gerbang auth)
- Test: `src/test/client-portal.test.tsx`

**Interfaces:**
- Consumes: `PortalProject`/`PortalSpec`/`PortalTicket`/`PortalTicketDetail` (Task 4), `UserView.role` (Task 1)
- Produces: `portalApi` (`listProjects`, `listBacklog`, `getSpec`, `listTickets`, `getTicket`, `logout`), komponen `<ClientPortal user onLoggedOut />`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/client-portal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientPortal } from "../src/portal/ClientPortal";
import type { UserView } from "@hanoman/shared";

vi.mock("../src/api/portal", () => ({
  portalApi: {
    listProjects: vi.fn(), listBacklog: vi.fn(), listTickets: vi.fn(),
    getSpec: vi.fn(), getTicket: vi.fn(), logout: vi.fn(),
  },
}));
import { portalApi } from "../src/api/portal";

const USER: UserView = { id: "u1", email: "klien@x.co", role: "client", createdAt: "2026-08-01T00:00:00Z" };

beforeEach(() => {
  (portalApi.listProjects as any).mockResolvedValue({ items: [{ id: "p1", name: "Toko Mekar" }] });
  (portalApi.listBacklog as any).mockResolvedValue({ items: [{
    id: "SPEC-1", title: "Checkout gagal", priority: "tinggi", stage: "executing",
    objective: "Checkout kembali jalan",
    createdAt: "2026-08-01T00:00:00Z", startedAt: "2026-08-02T00:00:00Z", doneAt: null }], total: 1, page: 1, pageSize: 1 });
  (portalApi.listTickets as any).mockResolvedValue({ items: [{
    id: "t1", number: 3, category: "bug", title: "Tombol bayar mati",
    status: "Sedang dikerjakan", createdAt: "2026-08-01T00:00:00Z" }], total: 1, page: 1, pageSize: 1 });
  (portalApi.getSpec as any).mockResolvedValue({
    id: "SPEC-1", title: "Checkout gagal", priority: "tinggi", stage: "executing",
    objective: "Checkout kembali jalan",
    createdAt: "2026-08-01T00:00:00Z", startedAt: "2026-08-02T00:00:00Z", doneAt: null });
  (portalApi.getTicket as any).mockResolvedValue({
    id: "t1", number: 3, category: "bug", title: "Tombol bayar mati", status: "Sedang dikerjakan",
    createdAt: "2026-08-01T00:00:00Z", detail: "Klik bayar tak terjadi apa-apa" });
});

describe("ClientPortal (SPEC-617)", () => {
  it("menampilkan project yang ditugaskan, backlog, dan tiketnya", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Toko Mekar")).toBeTruthy();
    expect(await screen.findByText("Checkout gagal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /help desk/i }));
    expect(await screen.findByText("Tombol bayar mati")).toBeTruthy();
    expect(screen.getByText("Sedang dikerjakan")).toBeTruthy();
  });

  it("detail backlog terbuka baca-saja", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Checkout gagal"));
    expect(await screen.findByText("Checkout kembali jalan")).toBeTruthy();
  });

  // Sidebar operator (Terminal/VPS/Settings/IDE) tak boleh muncul — bukan karena rahasia,
  // melainkan karena setiap entrinya adalah 403 yang menunggu diklik.
  it("tak merender navigasi operator satu pun", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    for (const label of ["Terminal", "VPS", "Settings", "IDE", "Scheduler", "Lead", "Docs · SoT", "PRD"])
      expect(screen.queryByText(label), label).toBeNull();
  });

  it("tanpa project yang ditugaskan → keadaan kosong, bukan halaman rusak", async () => {
    (portalApi.listProjects as any).mockResolvedValue({ items: [] });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText(/belum ada project/i)).toBeTruthy();
  });

  it("tombol keluar memanggil logout lalu melapor ke pemanggil", async () => {
    (portalApi.logout as any).mockResolvedValue(undefined);
    const onLoggedOut = vi.fn();
    render(<ClientPortal user={USER} onLoggedOut={onLoggedOut} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /keluar/i }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/client-portal.test.tsx
```
Expected: FAIL — modul `ClientPortal` tak ada.

- [x] **Step 3: Klien API portal**

Buat `src/src/api/portal.ts`:

```ts
import type { Paginated, PortalProject, PortalSpec, PortalTicket, PortalTicketDetail } from "@hanoman/shared";
import { ApiError } from "./client";

// SPEC-617 · ADR-0110 · permukaan klien punya berkasnya sendiri, terpisah dari api/client.ts:
// dengan begitu tak ada endpoint operator yang tak sengaja terjangkau dari layar portal.
async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "content-type": "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `GET ${url} → ${res.status}`);
  return res.json();
}

const p = (id: string) => `/api/portal/projects/${encodeURIComponent(id)}`;

export const portalApi = {
  listProjects: () => get<{ items: PortalProject[] }>("/api/portal/projects"),
  listBacklog: (id: string) => get<Paginated<PortalSpec>>(`${p(id)}/backlog`),
  getSpec: (id: string, specId: string) => get<PortalSpec>(`${p(id)}/backlog/${encodeURIComponent(specId)}`),
  listTickets: (id: string) => get<Paginated<PortalTicket>>(`${p(id)}/tickets`),
  getTicket: (id: string, ticketId: string) =>
    get<PortalTicketDetail>(`${p(id)}/tickets/${encodeURIComponent(ticketId)}`),
  logout: async () => {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) throw new ApiError(res.status, `POST /api/auth/logout → ${res.status}`);
  },
};
```

- [x] **Step 4: Komponen portal**

Buat `src/src/portal/ClientPortal.tsx`:

```tsx
import React from "react";
import type { PortalProject, PortalSpec, PortalTicket, PortalTicketDetail, UserView } from "@hanoman/shared";
import { Button, Card, Icon, Modal, StateBlock, StatusPill, Tabs } from "../ds";
import { Mark } from "../ds/marks";
import { portalApi } from "../api/portal";

// SPEC-617 · ADR-0110 · permukaan klien. SENGAJA tidak memakai <Shell>: sidebar HN_NAV adalah
// navigasi OPERATOR, dan setiap entrinya adalah 403 yang menunggu diklik. Chrome-nya sendiri,
// minimal, mengikuti design system (bone paper, brass accent). Tak ada satu pun aksi tulis.

const tanggal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STAGE_LABEL: Record<string, string> = {
  brainstorming: "Dirumuskan", objective: "Dirumuskan", "spec-ready": "Disiapkan",
  planned: "Direncanakan", executing: "Sedang dikerjakan", done: "Selesai",
};
const stageTone = (stage: string) => stage === "done" ? "ok" : stage === "executing" ? "run" : "idle";

export function ClientPortal({ user, onLoggedOut }: { user: UserView; onLoggedOut: () => void }) {
  const [projects, setProjects] = React.useState<PortalProject[] | null>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<"backlog" | "tickets">("backlog");
  const [backlog, setBacklog] = React.useState<PortalSpec[]>([]);
  const [tickets, setTickets] = React.useState<PortalTicket[]>([]);
  const [openSpec, setOpenSpec] = React.useState<PortalSpec | null>(null);
  const [openTicket, setOpenTicket] = React.useState<PortalTicketDetail | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    portalApi.listProjects()
      .then((r) => { setProjects(r.items); setActive((cur) => cur ?? r.items[0]?.id ?? null); })
      .catch(() => { setProjects([]); setFailed(true); });
  }, []);

  React.useEffect(() => {
    if (!active) return;
    void Promise.all([portalApi.listBacklog(active), portalApi.listTickets(active)])
      .then(([b, t]) => { setBacklog(b.items); setTickets(t.items); })
      .catch(() => { setBacklog([]); setTickets([]); });
  }, [active]);

  const logout = async () => {
    try { await portalApi.logout(); } catch { /* jaringan gagal — klien tetap dibersihkan */ }
    finally { onLoggedOut(); }
  };

  return (
    <div style={{ minHeight: "100%", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
        height: "var(--topbar-h)", borderBottom: "1px solid var(--border-hair)",
        background: "var(--bone-100)",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--accent)",
        }}><Mark id="buntut" size={17} color="#fff" /></span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--text-strong)" }}>
          Portal klien
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{user.email}</span>
        <Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Keluar</Button>
      </header>

      <main style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "24px 28px 32px" }}>
        {projects === null ? <StateBlock kind="loading" title="Memuat…" />
          : projects.length === 0 ? (
            <StateBlock kind="empty" icon="folder"
              title={failed ? "Gagal memuat data" : "Belum ada project yang bisa dilihat"}
              hint={failed ? "Coba muat ulang halaman ini."
                : "Hubungi tim hanoman untuk meminta akses ke project Anda."} />
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
                {projects.map((p) => (
                  <Button key={p.id} size="sm" variant={p.id === active ? "primary" : "ghost"}
                    onClick={() => setActive(p.id)}>{p.name}</Button>
                ))}
              </div>

              <Tabs tabs={[
                { key: "backlog", label: `Pekerjaan (${backlog.length})` },
                { key: "tickets", label: `Help desk (${tickets.length})` },
              ]} active={tab} onChange={(k) => setTab(k as "backlog" | "tickets")} />

              {tab === "backlog" ? (
                backlog.length === 0
                  ? <StateBlock kind="empty" icon="list-checks" title="Belum ada pekerjaan tercatat" />
                  : <Card padding={0}>
                      {backlog.map((s) => (
                        <div key={s.id} role="button" tabIndex={0}
                          onClick={() => void portalApi.getSpec(active!, s.id).then(setOpenSpec)}
                          onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getSpec(active!, s.id).then(setOpenSpec); }}
                          style={rowStyle}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)", width: 92 }}>{s.id}</span>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{s.title}</span>
                          <StatusPill tone={stageTone(s.stage)}>{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
                          <span style={metaStyle}>{s.priority}</span>
                          <span style={metaStyle}>{tanggal(s.doneAt ?? s.startedAt ?? s.createdAt)}</span>
                        </div>
                      ))}
                    </Card>
              ) : (
                tickets.length === 0
                  ? <StateBlock kind="empty" icon="inbox" title="Belum ada tiket" />
                  : <Card padding={0}>
                      {tickets.map((t) => (
                        <div key={t.id} role="button" tabIndex={0}
                          onClick={() => void portalApi.getTicket(active!, t.id).then(setOpenTicket)}
                          onKeyDown={(e) => { if (e.key === "Enter") void portalApi.getTicket(active!, t.id).then(setOpenTicket); }}
                          style={rowStyle}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)", width: 48 }}>#{t.number}</span>
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 500, color: "var(--text-strong)" }}>{t.title}</span>
                          <span style={metaStyle}>{t.category}</span>
                          <StatusPill tone="idle">{t.status}</StatusPill>
                          <span style={metaStyle}>{tanggal(t.createdAt)}</span>
                        </div>
                      ))}
                    </Card>
              )}
            </>
          )}
      </main>

      <Modal open={!!openSpec} title={openSpec?.title ?? ""} onClose={() => setOpenSpec(null)}>
        {openSpec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{openSpec.id}</span>
              <StatusPill tone={stageTone(openSpec.stage)}>{STAGE_LABEL[openSpec.stage] ?? openSpec.stage}</StatusPill>
              <span style={metaStyle}>prioritas {openSpec.priority}</span>
            </div>
            <p style={{ margin: 0, lineHeight: 1.6 }}>{openSpec.objective}</p>
            <dl style={dlStyle}>
              <dt style={dtStyle}>Dibuat</dt><dd style={ddStyle}>{tanggal(openSpec.createdAt)}</dd>
              <dt style={dtStyle}>Mulai</dt><dd style={ddStyle}>{tanggal(openSpec.startedAt)}</dd>
              <dt style={dtStyle}>Selesai</dt><dd style={ddStyle}>{tanggal(openSpec.doneAt)}</dd>
            </dl>
          </div>
        )}
      </Modal>

      <Modal open={!!openTicket} title={openTicket?.title ?? ""} onClose={() => setOpenTicket(null)}>
        {openTicket && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>#{openTicket.number}</span>
              <StatusPill tone="idle">{openTicket.status}</StatusPill>
              <span style={metaStyle}>{openTicket.category}</span>
            </div>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{openTicket.detail}</p>
            <span style={metaStyle}>Dikirim {tanggal(openTicket.createdAt)}</span>
          </div>
        )}
      </Modal>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
  borderBottom: "1px solid var(--border-hair)", cursor: "pointer",
};
const metaStyle: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-subtle)" };
const dlStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 16px", margin: 0 };
const dtStyle: React.CSSProperties = { fontSize: "var(--text-sm)", color: "var(--text-subtle)" };
const ddStyle: React.CSSProperties = { margin: 0, fontSize: "var(--text-sm)" };
```

Catatan: bila prop `Tabs`/`StatusPill`/`Modal`/`StateBlock`/`Button` di `src/src/ds` ternyata bernama lain, **ikuti tanda tangan yang ada di sana** — komponen DS adalah kebenaran, bukan cuplikan ini. `Icon` diimpor bila dipakai; hapus importnya bila tidak.

- [x] **Step 5: Percabangan di `App.tsx`**

Ganti blok gerbang auth (`src/src/App.tsx:1101-1104`):

```tsx
  // SPEC-169 · gerbang auth: splash → Setup/Login → app.
  if (!auth) return <StateBlock kind="loading" title="Memuat hanoman…" />;
  if (!auth.user) return <AuthScreen needsSetup={auth.needsSetup} onDone={(u) => setAuth({ needsSetup: false, user: u })} />;
  // SPEC-617 · ADR-0110 · akun klien mendarat di permukaannya sendiri, bukan dashboard operator.
  // Percabangan di sini (bukan di dalam Shell) supaya tak satu pun state/efek dashboard operator
  // pernah dijalankan untuk klien — termasuk poll yang endpointnya memang 403 baginya.
  if (auth.user.role === "client")
    return <ClientPortal user={auth.user} onLoggedOut={onLoggedOut} />;
  const me: UserView = auth.user;
```

dan tambahkan import di kepala berkas, bersama import screen lain:

```tsx
import { ClientPortal } from "./portal/ClientPortal";
```

- [x] **Step 6: Jalankan test**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/client-portal.test.tsx src/test/app-states.test.tsx src/test/app-flows.test.tsx
```
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/src/api/portal.ts src/src/portal src/src/App.tsx src/test/client-portal.test.tsx
git commit -m "feat(spec-617): portal klien di dashboard (fork sesudah gerbang auth)"
```


### Task 8: Layar admin "Akses klien"

**Files:**
- Create: `src/src/screens/ClientAccessPanel.tsx`
- Modify: `src/src/api/client.ts` (empat method + import tipe)
- Modify: `src/src/screens/SettingsScreen.tsx` (satu tab)
- Test: `src/test/client-access-panel.test.tsx`

**Interfaces:**
- Consumes: `ClientAccountView` (Task 6), `api` (`src/src/api/client.ts`)
- Produces: `api.listClientAccounts()`, `api.createClientAccount(input)`, `api.updateClientAccount(id, input)`, `api.deleteClientAccount(id)`; komponen `<ClientAccessPanel />`.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/client-access-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientAccessPanel } from "../src/screens/ClientAccessPanel";

vi.mock("../src/api/client", () => ({
  api: {
    listClientAccounts: vi.fn(), createClientAccount: vi.fn(),
    updateClientAccount: vi.fn(), deleteClientAccount: vi.fn(), listProjects: vi.fn(),
  },
}));
import { api } from "../src/api/client";

const ACCOUNT = { id: "u1", email: "klien@x.co", disabled: false, createdAt: "2026-08-01T00:00:00Z", projects: ["p1"] };

beforeEach(() => {
  (api.listClientAccounts as any).mockResolvedValue({ items: [ACCOUNT] });
  (api.listProjects as any).mockResolvedValue({ items: [
    { id: "p1", name: "Toko Mekar" }, { id: "p2", name: "Warung Sedap" }] });
  (api.createClientAccount as any).mockResolvedValue({ ...ACCOUNT, id: "u2", email: "baru@x.co", projects: ["p2"] });
  (api.updateClientAccount as any).mockResolvedValue({ ...ACCOUNT, disabled: true });
  (api.deleteClientAccount as any).mockResolvedValue(undefined);
});

describe("ClientAccessPanel (SPEC-617)", () => {
  it("menampilkan akun klien beserta project yang boleh ia lihat", async () => {
    render(<ClientAccessPanel />);
    expect(await screen.findByText("klien@x.co")).toBeTruthy();
    expect(await screen.findByText(/Toko Mekar/)).toBeTruthy();
  });

  it("membuat akun klien dengan project terpilih", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.change(screen.getByLabelText("Email klien"), { target: { value: "baru@x.co" } });
    fireEvent.change(screen.getByLabelText("Password awal"), { target: { value: "password9" } });
    fireEvent.click(screen.getByLabelText("Warung Sedap"));
    fireEvent.click(screen.getByRole("button", { name: /buat akun/i }));
    await waitFor(() => expect(api.createClientAccount).toHaveBeenCalledWith(
      { email: "baru@x.co", password: "password9", projects: ["p2"] }));
  });

  it("menonaktifkan akun", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.click(screen.getByRole("button", { name: /nonaktifkan/i }));
    await waitFor(() => expect(api.updateClientAccount).toHaveBeenCalledWith("u1", { disabled: true }));
  });

  it("menghapus akun", async () => {
    render(<ClientAccessPanel />);
    await screen.findByText("klien@x.co");
    fireEvent.click(screen.getByRole("button", { name: /hapus/i }));
    await waitFor(() => expect(api.deleteClientAccount).toHaveBeenCalledWith("u1"));
  });
});
```

- [x] **Step 2: Jalankan — harus gagal**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/client-access-panel.test.tsx
```
Expected: FAIL — modul tak ada.

- [x] **Step 3: Method API**

Di `src/src/api/client.ts`, tambahkan `type ClientAccountView` pada daftar import `@hanoman/shared`, lalu tambahkan method di objek `api` (dekat method `agentToken*`):

```ts
  // SPEC-617 · ADR-0110 · kelola akun klien (cookie-only, admin).
  listClientAccounts: () => j<{ items: ClientAccountView[] }>("/api/client-accounts"),
  createClientAccount: (input: { email: string; password: string; projects: string[] }) =>
    j<ClientAccountView>("/api/client-accounts", { method: "POST", body: JSON.stringify(input) }),
  updateClientAccount: (id: string, input: { projects?: string[]; disabled?: boolean; password?: string }) =>
    j<ClientAccountView>(`/api/client-accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  deleteClientAccount: (id: string) =>
    j<void>(`/api/client-accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
```

- [x] **Step 4: Komponen panel**

Buat `src/src/screens/ClientAccessPanel.tsx`:

```tsx
import React from "react";
import type { ClientAccountView } from "@hanoman/shared";
import { Button, Card, Checkbox, Field, Input, StateBlock, StatusPill } from "../ds";
import { api } from "../api/client";

// SPEC-617 · ADR-0110 · layar admin "Akses klien". Berkasnya sendiri: SettingsScreen.tsx sudah
// ~80 KB, dan panel ini punya state serta siklus datanya sendiri.

export function ClientAccessPanel() {
  const [accounts, setAccounts] = React.useState<ClientAccountView[] | null>(null);
  const [projects, setProjects] = React.useState<{ id: string; name: string }[]>([]);
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);

  const reload = React.useCallback(() =>
    api.listClientAccounts().then((r) => setAccounts(r.items)).catch(() => setAccounts([])), []);

  React.useEffect(() => {
    void reload();
    void api.listProjects().then((r) => setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, [reload]);

  const toggle = (id: string, on: boolean) =>
    setPicked((cur) => on ? [...cur, id] : cur.filter((v) => v !== id));

  const create = async () => {
    setErr(null);
    try {
      await api.createClientAccount({ email, password, projects: picked });
      setEmail(""); setPassword(""); setPicked([]);
      await reload();
    } catch { setErr("Gagal membuat akun — periksa email (mungkin sudah dipakai) dan panjang password."); }
  };

  const setDisabled = async (a: ClientAccountView, disabled: boolean) => {
    await api.updateClientAccount(a.id, { disabled });
    await reload();
  };
  const remove = async (a: ClientAccountView) => { await api.deleteClientAccount(a.id); await reload(); };
  const setProjectsOf = async (a: ClientAccountView, ids: string[]) => {
    await api.updateClientAccount(a.id, { projects: ids });
    await reload();
  };

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Card title="Buat akun klien"
        subtitle="Klien melihat daftar backlog & tiket help desk project yang dipilih — baca-saja, tanpa akses dashboard operator.">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Email klien">
            <Input aria-label="Email klien" placeholder="mis. budi@tokomekar.co.id"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password awal" hint="Minimal 8 karakter. Sampaikan ke klien lewat kanal yang aman; ia bisa menggantinya sendiri.">
            <Input aria-label="Password awal" type="password" placeholder="mis. kunci-tokomekar-2026"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Project yang boleh dilihat">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {projects.map((p) => (
                <Checkbox key={p.id} label={p.name} aria-label={p.name}
                  checked={picked.includes(p.id)}
                  onChange={(e) => toggle(p.id, e.target.checked)} />
              ))}
            </div>
          </Field>
          {err && <span style={{ color: "var(--status-err)", fontSize: "var(--text-sm)" }}>{err}</span>}
          <div><Button size="sm" leftIcon="user-plus" onClick={create}
            disabled={!email || password.length < 8}>Buat akun</Button></div>
        </div>
      </Card>

      <Card title="Akun klien" subtitle="Cabut akses dengan menonaktifkan, atau hapus akunnya sama sekali.">
        {accounts === null ? <StateBlock kind="loading" title="Memuat…" />
          : accounts.length === 0
            ? <StateBlock kind="empty" icon="users" title="Belum ada akun klien"
                hint="Buat akun di atas, lalu pilih project yang boleh ia lihat." />
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {accounts.map((a) => (
                  <div key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                    padding: "10px 0", borderBottom: "1px solid var(--border-hair)",
                  }}>
                    <span style={{ fontWeight: 500, color: "var(--text-strong)" }}>{a.email}</span>
                    <StatusPill tone={a.disabled ? "idle" : "ok"}>{a.disabled ? "nonaktif" : "aktif"}</StatusPill>
                    <span style={{ flex: 1, minWidth: 200, fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>
                      {a.projects.length ? a.projects.map(nameOf).join(" · ") : "belum diberi project"}
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {projects.map((p) => (
                        <Checkbox key={p.id} label={p.name} aria-label={`${a.email} · ${p.name}`}
                          checked={a.projects.includes(p.id)}
                          onChange={(e) => void setProjectsOf(a, e.target.checked
                            ? [...a.projects, p.id] : a.projects.filter((v) => v !== p.id))} />
                      ))}
                    </div>
                    <Button size="sm" variant="ghost"
                      onClick={() => void setDisabled(a, !a.disabled)}>
                      {a.disabled ? "Aktifkan" : "Nonaktifkan"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(a)}>Hapus</Button>
                  </div>
                ))}
              </div>
            )}
      </Card>
    </div>
  );
}
```

Catatan: `Card`/`Field`/`Checkbox` di repo ini punya tanda tangan sendiri (`title`/`subtitle`/`label`/`hint` mungkin bernama lain) — **baca `src/src/ds` dan ikuti yang ada di sana**, jangan memaksakan cuplikan ini.

- [x] **Step 5: Pasang sebagai tab Settings**

Di `src/src/screens/SettingsScreen.tsx`, tambahkan import:

```tsx
import { ClientAccessPanel } from "./ClientAccessPanel";
```

lalu tambahkan satu entri pada daftar tab (mengikuti bentuk entri tab yang sudah ada di berkas itu) dengan key `client-access`, label **"Akses klien"**, dan isi `<ClientAccessPanel />`.

- [x] **Step 6: Jalankan test**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism src/test/client-access-panel.test.tsx src/test/settings-screen.test.tsx src/test/placeholder-contract.test.ts
pnpm --filter ./src typecheck
```
Expected: PASS + nol error typecheck. (Nama berkas test Settings/placeholder mengikuti yang ada di `src/test`; lewati yang memang tak ada.)

- [x] **Step 7: Commit**

```bash
git add src/src/screens/ClientAccessPanel.tsx src/src/screens/SettingsScreen.tsx src/src/api/client.ts src/test/client-access-panel.test.tsx
git commit -m "feat(spec-617): layar admin kelola akses klien"
```


### Task 9: Docs Source of Truth — ADR-0110 + index + doc tersentuh

**Files:**
- Create: `internal/docs/adr/0110-portal-klien-read-only.md`
- Modify: `internal/docs/README.md` (daftar ADR, satu baris)
- Modify: `internal/docs/adr/README.md` (narasi)
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/security/security-standard.md`
- Modify: `internal/skills/hanoman/SKILL.md` (Aturan Keamanan + Aturan Data & Skema)
- Modify: `docs/agent-integration.md` **hanya bila** `agent-doc-contract.test.ts` menuntutnya

**Interfaces:**
- Consumes: seluruh keputusan Task 1-8
- Produces: jejak permanen keputusan; ADR baru ter-link di **dua** index (README + adr/README).

- [ ] **Step 1: Enumerasi ulang nomor ADR**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman
for b in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree -r --name-only "$b" -- internal/docs/adr 2>/dev/null; done | grep -o '01[0-9][0-9]-' | sort -u | tail -3
git worktree list
```
Expected: `0110-` belum terpakai. Bila sudah, naikkan ke nomor bebas berikutnya **di seluruh berkas** yang menyebutnya.

- [ ] **Step 2: Tulis ADR-0110**

`internal/docs/adr/0110-portal-klien-read-only.md` memuat: konteks (tak ada RBAC, `app.ts:120`
`if (user) return`), keputusan (peran `admin|client` + `ClientProjectAccess` + gerbang
deny-by-default + namespace `/api/portal` + proyeksi allowlist-field), konsekuensi, alternatif yang
ditolak (penyaringan di atas route operator; kolom `Json` daftar project; RBAC per-permission),
dan gotcha:
1. `role` default **`"admin"`** — itulah yang membuat migrasi aman untuk hub produksi.
2. Gerbang duduk **sebelum** bypass `/api/sync` & `/api/help` supaya allowlist adalah pernyataan lengkap.
3. Nonaktif ditegakkan di **dua** titik (login **dan** `lookupSession`) — sesi hidup 7 hari.
4. `DELETE /auth/users/:id` menjaga **admin terakhir**, bukan user terakhir.
5. Proyeksi = allowlist field eksplisit, bukan `Omit<>` — kolom Prisma baru tak ikut senyap.
6. Project bukan-miliknya dan project tak-ada dijawab **404 yang sama** (tak jadi alat enumerasi).
7. `ClientProjectAccess` **LOCAL-only** (tak di `SYNCED`/`FIELDS`) tapi **wajib** di `PG_ORDER`.

- [ ] **Step 3: Tautkan di kedua index**

`internal/docs/README.md`, di puncak daftar ADR:

```markdown
- [0110 — Portal klien read-only: peran `admin|client`, akses per project, gerbang deny-by-default](adr/0110-portal-klien-read-only.md)
```

`internal/docs/adr/README.md`: satu paragraf narasi bergaya entri di sekitarnya (apa yang diperluas/diamandemen: ADR-0028 auth diperluas dengan peran; ADR-0062 Help Center jadi sumber tiket; ADR-0065 tak berubah — klien adalah jalur cookie).

- [ ] **Step 4: Perbarui doc arsitektur & keamanan**

- `architecture/data-model.md`: `User.role`/`User.disabled` + model `ClientProjectAccess` (LOCAL-only, cascade dua sisi, unique gabungan).
- `architecture/api-contract.md`: lima endpoint `/api/portal/*` (GET, cookie-only, ber-scope akses) dan empat `/api/client-accounts` (cookie-only, admin), plus catatan 403 deny-by-default untuk `role=client`.
- `security/security-standard.md`: bagian auth — dua peran, allowlist klien, nonaktif dua titik, admin terakhir dijaga.
- `internal/skills/hanoman/SKILL.md`: baris "Tanpa RBAC — semua user setara" di **Aturan Keamanan** WAJIB diperbarui (kini salah), dan daftar model di **Aturan Data & Skema** ditambah `ClientProjectAccess`.

- [ ] **Step 5: Jalankan test kontrak docs & index**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/agent-doc-contract.test.ts
node --import tsx cli/src/index.ts docs index --check
```
Expected: PASS + index bersih. Bila `agent-doc-contract` menuntut naskah agen menyebut route/COOKIE_ONLY baru, perbarui `docs/agent-integration.md` sampai hijau.

- [ ] **Step 6: Commit**

```bash
git add internal/docs docs/agent-integration.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-617): ADR-0110 portal klien read-only + perbarui SoT tersentuh"
```

---

### Task 10: Verifikasi akhir — smoke endpoint nyata

**Files:** tak ada perubahan kode; bila ada temuan, perbaiki di berkas yang bersangkutan.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh SPEC ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/client-access-schema.test.ts server/test/client-route-allowed.test.ts \
  server/test/client-gate.test.ts server/test/portal.route.test.ts \
  server/test/client-accounts.route.test.ts server/test/auth-routes.test.ts \
  server/test/auth-service.test.ts server/test/agent-gate.test.ts \
  server/test/agent-capabilities.test.ts server/test/mcp-capability.test.ts \
  server/test/app.test.ts server/test/agent-doc-contract.test.ts \
  cli/test/migrate-pg.test.ts shared/src/portal.test.ts
env -u NODE_ENV ./node_modules/.bin/vitest --run --no-file-parallelism \
  src/test/client-portal.test.tsx src/test/client-access-panel.test.tsx \
  src/test/app-states.test.tsx src/test/app-flows.test.tsx src/test/auth-context.test.tsx
```
Expected: semua PASS, dan **jumlah test > 0** di tiap berkas (`--changed` tidak dipakai di sini justru supaya nol-test tak terbaca hijau).

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck && pnpm --filter ./cli typecheck
```
Expected: nol error. (Empat paket memang tersentuh — skema + tipe bersama berdampak luas; ini pengecualian yang dinyatakan, bukan rutinitas.)

- [ ] **Step 3: Smoke endpoint nyata (boot server + curl)**

```bash
export HANOMAN_HOME="$(mktemp -d)"
./node_modules/.bin/prisma migrate deploy --schema server/prisma/schema.prisma
node --import tsx server/src/server.ts &   # PORT default 8787; catat PID-nya
```

Lalu, dengan `curl -c/-b` cookie jar:
1. `POST /api/auth/setup` → admin pertama.
2. `POST /api/projects` → satu project.
3. `POST /api/client-accounts` → akun klien + project itu.
4. `POST /api/auth/login` sebagai klien → cookie klien.
5. `GET /api/portal/projects` → **200**, hanya project itu.
6. `GET /api/specs` dengan cookie klien → **403**.
7. `POST /api/specs` dengan cookie klien → **403**.
8. `GET /api/portal/projects/<lain>/backlog` → **404**.

Matikan server **per-PID**: `kill <pid>` (JANGAN `pkill -f node` — itu membunuh sesi agen tetangga, SPEC-402).

- [ ] **Step 4: Centang seluruh kotak plan & pastikan tak ada `- [ ]` tersisa**

```bash
grep -c "^- \[ \]" docs/superpowers/plans/2026-08-10-portal-klien-read-only.md || true
```
Expected: `0` (grep exit 1 = nol kecocokan). Selama masih ada, hanoman menahan backlog di `executing`.

- [ ] **Step 5: Commit sisa & push**

```bash
git add -A && git commit -m "chore(spec-617): centang plan portal klien + bukti verifikasi"
git push origin HEAD:refs/heads/hanoman/spec-617
```
