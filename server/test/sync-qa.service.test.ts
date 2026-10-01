import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { BOOTSTRAP_ORDER, PARENTS, SYNCED, __DATE_FIELDS, __FIELDS, __JSON_FIELDS, applyPush, snapshot, upsertLocal, validateSyncData } from "../src/services/sync";
import { IMAGE_TYPES } from "../src/services/spec-attachment";
import { DOCUMENT_TYPES } from "../src/services/upload-pipeline";
import { QA_SYNC_MIMES } from "../src/services/sync";
import { makeProject, resetDb } from "./factory";

const at = "2026-10-01T10:00:00.000Z";
const KEY = "0b7f3b1e-52a1-4b6e-8d0c-3a1f6d2c9e11.png";
const report = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "Smoke", buildVersion: "0.9", environment: { os: "macOS" }, scope: "", tester: "Dena",
  summary: "", status: "draft", verdict: null, createdAt: at, updatedAt: at, ...over,
});
const qcase = (over: Record<string, unknown> = {}) => ({
  reportId: "r1", title: "Login", steps: "", expected: "", actual: "", status: "todo", order: 1.5, createdAt: at, updatedAt: at, ...over,
});
const finding = (over: Record<string, unknown> = {}) => ({
  reportId: "r1", caseId: null, title: "Bug", severity: "major", priority: "P1", area: "", steps: ["a", "b"],
  expected: "", actual: "", status: "open", backlogId: null, createdAt: at, updatedAt: at, ...over,
});
const attachment = (over: Record<string, unknown> = {}) => ({
  reportId: "r1", projectId: "p1", ownerType: "finding", ownerId: "f1", filename: "layar.png", mimeType: "image/png",
  size: 1234, sha256: "a".repeat(64), storageKey: KEY, createdAt: at, updatedAt: at, ...over,
});

beforeEach(async () => { await resetDb(); await prisma.syncLog.deleteMany(); await prisma.syncTombstone.deleteMany(); await makeProject({ id: "p1" }); });

describe("registrasi entitas QA di mesin sync", () => {
  it("SYNCED memuat keempat entitas; induk lebih dulu dari anak di BOOTSTRAP_ORDER (setelah project)", () => {
    for (const e of ["qaReport", "qaCase", "qaFinding", "qaAttachment"]) expect(SYNCED as readonly string[]).toContain(e);
    const i = (e: string) => BOOTSTRAP_ORDER.indexOf(e as never);
    expect(i("project")).toBeLessThan(i("qaReport"));
    expect(i("qaReport")).toBeLessThan(i("qaCase"));
    expect(i("qaReport")).toBeLessThan(i("qaFinding"));
    expect(i("qaReport")).toBeLessThan(i("qaAttachment"));
  });
  it("PARENTS: case/finding/attachment → report (cascade), report → project (cascade)", () => {
    expect(PARENTS.qaReport).toEqual([{ field: "projectId", entity: "project", onDelete: "cascade" }]);
    for (const e of ["qaCase", "qaFinding", "qaAttachment"] as const)
      expect(PARENTS[e]).toEqual([{ field: "reportId", entity: "qaReport", onDelete: "cascade" }]);
  });
  it("kontrak field: kolom bermakna ikut; version/syncState (stempel & state LOKAL) tak pernah menyeberang", () => {
    expect(__FIELDS.qaReport).toEqual(expect.arrayContaining(["projectId", "title", "buildVersion", "environment", "scope", "tester", "summary", "status", "verdict", "createdAt", "updatedAt"]));
    expect(__FIELDS.qaCase).toEqual(expect.arrayContaining(["reportId", "title", "steps", "expected", "actual", "status", "order", "createdAt", "updatedAt"]));
    expect(__FIELDS.qaFinding).toEqual(expect.arrayContaining(["reportId", "caseId", "title", "severity", "priority", "area", "steps", "expected", "actual", "status", "backlogId", "createdAt", "updatedAt"]));
    expect(__FIELDS.qaAttachment).toEqual(expect.arrayContaining(["reportId", "projectId", "ownerType", "ownerId", "filename", "mimeType", "size", "sha256", "storageKey", "createdAt", "updatedAt"]));
    for (const e of ["qaReport", "qaCase", "qaFinding", "qaAttachment"] as const) {
      expect(__FIELDS[e]).not.toContain("version");
      expect(__FIELDS[e]).not.toContain("syncState");
    }
    expect(__DATE_FIELDS.qaAttachment).toEqual(["createdAt", "updatedAt"]);
    expect([...__JSON_FIELDS]).toEqual(expect.arrayContaining(["qaReport:environment", "qaFinding:steps"]));
  });
});

describe("push/pull entitas QA", () => {
  it("push berurutan induk→anak: semua diterima version 1; snapshot mencerminkan data (JSON, Float, tanggal)", async () => {
    expect(await applyPush("qaReport", "r1", 0, report())).toMatchObject({ ok: true, version: 1 });
    expect(await applyPush("qaCase", "c1", 0, qcase())).toMatchObject({ ok: true, version: 1 });
    expect(await applyPush("qaFinding", "f1", 0, finding({ caseId: "c1" }))).toMatchObject({ ok: true, version: 1 });
    expect(await applyPush("qaAttachment", "a1", 0, attachment())).toMatchObject({ ok: true, version: 1 });
    expect((await snapshot("qaReport", "r1"))!.data).toMatchObject({ environment: { os: "macOS" }, verdict: null, createdAt: at });
    expect((await snapshot("qaCase", "c1"))!.data).toMatchObject({ order: 1.5 });
    expect((await snapshot("qaFinding", "f1"))!.data).toMatchObject({ steps: ["a", "b"], caseId: "c1" });
    expect((await snapshot("qaAttachment", "a1"))!.data).toMatchObject({ size: 1234, storageKey: KEY, sha256: "a".repeat(64) });
  });
  it("update dengan baseVersion basi → konflik (server tak ditimpa)", async () => {
    await applyPush("qaReport", "r1", 0, report());
    await applyPush("qaReport", "r1", 1, report({ title: "Baru" }));
    const r = await applyPush("qaReport", "r1", 1, report({ title: "Basi" }));
    expect(r).toMatchObject({ ok: false, conflict: true });
    expect((await snapshot("qaReport", "r1"))!.data.title).toBe("Baru");
  });
  it("delete laporan (tombstone) merambat ke anak lewat cascade DB; anak yang datang untuk induk mati ditolak", async () => {
    await applyPush("qaReport", "r1", 0, report());
    await applyPush("qaCase", "c1", 0, qcase());
    await applyPush("qaReport", "r1", 1, report(), undefined, "delete");
    expect(await prisma.qaReport.count()).toBe(0);
    expect(await prisma.qaCase.count()).toBe(0);
  });
  it("upsertLocal (sisi penerima) menulis version/updatedAt apa adanya, tanpa SyncLog", async () => {
    await upsertLocal("qaReport", "r1", 7, report());
    expect((await snapshot("qaReport", "r1"))!.version).toBe(7);
    await upsertLocal("qaCase", "c1", 3, qcase());
    expect((await snapshot("qaCase", "c1"))!.version).toBe(3);
    expect(await prisma.syncLog.count()).toBe(0);
  });
});

describe("validasi sync: lampiran adalah permukaan serangan (storageKey jadi path di hub)", () => {
  const ok = (over: Record<string, unknown>) => () => validateSyncData("qaAttachment", attachment(over));
  it("menerima key uuid+ekstensi dan mime yang diizinkan", () => {
    expect(ok({})).not.toThrow();
    expect(ok({ mimeType: "application/pdf", storageKey: "0b7f3b1e-52a1-4b6e-8d0c-3a1f6d2c9e11.pdf" })).not.toThrow();
  });
  it("menolak path traversal / separator / titik-awal / terlalu panjang pada storageKey", () => {
    for (const k of ["../../etc/passwd", "a/b.png", "a\\b.png", ".htaccess", "", "x".repeat(200) + ".png", "..", "a b.png", "k\u0000.png"])
      expect(ok({ storageKey: k }), JSON.stringify(k)).toThrow(/storageKey/);
  });
  it("menolak mime di luar daftar, ownerType asing, sha256 bukan 64 hex, ukuran negatif/>10MB", () => {
    expect(ok({ mimeType: "application/x-sh" })).toThrow(/mimeType/);
    expect(ok({ ownerType: "banana" })).toThrow(/ownerType/);
    expect(ok({ sha256: "zz" })).toThrow(/sha256/);
    expect(ok({ size: -1 })).toThrow(/size/);
    expect(ok({ size: 10 * 1024 * 1024 + 1 })).toThrow(/size/);
  });
  it("push yang melanggar ditolak seluruhnya (tak ada baris tertulis)", async () => {
    await applyPush("qaReport", "r1", 0, report());
    await expect(applyPush("qaAttachment", "a1", 0, attachment({ storageKey: "../x" }))).rejects.toThrow();
    expect(await prisma.qaAttachment.count()).toBe(0);
  });
});

describe("paritas tipe lampiran", () => {
  it("QA_SYNC_MIMES = tipe yang diterima pipeline unggahan (gambar + dokumen) — daftar sync tak boleh melenceng", () => {
    expect([...QA_SYNC_MIMES].sort()).toEqual([...Object.keys(IMAGE_TYPES), ...Object.keys(DOCUMENT_TYPES)].sort());
  });
});
