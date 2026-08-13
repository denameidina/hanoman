import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { METHODS, methodSkills } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { killAll, killSession, listSessions, capturePane } from "../src/services/pty";
import { installCommand } from "../src/services/method-status";
import { resetDb, makeProject } from "./factory";

const app = buildApp({ requireAuth: false });
let repoDir = "";
let claudeHome = "";
let codexHome = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

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

// SPEC-739 · ADR-0114 · pemasangan lewat SESI TERMINAL (ADR-0056). Server tak pernah memasang
// apa pun sendiri — yang menjalankan perintah adalah shell di dalam pane, ditonton operator.
describe("POST /terminal/sessions · install metode (SPEC-739)", () => {
  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload });

  it("shell tanpa `install` tetap shell mentah (perilaku SPEC-236 utuh)", async () => {
    const res = await post({ project: "p1", shell: true });
    expect(res.statusCode).toBe(201);
    killSession(res.json().id);
  });

  // Bukti diambil dari PANE-nya, bukan dari argv yang dirakit helper: helper murninya sudah
  // diuji sendiri di bawah, dan yang bisa salah justru sambungan route → pane (pola SPEC-543).
  it("`install` melahirkan pane yang menjalankan perintah katalog", async () => {
    process.env.HANOMAN_SHELL = "/bin/echo";
    const res = await post({ project: "p1", shell: true, install: { method: "superpowers", agent: "codex" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const s = listSessions().find((x) => x.id === id)!;
    expect(s.flow).toBeUndefined();     // install bukan flow → mesin stage tak tersentuh
    expect(s.cwd).toBe(repoDir);        // pane lahir di checkout project, bukan .worktrees
    await waitFor(() => capturePane(id).includes("codex plugin add superpowers@openai-curated"));
    killSession(id);
    delete process.env.HANOMAN_SHELL;
  });

  // Sengaja TIDAK lenient seperti `resolveMethod`: resolusi longgar benar untuk MEMBACA, tapi ini
  // TINDAKAN — memasang default karena metodenya tak dikenal berarti menjalankan perintah yang
  // tak diminta siapa pun.
  it("metode tak dikenal → 400, bukan jatuh ke default", async () => {
    const res = await post({ project: "p1", shell: true, install: { method: "tak-ada", agent: "claude" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("tak-ada");
  });
});

describe("installCommand (SPEC-739)", () => {
  it("merangkai perintah katalog dan menyerahkan pane ke operator", () => {
    const argv = installCommand(METHODS.superpowers!, "codex", "/bin/zsh");
    expect(argv[0]).toBe("/bin/zsh");
    expect(argv[1]).toBe("-lc");
    expect(argv[2]).toContain("codex plugin add superpowers@openai-curated");
    expect(argv[2]).toContain("exec '/bin/zsh' -l");
  });
  it("perintah jamak dirangkai `&&` — langkah kedua tak jalan bila yang pertama gagal", () => {
    const argv = installCommand(METHODS.superpowers!, "claude", "/bin/zsh");
    expect(argv[2]).toContain(" && ");
  });
});
