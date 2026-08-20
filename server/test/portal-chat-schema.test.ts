import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { __FIELDS } from "../src/services/sync";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";

const clean = async () => {
  await prisma.portalChatMessage.deleteMany();
  await prisma.portalChatSession.deleteMany();
  await prisma.clientProjectAccess.deleteMany();
  await prisma.user.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function seed() {
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } });
  const u = await prisma.user.create({
    data: { email: "k@x.co", passwordHash: "h", role: "client" } });
  return u.id;
}

describe("skema chat portal (SPEC-854 · ADR-0129)", () => {
  it("sesi + pesan tersimpan berurutan dan terikat project/akun/tipe", async () => {
    const userId = await seed();
    const s = await prisma.portalChatSession.create({
      data: { projectId: "p1", userId, type: "tanya", periodKey: "2026-08" } });
    await prisma.portalChatMessage.create({
      data: { sessionId: s.id, seq: 1, role: "klien", text: "halo" } });
    await prisma.portalChatMessage.create({
      data: { sessionId: s.id, seq: 2, role: "hanoman", text: "hai" } });
    const rows = await prisma.portalChatMessage.findMany({
      where: { sessionId: s.id }, orderBy: { seq: "asc" } });
    expect(rows.map((r) => r.role)).toEqual(["klien", "hanoman"]);
  });

  it("seq unik per sesi — giliran ganda tak bisa menimpa urutan", async () => {
    const userId = await seed();
    const s = await prisma.portalChatSession.create({
      data: { projectId: "p1", userId, type: "tanya", periodKey: "2026-08" } });
    await prisma.portalChatMessage.create({
      data: { sessionId: s.id, seq: 1, role: "klien", text: "a" } });
    await expect(prisma.portalChatMessage.create({
      data: { sessionId: s.id, seq: 1, role: "klien", text: "b" } })).rejects.toThrow();
  });

  it("project dihapus → sesi & pesannya ikut hilang", async () => {
    const userId = await seed();
    const s = await prisma.portalChatSession.create({
      data: { projectId: "p1", userId, type: "tanya", periodKey: "2026-08" } });
    await prisma.portalChatMessage.create({
      data: { sessionId: s.id, seq: 1, role: "klien", text: "a" } });
    await prisma.project.delete({ where: { id: "p1" } });
    expect(await prisma.portalChatSession.count()).toBe(0);
    expect(await prisma.portalChatMessage.count()).toBe(0);
  });

  // LOCAL-only: percakapan klien adalah data per-instance, cermin ClientProjectAccess (ADR-0110).
  it("tak ikut sync", () => {
    expect(Object.keys(__FIELDS)).not.toContain("portalChatSession");
    expect(Object.keys(__FIELDS)).not.toContain("portalChatMessage");
  });

  // PG_ORDER wajib memuat TIAP model; migrate-pg.test.ts mengadu daftar ini ke DMMF.
  it("masuk PG_ORDER sesudah User dan Project", () => {
    const i = (n: string) => (PG_ORDER as readonly string[]).indexOf(n);
    expect(i("PortalChatSession")).toBeGreaterThan(i("User"));
    expect(i("PortalChatSession")).toBeGreaterThan(i("Project"));
    expect(i("PortalChatMessage")).toBeGreaterThan(i("PortalChatSession"));
  });
});
