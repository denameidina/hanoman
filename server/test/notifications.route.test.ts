import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb } from "./factory";

const app = buildApp({ requireAuth: false });

beforeEach(async () => {
  await resetDb();
  // `createdAt` eksplisit: dua `create` berturut-turut lazim jatuh di milidetik yang sama, dan
  // `orderBy createdAt desc` atas dua stempel yang seri mengembalikan urutan sesuka SQLite —
  // terlihat sebagai "SPEC-1 lebih dulu" hanya saat mesin sibuk (audit 2026-09-05).
  await prisma.notification.create({ data: { specId: "SPEC-1", title: "satu", projectId: "p1", createdAt: new Date("2026-09-05T00:00:00Z") } });
  await prisma.notification.create({ data: { specId: "SPEC-2", title: "dua", projectId: "p1", createdAt: new Date("2026-09-05T00:00:01Z") } });
});

describe("notifications routes", () => {
  it("GET mengembalikan items terbaru dulu + hitungan unread", async () => {
    const res = await app.inject({ url: "/api/notifications" });
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.unread).toBe(2);
    // terbaru dulu: SPEC-2 dibuat setelah SPEC-1
    expect(body.items[0].specId).toBe("SPEC-2");
  });

  it("POST /read menandai semua terbaca → unread 0", async () => {
    expect((await app.inject({ method: "POST", url: "/api/notifications/read" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().unread).toBe(0);
  });

  it("DELETE mengosongkan daftar", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/notifications" })).statusCode).toBe(204);
    const res = await app.inject({ url: "/api/notifications" });
    expect(res.json().items).toHaveLength(0);
  });
});

// SPEC-523 · 60 baris melampaui plafon 50 lama, jadi "tanpa limit" dan "total" tak bisa tertukar.
async function seed(n: number): Promise<void> {
  await prisma.notification.deleteMany();
  for (let i = 0; i < n; i++) {
    await prisma.notification.create({
      data: {
        specId: `SPEC-${i}`, title: `judul ${i}`, projectId: "p1",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
}

describe("GET /notifications — paginasi (SPEC-523)", () => {
  it("tanpa limit: 50 teratas seperti sebelum SPEC-523, tapi total menyatakan seluruhnya", async () => {
    await seed(60);
    const r = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items.length).toBe(50);
    expect(b.total).toBe(60);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(50);
    // terbaru dulu: detik ke-59 adalah yang paling baru
    expect(b.items[0].specId).toBe("SPEC-59");
  });

  it("page/limit memotong dengan benar dan total tetap penuh", async () => {
    await seed(60);
    const b = (await app.inject({ method: "GET", url: "/api/notifications?page=2&limit=10" })).json();
    expect(b.items.length).toBe(10);
    expect(b.total).toBe(60);
    expect(b.page).toBe(2);
    expect(b.pageSize).toBe(10);
    expect(b.items[0].specId).toBe("SPEC-49");   // halaman 1 = 59..50
  });

  it("page melampaui halaman terakhir: items kosong, total tetap benar", async () => {
    await seed(60);
    const b = (await app.inject({ method: "GET", url: "/api/notifications?page=99&limit=10" })).json();
    expect(b.items).toEqual([]);
    expect(b.total).toBe(60);
  });

  it("unread dihitung dari seluruh baris, bukan dari halaman yang diminta", async () => {
    await seed(60);
    const b = (await app.inject({ method: "GET", url: "/api/notifications?page=1&limit=5" })).json();
    expect(b.items.length).toBe(5);
    expect(b.unread).toBe(60);
  });
});
