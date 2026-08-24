import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { PRESENCE_PROTOCOL, type PresenceSession } from "@hanoman/shared";
import { presenceEntries, __resetPresence } from "../src/services/presence/registry";

const app = buildApp({ requireAuth: false });
let origin = "";

const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };

beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); await clean(); });
beforeEach(async () => { __resetPresence(); await clean(); });

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}
const open = (tok: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://${origin}/api/sync/ws`, { headers: { authorization: `Bearer ${tok}` } });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });

const session: PresenceSession = {
  sessionId: "spec-919", projectId: "hanoman", specId: "SPEC-919", flow: "feature",
  phase: "Execute", agent: "claude", status: "working", startedAt: "2026-08-24T00:00:00.000Z",
};
const frame = (sessions: PresenceSession[]) =>
  JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions });

describe("frame presence di /api/sync/ws", () => {
  it("mencatat sesi ke registry, beratribusi device dari TOKEN", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    const [e] = presenceEntries();
    expect(e!.deviceId).toBe(t.id);
    expect(e!.sessions[0]!.specId).toBe("SPEC-919");
    ws.close();
  });

  it("device lenyap saat socket ditutup", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    ws.close();
    await waitFor(() => presenceEntries().length === 0);
  });

  // Kanal ini mengangkut changefeed sync. Frame presence yang buruk TAK BOLEH menutupnya.
  it("frame rusak dibuang, socket tetap hidup", async () => {
    const t = await token();
    const ws = await open(t.token);
    ws.send("{bukan json");
    ws.send(JSON.stringify({ t: "presence", v: 99, sessions: [] }));
    ws.send(JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions: [{ ...session, cwd: "/rahasia" }] }));
    await new Promise((r) => setTimeout(r, 150));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(presenceEntries()).toHaveLength(0);
    ws.send(frame([session]));
    await waitFor(() => presenceEntries().length > 0);
    ws.close();
  });

  it("frame di atas jatah laju dibuang tanpa menutup socket", async () => {
    const t = await token();
    const ws = await open(t.token);
    for (let i = 0; i < 80; i++) ws.send(frame([{ ...session, sessionId: `s${i}` }]));
    await new Promise((r) => setTimeout(r, 250));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("tanpa device token upgrade ditolak", async () => {
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${origin}/api/sync/ws`);
      ws.on("open", () => resolve("open"));
      ws.on("error", reject);
    })).rejects.toBeTruthy();
  });
});
