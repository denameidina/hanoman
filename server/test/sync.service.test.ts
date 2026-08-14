import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { applyPush, pull, snapshot, publishLocal, backfillFeed } from "../src/services/sync";

const clean = async () => {
  await prisma.syncLog.deleteMany();
  await prisma.ticketAttachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.spec.deleteMany(); await prisma.vps.deleteMany(); await prisma.project.deleteMany();
};
beforeEach(clean); afterAll(clean);

async function project() {
  return prisma.project.create({ data: { id: "p1", name: "p1", desc: "d", kind: "existing", repoDir: "/local/only" } });
}
const specData = (over: Record<string, unknown> = {}) => ({
  projectId: "p1", title: "t", source: "brief", stage: "planned", priority: "sedang",
  author: "a@b.co", objective: "o", payload: null, branchFrom: null, baseSha: null, headSha: null, ...over,
});

describe("sync service (SPEC-213 AC-9..15)", () => {
  it("rejects fields outside the entity sync contract before applying a push", async () => {
    await project();
    await expect(applyPush("spec", "SPEC-1", 0, specData({ launchApprovedAt: new Date().toISOString() })))
      .rejects.toThrow(/field/);
    expect(await prisma.spec.findUnique({ where: { id: "SPEC-1" } })).toBeNull();
  });

  it("insert new record → version 1; snapshot reflects it", async () => {
    await project();
    const r = await applyPush("spec", "SPEC-1", 0, specData());
    expect(r).toMatchObject({ ok: true, version: 1 });
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap).toMatchObject({ version: 1 });
    expect(snap?.data).toMatchObject({ title: "t", stage: "planned" });
  });

  it("stale push rejected with server snapshot; DB unchanged (AC-12)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const stale = await applyPush("spec", "SPEC-1", 0, specData({ title: "HIJACK" }));
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect((stale as { server: { version: number } }).server.version).toBe(1);
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap?.version).toBe(1);
    expect(snap?.data).toMatchObject({ title: "t" }); // NOT hijacked
  });

  it("fresh push with matching baseVersion advances version (AC-11)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const r = await applyPush("spec", "SPEC-1", 1, specData({ stage: "executing" }));
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await snapshot("spec", "SPEC-1"))?.data).toMatchObject({ stage: "executing" });
  });

  // SPEC-408 · ADR-0090 · tanpa ini, spec yang lahir di hub akan mendapat createdAt = now()
  // di TIAP client (kolom NOT NULL ber-default) alias tanggal palsu per mesin.
  it("createdAt & startedAt menyeberang push (SPEC-408)", async () => {
    await project();
    const created = "2026-01-02T03:04:05.000Z";
    const started = "2026-02-03T04:05:06.000Z";
    await applyPush("spec", "SPEC-1", 0, specData({ createdAt: created, startedAt: started }));
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(row!.createdAt.toISOString()).toBe(created);
    expect(row!.startedAt!.toISOString()).toBe(started);
    const snap = await snapshot("spec", "SPEC-1");
    expect(snap?.data).toMatchObject({ createdAt: created, startedAt: started });
  });

  it("startedAt null menyeberang sebagai null (SPEC-408)", async () => {
    await project();
    await applyPush("spec", "SPEC-2", 0, specData({ createdAt: "2026-01-02T03:04:05.000Z", startedAt: null }));
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-2" } }))!.startedAt).toBeNull();
    expect((await snapshot("spec", "SPEC-2"))?.data).toMatchObject({ startedAt: null });
  });

  it("pull returns records after cursor, then is idempotent/empty (AC-15)", async () => {
    await project();
    await applyPush("spec", "SPEC-1", 0, specData());
    const first = await pull("0");
    expect(first.records.map((x) => x.recordId)).toContain("SPEC-1");
    expect(Number(first.cursor)).toBeGreaterThan(0);
    const second = await pull(first.cursor);
    expect(second.records).toHaveLength(0);
    expect(second.cursor).toBe(first.cursor);
  });

  it("snapshot excludes never-sync fields (repoDir on project, keyPath on vps) (AC-7/29)", async () => {
    await project();
    const psnap = await snapshot("project", "p1");
    expect(psnap?.data).not.toHaveProperty("repoDir");
    await prisma.vps.create({ data: { id: "v1", name: "v", host: "h", user: "u", keyPath: "/secret/key" } });
    const vsnap = await snapshot("vps", "v1");
    expect(vsnap?.data).not.toHaveProperty("keyPath");
    expect(vsnap?.data).toMatchObject({ name: "v", host: "h" });
  });

  it("rename: applyPush dgn renamedFrom memindahkan row lama, bukan insert baru (SPEC-255)", async () => {
    await project(); // id "p1"
    await applyPush("spec", "SPEC-1", 0, specData()); // spec di p1
    const r = await applyPush("project", "p1-renamed", 0, { name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null, renamedFrom: "p1" });
    expect(r).toMatchObject({ ok: true });
    // project lama hilang, baru ada, spec ikut pindah (cascade)
    expect(await prisma.project.findUnique({ where: { id: "p1" } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: "p1-renamed" } })).not.toBeNull();
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))?.projectId).toBe("p1-renamed");
    // renamedFrom bukan kolom — tak bocor ke Project (coerce membuangnya)
    const snap = await snapshot("project", "p1-renamed");
    expect(snap?.data).not.toHaveProperty("renamedFrom");
    // SyncLog rename membawa renamedFrom agar penerima ikut rename
    const log = await prisma.syncLog.findFirst({ where: { entity: "project", recordId: "p1-renamed" }, orderBy: { seq: "desc" } });
    expect((log?.data as Record<string, unknown>).renamedFrom).toBe("p1");
  });

  it("rename idempoten: push kedua (row baru sudah ada) tetap ok tanpa error (SPEC-255)", async () => {
    await project();
    await applyPush("project", "p1b", 0, { name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null, renamedFrom: "p1" });
    const again = await applyPush("project", "p1b", 0, { name: "p1", desc: "d", kind: "existing", stack: "", gitRemote: null, renamedFrom: "p1" });
    expect(again).toMatchObject({ ok: true });
  });

  it("ticket: snapshot menyertakan accessKeyHash, TIDAK ada lampiran (SPEC-268)", async () => {
    await project();
    await applyPush("ticket", "tk1", 0, {
      projectId: "p1", number: 1, category: "bug", title: "judul", detail: "isi",
      reporterEmail: "r@x.co", status: "new", accessKeyHash: "hashval", specId: null,
      createdAt: new Date().toISOString(),
    });
    const snap = await snapshot("ticket", "tk1");
    expect(snap?.data).toMatchObject({ number: 1, title: "judul", accessKeyHash: "hashval" });
    expect(snap?.data).not.toHaveProperty("attachments");
  });

  it("publishLocal: append SyncLog + naikkan version + panggil hook (SPEC-268)", async () => {
    await project();
    // SPEC-384 · subjeknya dulu ErrorGroup; sesudah error monitoring dicabut, Ticket adalah
    // record asal-hub tersisa dengan peran yang sama.
    await prisma.ticket.create({ data: { id: "tk2", projectId: "p1", number: 2, category: "bug", title: "judul2", detail: "d", reporterEmail: "r@x.co", accessKeyHash: "hash-tk2" } });
    await publishLocal("ticket", "tk2");
    const log = await prisma.syncLog.findFirst({ where: { entity: "ticket", recordId: "tk2" }, orderBy: { seq: "desc" } });
    expect(log?.version).toBe(1);
    expect((log?.data as Record<string, unknown>).title).toBe("judul2");
    expect((await prisma.ticket.findUnique({ where: { id: "tk2" } }))?.version).toBe(1);
  });

  it("SPEC-270: snapshot menyertakan updatedAt & applyPush menjaga updatedAt asal", async () => {
    await project();
    const origin = new Date("2020-01-02T03:04:05.000Z");
    const r = await applyPush("spec", "SPEC-1", 0, specData({ updatedAt: origin.toISOString() }));
    expect(r.ok).toBe(true);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-1" } });
    expect(row!.updatedAt.toISOString()).toBe(origin.toISOString());
    const s = await snapshot("spec", "SPEC-1");
    expect((s!.data as Record<string, unknown>).updatedAt).toBe(origin.toISOString());
  });

  it("SPEC-270: backfillFeed mempublish row yang belum ter-feed, idempoten", async () => {
    await project();
    // SPEC-384 · dulu ErrorGroup; Ticket memenuhi peran yang sama (row asal-hub tanpa jejak feed).
    await prisma.ticket.create({ data: { id: "g1", projectId: "p1", number: 9, category: "bug",
      title: "t", detail: "d", reporterEmail: "r@x.co", accessKeyHash: "hash-g1" } });
    const n1 = await backfillFeed();
    expect(n1).toBeGreaterThanOrEqual(1);
    const feed1 = (await pull("0")).records.filter((r) => r.recordId === "g1");
    expect(feed1).toHaveLength(1);
    const n2 = await backfillFeed();
    const feed2 = (await pull("0")).records.filter((r) => r.recordId === "g1");
    expect(feed2).toHaveLength(1);
    expect(n2).toBe(0);
  });

  it("ticketAttachment metadata roundtrip: push→pull membawa metadata, bukan byte (SPEC-272)", async () => {
    await project();
    await applyPush("ticket", "TCK-1", 0, {
      projectId: "p1", number: 1, category: "bug", title: "t", detail: "d",
      reporterEmail: "r@e.co", status: "new", accessKeyHash: "h", specId: null,
    });
    const r = await applyPush("ticketAttachment", "ATT-1", 0, {
      ticketId: "TCK-1", projectId: "p1", filename: "shot.png",
      mimeType: "image/png", size: 42, storageKey: "uuid-abc.png",
    });
    expect(r).toMatchObject({ ok: true, version: 1 });
    const snap = await snapshot("ticketAttachment", "ATT-1");
    expect(snap?.data).toMatchObject({ filename: "shot.png", storageKey: "uuid-abc.png", size: 42 });
    // metadata di feed, tak ada field byte/isi biner
    expect(Object.keys(snap!.data)).not.toContain("data");
    const feed = await pull("0");
    expect(feed.records.map((x) => x.recordId)).toContain("ATT-1");
  });
});
