import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildApp } from "../src/app";

// SPEC-761 memasang gerbang Origin fail-closed yang daftarnya HANYA dari HANOMAN_CONTROL_ORIGINS.
// Instalasi polos (`npm i -g hanoman` → `hanoman`) tak menyetel env itu, sehingga SETIAP WebSocket
// browser ditolak 401 dan terminal tampak kosong padahal tmux serta REST-nya sehat. Test ini
// menjaga jalur "baru install langsung pakai": tanpa allowlist, same-origin diterima dan origin
// asing tetap ditolak — jadi pertahanan CSWSH-nya tidak ikut hilang.
const app = buildApp({ requireAuth: false, env: { NODE_ENV: "test" } });
let localUrl = "";

beforeAll(async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  localUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/events/ws`;
});
afterAll(async () => { await app.close(); });

async function ticket(): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/ws-tickets", headers: { host: "dash.local" }, payload: { target: "events" },
  });
  expect(response.statusCode).toBe(200);
  return response.json().ticket as string;
}

async function result(origin: string): Promise<"open" | "rejected"> {
  const ws = new WebSocket(localUrl, [`hanoman-ticket.${await ticket()}`], {
    origin,
    headers: { host: "dash.local" },
  });
  return new Promise((resolve) => {
    ws.on("open", () => { resolve("open"); ws.close(); });
    ws.on("unexpected-response", () => resolve("rejected"));
    ws.on("error", () => resolve("rejected"));
  });
}

describe("events WebSocket without a configured control allowlist", () => {
  it("admits the dashboard's own origin and still rejects a foreign one", async () => {
    expect(await result("http://dash.local")).toBe("open");
    expect(await result("http://evil.local")).toBe("rejected");
  });
});
