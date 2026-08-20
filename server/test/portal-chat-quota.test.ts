import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { PORTAL_CHAT_DEFAULTS } from "@hanoman/shared";
import { quotaView, startSessionWithQuota } from "../src/services/portal-chat/quota";

const CFG = { ...PORTAL_CHAT_DEFAULTS, enabled: true, brainstormPerMonth: 2, askPerMonth: 3 };
const NOW = new Date("2026-08-19T10:00:00Z");

const clean = async () => {
  await prisma.portalChatMessage.deleteMany(); await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany();
  await prisma.user.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
  const a = await prisma.user.create({ data: { email: "a@x.co", passwordHash: "h", role: "client" } });
  const b = await prisma.user.create({ data: { email: "b@x.co", passwordHash: "h", role: "client" } });
  return { a: a.id, b: b.id };
}
const mulai = (userId: string, type: "brainstorm" | "tanya", projectId = "p1") =>
  startSessionWithQuota({ projectId, userId, type, cfg: CFG, now: NOW });

describe("kuota chat portal (SPEC-854 · ADR-0130 huruf C/F)", () => {
  it("dua ember terpisah: brainstorming dan pertanyaan", async () => {
    const { a } = await seed();
    for (let i = 0; i < 2; i++) expect(await mulai(a, "brainstorm")).not.toHaveProperty("error");
    expect(await mulai(a, "brainstorm")).toHaveProperty("error", "kuota");
    // Ember pertanyaan masih utuh — jatah brainstorming habis tak boleh ikut menutupnya.
    expect(await mulai(a, "tanya")).not.toHaveProperty("error");
  });

  it("perilaku PERSIS di batas", async () => {
    const { a } = await seed();
    for (let i = 0; i < 3; i++)
      expect(await mulai(a, "tanya"), `ke-${i + 1}`).not.toHaveProperty("error");
    expect(await mulai(a, "tanya")).toHaveProperty("error", "kuota");
  });

  // Tak bisa ditembus dengan beberapa akun klien di project yang SAMA.
  it("jatah milik project, bukan milik akun", async () => {
    const { a, b } = await seed();
    for (let i = 0; i < 2; i++) await mulai(a, "brainstorm");
    expect(await mulai(b, "brainstorm")).toHaveProperty("error", "kuota");
  });

  // …tapi jatah project lain tak ikut terpakai.
  it("jatah project tetangga tak tersentuh", async () => {
    const { a } = await seed();
    for (let i = 0; i < 2; i++) await mulai(a, "brainstorm");
    expect(await mulai(a, "brainstorm", "p2")).not.toHaveProperty("error");
  });

  // Tak bisa ditembus dengan membuka banyak tab / memuat ulang: yang menghabiskan jatah adalah
  // sesi yang LAHIR, dan membuka tab tak melahirkan sesi.
  it("giliran tambahan di sesi yang sudah ada tak menambah pemakaian", async () => {
    const { a } = await seed();
    const s = await mulai(a, "tanya");
    const sid = (s as { session: { id: string } }).session.id;
    for (let i = 1; i <= 6; i++)
      await prisma.portalChatMessage.create({
        data: { sessionId: sid, seq: i, role: "klien", text: "x" } });
    expect((await quotaView("p1", CFG, NOW)).tanya.terpakai).toBe(1);
  });

  it("sesudah reset jatahnya penuh lagi", async () => {
    const { a } = await seed();
    for (let i = 0; i < 3; i++) await mulai(a, "tanya");
    expect(await mulai(a, "tanya")).toHaveProperty("error", "kuota");
    const bulanDepan = new Date("2026-09-01T00:00:01Z");
    expect(await startSessionWithQuota({ projectId: "p1", userId: a, type: "tanya",
      cfg: CFG, now: bulanDepan })).not.toHaveProperty("error");
    expect((await quotaView("p1", CFG, bulanDepan)).tanya.terpakai).toBe(1);
  });

  it("tampilan sisa jatah + tanggal reset", async () => {
    const { a } = await seed();
    await mulai(a, "tanya");
    expect(await quotaView("p1", CFG, NOW)).toMatchObject({
      enabled: true,
      tanya: { terpakai: 1, jatah: 3, sisa: 2 },
      brainstorm: { terpakai: 0, jatah: 2, sisa: 2 },
      resetPada: "2026-09-01T00:00:00.000Z",
    });
  });

  it("jatah nol berarti tertutup, bukan tak terbatas", async () => {
    const { a } = await seed();
    expect(await startSessionWithQuota({ projectId: "p1", userId: a, type: "tanya",
      cfg: { ...CFG, askPerMonth: 0 }, now: NOW })).toHaveProperty("error", "kuota");
  });

  // `sisa` tak boleh negatif walau jatah diturunkan operator setelah sesi terlanjur lahir.
  it("jatah diturunkan di tengah periode: sisa nol, bukan minus", async () => {
    const { a } = await seed();
    for (let i = 0; i < 3; i++) await mulai(a, "tanya");
    const v = await quotaView("p1", { ...CFG, askPerMonth: 1 }, NOW);
    expect(v.tanya).toMatchObject({ terpakai: 3, jatah: 1, sisa: 0 });
  });
});
