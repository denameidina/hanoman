import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

// ADR-0190 · ADR-0191 · ADR-0192 · bentuk request tool dialog sesi & cron. Gerbang yang MENAHAN
// ada di server (server/test/decision-gate.test.ts, scheduler-cron-gate.test.ts); berkas ini
// menjaga sisi katalog: ke route mana tiap tool bicara, apa yang TAK bisa dikirim, dan bahwa
// semuanya tersembunyi di tingkat default.
const tool = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("dialog sesi", () => {
  it("get/answer/takeover memetakan ke route dialog, semuanya danger & tersembunyi di tingkat default", () => {
    expect(tool("hanoman_session_dialog_get").build({ session: "s 1" }))
      .toEqual({ method: "GET", path: "/terminal/sessions/s%201/dialog" });
    expect(tool("hanoman_session_dialog_takeover").build({ session: "s1" }))
      .toEqual({ method: "POST", path: "/terminal/sessions/s1/dialog/takeover" });
    const visible = new Set(mcpToolsFor("default").map((t) => t.name));
    for (const n of ["hanoman_session_dialog_get", "hanoman_session_dialog_answer", "hanoman_session_dialog_takeover"]) {
      expect(tool(n).mode, n).toBe("danger");
      expect(visible.has(n), n).toBe(false);
      expect(tool(n).description, n).toContain("sessions:decide");
    }
  });

  it("answer hanya mengirim field yang diisi; screenHash wajib; choices kosong tetap terkirim", () => {
    const t = tool("hanoman_session_dialog_answer");
    expect(t.inputSchema.required).toEqual(["session", "screenHash"]);
    expect(t.build({ session: "s1", screenHash: "h", choice: 2 })?.body).toEqual({ screenHash: "h", choice: 2 });
    expect(t.build({ session: "s1", screenHash: "h", choices: [] })?.body).toEqual({ screenHash: "h", choices: [] });
    expect(t.build({ session: "s1", screenHash: "h", text: "prosa" })?.body).toEqual({ screenHash: "h", text: "prosa" });
  });

  it("dialog_get: 204 (body null) dibaca sebagai 'tak ada dialog', bukan galat", () => {
    expect(tool("hanoman_session_dialog_get").shape(null, {})).toMatchObject({ dialog: null });
    expect(tool("hanoman_session_dialog_get").shape({ dialog: { title: "x" }, screenHash: "h" }, {}))
      .toMatchObject({ screenHash: "h" });
  });

  it("steer menyebut bahwa dialog di layar menuntut sessions:decide (bukan klaim lama 'tak bisa menjawab dialog')", () => {
    const d = tool("hanoman_session_steer").description;
    expect(d).toContain("sessions:decide");
    expect(d).not.toContain("sengaja hanya bisa dijawab manusia");
  });
});

describe("cron", () => {
  it("create hanya mengirim yang diisi & tak pernah memaksa enabled (default server = nonaktif)", () => {
    const t = tool("hanoman_scheduler_cron_create");
    expect(t.build({ project: "p1", name: "n", expr: "0 7 * * *", prompt: "p" })?.body)
      .toEqual({ project: "p1", name: "n", expr: "0 7 * * *", prompt: "p" });
    expect(t.build({ project: "p1", name: "n", expr: "e", prompt: "p", agent: "codex", enabled: true })?.body)
      .toMatchObject({ agent: "codex", enabled: true });
    expect(t.inputSchema.required).toEqual(["project", "name", "expr", "prompt"]);
  });

  it("update: `clear` mengosongkan jadi null dan menang atas nilai yang ikut dikirim", () => {
    const t = tool("hanoman_scheduler_cron_update");
    expect(t.build({ cron: "c1", name: "baru" })).toEqual({ method: "PATCH", path: "/scheduler/crons/c1", body: { name: "baru" } });
    expect(t.build({ cron: "c1", model: "m", clear: ["model", "effort", "bukan-field"] })?.body)
      .toEqual({ model: null, effort: null });
    expect(t.build({ cron: "c1", enabled: false })?.body).toEqual({ enabled: false });
  });

  it("list/runs/delete/run memetakan ke route yang benar; delete 204 → deleted:true", () => {
    expect(tool("hanoman_scheduler_crons_list").build({ project: "p1", page: 2, limit: 5 }))
      .toEqual({ method: "GET", path: "/scheduler/crons", query: { projectId: "p1", page: "2", limit: "5" } });
    expect(tool("hanoman_scheduler_cron_runs").build({ cron: "c1" }))
      .toEqual({ method: "GET", path: "/scheduler/crons/c1/runs", query: {} });
    expect(tool("hanoman_scheduler_cron_run").build({ cron: "c1" }))
      .toEqual({ method: "POST", path: "/scheduler/crons/c1/run" });
    expect(tool("hanoman_scheduler_cron_delete").build({ cron: "c1" }))
      .toEqual({ method: "DELETE", path: "/scheduler/crons/c1" });
    expect(tool("hanoman_scheduler_cron_delete").shape(null, {})).toEqual({ deleted: true });
  });

  it("hanya list & runs yang terlihat di tingkat default; sisanya (yang mengeksekusi) danger", () => {
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    expect(def.has("hanoman_scheduler_crons_list")).toBe(true);
    expect(def.has("hanoman_scheduler_cron_runs")).toBe(true);
    for (const n of ["create", "update", "delete", "run"])
      expect(def.has(`hanoman_scheduler_cron_${n}`), n).toBe(false);
  });
});


it("Antigravity launch/cron/history enum is additive without capability downgrade", () => {
  for (const name of ["hanoman_session_create", "hanoman_scheduler_cron_create", "hanoman_models"]) {
    const t = tool(name);
    expect(t.inputSchema.properties!.agent).toMatchObject({ enum: ["claude", "codex", "antigravity"] });
  }
  expect(tool("hanoman_session_create")).toMatchObject({ mode: "danger", capability: "sessions:spawn" });
  expect(tool("hanoman_session_create").build({ spec: "SPEC-1442", flow: "feature", agent: "antigravity" })!.body).toMatchObject({ agent: "antigravity" });
});


it("Antigravity model filter returns only the selected runtime provider", () => {
  const raw = { claude: ["c"], codex: ["x"], antigravity: ["a"], providers: { claude: "c", codex: "x", antigravity: "a" } };
  expect(tool("hanoman_models").shape(raw, { agent: "antigravity" })).toEqual({ antigravity: ["a"], providers: { antigravity: "a" } });
});
it("native phase overrides are preserved by the existing launch MCP tool", () => {
  const phaseOverrides = { Plan: { model: "inherit", effort: null } };
  const t = tool("hanoman_session_create");
  expect(t.inputSchema.properties!.phaseOverrides).toBeDefined();
  expect(t.build({ spec: "SPEC-1442", flow: "feature", agent: "antigravity", phaseOverrides })!.body).toMatchObject({ phaseOverrides });
});

// ADR-0222 · laporan run cron: dua tool baca, `scheduler:read`.
describe("laporan run cron (ADR-0222)", () => {
  const tool = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;
  it("hanoman_scheduler_reports: daftar berfilter, read, scheduler:read", () => {
    const t = tool("hanoman_scheduler_reports");
    expect(t).toMatchObject({ mode: "read", capability: "scheduler:read" });
    expect(t.build({ cron: "c1", project: "p1", page: 2, limit: 5 })).toEqual({
      method: "GET", path: "/scheduler/reports", query: { cronId: "c1", projectId: "p1", page: "2", limit: "5" },
    });
  });
  it("hanoman_scheduler_report_get: latest (default) atau id", () => {
    const t = tool("hanoman_scheduler_report_get");
    expect(t).toMatchObject({ mode: "read", capability: "scheduler:read" });
    expect(t.build({ cron: "c1" })).toEqual({ method: "GET", path: "/scheduler/reports/latest", query: { cronId: "c1" } });
    expect(t.build({ report: "latest" })?.path).toBe("/scheduler/reports/latest");
    expect(t.build({ report: "ab/c" })).toEqual({ method: "GET", path: "/scheduler/reports/ab%2Fc" });
  });
});
