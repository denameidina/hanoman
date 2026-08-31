import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUILTIN_AGENTS, BUILTIN_AGENT_NAMES, AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, zSetting,
} from "../src";

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

  it("hanya tiga agen read-only menyala secara default", () => {
    const on = BUILTIN_AGENTS.filter((a) => a.enabledByDefault).map((a) => a.name).sort();
    expect(on).toEqual(["blast-radius", "scout", "security-reviewer"]);
    for (const agent of BUILTIN_AGENTS.filter((a) => a.enabledByDefault)) {
      expect(agent.activation).toBe("smart");
      expect(agent.workspacePolicy).toBe("read-only");
      expect(agent.tools).not.toContain("Write");
      expect(agent.tools).not.toContain("Edit");
    }
  });

  it("qa-verifier opt-in selalu meminta worktree terisolasi dan batas kerja", () => {
    const qa = BUILTIN_AGENTS.find((a) => a.name === "qa-verifier")!;
    expect(qa.enabledByDefault).toBe(false);
    expect(qa.activation).toBe("smart");
    expect(qa.workspacePolicy).toBe("isolated-worktree");
    expect(qa.maxTurns).toBe(40);
    expect(qa.timeoutSeconds).toBe(900);
    expect(qa.instructions).toContain("worktree sementara");
    expect(qa.instructions).toContain("belum terbukti");
  });

  it("membawa rekomendasi model dan effort per runtime", () => {
    const scout = BUILTIN_AGENTS.find((a) => a.name === "scout")!;
    const security = BUILTIN_AGENTS.find((a) => a.name === "security-reviewer")!;
    expect(scout.models).toEqual({ claude: "haiku", codex: "gpt-5.6-terra" });
    expect(scout.effort).toBe("low");
    expect(security.models).toEqual({ claude: "sonnet", codex: "gpt-5.6" });
    expect(security.effort).toBe("high");
  });

  // Berkas ini ikut dibundel untuk browser. `node:crypto` di sini mematikan build web, dan
  // gejalanya muncul jauh dari sini.
  it("tabelnya data murni — tanpa impor node:*", () => {
    const src = readFileSync(new URL("../src/builtin-agents.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from "node:/);
  });
});

describe("bookkeeping sidik jari di zSetting", () => {
  // Tiga field ini tak punya `.default()`, jadi `parse({})` gagal karena mereka — bukan karena
  // field yang sedang diuji. Basis minimal ini yang membuat testnya menguji apa yang dimaksud.
  const base = { autoDefault: true, autoScaffold: true, notifyFail: true };

  // Zod MEMBUANG kunci tak dikenal, dan `PUT /settings` menulis balik hasil parse. Kalau field ini
  // tak dideklarasikan, seluruh bookkeeping lenyap diam-diam di penyimpanan Settings pertama — dan
  // seed lalu menganggap SEMUA baris belum pernah disunting, lalu menimpa kerja operator.
  it("bertahan melewati parse", () => {
    const parsed = zSetting.parse({ ...base, builtinAgents: { scout: "abc123" } });
    expect(parsed.builtinAgents).toEqual({ scout: "abc123" });
  });

  it("default objek kosong saat absen", () => {
    expect(zSetting.parse(base).builtinAgents).toEqual({});
    expect(zSetting.parse(base).builtinAgentPolicies).toEqual({});
  });

  it("bentuk asing ditolak, tidak diterima diam-diam", () => {
    expect(zSetting.safeParse({ ...base, builtinAgents: "bukan objek" }).success).toBe(false);
    expect(zSetting.safeParse({ ...base, builtinAgentPolicies: "bukan objek" }).success).toBe(false);
  });
});
