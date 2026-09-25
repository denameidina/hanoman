import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUILTIN_AGENTS, BUILTIN_AGENT_NAMES, AGENT_NAME_RE, DEFAULT_AGENT_TOOLS, zSetting, zCreateCustomAgent, effortsForRuntimeModel, modelsForRuntime,
} from "../src";

// SPEC-881 · ADR-0136 · kontrak katalog agen bawaan. Seed menulis LANGSUNG lewat Prisma dan
// MELEWATI validasi route, jadi batas-batas di bawah hanya ditegakkan di sini — kalau test ini
// tak ada, ia tak ditegakkan sama sekali.

describe("katalog agen bawaan", () => {
  it("berisi enam belas entri bernama unik", () => {
    expect(BUILTIN_AGENTS).toHaveLength(16);
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(16);
    expect(BUILTIN_AGENT_NAMES).toEqual(names);
  });

  it("delapan profile aplikasi opt-in valid untuk runtime dan model rekomendasinya", () => {
    const expected: Record<string, { policy: "read-only" | "isolated-worktree"; effort: string; maxTurns: number;
      models: { claude: string; codex: string } }> = {
      "product-designer": { policy: "isolated-worktree", effort: "medium", maxTurns: 40,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "feature-builder": { policy: "isolated-worktree", effort: "medium", maxTurns: 80,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "performance-engineer": { policy: "isolated-worktree", effort: "high", maxTurns: 40,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "product-analyst": { policy: "read-only", effort: "medium", maxTurns: 30,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      // ADR-0170-era decision: opus/gpt-5.6-sol/high/40 + Bash (spekulatif, lihat sintesis audit §5.5).
      "solution-architect": { policy: "read-only", effort: "high", maxTurns: 40,
        models: { claude: "opus", codex: "gpt-5.6-sol" } },
      "operations-engineer": { policy: "isolated-worktree", effort: "medium", maxTurns: 40,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "support-triager": { policy: "read-only", effort: "medium", maxTurns: 30,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "knowledge-maintainer": { policy: "isolated-worktree", effort: "low", maxTurns: 30,
        models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
    };
    for (const [name, spec] of Object.entries(expected)) {
      const a = BUILTIN_AGENTS.find((entry) => entry.name === name);
      expect(a, name).toBeDefined();
      if (!a) continue;
      expect(a).toMatchObject({ workspacePolicy: spec.policy, effort: spec.effort, enabledByDefault: false,
        activation: "smart", timeoutSeconds: null, maxTurns: spec.maxTurns, models: spec.models });
      expect(zCreateCustomAgent.safeParse({ ...a, model: null, mentions: [],
        runtime: spec.policy === "isolated-worktree" ? "claude" : null }).success).toBe(true);
      for (const runtime of ["claude", "codex"] as const) {
        // Claude accepts the native sonnet alias; the shared dropdown lists full IDs.
        if (runtime === "codex") expect(modelsForRuntime(runtime).map((m) => m.id)).toContain(a.models[runtime]);
        expect(effortsForRuntimeModel(runtime, a.models[runtime])).toContain(a.effort);
      }
      expect(a.tools).not.toContain("Task");
      // solution-architect is the one read-only exception: it also carries Bash (P2, sintesis §5.5).
      if (spec.policy === "read-only" && name !== "solution-architect") {
        expect(a.tools).toEqual(["Read", "Glob", "Grep", "WebFetch", "WebSearch"]);
      }
    }
    const architect = BUILTIN_AGENTS.find((a) => a.name === "solution-architect")!;
    expect(architect.tools).toEqual(["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"]);
  });

  // P0-1 · audit custom agent 2026-09-25: `gpt-5.6` (root-causer/edge-case-hunter/security-reviewer)
  // tak ada di katalog Codex manapun → recommendedModel jatuh ke null dan agen diam-diam mewarisi
  // model sesi. Ini menegakkan bahwa SETIAP rekomendasi model builtin dikenal katalog runtime-nya.
  it("setiap rekomendasi model builtin dikenal katalog runtime-nya", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(modelsForRuntime("codex").map((m) => m.id), a.name).toContain(a.models.codex);
      expect(effortsForRuntimeModel("codex", a.models.codex), a.name).toContain(a.effort);
      expect(["haiku", "sonnet", "opus"], a.name).toContain(a.models.claude);
    }
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
    expect(qa.timeoutSeconds).toBe(1800);
    expect(qa.instructions).toContain("worktree sementara");
    expect(qa.instructions).toContain("belum terbukti");
  });

  it("membawa rekomendasi model dan effort per runtime", () => {
    const scout = BUILTIN_AGENTS.find((a) => a.name === "scout")!;
    const security = BUILTIN_AGENTS.find((a) => a.name === "security-reviewer")!;
    expect(scout.models).toEqual({ claude: "haiku", codex: "gpt-5.6-terra" });
    expect(scout.effort).toBe("low");
    expect(security.models).toEqual({ claude: "sonnet", codex: "gpt-5.6-sol" });
    expect(security.effort).toBe("high");
  });

  it("memberi batas turn operasional per kelompok builtin", () => {
    const limits = Object.fromEntries(BUILTIN_AGENTS.map((a) => [a.name, a.maxTurns]));
    expect(limits).toEqual({
      scout: 20,
      "root-causer": 30,
      "qa-verifier": 40,
      "edge-case-hunter": 40,
      "blast-radius": 30,
      "spec-auditor": 30,
      "security-reviewer": 30,
      "dep-auditor": 40,
      "product-designer": 40,
      "feature-builder": 80,
      "performance-engineer": 40,
      "product-analyst": 30,
      "solution-architect": 40,
      "operations-engineer": 40,
      "support-triager": 30,
      "knowledge-maintainer": 30,
    });
  });

  it("memperbaiki aturan bukti yang terlalu absolut dan audit supply-chain", () => {
    const instructions = (name: string) => BUILTIN_AGENTS.find((a) => a.name === name)!.instructions;
    expect(instructions("qa-verifier")).toContain("test preservasi");
    expect(instructions("edge-case-hunter")).toContain("langsung hijau");
    expect(instructions("edge-case-hunter")).toContain("negative control");
    expect(instructions("blast-radius")).toContain("dampak");
    expect(instructions("blast-radius")).toContain("keyakinan");
    expect(instructions("spec-auditor")).toContain("sudah terpenuhi di base");
    expect(instructions("spec-auditor")).toContain("keadaan akhir");
    expect(instructions("security-reviewer")).toContain("belum dapat disimpulkan");
    expect(instructions("security-reviewer")).toContain("scope yang diperiksa");
    expect(instructions("dep-auditor")).toContain("versi terkunci");
    expect(instructions("dep-auditor")).toContain("tanggal pemeriksaan");
    expect(instructions("dep-auditor")).toContain("sumber primer");
    expect(instructions("dep-auditor")).toContain("ekuivalen secara fungsi");
    expect(instructions("dep-auditor")).toContain("belum terverifikasi");
  });

  // Berkas ini ikut dibundel untuk browser. `node:crypto` di sini mematikan build web, dan
  // gejalanya muncul jauh dari sini.
  it("tabelnya data murni — tanpa impor node:*", () => {
    for (const file of ["builtin-agents.ts", "builtin-app-agents.ts"]) {
      const src = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/from "node:/);
    }
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
