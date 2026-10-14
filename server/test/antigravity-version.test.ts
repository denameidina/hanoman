import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAntigravityVersion, probeAntigravityVersion, createAntigravityVersionService } from "../src/services/antigravity-version";

const dirs: string[] = [];
const executable = (body: string) => {
  const dir = mkdtempSync(join(tmpdir(), "antigravity-version-")); dirs.push(dir);
  const file = join(dir, "agy");
  writeFileSync(file, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return file;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("Antigravity version observation", () => {
  it("accepts only a complete semver, never extracts version-shaped data from diagnostics", () => {
    expect(parseAntigravityVersion("1.3.4\n")).toBe("1.3.4");
    expect(parseAntigravityVersion("1.3.4-rc.1+build.2\n")).toBe("1.3.4-rc.1+build.2");
    for (const text of ["", "agy 1.3.4", "01.3.4", "1.3.4.5", "1.3.4-01", "secret=/home/me/token 1.3.4", "1.3.4\nsecret"]) {
      expect(parseAntigravityVersion(text), text).toBeNull();
    }
  });
  it("probes only --version with the Antigravity environment", async () => {
    const bin = executable('if (JSON.stringify(process.argv.slice(2)) !== \'["--version"]\' || process.env.GEMINI_API_KEY !== "version-test" || process.env.GOOGLE_GEMINI_BASE_URL !== "https://version.invalid") process.exit(2); console.log("1.3.4");');
    const info = await probeAntigravityVersion(bin, { PATH: process.env.PATH, GEMINI_API_KEY: "version-test", GOOGLE_GEMINI_BASE_URL: "https://version.invalid" });
    expect(info).toEqual({ version: "1.3.4", error: null });
  });
  it("missing binary and malformed or failing output become safe DTOs", async () => {
    const missing = await probeAntigravityVersion("/private/home/token/no-agy", {});
    expect(missing).toMatchObject({ version: null, error: expect.any(String) });
    const malformed = await probeAntigravityVersion(executable('console.log("/private/home/token");'), {});
    const failed = await probeAntigravityVersion(executable('console.error("/private/home/token"); process.exit(1);'), {});
    expect(missing.error).toMatch(/ditemukan/);
    expect(malformed.error).toMatch(/dikenali/);
    expect(failed.error).toMatch(/diperiksa/);
    for (const info of [missing, malformed, failed]) {
      expect(info.version).toBeNull(); expect(info.error).toBeTruthy();
      expect(JSON.stringify(info)).not.toMatch(/private|home|token/);
    }
  });
  it("caps both stdout and stderr without reflecting either", async () => {
    for (const stream of ["stdout", "stderr"]) {
      const info = await probeAntigravityVersion(executable(`process.${stream}.write("SECRET".repeat(12000));`), {});
      expect(info.version).toBeNull(); expect(info.error).toMatch(/ukuran/);
      expect(info.error).not.toContain("SECRET");
    }
  });
  it("times out a stuck --version after 10 seconds", async () => {
    const start = Date.now();
    const info = await probeAntigravityVersion(executable('setInterval(() => {}, 1000);'), {});
    expect(info).toMatchObject({ version: null, error: expect.any(String) });
    expect(info.error).toMatch(/waktu/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9900);
    expect(Date.now() - start).toBeLessThan(13000);
  }, 15000);
  it.each([{ HANOMAN_SESSION_SANDBOX: "podman" }, { HANOMAN_HARDENING: "1" }])("never runs a host probe across boundary %j", async (env) => {
    const markerDir = mkdtempSync(join(tmpdir(), "antigravity-boundary-")); dirs.push(markerDir);
    const marker = join(markerDir, "ran");
    const bin = executable(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"); console.log("1.3.4");`);
    const result = await probeAntigravityVersion(bin, env);
    expect(result).toMatchObject({ version: null, error: expect.stringMatching(/sandbox/) });
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
  });
});

describe("Antigravity version cache", () => {
  it("coalesces concurrent reads and caches successes and safe failures for five minutes", async () => {
    let now = 0, calls = 0;
    const service = createAntigravityVersionService({ key: () => "host-agy", now: () => now,
      probe: async () => { calls++; return calls === 1 ? { version: "1.3.4", error: null } : { version: null, error: "Tidak tersedia" }; },
    });
    expect(await Promise.all([service(), service()])).toEqual([{ version: "1.3.4", error: null }, { version: "1.3.4", error: null }]);
    now = 299999; expect((await service()).version).toBe("1.3.4"); expect(calls).toBe(1);
    now = 300000; expect((await service()).error).toBeTruthy(); expect(calls).toBe(2);
    now = 599999; await service(); expect(calls).toBe(2);
  });
  it.each([true, false])("discards stale %s results and does not clear the new in-flight request", async (success) => {
    let key = "old-host", calls = 0;
    let finishOld!: (v: { version: string | null; error: string | null }) => void;
    let finishNew!: (v: { version: string | null; error: string | null }) => void;
    const service = createAntigravityVersionService({ key: () => key, now: () => 1,
      probe: () => { calls++; return new Promise((resolve) => { if (calls === 1) finishOld = resolve; else finishNew = resolve; }); },
    });
    const old = service(); key = "new-host"; const current = service();
    finishOld(success ? { version: "1.0.0", error: null } : { version: null, error: "Old error" });
    expect((await old).version).toBeNull();
    const same = service(); expect(calls).toBe(2);
    finishNew({ version: "1.3.4", error: null });
    expect(await current).toEqual({ version: "1.3.4", error: null });
    expect(await same).toEqual({ version: "1.3.4", error: null });
    expect(await service()).toEqual({ version: "1.3.4", error: null }); expect(calls).toBe(2);
  });
  it("checks a changed key on completion even before the next reader arrives", async () => {
    let key = "host", finish!: (v: { version: string | null; error: string | null }) => void;
    const service = createAntigravityVersionService({ key: () => key, probe: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = service(); key = "sandbox"; finish({ version: "1.3.4", error: null });
    expect((await pending).version).toBeNull();
  });
});
