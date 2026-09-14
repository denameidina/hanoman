import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSubagentStatusline } from "../src/subagent-statusline";

const run = (command: string, stdin: string) =>
  spawnSync("sh", ["-c", command], { input: stdin, encoding: "utf8" });

describe("subagentStatusLine (ADR-0164)", () => {
  it("menulis ulang baris subagent jadi label · model · effort · durasi · token", () => {
    const dir = mkdtempSync(join(tmpdir(), "hnm-sl-"));
    const command = writeSubagentStatusline(dir);
    const out = run(command, JSON.stringify({ tasks: [{
      id: "a9aec", type: "local_agent", status: "running", description: "Fase Spec", label: "Fase Spec",
      startTime: Date.now() - 72_000, model: "claude-opus-5", effort: "high", tokenCount: 18_400,
    }] }));
    expect(out.status).toBe(0);
    const row = JSON.parse(out.stdout.trim()) as { id: string; content: string };
    expect(row.id).toBe("a9aec");
    expect(row.content).toMatch(/^Fase Spec · Opus 5 · high · 1m1[23]s · 18k tok$/);
    expect(readFileSync(join(dir, "subagent-models.json"), "utf8")).toContain("Opus 5");
  });

  it("effort absen (mewarisi sesi) tak dikarang; model tak dikenal ditampilkan apa adanya", () => {
    const command = writeSubagentStatusline(mkdtempSync(join(tmpdir(), "hnm-sl-")));
    const out = run(command, JSON.stringify({ tasks: [{
      id: "b1", label: "Fase Plan", startTime: Date.now(), model: "model-baru", tokenCount: 0,
    }] }));
    expect(JSON.parse(out.stdout.trim()).content).toMatch(/^Fase Plan · model-baru · 0s$/);
  });

  it("stdin rusak → keluar 0 tanpa baris (claude memakai baris bawaan)", () => {
    const command = writeSubagentStatusline(mkdtempSync(join(tmpdir(), "hnm-sl-")));
    const out = run(command, "{bukan json");
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });
});
