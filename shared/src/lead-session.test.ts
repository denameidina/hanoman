import { describe, it, expect } from "vitest";
import {
  LEAD_ACTIONS, LEAD_AUTHORITY_DEFAULTS, zLeadAct, zLeadProject, isSensitiveText,
  zLead, SESSION_KINDS, SESSION_KIND_LABEL, CAPABILITY_IDS, grantsCapability,
} from "./index";

// ADR-0228 · kontrak sesi lead: wewenang per tindakan, bentuk `act`, setelan per proyek.

describe("kontrak sesi lead", () => {
  it("memberi mode wewenang untuk SETIAP tindakan, merge = ask", () => {
    for (const a of LEAD_ACTIONS) expect(LEAD_AUTHORITY_DEFAULTS[a]).toBeDefined();
    expect(LEAD_AUTHORITY_DEFAULTS["integrate-main"]).toBe("ask");
    expect(LEAD_AUTHORITY_DEFAULTS["answer-session"]).toBe("auto");
    expect(LEAD_AUTHORITY_DEFAULTS["start-session"]).toBe("auto");
  });

  it("default proyek memakai angka spec", () => {
    expect(zLeadProject.parse({})).toMatchObject({
      targetBranch: "main", verifyCommand: "", quotaStopPct: 85, rampStep: 1,
      rampProbeMin: 10, failStreak: 2, answerSlaSec: 300, authority: {},
    });
  });

  it("zLead menambah knob global sesi lead tanpa merusak baris lama", () => {
    const l = zLead.parse({ enabled: true });
    expect(l.deliverTimeoutSec).toBe(600);
    expect(l.approvalTtlMin).toBe(1440);
    expect(l.rotateAfterEvents).toBe(40);
    expect(l.projects).toEqual({});
    const withProject = zLead.parse({ projects: { p: { targetBranch: "develop" } } });
    expect(withProject.projects.p?.targetBranch).toBe("develop");
  });

  it("act menuntut eventId + verdict; evidence default kosong", () => {
    const ok = zLeadAct.parse({ eventId: "e1", verdict: { decision: "d", reason: "r" } });
    expect(ok.evidence).toEqual([]);
    expect(ok.verdict.action).toBe("none");
    expect(zLeadAct.safeParse({ verdict: { decision: "d", reason: "r" } }).success).toBe(false);
  });

  it("mengenali teks sensitif tanpa peka huruf besar", () => {
    expect(isSensitiveText("Deploy ke PRODUKSI sekarang")).toBe(true);
    expect(isSensitiveText("Bootstrap director sementara khusus staging untuk membuat akun uji")).toBe(true);
    expect(isSensitiveText("Pakai netSalary alokasi versi aktif")).toBe(false);
  });

  it("jenis sesi & capability baru terdaftar", () => {
    expect(SESSION_KINDS).toContain("lead");
    expect(SESSION_KIND_LABEL.lead).toBe("Lead");
    expect(CAPABILITY_IDS).toContain("lead:approve");
    // Menulis ke lead tak pernah cukup untuk menyetujui tindakannya sendiri (ADR-0192).
    expect(grantsCapability(["lead:write"], "lead:approve")).toBe(false);
  });
});
