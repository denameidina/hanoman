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
    // ADR-0183 · DELETE pindah ke capability danger `qa:delete` (tak diimplikasikan qa:write).
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1")).toBe("qa:delete");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1/cases/c1")).toBe("qa:delete");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1/findings/f1")).toBe("qa:delete");
    expect(capabilityForRoute("DELETE", "/api/projects/p1/qa/reports/r1/attachments/a1")).toBe("qa:delete");
    expect(capabilityForRoute("GET", "/api/projects/p1/qa/reports/r1/export")).toBe("qa:read");
    expect(capabilityForRoute("POST", "/api/projects/p1/qa/import")).toBe("qa:write");
    expect(capabilityForRoute("GET", "/api/qa/template.xlsx")).toBe("qa:read");
    expect(capabilityForRoute("GET", "/api/qa/template.md")).toBe("qa:read");
  });

  it("qa:delete terdaftar sebagai akses danger, dan qa:write TIDAK mewarisinya (ADR-0183)", () => {
    expect(CAPABILITIES.find((c) => c.id === "qa:delete")).toMatchObject({ domain: "qa", access: "danger" });
    expect(checkAgentCapability(["qa:write"], "DELETE", "/api/projects/p1/qa/reports/r1"))
      .toMatchObject({ ok: false, status: 403, need: "qa:delete" });
    expect(checkAgentCapability(["qa:read", "qa:write"], "DELETE", "/api/projects/p1/qa/reports/r1/attachments/a1"))
      .toMatchObject({ ok: false, need: "qa:delete" });
    expect(checkAgentCapability(["qa:delete"], "DELETE", "/api/projects/p1/qa/reports/r1")).toEqual({ ok: true });
    // qa:delete tidak mengimplikasikan baca maupun tulis.
    expect(checkAgentCapability(["qa:delete"], "GET", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, need: "qa:read" });
    expect(checkAgentCapability(["qa:delete"], "POST", "/api/projects/p1/qa/reports"))
      .toMatchObject({ ok: false, need: "qa:write" });
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
