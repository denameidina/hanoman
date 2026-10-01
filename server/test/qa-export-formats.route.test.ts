import { beforeEach, describe, expect, it } from "vitest";
import { CASE_COLUMNS, casesToRows, csvDecode, csvEncode } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readXlsx, writeXlsx } from "../src/services/xlsx";
import { readZip } from "../src/services/zip";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const tick = () => new Promise((r) => setTimeout(r, 5));
const R = (tail = "") => `/api/projects/p1/qa/reports${tail}`;
const call = (method: "POST" | "PATCH" | "GET", url: string, payload?: unknown) =>
  app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
const mp = (field: string, name: string, type: string, body: Buffer) => {
  const b = "----qaformats";
  return { payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${b}` } };
};
const importCases = (rid: string, name: string, type: string, body: Buffer, pid = "p1") =>
  app.inject({ method: "POST", url: `/api/projects/${pid}/qa/reports/${rid}/cases/import`, ...mp("file", name, type, body) });
const detailOf = async (rid: string) => (await call("GET", R(`/${rid}`))).json();

let rid = ""; let c1 = ""; let c2 = "";
beforeEach(async () => {
  await resetDb(); await makeProject({ id: "p1" }); await makeProject({ id: "p2" });
  rid = (await call("POST", R(), { title: "Smoke 0.9", buildVersion: "0.9.12", tester: "Dena", summary: "Ringkas.", environment: { os: "macOS" } })).json().id;
  c1 = (await call("POST", R(`/${rid}/cases`), { title: "Login", steps: "1. buka", expected: "masuk", actual: "masuk", status: "pass" })).json().cases[0].id;
  await tick();
  c2 = (await call("POST", R(`/${rid}/cases`), { title: "Bayar", steps: "1. klik", expected: "form", actual: "diam", status: "fail" })).json().cases[1].id;
  const f = (await call("POST", R(`/${rid}/findings`), { title: "Tombol mati", caseId: c2, steps: ["buka", "klik"], expected: "ok", actual: "diam", severity: "major", priority: "P1" })).json().findings[0];
  const b = "----qaseed";
  await app.inject({ method: "POST", url: R(`/${rid}/attachments?ownerType=finding&ownerId=${f.id}`), payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="layar.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${b}` } });
});

describe("GET export?format=…", () => {
  it("docx: tipe & nama berkas benar; document.xml memuat temuan; gambar tertanam sebagai media", async () => {
    const res = await call("GET", R(`/${rid}/export?format=docx`));
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(String(res.headers["content-disposition"])).toMatch(/QA-001\.docx/);
    const files = readZip(res.rawPayload);
    expect(files.get("word/document.xml")!.toString("utf8")).toContain("F-01 · [major/P1] Tombol mati");
    expect([...files.keys()]).toContain("word/media/image1.png");
  });
  it("pdf: application/pdf, %PDF", async () => {
    const res = await call("GET", R(`/${rid}/export?format=pdf`));
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(String(res.headers["content-disposition"])).toMatch(/QA-001\.pdf/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("xlsx: tiga sheet; Test case = matriks dengan Ref (id); Temuan memuat kolom backlog & lampiran", async () => {
    const res = await call("GET", R(`/${rid}/export?format=xlsx`));
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const rows = readXlsx(res.rawPayload, { sheet: "Test case" });
    expect(rows[0]).toEqual([...CASE_COLUMNS]);
    expect(rows[1]).toEqual(["TC-01", "Login", "1. buka", "masuk", "masuk", "pass", c1]);
    expect(rows[2]![6]).toBe(c2);
    const findings = readXlsx(res.rawPayload, { sheet: "Temuan" });
    expect(findings[0]).toContain("Backlog");
    expect(findings[1]![0]).toBe("F-01");
    expect(findings[1]).toContain("layar.png");
    expect(readXlsx(res.rawPayload)[1]).toEqual(["Kode", "QA-001"]);       // sheet pertama = Ringkasan
  });
  it("csv: UTF-8 BOM + matriks yang sama dengan xlsx", async () => {
    const res = await call("GET", R(`/${rid}/export?format=csv`));
    expect(String(res.headers["content-type"])).toMatch(/text\/csv/);
    expect(String(res.headers["content-disposition"])).toMatch(/QA-001-testcase\.csv/);
    expect(res.body.startsWith("﻿")).toBe(true);
    expect(csvDecode(res.body)[1]).toEqual(["TC-01", "Login", "1. buka", "masuk", "masuk", "pass", c1]);
  });
  it("format tak dikenal → 400; laporan project lain → 404; zip/md tetap jalan", async () => {
    expect((await call("GET", R(`/${rid}/export?format=odt`))).statusCode).toBe(400);
    expect((await call("GET", `/api/projects/p2/qa/reports/${rid}/export?format=docx`)).statusCode).toBe(404);
    expect((await call("GET", R(`/${rid}/export`))).headers["content-type"]).toBe("application/zip");
    expect(String((await call("GET", R(`/${rid}/export?format=md`))).headers["content-type"])).toMatch(/markdown/);
  });
});

describe("POST /cases/import (matriks)", () => {
  it("round-trip XLSX: baris ber-Ref diperbarui (status, aktual); sisanya tak berubah", async () => {
    const out = readXlsx((await call("GET", R(`/${rid}/export?format=xlsx`))).rawPayload, { sheet: "Test case" });
    out[2]![5] = "pass"; out[2]![4] = "form bayar tampil";
    const res = await importCases(rid, "matriks.xlsx", "application/octet-stream", writeXlsx([{ name: "Test case", rows: out }]));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1, created: 0, unchanged: 1 });
    const d = await detailOf(rid);
    expect(d.cases[1]).toMatchObject({ id: c2, status: "pass", actual: "form bayar tampil", title: "Bayar", steps: "1. klik" });
    expect(d.cases[0]).toMatchObject({ id: c1, status: "pass", title: "Login" });
  });
  it("mengimpor ekspor yang sama tanpa ubahan → semua unchanged", async () => {
    const x = (await call("GET", R(`/${rid}/export?format=xlsx`))).rawPayload;
    expect((await importCases(rid, "m.xlsx", "application/octet-stream", x)).json()).toEqual({ updated: 0, created: 0, unchanged: 2 });
  });
  it("CSV titik-koma (Excel locale Indonesia) + status Indonesia + baris baru tanpa Ref → dibuat berurut", async () => {
    const csv = `Judul;Status;Aktual;Ref\nLogin;lulus;ok banget;${c1}\nCek profil;gagal;error 500;\nCek logout;;;\n`;
    const res = await importCases(rid, "m.csv", "text/csv", Buffer.from(csv));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 1, created: 2, unchanged: 0 });
    const d = await detailOf(rid);
    expect(d.cases.map((c: { code: string; title: string; status: string }) => [c.code, c.title, c.status])).toEqual([
      ["TC-01", "Login", "pass"], ["TC-02", "Bayar", "fail"], ["TC-03", "Cek profil", "fail"], ["TC-04", "Cek logout", "todo"],
    ]);
    expect(d.cases[0]).toMatchObject({ actual: "ok banget", steps: "1. buka", expected: "masuk" });   // kolom absen → tak tersentuh
  });
  it("sel kosong pada kolom yang ADA mengosongkan nilai (round-trip jujur)", async () => {
    const csv = csvEncode([["Judul", "Aktual", "Ref"], ["Login", "", c1]]);
    await importCases(rid, "m.csv", "text/csv", Buffer.from(csv));
    expect((await detailOf(rid)).cases[0].actual).toBe("");
  });
  it("galat berbaris: status tak dikenal, baris baru tanpa judul, Ref asing tanpa judul → 400 dan TIDAK ada yang tertulis", async () => {
    const bad1 = await importCases(rid, "m.csv", "text/csv", Buffer.from(csvEncode([["Judul", "Status", "Ref"], ["Login", "gagal", c1], ["Baru", "mungkin", ""]])));
    expect(bad1.statusCode).toBe(400);
    expect(bad1.json().error).toMatch(/baris 3.*status/i);
    expect((await detailOf(rid)).cases[0].status).toBe("pass");                                 // transaksi: baris 2 tak ikut tertulis
    expect((await importCases(rid, "m.csv", "text/csv", Buffer.from(csvEncode([["Judul", "Aktual"], ["", "isi saja"]])))).json().error).toMatch(/baris 2.*judul/i);
    expect((await importCases(rid, "m.csv", "text/csv", Buffer.from(csvEncode([["Judul", "Ref"], ["", "id-asing"]])))).statusCode).toBe(400);
  });
  it("berkas rusak/bukan tabel → 400; project/laporan tak ada → 404; laporan closed → 409; bukan multipart → 400", async () => {
    expect((await importCases(rid, "x.xlsx", "application/octet-stream", Buffer.from("bukan xlsx"))).statusCode).toBe(400);
    expect((await importCases(rid, "x.csv", "text/csv", Buffer.from("tanpa,header,yang,dikenal\n1,2,3,4"))).statusCode).toBe(400);
    expect((await importCases("hantu", "x.csv", "text/csv", Buffer.from("Judul\nx"))).statusCode).toBe(404);
    expect((await importCases(rid, "x.csv", "text/csv", Buffer.from("Judul\nx"), "p2")).statusCode).toBe(404);
    await call("PATCH", R(`/${rid}`), { status: "closed", verdict: "go" });
    expect((await importCases(rid, "x.csv", "text/csv", Buffer.from("Judul\nx"))).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: R(`/${rid}/cases/import`), payload: { a: 1 } })).statusCode).toBe(400);
  });
  it("LOCAL-only (bagian 4): impor matriks tak menulis changefeed", async () => {
    await importCases(rid, "m.csv", "text/csv", Buffer.from("Judul\nbaru"));
    expect(await prisma.syncLog.count({ where: { entity: { startsWith: "qa" } } })).toBe(0);
  });
});
