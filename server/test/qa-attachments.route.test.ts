import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readUpload } from "../src/services/uploads";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
// Multipart dirakit tangan: `app.inject` tak punya pembangun form-data (pola spec-attachments.route.test).
function multipart(files: { name: string; type: string; body: Buffer }[]) {
  const boundary = "----hanomanqatest";
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`, "utf8"), f.body, Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

let rid = ""; let fid = "";
const base = () => `/api/projects/p1/qa/reports/${rid}/attachments`;
const upload = (files: { name: string; type: string; body: Buffer }[], owner = `ownerType=report&ownerId=${rid}`) =>
  app.inject({ method: "POST", url: `${base()}?${owner}`, ...multipart(files) });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  rid = (await app.inject({ method: "POST", url: "/api/projects/p1/qa/reports", payload: { title: "Smoke" } })).json().id;
  const d = (await app.inject({ method: "POST", url: `/api/projects/p1/qa/reports/${rid}/findings`, payload: { title: "Bug" } })).json();
  fid = d.findings[0].id;
});

describe("lampiran QA", () => {
  it("unggah ke laporan dan ke temuan; muncul di detail dengan sha256 + syncState local-only", async () => {
    const a = await upload([{ name: "layar.png", type: "image/png", body: PNG }]);
    expect(a.statusCode).toBe(201);
    expect(a.json().saved[0]).toMatchObject({ filename: "layar.png", ownerType: "report", ownerId: rid, syncState: "local-only" });
    expect(a.json().saved[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const b = await upload([{ name: "log.txt", type: "text/plain", body: Buffer.from("boom\n") }], `ownerType=finding&ownerId=${fid}`);
    expect(b.json().saved[0]).toMatchObject({ ownerType: "finding", ownerId: fid });
    const detail = (await app.inject({ method: "GET", url: `/api/projects/p1/qa/reports/${rid}` })).json();
    expect(detail.attachments).toHaveLength(2);
  });

  it("400 owner tak valid (ownerType liar / ownerId bukan milik laporan ini)", async () => {
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=banana&ownerId=x")).statusCode).toBe(400);
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=finding&ownerId=hantu")).statusCode).toBe(400);
    expect((await upload([{ name: "a.png", type: "image/png", body: PNG }], "ownerType=report&ownerId=lain")).statusCode).toBe(400);
  });

  it("tipe tak didukung ditolak tanpa menggagalkan berkas lain", async () => {
    const res = await upload([
      { name: "jahat.sh", type: "application/x-sh", body: Buffer.from("rm -rf /") },
      { name: "ok.md", type: "text/markdown", body: Buffer.from("# hai\n") },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().saved).toHaveLength(1);
    expect(res.json().rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("gambar disajikan inline + nosniff; berkas lain & ?download=1 sebagai attachment", async () => {
    const png = (await upload([{ name: "layar.png", type: "image/png", body: PNG }])).json().saved[0];
    const txt = (await upload([{ name: "log.txt", type: "text/plain", body: Buffer.from("x") }])).json().saved[0];
    const img = await app.inject({ method: "GET", url: `${base()}/${png.id}` });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(String(img.headers["content-disposition"])).toMatch(/^inline/);
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(String((await app.inject({ method: "GET", url: `${base()}/${png.id}?download=1` })).headers["content-disposition"])).toMatch(/^attachment/);
    expect(String((await app.inject({ method: "GET", url: `${base()}/${txt.id}` })).headers["content-disposition"])).toMatch(/^attachment/);
  });

  it("DELETE menghapus baris DAN byte di disk; 404 lampiran laporan lain", async () => {
    const a = (await upload([{ name: "layar.png", type: "image/png", body: PNG }])).json().saved[0];
    const row = await prisma.qaAttachment.findUniqueOrThrow({ where: { id: a.id } });
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).json()).toEqual({ ok: true });
    expect(await prisma.qaAttachment.count()).toBe(0);
    await expect(readUpload(row.storageKey)).rejects.toBeTruthy();
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).statusCode).toBe(404);
  });

  it("menghapus temuan / laporan ikut membuang lampirannya (baris + byte)", async () => {
    const a = (await upload([{ name: "l.png", type: "image/png", body: PNG }], `ownerType=finding&ownerId=${fid}`)).json().saved[0];
    const key = (await prisma.qaAttachment.findUniqueOrThrow({ where: { id: a.id } })).storageKey;
    await app.inject({ method: "DELETE", url: `/api/projects/p1/qa/reports/${rid}/findings/${fid}` });
    expect(await prisma.qaAttachment.count()).toBe(0);
    await expect(readUpload(key)).rejects.toBeTruthy();

    const b = (await upload([{ name: "l2.png", type: "image/png", body: PNG }])).json().saved[0];
    const key2 = (await prisma.qaAttachment.findUniqueOrThrow({ where: { id: b.id } })).storageKey;
    await app.inject({ method: "DELETE", url: `/api/projects/p1/qa/reports/${rid}` });
    await expect(readUpload(key2)).rejects.toBeTruthy();
  });

  it("laporan closed menolak unggah dan hapus lampiran (409)", async () => {
    const a = (await upload([{ name: "l.png", type: "image/png", body: PNG }])).json().saved[0];
    await app.inject({ method: "PATCH", url: `/api/projects/p1/qa/reports/${rid}`, payload: { status: "closed", verdict: "go" } });
    expect((await upload([{ name: "l2.png", type: "image/png", body: PNG }])).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `${base()}/${a.id}` })).statusCode).toBe(409);
  });

  it("400 bukan multipart; 400 tanpa berkas", async () => {
    expect((await app.inject({ method: "POST", url: `${base()}?ownerType=report&ownerId=${rid}`, payload: { a: 1 } })).statusCode).toBe(400);
  });
});
