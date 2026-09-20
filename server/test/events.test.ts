import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, detach, __tick, __reset, presenceKey } from "../src/services/events";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";
import { sessionPhasesBySpecAsync } from "../src/services/live-phases";
import { modelCatalogService } from "../src/services/model-catalog";
import { killAll } from "../src/services/pty";
import { _resetLimitsCache } from "../src/services/limits";
import { _resetUpdateCache } from "../src/services/update";
import { __resetPendingCache } from "../src/services/pending-counts";

// Klien perekam frame (lihat pty.test.ts) — cukup untuk menguji kontrak siar tanpa WS nyata.
function fakeClient() {
  const frames: { t: string; [k: string]: unknown }[] = [];
  return { frames, send: (m: string) => frames.push(JSON.parse(m)), close: () => {} };
}
vi.mock("../src/services/live-phases", () => ({ sessionPhasesBySpecAsync: vi.fn(async () => new Map()) }));

const groups = (c: ReturnType<typeof fakeClient>) => new Set(c.frames.map((f) => f.t));

beforeEach(async () => {
  // getLimits() jangan menyentuh keychain/jaringan di test: CLAUDE_CONFIG_DIR kosong → token null
  // → fallback "unavailable" seketika (tanpa prompt, tanpa fetch 5s).
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "hanoman-cfg-"));
  _resetLimitsCache();
  _resetUpdateCache();
  killAll();
  await resetDb();
  // `pending` (SPEC-961) menghitung Ticket/GithubIssue/LeadFlow, dan resetDb() tak menyentuh
  // ketiganya — sisa berkas test lain di DB bersama membuat angkanya bukan nol saat suite
  // penuh, padahal hijau sendirian. Cache PRD ikut dilupakan supaya hitungan disk segar.
  await prisma.ticket.deleteMany();
  await prisma.githubIssue.deleteMany();
  await prisma.leadFlow.deleteMany();
  __resetPendingCache();
  __reset();
});
afterEach(() => { __reset(); _resetUpdateCache(); });

describe("events hub", () => {
  it("mengirim snapshot semua grup ke klien saat attach", async () => {
    const c = fakeClient();
    await attach(c);
    // tmux tak jalan → sessions/specs kosong tapi tetap terkirim; notifications/limits/vps ada.
    expect(groups(c).has("sessions")).toBe(true);
    expect(groups(c).has("specs")).toBe(true);
    expect(groups(c).has("notifications")).toBe(true);
    expect(groups(c).has("limits")).toBe(true);
    expect(groups(c).has("vps")).toBe(true);
    expect(groups(c).has("update")).toBe(true);
    const nf = c.frames.find((f) => f.t === "notifications");
    expect(nf).toMatchObject({ unread: 0 });
    // SPEC-961 · grup ke-11. Badge sidebar tak punya muat awal HTTP: kalau frame ini tak ikut di
    // attach, angkanya baru muncul pada tick pertama yang isinya BERUBAH — di instalasi tenang,
    // tak pernah.
    expect(c.frames.find((f) => f.t === "pending"))
      .toMatchObject({ counts: { triage: 0, backlog: 0, prd: 0, lead: 0 } });
    detach(c);
  });

  it("broadcast frame notifications saat data berubah, dedup saat tak berubah", async () => {
    const c = fakeClient();
    await attach(c);
    const before = c.frames.filter((f) => f.t === "notifications").length;
    await prisma.notification.create({ data: { specId: "SPEC-1", title: "x", projectId: "p1" } });
    await __tick(); await __tick(); await __tick(); // notifications: everyTicks 3
    const afterCreate = c.frames.filter((f) => f.t === "notifications").length;
    expect(afterCreate).toBeGreaterThan(before);
    // tick lagi tanpa perubahan → tak ada frame notifications baru (dedup signature)
    await __tick(); await __tick(); await __tick();
    expect(c.frames.filter((f) => f.t === "notifications").length).toBe(afterCreate);
    detach(c);
  });

  it("klien yang di-detach berhenti menerima frame", async () => {
    const c = fakeClient();
    await attach(c);
    detach(c);
    const n = c.frames.length;
    await prisma.notification.create({ data: { specId: "SPEC-2", title: "y", projectId: "p1" } });
    await __tick(); await __tick(); await __tick();
    expect(c.frames.length).toBe(n);
  });
});

describe("attach({groups}) — grup terbatas (SPEC-1218 · AC-C9)", () => {
  it("groups diisi → hanya grup dalam himpunan yang dikirim saat attach, cookieOnly tetap nol", async () => {
    const c = fakeClient();
    await attach(c, { maySubscribe: false, groups: new Set(["sessions"]) });
    const types = groups(c);
    expect(types).toContain("hello");
    expect(types.has("sessions")).toBe(true);
    // cookieOnly (models/presence) tak boleh terkirim untuk principal non-cookie.
    expect(types.has("models")).toBe(false);
    expect(types.has("presence")).toBe(false);
    // grup non-cookieOnly TAPI di luar {sessions} juga tak boleh terkirim.
    expect(types.has("specs")).toBe(false);
    expect(types.has("notifications")).toBe(false);
    detach(c);
  });

  it("groups tak diisi (undefined) → perilaku lama tak berubah (regresi)", async () => {
    const c = fakeClient();
    await attach(c);
    const types = groups(c);
    expect(types.has("sessions")).toBe(true);
    expect(types.has("specs")).toBe(true);
    expect(types.has("notifications")).toBe(true);
    detach(c);
  });

  it("broadcast berikutnya juga terbatas grupnya untuk klien ber-groups", async () => {
    const c = fakeClient();
    await attach(c, { maySubscribe: false, groups: new Set(["notifications"]) });
    const before = c.frames.filter((f) => f.t === "notifications").length;
    await prisma.notification.create({ data: { specId: "SPEC-3", title: "z", projectId: "p1" } });
    await __tick(); await __tick(); await __tick();
    expect(c.frames.filter((f) => f.t === "notifications").length).toBeGreaterThan(before);
    expect(c.frames.some((f) => f.t === "specs")).toBe(false);
    detach(c);
  });
});

// SPEC-1267 · frame `specs` ringkas, hanya lahir saat berubah.
describe("events hub · specs ringkas (SPEC-1267)", () => {
  const specFrames = (c: ReturnType<typeof fakeClient>) => c.frames.filter((f) => f.t === "specs");

  it("frame specs tak memuat payload/objective/sourceHistory", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1", objective: "panjang", payload: { context: "c", outcome: "o", constraints: "", priority: "sedang" } });
    const c = fakeClient();
    await attach(c);
    const spec = (specFrames(c)[0]!.specs as Record<string, unknown>[])[0]!;
    expect(spec.id).toBe("SPEC-1");
    for (const k of ["payload", "objective", "sourceHistory"]) expect(k in spec).toBe(false);
    detach(c);
  });

  it("DB diam: satu frame lalu nol; satu perubahan: tepat satu frame", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1" });
    const c = fakeClient();
    await attach(c);
    const afterAttach = specFrames(c).length;
    for (let i = 0; i < 5; i++) await __tick();
    const afterIdle = specFrames(c).length;
    expect(afterIdle - afterAttach).toBeLessThanOrEqual(1);
    for (let i = 0; i < 5; i++) await __tick();
    expect(specFrames(c).length).toBe(afterIdle);

    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "baru", version: { increment: 1 } } });
    await __tick();
    expect(specFrames(c).length).toBe(afterIdle + 1);
    detach(c);
  });

  it("overlay stage jalan tiap tick walau digest DB tak berubah (AC-S6)", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1", stage: "brainstorming" });
    const c = fakeClient();
    await attach(c);
    await __tick();
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValue(
      new Map([["SPEC-1", { phases: [{ name: "Plan", state: "done" }], cwd: "/tmp/none" }]]) as never);
    await __tick();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.stage).toBe("planned");
    vi.mocked(sessionPhasesBySpecAsync).mockResolvedValue(new Map());
    detach(c);
  });

  it("specsDigest melempar: frame tetap dibangun (fail-open)", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1" });
    const c = fakeClient();
    await attach(c);
    const before = specFrames(c).length;
    vi.spyOn(prisma.spec, "aggregate").mockRejectedValue(new Error("boom"));
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "x" } });
    await __tick();
    expect(specFrames(c).length).toBe(before + 1);
    vi.restoreAllMocks();
    detach(c);
  });

  it("JSON.stringify dipanggil sekali per frame specs yang lahir", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1" });
    const c = fakeClient();
    await attach(c);
    await __tick();
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { title: "y", version: { increment: 1 } } });
    const spy = vi.spyOn(JSON, "stringify");
    await __tick();
    const specCalls = spy.mock.calls.filter(([v]) => (v as { t?: string } | undefined)?.t === "specs");
    spy.mockRestore();
    expect(specCalls).toHaveLength(1);
    detach(c);
  });
});

describe("events hub · siar paralel & attach dari g.last (SPEC-1267)", () => {
  it("grup yang melempar tak menahan grup lain di tick yang sama", async () => {
    vi.spyOn(modelCatalogService, "snapshot").mockImplementation(() => { throw new Error("boom"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = fakeClient();
    await attach(c);
    c.frames.length = 0;
    await __tick(); await __tick(); await __tick();
    expect(groups(c).has("notifications")).toBe(true);
    expect(groups(c).has("models")).toBe(false);
    vi.restoreAllMocks();
    detach(c);
  });

  it("klien kedua attach memakai g.last tanpa build ulang specs", async () => {
    await makeProject();
    await makeSpec({ id: "SPEC-1" });
    const first = fakeClient();
    await attach(first);
    await __tick();
    const spy = vi.spyOn(prisma.spec, "findMany");
    const second = fakeClient();
    await attach(second);
    expect(spy).not.toHaveBeenCalled();
    expect(groups(second).has("specs")).toBe(true);
    spy.mockRestore();
    detach(first); detach(second);
  });
});

describe("presenceKey (SPEC-1267 · AC-S24)", () => {
  const frame = (seen: string) => ({ t: "presence" as const, enabled: true,
    devices: [{ deviceId: "local", local: true, lastSeenAt: seen, sessions: [] }, { deviceId: "d2", local: false, lastSeenAt: "x", sessions: [] }] });

  it("beda hanya lastSeenAt device lokal → kunci sama", () => {
    expect(presenceKey(frame("t1"))).toBe(presenceKey(frame("t2")));
  });

  it("beda di device remote → kunci berbeda", () => {
    const a = frame("t1"); const b = frame("t1");
    b.devices[1]!.lastSeenAt = "y";
    expect(presenceKey(a)).not.toBe(presenceKey(b));
  });
});
