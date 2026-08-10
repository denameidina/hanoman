import { describe, it, expect } from "vitest";
import { zCreateCron, zPatchCron } from "./dto";
import { paths } from "./api";

describe("zCreateCron", () => {
  const ok = { project: "p1", name: "Cek error pagi", expr: "0 7 * * *", prompt: "Periksa error produksi." };
  it("menerima bentuk minimal dan default enabled=false", () => {
    const r = zCreateCron.parse(ok);
    expect(r.enabled).toBe(false);
    expect(r.agent).toBeUndefined();
  });
  it("menolak expr yang tak bisa diparse", () => {
    expect(zCreateCron.safeParse({ ...ok, expr: "0 99 * * *" }).success).toBe(false);
    expect(zCreateCron.safeParse({ ...ok, expr: "tiap pagi" }).success).toBe(false);
  });
  it("menolak prompt & nama kosong", () => {
    expect(zCreateCron.safeParse({ ...ok, prompt: "   " }).success).toBe(false);
    expect(zCreateCron.safeParse({ ...ok, name: "" }).success).toBe(false);
  });
  it("menerima knob sesi opsional", () => {
    const r = zCreateCron.parse({ ...ok, agent: "codex", model: "gpt-5.6-sol", effort: "high" });
    expect(r.agent).toBe("codex");
  });
});

describe("zPatchCron", () => {
  it("semuanya opsional; body kosong sah", () => {
    expect(zPatchCron.parse({})).toEqual({});
  });
  it("expr tetap divalidasi bila disebut", () => {
    expect(zPatchCron.safeParse({ expr: "0 7 * * *" }).success).toBe(true);
    expect(zPatchCron.safeParse({ expr: "* * *" }).success).toBe(false);
  });
  it("agent null mengosongkan (kembali ke warisan)", () => {
    expect(zPatchCron.parse({ agent: null }).agent).toBeNull();
  });
});

describe("paths cron", () => {
  it("hidup di bawah prefix /scheduler", () => {
    expect(paths.schedulerCrons).toBe("/api/scheduler/crons");
    expect(paths.schedulerCron("c1")).toBe("/api/scheduler/crons/c1");
    expect(paths.schedulerCronRunNow("c1")).toBe("/api/scheduler/crons/c1/run");
    expect(paths.schedulerCronRuns("c1")).toBe("/api/scheduler/crons/c1/runs");
  });
});
