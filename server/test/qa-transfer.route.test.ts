import { beforeEach, describe, expect, it } from "vitest";
import { parseQaMarkdown } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readXlsx, writeXlsx } from "../src/services/xlsx";
import { qaTemplateWorkbook } from "../src/services/qa-workbook";
import { readZip, writeZip } from "../src/services/zip";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function multipart(name: string, type: string, body: Buffer) {
  const boundary = "----hanomanqaimport";
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`, "utf8"),
    body, Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
const importFile = (pid: string, name: string, type: string, body: Buffer) =>
  app.inject({ method: "POST", url: `/api/projects/${pid}/qa/import`, ...multipart(name, type, body) });
const R = (pid: string, tail = "") => `/api/projects/${pid}/qa/reports${tail}`;
const json = (method: "POST" | "PATCH", url: string, payload: unknown) => app.inject({ method, url, payload: payload as object });

// Laporan lengkap: 1 case, 1 temuan ber-caseId, lampiran PNG pada temuan.
async function seed() {
  const r = (await json("POST", R("p1"), { title: "Smoke 0.9", buildVersion: "0.9.12", tester: "Dena" })).json();
  const c = (await json("POST", R("p1", `/${r.id}/cases`), { title: "Bayar", status: "fail", steps: "1. klik" })).json().cases[0];
  const f = (await json("POST", R("p1", `/${r.id}/findings`), { title: "Tombol mati", caseId: c.id, steps: ["buka", "klik"], expected: "ok", actual: "diam" })).json().findings[0];
  const b = "----seed";
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="layar.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  await app.inject({ method: "POST", url: R("p1", `/${r.id}/attachments?ownerType=finding&ownerId=${f.id}`), payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
  return r.id as string;
}

beforeEach(async () => { await resetDb(); await makeProject({ id: "p1" }); await makeProject({ id: "p2" }); });

describe("GET /qa/template.md", () => {
  it("mengirim template sebagai unduhan dan dapat diurai", async () => {
    const res = await app.inject({ method: "GET", url: "/api/qa/template.md" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/text\/markdown/);
    expect(String(res.headers["content-disposition"])).toMatch(/attachment; filename="qa-template\.md"/);
    expect(parseQaMarkdown(res.body).findings).toHaveLength(1);
  });
});

describe("ekspor", () => {
  it("ZIP berisi report.md + attachments/ dengan tautan relatif yang cocok", async () => {
    const rid = await seed();
    const res = await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(String(res.headers["content-disposition"])).toMatch(/QA-001\.zip/);
    const files = readZip(res.rawPayload);
    expect([...files.keys()].sort()).toEqual(["attachments/F-01-1-layar.png", "report.md", "report.xlsx"]);
    const md = files.get("report.md")!.toString("utf8");
    expect(md).toContain("### F-01 · [major/P2] Tombol mati");
    expect(md).toContain("![layar.png](attachments/F-01-1-layar.png)");
  });
  it("?format=md hanya Markdown; 404 laporan project lain", async () => {
    const rid = await seed();
    const md = await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=md`) });
    expect(String(md.headers["content-type"])).toMatch(/text\/markdown/);
    expect(md.body).toContain("hanoman-qa: 1");
    expect((await app.inject({ method: "GET", url: R("p2", `/${rid}/export`) })).statusCode).toBe(404);
  });
});

describe("impor", () => {
  it("round-trip ZIP ke project lain → laporan BARU lengkap dengan lampiran dan tautan caseId", async () => {
    const rid = await seed();
    const zip = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) })).rawPayload;
    const res = await importFile("p2", "QA-001.zip", "application/zip", zip);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: true, cases: 1, findings: 1 });
    expect(res.json().attachments.saved).toBe(1);
    const d = (await app.inject({ method: "GET", url: R("p2", `/${res.json().reportId}`) })).json();
    expect(d).toMatchObject({ code: "QA-001", title: "Smoke 0.9", buildVersion: "0.9.12", tester: "Dena" });
    expect(d.id).not.toBe(rid);
    expect(d.cases[0]).toMatchObject({ title: "Bayar", status: "fail" });
    expect(d.findings[0]).toMatchObject({ title: "Tombol mati", caseCode: "TC-01", steps: ["buka", "klik"], expected: "ok", actual: "diam" });
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0]).toMatchObject({ ownerType: "finding", ownerId: d.findings[0].id, filename: "layar.png" });
  });

  it("impor ulang ke project yang sama = UPSERT: tak menggandakan case/temuan/lampiran", async () => {
    const rid = await seed();
    const zip = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export`) })).rawPayload;
    const res = await importFile("p1", "QA-001.zip", "application/zip", zip);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: false, reportId: rid });
    const d = (await app.inject({ method: "GET", url: R("p1", `/${rid}`) })).json();
    expect([d.cases.length, d.findings.length, d.attachments.length]).toEqual([1, 1, 1]);
  });

  it("template tanpa ZIP → laporan baru (1 case, 1 temuan) dengan lampiran 0", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).rawPayload;
    const res = await importFile("p1", "qa-template.md", "text/markdown", tpl);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ created: true, cases: 1, findings: 1 });
  });

  it("400 berbaris untuk Markdown salah; 400 ZIP tanpa report.md; 400 ZIP berisi path traversal", async () => {
    const bad = await importFile("p1", "x.md", "text/markdown", Buffer.from("# tanpa front-matter\n"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/baris 1/);
    expect((await importFile("p1", "x.zip", "application/zip", writeZip([{ name: "a.txt", data: Buffer.from("x") }]))).statusCode).toBe(400);
    expect((await importFile("p1", "x.zip", "application/zip", writeZip([{ name: "../report.md", data: Buffer.from("x") }]))).statusCode).toBe(400);
  });

  it("400 submitted tanpa verdict; 409 bila laporan target closed; 404 project tak ada", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).body;
    const noVerdict = tpl.replace("status: draft", "status: submitted");
    expect((await importFile("p1", "x.md", "text/markdown", Buffer.from(noVerdict))).statusCode).toBe(400);

    const rid = await seed();
    const md = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=md`) })).body;
    await json("PATCH", R("p1", `/${rid}`), { status: "closed", verdict: "go" });
    expect((await importFile("p1", "x.md", "text/markdown", Buffer.from(md))).statusCode).toBe(409);
    expect((await importFile("hantu", "x.md", "text/markdown", Buffer.from(tpl))).statusCode).toBe(404);
  });

  it("bagian 3: impor menulis changefeed (dulu LOCAL-only di bagian 1)", async () => {
    const tpl = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).rawPayload;
    await importFile("p1", "t.md", "text/markdown", tpl);
    expect(await prisma.syncLog.count({ where: { entity: { startsWith: "qa" } } })).toBeGreaterThan(0);
  });
});

describe("laporan Excel lengkap", () => {
  it("Excel invalid ditolak sebelum membuat laporan dan ZIP Markdown lama tetap didukung", async () => {
    const sheets = ["Ringkasan", "Test case", "Temuan", "Lampiran"].map((name) => ({ name, rows: readXlsx(qaTemplateWorkbook(), { sheet: name }) }));
    sheets[2]!.rows[1]![2] = "unknown";
    const bad = await importFile("p1", "bad.xlsx", "application/octet-stream", writeXlsx(sheets));
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toMatch(/Temuan, baris 2/);
    expect(await prisma.qaReport.count()).toBe(0);
    const md = (await app.inject({ method: "GET", url: "/api/qa/template.md" })).rawPayload;
    const legacy = await importFile("p1", "old.zip", "application/zip", writeZip([{ name: "report.md", data: md }]));
    expect(legacy.statusCode).toBe(201); expect(legacy.json()).toMatchObject({ cases: 1, findings: 1 });
  });
  it("template XLSX dapat diimpor dan memiliki panduan pengisian", async () => {
    const tpl = await app.inject({ method: "GET", url: "/api/qa/template.xlsx" });
    expect(tpl.statusCode).toBe(200);
    expect(tpl.headers["content-disposition"]).toContain("qa-template.xlsx");
    const res = await importFile("p1", "qa-template.xlsx", "application/octet-stream", tpl.rawPayload);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ cases: 1, findings: 1, attachments: { saved: 0 } });
  });

  it("Excel langsung mengimpor ringkasan, case, temuan dan tautannya; Ref melakukan upsert", async () => {
    const rid = await seed();
    const excel = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=xlsx`) })).rawPayload;
    const res = await importFile("p2", "report.xlsx", "application/octet-stream", excel);
    expect(res.statusCode).toBe(201);
    const d = (await app.inject({ method: "GET", url: R("p2", `/${res.json().reportId}`) })).json();
    expect(d).toMatchObject({ title: "Smoke 0.9", tester: "Dena" });
    expect(d.findings[0].caseId).toBe(d.cases[0].id);
    expect(res.json().attachments.rejected).toEqual([{ filename: "layar.png", reason: "missing" }]);
    const again = await importFile("p1", "report.xlsx", "application/octet-stream", excel);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ reportId: rid, created: false });
    expect(await prisma.qaCase.count({ where: { reportId: rid } })).toBe(1);
  });

  it("Excel + berkas pendamping menyimpan lampiran pada pemilik yang benar", async () => {
    const rid = await seed();
    const excel = (await app.inject({ method: "GET", url: R("p1", `/${rid}/export?format=xlsx`) })).rawPayload;
    const b = "----qaexcel";
    const payload = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="report.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`), excel,
      Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="attachments"; filename="layar.png"\r\nContent-Type: image/png\r\n\r\n`), PNG,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const res = await app.inject({ method: "POST", url: "/api/projects/p2/qa/import", payload, headers: { "content-type": `multipart/form-data; boundary=${b}` } });
    expect(res.statusCode).toBe(201);
    expect(res.json().attachments).toEqual({ saved: 1, rejected: [] });
    const d = (await app.inject({ method: "GET", url: R("p2", `/${res.json().reportId}`) })).json();
    expect(d.attachments[0].ownerId).toBe(d.findings[0].id);
  });
});
