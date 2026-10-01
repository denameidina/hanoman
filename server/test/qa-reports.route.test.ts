import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const tick = () => new Promise((r) => setTimeout(r, 5)); // createdAt beda ≥ 1 ms → nomor tampil deterministik

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeProject({ id: "p2" });
});

const url = (p: string, tail = "") => `/api/projects/${p}/qa/reports${tail}`;
const post = (u: string, payload: unknown) => app.inject({ method: "POST", url: u, payload: payload as object });
const patch = (u: string, payload: unknown) => app.inject({ method: "PATCH", url: u, payload: payload as object });
const mk = async (title = "Smoke", p = "p1") => (await post(url(p), { title })).json();

describe("laporan", () => {
  it("membuat, mendaftar, dan membaca dengan nomor tampil + statistik", async () => {
    const res = await post(url("p1"), { title: "Smoke 0.9.12", buildVersion: "0.9.12", environment: { os: "macOS" }, tester: "Dena" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      code: "QA-001", title: "Smoke 0.9.12", status: "draft", verdict: null,
      environment: { os: "macOS" }, cases: [], findings: [], attachments: [],
    });
    const list = (await app.inject({ method: "GET", url: url("p1") })).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ code: "QA-001", stats: { cases: { total: 0 }, passRate: null } });
    expect((await app.inject({ method: "GET", url: url("p1", `/${res.json().id}`) })).statusCode).toBe(200);
  });

  it("nomor QA berurut per project dan mulai lagi dari 001 di project lain", async () => {
    const a = await mk("A"); await tick(); const b = await mk("B"); const c = await mk("C", "p2");
    expect([a.code, b.code, c.code]).toEqual(["QA-001", "QA-002", "QA-001"]);
  });

  it("400 title kosong; 404 project tak ada; 404 laporan milik project lain", async () => {
    expect((await post(url("p1"), { title: " " })).statusCode).toBe(400);
    expect((await post(url("hantu"), { title: "x" })).statusCode).toBe(404);
    const r = await mk();
    expect((await app.inject({ method: "GET", url: url("p2", `/${r.id}`) })).statusCode).toBe(404);
    expect((await patch(url("p2", `/${r.id}`), { title: "z" })).statusCode).toBe(404);
  });

  it("submit/close mensyaratkan verdict (400), lalu lolos setelah diisi", async () => {
    const r = await mk();
    const bad = await patch(url("p1", `/${r.id}`), { status: "submitted" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/verdict/);
    const ok = await patch(url("p1", `/${r.id}`), { status: "submitted", verdict: "no-go" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: "submitted", verdict: "no-go" });
  });

  it("PATCH hanya menulis field yang dikirim", async () => {
    const r = (await post(url("p1"), { title: "T", scope: "checkout", tester: "Dena" })).json();
    const res = await patch(url("p1", `/${r.id}`), { summary: "ok" });
    expect(res.json()).toMatchObject({ title: "T", scope: "checkout", tester: "Dena", summary: "ok" });
  });

  it("laporan closed read-only (409) kecuali dibuka kembali lewat PATCH {status}", async () => {
    const r = await mk();
    await patch(url("p1", `/${r.id}`), { status: "closed", verdict: "go" });
    expect((await patch(url("p1", `/${r.id}`), { title: "baru" })).statusCode).toBe(409);
    expect((await post(url("p1", `/${r.id}/cases`), { title: "c" })).statusCode).toBe(409);
    expect((await post(url("p1", `/${r.id}/findings`), { title: "f" })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: url("p1", `/${r.id}`) })).statusCode).toBe(409);
    const reopen = await patch(url("p1", `/${r.id}`), { status: "draft" });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe("draft");
    expect((await post(url("p1", `/${r.id}/cases`), { title: "c" })).statusCode).toBe(201);
  });

  it("DELETE menghapus laporan beserta anak-anaknya", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "c" });
    expect((await app.inject({ method: "DELETE", url: url("p1", `/${r.id}`) })).json()).toEqual({ ok: true });
    expect(await prisma.qaReport.count()).toBe(0);
    expect(await prisma.qaCase.count()).toBe(0);
  });

  it("bagian 3: tulisan QA MASUK changefeed (dulu LOCAL-only di bagian 1; rincian di qa-sync-wiring)", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "c" });
    await post(url("p1", `/${r.id}/findings`), { title: "f" });
    expect(await prisma.syncLog.count({ where: { entity: { startsWith: "qa" } } })).toBeGreaterThan(0);
  });
});

describe("test case", () => {
  it("order otomatis menaik; status bisa diubah; statistik ikut", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/cases`), { title: "Login" });
    const d = (await post(url("p1", `/${r.id}/cases`), { title: "Checkout" })).json();
    expect(d.cases.map((c: { code: string; title: string }) => [c.code, c.title])).toEqual([["TC-01", "Login"], ["TC-02", "Checkout"]]);
    const caseId = d.cases[0].id;
    const upd = await patch(url("p1", `/${r.id}/cases/${caseId}`), { status: "pass" });
    expect(upd.json().cases[0]).toMatchObject({ status: "pass" });
    expect(upd.json().stats).toMatchObject({ passRate: 1, cases: { total: 2, pass: 1, todo: 1 } });
  });

  it("menghapus case melepas caseId temuan (bukan menghapus temuannya)", async () => {
    const r = await mk();
    const c = (await post(url("p1", `/${r.id}/cases`), { title: "Login" })).json().cases[0];
    await post(url("p1", `/${r.id}/findings`), { title: "Bug", caseId: c.id });
    const del = await app.inject({ method: "DELETE", url: url("p1", `/${r.id}/cases/${c.id}`) });
    expect(del.statusCode).toBe(200);
    expect(del.json().cases).toEqual([]);
    expect(del.json().findings[0]).toMatchObject({ title: "Bug", caseId: null, caseCode: null });
  });

  it("404 case dari laporan lain", async () => {
    const a = await mk("A"); const b = await mk("B");
    const c = (await post(url("p1", `/${a.id}/cases`), { title: "x" })).json().cases[0];
    expect((await patch(url("p1", `/${b.id}/cases/${c.id}`), { status: "pass" })).statusCode).toBe(404);
  });
});

describe("temuan", () => {
  it("default severity major / P2 / open; steps tersimpan; kode F-01, F-02 menurut createdAt", async () => {
    const r = await mk();
    await post(url("p1", `/${r.id}/findings`), { title: "Pertama", steps: ["buka", "klik"] });
    await tick();
    const d = (await post(url("p1", `/${r.id}/findings`), { title: "Kedua", severity: "blocker", priority: "P0" })).json();
    expect(d.findings.map((f: { code: string }) => f.code)).toEqual(["F-01", "F-02"]);
    expect(d.findings[0]).toMatchObject({ severity: "major", priority: "P2", status: "open", steps: ["buka", "klik"], backlogId: null });
    expect(d.findings[1]).toMatchObject({ severity: "blocker", priority: "P0" });
    expect(d.stats.findings).toMatchObject({ total: 2, blocker: 1, major: 1, open: 2 });
  });

  it("400 caseId dari laporan lain; 400 status `sent`; 400 severity liar", async () => {
    const a = await mk("A"); const b = await mk("B");
    const c = (await post(url("p1", `/${a.id}/cases`), { title: "x" })).json().cases[0];
    const res = await post(url("p1", `/${b.id}/findings`), { title: "f", caseId: c.id });
    expect(res.statusCode).toBe(400);
    expect(res.json().caseId).toBe(c.id);
    expect((await post(url("p1", `/${b.id}/findings`), { title: "f", status: "sent" })).statusCode).toBe(400);
    expect((await post(url("p1", `/${b.id}/findings`), { title: "f", severity: "gawat" })).statusCode).toBe(400);
  });

  it("PATCH mengubah severity/status dan mengosongkan caseId; DELETE menghapus", async () => {
    const r = await mk();
    const c = (await post(url("p1", `/${r.id}/cases`), { title: "Login" })).json().cases[0];
    const f = (await post(url("p1", `/${r.id}/findings`), { title: "Bug", caseId: c.id })).json().findings[0];
    expect(f.caseCode).toBe("TC-01");
    const upd = await patch(url("p1", `/${r.id}/findings/${f.id}`), { severity: "minor", status: "wontfix", caseId: null });
    expect(upd.json().findings[0]).toMatchObject({ severity: "minor", status: "wontfix", caseId: null });
    const del = await app.inject({ method: "DELETE", url: url("p1", `/${r.id}/findings/${f.id}`) });
    expect(del.json().findings).toEqual([]);
  });
});
