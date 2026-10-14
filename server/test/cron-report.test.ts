import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { pull } from "../src/services/sync";
import { findTombstone } from "../src/services/tombstone";
import {
  getCronReport, latestCronReport, listCronReports, recordCronReport,
} from "../src/services/scheduler/cron-report";
import { CRON_REPORT_KEEP, CRON_REPORT_MAX_BYTES } from "@hanoman/shared";
import { makeProject, resetDb } from "./factory";

// ADR-0222 · laporan run cron. Sumber: hook `Stop` sesi `cron-*`; kunci: id = id run.
const SID = "cron-c1";
// `cronReport` entitas OPSIONAL (ADR-0180): feed hanya memuatnya untuk client yang memintanya.
const feedFor = async (accept: string[]) =>
  (await pull("0", undefined, undefined, { accept: new Set(accept) })).records as { entity: string; recordId: string; op: string }[];
const feed = () => feedFor(["cronReport"]);

async function seedRun(over: { cronId?: string; dueAt?: Date; status?: string; sessionId?: string | null } = {}) {
  const run = await prisma.schedulerCronRun.create({
    data: {
      cronId: over.cronId ?? "c1", projectId: "p1", dueAt: over.dueAt ?? new Date(2026, 9, 14, 1, 0),
      status: over.status ?? "launched", sessionId: over.sessionId === undefined ? SID : over.sessionId,
      startedAt: over.dueAt ?? new Date(2026, 9, 14, 1, 0),
    },
  });
  return run;
}

beforeEach(async () => {
  await resetDb();
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany(); await prisma.syncTombstone.deleteMany();
  await prisma.schedulerCronRun.deleteMany(); await prisma.schedulerCron.deleteMany();
  await makeProject({ id: "p1" });
  await prisma.schedulerCron.create({ data: { id: "c1", projectId: "p1", name: "Cek biaya Harian Cloudflare", expr: "0 1 * * *", prompt: "x" } });
});

describe("recordCronReport", () => {
  it("menulis laporan untuk run launched: id = id run, runDate lokal, ikut feed sync", async () => {
    const run = await seedRun();
    const r = await recordCronReport(SID, "## Biaya\nRp 10");
    expect(r?.id).toBe(run.id);
    const row = await prisma.cronReport.findUnique({ where: { id: run.id } });
    expect(row).toMatchObject({ projectId: "p1", cronId: "c1", cronName: "Cek biaya Harian Cloudflare",
      runDate: "2026-10-14", body: "## Biaya\nRp 10", sessionId: SID });
    expect(row!.bytes).toBe(Buffer.byteLength("## Biaya\nRp 10"));
    expect((await feed()).some((f) => f.entity === "cronReport" && f.recordId === run.id && f.op === "upsert")).toBe(true);
  });

  it("giliran terakhir menang, tetap SATU baris; isi sama tidak menerbitkan ulang", async () => {
    const run = await seedRun();
    await recordCronReport(SID, "draf");
    const before = (await feed()).filter((f) => f.recordId === run.id).length;
    await recordCronReport(SID, "draf");
    expect((await feed()).filter((f) => f.recordId === run.id).length).toBe(before);
    await recordCronReport(SID, "final");
    expect(await prisma.cronReport.count()).toBe(1);
    expect((await prisma.cronReport.findUnique({ where: { id: run.id } }))!.body).toBe("final");
  });

  it("memilih run launched TERBARU untuk sessionId yang dipakai ulang", async () => {
    await seedRun({ dueAt: new Date(2026, 9, 13, 1, 0) });
    const newer = await seedRun({ dueAt: new Date(2026, 9, 14, 1, 0) });
    const r = await recordCronReport(SID, "hari ini");
    expect(r?.id).toBe(newer.id);
  });

  it("diabaikan: bukan sesi cron, pesan kosong, tanpa run launched, run skipped/failed", async () => {
    await seedRun({ status: "failed" });
    expect(await recordCronReport(SID, "x")).toBeNull();
    await seedRun({ dueAt: new Date(2026, 9, 15, 1, 0) });
    expect(await recordCronReport("spec-1", "x")).toBeNull();
    expect(await recordCronReport(SID, "   ")).toBeNull();
    expect(await prisma.cronReport.count()).toBe(0);
  });

  it("memotong isi > 64 KiB dengan penanda", async () => {
    await seedRun();
    await recordCronReport(SID, "a".repeat(CRON_REPORT_MAX_BYTES * 2));
    const row = (await prisma.cronReport.findFirst())!;
    expect(row.bytes).toBeLessThanOrEqual(CRON_REPORT_MAX_BYTES);
    expect(row.body).toContain("dipotong");
  });

  it(`retensi: hanya ${CRON_REPORT_KEEP} laporan terbaru per cron; yang terpangkas bertombstone`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < CRON_REPORT_KEEP + 2; i++) {
      const run = await seedRun({ dueAt: new Date(2026, 0, 1 + i, 1, 0) });
      ids.push(run.id);
      await recordCronReport(SID, `r${i}`);
    }
    expect(await prisma.cronReport.count({ where: { cronId: "c1" } })).toBe(CRON_REPORT_KEEP);
    expect(await prisma.cronReport.findUnique({ where: { id: ids[0] } })).toBeNull();
    expect(await findTombstone("cronReport", ids[0]!)).not.toBeNull();
    expect(await prisma.cronReport.findUnique({ where: { id: ids.at(-1)! } })).not.toBeNull();
  });

  it("cron lain tak ikut terpangkas", async () => {
    await seedRun({ cronId: "c2", sessionId: "cron-c2" });
    await recordCronReport("cron-c2", "lain");
    for (let i = 0; i < CRON_REPORT_KEEP + 1; i++) {
      await seedRun({ dueAt: new Date(2026, 0, 1 + i, 1, 0) });
      await recordCronReport(SID, `r${i}`);
    }
    expect(await prisma.cronReport.count({ where: { cronId: "c2" } })).toBe(1);
  });
});

describe("kompatibilitas client lama (ADR-0180)", () => {
  it("client yang tak meminta cronReport tak menerimanya, kursor tetap maju", async () => {
    const run = await seedRun();
    await recordCronReport(SID, "x");
    expect((await feedFor([])).some((f) => f.recordId === run.id)).toBe(false);
    expect((await feedFor(["cronReport"])).some((f) => f.recordId === run.id)).toBe(true);
  });
});

describe("pembacaan", () => {
  it("daftar tanpa body, terbaru dulu, berfilter, berhalaman; detail dengan body + filename", async () => {
    const a = await seedRun({ dueAt: new Date(2026, 9, 13, 1, 0) }); await recordCronReport(SID, "A");
    const b = await seedRun({ dueAt: new Date(2026, 9, 14, 1, 0) }); await recordCronReport(SID, "B");
    const list = await listCronReports({ cronId: "c1" });
    expect(list.total).toBe(2);
    expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(list.items[0]).not.toHaveProperty("body");
    expect(list.items[0]!.filename).toBe(`2026-10-14-cek-biaya-harian-cloudflare-${b.id}.md`);
    expect((await listCronReports({ cronId: "c1", limit: "1", page: "2" })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listCronReports({ projectId: "nope" })).total).toBe(0);
    expect(await getCronReport(a.id)).toMatchObject({ id: a.id, body: "A" });
    expect(await getCronReport("tak-ada")).toBeNull();
    expect(await latestCronReport({ cronId: "c1" })).toMatchObject({ id: b.id, body: "B" });
    expect(await latestCronReport({ cronId: "x" })).toBeNull();
  });

  it("laporan dari cron yang TIDAK ada di DB ini (mesin lain via sync) tetap terbaca", async () => {
    await prisma.cronReport.create({ data: {
      id: "remote1", projectId: "p1", cronId: "cron-di-mesin-lain", cronName: "Jauh", runDate: "2026-10-12",
      dueAt: new Date(2026, 9, 12, 1, 0), body: "dari sana", bytes: 9 } });
    expect((await listCronReports({ cronId: "cron-di-mesin-lain" })).total).toBe(1);
    expect((await latestCronReport({ cronId: "cron-di-mesin-lain" }))?.body).toBe("dari sana");
  });
});
