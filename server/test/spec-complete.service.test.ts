import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { completeSpecManually } from "../src/services/spec-complete";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

const load = (id: string) => prisma.spec.findUnique({ where: { id } });

describe("SPEC-804 · completeSpecManually", () => {
  it("memindahkan stage ke done dan menyimpan jejak {at,by,reason}", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "planned", title: "judul" });
    const spec = (await load("SPEC-1"))!;
    const res = await completeSpecManually(spec, { by: "dena@x", reason: "sudah ter-merge lewat PR #12" });
    expect(res.ok).toBe(true);
    const after = (await load("SPEC-1"))!;
    expect(after.stage).toBe("done");
    expect(after.manualDone).toMatchObject({ by: "dena@x", reason: "sudah ter-merge lewat PR #12" });
    expect(typeof (after.manualDone as { at: string }).at).toBe("string");
  });

  it("alasan absen tak menulis key `reason`", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "brainstorming" });
    await completeSpecManually((await load("SPEC-2"))!, { by: "dena@x" });
    expect(Object.keys((await load("SPEC-2"))!.manualDone as object).sort()).toEqual(["at", "by"]);
  });

  it("menstempel doneAt + notifikasi done: + SessionResult ber-author", async () => {
    await makeSpec({ id: "SPEC-3", projectId: "p1", stage: "executing", title: "judul" });
    await completeSpecManually((await load("SPEC-3"))!, { by: "dena@x" });
    expect((await load("SPEC-3"))!.doneAt).toBeInstanceOf(Date);
    const notif = await prisma.notification.findFirst({ where: { key: "done:SPEC-3" } });
    expect(notif).toBeTruthy();
    const result = await prisma.sessionResult.findFirst({ where: { specId: "SPEC-3" } });
    expect(result).toMatchObject({ oldStage: "executing", newStage: "done", status: "done", author: "dena@x" });
  });

  it("CAS: item yang keburu done di bawah kita ditolak tanpa menulis apa pun", async () => {
    await makeSpec({ id: "SPEC-4", projectId: "p1", stage: "planned" });
    const stale = (await load("SPEC-4"))!;
    await prisma.spec.update({ where: { id: "SPEC-4" }, data: { stage: "done" } });
    const res = await completeSpecManually(stale, { by: "dena@x" });
    expect(res.ok).toBe(false);
    expect((await load("SPEC-4"))!.manualDone).toBeNull();
  });

  it("doneAt yang sudah ada tak bergeser — write-once ADR-0105", async () => {
    const old = new Date("2026-01-01T00:00:00.000Z");
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "executing", doneAt: old });
    await completeSpecManually((await load("SPEC-5"))!, { by: "dena@x" });
    expect((await load("SPEC-5"))!.doneAt!.toISOString()).toBe(old.toISOString());
  });
});
