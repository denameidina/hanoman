import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, getSession, killSession, registerCustomAgentSource, registerCodexNativeAgentSupport,
  agentsFilePath, promptFilePath, agentTempDir, trackPhaseDoneSeen, _forgetPhaseDoneSeen, AGENTS_ARG_SAFE_BYTES,
  agentContractFilePath, fitCustomAgentsToArgBudget,
} from "../src/services/pty";
import { agentContractOf, renderAgentsJson, type AgentDef } from "@hanoman/runner";

// ADR-0164 · kontrak orchestrator di titik cekik kelahiran sesi. Bukti dibaca dari berkas sesi dan
// layar pane ber-binary /bin/echo — bukan dari bentuk respons (pelajaran `sessionModel()`).

const phaseAgents: AgentDef[] = [
  { kind: "phase", phase: "Spec", name: "hanoman-fase-spec", description: "Fase Spec",
    instructions: "INSTRUKSI SPEC", tools: null, model: "claude-sonnet-5", effort: "low", mentions: [] },
  { kind: "phase", phase: "Plan", name: "hanoman-fase-plan", description: "Fase Plan",
    instructions: "INSTRUKSI PLAN", tools: null, model: "claude-opus-5", effort: "high", mentions: [] },
];
const scout: AgentDef = { name: "scout", description: "cari", instructions: "kamu pencari", tools: null, model: null, mentions: [] };
/** Audit P1-11 · render yang diharapkan: custom agent `inherit` merujuk berkas kontrak sesi itu. */
const renderedWithContract = (id: string, defs: AgentDef[]): string => renderAgentsJson(defs, {
  agentContractFiles: [{ policy: "inherit", content: agentContractOf("inherit"), path: agentContractFilePath(id, "inherit") }],
});

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
    expect(j["hanoman-fase-spec"]).toMatchObject({
      description: "Fase Spec", model: "claude-sonnet-5", effort: "low",
    });
    // ADR-0170 P2 · klausa delegasi ditempel di kelahiran sesi — roster custom agent baru pasti di sini.
    expect(j["hanoman-fase-spec"].prompt.startsWith("INSTRUKSI SPEC\n\n=== DELEGASI ===")).toBe(true);
    expect(j["hanoman-fase-spec"].prompt).toContain("`scout` (model sesi)");
    expect(readFileSync(promptFilePath(s.id), "utf8").startsWith("PROMPT ORCHESTRATOR")).toBe(true);
    const p = getSession(s.id)!;
    expect(p).toMatchObject({ orchestrated: true, model: "claude-opus-5", effort: "xhigh" });
    expect(p.agentRoster!.find((r) => r.name === "hanoman-fase-spec"))
      .toMatchObject({ phase: "Spec", model: "claude-sonnet-5", effort: "low" });
    expect(existsSync(join(agentTempDir(s.id), "subagent-statusline.cjs"))).toBe(true);
  });

  // T2 · konteks bersama ditulis SEKALI ke temp dir sesi (di-mount sandbox sebagai agentConfigDir)
  // dan dirujuk path-nya — bukan disalin ke tiap agen fase di dalam satu argumen `--agents`.
  it("claude: konteks bersama agen fase ditulis sekali ke berkas 0600 dan dirujuk path-nya", () => {
    const ctx = "KONTEKS-BESAR ".repeat(4_000); // ≈ 56 KB
    const withCtx = phaseAgents.map((d) => ({ ...d, context: ctx }));
    const s = createSession("p1", cwd, {
      id: born("orch-ctx"), agent: "claude", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents: withCtx,
    });
    const file = join(agentTempDir(s.id), "phase-context.md");
    expect(readFileSync(file, "utf8")).toBe(ctx);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = readFileSync(agentsFilePath(s.id), "utf8");
    expect(raw).not.toContain("KONTEKS-BESAR");
    expect(JSON.parse(raw)["hanoman-fase-spec"].prompt).toContain(`\`${file}\``);
    expect(Buffer.byteLength(raw)).toBeLessThan(AGENTS_ARG_SAFE_BYTES);
    expect(getSession(s.id)!.orchestrated).toBe(true);
  });

  // T2 · jaring pengaman: argumen `--agents` yang tetap melewati ambang aman (instruksi fase raksasa)
  // tak boleh sampai ke exec — di Linux ia mati "Argument list too long" tanpa fallback. Diperlakukan
  // seperti kegagalan materialisasi: all-or-nothing ke mode tunggal, dengan alasan di stderr.
  it("claude: argumen --agents melewati ambang aman → mode tunggal + peringatan stderr", () => {
    registerCustomAgentSource(() => [scout]);
    const huge = phaseAgents.map((d) => ({ ...d, instructions: "X".repeat(AGENTS_ARG_SAFE_BYTES) }));
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, {
      id: born("orch-huge"), agent: "claude", prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents: huge,
    });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    expect(getSession(s.id)!.orchestrated).toBe(false);
    expect(readFileSync(promptFilePath(s.id), "utf8").startsWith("PROMPT LAMA")).toBe(true);
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toBe(renderedWithContract(s.id, [scout]));
    expect(stderrOut).toContain("gagal dimaterialisasi");
    expect(stderrOut).toContain("ambang aman");
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
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toBe(renderedWithContract(s.id, [scout]));
  });

  // Audit P1-11 · kontrak bersama custom agent ditulis SEKALI per policy (0600) dan dirujuk path-nya.
  it("claude: kontrak bersama custom agent per policy ditulis sekali ke temp dir sesi", () => {
    const rev: AgentDef = { ...scout, name: "rev", workspacePolicy: "read-only" };
    registerCustomAgentSource(() => [scout, rev]);
    const s = createSession("p1", cwd, { id: born("orch-contract"), agent: "claude", prompt: "P" });
    for (const policy of ["inherit", "read-only"] as const) {
      const file = agentContractFilePath(s.id, policy);
      expect(readFileSync(file, "utf8")).toBe(agentContractOf(policy));
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(existsSync(agentContractFilePath(s.id, "isolated-worktree"))).toBe(false);
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(j.rev.prompt).toContain(`\`${agentContractFilePath(s.id, "read-only")}\``);
    expect(j.scout.prompt).not.toContain("Gaya kode —");
  });

  // Audit P1-11 · sesi TANPA agen fase dulu tak berambang: JSON melewati 128 KiB mati E2BIG di Linux.
  it("claude tanpa agen fase: melewati ambang → agen opt-in paling akhir dibuang + peringatan", () => {
    const big = (name: string): AgentDef => ({ ...scout, name, instructions: "Y".repeat(40 * 1024) });
    registerCustomAgentSource(() => [big("opt-a"), big("opt-b"), big("opt-c")]);
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const s = createSession("p1", cwd, { id: born("orch-budget"), agent: "claude", prompt: "P" });
    const stderrOut = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    writeSpy.mockRestore();
    const raw = readFileSync(agentsFilePath(s.id), "utf8");
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(AGENTS_ARG_SAFE_BYTES);
    expect(Object.keys(JSON.parse(raw))).toEqual(["opt-a", "opt-b"]);
    expect(stderrOut).toContain("custom agent opt-c dibuang");
    expect(stderrOut).toContain("ambang aman");
    expect(getSession(s.id)!.agentRoster!.map((r) => r.name)).not.toContain("opt-c");
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

  // ADR-0170 P2 · klausa delegasi agen fase menyebut HANYA custom agent yang hidup di sesi itu;
  // roster kosong → klausa generik tanpa nama. Reviewer tak menerima klausa, roster-nya ber-fase Execute.
  it("P2 · klausa delegasi dari roster hidup; reviewer tanpa klausa & tercatat di fase Execute", () => {
    const reviewer: AgentDef = { kind: "phase", phase: "Execute", name: "hanoman-fase-review", description: "Review",
      instructions: "INSTRUKSI REVIEW", tools: null, model: "opus", effort: "high", mentions: [] };
    const execute: AgentDef = { kind: "phase", phase: "Execute", name: "hanoman-fase-execute", description: "Fase Execute",
      instructions: "INSTRUKSI EXECUTE", tools: null, model: "sonnet", effort: "high", mentions: [] };
    registerCustomAgentSource(() => [{ ...scout, workspacePolicy: "read-only", model: "haiku" }]);
    const s = createSession("p1", cwd, {
      id: born("orch-deleg"), agent: "claude", prompt: "P", legacyPrompt: "L",
      phaseAgents: [...phaseAgents, execute, reviewer],
    });
    const j = JSON.parse(readFileSync(agentsFilePath(s.id), "utf8"));
    expect(j["hanoman-fase-execute"].prompt).toContain("`scout` (read-only · haiku)");
    expect(j["hanoman-fase-execute"].prompt).toContain("implementer per task");
    expect(j["hanoman-fase-review"].prompt).toBe("INSTRUKSI REVIEW");
    const roster = getSession(s.id)!.agentRoster!;
    expect(roster.find((r) => r.name === "hanoman-fase-review")).toMatchObject({ phase: "Execute", model: "opus" });
    // Agen fase Execute tetap entri roster PERTAMA untuk fase itu (chip fase memakai `find`).
    expect(roster.find((r) => r.phase === "Execute")!.name).toBe("hanoman-fase-execute");

    registerCustomAgentSource(() => []);
    const bare = createSession("p1", cwd, { id: born("orch-deleg-empty"), agent: "claude", prompt: "P", legacyPrompt: "L", phaseAgents });
    const k = JSON.parse(readFileSync(agentsFilePath(bare.id), "utf8"));
    expect(k["hanoman-fase-spec"].prompt).toContain("Tak ada custom agent di sesi ini");
    expect(k["hanoman-fase-spec"].prompt).not.toContain("`scout`");
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
    expect(j["hanoman-fase-plan"]).toMatchObject({
      description: "Fase Plan", model: "claude-opus-5", effort: "high",
    });
    expect(j["hanoman-fase-plan"].prompt.startsWith("INSTRUKSI PLAN\n\n=== DELEGASI ===")).toBe(true);
    // Klausa delegasi pun tak menyebut agen rogue: ia dibuang SEBELUM roster disusun.
    expect(j["hanoman-fase-plan"].prompt).not.toContain("coba menimpa");
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

// Audit P1-11 · urutan degradasi: opt-in (bukan enabledByDefault katalog bawaan) paling akhir dulu.
describe("fitCustomAgentsToArgBudget", () => {
  const agent = (name: string): AgentDef => ({ name, description: "d", instructions: "i", tools: null, model: null, mentions: [] });
  const size = (defs: AgentDef[]) => "x".repeat(defs.length * 10);

  it("muat → tak ada yang dibuang, JSON dari render apa adanya", () => {
    const defs = [agent("a"), agent("b")];
    expect(fitCustomAgentsToArgBudget(defs, size, 20)).toEqual({ kept: defs, dropped: [], json: "x".repeat(20) });
  });

  it("opt-in paling akhir dibuang lebih dulu; agen default bawaan dibuang terakhir", () => {
    // scout & security-reviewer: enabledByDefault di katalog bawaan; qa-verifier bawaan tapi opt-in.
    const defs = [agent("scout"), agent("qa-verifier"), agent("security-reviewer"), agent("opt-2")];
    const two = fitCustomAgentsToArgBudget(defs, size, 20);
    expect(two.kept.map((d) => d.name)).toEqual(["scout", "security-reviewer"]);
    expect(two.dropped.map((d) => d.name)).toEqual(["opt-2", "qa-verifier"]);
    const one = fitCustomAgentsToArgBudget(defs, size, 10);
    expect(one.kept.map((d) => d.name)).toEqual(["scout"]);
    expect(one.dropped.map((d) => d.name)).toEqual(["opt-2", "qa-verifier", "security-reviewer"]);
  });
});
