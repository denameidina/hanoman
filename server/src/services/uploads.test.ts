import { describe, it, expect, vi } from "vitest";
import { saveUpload, readUpload, deleteUpload, extFor, readUploadOrFetch } from "./uploads";
import { createServer } from "node:http";

describe("uploads", () => {
  it("extFor memetakan mime gambar", () => {
    expect(extFor("image/png")).toBe(".png");
    expect(extFor("image/jpeg")).toBe(".jpg");
    expect(extFor("image/webp")).toBe(".webp");
    expect(extFor("application/zip")).toBe(".bin");
  });
  it("save → read → delete round-trip", async () => {
    const buf = Buffer.from("PNGDATA");
    const { storageKey, size } = await saveUpload(buf, "image/png");
    expect(size).toBe(buf.length);
    expect(storageKey.endsWith(".png")).toBe(true);
    expect((await readUpload(storageKey)).equals(buf)).toBe(true);
    await deleteUpload(storageKey);
    await expect(readUpload(storageKey)).rejects.toThrow();
  });

  it("readUploadOrFetch: hit lokal mengembalikan file tanpa fetch", async () => {
    const { storageKey } = await saveUpload(Buffer.from("LOCAL"), "image/png");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await readUploadOrFetch(storageKey)).equals(Buffer.from("LOCAL"))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await deleteUpload(storageKey);
  });

  it("readUploadOrFetch: miss tanpa SYNC_SERVER_URL → throw", async () => {
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
    await expect(readUploadOrFetch("hilang.png")).rejects.toThrow();
  });

  it("readUploadOrFetch: miss + client sync → tarik dari hub lalu cache", async () => {
    let authorization = ""; let requested = "";
    const server = createServer((req, res) => {
      authorization = String(req.headers.authorization ?? ""); requested = req.url ?? "";
      res.writeHead(200, { "content-type": "image/png" }); res.end("REMOTE");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.SYNC_SERVER_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.SYNC_DEVICE_TOKEN = "tok";
    const key = "fetched-abc.png";
    const buf = await readUploadOrFetch(key);
    expect(buf.equals(Buffer.from("REMOTE"))).toBe(true);
    expect(requested).toBe("/api/sync/attachments/fetched-abc.png");
    expect(authorization).toBe("Bearer tok");
    // ter-cache: baca kedua tak fetch lagi
    requested = "";
    expect((await readUploadOrFetch(key)).equals(Buffer.from("REMOTE"))).toBe(true);
    expect(requested).toBe("");
    await deleteUpload(key);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.SYNC_SERVER_URL; delete process.env.SYNC_DEVICE_TOKEN;
  });
});
