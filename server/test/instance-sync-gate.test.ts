import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import * as restartSvc from "../src/services/restart";
import { __setExiter, _resetUpdateCache, __setRegistrySnapshot } from "../src/services/update";

// ADR-0199 · ADR-0200 · gerbang NYATA (bukan hanya peta): agent token melewati `onRequest` app.ts
// sampai ke handler. Yang dibuktikan: capability baru benar-benar membuka pintunya, capability lain
// (termasuk yang paling berkuasa) tidak, dan kanal mesin-ke-mesin tetap tak terjangkau.
const app = buildApp();
const clean = async () => {
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
};
const savedSup = process.env.HANOMAN_SUPERVISOR;
const savedDelay = process.env.HANOMAN_UPDATE_RESTART_DELAY_MS;
let exits: number[];
const manual = vi.spyOn(restartSvc, "requestManualRestart").mockImplementation(() => {});

beforeEach(async () => {
  await clean();
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  exits = [];
  __setExiter((c) => exits.push(c));
  process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = "0";
  _resetUpdateCache();
});
afterEach(() => {
  __setExiter(null); manual.mockClear();
  if (savedSup === undefined) delete process.env.HANOMAN_SUPERVISOR; else process.env.HANOMAN_SUPERVISOR = savedSup;
  if (savedDelay === undefined) delete process.env.HANOMAN_UPDATE_RESTART_DELAY_MS; else process.env.HANOMAN_UPDATE_RESTART_DELAY_MS = savedDelay;
  _resetUpdateCache();
});
afterAll(clean);

const as = async (capabilities: string[]) => {
  const { token } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { authorization: `Bearer ${token}` };
};
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("instance:admin — POST /update/apply & POST /restart", () => {
  const FULL = ["settings:write", "projects:write", "backlog:write", "backlog:lifecycle", "sessions:write",
    "sessions:spawn", "ide:write", "ide:git", "vps:write", "vps:exec", "sync:write", "sync:resolve"];

  it("capability lain — bahkan semua yang lain — ditolak 403 dengan need=instance:admin, dan TIDAK keluar", async () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    __setRegistrySnapshot("99.9.9", "ok");
    const h = await as(FULL);
    for (const url of ["/api/update/apply", "/api/restart"]) {
      const r = await app.inject({ method: "POST", url, headers: h, payload: { confirm: true } });
      expect(r.statusCode, url).toBe(403);
      expect(r.json(), url).toMatchObject({ error: "capability required", need: "instance:admin" });
    }
    await settle();
    expect(exits).toEqual([]);
    expect(manual).not.toHaveBeenCalled();
  });

  it("dengan instance:admin: confirm:false hanya melapor, confirm:true → 202 lalu keluar (update: sentinel 75)", async () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    __setRegistrySnapshot("99.9.9", "ok");
    const h = await as(["instance:admin"]);

    const dry = await app.inject({ method: "POST", url: "/api/update/apply", headers: h, payload: { confirm: false } });
    expect(dry.statusCode).toBe(409);
    expect(dry.json()).toMatchObject({ error: "confirm-required", to: "99.9.9" });
    const dryRestart = await app.inject({ method: "POST", url: "/api/restart", headers: h, payload: { confirm: false } });
    expect(dryRestart.statusCode).toBe(409);
    expect(dryRestart.json()).toMatchObject({ error: "confirm-required" });
    await settle();
    expect(exits).toEqual([]);
    expect(manual).not.toHaveBeenCalled();

    const go = await app.inject({ method: "POST", url: "/api/update/apply", headers: h, payload: { confirm: true } });
    expect(go.statusCode).toBe(202);
    const rs = await app.inject({ method: "POST", url: "/api/restart", headers: h, payload: { confirm: true } });
    expect(rs.statusCode).toBe(202);
    await settle();
    expect(exits).toEqual([75]);
    expect(manual).toHaveBeenCalledTimes(1);
  });

  it("tanpa supervisor tetap 409 unsupervised walau capability ada — capability bukan izin mematikan proses", async () => {
    delete process.env.HANOMAN_SUPERVISOR;
    __setRegistrySnapshot("99.9.9", "ok");
    const h = await as(["instance:admin"]);
    const a = await app.inject({ method: "POST", url: "/api/update/apply", headers: h, payload: { confirm: true } });
    const b = await app.inject({ method: "POST", url: "/api/restart", headers: h, payload: { confirm: true } });
    expect(a.statusCode).toBe(409); expect(a.json().error).toBe("unsupervised");
    expect(b.statusCode).toBe(409); expect(b.json().error).toBe("unsupervised");
    await settle();
    expect(exits).toEqual([]);
    expect(manual).not.toHaveBeenCalled();
  });

  it("exit dijadwalkan SESUDAH balasan, lewat afterReplyFlushed — bukan timer mandiri", async () => {
    process.env.HANOMAN_SUPERVISOR = "1";
    __setRegistrySnapshot("99.9.9", "ok");
    let release: (() => void) | undefined;
    const gate = vi.spyOn(restartSvc, "afterReplyFlushed").mockImplementation((_raw, fn) => { release = fn; });
    try {
      const h = await as(["instance:admin"]);
      const r = await app.inject({ method: "POST", url: "/api/update/apply", headers: h, payload: { confirm: true } });
      expect(r.statusCode).toBe(202);
      await settle();
      expect(exits).toEqual([]);     // balasan sudah di tangan klien, tapi gerbang flush belum dilepas
      release!();
      await settle();
      expect(exits).toEqual([75]);
    } finally { gate.mockRestore(); }
  });

  it("instance:admin tidak membuka apa pun selain dua route itu", async () => {
    const h = await as(["instance:admin"]);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/update", headers: h })).statusCode).toBe(200);   // GLOBAL_READ tak berubah
    expect((await app.inject({ method: "PUT", url: "/api/settings", headers: h, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/sync/conflicts", headers: h })).json())
      .toMatchObject({ need: "sync:read" });
  });
});

describe("sync:* — tiga permukaan UI", () => {
  it("antrean konflik & hapus-tertunda: sync:read cukup; tanpa capability 403 need sync:read", async () => {
    const none = await as(["projects:read"]);
    const r403 = await app.inject({ method: "GET", url: "/api/sync/conflicts", headers: none });
    expect(r403.statusCode).toBe(403);
    expect(r403.json()).toMatchObject({ need: "sync:read" });
    const h = await as(["sync:read"]);
    const c = await app.inject({ method: "GET", url: "/api/sync/conflicts", headers: h });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual({ conflicts: [] });
    const p = await app.inject({ method: "GET", url: "/api/sync/pending", headers: h });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ deletes: [], total: 0 });
  });

  it("POST /sync/now menuntut sync:write (sync:read tak cukup); instance bukan klien → not-configured", async () => {
    const ro = await app.inject({ method: "POST", url: "/api/sync/now", headers: await as(["sync:read"]), payload: {} });
    expect(ro.statusCode).toBe(403);
    expect(ro.json()).toMatchObject({ need: "sync:write" });
    const rw = await app.inject({ method: "POST", url: "/api/sync/now", headers: await as(["sync:write"]), payload: { full: false } });
    expect(rw.statusCode).toBe(200);
    expect(rw.json()).toMatchObject({ ok: false, reason: "not-configured" });
  });

  it("memutuskan konflik menuntut sync:resolve — sync:write (dan semua capability lain) tak cukup", async () => {
    const url = "/api/sync/conflicts/spec/SPEC-1/resolve";
    const w = await app.inject({ method: "POST", url, headers: await as(["sync:write", "backlog:lifecycle", "settings:write"]), payload: { choice: "server" } });
    expect(w.statusCode).toBe(403);
    expect(w.json()).toMatchObject({ need: "sync:resolve" });
    const h = await as(["sync:resolve"]);
    const bad = await app.inject({ method: "POST", url, headers: h, payload: { choice: "ngawur" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ ok: false, reason: "bad-choice" });
    const none = await app.inject({ method: "POST", url, headers: h, payload: { choice: "server" } });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toMatchObject({ ok: false, reason: "not-found" });   // tak ada baris konflik: tak ada yang dibuang
  });

  it("kanal mesin-ke-mesin TIDAK terbuka untuk agent token, sebanyak apa pun capability-nya", async () => {
    const h = await as(["sync:read", "sync:write", "sync:resolve", "instance:admin", "settings:write", "projects:write"]);
    // Gerbang app.ts mem-bypass /api/sync/* ke route-nya sendiri; route menolak token yang bukan device-token.
    for (const [method, url] of [
      ["GET", "/api/sync/pull"], ["GET", "/api/sync/bootstrap"], ["POST", "/api/sync/push"],
      ["POST", "/api/sync/logs"], ["GET", "/api/sync/attachments/k"], ["GET", "/api/sync/qa-attachments/i"],
    ] as const) {
      const r = await app.inject({ method, url, headers: h, payload: method === "POST" ? { records: [] } : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
    }
    // POST /ws-tickets jatuh ke gerbang agen → cookie-only.
    const t = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: h, payload: {} });
    expect(t.statusCode).toBe(403);
    expect(t.json()).toEqual({ error: "cookie session required" });
  });
});

describe("GET /api/agent-integration.md — publik", () => {
  it("terbaca tanpa token apa pun (tool hanoman_agent_guide bergantung pada ini)", async () => {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/agent-integration.md");
    const r = await buildApp({ agentDocFile: file }).inject({ method: "GET", url: "/api/agent-integration.md" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/markdown/);
    expect(r.body).toContain("hanoman");
  });
});

describe("Help Center publik — anonim, tak punya capability (ADR-0201)", () => {
  it("project tak ada / Help mati → 404 generik tanpa token; token agen tak mengubah apa pun", async () => {
    const anon = await app.inject({ method: "GET", url: "/api/help/tidak-ada" });
    expect(anon.statusCode).toBe(404);
    const withAgent = await app.inject({ method: "GET", url: "/api/help/tidak-ada", headers: await as([]) });
    expect(withAgent.statusCode).toBe(404);
    expect(withAgent.json()).toEqual(anon.json());
  });
});
