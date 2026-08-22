import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { subKey, MAX_SUBS } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";
import { canSubscribeTopics } from "../src/services/ws-admission";
import { createTicket } from "../src/services/ticket";
import { prisma } from "../src/db";

// SPEC-908 · gerbang frame masuk. Dua lapis diuji terpisah karena batasnya memang dua:
// `canSubscribeTopics` adalah keputusan OTORISASI (diuji langsung atas tiap kind principal),
// sisanya adalah pemasangan di route (diuji lewat socket sungguhan).

const app = buildApp({ requireAuth: false });
let origin = "";
const TICKETS_PARAMS = { project: "sub-proj", page: 1, limit: 20 };

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
function connect() {
  const ws = new WebSocket(`ws://${origin}/api/events/ws`);
  const frames: { t: string; [k: string]: unknown }[] = [];
  ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  const closed: { code?: number } = {};
  ws.on("close", (code: number) => { closed.code = code; });
  return { ws, frames, opened, closed };
}
const sub = (subs: unknown[]) => JSON.stringify({ t: "sub", subs });

beforeAll(async () => {
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "hanoman-cfg-"));
  process.env.HANOMAN_EVENTS_TICK_MS = "50";
  killAll(); await resetDb();
  await prisma.project.create({ data: { id: "sub-proj", name: "Sub", desc: "", kind: "existing", helpEnabled: true } });
  await createTicket({ projectId: "sub-proj", category: "bug", title: "X rusak", detail: "d", reporterEmail: "r@e.co" });
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("SPEC-908 · siapa yang boleh berlangganan", () => {
  it("hanya principal cookie — agent token TIDAK, walau `/events/ws` = GLOBAL_READ baginya", () => {
    expect(canSubscribeTopics({ kind: "user", id: "u1" })).toBe(true);
    expect(canSubscribeTopics({ kind: "agent", id: "tok-1" })).toBe(false);
    expect(canSubscribeTopics({ kind: "device", id: "dev-1" })).toBe(false);
  });

  it("principal `test` hanya sah di bawah NODE_ENV=test", () => {
    const before = process.env.NODE_ENV;
    expect(canSubscribeTopics({ kind: "test", id: "test" })).toBe(true);
    process.env.NODE_ENV = "production";
    try { expect(canSubscribeTopics({ kind: "test", id: "test" })).toBe(false); }
    finally { process.env.NODE_ENV = before; }
  });
});

describe("SPEC-908 · frame `sub` di route /events/ws", () => {
  it("frame sah melahirkan frame `tickets` ber-`key` yang cocok", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send(sub([{ topic: "tickets", params: TICKETS_PARAMS }]));
    await waitFor(() => c.frames.some((f) => f.t === "tickets"));
    const f = c.frames.find((x) => x.t === "tickets")!;
    expect(f.key).toBe(subKey("tickets", TICKETS_PARAMS));
    expect((f.data as { total: number }).total).toBe(1);
    c.ws.close();
  });

  it("frame bukan JSON / `t` lain diabaikan tanpa menutup socket", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send("bukan json");
    c.ws.send(JSON.stringify({ t: "write", d: "rm -rf /" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(c.frames.some((f) => f.t === "tickets")).toBe(false);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it("entri cacat & topik tak dikenal dilewati, yang sah tetap terpasang (ADR-0087)", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send(sub([
      { topic: "topikMasaDepan", params: {} },
      { topic: "tickets", params: { ...TICKETS_PARAMS, limit: 99_999 } },   // melebihi plafon
      { topic: "tickets", params: TICKETS_PARAMS },
    ]));
    await waitFor(() => c.frames.some((f) => f.t === "tickets"));
    const keys = c.frames.filter((f) => f.t === "tickets").map((f) => f.key);
    expect(keys).toEqual([subKey("tickets", TICKETS_PARAMS)]);
    c.ws.close();
  });

  it("frame melebihi MAX_WS_MESSAGE_BYTES menutup socket dengan 1009, tak sampai ke hub", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send(sub([{ topic: "tickets", params: { ...TICKETS_PARAMS, q: "x".repeat(70_000) } }]));
    await waitFor(() => c.closed.code !== undefined);
    expect(c.closed.code).toBe(1009);
    expect(c.frames.some((f) => f.t === "tickets")).toBe(false);
  });

  it("`subs` melebihi MAX_SUBS menjatuhkan seluruh frame", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send(sub(Array.from({ length: MAX_SUBS + 1 }, () => ({ topic: "tickets", params: TICKETS_PARAMS }))));
    await new Promise((r) => setTimeout(r, 200));
    expect(c.frames.some((f) => f.t === "tickets")).toBe(false);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });

  it("frame `sub` kosong melepas langganan — tak ada frame `tickets` baru sesudahnya", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "hello"));
    c.ws.send(sub([{ topic: "tickets", params: TICKETS_PARAMS }]));
    await waitFor(() => c.frames.some((f) => f.t === "tickets"));
    c.ws.send(sub([]));
    await new Promise((r) => setTimeout(r, 100));
    const before = c.frames.filter((f) => f.t === "tickets").length;
    // Ubah data: kalau langganan masih hidup, dedup akan melahirkan frame baru.
    await createTicket({ projectId: "sub-proj", category: "bug", title: "Y rusak", detail: "d", reporterEmail: "r@e.co" });
    await new Promise((r) => setTimeout(r, 400));
    expect(c.frames.filter((f) => f.t === "tickets")).toHaveLength(before);
    c.ws.close();
  });
});
