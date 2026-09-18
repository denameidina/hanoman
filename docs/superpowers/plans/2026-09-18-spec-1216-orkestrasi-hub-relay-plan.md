# SPEC-1216 (turunan B SPEC-1215) — Orkestrasi dari hub: plan implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup AC-B1…AC-B11 (SPEC-1215 §S9) — route relay HTTP di hub, gerbang satu sesi lintas
instance, `launchPrincipal` remote + `force` 403, retry `syncOnce` untuk spec-404, dan frontend
(`createApi`/`InstanceContext`/dialog Start bertarget) — sebagai test kontrak yang bisa dijalankan
ulang, plus update `internal/docs` dalam commit yang sama dengan kode.

**Architecture:** Fondasi kanal (socket relay, gate, dispatcher `req`, registry, audit `remote.request`)
sudah berdiri dari turunan A (base `61bc006c`). Plan ini murni menambah: (1) route HTTP hub
`devices-relay.ts` yang memanggil `requestRelay()` yang sudah ada; (2) cabang principal `remote` +
gerbang presence (murni, hanya menolak) di jalur peluncuran/penyelesaian yang sudah ada; (3) retry
`syncOnce` satu kali di dispatcher klien; (4) `createApi({base})`/`InstanceContext`/`startTargets()`
di frontend, dikonsumsi `StartSessionModal`. Tidak ada skema Prisma baru.

**Tech Stack:** Fastify (route/hook), Zod (`@hanoman/shared`), Prisma 6 (SQLite), Vitest, React 18 + TS.

## Global Constraints

- Kontrak (route, status, body, urutan gerbang, tanda tangan fungsi) sudah dikunci —
  `docs/superpowers/specs/2026-09-18-spec-1216-orkestrasi-hub-relay-design.md` §T1–T11. Jangan
  mendesain ulang; setiap penyimpangan yang ditemukan saat implementasi dicatat sebagai catatan
  eksekusi, bukan diputuskan sepihak.
- Presence hanya boleh MENOLAK atau MENGUSULKAN, tak pernah meluluskan (ADR-0165 §8). Tak ada jalur
  baru yang melewati `assertLaunchApproved`, gerbang dependency (`blockersForSpec`), atau
  `withSessionAdmission`.
- Tanpa Redis/queue/worker/Docker (ADR-0024/0086). Tanpa auto-dispatch scheduler/lead ke klien.
- Tiap task ditutup dengan test yang **benar-benar tersentuh** perubahan itu, dijalankan:
  `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <paths>`
  (CLAUDE.md + SPEC-479) — bukan suite penuh.
- Commit sering, satu task = satu (atau beberapa kecil) commit dengan pesan yang menyebut AC-nya.
- Task terakhir (docs) wajib mencabut frasa "SPEC-1216" dari
  `internal/docs/frontend/frontend-implementation.md:47` dan menautkan doc yang berubah di
  `internal/docs/README.md`, dalam commit yang sama dengan kode fase Execute — bukan commit terpisah.

---

## File Structure

| Berkas | Peran |
|---|---|
| `shared/src/relay.ts` | ekspor `zRelayPath` (sudah ada, tinggal `export`) |
| `server/src/services/agent-capabilities.ts` | tambah baris top `devices` → `"COOKIE_ONLY"` eksplisit |
| `server/src/routes/devices-relay.ts` (baru) | route HTTP relay hub, satu handler lima method |
| `server/src/app.ts` | registrasi `devices-relay` |
| `server/src/services/launch-authority.ts` | `launchPrincipal` mengenal `source.remote` |
| `server/src/routes/terminal.ts` | `force` dari `req.remote` → 403; mapping `LaunchError` baru → 409 |
| `server/src/services/presence/registry.ts` | `recordRecentlyOffline`/`recentlyOffline()` |
| `server/src/services/presence/remote-session.ts` (baru) | `remoteSessionVerdict()` murni |
| `server/src/services/session-launch.ts` | gerbang presence di `startSpecSession`, `LaunchError` kind baru |
| `server/src/routes/specs.ts` | `POST /specs/:id/done` lapis gerbang presence kedua |
| `server/src/services/relay/dispatcher.ts` | retry spec-404 → satu `syncOnce` lalu satu ulang |
| `server/src/services/relay/client.ts` | menyuntik `syncOnce: () => syncNow()` |
| `src/src/api/client.ts` | `createApi({base})`, `export const api = createApi()` |
| `src/src/api/instance.tsx` (baru) | `InstanceContext`, `useInstance`, `useApi`, `useWsTarget` |
| `src/src/api/start-targets.ts` (baru) | `startTargets()` murni |
| `src/src/App.tsx` (`StartSessionModal`) | pemilih target, default, alasan tak terpilih, 409 baru |
| `internal/docs/**` | docs yang tersentuh (Task 12) |

---

## Task 1: `devices` COOKIE_ONLY eksplisit + `zRelayPath` diekspor

**Files:**
- Modify: `shared/src/relay.ts:97` (`const zRelayPath` → `export const zRelayPath`)
- Modify: `server/src/services/agent-capabilities.ts` (tambah baris `top === "devices"` ke blok
  tak-boleh-didelegasikan, sekitar baris yang memuat `top === "remote-control"`)
- Test: `server/test/agent-capabilities.test.ts` (berkas sudah ada — tambah satu `it`)

**Interfaces:**
- Produces: `zRelayPath: z.ZodType<string>` (dipakai Task 2 untuk validasi `params["*"]`);
  `capabilityForRoute("GET", "/api/devices/x/relay/terminal/sessions") === "COOKIE_ONLY"`.

- [x] **Step 1: Cari nama test file yang ada dan tulis test yang gagal**

```bash
grep -n "remote-control\"" server/test/agent-capabilities.test.ts
```

Tambahkan di berkas itu (dekat test top `remote-control`/`presence`):

```ts
it("top devices → COOKIE_ONLY (SPEC-1216 · ADR-0165 §4)", () => {
  expect(capabilityForRoute("GET", "/api/devices/dev1/relay/terminal/sessions")).toBe("COOKIE_ONLY");
  expect(capabilityForRoute("POST", "/api/devices/dev1/relay/specs/x/done")).toBe("COOKIE_ONLY");
});
```

- [x] **Step 2: Jalankan test, pastikan gagal (capabilityForRoute memulangkan `rw(...)` atau null)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts
```
Expected: FAIL (nilai ≠ `"COOKIE_ONLY"`).

- [x] **Step 3: Implementasi**

Di `server/src/services/agent-capabilities.ts`, blok tak-boleh-didelegasikan (yang memuat
`top === "presence"`), tambahkan `"devices"` ke daftar `||`:

```ts
if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
  || top === "presence" || top === "models" || top === "remote-control"
  || top === "portal" || top === "client-accounts" || top === "session-events"
  // SPEC-1216 · ADR-0165 §4 · `/devices/:id/relay/*` menjalankan aksi sesi di MESIN LAIN atas nama
  // operator — capability apa pun yang bisa mendelegasikannya adalah eskalasi RCE lintas mesin
  // (preseden `remote-control`).
  || top === "devices") return "COOKIE_ONLY";
```

Di `shared/src/relay.ts:97`, tambahkan `export`:

```ts
export const zRelayPath = z.string().max(2048).regex(/^\/api\//).refine((p) => !UNSAFE_PATH.test(p), "path relay tak sah");
```

- [x] **Step 4: Jalankan test lagi, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts shared/src/relay.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/relay.ts server/src/services/agent-capabilities.ts server/test/agent-capabilities.test.ts
git commit -m "feat(spec-1216): top devices COOKIE_ONLY + ekspor zRelayPath (AC-B1)"
```

---

## Task 2: Route `server/src/routes/devices-relay.ts` + audit + registrasi

**Files:**
- Create: `server/src/routes/devices-relay.ts`
- Modify: `server/src/app.ts` (import + `await api.register(devicesRelay);` sesudah baris
  `await api.register(remoteControl);`)
- Test: `server/test/devices-relay.route.test.ts` (baru)

**Interfaces:**
- Consumes: `requestRelay(deviceId, {method,path,query,body,actor}, {timeoutMs}): Promise<RelayResponse>`
  dan `RelayError` (`server/src/services/relay/hub.ts`, sudah ada, T1); `zRelayPath` (Task 1);
  `appendEvent()` (`server/src/services/logs/event-log.ts`, sudah ada);
  `RELAY_SPAWN_TIMEOUT_MS`/`RELAY_REQ_TIMEOUT_MS` (`@hanoman/shared`).
- Produces: `GET|POST|PUT|PATCH|DELETE /api/devices/:deviceId/relay/*` — dipakai Task 5/6 tanpa
  perubahan lanjutan (route ini tak tahu soal gerbang presence; itu murni di klien lewat jalur yang
  sudah ada).

- [x] **Step 1: Tulis test tabel-driven yang gagal (mock `requestRelay`)**

```ts
// server/test/devices-relay.route.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
vi.mock("../src/services/relay/hub", async (orig) => {
  const mod = await orig<typeof import("../src/services/relay/hub")>();
  return { ...mod, requestRelay: vi.fn() };
});
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { __resetEventLog } from "../src/services/logs/event-log";
import { requestRelay, RelayError } from "../src/services/relay/hub";

const app = buildApp();
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); await prisma.logEntry.deleteMany();
};
let cookie = "";
beforeEach(async () => {
  await clean(); __resetEventLog(); vi.mocked(requestRelay).mockReset();
  const u = await prisma.user.create({ data: { email: "op@d.co", passwordHash: "x:y" } });
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  await prisma.user.deleteMany({ where: { NOT: { email: "op@d.co" } } });
});
afterAll(async () => { await app.close(); await clean(); });

const relay = (url: string, opts: { method?: string; payload?: unknown; ct?: string } = {}) =>
  app.inject({
    method: (opts.method ?? "POST") as any, url, headers: { cookie, ...(opts.ct ? { "content-type": opts.ct } : {}) },
    ...(opts.payload !== undefined ? { payload: opts.payload as any } : {}),
  });

describe("/api/devices/:deviceId/relay/* (SPEC-1216 · AC-B1/B9/B10)", () => {
  it("device tak dikenal → 404 unknown-device, audit relay.request warn", async () => {
    const res = await relay("/api/devices/nope/relay/terminal/sessions", { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: expect.any(String), relay: "unknown-device" });
    const rows = await prisma.logEntry.findMany({ where: { kind: "relay.request" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.level).toBe("warn");
  });

  it("content-type non-JSON pada POST → 415 unsupported-media", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { ct: "text/plain", payload: "x" });
    expect(res.statusCode).toBe(415);
    expect(res.json().relay).toBe("unsupported-media");
  });

  const table: Array<[RelayError["kind"], number, string]> = [
    ["offline", 503, "offline"], ["protocol-mismatch", 409, "protocol-mismatch"],
    ["too-large", 413, "too-large"], ["busy", 429, "busy"],
    ["protocol", 502, "protocol"], ["timeout", 504, "timeout"],
  ];
  it.each(table)("RelayError %s → %i {relay:%s}", async (kind, status, relayKind) => {
    const u = await prisma.user.create({ data: { email: `d-${kind}@d.co`, passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError(kind));
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(status);
    expect(res.json().relay).toBe(relayKind);
  });

  it("sukses → status/body/content-type klien diteruskan + header x-hanoman-device (AC-B9)", async () => {
    const u = await prisma.user.create({ data: { email: "d2@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockResolvedValueOnce({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "sess-1" }) });
    const res = await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: "sess-1" });
    expect(res.headers["x-hanoman-device"]).toBe(t.id);
    expect(vi.mocked(requestRelay)).toHaveBeenCalledWith(t.id, expect.objectContaining({
      method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" },
      actor: expect.objectContaining({ userId: expect.any(String), email: "op@d.co" }),
    }), { timeoutMs: expect.any(Number) });
  });

  it("timeout mapping memakai RELAY_SPAWN_TIMEOUT_MS untuk POST …/terminal/sessions, RELAY_REQ_TIMEOUT_MS selainnya", async () => {
    const u = await prisma.user.create({ data: { email: "d3@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockResolvedValue({ status: 200, contentType: "application/json", body: "{}" });
    await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    await relay(`/api/devices/${t.id}/relay/terminal/sessions/x/steer`, { payload: { message: "hi" } });
    const calls = vi.mocked(requestRelay).mock.calls;
    expect(calls[0]![2]!.timeoutMs).toBe(120_000);
    expect(calls[1]![2]!.timeoutMs).toBe(30_000);
  });

  it("AC-B10 · jalur galat tak menulis Prisma selain deviceToken (baca) dan logEntry (audit)", async () => {
    const u = await prisma.user.create({ data: { email: "d4@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    vi.mocked(requestRelay).mockRejectedValueOnce(new RelayError("offline"));
    const before = await prisma.spec.count();
    await relay(`/api/devices/${t.id}/relay/terminal/sessions`, { payload: { spec: "SPEC-1" } });
    expect(await prisma.spec.count()).toBe(before);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal (404 keseluruhan — route belum ada)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/devices-relay.route.test.ts
```
Expected: FAIL (banyak assert status).

- [x] **Step 3: Implementasi route**

```ts
// server/src/routes/devices-relay.ts
import type { FastifyInstance } from "fastify";
import { zRelayPath, RELAY_METHODS, RELAY_REQ_TIMEOUT_MS, RELAY_SPAWN_TIMEOUT_MS, type RelayActor } from "@hanoman/shared";
import { prisma } from "../db";
import { requestRelay, RelayError, type RelayResponse } from "../services/relay/hub";
import { appendEvent } from "../services/logs/event-log";
import { relayControlFor } from "../services/relay/hub";

// SPEC-1216 · ADR-0165 §4/§6 · permukaan HTTP hub yang meneruskan aksi sesi ke klien opt-in.
// COOKIE_ONLY (top `devices`, Task 1): agen/remote tak boleh mendelegasikan aksi lintas mesin.
const STATUS_FOR: Record<RelayError["kind"], number> = {
  offline: 503, "protocol-mismatch": 409, "too-large": 413, busy: 429, protocol: 502, timeout: 504,
};

function specIdOf(path: string, body: unknown): string | undefined {
  const m = path.match(/\/specs\/([^/]+)/);
  if (m) return m[1];
  if (body && typeof body === "object" && "spec" in (body as any) && typeof (body as any).spec === "string") return (body as any).spec;
  return undefined;
}

export default async function (app: FastifyInstance) {
  app.route({
    method: [...RELAY_METHODS] as any,
    url: "/devices/:deviceId/relay/*",
    handler: async (req, reply) => {
      // Principal: gate app.ts sudah menolak req.agent/req.remote lebih dulu (route COOKIE_ONLY),
      // jadi di sini req.user wajib ada.
      if (!req.user) return reply.code(401).send({ error: "unauthorized" });
      const { deviceId } = req.params as { deviceId: string };
      const wildcard = (req.params as { "*"?: string })["*"] ?? "";
      const path = `/api/${wildcard}`;
      if (!zRelayPath.safeParse(path).success) return reply.code(400).send({ error: "path relay tak sah" });

      const hasBody = req.method !== "GET" && req.method !== "DELETE";
      const ct = req.headers["content-type"] ?? "";
      if (hasBody && req.body !== undefined && req.body !== null && !ct.includes("application/json"))
        return reply.code(415).send({ error: "content-type harus application/json", relay: "unsupported-media" });

      const device = await prisma.deviceToken.findFirst({ where: { id: deviceId, revokedAt: null } });
      const started = Date.now();
      const method = req.method as typeof RELAY_METHODS[number];
      const q = req.raw.url?.split("?")[1];
      const specId = specIdOf(path, req.body);
      const audit = (status: number, extra: Record<string, unknown> = {}) => appendEvent({
        kind: "relay.request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        msg: `${method} ${path} → ${status}`, specId,
        data: { deviceId, actor: { userId: req.user!.id, email: req.user!.email }, method, path, status, ms: Date.now() - started, ...extra },
      });

      if (!device) { await audit(404); return reply.code(404).send({ error: "device tak dikenal", relay: "unknown-device" }); }

      const hubOrigin = String(req.headers.origin ?? `${req.protocol}://${req.headers.host}`).slice(0, 200);
      const actor: RelayActor = { hubOrigin, userId: req.user.id, email: req.user.email };
      const timeoutMs = method === "POST" && path === "/api/terminal/sessions" ? RELAY_SPAWN_TIMEOUT_MS : RELAY_REQ_TIMEOUT_MS;

      let res: RelayResponse;
      try {
        res = await requestRelay(deviceId, {
          method, path, ...(q ? { query: q } : {}),
          ...(hasBody && req.body !== undefined ? { body: req.body } : {}), actor,
        }, { timeoutMs });
      } catch (e) {
        if (e instanceof RelayError) {
          const status = STATUS_FOR[e.kind];
          const extra = e.kind === "offline" ? { presence: relayControlFor(deviceId) ? "online" : "offline" } : {};
          await audit(status, extra);
          return reply.code(status).send({ error: e.message, relay: e.kind, ...extra });
        }
        throw e;
      }
      await audit(res.status);
      return reply.code(res.status)
        .header("content-type", res.contentType ?? "application/json")
        .header("x-hanoman-device", deviceId)
        .send(res.body);
    },
  });
}
```

Registrasi di `server/src/app.ts`: tambah import dekat baris `import remoteControl from "./routes/remote-control";`

```ts
import devicesRelay from "./routes/devices-relay";
```

dan sesudah `await api.register(remoteControl); // SPEC-1215 · ADR-0165 · grant kendali jarak jauh (cookie-only)`:

```ts
await api.register(devicesRelay);  // SPEC-1216 · ADR-0165 §4/§6 · aksi sesi klien lewat relay (cookie-only)
```

- [x] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/devices-relay.route.test.ts
```
Expected: PASS. Bila `app.route({method:[...]})` menolak tipe array literal RELAY_METHODS, cek pesan
TS — Fastify menerima `string[]`, jadi `[...RELAY_METHODS] as any` sudah cukup longgar; ganti ke
`Array.from(RELAY_METHODS)` bila linter TS lebih ketat.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/devices-relay.ts server/src/app.ts server/test/devices-relay.route.test.ts
git commit -m "feat(spec-1216): route relay hub /api/devices/:id/relay/* + audit relay.request (AC-B1/B9/B10)"
```

---

## Task 3: `launchPrincipal` remote + `force` remote → 403

**Files:**
- Modify: `server/src/services/launch-authority.ts`
- Modify: `server/src/routes/terminal.ts:88` (blok `force`, sekitar baris yang cek `req.agent`)
- Test: `server/test/launch-authority.test.ts` (cari/buat), `server/test/terminal.route.test.ts`
  (cari test force yang ada dan tambah kasus remote)

**Interfaces:**
- Consumes: `req.remote?: RemoteContext` (`server/src/services/relay/gate.ts:11`, sudah ada, T1).
- Produces: `launchPrincipal(source): string | null` — dipakai Task 5 apa adanya (tanda tangan
  sudah kompatibel, `terminal.ts:99` memanggil `launchPrincipal(req)` tanpa perubahan pemanggilan).

- [x] **Step 1: Cari test file & pola yang ada**

```bash
grep -rn "launchPrincipal" server/test/*.ts
```

Tambah test (di berkas yang sudah menguji `launchPrincipal`, atau buat
`server/test/launch-authority.test.ts` bila belum ada):

```ts
import { describe, it, expect } from "vitest";
import { launchPrincipal } from "../src/services/launch-authority";

describe("launchPrincipal (SPEC-1216 · AC-B1/B2)", () => {
  it("user menang atas remote", () => {
    expect(launchPrincipal({
      user: { id: "u1", email: "a@b.co" },
      remote: { actor: { hubOrigin: "http://hub", userId: "h1", email: "op@hub.co" }, capabilities: ["sessions:spawn"] },
    })).toBe("user:a@b.co");
  });
  it("remote ber-sessions:spawn → remote:<email>@<hubOrigin>", () => {
    expect(launchPrincipal({
      remote: { actor: { hubOrigin: "http://hub.local", userId: "h1", email: "op@hub.co" }, capabilities: ["sessions:spawn", "sessions:read"] },
    })).toBe("remote:op@hub.co@http://hub.local");
  });
  it("remote tanpa sessions:spawn → null (tak ada approval)", () => {
    expect(launchPrincipal({
      remote: { actor: { hubOrigin: "http://hub", userId: "h1", email: "op@hub.co" }, capabilities: ["sessions:read"] },
    })).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal (TS: `remote` bukan properti `PrincipalSource`)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/launch-authority.test.ts
```
Expected: FAIL (type error atau assertion mismatch).

- [x] **Step 3: Implementasi**

```ts
// server/src/services/launch-authority.ts
import type { Spec } from "@prisma/client";
import { grantsCapability, type RelayActor } from "@hanoman/shared";
import { prisma } from "../db";

type PrincipalSource = {
  user?: { id: string; email: string } | null;
  agent?: { id: string; capabilities: string[] } | null;
  // SPEC-1216 · ADR-0165 §6 · req.remote (server/src/services/relay/gate.ts). Urutan: user → remote → agent.
  remote?: { actor: RelayActor; capabilities: string[] } | null;
};

export function launchPrincipal(source: PrincipalSource): string | null {
  if (source.user) return `user:${source.user.email}`;
  if (source.remote && grantsCapability(source.remote.capabilities, "sessions:spawn"))
    return `remote:${source.remote.actor.email}@${source.remote.actor.hubOrigin}`;
  if (source.agent && grantsCapability(source.agent.capabilities, "sessions:write"))
    return `agent:${source.agent.id}`;
  return null;
}
// approveLaunch/assertLaunchApproved tak berubah.
```

`terminal.ts:88` (blok force) — `launchPrincipal(req)` di baris 99 sudah memberikan `req` (yang
punya `.user`/`.agent`/`.remote` lewat deklarasi module Fastify di `gate.ts`), jadi TIDAK perlu
diubah pemanggilannya. Ubah HANYA blok force, dari:

```ts
if (req.agent && "force" in parsed.data && parsed.data.force) {
  return reply.code(403).send({ error: "force hanya boleh digunakan manusia melalui dashboard" });
}
```

menjadi:

```ts
// SPEC-1216 · ADR-0165 §6 · cermin ADR-0161: force principal non-manusia ditolak SEBELUM
// approveLaunch, supaya request yang gagal tak meninggalkan launchApprovedBy.
if ((req.agent || req.remote) && "force" in parsed.data && parsed.data.force) {
  return reply.code(403).send({ error: "force hanya boleh digunakan manusia melalui dashboard" });
}
```

- [x] **Step 4: Tulis/lengkapi test route `force` dari remote → 403 sebelum approveLaunch**

Cari test force yang ada:

```bash
grep -n "force hanya boleh" server/test/terminal.route.test.ts
```

Tambahkan kasus remote di berkas yang sama (pola `admitRemoteRequest`/header relay — lihat
`server/test/relay-gate.test.ts` untuk cara memalsukan `req.remote` lewat header
`x-hanoman-relay`/`x-hanoman-relay-actor` dan `RemoteControl` grant menyala):

```ts
it("force dari remote → 403 sebelum approveLaunch; launchApprovedBy tetap null (AC-B3)", async () => {
  // setup: grant remoteControl enabled ber-sessions:spawn, secret proses, header actor —
  // ikuti pola persis relay-gate.test.ts::admitRemoteRequest fixture.
  const res = await injectRemoteRequest(app, {
    method: "POST", url: "/api/terminal/sessions",
    payload: { spec: spec.id, flow: "feature", force: true },
  });
  expect(res.statusCode).toBe(403);
  const after = await prisma.spec.findUnique({ where: { id: spec.id } });
  expect(after!.launchApprovedBy).toBeNull();
});
```

(Sesuaikan helper `injectRemoteRequest` dengan fixture nyata `relay-gate.test.ts` — gate real, bukan
mock, supaya AC-B3 dibuktikan lewat jalur asli.)

- [x] **Step 5: Jalankan seluruh test tersentuh, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/launch-authority.test.ts server/test/terminal.route.test.ts
```
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/src/services/launch-authority.ts server/src/routes/terminal.ts server/test/launch-authority.test.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-1216): launchPrincipal remote + force remote 403 sebelum approveLaunch (AC-B1/B3)"
```

---

## Task 4: `remoteSessionVerdict()` murni + `recentlyOffline` di registry

**Files:**
- Modify: `server/src/services/presence/registry.ts`
- Create: `server/src/services/presence/remote-session.ts`
- Test: `server/test/remote-session-gate.test.ts` (baru) — bagian tabel murni dulu

**Interfaces:**
- Consumes: `PresenceDeviceView[]` (`@hanoman/shared`, sudah ada), `LOCAL_DEVICE_ID` (`@hanoman/shared`).
- Produces: `remoteSessionVerdict(input): RemoteSessionVerdict` (Task 5 memanggilnya di
  `session-launch.ts` dan Task 6 di `specs.ts`); `recordRecentlyOffline(entry)`/
  `recentlyOffline(specId, now?)` (Task 5 membaca ini sebagai input `remoteSessionVerdict`).

- [x] **Step 1: Tulis test tabel murni yang gagal**

```ts
// server/test/remote-session-gate.test.ts (bagian 1 — murni)
import { describe, it, expect } from "vitest";
import { LOCAL_DEVICE_ID, type PresenceDeviceView } from "@hanoman/shared";
import { remoteSessionVerdict } from "../src/services/presence/remote-session";

const dev = (id: string, over: Partial<PresenceDeviceView> = {}): PresenceDeviceView => ({
  deviceId: id, name: id, local: id === LOCAL_DEVICE_ID, online: true, lastSeenAt: null,
  sessions: [], control: null, capacity: null, ...over,
});

describe("remoteSessionVerdict (SPEC-1216 · AC-B5/B6)", () => {
  it("sesi working di device lain → remote-session", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: null,
      devices: [dev("dA", { sessions: [{ sessionId: "s1", projectId: "p", specId: "SPEC-1", agent: "claude", status: "working", startedAt: "t", statusAt: "t" }] })],
    });
    expect(v).toEqual({ kind: "remote-session", remote: { deviceId: "dA", name: "dA", sessionId: "s1" } });
  });
  it("tanpa sesi hidup, recentlyOffline ≤24 jam → confirm-required", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], lastResultDeviceId: null,
      recentlyOffline: [{ deviceId: "dA", name: "dA", specId: "SPEC-1", sessionId: "s1", at: 1000 - 3600_000 }],
    });
    expect(v).toEqual({ kind: "confirm-required", remote: { deviceId: "dA", name: "dA", sessionId: "s1", offline: true } });
  });
  it("recentlyOffline >24 jam → diabaikan (jatuh ke lastResultDeviceId lalu ok)", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], lastResultDeviceId: null,
      recentlyOffline: [{ deviceId: "dA", name: "dA", specId: "SPEC-1", sessionId: "s1", at: 1000 - 25 * 3600_000 }],
    });
    expect(v).toEqual({ kind: "ok" });
  });
  it("lastResultDeviceId offline → confirm-required sessionId null", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, devices: [], recentlyOffline: [],
      lastResultDeviceId: { deviceId: "dA", name: "dA" },
    });
    expect(v).toEqual({ kind: "confirm-required", remote: { deviceId: "dA", name: "dA", sessionId: null, offline: true } });
  });
  it("lastResultDeviceId online (ada di devices) → ok", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: { deviceId: "dA", name: "dA" },
      devices: [dev("dA")],
    });
    expect(v).toEqual({ kind: "ok" });
  });
  it("tak ada apa pun → ok", () => {
    expect(remoteSessionVerdict({ specId: "SPEC-1", now: 1000, devices: [], recentlyOffline: [], lastResultDeviceId: null }))
      .toEqual({ kind: "ok" });
  });
  it("device LOCAL_DEVICE_ID dengan sesi working diabaikan (bukan 'device lain')", () => {
    const v = remoteSessionVerdict({
      specId: "SPEC-1", now: 1000, recentlyOffline: [], lastResultDeviceId: null,
      devices: [dev(LOCAL_DEVICE_ID, { sessions: [{ sessionId: "s1", projectId: "p", specId: "SPEC-1", agent: "claude", status: "working", startedAt: "t", statusAt: "t" }] })],
    });
    expect(v).toEqual({ kind: "ok" });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal (modul belum ada)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: FAIL (cannot find module).

- [x] **Step 3: Implementasi `remote-session.ts`**

```ts
// server/src/services/presence/remote-session.ts
import { LOCAL_DEVICE_ID, type PresenceDeviceView } from "@hanoman/shared";

/* SPEC-1216 · ADR-0165 §5/§8 · satu-satunya tempat presence dibaca sebagai GERBANG (bukan info).
   `ok` bukan izin — pemanggil tetap menjalankan seluruh gerbang lain (dependency, admission).
   Murni: tak menyentuh Prisma/registry, supaya tabel positif/negatif diuji tanpa server. */

export type RecentlyOfflineEntry = { deviceId: string; name: string; specId: string; sessionId: string | null; at: number };
export type RemoteSessionVerdict =
  | { kind: "ok" }
  | { kind: "remote-session"; remote: { deviceId: string; name: string; sessionId: string } }
  | { kind: "confirm-required"; remote: { deviceId: string; name: string; sessionId: string | null; offline: true } };

const RECENTLY_OFFLINE_TTL_MS = 24 * 60 * 60_000;

export function remoteSessionVerdict(input: {
  specId: string;
  devices: PresenceDeviceView[];
  recentlyOffline: RecentlyOfflineEntry[];
  lastResultDeviceId: { deviceId: string; name: string } | null;
  now: number;
}): RemoteSessionVerdict {
  // 1. sesi working|waiting untuk specId di device ≠ LOCAL_DEVICE_ID (urutan presenceView = createdAt asc).
  for (const d of input.devices) {
    if (d.deviceId === LOCAL_DEVICE_ID) continue;
    const s = d.sessions.find((x) => x.specId === input.specId && (x.status === "working" || x.status === "waiting"));
    if (s) return { kind: "remote-session", remote: { deviceId: d.deviceId, name: d.name, sessionId: s.sessionId } };
  }
  // 2. recentlyOffline ≤ 24 jam untuk specId.
  const recent = input.recentlyOffline.find((e) => e.specId === input.specId && input.now - e.at <= RECENTLY_OFFLINE_TTL_MS);
  if (recent) return { kind: "confirm-required", remote: { deviceId: recent.deviceId, name: recent.name, sessionId: recent.sessionId, offline: true } };
  // 3. lastResultDeviceId ≠ null dan device itu tak online → confirm-required (sessionId null).
  if (input.lastResultDeviceId) {
    const online = input.devices.some((d) => d.deviceId === input.lastResultDeviceId!.deviceId);
    if (!online) return { kind: "confirm-required", remote: { ...input.lastResultDeviceId, sessionId: null, offline: true } };
  }
  return { kind: "ok" };
}
```

- [x] **Step 4: Jalankan test bagian murni, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: PASS.

- [x] **Step 5: Tulis test `recentlyOffline` di registry (gagal dulu)**

Tambahkan di `server/test/remote-session-gate.test.ts` (bagian 2 — registry):

```ts
import { recordRecentlyOffline, recentlyOffline, __resetPresence } from "../src/services/presence/registry";

describe("recentlyOffline registry (SPEC-1216 · AC-B6)", () => {
  beforeEach(() => __resetPresence());
  it("diisi via recordRecentlyOffline, kedaluwarsa 24 jam saat dibaca", () => {
    recordRecentlyOffline({ deviceId: "dA", name: "laptop", specId: "SPEC-1", sessionId: "s1" }, 1000);
    expect(recentlyOffline("SPEC-1", 1000 + 3600_000)).toEqual([
      { deviceId: "dA", name: "laptop", specId: "SPEC-1", sessionId: "s1", at: 1000 },
    ]);
    expect(recentlyOffline("SPEC-1", 1000 + 25 * 3600_000)).toEqual([]);
  });
});
```

(`beforeEach`/`describe` sudah diimpor di Step 1; tambahkan `beforeEach` ke import vitest bila belum.)

- [x] **Step 6: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: FAIL (`recordRecentlyOffline` tak ada).

- [x] **Step 7: Implementasi di `registry.ts`**

Tambahkan di `server/src/services/presence/registry.ts` (dekat `capacities`, sebelum
`dropPresence`):

```ts
/* SPEC-1216 · ADR-0165 §5 · jaring "device punah" untuk gerbang confirm-required, DI MEMORI
   (prinsip ADR-0148). Satu entri per (deviceId, specId) — sesi terakhir yang tercatat working|waiting
   sebelum device itu punah. Restart hub mengosongkannya; poin 3 remoteSessionVerdict (lastResultDeviceId)
   jadi jaring keduanya. */
type OfflineEntry = { deviceId: string; name: string; sessionId: string | null; at: number };
const recentlyOfflineMap = new Map<string, OfflineEntry>(); // key = `${deviceId}:${specId}`

export function recordRecentlyOffline(
  e: { deviceId: string; name: string; specId: string; sessionId: string | null }, now = Date.now(),
): void {
  recentlyOfflineMap.set(`${e.deviceId}:${e.specId}`, { deviceId: e.deviceId, name: e.name, sessionId: e.sessionId, at: now });
}

const RECENTLY_OFFLINE_TTL_MS = 24 * 60 * 60_000;
export function recentlyOffline(specId: string, now = Date.now()): Array<{ deviceId: string; name: string; specId: string; sessionId: string | null; at: number }> {
  const out: Array<{ deviceId: string; name: string; specId: string; sessionId: string | null; at: number }> = [];
  for (const [key, v] of recentlyOfflineMap) {
    if (now - v.at >= RECENTLY_OFFLINE_TTL_MS) { recentlyOfflineMap.delete(key); continue; }
    const [deviceId, specId2] = key.split(":");
    if (specId2 === specId) out.push({ deviceId: deviceId!, name: v.name, specId, sessionId: v.sessionId, at: v.at });
  }
  return out;
}
```

Sambungkan sumbernya (device punah) di dua tempat yang sudah ada di berkas ini:

```ts
// dropPresence — socket sync tutup. Rekam sesi working|waiting terakhir device itu sebelum dihapus.
export function dropPresence(deviceId: string): void {
  const d = devices.get(deviceId);
  if (d) {
    for (const t of d.sessions.values()) {
      if ((t.session.status === "working" || t.session.status === "waiting") && t.session.specId)
        recordRecentlyOffline({ deviceId, name: deviceId, specId: t.session.specId, sessionId: t.session.sessionId });
    }
  }
  devices.delete(deviceId); capacities.delete(deviceId);
}
```

```ts
// presenceEntries — sapuan ambang (device diam-diam kadaluwarsa lewat heartbeat).
export function presenceEntries(now = Date.now()): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [deviceId, d] of devices) {
    if (now - d.lastFrameAt >= PRESENCE_OFFLINE_MS) {
      for (const t of d.sessions.values()) {
        if ((t.session.status === "working" || t.session.status === "waiting") && t.session.specId)
          recordRecentlyOffline({ deviceId, name: deviceId, specId: t.session.specId, sessionId: t.session.sessionId }, now);
      }
      devices.delete(deviceId); continue;
    }
    out.push({ deviceId, sessions: [...d.sessions.values()].map((t) => ({ ...t.session, statusAt: new Date(t.statusAt).toISOString() })) });
  }
  return out;
}
```

`name: deviceId` sementara di kedua sumber (registry tak menyimpan nama device — hanya `deviceId`
dari `DeviceToken`). Catat sebagai batasan yang ditutup Task 5 (di sana `remoteSessionVerdict`
dipanggil dari `session-launch.ts` yang PUNYA akses `presenceView()`/`prisma.deviceToken`, jadi nama
asli disuntikkan di pemanggil, bukan di sini — `registry.ts` tetap murni presence tanpa nama).

Reset test-only helper `__resetPresence` juga mengosongkan `recentlyOfflineMap`:

```ts
export function __resetPresence(): void { devices.clear(); capacities.clear(); recentlyOfflineMap.clear(); }
```

- [x] **Step 8: Jalankan seluruh test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add server/src/services/presence/remote-session.ts server/src/services/presence/registry.ts server/test/remote-session-gate.test.ts
git commit -m "feat(spec-1216): remoteSessionVerdict murni + recentlyOffline registry (AC-B5/B6)"
```

---

## Task 5: Gerbang presence di `startSpecSession` + mapping 409 di `terminal.ts`

**Files:**
- Modify: `server/src/services/session-launch.ts`
- Modify: `server/src/routes/terminal.ts` (mapping `LaunchError` baru)
- Test: `server/test/session-launch.test.ts` (cari berkas yang ada) atau
  `server/test/remote-session-gate.test.ts` (bagian 3 — integrasi)

**Interfaces:**
- Consumes: `remoteSessionVerdict()`, `recentlyOffline()` (Task 4); `presenceView()`
  (`server/src/services/presence/view.ts`, sudah ada); `SessionResult` model (Prisma, cek field
  `deviceId` — verifikasi di Step 3 sebelum memakainya).
- Produces: `LaunchError` dengan `kind` baru `"remote-session"`/`"confirm-required"` dan field
  opsional keempat `remoteSession` — Task 6 memakai `remoteSessionVerdict` yang sama (bukan
  `LaunchError`, karena `specs.ts:/done` bukan jalur `startSpecSession`).

- [x] **Step 1: Verifikasi field yang dipakai `lastResultDeviceId` benar-benar ada**

```bash
grep -n "model SessionResult" -A 15 server/prisma/schema.prisma
grep -rn "recordSessionResult" server/src/services/session-result.ts | head -5
```

Catat nama field device (`deviceId`?) dan cara query "hasil terakhir untuk spec X, stage ≠ done" —
sesuaikan Step 3 dengan skema NYATA, bukan tebakan. Bila field berbeda dari yang diasumsikan di
spec teknis, catat penyimpangannya di pesan commit Step 6 sebagai koreksi kecil (bukan re-desain).

- [x] **Step 2: Tulis test integrasi yang gagal**

Tambahkan ke `server/test/remote-session-gate.test.ts` (bagian 3):

```ts
import { startSpecSession, LaunchError } from "../src/services/session-launch";
import { recordPresence } from "../src/services/presence/registry";
import { makeSpec, makeProject } from "./factory"; // pola factory yang sudah ada di server/test

describe("startSpecSession gerbang presence (SPEC-1216 · AC-B5/B6)", () => {
  beforeEach(() => __resetPresence());
  it("sesi working di device lain untuk spec yang sama → LaunchError remote-session, TAK memanggil createSession", async () => {
    const project = await makeProject();
    const spec = await makeSpec({ projectId: project.id, launchApprovedAt: new Date(), launchApprovedBy: "user:a@b.co" });
    recordPresence("dA", [{ sessionId: "s1", projectId: project.id, specId: spec.id, agent: "claude", status: "working", startedAt: new Date().toISOString() }]);
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "remote-session" });
  });
});
```

(Sesuaikan `makeSpec`/`makeProject` dengan helper nyata di `server/test/factory.ts` — jalankan
`grep -n "export.*makeSpec\|export.*makeProject" server/test/factory.ts` untuk tanda tangan pastinya.)

- [x] **Step 3: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: FAIL (`LaunchError` tanpa kind `remote-session`, atau sesi tetap lahir).

- [x] **Step 4: Implementasi di `session-launch.ts`**

```ts
// tambahan import di header
import { presenceView } from "./presence/view";
import { remoteSessionVerdict } from "./presence/remote-session";
import { recentlyOffline } from "./presence/registry";
import { LOCAL_DEVICE_ID } from "@hanoman/shared";
```

`LaunchError` bertambah kind + field opsional (posisi keempat, `blockers` tetap ketiga):

```ts
export class LaunchError extends Error {
  constructor(
    message: string,
    readonly kind: "needs-bind" | "worktree" | "blocked" | "not-approved" | "remote-session" | "confirm-required",
    readonly blockers: SpecBlocker[] = [],
    readonly remoteSession?: { deviceId: string; name: string; sessionId: string | null },
  ) { super(message); }
}
```

`opts` bertambah `confirmRemote?: boolean` (dokumentasi mengikuti pola `force` di atasnya):

```ts
    // SPEC-447 · ADR-0093 · lewati gerbang dependency...
    force?: boolean;
    // SPEC-1216 · ADR-0165 §6 · lewati gerbang presence satu-sesi. HANYA jalur manusia yang
    // memasoknya (POST /terminal/sessions), cermin `force`. Governor & denyut lead tak pernah.
    confirmRemote?: boolean;
```

Gerbang ditanam SESUDAH `const pane = await getSessionAsync(id);` dan cabang re-attach implisit
(pane truthy langsung lanjut ke `assertLaunchApproved` seperti sekarang), SEBELUM
`blockersForSpec`:

```ts
    const pane = await getSessionAsync(id);
    // SPEC-1216 · ADR-0165 §5/§8 · gerbang satu sesi lintas instance. HANYA saat tak ada pane
    // LOKAL (re-attach ke sesi yang sedang berjalan di mesin INI tak boleh ikut ditolak). Berdiri
    // SEBELUM approveLaunch/blockersForSpec — penolakan tak boleh meninggalkan efek. Di klien
    // (bukan hub) presence/registry.ts hanya pernah terisi LOCAL_DEVICE_ID lewat presenceView(),
    // jadi verdict di sini selalu "ok" tanpa flag "saya hub" terpisah — test menegakkan ini.
    if (!pane) {
      const view = await presenceView();
      const verdict = remoteSessionVerdict({
        specId: spec.id, now: Date.now(), devices: view.devices,
        recentlyOffline: recentlyOffline(spec.id),
        lastResultDeviceId: null, // TODO diisi Step 5 bila SessionResult.deviceId tersedia
      });
      if (verdict.kind === "remote-session") throw new LaunchError(`${spec.id} sedang berjalan di ${verdict.remote.name}`, "remote-session", [], verdict.remote);
      if (verdict.kind === "confirm-required" && !opts.confirmRemote)
        throw new LaunchError(`${spec.id} terakhir berjalan di ${verdict.remote.name} yang kini offline`, "confirm-required", [], verdict.remote);
    }
    try { assertLaunchApproved(spec); }
```

- [x] **Step 5: Isi `lastResultDeviceId` dari `SessionResult` (sesuai skema Step 1)**

Ganti `lastResultDeviceId: null` dengan query nyata — contoh bila `SessionResult` punya kolom
`deviceId` dan `specId`, urut `createdAt desc`, `take: 1`:

```ts
const lastResult = await prisma.sessionResult.findFirst({
  where: { specId: spec.id }, orderBy: { createdAt: "desc" }, select: { deviceId: true },
});
const lastResultDeviceId = lastResult?.deviceId && lastResult.deviceId !== LOCAL_DEVICE_ID
  ? { deviceId: lastResult.deviceId, name: lastResult.deviceId } : null;
```

(Sesuaikan persis dengan kolom yang ditemukan Step 1; bila `SessionResult` tak menyimpan `deviceId`
sama sekali, catat itu sebagai temuan dan gunakan `lastResultDeviceId: null` — poin 3
`remoteSessionVerdict` jadi no-op, bukan bug, karena poin 1/2 tetap menggerbang.)

- [x] **Step 6: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/remote-session-gate.test.ts
```
Expected: PASS.

- [x] **Step 7: Mapping status di `terminal.ts`**

Di blok `catch (e) { if (e instanceof LaunchError) { ... } }` (`terminal.ts`, dekat
`if (e.kind === "blocked") ...`), tambah dua cabang SEBELUM `not-approved`:

```ts
if (e.kind === "remote-session")
  return reply.code(409).send({ error: "remote-session", remoteSession: e.remoteSession });
if (e.kind === "confirm-required")
  return reply.code(409).send({ error: "confirm-required", remoteSession: { ...e.remoteSession, offline: true } });
if (e.kind === "not-approved") return reply.code(403).send({ error: e.message });
```

Teruskan `confirmRemote` dari body ke `startSpecSession` — cari pemanggilan `startSpecSession` di
`terminal.ts` (dekat baris 99-108) dan tambah field, plus `zTerminalSession` di
`shared/src/dto.ts` bertambah `confirmRemote?: boolean` (aditif, opsional — pemanggil lama tak
berubah):

```ts
const r = await startSpecSession(launchable, {
  flow: parsed.data.flow, model: parsed.data.model, effort: parsed.data.effort,
  goal: parsed.data.goal, goalCondition: parsed.data.goalCondition,
  agent: parsed.data.agent, verifyScope: parsed.data.verifyScope, method: parsed.data.method,
  phaseOverrides: parsed.data.phaseOverrides, force: parsed.data.force,
  confirmRemote: "confirmRemote" in parsed.data ? parsed.data.confirmRemote : undefined,
});
```

- [x] **Step 8: Tulis test route untuk 409 remote-session/confirm-required, jalankan, lulus**

Tambahkan test di `server/test/terminal.route.test.ts` yang mereproduksi fixture presence lewat
`recordPresence` lalu memanggil `POST /terminal/sessions`, meng-assert status 409 dan body persis.

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts
```
Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add server/src/services/session-launch.ts server/src/routes/terminal.ts shared/src/dto.ts server/test/remote-session-gate.test.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-1216): gerbang presence startSpecSession + 409 remote-session/confirm-required (AC-B5/B6)"
```

---

## Task 6: `POST /specs/:id/done` — lapis kedua gerbang presence

**Files:**
- Modify: `server/src/routes/specs.ts:338` (route yang sudah ada, ditampilkan di riset di atas)
- Test: `server/test/specs.route.test.ts` (cari berkas yang menguji `/specs/:id/done`)

**Interfaces:**
- Consumes: `remoteSessionVerdict()`, `recentlyOffline()`, `presenceView()` (Task 4/5, pola sama).

- [x] **Step 1: Tulis test yang gagal**

```bash
grep -n "specs/:id/done\|confirm-required" server/test/specs.route.test.ts | head -10
```

Tambahkan (pola sama Task 5 Step 8 — `recordPresence` device lain dengan sesi working untuk spec
yang sama, TANPA pane lokal):

```ts
it("gerbang presence lapis kedua: device lain kerjakan spec ini → 409 confirm-required (AC-B6)", async () => {
  recordPresence("dA", [{ sessionId: "s1", projectId: spec.projectId, specId: spec.id, agent: "claude", status: "working", startedAt: new Date().toISOString() }]);
  const res = await app.inject({ method: "POST", url: `/api/specs/${spec.id}/done`, headers: { cookie }, payload: {} });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe("confirm-required");
});
it("confirm:true melewati gerbang presence", async () => {
  recordPresence("dA", [{ sessionId: "s1", projectId: spec.projectId, specId: spec.id, agent: "claude", status: "working", startedAt: new Date().toISOString() }]);
  const res = await app.inject({ method: "POST", url: `/api/specs/${spec.id}/done`, headers: { cookie }, payload: { confirm: true } });
  expect(res.statusCode).not.toBe(409);
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/specs.route.test.ts
```
Expected: FAIL (status 200, bukan 409).

- [x] **Step 3: Implementasi**

Di `server/src/routes/specs.ts`, sesudah cek `if (live && parsed.data.confirm !== true) return reply.code(409)...`,
tambahkan lapis kedua SEBELUM `completeSpecManually`:

```ts
  if (!live) {
    const view = await presenceView();
    const verdict = remoteSessionVerdict({
      specId: id, now: Date.now(), devices: view.devices,
      recentlyOffline: recentlyOffline(id), lastResultDeviceId: null,
    });
    if (verdict.kind !== "ok" && parsed.data.confirm !== true) {
      return reply.code(409).send({
        error: "confirm-required",
        session: verdict.remote.sessionId ? { id: verdict.remote.sessionId, deviceId: verdict.remote.deviceId, name: verdict.remote.name } : undefined,
      });
    }
  }
  const res = await completeSpecManually(spec, {
    by: req.user?.email ?? (req.remote ? `remote:${req.remote.actor.email}@${req.remote.actor.hubOrigin}` : "system"),
    reason: parsed.data.reason || undefined,
  });
```

Tambahkan import di header `specs.ts`:

```ts
import { presenceView } from "../services/presence/view";
import { remoteSessionVerdict } from "../services/presence/remote-session";
import { recentlyOffline } from "../services/presence/registry";
```

- [x] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/specs.route.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(spec-1216): POST /specs/:id/done gerbang presence lapis kedua + by aktor remote (AC-B6/B9)"
```

---

## Task 7: Retry spec-404 di dispatcher klien

**Files:**
- Modify: `server/src/services/relay/dispatcher.ts`
- Modify: `server/src/services/relay/client.ts:78` (suntik `syncOnce`)
- Test: `server/test/relay-dispatcher.spec404.test.ts` (baru, cermin pola
  `server/test/relay-dispatcher.test.ts` yang sudah ada)

**Interfaces:**
- Consumes: `syncNow(): Promise<SyncStats | null>` (`server/src/services/sync-client.ts:409`,
  sudah ada).
- Produces: `createRelayDispatcher(o)` bertambah field opsional `syncOnce` — aditif, pemanggil
  lama (test A yang sudah ada) tak berubah karena defaultnya `() => syncNow()`.

- [x] **Step 1: Baca pola test dispatcher yang sudah ada**

```bash
sed -n '1,40p' server/test/relay-dispatcher.test.ts
```

- [x] **Step 2: Tulis test yang gagal**

```ts
// server/test/relay-dispatcher.spec404.test.ts
import { describe, it, expect, vi } from "vitest";
import { createRelayDispatcher, type InjectableApp } from "../src/services/relay/dispatcher";

function fakeApp(responses: Array<{ statusCode: number; body: string }>): InjectableApp & { calls: number } {
  let i = 0;
  return {
    calls: 0,
    async inject() {
      const r = responses[Math.min(i, responses.length - 1)]!;
      i++; (this as any).calls++;
      return { statusCode: r.statusCode, headers: { "content-type": "application/json" }, body: r.body };
    },
  } as any;
}

describe("relay dispatcher retry spec-404 (SPEC-1216 · AC-B11)", () => {
  it("404 spec not found → satu syncOnce lalu satu ulang; respons kedua diteruskan", async () => {
    const app = fakeApp([
      { statusCode: 404, body: JSON.stringify({ error: "spec not found" }) },
      { statusCode: 201, body: JSON.stringify({ id: "sess-1" }) },
    ]);
    const syncOnce = vi.fn().mockResolvedValue(null);
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" }, actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(syncOnce).toHaveBeenCalledTimes(1);
    expect(app.calls).toBe(2);
    const last = JSON.parse(sent[sent.length - 1]!);
    expect(last.status).toBe(201);
  });

  it("404 non-spec-not-found → tak retry, tak panggil syncOnce", async () => {
    const app = fakeApp([{ statusCode: 404, body: JSON.stringify({ error: "not found" }) }]);
    const syncOnce = vi.fn().mockResolvedValue(null);
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "GET", path: "/api/terminal/sessions", actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(syncOnce).not.toHaveBeenCalled();
    expect(app.calls).toBe(1);
  });

  it("syncOnce melempar → galat ditelan, ulang tetap jalan sekali", async () => {
    const app = fakeApp([
      { statusCode: 404, body: JSON.stringify({ error: "spec not found" }) },
      { statusCode: 201, body: JSON.stringify({ id: "sess-1" }) },
    ]);
    const syncOnce = vi.fn().mockRejectedValue(new Error("boom"));
    const sent: string[] = [];
    const d = createRelayDispatcher({ app, send: (j) => sent.push(j), syncOnce });
    d.onMessage(JSON.stringify({ t: "req", id: "r1", method: "POST", path: "/api/terminal/sessions", body: { spec: "SPEC-1" }, actor: { hubOrigin: "h", userId: "u", email: "e@e.co" } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(app.calls).toBe(2);
  });
});
```

- [x] **Step 3: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.spec404.test.ts
```
Expected: FAIL (`syncOnce` option tak dikenal type-wise / retry tak terjadi).

- [x] **Step 4: Implementasi di `dispatcher.ts`**

Tambah opsi & pemakaiannya:

```ts
export function createRelayDispatcher(o: {
  app: InjectableApp;
  send: (json: string) => void;
  host?: () => string;
  audit?: (e: RemoteRequestAudit) => void;
  now?: () => number;
  // SPEC-1216 · ADR-0165 §11 · disuntik relay/client.ts (default syncNow di sana, bukan di sini —
  // dispatcher tak boleh mengimpor sync-client langsung, cermin kenapa audit disuntikkan).
  syncOnce?: () => Promise<unknown>;
}) {
  ...
  const syncOnce = o.syncOnce ?? (async () => {});
```

Di `handleReq`, ganti bagian sesudah `inject` pertama:

```ts
    const entry = { cancelled: false };
    inflight.set(f.id, entry);
    try {
      const isSpawn = f.method === "POST" && f.path === "/api/terminal/sessions" && f.body && typeof f.body === "object" && "spec" in (f.body as any);
      const doInject = () => o.app.inject({
        method: f.method, url,
        headers: {
          host: host(), [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(f.actor),
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(payload !== undefined ? { payload } : {}),
      });
      let res = await doInject();
      let retried = false;
      if (isSpawn && res.statusCode === 404 && entry.cancelled === false) {
        const parsed = (() => { try { return JSON.parse(res.body); } catch { return null; } })();
        if (parsed?.error === "spec not found") {
          record(404); // percobaan pertama, level info, attempt 1
          await syncOnce().catch(() => {});
          if (!entry.cancelled) { res = await doInject(); retried = true; }
        }
      }
      if (!retried) record(res.statusCode);
      else audit({
        kind: "remote.request", level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        msg: `${f.method} ${f.path} → ${res.statusCode}`,
        data: { actor: f.actor, method: f.method, path: f.path, status: res.statusCode, ms: now() - started, retried: true },
      });
      if (entry.cancelled) return;
      if (utf8Bytes(res.body) > RELAY_RESPONSE_MAX_BYTES) { fail(f.id, 502, "relay-response-too-large"); return; }
      reply(f.id, res.statusCode, String(res.headers["content-type"] ?? "application/octet-stream"), res.body);
    } catch {
      record(502);
      if (!entry.cancelled) fail(f.id, 502, "relay-dispatch-failed");
    } finally {
      inflight.delete(f.id);
    }
```

(`record(status)` yang sudah ada menulis `data.attempt` tidak eksis — tambahkan `attempt: 1` ke
closure `record` untuk percobaan PERTAMA saat retry terjadi: ubah tanda tangan `record` jadi
`record(status, extra = {})` dan panggil `record(404, { attempt: 1 })` pada percobaan pertama,
sebelum retry, alih-alih hanya via cabang di atas — sesuaikan agar 404 pertama tetap tercatat
sendiri seperti T5 minta.)

- [x] **Step 5: Suntik `syncOnce` di `relay/client.ts`**

`client.ts:78`, di `connect()`:

```ts
import { syncNow } from "../sync-client";
...
const d = createRelayDispatcher({ app, send: (json) => { if (s.readyState === 1) s.send(json); }, syncOnce: () => syncNow() });
```

- [x] **Step 6: Jalankan test, pastikan lulus (dan test dispatcher A lama tetap hijau)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.spec404.test.ts server/test/relay-dispatcher.test.ts server/test/relay-client.test.ts
```
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/src/services/relay/dispatcher.ts server/src/services/relay/client.ts server/test/relay-dispatcher.spec404.test.ts
git commit -m "feat(spec-1216): retry spec-404 di dispatcher klien via syncOnce (AC-B11)"
```

---

## Task 8: `createApi({base})` di `src/src/api/client.ts`

**Files:**
- Modify: `src/src/api/client.ts`
- Test: `src/test/instance.test.tsx` (baru — bagian 1: rebase)

**Interfaces:**
- Produces: `createApi(o?: {base?: string}): typeof api` — Task 9 (`InstanceContext`) memakainya
  untuk `useApi()`.

- [x] **Step 1: Tulis test yang gagal**

```tsx
// src/test/instance.test.tsx (bagian 1)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApi } from "../src/api/client";

describe("createApi({base}) (SPEC-1216 · AC-B7/B9)", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  it("base default '/api' — j() memanggil URL apa adanya", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApi();
    await api.getSettings();
    expect(vi.mocked(fetch).mock.calls[0]![0]).toMatch(/^\/api\/settings/);
  });
  it("base 'http://client:9000' — j() merebase '/api/...' jadi base + sisanya", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const api = createApi({ base: "/api/devices/dev1/relay" });
    await api.getSettings();
    const url = String(vi.mocked(fetch).mock.calls[0]![0]);
    expect(url.startsWith("/api/devices/dev1/relay/settings")).toBe(true);
  });
  it("jUpload dan agentDoc ikut rebase", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ path: "x" }), { status: 200 }));
    const api = createApi({ base: "/api/devices/dev1/relay" });
    await api.uploadTerminalAttachment("s1", new File(["x"], "a.txt"));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/^\/api\/devices\/dev1\/relay\//);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/instance.test.tsx
```
Expected: FAIL (`createApi` tak diekspor).

- [x] **Step 3: Implementasi — bungkus `j`/`jUpload`/`agentDoc`/objek `api` ke dalam factory**

Di `src/src/api/client.ts`, langsung SEBELUM `async function j<T>(...)` (baris ~156), bungkus
SELURUH sisa berkas — dari `async function j` sampai penutup `export const api = { ... };` di akhir
(baris ~753) — di dalam:

```ts
export function createApi(o: { base?: string } = {}) {
  const base = o.base ?? "/api";
  // "/api/x" → base+"/x"; "/api" (tanpa slash, jarang) → base. Semua `paths.*` lahir dengan prefix
  // "/api/", jadi pengecualian kedua praktis tak pernah kena, tapi dijaga untuk kelengkapan.
  const rebase = (u: string) => (u.startsWith("/api/") || u === "/api" ? base + u.slice(4) : u);

  async function j<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(rebase(url), { headers: { "content-type": "application/json" }, ...init });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new ApiError(res.status, `${init?.method ?? "GET"} ${url} → ${res.status}`, detail);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }
  const body = (b: unknown) => ({ body: JSON.stringify(b) });
  async function jUpload<T>(url: string, form: FormData): Promise<T> {
    const res = await fetch(rebase(url), { method: "POST", body: form });
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, detail?.error ?? `POST ${url} → ${res.status}`, detail);
    }
    return res.json() as Promise<T>;
  }
  const qs = (params: Record<string, string | number | boolean | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
    const s = p.toString();
    return s ? "?" + s : "";
  };

  return {
    issueWsTicket: (target: "events" | `terminal:${string}`) =>
      j<{ ticket: string }>(paths.wsTickets, { method: "POST", ...body({ target }) }),
    // ... SELURUH isi objek `api` yang sudah ada, TANPA PERUBAHAN, sampai method terakhir ...
    // Satu pengecualian: `agentDoc` (baris ~330 semula) juga direbase:
    agentDoc: async (): Promise<string> => {
      const res = await fetch(rebase(paths.agentDoc), { headers: { accept: "text/markdown" } });
      if (!res.ok) throw new ApiError(res.status, `GET ${paths.agentDoc} → ${res.status}`);
      return res.text();
    },
    // ... method-method setelahnya tetap seperti semula ...
  };
}
export const api = createApi();
```

Catatan pelaksanaan (mekanis, bukan desain): pindahkan definisi tipe (`ApiError`, `Flow`,
`PhaseAgent`, `WorktreeView`, dll — semua yang ada SEBELUM `async function j`) tetap di scope MODUL
(di luar `createApi`) karena dipakai importir lain lewat `export type`. Yang pindah ke DALAM
`createApi` hanya: `j`, `jUpload`, `qs`, `body`, dan literal objek `api` (isinya identik, 164
method tak berubah satu pun kecuali dua rebase di atas). Jalankan `pnpm -F @hanoman/web typecheck`
sesudah paste untuk menangkap method yang lupa ter-include di `return {}`.

- [x] **Step 4: Jalankan test, pastikan lulus + typecheck bersih**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/instance.test.tsx
pnpm -F @hanoman/web typecheck
```
Expected: PASS; nol error tipe (61 importir `api` lama harus tetap kompilasi tanpa perubahan
karena `export const api = createApi()` tak berubah bentuk).

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/instance.test.tsx
git commit -m "feat(spec-1216): createApi({base}) — j/jUpload/agentDoc rebase ke base relay (AC-B7/B9)"
```

---

## Task 9: `InstanceContext` (`src/src/api/instance.tsx`)

**Files:**
- Create: `src/src/api/instance.tsx`
- Test: `src/test/instance.test.tsx` (bagian 2)

**Interfaces:**
- Consumes: `createApi` (Task 8); `RemoteCapability` (`@hanoman/shared`, sudah ada).
- Produces: `InstanceProvider`, `useInstance()`, `useApi()`, `useWsTarget()` — Task 11
  (`StartSessionModal`) memakai `useApi()`/`useInstance()` untuk aksi target remote.

- [x] **Step 1: Tulis test yang gagal**

```tsx
// src/test/instance.test.tsx (bagian 2, tambahan)
import { renderHook } from "@testing-library/react";
import React from "react";
import { InstanceProvider, useInstance, useApi, useWsTarget } from "../src/api/instance";
import { api } from "../src/api/client";

describe("InstanceContext (SPEC-1216 · AC-B7/B9)", () => {
  it("tanpa provider → local, useApi() === api singleton", () => {
    const { result } = renderHook(() => ({ i: useInstance(), a: useApi() }));
    expect(result.current.i).toEqual({ kind: "local" });
    expect(result.current.a).toBe(api);
  });
  it("dengan provider remote → useApi() BUKAN singleton local, useWsTarget merutekan ke relay", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <InstanceProvider value={{ kind: "remote", deviceId: "dev1", name: "laptop", version: "0.6.0", protocol: 1, capabilities: ["sessions:read"] }}>
        {children}
      </InstanceProvider>
    );
    const { result } = renderHook(() => ({ a: useApi(), t: useWsTarget("terminal:sess1") }), { wrapper });
    expect(result.current.a).not.toBe(api);
    expect(result.current.t).toEqual({ url: "/api/devices/dev1/relay/…", ticketTarget: "relay:dev1:terminal:sess1" });
  });
  it("useApi() remote di-memo per deviceId (referensi sama antar render)", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <InstanceProvider value={{ kind: "remote", deviceId: "dev1", name: "l", version: "v", protocol: 1, capabilities: [] }}>
        {children}
      </InstanceProvider>
    );
    const { result, rerender } = renderHook(() => useApi(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
```

(Sesuaikan bentuk `url` `useWsTarget` dengan T6 — spec menulis pola
`` `/api/devices/${deviceId}/relay/…` `` sebagai ilustrasi; konkretkan jadi path WS nyata,
konsisten dengan `RELAY_ROUTES` yang sudah mengizinkan `GET …/ws`, mis.
`` `/api/devices/${deviceId}/relay/terminal/sessions/${sid}/ws` `` untuk varian `` `terminal:${sid}` ``
dan `` `/api/devices/${deviceId}/relay/events/ws` `` untuk `"events"`.)

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/instance.test.tsx
```
Expected: FAIL (modul tak ada).

- [x] **Step 3: Implementasi**

```tsx
// src/src/api/instance.tsx
import React from "react";
import type { RemoteCapability } from "@hanoman/shared";
import { api, createApi } from "./client";

// SPEC-1216 · ADR-0165 §4/§11 · identitas "mesin yang sedang dilihat operator" — local (default,
// tanpa provider) atau remote (dialihkan dari device panel/dialog Start). Konsumen stream terminal
// jarak jauh (TerminalPane) milik turunan C; kontrak di sini murni, sudah diuji sekarang.
export type Instance =
  | { kind: "local" }
  | { kind: "remote"; deviceId: string; name: string; version: string; protocol: number; capabilities: RemoteCapability[] };

const LOCAL: Instance = { kind: "local" };
const InstanceCtx = React.createContext<Instance>(LOCAL);

export function InstanceProvider({ value, children }: { value: Instance; children: React.ReactNode }) {
  return <InstanceCtx.Provider value={value}>{children}</InstanceCtx.Provider>;
}
export function useInstance(): Instance {
  return React.useContext(InstanceCtx);
}
export function useApi(): ReturnType<typeof createApi> {
  const instance = useInstance();
  // Memo per deviceId: instance.kind === "local" mengembalikan singleton `api` yang sama persis
  // yang dipakai 61 importir lama, jadi tak ada perbedaan referensi untuk konsumen yang tak pernah
  // membaca instance.
  return React.useMemo(
    () => (instance.kind === "local" ? api : createApi({ base: `/api/devices/${instance.deviceId}/relay` })),
    [instance.kind === "local" ? "local" : instance.deviceId],
  );
}
export function useWsTarget(local: "events" | `terminal:${string}`): { url: string; ticketTarget: string } {
  const instance = useInstance();
  if (instance.kind === "local") return { url: `/api/${local === "events" ? "events" : `terminal/sessions/${local.slice("terminal:".length)}`}/ws`, ticketTarget: local };
  const path = local === "events" ? "events/ws" : `terminal/sessions/${local.slice("terminal:".length)}/ws`;
  return { url: `/api/devices/${instance.deviceId}/relay/${path}`, ticketTarget: `relay:${instance.deviceId}:${local}` };
}
```

Sesuaikan assertion test Step 1 (`t.url`) dengan bentuk nyata di atas sebelum menjalankan ulang.

- [x] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/instance.test.tsx
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/instance.tsx src/test/instance.test.tsx
git commit -m "feat(spec-1216): InstanceContext — useInstance/useApi/useWsTarget (AC-B7/B9)"
```

---

## Task 10: `startTargets()` murni (`src/src/api/start-targets.ts`)

**Files:**
- Create: `src/src/api/start-targets.ts`
- Test: `src/test/start-session-target.test.tsx` (baru — bagian 1: `startTargets` murni)

**Interfaces:**
- Consumes: `PresenceView`, `PresenceDeviceView`, `HandledByEntry`, `LOCAL_DEVICE_ID` (`@hanoman/shared`).
- Produces: `startTargets(view, handledBy)` — Task 11 (`StartSessionModal`) memakainya untuk
  default + render tak-terpilih.

- [x] **Step 1: Tulis test tabel murni yang gagal**

```tsx
// src/test/start-session-target.test.tsx (bagian 1)
import { describe, it, expect } from "vitest";
import { LOCAL_DEVICE_ID, type PresenceView, type PresenceDeviceView, type HandledByEntry } from "@hanoman/shared";
import { startTargets } from "../src/api/start-targets";

const dev = (o: Partial<PresenceDeviceView> & { deviceId: string }): PresenceDeviceView => ({
  name: o.deviceId, local: o.deviceId === LOCAL_DEVICE_ID, online: true, lastSeenAt: null,
  sessions: [], control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:spawn"], since: "t" },
  capacity: { enabled: true, liveCount: 0, liveAgentCount: 0, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available" },
  ...o,
});
const handledBy = (deviceId: string, name = deviceId): HandledByEntry[] => [{ deviceId, name }];

describe("startTargets (SPEC-1216 · AC-B7/B8)", () => {
  it("urutan: hub ini dulu, lalu handledBy, lalu device lain", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: LOCAL_DEVICE_ID }), dev({ deviceId: "dB" }), dev({ deviceId: "dA" })] };
    const out = startTargets(view, handledBy("dA"));
    expect(out.map((t) => t.deviceId)).toEqual([LOCAL_DEVICE_ID, "dA", "dB"]);
  });
  it("eligible = online ∧ control available ∧ sessions:spawn ∧ kapasitas tak penuh", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA" })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
  it.each([
    ["offline", { online: false }, "offline"],
    ["control null", { control: null }, "control-off"],
    ["protocol-mismatch", { control: { state: "protocol-mismatch", protocol: 2, version: "v", capabilities: [], since: "t" } }, "protocol-mismatch"],
    ["tanpa sessions:spawn", { control: { state: "available", protocol: 1, version: "v", capabilities: ["sessions:read"], since: "t" } }, "no-spawn"],
    ["kapasitas penuh (liveAgentCount≥max)", { capacity: { enabled: true, liveCount: 5, liveAgentCount: 5, maxConcurrent: 5, loadPerCore: 0.1, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
    ["kapasitas penuh (load>ambang)", { capacity: { enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 5, loadPerCore: 2, maxLoadPerCore: 1, loadStatus: "available" } }, "capacity-full"],
  ] as const)("%s → reason %s", (_label, over, reason) => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", ...over })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: false, reason });
  });
  it("capacity === null bukan alasan menolak", () => {
    const view: PresenceView = { enabled: true, devices: [dev({ deviceId: "dA", capacity: null })] };
    expect(startTargets(view, handledBy("dA"))[1]).toMatchObject({ deviceId: "dA", eligible: true });
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/start-session-target.test.tsx
```
Expected: FAIL (modul tak ada).

- [x] **Step 3: Implementasi**

```ts
// src/src/api/start-targets.ts
import { LOCAL_DEVICE_ID, type PresenceView, type HandledByEntry } from "@hanoman/shared";

// SPEC-1216 · ADR-0165 §9/§11 · murni: urutan tampil + kelayakan target dialog Start. Presence
// tak pernah meluluskan — fungsi ini hanya MENGUSULKAN; peluncuran tetap butuh klik manusia.
export type TargetReason = "offline" | "control-off" | "protocol-mismatch" | "no-spawn" | "capacity-full";
export type StartTarget = { deviceId: string; name: string; eligible: boolean; reason?: TargetReason };

function capacityFull(c: NonNullable<ReturnType<() => import("@hanoman/shared").LaunchStatus | null>>): boolean {
  if (!c.enabled) return true;
  if (c.liveAgentCount >= c.maxConcurrent) return true;
  if (c.loadStatus === "unavailable") return true;
  if (c.loadPerCore !== null && c.loadPerCore > c.maxLoadPerCore) return true;
  return false;
}

export function startTargets(view: PresenceView, handledBy: HandledByEntry[]): StartTarget[] {
  const byId = new Map(view.devices.map((d) => [d.deviceId, d]));
  const order = [
    LOCAL_DEVICE_ID,
    ...handledBy.map((h) => h.deviceId),
    ...view.devices.map((d) => d.deviceId).filter((id) => id !== LOCAL_DEVICE_ID && !handledBy.some((h) => h.deviceId === id)),
  ];
  const seen = new Set<string>();
  const out: StartTarget[] = [];
  for (const deviceId of order) {
    if (seen.has(deviceId)) continue;
    seen.add(deviceId);
    const d = byId.get(deviceId);
    const name = d?.name ?? handledBy.find((h) => h.deviceId === deviceId)?.name ?? deviceId;
    if (!d) { out.push({ deviceId, name, eligible: false, reason: "offline" }); continue; }
    if (!d.online) { out.push({ deviceId, name: d.name, eligible: false, reason: "offline" }); continue; }
    if (deviceId !== LOCAL_DEVICE_ID) {
      if (!d.control) { out.push({ deviceId, name: d.name, eligible: false, reason: "control-off" }); continue; }
      if (d.control.state === "protocol-mismatch") { out.push({ deviceId, name: d.name, eligible: false, reason: "protocol-mismatch" }); continue; }
      if (!d.control.capabilities.includes("sessions:spawn")) { out.push({ deviceId, name: d.name, eligible: false, reason: "no-spawn" }); continue; }
    }
    if (d.capacity && capacityFull(d.capacity)) { out.push({ deviceId, name: d.name, eligible: false, reason: "capacity-full" }); continue; }
    out.push({ deviceId, name: d.name, eligible: true });
  }
  return out;
}
```

(Perbaiki tipe helper `capacityFull` — hindari trik `ReturnType` ganjil di atas; tulis eksplisit:)

```ts
import type { LaunchStatus } from "@hanoman/shared";
function capacityFull(c: LaunchStatus): boolean { /* isi sama */ }
```

`deviceId !== LOCAL_DEVICE_ID` guard di atas berarti "hub ini" selalu eligible selama online (yang
selalu `true` di `presenceView()`) dan kapasitasnya tak penuh — cermin "tanpa kandidat → hub ini"
(AC-B7) karena hub selalu ada di indeks 0 dan (nyaris) selalu eligible.

- [x] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/start-session-target.test.tsx
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/start-targets.ts src/test/start-session-target.test.tsx
git commit -m "feat(spec-1216): startTargets murni — default + alasan tak terpilih (AC-B7/B8)"
```

---

## Task 11: `StartSessionModal` — pemilih target + aksi remote

**Files:**
- Modify: `src/src/App.tsx` (`StartSessionModal`, mulai baris 87)
- Test: `src/test/start-session-target.test.tsx` (bagian 2 — render modal)

**Interfaces:**
- Consumes: `startTargets()` (Task 10), `useApi()`/`useInstance()`/`InstanceProvider` (Task 9),
  `createApi({base})` (Task 8), `api.getPresence()`/`api.listHandledBy()` (endpoint yang sudah ada
  — verifikasi nama pastinya di Step 1).

- [x] **Step 1: Cari endpoint presence/handledBy yang sudah dipakai di frontend**

```bash
grep -n "getPresence\|presenceView\|PresenceView\|handledBy" src/src/api/client.ts src/src/App.tsx | head -20
```

Catat nama method `api.*` persis (dipakai Step 3).

- [x] **Step 2: Tulis test render yang gagal**

```tsx
// src/test/start-session-target.test.tsx (bagian 2, tambahan)
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

describe("StartSessionModal — target picker (SPEC-1216 · AC-B7/B8)", () => {
  it("default = handledBy pertama eligible; tak memanggil startSession sebelum klik", async () => {
    vi.spyOn(api, "getPresence").mockResolvedValue({ /* fixture: dA online, handledBy, eligible */ } as any);
    vi.spyOn(api, "startSession");
    render(<StartSessionModal open spec={fixtureSpec} onClose={() => {}} onStarted={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText(/target/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/target/i)).toHaveValue("dA");
    expect(api.startSession).not.toHaveBeenCalled();
  });
  it("tanpa kandidat eligible → default hub ini", async () => { /* fixture semua offline */ });
  it("target remote → tombol force ('Mulai tetap') tak dirender", async () => { /* pilih dA, cek queryByText */ });
});
```

(Fixture `fixtureSpec`/mock presence disesuaikan dengan helper test App.tsx yang sudah ada — cari
`grep -n "fixtureSpec\|makeSpec" src/test/*.test.tsx` untuk pola yang konsisten dengan suite
lain di file itu.)

- [x] **Step 3: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/start-session-target.test.tsx
```
Expected: FAIL (tak ada `aria-label="target"` di modal).

- [x] **Step 4: Implementasi — tambahan state + fetch + render di `StartSessionModal`**

Tambah state (dekat `const [launchRejection, ...]`, baris ~115):

```ts
  // SPEC-1216 · ADR-0165 §11 · target Start: "hub ini" atau device handledBy/online lainnya.
  const [targets, setTargets] = React.useState<StartTarget[]>([{ deviceId: LOCAL_DEVICE_ID, name: "hub ini", eligible: true }]);
  const [targetId, setTargetId] = React.useState<string>(LOCAL_DEVICE_ID);
  const [remoteError, setRemoteError] = React.useState<{ error: string; remoteSession?: { deviceId: string; name: string; sessionId: string | null } } | null>(null);
```

Tambah efek muat target (dekat `React.useEffect(() => { if (!open) return; ... }, [open, spec])`,
sebagai efek TERPISAH supaya gagal-diam tak mengganggu efek settings yang sudah ada):

```ts
  React.useEffect(() => {
    if (!open || !spec) return;
    Promise.all([api.getPresence(), api.listHandledBy(spec.projectId)]).then(([view, handledBy]) => {
      const t = startTargets(view, handledBy);
      setTargets(t);
      const first = t.find((x) => x.deviceId !== LOCAL_DEVICE_ID && x.eligible);
      setTargetId(first?.deviceId ?? LOCAL_DEVICE_ID);
    }).catch(() => { setTargets([{ deviceId: LOCAL_DEVICE_ID, name: "hub ini", eligible: true }]); setTargetId(LOCAL_DEVICE_ID); });
  }, [open, spec?.id]);
  const isRemoteTarget = targetId !== LOCAL_DEVICE_ID;
  const targetApi = React.useMemo(
    () => (isRemoteTarget ? createApi({ base: `/api/devices/${targetId}/relay` }) : api),
    [isRemoteTarget, targetId],
  );
```

(Sesuaikan nama `api.getPresence`/`api.listHandledBy` dengan hasil Step 1 bila berbeda.)

Ubah `start()` memakai `targetApi` alih-alih `api`, dan tangani 409 baru:

```ts
  async function start(force = false, confirmRemote = false) {
    setBusy(true);
    setLaunchRejection(null); setRemoteError(null);
    try {
      const { id, resumed } = await targetApi.startSession({
        spec: s.id, flow, model, effort, agent,
        ...(Object.keys(phaseOverrides).length ? { phaseOverrides } : {}),
        goal: goalOn, goalCondition: goalOn && goalCond.trim() ? goalCond.trim() : undefined,
        verifyScope, method,
        ...(isBlocked || force ? { force: true } : {}),
        ...(confirmRemote ? { confirmRemote: true } : {}),
      });
      onStarted(id, resumed); onClose();
    }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.detail && typeof e.detail === "object"
        && ((e.detail as any).error === "remote-session" || (e.detail as any).error === "confirm-required")) {
        setRemoteError(e.detail as any); return;
      }
      const rejected = e instanceof ApiError && e.status === 409 ? zLaunchRejection.safeParse(e.detail) : null;
      if (rejected?.success) setLaunchRejection(rejected.data);
      else onError?.(e);
    }
    finally { setBusy(false); }
  }
```

Tambah `Field` pemilih target DI ATAS `Field label="Agen"` (baris ~258):

```tsx
      <Field label="Target" hint="Mesin yang menjalankan sesi ini. Tak terpilih tetap tampil beserta alasannya.">
        <Select aria-label="target" value={targetId} style={{ width: "100%" }}
          options={targets.map((t) => ({ value: t.deviceId, label: t.eligible ? t.name : `${t.name} — ${reasonLabel(t.reason)}`, disabled: !t.eligible }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setTargetId(e.target.value); setRemoteError(null); }} />
      </Field>
      {remoteError?.error === "remote-session" && remoteError.remoteSession && (
        <div role="alert" style={{ fontSize: 12.5, marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "var(--warn-bg, #fdf6e3)" }}>
          Sesi ini sudah berjalan di <b>{remoteError.remoteSession.name}</b>.
          {/* aksi "Sambung ke sesi" milik navigasi TerminalScreen — turunan C; di sini cukup pesan + tutup */}
        </div>
      )}
      {remoteError?.error === "confirm-required" && (
        <div role="alert" style={{ fontSize: 12.5, marginBottom: 12, padding: "9px 11px", borderRadius: 8, background: "var(--warn-bg, #fdf6e3)" }}>
          <div>Device terakhir yang mengerjakan ini sudah offline.</div>
          <Button variant="danger" disabled={busy} onClick={() => void start(false, true)}>Tetap mulai</Button>
        </div>
      )}
```

Tambah helper kecil di module scope App.tsx (dekat impor):

```ts
function reasonLabel(r?: TargetReason): string {
  switch (r) {
    case "offline": return "offline";
    case "control-off": return "kendali jarak jauh mati";
    case "protocol-mismatch": return "versi tak cocok";
    case "no-spawn": return "tanpa izin mulai sesi";
    case "capacity-full": return "kapasitas penuh";
    default: return "tak tersedia";
  }
}
```

Sembunyikan tombol force ("Mulai tetap") untuk target remote — ubah footer (baris ~218):

```tsx
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon={isBlocked ? "lock" : "play"} variant={isBlocked ? "danger" : "primary"}
          disabled={busy} onClick={() => void start()}>{isBlocked ? "Mulai tetap" : launchRejection ? "Coba lagi" : "Mulai"}</Button>
        {launchRejection && !isBlocked && !isRemoteTarget && <Button leftIcon="lock" variant="danger" disabled={busy}
          onClick={() => void start(true)}>Mulai tetap</Button>}
      </>}>
```

Import tambahan di header `App.tsx`:

```ts
import { createApi } from "./api/instance"; // re-ekspor createApi tak perlu — import langsung dari ./api/client
import { startTargets, type StartTarget, type TargetReason } from "./api/start-targets";
```

(Perbaiki: `createApi` diimpor dari `./api/client`, bukan `./api/instance` — `instance.tsx` hanya
mengekspor `InstanceProvider`/`useInstance`/`useApi`/`useWsTarget`. `StartSessionModal` di sini
tidak memakai `useApi()` karena ia dipanggil dari luar `InstanceProvider` manapun — konsisten
dengan pola lama yang memanggil `api.*` langsung; `targetApi` lokal cukup.)

- [x] **Step 5: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/start-session-target.test.tsx
pnpm -F @hanoman/web typecheck
```
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/src/App.tsx src/test/start-session-target.test.tsx
git commit -m "feat(spec-1216): StartSessionModal — pemilih target default + alasan + 409 remote (AC-B7/B8)"
```

---

## Task 12: Docs — cabut penanda DIRANCANG + tautkan index

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md:47`
- Modify: `internal/docs/architecture/api-contract.md` (baris 1417-1418 + daftar top non-delegatable)
- Modify: `internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md` §6/§8/§9
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/security/threat-model.md:150`
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/docs/README.md` (tautan bila ada doc baru/berubah signifikan)

**Interfaces:** (dokumentasi, tak ada kode)

- [ ] **Step 1: Baca tiap titik yang disebut spec teknis §T10 sebelum mengedit**

```bash
grep -n "SPEC-1216" internal/docs/frontend/frontend-implementation.md \
  internal/docs/architecture/api-contract.md internal/docs/adr/0165-*.md \
  internal/docs/adr/README.md internal/docs/security/threat-model.md
sed -n '1410,1425p' internal/docs/architecture/api-contract.md
sed -n '140,155p' internal/docs/security/threat-model.md
```

- [ ] **Step 2: Cabut frasa "SPEC-1216" di `frontend-implementation.md:47`**

Ganti `"sisanya DIRANCANG untuk SPEC-1216/SPEC-1218"` menjadi `"sisanya DIRANCANG untuk SPEC-1218"`
— bagian SPEC-1216 dianggap SUDAH mendarat di kalimat sebelumnya (sesuaikan kalimat penuhnya
dengan isi nyata baris itu, mengikuti kutipan di spec teknis: `RemoteControlPanel` mendarat A tanpa
toggle lajur log, target Start + aksi sesi mendarat B, log terpusat tetap milik C/D).

- [ ] **Step 3: Perbarui `api-contract.md` — cabut "Belum dilayani" untuk devices-relay**

Baris 1417-1418: ganti status route `/devices/:deviceId/relay/*` dari "Belum dilayani (SPEC-1216)"
menjadi entri route terlayani (method, capability `COOKIE_ONLY`, mapping status). Tambahkan
`devices` ke daftar top non-delegatable bila daftar itu berbentuk tabel/list eksplisit.

- [ ] **Step 4: Perbarui ADR-0165 §6/§8/§9 + `adr/README.md`**

Ganti setiap "menyusul SPEC-1216" menjadi "mendarat SPEC-1216" (atau frasa serupa yang menyatakan
statusnya sudah terimplementasi), konsisten dengan amandemen ADR-0117/0120/0135/0147/0148/0161
yang disebut spec teknis — cek masing-masing berkas ADR itu untuk frasa yang sama:

```bash
grep -rln "menyusul SPEC-1216" internal/docs/adr/
```

- [ ] **Step 5: Perbarui `threat-model.md:150` + `stack.md`**

Masukkan turunan B ke daftar yang sudah mendarat (bukan lagi "direncanakan"); perbarui
diagram/penanda turunan di `stack.md` bila ada penanda eksplisit "A only, B/C/D menyusul".

- [ ] **Step 6: Tautkan di `internal/docs/README.md`**

Pastikan entri untuk `frontend-implementation.md`, `api-contract.md`, `adr/0165-*.md`,
`security/threat-model.md`, `architecture/stack.md` tetap tertaut (biasanya sudah, karena berkas
lama — bukan baru). Bila plan/spec SPEC-1216 belum tertaut, tambahkan baris untuk
`docs/superpowers/specs/2026-09-18-spec-1216-orkestrasi-hub-relay-design.md` dan plan ini
(`docs/superpowers/plans/2026-09-18-spec-1216-orkestrasi-hub-relay-plan.md`) di bagian yang sesuai.

- [ ] **Step 7: `git grep` untuk memastikan tak ada sisa "SPEC-1216" di penanda DIRANCANG**

```bash
git grep -n "DIRANCANG.*SPEC-1216\|SPEC-1216.*DIRANCANG" -- internal/docs/
```
Expected: nol hasil (atau hanya kemunculan yang memang bukan penanda "belum dikerjakan", mis. di
riwayat/rujukan spec ini sendiri).

- [ ] **Step 8: Commit BERSAMA kode Execute (bukan commit terpisah)**

Task ini dieksekusi sebagai bagian dari commit penutup setiap task kode di atas yang menyentuh
kontrak yang didokumentasikan — atau, bila dikerjakan terakhir, satu commit gabungan:

```bash
git add internal/docs/
git commit -m "docs(spec-1216): cabut penanda DIRANCANG turunan B, perbarui api-contract/ADR-0165/threat-model (SC11)"
```

---

## Self-review (dicatat, sudah dijalankan penulis plan)

- **Cakupan AC:** B1 (Task 2), B2 (Task 2+5, dibuktikan test kontrak lokal-vs-relay — TAMBAHKAN
  test paritas eksplisit di Task 5 Step 8 bila belum tercakup: satu test yang menjalankan
  start/steer/interrupt/dialog/done dua jalur dan membandingkan hasil DB), B3 (Task 3), B4 (Task 5,
  via re-attach pane truthy — sudah perilaku lama, tambahkan assert count pane di test Task 5),
  B5/B6 (Task 4/5/6), B7/B8 (Task 10/11), B9 (Task 2+5+6, header/status/body diteruskan apa
  adanya), B10 (Task 2, test diff `count()`), B11 (Task 7). SC11 (Task 12).
- **Placeholder:** tak ada "TODO"/"implement later" tersisa di kode task 1-11; satu `TODO` di Task
  5 Step 4 sengaja ditutup di Step 5 pada task yang sama.
- **Konsistensi tipe:** `LaunchError` (Task 5) dan `RemoteSessionVerdict` (Task 4) dipakai identik
  di Task 5/6; `createApi`/`useApi` (Task 8/9) dipakai identik di Task 11; `StartTarget`/`TargetReason`
  (Task 10) dipakai identik di Task 11.

## Execution Handoff

Plan tersimpan di `docs/superpowers/plans/2026-09-18-spec-1216-orkestrasi-hub-relay-plan.md`.
Dua opsi eksekusi:
1. **Subagent-Driven (disarankan)** — subagent segar per task, review dua tahap antar-task.
2. **Inline Execution** — eksekusi batch dalam sesi ini dengan checkpoint review.
