import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildApp } from "../src/app";

const app = buildApp({
  requireAuth: false,
  env: { NODE_ENV: "test", HANOMAN_CONTROL_ORIGINS: "http://control.test" },
});
let localUrl = "";

beforeAll(async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  localUrl = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/events/ws`;
});
afterAll(async () => { await app.close(); });

async function ticket(): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/ws-tickets", headers: { host: "control.test" }, payload: { target: "events" },
  });
  expect(response.statusCode).toBe(200);
  return response.json().ticket as string;
}

async function result(origin: string, token: string): Promise<"open" | "rejected"> {
  const ws = new WebSocket(localUrl, [`hanoman-ticket.${token}`], {
    origin,
    headers: { host: "control.test" },
  });
  return new Promise((resolve) => {
    ws.on("open", () => { resolve("open"); ws.close(); });
    ws.on("unexpected-response", () => resolve("rejected"));
    ws.on("error", () => resolve("rejected"));
  });
}

describe("events WebSocket admission", () => {
  it("accepts the exact configured Origin and rejects a sibling or ticket replay", async () => {
    const valid = await ticket();
    expect(await result("http://control.test", valid)).toBe("open");
    expect(await result("http://control.test", valid)).toBe("rejected");
    expect(await result("http://evil.control.test", await ticket())).toBe("rejected");
  });
});
