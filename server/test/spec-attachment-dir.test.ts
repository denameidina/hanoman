import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";

const repoDir = await mkdtemp(join(tmpdir(), "hanoman-repo-"));
const uploads = await mkdtemp(join(tmpdir(), "hanoman-up-"));

vi.mock("../src/services/local-binding", () => ({ resolveRepoDir: async () => repoDir }));
process.env.HANOMAN_UPLOAD_DIR = uploads;

const { syncSpecAttachmentsDir, dropSpecAttachmentsDir, specAttachmentsDir } =
  await import("../src/services/spec-attachment-dir");

const specId = "SPEC-9200";
const dir = specAttachmentsDir(repoDir, "spec-9200");

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

async function seedFile(key: string, bodyText: string) {
  await mkdir(uploads, { recursive: true });
  await writeFile(join(uploads, key), bodyText, "utf8");
}

const attach = (filename: string, storageKey: string, mimeType = "text/plain", size = 4) =>
  prisma.specAttachment.create({ data: { specId, projectId: "sad-proj", filename, mimeType, size, storageKey } });

beforeAll(async () => {
  await clean();
  await prisma.project.create({ data: { id: "sad-proj", name: "SAD", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: specId, projectId: "sad-proj", title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(clean);

describe("SPEC-843 · materialisasi lampiran", () => {
  it("menulis berkas + INDEX.md dengan path absolut", async () => {
    await seedFile("k1.md", "# isi\n");
    await attach("catatan.md", "k1.md", "text/markdown", 7);
    const out = await syncSpecAttachmentsDir(specId, "sad-proj");
    expect(out).toHaveLength(1);
    expect(out[0]!.path).toBe(join(dir, "catatan.md"));
    expect(await readFile(join(dir, "catatan.md"), "utf8")).toBe("# isi\n");
    const index = await readFile(join(dir, "INDEX.md"), "utf8");
    expect(index).toContain("catatan.md");
    expect(index).toContain(join(dir, "catatan.md"));
  });

  it("rekonsiliasi PENUH: berkas yang barisnya hilang ikut dibuang", async () => {
    await seedFile("k1.md", "# isi\n");
    await seedFile("k2.txt", "log\n");
    const a = await attach("catatan.md", "k1.md", "text/markdown", 7);
    await attach("error.txt", "k2.txt");
    await syncSpecAttachmentsDir(specId, "sad-proj");
    expect((await readdir(dir)).sort()).toEqual(["INDEX.md", "catatan.md", "error.txt"]);

    await prisma.specAttachment.delete({ where: { id: a.id } });
    await syncSpecAttachmentsDir(specId, "sad-proj");
    expect((await readdir(dir)).sort()).toEqual(["INDEX.md", "error.txt"]);
  });

  it("nama yang bertabrakan dibedakan, bukan saling menimpa", async () => {
    await seedFile("k1.txt", "satu");
    await seedFile("k2.txt", "dua");
    await attach("log.txt", "k1.txt");
    await attach("log.txt", "k2.txt", "text/plain", 3);
    const out = await syncSpecAttachmentsDir(specId, "sad-proj");
    expect(out).toHaveLength(2);
    expect(new Set(out.map((a) => a.path)).size).toBe(2);
  });

  it("byte yang hilang dari upload dir tak disebut di manifest", async () => {
    await seedFile("k1.txt", "ada");
    await attach("ada.txt", "k1.txt");
    await attach("hilang.txt", "tak-pernah-ditulis.txt");
    const out = await syncSpecAttachmentsDir(specId, "sad-proj");
    expect(out.map((a) => a.filename)).toEqual(["ada.txt"]);
    expect(await readFile(join(dir, "INDEX.md"), "utf8")).not.toContain("hilang.txt");
  });

  it("tanpa lampiran: direktori dibuang, INDEX.md ikut", async () => {
    await seedFile("k1.md", "# isi\n");
    await attach("catatan.md", "k1.md", "text/markdown", 7);
    await syncSpecAttachmentsDir(specId, "sad-proj");
    await prisma.specAttachment.deleteMany({ where: { specId } });
    expect(await syncSpecAttachmentsDir(specId, "sad-proj")).toEqual([]);
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("dropSpecAttachmentsDir idempoten", async () => {
    await expect(dropSpecAttachmentsDir(specId, "sad-proj")).resolves.toBeUndefined();
  });
});
