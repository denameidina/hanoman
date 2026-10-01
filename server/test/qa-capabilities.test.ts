import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "@hanoman/shared";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capability domain qa", () => {
  it("terdaftar sebagai qa:read dan qa:write", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(ids).toContain("qa:read");
    expect(ids).toContain("qa:write");
  });

  it("route QA dipetakan menurut METHOD (bukan prefix)", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports")).toBe("qa:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/qa/reports")).toBe("qa:write");
    expect(capabilityForRoute("PATCH", "/api/projects/p1/qa/reports/r1/findings/f1")).toBe("qa:write");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1")).toBe("qa:write");
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports/r1/export")).toBe("qa:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/qa/import")).toBe("qa:write");
    expect(capabilityForRoute("GET", "/api/qa/template.xlsx")).toBe("qa:read");
    expect(capabilityForRoute("GET", "/api/qa/template.md")).toBe("qa:read");
  });

  it("tak lagi jatuh ke projects:*", () => {
    expect(capabilityForRoute("GET", "/api/projects/p1")).toBe("projects:read");
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports")).not.toBe("projects:read");
  });

  it("token tanpa qa:* ditolak dengan `need`; qa:write mengimplikasikan qa:read", () => {
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, status: 403, need: "qa:read" });
    expect(checkAgentCapability(["qa:write"], "GET", "/api/projects/p1/qa/reports")).toEqual({ ok: true });
    expect(checkAgentCapability(["qa:read"], "POST", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, need: "qa:write" });
  });
});
