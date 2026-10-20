import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import type { LeadDecision } from "@prisma/client";
import { LEAD_DEFAULTS } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import { applyAction, type ApplyDeps } from "../src/services/lead/apply";
import { recordDecision } from "../src/services/lead/trail";

// SPEC-409 · ADR-0091 · H · permukaan tindakan lead. Batas kerasnya di SERVER (AC-34), bukan lewat
// hook penolak perintah pada sesi pekerja — ADR-0037 tetap dicabut.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
  await prisma.spec.create({ data: {
    id: "spec-1", projectId: "demo", title: "t", source: "brief", stage: "executing",
    priority: "sedang", author: "t", objective: "o",
  } });
  await setLead({ ...LEAD_DEFAULTS, enabled: true });
});
afterAll(clean);

type Trace = { killed: string[]; started: string[]; integrated: string[]; notes: string[] };
function harness(over: Partial<ApplyDeps> = {}): { deps: ApplyDeps; t: Trace } {
  const t: Trace = { killed: [], started: [], integrated: [], notes: [] };
  const deps: ApplyDeps = {
    killSession: (id) => { t.killed.push(id); return true; },
    sessionExists: () => true,
    startSpec: (async (spec: { id: string }) => { t.started.push(spec.id); return { id: "sess", resumed: true }; }) as unknown as ApplyDeps["startSpec"],
    repoDir: async () => "/repo",
    planDone: () => true,
    integrate: (async (_repo: string, specId: string) => { t.integrated.push(specId); return { status: "clean", detail: "ok" }; }) as unknown as ApplyDeps["integrate"],
    notify: async (_id, title) => { t.notes.push(title); },
    verify: async () => ({ ok: true, code: 0, tail: "" }),
    dirty: async () => false,
    targetOf: async () => ({ branch: "main", verifyCommand: "pnpm test" }),
    ...over,
  };
  return { deps, t };
}

// `over` sengaja sempit (bukan Partial<LeadDecision>): `refs` bertipe Json dan boleh null di baris,
// tapi tak boleh null di input update Prisma — Partial baris akan menyeret ketidakcocokan itu masuk.
const row = (action: string, over: { sessionId?: string | null; specId?: string | null } = {}): Promise<LeadDecision> =>
  recordDecision({
    projectId: "demo", specId: "spec-1", sessionId: "s1",
    gate: "pulse", kind: "quality", question: "q", answer: "a", reason: "r",
    refs: [], confidence: "tinggi", action: action as "none",
  }).then((r) => prisma.leadDecision.update({ where: { id: r.id }, data: over }));

describe("applyAction · batas keras (AC-31/32/33)", () => {
  it("refuses an action outside the allowlist, and says so out loud", async () => {
    const h = harness();
    const r = await applyAction(await row("deploy"), h.deps);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("terkunci");
    expect(h.t.notes[0]).toContain("menolak tindakan terkunci");
    expect(h.t).toMatchObject({ killed: [], started: [], integrated: [] });
  });
  it("refuses deleting a worktree even though a stored row asks for it", async () => {
    const h = harness();
    expect((await applyAction(await row("delete-worktree"), h.deps)).ok).toBe(false);
  });
});

describe("applyAction · menghentikan sesi (AC-32a)", () => {
  // Ini pemisah yang menentukan: `DELETE /terminal/sessions/:id` MEMANG menghapus worktree
  // (SPEC-362). Lead memakai killSession langsung supaya pekerjaan yang belum di-commit selamat
  // dan sesinya masih bisa dilanjutkan.
  it("kills the pane and leaves the worktree untouched", async () => {
    const h = harness();
    const r = await applyAction(await row("stop-session"), h.deps);
    expect(r.ok).toBe(true);
    expect(r.detail).toContain("worktree dibiarkan utuh");
    expect(h.t.killed).toEqual(["s1"]);
  });
  it("says no when the decision points at no session", async () => {
    const h = harness();
    expect((await applyAction(await row("stop-session", { sessionId: null }), h.deps)).ok).toBe(false);
  });
});

describe("applyAction · melanjutkan sesi (AC-18)", () => {
  it("goes through the existing resume path", async () => {
    const h = harness();
    const r = await applyAction(await row("resume-session"), h.deps);
    expect(r.ok).toBe(true);
    expect(h.t.started).toEqual(["spec-1"]);
    expect(r.detail).toContain("dilanjutkan");
  });
  // ADR-0084: pane MATI bukan sesi. Membiarkannya berdiri membuat startSpecSession melihat
  // keadaan "live" dan hanya re-attach ke layar mati — tombol yang diam.
  it("kills the leftover pane first so the launcher sees a resumable state", async () => {
    const h = harness();
    await applyAction(await row("resume-session"), h.deps);
    // Yang dibunuh adalah sesi TURUNAN SPEC (`sessionIdForSpec`), bukan `row.sessionId` — baris
    // jejak bisa menunjuk sesi lama, sementara yang menghalangi peluncuran adalah sesi spec-nya.
    expect(h.t.killed).toEqual(["spec-1"]);
  });
  it("does not write baseSha itself — jalur resume yang memutuskan", async () => {
    const h = harness();
    await applyAction(await row("resume-session"), h.deps);
    expect((await prisma.spec.findUnique({ where: { id: "spec-1" } }))!.baseSha).toBeNull();
  });
});

describe("applyAction · integrasi ke main (AC-19, OQ-3)", () => {
  it("refuses while the plan still has unchecked boxes, and records the evidence", async () => {
    const h = harness({ planDone: () => false });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(false);
    expect(h.t.integrated).toEqual([]);
    const saved = await prisma.leadDecision.findFirst({ where: { action: "integrate-main" } });
    expect(saved!.reason).toContain("MASIH menyisakan");
    expect(h.t.notes[0]).toContain("membatalkan integrasi");
  });
  it("integrates when the objective conditions hold, and writes the evidence to the trail", async () => {
    const h = harness();
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(true);
    expect(h.t.integrated).toEqual(["spec-1"]);
    const saved = await prisma.leadDecision.findFirst({ where: { action: "integrate-main" } });
    expect(saved!.reason).toContain("Bukti integrasi");
    expect(saved!.reason).toContain("integrasi bersih");
  });
  // ADR-0228 · knob lama tak lagi bisa melonggarkan jalur lead — merge tanpa bukti = minta izin.
  it("ignores requireGreenBeforeIntegrate=false: an unfinished plan is still refused", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: true, requireGreenBeforeIntegrate: false });
    const h = harness({ planDone: () => false });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(false);
    expect(r.detail.startsWith("plan-open:")).toBe(true);
    expect(h.t.integrated).toEqual([]);
  });
  it("notifies the operator when the merge is not clean", async () => {
    const h = harness({
      integrate: (async () => ({ status: "conflict" })) as unknown as ApplyDeps["integrate"],
    });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(false);
    expect(h.t.notes[0]).toContain("tak bersih");
  });
});

describe("applyAction · integrasi diperketat (ADR-0228)", () => {
  it("refuses a dirty worktree", async () => {
    const h = harness({ dirty: async () => true });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(false);
    expect(r.detail.startsWith("worktree-dirty:")).toBe(true);
    expect(h.t.integrated).toEqual([]);
  });
  it("refuses when the server-run verification is red, and keeps the pane", async () => {
    const h = harness({ verify: async () => ({ ok: false, code: 1, tail: "1 failed" }) });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.detail.startsWith("verify-failed:")).toBe(true);
    expect(r.detail).toContain("1 failed");
    expect(h.t.integrated).toEqual([]);
    expect(h.t.killed).toEqual([]);
  });
  it("merges into the project's target branch, not a hard-coded main", async () => {
    const seen: string[] = [];
    const h = harness({
      targetOf: async () => ({ branch: "develop", verifyCommand: "" }),
      integrate: (async (_r: string, _s: string, _op: string, target: string) => { seen.push(target); return { status: "clean", detail: "ok" }; }) as unknown as ApplyDeps["integrate"],
    });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["local:develop"]);
    expect(r.detail).toContain("tanpa perintah verifikasi");
  });
  it("prefixes a non-clean merge with conflict:", async () => {
    const h = harness({ integrate: (async () => ({ status: "conflict" })) as unknown as ApplyDeps["integrate"] });
    expect((await applyAction(await row("integrate-main"), h.deps)).detail.startsWith("conflict:")).toBe(true);
  });
});

// SPEC-451 · integrasi bersih MELEPAS panenya. Tanpa ini jawaban "integrate-main" hanya
// menyelesaikan separuh keluhan — hasilnya masuk main, tapi pane sesi yang sudah selesai tetap
// terhitung `liveCount()` governor (scheduler/engine.ts) sehingga antrean tak pernah dapat ruang,
// dan itulah kalimat terakhir SPEC-451: "memberikan ruang untuk backlog lain".
describe("applyAction · integrasi melepas panenya (SPEC-451)", () => {
  it("kills the pane after a clean integration, leaving the worktree intact", async () => {
    const h = harness();
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(true);
    // `sessionIdForSpec`, bukan `row.sessionId`: yang memegang slot adalah pane SPEC-nya.
    expect(h.t.killed).toEqual(["spec-1"]);
    expect(r.detail).toContain("pane");
  });

  it("keeps the pane when the merge is not clean — konflik masih butuh sesinya", async () => {
    const h = harness({
      integrate: (async () => ({ status: "conflict" })) as unknown as ApplyDeps["integrate"],
    });
    await applyAction(await row("integrate-main"), h.deps);
    expect(h.t.killed).toEqual([]);
  });

  it("keeps the pane when the plan is unfinished, even with the objective gate off", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: true, requireGreenBeforeIntegrate: false });
    const h = harness({ planDone: () => false });
    expect((await applyAction(await row("integrate-main"), h.deps)).ok).toBe(false);
    expect(h.t.integrated).toEqual([]);
    expect(h.t.killed).toEqual([]);
  });

  it("says so plainly when there was no pane left to release", async () => {
    const h = harness({ sessionExists: () => false });
    const r = await applyAction(await row("integrate-main"), h.deps);
    expect(r.ok).toBe(true);
    expect(h.t.killed).toEqual([]);
  });
});

describe("applyAction · tindakan yang wujudnya hanya jejak", () => {
  it("does nothing for none/answer-session/order-queue", async () => {
    const h = harness();
    for (const a of ["none", "answer-session", "order-queue"]) {
      expect((await applyAction(await row(a), h.deps)).ok).toBe(true);
    }
    expect(h.t).toMatchObject({ killed: [], started: [], integrated: [] });
  });
  it("leaves push/migration/hold to the operator in this version", async () => {
    const h = harness();
    for (const a of ["push-branch", "run-migration", "hold-work"]) {
      const r = await applyAction(await row(a), h.deps);
      expect(r.ok).toBe(true);
      expect(r.detail).toContain("operator");
    }
    expect(h.t).toMatchObject({ killed: [], started: [], integrated: [] });
  });
});
