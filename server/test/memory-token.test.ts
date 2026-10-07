import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken, patchAgentToken, verifyAgentToken } from "../src/services/agent-token";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const app = buildApp();
const clean = async () => { await prisma.agentToken.deleteMany(); };
beforeEach(clean);
afterAll(clean);

describe("agent token · allowlist project (ADR-0178)", () => {
  it("projectIds tersimpan, terbaca di view dan di verifikasi", async () => {
    const { view, token } = await issueAgentToken({ name: "b", capabilities: ["memory:read"], projectIds: ["p1"] });
    expect(view.projectIds).toEqual(["p1"]);
    expect((await verifyAgentToken(token))?.projectIds).toEqual(["p1"]);
  });

  it("token lama tanpa projectIds → null, bukan []", async () => {
    const { view, token } = await issueAgentToken({ name: "b", capabilities: [] });
    expect(view.projectIds).toBeNull();
    expect((await verifyAgentToken(token))?.projectIds).toBeNull();
  });

  it("patch mengganti allowlist", async () => {
    const { view } = await issueAgentToken({ name: "b", capabilities: [], projectIds: ["p1"] });
    expect((await patchAgentToken(view.id, { projectIds: ["p2", "p3"] }))?.projectIds).toEqual(["p2", "p3"]);
  });
});

describe("peta capability /api/memories", () => {
  it("baca → memory:read, tulis → memory:write", () => {
    expect(capabilityForRoute("GET", "/api/memories")).toBe("memory:read");
    expect(capabilityForRoute("GET", "/api/memories/abc")).toBe("memory:read");
    expect(capabilityForRoute("POST", "/api/memories")).toBe("memory:write");
    expect(capabilityForRoute("POST", "/api/memories/abc/invalidate")).toBe("memory:write");
  });

  it("review manusia cookie-only", () => {
    expect(capabilityForRoute("POST", "/api/memories/abc/activate")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/memories/abc/reject")).toBe("COOKIE_ONLY");
  });
});
