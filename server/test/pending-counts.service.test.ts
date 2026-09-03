import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { pendingCounts, __resetPendingCache, type PrdLister } from "../src/services/pending-counts";

// SPEC-961 · PRD bukan entitas DB (ADR-0041) — ia berkas di repoDir. Project di test ini sengaja
// TANPA repoDir, jadi `listAllPrds()` menjawab [] tanpa menyentuh disk dan tiga angka lainnya bisa
// diuji terhadap DB yang persis diketahui isinya. Perilaku cache PRD diuji terpisah di bawah.
const clean = async () => {
  await prisma.leadFlow.deleteMany();
  await prisma.githubIssue.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

const project = () => prisma.project.create({
  data: { id: "pc-proj", name: "PC", desc: "", kind: "existing" },
});

const spec = (id: string, o: { stage?: string; startedAt?: Date | null } = {}) =>
  prisma.spec.create({
    data: {
      id, projectId: "pc-proj", title: id, source: "brief", stage: o.stage ?? "spec-ready",
      priority: "sedang", author: "t", objective: "o", startedAt: o.startedAt ?? null,
    },
  });

const ticket = (id: string, status: string) => prisma.ticket.create({
  data: {
    id, projectId: "pc-proj", number: Number(id.slice(-1)), category: "bug", title: id,
    detail: "d", reporterEmail: "r@e.co", status, accessKeyHash: `hash-${id}`,
  },
});

const issue = (id: string, status: string) => prisma.githubIssue.create({
  data: {
    id, projectId: "pc-proj", repoSlug: "o/r", number: Number(id.slice(-1)), title: id, body: "",
    authorLogin: "a", labels: [], url: "https://x", issueState: "open", status,
    issueCreatedAt: new Date(), issueUpdatedAt: new Date(), pulledAt: new Date(),
  },
});

const flow = (id: string, status: string) => prisma.leadFlow.create({
  data: {
    id, projectId: "pc-proj", gate: "contract", status, title: id,
    expiresAt: new Date(Date.now() + 60_000),
  },
});

beforeEach(async () => { await clean(); __resetPendingCache(); await project(); });
afterAll(async () => { await clean(); });

describe("SPEC-961 · pendingCounts", () => {
  it("nol di instalasi kosong", async () =>
    expect(await pendingCounts()).toEqual({ triage: 0, backlog: 0, prd: 0, lead: 0 }));

  it("triage = tiket + issue GitHub yang belum diputuskan", async () => {
    await ticket("t-1", "new");
    await ticket("t-2", "accepted");
    await ticket("t-3", "rejected");
    await issue("i-1", "new");
    await issue("i-2", "new");
    await issue("i-3", "rejected");
    expect((await pendingCounts()).triage).toBe(3);
  });

  it("backlog = item yang belum pernah punya sesi", async () => {
    await spec("s-belum");
    await spec("s-jalan", { startedAt: new Date() });
    expect((await pendingCounts()).backlog).toBe(1);
  });

  // SPEC-804 · ADR-0120 · ditandai selesai manual = tak pernah punya sesi TAPI bukan pekerjaan
  // siapa pun lagi. Tanpa gerbang stage ia terhitung sebagai "butuh pengajuan" selamanya.
  it("item done tanpa sesi tak dihitung", async () => {
    await spec("s-manual", { stage: "done" });
    expect((await pendingCounts()).backlog).toBe(0);
  });

  it("lead = rantai yang masih terbuka saja", async () => {
    await flow("f-1", "menunggu");
    await flow("f-2", "sebagian");
    await flow("f-3", "selesai");
    await flow("f-4", "dibatalkan");
    expect((await pendingCounts()).lead).toBe(2);
  });

  it("project tanpa repoDir tak menyumbang PRD", async () =>
    expect((await pendingCounts()).prd).toBe(0));
});

describe("SPEC-961 · cache PRD", () => {
  // Grup siarnya berdetak tiap 5 dtk; tanpa cache itu berarti walk repo + baca berkas 12×/menit
  // di event loop yang sama dengan PTY terminal.
  it("tak membaca ulang PRD sebelum TTL 60 dtk lewat", async () => {
    const lister = vi.fn(async () => [
      { status: "draft" }, { status: "dieskalasi" }, { status: "draft" },
    ] as unknown as Awaited<ReturnType<PrdLister>>);
    const t0 = 1_000_000;
    expect((await pendingCounts(t0, lister)).prd).toBe(2);
    expect((await pendingCounts(t0 + 59_000, lister)).prd).toBe(2);
    expect(lister).toHaveBeenCalledTimes(1);
    await pendingCounts(t0 + 61_000, lister);
    expect(lister).toHaveBeenCalledTimes(2);
  });

  // Satu project yang repoDir-nya lenyap tak boleh menjatuhkan SELURUH frame: tiga angka lain
  // masih sah, dan badge yang hilang total lebih menyesatkan daripada angka PRD yang basi.
  it("kegagalan baca PRD tak menjatuhkan angka lain", async () => {
    await ticket("t-9", "new");
    const boom = vi.fn(async () => { throw new Error("repoDir hilang"); });
    expect(await pendingCounts(2_000_000, boom as unknown as PrdLister))
      .toEqual({ triage: 1, backlog: 0, prd: 0, lead: 0 });
  });

  // Kegagalan yang di-retry tiap tick akan mengubah satu repoDir rusak jadi walk disk 12×/menit —
  // persis biaya yang cache ini ada untuk mencegahnya.
  it("kegagalan tak memicu percobaan ulang tiap tick", async () => {
    const boom = vi.fn(async () => { throw new Error("repoDir hilang"); });
    await pendingCounts(3_000_000, boom as unknown as PrdLister);
    await pendingCounts(3_010_000, boom as unknown as PrdLister);
    expect(boom).toHaveBeenCalledTimes(1);
  });
});
