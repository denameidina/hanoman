import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  loadCustomAgents, agentDefsFor, validateGraph, unknownMentions, toDef,
} from "../src/services/custom-agents";
import { customAgentId } from "@hanoman/shared";

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "web" } });
});
afterAll(clean);

const mk = (projectId: string | null, name: string, extra: Record<string, unknown> = {}) =>
  prisma.customAgent.create({ data: {
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", ...extra,
  } as never });

describe("agentDefsFor — resolusi scope (sinkron, dari cache)", () => {
  it("project mendapat agen global + agen project-nya sendiri", async () => {
    await mk(null, "glob");
    await mk("p1", "lokal");
    await mk("p2", "asing");
    await loadCustomAgents();
    expect(agentDefsFor("p1", "claude").map((a) => a.name)).toEqual(["glob", "lokal"]);
  });

  it("agen project menimpa global bernama sama", async () => {
    await mk(null, "rev", { instructions: "GLOBAL" });
    await mk("p1", "rev", { instructions: "PROJECT" });
    await loadCustomAgents();
    const defs = agentDefsFor("p1", "claude");
    expect(defs).toHaveLength(1);
    expect(defs[0]!.instructions).toBe("PROJECT");
    expect(agentDefsFor("p2", "claude")[0]!.instructions).toBe("GLOBAL");
  });

  it("agen yang dimatikan tak ikut", async () => {
    await mk(null, "mati", { enabled: false });
    await loadCustomAgents();
    expect(agentDefsFor("p1", "claude")).toHaveLength(0);
  });

  it("project tanpa agen apa pun mengembalikan daftar kosong", async () => {
    await loadCustomAgents();
    expect(agentDefsFor("p1", "claude")).toEqual([]);
  });

  it("projectId sintetis (sesi VPS) tak meledak — global tetap terbawa", async () => {
    await mk(null, "glob");
    await loadCustomAgents();
    expect(agentDefsFor("vps:9", "claude").map((a) => a.name)).toEqual(["glob"]);
  });

  it("kolom Json rusak dari sync dibaca defensif", async () => {
    await mk(null, "a", { mentions: "bukan array", tools: 42 });
    await loadCustomAgents();
    const d = agentDefsFor("p1", "claude")[0]!;
    expect(d.mentions).toEqual([]);
    expect(d.tools).toBeNull();
  });
});

describe("validateGraph — lapis 1 anti-loop, LINTAS SCOPE (ADR-0094 gotcha 2)", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null,
    mentions, runtime: null, enabled: true,
  });

  it("graf asiklik → null", () => {
    expect(validateGraph([row(null, "a", ["b"]), row(null, "b", [])])).toBeNull();
  });

  it("siklus di scope global terdeteksi", () => {
    const r = validateGraph([row(null, "a", ["b"]), row(null, "b", ["a"])]);
    expect(r?.scope).toBe("global");
    expect(r?.cycle).toEqual(["a", "b", "a"]);
  });

  it("SIKLUS YANG HANYA MUNCUL SAAT PROJECT MENIMPA GLOBAL terdeteksi", () => {
    // global: g -> h (asiklik). project p1 menimpa `h` dengan versi yang menunjuk balik ke g.
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", []),
      row("p1", "h", ["g"]),
    ]);
    expect(r?.scope).toBe("p1");
    expect(r?.cycle).toEqual(["g", "h", "g"]);
  });

  it("agen project yang DIMATIKAN memutus siklus (ia menyembunyikan global)", () => {
    const r = validateGraph([
      row(null, "g", ["h"]),
      row(null, "h", ["g"]),
      { ...row("p1", "h", []), enabled: false },
    ]);
    expect(r?.scope).toBe("global"); // global tetap pecah; p1 tidak
  });
});

describe("unknownMentions", () => {
  const row = (projectId: string | null, name: string, mentions: string[]) => ({
    id: customAgentId(projectId, name), projectId, name,
    description: "d", instructions: "i", tools: null, model: null, mentions, runtime: null, enabled: true,
  });

  it("agen global hanya boleh menyebut agen global", () => {
    const all = [row(null, "g", ["lokal"]), row("p1", "lokal", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["lokal"]);
  });

  it("agen project boleh menyebut agen project DAN global", () => {
    const all = [row(null, "g", []), row("p1", "a", ["g", "b"]), row("p1", "b", [])];
    expect(unknownMentions(all[1]!, all)).toEqual([]);
  });

  it("nama yang benar-benar tak ada dilaporkan", () => {
    const all = [row("p1", "a", ["hantu"])];
    expect(unknownMentions(all[0]!, all)).toEqual(["hantu"]);
  });

  it("agen project tak bisa menyebut agen project LAIN", () => {
    const all = [row("p1", "a", ["asing"]), row("p2", "asing", [])];
    expect(unknownMentions(all[0]!, all)).toEqual(["asing"]);
  });
});

describe("toDef", () => {
  it("memetakan baris DB ke bentuk render runner", () => {
    const d = toDef({
      id: "global:a", projectId: null, name: "a", description: "desc",
      instructions: "ins", tools: ["Read"], model: "haiku", mentions: ["b"], runtime: null,
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 40, timeoutSeconds: 900, enabled: true,
    });
    expect(d).toEqual({
      id: "global:a", name: "a", description: "desc", instructions: "ins",
      tools: ["Read"], model: "haiku", mentions: ["b"],
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 40, timeoutSeconds: 900,
    });
  });
});

// SPEC-484 · ADR-0101 · penyaring runtime + ekspansi `*`, keduanya di `agentDefsFor`.
describe("agentDefsFor · penyaring runtime & ekspansi *", () => {
  beforeEach(async () => {
    await prisma.customAgent.deleteMany();
    await prisma.customAgent.create({ data: {
      id: "global:warisi", projectId: null, name: "warisi", description: "d", instructions: "i",
      mentions: [] as never, runtime: null,
    } });
    await prisma.customAgent.create({ data: {
      id: "global:hanya-claude", projectId: null, name: "hanya-claude", description: "d", instructions: "i",
      mentions: [] as never, runtime: "claude",
    } });
    await prisma.customAgent.create({ data: {
      id: "global:hanya-codex", projectId: null, name: "hanya-codex", description: "d", instructions: "i",
      mentions: [] as never, runtime: "codex",
    } });
    await loadCustomAgents();
  });

  it("sesi claude melihat warisi + hanya-claude", () => {
    expect(agentDefsFor("p1", "claude").map((d) => d.name).sort())
      .toEqual(["hanya-claude", "warisi"]);
  });

  it("sesi codex melihat warisi + hanya-codex", () => {
    expect(agentDefsFor("p1", "codex").map((d) => d.name).sort())
      .toEqual(["hanya-codex", "warisi"]);
  });

  it("runtime asing dari sync dibaca sebagai warisi, bukan disaring habis", async () => {
    await prisma.customAgent.update({ where: { id: "global:warisi" }, data: { runtime: "gemini" } });
    await loadCustomAgents();
    expect(agentDefsFor("p1", "claude").map((d) => d.name)).toContain("warisi");
    expect(agentDefsFor("p1", "codex").map((d) => d.name)).toContain("warisi");
  });

  it("tools ['*'] di-EXPAND jadi daftar eksplisit, tak pernah diteruskan apa adanya", async () => {
    await prisma.customAgent.update({ where: { id: "global:warisi" }, data: { tools: ["*"] as never } });
    await loadCustomAgents();
    const def = agentDefsFor("p1", "claude").find((d) => d.name === "warisi")!;
    expect(def.tools).not.toBeNull();
    expect(def.tools).not.toContain("*");
    expect(def.tools).toContain("Read");
  });
});
