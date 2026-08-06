import { describe, it, expect } from "vitest";
import { renderAgentsJson, agentRosterBlock, agentPromptOf, type AgentDef } from "../src/custom-agents";
import { DEFAULT_AGENT_TOOLS, MENTION_MAX_HOPS } from "@hanoman/shared";

const def = (o: Partial<AgentDef> & { name: string }): AgentDef => ({
  name: o.name,
  description: o.description ?? `deskripsi ${o.name}`,
  instructions: o.instructions ?? `instruksi ${o.name}`,
  tools: o.tools ?? null,
  model: o.model ?? null,
  mentions: o.mentions ?? [],
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
});

describe("agentRosterBlock — jalur codex", () => {
  it("daftar kosong → string kosong (tak ada yang ditempel ke prompt)", () => {
    expect(agentRosterBlock([])).toBe("");
  });

  it("memuat nama, deskripsi, dan instruksi tiap agen", () => {
    const b = agentRosterBlock([def({ name: "rev", description: "tinjau kode" })]);
    expect(b).toContain("rev");
    expect(b).toContain("tinjau kode");
    expect(b).toContain("instruksi rev");
  });

  it("menyebut allowlist mention tiap agen", () => {
    const b = agentRosterBlock([def({ name: "a", mentions: ["b"] }), def({ name: "b" })]);
    expect(b).toContain("@b");
  });

  it("diawali baris pemisah supaya bisa ditempel ke akhir prompt apa pun", () => {
    expect(agentRosterBlock([def({ name: "a" })]).startsWith("\n")).toBe(true);
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

  // Roster codex ditempel ke AKHIR prompt sesi yang sudah membawa klausa; memasangnya lagi di sini
  // menggandakan teks yang sama sekali per peran.
  it("roster codex TIDAK mengulanginya", () => {
    expect(agentRosterBlock([def({ name: "a" }), def({ name: "b" })])).not.toContain(MARK);
  });
});
