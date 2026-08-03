import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { recordCompletion } from "../src/services/notifications";
import { __FIELDS, __DATE_FIELDS } from "../src/services/sync";
import { resetDb, makeProject, makeSpec } from "./factory";

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("Spec.doneAt (SPEC-516 · ADR-0105)", () => {
  it("recordCompletion menstempel doneAt", async () => {
    await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done" });
    const before = Date.now();
    await recordCompletion("SPEC-1", "judul", "p1");
    const s = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(s!.doneAt).toBeInstanceOf(Date);
    expect(s!.doneAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("panggilan kedua TIDAK memindahkan stempel (selesai PERTAMA, cermin startedAt)", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done" });
    await recordCompletion("SPEC-2", "judul", "p1");
    const first = (await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.doneAt!;
    await new Promise((r) => setTimeout(r, 20));
    await recordCompletion("SPEC-2", "judul", "p1");
    const again = (await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.doneAt!;
    expect(again.getTime()).toBe(first.getTime());
  });

  it("spec yang sudah dihapus tak membuat recordCompletion melempar", async () => {
    await expect(recordCompletion("SPEC-HILANG", "judul", "p1")).resolves.toBeUndefined();
  });

  // Kelas gagal-senyap ADR-0090/0093/0094: `upsert` yang tak menyebut sebuah kolom TETAP
  // berhasil, jadi kolom yang lupa didaftarkan mendarat sebagai null palsu di tiap client.
  it("doneAt ikut menyeberang sync (FIELDS + DATE_FIELDS)", () => {
    expect(__FIELDS.spec).toContain("doneAt");
    expect(__DATE_FIELDS.spec).toContain("doneAt");
  });
});
