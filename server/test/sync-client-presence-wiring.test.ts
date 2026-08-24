import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { startSyncClient, stopSyncClient, syncStatus, RECONNECT_MIN_MS } from "../src/services/sync-client";
import { presenceEntries, __resetPresence } from "../src/services/presence/registry";

/* SPEC-919 · ADR-0147 · yang diuji di sini adalah WIRING, bukan aritmetika backoff: bahwa
   `startSyncClient` benar-benar memasang pengirim presence pada `open`, dan bahwa
   `stopSyncClient` benar-benar membatalkan ketukan reconnect yang tertunda. Tanpa berkas ini
   seluruh lifecycle itu bisa dicabut habis tanpa satu pun test merah — dan justru cacat "socket
   yatim menyambung dengan token LAMA" itulah alasan jalur ini disentuh. */

const app = buildApp({ requireAuth: false });
let base = "";

const waitFor = async (ok: () => boolean, ms = 6000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 25)); }
};
const clean = async () => { await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany(); };

beforeAll(async () => {
  await clean();
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { stopSyncClient(); await app.close(); await clean(); });
beforeEach(async () => { stopSyncClient(); __resetPresence(); await clean(); });

async function token() {
  const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return issueDeviceToken(u.id, "laptop");
}

describe("wiring pengirim presence di sync client", () => {
  it("startSyncClient memasang pengirim: hub menerima presence tanpa dipicu apa pun", async () => {
    const t = await token();
    await startSyncClient(base, t.token, 60_000);   // tick fallback jauh, supaya bukan itu pemicunya
    await waitFor(() => syncStatus().connected);
    await waitFor(() => presenceEntries().some((e) => e.deviceId === t.id));
    stopSyncClient();
  });

  it("stopSyncClient menutup socket DAN membatalkan reconnect yang tertunda", async () => {
    const t = await token();
    await startSyncClient(base, t.token, 60_000);
    await waitFor(() => presenceEntries().some((e) => e.deviceId === t.id));

    stopSyncClient();
    // Socket ditutup → hub menjatuhkan device seketika (`dropPresence` di handler `close`).
    await waitFor(() => !presenceEntries().some((e) => e.deviceId === t.id));

    // Ketukan reconnect pertama akan jatuh tempo dalam RECONNECT_MIN_MS (dikurangi jitter 20%).
    // Kalau ia tak dibatalkan, device muncul lagi memakai token yang sama.
    await new Promise((r) => setTimeout(r, RECONNECT_MIN_MS * 2));
    expect(presenceEntries().some((e) => e.deviceId === t.id)).toBe(false);
    expect(syncStatus().connected).toBe(false);
    expect(syncStatus().running).toBe(false);
  });
});
