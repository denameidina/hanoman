import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { __emitSessionHooks } from "../src/services/pty";
import { __resetEventLog, appendEvent, installEventTap, recentAudit } from "../src/services/logs/event-log";

const clean = async () => { await prisma.logEntry.deleteMany(); __resetEventLog(); };
beforeEach(clean);
afterAll(clean);
const T = new Date("2026-09-15T01:00:00.000Z");
const waitFor = async (ok: () => Promise<boolean>, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("appendEvent (SPEC-1215 · ADR-0166 §2–3)", () => {
  it("seq naik ketat walau stempel sama dan dipanggil serentak", async () => {
    await Promise.all([1, 2, 3, 4, 5].map((n) => appendEvent({ kind: "t", msg: `m${n}`, at: T })));
    const rows = await prisma.logEntry.findMany({ orderBy: { seq: "asc" } });
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.seq > rows[i - 1]!.seq).toBe(true);
    expect(rows[0]!.seq).toBe(BigInt(T.getTime()) * BigInt(1000));
    expect(rows.every((r) => r.deviceId === "local" && r.lane === "event")).toBe(true);
  });

  it("sesudah restart dengan jam mundur, seq tetap di atas baris terakhir", async () => {
    await appendEvent({ kind: "a", msg: "a", at: new Date(T.getTime() + 60_000) });
    __resetEventLog();
    await appendEvent({ kind: "b", msg: "b", at: T });
    const [a, b] = await prisma.logEntry.findMany({ orderBy: { id: "asc" } });
    expect(b!.seq > a!.seq).toBe(true);
  });

  it("msg dipotong 4 KiB, data > 8 KiB diganti penanda, bytes terisi", async () => {
    await appendEvent({ kind: "big", msg: "x".repeat(10_000), data: { blob: "y".repeat(20_000) } });
    const r = await prisma.logEntry.findFirstOrThrow({ where: { kind: "big" } });
    expect(r.msg).toHaveLength(4096);
    expect(r.data).toMatchObject({ truncated: true });
    expect(r.bytes).toBeGreaterThan(4096);
  });

  it("recentAudit hanya remote.* dan grant.changed, terbaru dulu", async () => {
    await appendEvent({ kind: "session.start", msg: "s", at: T });
    await appendEvent({ kind: "remote.request", msg: "r", at: new Date(T.getTime() + 1) });
    await appendEvent({ kind: "grant.changed", msg: "g", at: new Date(T.getTime() + 2) });
    const audit = await recentAudit();
    expect(audit.map((a) => a.kind)).toEqual(["grant.changed", "remote.request"]);
    expect(audit[0]).toMatchObject({ deviceId: "local", lane: "event", hasTranscript: false });
    expect(typeof audit[0]!.seq).toBe("string");
  });
});

describe("installEventTap", () => {
  let off: (() => void) | undefined;
  afterEach(() => { off?.(); off = undefined; });

  it("mencatat session.start & session.end tanpa cwd maupun transkrip", async () => {
    off = installEventTap();
    __emitSessionHooks.birth({
      sessionId: "spec-9", projectId: "p1", specId: "SPEC-9", flow: "feature", kind: "spec",
      agent: "claude", cwd: "/rahasia/path", model: "claude-opus-5",
    });
    __emitSessionHooks.death({ sessionId: "spec-9", exitCode: 1, transcript: "ISI-TRANSKRIP" });
    await waitFor(async () => (await prisma.logEntry.count()) === 2);
    const rows = await prisma.logEntry.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.kind)).toEqual(["session.start", "session.end"]);
    expect(rows[0]).toMatchObject({ projectId: "p1", specId: "SPEC-9", sessionId: "spec-9", level: "info" });
    expect(JSON.stringify(rows)).not.toContain("/rahasia/path");
    expect(JSON.stringify(rows)).not.toContain("ISI-TRANSKRIP");
    expect(rows[1]!.level).toBe("warn");
  });
});
