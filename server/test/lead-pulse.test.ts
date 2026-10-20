import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, SCHEDULER_DEFAULTS, type Lead } from "@hanoman/shared";
import { pulse, findCollisions, type PulseDeps, type WorkArea } from "../src/services/lead/pulse";
import { recordDecision } from "../src/services/lead/trail";
import type { DecideRequest } from "../src/services/lead/decide";

// SPEC-409 · ADR-0091 · pintu #3 (denyut proaktif): mutu hasil, tabrakan area kerja, ambil backlog.
// ADR-0228 · denyut MEMBUKA event tanpa penunggu (`post`) dan langsung kembali; eksekusinya diuji
// di lead-post.test.ts. Ambil backlog dibatasi jatah server.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "demo", name: "Demo", desc: "", kind: "web", leadOptIn: true } });
});
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });
const area = (specId: string, paths: string[]): WorkArea =>
  ({ specId, sessionId: specId, projectId: "demo", paths });

describe("findCollisions (AC-14, OQ-9)", () => {
  it("finds the same file touched by two sessions", () => {
    const c = findCollisions([area("a", ["server/src/x.ts"]), area("b", ["server/src/x.ts"])]);
    expect(c).toHaveLength(1);
    expect(c[0]!.shared).toEqual(["server/src/x.ts"]);
  });
  it("reports a shared module as a weaker signal, without double-counting the shared file", () => {
    const c = findCollisions([
      area("a", ["server/src/x.ts", "server/src/y.ts"]),
      area("b", ["server/src/x.ts", "server/src/z.ts"]),
    ]);
    expect(c[0]!.shared).toEqual(["server/src/x.ts"]);
    expect(c[0]!.nearby).toEqual([]);
  });
  it("flags a shared module even when no single file matches", () => {
    const c = findCollisions([area("a", ["server/src/y.ts"]), area("b", ["server/src/z.ts"])]);
    expect(c[0]!.shared).toEqual([]);
    expect(c[0]!.nearby).toEqual(["server/src"]);
  });
  it("is not a collision when the work is genuinely apart", () => {
    expect(findCollisions([area("a", ["server/src/x.ts"]), area("b", ["src/src/y.tsx"])])).toEqual([]);
  });
  it("never crosses project boundaries — satu lead melayani satu project (NG1)", () => {
    const b = { ...area("b", ["server/src/x.ts"]), projectId: "lain" };
    expect(findCollisions([area("a", ["server/src/x.ts"]), b])).toEqual([]);
  });
});

type Posted = DecideRequest & { eventKind?: string };
function harness(over: Partial<PulseDeps> = {}, conf: Lead = cfg()) {
  const posted: Posted[] = [];
  const paused: string[] = [];
  const deps: PulseDeps = {
    sessions: () => [],
    areas: async () => [],
    planDone: () => true,
    // SPEC-451 · default `false`: sebagian besar test bicara soal sesi yang GAGAL.
    finished: () => false,
    post: async (req, kind) => { posted.push({ ...req, eventKind: kind }); return { id: `e${posted.length}` }; },
    // Event yang masih terbuka = yang sudah dibuka harness ini (belum ada yang menjawabnya).
    openPosted: async (projectId, prefix) =>
      posted.some((p) => p.projectId === projectId && (p.question.startsWith(prefix) || p.question.includes(prefix))),
    budget: async () => ({ n: 1, reasons: [], tripped: false }),
    pauseProject: async (p) => { if (!paused.includes(p)) paused.push(p); },
    optIn: async () => ["demo"],
    cfg: async () => conf,
    scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: true }),
    ...over,
  };
  return { deps, posted, paused };
}

describe("pulse · gerbang (AC-12/15/30)", () => {
  it("is fully idle while the master switch is off", async () => {
    const h = harness({}, { ...LEAD_DEFAULTS, enabled: false });
    expect(await pulse(h.deps)).toEqual({ ordered: 0, collisions: 0, quality: 0 });
    expect(h.posted).toEqual([]);
  });
  it("is idle while paused", async () => {
    const h = harness({}, cfg({ paused: true }));
    await pulse(h.deps);
    expect(h.posted).toEqual([]);
  });
  it("skips a project paused individually", async () => {
    const h = harness({
      sessions: () => [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: true, exitCode: 1 }],
    }, cfg({ pausedProjects: ["demo"] }));
    await pulse(h.deps);
    expect(h.posted).toEqual([]);
  });
  it("never waits for the lead pane — the beat returns at once", async () => {
    const h = harness({
      sessions: () => [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: true, exitCode: 1 }],
      post: async (req) => { h.posted.push(req); return { id: "e" }; },
    });
    const t0 = Date.now();
    await pulse(h.deps);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe("pulse · mutu hasil (AC-16/17)", () => {
  const failedSession = [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: true, exitCode: 1 }];

  it("opens a session-ended event for a session that died with a non-zero exit code", async () => {
    const h = harness({ sessions: () => failedSession });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.posted[0]).toMatchObject({ kind: "quality", gate: "pulse", eventKind: "session-ended", sessionId: "s1" });
    expect(h.posted[0]!.question).toContain("kode keluar 1");
    expect(h.posted[0]!.options!.join(" ")).toContain("stop-session");
  });
  it("follows up a session that ended with unchecked plan boxes", async () => {
    const h = harness({ sessions: () => [{ ...failedSession[0]!, exitCode: 0 }], planDone: () => false });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.posted[0]!.question).toContain("`- [ ]`");
  });
  it("leaves an exited session alone when the failure door has nothing to say", async () => {
    const h = harness({ sessions: () => [{ ...failedSession[0]!, exitCode: 0 }] });
    expect((await pulse(h.deps)).quality).toBe(0);
  });
  it("never touches a session that is still running", async () => {
    const h = harness({ sessions: () => [{ ...failedSession[0]!, exited: false }] });
    expect((await pulse(h.deps)).quality).toBe(0);
  });
  // ADR-0228 · selama pane lead belum menjawab, denyut berikutnya tak boleh membuka event kembaran.
  it("does not open a twin event while the first is still unanswered", async () => {
    const h = harness({ sessions: () => failedSession });
    await pulse(h.deps);
    await pulse(h.deps);
    expect(h.posted).toHaveLength(1);
  });
  // SPEC-432 · idempotensi lewat JEJAK — termasuk baris `refusal` (decide menulis ulang `kind`).
  it("does not re-ask once a verdict is in the trail, even as a refusal", async () => {
    await recordDecision({
      projectId: "demo", specId: "spec-1", sessionId: "s1", gate: "pulse", kind: "refusal",
      question: "Sesi s1 untuk backlog spec-1 berakhir dengan kode keluar 1.", answer: "hapus worktree",
      reason: "DITOLAK", refs: [], confidence: "tinggi", action: "none",
    });
    const h = harness({ sessions: () => failedSession, openPosted: async () => false });
    await pulse(h.deps);
    expect(h.posted).toEqual([]);
  });
});

// SPEC-451 · pintu KEBERHASILAN: digerbangi `finished`, BUKAN `exited`.
describe("pulse · backlog selesai (SPEC-451)", () => {
  const liveDone = [{ id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt", exited: false }];

  it("asks what to do with finished work whose pane is still alive", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true });
    expect((await pulse(h.deps)).quality).toBe(1);
    expect(h.posted[0]!.question).toContain("sudah selesai");
  });
  it("offers integrating into the project's target branch, resuming, and stopping", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true }, cfg({ projects: { demo: { targetBranch: "develop" } } }));
    await pulse(h.deps);
    const opts = h.posted[0]!.options!.join(" ");
    expect(opts).toContain("integrate-main");
    expect(opts).toContain("develop");
    expect(opts).toContain("resume-session");
    expect(opts).toContain("stop-session");
    expect(h.posted[0]!.question).toContain("ke develop");
  });
  it("leaves a session that is still working alone", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => false });
    expect((await pulse(h.deps)).quality).toBe(0);
  });
  it("never asks twice about a session both doors could see", async () => {
    const h = harness({ sessions: () => [{ ...liveDone[0]!, exited: true, exitCode: 0 }], finished: () => true });
    await pulse(h.deps);
    expect(h.posted).toHaveLength(1);
  });
  it("leaves a failed session to the failure door even when its phases are all recorded", async () => {
    const h = harness({ sessions: () => [{ ...liveDone[0]!, exited: true, exitCode: 143 }], finished: () => true });
    await pulse(h.deps);
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]!.question).toContain("kode keluar 143");
  });
  it("still runs while the scheduler is off", async () => {
    const h = harness({ sessions: () => liveDone, finished: () => true, scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: false }) });
    expect((await pulse(h.deps)).quality).toBe(1);
  });
});

// ADR-0228 · ambil backlog: server menentukan BERAPA, lead memilih YANG MANA.
describe("pulse · ambil backlog berbasis jatah (ADR-0228)", () => {
  const seed = async (ids: string[]) => {
    for (const id of ids) {
      await prisma.spec.create({ data: {
        id, projectId: "demo", title: id, source: "brief", stage: "spec-ready",
        priority: "tinggi", author: "t", objective: `objective ${id}`,
      } });
    }
  };
  beforeEach(async () => { await prisma.project.update({ where: { id: "demo" }, data: { schedulerOptIn: true } }); });

  it("regresi 2026-10-20: 7 backlog siap, jatah 1 → satu event yang meminta paling banyak 1 pilihan", async () => {
    await seed(["S-1", "S-2", "S-3", "S-4", "S-5", "S-6", "S-7"]);
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(1);
    const order = h.posted.filter((p) => p.kind === "order");
    expect(order).toHaveLength(1);
    expect(order[0]).toMatchObject({ eventKind: "pulse", select: { mode: "multi", min: 0, max: 1 } });
    expect(order[0]!.options).toHaveLength(7);
    expect(order[0]!.question).toContain("Jatah peluncuran 1");
    expect(await prisma.schedulerQueueItem.count()).toBe(0);   // denyut tak pernah meng-enqueue sendiri
  });
  it("also offers a single ready item (no more 'minimal dua')", async () => {
    await seed(["S-1"]);
    const h = harness();
    expect((await pulse(h.deps)).ordered).toBe(1);
  });
  it("jatah 0 → tak ada event, dan alasannya tak memanggil lead", async () => {
    await seed(["S-1", "S-2"]);
    const h = harness({ budget: async () => ({ n: 0, reasons: ["kuota 90%"], tripped: false }) });
    expect((await pulse(h.deps)).ordered).toBe(0);
    expect(h.posted).toEqual([]);
  });
  it("pemutus menyala → proyek dijeda (sekali), tak ada event", async () => {
    await seed(["S-1"]);
    const h = harness({ budget: async () => ({ n: 0, reasons: ["2 sesi lead gagal beruntun"], tripped: true }) });
    await pulse(h.deps); await pulse(h.deps);
    expect(h.paused).toEqual(["demo"]);
    expect(h.posted).toEqual([]);
  });
  it("event pilihan sebelumnya belum dijawab → tak membuka yang baru", async () => {
    await seed(["S-1", "S-2"]);
    const h = harness();
    await pulse(h.deps); await pulse(h.deps);
    expect(h.posted.filter((p) => p.kind === "order")).toHaveLength(1);
  });
  it("membawa pembatas jatah ke catatan untuk lead", async () => {
    await seed(["S-1"]);
    const h = harness({ budget: async () => ({ n: 1, reasons: ["ramp: 0 sesi lead masih dalam probe"], tripped: false }) });
    await pulse(h.deps);
    expect(h.posted[0]!.notes!.join(" ")).toContain("Pembatas jatah");
  });
  it("tak menawarkan backlog yang sudah antre, sudah selesai, sudah mulai, atau terblokir", async () => {
    await seed(["S-1", "S-2", "S-3", "S-4", "S-5"]);
    await prisma.schedulerQueueItem.create({ data: { specId: "S-1", projectId: "demo", source: "backlog", priority: "tinggi" } });
    await prisma.spec.update({ where: { id: "S-2" }, data: { stage: "done" } });
    await prisma.spec.update({ where: { id: "S-3" }, data: { baseSha: "abc1234" } });
    await prisma.spec.update({ where: { id: "S-4" }, data: { dependsOn: ["S-5"] } });
    const h = harness();
    await pulse(h.deps);
    expect(h.posted[0]!.options!.map((o) => o.split(" ")[0])).toEqual(["S-5"]);
  });
  it("spends no lead turn while the scheduler is off or paused, or the project is not opted in", async () => {
    await seed(["S-1"]);
    for (const over of [
      { scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: false }) },
      { scheduler: async () => ({ ...SCHEDULER_DEFAULTS, enabled: true, paused: true }) },
    ] as Partial<PulseDeps>[]) {
      const h = harness(over);
      expect((await pulse(h.deps)).ordered).toBe(0);
    }
    await prisma.project.update({ where: { id: "demo" }, data: { schedulerOptIn: false } });
    expect((await pulse(harness().deps)).ordered).toBe(0);
  });
  it("picks per project, never in one mixed turn", async () => {
    await seed(["S-1"]);
    await prisma.project.create({ data: { id: "lain", name: "Lain", desc: "", kind: "web", leadOptIn: true, schedulerOptIn: true } });
    await prisma.spec.create({ data: { id: "L-1", projectId: "lain", title: "L-1", source: "brief", stage: "spec-ready", priority: "tinggi", author: "t", objective: "o" } });
    const h = harness({ optIn: async () => ["demo", "lain"] });
    expect((await pulse(h.deps)).ordered).toBe(2);
    expect(h.posted.map((p) => p.projectId).sort()).toEqual(["demo", "lain"]);
  });
});

describe("pulse · tabrakan (AC-14)", () => {
  const two = [
    { id: "s1", projectId: "demo", specId: "spec-1", cwd: "/wt1", exited: false },
    { id: "s2", projectId: "demo", specId: "spec-2", cwd: "/wt2", exited: false },
  ];
  it("opens one event per colliding pair", async () => {
    const h = harness({ sessions: () => two, areas: async () => ["server/src/x.ts"] });
    expect((await pulse(h.deps)).collisions).toBe(1);
    expect(h.posted[0]!.kind).toBe("collision");
  });
  it("does not re-open the same pair while it is unanswered", async () => {
    const h = harness({ sessions: () => two, areas: async () => ["server/src/x.ts"] });
    await pulse(h.deps); await pulse(h.deps);
    expect(h.posted.filter((p) => p.kind === "collision")).toHaveLength(1);
  });
  it("does not re-ask a pair whose verdict is in the trail as a refusal", async () => {
    await recordDecision({
      projectId: "demo", gate: "pulse", kind: "refusal",
      question: "Dua pekerjaan menyentuh area yang sama [s1|s2]: spec-1 dan spec-2.", answer: "hapus branch",
      reason: "DITOLAK", refs: [], confidence: "tinggi", action: "none",
    });
    const h = harness({ sessions: () => two, areas: async () => ["server/src/x.ts"], openPosted: async () => false });
    await pulse(h.deps);
    expect(h.posted).toEqual([]);
  });
  it("says nothing when the two sessions work apart", async () => {
    const h = harness({
      sessions: () => two,
      areas: async (s) => (s.specId === "spec-1" ? ["server/src/x.ts"] : ["src/src/y.tsx"]),
    });
    expect((await pulse(h.deps)).collisions).toBe(0);
  });
});
