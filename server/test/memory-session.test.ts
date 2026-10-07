import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const panes = new Map<string, Record<string, unknown>>();
vi.mock("../src/services/pty", async (orig) => ({
  ...(await orig<typeof import("../src/services/pty")>()),
  getSessionAsync: vi.fn(async (id: string) => panes.get(id)),
}));

const { prisma } = await import("../src/db");
const { resolveSessionScope, sessionTrusted } = await import("../src/services/memory/resolve");
const { proposeMemory } = await import("../src/services/memory/store");
const { sessionEventToken } = await import("../src/services/session-event-token");

let dir = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.ticket.deleteMany({ where: { specId: { in: ["SPEC-MS1", "SPEC-MS2"] } } });
  await prisma.spec.deleteMany({ where: { id: { in: ["SPEC-MS1", "SPEC-MS2"] } } });
  await prisma.project.deleteMany({ where: { id: "ms-p" } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-ses-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a.ts"), "1\n"); g("add", "."); g("commit", "-qm", "1");
});
beforeEach(async () => {
  await clean(); panes.clear();
  await prisma.project.create({ data: { id: "ms-p", name: "p", desc: "", kind: "existing" } });
  const spec = (id: string, source: string) => prisma.spec.create({ data: { id, projectId: "ms-p", title: "t", source,
    stage: "planned", author: "a", priority: "sedang", objective: "o" } });
  await spec("SPEC-MS1", "brief"); await spec("SPEC-MS2", "help");
  panes.set("spec-ms1", { id: "spec-ms1", projectId: "ms-p", specId: "SPEC-MS1", cwd: dir, exited: false, agent: "codex" });
  panes.set("spec-ms2", { id: "spec-ms2", projectId: "ms-p", specId: "SPEC-MS2", cwd: dir, exited: false, agent: "claude" });
  panes.set("spec-dead", { id: "spec-dead", projectId: "ms-p", cwd: dir, exited: true, agent: "claude" });
  panes.set("telegram-x", { id: "telegram-x", projectId: "telegram:1", cwd: dir, exited: false, agent: "claude" });
});
afterAll(clean);

const creds = (id: string) => ({ session: id, token: sessionEventToken(id) });

describe("resolveSessionScope", () => {
  it("tanpa header sesi → null (jalur lama)", async () => {
    expect(await resolveSessionScope({})).toBeNull();
  });
  it("token salah / header setengah → 401", async () => {
    expect(await resolveSessionScope({ session: "spec-ms1", token: "x" })).toMatchObject({ ok: false, status: 401 });
    expect(await resolveSessionScope({ session: "spec-ms1" })).toMatchObject({ ok: false, status: 401 });
  });
  it("sesi sah → scope dari pane: project, cwd worktree, HEAD worktree", async () => {
    const r = await resolveSessionScope(creds("spec-ms1"));
    expect(r).toEqual({ ok: true,
      scope: { projectId: "ms-p", repoDir: dir, head: g("rev-parse", "HEAD"), headVerified: true },
      session: { sessionId: "spec-ms1", runtime: "codex", trusted: true } });
  });
  it("pane mati / tak ada → 404; project sintetis (telegram) → 400", async () => {
    expect(await resolveSessionScope(creds("spec-dead"))).toMatchObject({ ok: false, status: 404 });
    expect(await resolveSessionScope(creds("nope"))).toMatchObject({ ok: false, status: 404 });
    expect(await resolveSessionScope(creds("telegram-x"))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("sessionTrusted", () => {
  it("source help / tiket / issue GitHub tertaut → tak tepercaya", async () => {
    expect(await sessionTrusted("SPEC-MS1")).toBe(true);
    expect(await sessionTrusted("SPEC-MS2")).toBe(false);
    expect(await sessionTrusted(undefined)).toBe(true);
  });
});

describe("store · actor sesi", () => {
  it("memori dari sesi tak tepercaya tak pernah auto-aktif walau jangkar valid", async () => {
    const r = await resolveSessionScope(creds("spec-ms2"));
    if (!r?.ok) throw new Error("setup");
    const m = await proposeMemory(r.scope, { kind: "session", id: "spec-ms2", runtime: "claude", trusted: r.session.trusted, tokenId: "tok" },
      { kind: "fact", content: "a.ts berisi satu", scopePaths: [], anchors: [{ path: "a.ts" }] });
    expect(m).toMatchObject({ ok: true, memory: {
      status: "proposed", reviewReason: "untrusted-source", trusted: false,
      source: { runtime: "claude", sessionId: "spec-ms2", tokenId: "tok" } } });
  });
  it("sesi tepercaya + jangkar valid → active, runtime codex", async () => {
    const r = await resolveSessionScope(creds("spec-ms1"));
    if (!r?.ok) throw new Error("setup");
    const m = await proposeMemory(r.scope, { kind: "session", id: "spec-ms1", runtime: "codex", trusted: true, tokenId: null },
      { kind: "fact", content: "a.ts ada", scopePaths: [], anchors: [{ path: "a.ts" }] });
    expect(m).toMatchObject({ ok: true, memory: { status: "active", source: { runtime: "codex", sessionId: "spec-ms1" } } });
  });
});
