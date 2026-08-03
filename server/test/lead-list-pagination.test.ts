import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.leadDecision.deleteMany(); await prisma.leadFlow.deleteMany(); };
beforeEach(clean); afterAll(clean);

async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.leadDecision.create({
      data: {
        projectId: "p1", gate: "detected", kind: "answer",
        question: `q${i}`, answer: `a${i}`, reason: "r", refs: [],
        confidence: "tinggi", action: "none", status: "berlaku", weighty: false,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
}

describe("GET /lead/decisions & /lead/flows — paginasi (SPEC-523)", () => {
  it("page/limit memotong dan total menyatakan seluruh baris tersaring", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?page=2&limit=10" })).json();
    expect(b.items.length).toBe(10);
    expect(b.total).toBe(25);
    expect(b.page).toBe(2);
    expect(b.pageSize).toBe(10);
  });

  it("take/skip lama tetap berperilaku sama (kompatibilitas)", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?take=5&skip=5" })).json();
    expect(b.items.length).toBe(5);
    expect(b.total).toBe(25);
  });

  it("page/limit menang bila dikirim bersama take/skip", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?take=5&skip=5&page=1&limit=3" })).json();
    expect(b.items.length).toBe(3);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(3);
  });

  it("total menghormati penyaring, bukan seluruh tabel", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?projectId=lain&page=1&limit=5" })).json();
    expect(b.total).toBe(0);
    expect(b.items).toEqual([]);
  });

  it("GET /lead/flows juga beramplop", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/lead/flows?page=1&limit=5" })).json();
    expect(b).toMatchObject({ items: [], total: 0, page: 1, pageSize: 5 });
  });
});
