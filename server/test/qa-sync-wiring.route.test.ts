import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { clearConfig, setConfig } from "../src/config";
import { pull } from "../src/services/sync";
import { listOutbox } from "../src/services/outbox";
import { findTombstone } from "../src/services/tombstone";
import { readUpload } from "../src/services/uploads";
import { csvEncode } from "@hanoman/shared";
import { makeProject, resetDb } from "./factory";

// Workspace QA · bagian 3 · SETIAP tulisan QA harus tampak di mesin lain: hub → SyncLog (publishLocal),
// client → outbox (enqueueOutbox); setiap hapus → tombstone. Test ini menjaga agar jalur tulis baru tak lupa
// memanggil notifySynced/deleteSynced (kelas bug SPEC-431/448/475/481).
const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const R = (tail = "") => `/api/projects/p1/qa/reports${tail}`;
const call = (method: "POST" | "PATCH" | "DELETE" | "GET", url: string, payload?: unknown) =>
  app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
const upload = (url: string, field: string, name: string, type: string, body: Buffer) => {
  const b = "----qasyncwire";
  return app.inject({ method: "POST", url, headers: { "content-type": `multipart/form-data; boundary=${b}` },
    payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from(`\r\n--${b}--\r\n`)]) });
};
const feed = async () => (await pull("0")).records as { entity: string; recordId: string; op: string; version: number }[];
const inFeed = async (entity: string, id: string, op = "upsert") => (await feed()).some((r) => r.entity === entity && r.recordId === id && r.op === op);

let rid = ""; let cid = ""; let fid = ""; let aid = "";
async function seed() {
  rid = (await call("POST", R(), { title: "Smoke" })).json().id;
  cid = (await call("POST", R(`/${rid}/cases`), { title: "Login" })).json().cases[0].id;
  fid = (await call("POST", R(`/${rid}/findings`), { title: "Bug", caseId: cid })).json().findings[0].id;
  aid = (await upload(R(`/${rid}/attachments?ownerType=finding&ownerId=${fid}`), "files", "layar.png", "image/png", PNG)).json().saved[0].id;
}
beforeEach(async () => { await resetDb(); await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany(); await prisma.syncTombstone.deleteMany(); await makeProject({ id: "p1" }); });
afterEach(async () => { await clearConfig("SYNC_SERVER_URL"); });

describe("mode hub: tulisan → SyncLog", () => {
  it("laporan, test case, temuan, lampiran: create masuk feed", async () => {
    await seed();
    expect(await inFeed("qaReport", rid)).toBe(true);
    expect(await inFeed("qaCase", cid)).toBe(true);
    expect(await inFeed("qaFinding", fid)).toBe(true);
    expect(await inFeed("qaAttachment", aid)).toBe(true);
  });
  it("PATCH laporan/case/temuan menaikkan version di feed", async () => {
    await seed();
    const v = async (e: string, id: string) => Math.max(...(await feed()).filter((r) => r.entity === e && r.recordId === id).map((r) => r.version));
    const [r0, c0, f0] = [await v("qaReport", rid), await v("qaCase", cid), await v("qaFinding", fid)];
    await call("PATCH", R(`/${rid}`), { summary: "ubah" });
    await call("PATCH", R(`/${rid}/cases/${cid}`), { status: "pass" });
    await call("PATCH", R(`/${rid}/findings/${fid}`), { severity: "minor" });
    expect(await v("qaReport", rid)).toBeGreaterThan(r0);
    expect(await v("qaCase", cid)).toBeGreaterThan(c0);
    expect(await v("qaFinding", fid)).toBeGreaterThan(f0);
  });
  it("mengubah anak juga menerbitkan laporan (updatedAt-nya berubah; peer mengurutkan menurutnya)", async () => {
    await seed();
    const before = (await feed()).filter((r) => r.entity === "qaReport" && r.recordId === rid).length;
    await call("POST", R(`/${rid}/cases`), { title: "Dua" });
    expect((await feed()).filter((r) => r.entity === "qaReport" && r.recordId === rid).length).toBeGreaterThan(before);
  });
  it("lampiran lahir 'available' di hub (tak ada hub di atasnya yang perlu diunggah)", async () => {
    await seed();
    expect((await prisma.qaAttachment.findUniqueOrThrow({ where: { id: aid } })).syncState).toBe("available");
  });
  it("hapus lampiran → tombstone + delete di feed", async () => {
    await seed();
    await call("DELETE", R(`/${rid}/attachments/${aid}`));
    expect(await findTombstone("qaAttachment", aid)).not.toBeNull();
    expect(await inFeed("qaAttachment", aid, "delete")).toBe(true);
  });
  it("hapus case → tombstone case; temuan yang menunjuknya diterbitkan ulang dengan caseId null", async () => {
    await seed();
    await call("DELETE", R(`/${rid}/cases/${cid}`));
    expect(await inFeed("qaCase", cid, "delete")).toBe(true);
    const last = (await pull("0")).records.filter((r) => r.entity === "qaFinding" && r.recordId === fid).pop()!;
    expect((last.data as { caseId: string | null }).caseId).toBeNull();
  });
  it("hapus temuan → tombstone temuan DAN lampirannya", async () => {
    await seed();
    await call("DELETE", R(`/${rid}/findings/${fid}`));
    expect(await inFeed("qaFinding", fid, "delete")).toBe(true);
    expect(await inFeed("qaAttachment", aid, "delete")).toBe(true);
  });
  it("hapus laporan → tombstone laporan + lampirannya; anak lain merambat lewat cascade (tanpa tombstone sendiri)", async () => {
    await seed();
    await call("DELETE", R(`/${rid}`));
    expect(await inFeed("qaReport", rid, "delete")).toBe(true);
    expect(await inFeed("qaAttachment", aid, "delete")).toBe(true);
    expect(await findTombstone("qaCase", cid)).toBeNull();
  });
  it("impor laporan (ZIP/MD) dan impor matriks menerbitkan baris yang ditulisnya", async () => {
    await seed();
    const zip = (await call("GET", R(`/${rid}/export`))).rawPayload;
    await makeProject({ id: "p2" });       // ke project LAIN → laporan baru (di project yang sama = upsert, id tetap)
    const imp = await upload("/api/projects/p2/qa/import", "file", "x.zip", "application/zip", zip);
    const newRid = imp.json().reportId;
    expect(newRid).not.toBe(rid);
    expect(await inFeed("qaReport", newRid)).toBe(true);
    const nc = await prisma.qaCase.findFirstOrThrow({ where: { reportId: newRid } });
    expect(await inFeed("qaCase", nc.id)).toBe(true);
    const na = await prisma.qaAttachment.findFirstOrThrow({ where: { reportId: newRid } });
    expect(await inFeed("qaAttachment", na.id)).toBe(true);

    await upload(R(`/${rid}/cases/import`), "file", "m.csv", "text/csv", Buffer.from(csvEncode([["Judul", "Status", "Ref"], ["Login", "gagal", cid], ["Baru dari lembar", "", ""]])));
    const created = await prisma.qaCase.findFirstOrThrow({ where: { reportId: rid, title: "Baru dari lembar" } });
    expect(await inFeed("qaCase", created.id)).toBe(true);
    const updated = (await pull("0")).records.filter((r) => r.entity === "qaCase" && r.recordId === cid).pop()!;
    expect((updated.data as { status: string }).status).toBe("fail");
  });
  it("kirim temuan ke backlog menerbitkan temuan (status sent + backlogId) dan spec-nya", async () => {
    await seed();
    const j = (await call("POST", R(`/${rid}/findings/${fid}/backlog`), {})).json();
    const last = (await pull("0")).records.filter((r) => r.entity === "qaFinding" && r.recordId === fid).pop()!;
    expect(last.data).toMatchObject({ status: "sent", backlogId: j.spec.id });
    expect(await inFeed("spec", j.spec.id)).toBe(true);
  });
  it("hapus PROJECT membuang byte lampiran QA dari disk (baris ikut cascade)", async () => {
    await seed();
    const key = (await prisma.qaAttachment.findUniqueOrThrow({ where: { id: aid } })).storageKey;
    expect((await readUpload(key)).length).toBeGreaterThan(0);
    expect((await call("DELETE", "/api/projects/p1")).statusCode).toBe(204);
    await expect(readUpload(key)).rejects.toBeTruthy();
  });
});

describe("mode client: tulisan → outbox, bukan SyncLog", () => {
  it("setiap entitas QA antre di outbox; lampiran lahir 'local-only' (menunggu unggah byte)", async () => {
    await setConfig("SYNC_SERVER_URL", "http://hub.example");
    await seed();
    const ids = (await listOutbox()).map((o) => `${o.entity}:${o.recordId}`);
    for (const k of [`qaReport:${rid}`, `qaCase:${cid}`, `qaFinding:${fid}`, `qaAttachment:${aid}`]) expect(ids).toContain(k);
    expect(await prisma.syncLog.count()).toBe(0);
    expect((await prisma.qaAttachment.findUniqueOrThrow({ where: { id: aid } })).syncState).toBe("local-only");
  });
});
