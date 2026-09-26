// server/test/skills.route.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const root = mkdtempSync(join(tmpdir(), "skr-"));
const home = join(root, "hanoman"), osHome = join(root, "home"), repo = join(root, "repo");
process.env.HANOMAN_HOME = home;
process.env.HANOMAN_CLAUDE_HOME = join(osHome, ".claude");
process.env.HANOMAN_CODEX_HOME = join(osHome, ".codex");
process.env.HANOMAN_AGENTS_HOME = join(osHome, ".agents");

const app = buildApp({ requireAuth: false });
const skill = (dir: string, name: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Use when x\n---\n`);
};
const k = encodeURIComponent;

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web", repoDir: repo } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "web", repoDir: join(root, "hilang") } });
});
afterAll(async () => { await prisma.project.deleteMany(); });

describe("capabilityForRoute · skills", () => {
  it("dipetakan menurut method", () => {
    expect(capabilityForRoute("GET", "/api/skills")).toBe("skills:read");
    expect(capabilityForRoute("PUT", "/api/skills/x/file")).toBe("skills:write");
    expect(capabilityForRoute("POST", "/api/skills")).toBe("skills:write");
    expect(capabilityForRoute("DELETE", "/api/skills/x")).toBe("skills:write");
  });
});

describe("GET /api/skills", () => {
  it("scope=all mengelompokkan global + per project; repo hilang → error per section", async () => {
    skill(join(home, "skills/g1"), "g1");
    skill(join(repo, ".claude/skills/p-a"), "p-a");
    const r = await app.inject({ method: "GET", url: "/api/skills?scope=all" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.global.map((s: { name: string }) => s.name)).toContain("g1");
    const p1 = body.projects.find((p: { projectId: string }) => p.projectId === "p1");
    expect(p1.skills.map((s: { name: string }) => s.name)).toEqual(["p-a"]);
    const p2 = body.projects.find((p: { projectId: string }) => p.projectId === "p2");
    expect(p2.error).toMatch(/repo/);
  });
  it("projectId menggabung global + project dengan shadowedBy", async () => {
    skill(join(home, "skills/dup"), "dup");
    skill(join(repo, ".agents/skills/dup"), "dup");
    const r = await app.inject({ method: "GET", url: "/api/skills?projectId=p1" });
    const g = r.json().find((s: { layer: string; name: string }) => s.layer === "hanoman" && s.name === "dup");
    expect(g.shadowedBy).toBe("project~p1~.agents~dup");
  });
});

describe("berkas skill", () => {
  it("tree, baca, tulis dengan hash, 409 bila basi", async () => {
    skill(join(home, "skills/ed"), "ed");
    const key = k("hanoman~-~hanoman~ed");
    const t = await app.inject({ method: "GET", url: `/api/skills/${key}/tree` });
    expect(t.json().files[0].path).toBe("SKILL.md");
    const f = await app.inject({ method: "GET", url: `/api/skills/${key}/file?path=SKILL.md` });
    const { hash } = f.json();
    const w = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "---\nname: ed\ndescription: baru\n---\n", baseHash: hash } });
    expect(w.statusCode).toBe(200);
    const stale = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "x", baseHash: hash } });
    expect(stale.statusCode).toBe(409);
  });
  it("traversal → 400, skill tak dikenal → 404", async () => {
    skill(join(home, "skills/ed"), "ed");
    const bad = await app.inject({ method: "GET", url: `/api/skills/${k("hanoman~-~hanoman~ed")}/file?path=../../x` });
    expect(bad.statusCode).toBe(400);
    const nf = await app.inject({ method: "GET", url: `/api/skills/${k("hanoman~-~hanoman~nope")}/tree` });
    expect(nf.statusCode).toBe(404);
  });
  it("plugin baca-saja → 403", async () => {
    skill(join(osHome, ".claude/plugins/cache/m/pkg/1/skills/pl"), "pl");
    const key = k("plugin~-~plugin:pkg~pl");
    const r = await app.inject({ method: "PUT", url: `/api/skills/${key}/file?path=SKILL.md`, payload: { content: "x", baseHash: null } });
    expect(r.statusCode).toBe(403);
    const d = await app.inject({ method: "DELETE", url: `/api/skills/${key}` });
    expect(d.statusCode).toBe(403);
  });
  it("entry: buat & hapus berkas", async () => {
    skill(join(home, "skills/ed"), "ed");
    const key = k("hanoman~-~hanoman~ed");
    expect((await app.inject({ method: "POST", url: `/api/skills/${key}/entry`, payload: { path: "references/a.md", kind: "file" } })).statusCode).toBe(201);
    expect(existsSync(join(home, "skills/ed/references/a.md"))).toBe(true);
    expect((await app.inject({ method: "DELETE", url: `/api/skills/${key}/entry?path=references` })).statusCode).toBe(204);
  });
});

describe("siklus hidup skill", () => {
  it("POST membuat skill di lapis hanoman / user / project", async () => {
    const a = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "baru", description: "Use when z" } });
    expect(a.statusCode).toBe(201);
    expect(a.json().key).toBe("hanoman~-~hanoman~baru");
    const b = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "user", source: ".agents", name: "u1", description: "d" } });
    expect(existsSync(join(osHome, ".agents/skills/u1/SKILL.md"))).toBe(true);
    expect(b.json().source).toBe(".agents");
    const c = await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "project", projectId: "p1", source: ".codex", name: "pc", description: "d" } });
    expect(existsSync(join(repo, ".codex/skills/pc/SKILL.md"))).toBe(true);
    expect(c.json().key).toBe("project~p1~.codex~pc");
  });
  it("POST menolak nama tak sah (400), nama terpakai (409), layer plugin (400)", async () => {
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "Bad", description: "d" } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "dua", description: "d" } });
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "hanoman", name: "dua", description: "d" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/skills", payload: { layer: "plugin", name: "x", description: "d" } })).statusCode).toBe(400);
  });
  it("fork plugin → hanoman; delete", async () => {
    skill(join(osHome, ".claude/plugins/cache/m/pkg/1/skills/pl"), "pl");
    const f = await app.inject({ method: "POST", url: `/api/skills/${k("plugin~-~plugin:pkg~pl")}/fork`, payload: { layer: "hanoman", name: "pl-saya" } });
    expect(f.statusCode).toBe(201);
    expect(readFileSync(join(home, "skills/pl-saya/SKILL.md"), "utf8")).toContain("name: pl-saya");
    expect((await app.inject({ method: "DELETE", url: `/api/skills/${k("hanoman~-~hanoman~pl-saya")}` })).statusCode).toBe(204);
    expect(existsSync(join(home, "skills/pl-saya"))).toBe(false);
  });
});
