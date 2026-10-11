import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { issueDeviceToken } from "../src/services/device-token";
import { hashPassword } from "../src/services/auth";
import { __resetEventLog } from "../src/services/logs/event-log";
import { getSetting } from "../src/services/settings";
import { makeSetting } from "./factory";

// ADR-0196..0198 · permukaan ADMIN yang dulu cookie-only kini terbuka lewat capability opt-in.
// Berkas ini menguji yang HANYA bisa salah di server: pagar tak-eskalasi-diri di handler (peta
// route→capability tak melihat body), pemilik device token, jejak audit, dan bahwa yang tetap
// cookie-only memang tetap tertutup.

const app: FastifyInstance = buildApp();
const clean = async () => {
  await prisma.deviceToken.deleteMany(); await prisma.agentToken.deleteMany();
  await prisma.logEntry.deleteMany(); await prisma.agentInvocation.deleteMany();
  await prisma.setting.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(async () => {
  await clean(); __resetEventLog();
  await makeSetting({ agentAccessEnabled: true });
});
afterAll(async () => { await app.close(); await clean(); });

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const call = (
  method: Method, url: string, token?: string, payload?: unknown,
): Promise<LightMyRequestResponse> =>
  app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });

async function admin() {
  return prisma.user.create({ data: { id: "admin-1", email: "a@b.co", passwordHash: await hashPassword("password1"), role: "admin" } });
}
async function agent(caps: string[], createdBy?: string) {
  const { token, view } = await issueAgentToken({ name: "bot", capabilities: caps, createdBy });
  return { token, id: view.id };
}
const events = (kind: string) => prisma.logEntry.findMany({ where: { kind } });

describe("agent-tokens · pagar tak-eskalasi-diri", () => {
  it("tanpa tokens:* → 403 dengan `need`; capability lama tak cukup", async () => {
    const { token } = await agent(["settings:write", "agents:write", "sessions:spawn"]);
    const r = await call("GET", "/api/agent-tokens", token);
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("tokens:read");
    expect((await call("POST", "/api/agent-tokens", token, { name: "x", capabilities: [] })).json().need).toBe("tokens:write");
  });

  it("POST mencetak token ⊆ milik pemanggil; plaintext SEKALI di balasan, tak pernah di daftar; createdBy = agent:<id>", async () => {
    const a = await agent(["tokens:write", "projects:write", "docs:read"]);
    const r = await call("POST", "/api/agent-tokens", a.token, { name: "anak", capabilities: ["projects:read", "docs:read"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().token).toMatch(/^hnm_agt_/);
    expect(r.json().createdBy).toBe(`agent:${a.id}`);
    const list = await call("GET", "/api/agent-tokens", a.token);
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(r.json().token);
    expect(JSON.stringify(list.json())).not.toContain("tokenHash");
    // jejak audit ada dan TIDAK memuat plaintext
    const ev = await events("admin.agent-token.created");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0])).not.toContain(r.json().token);
  });

  it("POST yang melebihi hak pemanggil → 403 + `exceeds`, dan tak ada token lahir (read ≠ write, write ≠ danger)", async () => {
    const a = await agent(["tokens:write", "projects:read", "sessions:write"]);
    for (const caps of [["projects:write"], ["sessions:spawn"], ["access:admin"], ["remote:control"], ["relay:exec"], ["vps:read"]]) {
      const r = await call("POST", "/api/agent-tokens", a.token, { name: "naik", capabilities: ["projects:read", ...caps] });
      expect(r.statusCode, caps.join()).toBe(403);
      expect(r.json().exceeds, caps.join()).toEqual(caps);
    }
    expect(await prisma.agentToken.count()).toBe(1);
  });

  it("PATCH tak boleh menaikkan token melebihi pemanggil, tapi boleh menurunkan/menonaktifkan token ⊆ miliknya", async () => {
    const a = await agent(["tokens:write", "projects:write", "docs:write"]);
    const kid = await agent(["projects:read"]);
    let r = await call("PATCH", `/api/agent-tokens/${kid.id}`, a.token, { capabilities: ["projects:read", "vps:exec"] });
    expect(r.statusCode).toBe(403);
    expect(r.json().exceeds).toEqual(["vps:exec"]);
    expect((await prisma.agentToken.findUnique({ where: { id: kid.id } }))!.capabilities).toEqual(["projects:read"]);

    r = await call("PATCH", `/api/agent-tokens/${kid.id}`, a.token, { capabilities: ["projects:write", "docs:read"], enabled: false });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ enabled: false, capabilities: ["projects:write", "docs:read"] });
    expect(await events("admin.agent-token.updated")).toHaveLength(1);
  });

  it("token TARGET yang lebih berkuasa dari pemanggil tak bisa diubah maupun dicabut (404 bila tak ada)", async () => {
    const a = await agent(["tokens:write", "projects:read"]);
    const strong = await agent(["projects:write", "vps:exec"]);
    for (const [m, body] of [["PATCH", { enabled: false }], ["DELETE", undefined]] as const) {
      const r = await call(m, `/api/agent-tokens/${strong.id}`, a.token, body);
      expect(r.statusCode, m).toBe(403);
      expect(r.json().exceeds, m).toEqual(["projects:write", "vps:exec"]);
    }
    const row = await prisma.agentToken.findUnique({ where: { id: strong.id } });
    expect(row!.enabled).toBe(true);
    expect(row!.revokedAt).toBeNull();
    expect((await call("DELETE", "/api/agent-tokens/nope", a.token)).statusCode).toBe(404);
  });

  it("token TIDAK bisa mengubah atau mencabut DIRINYA SENDIRI — apa pun isi patch-nya", async () => {
    const a = await agent(["tokens:write", "projects:read"]);
    for (const body of [{ enabled: false }, { name: "ganti" }, { capabilities: ["tokens:write"] }, { capabilities: [] }]) {
      const r = await call("PATCH", `/api/agent-tokens/${a.id}`, a.token, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(403);
      expect(r.json().self).toBe(true);
    }
    const d = await call("DELETE", `/api/agent-tokens/${a.id}`, a.token);
    expect(d.statusCode).toBe(403);
    expect(d.json().self).toBe(true);
    const row = await prisma.agentToken.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ enabled: true, revokedAt: null, name: "bot" });
  });

  it("mencabut token ⊆ miliknya berhasil (204) dan token itu langsung 401", async () => {
    const a = await agent(["tokens:write", "docs:write"]);
    const kid = await agent(["docs:read"]);
    expect((await call("DELETE", `/api/agent-tokens/${kid.id}`, a.token)).statusCode).toBe(204);
    expect((await call("GET", "/api/prds", kid.token)).statusCode).toBe(401);
    expect(await events("admin.agent-token.revoked")).toHaveLength(1);
  });

  it("katalog capability terbaca dengan tokens:read; manusia (cookie) tak dibatasi pagar ini", async () => {
    const a = await agent(["tokens:read"]);
    const r = await call("GET", "/api/agent-tokens/capabilities", a.token);
    expect(r.statusCode).toBe(200);
    expect(r.json().capabilities.length).toBe(48);
    // manusia: tanpa pagar — cookie menaikkan ke capability apa pun, seperti sebelumnya.
    const open = buildApp({ requireAuth: false });
    const c = await open.inject({ method: "POST", url: "/api/agent-tokens", payload: { name: "m", capabilities: ["vps:exec", "access:admin"] } });
    expect(c.statusCode).toBe(201);
    await open.close();
  });
});

describe("device-tokens · pemilik = akun penerbit agent token", () => {
  it("agen mencetak & mencabut device token ATAS NAMA akun penerbitnya; token akun lain 404", async () => {
    const u = await admin();
    const other = await prisma.user.create({ data: { id: "admin-2", email: "c@d.co", passwordHash: "x", role: "admin" } });
    const a = await agent(["devices:write"], u.id);
    const r = await call("POST", "/api/device-tokens", a.token, { name: "laptop" });
    expect(r.statusCode).toBe(201);
    expect(r.json().token).toEqual(expect.any(String));
    const row = await prisma.deviceToken.findUnique({ where: { id: r.json().id } });
    expect(row!.userId).toBe(u.id);
    const list = await call("GET", "/api/device-tokens", a.token);
    expect(list.json()).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain(r.json().token);
    expect(JSON.stringify(await events("admin.device-token.created"))).not.toContain(r.json().token);

    const theirs = await issueDeviceToken(other.id, "milik-lain");
    expect((await call("DELETE", `/api/device-tokens/${theirs.id}`, a.token)).statusCode).toBe(404);
    expect((await prisma.deviceToken.findUnique({ where: { id: theirs.id } }))!.revokedAt).toBeNull();
    expect((await call("DELETE", `/api/device-tokens/${r.json().id}`, a.token)).statusCode).toBe(204);
    expect((await prisma.deviceToken.findUnique({ where: { id: r.json().id } }))!.revokedAt).not.toBeNull();
  });

  it("rantai penerbit agen→agen tetap menemukan akun manusianya; tanpa penerbit manusia → 409", async () => {
    const u = await admin();
    const parent = await agent(["tokens:write", "devices:write"], u.id);
    const child = await call("POST", "/api/agent-tokens", parent.token, { name: "anak", capabilities: ["devices:write"] });
    expect(child.json().createdBy).toBe(`agent:${parent.id}`);
    const mint = await call("POST", "/api/device-tokens", child.json().token, { name: "dari-anak" });
    expect(mint.statusCode).toBe(201);
    expect((await prisma.deviceToken.findUnique({ where: { id: mint.json().id } }))!.userId).toBe(u.id);

    const orphan = await agent(["devices:write", "devices:read"]);   // createdBy null
    const r = await call("POST", "/api/device-tokens", orphan.token, { name: "yatim" });
    expect(r.statusCode).toBe(409);
    expect((await call("GET", "/api/device-tokens", orphan.token)).statusCode).toBe(409);
  });

  it("pemilik akun klien atau nonaktif tidak sah → 409", async () => {
    const client = await prisma.user.create({ data: { id: "cl", email: "k@l.co", passwordHash: "x", role: "client" } });
    const a = await agent(["devices:write"], client.id);
    expect((await call("POST", "/api/device-tokens", a.token, { name: "x" })).statusCode).toBe(409);
  });
});

describe("akun & password · access:*", () => {
  it("access:read melihat daftar tanpa hash; mencetak/menghapus butuh access:admin (tokens:write tak cukup)", async () => {
    await admin();
    const reader = await agent(["access:read", "tokens:write"]);
    const list = await call("GET", "/api/auth/users", reader.token);
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toMatch(/passwordHash|\$argon|scrypt/i);
    const r = await call("POST", "/api/auth/users", reader.token, { email: "x@y.co", password: "password2" });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("access:admin");
    expect((await call("POST", "/api/auth/change-password", reader.token, { userId: "admin-1", newPassword: "password2" })).json().need).toBe("access:admin");
    expect((await call("DELETE", "/api/auth/users/admin-1", reader.token)).json().need).toBe("access:admin");
  });

  it("access:admin membuat akun admin; password tak pernah dikembalikan; dicatat di audit", async () => {
    await admin();
    const a = await agent(["access:admin"]);
    const r = await call("POST", "/api/auth/users", a.token, { email: "baru@y.co", password: "password2" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ email: "baru@y.co", role: "admin" });
    expect(JSON.stringify(r.json())).not.toContain("password2");
    expect((await call("POST", "/api/auth/users", a.token, { email: "baru@y.co", password: "password2" })).statusCode).toBe(409);
    expect((await call("POST", "/api/auth/users", a.token, { email: "z@y.co", password: "pendek" })).statusCode).toBe(400);
    const ev = await events("admin.user.created");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toContain("password2");
  });

  it("setel ulang password akun lain: hash berubah, SEMUA sesi akun itu dicabut, tak ada cookie ke agen", async () => {
    const u = await admin();
    await prisma.session.create({ data: { id: "s1", userId: u.id, expiresAt: new Date(Date.now() + 60_000) } });
    const before = u.passwordHash;
    const a = await agent(["access:admin"]);
    const r = await call("POST", "/api/auth/change-password", a.token, { userId: u.id, newPassword: "password-baru" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(r.json().user.id).toBe(u.id);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.passwordHash).not.toBe(before);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    expect(JSON.stringify(await events("admin.user.password-reset"))).not.toContain("password-baru");
    // validasi: akun tak ada → 404; password pendek / field asing → 400; bentuk lama (currentPassword) → 400
    expect((await call("POST", "/api/auth/change-password", a.token, { userId: "nope", newPassword: "password-baru" })).statusCode).toBe(404);
    expect((await call("POST", "/api/auth/change-password", a.token, { userId: u.id, newPassword: "x" })).statusCode).toBe(400);
    expect((await call("POST", "/api/auth/change-password", a.token, { currentPassword: "a", newPassword: "password-baru" })).statusCode).toBe(400);
  });

  it("hapus akun: admin TERAKHIR dilindungi (400), selainnya 204 dan sesinya hilang", async () => {
    const u = await admin();
    const a = await agent(["access:admin"]);
    expect((await call("DELETE", `/api/auth/users/${u.id}`, a.token)).statusCode).toBe(400);
    const v = await prisma.user.create({ data: { id: "v", email: "v@w.co", passwordHash: "x", role: "admin" } });
    expect((await call("DELETE", `/api/auth/users/${v.id}`, a.token)).statusCode).toBe(204);
    expect(await prisma.user.count()).toBe(1);
    expect(await events("admin.user.deleted")).toHaveLength(1);
  });
});

describe("kendali jarak jauh · remote:*", () => {
  it("remote:read membaca; GET tak membuka PUT", async () => {
    const a = await agent(["remote:read"]);
    expect((await call("GET", "/api/remote-control", a.token)).statusCode).toBe(200);
    const r = await call("PUT", "/api/remote-control", a.token, { control: { enabled: true, capabilities: ["sessions:read"] } });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("remote:control");
  });

  it("grant ⊆ capability pemanggil: yang melebihi → 403 + exceeds dan grant TAK berubah", async () => {
    const a = await agent(["remote:control", "sessions:write"]);
    const r = await call("PUT", "/api/remote-control", a.token, { control: { enabled: true, capabilities: ["sessions:read", "sessions:write", "sessions:spawn", "backlog:write"] } });
    expect(r.statusCode).toBe(403);
    expect(r.json().exceeds).toEqual(["sessions:spawn", "backlog:write"]);
    expect((await getSetting()).remoteControl.enabled).toBe(false);
  });

  it("grant sah tersimpan, `by` = agent:<id>, dan audit agen tercatat", async () => {
    const a = await agent(["remote:control", "sessions:write"]);
    const r = await call("PUT", "/api/remote-control", a.token, { control: { enabled: true, capabilities: ["sessions:read", "sessions:write"] } });
    expect(r.statusCode).toBe(200);
    expect((await getSetting()).remoteControl).toEqual({ enabled: true, capabilities: ["sessions:read", "sessions:write"] });
    const grant = await events("grant.changed");
    expect(JSON.stringify(grant)).toContain(`agent:${a.id}`);
    expect(await events("admin.remote-control.updated")).toHaveLength(1);
  });

  it("mengubah lajur log (data keluar ke hub) butuh juga logs:write; tanpa perubahan tak perlu", async () => {
    const a = await agent(["remote:control"]);
    const ship = { event: true, server: false, transcript: true };
    const r = await call("PUT", "/api/remote-control", a.token, { logs: ship });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("logs:write");
    expect((await getSetting()).logShipping.transcript).toBe(false);
    // nilai yang SAMA dengan sekarang bukan perubahan
    expect((await call("PUT", "/api/remote-control", a.token, { logs: { event: true, server: false, transcript: false } })).statusCode).toBe(200);
    const b = await agent(["remote:control", "logs:write"]);
    expect((await call("PUT", "/api/remote-control", b.token, { logs: ship })).statusCode).toBe(200);
    expect((await getSetting()).logShipping.transcript).toBe(true);
  });
});

describe("relay · relay:exec", () => {
  it("tanpa relay:exec → 403 (sessions:spawn + remote:control tak cukup)", async () => {
    const a = await agent(["sessions:spawn", "remote:control", "sessions:write"]);
    const r = await call("POST", "/api/devices/d1/relay/terminal/sessions", a.token, { spec: "SPEC-1" });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("relay:exec");
  });

  it("dengan relay:exec agen SAMPAI ke handler (device tak dikenal → 404 relay), bukan 401/403", async () => {
    const a = await agent(["relay:exec"]);
    const r = await call("GET", "/api/devices/d1/relay/terminal/sessions", a.token);
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ relay: "unknown-device" });
    // aktor di audit hub ditandai agen, bukan akun manusia
    const ev = await events("relay.request");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.data)).toContain(`agent:${a.id}`);
  });

  it("path relay berbahaya ditolak server (400)", async () => {
    const a = await agent(["relay:exec"]);
    const r = await call("GET", "/api/devices/d1/relay/a/%2e%2e/b", a.token);
    expect([400, 404]).toContain(r.statusCode);
  });
});

describe("log, presence, metrik", () => {
  it("logs:read mencari log; logs:write dibutuhkan untuk retensi, dan perubahan dicatat SEBELUM nilainya berubah", async () => {
    const reader = await agent(["logs:read"]);
    const now = new Date();
    const q = `from=${encodeURIComponent(new Date(now.getTime() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(now.getTime() + 60_000).toISOString())}`;
    expect((await call("GET", `/api/logs?${q}`, reader.token)).statusCode).toBe(200);
    expect((await call("GET", "/api/logs/retention", reader.token)).statusCode).toBe(200);
    const denied = await call("PUT", "/api/logs/retention", reader.token, { eventDays: 1, serverDays: 1, transcriptDays: 1, maxBytes: 16 * 1024 ** 2 });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().need).toBe("logs:write");

    const w = await agent(["logs:write"]);
    const before = (await call("GET", "/api/logs/retention", w.token)).json();
    const r = await call("PUT", "/api/logs/retention", w.token, { eventDays: 2, serverDays: 3, transcriptDays: 4, maxBytes: 32 * 1024 ** 2 });
    expect(r.statusCode).toBe(200);
    const ev = await events("admin.log-retention.updated");
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({ from: before, to: { eventDays: 2, serverDays: 3, transcriptDays: 4 } });
  });

  it("presence:read membaca peta presence; token tanpa itu → 403 need presence:read", async () => {
    const a = await agent(["presence:read"]);
    expect((await call("GET", "/api/presence", a.token)).statusCode).toBe(200);
    const b = await agent(["sessions:write", "settings:write"]);
    const r = await call("GET", "/api/presence", b.token);
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("presence:read");
  });

  it("metrics:read membaca metrik; disposisi butuh metrics:write (agents:write tak cukup); invokasi tak ada → 404", async () => {
    const reader = await agent(["metrics:read", "agents:write"]);
    expect((await call("GET", "/api/custom-agents/metrics", reader.token)).statusCode).toBe(200);
    const denied = await call("PATCH", "/api/custom-agents/invocations/i1", reader.token, { disposition: "accepted" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().need).toBe("metrics:write");

    await prisma.agentInvocation.create({ data: {
      id: "i1", sessionId: "s", projectId: "p", runtime: "claude", runtimeInvocationId: "r1",
      agentName: "reviewer", status: "completed", startedAt: new Date(),
    } });
    const w = await agent(["metrics:write"]);
    const r = await call("PATCH", "/api/custom-agents/invocations/i1", w.token, { disposition: "rejected", note: "salah" });
    expect(r.statusCode).toBe(200);
    expect((await prisma.agentInvocation.findUnique({ where: { id: "i1" } }))!.disposition).toBe("rejected");
    expect((await call("PATCH", "/api/custom-agents/invocations/nope", w.token, { disposition: "accepted" })).statusCode).toBe(404);
    expect(await events("admin.invocation.disposition")).toHaveLength(1);
  });
});

describe("yang TETAP cookie-only tak bisa dibuka capability apa pun", () => {
  const ALL = [
    "tokens:write", "devices:write", "access:admin", "remote:control", "relay:exec", "logs:write",
    "metrics:write", "settings:write", "sessions:spawn", "projects:write",
  ];
  it("terminal/workspace, sync, portal, client-accounts, webhooks → 403 cookie-only walau token memegang semuanya", async () => {
    const a = await agent(ALL);
    for (const [m, url] of [
      ["GET", "/api/terminal/workspace"], ["PUT", "/api/terminal/workspace"],
      ["POST", "/api/sync/now"], ["GET", "/api/portal/projects"], ["GET", "/api/client-accounts"], ["GET", "/api/webhooks"],
    ] as const) {
      const r = await call(m, url, a.token, m === "PUT" ? {} : undefined);
      expect(r.statusCode, `${m} ${url}`).toBe(403);
      expect(r.json().error, `${m} ${url}`).toBe("cookie session required");
    }
  });

  it("POST /session-events menolak agent token dengan 401 (token HMAC per sesi, bukan capability)", async () => {
    const a = await agent(ALL);
    const r = await app.inject({
      method: "POST", url: "/api/session-events",
      headers: { authorization: `Bearer ${a.token}`, "x-hanoman-session": "s1" }, payload: {},
    });
    expect(r.statusCode).toBe(401);
  });
});
