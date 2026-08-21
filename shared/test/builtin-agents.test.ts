import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BUILTIN_AGENTS, BUILTIN_AGENT_NAMES, AGENT_NAME_RE, DEFAULT_AGENT_TOOLS } from "../src";

// SPEC-881 · ADR-0136 · kontrak katalog agen bawaan. Seed menulis LANGSUNG lewat Prisma dan
// MELEWATI validasi route, jadi batas-batas di bawah hanya ditegakkan di sini — kalau test ini
// tak ada, ia tak ditegakkan sama sekali.

describe("katalog agen bawaan", () => {
  it("berisi delapan entri bernama unik", () => {
    expect(BUILTIN_AGENTS).toHaveLength(8);
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(8);
    expect(BUILTIN_AGENT_NAMES).toEqual(names);
  });

  it("setiap nama lolos AGENT_NAME_RE", () => {
    for (const a of BUILTIN_AGENTS) expect(a.name).toMatch(AGENT_NAME_RE);
  });

  // ADR-0094 M4 · nama tool tak dikenal DIBUANG claude tanpa satu pun pesan → agen tanpa alat,
  // exit 0, tanpa keluhan. Nama MCP dilarang: ia berbeda per mesin, dan validasi keras ADR-0101
  // akan menolaknya di mesin yang tak punya server itu.
  it("setiap tool adalah anggota DEFAULT_AGENT_TOOLS", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.tools.length).toBeGreaterThan(0);
      for (const t of a.tools) expect(DEFAULT_AGENT_TOOLS).toContain(t);
    }
  });

  it("description & instructions ada di dalam batas zCreateCustomAgent", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.description.trim().length).toBeGreaterThan(0);
      expect(a.description.length).toBeLessThanOrEqual(500);
      expect(a.instructions.trim().length).toBeGreaterThan(0);
      expect(a.instructions.length).toBeLessThanOrEqual(20_000);
    }
  });

  it("tepat empat menyala secara default", () => {
    const on = BUILTIN_AGENTS.filter((a) => a.enabledByDefault).map((a) => a.name).sort();
    expect(on).toEqual(["blast-radius", "qa-verifier", "scout", "security-reviewer"]);
  });

  // Berkas ini ikut dibundel untuk browser. `node:crypto` di sini mematikan build web, dan
  // gejalanya muncul jauh dari sini.
  it("tabelnya data murni — tanpa impor node:*", () => {
    const src = readFileSync(new URL("../src/builtin-agents.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "node:/);
  });
});
