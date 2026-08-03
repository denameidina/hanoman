import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec, makeRepoWithTags, makeRepoWithBranches } from "./factory";

// Agen tak pernah benar-benar di-spawn dalam test route: `think` distub di titik cekiknya.
vi.mock("../src/services/lead/brain", async (orig) => ({
  ...(await orig<typeof import("../src/services/lead/brain")>()),
  think: vi.fn(async () => "# Changelog — uji\n\n- **Butir** — manfaatnya.\n"),
}));

const app = buildApp({ requireAuth: false });
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

// Anotasi tipe wajib: `inject` punya overload void/Promise/Chain, dan tanpa ini pemanggil
// helper melihat union yang tak punya `.json()` maupun `.statusCode`.
const gen = (body: Record<string, unknown>, id = "p1"): Promise<LightMyRequestResponse> =>
  app.inject({ method: "POST", url: `/api/projects/${id}/changelog`, payload: body });

describe("POST /projects/:id/changelog", () => {
  it("membangkitkan & menyimpan (201)", async () => {
    const res = await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j.mode).toBe("backlog");
    expect(j.generator).toBe("agent");
    expect(j.body).toContain("Butir");
    expect(await prisma.changelog.count()).toBe(1);
  });

  it("from > to ditolak 400 sebelum menyentuh repo", async () => {
    const res = await gen({ mode: "backlog", from: "2026-08-02", to: "2026-08-01" });
    expect(res.statusCode).toBe(400);
  });

  it("rentang kosong = 422 berpesan, bukan 500", async () => {
    const res = await gen({ mode: "backlog", from: "2026-01-01", to: "2026-01-31" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/tak ada backlog/i);
  });

  it("project tanpa repo, mode commit = 422 berpesan", async () => {
    const res = await gen({ mode: "commit", fromSha: "aaaa", toSha: "bbbb" });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/belum ditautkan/i);
  });

  it("repo tanpa tag, mode versi = 422 berpesan", async () => {
    await makeProject({ id: "p2", name: "p2", repoDir: makeRepoWithBranches() });
    const res = await gen({ mode: "version", toTag: "v1.0.0" }, "p2");
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/belum punya tag/i);
  });

  it("project tak ada = 404", async () => {
    const res = await gen({ mode: "backlog" }, "entah");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /projects/:id/changelog", () => {
  it("daftar terbaru lebih dulu, terpaginasi", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    const res = await app.inject({ url: "/api/projects/p1/changelog?limit=1&page=1" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.total).toBe(2);
    expect(j.items).toHaveLength(1);
  });

  // SPEC-519 · cari dijalankan SEBELUM paginate, jadi `total` ikut menyusut — kalau tidak,
  // Pager menjanjikan halaman yang isinya tak pernah ada.
  it("q menyaring dan total ikut hasil cari", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    await prisma.changelog.create({ data: {
      projectId: "p1", mode: "version", title: "v9.9.9", params: {},
      body: "- **Telegram** — notifikasi masuk.", generator: "agent", itemCount: 1 } });

    const hit = await app.inject({ url: "/api/projects/p1/changelog?q=telegram" });
    expect(hit.json().total).toBe(1);
    expect(hit.json().items[0].title).toBe("v9.9.9");

    const miss = await app.inject({ url: "/api/projects/p1/changelog?q=zzzz" });
    expect(miss.json().total).toBe(0);
    expect(miss.json().items).toEqual([]);
  });

  it("q kosong berperilaku persis seperti tanpa q", async () => {
    await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" });
    const withQ = await app.inject({ url: "/api/projects/p1/changelog?q=" });
    const without = await app.inject({ url: "/api/projects/p1/changelog" });
    expect(withQ.json().total).toBe(without.json().total);
    expect(withQ.json().total).toBe(1);
  });
});

describe("GET /projects/:id/changelog/sources", () => {
  it("repo bertag: daftar tag terbaru lebih dulu + rentang default", async () => {
    await makeProject({ id: "p3", name: "p3", repoDir: makeRepoWithTags({ "v1.0.0": ["a"], "v1.1.0": ["b"] }) });
    const res = await app.inject({ url: "/api/projects/p3/changelog/sources" });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.tags).toEqual(["v1.1.0", "v1.0.0"]);
    expect(j.reason).toBeNull();
    expect(j.defaultRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("repo belum ditautkan: 200 dengan alasan, BUKAN 500", async () => {
    const res = await app.inject({ url: "/api/projects/p1/changelog/sources" });
    expect(res.statusCode).toBe(200);
    expect(res.json().reason).toMatch(/belum ditautkan/i);
    expect(res.json().backlog.doneCount).toBe(1);
  });
});

describe("GET /projects/:id/changelog/:cid", () => {
  it("unduh .md membawa content-disposition dan isi apa adanya", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const res = await app.inject({ url: `/api/projects/p1/changelog/${made.id}?download=md` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.body).toBe(made.body);
  });

  it("tanpa query = JSON", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const res = await app.inject({ url: `/api/projects/p1/changelog/${made.id}` });
    expect(res.json().id).toBe(made.id);
  });

  it("id tak ada = 404", async () => {
    expect((await app.inject({ url: "/api/projects/p1/changelog/entah" })).statusCode).toBe(404);
  });
});

describe("DELETE /projects/:id/changelog/:cid", () => {
  it("menghapus (204) lalu 404", async () => {
    const made = (await gen({ mode: "backlog", from: "2026-07-01", to: "2026-07-31" })).json();
    const url = `/api/projects/p1/changelog/${made.id}`;
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url })).statusCode).toBe(404);
  });
});
