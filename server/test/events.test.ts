import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, detach, __tick, __reset } from "../src/services/events";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";
import { _resetLimitsCache } from "../src/services/limits";
import { _resetUpdateCache } from "../src/services/update";
import { __resetPendingCache } from "../src/services/pending-counts";

// Klien perekam frame (lihat pty.test.ts) — cukup untuk menguji kontrak siar tanpa WS nyata.
function fakeClient() {
  const frames: { t: string; [k: string]: unknown }[] = [];
  return { frames, send: (m: string) => frames.push(JSON.parse(m)), close: () => {} };
}
const groups = (c: ReturnType<typeof fakeClient>) => new Set(c.frames.map((f) => f.t));

beforeEach(async () => {
  // getLimits() jangan menyentuh keychain/jaringan di test: CLAUDE_CONFIG_DIR kosong → token null
  // → fallback "unavailable" seketika (tanpa prompt, tanpa fetch 5s).
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "hanoman-cfg-"));
  _resetLimitsCache();
  _resetUpdateCache();
  killAll();
  await resetDb();
  // `pending` (SPEC-961) menghitung Ticket/GithubIssue/LeadFlow, dan resetDb() tak menyentuh
  // ketiganya — sisa berkas test lain di DB bersama membuat angkanya bukan nol saat suite
  // penuh, padahal hijau sendirian. Cache PRD ikut dilupakan supaya hitungan disk segar.
  await prisma.ticket.deleteMany();
  await prisma.githubIssue.deleteMany();
  await prisma.leadFlow.deleteMany();
  __resetPendingCache();
  __reset();
});
afterEach(() => { __reset(); _resetUpdateCache(); });

describe("events hub", () => {
  it("mengirim snapshot semua grup ke klien saat attach", async () => {
    const c = fakeClient();
    await attach(c);
    // tmux tak jalan → sessions/specs kosong tapi tetap terkirim; notifications/limits/vps ada.
    expect(groups(c).has("sessions")).toBe(true);
    expect(groups(c).has("specs")).toBe(true);
    expect(groups(c).has("notifications")).toBe(true);
    expect(groups(c).has("limits")).toBe(true);
    expect(groups(c).has("vps")).toBe(true);
    expect(groups(c).has("update")).toBe(true);
    const nf = c.frames.find((f) => f.t === "notifications");
    expect(nf).toMatchObject({ unread: 0 });
    // SPEC-961 · grup ke-11. Badge sidebar tak punya muat awal HTTP: kalau frame ini tak ikut di
    // attach, angkanya baru muncul pada tick pertama yang isinya BERUBAH — di instalasi tenang,
    // tak pernah.
    expect(c.frames.find((f) => f.t === "pending"))
      .toMatchObject({ counts: { triage: 0, backlog: 0, prd: 0, lead: 0 } });
    detach(c);
  });

  it("broadcast frame notifications saat data berubah, dedup saat tak berubah", async () => {
    const c = fakeClient();
    await attach(c);
    const before = c.frames.filter((f) => f.t === "notifications").length;
    await prisma.notification.create({ data: { specId: "SPEC-1", title: "x", projectId: "p1" } });
    await __tick(); await __tick(); await __tick(); // notifications: everyTicks 3
    const afterCreate = c.frames.filter((f) => f.t === "notifications").length;
    expect(afterCreate).toBeGreaterThan(before);
    // tick lagi tanpa perubahan → tak ada frame notifications baru (dedup signature)
    await __tick(); await __tick(); await __tick();
    expect(c.frames.filter((f) => f.t === "notifications").length).toBe(afterCreate);
    detach(c);
  });

  it("klien yang di-detach berhenti menerima frame", async () => {
    const c = fakeClient();
    await attach(c);
    detach(c);
    const n = c.frames.length;
    await prisma.notification.create({ data: { specId: "SPEC-2", title: "y", projectId: "p1" } });
    await __tick(); await __tick(); await __tick();
    expect(c.frames.length).toBe(n);
  });
});
