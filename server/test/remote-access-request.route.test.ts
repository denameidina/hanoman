import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import {
  ACCESS_REQUEST_TTL_MS, RELAY_ACTOR_HEADER, RELAY_HEADER, REQUEST_TIER_GRANTS, validateRemoteGrant,
  zAccessRequestCreate, isAccessRequestRoute, relayRouteAllowed, type RemoteCapability,
} from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { __resetEventLog } from "../src/services/logs/event-log";
import { __resetAccessRequests, createAccessRequest } from "../src/services/remote-access-request";
import { admitRemoteRequest, encodeRelayActor } from "../src/services/relay/gate";
import { relaySecret } from "../src/services/relay/secret";
import { getSetting } from "../src/services/settings";
import { makeSetting } from "./factory";

// ADR-0217 · sisi TUJUAN (perangkat X): permintaan tingkat dari relay mengantre, persetujuan HANYA dari
// sesi cookie lokal, dan penerapannya lewat jalur PUT yang sama. Uji ini memakai inject + header relay
// (in-process), bukan socket — socket dibuktikan di remote-access-request.relay.test.ts.

// getSetting dibungkus pass-through agar satu panggilan bisa dibuat gagal (galat DB) tanpa menyentuh Prisma.
vi.mock("../src/services/settings", async (orig) => {
  const mod = await orig<typeof import("../src/services/settings")>();
  return { ...mod, getSetting: vi.fn(mod.getSetting) };
});

const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.logEntry.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
const hub = { hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const asRelay = (method: Method, url: string, payload?: unknown, actor = hub) => app.inject({
  method, url,
  headers: { host: "127.0.0.1", [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(actor) },
  ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
});
let cookie = "";
const asCookie = (method: Method, url: string, payload?: unknown) => app.inject({
  method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
});
const grant = async (enabled: boolean, capabilities: RemoteCapability[]) => makeSetting({ remoteControl: { enabled, capabilities } });
const current = async () => (await getSetting()).remoteControl;

beforeEach(async () => {
  await clean(); __resetEventLog(); __resetAccessRequests();
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
});
afterEach(() => { vi.useRealTimers(); });
afterAll(async () => { await app.close(); await clean(); });

const createOn = (tier: string, actor = hub) => asRelay("POST", "/api/remote-control/access-requests", { tier }, actor);
// Persetujuan wajib membawa tingkat & hub yang dilihat di kartu (ADR-0217 §2). Tanpa body → 400.
const approve = (id: string, payload?: unknown) =>
  asCookie("POST", `/api/remote-control/access-requests/${id}/approve`, payload);

describe("permintaan tingkat dari relay (ADR-0217 · sisi tujuan)", () => {
  it("relay POST menghasilkan permintaan PENDING; grant TIDAK berubah walau grant-nya kosong", async () => {
    await grant(true, []);
    const res = await createOn("kerja");
    expect(res.statusCode).toBe(201);
    expect(res.json().request).toMatchObject({ tier: "kerja", status: "pending", from: hub.hubOrigin, requestedBy: hub.email });
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
  });

  it("permintaan kedua saat masih menunggu → 409, tanpa entri baru", async () => {
    await grant(true, []);
    await createOn("lihat");
    const second = await createOn("tulis");
    expect(second.statusCode).toBe(409);
    expect(second.json().request).toMatchObject({ tier: "lihat", status: "pending" });
    const list = await asCookie("GET", "/api/remote-control/access-requests");
    expect(list.json().items).toHaveLength(1);
  });

  it("relay TAK bisa menyetujui, menolak, atau membaca daftar cookie-only: rute di luar allowlist → 403", async () => {
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    for (const url of [`/api/remote-control/access-requests/${id}/approve`, `/api/remote-control/access-requests/${id}/reject`]) {
      const res = await asRelay("POST", url);
      expect(res.statusCode, url).toBe(403);
      expect(res.json()).toEqual({ error: "relay route not allowed" });
    }
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
  });

  it("POST tanpa relay (cookie lokal) ditolak: hanya relay yang boleh meminta", async () => {
    await grant(true, []);
    const res = await asCookie("POST", "/api/remote-control/access-requests", { tier: "lihat" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/relay/);
  });

  it("tingkat di luar tiga tingkat, atau field asing → 400", async () => {
    await grant(true, []);
    expect((await createOn("vps")).statusCode).toBe(400);
    expect((await asRelay("POST", "/api/remote-control/access-requests", { tier: "lihat", capabilities: ["vps:exec"] })).statusCode).toBe(400);
  });

  it("relay GET hanya memuat permintaan dari hub yang sama", async () => {
    await grant(true, []);
    await createOn("lihat", hub);
    const other = { hubOrigin: "https://lain.example", userId: "u2", email: "x@lain.example" };
    const seen = await asRelay("GET", "/api/remote-control/access-requests", undefined, other);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().items).toEqual([]);
    const mine = await asRelay("GET", "/api/remote-control/access-requests", undefined, hub);
    expect(mine.json().items).toHaveLength(1);
  });

  it("gate grant-free: POST/GET permintaan lolos walau capability kosong; PATCH tetap ditolak", async () => {
    const fake = (method: string, url: string) => ({
      method, url, headers: { [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(hub) },
      raw: { socket: undefined },
    }) as any;
    const none = async () => ({ enabled: true, capabilities: [] as RemoteCapability[] });
    expect(await admitRemoteRequest(fake("POST", "/api/remote-control/access-requests"), none)).toMatchObject({ ok: true });
    expect(await admitRemoteRequest(fake("GET", "/api/remote-control/access-requests"), none)).toMatchObject({ ok: true });
    expect(await admitRemoteRequest(fake("POST", "/api/remote-control/access-requests/ar1/approve"), none))
      .toMatchObject({ ok: false, status: 403 });
    expect(await admitRemoteRequest(fake("PATCH", "/api/remote-control/access-requests"), none))
      .toMatchObject({ ok: false, status: 403 });
    // ADR-0217 · master mati: dua rute permintaan → 403 'kendali jarak jauh mati' (BUKAN 401, yang dibaca hub
    // sebagai sesi habis); rute lain di kondisi yang sama tetap 401.
    const off = async () => ({ enabled: false, capabilities: [] as RemoteCapability[] });
    expect(await admitRemoteRequest(fake("POST", "/api/remote-control/access-requests"), off))
      .toMatchObject({ ok: false, status: 403, body: { error: "kendali jarak jauh mati" } });
    expect(await admitRemoteRequest(fake("GET", "/api/remote-control/access-requests"), off))
      .toMatchObject({ ok: false, status: 403, body: { error: "kendali jarak jauh mati" } });
    expect(await admitRemoteRequest(fake("PATCH", "/api/remote-control/access-requests"), off))
      .toMatchObject({ ok: false, status: 401 });
  });

  it("relay POST saat kendali mati → 403 'kendali jarak jauh mati' end-to-end, grant tak tersentuh", async () => {
    await grant(false, []);
    const res = await createOn("kerja");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "kendali jarak jauh mati" });
    expect(await current()).toEqual({ enabled: false, capabilities: [] });
  });

  it("permintaan tertunda milik hub LAIN: 409 tanpa view (tingkat, email, dan id-nya tak bocor); hub yang sama tetap dapat view", async () => {
    await grant(true, []);
    await createOn("tulis", hub);
    const other = { hubOrigin: "https://lain.example", userId: "u2", email: "x@lain.example" };
    const foreign = await createOn("lihat", other);
    expect(foreign.statusCode).toBe(409);
    expect(foreign.json()).toEqual({ error: "permintaan sebelumnya masih menunggu keputusan di perangkat ini" });
    const own = await createOn("lihat", hub);
    expect(own.statusCode).toBe(409);
    expect(own.json().request).toMatchObject({ tier: "tulis", from: hub.hubOrigin, status: "pending" });
  });
});

describe("id permintaan (ADR-0217 · acak, tak dipakai ulang setelah restart)", () => {
  it("id berupa UUID acak; setelah restart (modul dimuat ulang) id lama tak menemukan permintaan dan id baru beda", async () => {
    const before = createAccessRequest({ tier: "lihat", from: hub.hubOrigin, requestedBy: hub.email });
    if (!before.ok) throw new Error("setup: permintaan pertama harus diterima");
    const oldId = before.view.id;
    expect(oldId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // Restart = modul dimuat ulang dengan keadaan kosong. Penghitung lama akan mulai dari ar1 lagi di sini.
    vi.resetModules();
    const fresh = await import("../src/services/remote-access-request");
    expect(fresh.viewById(oldId)).toBeNull();
    const after = fresh.createAccessRequest({ tier: "lihat", from: hub.hubOrigin, requestedBy: hub.email });
    if (!after.ok) throw new Error("setup: permintaan di proses baru harus diterima");
    expect(after.view.id).not.toBe(oldId);
    expect(after.view.id).not.toBe("ar1");
  });

  it("approve memakai id yang tak ada lagi (kartu basi setelah restart) → 409 'berubah', grant tak tersentuh", async () => {
    await grant(true, []);
    const res = await approve("ar1", { tier: "kerja", from: hub.hubOrigin });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("Permintaan berubah, periksa lagi");
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
  });
});

describe("persetujuan lokal (ADR-0217 · satu-satunya jalur yang menerapkan grant)", () => {
  it("setujui → grant = tingkat yang diminta, master tetap menyala, audit beraktor cookie", async () => {
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    const res = await approve(id, { tier: "kerja", from: hub.hubOrigin });
    expect(res.statusCode).toBe(200);
    expect(res.json().request.status).toBe("approved");
    expect(await current()).toEqual({ enabled: true, capabilities: [...REQUEST_TIER_GRANTS.kerja] });
    expect(validateRemoteGrant(REQUEST_TIER_GRANTS.kerja)).toBeNull();
    const rows = await prisma.logEntry.findMany({ where: { kind: "grant.changed" } });
    expect(rows.some((r) => (r.data as any)?.by === "a@b.co")).toBe(true);
    // keputusan kedua ditolak: sudah diputuskan
    expect((await approve(id, { tier: "kerja", from: hub.hubOrigin })).statusCode).toBe(409);
    expect((await asCookie("POST", `/api/remote-control/access-requests/${id}/reject`)).statusCode).toBe(409);
  });

  it("menurunkan tingkat juga butuh persetujuan: grant tetap sampai disetujui", async () => {
    await grant(true, [...REQUEST_TIER_GRANTS.tulis]);
    await createOn("lihat");
    expect(await current()).toEqual({ enabled: true, capabilities: [...REQUEST_TIER_GRANTS.tulis] });
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    expect((await approve(id, { tier: "lihat", from: hub.hubOrigin })).statusCode).toBe(200);
    expect(await current()).toEqual({ enabled: true, capabilities: [...REQUEST_TIER_GRANTS.lihat] });
  });

  it("tolak → grant tak berubah, permintaan 'ditolak', dan slot tunggu lepas", async () => {
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    const res = await asCookie("POST", `/api/remote-control/access-requests/${id}/reject`);
    expect(res.json().request.status).toBe("rejected");
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
    expect((await createOn("lihat")).statusCode).toBe(201);
  });

  it("approve dengan tingkat atau hub yang TAK dilihat operator → 409, permintaan tetap pending, grant tak berubah", async () => {
    // Kartu yang dilihat operator tak lagi cocok dengan permintaan tertunda (mis. kartu basi setelah restart).
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    const wrongTier = await approve(id, { tier: "tulis", from: hub.hubOrigin });
    expect(wrongTier.statusCode).toBe(409);
    expect(wrongTier.json().error).toBe("Permintaan berubah, periksa lagi");
    const wrongHub = await approve(id, { tier: "kerja", from: "https://lain.example" });
    expect(wrongHub.statusCode).toBe(409);
    expect(wrongHub.json().error).toBe("Permintaan berubah, periksa lagi");
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
    const list = await asCookie("GET", "/api/remote-control/access-requests");
    expect(list.json().items[0].status).toBe("pending");
    // tanpa body, atau dengan field asing → 400: tak ada persetujuan tanpa tahu tingkatnya
    expect((await approve(id)).statusCode).toBe(400);
    expect((await approve(id, { tier: "kerja", from: hub.hubOrigin, extra: 1 })).statusCode).toBe(400);
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
    // pasangan yang benar tetap menerapkan grant
    expect((await approve(id, { tier: "kerja", from: hub.hubOrigin })).statusCode).toBe(200);
    expect(await current()).toEqual({ enabled: true, capabilities: [...REQUEST_TIER_GRANTS.kerja] });
  });

  it("kendali jarak jauh mati → 409, permintaan kembali menunggu, grant tak berubah", async () => {
    // Relay hanya terbuka saat grant menyala, jadi permintaan dibuat dulu lalu grant dimatikan.
    await grant(true, []);
    await createOn("kerja");
    await grant(false, []);
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    const res = await approve(id, { tier: "kerja", from: hub.hubOrigin });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/nyalakan/);
    expect(await current()).toEqual({ enabled: false, capabilities: [] });
    const list = await asCookie("GET", "/api/remote-control/access-requests");
    expect(list.json().items[0].status).toBe("pending");
  });

  it("permintaan kedaluwarsa setelah 10 menit: setujui → 409, status tampil 'expired', grant tak berubah", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    vi.setSystemTime(new Date(Date.parse("2026-10-12T10:00:00Z") + ACCESS_REQUEST_TTL_MS));
    const list = await asCookie("GET", "/api/remote-control/access-requests");
    expect(list.json().items[0].status).toBe("expired");
    const res = await approve(id, { tier: "kerja", from: hub.hubOrigin });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/kedaluwarsa/);
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
    // slot tunggu yang sudah kedaluwarsa tak menghalangi permintaan baru
    expect((await createOn("lihat")).statusCode).toBe(201);
  });

  it("galat DB di tengah persetujuan → permintaan kembali pending (tak tertinggal 'approved' tanpa grant)", async () => {
    await grant(true, []);
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    // getSetting dipasang mock pass-through di atas; hanya panggilan BERIKUT yang gagal (DB sakit sesaat).
    vi.mocked(getSetting).mockRejectedValueOnce(new Error("db sakit"));
    const res = await approve(id, { tier: "kerja", from: hub.hubOrigin });
    expect(res.statusCode).toBe(500);
    const list = await asCookie("GET", "/api/remote-control/access-requests");
    expect(list.json().items[0]).toMatchObject({ id, status: "pending" });
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
    // dan masih bisa disetujui setelah DB pulih
    expect((await approve(id, { tier: "kerja", from: hub.hubOrigin })).statusCode).toBe(200);
  });

  it("agen ber-remote:control tak bisa menyetujui: COOKIE_ONLY → 403 'cookie session required'", async () => {
    await makeSetting({ agentAccessEnabled: true, remoteControl: { enabled: true, capabilities: [] } });
    await createOn("kerja");
    const id = (await asCookie("GET", "/api/remote-control/access-requests")).json().items[0].id;
    const { token } = await issueAgentToken({ name: "bot", capabilities: ["remote:control", "remote:read"] });
    const h = { authorization: `Bearer ${token}` };
    const approve = await app.inject({ method: "POST", url: `/api/remote-control/access-requests/${id}/approve`, headers: h });
    expect(approve.statusCode).toBe(403);
    expect(approve.json()).toEqual({ error: "cookie session required" });
    const list = await app.inject({ method: "GET", url: "/api/remote-control/access-requests", headers: h });
    expect(list.statusCode).toBe(403);
    expect(await current()).toEqual({ enabled: true, capabilities: [] });
  });

  it("cookie lokal melihat semua permintaan (termasuk dari hub lain)", async () => {
    await grant(true, []);
    await createOn("lihat", hub);
    const items = (await asCookie("GET", "/api/remote-control/access-requests")).json().items;
    expect(items.map((i: any) => i.from)).toEqual([hub.hubOrigin]);
  });
});

describe("pembatas tingkat dan kedaluwarsa (ADR-0217 · anti-spam)", () => {
  it("permintaan ke-4 dalam 10 menit → 429 + retry-after; jendela lewat → diterima lagi", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
    await grant(true, []);
    for (let i = 0; i < 3; i++) {
      const created = await createOn("lihat");
      expect(created.statusCode, `permintaan ${i + 1}`).toBe(201);
      const id = created.json().request.id;
      await asCookie("POST", `/api/remote-control/access-requests/${id}/reject`);
    }
    const limited = await createOn("lihat");
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    vi.setSystemTime(new Date(Date.parse("2026-10-12T10:00:00Z") + 10 * 60_000 + 1));
    expect((await createOn("lihat")).statusCode).toBe(201);
  });
});

describe("kontrak keamanan rute (ADR-0202 · COOKIE_ONLY di peta capability)", () => {
  it("rute persetujuan & daftar = COOKIE_ONLY; rute relay POST/GET ada di allowlist", () => {
    expect(capabilityForRoute("POST", "/api/remote-control/access-requests/ar1/approve")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/remote-control/access-requests/ar1/reject")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/remote-control/access-requests")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/remote-control/access-requests")).toBe("COOKIE_ONLY");
    expect(relayRouteAllowed("POST", "/api/remote-control/access-requests")).toBe(true);
    expect(relayRouteAllowed("GET", "/api/remote-control/access-requests")).toBe(true);
    expect(relayRouteAllowed("POST", "/api/remote-control/access-requests/ar1/approve")).toBe(false);
    expect(isAccessRequestRoute("POST", "/api/remote-control/access-requests?x=1")).toBe(true);
    expect(isAccessRequestRoute("POST", "/api/remote-control/access-requests/ar1/approve")).toBe(false);
    expect(zAccessRequestCreate.safeParse({ tier: "tulis" }).success).toBe(true);
    expect(zAccessRequestCreate.safeParse({ tier: "tulis", extra: 1 }).success).toBe(false);
  });
});

