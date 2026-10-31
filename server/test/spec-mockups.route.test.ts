import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { checkAgentCapability } from "../src/services/agent-capabilities";

// ADR-0233 · mockup backlog dibaca dari docs/mockups/<spec-id>/ worktree sesi, jatuh ke checkout project.
const app = buildApp({ requireAuth: false });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const specId = "SPEC-9400";
let repo = "";
const repoMockups = () => join(repo, "docs", "mockups", "spec-9400");
const worktreeMockups = () => join(repo, ".worktrees", "spec-9400", "docs", "mockups", "spec-9400");
const list = () => app.inject({ method: "GET", url: `/api/specs/${specId}/mockups` });
const get = (name: string) => app.inject({ method: "GET", url: `/api/specs/${specId}/mockups/${name}` });

const clean = async () => {
  await prisma.spec.deleteMany({ where: { id: specId } });
  await prisma.project.deleteMany({ where: { id: "smk-proj" } });
};

beforeAll(async () => { await app.ready(); await clean(); });
beforeEach(async () => {
  await clean();
  repo = mkdtempSync(join(tmpdir(), "hanoman-mockups-"));
  await prisma.project.create({ data: { id: "smk-proj", name: "SMK", desc: "", kind: "existing", repoDir: repo } });
  await prisma.spec.create({ data: {
    id: specId, projectId: "smk-proj", title: "T", source: "brief",
    stage: "spec-ready", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(async () => { await clean(); await app.close(); });

describe("GET /specs/:id/mockups (ADR-0233)", () => {
  it("tanpa folder mockup → source null, daftar kosong", async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ source: null, dir: null, items: [] });
  });

  it("hanya checkout project → source repo, gambar saja, urut nama", async () => {
    mkdirSync(repoMockups(), { recursive: true });
    writeFileSync(join(repoMockups(), "02-b.png"), PNG);
    writeFileSync(join(repoMockups(), "01-a.png"), PNG);
    writeFileSync(join(repoMockups(), "catatan.md"), "bukan gambar");
    const body = (await list()).json();
    expect(body.source).toBe("repo");
    expect(body.dir).toBe(repoMockups());
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(["01-a.png", "02-b.png"]);
    expect(body.items[0]).toMatchObject({ size: PNG.length });
    expect(Date.parse(body.items[0].modifiedAt)).not.toBeNaN();
  });

  it("worktree sesi menang atas checkout project", async () => {
    mkdirSync(repoMockups(), { recursive: true });
    writeFileSync(join(repoMockups(), "01-lama.png"), PNG);
    mkdirSync(worktreeMockups(), { recursive: true });
    writeFileSync(join(worktreeMockups(), "01-baru.png"), PNG);
    const body = (await list()).json();
    expect(body.source).toBe("worktree");
    expect(body.items.map((i: { name: string }) => i.name)).toEqual(["01-baru.png"]);
  });

  it("spec tak ada → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/specs/SPEC-0/mockups" })).statusCode).toBe(404);
  });
});

describe("GET /specs/:id/mockups/:name (ADR-0233)", () => {
  beforeEach(() => {
    mkdirSync(repoMockups(), { recursive: true });
    writeFileSync(join(repoMockups(), "01-a.png"), PNG);
  });

  it("menyajikan gambar inline dengan header aman", async () => {
    const res = await get("01-a.png");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe('inline; filename="01-a.png"');
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it("nama tak valid, traversal, dan berkas bukan gambar → 404", async () => {
    writeFileSync(join(repoMockups(), "catatan.md"), "x");
    writeFileSync(join(repo, "rahasia.png"), PNG);
    for (const name of ["catatan.md", "..%2F..%2F..%2Frahasia.png", ".tersembunyi.png", "tak-ada.png"])
      expect((await get(name)).statusCode, name).toBe(404);
  });

  it("symlink yang keluar folder mockup → 404", async () => {
    const outside = mkdtempSync(join(tmpdir(), "hanoman-luar-"));
    writeFileSync(join(outside, "luar.png"), PNG);
    symlinkSync(join(outside, "luar.png"), join(repoMockups(), "02-link.png"));
    expect((await get("02-link.png")).statusCode).toBe(404);
    rmSync(outside, { recursive: true, force: true });
  });

  it("capability: backlog:read cukup untuk daftar & ambil gambar", () => {
    const read = ["backlog:read"];
    expect(checkAgentCapability(read, "GET", `/api/specs/${specId}/mockups`)).toEqual({ ok: true });
    expect(checkAgentCapability(read, "GET", `/api/specs/${specId}/mockups/01-a.png`)).toEqual({ ok: true });
    expect(checkAgentCapability([], "GET", `/api/specs/${specId}/mockups`))
      .toMatchObject({ ok: false, status: 403, need: "backlog:read" });
  });
});
