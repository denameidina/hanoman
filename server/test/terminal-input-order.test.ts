import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

// Revalidasi principal dibuat bisa DITAHAN dari test: di jalur lama setiap frame `in` menunggu
// `await revalidateWsPrincipal` sebelum `writeTo`, jadi dua frame beruntun berlomba di Prisma dan
// bisa mendarat terbalik di pty (terukur `bcdef` → `bdcef`, 3/3 run), dan satu query yang tertahan
// pool (5 dtk terukur) atau melempar P1008 menahan lalu menutup socket yang sah.
vi.mock("../src/services/ws-admission", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/services/ws-admission")>();
  return { ...real, revalidateWsPrincipal: vi.fn(real.revalidateWsPrincipal) };
});

import { buildApp } from "../src/app";
import { revalidateWsPrincipal } from "../src/services/ws-admission";
import { killAll } from "../src/services/pty";
import { resetDb, makeProject } from "./factory";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));
const app = buildApp({ requireAuth: false });
let origin = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 10));
  }
};

type Deferred = { resolve: (ok: boolean) => void; reject: (e: Error) => void };
const checks: Deferred[] = [];
const held = vi.mocked(revalidateWsPrincipal);

type Frame = { t: string; d?: string; seq?: number };
async function connect() {
  const res = await app.inject({ method: "POST", url: "/api/terminal/sessions", payload: { project: "p1" } });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  const ws = new WebSocket(`ws://${origin}/api/terminal/sessions/${id}/ws`);
  const frames: Frame[] = [];
  let closed: { code: number; reason: string } | undefined;
  ws.on("message", (raw: Buffer) => { frames.push(JSON.parse(raw.toString())); });
  ws.on("close", (code, reason) => { closed = { code, reason: reason.toString() }; });
  await new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const data = () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");
  const acks = () => frames.filter((f) => f.t === "ack").map((f) => f.seq!);
  // Pane siap menerima ketikan begitu banner fake-claude tergambar.
  await waitFor(() => data().includes("sshenv:"));
  return { id, ws, frames, data, acks, closed: () => closed };
}

beforeAll(async () => {
  killAll();
  const repoDir = mkdtempSync(join(tmpdir(), "hanoman-term-order-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t",
    "commit", "-qm", "init", "--allow-empty"], { cwd: repoDir });
  await resetDb();
  await makeProject({ id: "p1", repoDir });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
});
beforeEach(() => {
  checks.length = 0;
  held.mockReset();
  held.mockImplementation(() => new Promise<boolean>((resolve, reject) => { checks.push({ resolve, reject }); }));
});
afterAll(async () => { await app.close(); });

describe("urutan & latensi frame input terminal", () => {
  it("writes a burst to the pty in arrival order and acks it without waiting for revalidation", async () => {
    const c = await connect();
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < chars.length; i += 1) c.ws.send(JSON.stringify({ t: "in", d: chars[i], seq: i + 1 }));
    // Pemeriksaan principal belum terjawab sama sekali (`checks` ditahan) — ketikan tetap sampai.
    await waitFor(() => c.acks().length === chars.length);
    expect(c.acks()).toEqual(chars.split("").map((_, i) => i + 1));
    await waitFor(() => c.data().includes(chars));
    expect(checks.every((d) => d !== undefined)).toBe(true);
    c.ws.close();
  });

  it("revalidates at most once per window during a burst, not once per frame", async () => {
    const c = await connect();
    for (let i = 1; i <= 50; i += 1) c.ws.send(JSON.stringify({ t: "in", d: "a", seq: i }));
    await waitFor(() => c.acks().length === 50);
    expect(checks.length).toBeLessThanOrEqual(2);
    expect(checks.length).toBeGreaterThanOrEqual(1);
    c.ws.close();
  });

  it("closes 1008 once the principal is found revoked", async () => {
    const c = await connect();
    c.ws.send(JSON.stringify({ t: "in", d: "a", seq: 1 }));
    await waitFor(() => checks.length >= 1);
    checks[0]!.resolve(false);
    await waitFor(() => c.closed() !== undefined);
    expect(c.closed()).toEqual({ code: 1008, reason: "session revoked" });
  });

  it("keeps serving when the revalidation query itself fails", async () => {
    const c = await connect();
    c.ws.send(JSON.stringify({ t: "in", d: "a", seq: 1 }));
    await waitFor(() => checks.length >= 1);
    checks[0]!.reject(new Error("P1008 Operations timed out"));
    await new Promise((r) => setTimeout(r, 50));
    c.ws.send(JSON.stringify({ t: "in", d: "b", seq: 2 }));
    await waitFor(() => c.acks().includes(2));
    expect(c.closed()).toBeUndefined();
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });
});
