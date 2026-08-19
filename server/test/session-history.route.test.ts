import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { beginSession, finishSession, reconcileHistory } from "../src/services/session-history";

const app = buildApp();
const clean = async () => {
  await prisma.sessionHistory.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(async () => {
  process.env.HANOMAN_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), "hanoman-thr-"));
  await clean();
});
afterAll(async () => { await clean(); delete process.env.HANOMAN_TRANSCRIPT_DIR; });

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];
const login = async () => cookieOf(await app.inject({
  method: "POST", url: "/api/auth/setup", payload: { email: "a@b.co", password: "password1" } }));

// Berurutan (bukan Promise.all): startedAt default now() dan urutan `desc` harus deterministik.
async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await beginSession({
      sessionId: `s${i}`, projectId: i % 2 ? "p2" : "p1", specId: `SPEC-${i}`, flow: "feature",
      kind: "spec", agent: "claude", model: "claude-opus-5", effort: "xhigh", cwd: `/r/.worktrees/s${i}`,
    });
  }
}

describe("GET/DELETE /api/terminal/history (SPEC-362)", () => {
  it("401 tanpa cookie", async () => {
    expect((await app.inject({ method: "GET", url: "/api/terminal/history" })).statusCode).toBe(401);
  });

  it("amplop paginasi: items dipotong, total tetap penuh", async () => {
    const cookie = await login();
    await seed(5);
    const r = await app.inject({ method: "GET", url: "/api/terminal/history?page=1&limit=2", headers: { cookie } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items).toHaveLength(2);
    expect(b.total).toBe(5);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(2);
  });

  it("filter projectId mempersempit total, bukan cuma halaman", async () => {
    const cookie = await login();
    await seed(4);
    const b = (await app.inject({ method: "GET", url: "/api/terminal/history?projectId=p2", headers: { cookie } })).json();
    expect(b.total).toBe(2);
    expect(b.items.every((r: { projectId: string }) => r.projectId === "p2")).toBe(true);
  });

  it("detail + transkrip; tanpa transkrip → 404", async () => {
    const cookie = await login();
    await beginSession({ sessionId: "t1", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "t1", exitCode: 0, transcript: "PENANDA-TRANSKRIP" });
    await beginSession({ sessionId: "t2", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "t2", exitCode: 0, transcript: null });
    const list = (await app.inject({ method: "GET", url: "/api/terminal/history", headers: { cookie } })).json();
    const withT = list.items.find((r: { sessionId: string }) => r.sessionId === "t1");
    const noT = list.items.find((r: { sessionId: string }) => r.sessionId === "t2");

    const d = await app.inject({ method: "GET", url: `/api/terminal/history/${withT.id}`, headers: { cookie } });
    expect(d.json().hasTranscript).toBe(true);

    const t = await app.inject({ method: "GET", url: `/api/terminal/history/${withT.id}/transcript`, headers: { cookie } });
    expect(t.statusCode).toBe(200);
    expect(t.json().text).toContain("PENANDA-TRANSKRIP");

    expect((await app.inject({ method: "GET", url: `/api/terminal/history/${noT.id}/transcript`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/terminal/history/tidak-ada", headers: { cookie } })).statusCode).toBe(404);
  });

  it("purge menolak tanpa parameter, lalu menghapus ber-scope", async () => {
    const cookie = await login();
    await seed(4);
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/history", headers: { cookie } })).statusCode).toBe(400);
    const r = await app.inject({ method: "DELETE", url: "/api/terminal/history?projectId=p1", headers: { cookie } });
    expect(r.json().purged).toBe(2);
    expect((await app.inject({ method: "GET", url: "/api/terminal/history", headers: { cookie } })).json().total).toBe(2);
  });

  // SPEC-844 · ADR-0125 · kedua kolom baru harus MENYEBERANG kawat: tanpa itu klien tak punya cara
  // membedakan sesi yang ditutup operator dari sesi yang mati bersama tmux.
  it("endedReason & reconciledAt sampai ke klien, dan membedakan kedua jalur tutup", async () => {
    const cookie = await login();
    await beginSession({ sessionId: "ditutup", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    await finishSession({ sessionId: "ditutup", exitCode: null, transcript: null });
    await beginSession({ sessionId: "zombie", projectId: "p1", kind: "shell", agent: "claude", cwd: "/r" });
    expect(await reconcileHistory([])).toBe(1);

    const items = (await app.inject({ method: "GET", url: "/api/terminal/history", headers: { cookie } }))
      .json().items as { sessionId: string; endedReason: string | null; reconciledAt: string | null }[];
    const by = Object.fromEntries(items.map((r) => [r.sessionId, r]));
    expect(by["ditutup"]).toMatchObject({ endedReason: "closed", reconciledAt: null });
    expect(by["zombie"]!.endedReason).toBe("reconciled");
    expect(Date.parse(by["zombie"]!.reconciledAt!)).toBeGreaterThan(0);
  });

  it("before bukan tanggal valid → 400", async () => {
    const cookie = await login();
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/history?before=bukan-tanggal", headers: { cookie } })).statusCode).toBe(400);
  });
});
