import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, appendFileSync, existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { killAll, killSession, listSessions, promptFilePath, createSession as createSessionSvc } from "../src/services/pty";
import { phaseFilePath } from "../src/services/session-phases";
import { sweepRepo, __resetReaper } from "../src/services/worktree-reaper";
import { resetDb, makeProject, makeSpec } from "./factory";

// Lihat pty.test.ts: /bin/cat mati karena --dangerously-skip-permissions ilegal baginya.
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

const app = buildApp({ requireAuth: false });
let origin = "";
let repoDir = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

type Frame = { t: string; d?: string; code?: number; seq?: number };
function connect(id: string) {
  const ws = new WebSocket(`ws://${origin}/api/terminal/sessions/${id}/ws`);
  const frames: Frame[] = [];
  ws.on("message", (raw: Buffer) => { frames.push(JSON.parse(raw.toString())); });
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const data = () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");
  return { ws, frames, opened, data };
}
const createSession = async () => {
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p1" } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

beforeAll(async () => {
  // Sesi tmux test selamat antar-run (ADR-0016) sementara repoDir lahir baru: sesi basi
  // ber-id sama (spec-900, reverse-p1) membuat jalur idempoten ADR-0015 melewatkan
  // pembuatan worktree. File ini harus mandiri, bukan berharap pty.test.ts jalan duluan.
  killAll();
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-term-"));
  // `git worktree add --detach <path> <base>` butuh basis yang bisa di-resolve: repo yang
  // baru di-init belum punya satu commit pun.
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t",
    "commit", "-qm", "init", "--allow-empty"], { cwd: repoDir });
  await resetDb();
  await makeProject({ id: "p1", repoDir });
  await makeProject({ id: "p2", name: "p2", repoDir: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("terminal routes", () => {
  it("streams pty output and the exit code over the websocket", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("--dangerously-skip-permissions");
    expect(c.frames.find((f) => f.t === "exit")).toEqual({ t: "exit", code: 0 });
    c.ws.close();
  });

  it("forwards stdin, and replays scrollback to a reconnecting client", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const first = connect(id);
    await first.opened;
    first.ws.send(JSON.stringify({ t: "in", d: "halo\n" }));
    await waitFor(() => first.data().includes("halo"));
    first.ws.close();

    const second = connect(id);
    await second.opened;
    await waitFor(() => second.data().includes("halo"));
    second.ws.close();
  });

  // SPEC-812 · aliran terminal terukur 26× kompresibel, dan lewat tunnel ke ponsel ia satu-satunya
  // hal yang mengisi antrean kirim di depan echo ketikan. Kompresinya dinegosiasikan di handshake,
  // jadi yang diuji adalah handshake-nya — bukan opsi yang dilewatkan ke `ws`.
  it("menegosiasikan permessage-deflate pada socket terminal", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    expect(c.ws.extensions).toContain("permessage-deflate");
    c.ws.close();
  });

  // SPEC-878 · ADR-0134 · ack adalah satu-satunya titik nol jam TTL echo prediktif di klien. Ia
  // dibalas SESUDAH writeTo, jadi maknanya "server menerima frame ini dan menyerahkannya ke pty".
  // `seq` opsional supaya klien lama tak berubah perilakunya.
  it("mengakui frame input yang bernomor, dan hanya yang bernomor", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    c.ws.send(JSON.stringify({ t: "in", d: "a", seq: 1 }));
    c.ws.send(JSON.stringify({ t: "in", d: "b", seq: 2 }));
    c.ws.send(JSON.stringify({ t: "in", d: "c" }));
    c.ws.send(JSON.stringify({ t: "in", d: "\nACK-PROBE-OK\n" }));
    await waitFor(() => c.data().includes("ACK-PROBE-OK"));
    expect(c.frames.filter((f) => f.t === "ack").map((f) => f.seq)).toEqual([1, 2]);
    c.ws.close();
  });

  it("keeps accepting a normal rapid-typing burst beyond 120 input frames", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    let closed: { code: number; reason: string } | undefined;
    c.ws.on("close", (code, reason) => { closed = { code, reason: reason.toString() }; });

    for (let i = 0; i < 120; i += 1) c.ws.send(JSON.stringify({ t: "in", d: "a" }));
    c.ws.send(JSON.stringify({ t: "in", d: "\nBURST-INPUT-OK\n" }));

    await waitFor(() => c.data().includes("BURST-INPUT-OK") || closed !== undefined, 1_500);
    expect({ marker: c.data().includes("BURST-INPUT-OK"), closed })
      .toEqual({ marker: true, closed: undefined });
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it("accepts a resize without killing the session", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const c = connect(id);
    await c.opened;
    c.ws.send(JSON.stringify({ t: "resize", cols: 120, rows: 40 }));
    c.ws.send(JSON.stringify({ t: "in", d: "masih hidup\n" }));
    await waitFor(() => c.data().includes("masih hidup"));
    expect(c.frames.some((f) => f.t === "exit")).toBe(false);
    c.ws.close();
  });

  it("lists sessions, and DELETE removes one exactly once", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    const list = await app.inject({ url: "/api/terminal/sessions" });
    expect(list.json().map((s: { id: string }) => s.id)).toContain(id);

    const del = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(del.statusCode).toBe(202);
    const again = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(again.statusCode).toBe(404);

    const after = await app.inject({ url: "/api/terminal/sessions" });
    expect(after.json().map((s: { id: string }) => s.id)).not.toContain(id);
  });

  it("404s an unknown project and 400s a project with no repoDir", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "nope" } });
    expect(missing.statusCode).toBe(404);
    const noDir = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p2" } });
    expect(noDir.statusCode).toBe(400);
  });

  // SPEC-376 · ADR-0080 · body verifyScope divalidasi di batas HTTP. Nilai tak dikenal ditolak
  // zod SEBELUM lookup spec, jadi 400 (bukan 404) walau spec-nya memang tak ada — itulah yang
  // membedakan "bentuk body salah" dari "spec tak ketemu".
  it("POST /terminal/sessions menolak verifyScope yang tak dikenal", async () => {
    const bad = await app.inject({
      method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-TIDAKADA", flow: "feature", verifyScope: "sebagian" },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-TIDAKADA", flow: "feature", verifyScope: "changed" },
    });
    expect(ok.statusCode).toBe(404);   // bentuk body sah; spec-nya yang tak ada
  });

  // SPEC-517 · runtime dipilih saat sesi terminal dibuat. `/bin/echo` mencetak argv-nya ke pane,
  // jadi frame WS adalah bukti langsung argv yang benar-benar lahir.
  it("override model/effort claude ikut ke argv pane", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "claude", model: "claude-haiku-4-5", effort: "low" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("--model claude-haiku-4-5");
    expect(c.data()).toContain("--effort low");
    c.ws.close();
    killSession(id);
  });

  it("override agen codex memakai biner & bentuk flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "codex", model: "gpt-5.6-sol", effort: "high" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("-m gpt-5.6-sol");
    expect(c.data()).toContain("model_reasoning_effort");
    c.ws.close();
    killSession(id);
    delete process.env.HANOMAN_CODEX_BIN;
  });

  it("agen di luar katalog → 400, tak ada sesi yang lahir", async () => {
    const before = listSessions().length;
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", agent: "gemini" } });
    expect(res.statusCode).toBe(400);
    expect(listSessions().length).toBe(before);
  });

  // Gerbang `flow: z.undefined()` pada varian plain, dilihat dari sisi route: body prd yang cacat
  // harus ditolak, bukan diam-diam membuka terminal biasa.
  it("flow prd tanpa brief → 400, bukan terminal biasa", async () => {
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", flow: "prd" } });
    expect(res.statusCode).toBe(400);
  });

  it("closes the socket for an unknown session id", async () => {
    const c = connect("tidakada");
    c.opened.catch(() => {}); // socket ini memang ditutup; jangan biarkan rejection-nya menganggur
    const code = await new Promise<number>((res) => c.ws.on("close", (n: number) => res(n)));
    expect(code).toBe(4004);
  });

  // SPEC-230 · sesi project-level (PRD) membawa branch integrasi; disimpan @hanoman_branch
  // dan disurfacekan lewat listSessions/SessionDTO agar frontend & endpoint tahu apa yang di-merge.
  it("createSession menyimpan branch dan mengembalikannya di listSessions", () => {
    const wt = join(repoDir, ".worktrees", "prd-branchtest");
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repoDir });
    const s = createSessionSvc("p1", wt, { id: "prd-branchtest", flow: "prd", branch: "prd/branchtest", command: ["/bin/sleep", "30"] });
    const found = listSessions().find((x) => x.id === s.id);
    expect(found?.branch).toBe("prd/branchtest");
    killSession("prd-branchtest");
    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repoDir });
  });
});

// SPEC-236 · terminal biasa NON-claude: shell mentah di repoDir project (bukan TUI Claude).
describe("terminal routes · shell non-claude (SPEC-236)", () => {
  const FAKE_SHELL = fileURLToPath(new URL("./fixtures/fake-shell.sh", import.meta.url));
  const startShell = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, shell: true } });

  it("POST { project, shell:true } → 201, sesi tanpa flow di repoDir, menjalankan shell (bukan claude)", async () => {
    process.env.HANOMAN_SHELL = FAKE_SHELL;
    const res = await startShell("p1");
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const s = listSessions().find((x) => x.id === id)!;
    expect(s.flow).toBeUndefined();          // shell bukan flow → mesin stage tak tersentuh
    expect(s.cwd).toBe(repoDir);             // jalan di working tree project, bukan .worktrees
    const c = connect(id);
    await c.opened;
    await waitFor(() => c.data().includes("SHELL-BIASA-SIAP"));
    expect(c.data()).not.toContain("--dangerously-skip-permissions"); // bukan argv claude
    c.ws.close();
    await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
  });

  // SPEC-362 · REGRESI (kerusakan data nyata): menutup terminal biasa pernah MENGHAPUS checkout
  // project-nya sendiri. Guard lama menguji substring "/.worktrees/" pada cwd, bukan hubungan
  // cwd↔repoDir — jadi project yang di-bind ke checkout DI BAWAH .worktrees/ (persis keadaan saat
  // hanoman didogfood di worktree-nya sendiri) lolos ke removeWorktree(repoDir, repoDir).
  it("menutup shell TIDAK menghapus repoDir project, walau repoDir ada di bawah .worktrees/", async () => {
    process.env.HANOMAN_SHELL = FAKE_SHELL;
    const parent = mkdtempSync(join(tmpdir(), "hanoman-dogfood-"));
    const nested = join(parent, ".worktrees", "spec-362");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: nested });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t",
      "commit", "-qm", "init", "--allow-empty"], { cwd: nested });
    writeFileSync(join(nested, "PENANDA.txt"), "jangan hapus saya");
    await makeProject({ id: "p-dogfood", name: "p-dogfood", repoDir: nested });

    const res = await startShell("p-dogfood");
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(listSessions().find((x) => x.id === id)!.cwd).toBe(nested);

    const del = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });
    expect(del.statusCode).toBe(202);
    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(nested, "PENANDA.txt"))).toBe(true);
  });

  it("shell untuk project tanpa repoDir → 400 (bukan 422)", async () => {
    const res = await startShell("p2");   // p2.repoDir = null
    expect(res.statusCode).toBe(400);
    expect(res.json().needsBind).toBe(true);
  });

  it("shell untuk project tak dikenal → 404", async () => {
    expect((await startShell("nope")).statusCode).toBe(404);
  });

  it("DELETE sesi shell tidak menghapus/mengganggu working tree project", async () => {
    process.env.HANOMAN_SHELL = FAKE_SHELL;
    const id = (await startShell("p1")).json().id as string;
    expect(existsSync(repoDir)).toBe(true);
    expect((await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` })).statusCode).toBe(202);
    expect(existsSync(repoDir)).toBe(true);           // repoDir utuh
    expect(existsSync(join(repoDir, ".git"))).toBe(true);
  });
});

// SPEC-230: sesi project-level (PRD) mendapat review + integrate ber-skop sesi (keyed ke
// worktree + branch sesi, tanpa Spec).
describe("terminal routes · sesi PRD review + integrate", () => {
  // Buat sesi prd langsung lewat service (hindari spawn claude sungguhan): worktree + branch,
  // command sleep supaya sesi hidup selama assert.
  const mkPrd = (slug: string) => {
    const id = `prd-${slug}`;
    const wt = join(repoDir, ".worktrees", id);
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "HEAD"], { cwd: repoDir });
    writeFileSync(join(wt, `docs-prd-${slug}.md`), `# PRD ${slug}\n`);
    createSessionSvc("p1", wt, { id, flow: "prd", branch: `prd/${slug}`, command: ["/bin/sleep", "30"] });
    return id;
  };
  const cleanup = (id: string) => {
    killSession(id);
    const wt = join(repoDir, ".worktrees", id);
    if (existsSync(wt)) execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repoDir });
  };

  it("GET /:id/review mengembalikan diff worktree sesi PRD", async () => {
    const id = mkPrd("rev");
    const res = await app.inject({ url: `/api/terminal/sessions/${id}/review` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.changed.some((c: { path: string }) => c.path === "docs-prd-rev.md")).toBe(true);
    cleanup(id);
  });

  it("GET /:id/review setelah worktree lenyap (sesi masih terdaftar) → 409, bukan 500", async () => {
    const id = mkPrd("gone");
    // Worktree dihapus tapi sesi masih di tmux (mis. proses exited, DELETE belum jalan): cwd
    // sesi menunjuk direktori yang lenyap → 409 ramah (empty-state ReviewScreen), bukan 500.
    execFileSync("git", ["worktree", "remove", "--force", join(repoDir, ".worktrees", id)], { cwd: repoDir });
    const res = await app.inject({ url: `/api/terminal/sessions/${id}/review` });
    expect(res.statusCode).toBe(409);
    killSession(id);
  });

  it("POST /:id/integrate branch belum ada → 409", async () => {
    const id = mkPrd("noremote");
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/integrate`,
      payload: { op: "merge", target: "origin:main" } });
    expect(res.statusCode).toBe(409);
    cleanup(id);
  });

  it("POST /:id/integrate op/target invalid → 400", async () => {
    const id = mkPrd("badreq");
    const res = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${id}/integrate`,
      payload: { op: "nope", target: "x" } });
    expect(res.statusCode).toBe(400);
    cleanup(id);
  });
});

// SPEC-162: terminal membuka sesi claude interaktif untuk sebuah backlog item, di worktree-nya.
describe("terminal routes · sesi backlog", () => {
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });

  it("POST { spec, flow } membuat worktree + sesi bernama spec-nya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-900", projectId: "p1", objective: "kerjakan sesuatu" });
    const res = await start("SPEC-900");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("spec-900");
    expect(existsSync(join(repoDir, ".worktrees", "spec-900"))).toBe(true);
  });

  // SPEC-176 · ADR-0030: SHA start/end disimpan agar review backlog done tak bergantung grep.
  it("menyimpan baseSha saat start dan headSha saat DELETE", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-930", projectId: "p1", stage: "planned" });
    await start("SPEC-930");
    const afterStart = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-930" } });
    expect(afterStart.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(afterStart.headSha).toBeNull();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-930" });
    const afterDel = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-930" } });
    expect(afterDel.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("POST kedua untuk spec yang sama mengembalikan sesi yang sama, bukan yang kedua", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-901", projectId: "p1" });
    const a = await start("SPEC-901", "qa");
    const b = await start("SPEC-901", "qa");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "spec-901")).toHaveLength(1);
  });

  // SPEC-394 · ADR-0084 · respons menyebut apa yang benar-benar terjadi. Keluhan aslinya soal
  // persepsi ("malah membuat session baru"), jadi umpan baliknya tak boleh sama untuk dua hal
  // yang berbeda.
  it("peluncuran pertama 201 {id} tanpa resumed; peluncuran lanjutan 201 {id, resumed:true}", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-394A", projectId: "p1", stage: "planned" });
    const a = await start("SPEC-394A", "qa");
    expect(a.statusCode).toBe(201);
    expect(a.json().resumed).toBeUndefined();

    // worktree tetap, pane dibunuh → peluncuran berikutnya adalah lanjutan
    killSession("spec-394a");
    const b = await start("SPEC-394A", "qa");
    expect(b.statusCode).toBe(201);
    expect(b.json()).toEqual({ id: "spec-394a", resumed: true });
  });

  it("spec tak dikenal → 404; project tanpa repoDir → 400", async () => {
    expect((await start("SPEC-XXX")).statusCode).toBe(404);
    await makeSpec({ id: "SPEC-902", projectId: "p2" }); // p2.repoDir = null
    expect((await start("SPEC-902")).statusCode).toBe(400);
  });

  it("GET /:id/phases menurunkan fase dari berkas yang ditulis agen", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-903", projectId: "p1" });
    await start("SPEC-903");
    appendFileSync(phaseFilePath(repoDir, "spec-903"), "Brainstorm done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/spec-903/phases" });
    expect(res.json()).toMatchObject({ flow: "feature" });
    expect(res.json().phases[0]).toEqual({ name: "Brainstorm", state: "done" });
    expect(res.json().phases[1].state).toBe("active");
  });

  it("GET /:id/phases untuk sesi project → 404", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const id = await createSession();
    expect((await app.inject({ url: `/api/terminal/sessions/${id}/phases` })).statusCode).toBe(404);
  });

  it("DELETE membuang worktree dan memajukan Spec.stage ke keadaan finalnya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-904", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-904");
    appendFileSync(phaseFilePath(repoDir, "spec-904"), "Brainstorm done\nObjective done\nSpec done\n");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-904" })).statusCode).toBe(202);
    expect(existsSync(join(repoDir, ".worktrees", "spec-904"))).toBe(false);
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-904" } });
    expect(spec.stage).toBe("spec-ready");
  });

  it("Spec.stage tak pernah mundur", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-905", projectId: "p1", stage: "planned" });
    await start("SPEC-905");
    appendFileSync(phaseFilePath(repoDir, "spec-905"), "Brainstorm done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-905" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-905" } });
    expect(spec.stage).toBe("planned");
  });

  // SPEC-172 · reopen: spec `done` memakai continuePrompt (lanjut Execute), bukan startPrompt.
  it("spec done → sesi baru memakai continuePrompt (marker MELANJUTKAN)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE; // fake-claude cetak `args: $*`
    await makeSpec({ id: "SPEC-920", projectId: "p1", stage: "done", objective: "selesaikan 3 PR sisa" });
    const res = await start("SPEC-920");
    expect(res.statusCode).toBe(201);
    expect(existsSync(join(repoDir, ".worktrees", "spec-920"))).toBe(true);
    const c = connect("spec-920");
    await c.opened;
    // Marker MELANJUTKAN ada di puncak continuePrompt; sejak SPEC-184 --settings (hooks decision)
    // lebih besar dan mendorongnya keluar viewport 80×24 fake-claude. Perbesar viewport agar
    // riwayat ter-scroll tergambar ulang — asersi perilaku (continuePrompt) tetap sama.
    c.ws.send(JSON.stringify({ t: "resize", cols: 80, rows: 200 }));
    await waitFor(() => c.data().includes("MELANJUTKAN"));
    expect(c.data()).not.toContain("Kerjakan fase berurutan"); // pipeline penuh tak dipakai
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-920" });
  });

  it("spec non-done → tetap startPrompt (tanpa marker MELANJUTKAN)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-921", projectId: "p1", stage: "planned", objective: "kerja biasa" });
    const res = await start("SPEC-921");
    expect(res.statusCode).toBe(201);
    const c = connect("spec-921");
    await c.opened;
    // startPrompt menggiring pipeline penuh — skill Brainstorm hanya muncul di startPrompt
    // (continuePrompt cuma emit skill Execute). Penanda teratas "Kerjakan fase berurutan" bisa
    // ter-scroll keluar layar tmux 80×24 karena prompt feature panjang (SPEC-173 menambah
    // paragraf plan-gate); pakai penanda startPrompt-unik yang tetap dalam viewport.
    await waitFor(() => c.data().includes("superpowers:brainstorming"));
    expect(c.data()).not.toContain("MELANJUTKAN");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-921" });
  });

  // SPEC-252 · ADR-0061 — model & effort per SESI: override per-instance dari body Start sampai ke
  // argv `--model`/`--effort`; kosong → default global. fake-claude yang merekam argv ke berkas
  // menghindari kerapuhan viewport (baris argv panjang ter-wrap di layar tmux 80×24).
  const recordingClaude = () => {
    const out = join(mkdtempSync(join(tmpdir(), "hanoman-argv-")), "argv");
    const bin = join(mkdtempSync(join(tmpdir(), "hanoman-bin-")), "fake-claude.sh");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$*" > ${JSON.stringify(out)}\nexec cat\n`);
    execFileSync("chmod", ["755", bin]);
    process.env.HANOMAN_CLAUDE_BIN = bin;
    return out;
  };
  it("spec-flow dengan model/effort per-instance → argv sesi memakai override", async () => {
    const out = recordingClaude();
    await makeSpec({ id: "SPEC-952", projectId: "p1", stage: "planned", objective: "kerja" });
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-952", flow: "qa", model: "claude-sonnet-5", effort: "high" } });
    expect(res.statusCode).toBe(201);
    await waitFor(() => existsSync(out) && readFileSync(out, "utf8").includes("--dangerously-skip-permissions"));
    const argv = readFileSync(out, "utf8");
    expect(argv).toContain("--model claude-sonnet-5");
    expect(argv).toContain("--effort high");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-952" });
  });
  it("spec-flow TANPA model/effort → argv memakai default global", async () => {
    const out = recordingClaude();
    await makeSpec({ id: "SPEC-953", projectId: "p1", stage: "planned", objective: "kerja" });
    const res = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-953", flow: "qa" } });
    expect(res.statusCode).toBe(201);
    await waitFor(() => existsSync(out) && readFileSync(out, "utf8").includes("--dangerously-skip-permissions"));
    const argv = readFileSync(out, "utf8");
    expect(argv).toContain("--model claude-opus-5");
    expect(argv).toContain("--effort xhigh");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-953" });
  });

  // SPEC-173 · ADR-0029: `Execute done` tak boleh mencapai `done` selama plan spec-nya
  // masih punya `- [ ]`. Plan ditulis ke worktree sesi (untracked; dibaca dari filesystem).
  const writePlan = (sessionId: string, body: string) => {
    const dir = join(repoDir, ".worktrees", sessionId, "docs/superpowers/plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `2026-07-11-x-${sessionId}.md`), body);
  };

  it("DELETE menahan di executing bila plan spec masih punya - [ ]", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-910", projectId: "p1", stage: "planned" });
    await start("SPEC-910");
    writePlan("spec-910", "- [x] a\n- [ ] b\n");
    appendFileSync(phaseFilePath(repoDir, "spec-910"), "Execute done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-910" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-910" } });
    expect(spec.stage).toBe("executing");
  });

  it("DELETE mencapai done saat semua kotak plan sudah - [x]", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-911", projectId: "p1", stage: "planned" });
    await start("SPEC-911");
    writePlan("spec-911", "- [x] a\n- [x] b\n");
    appendFileSync(phaseFilePath(repoDir, "spec-911"), "Execute done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-911" });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-911" } });
    expect(spec.stage).toBe("done");
  });

  it("DELETE yang mencapai done membuat satu notifikasi (SPEC-180)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-914", projectId: "p1", stage: "planned", title: "Judul 914" });
    await start("SPEC-914");
    writePlan("spec-914", "- [x] a\n");
    appendFileSync(phaseFilePath(repoDir, "spec-914"), "Execute done\n");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-914" });
    const notif = await prisma.notification.findFirst({ where: { specId: "SPEC-914" } });
    expect(notif?.title).toBe("Judul 914");
  });
});

// SPEC-166: reverse menyusun Source of Truth dari kode — sesi project-level di worktree-nya.
describe("terminal routes · sesi reverse", () => {
  const start = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, flow: "reverse" } });

  it("POST { project, flow: reverse } membuat worktree + sesi ber-id deterministik", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("reverse-p1");
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(true);
  });

  it("POST kedua menyambung ke sesi yang sama (ADR-0015)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = await start("p1");
    const b = await start("p1");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "reverse-p1")).toHaveLength(1);
  });

  it("project tanpa repoDir + flow → 422 (bukan 400)", async () => {
    expect((await start("p2")).statusCode).toBe(422);
  });

  // SPEC-394 · ADR-0084 · cacat pane-mati yang kembar dengan sesi backlog. Bahaya utamanya BUKAN
  // gerbangnya melainkan `addWorktree` di belakangnya: ia selalu merebut path, jadi respawn tanpa
  // penjaga akan menghapus dokumen yang belum di-commit. Kedua sifat diuji BERSAMA, karena
  // memperbaiki gerbangnya sendirian justru menukar "tombol diam" dengan kehilangan data.
  it("sesi project-level: pane mati dilahirkan ulang TANPA menghapus worktree-nya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const born = await start("p1");
    expect(born.statusCode).toBe(201);
    const id = born.json().id as string;
    const wt = join(repoDir, ".worktrees", id);
    writeFileSync(join(wt, "draft-docs.md"), "dokumen setengah jadi");

    killSession(id);                       // pane hilang, worktree tetap
    const again = await start("p1");
    expect(again.statusCode).toBe(201);
    expect(again.json().id).toBe(id);
    expect(existsSync(join(wt, "draft-docs.md"))).toBe(true);        // TIDAK terhapus
    expect(listSessions().filter((s) => s.id === id && !s.exited)).toHaveLength(1);
    expect(readFileSync(promptFilePath(id), "utf8")).toContain("BUKAN kosong");
    killSession(id);
  });

  it("sesi project-level yang benar-benar baru tetap lahir tanpa catatan worktree", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const r = await app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project: "p1", flow: "prd", brief: { title: "Bersih 394", context: "c", outcome: "o" } } });
    expect(r.statusCode).toBe(201);
    const id = r.json().id as string;
    expect(readFileSync(promptFilePath(id), "utf8")).not.toContain("BUKAN kosong");
    killSession(id);
  });

  it("GET phases memakai pipeline reverse baru", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    appendFileSync(phaseFilePath(repoDir, "reverse-p1"), "Scan done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/reverse-p1/phases" });
    expect(res.json().flow).toBe("reverse");
    expect(res.json().phases[0]).toEqual({ name: "Scan", state: "done" });
    expect(res.json().phases[1]).toEqual({ name: "Docs teknis", state: "active" });
  });

  it("DELETE membuang worktree sesi reverse — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" })).statusCode).toBe(202);
    expect(existsSync(join(repoDir, ".worktrees", "reverse-p1"))).toBe(false);
  });

  it("prompt sesi reverse memuat standar docs", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1"); // sesi lama sudah di-DELETE oleh test sebelumnya
    expect(res.statusCode).toBe(201);
    const c = connect("reverse-p1");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("STANDAR DOCS");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/reverse-p1" });
  });
});

// SPEC-210: sesi prd — PM menyusun dokumen PRD dari brief + brainstorm; project-level, tanpa Spec.
describe("terminal routes · sesi prd", () => {
  const start = (project: string, brief?: unknown) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project, flow: "prd", ...(brief === undefined ? {} : { brief }) } });
  const brief = { title: "Jadwal Invoice", context: "c", outcome: "o" };

  it("POST { project, flow: prd, brief } → worktree + sesi ber-id prd-<slug>", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1", brief);
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("prd-jadwal-invoice");
    expect(existsSync(join(repoDir, ".worktrees", "prd-jadwal-invoice"))).toBe(true);
    const s = listSessions().find((x) => x.id === "prd-jadwal-invoice")!;
    expect(s.flow).toBe("prd");
    expect(s.cwd).toContain(join(".worktrees", "prd-jadwal-invoice"));
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/prd-jadwal-invoice" });
  });

  it("POST prd tanpa brief → 400", async () => {
    expect((await start("p1")).statusCode).toBe(400);
  });

  it("POST prd judul kosong → 400 (slug kosong)", async () => {
    expect((await start("p1", { title: "", context: "c", outcome: "o" })).statusCode).toBe(400);
  });

  it("project tanpa repoDir + prd → 422", async () => {
    expect((await start("p2", brief)).statusCode).toBe(422);
  });

  it("DELETE membuang worktree sesi prd — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1", brief);
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/prd-jadwal-invoice" })).statusCode).toBe(202);
    expect(existsSync(join(repoDir, ".worktrees", "prd-jadwal-invoice"))).toBe(false);
  });

  it("prompt sesi prd memuat instruksi PRD (docs/prd + brainstorming)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1", brief);
    expect(res.statusCode).toBe(201);
    const c = connect("prd-jadwal-invoice");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("docs/prd/jadwal-invoice.md");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/prd-jadwal-invoice" });
  });
});

// SPEC-222: scaffold menyusun Source of Truth dari ide — sesi project-level di worktree-nya.
describe("terminal routes · sesi scaffold", () => {
  const start = (project: string) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project, flow: "scaffold" } });

  it("POST { project, flow: scaffold } membuat worktree + sesi ber-id deterministik", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("scaffold-p1");
    expect(existsSync(join(repoDir, ".worktrees", "scaffold-p1"))).toBe(true);
    const s = listSessions().find((x) => x.id === "scaffold-p1")!;
    expect(s.flow).toBe("scaffold");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("POST kedua menyambung ke sesi yang sama (ADR-0015)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = await start("p1");
    const b = await start("p1");
    expect(a.json().id).toBe(b.json().id);
    expect(listSessions().filter((s) => s.id === "scaffold-p1")).toHaveLength(1);
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("project tanpa repoDir + flow → 422 (bukan 400)", async () => {
    expect((await start("p2")).statusCode).toBe(422);
  });

  // SPEC-223 · "project baru pasti kosongan": repoDir project from-scratch bisa BELUM ada di disk
  // saat scaffold (project di-sync dari device lain, folder dipindah, atau create-time init tak
  // jalan). Scaffold harus init repo on-demand (idempoten), bukan mati `spawnSync git ENOENT`.
  it("repoDir belum ada di disk → scaffold init repo dulu, tetap 201", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const scratchDir = join(mkdtempSync(join(tmpdir(), "hanoman-scratch-")), "repo");
    expect(existsSync(scratchDir)).toBe(false); // repoDir project baru: belum ada
    await makeProject({ id: "p3-scratch", name: "p3-scratch", kind: "from-scratch", repoDir: scratchDir });
    const res = await start("p3-scratch");
    expect(res.statusCode).toBe(201);
    expect(existsSync(join(scratchDir, ".git"))).toBe(true);          // repo di-init on-demand
    expect(existsSync(join(scratchDir, ".worktrees", "scaffold-p3-scratch"))).toBe(true);
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p3-scratch" });
  });

  it("GET phases memakai pipeline scaffold", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    appendFileSync(phaseFilePath(repoDir, "scaffold-p1"), "Brainstorm done\n");
    const res = await app.inject({ url: "/api/terminal/sessions/scaffold-p1/phases" });
    expect(res.json().flow).toBe("scaffold");
    expect(res.json().phases[0]).toEqual({ name: "Brainstorm", state: "done" });
    expect(res.json().phases[1]).toEqual({ name: "Objective", state: "active" });
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });

  it("DELETE membuang worktree sesi scaffold — meski tanpa spec", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await start("p1");
    expect((await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" })).statusCode).toBe(202);
    expect(existsSync(join(repoDir, ".worktrees", "scaffold-p1"))).toBe(false);
  });

  it("prompt sesi scaffold memuat STANDAR DOCS", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await start("p1");
    expect(res.statusCode).toBe(201);
    const c = connect("scaffold-p1");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("STANDAR DOCS");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/scaffold-p1" });
  });
});

// SPEC-168: backlog menurunkan stage sesi yang hidup — real time, tanpa menunggu DELETE.
describe("GET /specs · stage live dari sesi", () => {
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });
  const stageOf = async (id: string) => {
    const res = await app.inject({ url: "/api/specs" });
    return (res.json().items as { id: string; stage: string }[]).find((s) => s.id === id)?.stage;
  };

  it("menurunkan stage dari berkas fase selama sesi hidup, lalu mempersistnya (write-through)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-906", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-906");
    appendFileSync(phaseFilePath(repoDir, "spec-906"), "Brainstorm done\nObjective done\n");

    expect(await stageOf("SPEC-906")).toBe("objective");
    // Durabilitas: read yang melihat kemajuan menuliskannya ke DB, jadi stage selamat
    // meski berkas fase / pane hilang sebelum DELETE (SPEC-168).
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-906" } });
    expect(row.stage).toBe("objective");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-906" });
  });

  it("stage selamat saat sesi lenyap tanpa DELETE — sudah dipersist saat dibaca", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-909", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-909");
    appendFileSync(phaseFilePath(repoDir, "spec-909"), "Brainstorm done\nObjective done\n");
    expect(await stageOf("SPEC-909")).toBe("objective"); // derive + persist

    killSession("spec-909"); // pane hilang tanpa advanceStage (reboot/tmux mati)
    expect(listSessions().some((s) => s.id === "spec-909")).toBe(false);
    expect(await stageOf("SPEC-909")).toBe("objective"); // dari DB, bukan derive
  });

  it("tak menyeret stage mundur: fase lebih awal dari nilai persist diabaikan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-907", projectId: "p1", stage: "planned" });
    await start("SPEC-907");
    appendFileSync(phaseFilePath(repoDir, "spec-907"), "Objective done\n"); // → "objective" < "planned"
    expect(await stageOf("SPEC-907")).toBe("planned");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-907" });
  });

  it("spec tanpa sesi: stage = nilai DB apa adanya", async () => {
    await makeSpec({ id: "SPEC-908", projectId: "p1", stage: "objective" });
    expect(await stageOf("SPEC-908")).toBe("objective");
  });

  // SPEC-173 · ADR-0029: write-through pun digerbang — `Execute done` live tak boleh
  // mempersist `done` selama plan spec-nya masih punya `- [ ]`.
  const writeLivePlan = (sessionId: string, body: string) => {
    const dir = join(repoDir, ".worktrees", sessionId, "docs/superpowers/plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `2026-07-11-x-${sessionId}.md`), body);
  };

  it("write-through tertahan di executing selama plan spec masih - [ ]", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-912", projectId: "p1", stage: "planned" });
    await start("SPEC-912");
    writeLivePlan("spec-912", "- [x] a\n- [ ] b\n");
    appendFileSync(phaseFilePath(repoDir, "spec-912"), "Execute done\n");
    expect(await stageOf("SPEC-912")).toBe("executing");
    const row = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-912" } });
    expect(row.stage).toBe("executing"); // persist ikut tertahan, bukan done
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-912" });
  });

  it("write-through mencapai done saat semua kotak plan - [x] + membuat notifikasi (SPEC-180)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-913", projectId: "p1", stage: "planned", title: "Judul 913" });
    await start("SPEC-913");
    writeLivePlan("spec-913", "- [x] a\n- [x] b\n");
    appendFileSync(phaseFilePath(repoDir, "spec-913"), "Execute done\n");
    expect(await stageOf("SPEC-913")).toBe("done");
    // SPEC-180 · jalur write-through GET /specs juga mencatat notifikasi saat masuk done.
    const notif = await prisma.notification.findFirst({ where: { specId: "SPEC-913" } });
    expect(notif?.title).toBe("Judul 913");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-913" });
  });
});

// SPEC-175: sesi integrasi (resolve konflik merge/rebase) hidup di .worktrees/* tanpa flow —
// DELETE harus tetap membersihkan worktree-nya.
describe("terminal DELETE — integrate session cleanup (SPEC-175)", () => {
  it("DELETE sesi tanpa-flow di .worktrees/* menghapus worktree-nya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const wt = join(repoDir, ".worktrees", "merge-cleanup");
    execFileSync("git", ["worktree", "add", "--detach", "-q", wt, "main"], { cwd: repoDir });
    const s = createSessionSvc("p1", wt, { id: "merge-cleanup", specId: "SPEC-1" });
    expect(existsSync(wt)).toBe(true);
    const res = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${s.id}` });
    expect(res.statusCode).toBe(202);
    expect(existsSync(wt)).toBe(false);
  });
});

// SPEC-273: sesi breakdown — pecah SATU PRD → manifest N backlog paralel. Project-level, tanpa Spec.
describe("terminal routes · sesi breakdown", () => {
  const start = (project: string, prdPath?: unknown) =>
    app.inject({ method: "POST", url: "/api/terminal/sessions",
      payload: { project, flow: "breakdown", ...(prdPath === undefined ? {} : { prdPath }) } });
  const seedPrd = () => {
    mkdirSync(join(repoDir, "docs", "prd"), { recursive: true });
    writeFileSync(join(repoDir, "docs", "prd", "jadwal-invoice.md"),
      "# Jadwal Invoice Berulang\n\nSCOPE-MARKER");
  };

  it("POST { flow: breakdown, prdPath } → worktree + sesi breakdown-<slug>", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    seedPrd();
    const res = await start("p1", "docs/prd/jadwal-invoice.md");
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("breakdown-jadwal-invoice");
    expect(existsSync(join(repoDir, ".worktrees", "breakdown-jadwal-invoice"))).toBe(true);
    const s = listSessions().find((x) => x.id === "breakdown-jadwal-invoice")!;
    expect(s.flow).toBe("breakdown");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/breakdown-jadwal-invoice" });
  });

  it("prdPath yang tak terbaca → 400", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    expect((await start("p1", "docs/prd/tidak-ada.md")).statusCode).toBe(400);
  });

  it("prompt sesi breakdown memuat isi PRD + path manifest", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    seedPrd();
    const res = await start("p1", "docs/prd/jadwal-invoice.md");
    expect(res.statusCode).toBe(201);
    const c = connect("breakdown-jadwal-invoice");
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "exit"));
    expect(c.data()).toContain("docs/prd/jadwal-invoice.breakdown.md");
    expect(c.data()).toContain("SCOPE-MARKER");
    c.ws.close();
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/breakdown-jadwal-invoice" });
  });
});

// SPEC-447 · ADR-0093 · kontrak HTTP gerbang dependency.
describe("POST /terminal/sessions · dependency (SPEC-447)", () => {
  beforeAll(async () => {
    await makeSpec({ id: "SPEC-T1", projectId: "p1", stage: "planned" });
    await makeSpec({ id: "SPEC-T2", projectId: "p1", stage: "planned", dependsOn: ["SPEC-T1"] });
  });

  it("409 + daftar pemblokir saat dependency belum siap", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await app.inject({
      method: "POST", url: "/api/terminal/sessions", payload: { spec: "SPEC-T2", flow: "feature" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().blocked).toBe(true);
    expect(res.json().blockers).toEqual([{ id: "SPEC-T1", reason: "unfinished" }]);
    // Gerbang berdiri di depan worktree: penolakan tak boleh meninggalkan jejak apa pun.
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-T2" } }))!.baseSha).toBeNull();
  });

  it("force:true melewati gerbang dan sesi lahir", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const res = await app.inject({
      method: "POST", url: "/api/terminal/sessions",
      payload: { spec: "SPEC-T2", flow: "feature", force: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("spec-t2");
    killSession("spec-t2");
  });
});

// SPEC-742 · ADR-0116 · penutupan sesi asinkron. Yang wajib-urut & murah tetap di dalam request;
// worktree-nya DIPINDAH ke `.worktrees/.trash` (1 ms) lalu byte-nya dihapus penyapu latar.
describe("DELETE /terminal/sessions/:id · penutupan asinkron (SPEC-742)", () => {
  // repoDir baru terisi di beforeAll — badan describe dievaluasi lebih dulu.
  const trashDir = () => join(repoDir, ".worktrees", ".trash");
  const trashNames = () => { try { return readdirSync(trashDir()); } catch { return []; } };
  const start = (spec: string, flow = "feature") =>
    app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { spec, flow } });

  beforeEach(() => { __resetReaper(); rmSync(trashDir(), { recursive: true, force: true }); });

  it("membalas 202 { cleanup } dan path worktree SUDAH bebas saat respons kembali", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-742A", projectId: "p1", stage: "planned" });
    await start("SPEC-742A");
    const wt = join(repoDir, ".worktrees", "spec-742a");
    expect(existsSync(wt)).toBe(true);

    const del = await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-742a" });

    expect(del.statusCode).toBe(202);
    expect(del.json().cleanup).toMatch(/^spec-742a\./);
    expect(existsSync(wt)).toBe(false);                       // dibebaskan SINKRON, bukan dijanjikan
  });

  // Constraint yang paling mudah dilanggar: memindahkan bacaan ini ke latar membuat stage tak maju
  // dan headSha hilang — dan bersamanya bukti dependency antar-backlog (ADR-0093).
  it("stage & headSha tetap terekam meski penghapusannya ditunda", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-742B", projectId: "p1", stage: "brainstorming" });
    await start("SPEC-742B");
    appendFileSync(phaseFilePath(repoDir, "spec-742b"), "Brainstorm done\nObjective done\nSpec done\n");

    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-742b" });

    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: "SPEC-742B" } });
    expect(spec.stage).toBe("spec-ready");
    expect(spec.headSha).toMatch(/^[0-9a-f]{40}$/);
  });

  // Inti keluhannya: operator tak boleh menunggu apa pun untuk membuka sesi berikutnya, termasuk
  // sesi untuk backlog yang SAMA — yang memakai path worktree yang persis sama.
  it("sesi baru untuk backlog yang sama langsung lahir selagi entri trash masih tertahan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-742C", projectId: "p1", stage: "planned" });
    await start("SPEC-742C");
    writeFileSync(join(repoDir, ".worktrees", "spec-742c", "KERJA-LAMA.txt"), "x");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-742c" });
    expect(trashNames()).toHaveLength(1);                     // sengaja belum disapu

    const lagi = await start("SPEC-742C");

    expect(lagi.statusCode).toBe(201);
    const wt = join(repoDir, ".worktrees", "spec-742c");
    expect(existsSync(wt)).toBe(true);
    expect(existsSync(join(wt, "KERJA-LAMA.txt"))).toBe(false);
    killSession("spec-742c");
  });

  it("GET /terminal/cleanups menampilkan entri sebagai closing, lalu kosong sesudah disapu", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    await makeSpec({ id: "SPEC-742D", projectId: "p1", stage: "planned" });
    await start("SPEC-742D");
    await app.inject({ method: "DELETE", url: "/api/terminal/sessions/spec-742d" });

    const items = (await app.inject({ url: "/api/terminal/cleanups" })).json().items;
    expect(items).toEqual([
      expect.objectContaining({ sessionId: "spec-742d", projectId: "p1", state: "closing" }),
    ]);

    await sweepRepo(repoDir, "p1");
    expect(trashNames()).toEqual([]);
    expect((await app.inject({ url: "/api/terminal/cleanups" })).json().items).toEqual([]);
  });

  it("sesi tanpa worktree → 202 { cleanup: null }", async () => {
    process.env.HANOMAN_SHELL = fileURLToPath(new URL("./fixtures/fake-shell.sh", import.meta.url));
    const id = (await app.inject({
      method: "POST", url: "/api/terminal/sessions", payload: { project: "p1", shell: true },
    })).json().id as string;

    const del = await app.inject({ method: "DELETE", url: `/api/terminal/sessions/${id}` });

    expect(del.statusCode).toBe(202);
    expect(del.json().cleanup).toBeNull();
    expect(trashNames()).toEqual([]);
  });
});
