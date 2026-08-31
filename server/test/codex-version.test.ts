import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseCodexVersion, probeCodexVersion, cmpVersion, codexVersionInfo,
  _resetCodexVersionCache, CODEX_MIN_CLIENT,
} from "../src/services/codex-version";
import { buildApp } from "../src/app";

beforeEach(() => { _resetCodexVersionCache(); });
afterEach(() => {
  delete process.env.HANOMAN_CODEX_BIN;
  delete process.env.HANOMAN_SESSION_SANDBOX;
  delete process.env.HANOMAN_SESSION_IMAGE;
  delete process.env.HANOMAN_PODMAN_BIN;
});

describe("SPEC-339 · deteksi versi codex", () => {
  it("memparse keluaran `codex --version`", () => {
    expect(parseCodexVersion("codex-cli 0.145.0\n")).toBe("0.145.0");
    expect(parseCodexVersion("codex-cli 0.142.5")).toBe("0.142.5");
    expect(parseCodexVersion("bukan versi apa pun")).toBeNull();
  });

  // localeCompare akan bilang "0.9.0" > "0.144.0" — perbandingan WAJIB numerik per segmen.
  it("membandingkan versi secara numerik per segmen", () => {
    expect(cmpVersion("0.142.5", "0.144.0")).toBeLessThan(0);
    expect(cmpVersion("0.145.0", "0.144.0")).toBeGreaterThan(0);
    expect(cmpVersion("0.144.0", "0.144.0")).toBe(0);
    expect(cmpVersion("0.9.0", "0.144.0")).toBeLessThan(0);
  });

  it("keluaran tanpa angka versi → null, dan null TIDAK dianggap gagal", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";   // mencetak argumennya: "--version"
    const info = await codexVersionInfo();
    expect(info.minRequired).toBe(CODEX_MIN_CLIENT);
    expect(info.version).toBeNull();
    expect(info.ok).toBe(true);
  });

  it("biner tak ada → version null, ok true (ketiadaan bukti bukan bukti ketiadaan)", async () => {
    process.env.HANOMAN_CODEX_BIN = "/tak/ada/codex-339";
    const info = await codexVersionInfo();
    expect(info.version).toBeNull();
    expect(info.ok).toBe(true);
  });

  it("versi native dibaca dari image sandbox, bukan executable host", async () => {
    process.env.HANOMAN_CODEX_BIN = "codex";
    process.env.HANOMAN_SESSION_SANDBOX = "podman";
    process.env.HANOMAN_SESSION_IMAGE = "hanoman-agent:test";
    process.env.HANOMAN_PODMAN_BIN = "/opt/podman-custom";
    const calls: Array<{ bin: string; args: string[] }> = [];
    const version = await probeCodexVersion(process.env, async (bin, args) => {
      calls.push({ bin, args });
      return { stdout: "codex-cli 0.151.0\n" };
    });
    expect(version).toBe("0.151.0");
    expect(calls[0]).toMatchObject({ bin: "/opt/podman-custom" });
    expect(calls[0]!.args).toContain("hanoman-agent:test");
  });

  it("GET /api/codex/version mengembalikan bentuk kontraknya", async () => {
    process.env.HANOMAN_CODEX_BIN = "/tak/ada/codex-339";
    const app = buildApp({ requireAuth: false });
    const res = await app.inject({ method: "GET", url: "/api/codex/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: null, minRequired: "0.144.0", ok: true });
    await app.close();
  });
});
