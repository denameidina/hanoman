# Orkestrasi Subagent per Fase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sesi interaktif hanoman menjadi orchestrator; setiap fase flow dikerjakan subagent native `hanoman-fase-<slug>` dengan model/effort per fase dari `Setting.orchestration`, terlihat di chip `PhaseStrip` dan baris subagent TUI claude.

**Architecture:** `shared` memiliki daftar fase (`FLOW_PHASES`), skema `Setting.orchestration`, dan resolver murni `resolvePhasePlan`. `runner` merakit definisi agen fase (`buildPhaseAgents`) dan klausa orchestrator di delapan pembangun prompt. `server` menyerahkan prompt orchestrator + agen fase + prompt lama ke `createSession`, yang merender agen fase lewat renderer native custom agent (all-or-nothing), mencatat bukti invocation ber-`phase`/`effort`, dan memperkaya frame `phase`. Frontend menambah tab Settings, pratinjau modal Start, dan chip fase.

**Tech Stack:** TypeScript strict · zod 3.23 · vitest 2 · Fastify · Prisma 6 (SQLite) · React + Vite · tmux · Claude Code 2.1.270 · Codex CLI 0.154.0

**Spec:** `docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md`

## Global Constraints

- Flow yang saklarnya mati, atau runtime tanpa agen native: argv & prompt **byte-identik** dengan sebelum plan ini (dijaga golden test Task 2).
- Nama agen fase `hanoman-fase-<slug>`; `AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,39}$/`; nama custom agent berawalan `hanoman-fase-` ditolak.
- Codex native agent butuh client `>=0.151.0`.
- Delegasi fase gagal diulang tepat **1×**, lalu `AskUserQuestion`.
- Tenggang bukti subagent: `60_000` ms.
- Satu-satunya perubahan skema DB: `AgentInvocation.phase String?`, `AgentInvocation.effort String?` (migration). `Setting.orchestration` hidup di `Setting.data` Json tanpa migration. Tanpa endpoint baru.
- Orchestrator wajib mengisi deskripsi pemanggilan subagent persis `Fase <Nama Fase>` — stdin `subagentStatusLine` claude hanya membawa `label` (= deskripsi), `model`, `effort`, `startTime` (epoch ms), `tokenCount`; **tak ada nama agen** (terukur probe 2026-09-14).
- Komentar kode berbahasa Indonesia, kepadatan setara kode sekitar; keputusan baru dirujuk sebagai `ADR-0164`.
- Git di worktree ini: `/usr/bin/git` (hook rtk menolak `git` di sesi worktree). `git add <path eksplisit>` — **jangan** `-A`, **jangan** `git stash`.
- Resep test (mesin ini menjalankan banyak sesi; jalankan serial, jangan paralel antar-task):
  `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism <path…>`
- Typecheck hanya paket tersentuh: `rtk proxy pnpm --filter ./<paket> typecheck` (`shared`, `runner`, `server`, `src`).

## Peta berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/orchestration.ts` (baru) | Konstanta & tipe tanpa impor: `ORCHESTRATION_FLOWS`, `FLOW_PHASES`, `phaseAgentName`, `PhasePlan` |
| `shared/src/orchestration-plan.ts` (baru) | `resolvePhasePlan`, gerbang `codexNativeAgentsSupported` |
| `shared/src/entities.ts` | Skema `zOrchestration` + `Setting.orchestration` |
| `shared/src/custom-agent.ts` | Awalan `hanoman-fase-` dicadangkan |
| `runner/src/prompt.ts` | Potongan prompt diekspor, blok konteks, `orchestratorClause`, parameter `plan` di 8 pembangun |
| `runner/src/phase-agents.ts` (baru) | `buildPhaseAgents` — instruksi per fase |
| `runner/src/custom-agents.ts` · `codex-agent-config.ts` · `agent-definition.ts` | Renderer mengenal `kind: "phase"` |
| `runner/src/subagent-statusline.ts` (baru) · `settings.ts` · `agent-cli.ts` | `subagentStatusLine` claude |
| `server/src/services/pty.ts` | Materialisasi all-or-nothing, opsi tmux, roster ber-fase, cache invocation fase |
| `server/src/services/orchestration.ts` (baru) | `sessionPhasePlan` — satu titik resolusi untuk semua pemanggil |
| `server/src/services/session-launch.ts` · `routes/terminal.ts` | Pemanggil merakit prompt + agen fase + prompt lama |
| `server/src/services/session-phases.ts` | `enrichPhases` murni |
| `server/src/services/agent-invocations.ts` · `phase-invocations.ts` (baru) · `routes/session-events.ts` | Bukti `phase`/`effort`, siaran ulang |
| `server/prisma/**` | Migration kolom `phase`/`effort` |
| `src/src/api/client.ts` · `screens/phase-chip.ts` (baru) · `screens/TerminalScreen.tsx` | Chip fase & chip orchestrator |
| `src/src/screens/OrchestrationPanel.tsx` (baru) · `SettingsScreen.tsx` | Tab Orkestrasi |
| `src/src/screens/PhasePlanPreview.tsx` (baru) · `App.tsx` | Pratinjau modal Start |
| `internal/docs/**` · `internal/skills/hanoman/SKILL.md` | ADR-0164 & docs tersentuh |

---

### Task 1: Fondasi `shared` — daftar fase, skema `Setting.orchestration`, resolver

**Files:**
- Create: `shared/src/orchestration.ts`
- Create: `shared/src/orchestration-plan.ts`
- Create: `shared/src/orchestration.test.ts`
- Modify: `shared/src/entities.ts` (skema sebelum `export const zSetting`, field di `zSetting`)
- Modify: `shared/src/index.ts`
- Modify: `runner/src/prompt.ts:1-27` (`PIPELINES`)
- Modify: `runner/src/codex-agent-config.ts:1-13`
- Modify: `runner/test/method-phases.test.ts`
- Modify: `server/src/services/settings.ts:2-31`
- Modify: `src/src/screens/SettingsScreen.tsx:6,42-64`

**Interfaces:**
- Consumes: `cmpVersion`, `coerceClaudeEffort`, `coerceCodexEffort` dari `shared/src/entities.ts`.
- Produces:
  ```ts
  // shared/src/orchestration.ts
  export const ORCHESTRATION_FLOWS: readonly ["feature","qa","scaffold","reverse","prd","audit","breakdown","goal","no_effort"];
  export type OrchestrationFlow = (typeof ORCHESTRATION_FLOWS)[number];
  export const FLOW_PHASES: Readonly<Record<OrchestrationFlow, readonly string[]>>;
  export const PHASE_AGENT_PREFIX = "hanoman-fase-";
  export function phaseAgentName(phase: string): string;
  export const isPhaseAgentName: (name: string) => boolean;
  export const PHASE_EVIDENCE_GRACE_MS = 60_000;
  export type PhasePlanEntry = { phase: string; agentName: string; model: string; effort: string };
  export type PhasePlan = { flow: OrchestrationFlow; runtime: "claude" | "codex"; phases: PhasePlanEntry[] };
  // shared/src/entities.ts
  export type PhaseCell = { model: string | null; effort: string | null };
  export type FlowOrchestration = { enabled: boolean; claude: Record<string, PhaseCell>; codex: Record<string, PhaseCell> };
  export type Orchestration = Record<OrchestrationFlow, FlowOrchestration>;
  export const ORCHESTRATION_DEFAULTS: Orchestration;   // Setting.orchestration
  // shared/src/orchestration-plan.ts
  export const CODEX_NATIVE_AGENTS_MIN_CLIENT = "0.151.0";
  export function codexNativeAgentsSupported(version: string | null): boolean;
  export type PhasePlanInput = { flow: OrchestrationFlow; runtime: "claude" | "codex";
    orchestration: Orchestration | undefined; orchestrator: { model: string; effort: string }; nativeAgents: boolean };
  export function resolvePhasePlan(input: PhasePlanInput): PhasePlan | null;
  ```

- [x] **Step 0: Pasang dependensi worktree**

Run: `rtk proxy pnpm install`
Expected: selesai tanpa error (postinstall `server` men-generate Prisma Client).

- [x] **Step 1: Tulis test yang gagal** — `shared/src/orchestration.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  FLOW_PHASES, ORCHESTRATION_FLOWS, PHASE_AGENT_PREFIX, isPhaseAgentName, phaseAgentName,
} from "./orchestration";
import { codexNativeAgentsSupported, resolvePhasePlan } from "./orchestration-plan";
import { ORCHESTRATION_DEFAULTS, zOrchestration, zSetting } from "./entities";
import { AGENT_NAME_RE } from "./custom-agent";

const orchestrator = { model: "claude-opus-5", effort: "xhigh" };

describe("FLOW_PHASES (ADR-0164)", () => {
  it("setiap flow orkestrasi punya daftar fase", () => {
    expect(Object.keys(FLOW_PHASES).sort()).toEqual([...ORCHESTRATION_FLOWS].sort());
    expect(FLOW_PHASES.feature).toEqual(["Brainstorm", "Objective", "Spec", "Plan", "Execute"]);
    expect(FLOW_PHASES.reverse).toEqual(["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"]);
  });
});

describe("phaseAgentName", () => {
  it("slug huruf kecil, non-alnum dirapatkan jadi satu tanda hubung", () => {
    expect(phaseAgentName("Doc index")).toBe("hanoman-fase-doc-index");
    expect(phaseAgentName("Konvensi & index")).toBe("hanoman-fase-konvensi-index");
    expect(phaseAgentName("Execute")).toBe("hanoman-fase-execute");
  });
  it("semua nama agen fase sah menurut AGENT_NAME_RE dan unik per flow", () => {
    for (const phases of Object.values(FLOW_PHASES)) {
      const names = phases.map(phaseAgentName);
      for (const n of names) expect(AGENT_NAME_RE.test(n), n).toBe(true);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it("isPhaseAgentName mengenali awalan yang dicadangkan", () => {
    expect(isPhaseAgentName(`${PHASE_AGENT_PREFIX}plan`)).toBe(true);
    expect(isPhaseAgentName("scout")).toBe(false);
  });
});

describe("Setting.orchestration", () => {
  it("default: setiap flow aktif dengan matriks kosong", () => {
    expect(Object.keys(ORCHESTRATION_DEFAULTS).sort()).toEqual([...ORCHESTRATION_FLOWS].sort());
    for (const flow of ORCHESTRATION_FLOWS)
      expect(ORCHESTRATION_DEFAULTS[flow]).toEqual({ enabled: true, claude: {}, codex: {} });
  });
  it("baris Setting lama tanpa blok ini tetap parse dengan default aktif", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.orchestration.feature.enabled).toBe(true);
  });
  it("sel parsial diisi null, flow lain tetap default", () => {
    const o = zOrchestration.parse({ qa: { enabled: false, claude: { Plan: { model: "claude-sonnet-5" } } } });
    expect(o.qa).toEqual({ enabled: false, claude: { Plan: { model: "claude-sonnet-5", effort: null } }, codex: {} });
    expect(o.feature.enabled).toBe(true);
  });
});

describe("resolvePhasePlan", () => {
  const base = {
    flow: "feature" as const, runtime: "claude" as const,
    orchestration: ORCHESTRATION_DEFAULTS, orchestrator, nativeAgents: true,
  };
  it("flow mati → null", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS, feature: { enabled: false, claude: {}, codex: {} } };
    expect(resolvePhasePlan({ ...base, orchestration })).toBeNull();
  });
  it("runtime tanpa agen native → null", () => {
    expect(resolvePhasePlan({ ...base, nativeAgents: false })).toBeNull();
  });
  it("blok absen (respons Setting lama) → default aktif", () => {
    expect(resolvePhasePlan({ ...base, orchestration: undefined })?.phases).toHaveLength(5);
  });
  it("sel kosong mewarisi orchestrator di setiap fase", () => {
    const plan = resolvePhasePlan(base)!;
    expect(plan).toMatchObject({ flow: "feature", runtime: "claude" });
    expect(plan.phases.map((p) => p.phase)).toEqual(FLOW_PHASES.feature);
    expect(plan.phases[3]).toEqual({
      phase: "Plan", agentName: "hanoman-fase-plan", model: "claude-opus-5", effort: "xhigh",
    });
  });
  it("model sel dipakai; effort warisan dikoersi ke model hasil resolusi (claude)", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS,
      feature: { enabled: true, claude: { Plan: { model: "claude-fable-5-1", effort: null } }, codex: {} } };
    const plan = resolvePhasePlan({ ...base, orchestration, orchestrator: { model: "claude-opus-5", effort: "ultracode" } })!;
    expect(plan.phases.find((p) => p.phase === "Plan")).toMatchObject({ model: "claude-fable-5-1", effort: "xhigh" });
  });
  it("codex membaca kolom codex dan mengoreksi effort ke fallback model", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS, qa: { enabled: true,
      claude: { Execute: { model: "claude-sonnet-5", effort: "low" } },
      codex: { Execute: { model: "gpt-5.6-luna", effort: null } } } };
    const plan = resolvePhasePlan({ ...base, flow: "qa", runtime: "codex", orchestration,
      orchestrator: { model: "gpt-5.6-sol", effort: "ultra" } })!;
    expect(plan.phases.find((p) => p.phase === "Execute")).toMatchObject({ model: "gpt-5.6-luna", effort: "xhigh" });
    expect(plan.phases.find((p) => p.phase === "Audit")).toMatchObject({ model: "gpt-5.6-sol", effort: "ultra" });
  });
  it("kunci fase asing di matriks tak menambah fase", () => {
    const orchestration = { ...ORCHESTRATION_DEFAULTS,
      goal: { enabled: true, claude: { Foo: { model: "x", effort: "low" } }, codex: {} } };
    expect(resolvePhasePlan({ ...base, flow: "goal", orchestration })!.phases.map((p) => p.phase))
      .toEqual(["Goal", "Verifikasi"]);
  });
});

describe("codexNativeAgentsSupported", () => {
  it("membaca versi dari keluaran --version", () => {
    expect(codexNativeAgentsSupported("codex-cli 0.154.0")).toBe(true);
    expect(codexNativeAgentsSupported("0.151.0")).toBe(true);
    expect(codexNativeAgentsSupported("0.150.9")).toBe(false);
    expect(codexNativeAgentsSupported(null)).toBe(false);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run shared/src/orchestration.test.ts`
Expected: FAIL — `Failed to resolve import "./orchestration"`.

- [x] **Step 3: Buat `shared/src/orchestration.ts`**

```ts
// ADR-0164 · orkestrasi subagent per fase — konstanta & tipe TANPA impor. `entities.ts` membangun
// skema `Setting.orchestration`, sementara resolver yang butuh katalog model hidup di
// `orchestration-plan.ts`: menaruh keduanya di satu berkas menutup lingkaran impor.

export const ORCHESTRATION_FLOWS = [
  "feature", "qa", "scaffold", "reverse", "prd", "audit", "breakdown", "goal", "no_effort",
] as const;
export type OrchestrationFlow = (typeof ORCHESTRATION_FLOWS)[number];

// Pindahan `PIPELINES` (runner/src/prompt.ts) APA ADANYA; runner mengekspornya ulang dengan nama
// lama. Ia pindah ke sini karena Settings & modal Start butuh daftar yang sama, dan frontend tak
// mengimpor runner.
export const FLOW_PHASES: Readonly<Record<OrchestrationFlow, readonly string[]>> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
  prd: ["Brainstorm", "PRD"],
  audit: ["Audit", "Laporan"],
  breakdown: ["Analisis", "Breakdown"],
  // SPEC-337 · ADR-0075 · audit lintas project: fase & stage-map identik audit-only, scope-nya
  // yang berbeda (project utama + tetangga ProjectLink).
  // SPEC-407 · ADR-0089 · backlog goal: tak ada fase perencanaan sama sekali. `Goal` = kerjakan,
  // `Verifikasi` = buktikan. Kedua nama unik lintas daftar ini — syarat peta REACHED di server,
  // yang berkunci nama fase saja.
  goal: ["Goal", "Verifikasi"],
  // SPEC-825 · ADR-0123 · task remeh: SATU fase. Nama `Kerjakan` unik lintas daftar ini — syarat
  // peta REACHED server, yang berkunci nama fase saja.
  no_effort: ["Kerjakan"],
};

/** Awalan yang dicadangkan: skema custom agent menolaknya supaya registry native tak tertimpa. */
export const PHASE_AGENT_PREFIX = "hanoman-fase-";

export function phaseAgentName(phase: string): string {
  return PHASE_AGENT_PREFIX
    + phase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const isPhaseAgentName = (name: string): boolean => name.startsWith(PHASE_AGENT_PREFIX);

/** Hook fail-open dan relay spool bisa terlambat; ⚠ baru menyala sesudah tenggang ini. */
export const PHASE_EVIDENCE_GRACE_MS = 60_000;

export type PhasePlanEntry = { phase: string; agentName: string; model: string; effort: string };
export type PhasePlan = {
  flow: OrchestrationFlow; runtime: "claude" | "codex"; phases: PhasePlanEntry[];
};
```

- [x] **Step 4: Tambah skema di `shared/src/entities.ts`** — sisipkan tepat sebelum `export const zSetting = z.object({`

```ts
// ADR-0164 · orkestrasi subagent per fase. `Setting.data` bertipe Json → blok ini TANPA migration,
// cermin conflict/goal. Default AKTIF per flow (keputusan operator). Sel `null` = warisi
// model/effort orchestrator (picker Start). Lenient `z.string()` seperti model/effort akar:
// katalog ditegakkan UI, dan kunci fase tak dikenal diabaikan `resolvePhasePlan`.
export const zPhaseCell = z.object({
  model: z.string().nullable().default(null),
  effort: z.string().nullable().default(null),
});
export type PhaseCell = z.infer<typeof zPhaseCell>;
export const zFlowOrchestration = z.object({
  enabled: z.boolean().default(true),
  claude: z.record(z.string(), zPhaseCell).default({}),
  codex: z.record(z.string(), zPhaseCell).default({}),
});
export type FlowOrchestration = z.infer<typeof zFlowOrchestration>;
// Kunci eksplisit, bukan `Object.fromEntries`: tipe hasilnya harus tetap `Record<flow, …>` penuh.
// Kecocokannya dengan `ORCHESTRATION_FLOWS` dijaga orchestration.test.ts.
export const zOrchestration = z.object({
  feature: zFlowOrchestration.default({}), qa: zFlowOrchestration.default({}),
  scaffold: zFlowOrchestration.default({}), reverse: zFlowOrchestration.default({}),
  prd: zFlowOrchestration.default({}), audit: zFlowOrchestration.default({}),
  breakdown: zFlowOrchestration.default({}), goal: zFlowOrchestration.default({}),
  no_effort: zFlowOrchestration.default({}),
});
export type Orchestration = z.infer<typeof zOrchestration>;
export const ORCHESTRATION_DEFAULTS: Orchestration = zOrchestration.parse({});
```

Lalu di dalam `zSetting`, tepat sesudah baris `portalChat: zPortalChat.default(PORTAL_CHAT_DEFAULTS), …`:

```ts
  orchestration: zOrchestration.default(ORCHESTRATION_DEFAULTS),         // ADR-0164 · orkestrasi subagent per fase (default aktif)
```

- [x] **Step 5: Buat `shared/src/orchestration-plan.ts`**

```ts
import { cmpVersion, coerceClaudeEffort, coerceCodexEffort, type Orchestration } from "./entities";
import { FLOW_PHASES, phaseAgentName, type OrchestrationFlow, type PhasePlan } from "./orchestration";

// ADR-0164 · resolver rencana fase. Satu fungsi murni dipakai server (kelahiran sesi) dan UI
// (pratinjau modal Start) — dua salinan aturan warisan/koersi akan membuat pratinjau berbohong.

/** Pindahan dari runner/src/codex-agent-config.ts (ADR-0159): UI butuh gerbang yang sama. */
export const CODEX_NATIVE_AGENTS_MIN_CLIENT = "0.151.0";

export function codexNativeAgentsSupported(version: string | null): boolean {
  const parsed = version ? /(\d+)\.(\d+)\.(\d+)/.exec(version)?.[0] : null;
  return parsed ? cmpVersion(parsed, CODEX_NATIVE_AGENTS_MIN_CLIENT) >= 0 : false;
}

export type PhasePlanInput = {
  flow: OrchestrationFlow;
  runtime: "claude" | "codex";
  /** `undefined` = respons Setting lama tanpa blok ini → default aktif. */
  orchestration: Orchestration | undefined;
  orchestrator: { model: string; effort: string };
  /** Runtime sanggup subagent native: claude selalu, codex bila client >= 0.151.0. */
  nativeAgents: boolean;
};

export function resolvePhasePlan(input: PhasePlanInput): PhasePlan | null {
  const cfg = input.orchestration?.[input.flow];
  if (!input.nativeAgents || cfg?.enabled === false) return null;
  const cells = cfg?.[input.runtime] ?? {};
  // Effort dikoersi ke model HASIL resolusi: sel Luna yang mewarisi `ultra` harus turun ke
  // fallback Luna sebelum sampai ke `model_reasoning_effort`.
  const coerce = input.runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  return {
    flow: input.flow,
    runtime: input.runtime,
    phases: FLOW_PHASES[input.flow].map((phase) => {
      const cell = cells[phase];
      const model = cell?.model ?? input.orchestrator.model;
      return {
        phase, agentName: phaseAgentName(phase), model,
        effort: coerce(model, cell?.effort ?? input.orchestrator.effort),
      };
    }),
  };
}
```

- [x] **Step 6: Ekspor dari `shared/src/index.ts`** — tambahkan dua baris sesudah `export * from "./entities";`

```ts
export * from "./orchestration";
export * from "./orchestration-plan";
```

- [x] **Step 7: Jalankan test, pastikan lulus**

Run: `rtk proxy pnpm vitest --run shared/src/orchestration.test.ts`
Expected: PASS (semua test di berkas).

- [x] **Step 8: Runner memakai sumber tunggal**

`runner/src/prompt.ts` baris 2 menjadi:

```ts
import { resolveMethod, FLOW_PHASES, type MethodDef } from "@hanoman/shared";
```

Ganti seluruh blok `export const PIPELINES: Record<Flow, readonly string[]> = { … };` (baris 8–27, termasuk komentar di dalamnya) dengan:

```ts
// ADR-0164 · daftar fase pindah ke @hanoman/shared (`FLOW_PHASES`) supaya Settings & modal Start
// membaca sumber yang sama; nama lama tetap diekspor untuk semua pemakai runner/server.
export const PIPELINES: Record<Flow, readonly string[]> = FLOW_PHASES;
```

`runner/src/codex-agent-config.ts`: hapus baris 3 (`import { cmpVersion } from "@hanoman/shared";`) dan baris 7–13 (konstanta + fungsi `codexNativeAgentsSupported`), lalu tambahkan di blok impor:

```ts
import { CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported } from "@hanoman/shared";

// ADR-0164 · gerbang versi pindah ke @hanoman/shared (UI butuh aturan yang sama); diekspor ulang
// supaya pemakai lama tak berubah.
export { CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported };
```

`runner/test/method-phases.test.ts`: ganti impor `METHODS` menjadi `import { METHODS, FLOW_PHASES } from "@hanoman/shared";` dan tambahkan di dalam `describe`:

```ts
  it("PIPELINES adalah FLOW_PHASES milik shared, bukan cermin kedua (ADR-0164)", () => {
    expect(PIPELINES).toBe(FLOW_PHASES);
  });
```

`server/src/services/settings.ts`: tambahkan `ORCHESTRATION_DEFAULTS` ke impor `@hanoman/shared`, lalu di `DEFAULT_SETTING` sesudah `portalChat: PORTAL_CHAT_DEFAULTS, …`:

```ts
  orchestration: ORCHESTRATION_DEFAULTS, // ADR-0164 · orkestrasi subagent per fase (default aktif)
```

`src/src/screens/SettingsScreen.tsx`: tambahkan `ORCHESTRATION_DEFAULTS` ke impor `@hanoman/shared` baris 6, lalu di `S_DEFAULTS` sesudah `portalChat: PORTAL_CHAT_DEFAULTS, …`:

```ts
  orchestration: ORCHESTRATION_DEFAULTS, // ADR-0164 · orkestrasi subagent per fase (default aktif)
```

- [x] **Step 9: Verifikasi tersentuh**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism shared/src/orchestration.test.ts runner/test/method-phases.test.ts runner/test/codex-agent-config.test.ts runner/test/prompt.test.ts server/test/settings.test.ts`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./shared typecheck && rtk proxy pnpm --filter ./runner typecheck && rtk proxy pnpm --filter ./server typecheck && rtk proxy pnpm --filter ./src typecheck`
Expected: exit 0 keempatnya.

- [x] **Step 10: Commit**

```bash
/usr/bin/git add shared/src/orchestration.ts shared/src/orchestration-plan.ts shared/src/orchestration.test.ts shared/src/entities.ts shared/src/index.ts runner/src/prompt.ts runner/src/codex-agent-config.ts runner/test/method-phases.test.ts server/src/services/settings.ts src/src/screens/SettingsScreen.tsx
/usr/bin/git commit -m "feat(orkestrasi): daftar fase, Setting.orchestration, dan resolver rencana fase di shared"
```

### Task 2: Jaring golden prompt + ekspor potongan prompt (tanpa perubahan byte)

**Files:**
- Create: `runner/test/prompt-golden.test.ts`
- Create (dibangkitkan): `runner/test/__golden__/*.txt`
- Modify: `runner/src/prompt.ts`

**Interfaces:**
- Consumes: `PIPELINES`, pembangun prompt yang ada.
- Produces (semua di `runner/src/prompt.ts`, keluaran mode tunggal tak berubah):
  ```ts
  export const AUTONOMY_CLAUSE: string;
  export const autonomyClause: (mode?: Autonomy) => string;
  export const writesCode: (flow: Flow) => boolean;
  export const scopeClause: (flow: Flow, scope?: VerifyScope) => string;
  export const codeStyleClause: (flow: Flow) => string;
  export const methodClause: (method: MethodDef) => string;
  export const REVERSE_PHASE_GUIDE: string;
  export const SCAFFOLD_PHASE_GUIDE: string;
  export const PROJECT_METHOD: MethodDef;
  export function guideLine(guide: string, phase: string): string;
  export function phaseSkillsFor(flow: Flow, phase: string, method: MethodDef): string[];
  export const specContext: (spec: SpecBrief) => string;
  export const goalDetail: (spec: SpecBrief) => string;
  export const goalBlock: (spec: SpecBrief) => string;
  export const goalContext: (spec: SpecBrief) => string;
  export const projectContext: (project: ProjectBrief) => string;
  export const scaffoldContext: (project: ProjectBrief) => string;
  export const prdBriefBlock: (project: ProjectBrief, brief: PrdBrief) => string;
  export const prdAuditBlock: (audit?: AuditDoc) => string;
  export const prdContext: (project: ProjectBrief, brief: PrdBrief, audit?: AuditDoc) => string;
  export const breakdownContext: (project: ProjectBrief, prd: BreakdownPrd) => string;
  export const prdPhaseLines: (slug: string) => Record<"Brainstorm" | "PRD", string>;
  export const breakdownPhaseLines: (slug: string, title: string) => Record<"Analisis" | "Breakdown", string>;
  ```

- [x] **Step 1: Tulis golden test** — `runner/test/prompt-golden.test.ts` (SEBELUM menyentuh prompt.ts)

```ts
import { describe, it, expect } from "vitest";
import {
  startPrompt, continuePrompt, resumePrompt, startGoalPrompt, startProjectPrompt,
  startPrdPrompt, startBreakdownPrompt, startScaffoldPrompt,
} from "../src/prompt";

// ADR-0164 · AC-2 · jaring byte-identitas. Berkas __golden__ ditulis SEKALI dari kode sebelum
// orkestrasi, lalu setiap perubahan prompt.ts wajib tetap menghasilkan byte yang sama untuk jalur
// tanpa rencana fase. JANGAN memperbarui snapshot ini (`-u`) untuk membuat test hijau.
const spec = { id: "SPEC-1151", title: "Orkestrasi", source: "brief", priority: "tinggi",
  objective: "Fase dikerjakan subagent", payload: { context: "c", outcome: "o" } };
const qa = { ...spec, source: "qa", payload: { fromAudit: "SPEC-1100", steps: "s" } };
const goal = { ...spec, source: "goal", payload: { goal: "Hijau", done: "test lulus", constraints: "tanpa migrasi" } };
const attachments = { dir: "/att", items: [{ filename: "a.md", mimeType: "text/markdown", size: 3, path: "/att/a.md" }] };
const project = { id: "p1", name: "P1", desc: "ide", stack: "ts" };
const resume = { recorded: ["Audit done"], next: "Spec", worktreeKept: false };
const file = (name: string) => `./__golden__/${name}.txt`;

describe("golden prompt mode sesi tunggal (ADR-0164)", () => {
  it("startPrompt feature", async () => {
    await expect(startPrompt("feature", spec, "hanoman/spec-1151", undefined, "changed", "superpowers", attachments))
      .toMatchFileSnapshot(file("start-feature"));
  });
  it("startPrompt qa full-control matt", async () => {
    await expect(startPrompt("qa", qa, "b", "full-control", "full", "matt")).toMatchFileSnapshot(file("start-qa-matt"));
  });
  it("startPrompt audit", async () => {
    await expect(startPrompt("audit", spec, "b")).toMatchFileSnapshot(file("start-audit"));
  });
  it("continuePrompt", async () => {
    await expect(continuePrompt("feature", spec, "b", undefined, "changed")).toMatchFileSnapshot(file("continue-feature"));
  });
  it("resumePrompt qa", async () => {
    await expect(resumePrompt("qa", qa, "b", resume, undefined, "changed", "superpowers", attachments))
      .toMatchFileSnapshot(file("resume-qa"));
  });
  it("startGoalPrompt goal", async () => {
    await expect(startGoalPrompt("goal", goal, "b", { verifyScope: "changed" })).toMatchFileSnapshot(file("goal"));
  });
  it("startGoalPrompt no_effort resume", async () => {
    await expect(startGoalPrompt("no_effort", goal, "b", { resume })).toMatchFileSnapshot(file("no-effort-resume"));
  });
  it("startProjectPrompt reverse", async () => {
    await expect(startProjectPrompt("reverse", project, "reverse-docs")).toMatchFileSnapshot(file("reverse"));
  });
  it("startScaffoldPrompt", async () => {
    await expect(startScaffoldPrompt(project, "scaffold-docs")).toMatchFileSnapshot(file("scaffold"));
  });
  it("startPrdPrompt dengan audit", async () => {
    await expect(startPrdPrompt(project, { title: "T", context: "c", outcome: "o", constraints: "k" }, "prd/t",
      { id: "SPEC-1", path: "internal/docs/research/audit-spec-1-x.md", content: "isi audit" }))
      .toMatchFileSnapshot(file("prd-audit"));
  });
  it("startBreakdownPrompt", async () => {
    await expect(startBreakdownPrompt(project, { title: "PRD", path: "docs/prd/p.md", content: "# PRD\nisi" }, "breakdown/p"))
      .toMatchFileSnapshot(file("breakdown"));
  });
});
```

- [x] **Step 2: Bangkitkan golden dari kode yang ada**

Run: `rtk proxy pnpm vitest --run runner/test/prompt-golden.test.ts -u`
Expected: PASS, 11 berkas tertulis di `runner/test/__golden__/`. Periksa `runner/test/__golden__/reverse.txt` memuat `=== STANDAR DOCS ===` (bukti isinya prompt nyata, bukan kosong).

- [x] **Step 3: Commit golden SEBELUM refactor**

```bash
/usr/bin/git add runner/test/prompt-golden.test.ts runner/test/__golden__
/usr/bin/git commit -m "test(prompt): golden byte-identitas prompt mode sesi tunggal"
```

- [x] **Step 4: Ekspor klausa yang sudah ada** — di `runner/src/prompt.ts` ubah `const` menjadi `export const` (isi tak berubah) untuk: `AUTONOMY_CLAUSE`, `autonomyClause`, `writesCode`, `scopeClause`, `codeStyleClause`, `methodClause`, `REVERSE_PHASE_GUIDE`, `SCAFFOLD_PHASE_GUIDE`, `PROJECT_METHOD`.

Tambahkan impor tipe yang dibutuhkan helper di bawah bila belum ada di baris 1: `ProjectBrief, PrdBrief, AuditDoc, BreakdownPrd` (sudah ada), `SpecBrief` (sudah ada).

- [x] **Step 5: Tambah helper per fase** — sisipkan tepat sesudah fungsi `skillInstruction`

```ts
// ADR-0164 · satu baris panduan fase dari guide bergaris `- <Fase>: …` (REVERSE/SCAFFOLD). Agen
// fase memakai baris yang SAMA dengan prompt sesi tunggal, bukan salinan yang bisa berselisih.
export function guideLine(guide: string, phase: string): string {
  return guide.split("\n").find((line) => line.startsWith(`- ${phase}:`)) ?? "";
}

// ADR-0164 · skill satu fase — aturan `skillInstruction` untuk satu baris: `exitSkills` digabung ke
// fase TERAKHIR hanya untuk flow penulis-kode (INVARIAN 2 ADR-0113).
export function phaseSkillsFor(flow: Flow, phase: string, method: MethodDef): string[] {
  const own = method.phaseSkills[phase] ?? [];
  const phases = PIPELINES[flow];
  return writesCode(flow) && phase === phases[phases.length - 1]
    ? [...new Set([...own, ...method.exitSkills])]
    : [...own];
}
```

- [x] **Step 6: Tambah blok konteks + baris fase PRD/breakdown** — sisipkan tepat sebelum `export function startPrompt(`

````ts
// ADR-0164 · blok konteks di ekor prompt. Diekspor karena agen fase lahir dengan konteks TERPISAH
// (subagent tak melihat prompt parent), jadi server menyematkan blok yang SAMA ke instruksinya.
export const specContext = (spec: SpecBrief): string => {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
    + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`;
};
export const goalDetail = (spec: SpecBrief): string => {
  const g = readGoalPayload(spec.payload);
  return [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
};
export const goalBlock = (spec: SpecBrief): string =>
  `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
    + `Judul: ${spec.title}`;
export const goalContext = (spec: SpecBrief): string => `${goalDetail(spec)}\n\n${goalBlock(spec)}`;
export const projectContext = (project: ProjectBrief): string =>
  `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`;
export const scaffoldContext = (project: ProjectBrief): string =>
  `Project ${project.id} · ${project.name}\nIde awal: ${project.desc || "—"}\nStack: ${project.stack || "—"}`;
export const prdBriefBlock = (project: ProjectBrief, brief: PrdBrief): string =>
  `Project ${project.id} · ${project.name}\nBrief — Judul: ${brief.title}\nKonteks: ${brief.context}\n`
    + `Outcome: ${brief.outcome}${brief.constraints ? `\nBatasan: ${brief.constraints}` : ""}`;
export const prdAuditBlock = (audit?: AuditDoc): string => audit
  ? `=== DOKUMEN AUDIT ${audit.id} (${audit.path}) ===\nPRD ini adalah TINDAK LANJUT audit di bawah. `
    + "Pakai temuannya sebagai bahan brainstorm — jangan menginvestigasi ulang, dan jangan pula "
    + `menyalinnya mentah-mentah ke PRD.\n\n${audit.content}`
  : "";
export const prdContext = (project: ProjectBrief, brief: PrdBrief, audit?: AuditDoc): string =>
  [prdBriefBlock(project, brief), prdAuditBlock(audit)].filter(Boolean).join("\n\n");
export const breakdownContext = (project: ProjectBrief, prd: BreakdownPrd): string =>
  `Project ${project.id} · ${project.name}\n=== PRD: ${prd.title} (${prd.path}) ===\n${prd.content}`;

// ADR-0164 · baris panduan fase PRD & breakdown dipakai DUA jalur: prompt sesi tunggal di bawah dan
// instruksi agen fase (phase-agents.ts). String dipindah APA ADANYA dari pembangunnya.
export const prdPhaseLines = (slug: string): Record<"Brainstorm" | "PRD", string> => ({
  Brainstorm: `- Brainstorm: pandu PM secara interaktif. Ajukan SATU pertanyaan per giliran ke manusia di `
    + `terminal ini, tunggu jawabannya, perdalam brief sampai jelas (masalah, pengguna, scope, `
    + `metrik sukses). Jangan mengarang; topik yang PM belum jawab tandai sebagai open question.`,
  PRD: `- PRD: tulis dokumen ke \`docs/prd/${slug}.md\`. Awali dengan heading \`# <judul PRD>\`, lalu `
    + `bagian: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope `
    + `(in/out) · User stories · Acceptance criteria (gaya EARS) · Metrik sukses · Open questions. `
    + `Isi lengkap dan spesifik dari hasil brainstorm, bukan kerangka kosong.`,
});
export const breakdownPhaseLines = (slug: string, title: string): Record<"Analisis" | "Breakdown", string> => ({
  Analisis: `- Analisis: baca PRD (di bawah) sampai paham SELURUH scope in-PRD. Petakan pekerjaan menjadi `
    + `unit-unit yang: (a) kecil & terukur — tiap unit tuntas dalam satu sesi; (b) non-overlapping `
    + `— cakupan tak tumpang tindih; (c) TANPA cross-dependency — urutan bebas, bisa jalan bersamaan; `
    + `(d) gabungannya MENUTUP seluruh scope PRD. Bila dua unit terpaksa berurutan, gabung jadi satu.`,
  Breakdown: `- Breakdown: tulis manifest ke \`docs/prd/${slug}.breakdown.md\`. Awali heading `
    + `\`# Breakdown: ${title}\`, lalu prosa: ringkasan + untuk TIAP backlog satu paragraf `
    + `(judul, cakupan, dan SATU kalimat kenapa aman-paralel / tak bergantung yang lain). `
    + `Di AKHIR dokumen sertakan TEPAT SATU blok kode berpagar json berisi kontrak mesin PERSIS `
    + `bentuk ini (tanpa komentar, priority ∈ tinggi|sedang|rendah):\n`
    + "```json\n"
    + `{ "items": [ { "title": "…", "context": "…", "outcome": "…", "priority": "sedang" } ] }\n`
    + "```\n"
    + `\`context\` = bagian PRD yang dicakup; \`outcome\` = kondisi selesai terukur; \`title\` ringkas. `
    + `Minimal 2 item bila PRD memang kompleks; bila PRD ternyata sekecil 1 unit, katakan itu di `
    + `prosa dan tetap tulis 1 item.`,
});
````

- [x] **Step 7: Pembangun mode tunggal memakai helper** (byte tetap sama)

- `startPrompt`, `continuePrompt`, `resumePrompt`: hapus `const detail = …`; ganti elemen terakhir array (`Backlog item … ${detail}`) dengan `specContext(spec)`.
- `startGoalPrompt`: hapus `const g = …` dan `const detail = …`; ganti elemen `detail` dengan `goalDetail(spec)`, dan elemen terakhir (`Backlog item … Judul: ${spec.title}`) dengan `goalBlock(spec)`.
- `startProjectPrompt`: ganti elemen `Project ${project.id} · … Stack: …` dengan `projectContext(project)`.
- `startScaffoldPrompt`: ganti elemen `Project … Ide awal: …` dengan `scaffoldContext(project)`.
- `startPrdPrompt`: hapus `const auditBlock = …`; ganti dua elemen `- Brainstorm: …` dan `- PRD: …` dengan `prdPhaseLines(slug).Brainstorm, prdPhaseLines(slug).PRD,`; ganti elemen brief (`Project … Outcome …`) dengan `prdBriefBlock(project, brief)` dan elemen `auditBlock` dengan `prdAuditBlock(audit)`.
- `startBreakdownPrompt`: ganti dua elemen `- Analisis: …` dan `- Breakdown: …` dengan `breakdownPhaseLines(slug, prd.title).Analisis, breakdownPhaseLines(slug, prd.title).Breakdown,`; ganti elemen terakhir dengan `breakdownContext(project, prd)`.

- [x] **Step 8: Buktikan byte tak berubah**

Run: `rtk proxy pnpm vitest --run runner/test/prompt-golden.test.ts runner/test/prompt.test.ts runner/test/escalation-prompt.test.ts runner/test/code-style.test.ts runner/test/verify-scope.test.ts`
Expected: PASS semua, **tanpa** `-u`. Mismatch golden = refactor mengubah byte → perbaiki kodenya, bukan snapshot-nya.

Run: `rtk proxy pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 9: Commit**

```bash
/usr/bin/git add runner/src/prompt.ts
/usr/bin/git commit -m "refactor(prompt): ekspor potongan prompt & blok konteks untuk agen fase (byte identik)"
```

### Task 3: Renderer native mengenal agen fase (`kind: "phase"`)

**Files:**
- Modify: `runner/src/custom-agents.ts:7-21` (`AgentDef`), `:140-167` (`renderAgentsJson`)
- Modify: `runner/src/codex-agent-config.ts` (`renderCodexAgentToml`, `materializeCodexAgents`)
- Modify: `runner/src/agent-definition.ts:15-18`
- Test: `runner/test/custom-agents.test.ts`, `runner/test/codex-agent-config.test.ts`, `runner/test/agent-definition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // AgentDef (runner/src/custom-agents.ts) bertambah:
  kind?: "custom" | "phase";
  phase?: string;
  // MaterializeOptions (runner/src/codex-agent-config.ts) bertambah:
  maxDepth?: number;
  ```
- Aturan: `kind: "phase"` → claude JSON `{ description, prompt: instructions, model?, effort? }` **tanpa** `tools`; codex TOML `developer_instructions = instructions` apa adanya. Agen fase tak pernah masuk `agentDelegationClause`.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `runner/test/custom-agents.test.ts`:

```ts
// ADR-0164 · agen fase: instruksi apa adanya dan TANPA kunci tools — terukur 2026-09-14 (claude
// 2.1.270): subagent tanpa `tools` mewarisi seluruh tool sesi termasuk Skill.
describe("renderAgentsJson · agen fase (ADR-0164)", () => {
  const phase = def({
    name: "hanoman-fase-plan", description: "Fase Plan", instructions: "INSTRUKSI FASE",
    model: "claude-sonnet-5",
  });
  it("tanpa tools, prompt apa adanya, model & effort ikut", () => {
    const j = JSON.parse(renderAgentsJson([{ ...phase, kind: "phase", phase: "Plan", effort: "low" }, def({ name: "scout" })]));
    expect(j["hanoman-fase-plan"]).toEqual({
      description: "Fase Plan", prompt: "INSTRUKSI FASE", model: "claude-sonnet-5", effort: "low",
    });
    expect(j.scout.tools).toBeDefined();
  });
  it("agen fase tak masuk klausa delegasi custom agent", () => {
    expect(agentDelegationClause([{ ...phase, kind: "phase", phase: "Plan" }].filter((d) => d.kind !== "phase"))).toBe("");
  });
});
```

Tambahkan di akhir `runner/test/codex-agent-config.test.ts`:

```ts
describe("agen fase codex (ADR-0164)", () => {
  const phase: AgentDef = {
    kind: "phase", phase: "Execute", name: "hanoman-fase-execute", description: "Fase Execute",
    instructions: "KERJAKAN PLAN", tools: null, model: "gpt-5.6-luna", effort: "low", mentions: [],
  };
  it("developer_instructions apa adanya dengan model & effort role", () => {
    const toml = renderCodexAgentToml(phase, [phase]);
    expect(toml).toContain('developer_instructions = "KERJAKAN PLAN"');
    expect(toml).toContain('model = "gpt-5.6-luna"');
    expect(toml).toContain('model_reasoning_effort = "low"');
  });
  it("maxDepth dipasang eksplisit dan agen fase tak masuk klausa delegasi", () => {
    const m = materializeCodexAgents([phase], "/tmp/hnm-fase", {
      clientVersion: "0.154.0", maxDepth: 3, writeFile: () => {}, chmod: () => {},
    });
    expect(m.args).toContain("agents.max_depth=3");
    expect(m.delegationClause).toBe("");
    expect(m.liveDefs.map((d) => d.name)).toEqual(["hanoman-fase-execute"]);
  });
  it("tanpa maxDepth argv custom agent tak berubah", () => {
    const m = materializeCodexAgents([def()], "/tmp/hnm-fase", { clientVersion: "0.154.0", writeFile: () => {}, chmod: () => {} });
    expect(m.args.some((a) => a.startsWith("agents.max_depth"))).toBe(false);
  });
});
```

Tambahkan di akhir `runner/test/agent-definition.test.ts` (sesuaikan impor `agentDefinitionHash` dan `AgentDef` yang sudah ada di berkas itu):

```ts
describe("agentDefinitionHash · agen fase (ADR-0164)", () => {
  it("menghitung hash walau definisi native tak punya tools", () => {
    const phase: AgentDef = {
      kind: "phase", phase: "Spec", name: "hanoman-fase-spec", description: "Fase Spec",
      instructions: "SPEC", tools: null, model: "claude-opus-5", effort: "high", mentions: [],
    };
    expect(agentDefinitionHash(phase, [phase], "claude")).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run runner/test/custom-agents.test.ts runner/test/codex-agent-config.test.ts runner/test/agent-definition.test.ts`
Expected: FAIL — objek agen fase masih memuat `tools`, `agents.max_depth=3` tak ada, hash melempar `Cannot read properties of undefined (reading 'sort')`.

- [x] **Step 3: Implementasi**

`runner/src/custom-agents.ts` — di dalam `export type AgentDef = { … }` tambahkan sesudah `timeoutSeconds?`:

```ts
  /**
   * ADR-0164 · `phase` = agen fase dari `buildPhaseAgents`: instruksi dirender APA ADANYA, tanpa
   * kunci `tools` (mewarisi seluruh tool sesi — Skill/Agent/MCP) dan tanpa klausa policy/delegasi
   * custom agent. Absen = custom agent.
   */
  kind?: "custom" | "phase";
  /** ADR-0164 · nama fase PIPELINES milik agen fase; ikut roster tmux sebagai bukti. */
  phase?: string;
```

Di `renderAgentsJson`, baris pertama di dalam `for (const d of defs) {`:

```ts
    if (d.kind === "phase") {
      out[d.name] = {
        description: d.description,
        prompt: d.instructions,
        ...(d.model ? { model: d.model } : {}),
        ...(d.effort ? { effort: d.effort } : {}),
      };
      continue;
    }
```

`runner/src/codex-agent-config.ts` — di `renderCodexAgentToml`, ganti baris `developer_instructions`:

```ts
    `developer_instructions = ${tomlString(def.kind === "phase"
      ? def.instructions
      : agentPromptOf(def, roster, "codex") + (options.promptSuffix ?? ""))}`,
```

Di `type MaterializeOptions`, tambahkan:

```ts
  /** ADR-0164 · batas kedalaman subagent codex, dipasang eksplisit hanya untuk sesi orchestrator. */
  maxDepth?: number;
```

Di `materializeCodexAgents`, tepat sesudah `const args = [ … ];` tambahkan:

```ts
  if (options.maxDepth) args.push("-c", `agents.max_depth=${options.maxDepth}`);
```

dan ganti `delegationClause: agentDelegationClause(liveDefs, "codex"),` dengan:

```ts
    delegationClause: agentDelegationClause(liveDefs.filter((d) => d.kind !== "phase"), "codex"),
```

`runner/src/agent-definition.ts` — ganti dua baris:

```ts
    : JSON.parse(renderAgentsJson(liveRoster, options))[def.name] as { tools?: string[] };
  if (typeof native !== "string" && native.tools) native.tools.sort();
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run runner/test/custom-agents.test.ts runner/test/codex-agent-config.test.ts runner/test/agent-definition.test.ts runner/test/prompt-golden.test.ts`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
/usr/bin/git add runner/src/custom-agents.ts runner/src/codex-agent-config.ts runner/src/agent-definition.ts runner/test/custom-agents.test.ts runner/test/codex-agent-config.test.ts runner/test/agent-definition.test.ts
/usr/bin/git commit -m "feat(agents): renderer native mengenal agen fase tanpa kunci tools"
```

### Task 4: `runner/src/phase-agents.ts` — definisi agen fase

**Files:**
- Create: `runner/src/phase-agents.ts`
- Create: `runner/test/phase-agents.test.ts`
- Modify: `runner/src/index.ts`

**Interfaces:**
- Consumes: Task 1 (`PhasePlan`, `PhasePlanEntry`, `PHASE_AGENT_PREFIX`), Task 2 (`guideLine`, `phaseSkillsFor`, `scopeClause`, `codeStyleClause`, `methodClause`, `REVERSE_PHASE_GUIDE`, `SCAFFOLD_PHASE_GUIDE`, `prdPhaseLines`, `breakdownPhaseLines`, `ESCALATION_CONTRACT`, `WORK_PHASES`), Task 3 (`AgentDef.kind/phase`).
- Produces:
  ```ts
  export type PhaseAgentContext = {
    flow: Flow; method: MethodDef; verifyScope?: VerifyScope; context: string;
    prd?: { slug: string; title?: string }; fromAudit?: string;
  };
  export function fromAuditOf(payload: unknown): string | undefined;
  export function phaseAgentInstructions(entry: PhasePlanEntry, index: number, plan: PhasePlan, ctx: PhaseAgentContext): string;
  export function buildPhaseAgents(plan: PhasePlan, ctx: PhaseAgentContext): AgentDef[];
  ```

- [x] **Step 1: Tulis test yang gagal** — `runner/test/phase-agents.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolveMethod, resolvePhasePlan } from "@hanoman/shared";
import { buildPhaseAgents, fromAuditOf } from "../src/phase-agents";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import { ESCALATION_CONTRACT } from "../src/prompt";
import type { AgentDef } from "../src/custom-agents";
import type { Flow } from "../src/types";

const planFor = (flow: Flow) => resolvePhasePlan({
  flow, runtime: "claude", orchestration: ORCHESTRATION_DEFAULTS,
  orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
})!;
const agentsFor = (flow: Flow, over: Partial<Parameters<typeof buildPhaseAgents>[1]> = {}) =>
  buildPhaseAgents(planFor(flow), {
    flow, method: resolveMethod("superpowers"), verifyScope: "changed", context: "KONTEKS-UJI", ...over,
  });
const at = (defs: AgentDef[], phase: string) => defs.find((d) => d.phase === phase)!;

describe("buildPhaseAgents (ADR-0164)", () => {
  it("satu agen fase per fase, bernama & ber-model sesuai rencana, tanpa tools", () => {
    const defs = agentsFor("feature");
    expect(defs.map((d) => d.name)).toEqual([
      "hanoman-fase-brainstorm", "hanoman-fase-objective", "hanoman-fase-spec",
      "hanoman-fase-plan", "hanoman-fase-execute",
    ]);
    for (const d of defs) {
      expect(d).toMatchObject({ kind: "phase", tools: null, model: "claude-opus-5", effort: "high", mentions: [] });
      expect(d.instructions).toContain("KONTEKS-UJI");
      expect(d.instructions).toContain("JANGAN menulis `$HANOMAN_PHASE_FILE`");
      expect(d.instructions).toContain("Status: selesai | sebagian | terhalang");
      expect(d.instructions).toContain("Pertanyaan untuk manusia:");
    }
  });

  it("skill metode hanya di fase pemiliknya; exitSkills di fase terakhir flow penulis-kode", () => {
    const defs = agentsFor("feature");
    expect(at(defs, "Brainstorm").instructions).toContain("superpowers:brainstorming");
    expect(at(defs, "Plan").instructions).toContain("superpowers:writing-plans");
    expect(at(defs, "Execute").instructions).toContain("superpowers:verification-before-completion");
    expect(at(defs, "Objective").instructions).not.toContain("Skills superpowers WAJIB");
    expect(at(defs, "Plan").instructions).not.toContain("superpowers:brainstorming");
  });

  it("Execute membawa gerbang plan, scope verifikasi, dan klausa gaya kode; fase lain tidak", () => {
    const defs = agentsFor("feature");
    expect(at(defs, "Execute").instructions).toContain("- [ ]");
    expect(at(defs, "Execute").instructions).toContain("Scope verifikasi");
    expect(at(defs, "Execute").instructions).toContain(CODE_STYLE_CLAUSE);
    expect(at(defs, "Spec").instructions).not.toContain(CODE_STYLE_CLAUSE);
  });

  it("metode matt: skill & klausa khas matt ikut, plan dir matt", () => {
    const defs = agentsFor("qa", { method: resolveMethod("matt") });
    expect(at(defs, "Plan").instructions).toContain("mattpocock-skills:to-tickets");
    expect(at(defs, "Plan").instructions).toContain("docs/matt/plans");
    expect(at(defs, "Execute").instructions).toContain("TAK BERPENUNGGU");
  });

  it("Audit qa merekomendasikan jalur, bukan menulis marker", () => {
    const audit = at(agentsFor("qa"), "Audit").instructions;
    expect(audit).toContain("Rekomendasi fase: jalur-cepat");
    expect(audit).not.toContain('echo "Spec skipped"');
  });

  it("lanjutan audit menyebut dokumen audit asal di Brainstorm", () => {
    const b = at(agentsFor("feature", { fromAudit: "SPEC-1100" }), "Brainstorm").instructions;
    expect(b).toContain("internal/docs/research/audit-spec-1100-*.md");
  });

  it("flow audit: kontrak eskalasi hanya di Laporan", () => {
    const defs = agentsFor("audit");
    expect(at(defs, "Laporan").instructions).toContain(ESCALATION_CONTRACT);
    expect(at(defs, "Audit").instructions).not.toContain(ESCALATION_CONTRACT);
    expect(at(defs, "Audit").instructions).toContain("JANGAN menulis perbaikan kode");
  });

  it("reverse: STANDAR DOCS hanya di fase penulis docs; Wawancara memakai baris panduan yang sama", () => {
    const defs = agentsFor("reverse", { method: resolveMethod() });
    expect(at(defs, "Docs teknis").instructions).toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Konvensi & index").instructions).toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Wawancara").instructions).not.toContain("=== STANDAR DOCS ===");
    expect(at(defs, "Wawancara").instructions).toContain("- Wawancara: untuk product, business");
  });

  it("prd & breakdown: baris panduan memakai slug", () => {
    expect(at(agentsFor("prd", { method: resolveMethod(), prd: { slug: "dasbor" } }), "PRD").instructions)
      .toContain("docs/prd/dasbor.md");
    expect(at(agentsFor("breakdown", { method: resolveMethod(), prd: { slug: "dasbor", title: "Dasbor" } }), "Breakdown").instructions)
      .toContain("# Breakdown: Dasbor");
  });

  it("goal: Verifikasi bukan formalitas; Goal tanpa skill", () => {
    const defs = agentsFor("goal");
    expect(at(defs, "Verifikasi").instructions).toContain("bukan formalitas");
    expect(at(defs, "Goal").instructions).not.toContain("Skills superpowers WAJIB");
  });
});

describe("fromAuditOf", () => {
  it("membaca payload.fromAudit secara defensif", () => {
    expect(fromAuditOf({ fromAudit: "SPEC-1" })).toBe("SPEC-1");
    expect(fromAuditOf({ fromAudit: "" })).toBeUndefined();
    expect(fromAuditOf(["x"])).toBeUndefined();
    expect(fromAuditOf(null)).toBeUndefined();
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run runner/test/phase-agents.test.ts`
Expected: FAIL — `Failed to resolve import "../src/phase-agents"`.

- [x] **Step 3: Implementasi** — `runner/src/phase-agents.ts`

```ts
import { PHASE_AGENT_PREFIX, type MethodDef, type PhasePlan, type PhasePlanEntry } from "@hanoman/shared";
import type { AgentDef } from "./custom-agents";
import type { Flow, VerifyScope } from "./types";
import {
  ESCALATION_CONTRACT, REVERSE_PHASE_GUIDE, SCAFFOLD_PHASE_GUIDE, WORK_PHASES, breakdownPhaseLines,
  codeStyleClause, guideLine, methodClause, phaseSkillsFor, prdPhaseLines, scopeClause,
} from "./prompt";
import { REVERSE_STANDARD } from "./reverse-standard";

// ADR-0164 · agen fase. Setiap fase flow dikerjakan subagent native `hanoman-fase-<slug>` yang
// model/effort-nya terkunci saat sesi lahir. Instruksinya potongan prompt yang di mode sesi tunggal
// hidup di prompt parent — dipindah ke fase pemiliknya, supaya kedua mode tak berselisih soal CARA
// sebuah fase dikerjakan.

export type PhaseAgentContext = {
  flow: Flow;
  method: MethodDef;
  verifyScope?: VerifyScope;
  /** Blok ekor prompt sesi tunggal (backlog/project/brief/PRD). Subagent lahir dengan konteks
   *  TERPISAH dan tak pernah melihat prompt parent, jadi blok ini wajib ikut di instruksinya. */
  context: string;
  /** flow prd: slug `docs/prd/<slug>.md`; flow breakdown: slug + judul PRD. */
  prd?: { slug: string; title?: string };
  /** id backlog audit asal (`payload.fromAudit`) untuk feature/qa lanjutan audit. */
  fromAudit?: string;
};

const PROJECT_FLOWS: ReadonlySet<Flow> = new Set(["reverse", "scaffold", "prd", "breakdown"]);
const DOC_WRITING_PHASES: ReadonlySet<string> = new Set(["Docs teknis", "Konvensi & index", "Doc index"]);

const PHASE_AGENT_AUTONOMY =
  "Kamu dipanggil orchestrator sesi hanoman, bukan manusia. Checkpoint \"review\"/\"approval\" milik "
  + "skill BUKAN titik berhenti — lanjut sampai fase ini tuntas. JANGAN bertanya ke manusia secara "
  + "langsung: bila butuh keputusan yang mengubah bentuk kerja (data model, kontrak API, scope), atau "
  + "panduan fase menyuruhmu bertanya ke manusia di terminal, tulis SATU pertanyaan di bagian "
  + "`Pertanyaan untuk manusia:` laporanmu lalu berhenti. Jawabannya datang sebagai pesan susulan ke "
  + "agen yang sama — lanjutkan dari sana dengan konteks yang sudah kamu punya.";

const PHASE_AGENT_RULES = [
  "Batas peran fase:",
  "- JANGAN menulis `$HANOMAN_PHASE_FILE` — orchestrator satu-satunya penulis marker fase.",
  "- JANGAN `git push` — push milik orchestrator. Commit artefak fasemu sendiri sebelum melapor.",
  `- JANGAN memanggil agen berawalan \`${PHASE_AGENT_PREFIX}\`. Custom agent lain boleh dipanggil bila relevan.`,
  "- Kerjakan HANYA fase ini; fase lain dikerjakan agen fasenya sendiri.",
].join("\n");

const PHASE_AGENT_REPORT = [
  "Kontrak laporan (wajib, di akhir):",
  "- Baris pertama: `Status: selesai | sebagian | terhalang`.",
  "- `Artefak:` path berkas yang kamu tulis/ubah.",
  "- `Bukti:` perintah yang dijalankan beserta hasil yang benar-benar kamu baca.",
  "- `Pertanyaan untuk manusia:` (opsional) SATU pertanyaan; bila ada, berhenti di situ.",
  "- `Rekomendasi fase:` (opsional) mis. `jalur-cepat` sesudah Audit qa.",
  "Klaim tanpa bukti bukan bukti. Maksimal 1200 kata.",
].join("\n");

const ATTACHMENT_NOTE =
  "Bila serah-terima menyebut manifest lampiran (`INDEX.md`), baca manifest itu dan lampiran yang "
  + "relevan di awal fase.";

/** Defensif seperti `readSpecMethod`: payload datang dari kolom Json. */
export function fromAuditOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>).fromAudit;
  return typeof value === "string" && value ? value : undefined;
}

function backlogGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  const m = ctx.method;
  switch (phase) {
    case "Brainstorm":
      return "- Brainstorm: gali konteks, alternatif, dan keputusan untuk backlog ini dari Source of Truth "
        + `dan kode. Tulis hasilnya sebagai bagian \`## Konteks & keputusan\` di dokumen spec baru di `
        + `\`${m.specDir}/\` (nama berkas \`<YYYY-MM-DD>-<spec-id>-<slug>-design.md\`) dan laporkan path-nya.`
        + (ctx.fromAudit
          ? ` Backlog ini LANJUTAN audit ${ctx.fromAudit}: baca \`internal/docs/research/audit-`
            + `${ctx.fromAudit.toLowerCase()}-*.md\` lebih dulu dan pakai temuannya sebagai bahan — jangan `
            + "menginvestigasi ulang dari nol."
          : "");
    case "Objective":
      return "- Objective: baca dokumen spec dari fase Brainstorm (path-nya di serah-terima), lalu tambahkan "
        + "bagian `## Objective` berisi SATU objective terukur beserta kriteria suksesnya.";
    case "Spec":
      return flow === "qa"
        ? `- Spec: tulis dokumen spec perbaikan di \`${m.specDir}/\` dari dokumen audit fase Audit (path-nya `
          + "di serah-terima): akar masalah, bentuk perbaikan, dan acceptance criteria gaya EARS."
        : "- Spec: lengkapi dokumen spec yang sama — arsitektur, komponen, kontrak data/API, penanganan "
          + "galat, dan acceptance criteria gaya EARS. Perbarui docs Source of Truth yang tersentuh.";
    case "Plan":
      return `- Plan: tulis plan implementasi berkotak \`- [ ]\` di \`${m.planDir}/\` untuk backlog ini dari `
        + "dokumen spec-nya (path di serah-terima).";
    case "Execute":
      return `- Execute: kerjakan plan di \`${m.planDir}/**\` untuk backlog ini. Execute BELUM selesai selama `
        + "plan masih punya task `- [ ]`: kerjakan SEMUA task sampai tiap kotak jadi `- [x]` sebelum melapor "
        + "`Status: selesai`. hanoman menahan backlog di `executing`, bukan `done`, selama masih ada `- [ ]`.";
    case "Audit":
      return flow === "audit"
        ? "- Audit: ini audit-only — investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Telusuri akar "
          + "masalah / log / jawaban dan nilai apakah issue terdefinisi dengan baik. Laporkan temuan beserta "
          + "buktinya; dokumennya ditulis fase Laporan."
        : "- Audit: telusuri akar masalah dengan bukti (reproduksi, log, kode) dan tulis dokumen audit ke "
          + "`internal/docs/research/audit-<spec-id>-<slug>.md`. Lalu putuskan jalurnya dari hasil Audit, "
          + "bukan default: bila temuan berconfidence tinggi dan perbaikannya bisa dikerjakan langsung (diff "
          + "kecil, akar masalah jelas), tulis `Rekomendasi fase: jalur-cepat` beserta alasannya — "
          + "orchestrator akan melewati Spec & Plan dan dokumen audit menjadi doc-of-record perbaikan itu. "
          + "Bila temuan luas, berisiko, atau ambigu, tulis `Rekomendasi fase: penuh`.";
    case "Laporan":
      return "- Laporan: tulis DOKUMEN AUDIT ke Source of Truth `internal/docs/research/audit-<spec-id>-<slug>.md` "
        + "(ikuti konvensi audit yang ada), tautkan di `internal/docs/README.md`, memuat: keluhan/pertanyaan, "
        + "temuan (dengan bukti/log), apakah issue terdefinisi baik, dan rekomendasi tindak lanjut. Commit "
        + "dokumen itu. Tak ada kode fitur.\n\n" + ESCALATION_CONTRACT;
    case "Goal":
      return "- Goal: kerjakan goal di blok KONTEKS sampai tercapai. TIDAK ada design doc, plan berkotak, "
        + "maupun backlog baru.";
    case "Verifikasi":
      return "- Verifikasi: bukan formalitas — jalankan perintah yang membuktikan goal-nya tercapai "
        + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output bukan bukti.";
    case "Kerjakan":
      return "- Kerjakan: SATU pekerjaan remeh. Langsung kerjakan dan buktikan seperlunya di fase yang sama. "
        + "Jangan menulis design doc, plan berkotak, backlog baru, atau fase tambahan.";
    default:
      return "";
  }
}

function projectGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  if (flow === "reverse") return guideLine(REVERSE_PHASE_GUIDE, phase);
  if (flow === "scaffold") return guideLine(SCAFFOLD_PHASE_GUIDE, phase);
  const slug = ctx.prd?.slug ?? flow;
  const lines: Record<string, string> = flow === "prd"
    ? prdPhaseLines(slug)
    : breakdownPhaseLines(slug, ctx.prd?.title ?? slug);
  return lines[phase] ?? "";
}

export function phaseAgentInstructions(
  entry: PhasePlanEntry, index: number, plan: PhasePlan, ctx: PhaseAgentContext,
): string {
  const { flow, method } = ctx;
  const phase = entry.phase;
  const guide = PROJECT_FLOWS.has(flow) ? projectGuide(flow, phase, ctx) : backlogGuide(flow, phase, ctx);
  const skills = phaseSkillsFor(flow, phase, method);
  const work = (WORK_PHASES as readonly string[]).includes(phase);
  return [
    `Kamu agen fase "${phase}" (fase ${index + 1}/${plan.phases.length}) flow ${flow} hanoman. Ikuti `
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam "
      + "commit yang sama.",
    guide,
    DOC_WRITING_PHASES.has(phase) ? `=== STANDAR DOCS ===\n${REVERSE_STANDARD}` : "",
    skills.length
      ? `Skills ${method.label} WAJIB untuk fase ini — muat & ikuti dengan mekanisme yang tersedia di agenmu: `
        + skills.join(", ")
      : "",
    work ? scopeClause(flow, ctx.verifyScope) : "",
    work ? codeStyleClause(flow) : "",
    methodClause(method),
    ATTACHMENT_NOTE,
    PHASE_AGENT_AUTONOMY,
    PHASE_AGENT_RULES,
    PHASE_AGENT_REPORT,
    `=== KONTEKS ===\n${ctx.context}`,
  ].filter(Boolean).join("\n\n");
}

export function buildPhaseAgents(plan: PhasePlan, ctx: PhaseAgentContext): AgentDef[] {
  return plan.phases.map((entry, index) => ({
    kind: "phase" as const,
    phase: entry.phase,
    name: entry.agentName,
    description: `Fase ${entry.phase} flow ${plan.flow} hanoman — hanya dipanggil orchestrator sesi ini.`,
    instructions: phaseAgentInstructions(entry, index, plan, ctx),
    tools: null,
    model: entry.model,
    effort: entry.effort,
    mentions: [],
  }));
}
```

Di `runner/src/index.ts`, tambahkan sesudah `export * from "./agent-definition";`:

```ts
export * from "./phase-agents";
```

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run runner/test/phase-agents.test.ts runner/test/prompt-golden.test.ts`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
/usr/bin/git add runner/src/phase-agents.ts runner/test/phase-agents.test.ts runner/src/index.ts
/usr/bin/git commit -m "feat(orkestrasi): definisi agen fase dari potongan prompt per fase"
```

### Task 5: Klausa orchestrator di delapan pembangun prompt

**Files:**
- Modify: `runner/src/prompt.ts`
- Create: `runner/test/orchestrator-prompt.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PhasePlan`), Task 2 (blok konteks & helper).
- Produces:
  ```ts
  export function orchestratorClause(plan: PhasePlan, o?: { fastPath?: boolean }): string;
  // parameter terakhir BARU, opsional; null/absen = mode sesi tunggal byte-identik:
  startPrompt(flow, spec, branchTo, autonomy?, verifyScope?, method?, attachments?, plan?: PhasePlan | null)
  continuePrompt(flow, spec, branchTo, autonomy?, verifyScope?, method?, attachments?, plan?: PhasePlan | null)
  resumePrompt(flow, spec, branchTo, resume, autonomy?, verifyScope?, method?, attachments?, plan?: PhasePlan | null)
  startGoalPrompt(flow, spec, branchTo, opts: { …; plan?: PhasePlan | null })
  startProjectPrompt(flow, project, branchTo, plan?: PhasePlan | null)
  startPrdPrompt(project, brief, branchTo, audit?, plan?: PhasePlan | null)
  startBreakdownPrompt(project, prd, branchTo, plan?: PhasePlan | null)
  startScaffoldPrompt(project, branchTo, plan?: PhasePlan | null)
  ```

- [x] **Step 1: Tulis test yang gagal** — `runner/test/orchestrator-prompt.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { ORCHESTRATION_DEFAULTS, resolvePhasePlan, type Orchestration } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "../src/code-style";
import {
  orchestratorClause, startPrompt, continuePrompt, resumePrompt, startGoalPrompt, startProjectPrompt,
  startPrdPrompt, startBreakdownPrompt, startScaffoldPrompt, specContext,
} from "../src/prompt";
import type { Flow } from "../src/types";

const plan = (flow: Flow, runtime: "claude" | "codex" = "claude", orchestration: Orchestration = ORCHESTRATION_DEFAULTS) =>
  resolvePhasePlan({
    flow, runtime, orchestration, orchestrator: { model: "claude-opus-5", effort: "high" }, nativeAgents: true,
  })!;
const spec = { id: "SPEC-9", title: "T", source: "brief", priority: "sedang", objective: "O", payload: { a: 1 } };
const project = { id: "p1", name: "P1", desc: "d", stack: "ts" };

describe("orchestratorClause (ADR-0164)", () => {
  it("mendaftar agen fase ber-model/effort, aturan ulang/eskalasi/relay, dan larangan", () => {
    const o: Orchestration = { ...ORCHESTRATION_DEFAULTS,
      feature: { enabled: true, claude: { Plan: { model: "claude-sonnet-5", effort: "low" } }, codex: {} } };
    const c = orchestratorClause(plan("feature", "claude", o));
    expect(c).toContain("Sesi ini ORCHESTRATOR");
    expect(c).toContain("4. Plan → `hanoman-fase-plan` · claude-sonnet-5 · low");
    expect(c).toContain("`Fase <Nama Fase>`");
    expect(c).toContain("Percobaan: <k>/2");
    expect(c).toContain("AskUserQuestion");
    expect(c).toContain("SendMessage");
    expect(c).toContain("DILARANG mengerjakan isi fase sendiri");
    expect(c).not.toContain("jalur-cepat");
  });
  it("codex memakai spawn_agent & send_input; fastPath menambah aturan jalur cepat", () => {
    const c = orchestratorClause(plan("qa", "codex"), { fastPath: true });
    expect(c).toContain("spawn_agent");
    expect(c).toContain("send_input");
    expect(c).toContain("`Rekomendasi fase: jalur-cepat`");
  });
});

describe("pembangun prompt · mode orchestrator (ADR-0164)", () => {
  it("rencana null identik dengan tanpa rencana", () => {
    expect(startPrompt("feature", spec, "b", undefined, "changed", undefined, undefined, null))
      .toBe(startPrompt("feature", spec, "b", undefined, "changed"));
  });
  it("startPrompt dengan rencana: kontrak delegasi tanpa cara mengerjakan fase", () => {
    const p = startPrompt("feature", spec, "hanoman/spec-9", undefined, "changed", undefined, undefined, plan("feature"));
    expect(p).toContain("Sesi ini ORCHESTRATOR");
    expect(p).toContain(specContext(spec));
    expect(p).toContain("git push origin HEAD:refs/heads/hanoman/spec-9");
    for (const bocor of ["superpowers:brainstorming", "Kerjakan fase berurutan", "Scope verifikasi", CODE_STYLE_CLAUSE])
      expect(p).not.toContain(bocor);
  });
  it("qa start memuat jalur cepat; resume qa yang Audit-nya sudah tercatat tidak", () => {
    expect(startPrompt("qa", spec, "b", undefined, undefined, undefined, undefined, plan("qa"))).toContain("jalur-cepat");
    const resume = { recorded: ["Audit done"], next: "Spec", worktreeKept: true };
    const r = resumePrompt("qa", spec, "b", resume, undefined, undefined, undefined, undefined, plan("qa"));
    expect(r).toContain("Lanjutkan dari fase: Spec.");
    expect(r).not.toContain("jalur-cepat");
  });
  it("continuePrompt hanya melanjutkan Execute", () => {
    const full = plan("feature");
    const p = continuePrompt("feature", spec, "b", undefined, undefined, undefined, undefined,
      { ...full, phases: full.phases.filter((x) => x.phase === "Execute") });
    expect(p).toContain("1. Execute → `hanoman-fase-execute`");
    expect(p).not.toContain("hanoman-fase-plan");
  });
  it("startGoalPrompt dengan rencana: klausa Verifikasi pindah ke agen fase", () => {
    const g = { ...spec, source: "goal", payload: { goal: "Hijau" } };
    const p = startGoalPrompt("goal", g, "b", { plan: plan("goal") });
    expect(p).toContain("Goal: Hijau");
    expect(p).toContain("hanoman-fase-verifikasi");
    expect(p).not.toContain("bukan formalitas");
  });
  it("reverse/scaffold/prd/breakdown: STANDAR DOCS & isi PRD tak masuk prompt orchestrator", () => {
    expect(startProjectPrompt("reverse", project, "reverse-docs", plan("reverse"))).not.toContain("=== STANDAR DOCS ===");
    expect(startScaffoldPrompt(project, "scaffold-docs", plan("scaffold"))).not.toContain("=== STANDAR DOCS ===");
    expect(startPrdPrompt(project, { title: "T", context: "c", outcome: "o" }, "prd/t", undefined, plan("prd")))
      .toContain("Brief — Judul: T");
    const b = startBreakdownPrompt(project, { title: "PRD", path: "docs/prd/p.md", content: "ISI-PRD-RAHASIA" },
      "breakdown/p", plan("breakdown"));
    expect(b).toContain("PRD: PRD (docs/prd/p.md)");
    expect(b).not.toContain("ISI-PRD-RAHASIA");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run runner/test/orchestrator-prompt.test.ts`
Expected: FAIL — `orchestratorClause is not a function` / `does not provide an export named 'orchestratorClause'`.

- [x] **Step 3: Tambah `orchestratorClause`** — `runner/src/prompt.ts`

Baris impor shared menjadi:

```ts
import { resolveMethod, FLOW_PHASES, type MethodDef, type PhasePlan } from "@hanoman/shared";
```

Sisipkan tepat sesudah `phaseSkillsFor` (Task 2):

```ts
// ADR-0164 · kontrak orchestrator. Yang mengikat model/effort tiap fase adalah DEFINISI subagent
// (argv saat lahir); klausa ini hanya menyuruh mendelegasikan — dan setiap delegasi meninggalkan
// bukti SubagentStart/Stop, jadi pelanggarannya terlihat, tidak diam seperti ADR-0058.
// Deskripsi pemanggilan `Fase <Nama Fase>` wajib: stdin `subagentStatusLine` claude hanya membawa
// deskripsi itu sebagai label, tanpa nama agen (terukur 2026-09-14).
export function orchestratorClause(plan: PhasePlan, o: { fastPath?: boolean } = {}): string {
  const codex = plan.runtime === "codex";
  const call = codex ? "spawn_agent" : "tool Agent";
  const resume = codex ? "send_input ke agent id yang sama" : "SendMessage ke agent ID yang kamu terima";
  const list = plan.phases
    .map((p, i) => `${i + 1}. ${p.phase} → \`${p.agentName}\` · ${p.model} · ${p.effort}`)
    .join("\n");
  return [
    "Sesi ini ORCHESTRATOR. Setiap fase dikerjakan subagent fase miliknya dengan model & effort yang "
      + "sudah terkunci di definisinya — kamu TIDAK mengerjakan isi fase sendiri.",
    `Fase berurutan:\n${list}`,
    "Untuk SETIAP fase, berurutan:",
    `1. Panggil subagent fasenya lewat ${call}. Isi deskripsi pemanggilan persis \`Fase <Nama Fase>\`, dan `
      + "tugasnya berupa blok serah-terima berbentuk tetap:\n"
      + "Fase <n>/<total>: <Nama Fase>\nTujuan: <objective backlog/project>\n"
      + "Base SHA: $HANOMAN_BASE_SHA (atau -)\nArtefak fase sebelumnya: <path yang dilaporkan, atau ->\n"
      + "Keputusan manusia sejauh ini: <ringkas, atau ->\nLampiran: <path INDEX.md lampiran, atau ->\n"
      + "Percobaan: <k>/2",
    "2. Baca laporannya. `Status: selesai` DENGAN bukti → append satu baris ke berkas di $HANOMAN_PHASE_FILE "
      + "— persis: `echo \"<Nama Fase> done\" >> \"$HANOMAN_PHASE_FILE\"`. Kamu satu-satunya penulis berkas itu.",
    "3. `Status: sebagian`/`terhalang`, galat, atau laporan tanpa bukti → delegasikan ULANG SEKALI ke "
      + "subagent fase yang sama dengan laporan gagalnya disertakan (`Percobaan: 2/2`). Gagal lagi → "
      + "BERHENTI dan tanyakan lewat AskUserQuestion apa yang harus dilakukan. Aturan ini berlaku walau "
      + "klausa otonomi di prompt ini menyuruhmu tak bertanya.",
    "4. `Pertanyaan untuk manusia:` di laporan → tanyakan ke manusia (AskUserQuestion; di fase yang memang "
      + "bergiliran dengan manusia — Wawancara, Brainstorm prd/scaffold — tanyakan di terminal ini), lalu "
      + `LANJUTKAN subagent yang SAMA lewat ${resume} dengan jawabannya. Giliran relay ini bukan percobaan `
      + "ulang. Di sesi tanpa pengawas, putuskan sendiri lalu teruskan keputusanmu dengan cara yang sama.",
    o.fastPath
      ? "5. `Rekomendasi fase: jalur-cepat` sesudah Audit → append `Spec skipped` lalu `Plan skipped` ke "
        + "$HANOMAN_PHASE_FILE (format yang sama), lanjut ke Execute. `penuh` → Spec → Plan → Execute."
      : "",
    "DILARANG mengerjakan isi fase sendiri — termasuk saat subagent gagal. Menulis `skipped` untuk fase "
      + "yang dilewati bukan mengerjakannya.",
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 4: `startPrompt`, `continuePrompt`, `resumePrompt`** — ganti ketiga fungsi dengan bentuk berikut (komentar di atas fungsi & di dalam `resumePrompt` dipertahankan)

```ts
export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx, plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  const head = `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
    + `dan link-nya di index, dalam commit yang sama.`;
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  // ADR-0164 · orchestrator: CARA mengerjakan fase (skill, panduan, scope, gaya kode, keputusan
  // pasca-Audit) hidup di definisi agen fase — prompt parent hanya membawa kontrak delegasi.
  if (plan) {
    return [
      head, orchestratorClause(plan, { fastPath: flow === "qa" }), auditContinuationInstruction(flow, spec),
      autonomyClause(autonomy), attachmentClause(attachments), push, specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    phaseInstruction(PIPELINES[flow], m),
    auditDecisionInstruction(flow),
    auditContinuationInstruction(flow, spec),
    auditOnlyInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}

export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx, plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  const head = `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
    + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
    + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`;
  const push = `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
    + `ini detached HEAD — itu memang disengaja.`;
  if (plan) {
    return [
      head,
      `JANGAN mengulang fase awal — spec & plan sudah ada di ${m.planDir}/**. Lanjutkan HANYA fase `
        + "Execute lewat subagent fasenya.",
      orchestratorClause(plan), autonomyClause(autonomy), attachmentClause(attachments), push, specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di ${m.planDir}/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(["Execute"], m, writesCode(flow)),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}

export function resumePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
  autonomy?: Autonomy, verifyScope?: VerifyScope, method?: string, attachments?: AttachmentCtx,
  plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  const auditDecided = resume.recorded.some((line) => line.startsWith("Audit "));
  const head = `hanoman ${flow} — MELANJUTKAN sesi backlog yang sudah berjalan. Ikuti internal/docs sebagai `
    + `Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam commit yang sama.`;
  const resumed = resumeClause(resume, branchTo, m.planDir, PIPELINES[flow].includes("Plan"));
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  if (plan) {
    return [
      head, resumed, orchestratorClause(plan, { fastPath: flow === "qa" && !auditDecided }),
      autonomyClause(autonomy), attachmentClause(attachments), push, specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    resumed,
    phaseInstruction(PIPELINES[flow], m),
    auditDecided ? "" : auditDecisionInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}
```

- [x] **Step 5: `startGoalPrompt`** — tambah `plan?: PhasePlan | null` ke tipe `opts`; pindahkan ekspresi ternary elemen pertama array APA ADANYA ke `const head = …;`, lalu badan fungsi menjadi:

```ts
  const m = resolveMethod(opts.method);
  const noEffort = flow === "no_effort";
  const head = noEffort
    ? "hanoman no-effort — sesi ini mengerjakan SATU pekerjaan remeh lalu berhenti. TIDAK ada "
      + "fase Brainstorm, Objective, Spec, Plan, maupun fase pembuktian terpisah: jangan menulis "
      + "design doc, jangan menulis plan berkotak, jangan memecah pekerjaan ini jadi backlog "
      + "baru, dan jangan menambah fase sendiri. Langsung kerjakan, buktikan seperlunya di fase "
      + "yang sama, lalu berhenti. Tetap ikuti internal/docs sebagai Source of Truth; perbarui "
      + "docs yang tersentuh dan link-nya di index, dalam commit yang sama."
    : "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.";
  const resumed = opts.resume ? resumeClause(opts.resume, branchTo, m.planDir, false) : "";
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  if (opts.plan) {
    return [
      head, resumed, goalDetail(spec), orchestratorClause(opts.plan), autonomyClause(opts.autonomy),
      attachmentClause(opts.attachments), push, goalBlock(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    resumed,
    goalDetail(spec),
    phaseInstruction(PIPELINES[flow], m),
    noEffort ? ""
      : "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
        + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
        + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause(flow, opts.verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(opts.attachments),
    skillInstruction(PIPELINES[flow], m, writesCode(flow)),
    push,
    goalBlock(spec),
  ].filter(Boolean).join("\n\n");
```

(`head` adalah ekspresi ternary elemen pertama array lama, dipindah apa adanya; golden test menolak satu karakter pun yang berubah.)

- [x] **Step 6: Empat pembangun project** — tambah parameter `plan?: PhasePlan | null` dan cabang orchestrator di awal badan; array mode tunggal tak berubah.

```ts
export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string, plan?: PhasePlan | null): string {
  const push = `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
    + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
    + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
    + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`;
  if (plan) {
    return [
      `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/** lewat subagent `
        + "fase; STANDAR DOCS ada di definisi agen fase penulis docs.",
      orchestratorClause(plan), push, projectContext(project),
    ].join("\n\n");
  }
  return [
    `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/**, `
      + `mengikuti STANDAR DOCS di bagian bawah prompt ini.`,
    phaseInstruction(PIPELINES[flow], PROJECT_METHOD),
    REVERSE_PHASE_GUIDE,
    push,
    projectContext(project),
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].join("\n\n");
}
```

`startScaffoldPrompt(project, branchTo, plan?)`: angkat elemen push yang ada ke `const push`, lalu tambahkan di awal badan:

```ts
  if (plan) {
    return [
      "hanoman scaffold. Susun Source of Truth LENGKAP untuk project from-scratch ini di internal/docs/** "
        + "DARI IDE-nya lewat subagent fase; STANDAR DOCS ada di definisi agen fase Doc index. Belum ada "
        + "kode — docs dulu.",
      orchestratorClause(plan), push, scaffoldContext(project),
    ].join("\n\n");
  }
```

`startPrdPrompt(project, brief, branchTo, audit?, plan?)`: angkat elemen push yang ada ke `const push`, lalu sesudah `const slug = …`:

```ts
  if (plan) {
    return [
      "hanoman prd. Kamu memimpin penyusunan SATU dokumen PRD untuk project ini lewat subagent fase. "
        + "Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.",
      orchestratorClause(plan), push, prdBriefBlock(project, brief),
    ].join("\n\n");
  }
```

`startBreakdownPrompt(project, prd, branchTo, plan?)`: angkat elemen push yang ada ke `const push`, lalu sesudah `const slug = …`:

```ts
  if (plan) {
    return [
      "hanoman breakdown. Kamu memimpin pemecahan SATU PRD kompleks menjadi BEBERAPA backlog kecil yang "
        + "bisa dikerjakan PARALEL lewat subagent fase. Keluaranmu HANYA dokumen manifest — JANGAN "
        + "menulis kode fitur.",
      orchestratorClause(plan), AUTONOMY_CLAUSE, push,
      `Project ${project.id} · ${project.name}\nPRD: ${prd.title} (${prd.path})`,
    ].join("\n\n");
  }
```

- [x] **Step 7: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run runner/test/orchestrator-prompt.test.ts runner/test/prompt-golden.test.ts runner/test/prompt.test.ts runner/test/phase-agents.test.ts runner/test/escalation-prompt.test.ts`
Expected: PASS semua; golden tanpa `-u`.

Run: `rtk proxy pnpm --filter ./runner typecheck && rtk proxy pnpm --filter ./server typecheck`
Expected: exit 0 (parameter baru opsional — pemanggil server belum berubah).

- [x] **Step 8: Commit**

```bash
/usr/bin/git add runner/src/prompt.ts runner/test/orchestrator-prompt.test.ts
/usr/bin/git commit -m "feat(orkestrasi): klausa orchestrator di delapan pembangun prompt"
```

### Task 6: `subagentStatusLine` claude

**Files:**
- Create: `runner/src/subagent-statusline.ts`
- Create: `runner/test/subagent-statusline.test.ts`
- Modify: `runner/src/settings.ts:47-83` (`guardSettings`)
- Modify: `runner/src/agent-cli.ts`
- Modify: `runner/src/index.ts`
- Test: `runner/test/settings.test.ts`, `runner/test/agent-cli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SUBAGENT_STATUSLINE_SCRIPT: string;            // CommonJS, dijalankan `node`
  export function writeSubagentStatusline(dir: string): string; // tulis skrip + label model, kembalikan command
  guardSettings(decisionFile?, goal?, eventHook?, subagentStatusLine?: string)
  AgentFlagsOpts.subagentStatusLine?: string                    // claude saja
  ```
- Kontrak stdin (terukur claude 2.1.270, 2026-09-14): `{ tasks: [{ id, type: "local_agent", status, description, label, startTime /* epoch ms */, model, effort?, tokenCount }] }`. Baris dikembalikan sebagai `{"id","content"}` per baris; id yang tak ditulis memakai baris bawaan.

- [x] **Step 1: Tulis test yang gagal** — `runner/test/subagent-statusline.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSubagentStatusline } from "../src/subagent-statusline";

const run = (command: string, stdin: string) =>
  spawnSync("sh", ["-c", command], { input: stdin, encoding: "utf8" });

describe("subagentStatusLine (ADR-0164)", () => {
  it("menulis ulang baris subagent jadi label · model · effort · durasi · token", () => {
    const dir = mkdtempSync(join(tmpdir(), "hnm-sl-"));
    const command = writeSubagentStatusline(dir);
    const out = run(command, JSON.stringify({ tasks: [{
      id: "a9aec", type: "local_agent", status: "running", description: "Fase Spec", label: "Fase Spec",
      startTime: Date.now() - 72_000, model: "claude-opus-5", effort: "high", tokenCount: 18_400,
    }] }));
    expect(out.status).toBe(0);
    const row = JSON.parse(out.stdout.trim()) as { id: string; content: string };
    expect(row.id).toBe("a9aec");
    expect(row.content).toMatch(/^Fase Spec · Opus 5 · high · 1m1[23]s · 18k tok$/);
    expect(readFileSync(join(dir, "subagent-models.json"), "utf8")).toContain("Opus 5");
  });

  it("effort absen (mewarisi sesi) tak dikarang; model tak dikenal ditampilkan apa adanya", () => {
    const command = writeSubagentStatusline(mkdtempSync(join(tmpdir(), "hnm-sl-")));
    const out = run(command, JSON.stringify({ tasks: [{
      id: "b1", label: "Fase Plan", startTime: Date.now(), model: "model-baru", tokenCount: 0,
    }] }));
    expect(JSON.parse(out.stdout.trim()).content).toMatch(/^Fase Plan · model-baru · 0s$/);
  });

  it("stdin rusak → keluar 0 tanpa baris (claude memakai baris bawaan)", () => {
    const command = writeSubagentStatusline(mkdtempSync(join(tmpdir(), "hnm-sl-")));
    const out = run(command, "{bukan json");
    expect(out.status).toBe(0);
    expect(out.stdout).toBe("");
  });
});
```

Tambahkan di `runner/test/settings.test.ts` (impor `guardSettings` sudah ada di berkas itu):

```ts
describe("guardSettings · subagentStatusLine (ADR-0164)", () => {
  it("tanpa command: bentuk lama persis — hanya kunci hooks", () => {
    expect(Object.keys(guardSettings("/m", undefined, true))).toEqual(["hooks"]);
  });
  it("dengan command: kunci subagentStatusLine bertipe command", () => {
    expect(guardSettings(undefined, undefined, true, 'node "/t/s.cjs" "/t/m.json"').subagentStatusLine)
      .toEqual({ type: "command", command: 'node "/t/s.cjs" "/t/m.json"' });
  });
});
```

Tambahkan di `runner/test/agent-cli.test.ts` (impor `agentFlags` sudah ada):

```ts
describe("agentFlags · subagentStatusLine (ADR-0164)", () => {
  it("claude: masuk ke JSON --settings; codex: diabaikan", () => {
    const claude = agentFlags({ agent: "claude", subagentStatusLine: "node x" });
    const settings = JSON.parse(claude[claude.indexOf("--settings") + 1]!);
    expect(settings.subagentStatusLine).toEqual({ type: "command", command: "node x" });
    expect(agentFlags({ agent: "codex", subagentStatusLine: "node x" }).join(" ")).not.toContain("node x");
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run runner/test/subagent-statusline.test.ts runner/test/settings.test.ts runner/test/agent-cli.test.ts`
Expected: FAIL — modul `../src/subagent-statusline` tak ada; `subagentStatusLine` undefined.

- [x] **Step 3: Implementasi** — `runner/src/subagent-statusline.ts`

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODELS } from "@hanoman/shared";

// ADR-0164 · baris subagent di TUI claude memperlihatkan fase · model · effort. stdin
// `subagentStatusLine` tak membawa nama agen — `label` adalah deskripsi pemanggilan, dan
// orchestrator diwajibkan mengisinya `Fase <Nama Fase>`. Model & effort dibaca dari task itu
// sendiri (nilai yang benar-benar dipakai runtime), bukan dari roster.
// Fail-open: galat apa pun = tak ada keluaran = claude memakai baris bawaannya.
export const SUBAGENT_STATUSLINE_SCRIPT = [
  "const fs = require(\"node:fs\");",
  "const labelsPath = process.argv[2];",
  "let raw = \"\";",
  "process.stdin.setEncoding(\"utf8\");",
  "process.stdin.on(\"data\", (c) => { raw += c; });",
  "process.stdin.on(\"end\", () => {",
  "  try {",
  "    const labels = JSON.parse(fs.readFileSync(labelsPath, \"utf8\"));",
  "    const tasks = JSON.parse(raw).tasks || [];",
  "    const rows = [];",
  "    for (const t of tasks) {",
  "      if (!t || typeof t.id !== \"string\" || typeof t.model !== \"string\") continue;",
  "      const parts = [t.label || t.description || \"subagent\", labels[t.model] || t.model];",
  "      if (typeof t.effort === \"string\") parts.push(t.effort);",
  "      if (typeof t.startTime === \"number\") {",
  "        const s = Math.max(0, Math.round((Date.now() - t.startTime) / 1000));",
  "        parts.push(s >= 60 ? Math.floor(s / 60) + \"m\" + String(s % 60).padStart(2, \"0\") + \"s\" : s + \"s\");",
  "      }",
  "      if (typeof t.tokenCount === \"number\" && t.tokenCount > 0) parts.push(Math.round(t.tokenCount / 1000) + \"k tok\");",
  "      rows.push(JSON.stringify({ id: t.id, content: parts.join(\" · \") }));",
  "    }",
  "    if (rows.length) process.stdout.write(rows.join(\"\\n\") + \"\\n\");",
  "  } catch {}",
  "});",
].join("\n");

/** Tulis skrip + peta label model ke `dir` (temp dir sesi, di luar worktree) dan kembalikan command-nya. */
export function writeSubagentStatusline(dir: string): string {
  const script = join(dir, "subagent-statusline.cjs");
  const labels = join(dir, "subagent-models.json");
  writeFileSync(script, SUBAGENT_STATUSLINE_SCRIPT, { mode: 0o600 });
  writeFileSync(labels, JSON.stringify(Object.fromEntries(MODELS.map((m) => [m.id, m.label]))), { mode: 0o600 });
  return `node ${JSON.stringify(script)} ${JSON.stringify(labels)}`;
}
```

`runner/src/settings.ts` — ganti tanda tangan & baris kembalian `guardSettings`:

```ts
export const guardSettings = (
  decisionFile?: string, goal?: string, eventHook?: boolean, subagentStatusLine?: string,
) => {
```

```ts
  if (goal) hooks.Stop = [{ hooks: [{ type: "prompt", prompt: goal }] }];
  // ADR-0164 · kunci ini hanya lahir untuk sesi orchestrator — tanpanya JSON `--settings` persis
  // seperti sebelumnya (byte-identik untuk flow yang orkestrasinya mati).
  return {
    hooks,
    ...(subagentStatusLine ? { subagentStatusLine: { type: "command", command: subagentStatusLine } } : {}),
  };
```

`runner/src/agent-cli.ts` — tambah field di `AgentFlagsOpts`:

```ts
  /** ADR-0164 · command `subagentStatusLine` claude; hanya sesi orchestrator. Codex tak punya padanan. */
  subagentStatusLine?: string;
```

dan baris `--settings` claude menjadi:

```ts
    "--settings", JSON.stringify(guardSettings(o.decisionFile, o.goal, o.eventHook, o.subagentStatusLine)),
```

`runner/src/index.ts` — tambahkan `export * from "./subagent-statusline";`.

- [x] **Step 4: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run runner/test/subagent-statusline.test.ts runner/test/settings.test.ts runner/test/agent-cli.test.ts runner/test/codex-settings.test.ts`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./runner typecheck`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
/usr/bin/git add runner/src/subagent-statusline.ts runner/test/subagent-statusline.test.ts runner/src/settings.ts runner/src/agent-cli.ts runner/src/index.ts runner/test/settings.test.ts runner/test/agent-cli.test.ts
/usr/bin/git commit -m "feat(orkestrasi): subagentStatusLine claude menampilkan fase, model, effort"
```

### Task 7: `createSession` — materialisasi agen fase, fallback, opsi tmux, roster ber-fase

**Files:**
- Modify: `server/src/services/pty.ts` (tipe `SessionInfo`/`SessionAgentMeta`/`CreateOpts`, `FMT`, `parsePanes`, `parseAgentRoster`, `toSessionInfo`, `createSession`, `nativeAgentsAvailable`)
- Modify: `server/test/pty-parse.test.ts`
- Create: `server/test/phase-agents.pty.test.ts`

**Interfaces:**
- Consumes: Task 3 (`AgentDef.kind/phase`, `materializeCodexAgents({ maxDepth })`), Task 6 (`writeSubagentStatusline`, `agentFlags({ subagentStatusLine })`).
- Produces:
  ```ts
  // server/src/services/pty.ts
  CreateOpts.phaseAgents?: AgentDef[];   // terisi = minta sesi orchestrator
  CreateOpts.legacyPrompt?: string;      // prompt mode tunggal dari input yang sama
  SessionInfo.model?: string; SessionInfo.effort?: string; SessionInfo.orchestrated?: boolean;
  SessionAgentMeta.phase?: string; SessionAgentMeta.effort?: string;
  export const nativeAgentsAvailable: (agent: Agent) => boolean;
  ```
- Aturan: orchestrated = `phaseAgents.length > 0` **dan** seluruh agen fase termaterialisasi. Gagal satu → pakai `legacyPrompt`, buang agen fase, tanpa `@hanoman_orchestrated`/`subagentStatusLine`, peringatan stderr. Sesi tanpa `phaseAgents`: argv & berkas agen byte-identik dengan sebelumnya.

- [x] **Step 1: Tulis test yang gagal** — `server/test/phase-agents.pty.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession, getSession, killSession, registerCustomAgentSource, registerCodexNativeAgentSupport,
  agentsFilePath, promptFilePath, agentTempDir,
} from "../src/services/pty";
import { renderAgentsJson, type AgentDef } from "@hanoman/runner";

// ADR-0164 · kontrak orchestrator di titik cekik kelahiran sesi. Bukti dibaca dari berkas sesi dan
// layar pane ber-binary /bin/echo — bukan dari bentuk respons (pelajaran `sessionModel()`).

const phaseAgents: AgentDef[] = [
  { kind: "phase", phase: "Spec", name: "hanoman-fase-spec", description: "Fase Spec",
    instructions: "INSTRUKSI SPEC", tools: null, model: "claude-sonnet-5", effort: "low", mentions: [] },
  { kind: "phase", phase: "Plan", name: "hanoman-fase-plan", description: "Fase Plan",
    instructions: "INSTRUKSI PLAN", tools: null, model: "claude-opus-5", effort: "high", mentions: [] },
];
const scout: AgentDef = { name: "scout", description: "cari", instructions: "kamu pencari", tools: null, model: null, mentions: [] };

let cwd: string;
const ids: string[] = [];
const born = (id: string): string => { ids.push(id); return id; };
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "hnm-orch-")); });
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
    expect(j["hanoman-fase-spec"]).toEqual({
      description: "Fase Spec", prompt: "INSTRUKSI SPEC", model: "claude-sonnet-5", effort: "low",
    });
    expect(readFileSync(promptFilePath(s.id), "utf8").startsWith("PROMPT ORCHESTRATOR")).toBe(true);
    const p = getSession(s.id)!;
    expect(p).toMatchObject({ orchestrated: true, model: "claude-opus-5", effort: "xhigh" });
    expect(p.agentRoster!.find((r) => r.name === "hanoman-fase-spec"))
      .toMatchObject({ phase: "Spec", model: "claude-sonnet-5", effort: "low" });
    expect(existsSync(join(agentTempDir(s.id), "subagent-statusline.cjs"))).toBe(true);
  });

  it("claude: --settings memuat subagentStatusLine hanya untuk sesi diorkestrasi", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const a = createSession("p1", cwd, { id: born("orch-sl-a"), agent: "claude", prompt: "P", legacyPrompt: "L", phaseAgents });
    const b = createSession("p1", cwd, { id: born("orch-sl-b"), agent: "claude", prompt: "P" });
    expect(await screenOf(a.id)).toContain("subagentStatusLine");
    expect(await screenOf(b.id)).not.toContain("subagentStatusLine");
    expect(getSession(b.id)!.orchestrated).toBe(false);
  });

  it("sesi tanpa agen fase: berkas --agents byte-identik dengan renderer custom agent", () => {
    registerCustomAgentSource(() => [scout]);
    const s = createSession("p1", cwd, { id: born("orch-none"), agent: "claude", prompt: "P" });
    expect(readFileSync(agentsFilePath(s.id), "utf8")).toBe(renderAgentsJson([scout]));
  });

  it("codex < 0.151: seluruh rencana dibatalkan, prompt lama, tanpa penanda orkestrasi", () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    const s = createSession("p1", cwd, {
      id: born("orch-codex-old"), agent: "codex", model: "gpt-5.6-sol", effort: "high",
      prompt: "PROMPT ORCHESTRATOR", legacyPrompt: "PROMPT LAMA", phaseAgents,
    });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("PROMPT LAMA");
    expect(getSession(s.id)!.orchestrated).toBe(false);
    expect(getSession(s.id)!.agentRoster ?? []).toEqual([]);
  });

  it("codex ≥ 0.151: agen fase jadi role native dengan max_depth eksplisit", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    registerCodexNativeAgentSupport(() => ({ version: "0.154.0", ok: true }));
    const s = createSession("p1", cwd, { id: born("orch-codex"), agent: "codex", prompt: "P", legacyPrompt: "L", phaseAgents });
    const screen = await screenOf(s.id);
    expect(screen).toContain("agents.max_depth=3");
    expect(screen).toContain('agents."hanoman-fase-spec".config_file');
    expect(getSession(s.id)!.orchestrated).toBe(true);
  });
});
```

Di `server/test/pty-parse.test.ts`: ubah `expect(FIELDS).toHaveLength(17);` menjadi `toHaveLength(20)` dan `expect(FIELDS[FIELDS.length - 1]).toBe("#{@hanoman_launch_class}");` menjadi `toBe("#{@hanoman_orchestrated}")`. Lalu tambahkan di `describe("parsePanes")`:

```ts
  it("ADR-0164 · model/effort orchestrator, penanda orkestrasi, dan roster ber-fase", () => {
    const [p] = parsePanes(line({
      "#{@hanoman_model}": "claude-opus-5", "#{@hanoman_effort}": "high", "#{@hanoman_orchestrated}": "1",
      "#{@hanoman_agent_roster}": '[{"name":"hanoman-fase-plan","phase":"Plan","model":"claude-sonnet-5","effort":"low"}]',
    }));
    expect(p).toMatchObject({ model: "claude-opus-5", effort: "high", orchestrated: true });
    expect(p!.agentRoster).toEqual([{ name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" }]);
    expect(parsePanes(line())[0]!.orchestrated).toBe(false);
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism server/test/phase-agents.pty.test.ts server/test/pty-parse.test.ts`
Expected: FAIL — berkas agen tak memuat agen fase, `orchestrated` undefined, `FIELDS` masih 17.

- [x] **Step 3: Tipe & parsing** — `server/src/services/pty.ts`

Impor runner (baris 8–12) menjadi:

```ts
import {
  goalOneLine, goalChunks, agentFlags, codexGoalScript, ensureSpawnHelperOnce,
  renderAgentsJson, agentDelegationClause, materializeCodexAgents, writeReadOnlyHook,
  writeSubagentStatusline, type AgentDef, type Flow, type Agent,
} from "@hanoman/runner";
```

Di `SessionInfo`, sesudah `agent: Agent;`:

```ts
  // ADR-0164 · model/effort orchestrator (argv saat lahir) + penanda sesi diorkestrasi. Absen untuk
  // sesi lama; `orchestrated` hanya ikut DTO bila true.
  model?: string; effort?: string; orchestrated?: boolean;
```

`SessionAgentMeta` menjadi:

```ts
export type SessionAgentMeta = {
  id?: string; name: string; model?: string; timeoutSeconds?: number; definitionHash?: string;
  // ADR-0164 · agen fase membawa nama fasenya; effort = nilai efektif saat lahir (sudah dikoersi).
  phase?: string; effort?: string;
};
```

`FMT`: tambahkan di UJUNG sesudah `"#{@hanoman_agent_roster}", "#{@hanoman_launch_class}",`:

```ts
  // ADR-0164 · di UJUNG juga, alasan yang sama dengan SPEC-919.
  "#{@hanoman_model}", "#{@hanoman_effort}", "#{@hanoman_orchestrated}",
```

`parsePanes`: destructuring menjadi `…, agentRoster, launchClass, model, effort, orchestrated] = line.split("\t");`, dan di objek hasil sesudah `launchClass: …,`:

```ts
      model: model || undefined,
      effort: effort || undefined,
      orchestrated: orchestrated === "1",
```

`parseAgentRoster`: di objek hasil sesudah baris `timeoutSeconds`:

```ts
        ...(typeof row.phase === "string" ? { phase: row.phase } : {}),
        ...(typeof row.effort === "string" ? { effort: row.effort } : {}),
```

`toSessionInfo` menjadi:

```ts
const toSessionInfo = ({ id, projectId, specId, flow, cwd, exited, code, branch, decision, agent,
  decisionFile, activityAt, model, effort, orchestrated }: Pane): SessionInfo => ({
  id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  // Hanya untuk pane mati: `pane_dead_status` kosong pada pane hidup, dan `exitCode: 0` di sana
  // akan terbaca sebagai "sudah berakhir sukses".
  ...(exited ? { exitCode: code } : {}),
  ...(decision && decisionFile ? { decisionAt: decisionOnset(decisionFile, activityAt) } : {}),
  ...(model ? { model } : {}),
  ...(effort ? { effort } : {}),
  ...(orchestrated ? { orchestrated: true } : {}),
});
```

Sesudah `registerCodexNativeAgentSupport`:

```ts
/** ADR-0164 · runtime sanggup subagent native: claude selalu, codex bila client terdeteksi >= 0.151. */
export const nativeAgentsAvailable = (agent: Agent): boolean =>
  agent === "claude" || codexNativeAgentSupport().ok;
```

`CreateOpts`, sesudah `attachmentsDir?: string;`:

```ts
  // ADR-0164 · orkestrasi. `phaseAgents` terisi = minta sesi orchestrator; `legacyPrompt` = prompt
  // mode tunggal dari input yang SAMA, dipakai bila satu agen fase gagal dimaterialisasi.
  phaseAgents?: AgentDef[];
  legacyPrompt?: string;
```

- [x] **Step 4: Materialisasi all-or-nothing** — di `createSession`, ganti blok dari `const agentForDefs: Agent = opts.agent ?? "claude";` sampai akhir blok penulisan berkas prompt (`promptArg = \`"$(cat ${sq(promptFile)})"\`; }`) dengan:

```ts
  const agentForDefs: Agent = opts.agent ?? "claude";
  // SPEC-339 · effort codex dikoersi SEKALI di sini; argv, roster, dan opsi tmux memakai nilai ini.
  const sessionEffort = agentForDefs === "codex" && opts.model && opts.effort
    ? coerceCodexEffort(opts.model, opts.effort) : opts.effort;
  const selectionContext: AgentSelectionContext = {
    projectId, runtime: agentForDefs, flow: opts.flow, cwd,
    baseSha: opts.env?.HANOMAN_BASE_SHA, prompt: opts.prompt,
    changedFiles: opts.command ? [] : collectChangedFiles(cwd, opts.env?.HANOMAN_BASE_SHA),
  };
  const customDefs = opts.command ? [] : customAgentsFor(selectionContext);
  const requestedPhaseDefs = opts.command ? [] : (opts.phaseAgents ?? []);
  let rosterBlock = "";
  let codexAgentArgs: string[] = [];
  let agentsFile: string | undefined;
  let agentConfigDir: string | undefined;
  let liveAgentDefs: AgentDef[] = [];
  let renderedDefs: AgentDef[] = [];
  let orchestrated = false;
  let statusLineCommand: string | undefined;
  if (customDefs.length > 0 || requestedPhaseDefs.length > 0) {
    const tempDir = agentTempDir(id);
    agentConfigDir = tempDir;
    mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    const readOnlyHook = customDefs.some((def) => def.workspacePolicy === "read-only")
      ? writeReadOnlyHook(tempDir)
      : undefined;
    // ADR-0164 · satu lintasan renderer untuk agen fase + custom agent. `false` = ada agen fase yang
    // gagal; pemanggil lalu mencoba lagi TANPA agen fase (all-or-nothing): orchestrator yang lahir
    // tanpa salah satu agen fasenya akan terpaksa mengerjakan fase itu sendiri.
    const attempt = (phaseDefs: AgentDef[]): boolean => {
      const defs = [...phaseDefs, ...customDefs];
      if (defs.length === 0) return true;
      if (agentForDefs === "claude") {
        const file = agentsFilePath(id);
        try {
          writeFileSync(file, renderAgentsJson(defs, { readOnlyHookCommand: readOnlyHook?.command }), { mode: 0o600 });
        } catch (error) {
          if (phaseDefs.length === 0) throw error;
          return false;
        }
        agentsFile = file;
        rosterBlock = agentDelegationClause(customDefs, "claude");
        liveAgentDefs = defs;
        renderedDefs = defs;
        return true;
      }
      const materialized = materializeCodexAgents(defs, tempDir, {
        readOnlyHookCommand: readOnlyHook?.command,
        clientVersion: codexNativeAgentSupport().version,
        ...(phaseDefs.length > 0 ? { maxDepth: 3 } : {}),
      });
      if (materialized.warnings.some((w) => phaseDefs.some((d) => d.name === w.agentName))) return false;
      codexAgentArgs = materialized.args;
      rosterBlock = materialized.delegationClause;
      liveAgentDefs = materialized.liveDefs;
      renderedDefs = defs;
      for (const warning of materialized.warnings) {
        process.stderr.write(
          `hanoman: custom agent ${warning.agentName} tidak dimaterialisasi: ${warning.reason}\n`,
        );
      }
      return true;
    };
    orchestrated = requestedPhaseDefs.length > 0 && attempt(requestedPhaseDefs);
    if (!orchestrated) {
      if (requestedPhaseDefs.length > 0)
        process.stderr.write(`hanoman: agen fase sesi ${id} gagal dimaterialisasi — sesi lahir mode tunggal\n`);
      attempt([]);
    }
    if (orchestrated && agentForDefs === "claude") statusLineCommand = writeSubagentStatusline(tempDir);
  }

  let promptArg = "";
  let promptFile: string | undefined;
  const sessionPrompt = orchestrated ? opts.prompt : (opts.legacyPrompt ?? opts.prompt);
  if (!opts.command && sessionPrompt) {
    promptFile = promptFilePath(id);
    mkdirSync(dirname(promptFile), { recursive: true, mode: 0o700 });
    writeFileSync(promptFile, sessionPrompt + rosterBlock, { mode: 0o600 });
    promptArg = `"$(cat ${sq(promptFile)})"`;
  }
```

- [x] **Step 5: Argv, opsi tmux, roster**

Di cabang argv agen, ganti blok `const effort = agent === "codex" && … : opts.effort;` dengan `const effort = sessionEffort;`, dan panggilan `agentFlags({ … })` menambah properti:

```ts
      subagentStatusLine: statusLineCommand,
```

Sesudah baris `tmux("set-option", "-t", name(id), "@hanoman_launch_class", …);` tambahkan:

```ts
  // ADR-0164 · model/effort orchestrator + penanda orkestrasi → chip header sel terminal.
  if (!opts.command && opts.model) tmux("set-option", "-t", name(id), "@hanoman_model", opts.model);
  if (!opts.command && sessionEffort) tmux("set-option", "-t", name(id), "@hanoman_effort", sessionEffort);
  if (orchestrated) tmux("set-option", "-t", name(id), "@hanoman_orchestrated", "1");
```

Blok roster (`if (liveAgentDefs.length > 0) { … }`) menjadi:

```ts
  if (liveAgentDefs.length > 0) {
    const inherited = { model: opts.model, effort: sessionEffort };
    const roster: SessionAgentMeta[] = liveAgentDefs.map((def) => ({
      ...(def.id ? { id: def.id } : {}), name: def.name,
      ...(def.model ?? inherited.model ? { model: def.model ?? inherited.model } : {}),
      ...(def.phase ? { phase: def.phase } : {}),
      ...(def.effort ?? inherited.effort ? { effort: def.effort ?? inherited.effort } : {}),
      // Berkas native dirender dengan `renderedDefs`, walau satu berkas Codex lain gagal ditulis.
      definitionHash: agentDefinitionHash(def, renderedDefs, agent, inherited),
      ...(def.timeoutSeconds ? { timeoutSeconds: def.timeoutSeconds } : {}),
    }));
    tmux("set-option", "-t", name(id), "@hanoman_agent_roster", JSON.stringify(roster));
  }
```

- [x] **Step 6: Jalankan, pastikan lulus**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism server/test/phase-agents.pty.test.ts server/test/pty-parse.test.ts server/test/custom-agents.pty.test.ts server/test/pty.test.ts`
Expected: PASS semua. (`pty.test.ts` merah karena `SSH_ASKPASS`/tmux sisa tetangga → lihat catatan resep; bukan regresi bila juga merah di base `05978c6d`.)

Run: `rtk proxy pnpm --filter ./server typecheck`
Expected: exit 0.

- [x] **Step 7: Commit**

```bash
/usr/bin/git add server/src/services/pty.ts server/test/phase-agents.pty.test.ts server/test/pty-parse.test.ts
/usr/bin/git commit -m "feat(orkestrasi): createSession melahirkan orchestrator dengan agen fase all-or-nothing"
```

### Task 8: Pemanggil sesi merakit rencana fase + nama agen fase dicadangkan

**Files:**
- Create: `server/src/services/orchestration.ts`
- Create: `server/test/orchestration.service.test.ts`
- Create: `shared/src/custom-agent-reserved.test.ts`
- Modify: `server/src/services/session-launch.ts:3,106-227`
- Modify: `server/src/routes/terminal.ts:7,12,170-313`
- Modify: `shared/src/custom-agent.ts:77-93`
- Test: `server/test/session-launch.test.ts`

**Interfaces:**
- Consumes: Task 1 (`resolvePhasePlan`), Task 2 (blok konteks), Task 4 (`buildPhaseAgents`, `fromAuditOf`), Task 5 (parameter `plan`), Task 7 (`CreateOpts.phaseAgents/legacyPrompt`, `nativeAgentsAvailable`).
- Produces:
  ```ts
  // server/src/services/orchestration.ts
  export function sessionPhasePlan(setting: Setting, flow: Flow, agent: Agent,
    orchestrator: { model: string; effort: string }): PhasePlan | null;
  ```

- [x] **Step 1: Tulis test yang gagal**

`shared/src/custom-agent-reserved.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zCreateCustomAgent } from "./custom-agent";

// ADR-0164 · AC-13 · registry native berkunci nama: custom agent bernama `hanoman-fase-*` akan
// menimpa agen fase sesi orchestrator. Route POST /custom-agents membalas 400 dari parse ini.
describe("nama custom agent yang dicadangkan", () => {
  const base = { description: "d", instructions: "i" };
  it("menolak awalan hanoman-fase-", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, name: "hanoman-fase-plan" }).success).toBe(false);
  });
  it("nama lain tetap sah", () => {
    expect(zCreateCustomAgent.safeParse({ ...base, name: "scout-dua" }).success).toBe(true);
  });
});
```

`server/test/orchestration.service.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { sessionPhasePlan } from "../src/services/orchestration";
import { registerCodexNativeAgentSupport } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";

afterEach(() => registerCodexNativeAgentSupport(() => ({ version: "0.151.0", ok: true })));

describe("sessionPhasePlan (ADR-0164)", () => {
  const orchestrator = { model: "claude-opus-5", effort: "high" };
  it("claude + flow aktif → rencana", () => {
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "claude", orchestrator)?.phases).toHaveLength(5);
  });
  it("flow mati → null", () => {
    const setting = { ...DEFAULT_SETTING,
      orchestration: { ...ORCHESTRATION_DEFAULTS, qa: { enabled: false, claude: {}, codex: {} } } };
    expect(sessionPhasePlan(setting, "qa", "claude", orchestrator)).toBeNull();
  });
  it("codex tanpa dukungan agen native → null", () => {
    registerCodexNativeAgentSupport(() => ({ version: "0.150.0", ok: false }));
    expect(sessionPhasePlan(DEFAULT_SETTING, "feature", "codex", { model: "gpt-5.6-sol", effort: "high" })).toBeNull();
  });
});
```

Tambahkan di `server/test/session-launch.test.ts` (tambah impor `readFileSync, existsSync` dari `node:fs`, `agentsFilePath, promptFilePath` dari `../src/services/pty`, `ORCHESTRATION_DEFAULTS` dari `@hanoman/shared`), di dalam `describe("session-launch")`:

```ts
  // ADR-0164 · default orkestrasi AKTIF: sesi backlog lahir sebagai orchestrator dengan agen fase.
  const setOrchestration = (flow: "feature" | "qa", enabled: boolean) => {
    const data = { ...DEFAULT_SETTING,
      orchestration: { ...ORCHESTRATION_DEFAULTS, [flow]: { enabled, claude: {}, codex: {} } } } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  it("orkestrasi aktif (default) → agen fase ikut lahir dan prompt orchestrator", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-ORCH1");
    const r = await startSpecSession(spec, { flow: "feature" });
    const agents = JSON.parse(readFileSync(agentsFilePath(r.id), "utf8"));
    expect(Object.keys(agents)).toEqual(expect.arrayContaining(["hanoman-fase-brainstorm", "hanoman-fase-execute"]));
    expect(readFileSync(promptFilePath(r.id), "utf8")).toContain("Sesi ini ORCHESTRATOR");
    killSession(r.id);
  });

  it("orkestrasi flow mati → prompt mode tunggal, tanpa berkas agen", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setOrchestration("feature", false);
    const spec = await seedRepo("SPEC-ORCH2");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(readFileSync(promptFilePath(r.id), "utf8")).toContain("Kerjakan fase berurutan");
    expect(existsSync(agentsFilePath(r.id))).toBe(false);
    killSession(r.id);
  });

  it("continue (stage done) hanya membawa agen fase Execute", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const seeded = await seedRepo("SPEC-ORCH3");
    const spec = await prisma.spec.update({ where: { id: seeded.id }, data: { stage: "done" } });
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(Object.keys(JSON.parse(readFileSync(agentsFilePath(r.id), "utf8")))).toEqual(["hanoman-fase-execute"]);
    killSession(r.id);
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism shared/src/custom-agent-reserved.test.ts server/test/orchestration.service.test.ts server/test/session-launch.test.ts`
Expected: FAIL — nama tercadang lolos, modul `orchestration` tak ada, sesi lahir tanpa agen fase.

- [x] **Step 3: Nama tercadang** — `shared/src/custom-agent.ts`

Tambah impor `import { PHASE_AGENT_PREFIX, isPhaseAgentName } from "./orchestration";` lalu baris `name` di `zCreateCustomAgentFields` menjadi:

```ts
  // ADR-0164 · awalan agen fase dicadangkan — registry native berkunci nama, jadi custom agent
  // bernama sama akan menimpa agen fase sesi orchestrator tanpa satu pun galat.
  name: z.string().regex(AGENT_NAME_RE)
    .refine((n) => !isPhaseAgentName(n), { message: `awalan ${PHASE_AGENT_PREFIX} dicadangkan untuk agen fase hanoman` }),
```

- [x] **Step 4: Satu titik resolusi** — `server/src/services/orchestration.ts`

```ts
import { resolvePhasePlan, type Agent, type PhasePlan, type Setting } from "@hanoman/shared";
import type { Flow } from "@hanoman/runner";
import { nativeAgentsAvailable } from "./pty";

// ADR-0164 · satu titik resolusi rencana fase untuk SEMUA pemanggil sesi ber-flow (backlog manual,
// governor scheduler, lead, reverse/scaffold/prd/breakdown). Menyalinnya ke tiap route adalah kelas
// bug SPEC-431/448: satu pintu yang lupa gerbang `nativeAgents` melahirkan orchestrator codex tua
// tanpa satu pun agen fase.
export function sessionPhasePlan(
  setting: Setting, flow: Flow, agent: Agent, orchestrator: { model: string; effort: string },
): PhasePlan | null {
  return resolvePhasePlan({
    flow, runtime: agent, orchestration: setting.orchestration, orchestrator,
    nativeAgents: nativeAgentsAvailable(agent),
  });
}
```

- [x] **Step 5: Backlog** — `server/src/services/session-launch.ts`

Impor runner baris 3 menjadi:

```ts
import { realGit, startPrompt, continuePrompt, resumePrompt, startGoalPrompt, resolveGoalCondition, buildPhaseAgents, fromAuditOf, specContext, goalContext, type Flow, type Autonomy, type VerifyScope, type ResumeCtx } from "@hanoman/runner";
```

tambah `import { sessionPhasePlan } from "./orchestration";`, lalu ganti blok dari `let prompt: string;` sampai penutup `}` rantai `if/else` pembangun prompt dengan:

```ts
    // ADR-0164 · rencana fase dihitung SEKALI; prompt orchestrator, agen fase, dan prompt mode tunggal
    // lahir dari input yang SAMA, jadi fallback all-or-nothing di createSession tak merakit ulang apa pun.
    const fullPlan = sessionPhasePlan(setting, opts.flow, agent, { model, effort });
    // SPEC-172 · continue hanya melanjutkan Execute; flow goal tak punya Execute dan tetap utuh.
    const plan = fullPlan && isContinue && !isGoalFlow
      ? { ...fullPlan, phases: fullPlan.phases.filter((p) => p.phase === "Execute") }
      : fullPlan;
    const buildPrompt = (p: typeof plan): string => {
      if (isGoalFlow) {
        // SPEC-407 · satu builder untuk ketiga keadaan sesi goal: `continuePrompt`/`resumePrompt`
        // bicara plan berkotak & fase perencanaan, dan sesi goal tak punya keduanya.
        return startGoalPrompt(opts.flow as "goal" | "no_effort", brief, branchTo, {
          autonomy: opts.autonomy, verifyScope, resume: resumeCtx, method: method.id, attachments, plan: p,
        });
      }
      if (isContinue) return continuePrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments, p);
      if (resumeCtx) return resumePrompt(opts.flow, brief, branchTo, resumeCtx, opts.autonomy, verifyScope, method.id, attachments, p);
      return startPrompt(opts.flow, brief, branchTo, opts.autonomy, verifyScope, method.id, attachments, p);
    };
    const legacyPrompt = buildPrompt(null);
    const prompt = plan ? buildPrompt(plan) : legacyPrompt;
    const phaseAgents = plan ? buildPhaseAgents(plan, {
      flow: opts.flow, method, verifyScope,
      context: isGoalFlow ? goalContext(brief) : specContext(brief),
      fromAudit: fromAuditOf(spec.payload),
    }) : [];
```

dan panggilan `createSession(spec.projectId, worktree, { … })` menambah `legacyPrompt, phaseAgents,` sesudah `prompt,`.

- [x] **Step 6: Empat flow project** — `server/src/routes/terminal.ts`

Impor runner baris 7 menambah `buildPhaseAgents, projectContext, scaffoldContext, prdContext, breakdownContext, PROJECT_METHOD`; baris 12 menambah `getSetting`; tambah `import { sessionPhasePlan } from "../services/orchestration";`.

Reverse — ganti `const s = createSession(project.id, wt, { … });` dengan:

```ts
        const brief = { id: project.id, name: project.name, desc: project.desc, stack: project.stack };
        // ADR-0164 · rencana fase dari Setting yang sama; prompt lama ikut sebagai fallback.
        const plan = sessionPhasePlan(await getSetting(), "reverse", agent, { model, effort });
        const legacyPrompt = startProjectPrompt("reverse", brief, "reverse-docs") + resumeNote(reused);
        const s = createSession(project.id, wt, {
          id, flow: "reverse", model, effort, agent,
          phaseFile: phaseFilePath(repoDir, id),
          decisionFile: decisionFilePath(repoDir, id),
          prompt: plan ? startProjectPrompt("reverse", brief, "reverse-docs", plan) + resumeNote(reused) : legacyPrompt,
          legacyPrompt,
          phaseAgents: plan
            ? buildPhaseAgents(plan, { flow: "reverse", method: PROJECT_METHOD, context: projectContext(brief) }) : [],
        });
```

Scaffold — ganti `const s = createSession(…)` dengan:

```ts
        const brief = { id: project.id, name: project.name, desc: project.desc, stack: project.stack };
        const plan = sessionPhasePlan(await getSetting(), "scaffold", agent, { model, effort });
        const legacyPrompt = startScaffoldPrompt(brief, "scaffold-docs") + resumeNote(reused);
        const s = createSession(project.id, wt, {
          id, flow: "scaffold", model, effort, agent,
          phaseFile: phaseFilePath(repoDir, id),
          decisionFile: decisionFilePath(repoDir, id),
          prompt: plan ? startScaffoldPrompt(brief, "scaffold-docs", plan) + resumeNote(reused) : legacyPrompt,
          legacyPrompt,
          phaseAgents: plan
            ? buildPhaseAgents(plan, { flow: "scaffold", method: PROJECT_METHOD, context: scaffoldContext(brief) }) : [],
        });
```

PRD — ganti `const s = createSession(…)` dengan:

```ts
        const project_ = { id: project.id, name: project.name, desc: project.desc, stack: project.stack };
        const audit = auditDoc ? { id: fromAudit!, path: auditDoc.path, content: auditDoc.content } : undefined;
        const plan = sessionPhasePlan(await getSetting(), "prd", agent, { model, effort });
        const legacyPrompt = startPrdPrompt(project_, brief, `prd/${slug}`, audit) + resumeNote(reused);
        const s = createSession(project.id, wt, {
          id, flow: "prd", branch: `prd/${slug}`, model, effort, agent,
          phaseFile: phaseFilePath(repoDir, id),
          decisionFile: decisionFilePath(repoDir, id),
          prompt: plan ? startPrdPrompt(project_, brief, `prd/${slug}`, audit, plan) + resumeNote(reused) : legacyPrompt,
          legacyPrompt,
          phaseAgents: plan ? buildPhaseAgents(plan, {
            flow: "prd", method: PROJECT_METHOD, context: prdContext(project_, brief, audit), prd: { slug },
          }) : [],
        });
```

Breakdown — ganti `const s = createSession(…)` dengan:

```ts
        const project_ = { id: project.id, name: project.name, desc: project.desc, stack: project.stack };
        const prd = { title, path: prdPath, content };
        const plan = sessionPhasePlan(await getSetting(), "breakdown", agent, { model, effort });
        const legacyPrompt = startBreakdownPrompt(project_, prd, `breakdown/${slug}`) + resumeNote(reused);
        const s = createSession(project.id, wt, {
          id, flow: "breakdown", branch: `breakdown/${slug}`, model, effort, agent,
          phaseFile: phaseFilePath(repoDir, id),
          decisionFile: decisionFilePath(repoDir, id),
          prompt: plan ? startBreakdownPrompt(project_, prd, `breakdown/${slug}`, plan) + resumeNote(reused) : legacyPrompt,
          legacyPrompt,
          phaseAgents: plan ? buildPhaseAgents(plan, {
            flow: "breakdown", method: PROJECT_METHOD, context: breakdownContext(project_, prd), prd: { slug, title },
          }) : [],
        });
```

- [x] **Step 7: Jalankan, pastikan lulus**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism shared/src/custom-agent-reserved.test.ts server/test/orchestration.service.test.ts server/test/session-launch.test.ts server/test/spec-attachment-launch.test.ts server/test/custom-agents.route.test.ts`
Expected: PASS semua.

Bila test launch/route LAMA merah karena menegaskan teks prompt mode tunggal (mis. `Kerjakan fase berurutan`, `Scope verifikasi`, skill fase), itu perubahan default yang disengaja: di test itu panggil `await setOrchestration("<flow>", false)` sebelum peluncuran, dengan komentar `// ADR-0164 · test ini menegaskan prompt mode tunggal`. Jangan melemahkan assertion-nya. Cari route test flow project yang terdampak dengan `ls server/test | rtk proxy grep -E "terminal|reverse|prd|scaffold|breakdown"` dan jalankan juga; perlakukan dengan cara yang sama (Setting ber-`orchestration.<flow>.enabled: false`).

Run: `rtk proxy pnpm --filter ./shared typecheck && rtk proxy pnpm --filter ./server typecheck`
Expected: exit 0.

- [x] **Step 8: Commit**

```bash
/usr/bin/git add shared/src/custom-agent.ts shared/src/custom-agent-reserved.test.ts server/src/services/orchestration.ts server/test/orchestration.service.test.ts server/src/services/session-launch.ts server/src/routes/terminal.ts server/test/session-launch.test.ts
/usr/bin/git commit -m "feat(orkestrasi): semua pemanggil sesi ber-flow melahirkan orchestrator dari Setting"
```

(Tambahkan path test lama yang disesuaikan di Step 7 ke `git add` yang sama.)

### Task 9: Bukti invocation fase + frame `phase` diperkaya

**Files:**
- Modify: `server/prisma/schema.prisma` (model `AgentInvocation`)
- Create: `server/prisma/migrations/20260914120000_agent_invocation_phase/migration.sql`
- Modify: `server/src/services/session-phases.ts` (tipe `Phase`, `enrichPhases`)
- Modify: `server/src/services/agent-invocations.ts` (identitas, `listPhaseInvocations`, pengecualian metrik)
- Create: `server/src/services/phase-invocations.ts`
- Modify: `server/src/routes/session-events.ts`
- Modify: `server/src/services/pty.ts` (cache invocation fase, `pollPhases`, `attach`, `killSession`)
- Modify: `server/src/routes/terminal.ts` (hidrasi saat attach WS)
- Test: `server/test/session-phases.test.ts`, `server/test/agent-invocations.service.test.ts`, `server/test/session-events.route.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PHASE_EVIDENCE_GRACE_MS`), Task 7 (`SessionAgentMeta.phase/effort`).
- Produces:
  ```ts
  // server/src/services/session-phases.ts
  export type PhaseInvocation = { phase: string; runtimeInvocationId: string; status: string; startedAt: string;
    durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
    cachedTokens: number | null; resultExcerpt: string | null };
  export type PhaseRosterEntry = { name: string; phase: string; model?: string; effort?: string };
  export type PhaseAgent = { name: string; model?: string; effort?: string; status?: string; startedAt?: string;
    durationMs?: number | null; attempts: number; inputTokens?: number | null; outputTokens?: number | null;
    cachedTokens?: number | null; resultExcerpt?: string | null; evidence: "ok" | "pending" | "missing" };
  export type Phase = { name: string; state: PhaseState; agent?: PhaseAgent };
  export function enrichPhases(phases: Phase[], roster: PhaseRosterEntry[], invocations: PhaseInvocation[],
    doneSeenAt: Map<string, number>, now: number): Phase[];
  // server/src/services/agent-invocations.ts
  export async function listPhaseInvocations(sessionId: string): Promise<PhaseInvocation[]>;
  // server/src/services/phase-invocations.ts
  export async function refreshPhaseInvocations(sessionId: string): Promise<void>;
  // server/src/services/pty.ts
  export function setPhaseInvocations(sessionId: string, rows: PhaseInvocation[]): void;
  ```
- Payload hook terukur (claude 2.1.270): `SubagentStart {agent_id, agent_type}`; `SubagentStop {agent_id, agent_type, effort: {level}, last_assistant_message, agent_transcript_path}`. Melanjutkan subagent (`SendMessage`) menembak `SubagentStart` lagi dengan `agent_id` SAMA → idempoten lewat unique yang ada.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `server/test/session-phases.test.ts` (tambah `enrichPhases, type PhaseInvocation` ke impor `../src/services/session-phases`):

```ts
describe("enrichPhases (ADR-0164)", () => {
  const roster = [
    { name: "hanoman-fase-spec", phase: "Spec", model: "claude-opus-5", effort: "high" },
    { name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" },
  ];
  const inv = (o: Partial<PhaseInvocation>): PhaseInvocation => ({
    phase: "Spec", runtimeInvocationId: "a1", status: "completed", startedAt: "2026-09-14T00:00:00.000Z",
    durationMs: 72_000, inputTokens: 10, outputTokens: 5, cachedTokens: null, resultExcerpt: "Status: selesai", ...o,
  });
  const phases: Phase[] = [
    { name: "Brainstorm", state: "done" }, { name: "Spec", state: "done" }, { name: "Plan", state: "active" },
  ];

  it("fase tanpa agen fase di roster tak disentuh", () => {
    expect(enrichPhases(phases, roster, [], new Map(), 0)[0]).toEqual({ name: "Brainstorm", state: "done" });
  });
  it("invocation terakhir menentukan status; percobaan = agent id berbeda", () => {
    const [, spec] = enrichPhases(phases, roster, [
      inv({ runtimeInvocationId: "a1", status: "interrupted", startedAt: "2026-09-14T00:00:00.000Z" }),
      inv({ runtimeInvocationId: "a2", status: "completed", startedAt: "2026-09-14T00:05:00.000Z" }),
    ], new Map(), 0);
    expect(spec!.agent).toMatchObject({
      name: "hanoman-fase-spec", model: "claude-opus-5", effort: "high", status: "completed", attempts: 2, evidence: "ok",
    });
  });
  it("fase done tanpa invocation: pending selama tenggang, missing sesudahnya", () => {
    const seen = new Map([["Spec", 1_000]]);
    expect(enrichPhases(phases, roster, [], seen, 1_000 + 59_999)[1]!.agent!.evidence).toBe("pending");
    expect(enrichPhases(phases, roster, [], seen, 1_000 + 60_000)[1]!.agent!.evidence).toBe("missing");
  });
  it("fase aktif belum berinvocation tetap pending walau lama", () => {
    expect(enrichPhases(phases, roster, [], new Map(), 10_000_000)[2]!.agent)
      .toMatchObject({ attempts: 0, evidence: "pending" });
  });
});
```

Tambahkan di akhir `server/test/agent-invocations.service.test.ts` (tambah `agentMetrics, listPhaseInvocations` ke impor):

```ts
describe("invocation agen fase (ADR-0164)", () => {
  it("menyimpan phase & effort; stop memakai effort runtime", async () => {
    await startAgentInvocation({ ...base, runtimeInvocationId: "fase-1", agentName: "hanoman-fase-plan",
      customAgentId: undefined, phase: "Plan", effort: "low" });
    await stopAgentInvocation({ ...base, runtimeInvocationId: "fase-1", agentName: "hanoman-fase-plan",
      customAgentId: undefined, phase: "Plan", effort: "medium", result: "Status: selesai" });
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "fase-1" } }))
      .toMatchObject({ phase: "Plan", effort: "medium", status: "completed" });
    expect(await listPhaseInvocations("s1")).toEqual([expect.objectContaining({
      phase: "Plan", runtimeInvocationId: "fase-1", status: "completed", resultExcerpt: "Status: selesai",
    })]);
  });
  it("metrik custom agent mengecualikan invocation agen fase", async () => {
    await startAgentInvocation({ ...base, runtimeInvocationId: "fase-2", agentName: "hanoman-fase-spec",
      customAgentId: undefined, phase: "Spec" });
    await startAgentInvocation({ ...base, runtimeInvocationId: "scout-1" });
    expect(JSON.stringify(await agentMetrics({}))).not.toContain("hanoman-fase-spec");
  });
});
```

Di `server/test/session-events.route.test.ts`, tambahkan entri kedua pada `PANE.s1.agentRoster` (sesudah entri `scout`):

```ts
          { name: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low", definitionHash: "b".repeat(64) },
```

lalu di dalam `describe("POST /api/session-events")`:

```ts
  it("ADR-0164 · event agen fase menyimpan phase & effort; stop mengambil effort runtime", async () => {
    const app = buildApp();
    const start = await post(app, { hook_event_name: "SubagentStart", agent_id: "ag-1", agent_type: "hanoman-fase-plan" }, auth("s1"));
    expect(start.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-1" } }))
      .toMatchObject({ agentName: "hanoman-fase-plan", phase: "Plan", model: "claude-sonnet-5", effort: "low" });
    const stop = await post(app, { hook_event_name: "SubagentStop", agent_id: "ag-1", agent_type: "hanoman-fase-plan",
      effort: { level: "medium" }, last_assistant_message: "Status: selesai" }, auth("s1"));
    expect(stop.statusCode).toBe(202);
    expect(await prisma.agentInvocation.findFirstOrThrow({ where: { runtimeInvocationId: "ag-1" } }))
      .toMatchObject({ status: "completed", effort: "medium" });
    await app.close();
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism server/test/session-phases.test.ts server/test/agent-invocations.service.test.ts server/test/session-events.route.test.ts`
Expected: FAIL — `enrichPhases` tak ada; kolom `phase` tak dikenal Prisma.

- [x] **Step 3: Skema + migration**

`server/prisma/schema.prisma`, model `AgentInvocation`, sesudah `definitionHash String?`:

```prisma
  phase               String?
  effort              String?
```

`server/prisma/migrations/20260914120000_agent_invocation_phase/migration.sql`:

```sql
-- ADR-0164 · LOCAL-only. Baris sebelum orkestrasi tetap null: tak ada fase yang bisa dikarang.
ALTER TABLE "AgentInvocation" ADD COLUMN "phase" TEXT;
ALTER TABLE "AgentInvocation" ADD COLUMN "effort" TEXT;
```

Run: `rtk proxy pnpm db:generate`
Expected: `Generated Prisma Client`.

- [x] **Step 4: `enrichPhases`** — `server/src/services/session-phases.ts`

Tambah impor `import { PHASE_EVIDENCE_GRACE_MS } from "@hanoman/shared";` (gabungkan dengan impor shared yang ada) dan ganti `export type Phase = …` dengan:

```ts
// ADR-0164 · bukti agen fase yang ikut frame `phase`. `resultExcerpt` aman di sini: WS terminal
// ber-cookie, sama dengan route metrik yang memuat excerpt (ADR-0159).
export type PhaseInvocation = {
  phase: string; runtimeInvocationId: string; status: string; startedAt: string;
  durationMs: number | null; inputTokens: number | null; outputTokens: number | null;
  cachedTokens: number | null; resultExcerpt: string | null;
};
export type PhaseRosterEntry = { name: string; phase: string; model?: string; effort?: string };
export type PhaseAgent = {
  name: string; model?: string; effort?: string; status?: string; startedAt?: string;
  durationMs?: number | null; attempts: number;
  inputTokens?: number | null; outputTokens?: number | null; cachedTokens?: number | null;
  resultExcerpt?: string | null;
  evidence: "ok" | "pending" | "missing";
};
export type Phase = { name: string; state: PhaseState; agent?: PhaseAgent };
```

Tambahkan sesudah `readPhases`:

```ts
/**
 * ADR-0164 · fase diperkaya agen fasenya. MURNI: roster (tmux), invocation (DB lewat cache pty), dan
 * `doneSeenAt` (kapan server pertama melihat fase `done`) disuntik pemanggil. `missing` = fase tercatat
 * selesai tanpa satu pun invocation lewat tenggang relay — dilabeli "bukti tak diterima", bukan
 * "tidak didelegasikan": hook fail-open dan nol invocation bukan bukti tak dipakai (ADR-0159).
 */
export function enrichPhases(
  phases: Phase[], roster: PhaseRosterEntry[], invocations: PhaseInvocation[],
  doneSeenAt: Map<string, number>, now: number,
): Phase[] {
  return phases.map((p) => {
    const r = roster.find((entry) => entry.phase === p.name);
    if (!r) return p;
    const mine = invocations.filter((i) => i.phase === p.name)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const last = mine[mine.length - 1];
    const seen = doneSeenAt.get(p.name);
    const evidence: PhaseAgent["evidence"] = mine.length > 0 ? "ok"
      : p.state === "done" && seen !== undefined && now - seen >= PHASE_EVIDENCE_GRACE_MS ? "missing"
        : "pending";
    return {
      ...p,
      agent: {
        name: r.name,
        ...(r.model ? { model: r.model } : {}),
        ...(r.effort ? { effort: r.effort } : {}),
        attempts: new Set(mine.map((i) => i.runtimeInvocationId)).size,
        ...(last ? {
          status: last.status, startedAt: last.startedAt, durationMs: last.durationMs,
          inputTokens: last.inputTokens, outputTokens: last.outputTokens, cachedTokens: last.cachedTokens,
          resultExcerpt: last.resultExcerpt,
        } : {}),
        evidence,
      },
    };
  });
}
```

- [x] **Step 5: Invocation** — `server/src/services/agent-invocations.ts`

Tambah `import type { PhaseInvocation } from "./session-phases";`. Di `InvocationIdentity` sesudah `definitionHash?: string;`:

```ts
  // ADR-0164 · agen fase. `effort` saat start dari roster tepercaya; saat stop dari payload runtime.
  phase?: string; effort?: string;
```

Di `startAgentInvocation`, objek `create` menambah `phase: input.phase ?? null, effort: input.effort ?? null,`. Di `stopAgentInvocation`, objek `evidence` menambah baris terakhir `...(input.effort ? { effort: input.effort } : {}),` dan objek `create` menambah `phase: input.phase ?? null,`.

Di `agentMetrics`, objek `where` menambah baris pertama:

```ts
    // ADR-0164 · telemetri agen fase milik terminal, bukan presisi katalog custom agent.
    phase: null,
```

Tambahkan di akhir berkas:

```ts
/** ADR-0164 · invocation agen fase satu sesi, urut waktu mulai — bahan frame `phase` terminal. */
export async function listPhaseInvocations(sessionId: string): Promise<PhaseInvocation[]> {
  const rows = await prisma.agentInvocation.findMany({
    where: { sessionId, phase: { not: null } }, orderBy: { startedAt: "asc" },
  });
  return rows.map((row) => ({
    phase: row.phase!, runtimeInvocationId: row.runtimeInvocationId, status: row.status,
    startedAt: row.startedAt.toISOString(), durationMs: row.durationMs,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, cachedTokens: row.cachedTokens,
    resultExcerpt: row.resultExcerpt,
  }));
}
```

`server/src/services/phase-invocations.ts`:

```ts
import { listPhaseInvocations } from "./agent-invocations";
import { setPhaseInvocations } from "./pty";

// ADR-0164 · jembatan DB → pty. pty.ts tetap nol dependensi DB (ADR-0094 §7): pemanggil yang
// membaca invocation lalu menyuntikkannya. Telemetri tak pernah boleh menggagalkan event atau attach.
export async function refreshPhaseInvocations(sessionId: string): Promise<void> {
  try { setPhaseInvocations(sessionId, await listPhaseInvocations(sessionId)); }
  catch { /* frame berikutnya tetap membawa rencana fase dari roster */ }
}
```

- [x] **Step 6: Route event** — `server/src/routes/session-events.ts`

Tambah `import { refreshPhaseInvocations } from "../services/phase-invocations";`. Objek `identity` menambah sesudah `definitionHash: meta.definitionHash,`:

```ts
        ...(meta.phase ? { phase: meta.phase } : {}),
        ...(meta.effort ? { effort: meta.effort } : {}),
```

Cabang `stopAgentInvocation({ ...identity, … })` menambah properti:

```ts
          // ADR-0164 · effort yang BENAR-BENAR dipakai runtime (claude: `effort.level` di SubagentStop).
          ...(typeof recordOf(body.effort)?.level === "string"
            ? { effort: String(recordOf(body.effort)!.level) } : {}),
```

Sesudah `const outcome = …;` dan sebelum `return reply.code(202)…`:

```ts
      if (meta.phase) void refreshPhaseInvocations(sessionId);
```

- [x] **Step 7: Cache & frame di pty** — `server/src/services/pty.ts`

Impor `session-phases` menjadi `import { enrichPhases, readPhases, sessionComplete, type Phase, type PhaseInvocation } from "./session-phases";`.

Tipe `Attachment` menambah `doneSeenAt: Map<string, number>;`, dan literal attachment di `open()` menambah `doneSeenAt: new Map(),`.

Sesudah `const attached = new Map<string, Attachment>();`:

```ts
// ADR-0164 · status live agen fase per sesi. Diisi route session-events & route WS terminal (yang
// membaca DB); pty sendiri tak pernah menyentuh DB (ADR-0094 §7).
const phaseInvocations = new Map<string, PhaseInvocation[]>();

/** Frame fase satu pane: berkas fase diperkaya roster agen fase + invocation. Tanpa agen fase → apa adanya. */
function phaseView(p: Pane, a: Attachment): Phase[] {
  const phases = readPhases(p.phaseFile!, p.flow!);
  const now = Date.now();
  for (const phase of phases)
    if (phase.state === "done" && !a.doneSeenAt.has(phase.name)) a.doneSeenAt.set(phase.name, now);
  const roster = (p.agentRoster ?? []).flatMap((r) =>
    r.phase ? [{ name: r.name, phase: r.phase, model: r.model, effort: r.effort }] : []);
  return roster.length ? enrichPhases(phases, roster, phaseInvocations.get(p.id) ?? [], a.doneSeenAt, now) : phases;
}
```

`pollPhases`: ganti `const phases = readPhases(p.phaseFile, p.flow);` dengan `const phases = phaseView(p, a);`. Di `attach`: ganti `const phases = readPhases(p.phaseFile, p.flow);` dengan `const phases = phaseView(p, a);`.

Sesudah fungsi `pollPhases`:

```ts
/** ADR-0164 · suntik invocation fase terbaru lalu siarkan ulang frame fase bila ada penonton. */
export function setPhaseInvocations(sessionId: string, rows: PhaseInvocation[]): void {
  phaseInvocations.set(sessionId, rows);
  const a = attached.get(sessionId);
  const p = a ? getSession(sessionId) : null;
  if (a && p) pollPhases(p, a);
}
```

Baris pertama di dalam `export function killSession(id: string): boolean {`:

```ts
  phaseInvocations.delete(id);
```

`server/src/routes/terminal.ts`: tambah `import { refreshPhaseInvocations } from "../services/phase-invocations";` dan tepat sesudah `attach(id, client);`:

```ts
    // ADR-0164 · invocation agen fase dari DB — frame pertama sudah membawa rencana dari roster, frame
    // kedua (sesudah hidrasi) membawa status. Tanpa await: handler ini sengaja sinkron (lihat bawah).
    void refreshPhaseInvocations(id);
```

- [x] **Step 8: Jalankan, pastikan lulus**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --no-file-parallelism server/test/session-phases.test.ts server/test/agent-invocations.service.test.ts server/test/session-events.route.test.ts server/test/custom-agent-metrics.route.test.ts server/test/phase-agents.pty.test.ts`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./server typecheck`
Expected: exit 0.

- [x] **Step 9: Commit**

```bash
/usr/bin/git add server/prisma/schema.prisma server/prisma/migrations/20260914120000_agent_invocation_phase server/src/services/session-phases.ts server/src/services/agent-invocations.ts server/src/services/phase-invocations.ts server/src/routes/session-events.ts server/src/services/pty.ts server/src/routes/terminal.ts server/test/session-phases.test.ts server/test/agent-invocations.service.test.ts server/test/session-events.route.test.ts
/usr/bin/git commit -m "feat(orkestrasi): bukti invocation agen fase dan frame fase diperkaya"
```

### Task 10: Frontend — chip `PhaseStrip` & chip orchestrator

**Files:**
- Modify: `src/src/api/client.ts:19-37` (`Phase`, `TerminalSession`)
- Create: `src/src/screens/phase-chip.ts`
- Modify: `src/src/screens/TerminalScreen.tsx:739-759` (`PhaseStrip`), `:909-917` (header `Cell`), `:946` (pemanggilan strip)
- Create: `src/test/phase-strip.test.tsx`
- Modify: `src/test/terminal-screen.test.tsx`

**Interfaces:**
- Consumes: bentuk frame Task 9 (`Phase.agent`), field Task 7 (`TerminalSession.model/effort/orchestrated`).
- Produces:
  ```ts
  // src/src/api/client.ts
  export type PhaseAgent = { name: string; model?: string; effort?: string; status?: string; startedAt?: string;
    durationMs?: number | null; attempts: number; inputTokens?: number | null; outputTokens?: number | null;
    cachedTokens?: number | null; resultExcerpt?: string | null; evidence: "ok" | "pending" | "missing" };
  export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending"; agent?: PhaseAgent };
  // src/src/screens/phase-chip.ts
  export const modelLabel: (id?: string) => string;
  export function formatDuration(ms: number): string;
  export type ChipTone = "done" | "running" | "pending" | "skipped" | "failed" | "abandoned";
  export function chipTone(p: Phase): ChipTone;
  // src/src/screens/TerminalScreen.tsx
  export function PhaseStrip(props: { phases: Phase[] | null; compact?: boolean; now?: number }): JSX.Element | null;
  ```

- [x] **Step 1: Tulis test yang gagal** — `src/test/phase-strip.test.tsx`

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PhaseStrip } from "../src/screens/TerminalScreen";
import { formatDuration, chipTone } from "../src/screens/phase-chip";
import type { Phase } from "../src/api/client";

const agent = (o: Partial<NonNullable<Phase["agent"]>> = {}): NonNullable<Phase["agent"]> => ({
  name: "hanoman-fase-spec", model: "claude-opus-5", effort: "high", status: "completed",
  startedAt: "2026-09-14T00:00:00.000Z", durationMs: 72_000, attempts: 1, evidence: "ok",
  inputTokens: 1_200, outputTokens: 300, cachedTokens: 5_000, resultExcerpt: "Status: selesai", ...o,
});

describe("phase-chip (ADR-0164)", () => {
  it("formatDuration & chipTone", () => {
    expect(formatDuration(72_000)).toBe("1m12s");
    expect(formatDuration(42_400)).toBe("42s");
    expect(chipTone({ name: "Plan", state: "skipped", agent: agent() })).toBe("skipped");
    expect(chipTone({ name: "Plan", state: "active", agent: agent({ status: "abandoned" }) })).toBe("abandoned");
    expect(chipTone({ name: "Plan", state: "active", agent: agent({ status: "running" }) })).toBe("running");
    expect(chipTone({ name: "Plan", state: "pending" })).toBe("pending");
  });
});

describe("PhaseStrip · chip agen fase (ADR-0164)", () => {
  it("fase selesai: nama · model · effort · durasi akhir", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    const chip = screen.getByRole("button", { name: "Detail fase Spec" });
    expect(chip).toHaveTextContent("Spec");
    expect(chip).toHaveTextContent("Opus 5");
    expect(chip).toHaveTextContent("high");
    expect(chip).toHaveTextContent("1m12s");
    expect(screen.getByText("Spec")).toHaveAttribute("data-state", "done");
  });
  it("fase berjalan: durasi dihitung dari startedAt", () => {
    render(<PhaseStrip now={Date.parse("2026-09-14T00:00:42.000Z")}
      phases={[{ name: "Plan", state: "active", agent: agent({ status: "running", durationMs: null }) }]} />);
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("42s");
  });
  it("percobaan ulang dan bukti yang tak diterima terlihat", () => {
    render(<PhaseStrip phases={[
      { name: "Spec", state: "done", agent: agent({ attempts: 2 }) },
      { name: "Plan", state: "done", agent: agent({ name: "hanoman-fase-plan", status: undefined, attempts: 0, evidence: "missing" }) },
    ]} />);
    expect(screen.getByText("↻2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "bukti subagent tak diterima" })).toBeInTheDocument();
  });
  it("mode ringkas: hanya fase aktif yang menampilkan model", () => {
    render(<PhaseStrip compact phases={[
      { name: "Spec", state: "done", agent: agent() },
      { name: "Plan", state: "active", agent: agent({ model: "claude-sonnet-5", status: "running" }) },
    ]} />);
    expect(screen.getByRole("button", { name: "Detail fase Spec" })).not.toHaveTextContent("Opus 5");
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("Sonnet 5");
  });
  it("klik chip membuka detail: token terpisah & cuplikan hasil", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Detail fase Spec" }));
    const detail = screen.getByRole("dialog", { name: "Detail fase Spec" });
    expect(within(detail).getByText(/in 1200 · out 300 · cache 5000/)).toBeInTheDocument();
    expect(within(detail).getByText("Status: selesai")).toBeInTheDocument();
  });
  it("fase dilewati ber-agen berlabel dilewati", () => {
    render(<PhaseStrip phases={[{ name: "Plan", state: "skipped", agent: agent({ status: undefined, attempts: 0, evidence: "pending" }) }]} />);
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("dilewati");
  });
});
```

Di `src/test/terminal-screen.test.tsx`, di dalam `describe("TerminalScreen · aksi tetap terjangkau saat sempit (SPEC-800)")`, tambahkan:

```tsx
  it("ADR-0164 · sesi diorkestrasi menampilkan model & effort orchestrator di header sel", async () => {
    stubResizeObserver(900);
    localStorage.setItem(WKEY, JSON.stringify({ active: "g1", groups: [
      { id: "g1", name: "Utama", layout: { rows: 1, cols: 1, cells: ["aaaa1111"] } },
    ] }));
    listTerminals.mockResolvedValue([
      { id: "aaaa1111", projectId: "p1", specId: "SPEC-1", cwd: "/repo", exited: false,
        orchestrated: true, model: "claude-opus-5", effort: "high" },
    ]);
    render(<TerminalScreen projects={projects} onOpenReview={() => {}} />);
    expect(await screen.findByTestId("orchestrator-chip")).toHaveTextContent("orch Opus 5 · high");
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run src/test/phase-strip.test.tsx src/test/terminal-screen.test.tsx`
Expected: FAIL — modul `phase-chip` tak ada; `orchestrator-chip` tak ditemukan.

- [x] **Step 3: Tipe** — `src/src/api/client.ts`

Ganti `export type Phase = …` dengan:

```ts
// ADR-0164 · agen fase yang mengerjakan fase ini (frame `phase` WS terminal). Absen = fase tanpa
// orkestrasi. `evidence: "missing"` = fase tercatat selesai tanpa bukti subagent lewat tenggang relay.
export type PhaseAgent = {
  name: string; model?: string; effort?: string; status?: string; startedAt?: string;
  durationMs?: number | null; attempts: number;
  inputTokens?: number | null; outputTokens?: number | null; cachedTokens?: number | null;
  resultExcerpt?: string | null;
  evidence: "ok" | "pending" | "missing";
};
export type Phase = { name: string; state: "done" | "skipped" | "active" | "pending"; agent?: PhaseAgent };
```

Di `TerminalSession`, sesudah `decisionAt?: string;`:

```ts
  // ADR-0164 · model/effort orchestrator (argv saat lahir) dan penanda sesi diorkestrasi.
  model?: string; effort?: string; orchestrated?: boolean;
```

- [x] **Step 4: Helper murni** — `src/src/screens/phase-chip.ts`

```ts
import { MODELS, CODEX_MODELS } from "@hanoman/shared";
import type { Phase } from "../api/client";

// ADR-0164 · format chip fase. Murni supaya PhaseStrip dan chip header memakai label yang sama.
export const modelLabel = (id?: string): string =>
  !id ? "" : MODELS.find((m) => m.id === id)?.label ?? CODEX_MODELS.find((m) => m.id === id)?.label ?? id;

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export type ChipTone = "done" | "running" | "pending" | "skipped" | "failed" | "abandoned";

export function chipTone(p: Phase): ChipTone {
  if (p.state === "skipped") return "skipped";
  const status = p.agent?.status;
  if (status === "abandoned") return "abandoned";
  if (status === "interrupted") return "failed";
  if (p.state === "done") return "done";
  if (status === "running" || p.state === "active") return "running";
  return "pending";
}
```

- [x] **Step 5: `PhaseStrip`** — `src/src/screens/TerminalScreen.tsx`

Tambah impor `import { chipTone, formatDuration, modelLabel, type ChipTone } from "./phase-chip";`. Ganti fungsi `PhaseStrip` (tetap di bawah `PHASE_COLOR`) dengan:

```tsx
const CHIP_ICON: Record<ChipTone, string> = {
  done: "✓", running: "●", pending: "○", skipped: "–", failed: "✕", abandoned: "⨯",
};

// ADR-0164 · fase tanpa agen digambar persis seperti sebelumnya. Fase ber-agen jadi chip: nama ·
// model · effort · durasi, ditambah ↻n bila diulang dan ⚠ bila bukti subagent tak diterima.
// `compact` (sel sempit): hanya chip aktif yang menampilkan model/effort/durasi.
export function PhaseStrip({ phases, compact = false, now }: {
  phases: Phase[] | null; compact?: boolean; now?: number;
}) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [, setTick] = React.useState(0);
  const running = !!phases?.some((p) => p.agent?.status === "running");
  React.useEffect(() => {
    if (!running || now !== undefined) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [running, now]);
  if (!phases?.length) return null;
  const at = now ?? Date.now();
  const openPhase = phases.find((p) => p.name === open && p.agent);
  const nameStyle = (p: Phase): React.CSSProperties => ({
    color: PHASE_COLOR[p.state],
    fontWeight: p.state === "active" ? 600 : 400,
    textDecoration: p.state === "skipped" ? "line-through" : "none",
    opacity: p.state === "pending" ? 0.5 : 1,
  });
  const durationOf = (p: Phase): string => {
    const a = p.agent;
    if (!a) return "";
    if (typeof a.durationMs === "number") return formatDuration(a.durationMs);
    if (a.status === "running" && a.startedAt) return formatDuration(at - Date.parse(a.startedAt));
    return "";
  };
  return (
    <div data-testid="phase-strip" style={{
      position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", flex: "0 0 auto",
      borderBottom: "1px solid var(--border-hair)", fontSize: 10, fontFamily: "var(--font-mono)",
      overflowX: "auto", whiteSpace: "nowrap",
    }}>
      {phases.map((p) => {
        if (!p.agent) {
          return <span key={p.name} data-state={p.state} title={p.state} style={nameStyle(p)}>{p.name}</span>;
        }
        const a = p.agent;
        const tone = chipTone(p);
        const full = !compact || p.state === "active";
        const duration = durationOf(p);
        return (
          <button key={p.name} type="button" data-tone={tone} aria-expanded={open === p.name}
            aria-label={`Detail fase ${p.name}`} onClick={() => setOpen(open === p.name ? null : p.name)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto", padding: "1px 6px",
              border: "1px solid var(--border-hair)", borderRadius: "var(--radius-sm)", background: "transparent",
              font: "inherit", color: "var(--text-body)", cursor: "pointer",
            }}>
            <span aria-hidden>{CHIP_ICON[tone]}</span>
            <span data-state={p.state} title={p.state} style={nameStyle(p)}>{p.name}</span>
            {p.state === "skipped" && <span>dilewati</span>}
            {full && a.model && <span>· {modelLabel(a.model)}</span>}
            {full && a.effort && <span>· {a.effort}</span>}
            {full && duration && <span>· {duration}</span>}
            {a.attempts > 1 && <span>↻{a.attempts}</span>}
            {a.evidence === "missing" && (
              <span role="img" aria-label="bukti subagent tak diterima" title="bukti subagent tak diterima"
                style={{ color: "var(--status-warn)" }}>⚠</span>
            )}
          </button>
        );
      })}
      {openPhase?.agent && (
        <div role="dialog" aria-label={`Detail fase ${openPhase.name}`} style={{
          position: "absolute", top: "100%", left: 8, zIndex: 5, minWidth: 220, maxWidth: "min(420px, 90vw)",
          padding: "8px 10px", background: "var(--bone-50)", border: "1px solid var(--border-hair)",
          borderRadius: "var(--radius-sm)", whiteSpace: "normal", lineHeight: 1.5,
        }}>
          <div><b>{openPhase.agent.name}</b></div>
          <div>{modelLabel(openPhase.agent.model)} · {openPhase.agent.effort ?? "—"} · {openPhase.agent.status ?? "belum mulai"}</div>
          <div>durasi {durationOf(openPhase) || "—"} · percobaan {openPhase.agent.attempts}</div>
          <div>token in {openPhase.agent.inputTokens ?? "—"} · out {openPhase.agent.outputTokens ?? "—"} · cache {openPhase.agent.cachedTokens ?? "—"}</div>
          {openPhase.agent.resultExcerpt && (
            <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>{openPhase.agent.resultExcerpt}</pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 6: Header sel & strip ringkas** — di `Cell`, tepat sebelum `{session.exited && (failed …`:

```tsx
        {/* ADR-0164 · model & effort orchestrator; model tiap fase ada di chip PhaseStrip. */}
        {session.orchestrated && session.model && (
          <span data-testid="orchestrator-chip" title="Model & effort orchestrator"
            style={{ flex: "0 0 auto", fontSize: 10, color: "var(--text-muted)" }}>
            orch {modelLabel(session.model)}{session.effort ? ` · ${session.effort}` : ""}
          </span>
        )}
```

dan ganti `<PhaseStrip phases={phases} />` dengan `<PhaseStrip phases={phases} compact={headerWidth < 480} />`.

- [x] **Step 7: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run src/test/phase-strip.test.tsx src/test/terminal-screen.test.tsx`
Expected: PASS semua (test `PhaseStrip` lama tetap hijau — fase tanpa agen tak berubah).

Run: `rtk proxy pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 8: Commit**

```bash
/usr/bin/git add src/src/api/client.ts src/src/screens/phase-chip.ts src/src/screens/TerminalScreen.tsx src/test/phase-strip.test.tsx src/test/terminal-screen.test.tsx
/usr/bin/git commit -m "feat(terminal): chip fase ber-model/effort dan chip orchestrator di header sel"
```

### Task 11: Settings — tab Orkestrasi

**Files:**
- Create: `src/src/screens/OrchestrationPanel.tsx`
- Modify: `src/src/screens/SettingsScreen.tsx` (`S_SECTIONS`, `prefs()`, teks kartu Model sesi)
- Create: `src/test/settings-orchestration.test.tsx`
- Modify: `src/test/settings-no-matrix.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`ORCHESTRATION_FLOWS`, `FLOW_PHASES`, `ORCHESTRATION_DEFAULTS`, tipe `Orchestration`), `runtimeModels`/`runtimeEfforts` (`src/src/screens/session-runtime.ts`).
- Produces:
  ```tsx
  export function OrchestrationPanel(props: {
    orchestration: Orchestration | undefined;
    onChange: (next: Orchestration, msg: string) => void;
  }): JSX.Element;
  ```
- aria-label kontrol (dipakai test): `Orkestrasi <flow>` (Switch), `Model <flow> <Fase> <claude|codex>`, `Effort <flow> <Fase> <claude|codex>`.

- [x] **Step 1: Tulis test yang gagal** — `src/test/settings-orchestration.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

// ADR-0164 · tab Orkestrasi: saklar per flow + matriks model/effort per fase per runtime.
vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), putSettings: vi.fn(), getConfig: vi.fn(), putConfig: vi.fn(), deleteConfig: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const SETTING = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  goal: { enabled: false, condition: "" }, orchestration: ORCHESTRATION_DEFAULTS,
};
const me = { id: "u1", email: "a@b.c" } as any;
const lastPut = () => (api.putSettings as any).mock.calls.at(-1)[0];

beforeEach(() => {
  vi.clearAllMocks();
  (api.getSettings as any).mockResolvedValue(structuredClone(SETTING));
  (api.putSettings as any).mockResolvedValue({});
});

const open = async () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={() => {}} />);
  fireEvent.click(screen.getByText("Orkestrasi"));
  return screen.findByTestId("orch-flow-feature");
};

describe("Settings · Orkestrasi (ADR-0164)", () => {
  it("satu kartu per flow memuat fase flow itu", async () => {
    const feature = await open();
    for (const phase of ["Brainstorm", "Objective", "Spec", "Plan", "Execute"])
      expect(within(feature).getByText(phase)).toBeInTheDocument();
    expect(screen.getByTestId("orch-flow-no_effort")).toBeInTheDocument();
  });

  it("memilih model sel menyimpan sel itu; effort tetap warisi", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Model feature Plan claude"), { target: { value: "claude-sonnet-5" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.feature.claude.Plan).toEqual({ model: "claude-sonnet-5", effort: null });
  });

  it("memilih effort sel menyimpan effort itu", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Effort feature Execute claude"), { target: { value: "low" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.feature.claude.Execute).toEqual({ model: null, effort: "low" });
  });

  it("mematikan saklar flow menyimpan enabled:false", async () => {
    await open();
    fireEvent.click(within(screen.getByLabelText("Orkestrasi qa")).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.qa.enabled).toBe(false);
  });

  it("ganti model codex mengoreksi effort yang tak didukung model baru", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.codex.Execute = { model: "gpt-5.6-sol", effort: "ultra" };
    (api.getSettings as any).mockResolvedValue({ ...structuredClone(SETTING), orchestration });
    await open();
    fireEvent.change(screen.getByLabelText("Model qa Execute codex"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalled());
    expect(lastPut().orchestration.qa.codex.Execute).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
  });
});
```

Di `src/test/settings-no-matrix.test.tsx`: ganti komentar baris 6–7 dengan

```tsx
// SPEC-252 · ADR-0061 — matrix per-fase lama (SPEC-238) DICABUT dari tab "Model sesi". ADR-0164 ·
// model/effort per fase kini hidup di tab "Orkestrasi" (definisi subagent, bukan `/model`), dan tab
// Model sesi hanya menunjuk ke sana.
```

dan di test pertama sesudah `expect(screen.queryByText("Laporan")).not.toBeInTheDocument();` tambahkan:

```tsx
    expect(screen.getByText(/tab Orkestrasi/)).toBeInTheDocument();
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run src/test/settings-orchestration.test.tsx src/test/settings-no-matrix.test.tsx`
Expected: FAIL — teks `Orkestrasi` tak ada di navigasi; `tab Orkestrasi` tak ada di kartu Model sesi.

- [x] **Step 3: Panel** — `src/src/screens/OrchestrationPanel.tsx`

```tsx
import React from "react";
import { Card, Select, Switch } from "../ds";
import {
  FLOW_PHASES, ORCHESTRATION_DEFAULTS, ORCHESTRATION_FLOWS, coerceClaudeEffort, coerceCodexEffort,
  type Agent, type FlowOrchestration, type Orchestration, type OrchestrationFlow, type PhaseCell,
} from "@hanoman/shared";
import { runtimeEfforts, runtimeModels } from "./session-runtime";

// ADR-0164 · matriks model/effort per fase. Satu-satunya penulis `Setting.orchestration` adalah tab
// ini, jadi menulis dari snapshot mount aman (pola `changelog`, bukan baca-ulang lead/telegram).
// Katalog dibaca lewat `session-runtime.ts` — sumber yang sama dengan picker Start.

const FLOW_LABEL: Record<OrchestrationFlow, string> = {
  feature: "Brief (feature)", qa: "QA", scaffold: "Scaffold", reverse: "Reverse docs", prd: "PRD",
  audit: "Audit", breakdown: "Breakdown PRD", goal: "Goal", no_effort: "No effort",
};
const RUNTIMES: { id: Agent; label: string }[] = [
  { id: "claude", label: "Claude Code" }, { id: "codex", label: "Codex CLI" },
];
const EMPTY_CELL: PhaseCell = { model: null, effort: null };
const CELL: React.CSSProperties = { padding: "6px 8px", borderTop: "1px solid var(--border-hair)", verticalAlign: "top" };

function CellPicker({ flow, phase, runtime, cell, onPick }: {
  flow: OrchestrationFlow; phase: string; runtime: Agent; cell: PhaseCell;
  onPick: (next: PhaseCell, msg: string) => void;
}) {
  const models = runtimeModels(runtime);
  const efforts = runtimeEfforts(runtime, cell.model ?? "");
  const coerce = runtime === "codex" ? coerceCodexEffort : coerceClaudeEffort;
  const modelOptions = [
    { value: "", label: "— warisi orchestrator" },
    // Nilai di luar katalog (PUT ber-AgentToken, model lama) tetap tampil supaya picker tak kosong.
    ...(cell.model && !models.some((m) => m.id === cell.model) ? [{ value: cell.model, label: cell.model }] : []),
    ...models.map((m) => ({ value: m.id, label: m.label })),
  ];
  const effortOptions = [
    { value: "", label: "— warisi" },
    ...(cell.effort && !efforts.includes(cell.effort) ? [{ value: cell.effort, label: cell.effort }] : []),
    ...efforts.map((e) => ({ value: e, label: e })),
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Select size="sm" aria-label={`Model ${flow} ${phase} ${runtime}`} value={cell.model ?? ""}
        style={{ minWidth: 150 }} options={modelOptions}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
          const model = e.target.value || null;
          // Cermin picker Start: menukar model menurunkan effort yang tak didukung model baru SEKARANG.
          onPick({ model, effort: model && cell.effort ? coerce(model, cell.effort) : cell.effort },
            `${phase} (${runtime}) → ${model ?? "warisi"}`);
        }} />
      <Select size="sm" aria-label={`Effort ${flow} ${phase} ${runtime}`} value={cell.effort ?? ""}
        style={{ minWidth: 96 }} options={effortOptions}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
          onPick({ ...cell, effort: e.target.value || null }, `${phase} (${runtime}) effort → ${e.target.value || "warisi"}`)} />
    </div>
  );
}

export function OrchestrationPanel({ orchestration, onChange }: {
  orchestration: Orchestration | undefined;
  onChange: (next: Orchestration, msg: string) => void;
}) {
  const orch = orchestration ?? ORCHESTRATION_DEFAULTS;
  const flowOf = (flow: OrchestrationFlow): FlowOrchestration => orch[flow] ?? ORCHESTRATION_DEFAULTS[flow];
  const putFlow = (flow: OrchestrationFlow, next: FlowOrchestration, msg: string) =>
    onChange({ ...orch, [flow]: next }, msg);
  return (
    <>
      <Card eyebrow="orkestrasi" title="Orkestrasi subagent per fase">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Sesi utama menjadi <b>orchestrator</b>; setiap fase dikerjakan subagent dengan model &amp; effort di
          bawah. <b>Warisi</b> memakai model/effort orchestrator yang dipilih saat <b>Start</b>. Subagent selalu
          berjalan di runtime orchestrator: sesi claude memakai kolom Claude Code, sesi codex kolom Codex CLI.
          Flow yang dimatikan berjalan sebagai sesi tunggal seperti sebelumnya.
        </div>
      </Card>
      {ORCHESTRATION_FLOWS.map((flow) => {
        const f = flowOf(flow);
        return (
          <div key={flow} data-testid={`orch-flow-${flow}`}>
            <Card eyebrow="flow" title={FLOW_LABEL[flow]}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                  {f.enabled ? "Fase dikerjakan subagent" : "Sesi tunggal (orkestrasi mati)"}
                </span>
                <Switch aria-label={`Orkestrasi ${flow}`} checked={f.enabled}
                  onChange={(v: boolean) => putFlow(flow, { ...f, enabled: v },
                    `Orkestrasi ${FLOW_LABEL[flow]} · ${v ? "aktif" : "nonaktif"}`)} />
              </div>
              <div style={{ overflowX: "auto", opacity: f.enabled ? 1 : 0.55 }}>
                <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th style={{ ...CELL, borderTop: "none", textAlign: "left" }}>Fase</th>
                      {RUNTIMES.map((rt) => (
                        <th key={rt.id} style={{ ...CELL, borderTop: "none", textAlign: "left" }}>{rt.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FLOW_PHASES[flow].map((phase) => (
                      <tr key={phase}>
                        <td style={CELL}>{phase}</td>
                        {RUNTIMES.map((rt) => (
                          <td key={rt.id} style={CELL}>
                            <CellPicker flow={flow} phase={phase} runtime={rt.id} cell={f[rt.id][phase] ?? EMPTY_CELL}
                              onPick={(cell, msg) => putFlow(flow, { ...f, [rt.id]: { ...f[rt.id], [phase]: cell } }, msg)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })}
    </>
  );
}
```

- [x] **Step 4: Sambungkan ke Settings** — `src/src/screens/SettingsScreen.tsx`

Tambah impor `import { OrchestrationPanel } from "./OrchestrationPanel";   // ADR-0164 · orkestrasi subagent per fase`.

`S_SECTIONS`: sesudah `{ key: "model", label: "Model sesi", icon: "cpu" },` tambahkan

```ts
  { key: "orkestrasi", label: "Orkestrasi", icon: "layers" },   // ADR-0164 · model/effort per fase
```

Di `prefs()`, tepat sebelum `if (tab === "model") {`:

```tsx
    // ADR-0164 · satu-satunya penulis `Setting.orchestration` → `save()` dari snapshot mount aman.
    if (tab === "orkestrasi") return (
      <OrchestrationPanel orchestration={s.orchestration}
        onChange={(orchestration, msg) => save({ orchestration }, msg)} />
    );
```

Kartu "Model sesi — default global": ganti kalimat `Sesi = satu proses, satu model seumur hidup.` dengan

```tsx
          Dengan orkestrasi aktif, model ini menjadi model <b>orchestrator</b>; model &amp; effort tiap
          fase diatur di <b>tab Orkestrasi</b>.
```

dan ganti komentar JSX di atas kartu itu (`SPEC-252 · ADR-0061 · default global saja … matrix per-fase (SPEC-238) dicabut …`) dengan versi yang menyebut `ADR-0164 · model per fase kini lewat definisi subagent di tab Orkestrasi; matrix /model ADR-0058 tetap dicabut.`

- [x] **Step 5: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run src/test/settings-orchestration.test.tsx src/test/settings-no-matrix.test.tsx src/test/settings-model-tab.test.tsx src/test/settings-nav.test.tsx src/test/icon-registry.test.ts`
Expected: PASS semua (ikon `layers` sudah terdaftar di registry).

Run: `rtk proxy pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 6: Commit**

```bash
/usr/bin/git add src/src/screens/OrchestrationPanel.tsx src/src/screens/SettingsScreen.tsx src/test/settings-orchestration.test.tsx src/test/settings-no-matrix.test.tsx
/usr/bin/git commit -m "feat(settings): tab Orkestrasi — saklar per flow dan model/effort per fase"
```

### Task 12: Modal Start — pratinjau fase orchestrator

**Files:**
- Create: `src/src/screens/PhasePlanPreview.tsx`
- Modify: `src/src/App.tsx` (`StartSessionModal`)
- Create: `src/test/start-session-orchestration.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`resolvePhasePlan`, `codexNativeAgentsSupported`, `CODEX_NATIVE_AGENTS_MIN_CLIENT`, tipe `Orchestration`), Task 10 (`modelLabel`).
- Produces:
  ```tsx
  export function PhasePlanPreview(props: {
    flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
    orchestration: Orchestration | undefined; codexVersion: string | null;
  }): JSX.Element;   // selalu merender elemen data-testid="phase-plan-preview"
  ```
- Payload `api.startSession` **tidak berubah** — pratinjau murni tampilan; server menghitung ulang rencana dari Setting yang sama (`start-session-model.test.tsx` yang memeriksa payload persis tetap hijau).

- [x] **Step 1: Tulis test yang gagal** — `src/test/start-session-orchestration.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { StartSessionModal } from "../src/App";
import { api } from "../src/api/client";

// ADR-0164 · pratinjau rencana fase di modal Start: resolver yang SAMA dengan server.
vi.mock("../src/api/client", () => ({
  api: {
    getMethodStatus: vi.fn().mockResolvedValue({ agents: [], methods: [] }),
    listProjects: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    getSettings: vi.fn(), startSession: vi.fn(),
    getCodexVersion: vi.fn().mockResolvedValue({ version: null, minRequired: "0.144.0", ok: true }),
  },
  ApiError: class extends Error { status = 0 },
}));

const spec = { id: "SPEC-9", source: "qa", projectId: "p1" } as any;
const settingWith = (orchestration: unknown, extra: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", goal: { enabled: false, condition: "" }, orchestration, ...extra,
});
const renderModal = () => render(<StartSessionModal open spec={spec} onClose={() => {}} onStarted={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  (api.startSession as any).mockResolvedValue({ id: "spec-9" });
});

describe("StartSessionModal · pratinjau fase (ADR-0164)", () => {
  it("memakai sel Settings dan menandai fase yang mewarisi orchestrator", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.claude.Plan = { model: "claude-sonnet-5", effort: "low" };
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Plan · Sonnet 5 · low"));
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Audit · Opus 5 · xhigh (warisi)");
  });

  it("mengubah effort orchestrator ikut mengubah fase yang mewarisi", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS)));
    renderModal();
    await waitFor(() => expect(screen.getByLabelText("Effort")).toHaveValue("xhigh"));
    fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "high" } });
    expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Execute · Opus 5 · high (warisi)");
  });

  it("flow yang orkestrasinya mati → sesi tunggal", async () => {
    const orchestration = structuredClone(ORCHESTRATION_DEFAULTS);
    orchestration.qa.enabled = false;
    (api.getSettings as any).mockResolvedValue(settingWith(orchestration));
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("Orkestrasi mati untuk flow ini"));
  });

  it("codex di bawah 0.151 → sesi tunggal dengan alasannya", async () => {
    (api.getSettings as any).mockResolvedValue(settingWith(structuredClone(ORCHESTRATION_DEFAULTS),
      { agent: "codex", codex: { model: "gpt-5.6-sol", effort: "high" } }));
    (api.getCodexVersion as any).mockResolvedValueOnce({ version: "0.150.0", minRequired: "0.144.0", ok: true });
    renderModal();
    await waitFor(() => expect(screen.getByTestId("phase-plan-preview")).toHaveTextContent("belum mendukung subagent native"));
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `rtk proxy pnpm vitest --run src/test/start-session-orchestration.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="phase-plan-preview"]`.

- [x] **Step 3: Komponen** — `src/src/screens/PhasePlanPreview.tsx`

```tsx
import React from "react";
import {
  CODEX_NATIVE_AGENTS_MIN_CLIENT, codexNativeAgentsSupported, resolvePhasePlan,
  type Agent, type Orchestration, type OrchestrationFlow,
} from "@hanoman/shared";
import { modelLabel } from "./phase-chip";

// ADR-0164 · pratinjau read-only. Memanggil resolver yang SAMA dengan server (`resolvePhasePlan`),
// dengan gerbang versi codex yang sama — dua salinan aturan akan membuat pratinjau berbohong.
const NOTE: React.CSSProperties = { fontSize: 12, lineHeight: 1.5, marginBottom: 12, color: "var(--text-muted)" };

export function PhasePlanPreview({ flow, agent, model, effort, orchestration, codexVersion }: {
  flow: OrchestrationFlow; agent: Agent; model: string; effort: string;
  orchestration: Orchestration | undefined; codexVersion: string | null;
}) {
  const cfg = orchestration?.[flow];
  if (cfg?.enabled === false) {
    return <div data-testid="phase-plan-preview" style={NOTE}>Orkestrasi mati untuk flow ini — sesi tunggal.</div>;
  }
  const nativeAgents = agent === "claude" || codexNativeAgentsSupported(codexVersion);
  const plan = resolvePhasePlan({ flow, runtime: agent, orchestration, orchestrator: { model, effort }, nativeAgents });
  if (!plan) {
    return (
      <div data-testid="phase-plan-preview" style={NOTE}>
        Codex CLI {codexVersion ?? "tak terdeteksi"} belum mendukung subagent native (butuh ≥
        {" "}{CODEX_NATIVE_AGENTS_MIN_CLIENT}) — sesi tunggal.
      </div>
    );
  }
  return (
    <div data-testid="phase-plan-preview" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Fase — dikerjakan subagent</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6, fontFamily: "var(--font-mono)" }}>
        {plan.phases.map((p) => {
          const cell = cfg?.[agent]?.[p.phase];
          const inherited = !cell?.model && !cell?.effort;
          return <li key={p.phase}>{p.phase} · {modelLabel(p.model)} · {p.effort}{inherited ? " (warisi)" : ""}</li>;
        })}
      </ul>
    </div>
  );
}
```

- [x] **Step 4: Sambungkan ke modal** — `src/src/App.tsx`

Impor shared baris 17 menambah `type Orchestration, type OrchestrationFlow`; tambah `import { PhasePlanPreview } from "./screens/PhasePlanPreview";`.

Di `StartSessionModal`, sesudah deklarasi `const [codexVer, setCodexVer] = …`:

```tsx
  // ADR-0164 · matriks orkestrasi untuk pratinjau fase. Absen di respons Setting lama → default aktif.
  const [orchestration, setOrchestration] = React.useState<Orchestration | undefined>(undefined);
```

Di `api.getSettings().then((s) => { … })`, sesudah `setMethod(resolveMethod(s.method).id);`:

```tsx
      setOrchestration(s.orchestration);
```

Teks pengantar modal (`Agen, model & effort untuk sesi ini. … — <code>/model</code> di terminal tetap bisa mengubahnya.`) diganti:

```tsx
        Agen, model &amp; effort <b>orchestrator</b> sesi ini. Default dari setelan global; ubah bila perlu. Bila
        orkestrasi flow ini aktif, tiap fase dikerjakan subagent dengan model &amp; effort di bawah (Settings ›
        Orkestrasi).
```

Tepat sesudah blok `{agent === "codex" && codexClientTooOld(model, codexVer) && ( … )}`:

```tsx
      <PhasePlanPreview flow={flow as OrchestrationFlow} agent={agent} model={model} effort={effort}
        orchestration={orchestration} codexVersion={codexVer} />
```

- [x] **Step 5: Jalankan, pastikan lulus**

Run: `rtk proxy pnpm vitest --run src/test/start-session-orchestration.test.tsx src/test/start-session-model.test.tsx src/test/start-session-agent.test.tsx src/test/start-session-goal.test.tsx`
Expected: PASS semua.

Run: `rtk proxy pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 6: Commit**

```bash
/usr/bin/git add src/src/screens/PhasePlanPreview.tsx src/src/App.tsx src/test/start-session-orchestration.test.tsx
/usr/bin/git commit -m "feat(start): pratinjau fase orchestrator di modal Start"
```

### Task 13: ADR-0164 & docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0164-orkestrasi-subagent-per-fase.md`
- Modify: `internal/docs/README.md` (daftar ADR + entri rancangan)
- Modify: `internal/docs/architecture/data-model.md` (§Setting, §AgentInvocation)
- Modify: `internal/docs/architecture/api-contract.md` (`GET /terminal/sessions`, frame WS `phase`)
- Modify: `internal/docs/frontend/frontend-implementation.md` (bagian baru di akhir)
- Modify: `internal/skills/hanoman/SKILL.md` (butir "Model & effort per SESI")
- Modify: `docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md` (status, §6 statusline, pengukuran)

**Interfaces:** dokumentasi saja; tak ada kode.

- [x] **Step 1: Pastikan nomor ADR belum terpakai**

Run: `ls internal/docs/adr | rtk proxy grep -E "^016[4-9]"`
Expected: kosong. Bila 0164 sudah ada (sesi lain), pakai nomor bebas berikutnya dan ganti SEMUA rujukan `ADR-0164` di kode & docs dalam task ini (`rtk proxy grep -rn "ADR-0164" shared runner server src internal docs`).

- [x] **Step 2: Tulis ADR** — `internal/docs/adr/0164-orkestrasi-subagent-per-fase.md`

```markdown
# ADR-0164 — Orkestrasi subagent per fase: model & effort lewat definisi subagent

- Status: Accepted
- Tanggal: 2026-09-14
- Spec: [rancangan orkestrasi subagent per fase](../../../docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md)
- Terkait: **mengamandemen** [0061](0061-model-effort-per-sesi-picker-start.md) — model/effort sesi kini
  model/effort **orchestrator**; **tidak menghidupkan kembali** [0058](0058-model-effort-per-fase.md) —
  tak ada `/model` yang diketik agen; **memperluas** [0094](0094-custom-agent-katalog-materialisasi-native.md)
  & [0159](0159-custom-agent-native-terukur-terisolasi.md) — renderer, hook, roster, dan `AgentInvocation`
  dipakai untuk agen fase; **menegakkan** [0024](0024-sesi-interaktif-menggantikan-run.md) &
  [0015](0015-one-session-per-backlog.md) — tetap satu sesi tmux per backlog; **mengubah pelaksana**
  [0035](0035-sesi-lanjut-fase-tanpa-berhenti-kecuali-keputusan.md) & [0040](0040-*.md) — batas fase
  ditembus orchestrator, keputusan jalur cepat qa jadi rekomendasi agen Audit.

## Konteks

Operator ingin setiap fase flow (mis. brief: Brainstorm → Objective → Spec → Plan → Execute) dikerjakan
model & effort yang berbeda, disetel dari Settings, dengan sesi utama sebagai orchestrator. ADR-0058
pernah mencobanya lewat agen yang mengetik `/model`+`/effort` di batas fase dan dicabut ADR-0061:
peralihannya bergantung kepatuhan agen, server tak bisa menegakkannya, `/effort` diabaikan di Opus.

Kedua runtime kini punya subagent native ber-model/effort per definisi. Diukur 2026-09-14 (claude
2.1.270, codex 0.154.0), dengan parent SENGAJA berbeda dari anak:

| # | Yang diukur | Hasil |
|---|---|---|
| P1 | claude `--agents` tanpa kunci `tools` | Subagent mendapat seluruh tool sesi dan memanggil skill `superpowers:verification-before-completion`. |
| P2 | claude parent Haiku/low, agen Sonnet/medium | stdin `subagentStatusLine`: `model: claude-sonnet-5`, `effort: medium`; `SubagentStop.effort.level = medium`. |
| P3 | claude `SendMessage` ke agent ID | Subagent yang sama dilanjutkan dengan konteks utuh; `SubagentStart` menembak ulang dengan `agent_id` SAMA. |
| P4 | stdin `subagentStatusLine` | `tasks[]` = `id, type:"local_agent", label/description, startTime (ms), model, effort?, tokenCount` — **tanpa nama agen**. |
| P5 | codex parent Sol/medium, role Luna/low via `config_file` | Rollout anak `gpt-5.6-luna` + `reasoning_effort: low`; rollout parent nol `luna`. |
| P6 | codex `spawn_agent` + `send_input` | Skill tersedia di anak; pesan susulan dijawab dari konteks yang sama. |

## Keputusan

1. **`Setting.orchestration`** (Json, tanpa migration): saklar per flow default **aktif** + matriks
   `claude`/`codex` × fase; sel `null` mewarisi model/effort orchestrator (picker Start). Resolver murni
   `resolvePhasePlan` (`@hanoman/shared`) dipakai server dan pratinjau Start; effort dikoersi ke model
   hasil resolusi.
2. **Agen fase di-generate saat sesi lahir** (`buildPhaseAgents`), bernama `hanoman-fase-<slug>`, bukan
   baris `CustomAgent`: tak disync, tak masuk katalog, tak masuk graf mention. Instruksinya potongan prompt
   mode tunggal yang dipindah ke fase pemiliknya. Awalan `hanoman-fase-` dicadangkan di skema custom agent.
3. **Agen fase dirender tanpa kunci `tools`** — pengecualian sadar atas gotcha 5 ADR-0094 (P1): tanpa itu
   agen fase kehilangan `Skill` tanpa galat. Batas loop: kedalaman native claude (3 lapis), `agents.max_depth=3`
   codex, larangan tertulis memanggil `hanoman-fase-*`.
4. **Prompt orchestrator** hanya membawa kontrak delegasi: deskripsi pemanggilan `Fase <Nama Fase>` (P4),
   blok serah-terima tetap, orchestrator satu-satunya penulis `$HANOMAN_PHASE_FILE`, ulang **sekali** lalu
   `AskUserQuestion` (juga di sesi full-control), relay pertanyaan ke subagent yang SAMA (P3/P6), dilarang
   mengerjakan fase sendiri.
5. **All-or-nothing**: satu agen fase gagal dimaterialisasi (atau codex < 0.151) → sesi lahir mode tunggal
   dengan prompt lama yang dirakit pemanggil dari input yang sama. Flow mati → argv & prompt byte-identik
   (golden test).
6. **Bukti**: `AgentInvocation.phase`/`effort` (satu migration, LOCAL-only); effort stop dari payload
   runtime. Frame `phase` WS terminal diperkaya status/durasi/percobaan/token; `evidence: missing` sesudah
   60 dtk tanpa invocation dilabeli "bukti subagent tak diterima". Metrik custom agent mengecualikan baris
   ber-`phase`.
7. **Tampilan**: tab Settings "Orkestrasi", pratinjau fase di modal Start, chip `PhaseStrip` + chip
   orchestrator di header sel, `subagentStatusLine` claude `label · model · effort · durasi · token`.

## Alternatif ditolak

- **Seed baris `CustomAgent` per fase** — ±60 baris tersync, instruksi beku terhadap ganti metode, pengaturan
  pindah ke layar Agents.
- **Server spawn satu sesi tmux per fase** — tanpa orchestrator, membalik ADR-0024/0015; ditolak dua kali.
- **Runtime berbeda per fase** (claude memanggil `codex exec`) — titik spawn baru, ditolak ADR-0094/SPEC-448.
- **Orchestrator mengerjakan fase interaktif sendiri** — melanggar "setiap fase oleh subagent"; relay P3/P6 cukup.

## Konsekuensi

- Delegasi tetap kepatuhan orchestrator; yang dijamin model/effort **saat** didelegasikan dan **terlihatnya**
  pelanggaran, bukan kemustahilannya.
- Tiap fase mulai dengan konteks segar → biaya token bisa naik; serah-terima lewat berkas.
- Default aktif mengubah perilaku semua flow sesudah upgrade, termasuk `no_effort`.
- `pty.ts` tetap nol dependensi DB: invocation disuntik lewat `setPhaseInvocations`.
```

Ganti tautan `[0040](0040-*.md)` dengan nama berkas ADR-0040 yang sebenarnya: `ls internal/docs/adr | rtk proxy grep "^0040-"`.

- [x] **Step 3: Index** — `internal/docs/README.md`

Di bagian ADR, tepat di atas baris `- [0163 — …`:

```markdown
- [0164 — Orkestrasi subagent per fase: model & effort lewat definisi subagent](adr/0164-orkestrasi-subagent-per-fase.md) — **mengamandemen 0061**, memperluas 0094/0159. Sesi ber-flow jadi orchestrator; tiap fase dikerjakan agen native `hanoman-fase-<slug>` ber-model/effort dari `Setting.orchestration` (saklar per flow default aktif). Tanpa kunci `tools` (Skill terwarisi), all-or-nothing ke mode tunggal, bukti `AgentInvocation.phase/effort`, chip `PhaseStrip` + `subagentStatusLine` claude
```

Pada entri "rancangan orkestrasi subagent per fase" di bagian research, ganti ekor `ADR-0164 (bersama implementasi)` dengan `[ADR-0164](adr/0164-orkestrasi-subagent-per-fase.md) · [plan](../../docs/superpowers/plans/2026-09-14-orkestrasi-subagent-fase.md)`.

- [x] **Step 4: Data model** — `internal/docs/architecture/data-model.md`

Di §Setting, sesudah butir `phaseModels` **dicabut** …:

```markdown
- `orchestration` ([ADR-0164](../adr/0164-orkestrasi-subagent-per-fase.md)) — satu kunci per flow
  (`feature`…`no_effort`) berbentuk `{ enabled (default true), claude: {<Fase>: {model|null, effort|null}},
  codex: {…} }`. Sesi ber-flow aktif lahir sebagai orchestrator; tiap fase dikerjakan subagent native
  `hanoman-fase-<slug>` dengan model/effort sel, atau warisan orchestrator bila `null`. Lenient; baris lama
  tanpa blok ini parse dengan default aktif. Tanpa migration.
```

Di tabel §AgentInvocation, sesudah baris `definitionHash?`:

```markdown
| `phase?` · `effort?` | [ADR-0164](../adr/0164-orkestrasi-subagent-per-fase.md) · fase milik agen fase (null untuk custom agent); effort dari roster saat start, diganti effort runtime (`SubagentStop.effort.level`) saat stop. Metrik custom agent mengecualikan baris ber-`phase`. |
```

- [x] **Step 5: Kontrak API** — `internal/docs/architecture/api-contract.md`

Baris `GET    /terminal/sessions            # [{ id, projectId, specId?, flow?, cwd, branch?, exited, exitCode?, decision, agent }]` menjadi:

```text
GET    /terminal/sessions            # [{ id, projectId, specId?, flow?, cwd, branch?, exited, exitCode?, decision, agent, model?, effort?, orchestrated? }]
```

Cari dokumentasi WS terminal (`rtk proxy grep -n "terminal/sessions/:id/ws" internal/docs/architecture/api-contract.md`) dan tambahkan di bawahnya:

```text
#   ADR-0164 · frame {t:"phase", phases, complete}: tiap fase MAY membawa `agent` =
#   { name, model?, effort?, status?, startedAt?, durationMs?, attempts, inputTokens?, outputTokens?,
#     cachedTokens?, resultExcerpt?, evidence: "ok"|"pending"|"missing" } untuk sesi orchestrator.
#   Frame disiarkan ulang tiap SubagentStart/Stop agen fase dan sesudah hidrasi saat attach.
```

- [x] **Step 6: Frontend & skill project**

Tambahkan di akhir `internal/docs/frontend/frontend-implementation.md`:

```markdown
## Settings → Orkestrasi, pratinjau Start, chip fase (ADR-0164)

- **Tab Orkestrasi** (`OrchestrationPanel`): satu kartu per flow — `Switch` "Orkestrasi <flow>" + tabel fase ×
  (Claude Code | Codex CLI) berisi dua `Select` (model: `— warisi orchestrator` + katalog runtime; effort:
  `— warisi` + `runtimeEfforts`). Menukar model mengoreksi effort sel. Tabel di dalam `overflowX: auto`.
- **Modal Start** (`PhasePlanPreview`): picker yang ada = orchestrator; di bawahnya daftar `Fase · model · effort
  (warisi)` dari `resolvePhasePlan`, atau catatan "sesi tunggal" (flow mati / codex < 0.151).
- **Sel terminal**: chip `orch <model> · <effort>` di header bila `orchestrated`; `PhaseStrip` menggambar fase
  ber-agen sebagai chip `ikon · nama · model · effort · durasi` (+`↻n`, ⚠ "bukti subagent tak diterima"),
  ringkas bila header < 480px, klik → detail token in/out/cache terpisah + cuplikan hasil. Fase tanpa agen
  digambar seperti sebelumnya.
```

Di `internal/skills/hanoman/SKILL.md`, di akhir butir `- **Model & effort per SESI** (SPEC-252/ADR-0061 …`, tambahkan kalimat:

```markdown
  **ADR-0164** · untuk flow yang orkestrasinya aktif (default), model/effort itu menjadi model **orchestrator**;
  tiap fase dikerjakan subagent native `hanoman-fase-<slug>` dengan model/effort dari `Setting.orchestration`
  (tab Settings → Orkestrasi) — lewat definisi subagent saat sesi lahir, bukan `/model` (ADR-0058 tetap dicabut).
```

- [x] **Step 7: Spec** — `docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md`

- Baris status menjadi `Status: approved 2026-09-14 · diimplementasikan lewat [plan](../plans/2026-09-14-orkestrasi-subagent-fase.md). [ADR-0164](../../../internal/docs/adr/0164-orkestrasi-subagent-per-fase.md) mengikat.`
- §6 butir statusline: ganti `node <tempDir>/subagent-statusline.mjs`, membaca `<tempDir>/roster.json` dengan `node <tempDir>/subagent-statusline.cjs <tempDir>/subagent-models.json`; label dari deskripsi pemanggilan `Fase <Nama Fase>` (stdin tak membawa nama agen), model & effort dari task itu sendiri.
- Tambahkan bagian `## Pengukuran fondasi (2026-09-14)` berisi tabel P1–P6 yang sama dengan ADR-0164.

- [x] **Step 8: Integritas index & commit**

Run: `rtk proxy pnpm exec tsx cli/src/index.ts docs index --check` — bila perintah itu tak tersedia di worktree, jalankan `rtk proxy grep -c "0164-orkestrasi-subagent-per-fase" internal/docs/README.md` dan pastikan ≥ 1.
Expected: index sah / hitungan ≥ 1.

```bash
/usr/bin/git add internal/docs/adr/0164-orkestrasi-subagent-per-fase.md internal/docs/README.md internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md internal/docs/frontend/frontend-implementation.md internal/skills/hanoman/SKILL.md docs/superpowers/specs/2026-09-14-orkestrasi-subagent-fase-design.md
/usr/bin/git commit -m "docs(orkestrasi): ADR-0164 dan docs Source of Truth tersentuh"
```

### Task 14: Verifikasi akhir — test tersentuh, typecheck, smoke live, API nyata

Dikerjakan **controller** (sesi utama), bukan subagent implementer: smoke memakai tmux, CLI claude sungguhan, dan server lokal.

**Files:**
- Create (sementara, JANGAN di-commit): `server/.smoke/render.ts`, `server/.smoke/seed.ts`, `server/.smoke/token.ts`
- Modify: `docs/superpowers/plans/2026-09-14-orkestrasi-subagent-fase.md` (centang)

- [x] **Step 1: Test tersentuh, serial**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" rtk proxy pnpm vitest --run --changed 05978c6d --no-file-parallelism`
Expected: PASS. Setiap merah dicek di base dulu (`/usr/bin/git stash` DILARANG — pakai `/usr/bin/git worktree add "$(mktemp -d)/base" 05978c6d` lalu jalankan test yang sama di sana). Merah yang juga merah di base dicatat apa adanya di laporan akhir, bukan diperbaiki diam-diam.

- [x] **Step 2: Typecheck keempat paket**

Run: `rtk proxy pnpm --filter ./shared typecheck && rtk proxy pnpm --filter ./runner typecheck && rtk proxy pnpm --filter ./server typecheck && rtk proxy pnpm --filter ./src typecheck`
Expected: exit 0.

- [x] **Step 3: Smoke live orchestrator claude (renderer produk sungguhan)**

`server/.smoke/render.ts`:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORCHESTRATION_DEFAULTS, resolveMethod, resolvePhasePlan } from "@hanoman/shared";
import { agentFlags, buildPhaseAgents, goalContext, renderAgentsJson, startGoalPrompt, writeSubagentStatusline } from "@hanoman/runner";

const dir = process.argv[2]!;
const spec = { id: "SPEC-SMOKE", title: "Smoke orkestrasi", source: "no_effort", priority: "rendah",
  objective: "Buat HALO.md", payload: { goal: "Buat berkas HALO.md berisi satu baris 'halo' lalu commit.", done: "HALO.md ter-commit" } };
const plan = resolvePhasePlan({
  flow: "no_effort", runtime: "claude", nativeAgents: true,
  orchestration: { ...ORCHESTRATION_DEFAULTS, no_effort: { enabled: true, claude: { Kerjakan: { model: "claude-sonnet-5", effort: "low" } }, codex: {} } },
  orchestrator: { model: "claude-haiku-4-5", effort: "low" },
})!;
writeFileSync(join(dir, "prompt.txt"), startGoalPrompt("no_effort", spec, "smoke", { plan }));
writeFileSync(join(dir, "agents.json"), renderAgentsJson(buildPhaseAgents(plan, {
  flow: "no_effort", method: resolveMethod(), context: goalContext(spec),
})));
const flags = agentFlags({ agent: "claude", model: "claude-haiku-4-5", effort: "low", subagentStatusLine: writeSubagentStatusline(dir) });
const settings = JSON.parse(flags[flags.indexOf("--settings") + 1]!);
// Bukti: hook mencatat payload, statusline mencatat stdin sebelum diteruskan ke skrip produk.
settings.hooks = {
  SubagentStart: [{ hooks: [{ type: "command", command: `cat >> ${dir}/hooks.log; echo >> ${dir}/hooks.log` }] }],
  SubagentStop: [{ hooks: [{ type: "command", command: `cat >> ${dir}/hooks.log; echo >> ${dir}/hooks.log` }] }],
};
settings.subagentStatusLine.command = `tee -a ${dir}/statusline.log | ${settings.subagentStatusLine.command}`;
writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
```

Tulis ke `.superpowers/sdd/smoke-orkestrasi.sh` lalu jalankan `sh <path>` di background (timeout 10 menit):

```sh
#!/bin/sh
set -u
W=/Users/denameidina/Documents/Nafanesia/hanoman/.claude/worktrees/orkestrasi-subagent-fase
D=$(mktemp -d)/smoke; S=smokeorch14
mkdir -p "$D/repo"; git -C "$D/repo" init -q; git -C "$D/repo" -c user.name=s -c user.email=s@s commit -q --allow-empty -m root
(cd "$W" && pnpm --filter ./server exec tsx .smoke/render.ts "$D") || exit 1
tmux -L "$S" kill-server 2>/dev/null
tmux -L "$S" new-session -d -s p -x 220 -y 60 -c "$D/repo" \
  "env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT HANOMAN_PHASE_FILE='$D/phases' claude --model claude-haiku-4-5 --effort low --dangerously-skip-permissions --settings \"\$(cat $D/settings.json)\" --agents \"\$(cat $D/agents.json)\" \"\$(cat $D/prompt.txt)\"; sleep 600"
end=$(( $(date +%s) + 480 )); trusted=0
while [ "$(date +%s)" -lt "$end" ]; do
  tmux -L "$S" capture-pane -p -t p -S -200 > "$D/pane.txt" 2>/dev/null
  if grep -q "Kerjakan done" "$D/phases" 2>/dev/null; then sleep 8; break; fi
  if [ "$trusted" = 0 ] && grep -q "Yes, I trust this folder" "$D/pane.txt"; then
    tmux -L "$S" send-keys -t p Down; sleep 1; tmux -L "$S" send-keys -t p Enter; trusted=1
  fi
  sleep 5
done
tmux -L "$S" capture-pane -p -t p -S -200 > "$D/pane.txt"; tmux -L "$S" kill-server
echo "=== phases ==="; cat "$D/phases" 2>/dev/null
echo "=== agent_type di hook ==="; grep -oE '"agent_type":"[^"]*"' "$D/hooks.log" | sort | uniq -c
echo "=== stdin statusline ==="; grep -oE '"(label|model|effort)":"[^"]*"' "$D/statusline.log" | sort | uniq -c
echo "=== repo ==="; git -C "$D/repo" log --oneline; cat "$D/repo/HALO.md" 2>/dev/null
echo "=== pane (baris subagent) ==="; grep -n "Fase Kerjakan" "$D/pane.txt"
```

Expected (semua wajib):
- `phases` memuat `Kerjakan done`.
- hook memuat `"agent_type":"hanoman-fase-kerjakan"`.
- stdin statusline memuat `"label":"Fase Kerjakan"`, `"model":"claude-sonnet-5"`, `"effort":"low"` (parent Haiku — model/effort agen fase benar-benar dipakai).
- repo punya commit dengan `HALO.md` berisi `halo`.

Gagal di salah satu = temuan, bukan catatan kaki: laporkan dengan output apa adanya dan hentikan penutupan pekerjaan.

- [x] **Step 4: API nyata dengan HOME sekali pakai**

`server/.smoke/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
await prisma.project.create({ data: { id: "smoke", name: "Smoke", desc: "", kind: "existing", repoDir: process.argv[2]! } });
await prisma.spec.create({ data: { id: "SPEC-SMOKE", projectId: "smoke", title: "t", source: "brief", stage: "planned",
  author: "a", priority: "sedang", objective: "o", launchApprovedAt: new Date(), launchApprovedBy: "smoke" } });
await prisma.$disconnect();
```

`server/.smoke/token.ts`:

```ts
import { sessionEventToken } from "../src/services/session-event-token";
process.stdout.write(sessionEventToken(process.argv[2]!));
```

Perintah (satu per satu; `H`, `R` diekspor sekali di shell yang sama):

```sh
export H=$(mktemp -d) R=$(mktemp -d)/repo
mkdir -p "$R" && git -C "$R" init -q && git -C "$R" -c user.name=s -c user.email=s@s commit -q --allow-empty -m root
env -u HANOMAN_CONTROL_ORIGINS -u NODE_ENV HANOMAN_HOME="$H" DATABASE_URL="file:$H/hanoman.db" rtk proxy pnpm --filter ./server exec prisma migrate deploy --schema prisma/schema.prisma
env -u HANOMAN_CONTROL_ORIGINS -u NODE_ENV HANOMAN_HOME="$H" DATABASE_URL="file:$H/hanoman.db" rtk proxy pnpm --filter ./server exec tsx .smoke/seed.ts "$R"
```

Boot server di background (catat PID dari notifikasi / `lsof -ti:8799`):

```sh
env -u HANOMAN_CONTROL_ORIGINS -u NODE_ENV PORT=8799 HANOMAN_HOME="$H" DATABASE_URL="file:$H/hanoman.db" HANOMAN_TMUX_SOCKET=hanoman-smoke HANOMAN_CLAUDE_BIN=/bin/echo pnpm --filter ./server exec tsx src/server.ts
```

Lalu:

```sh
curl -s -c "$H/jar" -H 'content-type: application/json' -H 'origin: http://localhost:8799' \
  -d '{"email":"smoke@local.test","password":"smoke-password-123"}' http://localhost:8799/api/auth/setup
curl -s -b "$H/jar" http://localhost:8799/api/settings | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);j.orchestration.feature.claude.Plan={model:"claude-sonnet-5",effort:"low"};process.stdout.write(JSON.stringify(j))})' > "$H/setting.json"
curl -s -b "$H/jar" -X PUT -H 'content-type: application/json' -H 'origin: http://localhost:8799' --data @"$H/setting.json" http://localhost:8799/api/settings | rtk proxy grep -o '"Plan":{[^}]*}'
curl -s -b "$H/jar" -H 'content-type: application/json' -H 'origin: http://localhost:8799' \
  -d '{"spec":"SPEC-SMOKE","flow":"feature"}' http://localhost:8799/api/terminal/sessions
tmux -L hanoman-smoke capture-pane -p -J -S -3000 -t hanoman-spec-smoke | rtk proxy grep -oE 'hanoman-fase-[a-z-]+|Sesi ini ORCHESTRATOR|subagentStatusLine' | sort | uniq -c
curl -s -b "$H/jar" http://localhost:8799/api/terminal/sessions | rtk proxy grep -oE '"orchestrated":true|"model":"[^"]*"'
TOKEN=$(env HANOMAN_HOME="$H" DATABASE_URL="file:$H/hanoman.db" pnpm --silent --filter ./server exec tsx .smoke/token.ts spec-smoke)
curl -s -X POST -H "authorization: Bearer $TOKEN" -H 'x-hanoman-session: spec-smoke' -H 'content-type: application/json' \
  -d '{"hook_event_name":"SubagentStart","agent_id":"smk-1","agent_type":"hanoman-fase-plan"}' http://localhost:8799/api/session-events
sqlite3 "$H/hanoman.db" 'select agentName, phase, effort, model from AgentInvocation;'
```

Expected:
- PUT membalas `"Plan":{"model":"claude-sonnet-5","effort":"low"}`.
- POST sesi → `201 {"id":"spec-smoke"}`; layar pane memuat kelima `hanoman-fase-*` feature, `Sesi ini ORCHESTRATOR`, dan `subagentStatusLine`.
- GET sesi memuat `"orchestrated":true` dan `"model":"claude-opus-5"`.
- session-events → `{"accepted":true}`; sqlite → `hanoman-fase-plan|Plan|low|claude-sonnet-5`.

Bila auth/Origin menolak (401/403/404), baca `server/src/app.ts` bagian gerbang cookie & ingress lalu sesuaikan header — catat penyesuaiannya di laporan.

- [x] **Step 5: Bersihkan (per-PID, bukan pola)**

```sh
kill <PID server dari Step 4>
tmux -L hanoman-smoke kill-server
rm -rf server/.smoke
/usr/bin/git status --short
```

Expected: `git status` hanya menunjukkan centang plan (belum di-commit) — tak ada `server/.smoke`.

- [x] **Step 6: Commit centang plan**

```bash
/usr/bin/git add docs/superpowers/plans/2026-09-14-orkestrasi-subagent-fase.md
/usr/bin/git commit -m "docs(plan): orkestrasi subagent per fase — semua task terverifikasi"
```

---

## Self-review (penulis plan)

- **Cakupan spec → task:** AC-1/AC-4 → T1 · AC-2 → T2 (golden) + T5 + T7 · AC-3/AC-5/AC-6 → T3–T5, T7–T8 · AC-7/AC-8 → T7, T12 · AC-9/AC-11/AC-15 → T9 · AC-10 → T10 · AC-12 → T6–T7 · AC-13 → T8 · AC-14 → T12 · Settings → T11 · docs/ADR → T13 · smoke & API → T14.
- **Kontrak statusline dikoreksi dari spec awal** oleh pengukuran (tanpa roster; label = deskripsi `Fase <Nama Fase>`); T13 memperbarui spec §6.
- **Nama konsisten lintas task:** `resolvePhasePlan`, `PhasePlan`, `buildPhaseAgents`, `orchestratorClause`, `writeSubagentStatusline`, `sessionPhasePlan`, `nativeAgentsAvailable`, `enrichPhases`, `listPhaseInvocations`, `refreshPhaseInvocations`, `setPhaseInvocations`, `PhasePlanPreview`, `OrchestrationPanel`, `phase-chip.ts` (`modelLabel`, `formatDuration`, `chipTone`).

