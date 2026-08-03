import { describe, it, expect, beforeEach } from "vitest";
import { collectBacklog } from "../src/services/changelog/collect";
import { resetDb, makeProject, makeSpec } from "./factory";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("collectBacklog", () => {
  it("mengambil item done di dalam rentang, inklusif di kedua ujung", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done", title: "Unduh laporan", doneAt: at(2026, 7, 1) });
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done", title: "Notifikasi tenang", doneAt: at(2026, 7, 31) });
    await makeSpec({ id: "SPEC-3", projectId: "p1", stage: "done", title: "Di luar", doneAt: at(2026, 8, 1) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items.map((i) => i.label)).toEqual(["Unduh laporan", "Notifikasi tenang"]);
  });

  it("membuang item yang belum done", async () => {
    await makeSpec({ id: "SPEC-4", projectId: "p1", stage: "executing", title: "Belum", doneAt: at(2026, 7, 10) });
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "done", title: "Sudah", doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok && r.input.items.map((i) => i.label)).toEqual(["Sudah"]);
  });

  it("item done tanpa doneAt tak dihitung, tapi dilaporkan sebagai catatan", async () => {
    await makeSpec({ id: "SPEC-6", projectId: "p1", stage: "done", title: "Punya stempel", doneAt: at(2026, 7, 10) });
    await makeSpec({ id: "SPEC-7", projectId: "p1", stage: "done", title: "Tanpa stempel", doneAt: null });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items).toHaveLength(1);
    expect(r.input.notes.join(" ")).toMatch(/1 item .*tanpa stempel/i);
  });

  it("judul & objective ikut sebagai label & detail, sudah di-scrub", async () => {
    await makeSpec({ id: "SPEC-8", projectId: "p1", stage: "done",
      title: "fix(spec-8): unduh laporan di server/src/x.ts",
      objective: "Pemakai bisa mengunduh laporan.\n\nDetail: ubah recordCompletion().",
      doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.items[0]!.label).toBe("unduh laporan di");
    expect(r.input.items[0]!.detail).toBe("Pemakai bisa mengunduh laporan.");
  });

  it("rentang kosong = alasan yang bisa dibaca, bukan lemparan", async () => {
    const r = await collectBacklog("p1", "2026-01-01", "2026-01-31");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/tak ada backlog/i);
  });

  it("item project lain tak ikut", async () => {
    await makeProject({ id: "p2", name: "p2" });
    await makeSpec({ id: "SPEC-9", projectId: "p2", stage: "done", title: "Punya tetangga", doneAt: at(2026, 7, 10) });
    const r = await collectBacklog("p1", "2026-07-01", "2026-07-31");
    expect(r.ok).toBe(false);
  });
});
