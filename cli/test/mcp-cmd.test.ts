import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { resolveHome } from "@hanoman/runner";
import { route } from "../src/router";

describe("route mcp", () => {
  it("`hanoman mcp` masuk ke perintah mcp", () => {
    expect(route(["mcp"])).toEqual({ cmd: "mcp", args: [] });
  });
  it("flag ikut diteruskan", () => {
    expect(route(["mcp", "--read-only", "--host", "http://x"]))
      .toEqual({ cmd: "mcp", args: ["--read-only", "--host", "http://x"] });
  });
  it("tetap bukan `start` walaupun ada flag", () => {
    expect(route(["mcp", "--host", "http://x"]).cmd).toBe("mcp");
  });
});

describe("perintah mcp", () => {
  it("TIDAK PERNAH menulis ke stdout — stdout milik JSON-RPC", async () => {
    const mod = await import("../src/commands/mcp");
    const stdout = vi.fn();
    const stderr = vi.fn();
    // Konfigurasi kosong: perintah tetap berdiri (gagal-lunak) dan hanya mengeluh ke stderr.
    const code = await mod.default(["--exit-after-boot"], {
      cwd: "/", env: { HANOMAN_HOME: "/tmp/tidak-ada-482" }, stdout, stderr,
    });
    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
    expect(stderr.mock.calls.join(" ")).toContain("HANOMAN_HOST");
  });
});

// SPEC-846 · lokasi home diturunkan `resolveHome()`, tidak DISALIN. Salinan lamanya tak mem-`trim()`,
// jadi `HANOMAN_HOME` berisi spasi — mudah lahir dari `EnvironmentFile` yang ceroboh — membuat
// agent token dicari di direktori yang mustahil dan MCP berjalan tanpa autentikasi sambil hanya
// mengeluh di stderr.
describe("agentTokenPath (SPEC-846)", () => {
  it("mengikuti HANOMAN_HOME", async () => {
    const { agentTokenPath } = await import("../src/commands/mcp");
    expect(agentTokenPath({ HANOMAN_HOME: "/srv/hn" })).toBe("/srv/hn/agent-token");
  });
  it("HANOMAN_HOME berisi spasi jatuh ke default, sejalan resolveHome", async () => {
    const { agentTokenPath } = await import("../src/commands/mcp");
    expect(agentTokenPath({ HANOMAN_HOME: "  " })).toBe(join(resolveHome({}), "agent-token"));
  });
});
