import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/db";
import { resetDb } from "./factory";
import { zNotification } from "@hanoman/shared";
import { recordCompletion, recordFailure, scanDecisions, __resetAwaiting } from "../src/services/notifications";

describe("Notification model", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat & membaca satu notifikasi; bentuknya lolos zNotification", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-1", specId: "SPEC-1", sessionId: "spec_1", title: "judul", projectId: "p1" } });
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-1" } });
    // Fastify menserialisasi Date → ISO string; tiru untuk memvalidasi kontrak shared.
    const wire = { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
    expect(zNotification.safeParse(wire).success).toBe(true);
  });

  it("key unik: create kedua dengan key sama melempar P2002", async () => {
    await prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "a", projectId: null } });
    await expect(prisma.notification.create({ data: { key: "done:SPEC-2", specId: "SPEC-2", title: "b", projectId: null } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("dua baris decision (key null) tidak saling tabrakan", async () => {
    await prisma.notification.create({ data: { type: "decision", sessionId: "s1", title: "a", projectId: null } });
    await prisma.notification.create({ data: { type: "decision", sessionId: "s2", title: "b", projectId: null } });
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(2);
  });
});

describe("recordCompletion", () => {
  beforeEach(async () => { await resetDb(); });

  it("idempoten via key: dua panggilan spec sama → satu baris", async () => {
    await recordCompletion("SPEC-3", "judul", "p1");
    await recordCompletion("SPEC-3", "judul", "p1");
    expect(await prisma.notification.count({ where: { specId: "SPEC-3" } })).toBe(1);
  });

  it("menyimpan sessionId turunan untuk aksi 'Buka'", async () => {
    await recordCompletion("SPEC-4", "judul", "p1");
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-4" } });
    expect(row.sessionId).toBe("spec-4");
    expect(row.type).toBe("done");
  });
});

describe("recordFailure", () => {
  beforeEach(async () => { await resetDb(); });

  it("membuat notif type fail dengan sessionId turunan + alasan di judul", async () => {
    await recordFailure("SPEC-9", "Judul spec", "p1", "sesi berakhir sebelum mencapai done (gagal/limit)");
    const row = await prisma.notification.findFirstOrThrow({ where: { specId: "SPEC-9" } });
    expect(row.type).toBe("fail");
    expect(row.sessionId).toBe("spec-9");
    expect(row.title).toContain("Judul spec");
    expect(row.title.toLowerCase()).toContain("gagal");
  });

  it("idempoten via key: dua panggilan spec sama → satu baris", async () => {
    await recordFailure("SPEC-10", "t", "p1", "r");
    await recordFailure("SPEC-10", "t", "p1", "r");
    expect(await prisma.notification.count({ where: { specId: "SPEC-10" } })).toBe(1);
  });
});

describe("scanDecisions", () => {
  beforeEach(async () => { await resetDb(); __resetAwaiting(); });

  const marker = (content = "waiting\n") => {
    const f = join(mkdtempSync(join(tmpdir(), "hanoman-dec-")), "sess");
    writeFileSync(f, content);
    return f;
  };

  it("marker terisi → satu notif decision (sessionId+projectId); scan ulang tak menambah", async () => {
    const f = marker();
    const read = () => [{ id: "sess1", specId: undefined, projectId: "p1", decisionFile: f, waiting: true }];
    await scanDecisions(read);
    await scanDecisions(read);
    const rows = await prisma.notification.findMany({ where: { type: "decision" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionId).toBe("sess1");
    expect(rows[0]!.projectId).toBe("p1");
  });

  it("dikosongkan (manusia menjawab) lalu terisi lagi → notif kedua", async () => {
    const f = marker();
    const read = () => [{ id: "sess1", specId: undefined, projectId: "p1", decisionFile: f, waiting: true }];
    await scanDecisions(read);
    truncateSync(f, 0); await scanDecisions(read);
    writeFileSync(f, "waiting\n"); await scanDecisions(read);
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(2);
  });

  it("marker kosong diabaikan", async () => {
    const f = marker("");
    await scanDecisions(() => [{ id: "x", specId: undefined, projectId: "p1", decisionFile: f, waiting: true }]);
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(0);
  });

  // SPEC-903 · ADR-0143 · marker codex dipasang di TIAP akhir turn, jadi sesi yang melanjutkan
  // sendiri hari ini menotifikasi "menunggu keputusan" berulang kali tanpa ada yang ditanyakan.
  it("tak menotifikasi selama agen masih bekerja, lalu satu kali saat benar-benar menunggu", async () => {
    const f = marker("1787400000\n");
    const row = (waiting: boolean) =>
      [{ id: "s903", specId: undefined, projectId: "p1", decisionFile: f, waiting }];
    await scanDecisions(() => row(false));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(0);
    await scanDecisions(() => row(true));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(1);
  });

  // Manusia yang mengetik jawabannya membuat pane berisik sebentar-sebentar. Dedup karena itu tetap
  // dikunci pada MARKER, bukan pada bit turunan — kalau tidak tiap kedipan melahirkan notif kedua.
  it("kedipan sibuk di tengah satu episode marker tak melahirkan notifikasi kedua", async () => {
    const f = marker("1787400000\n");
    const row = (waiting: boolean) =>
      [{ id: "s903b", specId: undefined, projectId: "p1", decisionFile: f, waiting }];
    await scanDecisions(() => row(true));
    await scanDecisions(() => row(false));
    await scanDecisions(() => row(true));
    expect(await prisma.notification.count({ where: { type: "decision" } })).toBe(1);
  });
});
