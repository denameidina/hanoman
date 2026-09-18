import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MODE_HEADER } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeSetting } from "./factory";
import { killAll } from "../src/services/pty";
import { encodeRelayActor } from "../src/services/relay/gate";
import { relaySecret } from "../src/services/relay/secret";
import { DEFAULT_SETTING } from "../src/services/settings";
import { remoteEventGroups } from "../src/routes/events";

const app = buildApp({ requireAuth: false });
let origin = "";
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) { if (Date.now() > deadline) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); }
};
function connect() {
  const ws = new WebSocket(`ws://${origin}/api/events/ws`);
  const frames: { t: string; [k: string]: unknown }[] = [];
  ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
  const opened = new Promise<void>((res, rej) => { ws.on("open", () => res()); ws.on("error", rej); });
  return { ws, frames, opened };
}

beforeAll(async () => {
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "hanoman-cfg-")); // getLimits → unavailable, tanpa jaringan
  process.env.HANOMAN_EVENTS_TICK_MS = "50";
  killAll(); await resetDb();
  await app.listen({ port: 0, host: "127.0.0.1" });
  origin = `127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await app.close(); });

describe("events WS route", () => {
  it("kirim snapshot penuh saat connect", async () => {
    const c = connect();
    await c.opened;
    // Snapshot attach mengirim tiap grup berurutan (sessions→specs→notifications→vps→limits→update);
    // pengiriman WS async, jadi tunggu SEMUA jenis frame tiba, bukan hanya `notifications`
    // (limits/vps/update datang belakangan → race di bawah beban suite penuh). SPEC-214 menambah "update".
    // SPEC-919 · `presence` ikut: `attach()` melewati grup yang `build()`-nya melempar lewat
    // `catch { continue; }` TANPA log sama sekali, dan `presenceView()` menyentuh Prisma — tanpa
    // baris ini satu kedipan DB menghapus grup itu dari snapshot pertama tanpa jejak apa pun.
    const want = ["sessions", "specs", "notifications", "vps", "limits", "update", "presence"];
    await waitFor(() => want.every((t) => c.frames.some((f) => f.t === t)));
    for (const t of want) expect(c.frames.some((f) => f.t === t)).toBe(true);
    c.ws.close();
  });

  it("mendorong frame notifications saat baris baru lahir", async () => {
    const c = connect();
    await c.opened;
    await waitFor(() => c.frames.some((f) => f.t === "notifications"));
    await prisma.notification.create({ data: { specId: "SPEC-9", title: "z", projectId: "p1" } });
    // Attach snapshot + broadcast loop bisa sama-sama mengirim snapshot kosong; tunggu isi,
    // bukan sekadar frame berikutnya.
    await waitFor(() => c.frames.some((f) => f.t === "notifications" && Array.isArray(f.items) && f.items.length === 1));
    const nf = c.frames.filter((f) => f.t === "notifications" && Array.isArray(f.items) && f.items.length === 1).at(-1);
    expect(nf?.items).toHaveLength(1);
    c.ws.close();
  });
});

describe("/api/events/ws (klien) — principal remote grup terbatas (SPEC-1218 · AC-C9)", () => {
  const remoteHeaders = (capabilities: string[]) => ({
    [RELAY_HEADER]: relaySecret(),
    [RELAY_ACTOR_HEADER]: encodeRelayActor({ hubOrigin: "https://hub.example", userId: "u1", email: "op@hub.example" }),
    [RELAY_MODE_HEADER]: "read",
    // ponytail: header di sini cuma untuk lolos onRequest gate; capability sesungguhnya datang
    // dari grant Setting.remoteControl, bukan header ini (gate.ts membaca DB, bukan header caps).
  });
  const remoteGrant = (capabilities: string[]) =>
    makeSetting({
      remoteControl: { enabled: true, capabilities: capabilities as any },
      scheduler: { ...DEFAULT_SETTING.scheduler, launchGuard: { enabled: false, maxLoadPerCore: 2.5 } },
    });

  it("req.remote tanpa ide:read → hanya sessions/leadAsks/cleanups, nol git, nol cookieOnly", async () => {
    await remoteGrant(["sessions:read"]);
    const ws = await app.injectWS("/api/events/ws", { headers: remoteHeaders(["sessions:read"]) } as any);
    const frames: { t: string }[] = [];
    ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
    await waitFor(() => frames.some((f) => f.t === "sessions"));
    const types = new Set(frames.map((f) => f.t));
    expect(types.has("sessions")).toBe(true);
    expect(types.has("git")).toBe(false);
    expect(types.has("models")).toBe(false);
    expect(types.has("presence")).toBe(false);
    ws.terminate();
  });

  it("remoteEventGroups(ideRead) — murni: tanpa ide:read basis saja, dengan ide:read tambah git", () => {
    const base = remoteEventGroups(false);
    expect(base.has("sessions")).toBe(true);
    expect(base.has("leadAsks")).toBe(true);
    expect(base.has("cleanups")).toBe(true);
    expect(base.has("git")).toBe(false);
    expect(remoteEventGroups(true).has("git")).toBe(true);
  });

  it("req.remote DENGAN ide:read → koneksi tetap admitted, grup dasar tetap terkirim", async () => {
    await remoteGrant(["sessions:read", "ide:read"]);
    const ws = await app.injectWS("/api/events/ws", { headers: remoteHeaders(["sessions:read", "ide:read"]) } as any);
    const frames: { t: string }[] = [];
    ws.on("message", (raw: Buffer) => frames.push(JSON.parse(raw.toString())));
    await waitFor(() => frames.some((f) => f.t === "sessions"));
    expect(frames.some((f) => f.t === "sessions")).toBe(true);
    ws.terminate();
  });
});
