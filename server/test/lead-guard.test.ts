import { describe, it, expect } from "vitest";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { checkAct, type GuardDeps, type GuardInput } from "../src/services/lead/guard";

// ADR-0228 · gerbang tindakan lead: deterministik, di server.

const spec = {
  id: "SPEC-1", projectId: "p", stage: "spec-ready", baseSha: null, objective: "o",
  launchApprovedAt: new Date(), dependsOn: [], branchFrom: null,
};
const deps = (over: Partial<GuardDeps> = {}): GuardDeps => ({
  cfg: async () => LEAD_DEFAULTS,
  budget: async () => ({ n: 1, reasons: [], tripped: false }),
  spec: async () => spec,
  blockers: async () => [],
  sessionLive: async () => false,
  sessionWaiting: () => true,
  approved: () => true,
  ...over,
});
const inp = (over: Partial<GuardInput> = {}): GuardInput => ({
  projectId: "p", eventKind: "pulse", eventOpen: true, action: "start-session", specId: "SPEC-1",
  sessionId: null, decision: "mulai SPEC-1", choices: [], reason: "paling mendesak", evidence: ["SPEC-1 objective"],
  ...over,
});

describe("checkAct · umum", () => {
  it("event tertutup selalu ditolak", async () => {
    expect((await checkAct(inp({ eventOpen: false }), deps())).code).toBe("event-closed");
  });
  it("tindakan di luar allowlist ditolak", async () => {
    expect((await checkAct(inp({ action: "deploy" }), deps())).code).toBe("action-locked");
  });
  it("mode off menolak", async () => {
    const off = { ...LEAD_DEFAULTS, projects: { p: { authority: { "start-session": "off" as const } } } };
    expect((await checkAct(inp(), deps({ cfg: async () => off }))).code).toBe("authority-off");
  });
  it("none selalu lolos", async () => {
    expect((await checkAct(inp({ action: "none" }), deps())).outcome).toBe("lolos");
  });
});

describe("checkAct · start-session", () => {
  it("jatah 0 → budget-zero membawa alasannya", async () => {
    const r = await checkAct(inp(), deps({ budget: async () => ({ n: 0, reasons: ["kuota 90%"], tripped: false }) }));
    expect(r).toMatchObject({ outcome: "ditolak", code: "budget-zero" });
    expect(r.report.join(" ")).toContain("kuota 90%");
  });
  it("menolak blocker, sesi hidup, tanpa alasan/bukti, belum disetujui, sudah selesai", async () => {
    expect((await checkAct(inp(), deps({ blockers: async () => ["SPEC-0 (unfinished)"] }))).code).toBe("blocked");
    expect((await checkAct(inp(), deps({ sessionLive: async () => true }))).code).toBe("session-live");
    expect((await checkAct(inp({ reason: " " }), deps())).code).toBe("no-reason");
    expect((await checkAct(inp({ evidence: ["docs/x.md"] }), deps())).code).toBe("no-evidence");
    expect((await checkAct(inp(), deps({ approved: () => false }))).code).toBe("spec-not-approved");
    expect((await checkAct(inp(), deps({ spec: async () => ({ ...spec, stage: "done" }) }))).code).toBe("spec-done");
    expect((await checkAct(inp(), deps({ spec: async () => ({ ...spec, projectId: "lain" }) }))).code).toBe("spec-empty");
  });
  it("lolos saat semua syarat terpenuhi", async () => {
    const r = await checkAct(inp(), deps());
    expect(r.outcome).toBe("lolos");
    expect(r.report).toContain("jatah tersisa 1");
  });
});

describe("checkAct · answer-session", () => {
  const ask = (over: Partial<GuardInput> = {}) => inp({ eventKind: "ask", action: "answer-session", sessionId: "spec-1", specId: null, ...over });
  it("jawaban biasa lolos", async () => {
    expect((await checkAct(ask({ decision: "Pakai netSalary versi aktif" }), deps())).outcome).toBe("lolos");
  });
  it("sensitif → butuh-izin walau mode auto (kasus director staging)", async () => {
    const r = await checkAct(ask({ decision: "Bootstrap director sementara di staging", choices: ["Bootstrap director sementara"] }), deps());
    expect(r.outcome).toBe("butuh-izin");
  });
  it("sesi tak lagi menunggu → not-waiting", async () => {
    expect((await checkAct(ask(), deps({ sessionWaiting: () => false }))).code).toBe("not-waiting");
  });
});

describe("checkAct · integrate-main", () => {
  const i = inp({ eventKind: "session-ended", action: "integrate-main", sessionId: "spec-1" });
  it("default butuh-izin", async () => {
    expect((await checkAct(i, deps())).outcome).toBe("butuh-izin");
  });
  it("mode auto + verifyCommand kosong tetap butuh-izin", async () => {
    const auto = { ...LEAD_DEFAULTS, projects: { p: { authority: { "integrate-main": "auto" as const } } } };
    const r = await checkAct(i, deps({ cfg: async () => auto }));
    expect(r.outcome).toBe("butuh-izin");
    expect(r.report.join(" ")).toContain("tak ada perintah verifikasi");
  });
  it("mode auto + verifyCommand terisi → lolos", async () => {
    const ok = { ...LEAD_DEFAULTS, projects: { p: { verifyCommand: "pnpm test", authority: { "integrate-main": "auto" as const } } } };
    expect((await checkAct(i, deps({ cfg: async () => ok }))).outcome).toBe("lolos");
  });
});
