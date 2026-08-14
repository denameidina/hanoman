import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { applyPush } from "../src/services/sync";

const app = buildApp({ requireAuth: false });
let origin = "";
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};

const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany();
};
beforeAll(async () => { await clean(); await app.listen({ port: 0, host: "127.0.0.1" }); origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`; });
afterAll(async () => { await app.close(); await clean(); });
beforeEach(clean);

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return (await issueDeviceToken(u.id, "laptop")).token;
}

describe("sync WS /api/sync/ws (SPEC-213 AC-16)", () => {
  it("broadcasts accepted writes to a token-authed client", async () => {
    const tok = await token();
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    const ws = new WebSocket(`ws://${origin}/api/sync/ws`, { headers: { authorization: `Bearer ${tok}` } });
    const frames: Record<string, unknown>[] = [];
    ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
    await new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });

    await applyPush("spec", "SPEC-1", 0, { projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang", author: "a", objective: "o" });
    await waitFor(() => frames.some((f) => f.t === "sync" && f.recordId === "SPEC-1"));
    const frame = frames.find((f) => f.recordId === "SPEC-1")!;
    expect(frame).toMatchObject({ t: "sync", entity: "spec", version: 1 });
    ws.close();
  });

  it("rejects upgrade without a valid token (socket closes)", async () => {
    // Upgrade bisa 'open' dulu lalu handler menutup — jadi tunggu event 'close', bukan 'open'.
    const ws = new WebSocket(`ws://${origin}/api/sync/ws`, { headers: { authorization: "Bearer nope" } });
    const result = await new Promise<"closed" | "stayed">((res) => {
      ws.on("close", () => res("closed"));
      ws.on("error", () => res("closed"));
      setTimeout(() => res("stayed"), 1000);
    });
    expect(result).toBe("closed");
  });

  it("rejects legacy query credentials", async () => {
    const tok = await token();
    const ws = new WebSocket(`ws://${origin}/api/sync/ws?token=${tok}`);
    const result = await new Promise<"closed" | "stayed">((res) => {
      ws.on("close", () => res("closed"));
      ws.on("error", () => res("closed"));
      setTimeout(() => res("stayed"), 1000);
    });
    expect(result).toBe("closed");
  });
});
