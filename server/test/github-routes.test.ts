import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Jalur jaringan disuntik lewat mock modul — tak ada test yang memukul api.github.com.
vi.mock("../src/services/github-fetch", async (orig) => {
  const real = await orig<typeof import("../src/services/github-fetch")>();
  return { ...real, fetchIssues: vi.fn(async () => ({
    ok: true as const, via: "gh" as const, skippedPullRequests: 2,
    issues: [{ number: 9, title: "Issue sembilan", body: "isi", authorLogin: "wulanrlestari",
      labels: [], url: "https://github.com/denameidina/hanoman/issues/9", issueState: "open" as const,
      issueCreatedAt: "2026-07-30T11:57:43Z", issueUpdatedAt: "2026-07-30T11:57:43Z" }],
  })) };
});

const { buildApp } = await import("../src/app");
const { prisma } = await import("../src/db");

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.githubIssue.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => { await app.ready(); await clean(); });
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "r-p", name: "P", desc: "", kind: "existing",
    gitRemote: "https://github.com/denameidina/hanoman" } });
  await prisma.project.create({ data: { id: "r-none", name: "N", desc: "", kind: "existing" } });
});
afterAll(async () => { await clean(); await app.close(); });

const pull = (p = "r-p") =>
  app.inject({ method: "POST", url: `/api/projects/${p}/github/pull`, payload: {} });

describe("SPEC-471 · endpoint tarik & triase issue", () => {
  it("POST pull → 200 dengan ringkasan, termasuk skippedPullRequests", async () => {
    const res = await pull();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ repo: "denameidina/hanoman", pulled: 1, created: 1, updated: 0, skippedPullRequests: 2 });
  });

  it("POST pull pada project tanpa remote → 400 dengan sebab yang bisa dibaca", async () => {
    const res = await pull("r-none");
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("remote GitHub");
  });

  it("POST pull project tak dikenal → 404", async () => {
    expect((await pull("tidak-ada")).statusCode).toBe(404);
  });

  it("GET daftar issue, bisa difilter status", async () => {
    await pull();
    const all = await app.inject({ method: "GET", url: "/api/projects/r-p/github/issues" });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(1);
    expect(all.json().items[0]).toMatchObject({ number: 9, status: "new", specId: null });
    const none = await app.inject({ method: "GET", url: "/api/projects/r-p/github/issues?status=accepted" });
    expect(none.json().items).toHaveLength(0);
  });

  // SPEC-523 · amplop Paginated (cermin GET /tickets). `total` menghitung seluruh baris tersaring.
  it("GET issue beramplop Paginated dan menghormati page/limit", async () => {
    for (let i = 1; i <= 5; i++) {
      await prisma.githubIssue.create({
        data: {
          id: `r-p:denameidina/hanoman#${i}`, projectId: "r-p", repoSlug: "denameidina/hanoman",
          number: i, title: `issue ${i}`, body: "", authorLogin: "rekan", labels: [],
          url: `https://github.com/denameidina/hanoman/issues/${i}`, issueState: "open",
          issueCreatedAt: new Date(), issueUpdatedAt: new Date(), pulledAt: new Date(),
        },
      });
    }
    const r = await app.inject({ method: "GET", url: "/api/projects/r-p/github/issues?page=1&limit=2" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items.length).toBe(2);
    expect(b.total).toBe(5);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(2);
  });

  it("POST accept satu → 201 + Spec, accept ulang → 200 alreadyPromoted", async () => {
    await pull();
    const id = "r-p:denameidina/hanoman#9";
    const first = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    expect(first.statusCode).toBe(201);
    expect(first.json().spec.source).toBe("qa");
    const second = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyPromoted).toBe(true);
    expect(await prisma.spec.count()).toBe(1);
  });

  it("POST accept massal → satu Spec per issue", async () => {
    await pull();
    await prisma.githubIssue.create({ data: {
      id: "r-p:denameidina/hanoman#6", projectId: "r-p", repoSlug: "denameidina/hanoman", number: 6,
      title: "Enam", body: "b", authorLogin: "a", labels: [], url: "u", issueState: "open",
      issueCreatedAt: new Date(), issueUpdatedAt: new Date(), pulledAt: new Date() } });
    const res = await app.inject({ method: "POST", url: "/api/github-issues/accept",
      payload: { ids: ["r-p:denameidina/hanoman#9", "r-p:denameidina/hanoman#6"] } });
    expect(res.statusCode).toBe(201);
    expect(res.json().created).toHaveLength(2);
    expect(await prisma.spec.count()).toBe(2);
  });

  it("POST reject → status rejected", async () => {
    await pull();
    const id = "r-p:denameidina/hanoman#9";
    const res = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/reject`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
  });

  it("POST unlink → specId lepas, status kembali new", async () => {
    await pull();
    const id = "r-p:denameidina/hanoman#9";
    await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/accept`, payload: {} });
    const res = await app.inject({ method: "POST", url: `/api/github-issues/${encodeURIComponent(id)}/unlink`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "new", specId: null });
  });

  it("issue tak dikenal → 404", async () => {
    expect((await app.inject({ method: "POST", url: "/api/github-issues/tidak-ada/accept", payload: {} })).statusCode).toBe(404);
  });
});
