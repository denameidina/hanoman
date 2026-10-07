import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REPO_HEADER, encodeRepoHeader } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

const app = buildApp();
let dir = ""; let head = "";
const g = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const repoA = () => encodeRepoHeader({ remote: "git@github.com:acme/alpha.git", rootCommit: head, head });
const repoB = () => encodeRepoHeader({ remote: "git@github.com:acme/beta.git", rootCommit: head, head });

const blob = { model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true };
const clean = async () => {
  await prisma.memoryEvent.deleteMany(); await prisma.projectMemory.deleteMany();
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.project.deleteMany({ where: { id: { in: ["rt-a", "rt-b"] } } });
};
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mem-route-"));
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "README.md"), "x\n"); g("add", "."); g("commit", "-qm", "1"); head = g("rev-parse", "HEAD");
});
beforeEach(async () => {
  await clean();
  await prisma.setting.create({ data: { id: 1, data: blob } });
  await prisma.project.create({ data: { id: "rt-a", name: "a", desc: "", kind: "app", gitRemote: "https://github.com/acme/alpha", repoDir: dir } });
  await prisma.project.create({ data: { id: "rt-b", name: "b", desc: "", kind: "app", gitRemote: "https://github.com/acme/beta" } });
});
afterAll(clean);

const tokenFor = async (projectIds: string[] | undefined, caps = ["memory:write"]) =>
  (await issueAgentToken({ name: "bot", capabilities: caps as never, projectIds })).token;
const H = (token: string, repo = repoA()) => ({ authorization: `Bearer ${token}`, [REPO_HEADER]: repo });
const fact = { kind: "fact", content: "README ada di root", scopePaths: [], anchors: [{ path: "README.md" }] };

describe("/api/memories · agent token", () => {
  it("propose → 201 active, lalu search & get menemukannya", async () => {
    const t = await tokenFor(["rt-a"]);
    const p = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    expect(p.statusCode).toBe(201);
    const id = p.json().memory.id;
    expect(p.json().memory.status).toBe("active");
    const s = await app.inject({ method: "GET", url: "/api/memories?q=readme", headers: H(t) });
    expect(s.json().items.map((m: { id: string }) => m.id)).toEqual([id]);
    const gg = await app.inject({ method: "GET", url: `/api/memories/${id}`, headers: H(t) });
    expect(gg.json().events.length).toBe(2);
  });

  it("tanpa capability → 403 need memory:read", async () => {
    const t = await tokenFor(["rt-a"], ["projects:read"]);
    const r = await app.inject({ method: "GET", url: "/api/memories", headers: H(t) });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("memory:read");
  });

  it("token tanpa allowlist → 403 need projectIds", async () => {
    const t = await tokenFor(undefined);
    const r = await app.inject({ method: "GET", url: "/api/memories", headers: H(t) });
    expect(r.statusCode).toBe(403);
    expect(r.json().need).toBe("projectIds");
  });

  it("agent mengirim projectId (query/body) → 400", async () => {
    const t = await tokenFor(["rt-a"]);
    expect((await app.inject({ method: "GET", url: "/api/memories?projectId=rt-a", headers: H(t) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { ...fact, projectId: "rt-a" } })).statusCode).toBe(400);
  });

  it("ANTI-BOCOR: token A + repo B → 403; token A tak bisa membaca id memori B", async () => {
    const tA = await tokenFor(["rt-a"]); const tB = await tokenFor(["rt-b"]);
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: H(tA, repoB()) })).statusCode).toBe(403);
    const pb = await app.inject({ method: "POST", url: "/api/memories", headers: H(tB, repoB()),
      payload: { kind: "fact", content: "rahasia beta", scopePaths: [], anchors: [] } });
    expect(pb.statusCode).toBe(201);
    const idB = pb.json().memory.id;
    expect((await app.inject({ method: "GET", url: `/api/memories/${idB}`, headers: H(tA) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/memories/${idB}/invalidate`, headers: H(tA), payload: { reason: "x" } })).statusCode).toBe(404);
  });

  it("ADR-0179: header sesi palsu → 401, tak jatuh diam-diam ke jalur repo", async () => {
    const t = await tokenFor(["rt-a"]);
    const r = await app.inject({ method: "GET", url: "/api/memories",
      headers: { ...H(t), "x-hanoman-session": "spec-x", "x-hanoman-session-token": "palsu" } });
    expect(r.statusCode).toBe(401);
  });

  it("activate/reject cookie-only untuk agent token", async () => {
    const t = await tokenFor(["rt-a"]);
    const r = await app.inject({ method: "POST", url: "/api/memories/abc/activate", headers: H(t), payload: {} });
    expect(r.statusCode).toBe(403);
  });

  it("galat terpetakan: 422 jangkar, 409 duplikat, 400 body", async () => {
    const t = await tokenFor(["rt-a"]);
    const bad = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { ...fact, anchors: [{ path: "none.md" }] } });
    expect(bad.statusCode).toBe(422);
    await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    const dup = await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: fact });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().duplicateOf).toEqual(expect.any(String));
    expect((await app.inject({ method: "POST", url: "/api/memories", headers: H(t), payload: { kind: "x" } })).statusCode).toBe(400);
  });
});

const cookieHeader = async () => {
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } });
  return { cookie: (r.headers["set-cookie"] as string).split(";")[0]! };
};

describe("/api/memories · cookie", () => {
  it("cookie wajib projectId; review activate memindahkan proposed → active", async () => {
    const c = await cookieHeader();
    expect((await app.inject({ method: "GET", url: "/api/memories", headers: c })).statusCode).toBe(400);
    const p = await app.inject({ method: "POST", url: "/api/memories", headers: c,
      payload: { projectId: "rt-a", kind: "decision", content: "pakai SQLite", scopePaths: [], anchors: [] } });
    expect(p.statusCode).toBe(201);
    expect(p.json().memory).toMatchObject({ status: "proposed", source: { runtime: "human" } });
    const a = await app.inject({ method: "POST", url: `/api/memories/${p.json().memory.id}/activate?projectId=rt-a`, headers: c, payload: {} });
    expect(a.statusCode).toBe(200);
    expect(a.json().memory.status).toBe("active");
  });
});
