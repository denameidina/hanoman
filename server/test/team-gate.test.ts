import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import { resetDb } from "./factory";

// SPEC-945 · ADR-0150, DIAMANDEMEN ADR-0157 · papan tim kini punya domain capability sendiri
// (`team`). Yang diuji di sini bukan lagi "tertutup", melainkan bahwa penolakannya lahir dari
// DOMAIN YANG SALAH, bukan dari route yang tak ada: token bermodal seluruh capability LAIN tetap
// 403 — dan 403-nya menyebut `need: team:*`, bukan `cookie-only`.
//
// Bedanya tak bisa diuji dengan satu request saja: `403` sendirian juga muncul di pohon yang BELUM
// punya route ini sama sekali, karena gerbangnya berjalan sebagai hook SEBELUM routing. Jadi tiap
// path diperiksa BERPASANGAN — sesi cookie menjangkaunya (bukan 404), agent token bercapability
// lain tetap ditolak. Jalur POSITIF (`team:read`/`team:write` benar-benar membuka) hidup di
// `team-agent-access.test.ts`.

const gated = buildApp();                          // gerbang auth hidup
const open = buildApp({ requireAuth: false });     // setara sesi cookie

const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
};
const clean = async () => {
  await prisma.agentToken.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await resetDb();
};
beforeEach(async () => {
  await clean();
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
});
afterAll(clean);

const READS = ["/api/members", "/api/tasks"];

// Anotasi tipe wajib: `inject` punya overload void/Promise/Chain, dan tanpa ini pemanggil melihat
// union yang tak punya `.json()` maupun `.statusCode`. `light-my-request` juga memakai daftar
// method yang lebih sempit daripada `HTTPMethods` milik Fastify, jadi keempat yang dipakai di sini
// disebut apa adanya.
type Method = "GET" | "POST" | "PATCH" | "DELETE";
const call = (
  app: FastifyInstance, method: Method, url: string, headers?: Record<string, string>,
): Promise<LightMyRequestResponse> => app.inject({ method, url, headers, payload: {} });

describe("SPEC-945 · ADR-0157 · papan tim: ada untuk manusia, digerbangi domain `team`", () => {
  it("sesi cookie MENJANGKAU kedua daftar — bukan 404", async () => {
    for (const url of READS) {
      const r = await open.inject({ method: "GET", url });
      expect(r.statusCode, url).toBe(200);
      // Amplop `Paginated` (ADR-0107), bukan badan 404 Fastify yang kebetulan ber-JSON.
      expect(r.json(), url).toMatchObject({ items: [], total: 0, page: 1 });
    }
  });

  it("agent token bermodal SELURUH capability lain tetap 403 — dan 403-nya menyebut `team`", async () => {
    const { token } = await issueAgentToken({ name: "bot", capabilities: [
      "projects:write", "backlog:write", "support:write", "settings:write", "agents:write",
    ] });
    const h = { authorization: `Bearer ${token}` };
    // Pasangan method↔path yang BENAR-BENAR ada. `PATCH /api/members` (tanpa `:id`) menjawab 404
    // dari router, bukan 403 dari gerbang — dan 404 itu tak membuktikan apa pun soal otorisasi.
    const calls: [Method, string][] = [
      ["GET", "/api/members"], ["POST", "/api/members"],
      ["PATCH", "/api/members/a@x.id"], ["DELETE", "/api/members/a@x.id"],
      ["GET", "/api/tasks"], ["POST", "/api/tasks"],
      ["PATCH", "/api/tasks/t1"], ["DELETE", "/api/tasks/t1"],
    ];
    for (const [method, url] of calls) {
      const r = await call(gated, method, url, h);
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      // ADR-0157 · `need` KINI ada, dan itu perbaikan yang disengaja: 403 tanpa nama capability
      // meninggalkan agen tanpa kalimat yang bisa disampaikan ke manusia (ADR-0065 §"baca 403
      // sebagai instruksi"). Domainnya `team`, bukan `backlog` — token di atas memegang
      // `backlog:write` dan tetap ditolak, dan itulah bukti pemisahan domainnya nyata.
      expect(r.json().need, `${method} ${url}`).toBe(method === "GET" ? "team:read" : "team:write");
    }
  });

  it("tanpa kredensial apa pun → 401, bukan diam-diam terbuka", async () => {
    for (const url of READS)
      expect((await gated.inject({ method: "GET", url })).statusCode, url).toBe(401);
  });
});
