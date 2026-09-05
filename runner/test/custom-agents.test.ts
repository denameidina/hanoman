import { describe, it, expect } from "vitest";
import {
  renderAgentsJson, agentPromptOf, agentDelegationClause, type AgentDef,
} from "../src/custom-agents";
import { DEFAULT_AGENT_TOOLS, MENTION_MAX_HOPS } from "@hanoman/shared";

const def = (o: Partial<AgentDef> & { name: string }): AgentDef => ({
  name: o.name,
  description: o.description ?? `deskripsi ${o.name}`,
  instructions: o.instructions ?? `instruksi ${o.name}`,
  tools: o.tools ?? null,
  model: o.model ?? null,
  mentions: o.mentions ?? [],
  activation: o.activation ?? "always",
  effort: o.effort ?? null,
  workspacePolicy: o.workspacePolicy ?? "inherit",
  maxTurns: o.maxTurns ?? null,
  timeoutSeconds: o.timeoutSeconds ?? null,
});

describe("renderAgentsJson", () => {
  it("daftar kosong → string kosong (flag tak dipasang sama sekali)", () => {
    expect(renderAgentsJson([])).toBe("");
  });

  it("bentuknya {name:{description,prompt,tools}} sesuai --agents claude", () => {
    const parsed = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(Object.keys(parsed)).toEqual(["rev"]);
    expect(parsed.rev.description).toBe("deskripsi rev");
    expect(typeof parsed.rev.prompt).toBe("string");
    expect(parsed.rev.tools).toEqual([...DEFAULT_AGENT_TOOLS]);
  });

  it("model hanya dipancarkan bila diisi (else agen mewarisi model sesi)", () => {
    expect(JSON.parse(renderAgentsJson([def({ name: "a" })])).a.model).toBeUndefined();
    expect(JSON.parse(renderAgentsJson([def({ name: "a", model: "haiku" })])).a.model).toBe("haiku");
  });

  it("agen ber-mentions mendapat Task; agen daun TIDAK", () => {
    const j = JSON.parse(renderAgentsJson([
      def({ name: "a", mentions: ["b"] }),
      def({ name: "b" }),
    ]));
    expect(j.a.tools).toContain("Task");
    expect(j.b.tools).not.toContain("Task");
  });

  it("Task yang diketik operator dicabut untuk agen daun", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "b", tools: ["Read", "Task"] })]));
    expect(j.b.tools).toEqual(["Read"]);
  });

  it("keluarannya JSON sah walau instruksi memuat kutip, newline, dan backslash", () => {
    const nasty = 'baris1\n"kutip" \\ backslash \t tab';
    const j = JSON.parse(renderAgentsJson([def({ name: "a", instructions: nasty })]));
    expect(j.a.prompt).toContain(nasty);
  });

  it("memancarkan profil Claude yang didukung runtime", () => {
    const parsed = JSON.parse(renderAgentsJson([def({
      name: "qa", model: "sonnet", effort: "high", workspacePolicy: "isolated-worktree",
      maxTurns: 40, timeoutSeconds: 900,
    })]));
    expect(parsed.qa).toMatchObject({
      model: "sonnet", effort: "high", isolation: "worktree", maxTurns: 40,
    });
    expect(parsed.qa.prompt).toContain("900 detik");
  });

  it("read-only mencabut tool mutasi dan memasang permission + validator hook", () => {
    const parsed = JSON.parse(renderAgentsJson([def({
      name: "review", tools: ["Read", "Write", "Edit", "Bash", "Task", "mcp__db__write"],
      mentions: ["other"], workspacePolicy: "read-only",
    }), def({ name: "other" })], { readOnlyHookCommand: "node /tmp/readonly.js" }));
    expect(parsed.review.tools).toEqual(["Read", "Bash"]);
    expect(parsed.review.permissionMode).toBe("plan");
    expect(parsed.review.hooks.PreToolUse[0].hooks[0]).toMatchObject({
      type: "command", command: "node /tmp/readonly.js",
    });
  });
});

describe("agentPromptOf — lapis 3 anti-loop", () => {
  it("agen daun diberi tahu ia TIDAK boleh mendelegasikan", () => {
    const p = agentPromptOf(def({ name: "b" }), []);
    expect(p).toContain("instruksi b");
    expect(p.toLowerCase()).toContain("tidak boleh mendelegasikan");
  });

  it("agen ber-mentions menyebut siapa yang boleh dipanggil + anggaran hop", () => {
    const a = def({ name: "a", mentions: ["b", "c"] });
    const p = agentPromptOf(a, [a, def({ name: "b" }), def({ name: "c" })]);
    expect(p).toContain("@b");
    expect(p).toContain("@c");
    expect(p).toContain(String(MENTION_MAX_HOPS));
  });

  it("mention ke agen yang tak ada di roster tak ikut disebut", () => {
    const a = def({ name: "a", mentions: ["b", "hantu"] });
    const p = agentPromptOf(a, [a, def({ name: "b" })]);
    expect(p).toContain("@b");
    expect(p).not.toContain("@hantu");
  });

  it("membawa policy efektif read-only dan melarang klaim eksperimen tanpa output", () => {
    const p = agentPromptOf(def({
      name: "root-causer", workspacePolicy: "read-only", maxTurns: 40,
    }), [], "claude");
    expect(p).toContain("Policy efektif: read-only");
    expect(p).toContain("diagnosis statis");
    expect(p).toContain("rencana eksperimen untuk parent");
    expect(p).toContain("Jangan mengklaim eksperimen telah dijalankan tanpa output");
  });

  it("mengizinkan root-causer mereproduksi hanya pada isolated-worktree", () => {
    const p = agentPromptOf(def({
      name: "root-causer", workspacePolicy: "isolated-worktree", maxTurns: 40,
    }), [], "claude");
    expect(p).toContain("Policy efektif: isolated-worktree");
    expect(p).toContain("boleh mereproduksi");
    expect(p).toContain("worktree terisolasi");
  });

  it("membawa kontrak handoff, batas laporan, dan batas turn instruksional", () => {
    const p = agentPromptOf(def({ name: "scout", maxTurns: 20 }), [], "codex");
    expect(p).toContain("Status: selesai | sebagian | terhalang");
    expect(p).toContain("maksimal 12 temuan utama");
    expect(p).toContain("maksimal 1200 kata");
    expect(p).toContain("20 turn");
    expect(p).toContain("batas instruksional");
    expect(p).toContain("bukan hard kill");
  });
});

// SPEC-543 · ADR-0108 · subagent claude punya konteks TERPISAH: prompt sesi (yang membawa klausa
// gaya kode) tak pernah sampai ke sana, jadi klausanya harus ikut di prompt perannya sendiri.
describe("klausa gaya kode di custom agent (SPEC-543)", () => {
  const MARK = "Gaya kode —";

  it("agen daun membawanya", () => {
    expect(agentPromptOf(def({ name: "b" }), [])).toContain(MARK);
  });

  it("agen ber-mentions membawanya juga (kedua cabang)", () => {
    const a = def({ name: "a", mentions: ["b"] });
    expect(agentPromptOf(a, [a, def({ name: "b" })])).toContain(MARK);
  });

  it("ikut terbawa ke JSON --agents", () => {
    const j = JSON.parse(renderAgentsJson([def({ name: "rev" })]));
    expect(j.rev.prompt).toContain(MARK);
  });

});

// SPEC-881 · ADR-0136 · dorongan untuk jalur CLAUDE. Codex sudah menerima roster yang menyuruhnya
// MENGADOPSI peran; claude menerima definisinya lewat `--agents` tapi tak menerima satu pun alasan
// untuk menoleh ke sana — dan katalog yang tak pernah dipanggil sama saja dengan katalog kosong.
describe("agentDelegationClause", () => {
  const def = (name: string, description: string): AgentDef => ({
    name, description, instructions: "i", tools: null, model: null, mentions: [],
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("kosong saat tak ada agen", () => {
    expect(agentDelegationClause([])).toBe("");
  });

  it("hanya menyebut agen yang ada di roster", () => {
    const out = agentDelegationClause([def("scout", "cari kode"), def("qa-verifier", "uji")]);
    expect(out).toContain("scout");
    expect(out).toContain("qa-verifier");
    expect(out).not.toContain("blast-radius");
  });

  it("membawa deskripsi tiap agen sebagai pemicunya", () => {
    expect(agentDelegationClause([def("scout", "cari kode")])).toContain("cari kode");
  });

  it("menilai ulang smart delegation dari pekerjaan terbaru dan meminta handoff lengkap", () => {
    const agent = def("scout", "cari kode");
    agent.activation = "smart";
    const out = agentDelegationClause([agent]);
    expect(out).toContain("pekerjaan, fase, dan diff TERKINI");
    expect(out).toContain("base SHA");
    expect(out).toContain("dirty changes");
    expect(out).toContain("bukti sebelumnya");
    expect(out).toContain("kandidat yang diperiksa");
    expect(out).toContain("aturan verifikasi");
  });

  it("Codex diarahkan ke spawn_agent tanpa membawa full instructions", () => {
    const agent = def("scout", "cari kode");
    agent.instructions = "RAHASIA-INSTRUKSI-PANJANG";
    const out = agentDelegationClause([agent], "codex");
    expect(out).toContain("spawn_agent");
    expect(out).toContain("scout");
    expect(out).not.toContain("RAHASIA-INSTRUKSI-PANJANG");
  });
});
