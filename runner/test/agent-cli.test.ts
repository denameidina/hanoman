import { describe, it, expect } from "vitest";
import { agentFlags } from "../src/agent-cli";

describe("agentFlags · claude", () => {
  it("mempertahankan argv historis claude", () => {
    const f = agentFlags({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(f.slice(0, 4)).toEqual(["--model", "claude-opus-5", "--effort", "xhigh"]);
    expect(f).toContain("--dangerously-skip-permissions");
    expect(f).toContain("--settings");
  });

  it("goal claude tetap Stop hook bertipe prompt di --settings", () => {
    const f = agentFlags({ agent: "claude", goal: "SELESAI-338" });
    const settings = f[f.indexOf("--settings") + 1]!;
    expect(JSON.parse(settings)).toEqual({ hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "SELESAI-338" }] }] } });
  });

  it("model/effort kosong tak menghasilkan flag kosong", () => {
    const f = agentFlags({ agent: "claude" });
    expect(f).not.toContain("--model");
    expect(f).not.toContain("--effort");
  });
});

describe("agentFlags · codex", () => {
  it("memakai -m dan model_reasoning_effort, bukan --model/--effort", () => {
    const f = agentFlags({ agent: "codex", model: "gpt-5.5", effort: "high" });
    expect(f.slice(0, 4)).toEqual(["-m", "gpt-5.5", "-c", 'model_reasoning_effort="high"']);
    expect(f).not.toContain("--model");
    expect(f).not.toContain("--effort");
  });

  it("selalu membawa bypass approvals DAN bypass hook trust", () => {
    const f = agentFlags({ agent: "codex" });
    expect(f).toContain("--dangerously-bypass-approvals-and-sandbox");
    // Tanpa ini TUI berhenti di layar "Hooks need review" dan sesi tak pernah mulai.
    expect(f).toContain("--dangerously-bypass-hook-trust");
    expect(f).not.toContain("--dangerously-skip-permissions");
    expect(f).not.toContain("--settings");
  });

  it("berjalan inline (--no-alt-screen) supaya riwayat masuk scrollback pane tmux", () => {
    // Di alternate screen tmux tak menyimpan history (history_size 0), jadi wheel → copy-mode
    // (SPEC-209) tak menemukan apa pun untuk digulir.
    expect(agentFlags({ agent: "codex" })).toContain("--no-alt-screen");
    expect(agentFlags({ agent: "claude" })).not.toContain("--no-alt-screen");
  });

  it("meneruskan marker keputusan & gate goal sebagai hook -c", () => {
    const f = agentFlags({ agent: "codex", decisionFile: "/tmp/d", goalGate: "/tmp/g.sh" });
    const joined = f.join(" ");
    expect(joined).toContain("hooks.Stop=");
    expect(joined).toContain("hooks.UserPromptSubmit=");
    expect(joined).toContain("/tmp/g.sh");
  });
});

describe("agentFlags · subagentStatusLine (ADR-0164)", () => {
  it("claude: masuk ke JSON --settings; codex: diabaikan", () => {
    const claude = agentFlags({ agent: "claude", subagentStatusLine: "node x" });
    const settings = JSON.parse(claude[claude.indexOf("--settings") + 1]!);
    expect(settings.subagentStatusLine).toEqual({ type: "command", command: "node x" });
    expect(agentFlags({ agent: "codex", subagentStatusLine: "node x" }).join(" ")).not.toContain("node x");
  });
});
