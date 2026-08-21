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

describe("SPEC-880 · tulis & filter penanda 'ditangani oleh'", () => {
  it("PATCH menerima daftar sah dan memulangkan view yang diperkaya", async () => {
    const d = await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "hm-dena" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
    const row = await prisma.project.findUnique({ where: { id: "p1" } });
    expect(row!.handledBy).toEqual([{ deviceId: d.id, name: "hm-dena" }]);
  });

  it("PATCH menolak deviceId yang tak dikenal saat instance ini punya katalog device", async () => {
    await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: "karangan", name: "?" }] },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(r.json())).toContain("karangan");
  });

  it("PATCH menolak deviceId duplikat", async () => {
    const d = await device("hm-dena");
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "a" }, { deviceId: d.id, name: "b" }] },
    });
    expect(r.statusCode).toBe(400);
  });

  // Instance tanpa katalog device (client) tak berhak menghakimi deviceId — katalognya hidup di hub.
  it("tanpa satu pun DeviceToken, deviceId apa pun diterima", async () => {
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: "device-asal-hub", name: "hub-vps" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy).toEqual([{ deviceId: "device-asal-hub", name: "hub-vps", revoked: false }]);
  });

  // Device dicabut TETAP sah: kalau tidak, PATCH yang cuma mengganti nama project akan menolak
  // nilai handledBy yang sudah tersimpan.
  it("deviceId yang sudah dicabut tetap boleh disimpan", async () => {
    const d = await device("laptop-lama", true);
    await project("p1");
    const r = await app.inject({
      method: "PATCH", url: "/api/projects/p1",
      payload: { handledBy: [{ deviceId: d.id, name: "laptop-lama" }] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().handledBy[0].revoked).toBe(true);
  });

  it("null dan [] sama-sama mengosongkan penanda", async () => {
    const d = await device("hm-dena");
    for (const kosong of [null, []]) {
      await prisma.project.deleteMany();
      await project("p1", [{ deviceId: d.id, name: "hm-dena" }]);
      const r = await app.inject({ method: "PATCH", url: "/api/projects/p1", payload: { handledBy: kosong } });
      expect(r.statusCode).toBe(200);
      expect(r.json().handledBy).toEqual([]);
      expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.handledBy).toBeNull();
    }
  });

  it("POST /projects menerima handledBy", async () => {
    const d = await device("hm-dena");
    const r = await app.inject({
      method: "POST", url: "/api/projects",
      payload: { name: "baru", kind: "existing", handledBy: [{ deviceId: d.id, name: "hm-dena" }] },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: false }]);
  });

  it("?handledBy=<deviceId> menyaring daftar ke project mesin itu saja", async () => {
    const a = await device("hm-dena");
    const b = await device("hub-vps");
    await project("punya-a", [{ deviceId: a.id, name: "hm-dena" }]);
    await project("punya-b", [{ deviceId: b.id, name: "hub-vps" }]);
    await project("tak-bertuan");
    const r = await app.inject({ method: "GET", url: `/api/projects?handledBy=${a.id}` });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((p: { id: string }) => p.id)).toEqual(["punya-a"]);
    expect(r.json().total).toBe(1);
  });

  it("?handledBy= bergabung dengan q, bukan menggantikannya", async () => {
    const a = await device("hm-dena");
    await project("alpha", [{ deviceId: a.id, name: "hm-dena" }]);
    await project("beta", [{ deviceId: a.id, name: "hm-dena" }]);
    const r = await app.inject({ method: "GET", url: `/api/projects?handledBy=${a.id}&q=beta` });
    expect(r.json().items.map((p: { id: string }) => p.id)).toEqual(["beta"]);
  });

  // AC-7 · revoke adalah operasi pada DeviceToken; ia tak pernah menyentuh Project.handledBy.
  it("revoke device tak menghapus penanda project", async () => {
    const d = await device("hm-dena");
    await project("p1", [{ deviceId: d.id, name: "hm-dena" }]);
    await prisma.deviceToken.update({ where: { id: d.id }, data: { revokedAt: new Date() } });
    const one = await app.inject({ method: "GET", url: "/api/projects/p1" });
    expect(one.json().handledBy).toEqual([{ deviceId: d.id, name: "hm-dena", revoked: true }]);
    expect((await prisma.project.findUnique({ where: { id: "p1" } }))!.handledBy).toHaveLength(1);
  });
});
