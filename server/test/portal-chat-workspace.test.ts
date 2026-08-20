import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { prisma } from "../src/db";
import { buildChatWorkspace } from "../src/services/portal-chat/workspace";

const clean = async () => {
  await prisma.ticket.deleteMany(); await prisma.spec.deleteMany();
  await prisma.changelog.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)).map((f) => join(e.name, f)) : [e.name]);

const isiSemua = (dir: string) =>
  walk(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");

async function seed() {
  await prisma.project.create({
    data: { id: "p1", name: "Toko Mekar", desc: "Toko kelontong online", kind: "existing" } });
  await prisma.project.create({
    data: { id: "p2", name: "Klinik Sehat", desc: "RAHASIA TETANGGA", kind: "existing" } });
  await prisma.spec.create({ data: {
    id: "SPEC-1", projectId: "p1", title: "Keranjang belanja", source: "brief", stage: "executing",
    priority: "tinggi", author: "op@internal.co", objective: "klien bisa checkout",
    payload: { context: "RAHASIA INTERNAL PAYLOAD" } } });
  await prisma.spec.create({ data: {
    id: "SPEC-9", projectId: "p2", title: "Jadwal dokter", source: "brief", stage: "done",
    priority: "rendah", author: "op@internal.co", objective: "RAHASIA TETANGGA" } });
  await prisma.ticket.create({ data: {
    id: "t1", projectId: "p1", number: 1, category: "bug", title: "Tombol mati",
    detail: "tidak bisa diklik", reporterEmail: "klien@x.co", status: "new", accessKeyHash: "h" } });
}

describe("workspace dokumen chat portal (SPEC-854 · ADR-0129)", () => {
  it("hanya berkas allowlist yang lahir — tanpa satu baris source code", async () => {
    await seed();
    const ws = await buildChatWorkspace("p1");
    try {
      const files = walk(ws.dir).sort();
      expect(files).toEqual(["catatan-rilis.md", "laporan.md", "pekerjaan.md", "project.md"]);
      for (const f of files) expect(f.endsWith(".md"), f).toBe(true);
    } finally { ws.cleanup(); }
  });

  it("isinya persis yang boleh dibaca klien — payload internal tak ikut", async () => {
    await seed();
    const ws = await buildChatWorkspace("p1");
    try {
      const semua = isiSemua(ws.dir);
      expect(semua).toContain("Toko Mekar");
      expect(semua).toContain("Keranjang belanja");
      expect(semua).toContain("Tombol mati");
      expect(semua).not.toContain("RAHASIA INTERNAL PAYLOAD");
      expect(semua).not.toContain("op@internal.co");   // penulis internal tak menyeberang
    } finally { ws.cleanup(); }
  });

  // Inti huruf E: tak ada satu pun jalur yang memasukkan isi project lain.
  it("isi project lain tidak pernah masuk", async () => {
    await seed();
    const ws = await buildChatWorkspace("p1");
    try {
      const semua = isiSemua(ws.dir);
      expect(semua).not.toContain("RAHASIA TETANGGA");
      expect(semua).not.toContain("Klinik Sehat");
      expect(semua).not.toContain("Jadwal dokter");
      expect(semua).not.toContain("SPEC-9");
    } finally { ws.cleanup(); }
  });

  it("cleanup menghapus seluruh direktori", async () => {
    await seed();
    const ws = await buildChatWorkspace("p1");
    const dir = ws.dir;
    ws.cleanup();
    expect(existsSync(dir)).toBe(false);
  });

  it("project tanpa isi tetap melahirkan workspace yang sah", async () => {
    await prisma.project.create({ data: { id: "kosong", name: "Kosong", desc: "", kind: "new" } });
    const ws = await buildChatWorkspace("kosong");
    try { expect(walk(ws.dir).length).toBeGreaterThan(0); } finally { ws.cleanup(); }
  });

  it("project yang tak ada ditolak, tanpa meninggalkan direktori", async () => {
    await expect(buildChatWorkspace("tak-ada")).rejects.toThrow();
  });
});
