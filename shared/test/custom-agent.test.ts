import { describe, it, expect } from "vitest";
import {
  AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, MENTION_TOOL, MENTION_MAX_HOPS,
  customAgentId, resolveTools, detectCycle, effectiveAgents,
  mentionsOf, toolsOf, zCreateCustomAgent, type CustomAgent,
} from "../src/custom-agent";

const agent = (o: Partial<CustomAgent> & { name: string }): CustomAgent => ({
  id: customAgentId(o.projectId ?? null, o.name),
  projectId: o.projectId ?? null,
  name: o.name,
  description: o.description ?? "d",
  instructions: o.instructions ?? "i",
  tools: o.tools ?? null,
  model: o.model ?? null,
  runtime: o.runtime ?? null,
  activation: o.activation ?? "always",
  effort: o.effort ?? null,
  workspacePolicy: o.workspacePolicy ?? "inherit",
  maxTurns: o.maxTurns ?? null,
  timeoutSeconds: o.timeoutSeconds ?? null,
  mentions: o.mentions ?? null,
  enabled: o.enabled ?? true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

describe("konstanta anti-loop (ADR-0094 keputusan 6)", () => {
  it("DEFAULT_AGENT_TOOLS tak pernah memuat alat delegasi", () => {
    expect(DEFAULT_AGENT_TOOLS as readonly string[]).not.toContain(MENTION_TOOL);
  });
  it("nilainya persis seperti yang dikunci ADR", () => {
    expect(MENTION_TOOL).toBe("Task");
    expect(MENTION_MAX_HOPS).toBe(3);
    expect([...DEFAULT_AGENT_TOOLS]).toEqual(
      ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
    );
  });
});

describe("customAgentId — deterministik (ADR-0094 keputusan 2)", () => {
  it("global memakai literal 'global'", () => {
    expect(customAgentId(null, "reviewer")).toBe("global:reviewer");
  });
  it("project memakai id project", () => {
    expect(customAgentId("hanoman", "reviewer")).toBe("hanoman:reviewer");
  });
  it("dua mesin yang membuat nama sama menghasilkan id yang SAMA", () => {
    expect(customAgentId(null, "reviewer")).toBe(customAgentId(null, "reviewer"));
  });
});

describe("AGENT_NAME_RE", () => {
  it.each(["reviewer", "sec-audit", "a1", "x-9-y"])("menerima %s", (n) => {
    expect(AGENT_NAME_RE.test(n)).toBe(true);
  });
  it.each(["A", "1a", "-a", "a_", "a", "ab*", "", "a".repeat(41)])("menolak %s", (n) => {
    expect(AGENT_NAME_RE.test(n)).toBe(false);
  });
});

describe("resolveTools — lapis 2 anti-loop (ADR-0094 keputusan 5)", () => {
  it("daun tanpa tools → DEFAULT tanpa Task", () => {
    expect(resolveTools({})).toEqual([...DEFAULT_AGENT_TOOLS]);
    expect(resolveTools({})).not.toContain("Task");
  });
  it("daun DENGAN tools → tools operator dikurangi Task", () => {
    expect(resolveTools({ tools: ["Read", "Task", "Bash"] })).toEqual(["Read", "Bash"]);
  });
  it("agen ber-mentions tanpa tools → DEFAULT + Task", () => {
    expect(resolveTools({ mentions: ["b"] })).toEqual([...DEFAULT_AGENT_TOOLS, "Task"]);
  });
  it("agen ber-mentions DENGAN tools → tools operator + Task, tanpa duplikat", () => {
    expect(resolveTools({ tools: ["Read", "Task"], mentions: ["b"] })).toEqual(["Read", "Task"]);
  });
  it("mentions kosong (array) diperlakukan sebagai daun", () => {
    expect(resolveTools({ tools: ["Task"], mentions: [] })).toEqual([]);
  });
});

describe("detectCycle — lapis 1 anti-loop", () => {
  it("graf asiklik → null", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["c"] },
      { name: "c", mentions: [] },
    ])).toBeNull();
  });
  it("self-loop terdeteksi", () => {
    expect(detectCycle([{ name: "a", mentions: ["a"] }])).toEqual(["a", "a"]);
  });
  it("siklus dua simpul terdeteksi", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["a"] },
    ])).toEqual(["a", "b", "a"]);
  });
  it("siklus tak langsung terdeteksi", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b"] },
      { name: "b", mentions: ["c"] },
      { name: "c", mentions: ["a"] },
    ])).toEqual(["a", "b", "c", "a"]);
  });
  it("diamond (dua jalur ke satu simpul) BUKAN siklus", () => {
    expect(detectCycle([
      { name: "a", mentions: ["b", "c"] },
      { name: "b", mentions: ["d"] },
      { name: "c", mentions: ["d"] },
      { name: "d", mentions: [] },
    ])).toBeNull();
  });
  it("mention ke nama yang tak ada diabaikan (validasi rujukan bukan tugasnya)", () => {
    expect(detectCycle([{ name: "a", mentions: ["hantu"] }])).toBeNull();
  });
});

describe("effectiveAgents — project menimpa global", () => {
  it("menggabungkan keduanya", () => {
    const out = effectiveAgents([agent({ name: "g" })], [agent({ name: "p", projectId: "x" })]);
    expect(out.map((a) => a.name).sort()).toEqual(["g", "p"]);
  });
  it("agen project menimpa global bernama sama", () => {
    const out = effectiveAgents(
      [agent({ name: "rev", instructions: "GLOBAL" })],
      [agent({ name: "rev", projectId: "x", instructions: "PROJECT" })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.instructions).toBe("PROJECT");
  });
  it("agen project yang DIMATIKAN menyembunyikan global bernama sama", () => {
    const out = effectiveAgents(
      [agent({ name: "rev" })],
      [agent({ name: "rev", projectId: "x", enabled: false })],
    );
    expect(out).toHaveLength(0);
  });
  it("agen global yang dimatikan tak ikut", () => {
    expect(effectiveAgents([agent({ name: "g", enabled: false })], [])).toHaveLength(0);
  });
  it("urutannya stabil menurut nama", () => {
    const out = effectiveAgents([agent({ name: "z" }), agent({ name: "a" })], []);
    expect(out.map((a) => a.name)).toEqual(["a", "z"]);
  });
});

describe("pembacaan defensif kolom Json (datang dari sync mesin lain)", () => {
  it("mentionsOf membuang non-array, non-string, dan duplikat", () => {
    expect(mentionsOf(null)).toEqual([]);
    expect(mentionsOf("bukan array")).toEqual([]);
    expect(mentionsOf(["a", 1, "a", null, "b"])).toEqual(["a", "b"]);
  });
  it("toolsOf membedakan 'tak diisi' (null) dari 'sengaja kosong' ([])", () => {
    expect(toolsOf(null)).toBeNull();
    expect(toolsOf(undefined)).toBeNull();
    expect(toolsOf([])).toEqual([]);
    expect(toolsOf(["Read", 2, "Read"])).toEqual(["Read"]);
  });
});

describe("zCreateCustomAgent", () => {
  it("menerima payload minimal", () => {
    const r = zCreateCustomAgent.safeParse({ name: "rev", description: "d", instructions: "i" });
    expect(r.success).toBe(true);
  });
  it("menolak nama yang tak sesuai slug", () => {
    const r = zCreateCustomAgent.safeParse({ name: "Rev", description: "d", instructions: "i" });
    expect(r.success).toBe(false);
  });
  it("menolak deskripsi kosong — claude memakainya untuk MEMILIH agen", () => {
    const r = zCreateCustomAgent.safeParse({ name: "rev", description: "  ", instructions: "i" });
    expect(r.success).toBe(false);
  });
  it("menerima effort runtime masa depan yang bentuknya sah", () => {
    const r = zCreateCustomAgent.safeParse({
      name: "rev", description: "d", instructions: "i", effort: "turbo",
    });
    expect(r.success).toBe(true);
  });
});
