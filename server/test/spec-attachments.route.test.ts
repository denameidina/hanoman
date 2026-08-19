import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { checkAgentCapability } from "../src/services/agent-capabilities";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const specId = "SPEC-9300";

const clean = async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.project.deleteMany();
};

// Multipart dirakit tangan: `app.inject` tak punya pembangun form-data.
function multipart(files: { name: string; type: string; body: Buffer }[]) {
  const boundary = "----hanomantest843";
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\n`
      + `Content-Type: ${f.type}\r\n\r\n`, "utf8"), f.body, Buffer.from("\r\n", "utf8"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(parts),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const upload = (files: { name: string; type: string; body: Buffer }[]) =>
  app.inject({ method: "POST", url: `/api/specs/${specId}/attachments`, ...multipart(files) });

beforeAll(async () => {
  await app.ready();
  await clean();
  await prisma.project.create({ data: { id: "sar-proj", name: "SAR", desc: "", kind: "existing" } });
});
beforeEach(async () => {
  await prisma.specAttachment.deleteMany();
  await prisma.spec.deleteMany();
  await prisma.spec.create({ data: {
    id: specId, projectId: "sar-proj", title: "T", source: "brief",
    stage: "brainstorming", priority: "sedang", author: "t", objective: "o",
  } });
});
afterAll(async () => { await clean(); await app.close(); });

describe("SPEC-843 · endpoint lampiran backlog", () => {
  it("unggah beberapa berkas dalam satu request", async () => {
    const res = await upload([
      { name: "layar.png", type: "image/png", body: PNG },
      { name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().saved.map((a: { filename: string }) => a.filename)).toEqual(["layar.png", "catatan.md"]);
    expect(res.json().rejected).toEqual([]);
  });

  it("tipe tak didukung ditolak tanpa menggagalkan berkas lain", async () => {
    const res = await upload([
      { name: "jahat.sh", type: "application/x-sh", body: Buffer.from("rm -rf /") },
      { name: "ok.txt", type: "text/plain", body: Buffer.from("halo") },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().saved).toHaveLength(1);
    expect(res.json().rejected).toEqual([{ filename: "jahat.sh", reason: "type" }]);
  });

  it("daftar → unduh → hapus", async () => {
    await upload([{ name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") }]);
    const list = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments` });
    expect(list.statusCode).toBe(200);
    const att = list.json().attachments[0];
    expect(att.filename).toBe("catatan.md");

    const file = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments/${att.id}` });
    expect(file.statusCode).toBe(200);
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(file.headers["content-disposition"]).toContain("catatan.md");
    expect(file.body).toContain("# hai");

    const del = await app.inject({ method: "DELETE", url: `/api/specs/${specId}/attachments/${att.id}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments` })).json().attachments).toEqual([]);
  });

  it("lampiran yang bukan milik spec ini → 404", async () => {
    const res = await app.inject({ method: "GET", url: `/api/specs/${specId}/attachments/tak-ada` });
    expect(res.statusCode).toBe(404);
  });

  it("spec tak dikenal → 404", async () => {
    expect((await app.inject({ method: "GET", url: "/api/specs/SPEC-0/attachments" })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/specs/SPEC-0/attachments/x" })).statusCode).toBe(404);
  });

  it("bukan multipart → 400", async () => {
    const res = await app.inject({
      method: "POST", url: `/api/specs/${specId}/attachments`,
      headers: { "content-type": "application/json" }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("hapus Spec ikut menghapus baris lampiran", async () => {
    await upload([{ name: "catatan.md", type: "text/markdown", body: Buffer.from("# hai\n") }]);
    expect((await app.inject({ method: "DELETE", url: `/api/specs/${specId}` })).statusCode).toBe(204);
    expect(await prisma.specAttachment.count({ where: { specId } })).toBe(0);
  });

  it("capability: baca cukup untuk daftar/unduh, tak cukup untuk unggah/hapus", () => {
    const read = ["backlog:read"];
    expect(checkAgentCapability(read, "GET", `/api/specs/${specId}/attachments`)).toEqual({ ok: true });
    expect(checkAgentCapability(read, "GET", `/api/specs/${specId}/attachments/a1`)).toEqual({ ok: true });
    expect(checkAgentCapability(read, "POST", `/api/specs/${specId}/attachments`))
      .toMatchObject({ ok: false, status: 403, need: "backlog:write" });
    expect(checkAgentCapability(read, "DELETE", `/api/specs/${specId}/attachments/a1`))
      .toMatchObject({ ok: false, status: 403, need: "backlog:write" });
    expect(checkAgentCapability(["backlog:write"], "DELETE", `/api/specs/${specId}/attachments/a1`)).toEqual({ ok: true });
  });
});
