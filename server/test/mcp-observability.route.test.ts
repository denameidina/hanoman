// ADR-0187/0188/0189 · gerbang SUNGGUHAN (onRequest) untuk route yang dibuka ke agent token:
// bukan hanya peta `capabilityForRoute`, tapi request HTTP ber-Bearer lewat seluruh hook. Yang
// dikunci: (1) capability baru opt-in — token berisi SEMUA capability lama tetap 403; (2) tulis tak
// ikut baca; (3) properti mesin terbaca tanpa capability tapi tak bisa ditulis; (4) shape() katalog
// membaca balasan NYATA server, termasuk NDJSON.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCP_TOOLS, CAPABILITY_IDS, PORTAL_CHAT_DEFAULTS, periodKeyOf } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { issueAgentToken } from "../src/services/agent-token";
import { checkAgentCapability } from "../src/services/agent-capabilities";

const app = buildApp();
const clean = async () => {
  await prisma.portalChatMessage.deleteMany(); await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany(); await prisma.sessionResult.deleteMany();
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;
const bearer = async (caps: string[]) => ({
  authorization: `Bearer ${(await issueAgentToken({ name: "bot", capabilities: caps as never })).token}`,
});

// Semua capability LAMA — tepat yang dipegang token paling berkuasa sebelum ADR-0188/0189.
const LEGACY = CAPABILITY_IDS.filter((c) => !c.startsWith("activity:") && !c.startsWith("portal-chat:"));

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "adr0189-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

async function seed(repoDir: string | null) {
  await prisma.setting.create({ data: { id: 1, data: {
    model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
    notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true,
    notifyDecisionSound: "alert", agentAccessEnabled: true,
    portalChat: { ...PORTAL_CHAT_DEFAULTS, enabled: true } } as object } });
  await prisma.project.create({ data: { id: "p1", name: "Toko Mekar", desc: "", kind: "existing", repoDir } });
  const klien = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  const s = await prisma.portalChatSession.create({ data: {
    projectId: "p1", userId: klien.id, type: "brainstorm", periodKey: periodKeyOf(new Date()),
    summary: "ide program loyalitas", prdMarkdown: "# Program loyalitas\n\nisi",
    prdReadyAt: new Date("2026-08-19T10:00:00Z") } });
  await prisma.portalChatMessage.create({ data: { sessionId: s.id, seq: 1, role: "klien", text: "mau program loyalitas" } });
  await prisma.portalChatMessage.create({ data: {
    sessionId: s.id, seq: 2, role: "hanoman", text: "ditolak", rawText: "mentah", blocked: true, blockReasons: ["x"] } });
  return s.id;
}

describe("properti mesin: terbaca tanpa capability, tak bisa ditulis (ADR-0187)", () => {
  it("token TANPA capability apa pun → 200 di /models, /methods/status, /codex/version, /health", async () => {
    await seed(null);
    const h = await bearer([]);
    for (const url of ["/api/models", "/api/methods/status", "/api/codex/version", "/api/health"])
      expect((await app.inject({ method: "GET", url, headers: h })).statusCode, url).toBe(200);
  });

  it("katalog model yang sampai ke agen tak memuat detail akun", async () => {
    await seed(null);
    const r = await app.inject({ method: "GET", url: "/api/models", headers: await bearer([]) });
    expect(JSON.stringify(r.json()).toLowerCase()).not.toContain("account");
    expect(r.json()).toHaveProperty("claude");
    expect(r.json()).toHaveProperty("providers");
  });

  // Tak ada route tulis di ketiga prefix itu (Fastify menjawab 404 SEBELUM hook auth untuk path tak
  // terdaftar), jadi yang bisa dikunci adalah putusan gerbangnya: route tulis yang kelak lahir di
  // sana harus cookie-only, bukan ikut terbuka karena prefix-nya `GLOBAL_READ`.
  it("method tulis di prefix yang sama diputus cookie-only — bahkan untuk token berkapasitas penuh", () => {
    const all = [...CAPABILITY_IDS];
    for (const [method, url] of [["POST", "/api/models"], ["POST", "/api/methods/status"], ["PUT", "/api/codex/version"], ["DELETE", "/api/models"]] as const)
      expect(checkAgentCapability(all, method, url), `${method} ${url}`).toEqual({ ok: false, status: 403, reason: "cookie-only" });
  });

  it("shape() katalog membaca balasan nyata server", async () => {
    await seed(null);
    const h = await bearer([]);
    const models = (await app.inject({ method: "GET", url: "/api/models", headers: h })).json();
    const slim = byName("hanoman_models").shape(models, { agent: "codex" }) as Record<string, unknown>;
    expect(Object.keys(slim).sort()).toEqual(["codex", "providers"]);
    const codex = (await app.inject({ method: "GET", url: "/api/codex/version", headers: h })).json();
    expect(codex).toMatchObject({ minRequired: expect.any(String), ok: expect.any(Boolean) });
    const methods = (await app.inject({ method: "GET", url: "/api/methods/status", headers: h })).json();
    expect(Array.isArray(methods.agents) && Array.isArray(methods.methods)).toBe(true);
  });
});

describe("log aktivitas: activity:read / activity:write (ADR-0188)", () => {
  const rows = async () => prisma.sessionResult.createMany({ data: [
    { id: "r1", projectId: "p1", status: "done", createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "r2", projectId: "p1", status: "done", createdAt: new Date("2026-07-14T00:00:00Z") },
    { id: "r3", projectId: "p2", status: "done", createdAt: new Date("2026-07-14T00:00:00Z") },
  ] });

  it("TIDAK diwarisi capability lama: token berisi semuanya kecuali activity:* → 403 menyebut capability-nya", async () => {
    await seed(null); await rows();
    const h = await bearer([...LEGACY]);
    const r = await app.inject({ method: "GET", url: "/api/session-results", headers: h });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "activity:read" });
    const d = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1", headers: h });
    expect(d.statusCode).toBe(403);
    expect(d.json()).toMatchObject({ need: "activity:write" });
    expect(await prisma.sessionResult.count()).toBe(3);
  });

  it("activity:read membaca tapi tak bisa purge; baris tak berkurang", async () => {
    await seed(null); await rows();
    const h = await bearer(["activity:read"]);
    const list = await app.inject({ method: "GET", url: "/api/session-results?projectId=p1", headers: h });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2);
    const d = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1", headers: h });
    expect(d.statusCode).toBe(403);
    expect(await prisma.sessionResult.count()).toBe(3);
  });

  it("activity:write meng-implikasikan baca dan purge ber-scope; tanpa scope → 400 dan tak ada yang hilang", async () => {
    await seed(null); await rows();
    const h = await bearer(["activity:write"]);
    expect((await app.inject({ method: "DELETE", url: "/api/session-results", headers: h })).statusCode).toBe(400);
    expect(await prisma.sessionResult.count()).toBe(3);
    const d = await app.inject({ method: "DELETE", url: "/api/session-results?projectId=p1&before=2026-06-01T00:00:00Z", headers: h });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toEqual({ purged: 1 });
    expect((await app.inject({ method: "GET", url: "/api/session-results", headers: h })).json()).toHaveLength(2);
  });

  it("request yang dirakit build() katalog diterima server apa adanya", async () => {
    await seed(null); await rows();
    const h = await bearer(["activity:write"]);
    const req = byName("hanoman_activity_purge").build({ project: "p1", before: "2026-06-01T00:00:00Z" })!;
    const qs = new URLSearchParams(req.query).toString();
    const r = await app.inject({ method: req.method, url: `/api${req.path}?${qs}`, headers: h });
    expect(r.json()).toEqual({ purged: 1 });
    const lreq = byName("hanoman_activity_list").build({ project: "p1" })!;
    const l = await app.inject({ method: "GET", url: `/api${lreq.path}?${new URLSearchParams(lreq.query).toString()}`, headers: h });
    const shaped = byName("hanoman_activity_list").shape(l.json(), { project: "p1" }) as { items: { id: string }[]; hasMore: boolean };
    expect(shaped.items.map((x) => x.id)).toEqual(["r2"]);
    expect(shaped.hasMore).toBe(false);
  });
});

describe("chat portal operator: portal-chat:read / portal-chat:write (ADR-0189)", () => {
  it("TIDAK diwarisi capability lama — semua cabang 403 menyebut capability yang kurang", async () => {
    const sid = await seed(repo());
    const h = await bearer([...LEGACY]);
    for (const url of ["/api/portal-chat/sessions?project=p1", `/api/portal-chat/sessions/${sid}`, "/api/portal-chat/export?project=p1"]) {
      const r = await app.inject({ method: "GET", url, headers: h });
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).toMatchObject({ need: "portal-chat:read" });
    }
    const w = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`, headers: h, payload: { slug: "x" } });
    expect(w.statusCode).toBe(403);
    expect(w.json()).toMatchObject({ need: "portal-chat:write" });
  });

  it("portal-chat:read membaca daftar/detail/ekspor dan shape() katalog memadatkan balasan NYATA", async () => {
    const sid = await seed(null);
    const h = await bearer(["portal-chat:read"]);
    const list = await app.inject({ method: "GET", url: "/api/portal-chat/sessions?project=p1&limit=20", headers: h });
    expect(list.statusCode).toBe(200);
    const shapedList = byName("hanoman_portal_admin_chat_sessions").shape(list.json(), {}) as { items: Record<string, unknown>[]; kuota: unknown };
    expect(shapedList.items[0]).toMatchObject({ id: sid, clientEmail: "klien@x.co", prdSiap: true });
    expect(shapedList.kuota).toBeDefined();

    const det = await app.inject({ method: "GET", url: `/api/portal-chat/sessions/${sid}`, headers: h });
    const shapedDet = byName("hanoman_portal_admin_chat_session_get").shape(det.json(), {}) as { items: { seq: number; rawText?: string }[]; total: number };
    expect(shapedDet.items.map((m) => m.seq)).toEqual([1, 2]);
    expect(shapedDet.items[1]!.rawText).toBe("mentah");   // baris tertolak menyertakan teks mentah

    const exp = await app.inject({ method: "GET", url: "/api/portal-chat/export?project=p1", headers: h });
    expect(exp.statusCode).toBe(200);
    // Persis yang dilakukan klien MCP: coba JSON.parse, jatuh ke teks bila gagal. Satu sesi → OBJEK.
    let body: unknown = exp.body;
    try { body = JSON.parse(exp.body); } catch { /* tetap teks */ }
    const shapedExp = byName("hanoman_portal_admin_chat_export").shape(body, {}) as { items: { id: string; messageCount: number; messages: Record<string, unknown>[] }[]; total: number };
    expect(shapedExp.total).toBe(1);
    expect(shapedExp.items[0]).toMatchObject({ id: sid, messageCount: 2 });
    expect(shapedExp.items[0]!.messages.every((m) => !("rawText" in m))).toBe(true);
  });

  it("ekspor dengan tanggal cacat → 400 (dulu 500), bukan galat server", async () => {
    await seed(null);
    const h = await bearer(["portal-chat:read"]);
    for (const q of ["from=bukan-tanggal", "to=bukan-tanggal"]) {
      const r = await app.inject({ method: "GET", url: `/api/portal-chat/export?project=p1&${q}`, headers: h });
      expect(r.statusCode, q).toBe(400);
    }
    const ok = await app.inject({ method: "GET", url: "/api/portal-chat/export?project=p1&from=2020-01-01&to=2020-01-02", headers: h });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("");
  });

  it("portal-chat:read tak bisa menulis PRD — dan berkas tak muncul", async () => {
    const dir = repo();
    const sid = await seed(dir);
    const r = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`,
      headers: await bearer(["portal-chat:read"]), payload: { slug: "program-loyalitas" } });
    expect(r.statusCode).toBe(403);
    expect(existsSync(join(dir, "docs/prd/program-loyalitas.md"))).toBe(false);
  });

  it("portal-chat:write menulis PRD ke checkout, slug traversal ditolak, dan tak membuat backlog", async () => {
    const dir = repo();
    const sid = await seed(dir);
    const h = await bearer(["portal-chat:write"]);
    const req = byName("hanoman_portal_admin_chat_prd_write").build({ session: sid, slug: "program-loyalitas" })!;
    const ok = await app.inject({ method: req.method, url: `/api${req.path}`, headers: h, payload: req.body as object });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toEqual({ path: "docs/prd/program-loyalitas.md" });
    expect(readFileSync(join(dir, "docs/prd/program-loyalitas.md"), "utf8")).toContain("Program loyalitas");
    expect(await prisma.spec.count()).toBe(0);
    for (const slug of ["../../etc/passwd", "A/B", "-x", ""]) {
      const bad = await app.inject({ method: "POST", url: `/api/portal-chat/sessions/${sid}/prd`, headers: h, payload: { slug } });
      expect(bad.statusCode, slug).toBe(400);
    }
  });

  it("akun KLIEN tetap tertutup untuk permukaan operator (gerbang lama tak berubah)", async () => {
    await seed(null);
    const cookie = (await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "klien@x.co", password: "password2" } })).headers["set-cookie"] as string;
    const r = await app.inject({ method: "GET", url: "/api/portal-chat/sessions?project=p1", headers: { cookie: cookie.split(";")[0]! } });
    expect(r.statusCode).toBe(403);
  });
});
