import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { deleteUpload, readUpload } from "../src/services/uploads";
import { makeProject, resetDb } from "./factory";

// Workspace QA · bagian 3 · byte lampiran lewat endpoint device-token terpisah (BUKAN feed). Hub memverifikasi
// ukuran + sha256 + tipe sebelum menulis ke `storageKey` baris itu — storageKey datang dari peer, jadi jalur
// tulisnya adalah permukaan serangan.
const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const KEY = "5d0c7a54-3f0b-4b61-9a43-0c7d5d2b8f10.png";
let auth: Record<string, string> = {};

async function meta(over: Record<string, unknown> = {}) {
  await prisma.qaReport.create({ data: { id: "r1", projectId: "p1", title: "T" } });
  return prisma.qaAttachment.create({ data: {
    id: "a1", reportId: "r1", projectId: "p1", ownerType: "report", ownerId: "r1", filename: "l.png", mimeType: "image/png",
    size: PNG.length, sha256: sha(PNG), storageKey: KEY, syncState: "remote", ...over,
  } });
}
const put = (id: string, body: Buffer | string, headers: Record<string, string> = { "content-type": "application/octet-stream", ...auth }) =>
  app.inject({ method: "PUT", url: `/api/sync/qa-attachments/${id}`, headers, payload: body });
const get = (id: string, headers: Record<string, string> = auth) => app.inject({ method: "GET", url: `/api/sync/qa-attachments/${id}`, headers });

const KEYS = [KEY, "11111111-2222-3333-4444-555555555555.log", "22222222-2222-3333-4444-555555555555.txt"];
beforeEach(async () => {
  for (const k of KEYS) await deleteUpload(k).catch(() => {});      // upload dir bertahan antar test — bersihkan byte sisa
  await resetDb(); await prisma.deviceToken.deleteMany(); await prisma.user.deleteMany();
  await makeProject({ id: "p1" });
  const u = await prisma.user.create({ data: { email: "dev@x.co", passwordHash: "x:y" } });
  auth = { authorization: `Bearer ${(await issueDeviceToken(u.id, "laptop")).token}` };
});

describe("GET /sync/qa-attachments/:id", () => {
  it("401 tanpa device token (cookie TIDAK cukup untuk permukaan mesin-ke-mesin)", async () => {
    await meta();
    expect((await get("a1", {})).statusCode).toBe(401);
  });
  it("404: id tak ada; baris ada tapi byte belum ada di hub", async () => {
    expect((await get("hantu")).statusCode).toBe(404);
    await meta();
    expect((await get("a1")).statusCode).toBe(404);
  });
  it("200: byte + content-type + x-qa-sha256, setelah byte diunggah", async () => {
    await meta();
    expect((await put("a1", PNG)).statusCode).toBe(200);
    const res = await get("a1");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-qa-sha256"]).toBe(sha(PNG));
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });
});

describe("PUT /sync/qa-attachments/:id", () => {
  it("401 tanpa token; 404 id tak ada (metadata harus sampai lebih dulu)", async () => {
    await meta();
    expect((await put("a1", PNG, { "content-type": "application/octet-stream" })).statusCode).toBe(401);
    expect((await put("hantu", PNG)).statusCode).toBe(404);
  });
  it("menulis ke storageKey baris, menandai available, dan idempoten", async () => {
    await meta();
    const res = await put("a1", PNG);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, state: "available" });
    expect((await readUpload(KEY)).equals(PNG)).toBe(true);
    expect((await prisma.qaAttachment.findUniqueOrThrow({ where: { id: "a1" } })).syncState).toBe("available");
    expect((await put("a1", PNG)).statusCode).toBe(200);              // ulang = sukses, bukan 409
  });
  it("400 ukuran tak cocok; 400 sha256 tak cocok — tak ada yang tertulis", async () => {
    await meta();
    const wrongSize = await put("a1", Buffer.concat([PNG, Buffer.from("x")]));
    expect(wrongSize.statusCode).toBe(400);
    expect(wrongSize.json().error).toBe("size");
    const tampered = Buffer.from(PNG); tampered[tampered.length - 2] = (tampered[tampered.length - 2]! + 1) % 256;
    const wrongSha = await put("a1", tampered);
    expect(wrongSha.statusCode).toBe(400);
    expect(wrongSha.json().error).toBe("sha256");
    await expect(readUpload(KEY)).rejects.toBeTruthy();
    expect((await prisma.qaAttachment.findUniqueOrThrow({ where: { id: "a1" } })).syncState).toBe("remote");
  });
  it("415 isi tak sesuai tipe yang diklaim baris (sha & ukuran cocok, tapi bukan PNG)", async () => {
    const fake = Buffer.from("ini teks biasa, bukan png");
    await meta({ size: fake.length, sha256: sha(fake) });
    const res = await put("a1", fake);
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe("type");
    await expect(readUpload(KEY)).rejects.toBeTruthy();
  });
  it("teks: UTF-8 sah diterima; biner berpura-pura teks ditolak", async () => {
    const txt = Buffer.from("log baris 1\nbaris 2 ✓\n", "utf8");
    await meta({ mimeType: "text/plain", filename: "a.log", storageKey: "11111111-2222-3333-4444-555555555555.log", size: txt.length, sha256: sha(txt) });
    expect((await put("a1", txt)).statusCode).toBe(200);
    const bin = Buffer.from([0x68, 0x69, 0x00, 0xff, 0xfe]);
    await prisma.qaAttachment.create({ data: { id: "a2", reportId: "r1", projectId: "p1", ownerType: "report", ownerId: "r1", filename: "b.txt", mimeType: "text/plain", size: bin.length, sha256: sha(bin), storageKey: "22222222-2222-3333-4444-555555555555.txt" } });
    expect((await put("a2", bin)).statusCode).toBe(415);
  });
  it("415 bila bukan application/octet-stream (JSON tak boleh dipakai membawa byte)", async () => {
    await meta();
    expect((await put("a1", JSON.stringify({ a: 1 }), { "content-type": "application/json", ...auth })).statusCode).toBe(415);
  });
  it("413 body melebihi 10 MB", async () => {
    await meta();
    expect((await put("a1", Buffer.alloc(10 * 1024 * 1024 + 4096))).statusCode).toBe(413);
  });
  it("400 storageKey di baris yang tak sah (pertahanan berlapis: tak pernah menyentuh path di luar upload dir)", async () => {
    await meta({ storageKey: "../../etc/passwd" });
    expect((await put("a1", PNG)).statusCode).toBe(400);
    expect((await get("a1")).statusCode).toBe(400);
  });
});
