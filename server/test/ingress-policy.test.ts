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

  it("parses only explicit hop or CIDR trust", () => {
    expect(trustProxyFromEnv({ HANOMAN_TRUST_PROXY: "127.0.0.1/32, ::1/128" })).toEqual([
      "127.0.0.1/32", "::1/128",
    ]);
    expect(trustProxyFromEnv({})).toBe(false);
    expect(() => trustProxyFromEnv({ HANOMAN_TRUST_PROXY: "true" })).toThrow(/hop atau CIDR/);
  });
});
