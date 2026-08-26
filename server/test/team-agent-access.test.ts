import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { resetDb, makeProject } from "./factory";

// ADR-0157 · papan Tim lewat agent token, DIUJI SAMPAI KE ROUTE. `agent-capabilities.test.ts`
// hanya menguji fungsi murni `(method, path) → capability`; berkas ini yang membuktikan gerbang di
// `app.ts` benar-benar memakainya — pemetaan yang benar sambil route tetap 403 adalah kegagalan
// yang tak terlihat unit test mana pun.
//
// `HANOMAN_CONTROL_ORIGINS` dibuang eksplisit: gerbang ingress (SPEC-761/ADR-0117) berdiri SEBELUM
// route dinilai, jadi var yang diwarisi shell operator membuat setiap path di sini 404 (terukur
// berulang, lihat tasks-escalate.route.test.ts).
const cleanEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined };
const app = buildApp({ env: cleanEnv });

const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
};

async function tokenWith(capabilities: string[]): Promise<{ headers: { authorization: string }; id: string }> {
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  const { token, view } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { headers: { authorization: `Bearer ${token}` }, id: view.id };
}

beforeEach(async () => {
  await resetDb();
  await prisma.agentToken.deleteMany();
  await makeProject({ id: "p1" });
});

describe("papan Tim lewat agent token", () => {
  it("team:read membaca kartu & anggota, tapi tak bisa menulis", async () => {
    const { headers } = await tokenWith(["team:read"]);
    expect((await app.inject({ method: "GET", url: "/api/tasks", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/members", headers })).statusCode).toBe(200);

    const r = await app.inject({ method: "POST", url: "/api/tasks", headers, payload: { title: "x" } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "team:write" });
  });

  it("team:write membuat kartu dan anggota, dan write mencakup read", async () => {
    const { headers } = await tokenWith(["team:write"]);
    const m = await app.inject({
      method: "POST", url: "/api/members", headers, payload: { name: "Adi", email: "A@x.id" },
    });
    expect(m.statusCode).toBe(201);
    expect(m.json().id).toBe("a@x.id");

    const t = await app.inject({
      method: "POST", url: "/api/tasks", headers,
      payload: { title: "Perbaiki halaman harga", projectId: "p1", memberId: "a@x.id" },
    });
    expect(t.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/api/tasks", headers })).json().total).toBe(1);
    expect((await app.inject({
      method: "DELETE", url: `/api/tasks/${t.json().id}`, headers,
    })).statusCode).toBe(204);
  });

  // Domain terpisah bukan kosmetik: satu centang "Backlog — tulis" tak boleh diam-diam membuka
  // papan orang. Ini sisi yang paling mudah rusak bila cabang barunya kelak digeser.
  it("token backlog/sesi penuh TIDAK menjangkau papan Tim", async () => {
    const { headers } = await tokenWith(["backlog:write", "sessions:write", "projects:write"]);
    for (const url of ["/api/tasks", "/api/members"]) {
      const r = await app.inject({ method: "GET", url, headers });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ need: "team:read" });
    }
  });

  // Eskalasi MELAHIRKAN backlog item — cermin `POST /tickets/:id/accept`, dan seperti di sana
  // capability-nya tetap capability permukaan MASUK. Yang menahan peluncuran sesi bukan gerbang
  // route melainkan `launchPrincipal`: tanpa `sessions:write` Spec-nya lahir TAK disetujui.
  describe("eskalasi kartu", () => {
    const makeTask = () => prisma.task.create({
      data: { id: "t1", title: "Perbaiki halaman harga", status: "doing", priority: "tinggi", projectId: "p1" },
    });

    it("team:write cukup untuk mengeskalasi, dan penulisnya bernama agen", async () => {
      const { headers, id } = await tokenWith(["team:write"]);
      await makeTask();
      const r = await app.inject({ method: "POST", url: "/api/tasks/t1/escalate", headers, payload: {} });
      expect(r.statusCode).toBe(201);
      const spec = await prisma.spec.findUnique({ where: { id: r.json().spec.id } });
      expect(spec!.author).toBe(`Tim · agent:${id}`);
      // Tak memegang `sessions:write` → tak ada yang menyetujui peluncuran. Stempel karangan di
      // sini akan membuat backlog buatan agen bisa langsung dijalankan tanpa satu pun manusia.
      expect(spec!.launchApprovedAt).toBeNull();
      expect(spec!.launchApprovedBy).toBeNull();
    });

    it("token ber-sessions:write ikut menyetujui peluncuran", async () => {
      const { headers, id } = await tokenWith(["team:write", "sessions:write"]);
      await makeTask();
      const r = await app.inject({ method: "POST", url: "/api/tasks/t1/escalate", headers, payload: {} });
      const spec = await prisma.spec.findUnique({ where: { id: r.json().spec.id } });
      expect(spec!.launchApprovedBy).toBe(`agent:${id}`);
      expect(spec!.launchApprovedAt).not.toBeNull();
    });

    it("backlog:write TIDAK membuka eskalasi — pintunya milik domain team", async () => {
      const { headers } = await tokenWith(["backlog:write"]);
      await makeTask();
      const r = await app.inject({ method: "POST", url: "/api/tasks/t1/escalate", headers, payload: {} });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toMatchObject({ need: "team:write" });
    });
  });
});

// ADR-0157 · route `GLOBAL_READ` kini punya tool MCP. Yang diuji: keterjangkauannya memang TIDAK
// bergantung capability apa pun (kalau ternyata bergantung, tool bercapability null akan menjawab
// 403 di lapangan), dan `POST /update/apply` tetap tertutup meski prefiksnya sama (SPEC-405).
describe("route GLOBAL_READ terjangkau tanpa capability", () => {
  it("token TANPA satu pun capability tetap membaca limits, update, dan fs/browse", async () => {
    const { headers } = await tokenWith([]);
    for (const url of ["/api/limits", "/api/limits/codex", "/api/update", "/api/fs/browse"])
      expect((await app.inject({ method: "GET", url, headers })).statusCode, url).toBe(200);
  });

  it("POST /update/apply tetap 403 — prefix yang sama tak menurunkan gerbangnya", async () => {
    const { headers } = await tokenWith(["settings:write", "sessions:spawn"]);
    const r = await app.inject({ method: "POST", url: "/api/update/apply", headers, payload: {} });
    expect(r.statusCode).toBe(403);
  });
});
