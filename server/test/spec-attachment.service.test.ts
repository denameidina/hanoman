import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  addSpecAttachments, deleteSpecAttachment, dropSpecAttachments, listSpecAttachments,
  SPEC_ATTACHMENT_LIMITS,
} from "../src/services/spec-attachment";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const spec = { id: "SPEC-9100", projectId: "sa-proj" };

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sa-proj", name: "SA", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: spec.id, projectId: spec.projectId, title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(clean);

describe("SPEC-843 · addSpecAttachments", () => {
  it("menyimpan beberapa berkas sekaligus (gambar + dokumen)", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: PNG, mime: "image/png", name: "layar.png" },
      { buf: Buffer.from("# catatan\n", "utf8"), mime: "text/markdown", name: "catatan.md" },
      { buf: Buffer.from("a,b\n1,2\n", "utf8"), mime: "text/csv", name: "data.csv" },
    ]);
    expect(res.rejected).toEqual([]);
    expect(res.saved.map((a) => a.filename)).toEqual(["layar.png", "catatan.md", "data.csv"]);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(3);
  });

  it("berkas yang ditolak tak menggagalkan yang lain", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.from("halo", "utf8"), mime: "application/x-sh", name: "jahat.sh" },
      { buf: Buffer.from("halo", "utf8"), mime: "text/plain", name: "ok.txt" },
    ]);
    expect(res.saved.map((a) => a.filename)).toEqual(["ok.txt"]);
    expect(res.rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("menolak mime gambar yang ekstensinya tak cocok", async () => {
    const res = await addSpecAttachments(spec, [{ buf: PNG, mime: "image/png", name: "layar.jpg" }]);
    expect(res.rejected).toEqual([{ filename: "layar.jpg", reason: "type" }]);
  });

  it("menolak berkas melebihi batas per-berkas", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.alloc(SPEC_ATTACHMENT_LIMITS.fileBytes + 1, 0x61), mime: "text/plain", name: "besar.txt" },
    ]);
    expect(res.saved).toEqual([]);
    expect(res.rejected).toEqual([{ filename: "besar.txt", reason: "size" }]);
  });

  it("menolak berkas yang datang ter-truncate", async () => {
    const res = await addSpecAttachments(spec, [
      { buf: Buffer.from("x", "utf8"), mime: "text/plain", name: "potong.txt", truncated: true },
    ]);
    expect(res.rejected).toEqual([{ filename: "potong.txt", reason: "size" }]);
  });

  it("menegakkan batas jumlah per backlog", async () => {
    const many = Array.from({ length: SPEC_ATTACHMENT_LIMITS.perSpec + 2 }, (_, i) =>
      ({ buf: Buffer.from(`isi ${i}`, "utf8"), mime: "text/plain", name: `f${i}.txt` }));
    const res = await addSpecAttachments(spec, many);
    expect(res.saved.length).toBe(SPEC_ATTACHMENT_LIMITS.perSpec);
    expect(res.rejected.every((r) => r.reason === "count")).toBe(true);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(SPEC_ATTACHMENT_LIMITS.perSpec);
  });

  it("batas jumlah dihitung dari lampiran yang SUDAH ada, bukan hanya request ini", async () => {
    for (let i = 0; i < SPEC_ATTACHMENT_LIMITS.perSpec; i++)
      await addSpecAttachments(spec, [{ buf: Buffer.from(`i${i}`, "utf8"), mime: "text/plain", name: `a${i}.txt` }]);
    const res = await addSpecAttachments(spec, [{ buf: Buffer.from("x", "utf8"), mime: "text/plain", name: "lebih.txt" }]);
    expect(res.saved).toEqual([]);
    expect(res.rejected).toEqual([{ filename: "lebih.txt", reason: "count" }]);
  });
});

describe("SPEC-843 · daftar & hapus", () => {
  it("listSpecAttachments urut createdAt naik", async () => {
    await addSpecAttachments(spec, [
      { buf: Buffer.from("satu", "utf8"), mime: "text/plain", name: "a.txt" },
      { buf: Buffer.from("dua", "utf8"), mime: "text/plain", name: "b.txt" },
    ]);
    expect((await listSpecAttachments(spec.id)).map((a) => a.filename)).toEqual(["a.txt", "b.txt"]);
  });

  it("deleteSpecAttachment membuang baris & menolak lampiran milik spec lain", async () => {
    const { saved } = await addSpecAttachments(spec, [{ buf: Buffer.from("x", "utf8"), mime: "text/plain", name: "a.txt" }]);
    expect(await deleteSpecAttachment("SPEC-OTHER", saved[0]!.id)).toBe(false);
    expect(await deleteSpecAttachment(spec.id, saved[0]!.id)).toBe(true);
    expect(await prisma.specAttachment.count({ where: { specId: spec.id } })).toBe(0);
  });

  it("dropSpecAttachments idempoten pada spec tanpa lampiran", async () => {
    await expect(dropSpecAttachments(spec.id)).resolves.toBeUndefined();
  });
});
