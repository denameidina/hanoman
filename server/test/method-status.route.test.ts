import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS, methodSkills } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { killAll } from "../src/services/pty";
import { resetDb, makeProject } from "./factory";

const app = buildApp({ requireAuth: false });
let repoDir = "";
let claudeHome = "";
let codexHome = "";

const skill = (dir: string, name: string) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\n`);
};

beforeAll(async () => {
  killAll();
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-method-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t",
    "commit", "-qm", "init", "--allow-empty"], { cwd: repoDir });
  await resetDb();
  await makeProject({ id: "p1", repoDir });
  await app.ready();
});
afterAll(async () => { killAll(); await app.close(); });

// CATATAN VERIFIKASI SPEC-739: akar skill selalu disuntik lewat env ke direktori sementara,
// TIDAK PERNAH HOME mesin yang menjalankan test — kalau tidak, hijau/merah bergantung siapa
// yang menjalankan suite-nya.
beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "hn-claude-"));
  codexHome = mkdtempSync(join(tmpdir(), "hn-codex-"));
  process.env.HANOMAN_CLAUDE_HOME = claudeHome;
  process.env.HANOMAN_CODEX_HOME = codexHome;
});
afterEach(() => {
  delete process.env.HANOMAN_CLAUDE_HOME;
  delete process.env.HANOMAN_CODEX_HOME;
  rmSync(claudeHome, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

const get = () => app.inject({ method: "GET", url: "/api/methods/status" });

describe("GET /api/methods/status (SPEC-739)", () => {
  it("melaporkan setiap metode untuk KEDUA agen", async () => {
    const res = await get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const pairs = body.methods.map((m: { method: string; agent: string }) => `${m.method}/${m.agent}`);
    for (const id of Object.keys(METHODS)) {
      expect(pairs).toContain(`${id}/claude`);
      expect(pairs).toContain(`${id}/codex`);
    }
    expect(body.agents.map((a: { agent: string }) => a.agent).sort()).toEqual(["claude", "codex"]);
  });

  it("akar kosong → semua metode belum siap, dengan sebab spesifik", async () => {
    const body = (await get()).json();
    const sp = body.methods.find((m: { method: string; agent: string }) =>
      m.method === "superpowers" && m.agent === "claude");
    expect(sp.ready).toBe(false);
    expect(sp.missingPackages).toContain("superpowers");
    expect(sp.missingSkills.length).toBeGreaterThan(0);
    expect(sp.install.length).toBeGreaterThan(0);
  });

  // Gejala paling mahal spec ini: mengira "terpasang" satu bit global. Status wajib per-agen.
  it("siap untuk claude, kosong untuk codex — di mesin yang sama", async () => {
    const dir = join(claudeHome, "plugins", "cache", "mkt", "superpowers", "6.0.3", "skills");
    for (const s of methodSkills(METHODS.superpowers!)) skill(dir, s.split(":")[1]!);
    const body = (await get()).json();
    const find = (agent: string) => body.methods.find(
      (m: { method: string; agent: string }) => m.method === "superpowers" && m.agent === agent);
    expect(find("claude").ready).toBe(true);
    expect(find("codex").ready).toBe(false);
    expect(find("codex").missingPackages).toContain("superpowers");
  });

  // Diturunkan LIVE tiap request: kolom status akan basi persis saat ia paling menyesatkan —
  // sesudah operator memasang skill-nya.
  it("status berubah tanpa restart begitu skill muncul di disk", async () => {
    const codexSp = (body: { methods: Array<{ method: string; agent: string; ready: boolean }> }) =>
      body.methods.find((m) => m.method === "superpowers" && m.agent === "codex")!;
    expect(codexSp((await get()).json()).ready).toBe(false);
    const dir = join(codexHome, "plugins", "cache", "mkt", "superpowers", "1.0.0", "skills");
    for (const s of methodSkills(METHODS.superpowers!)) skill(dir, s.split(":")[1]!);
    expect(codexSp((await get()).json()).ready).toBe(true);
  });
});
