import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearConfig, setConfig } from "../src/config";
import { prisma } from "../src/db";
import { enqueueOutbox } from "../src/services/outbox";
import { syncOnce, type Transport } from "../src/services/sync-client";
import { deleteUpload, readUpload } from "../src/services/uploads";
import { makeProject, resetDb } from "./factory";

// safeRequest dimock: "hub" disimulasikan oleh pemanggil test. DB/disk tetap nyata.
const hub = vi.hoisted(() => ({ calls: [] as { method: string; path: string; headers: Record<string, string>; body?: Buffer }[], handler: (() => ({ status: 200, headers: {}, body: Buffer.alloc(0) })) as (c: { method: string; path: string; headers: Record<string, string>; body?: Buffer }) => { status: number; headers: Record<string, string>; body: Buffer } }));
vi.mock("../src/services/safe-outbound-request", () => ({
  safeRequest: async (o: { url: URL; method: string; headers: Record<string, string>; body?: Buffer }) => {
    const call = { method: o.method, path: o.url.pathname, headers: o.headers, body: o.body };
    hub.calls.push(call);
    return hub.handler(call);
  },
}));
const { readQaAttachmentBytes, uploadPendingQaBytes, downloadPendingQaBytes } = await import("../src/services/qa-attachment-transfer");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const key = (n: number) => `00000000-0000-4000-8000-00000000000${n}.png`;
const ok = (body: Buffer = Buffer.alloc(0), status = 200) => ({ status, headers: {}, body });

async function row(n: number, over: Record<string, unknown> = {}) {
  if (n === 1) await prisma.qaReport.create({ data: { id: "r1", projectId: "p1", title: "T" } });
  return prisma.qaAttachment.create({ data: {
    id: `a${n}`, reportId: "r1", projectId: "p1", ownerType: "report", ownerId: "r1", filename: `f${n}.png`, mimeType: "image/png",
    size: PNG.length, sha256: sha(PNG), storageKey: key(n), syncState: "remote", ...over,
  } });
}
const configure = async () => { await setConfig("SYNC_SERVER_URL", "http://hub.example"); await setConfig("SYNC_DEVICE_TOKEN", "tok-xyz"); };
const state = async (id: string) => (await prisma.qaAttachment.findUniqueOrThrow({ where: { id } })).syncState;

beforeEach(async () => {
  hub.calls.length = 0; hub.handler = () => ok();
  for (let i = 1; i <= 8; i++) await deleteUpload(key(i)).catch(() => {});
  await resetDb(); await prisma.syncOutbox.deleteMany(); await prisma.syncLog.deleteMany(); await prisma.syncState.deleteMany();
  await makeProject({ id: "p1" });
});
afterEach(async () => { for (const k of ["SYNC_SERVER_URL", "SYNC_DEVICE_TOKEN"]) await clearConfig(k); });

describe("readQaAttachmentBytes (fetch-through)", () => {
  it("byte ada lokal → dibaca tanpa jaringan", async () => {
    await configure(); await row(1, { syncState: "available" });
    await saveUploadAs(key(1), PNG);
    expect((await readQaAttachmentBytes("a1"))!.equals(PNG)).toBe(true);
    expect(hub.calls).toHaveLength(0);
  });
  it("byte belum ada: ditarik dari hub (Bearer), diverifikasi, di-cache ke storageKey, state → available; pembacaan kedua lokal", async () => {
    await configure(); await row(1);
    hub.handler = () => ok(PNG);
    expect((await readQaAttachmentBytes("a1"))!.equals(PNG)).toBe(true);
    expect(hub.calls).toHaveLength(1);
    expect(hub.calls[0]).toMatchObject({ method: "GET", path: "/api/sync/qa-attachments/a1" });
    expect(hub.calls[0]!.headers.authorization).toBe("Bearer tok-xyz");
    expect((await readUpload(key(1))).equals(PNG)).toBe(true);
    expect(await state("a1")).toBe("available");
    await readQaAttachmentBytes("a1");
    expect(hub.calls).toHaveLength(1);
  });
  it("byte dari hub yang TAK cocok sha256 ditolak: null, tak di-cache, state tetap remote", async () => {
    await configure(); await row(1);
    hub.handler = () => ok(Buffer.concat([PNG, Buffer.from("x")]));
    expect(await readQaAttachmentBytes("a1")).toBeNull();
    await expect(readUpload(key(1))).rejects.toBeTruthy();
    expect(await state("a1")).toBe("remote");
  });
  it("hub 404/5xx → null; bukan client sync → null TANPA jaringan; id tak ada → null", async () => {
    await row(1);
    expect(await readQaAttachmentBytes("a1")).toBeNull();
    expect(hub.calls).toHaveLength(0);
    await configure();
    hub.handler = () => ok(Buffer.alloc(0), 404);
    expect(await readQaAttachmentBytes("a1")).toBeNull();
    hub.handler = () => ok(Buffer.alloc(0), 503);
    expect(await readQaAttachmentBytes("a1")).toBeNull();
    expect(await readQaAttachmentBytes("hantu")).toBeNull();
  });
  it("pembacaan serentak untuk satu lampiran → SATU unduhan (lima <img> tak menggandakan)", async () => {
    await configure(); await row(1);
    hub.handler = () => ok(PNG);
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => readQaAttachmentBytes("a1")));
    expect(all.every((b) => b?.equals(PNG))).toBe(true);
    expect(hub.calls).toHaveLength(1);
  });
});

describe("uploadPendingQaBytes", () => {
  it("PUT octet-stream ber-Bearer berisi byte persis; 200 → available", async () => {
    await configure(); await row(1, { syncState: "local-only" }); await saveUploadAs(key(1), PNG);
    const r = await uploadPendingQaBytes();
    expect(r).toMatchObject({ uploaded: 1 });
    expect(hub.calls[0]).toMatchObject({ method: "PUT", path: "/api/sync/qa-attachments/a1" });
    expect(hub.calls[0]!.headers["content-type"]).toBe("application/octet-stream");
    expect(hub.calls[0]!.headers.authorization).toBe("Bearer tok-xyz");
    expect(hub.calls[0]!.body!.equals(PNG)).toBe(true);
    expect(await state("a1")).toBe("available");
  });
  it("404 (metadata belum sampai) & galat jaringan → tetap local-only, tak melempar; 400/415 (ditolak hub) → failed", async () => {
    await configure();
    for (const n of [1, 2, 3]) { await row(n, { syncState: "local-only" }); await saveUploadAs(key(n), PNG); }
    const answers: Record<string, number | "boom"> = { a1: 404, a2: 415, a3: "boom" };
    hub.handler = (c) => { const v = answers[c.path.split("/").pop()!]; if (v === "boom") throw new Error("ECONNRESET"); return ok(Buffer.alloc(0), v as number); };
    await expect(uploadPendingQaBytes()).resolves.toBeTruthy();
    expect(await state("a1")).toBe("local-only");
    expect(await state("a2")).toBe("failed");
    expect(await state("a3")).toBe("local-only");
  });
  it("byte lokal hilang → failed (tak bisa diunggah, jangan diulang selamanya)", async () => {
    await configure(); await row(1, { syncState: "local-only" });
    await uploadPendingQaBytes();
    expect(await state("a1")).toBe("failed");
    expect(hub.calls).toHaveLength(0);
  });
  it("dilewati bila metadatanya masih antre di outbox (hub pasti menjawab 404)", async () => {
    await configure(); await row(1, { syncState: "local-only" }); await saveUploadAs(key(1), PNG);
    await enqueueOutbox("qaAttachment", "a1");
    await uploadPendingQaBytes();
    expect(hub.calls).toHaveLength(0);
    expect(await state("a1")).toBe("local-only");
  });
  it("maksimal 5 per panggilan; bukan client → no-op tanpa jaringan", async () => {
    for (let n = 1; n <= 7; n++) { await row(n, { syncState: "local-only" }); await saveUploadAs(key(n), PNG); }
    expect(await uploadPendingQaBytes()).toMatchObject({ uploaded: 0 });
    expect(hub.calls).toHaveLength(0);
    await configure();
    expect((await uploadPendingQaBytes()).uploaded).toBe(5);
    expect((await uploadPendingQaBytes()).uploaded).toBe(2);
  });
});

describe("siklus sync menjalankan unggah byte", () => {
  it("syncOnce (feed kosong) mengunggah byte yang menunggu — SESUDAH outbox dikuras", async () => {
    await configure(); await row(1, { syncState: "local-only" }); await saveUploadAs(key(1), PNG);
    const transport: Transport = async (method) => (method === "GET" ? { status: 200, body: { records: [], cursor: "0", hasMore: false } } : { status: 200, body: { results: [] } });
    await syncOnce(transport);
    expect(hub.calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(await state("a1")).toBe("available");
  });
  it("galat saat unggah TIDAK menggagalkan siklus sync", async () => {
    await configure(); await row(1, { syncState: "local-only" }); await saveUploadAs(key(1), PNG);
    hub.handler = () => { throw new Error("hub mati"); };
    const transport: Transport = async () => ({ status: 200, body: { records: [], cursor: "0", hasMore: false } });
    await expect(syncOnce(transport)).resolves.toMatchObject({ pulled: 0 });
  });
});

// helper: tulis byte persis ke storageKey tertentu (saveUpload membuat key acak)
async function saveUploadAs(storageKey: string, buf: Buffer) {
  const { storeQaBytes } = await import("../src/services/qa-attachment-sync");
  await storeQaBytes(storageKey, buf);
}


describe("unduh QA otomatis", () => {
  it("syncOnce downloads remote bytes without opening an attachment", async () => {
    await configure(); await row(1); hub.handler = () => ok(PNG);
    const transport: Transport = async () => ({ status: 200, body: { records: [], cursor: "0", hasMore: false } });
    await syncOnce(transport);
    expect(await state("a1")).toBe("available");
    expect((await readUpload(key(1))).equals(PNG)).toBe(true);
    expect(hub.calls.map((c) => c.method)).toEqual(["GET"]);
  });
  it("downloads at most five, advances past missing/corrupt bytes, then retries", async () => {
    await configure();
    for (let n = 1; n <= 7; n++) await row(n);
    hub.handler = (c) => c.path.endsWith("a1") ? ok(Buffer.from("corrupt")) : ok(PNG);
    const first = await downloadPendingQaBytes();
    expect(hub.calls.length).toBeLessThanOrEqual(5);
    expect(first.downloaded).toBeGreaterThan(0);
    await downloadPendingQaBytes(); await downloadPendingQaBytes();
    expect(await state("a7")).toBe("available");
    expect(await state("a1")).toBe("remote");
    hub.handler = () => ok(PNG);
    await downloadPendingQaBytes();
    expect(await state("a1")).toBe("available");
  });
  it("standalone does not fetch; offline keeps remote state for retry", async () => {
    await row(1);
    expect(await downloadPendingQaBytes()).toEqual({ downloaded: 0, pending: 0 });
    expect(hub.calls).toHaveLength(0);
    await configure(); hub.handler = () => { throw new Error("offline"); };
    await downloadPendingQaBytes(); expect(await state("a1")).toBe("remote");
  });
});


it("uploads rotate past temporary failures so later files are not starved", async () => {
  await configure();
  for (let n = 1; n <= 7; n++) { await row(n, { syncState: "local-only" }); await saveUploadAs(key(n), PNG); }
  hub.handler = (c) => ["a6", "a7"].some((id) => c.path.endsWith(id)) ? ok() : ok(Buffer.alloc(0), 503);
  await uploadPendingQaBytes(); await uploadPendingQaBytes(); await uploadPendingQaBytes();
  expect(await state("a7")).toBe("available");
  expect(await state("a1")).toBe("local-only");
  hub.handler = () => ok();
  await uploadPendingQaBytes(); await uploadPendingQaBytes();
  expect(await state("a1")).toBe("available");
});
