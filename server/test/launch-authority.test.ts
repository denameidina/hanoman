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
