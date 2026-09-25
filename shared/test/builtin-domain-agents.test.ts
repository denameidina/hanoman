import { describe, it, expect } from "vitest";
import {
  BUILTIN_AGENTS, DEFAULT_AGENT_TOOLS, zCreateCustomAgent, effortsForRuntimeModel, modelsForRuntime,
} from "../src";

// Audit custom agent 2026-09-25 · koreksi 2026-09-25 · katalog agen domain
// (`builtin-domain-agents.ts`): lima PENGERJA isolated-worktree + empat auditor read-only pasangan
// review-nya. Katalog utama (`builtin-agents.test.ts`) sudah menegakkan invariant lintas-katalog
// (nama unik, tools ⊆ DEFAULT_AGENT_TOOLS, model dikenal katalog runtime). Berkas ini menegakkan
// kontrak KHUSUS kelompok domain, termasuk yang membedakan pengerja dari auditor.

const ENGINEER_AGENT_NAMES = [
  "frontend-engineer",
  "backend-engineer",
  "database-engineer",
  "cloudflare-engineer",
  "vps-engineer",
] as const;

const AUDITOR_AGENT_NAMES = [
  "a11y-auditor",
  "api-contract-auditor",
  "schema-migration-auditor",
  "cloudflare-config-auditor",
] as const;

const DOMAIN_AGENT_NAMES = [...ENGINEER_AGENT_NAMES, ...AUDITOR_AGENT_NAMES] as const;

// Keputusan manusia (koreksi 2026-09-25): agen infra berwewenang PENUH mengubah produksi TANPA
// gerbang izin tambahan — beda dari `operations-engineer`, yang wajib mengutip otorisasi eksplisit
// dan berhenti dengan frasa ini bila tak ada. Instruksi infra harus TIDAK memuat frasa gerbang izin
// itu; disiplinnya lewat prosedur operasi (rollback/validasi/verifikasi), bukan gerbang persetujuan.
const PERMISSION_GATE_PHRASES = ["menunggu-keputusan", "kutip kalimat otorisasi"];

const domainAgent = (name: string) => {
  const a = BUILTIN_AGENTS.find((entry) => entry.name === name);
  if (!a) throw new Error(`agen domain hilang dari katalog: ${name}`);
  return a;
};

describe("katalog agen domain (koreksi 2026-09-25: agen pengerja domain)", () => {
  it("berisi sembilan agen: lima pengerja + empat auditor pasangannya", () => {
    for (const name of DOMAIN_AGENT_NAMES) expect(domainAgent(name)).toBeDefined();
    expect(DOMAIN_AGENT_NAMES).toHaveLength(9);
  });

  it("lima pengerja domain: isolated-worktree, tools tulis, opt-in, Claude saja secara efektif", () => {
    for (const name of ENGINEER_AGENT_NAMES) {
      const a = domainAgent(name);
      expect(a.enabledByDefault, name).toBe(false);
      expect(a.workspacePolicy, name).toBe("isolated-worktree");
      expect(a.activation, name).toBe("smart");
      expect(a.tools, name).toContain("Write");
      expect(a.tools, name).toContain("Edit");
      expect(a.tools, name).toContain("Bash");
      expect(a.tools, name).not.toContain("Task");
    }
  });

  it("empat auditor domain: read-only, tanpa tool tulis, opt-in", () => {
    for (const name of AUDITOR_AGENT_NAMES) {
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

  it("lolos validasi zCreateCustomAgent sebagai baris global (isolated-worktree wajib runtime claude)", () => {
    for (const name of DOMAIN_AGENT_NAMES) {
      const a = domainAgent(name);
      const runtime = a.workspacePolicy === "isolated-worktree" ? "claude" : null;
      const parsed = zCreateCustomAgent.safeParse({ ...a, model: null, mentions: [], runtime });
      expect(parsed.success, name).toBe(true);
    }
  });

  it("profil model/effort/turn persis sesuai keputusan koreksi", () => {
    const expected: Record<(typeof DOMAIN_AGENT_NAMES)[number], {
      effort: "low" | "medium" | "high"; maxTurns: number;
      models: { claude: string; codex: string };
    }> = {
      "frontend-engineer": { effort: "medium", maxTurns: 80, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "backend-engineer": { effort: "medium", maxTurns: 80, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      // Keputusan manusia: database-engineer → opus (kesalahan skema/migration jarang bisa dibatalkan).
      "database-engineer": { effort: "high", maxTurns: 60, models: { claude: "opus", codex: "gpt-5.6-terra" } },
      "cloudflare-engineer": { effort: "high", maxTurns: 60, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "vps-engineer": { effort: "high", maxTurns: 60, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "a11y-auditor": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "api-contract-auditor": { effort: "medium", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-terra" } },
      "schema-migration-auditor": { effort: "high", maxTurns: 30, models: { claude: "opus", codex: "gpt-5.6-sol" } },
      "cloudflare-config-auditor": { effort: "high", maxTurns: 30, models: { claude: "sonnet", codex: "gpt-5.6-sol" } },
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

  it("cloudflare-config-auditor menandai perintah operator UNTUK PARENT (auditor tetap read-only)", () => {
    // Prosedur riset asli menyuruh agen read-only menjalankan wrangler sendiri — ditolak validator
    // (`runner/src/agent-readonly.ts`: shellCommands tak memuat perintah itu). Teks final harus
    // menyerahkannya ke parent secara eksplisit, bukan menyuruh agen sendiri.
    const cloudflare = domainAgent("cloudflare-config-auditor").instructions;
    for (const term of ["wrangler", "PARENT"]) expect(cloudflare, term).toContain(term);
  });

  it("cloudflare-engineer dan vps-engineer: wewenang produksi penuh, TANPA frasa gerbang izin tambahan", () => {
    for (const name of ["cloudflare-engineer", "vps-engineer"]) {
      const instructions = domainAgent(name).instructions;
      expect(instructions, name).toMatch(/produksi/);
      expect(instructions, name).toMatch(/rollback/i);
      for (const phrase of PERMISSION_GATE_PHRASES) {
        expect(instructions, `${name} tidak boleh memuat "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("cloudflare-engineer memvalidasi statis sebelum menerapkan (dry-run) dan menyebut kredensial/Status: terhalang", () => {
    const instructions = domainAgent("cloudflare-engineer").instructions;
    for (const term of ["--dry-run", "rollback", "Status: terhalang", "CLOUDFLARE_API_TOKEN"]) {
      expect(instructions, term).toContain(term);
    }
  });

  it("vps-engineer memvalidasi statis sebelum menerapkan dan menyebut kredensial/Status: terhalang", () => {
    const instructions = domainAgent("vps-engineer").instructions;
    for (const term of ["sshd -t", "systemd-analyze verify", "Status: terhalang", "~/.ssh/config"]) {
      expect(instructions, term).toContain(term);
    }
  });

  // Temuan review 2026-09-25 (r3): kunci prosedur keselamatan produksi, bukan gerbang izin baru.
  it("cloudflare-engineer: D1 export produksi wajib --remote (tanpa itu wrangler mengekspor DB lokal kosong)", () => {
    const instructions = domainAgent("cloudflare-engineer").instructions;
    expect(instructions).toMatch(/d1 export <db> --remote --output/);
  });

  it("cloudflare-engineer: rollback dan deployments list memuat --env (bukan Worker tingkat atas)", () => {
    const instructions = domainAgent("cloudflare-engineer").instructions;
    expect(instructions).toMatch(/deployments list --env/);
    expect(instructions).toMatch(/wrangler rollback <version-id> --env <env> --message/);
  });

  it("cloudflare-engineer: migrasi Durable Object tanpa rollback wajib dilaporkan sebelum diterapkan", () => {
    const instructions = domainAgent("cloudflare-engineer").instructions;
    expect(instructions).toMatch(/TIDAK BISA di-rollback/);
  });

  it("cloudflare-engineer: produksi hanya di-deploy dari commit bersih", () => {
    const instructions = domainAgent("cloudflare-engineer").instructions;
    expect(instructions).toMatch(/git status --porcelain.*kosong/);
  });

  it("vps-engineer: port SSH diizinkan sebelum default deny/ufw enable, dengan auto-revert berjangka", () => {
    const instructions = domainAgent("vps-engineer").instructions;
    expect(instructions).toMatch(/IZINKAN port SSH.*SEBELUM.*default deny/);
    expect(instructions).toMatch(/auto-revert berjangka/);
  });

  it("cloudflare-engineer dan vps-engineer: aturan secret stdin/env, bukan literal argv, dump 0600 di luar worktree", () => {
    for (const name of ["cloudflare-engineer", "vps-engineer"]) {
      const instructions = domainAgent(name).instructions;
      expect(instructions, name).toMatch(/TIDAK PERNAH literal di argv/);
      expect(instructions, name).toMatch(/0600/);
      expect(instructions, name).toMatch(/tampilkan nama key saja/);
    }
  });

  it("agen pengerja domain menyebut pasangan review auditornya (kecuali vps-engineer, auditornya dicabut)", () => {
    expect(domainAgent("backend-engineer").instructions).toContain("api-contract-auditor");
    expect(domainAgent("database-engineer").instructions).toContain("schema-migration-auditor");
    expect(domainAgent("cloudflare-engineer").description).toContain("cloudflare-config-auditor");
  });

  it("tidak ada agen domain memakai nama yang sudah dipakai katalog inti/aplikasi", () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lima auditor yang dicabut (belum pernah dirilis/di-seed) tidak lagi ada di katalog", () => {
    const cabut = [
      "frontend-render-auditor",
      "concurrency-hazard-hunter",
      "layering-guard",
      "vps-hardening-auditor",
      "maintainability-reviewer",
    ];
    const names = new Set(BUILTIN_AGENTS.map((a) => a.name));
    for (const name of cabut) expect(names.has(name), name).toBe(false);
  });
});
