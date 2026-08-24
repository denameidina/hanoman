import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";

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
