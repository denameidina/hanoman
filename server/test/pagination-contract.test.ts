import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });

// SPEC-523 · ADR-0107 · daftar utama dashboard. Konstanta di sini bukan hiasan: daftar BARU yang
// lahir tanpa halaman harus punya satu tempat yang menolaknya.
//
// Yang SENGAJA tak ada di sini, berikut alasannya (ADR-0107):
//   · `/projects/:id/graph` — jendela tumbuh, bukan halaman diskrit; lane butuh commit KONTIGU
//   · `/projects/:id/docs`  — pohon kategori→berkas, bukan daftar rata
//   · error monitoring      — dicabut ADR-0092, tak ada endpointnya
const LIST_ENDPOINTS = [
  "/api/specs",
  "/api/projects",
  "/api/tickets",
  "/api/notifications",
  "/api/terminal/history",
  "/api/scheduler/queue",
  "/api/lead/decisions",
  "/api/lead/flows",
  "/api/projects/p-pagination/changelog",
  "/api/projects/p-pagination/github/issues",
] as const;

beforeAll(async () => {
  await app.ready();
  await prisma.project.upsert({
    where: { id: "p-pagination" }, update: {},
    create: { id: "p-pagination", name: "pagination", desc: "", kind: "existing" },
  });
});
afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: "p-pagination" } });
  await app.close();
});

describe("kontrak paginasi daftar utama (SPEC-523 · ADR-0107)", () => {
  for (const url of LIST_ENDPOINTS) {
    it(`${url} menerima page/limit dan membalas amplop Paginated`, async () => {
      const r = await app.inject({ method: "GET", url: `${url}?page=1&limit=1` });
      expect(r.statusCode, `${url} balas ${r.statusCode}`).toBe(200);
      const b = r.json();
      expect(Array.isArray(b.items), `${url} tak punya items[]`).toBe(true);
      expect(typeof b.total, `${url} tak punya total`).toBe("number");
      expect(typeof b.page, `${url} tak punya page`).toBe("number");
      expect(typeof b.pageSize, `${url} tak punya pageSize`).toBe("number");
      expect(b.items.length, `${url} tak menghormati limit=1`).toBeLessThanOrEqual(1);
    });
  }
});
