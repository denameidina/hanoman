import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

// Gate lewat: uji perilaku data, bukan auth (cermin project-gitremote.route.test.ts).
const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function device(name: string, revoked = false) {
  const u = await prisma.user.findFirst()
    ?? await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
  return prisma.deviceToken.create({
    data: {
      userId: u.id, name, tokenHash: `hash-${name}-${Math.random()}`,
      revokedAt: revoked ? new Date() : null,
    },
  });
}
const project = (id: string, handledBy?: unknown) =>
  prisma.project.create({
    data: { id, name: id, desc: "d", kind: "existing", ...(handledBy ? { handledBy: handledBy as object } : {}) },
  });

describe("SPEC-880 · baca penanda 'ditangani oleh'", () => {
  it("project tanpa penanda → handledBy [] (bukan null), di list & detail", async () => {
    await project("polos");
    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].handledBy).toEqual([]);
    const one = await app.inject({ method: "GET", url: "/api/projects/polos" });
    expect(one.json().handledBy).toEqual([]);
  });

  it("nama HIDUP menang atas snapshot saat baris device ada di instance ini", async () => {
    const d = await device("hm-dena");
    await project("p1", [{ deviceId: d.id, name: "nama-lama" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
  });

  // AC-7 · revoke device TIDAK menghapus penanda; ia hanya diberi tanda.
  it("device dicabut tetap tampil, bertanda revoked", async () => {
    const d = await device("laptop-lama", true);
    await project("p2", [{ deviceId: d.id, name: "laptop-lama" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p2" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "laptop-lama", revoked: true }]);
  });

  // Inti K2: di client tak ada baris DeviceToken untuk di-join. Tanpa `name` tersimpan chip kosong.
  it("tanpa baris device lokal, nama SNAPSHOT yang dipakai (bukan kosong)", async () => {
    await project("p3", [{ deviceId: "device-asal-hub", name: "hub-vps" }]);
    const one = await app.inject({ method: "GET", url: "/api/projects/p3" });
    expect(one.json().handledBy).toEqual([{ deviceId: "device-asal-hub", name: "hub-vps", revoked: false }]);
  });

  it("isi kolom yang rusak tak meruntuhkan daftar project", async () => {
    await project("rusak", { bukan: "array" });
    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].handledBy).toEqual([]);
  });
});
