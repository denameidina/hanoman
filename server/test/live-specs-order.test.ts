import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { liveSpecs } from "../src/services/live-specs";

const clean = async () => { await prisma.spec.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "po", name: "PO", desc: "", kind: "existing" } });
});
afterAll(clean);

const spec = (id: string) => prisma.spec.create({
  data: { id, projectId: "po", title: id, source: "brief", stage: "brainstorming",
    priority: "sedang", author: "a", objective: "" },
});

// Nomor SPEC hidup di kolom STRING, jadi `orderBy: { id: "desc" }` mengurutkannya leksikografis:
// "SPEC-999" > "SPEC-140" > "SPEC-1015". Begitu backlog tembus empat digit, item TERBARU justru
// jatuh ke halaman TERAKHIR — terlihat seperti "spec 1000 ke atas tidak tampil" karena list view
// dipaginasi 20/halaman. Urutan diturunkan dari NOMOR-nya, dan kontrak ini dipegang bersama oleh
// GET /specs dan grup siar WS `specs` (SPEC-199) — keduanya membaca liveSpecs yang sama.
describe("liveSpecs · urutan nomor SPEC empat digit", () => {
  it("nomor empat digit mendahului tiga digit (bukan urutan leksikografis)", async () => {
    for (const id of ["SPEC-140", "SPEC-999", "SPEC-1000", "SPEC-1015"]) await spec(id);
    const rows = await liveSpecs({ project: "po" });
    expect(rows.map((r) => r.id)).toEqual(["SPEC-1015", "SPEC-1000", "SPEC-999", "SPEC-140"]);
  });

  it("id tanpa nomor tetap terurut stabil di belakang, tak menghilang", async () => {
    for (const id of ["SPEC-1000", "SPEC-9", "SPEC-BEBAS"]) await spec(id);
    const rows = await liveSpecs({ project: "po" });
    expect(rows.map((r) => r.id)).toEqual(["SPEC-1000", "SPEC-9", "SPEC-BEBAS"]);
  });
});
