import { describe, it, expect } from "vitest";
import { planUpdate, INSTALL_ARGS, PKG } from "../src/commands/update";

describe("planUpdate", () => {
  it("registry tak terjangkau → unknown (jangan memasang buta)", () => {
    expect(planUpdate("0.1.0", null).action).toBe("unknown");
  });
  it("lebih baru tersedia → install", () => {
    expect(planUpdate("0.1.0", "0.2.0")).toEqual({ action: "install", current: "0.1.0", latest: "0.2.0" });
  });
  it("sama → up-to-date", () => {
    expect(planUpdate("0.2.0", "0.2.0").action).toBe("up-to-date");
  });
  it("registry lebih tua → up-to-date, jangan pernah turun versi", () => {
    expect(planUpdate("0.3.0", "0.2.0").action).toBe("up-to-date");
  });
  it("checkout dev (0.0.0) vs rilis → install", () => {
    expect(planUpdate("0.0.0", "0.1.0").action).toBe("install");
  });
  it("perintah pemasangan global & bernama tepat", () => {
    expect(INSTALL_ARGS.join(" ")).toBe(`i -g ${PKG}@latest --prefer-online`);
    expect(PKG).toBe("hanoman");
  });
});
