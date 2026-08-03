# SPEC-517 — Pilih runtime claude/codex saat buat sesi terminal baru · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tombol “Sesi baru” di halaman Terminal membuka form pemilih runtime (claude/codex) + model + effort, dan pilihan itu jadi argv pane tmux saat sesi lahir.

**Architecture:** Varian `{project}` di `POST /terminal/sessions` menerima `agent?`/`model?`/`effort?` opsional; server meresolusinya lewat helper baru `terminalAgentDefaults()` (cermin `conflictSessionDefaults()`); UI mendapat modal `NewTerminalModal` yang memakai katalog `@hanoman/shared` yang sudah ada. Tanpa override, byte request & perilaku server identik dengan hari ini.

**Tech Stack:** TypeScript strict · zod (`shared/src/dto.ts`) · Fastify (`server/src/routes/terminal.ts`) · Prisma/SQLite (tak tersentuh — **tanpa migration**) · React + Vite (`src/src`) · vitest + @testing-library/react.

## Global Constraints

- **Jangan hardcode daftar model/effort baru.** Sumber tunggal katalog: `MODELS`, `EFFORTS`, `CODEX_MODELS`, `codexEfforts(model)`, `coerceCodexEffort(model, effort)` di `@hanoman/shared`.
- **Default tetap setelan global** bila operator tak memilih: body `{project}` polos harus berperilaku persis seperti sebelum SPEC-517.
- **Tanpa perubahan skema, tanpa migration, tanpa endpoint baru, tanpa ADR baru.**
- **`ensureCodexTrust(repoDir)` wajib diturunkan dari agen HASIL resolusi**, bukan dari `Setting.agent` (gotcha SPEC-377/ADR-0081 — kini keduanya bisa berbeda di jalur ini).
- Scope override **hanya** terminal agen biasa. `reverse`/`scaffold`/`prd`/`breakdown`, sesi konflik, dan shell mentah tak berubah.
- Test web **wajib** dijalankan dengan `env -u NODE_ENV` (shell mesin ini menyetel `NODE_ENV=production`, yang membuat RTL `act` gagal massal).
- Test server **wajib** `--no-file-parallelism` dan `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (sesi lain di mesin ini menghapus DB test bersama di tengah run).
- Bahasa komentar & string UI: **Indonesia**, mengikuti berkas di sekitarnya.

---

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/dto.ts` (modify) | Pecah varian union `{project, flow?: "reverse"}` jadi dua; varian plain menerima `agent?`/`model?`/`effort?` |
| `shared/src/terminal-session-runtime.test.ts` (create) | Kontrak union: apa yang lolos, apa yang ditolak, apa yang **tak boleh** ditelan varian plain |
| `server/src/services/settings.ts` (modify) | `terminalAgentDefaults(o)` — resolusi override → `{agent, model, effort}` |
| `server/test/terminal-agent-defaults.test.ts` (create) | Unit test helper itu (cermin `conflict-session-defaults.test.ts`) |
| `server/src/routes/terminal.ts` (modify, ±baris 286-291) | Cabang terminal agen biasa memakai helper + `ensureCodexTrust` dari agen hasil |
| `server/test/terminal.route.test.ts` (modify) | Route melahirkan argv sesuai override |
| `src/src/screens/session-runtime.ts` (create) | Helper murni katalog runtime: `runtimeModels`/`runtimeEfforts`/`runtimeFor` |
| `src/test/session-runtime.test.ts` (create) | Unit test helper murni |
| `src/src/App.tsx` (modify, `StartSessionModal`) | Memakai helper yang sama (perubahan penataan, perilaku identik) |
| `src/src/api/client.ts` (modify) | `createTerminal(project, opts?)` |
| `src/src/screens/NewTerminalModal.tsx` (create) | Modal pemilih Agen/Model/Effort + catatan versi codex |
| `src/src/screens/TerminalScreen.tsx` (modify) | “Sesi baru” membuka modal; `restartFromHistory` membawa runtime baris riwayat |
| `src/test/new-terminal-runtime.test.tsx` (create) | Perilaku modal + body request + restart riwayat |
| `src/test/terminal-screen.test.tsx` (modify) | Test lama yang mengencode “klik langsung membuat sesi” diperbarui |
| `internal/docs/architecture/api-contract.md` (modify) | Varian request + amandemen klausa “terminal … tak punya override” |
| `internal/skills/hanoman/SKILL.md` (modify) | Butir ADR-0074: daftar pintu yang mengikuti `Setting.agent` |
| `internal/docs/frontend/frontend-implementation.md` (modify) | Paragraf Terminal: “Sesi baru” kini membuka picker |

---

### Task 1: Kontrak DTO — varian plain menerima override runtime

**Files:**
- Modify: `shared/src/dto.ts:334-367`
- Test: `shared/src/terminal-session-runtime.test.ts` (create)

**Interfaces:**
- Consumes: `zAgent` (sudah diimpor di `dto.ts`).
- Produces: `zTerminalSession` menerima `{ project, agent?, model?, effort? }`; varian `reverse` jadi `{ project, flow: "reverse" }` terpisah.

- [x] **Step 1: Tulis test yang gagal**

Buat `shared/src/terminal-session-runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zTerminalSession } from "./dto";

// SPEC-517 · varian terminal agen biasa menerima override runtime per sesi. Varian reverse
// (sesi project-level, ADR-0074) sengaja TIDAK — ia tetap mengikuti Setting.agent.
describe("zTerminalSession · varian terminal agen biasa (SPEC-517)", () => {
  it("{project} polos tetap sah dan tak membawa override apa pun", () => {
    const r = zTerminalSession.safeParse({ project: "p1" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1" });
  });

  it("membawa agent + model + effort sampai ke data hasil parse", () => {
    const r = zTerminalSession.safeParse(
      { project: "p1", agent: "codex", model: "gpt-5.6-luna", effort: "max" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject(
      { project: "p1", agent: "codex", model: "gpt-5.6-luna", effort: "max" });
  });

  it("agen di luar katalog ditolak", () => {
    expect(zTerminalSession.safeParse({ project: "p1", agent: "gemini" }).success).toBe(false);
  });

  it("flow reverse tetap sah, TANPA membawa override", () => {
    const r = zTerminalSession.safeParse({ project: "p1", flow: "reverse", agent: "codex" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1", flow: "reverse" });
  });

  // Gerbang `flow: z.undefined()` pada varian plain. Tanpa itu, varian permisif ini menelan
  // body flow yang cacat dan melahirkan terminal biasa secara SENYAP alih-alih 400.
  it("body prd tanpa brief ditolak seluruh union — bukan jatuh jadi terminal biasa", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "prd" }).success).toBe(false);
  });

  it("flow breakdown tanpa prdPath ditolak, tak jatuh jadi terminal biasa", () => {
    expect(zTerminalSession.safeParse({ project: "p1", flow: "breakdown" }).success).toBe(false);
  });

  it("varian shell tetap menang atas varian plain", () => {
    const r = zTerminalSession.safeParse({ project: "p1", shell: true, agent: "codex" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ project: "p1", shell: true });
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
pnpm vitest --run shared/src/terminal-session-runtime.test.ts
```

Expected: FAIL — `{project, agent:"codex"}` lolos tapi `agent` dibuang (varian lama non-strict), dan `{project, flow:"prd"}` **lolos** sebagai terminal biasa.

- [x] **Step 3: Implementasi**

Di `shared/src/dto.ts`, ganti varian ini:

```ts
  // flow opsional (SPEC-166): "reverse" = sesi project-level di worktree-nya sendiri,
  // menyusun Source of Truth dari kode. Tanpa flow = terminal biasa (claude) di repoDir.
  z.object({ project: z.string(), flow: z.literal("reverse").optional() }),
```

menjadi:

```ts
  // SPEC-166 · "reverse" = sesi project-level di worktree-nya sendiri, menyusun Source of Truth
  // dari kode. TANPA override runtime: sesi project-level mengikuti Setting.agent (ADR-0074).
  z.object({ project: z.string(), flow: z.literal("reverse") }),
```

dan tambahkan varian baru **sesudah** varian `scaffold` (sebelum varian `spec`):

```ts
  // SPEC-517 · terminal agen biasa: agen (claude|codex) + model + effort boleh dipilih PER SESI,
  // seperti picker Start backlog (ADR-0061/0074). Kosong → default global (Setting).
  // `flow: z.undefined()` BUKAN hiasan: varian ini permisif dan diletakkan sesudah semua varian
  // ber-flow, jadi tanpa gerbang itu body flow yang CACAT ({project, flow:"prd"} tanpa brief)
  // akan lolos ke sini dan melahirkan terminal biasa secara senyap alih-alih dijawab 400.
  z.object({
    project: z.string(), flow: z.undefined(),
    agent: zAgent.optional(), model: z.string().optional(), effort: z.string().optional(),
  }),
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
pnpm vitest --run shared/src/terminal-session-runtime.test.ts
```

Expected: PASS (7 test).

- [x] **Step 5: Test kontrak tetangga tak regresi**

```bash
pnpm vitest --run shared/src/agent-session.test.ts shared/src/goal.test.ts shared/src/spec-deps-contract.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add shared/src/dto.ts shared/src/terminal-session-runtime.test.ts
git commit -m "feat(spec-517): varian terminal agen biasa menerima override runtime"
```

---

### Task 2: `terminalAgentDefaults()` — resolusi override di server

**Files:**
- Modify: `server/src/services/settings.ts` (tambahkan sesudah `conflictSessionDefaults`)
- Test: `server/test/terminal-agent-defaults.test.ts` (create)

**Interfaces:**
- Consumes: `getSetting()`, `agentDefaultsOf(s)`, `coerceCodexEffort` (sudah ada di berkas itu).
- Produces:
  ```ts
  export async function terminalAgentDefaults(
    o: { agent?: Agent; model?: string; effort?: string },
  ): Promise<{ agent: Agent; model: string; effort: string }>
  ```

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/terminal-agent-defaults.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { terminalAgentDefaults, sessionAgentDefaults } from "../src/services/settings";
import { resetDb, makeSetting } from "./factory";

// SPEC-517 · terminal agen biasa boleh memilih runtime per sesi. Tanpa override ia HARUS
// identik dengan sessionAgentDefaults() — itulah jaminan "perilaku hari ini utuh".
beforeAll(async () => { await resetDb(); });
afterAll(async () => { await resetDb(); });

describe("terminalAgentDefaults", () => {
  it("tanpa override → identik dengan default global claude", async () => {
    await makeSetting({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
    expect(await terminalAgentDefaults({})).toEqual(await sessionAgentDefaults());
    expect(await terminalAgentDefaults({}))
      .toEqual({ agent: "claude", model: "claude-sonnet-5", effort: "medium" });
  });

  it("tanpa override → identik dengan default global codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await terminalAgentDefaults({}))
      .toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  // Inti SPEC-377: model WAJIB datang dari blok agen terpilih, bukan blok agen sebelumnya.
  it("override agen saja → model & effort dari blok agen ITU", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh",
      codex: { model: "gpt-5.6-terra", effort: "low" } });
    expect(await terminalAgentDefaults({ agent: "codex" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
  });

  it("override agen + model + effort dipakai apa adanya", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(await terminalAgentDefaults({ agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-sol", effort: "ultra" });
  });

  it("override model saja → agen tetap default global", async () => {
    await makeSetting({ agent: "claude", model: "claude-opus-5", effort: "xhigh" });
    expect(await terminalAgentDefaults({ model: "claude-haiku-4-5" }))
      .toEqual({ agent: "claude", model: "claude-haiku-4-5", effort: "xhigh" });
  });

  // SPEC-339 · Luna tak mendukung `ultra`. Koersi di sini supaya picker & argv tak berselisih.
  it("effort codex yang tak didukung model diturunkan ke fallback", async () => {
    await makeSetting({ agent: "claude" });
    expect(await terminalAgentDefaults({ agent: "codex", model: "gpt-5.6-luna", effort: "ultra" }))
      .toEqual({ agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });

  it("override claude tidak dikoersi katalog codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-sol", effort: "ultra" } });
    expect(await terminalAgentDefaults({ agent: "claude", model: "claude-fable-5", effort: "ultracode" }))
      .toEqual({ agent: "claude", model: "claude-fable-5", effort: "ultracode" });
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-agent-defaults.test.ts
```

Expected: FAIL — `terminalAgentDefaults` belum diekspor.

- [x] **Step 3: Implementasi**

Tambahkan di `server/src/services/settings.ts`, sesudah `conflictSessionDefaults`:

```ts
/**
 * SPEC-517 · default untuk TERMINAL AGEN BIASA (`POST /terminal/sessions {project}`), dengan
 * override per-request. Cermin `conflictSessionDefaults()`, tapi sumber overridenya request —
 * bukan blok Setting — karena pilihannya dibuat operator di form saat sesi dibuat.
 *
 * Aturan mengikat: `o.agent` yang terisi memilih BLOK Setting agen itu, bukan sekadar menukar
 * nama biner. Membaca `Setting.model` untuk sesi codex melahirkan `codex -m claude-opus-5` —
 * persis bug SPEC-377. Pemanggil WAJIB menurunkan `ensureCodexTrust` dari `agent` HASIL fungsi
 * ini, bukan dari `Setting.agent`: sejak SPEC-517 keduanya bisa berbeda di jalur ini.
 *
 * Effort codex dikoersi di sini (cermin `normalizeCodex`/`conflictSessionDefaults`) supaya
 * picker dan argv tak pernah berselisih; `createSession` tetap titik cekik terakhirnya.
 */
export async function terminalAgentDefaults(
  o: { agent?: Agent; model?: string; effort?: string },
): Promise<{ agent: Agent; model: string; effort: string }> {
  const s = await getSetting();
  const base = o.agent
    ? (o.agent === "codex"
      ? { agent: "codex" as const, model: s.codex.model, effort: s.codex.effort }
      : { agent: "claude" as const, model: s.model, effort: s.effort })
    : agentDefaultsOf(s);
  const model = o.model ?? base.model;
  const effort = o.effort ?? base.effort;
  return base.agent === "codex"
    ? { agent: "codex", model, effort: coerceCodexEffort(model, effort) }
    : { agent: "claude", model, effort };
}
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal-agent-defaults.test.ts
```

Expected: PASS (7 test).

- [x] **Step 5: Commit**

```bash
git add server/src/services/settings.ts server/test/terminal-agent-defaults.test.ts
git commit -m "feat(spec-517): terminalAgentDefaults untuk override runtime per sesi"
```

---

### Task 3: Route terminal memakai override

**Files:**
- Modify: `server/src/routes/terminal.ts:286-291` (dan import di baris 10)
- Test: `server/test/terminal.route.test.ts` (tambahkan describe baru di akhir berkas)

**Interfaces:**
- Consumes: `terminalAgentDefaults` dari Task 2; varian DTO dari Task 1.
- Produces: `POST /terminal/sessions {project, agent?, model?, effort?}` → 201 `{ id }` dengan pane ber-argv sesuai pilihan.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan di `server/test/terminal.route.test.ts` (di dalam `describe("terminal routes", …)`, dekat test argv yang sudah ada):

```ts
  // SPEC-517 · runtime dipilih saat sesi terminal dibuat. `/bin/echo` mencetak argv-nya ke pane,
  // jadi frame WS adalah bukti langsung argv yang benar-benar lahir.
  it("override model/effort claude ikut ke argv pane", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "claude", model: "claude-haiku-4-5", effort: "low" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("--model claude-haiku-4-5");
    expect(c.data()).toContain("--effort low");
    c.ws.close();
    killSession(id);
  });

  it("override agen codex memakai biner & bentuk flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "codex", model: "gpt-5.6-sol", effort: "high" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("-m gpt-5.6-sol");
    expect(c.data()).toContain("model_reasoning_effort");
    c.ws.close();
    killSession(id);
    delete process.env.HANOMAN_CODEX_BIN;
  });

  it("agen di luar katalog → 400, tak ada sesi yang lahir", async () => {
    const before = listSessions().length;
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "gemini" } });
    expect(res.statusCode).toBe(400);
    expect(listSessions().length).toBe(before);
  });

  // Gerbang `flow: z.undefined()` (Task 1) dilihat dari sisi route: body prd yang cacat harus
  // ditolak, bukan diam-diam membuka terminal biasa.
  it("flow prd tanpa brief → 400, bukan terminal biasa", async () => {
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", flow: "prd" } });
    expect(res.statusCode).toBe(400);
  });
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts
```

Expected: FAIL — argv memakai default global, dan body prd cacat menjawab 201.

- [x] **Step 3: Implementasi**

`server/src/routes/terminal.ts` baris 10 — tambahkan import:

```ts
import { sessionAgentDefaults, conflictSessionDefaults, terminalAgentDefaults } from "../services/settings";
```

Ganti blok baris 286-291:

```ts
    // SPEC-338 · ADR-0074 · terminal agen biasa ikut agen default global, termasuk model/effort-nya.
    // SPEC-517 · …kecuali bila operator memilihnya di form "Sesi baru": `agent`/`model`/`effort`
    // per-request menang, dan agen terpilih menentukan blok Setting mana yang dibaca.
    // `ensureCodexTrust` diturunkan dari agen HASIL resolusi — sejak sekarang ia bisa berbeda dari
    // `Setting.agent`, dan membaca yang salah membuat sesi mentok di layar trust codex (SPEC-377).
    const { agent, model, effort } = await terminalAgentDefaults(parsed.data);
    if (agent === "codex") ensureCodexTrust(repoDir);
    const s = createSession(project.id, repoDir, { agent, model, effort });
    return reply.code(201).send({ id: s.id });
```

> Catatan tipe: di titik ini TypeScript sudah menyempitkan `parsed.data` ke varian plain
> (varian `shell`, `reverse`, `prd`, `breakdown`, `scaffold`, dan `spec` semuanya sudah
> keluar lewat `return` di atas), jadi `parsed.data` memang punya `agent?`/`model?`/`effort?`.
> Bila `tsc` mengeluh, **jangan** meng-cast: pindahkan cabang `if ("shell" in parsed.data)`
> tetap di tempatnya dan pastikan cabang `flow` di atasnya memakai `return`, bukan `else`.

- [x] **Step 4: Jalankan test — harus lulus**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts server/test/terminal-agent-defaults.test.ts
```

Expected: PASS.

- [x] **Step 5: Typecheck paket server**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar tanpa error.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-517): POST /terminal/sessions menghormati runtime pilihan operator"
```

---

### Task 4: Helper murni katalog runtime di web

**Files:**
- Create: `src/src/screens/session-runtime.ts`
- Test: `src/test/session-runtime.test.ts` (create)
- Modify: `src/src/App.tsx` (`StartSessionModal`: `pickAgent`, `pickModel`, `models`, `efforts`)

**Interfaces:**
- Produces:
  ```ts
  export type RuntimeDefs = Record<Agent, { model: string; effort: string }>;
  export function runtimeModels(agent: Agent): readonly { id: string; label: string }[];
  export function runtimeEfforts(agent: Agent, model: string): readonly string[];
  export function runtimeFor(defs: RuntimeDefs, agent: Agent): { model: string; effort: string };
  ```

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/session-runtime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runtimeModels, runtimeEfforts, runtimeFor } from "../src/screens/session-runtime";

// SPEC-517 · satu definisi untuk dua picker (Start backlog & Sesi baru terminal). "Satu definisi,
// N call site" adalah kelas bug yang sudah dibayar hanoman di SPEC-431/448/475/481.
describe("session-runtime", () => {
  it("katalog model mengikuti agen", () => {
    expect(runtimeModels("claude").map((m) => m.id)).toContain("claude-opus-5");
    expect(runtimeModels("codex").map((m) => m.id)).toContain("gpt-5.6-luna");
    expect(runtimeModels("codex").map((m) => m.id)).not.toContain("claude-opus-5");
  });

  it("effort claude tak bergantung model", () => {
    expect(runtimeEfforts("claude", "claude-opus-5")).toContain("ultracode");
  });

  it("effort codex menyempit per model — Luna tanpa ultra", () => {
    expect(runtimeEfforts("codex", "gpt-5.6-sol")).toEqual(
      ["ultra", "max", "xhigh", "high", "medium", "low"]);
    expect(runtimeEfforts("codex", "gpt-5.6-luna")).toEqual(
      ["max", "xhigh", "high", "medium", "low"]);
  });

  it("runtimeFor mengambil blok agen terpilih", () => {
    const defs = {
      claude: { model: "claude-opus-5", effort: "xhigh" },
      codex: { model: "gpt-5.6-terra", effort: "low" },
    } as const;
    expect(runtimeFor(defs, "claude")).toEqual({ model: "claude-opus-5", effort: "xhigh" });
    expect(runtimeFor(defs, "codex")).toEqual({ model: "gpt-5.6-terra", effort: "low" });
  });

  it("runtimeFor mengoreksi effort codex yang tak didukung modelnya", () => {
    const defs = {
      claude: { model: "claude-opus-5", effort: "xhigh" },
      codex: { model: "gpt-5.6-luna", effort: "ultra" },
    } as const;
    expect(runtimeFor(defs, "codex")).toEqual({ model: "gpt-5.6-luna", effort: "xhigh" });
  });
});
```

- [x] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV pnpm vitest --run src/test/session-runtime.test.ts
```

Expected: FAIL — modul `../src/screens/session-runtime` belum ada.

- [x] **Step 3: Implementasi helper**

Buat `src/src/screens/session-runtime.ts`:

```ts
import {
  MODELS, EFFORTS, CODEX_MODELS, codexEfforts, coerceCodexEffort, type Agent,
} from "@hanoman/shared";

/** Default per agen sebagaimana dibaca dari `GET /settings` (blok claude & blok codex). */
export type RuntimeDefs = Record<Agent, { model: string; effort: string }>;

/**
 * SPEC-517 · aturan katalog runtime dipakai DUA picker: "Mulai sesi" backlog (ADR-0061) dan
 * "Sesi baru" terminal. Ia hidup di satu berkas supaya keduanya tak bisa berselisih pendapat —
 * pola yang sama dengan `codexClientTooOld` yang menyatukan Settings & picker Start (SPEC-339).
 */
export function runtimeModels(agent: Agent): readonly { id: string; label: string }[] {
  return agent === "codex" ? CODEX_MODELS : MODELS;
}

/** SPEC-339 · effort adalah properti MODEL untuk codex; untuk claude ia properti CLI. */
export function runtimeEfforts(agent: Agent, model: string): readonly string[] {
  return agent === "codex" ? codexEfforts(model) : EFFORTS;
}

/**
 * Model & effort default untuk `agent`, diambil dari blok agen ITU. Menukar agen tanpa menukar
 * model melahirkan `codex -m claude-opus-5` — bug SPEC-377. Effort codex dikoreksi sekarang juga
 * supaya perubahannya TERLIHAT di picker, bukan terjadi diam-diam saat sesi lahir.
 */
export function runtimeFor(defs: RuntimeDefs, agent: Agent): { model: string; effort: string } {
  const d = defs[agent];
  return {
    model: d.model,
    effort: agent === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort,
  };
}
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
env -u NODE_ENV pnpm vitest --run src/test/session-runtime.test.ts
```

Expected: PASS (5 test).

- [x] **Step 5: Pakai helper di `StartSessionModal` (perilaku identik)**

Di `src/src/App.tsx`, tambahkan import:

```ts
import { runtimeModels, runtimeEfforts, runtimeFor } from "./screens/session-runtime";
```

lalu ganti empat potongan di `StartSessionModal`:

```ts
  const pickAgent = (a: Agent) => {
    setAgent(a);
    // SPEC-517 · aturan "blok agen terpilih + koersi effort codex" hidup di session-runtime.ts,
    // dipakai bersama picker "Sesi baru" di Terminal.
    const r = runtimeFor(defs, a);
    setModel(r.model);
    setEffort(r.effort);
  };
  // SPEC-339 · menukar model bisa membuat effort terpilih jadi tak sah (Luna tak punya `ultra`).
  // Turunkan SEKARANG supaya perubahannya terlihat di picker, bukan diam-diam saat sesi lahir.
  const pickModel = (id: string) => {
    setModel(id);
    if (agent === "codex") setEffort((e) => coerceCodexEffort(id, e));
  };
  const models = runtimeModels(agent);
  // SPEC-339 · effort adalah properti MODEL untuk codex — daftarnya menyempit mengikuti pilihan.
  const efforts = runtimeEfforts(agent, model);
```

Hapus import `MODELS`, `EFFORTS`, `CODEX_MODELS`, `codexEfforts` dari `App.tsx` **hanya bila**
tak ada pemakai lain di berkas itu (`rtk proxy grep -n "MODELS\|EFFORTS\|codexEfforts" src/src/App.tsx`).
`coerceCodexEffort` tetap dipakai `pickModel`.

- [x] **Step 6: Test StartSessionModal tak berubah perilaku**

```bash
env -u NODE_ENV pnpm vitest --run src/test/start-session-agent.test.tsx src/test/start-session-model.test.tsx
```

Expected: PASS — semuanya, tanpa satu pun test diubah. Kalau ada yang merah, refactor-nya tidak
setara; kembalikan dan perbaiki, jangan menyunting testnya.

- [x] **Step 7: Commit**

```bash
git add src/src/screens/session-runtime.ts src/test/session-runtime.test.ts src/src/App.tsx
git commit -m "refactor(spec-517): satu definisi katalog runtime untuk kedua picker"
```

---

### Task 5: `createTerminal(project, opts?)` di klien API

**Files:**
- Modify: `src/src/api/client.ts:262`
- Test: `src/test/api-client.test.ts` (tambahkan satu `it`)

**Interfaces:**
- Produces:
  ```ts
  createTerminal(project: string, opts?: { agent?: Agent; model?: string; effort?: string }): Promise<{ id: string }>
  ```
  `opts` absen ⇒ body persis `{ project }` seperti sebelum SPEC-517.

- [x] **Step 1: Tulis test yang gagal**

Buka `src/test/api-client.test.ts`, lihat pola mock `fetch` yang sudah dipakai di sana, lalu
tambahkan di dalam `describe` utamanya:

```ts
  // SPEC-517 · runtime opsional. Tanpa opts body HARUS tetap {project} — pemanggil lama
  // (restart riwayat, test lama) tak boleh berubah artinya.
  it("createTerminal tanpa opts mengirim body {project} apa adanya", async () => {
    await api.createTerminal("p1");
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ project: "p1" });
  });

  it("createTerminal meneruskan agent/model/effort saat diberikan", async () => {
    await api.createTerminal("p1", { agent: "codex", model: "gpt-5.6-sol", effort: "high" });
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect(JSON.parse(String((init as RequestInit).body)))
      .toEqual({ project: "p1", agent: "codex", model: "gpt-5.6-sol", effort: "high" });
  });
```

> Sesuaikan nama variabel mock (`fetchMock`) dengan yang sudah dipakai berkas itu — jangan
> membuat mock kedua.

- [x] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV pnpm vitest --run src/test/api-client.test.ts
```

Expected: FAIL pada test kedua — `opts` diabaikan.

- [x] **Step 3: Implementasi**

`src/src/api/client.ts`:

```ts
  // SPEC-517 · runtime PER SESI untuk terminal agen biasa (opsional; kosong → default global di
  // server). Tanpa `opts`, body byte-identik dengan sebelum SPEC-517.
  createTerminal: (project: string, opts?: { agent?: Agent; model?: string; effort?: string }) =>
    j<{ id: string }>(paths.terminalSessions, { method: "POST", ...body({ project, ...(opts ?? {}) }) }),
```

- [x] **Step 4: Jalankan test — harus lulus**

```bash
env -u NODE_ENV pnpm vitest --run src/test/api-client.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts src/test/api-client.test.ts
git commit -m "feat(spec-517): createTerminal menerima runtime opsional"
```

---

### Task 6: `NewTerminalModal` + tombol “Sesi baru” membukanya

**Files:**
- Create: `src/src/screens/NewTerminalModal.tsx`
- Modify: `src/src/screens/TerminalScreen.tsx` (`openNew`, tombol “Sesi baru”, state modal)
- Test: `src/test/new-terminal-runtime.test.tsx` (create)
- Modify: `src/test/terminal-screen.test.tsx:116-123` (test lama mengencode klik-langsung)

**Interfaces:**
- Consumes: `runtimeModels`/`runtimeEfforts`/`runtimeFor` (Task 4), `api.createTerminal(project, opts)` (Task 5), `api.getSettings`, `api.getCodexVersion`, `codexClientTooOld`/`codexModel` (`@hanoman/shared`).
- Produces:
  ```tsx
  export function NewTerminalModal({ open, projectId, projectName, onClose, onCreated }: {
    open: boolean; projectId: string; projectName: string;
    onClose: () => void; onCreated: (id: string) => void;
  }): JSX.Element | null
  ```

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/new-terminal-runtime.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const listTerminals = vi.fn();
const createTerminal = vi.fn();
const getSettings = vi.fn();
const getCodexVersion = vi.fn();
vi.mock("../src/api/client", () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } },
  api: {
    listTerminals: (...a: unknown[]) => listTerminals(...a),
    createTerminal: (...a: unknown[]) => createTerminal(...a),
    createShell: vi.fn(async () => ({ id: "sh1" })),
    deleteTerminal: vi.fn(async () => {}),
    listSpecs: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 0 })),
    getSettings: (...a: unknown[]) => getSettings(...a),
    getCodexVersion: (...a: unknown[]) => getCodexVersion(...a),
  },
}));
vi.mock("../src/api/events", () => ({ subscribe: () => () => {} }));
vi.mock("../src/screens/TerminalPane", () => ({
  TerminalPane: ({ sessionId }: { sessionId: string }) => <div data-testid="pane">{sessionId}</div>,
}));

import { TerminalScreen } from "../src/screens/TerminalScreen";

const projects = [{ id: "p1", name: "hanoman" }];
const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", agent: "claude",
  codex: { model: "gpt-5.6-sol", effort: "xhigh" }, ...over,
});

beforeEach(() => {
  localStorage.clear();
  [listTerminals, createTerminal, getSettings, getCodexVersion].forEach((m) => m.mockReset());
  listTerminals.mockResolvedValue([]);
  createTerminal.mockResolvedValue({ id: "term1" });
  getSettings.mockResolvedValue(settings());
  getCodexVersion.mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true });
});

// SPEC-517 · "Sesi baru" tak lagi langsung men-spawn: operator memilih runtime dulu.
describe("Sesi baru · pemilih runtime (SPEC-517)", () => {
  it("membuka form, bukan langsung membuat sesi", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    expect(await screen.findByLabelText("Agen")).toBeInTheDocument();
    expect(createTerminal).not.toHaveBeenCalled();
  });

  it("prefill dari setelan global", async () => {
    getSettings.mockResolvedValue(settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "low" } }));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("codex"));
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-terra");
    expect(screen.getByLabelText("Effort")).toHaveValue("low");
  });

  it("menukar agen menukar katalog model & effort", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    const opts = [...screen.getByLabelText("Model").querySelectorAll("option")].map((o) => o.value);
    expect(opts).toContain("gpt-5.6-luna");
    expect(opts).not.toContain("claude-opus-5");
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(
      [...screen.getByLabelText("Effort").querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["max", "xhigh", "high", "medium", "low"]));
  });

  it("mengirim pilihan ke createTerminal dan menaruh sesinya di grid", async () => {
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("claude-opus-5"));
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("gpt-5.6-sol"));
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledWith(
      "p1", { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("term1"));
  });

  it("CLI codex terlalu tua → catatan lunak, tombol tetap hidup", async () => {
    getCodexVersion.mockResolvedValue({ version: "0.142.5", minRequired: "0.144.0", ok: false });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
    expect(screen.queryByTestId("codex-version-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("Agen"), { target: { value: "codex" } });
    expect(await screen.findByTestId("codex-version-note")).toHaveTextContent("0.142.5");
    expect(screen.getByRole("button", { name: "Buka sesi" })).toBeEnabled();
  });

  it("GET /settings gagal → form tetap bisa dipakai dengan default bawaan", async () => {
    getSettings.mockRejectedValue(new Error("boom"));
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    await waitFor(() => expect(screen.getByLabelText("Agen")).toHaveValue("claude"));
    fireEvent.click(screen.getByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(createTerminal).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV pnpm vitest --run src/test/new-terminal-runtime.test.tsx
```

Expected: FAIL — tak ada `Agen` di layar; `createTerminal` terpanggil langsung.

- [ ] **Step 3: Buat modal**

Buat `src/src/screens/NewTerminalModal.tsx`:

```tsx
import React from "react";
import { Modal, Button, Select, Field } from "../ds";
import { api } from "../api/client";
import { codexClientTooOld, codexModel, coerceCodexEffort, CODEX_DEFAULTS, type Agent } from "@hanoman/shared";
import { runtimeModels, runtimeEfforts, runtimeFor, type RuntimeDefs } from "./session-runtime";

/**
 * SPEC-517 · form "Sesi baru" di halaman Terminal. Sampai sekarang tombol itu men-spawn agen
 * dengan default global apa adanya — operator yang ingin satu sesi codex harus menukar Settings
 * untuk SELURUH workspace lalu mengembalikannya. Bentuknya sengaja cermin `StartSessionModal`
 * (ADR-0061): agen menentukan katalog model, model menentukan katalog effort (SPEC-339).
 * Katalognya datang dari `@hanoman/shared` lewat `session-runtime.ts` — tak ada daftar model
 * kedua yang bisa basi.
 */
export function NewTerminalModal({ open, projectId, projectName, onClose, onCreated }: {
  open: boolean; projectId: string; projectName: string;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const [agent, setAgent] = React.useState<Agent>("claude");
  const [model, setModel] = React.useState("claude-opus-5");
  const [effort, setEffort] = React.useState("xhigh");
  const [defs, setDefs] = React.useState<RuntimeDefs>({
    claude: { model: "claude-opus-5", effort: "xhigh" },
    codex: { ...CODEX_DEFAULTS },
  });
  const [busy, setBusy] = React.useState(false);
  const [codexVer, setCodexVer] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    // Gagal-diam (cermin StartSessionModal): form harus tetap bisa dipakai dengan default bawaan
    // walau settings tak terbaca — memblokir "Sesi baru" karena satu GET jauh lebih buruk.
    api.getSettings().then((s) => {
      const d: RuntimeDefs = {
        claude: { model: s.model, effort: s.effort },
        codex: { ...CODEX_DEFAULTS, ...(s.codex ?? {}) },
      };
      const a: Agent = s.agent === "codex" ? "codex" : "claude";
      const r = runtimeFor(d, a);
      setDefs(d); setAgent(a); setModel(r.model); setEffort(r.effort);
    }).catch(() => {});
    api.getCodexVersion().then((v) => setCodexVer(v.version)).catch(() => {});
  }, [open]);

  const pickAgent = (a: Agent) => {
    setAgent(a);
    const r = runtimeFor(defs, a);
    setModel(r.model); setEffort(r.effort);
  };
  const pickModel = (id: string) => {
    setModel(id);
    if (agent === "codex") setEffort((e) => coerceCodexEffort(id, e));
  };

  async function create() {
    setBusy(true);
    try {
      const { id } = await api.createTerminal(projectId, { agent, model, effort });
      onCreated(id);
      onClose();
    } catch {
      // Pesan galatnya sudah muncul di jalur pembuatan sesi biasa; jangan menduplikasi di sini.
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} icon="plus" eyebrow={projectName} title="Sesi baru"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Batal</Button>
        <Button leftIcon="play" disabled={busy} onClick={() => void create()}>Buka sesi</Button>
      </>}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Runtime untuk sesi ini. Default dari setelan global; ubah bila perlu. Sesi lahir dengan
        pilihan ini untuk seluruh hidupnya — <code>/model</code> di terminal tetap bisa mengubahnya.
      </div>
      <Field label="Agen" hint="Mesin yang menjalankan sesi ini. Perilaku sesi sama; hanya CLI-nya berbeda.">
        <Select aria-label="Agen" value={agent} style={{ width: "100%" }}
          options={[{ value: "claude", label: "Claude Code" }, { value: "codex", label: "Codex CLI" }]}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickAgent(e.target.value as Agent)} />
      </Field>
      <Field label="Model">
        <Select aria-label="Model" value={model} style={{ width: "100%" }}
          options={runtimeModels(agent).map((m) => ({ value: m.id, label: m.label }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => pickModel(e.target.value)} />
      </Field>
      <Field label="Effort">
        <Select aria-label="Effort" value={effort} style={{ width: "100%" }}
          options={runtimeEfforts(agent, model).map((v) => ({ value: v, label: v }))}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setEffort(e.target.value)} />
      </Field>
      {/* SPEC-339 · catatan LUNAK: CLI terlalu tua untuk model terpilih. Tak memblokir. */}
      {agent === "codex" && codexClientTooOld(model, codexVer) && (
        <div data-testid="codex-version-note" style={{
          fontSize: 12, lineHeight: 1.5, marginBottom: 12, padding: "8px 10px",
          borderRadius: 8, background: "var(--warn-bg, #fdf6e3)", color: "var(--text-muted)",
        }}>
          Codex CLI terpasang <b>{codexVer}</b>, sedangkan <b>{model}</b> butuh <b>{codexModel(model)?.minClient}</b>.
          Sesi tetap boleh dijalankan, tapi modelnya belum tentu dikenali CLI ini.
        </div>
      )}
    </Modal>
  );
}
```

> Sebelum menulis, konfirmasi bahwa `Field` memang diekspor dari `../ds`
> (`rtk proxy grep -n "export function Field" src/src/ds/kit.tsx` → ada di baris 100) dan bahwa
> `ds/index` me-re-export-nya; kalau tidak, impor dari `../ds/kit`.

- [ ] **Step 4: Sambungkan ke TerminalScreen**

Di `src/src/screens/TerminalScreen.tsx`:

```tsx
import { NewTerminalModal } from "./NewTerminalModal";
```

Tambahkan state di samping `picking`:

```tsx
  // SPEC-517 · form runtime sebelum sesi agen biasa lahir. Modal, bukan panel: grid di
  // belakangnya tak berubah ukuran — pola yang sama dengan "Ambil backlog" & "Riwayat".
  const [newOpen, setNewOpen] = React.useState(false);
```

Ganti `openNew` menjadi penerima id hasil modal:

```tsx
  // SPEC-517 · sesi lahir di dalam modal (ia yang memegang pilihan runtime); di sini tinggal
  // menaruhnya di grid — persis seperti jalur lama sesudah createTerminal.
  function placeNew(id: string) {
    setSessions((s) => (s.some((x) => x.id === id) ? s : [...s, { id, projectId: project, cwd: "", exited: false }]));
    setWs((w) => W.placeFirstEmptyInActive(w, id));
  }
```

Tombolnya:

```tsx
          <Button size="sm" leftIcon="plus" onClick={() => setNewOpen(true)}>Sesi baru</Button>
```

Render modalnya di samping `BacklogPicker`:

```tsx
      {newOpen && (
        <NewTerminalModal open projectId={project} projectName={nameOf(project)}
          onClose={() => setNewOpen(false)} onCreated={placeNew} />
      )}
```

- [ ] **Step 5: Jalankan test baru — harus lulus**

```bash
env -u NODE_ENV pnpm vitest --run src/test/new-terminal-runtime.test.tsx
```

Expected: PASS (6 test).

- [ ] **Step 6: Perbaiki test lama yang mengencode klik-langsung**

`src/test/terminal-screen.test.tsx` — tambahkan dua mock ke objek `api` di `vi.mock` (baris 37-45):

```ts
    getSettings: (...a: unknown[]) => getSettings(...a),
    getCodexVersion: (...a: unknown[]) => getCodexVersion(...a),
```

dengan deklarasi di dekat `const createTerminal = vi.fn();`:

```ts
const getSettings = vi.fn();
const getCodexVersion = vi.fn();
```

dan default di `beforeEach`:

```ts
  getSettings.mockReset(); getCodexVersion.mockReset();
  getSettings.mockResolvedValue({ model: "claude-opus-5", effort: "xhigh", agent: "claude",
    codex: { model: "gpt-5.6-sol", effort: "xhigh" } });
  getCodexVersion.mockResolvedValue({ version: "0.145.0", minRequired: "0.144.0", ok: true });
```

lalu perbarui test baris 116:

```ts
  // SPEC-517 · "Sesi baru" membuka form runtime dulu; sesinya lahir saat "Buka sesi" ditekan.
  it("Sesi baru menaruh sesi di sel kosong pertama", async () => {
    listTerminals.mockResolvedValue([]);
    createTerminal.mockResolvedValue({ id: "newsesi1" });
    render(<TerminalScreen projects={projects} />);
    await screen.findByText("Belum ada sesi terminal");
    fireEvent.click(screen.getByRole("button", { name: "Sesi baru" }));
    fireEvent.click(await screen.findByRole("button", { name: "Buka sesi" }));
    await waitFor(() => expect(screen.getByTestId("pane")).toHaveTextContent("newsesi1"));
  });
```

- [ ] **Step 7: Jalankan seluruh test layar Terminal**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-screen.test.tsx src/test/new-terminal-runtime.test.tsx src/test/terminal-history-button.test.tsx
```

Expected: PASS semua.

- [ ] **Step 8: Commit**

```bash
git add src/src/screens/NewTerminalModal.tsx src/src/screens/TerminalScreen.tsx \
        src/test/new-terminal-runtime.test.tsx src/test/terminal-screen.test.tsx
git commit -m "feat(spec-517): form pemilih runtime saat membuat sesi terminal baru"
```

---

### Task 7: “Mulai lagi” riwayat terminal membawa runtime baris itu

**Files:**
- Modify: `src/src/screens/TerminalScreen.tsx` (`restartFromHistory`)
- Test: `src/test/terminal-history-button.test.tsx` (tambahkan satu `it`)

**Interfaces:**
- Consumes: `SessionHistoryView` (`agent: string`, `model: string | null`, `effort: string | null`) — kolomnya sudah ada sejak ADR-0079.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/test/terminal-history-button.test.tsx`:

```tsx
  // SPEC-517 · "Mulai lagi" = sesi BARU dengan konteks yang sama. Sejak runtime bisa dipilih,
  // "konteks yang sama" termasuk agen/model/effort yang tercatat di baris riwayat itu.
  it("Mulai lagi terminal agen membawa runtime baris riwayatnya", async () => {
    listSessionHistory.mockResolvedValue({
      items: [row({ kind: "terminal", specId: null, title: null, flow: null,
        agent: "codex", model: "gpt-5.6-terra", effort: "low" })],
      total: 1, page: 1, pageSize: 20 });
    render(<TerminalScreen projects={projects} backlog={[]} />);
    fireEvent.click(await screen.findByText("Riwayat"));
    await waitFor(() => expect(screen.getAllByText("hanoman").some((el) => el.closest("button"))).toBe(true));
    fireEvent.click(screen.getAllByText("hanoman").find((el) => el.closest("button"))!);
    fireEvent.click(await screen.findByText("Mulai lagi"));
    await waitFor(() => expect(createTerminal).toHaveBeenCalledWith(
      "p1", { agent: "codex", model: "gpt-5.6-terra", effort: "low" }));
  });
```

- [ ] **Step 2: Jalankan test — harus gagal**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-history-button.test.tsx
```

Expected: FAIL — `createTerminal` dipanggil dengan `"p1"` saja.

- [ ] **Step 3: Implementasi**

Di `restartFromHistory` (`TerminalScreen.tsx`), ganti cabang `r.kind === "terminal"`:

```tsx
          : r.kind === "terminal"
            // SPEC-517 · runtime baris riwayat ikut, bukan default global: "Mulai lagi" berjanji
            // konteks yang sama, dan sejak runtime bisa dipilih ia bagian dari konteks itu.
            // `agent` kolomnya `String` (bukan enum) — nilai asing jatuh ke claude, seperti
            // pembacaan @hanoman_agent di pty.ts.
            ? await api.createTerminal(r.projectId, {
                agent: r.agent === "codex" ? "codex" : "claude",
                ...(r.model ? { model: r.model } : {}),
                ...(r.effort ? { effort: r.effort } : {}),
              })
            : await api.createTerminalFlow(r.projectId, r.kind as Flow)
```

- [ ] **Step 4: Jalankan test — harus lulus**

```bash
env -u NODE_ENV pnpm vitest --run src/test/terminal-history-button.test.tsx
```

Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/TerminalScreen.tsx src/test/terminal-history-button.test.tsx
git commit -m "feat(spec-517): Mulai lagi terminal memakai runtime baris riwayatnya"
```

---

### Task 8: Docs Source of Truth

**Files:**
- Modify: `internal/docs/architecture/api-contract.md:557-594`
- Modify: `internal/skills/hanoman/SKILL.md` (butir ADR-0074, cari `terminal-agen`)
- Modify: `internal/docs/frontend/frontend-implementation.md:169-172`

- [ ] **Step 1: `api-contract.md` — varian request**

Sesudah baris `POST   /terminal/sessions  {project, flow?} …` dan blok `{project, shell:true}`,
tambahkan:

```
#   {project, agent?, model?, effort?} (SPEC-517): TERMINAL AGEN BIASA dengan runtime PER SESI —
#     form "Sesi baru" di halaman Terminal. Kosong → default global (Setting), jadi body {project}
#     polos berperilaku persis seperti sebelum SPEC-517. `agent` memilih BLOK Setting yang dibaca
#     (claude → model/effort, codex → codex.model/codex.effort), bukan sekadar menukar biner —
#     membaca blok yang salah melahirkan `codex -m claude-opus-5` (SPEC-377). Effort codex
#     dikoersi ke katalog modelnya (SPEC-339). `ensureCodexTrust` diturunkan dari agen HASIL
#     resolusi, bukan Setting.agent. agent di luar claude|codex → 400.
#     Varian ini dijaga `flow: z.undefined()` di zod: ia permisif dan duduk sesudah semua varian
#     ber-flow, jadi tanpa gerbang itu body flow yang CACAT (mis. {project, flow:"prd"} tanpa
#     brief) akan lolos ke sini dan membuka terminal biasa secara SENYAP alih-alih dijawab 400.
```

- [ ] **Step 2: `api-contract.md` — amandemen klausa “tak punya override”**

Baris 594 berbunyi:

```
#       Sesi project-level (reverse/prd/scaffold/breakdown/terminal/konflik) TAK punya override — ikut Setting.agent.
```

ganti menjadi:

```
#       Sesi project-level (reverse/prd/scaffold/breakdown) & sesi konflik TAK punya override — ikut
#       Setting.agent (konflik: blok Setting.conflict bila dinyalakan, ADR-0081). Terminal agen biasa
#       DIKECUALIKAN sejak SPEC-517: ia punya form pemilih runtime sendiri (lihat varian di atas).
```

- [ ] **Step 3: `SKILL.md` — butir ADR-0074**

Cari kalimat `Setting.agent` = default global untuk SEMUA sesi yang men-spawn agen (…, terminal-agen, …)`
dan sesuaikan:

```
- **Dua agen** (SPEC-338/ADR-0074): `Agent = "claude" | "codex"`. `Setting.agent` = default global
  untuk SEMUA sesi yang men-spawn agen (backlog, reverse, prd, scaffold, breakdown, terminal-agen,
  konflik-integrasi); **dua** pintu bisa meng-override per sesi: sesi backlog lewat `agent` di
  `POST /terminal/sessions` (picker Start, ADR-0061) dan — sejak **SPEC-517** — terminal agen biasa
  lewat form "Sesi baru" (`{project, agent?, model?, effort?}`, resolusi di `terminalAgentDefaults()`,
  aturan katalog UI di `src/src/screens/session-runtime.ts` yang dipakai KEDUA picker). Sisanya
  (reverse/prd/scaffold/breakdown, konflik) tetap mengikuti Setting.
```

> Sunting kalimatnya di tempat — jangan menambah butir baru; butir ADR-0074 sudah panjang dan
> index ini dibaca setiap sesi agen (SPEC-386).

- [ ] **Step 4: `frontend-implementation.md`**

Sesudah paragraf “Terminal biasa” (baris 169-172), tambahkan:

```markdown
**Sesi baru** (SPEC-517) tak lagi men-spawn seketika: ia membuka `NewTerminalModal` — Agen ·
Model · Effort, prefill dari `GET /settings`, katalog dari `@hanoman/shared` lewat
`screens/session-runtime.ts` (`runtimeModels`/`runtimeEfforts`/`runtimeFor`), berkas yang sama
yang dipakai picker Start backlog supaya keduanya tak bisa berselisih pendapat. Pilihannya
dikirim sebagai `POST {project, agent?, model?, effort?}` dan jadi argv pane tmux; tanpa
mengubah apa pun, body-nya `{project}` polos dan perilakunya persis seperti sebelumnya.
Catatan versi codex (`codexClientTooOld`) muncul di sini juga, dan **tak** memblokir tombolnya.
"Mulai lagi" pada baris riwayat ber-`kind: "terminal"` mengirim runtime baris itu.
```

- [ ] **Step 5: Commit**

```bash
git add internal/docs/architecture/api-contract.md internal/skills/hanoman/SKILL.md \
        internal/docs/frontend/frontend-implementation.md
git commit -m "docs(spec-517): runtime per sesi terminal di api-contract, SKILL, frontend"
```

---

### Task 9: Verifikasi akhir (scope: hanya yang berubah)

- [ ] **Step 1: Test yang tersentuh — shared + server**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  shared/src/terminal-session-runtime.test.ts shared/src/agent-session.test.ts \
  server/test/terminal-agent-defaults.test.ts server/test/terminal.route.test.ts \
  server/test/conflict-session-defaults.test.ts server/test/settings.test.ts
```

Expected: PASS. **Pastikan jumlah test > 0** — `--changed` menyalakan `passWithNoTests`, jadi
“no test files” TERLIHAT hijau; di sini path-nya disebut eksplisit, jadi nol berkas = salah ketik.

- [ ] **Step 2: Test yang tersentuh — web**

```bash
env -u NODE_ENV pnpm vitest --run \
  src/test/session-runtime.test.ts src/test/new-terminal-runtime.test.tsx \
  src/test/terminal-screen.test.tsx src/test/terminal-history-button.test.tsx \
  src/test/start-session-agent.test.tsx src/test/start-session-model.test.tsx \
  src/test/start-session-goal.test.tsx src/test/start-session-verify-scope.test.tsx \
  src/test/api-client.test.ts src/test/placeholder-contract.test.ts
```

Expected: PASS. `placeholder-contract.test.ts` ikut karena SPEC-490 menegakkan aturan placeholder
pada berkas sumber — modal baru punya `<Select>`, jadi jalankan untuk memastikan ia tak melanggar.

- [ ] **Step 3: Typecheck paket yang tersentuh saja**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: bersih. **Jangan** `pnpm -r typecheck` — mesin ini menjalankan beberapa sesi sekaligus.

- [ ] **Step 4: Smoke endpoint sungguhan (sekali, di akhir)**

Task ini menyentuh endpoint, jadi wajib diuji nyata — dengan DB khusus, bukan DB test bersama:

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server build 2>/dev/null || true
# jalankan server dev di latar (catat PID-nya, JANGAN pkill):
pnpm dev &
echo $! > /tmp/spec517-dev.pid
```

Sesudah server siap (`curl -s localhost:8787/api/health`), uji tiga hal:

```bash
# 1. body polos tetap 201 (default global)
curl -s -X POST localhost:8787/api/terminal/sessions \
  -H 'content-type: application/json' -d '{"project":"<id-project>"}' -w '\n%{http_code}\n'
# 2. override runtime → 201, lalu cek argv panenya
curl -s -X POST localhost:8787/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"project":"<id-project>","agent":"codex","model":"gpt-5.6-sol","effort":"high"}' -w '\n%{http_code}\n'
tmux -L hanoman list-panes -a -F '#{session_name} #{pane_start_command}' | grep codex
# 3. agen asing → 400
curl -s -X POST localhost:8787/api/terminal/sessions -H 'content-type: application/json' \
  -d '{"project":"<id-project>","agent":"gemini"}' -w '\n%{http_code}\n'
```

Bereskan sesudahnya — **per-PID**, jangan `pkill -f`:

```bash
kill "$(cat /tmp/spec517-dev.pid)"
tmux -L hanoman kill-session -t <nama-sesi-yang-dibuat>   # hanya sesi yang lahir dari smoke ini
```

- [ ] **Step 5: Centang seluruh kotak plan ini & commit**

```bash
git add docs/superpowers/plans/2026-08-04-spec-517-runtime-picker-sesi-terminal.md
git commit -m "docs(spec-517): centang plan"
```

- [ ] **Step 6: Push**

```bash
git push origin HEAD:refs/heads/hanoman/spec-517
```

---

## Self-Review

**Spec coverage:** AC-1/2/3/4 → Task 6 (+ helper Task 4). AC-5/6/7/8 → Task 1-3. AC-9 → Task 7.
AC-10 → Task 1 (varian `reverse` terpisah, tanpa field override) + Task 3 (cabang lain tak disentuh).
Dokumen tersentuh → Task 8. Verifikasi → Task 9.

**Placeholder scan:** tak ada TBD/TODO; setiap step yang mengubah kode memuat kodenya. Dua tempat
menyuruh implementer **memeriksa** dulu (nama mock `fetch` di `api-client.test.ts`, re-export
`Field` dari `../ds`) — keduanya disertai perintah pemeriksaannya, bukan tebakan.

**Type consistency:** `terminalAgentDefaults(o)` dipakai dengan bentuk yang sama di Task 2 & 3.
`runtimeModels`/`runtimeEfforts`/`runtimeFor`/`RuntimeDefs` konsisten antara Task 4, 6.
`createTerminal(project, opts?)` konsisten antara Task 5, 6, 7. `NewTerminalModal` props
(`open`/`projectId`/`projectName`/`onClose`/`onCreated`) sama di Task 6 definisi & call site.
