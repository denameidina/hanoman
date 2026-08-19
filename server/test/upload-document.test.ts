import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDocumentUpload, UploadError } from "../src/services/upload-pipeline";

const PDF = Buffer.from("255044462d312e340a25c4e5f2e5eba7f3a0d0c4c6", "hex");
async function dir() { return mkdtemp(join(tmpdir(), "hanoman-doc-")); }
const deps = async () => ({ storageDir: await dir(), scanner: async () => {} });

describe("SPEC-843 · pipeline dokumen", () => {
  it("menyimpan markdown UTF-8 dan menyanitasi nama berkasnya", async () => {
    const storageDir = await dir();
    const out = await processDocumentUpload({
      buffer: Buffer.from("# Judul\n\nisi\n", "utf8"),
      clientName: "../../catatan rapat.MD", clientMime: "text/markdown", clientExt: ".md",
    }, { storageDir, scanner: async () => {} });
    expect(out.filename).toBe("catatan rapat.md");
    expect(out.mimeType).toBe("text/markdown");
    expect(await readFile(join(storageDir, out.storageKey), "utf8")).toContain("# Judul");
  });

  it("menolak biner yang menyamar sebagai .txt", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from([0x00, 0x01, 0x02, 0x00]),
      clientName: "log.txt", clientMime: "text/plain", clientExt: ".txt",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("menerima pdf yang magic bytes-nya cocok", async () => {
    const out = await processDocumentUpload({
      buffer: PDF, clientName: "spek.pdf", clientMime: "application/pdf", clientExt: ".pdf",
    }, await deps());
    expect(out.mimeType).toBe("application/pdf");
  });

  it("menolak pdf palsu (magic bytes tak cocok)", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("bukan pdf sama sekali", "utf8"),
      clientName: "spek.pdf", clientMime: "application/pdf", clientExt: ".pdf",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("menolak pasangan mime ↔ ekstensi yang tak cocok", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("halo", "utf8"),
      clientName: "x.csv", clientMime: "text/markdown", clientExt: ".csv",
    }, await deps())).rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("gagal-tertutup saat scanner melempar", async () => {
    await expect(processDocumentUpload({
      buffer: Buffer.from("halo", "utf8"),
      clientName: "x.txt", clientMime: "text/plain", clientExt: ".txt",
    }, { storageDir: await dir(), scanner: async () => { throw new Error("nope"); } }))
      .rejects.toBeInstanceOf(UploadError);
  });
});
