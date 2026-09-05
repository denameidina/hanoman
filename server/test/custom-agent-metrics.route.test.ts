import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const app = buildApp();
const cookieOf = (r: { headers: Record<string, unknown> }) =>
  (r.headers["set-cookie"] as string).split(";")[0]!;

async function login(): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/api/auth/setup",
    payload: { email: "metrics@hanoman.local", password: "password1" },
  });
  return cookieOf(r);
}

const invocation = (overrides: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), sessionId: crypto.randomUUID(), projectId: "p1", specId: "SPEC-1",
  runtime: "claude", runtimeInvocationId: crypto.randomUUID(), customAgentId: "global:scout",
  agentName: "scout", model: "haiku", status: "completed",
  startedAt: new Date("2026-08-20T00:00:00.000Z"), endedAt: new Date("2026-08-20T00:00:01.000Z"),
  durationMs: 1_000, inputTokens: 10, outputTokens: 5, cachedTokens: null,
  disposition: "pending", workspaceChanged: false,
  ...overrides,
});

const clean = async () => {
  await prisma.agentInvocation.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(async () => { await clean(); await app.close(); });

describe("GET /api/custom-agents/metrics", () => {
  it("keeps per-agent reviewed, pending and rework samples beyond the global recent limit", async () => {
    const cookie = await login();
    await prisma.agentInvocation.createMany({ data: [
      ...Array.from({ length: 101 }, () => invocation({ agentName: "busy-agent",
        startedAt: new Date("2026-09-05T00:00:00Z") })),
      invocation({ id: "reviewed", disposition: "accepted", reworkRequired: false }),
      invocation({ id: "rework", disposition: "partial", reworkRequired: true }),
      invocation({ id: "pending" }),
    ] as never[] });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents/metrics", headers: { cookie } });
    expect(r.json().recent).toHaveLength(100);
    expect(r.json().recent.every((row: { agentName: string }) => row.agentName === "busy-agent")).toBe(true);
    const samples = r.json().samples.filter((row: { agentName: string }) => row.agentName === "scout");
    expect(samples.map((row: { id: string }) => row.id).sort()).toEqual(["pending", "reviewed", "rework"]);
  });
  it("reports no observed evidence without claiming no usage or healthy hooks", async () => {
    const cookie = await login();
    const r = await app.inject({ method: "GET", url: "/api/custom-agents/metrics", headers: { cookie } });
    expect(r.json()).toMatchObject({
      agents: [], variants: [], recent: [],
      telemetry: { state: "unobserved", lastEventAt: null, incompleteCount: 0 },
    });
  });

  it("separates runtime, model and executed definition without losing the aggregate", async () => {
    const cookie = await login();
    await prisma.agentInvocation.createMany({ data: [
      invocation({ definitionHash: "a".repeat(64), disposition: "accepted", reworkRequired: false }),
      invocation({ definitionHash: "b".repeat(64), disposition: "partial", reworkRequired: true }),
      invocation({ definitionHash: "a".repeat(64), model: "sonnet" }),
      invocation({ definitionHash: null, runtime: "codex", model: "gpt-5.6-terra" }),
    ] as never[] });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents/metrics", headers: { cookie } });
    const body = r.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ invocationCount: 4, evaluatedCount: 2,
      rework: { required: 1, notRequired: 1, unknown: 2 } });
    expect(body.variants).toHaveLength(4);
    expect(body.variants).toContainEqual(expect.objectContaining({ runtime: "codex", definitionHash: null }));
    expect(body.telemetry).toMatchObject({ state: "observed", lastEventAt: "2026-08-20T00:00:01.000Z" });
  });
  it("mengagregasi median, token tersedia, disposition, precision, dan perubahan workspace", async () => {
    const cookie = await login();
    await prisma.agentInvocation.createMany({ data: [
      invocation({ id: "a", runtimeInvocationId: "a", durationMs: 100, disposition: "accepted" }),
      invocation({ id: "b", runtimeInvocationId: "b", durationMs: 300, inputTokens: null,
        outputTokens: null, disposition: "partial", workspaceChanged: true }),
      invocation({ id: "c", runtimeInvocationId: "c", durationMs: 200,
        disposition: "false-positive" }),
      invocation({ id: "d", runtimeInvocationId: "d", projectId: "p2", disposition: "rejected" }),
    ] as never[] });
    const r = await app.inject({
      method: "GET", url: "/api/custom-agents/metrics?projectId=p1", headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.agents).toEqual([expect.objectContaining({
      agentName: "scout", invocationCount: 3, medianDurationMs: 200,
      inputTokens: 20, outputTokens: 10, cachedTokens: null,
      dispositions: { pending: 0, accepted: 1, partial: 1, rejected: 0, falsePositive: 1 },
      operationalPrecision: 2 / 3, workspaceChanged: true,
    })]);
    expect(body.recent).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("transcriptPath");
  });

  it("memakai filter tanggal dan membatasi recent ke 100", async () => {
    const cookie = await login();
    await prisma.agentInvocation.createMany({ data: Array.from({ length: 105 }, (_, i) => invocation({
      id: `row-${i}`, sessionId: `s-${i}`, runtimeInvocationId: `r-${i}`,
      startedAt: new Date(Date.UTC(2026, 7, 1, 0, 0, i)),
    })) as never[] });
    const r = await app.inject({
      method: "GET",
      url: "/api/custom-agents/metrics?from=2026-08-01T00:00:10.000Z&to=2026-08-02T00:00:00.000Z",
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().agents[0].invocationCount).toBe(95);
    expect(r.json().recent).toHaveLength(95);

    const all = await app.inject({ method: "GET", url: "/api/custom-agents/metrics", headers: { cookie } });
    expect(all.json().recent).toHaveLength(100);
  });

  it("cookie-only dan menolak tanggal tidak sah", async () => {
    expect((await app.inject({ method: "GET", url: "/api/custom-agents/metrics" })).statusCode).toBe(401);
    expect(capabilityForRoute("GET", "/api/custom-agents/metrics")).toBe("COOKIE_ONLY");
    const cookie = await login();
    expect((await app.inject({
      method: "GET", url: "/api/custom-agents/metrics?from=kemarin", headers: { cookie },
    })).statusCode).toBe(400);
  });
});

describe("PATCH /api/custom-agents/invocations/:id", () => {
  it("stores optional tri-state parent rework and preserves it when omitted", async () => {
    const cookie = await login();
    await prisma.agentInvocation.create({ data: invocation({ id: "rework" }) as never });
    const patch = (payload: Record<string, unknown>) => app.inject({ method: "PATCH",
      url: "/api/custom-agents/invocations/rework", headers: { cookie }, payload });
    for (const reworkRequired of [true, false, null]) {
      const r = await patch({ disposition: "accepted", reworkRequired });
      expect(r.statusCode).toBe(200);
      expect(r.json().reworkRequired).toBe(reworkRequired);
    }
    await patch({ disposition: "partial", reworkRequired: true });
    expect((await patch({ disposition: "accepted" })).json().reworkRequired).toBe(true);
    expect((await patch({ disposition: "accepted", reworkRequired: "yes" })).statusCode).toBe(400);
  });
  it("menilai invocation dan mengembalikan view tanpa path internal", async () => {
    const cookie = await login();
    await prisma.agentInvocation.create({ data: invocation({ id: "judge", runtimeInvocationId: "judge" }) as never });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/invocations/judge", headers: { cookie },
      payload: { disposition: "accepted", note: "dipakai di patch" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      id: "judge", disposition: "accepted", dispositionNote: "dipakai di patch",
      evaluatedAt: expect.any(String),
    });
    expect(JSON.stringify(r.json())).not.toContain("cwd");
  });

  it("memvalidasi disposition, note 500 karakter, id, dan akses agent token", async () => {
    const cookie = await login();
    await prisma.agentInvocation.create({ data: invocation({ id: "judge", runtimeInvocationId: "judge" }) as never });
    for (const payload of [
      { disposition: "pending" },
      { disposition: "accepted", note: "x".repeat(501) },
    ]) {
      expect((await app.inject({
        method: "PATCH", url: "/api/custom-agents/invocations/judge", headers: { cookie }, payload,
      })).statusCode).toBe(400);
    }
    expect((await app.inject({
      method: "PATCH", url: "/api/custom-agents/invocations/missing", headers: { cookie },
      payload: { disposition: "rejected" },
    })).statusCode).toBe(404);
    expect(capabilityForRoute("PATCH", "/api/custom-agents/invocations/judge")).toBe("COOKIE_ONLY");
  });
});
