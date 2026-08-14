import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processUpload, UPLOAD_LIMITS, UploadError } from "../src/services/upload-pipeline";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function dir() { return mkdtemp(join(tmpdir(), "hanoman-upload-")); }
afterEach(() => vi.restoreAllMocks());

describe("upload quarantine pipeline", () => {
  it("uses magic bytes instead of a spoofed client MIME", async () => {
    await expect(processUpload({
      buffer: PNG, clientName: "photo.jpg", clientMime: "image/jpeg", projectId: "p1", ticketBytes: 0,
    }, { storageDir: await dir(), scanner: async () => {} }))
      .rejects.toMatchObject({ code: "UPLOAD_TYPE" });
  });

  it("decodes and re-encodes images so appended active content is discarded", async () => {
    const storageDir = await dir();
    const result = await processUpload({
      buffer: Buffer.concat([PNG, Buffer.from("<script>alert(1)</script>")]),
      clientName: "../../proof.PNG", clientMime: "image/png", projectId: "p1", ticketBytes: 0,
    }, { storageDir, scanner: async () => {} });
    const stored = await readFile(join(storageDir, result.storageKey));
    expect(stored.includes(Buffer.from("<script>"))).toBe(false);
    expect(result).toMatchObject({ mimeType: "image/png", extension: ".png", width: 1, height: 1 });
    expect(result.filename).toBe("proof.png");
  });

  it("enforces cumulative quotas before promotion", async () => {
    await expect(processUpload({
      buffer: PNG, clientName: "p.png", clientMime: "image/png", projectId: "p1", ticketBytes: UPLOAD_LIMITS.ticketBytes,
    }, { storageDir: await dir(), scanner: async () => {} }))
      .rejects.toMatchObject({ code: "UPLOAD_QUOTA" });
  });

  it("fails closed when the malware scanner errors", async () => {
    await expect(processUpload({
      buffer: PNG, clientName: "p.png", clientMime: "image/png", projectId: "p1", ticketBytes: 0,
    }, { storageDir: await dir(), scanner: async () => { throw new Error("scanner unavailable"); } }))
      .rejects.toBeInstanceOf(UploadError);
  });
});
