import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, getSession, killSession, registerCustomAgentSource, registerCodexNativeAgentSupport,
  agentsFilePath, promptFilePath, agentTempDir, trackPhaseDoneSeen, _forgetPhaseDoneSeen,
} from "../src/services/pty";
import { renderAgentsJson, type AgentDef } from "@hanoman/runner";

// ADR-0164 · kontrak orchestrator di titik cekik kelahiran sesi. Bukti dibaca dari berkas sesi dan
// layar pane ber-binary /bin/echo — bukan dari bentuk respons (pelajaran `sessionModel()`).

const phaseAgents: AgentDef[] = [
  { kind: "phase", phase: "Spec", name: "hanoman-fase-spec", description: "Fase Spec",
    instructions: "INSTRUKSI SPEC", tools: null, model: "claude-sonnet-5", effort: "low", mentions: [] },
  { kind: "phase", phase: "Plan", name: "hanoman-fase-plan", description: "Fase Plan",
    instructions: "INSTRUKSI PLAN", tools: null, model: "claude-opus-5", effort: "high", mentions: [] },
];
const scout: AgentDef = { name: "scout", description: "cari", instructions: "kamu pencari", tools: null, model: null, mentions: [] };

let cwd: string;
const ids: string[] = [];
const born = (id: string): string => { ids.push(id); return id; };
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "hnm-orch-"));
  // Mesin ini bersama sesi lain — jangan pernah melahirkan claude/codex sungguhan dari test.
  process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
  process.env.HANOMAN_CODEX_BIN = "/bin/echo";
});
afterEach(() => {
  for (const id of ids.splice(0)) { try { killSession(id); } catch { /* sudah mati */ } }
  registerCustomAgentSource(() => []);
  registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true }));
  delete process.env.HANOMAN_CLAUDE_BIN;
  delete process.env.HANOMAN_CODEX_BIN;
});

/** Layar pane: binary /bin/echo mencetak argv utuh, `remain-on-exit` menahan pane mati terbaca. */
const screenOf = async (id: string): Promise<string> => {
  const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
    "-f", "/dev/null", "capture-pane", "-p", "-J", "-S", "-2000", "-t", "hanoman-" + id],
    { encoding: "utf8" }).replace(/\s+/g, " ").trim();
  for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
  return read();
};

describe("createSession · orchestrator (ADR-0164)", () => {
  it("claude: agen fase + custom dirender bersama, prompt orchestrator, roster ber-fase, penanda tmux", () => {
    registerCustomAgentSource(() => [scout]);
    const s = createSession("p1", cwd, {
      id: born("orch-claude"), agent: "claude", model: "claude-opus-5", effort: "xhigh",
      prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(Object.keys(j).sort()).toEqual(["hanoman-fase-plan", "hanoman-fase-spec", "scout"]);
    expect(j["hanoman-fase-spec"]).toEqual({
      description: "Fase Spec", prompt: "INSTRUKSI SPEC", model: "claude-sonnet-5", effort: "low",
    });
    expect(readFileSync(promptFilePath(s.id), "utf8").startsWith("PROMPT ORCHESTRATOR")).toBe(true);
    const p = getSession(s.id)!;
    expect(p).toMatchObject({ orchestrated: true, model: "claude-opus-5", effort: "xhigh" });
    expect(p.agentRoster!.find((r) => r.name === "hanoman-fase-spec"))
      .toMatchObject({ phase: "Spec", model: "claude-sonnet-5", effort: "low" });
    expect(existsSync(join(agentTempDir(s.id), "subagent-statusline.cjs"))).toBe(true);
  });

  it("claude: --settings memuat subagentStatusLine hanya untuk sesi diorkestrasi", async () => {
    const a = createSession("p1", cwd, { id: born("orch-sl-a"), agent: "claude", prompt: "P", legacyPrompt: "L", phaseAgents });
    const b = createSession("p1", cwd, { id: born("orch-sl-b"), agent: "claude", prompt: "P" });
    expect(await screenOf(a.id)).toContain("subagentStatusLine");
    expect(await screenOf(b.id)).not.toContain("subagentStatusLine");
    expect(getSession(b.id)!.orchestrated).toBe(false);
  });

  it("sesi tanpa agen fase: berkas --agents byte-identik dengan renderer custom agent", () => {
    registerCustomAgentSource(() => [scout]);
    const s = createSession("p1", cwd, { id: born("orch-none"), agent: "claude", prompt: "P" });
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toBe(renderAgentsJson([scout]));
  });

  it("codex < 0.151: seluruh rencana dibatalkan, prompt lama, tanpa penanda orkestrasi", () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id: born("orch-codex-old"), agent: "codex", model: "gpt-5.6-sol", effort: "high",
      prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("PROMPT LAMA");
    expect(getSession(s.id)!.orchestrated).toBe(false);
    expect(getSession(s.id)!.agentRoster ?? []).toEqual([]);
    // Review Task 7: fallback harus mencetak ALASANNYA, bukan cuma "gagal dimaterialisasi".
    expect(stderrOut).toContain("0.151.0");
  });

  it("codex ≥ 0.151: satu agen fase gagal (workspacePolicy tak didukung) mencetak alasannya, sisanya jatuh ke mode tunggal", async () => {
    registerCustomAgentSource(() => [scout]);
    registerCodexNativeAgentSupport(() => ({ version: "0.154.0", ok: true }));
    // Fase pertama dipaksa gagal dengan policy yang ditolak materializer Codex — kegagalan NYATA
    // satu agen fase, sementara fase kedua & custom agent tetap bisa dimaterialisasi.
    const brokenPhaseAgents: AgentDef[] = [
      { ...phaseAgents[0]!, workspacePolicy: "isolated-worktree" },
      phaseAgents[1]!,
    ];
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id: born("orch-codex-partial"), agent: "codex",
      prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents: brokenPhaseAgents,
    });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    expect(readFileSync(promptFilePath(s.id), "utf8").startsWith("PROMPT LAMA")).toBe(true);
    expect(getSession(s.id)!.orchestrated).toBe(false);
    expect(getSession(s.id)!.agentRoster!.map((r) => r.name)).toEqual(["scout"]);
    expect(await screenOf(s.id)).not.toContain("agents.max_depth");
    expect(stderrOut).toContain("gagal dimaterialisasi");
    expect(stderrOut).toContain("hanoman-fase-spec");
    expect(stderrOut).toContain("isolated-worktree");
  });

  // R7 · smart activation custom agent harus melihat prompt yang BENAR-BENAR lahir: saat fallback
  // all-or-nothing, itu `legacyPrompt`, bukan prompt orchestrator yang tak pernah dipakai.
  it("R7 · fallback mode tunggal memilih custom agent dengan legacyPrompt yang lahir", () => {
    const seen: Array<string | undefined> = [];
    registerCustomAgentSource((ctx) => {
      seen.push(ctx.prompt);
      return ctx.prompt === "PROMPT LAMA" ? [scout] : [];
    });
    registerCodexNativeAgentSupport(() => ({ version: "0.154.0", ok: true }));
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id: born("orch-r7-fallback"), agent: "codex", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA",
      phaseAgents: [{ ...phaseAgents[0]!, workspacePolicy: "isolated-worktree" }, phaseAgents[1]!],
    });
    writeSpy.mockRestore();
    expect(getSession(s.id)!.orchestrated).toBe(false);
    expect(seen.at(-1)).toBe("PROMPT LAMA");
    expect(getSession(s.id)!.agentRoster!.map((r) => r.name)).toEqual(["scout"]);
  });

  it("R7 · sesi orchestrator memilih custom agent dengan prompt orchestrator", () => {
    const seen: Array<string | undefined> = [];
    registerCustomAgentSource((ctx) => { seen.push(ctx.prompt); return [scout]; });
    createSession("p1", cwd, {
      id: born("orch-r7-ok"), agent: "claude", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    expect(seen).toEqual(["PROMPT ORCHESTRATOR"]);
  });

  it("codex ≥ 0.151: agen fase jadi role native dengan max_depth eksplisit", async () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.154.0", ok: true }));
    const s = createSession("p1", cwd, { id: born("orch-codex"), agent: "codex", prompt: "P", legacyPrompt: "L", phaseAgents });
    const screen = await screenOf(s.id);
    expect(screen).toContain("agents.max_depth=3");
    expect(screen).toContain('agents."hanoman-fase-spec".config_file');
    expect(getSession(s.id)!.orchestrated).toBe(true);
  });

  // R3 · tenggang ⚠ 60 dtk dihitung "sejak server PERTAMA melihat marker done" — dulu disimpan per
  // attachment, jadi reconnect dashboard dan restart server memulai ulang tenggangnya.
  it("R3 · doneSeen per sesi: tahan reconnect & restart (opsi tmux), dibuang saat sesi dibunuh", async () => {
    const s = createSession("p1", cwd, {
      id: born("orch-r3"), agent: "claude", prompt: "P", legacyPrompt: "L", phaseAgents,
    });
    const spec = [{ name: "Spec", state: "done" as const }];
    expect(trackPhaseDoneSeen(s.id, spec, 1_000).get("Spec")).toBe(1_000);
    // Tanpa state per-attachment: panggilan berikutnya (attachment/klien mana pun) tak me-reset.
    expect(trackPhaseDoneSeen(s.id, spec, 50_000).get("Spec")).toBe(1_000);
    // Restart server = peta modul hilang; opsi tmux sesi membawanya kembali.
    await new Promise((r) => setTimeout(r, 100));   // set-option asinkron
    _forgetPhaseDoneSeen(s.id);
    expect(trackPhaseDoneSeen(s.id, spec, 90_000).get("Spec")).toBe(1_000);
    // Fase di-reset lalu selesai lagi → tenggang utuh (perilaku trackDoneSeen dipertahankan).
    expect(trackPhaseDoneSeen(s.id, [{ name: "Spec", state: "active" }], 95_000).has("Spec")).toBe(false);
    expect(trackPhaseDoneSeen(s.id, spec, 99_000).get("Spec")).toBe(99_000);
    killSession(s.id);
    const again = createSession("p1", cwd, {
      id: s.id, agent: "claude", prompt: "P", legacyPrompt: "L", phaseAgents,
    });
    expect(trackPhaseDoneSeen(again.id, spec, 200_000).get("Spec")).toBe(200_000);
  });

  // M-1 · ADR-0164 · awalan `hanoman-fase-` dicadangkan untuk agen fase; skema `CustomAgent`
  // menolaknya di ENTRY BARU, tapi baris lama bisa nyasar lewat sync dari peer lama. Tanpa gerbang
  // di sini, `attempt()` merakit `[...phaseDefs, ...customDefs]` dan claude JSON last-key-wins —
  // custom agent bernama sama MENIMPA definisi/instruksi agen fase asli, senyap.
  it("M-1 · custom agent hanoman-fase-plan dari sumber custom dibuang, tak menimpa agen fase asli", () => {
    const rogue: AgentDef = {
      name: "hanoman-fase-plan", description: "custom jahat", instructions: "coba menimpa fase Plan",
      tools: null, model: null, mentions: [],
    };
    registerCustomAgentSource(() => [rogue, scout]);
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id: born("orch-m1"), agent: "claude", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    // Berkas --agents hanya memuat agen fase ASLI + custom agent yang sah — bukan versi rogue-nya.
    expect(Object.keys(j).sort()).toEqual(["hanoman-fase-plan", "hanoman-fase-spec", "scout"]);
    expect(j["hanoman-fase-plan"]).toEqual({
      description: "Fase Plan", prompt: "INSTRUKSI PLAN", model: "claude-opus-5", effort: "high",
    });
    expect(stderrOut).toContain("hanoman-fase-plan");
    expect(stderrOut).toContain("diabaikan");
  });

  // M-7 · ADR-0164 · statusline TUI subagent adalah kosmetik (fail-open di skripnya sendiri saat
  // runtime) — kegagalan MENULISNYA saat lahir tak boleh menggagalkan kelahiran sesi orchestrator.
  // Dipaksa gagal tanpa mock modul: path tulisnya sendiri sudah berupa DIREKTORI (EISDIR), bukan
  // lewat chmod (timing-sensitif di tengah satu pemanggilan sinkron).
  it("M-7 · gagal tulis subagentStatusline tak menggagalkan kelahiran sesi", async () => {
    const id = born("orch-m7");
    mkdirSync(join(agentTempDir(id), "subagent-statusline.cjs"), { recursive: true });
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id, agent: "claude", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    expect(getSession(s.id)!.orchestrated).toBe(true);
    expect(await screenOf(s.id)).not.toContain("subagentStatusLine");
    expect(stderrOut).toContain("subagentStatusline");
    expect(stderrOut).toContain(id);
  });
});
