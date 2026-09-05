import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { catalogCommand, runCatalogCommand } from "../src/services/model-catalog-probe";

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
