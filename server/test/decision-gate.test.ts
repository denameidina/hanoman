import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";
import type { PaneIO } from "../src/services/tui-dialog";
import { screenHashOf, __setPaneIO, __resetPaneIO, __resetAnswering } from "../src/services/session-dialog";
import { markDeciding, __resetDeciding } from "../src/services/lead/deciding";
import { sessionEventToken } from "../src/services/session-event-token";
import { __resetLaunchers, launchedBy, recordLauncher, refuseSelfDecision } from "../src/services/decision-guard";
import { createSession, killSession } from "../src/services/pty";
import { resetDb, makeProject } from "./factory";

// ADR-0190 · ADR-0192 · gerbang keputusan dialog sesi, DIUJI SAMPAI KE ROUTE lewat agent token
// sungguhan (requireAuth menyala). Tiga hal dibuktikan, masing-masing dengan kontrol negatifnya:
//   1. `sessions:decide` memang pintu — `sessions:write`/`sessions:spawn` sehebat apa pun ditolak;
//   2. agen tak bisa memutuskan sesinya sendiri (peluncur, approver backlog, penelepon dari dalam sesi);
//   3. 409 deciding/answering milik lead tetap berlaku, dan steer tak jadi pintu belakang.
//
// Pane tmux SUNGGUHAN hanya berarti "sesi ini ada"; layarnya `PaneIO` palsu (pola
// terminal-dialog.route.test.ts). Socket tmux & HANOMAN_HOME tersendiri.
const PREV = {
  socket: process.env.HANOMAN_TMUX_SOCKET, home: process.env.HANOMAN_HOME, shell: process.env.HANOMAN_SHELL,
};
let home = "";
let repoDir = "";
beforeAll(() => {
  process.env.HANOMAN_TMUX_SOCKET = "hanoman-t1190";
  home = mkdtempSync(join(tmpdir(), "hanoman-decision-home-"));
  repoDir = mkdtempSync(join(tmpdir(), "hanoman-decision-repo-"));
  process.env.HANOMAN_HOME = home;
  process.env.HANOMAN_SHELL = fileURLToPath(new URL("./fixtures/fake-shell.sh", import.meta.url));
});
afterAll(() => {
  const back = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  back("HANOMAN_TMUX_SOCKET", PREV.socket); back("HANOMAN_HOME", PREV.home); back("HANOMAN_SHELL", PREV.shell);
  rmSync(home, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

const cleanEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined };
const app = buildApp({ env: cleanEnv });

const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
};

async function tokenWith(capabilities: string[]) {
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  const { token, view } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { headers: { authorization: `Bearer ${token}` }, id: view.id, token };
}

const SINGLE = [
  "  ←  ☐ Warna  →",
  "  Warna apa yang dipakai?",
  "",
  "❯ 1. merah",
  "  2. biru",
  "  3. Type something.",
  "",
  "  enter to select · esc to cancel",
].join("\n");
const SHELL_SCREEN = "$ pnpm dev\n  ready in 312 ms\n";

const typed: string[] = [];
let screens: string[] = [SINGLE];
let at = 0;
const fakeIO = (): PaneIO => ({
  capture: () => screens[Math.min(at, screens.length - 1)]!,
  literal: (s) => { typed.push(s); at = Math.min(at + 1, screens.length - 1); },
  enter: () => { typed.push("<enter>"); },
  down: () => { at = Math.min(at + 1, screens.length - 1); },
  sleep: async () => { },
});

let sessionId = "";
const answer = (headers: Record<string, string>, id = sessionId, extra: Record<string, string> = {}) => app.inject({
  method: "POST", url: `/api/terminal/sessions/${id}/dialog/answer`, headers: { ...headers, ...extra },
  payload: { screenHash: screenHashOf(SINGLE), choice: 1 },
});

beforeEach(async () => {
  await resetDb();
  await prisma.agentToken.deleteMany();
  await makeProject({ id: "p1", repoDir });
  typed.length = 0; at = 0; screens = [SINGLE];
  __resetDeciding(); __resetAnswering(); __resetLaunchers();
  __setPaneIO(fakeIO);
  sessionId = createSession("p1", "/tmp", { command: ["/bin/cat"] }).id;
});
afterEach(() => {
  __resetPaneIO(); __resetDeciding(); __resetAnswering();
  if (sessionId) killSession(sessionId);
});

describe("1 · sessions:decide adalah satu-satunya pintu", () => {
  it("token ber-sessions:write + sessions:spawn ditolak 403 need=sessions:decide di ketiga route — pane tak tersentuh", async () => {
    const { headers } = await tokenWith(["sessions:read", "sessions:write", "sessions:spawn"]);
    for (const [method, url, payload] of [
      ["GET", `/api/terminal/sessions/${sessionId}/dialog`, undefined],
      ["POST", `/api/terminal/sessions/${sessionId}/dialog/answer`, { screenHash: screenHashOf(SINGLE), choice: 1 }],
      ["POST", `/api/terminal/sessions/${sessionId}/dialog/takeover`, undefined],
    ] as const) {
      const r = await app.inject({ method, url, headers, payload });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(r.json()).toMatchObject({ need: "sessions:decide" });
    }
    expect(typed).toEqual([]);
  });

  it("sessions:decide SAJA cukup membaca & menjawab dari luar sesi (kontrol positif)", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    const g = await app.inject({ method: "GET", url: `/api/terminal/sessions/${sessionId}/dialog`, headers });
    expect(g.statusCode).toBe(200);
    expect(g.json().screenHash).toBe(screenHashOf(SINGLE));
    screens = [SINGLE, SINGLE, SINGLE.replace("3. Type something.", "3. merah")];
    const r = await answer(headers);
    expect(r.statusCode).toBe(202);
    expect(typed).toEqual(["3", "merah", "<enter>"]);
  });

  it("sessions:decide tidak memberi hak lain: tak bisa steer/interrupt", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/interrupt`, headers,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "sessions:write" });
  });

  it("token turunan sesi (HANOMAN_EVENT_TOKEN) bukan agent token — 401, sesi tak bisa lewat jalur 'turunan'", async () => {
    await tokenWith(["sessions:decide"]);   // master switch menyala; ini yang membuat 401 bermakna
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/dialog/answer`,
      headers: { authorization: `Bearer ${sessionEventToken(sessionId)}`, "x-hanoman-session": sessionId },
      payload: { screenHash: screenHashOf(SINGLE), choice: 1 },
    });
    expect(r.statusCode).toBe(401);
    expect(typed).toEqual([]);
  });
});

describe("2 · agen tak boleh memutuskan sesinya sendiri", () => {
  it("memanggil dengan x-hanoman-session = sesi targetnya → 403 reason=self", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    const r = await answer(headers, sessionId, { "x-hanoman-session": sessionId });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("self");
    expect(typed).toEqual([]);
  });

  it("memanggil dari dalam sesi LAIN → 403 reason=in-session (agen-di-sesi tak memutuskan untuk siapa pun)", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    const r = await answer(headers, sessionId, { "x-hanoman-session": "sesi-lain" });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("in-session");
    expect(typed).toEqual([]);
  });

  it("takeover dari dalam sesi juga ditolak", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/dialog/takeover`,
      headers: { ...headers, "x-hanoman-session": sessionId },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("self");
  });

  it("token yang MELUNCURKAN sesi (POST /terminal/sessions) ditolak memutuskannya — dan pencatatnya tahan restart", async () => {
    const { headers, id } = await tokenWith(["sessions:spawn", "sessions:decide"]);
    const launched = await app.inject({
      method: "POST", url: "/api/terminal/sessions", headers, payload: { project: "p1", shell: true },
    });
    expect(launched.statusCode).toBe(201);
    const launchedId = launched.json().id as string;
    try {
      expect(launchedBy(launchedId, id)).toBe(true);
      // simulasi restart server: cache memori hilang, berkas yang menjawab
      __resetLaunchers();
      expect(launchedBy(launchedId, id)).toBe(true);
      const r = await app.inject({
        method: "POST", url: `/api/terminal/sessions/${launchedId}/dialog/takeover`, headers,
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().reason).toBe("launcher");
      // kontrol negatif: token LAIN (bukan peluncur) lolos gerbang ini — jawabannya 404 karena
      // tak ada pertanyaan hidup, bukan 403.
      const other = await tokenWith(["sessions:decide"]);
      const o = await app.inject({
        method: "POST", url: `/api/terminal/sessions/${launchedId}/dialog/takeover`, headers: other.headers,
      });
      expect(o.statusCode).toBe(404);
    } finally { killSession(launchedId); }
  });

  it("cookie/manusia (tanpa agent token) tak dinilai gerbang ini", async () => {
    const open = buildApp({ requireAuth: false, env: cleanEnv });
    screens = [SINGLE, SINGLE, SINGLE.replace("3. Type something.", "3. merah")];
    const r = await open.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/dialog/answer`,
      headers: { "x-hanoman-session": sessionId },   // header dibuang diam-diam: bukan principal agen
      payload: { screenHash: screenHashOf(SINGLE), choice: 1 },
    });
    expect(r.statusCode).toBe(202);
    await open.close();
  });

  it("unit: approver backlog (Spec.launchApprovedBy=agent:<id>) ditolak; agen lain lolos", async () => {
    await prisma.spec.create({
      data: {
        id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned", author: "x",
        priority: "sedang", objective: "", launchApprovedAt: new Date(), launchApprovedBy: "agent:A1",
      },
    });
    const refused = await refuseSelfDecision({ agentId: "A1", sessionId: "spec-1", specId: "SPEC-1", header: undefined });
    expect(refused?.reason).toBe("launcher");
    expect(await refuseSelfDecision({ agentId: "A2", sessionId: "spec-1", specId: "SPEC-1", header: undefined })).toBeNull();
    // manusia menyetujui peluncuran → siapa pun agen bebas
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { launchApprovedBy: "user:a@b.c" } });
    expect(await refuseSelfDecision({ agentId: "A1", sessionId: "spec-1", specId: "SPEC-1", header: undefined })).toBeNull();
  });

  it("unit: peluncur ganda — token kedua yang menyambung tak membebaskan token pertama; id berbahaya diabaikan", () => {
    recordLauncher("s-x", "A1");
    recordLauncher("s-x", "A2");
    __resetLaunchers();
    expect(launchedBy("s-x", "A1")).toBe(true);
    expect(launchedBy("s-x", "A2")).toBe(true);
    expect(launchedBy("s-x", "A3")).toBe(false);
    recordLauncher("../../etc/passwd", "A1");
    expect(launchedBy("../../etc/passwd", "A1")).toBe(false);
  });
});

describe("3 · gerbang lead tetap berlaku, dan steer bukan pintu belakang", () => {
  it("409 deciding bagi pemegang sessions:decide yang lolos gerbang self-decision", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    markDeciding(sessionId);
    const r = await answer(headers);
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("deciding");
    expect(typed).toEqual([]);
  });

  it("403 self-decision MENDAHULUI 409 deciding: penolakan tak membocorkan keadaan lead", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    markDeciding(sessionId);
    const r = await answer(headers, sessionId, { "x-hanoman-session": sessionId });
    expect(r.statusCode).toBe(403);
  });

  it("409 answering saat jawaban lain masih berjalan", async () => {
    const { headers } = await tokenWith(["sessions:decide"]);
    let release = () => { };
    const held = new Promise<void>((res) => { release = res; });
    __setPaneIO(() => ({ ...fakeIO(), sleep: () => held }));
    const first = answer(headers);
    await new Promise((r) => setTimeout(r, 20));
    const second = await answer(headers);
    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe("answering");
    release();
    await first;
  });

  it("steer oleh sessions:write SAAT dialog di layar → 403 need=sessions:decide; pane tak disentuh", async () => {
    const { headers } = await tokenWith(["sessions:write"]);
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/steer`, headers, payload: { text: "merah" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "sessions:decide", reason: "dialog-on-screen" });
    expect(typed).toEqual([]);
  });

  it("steer oleh pemegang decide dari DALAM sesi saat dialog di layar → 403 (self)", async () => {
    const { headers } = await tokenWith(["sessions:write", "sessions:decide"]);
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/steer`,
      headers: { ...headers, "x-hanoman-session": sessionId }, payload: { text: "merah" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("self");
    expect(typed).toEqual([]);
  });

  it("steer biasa (tanpa dialog di layar) TIDAK berubah: sessions:write cukup", async () => {
    screens = [SHELL_SCREEN];
    const { headers } = await tokenWith(["sessions:write"]);
    const r = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${sessionId}/steer`, headers, payload: { text: "ls" },
    });
    expect(r.statusCode).toBe(202);
  });
});
