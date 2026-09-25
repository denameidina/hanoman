import { describe, it, expect } from "vitest";
import {
  BUILTIN_AGENTS, DEFAULT_AGENT_TOOLS, zCreateCustomAgent, effortsForRuntimeModel, modelsForRuntime,
} from "../src";

// Audit custom agent 2026-09-25 · §4 sintesis · 9 agen domain baru (`builtin-domain-agents.ts`).
// Katalog utama (`builtin-agents.test.ts`) sudah menegakkan invariant lintas-katalog (nama unik,
// tools ⊆ DEFAULT_AGENT_TOOLS, model dikenal katalog runtime). Berkas ini menegakkan kontrak
// KHUSUS kelompok domain: semuanya opt-in + read-only, dan profil model/effort persis sesuai putusan.

const DOMAIN_AGENT_NAMES = [
  "a11y-auditor",
  "frontend-render-auditor",
  "api-contract-auditor",
  "concurrency-hazard-hunter",
  "schema-migration-auditor",
  "layering-guard",
  "cloudflare-config-auditor",
  "vps-hardening-auditor",
  "maintainability-reviewer",
] as const;

const domainAgent = (name: string) => {
  const a = BUILTIN_AGENTS.find((entry) => entry.name === name);
  if (!a) throw new Error(`agen domain hilang dari katalog: ${name}`);
  return a;
};

describe("katalog agen domain (§4 sintesis)", () => {
  it("berisi sembilan agen bernama sesuai putusan deduplikasi", () => {
    for (const name of DOMAIN_AGENT_NAMES) expect(domainAgent(name)).toBeDefined();
  });

  it("semuanya opt-in, read-only, dan tanpa tool tulis", () => {
    for (const name of DOMAIN_AGENT_NAMES) {
      const a = domainAgent(name);
      expect(a.enabledByDefault, name).toBe(false);
      expect(a.workspacePolicy, name).toBe("read-only");
      expect(a.activation, name).toBe("smart");
      expect(a.tools, name).not.toContain("Write");
      expect(a.tools, name).not.toContain("Edit");
      expect(a.tools, name).not.toContain("Task");
    }
  });

  it("deskripsi dimulai dengan 'Gunakan saat' — pintu pemilihan claude", () => {
    for (const name of DOMAIN_AGENT_NAMES) {
      expect(domainAgent(name).description, name).toMatch(/^Gunakan saat/);
    }
  });

  it("tools setiap agen adalah subset DEFAULT_AGENT_TOOLS", () => {
    for (const name of DOMAIN_AGENT_NAMES) {
      const a = domainAgent(name);
      expect(a.tools.length, name).toBeGreaterThan(0);
      for (const t of a.tools) expect(DEFAULT_AGENT_TOOLS, `${name}: ${t}`).toContain(t);
    }
  });

  it("lolos validasi zCreateCustomAgent sebagai baris global read-only", () => {
    for (const name of DOMAIN_AGENT_NAMES) {
      const a = domainAgent(name);
      const parsed = zCreateCustomAgent.safeParse({ ...a, model: null, mentions: [], runtime: null });
      expect(parsed.success, name).toBe(true);
    }
  });

  it("profil model/effort/turn persis sesuai putusan §4", () => {
    const expected: Record<(typeof DOMAIN_AGENT_NAMES)[number], {
      effort: "low" | "medium" | "high"; maxTurns: number;
      models: { claude: string; codex: string };
    }> = {
      "a11y-auditor": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "frontend-render-auditor": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "api-contract-auditor": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "concurrency-hazard-hunter": { effort: "high", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-sol" } },
      // Keputusan manusia: schema-migration-auditor → opus (kesalahan skema jarang bisa dibatalkan).
      "schema-migration-auditor": { effort: "high", maxTurns: 30, models: { claude: "opus", codex: "gpt-5.6-sol" } },
      "layering-guard": { effort: "medium", maxTurns: 20, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "cloudflare-config-auditor": { effort: "high", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-sol" } },
      "vps-hardening-auditor": { effort: "high", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-sol" } },
      "maintainability-reviewer": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
    };
    for (const [name, spec] of Object.entries(expected)) {
      const a = domainAgent(name);
      expect(a, name).toMatchObject({ effort: spec.effort, maxTurns: spec.maxTurns, models: spec.models,
        timeoutSeconds: null });
      for (const runtime of ["claude", "codex"] as const) {
        if (runtime === "codex") expect(modelsForRuntime(runtime).map((m) => m.id), name).toContain(a.models[runtime]);
        expect(effortsForRuntimeModel(runtime, a.models[runtime]), name).toContain(a.effort);
      }
    }
  });

  it("cloudflare-config-auditor dan vps-hardening-auditor menandai perintah operator UNTUK PARENT", () => {
    // Prosedur riset asli menyuruh agen read-only menjalankan wrangler/sshd -T/nginx -t sendiri —
    // ditolak validator (`runner/src/agent-readonly.ts`: shellCommands tak memuat perintah itu).
    // Teks final harus menyerahkannya ke parent secara eksplisit, bukan menyuruh agen sendiri.
    const cloudflare = domainAgent("cloudflare-config-auditor").instructions;
    const vps = domainAgent("vps-hardening-auditor").instructions;
    for (const term of ["wrangler", "PARENT"]) expect(cloudflare, term).toContain(term);
    for (const term of ["sshd -T", "nginx -t", "systemctl", "PARENT"]) expect(vps, term).toContain(term);
  });

  it("tidak ada agen domain memakai nama yang sudah dipakai katalog inti/aplikasi", () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
