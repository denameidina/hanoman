import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { enqueueOutbox, listOutbox } from "../src/services/outbox";
import { recordConflict, listConflicts, resolveConflict } from "../src/services/conflicts";

const clean = async () => {
  await prisma.syncConflict.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

const L = { version: 2, data: { title: "lokal", updatedAt: "2020-01-02T00:00:00.000Z" } };
const S = { version: 3, data: { title: "server", updatedAt: "2020-01-01T00:00:00.000Z" } };

function fullSpec(title: string) {
  return { projectId: "p1", title, source: "brief", stage: "planned", priority: "sedang", author: "a",
    objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null,
    updatedAt: "2020-01-02T00:00:00.000Z" };
}

describe("conflicts service (SPEC-270)", () => {
  it("record + list mengembalikan konflik pending", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!).toMatchObject({ entity: "spec", recordId: "SPEC-1", localVersion: 2, serverVersion: 3 });
  });

  it("record idempoten per (entity,recordId) — update snapshot, bukan duplikat", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    await recordConflict("spec", "SPEC-1", { ...L, version: 4 }, S);
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!.localVersion).toBe(4);
  });

  // Cacat A · keputusan manusia dihapus tick sync berikutnya. `recordConflict` meng-upsert dengan
  // `resolvedAt: null` di payload update, jadi setiap siklus (~15 detik) membuka kembali konflik
  // yang BARU SAJA diputuskan — dari sisi operator, tombolnya "tak berfungsi".
  it("record TIDAK membuka kembali konflik yang sudah diputuskan pada pasangan versi yang sama", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    const push = async () => ({ results: [{ ok: true, version: 4 }] });
    await resolveConflict("spec", "SPEC-1", "local", push);
    expect(await listConflicts()).toHaveLength(0);

    await recordConflict("spec", "SPEC-1", L, S); // tick sync berikutnya melihat baris yang sama
    expect(await listConflicts()).toHaveLength(0);
  });

  it("record MEMBUKA kembali bila salah satu sisi benar-benar bergeser sesudah diputuskan", async () => {
    await recordConflict("spec", "SPEC-1", L, S);
    await resolveConflict("spec", "SPEC-1", "local", async () => ({ results: [{ ok: true, version: 4 }] }));
    await recordConflict("spec", "SPEC-1", L, { ...S, version: 9 }); // divergensi BARU
    const list = await listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0]!.serverVersion).toBe(9);
  });

  // Cacat B · "Pakai Lokal" memakai `baseVersion` dari baris konflik. Begitu hub bergerak (VPS
  // menulis health-nya tiap beberapa menit), angka itu basi dan hub menolak selamanya — padahal
  // tombolnya menjanjikan force-push. Hub sudah mengembalikan snapshot terkininya; pakai itu.
  it("resolve(local) mencoba ulang dengan versi server terkini saat hub menolak", async () => {
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    const seen: number[] = [];
    const push = async (records: any[]) => {
      const base = records[0].baseVersion as number;
      seen.push(base);
      return base === 77
        ? { results: [{ ok: true, version: 78 }] }
        : { results: [{ ok: false, conflict: true, server: { version: 77, data: fullSpec("server") } }] };
    };
    const r = await resolveConflict("spec", "SPEC-1", "local", push);
    expect(r.ok).toBe(true);
    expect(seen).toEqual([3, 77]);
    expect(await listConflicts()).toHaveLength(0);
  });

  it("resolve(server) mengadopsi data server ke lokal & menuntaskan", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: null } });
    await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "lokal", source: "brief",
      stage: "planned", priority: "sedang", author: "a", objective: "o", version: 2 } });
    await enqueueOutbox("spec", "SPEC-1");
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    const push = async () => ({ results: [{ ok: true, version: 4 }] });
    const r = await resolveConflict("spec", "SPEC-1", "server", push);
    expect(r.ok).toBe(true);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.title).toBe("server");
    expect(await listConflicts()).toHaveLength(0);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("resolve(local) force-push data lokal ke hub & menuntaskan", async () => {
    await recordConflict("spec", "SPEC-1", { version: 2, data: fullSpec("lokal") },
      { version: 3, data: fullSpec("server") });
    let pushed: any = null;
    const push = async (records: unknown[]) => { pushed = records; return { results: [{ ok: true, version: 4 }] }; };
    const r = await resolveConflict("spec", "SPEC-1", "local", push);
    expect(r.ok).toBe(true);
    expect(pushed[0]).toMatchObject({ entity: "spec", id: "SPEC-1", baseVersion: 3 });
    expect(await listConflicts()).toHaveLength(0);
  });
});
