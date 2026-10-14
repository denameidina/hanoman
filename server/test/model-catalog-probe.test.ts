import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { clearConfig, setConfig } from "../src/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { catalogCommand, runCatalogCommand, probeModelCatalog, catalogProbeKey } from "../src/services/model-catalog-probe";

describe("catalog transport", () => {
  it("sends only initialize and accepts matching control response without inference", async () => {
    const script = `process.stdin.once("data", b => {
      const request = JSON.parse(b);
      if (request.type !== "control_request" || request.request.subtype !== "initialize") process.exit(2);
      process.stdout.write(JSON.stringify({type:"control_response",response:{
        request_id:request.request_id,subtype:"success",response:{models:[{value:"future"}]}
      }})+"\\n");
    });`;
    expect(await runCatalogCommand({ bin: process.execPath, args: ["-e", script] }, "claude", tmpdir(), {}))
      .toEqual([{ value: "future" }]);
  });
  it("terminates a hung child and rejects broken JSON", async () => {
    await expect(runCatalogCommand({ bin: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      "codex", tmpdir(), {}, 50)).rejects.toThrow("batas waktu");
    await expect(runCatalogCommand({ bin: process.execPath, args: ["-e", "console.log('broken')"] },
      "codex", tmpdir(), {})).rejects.toThrow("JSON");
  });
  it("uses configured binary and the same Podman credentials/proxy boundary as sessions", () => {
    const command = catalogCommand("claude", "/tmp/probe", {
      HANOMAN_CLAUDE_BIN: "/opt/claude", HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_PODMAN_BIN: "/opt/podman", HANOMAN_AGENT_CREDENTIAL_DIR: "/credentials",
      HANOMAN_EGRESS_PROXY: "http://proxy:8080",
    });
    expect(command.bin).toBe("/opt/podman");
    expect(command.args).toContain("-i");
    expect(command.args).toContain("/credentials:/agent-home:ro");
    expect(command.args.at(-1)).toContain("'/opt/claude'");
    expect(command.args.at(-1)).toContain("disableAllHooks");
    expect(() => catalogCommand("codex", "/tmp", { HANOMAN_SESSION_SANDBOX: "required" })).toThrow();
  });
});

afterEach(() => vi.unstubAllEnvs());
describe("Antigravity catalog transport", () => {
  it("uses a models argv and keeps stdout as bounded text, never inference", async () => {
    expect(catalogCommand("antigravity", "/tmp", { HANOMAN_ANTIGRAVITY_BIN: "/opt/agy" }))
      .toEqual({ bin: "/opt/agy", args: ["models"] });
    expect(await runCatalogCommand({ bin: process.execPath, args: ["-e", "console.log('future-high\\tFuture')"] },
      "antigravity", tmpdir(), {})).toBe("future-high\tFuture\n");
  });
  it("rejects stdout above 4MiB, timeout and failed process without exposing diagnostics", async () => {
    await expect(runCatalogCommand({ bin: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(4*1024*1024+1))"] },
      "antigravity", tmpdir(), {})).rejects.toThrow("batas ukuran");
    await expect(runCatalogCommand({ bin: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      "antigravity", tmpdir(), {}, 50)).rejects.toThrow("batas waktu");
    await expect(runCatalogCommand({ bin: process.execPath, args: ["-e", "console.error('SECRET');process.exit(1)"] },
      "antigravity", tmpdir(), {})).rejects.toThrow("CLI tidak mengembalikan");
  });
  it("refuses unsupported sandbox and public hardening before starting any host command", () => {
    for (const env of [{ HANOMAN_SESSION_SANDBOX: "podman" }, { HANOMAN_SESSION_SANDBOX: "required" },
      { HANOMAN_HARDENING: "1" }]) expect(() => catalogCommand("antigravity", "/tmp", env)).toThrow("sandbox");
  });
});

describe("configured probe binary and env boundary", () => {
  it("uses DB override over env, notices config changes, strips only Antigravity credentials for other runtimes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "catalog-bin-"));
    const file = join(dir, "agy-test");
    try {
      await writeFile(file, `#!${process.execPath}
const ag = process.argv[2] === "models";
if (ag && (process.env.GEMINI_API_KEY !== "secret" || process.env.GOOGLE_GEMINI_BASE_URL !== "https://private")) process.exit(2);
if (!ag && (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_BASE_URL)) process.exit(3);
if (process.env.GOOGLE_PROJECT_ID !== "keep") process.exit(4);
console.log(ag ? "future-high\\tFuture" : JSON.stringify({models:[{slug:"gpt-future",supported_reasoning_levels:[{effort:"low"}],default_reasoning_level:"low"}]}));
`, { mode: 0o700 });
      vi.stubEnv("HANOMAN_ANTIGRAVITY_BIN", "/missing-env-agy");
      vi.stubEnv("GEMINI_API_KEY", "secret");
      vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://private");
      vi.stubEnv("GOOGLE_PROJECT_ID", "keep");
      vi.stubEnv("HANOMAN_SESSION_SANDBOX", "off");
      const before = catalogProbeKey();
      await setConfig("HANOMAN_ANTIGRAVITY_BIN", file);
      expect(catalogProbeKey()).not.toBe(before);
      expect(await probeModelCatalog("antigravity")).toEqual([{ id: "future-high", label: "Future", efforts: ["high"] }]);
      vi.stubEnv("HANOMAN_CODEX_BIN", file);
      expect((await probeModelCatalog("codex"))[0]?.id).toBe("gpt-future");
      const host = catalogProbeKey();
      vi.stubEnv("HANOMAN_SESSION_SANDBOX", "podman");
      expect(catalogProbeKey()).not.toBe(host);
      await expect(probeModelCatalog("antigravity")).rejects.toThrow("sandbox");
    } finally { await clearConfig("HANOMAN_ANTIGRAVITY_BIN"); await rm(dir, { recursive: true, force: true }); }
  });
  it("bounds the default timeout at twenty seconds", async () => {
    const started = Date.now();
    const pending = runCatalogCommand({ bin: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      "antigravity", tmpdir(), {});
    await expect(pending).rejects.toThrow("batas waktu");
    expect(Date.now() - started).toBeGreaterThanOrEqual(19_500);
    expect(Date.now() - started).toBeLessThan(24_000);
  }, 25_000);
});
