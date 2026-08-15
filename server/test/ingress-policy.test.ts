import { describe, expect, it } from "vitest";
import { classifyIngress, loadIngressPolicy, trustProxyFromEnv } from "../src/services/ingress-policy";

const req = (host: string, method: string, url: string) => ({ host, method, url });

describe("ingress policy", () => {
  const policy = loadIngressPolicy({
    HANOMAN_PUBLIC_ORIGINS: "https://help.example",
    HANOMAN_CONTROL_ORIGINS: "https://admin.example:8443",
  });

  it("exposes only Help and health on the public origin", () => {
    expect(classifyIngress(req("help.example", "POST", "/api/help/p/tickets"), policy)).toBe("public");
    expect(classifyIngress(req("help.example", "GET", "/api/health"), policy)).toBe("public");
    expect(classifyIngress(req("help.example", "GET", "/api/terminal/sessions"), policy)).toBe("denied");
  });

  it("keeps public intake off the control origin and denies unknown hosts", () => {
    expect(classifyIngress(req("admin.example:8443", "POST", "/api/help/p/tickets"), policy)).toBe("denied");
    expect(classifyIngress(req("admin.example:8443", "GET", "/api/terminal/sessions"), policy)).toBe("control");
    expect(classifyIngress(req("unknown.example", "GET", "/api/health"), policy)).toBe("denied");
  });

  it("serves Help on the control origin when no public origin is split off (SPEC-805)", () => {
    const single = loadIngressPolicy({ HANOMAN_CONTROL_ORIGINS: "https://admin.example" });
    expect(single.publicBase).toBe(null);
    expect(classifyIngress(req("admin.example", "GET", "/api/help/p"), single)).toBe("control");
    expect(classifyIngress(req("admin.example", "GET", "/api/terminal/sessions"), single)).toBe("control");
    expect(classifyIngress(req("unknown.example", "GET", "/api/help/p"), single)).toBe("denied");
  });

  it("exposes the first public origin verbatim as the base for share links (SPEC-805)", () => {
    expect(policy.publicBase).toBe("https://help.example");
    expect(loadIngressPolicy({ HANOMAN_PUBLIC_ORIGINS: "http://help.example:8080" }).publicBase)
      .toBe("http://help.example:8080");
  });

  it("parses only explicit hop or CIDR trust", () => {
    expect(trustProxyFromEnv({ HANOMAN_TRUST_PROXY: "127.0.0.1/32, ::1/128" })).toEqual([
      "127.0.0.1/32", "::1/128",
    ]);
    expect(trustProxyFromEnv({})).toBe(false);
    expect(() => trustProxyFromEnv({ HANOMAN_TRUST_PROXY: "true" })).toThrow(/hop atau CIDR/);
  });
});
