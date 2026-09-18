import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { approveLaunch, assertLaunchApproved, launchPrincipal } from "../src/services/launch-authority";
import { __FIELDS } from "../src/services/sync";

beforeEach(async () => {
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "p", name: "p", desc: "", kind: "existing" } });
});
afterAll(async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); });

const createSpec = () => prisma.spec.create({ data: {
  id: "SPEC-AUTH", projectId: "p", title: "x", source: "brief", stage: "planned",
  priority: "sedang", author: "agent", objective: "",
} });

describe("effective launch authority", () => {
  it("rejects an unapproved row and accepts it after a sessions principal approves", async () => {
    const spec = await createSpec();
    expect(() => assertLaunchApproved(spec)).toThrow(/belum disetujui/);
    await approveLaunch(spec.id, "agent:session-writer");
    const approved = await prisma.spec.findUnique({ where: { id: spec.id } });
    expect(() => assertLaunchApproved(approved!)).not.toThrow();
  });

  it("does not derive authority from settings/projects/backlog capabilities", () => {
    expect(launchPrincipal({ agent: { id: "a", capabilities: ["settings:write", "projects:write", "backlog:write"] } })).toBeNull();
    expect(launchPrincipal({ agent: { id: "a", capabilities: ["sessions:write"] } })).toBe("agent:a");
    expect(launchPrincipal({ user: { id: "u", email: "admin@example.test" } })).toBe("user:admin@example.test");
  });

  it("keeps launch approval local and outside record sync", () => {
    expect(__FIELDS.spec).not.toContain("launchApprovedAt");
    expect(__FIELDS.spec).not.toContain("launchApprovedBy");
  });
});

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
