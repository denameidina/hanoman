import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import type { PaneIO } from "../src/services/tui-dialog";
import {
  screenHashOf, __setPaneIO, __resetPaneIO, __resetAnswering,
} from "../src/services/session-dialog";
import { markDeciding, __resetDeciding } from "../src/services/lead/deciding";
import { createSession, killSession } from "../src/services/pty";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pane tmux SUNGGUHAN dipakai hanya sebagai "sesi ini ada"; layarnya datang dari `PaneIO` palsu.
// Memisahkan keduanya membuat berkas ini menguji ROUTE (gerbang, status, bentuk respons), bukan
// kemampuan tmux merender widget Ink.
//
// Socket tersendiri: `hanoman-test` dipakai bersama seluruh suite server di mesin ini, dan pane
// uji yang menumpang di sana ikut mati saat tetangga membereskan miliknya (pola pty-queries.test).
const PREV_SOCKET = process.env.HANOMAN_TMUX_SOCKET;
beforeAll(() => { process.env.HANOMAN_TMUX_SOCKET = "hanoman-t899"; });
afterAll(() => {
  if (PREV_SOCKET === undefined) delete process.env.HANOMAN_TMUX_SOCKET;
  else process.env.HANOMAN_TMUX_SOCKET = PREV_SOCKET;
});

// `HANOMAN_CONTROL_ORIGINS` yang kebetulan terpasang di shell operator menyalakan `enforce` di
// ingress-policy, dan `app.inject` mengirim Host yang tak ada di daftar itu → SELURUH /api dijawab
// 404 sebelum satu pun route dinilai. Env-nya karena itu diserahkan eksplisit, bukan diwarisi.
const app = buildApp({
  requireAuth: false,
  env: { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined },
});

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

beforeEach(() => {
  typed.length = 0;
  at = 0;
  screens = [SINGLE];
  __resetDeciding();
  __resetAnswering();
  __setPaneIO(fakeIO);
  sessionId = createSession("p1", "/tmp", { command: ["/bin/cat"] }).id;
});

afterEach(() => {
  __resetPaneIO();
  __resetDeciding();
  __resetAnswering();
  if (sessionId) killSession(sessionId);
});

describe("SPEC-899 · GET /terminal/sessions/:id/dialog", () => {
  it("mengembalikan dialog + screenHash saat pane menampilkan dialog pilihan", async () => {
    const r = await app.inject({ method: "GET", url: `/api/terminal/sessions/${sessionId}/dialog` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      screenHash: screenHashOf(SINGLE),
      dialog: {
        title: "Warna apa yang dipakai?", multi: false, freeIndex: 3, notes: false,
        options: [{ n: 1, label: "merah", checked: null }, { n: 2, label: "biru", checked: null }],
        tabs: [{ header: "Warna", answered: false }],
      },
    });
  });

  it("204 saat layarnya bukan dialog", async () => {
    screens = ["$ pnpm dev\n  ready in 312 ms\n"];
    const r = await app.inject({ method: "GET", url: `/api/terminal/sessions/${sessionId}/dialog` });
    expect(r.statusCode).toBe(204);
  });

  it("404 untuk sesi yang tak ada", async () => {
    const r = await app.inject({ method: "GET", url: "/api/terminal/sessions/tak-ada/dialog" });
    expect(r.statusCode).toBe(404);
  });
});

describe("SPEC-899 · POST /terminal/sessions/:id/dialog/answer", () => {
  const url = (id: string) => `/api/terminal/sessions/${id}/dialog/answer`;

  it("202 dan mengetik label opsi ke kolom bebas", async () => {
    screens = [SINGLE, SINGLE, SINGLE.replace("3. Type something.", "3. biru")];
    const r = await app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: screenHashOf(SINGLE), choice: 2 } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ accepted: true });
    expect(typed).toEqual(["3", "biru", "<enter>"]);
  });

  it("409 stale saat screenHash tak lagi cocok — dan pane tak disentuh", async () => {
    const r = await app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: "sudah-basi", choice: 1 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("stale");
    expect(typed).toEqual([]);
  });

  it("409 deciding saat lead sedang menyusun keputusan untuk sesi ini", async () => {
    markDeciding(sessionId);
    const r = await app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: screenHashOf(SINGLE), choice: 1 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().reason).toBe("deciding");
    expect(typed).toEqual([]);
  });

  it("404 untuk sesi yang tak ada", async () => {
    const r = await app.inject({ method: "POST", url: url("tak-ada"), payload: { screenHash: screenHashOf(SINGLE), choice: 1 } });
    expect(r.statusCode).toBe(404);
  });

  it("400 untuk body tanpa bentuk jawaban", async () => {
    const r = await app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: screenHashOf(SINGLE) } });
    expect(r.statusCode).toBe(400);
  });

  it("409 answering saat satu jawaban lain masih berjalan untuk sesi yang sama", async () => {
    // `sleep` yang menahan jawaban pertama sampai POST kedua sudah dinilai gerbangnya.
    let release = () => { };
    const held = new Promise<void>((res) => { release = res; });
    __setPaneIO(() => ({ ...fakeIO(), sleep: () => held }));
    const first = app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: screenHashOf(SINGLE), choice: 1 } });
    await new Promise((r) => setTimeout(r, 20));
    const second = await app.inject({ method: "POST", url: url(sessionId), payload: { screenHash: screenHashOf(SINGLE), choice: 2 } });
    expect(second.statusCode).toBe(409);
    expect(second.json().reason).toBe("answering");
    release();
    await first;
  });
});

// SPEC-903 · ADR-0143 · jawaban dialog adalah TOOL RESULT, bukan prompt, jadi hook pengosong marker
// (`UserPromptSubmit`, SPEC-184) tak pernah menembak untuk jalur ini. Tanpa langkah eksplisit di
// route, pil "Menunggu keputusan" hanya padam saat pane kebetulan diam ≥ PANE_QUIET_MS.
describe("SPEC-903 · jawaban yang mendarat mengosongkan marker keputusan", () => {
  it("marker dikosongkan sesudah 202", async () => {
    const decisionFile = join(mkdtempSync(join(tmpdir(), "hanoman-903-")), "spec-903");
    writeFileSync(decisionFile, "1787400000\n");
    screens = [SINGLE, SINGLE, SINGLE.replace("3. Type something.", "3. merah")];
    const s = createSession("p903", "/tmp", { decisionFile, command: ["/bin/cat"] });
    try {
      const r = await app.inject({
        method: "POST", url: `/api/terminal/sessions/${s.id}/dialog/answer`,
        payload: { screenHash: screenHashOf(SINGLE), choice: 1 },
      });
      expect(r.statusCode).toBe(202);
      expect(readFileSync(decisionFile, "utf8")).toBe("");
    } finally {
      killSession(s.id);
    }
  });
});
