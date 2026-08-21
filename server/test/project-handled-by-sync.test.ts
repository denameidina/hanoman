import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { applyPush, pull, snapshot, upsertLocal } from "../src/services/sync";

// SPEC-880 · ADR-0135 · penanda "ditangani oleh" HARUS menyeberang utuh — termasuk `name`, karena
// DeviceToken tak ikut SYNCED dan client kedua tak punya baris device untuk di-join.
const clean = async () => {
  await prisma.syncLog.deleteMany(); await prisma.syncOutbox.deleteMany();
  await prisma.syncTombstone.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.deviceToken.deleteMany(); await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean); afterAll(clean);

const HANDLED = [
  { deviceId: "dev-hm-dena", name: "hm-dena" },
  { deviceId: "dev-hub", name: "hub-vps" },
];

describe("SPEC-880 · round-trip sync handledBy", () => {
  it("push client → hub: kolom tersimpan & terbit ke feed", async () => {
    const r = await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect((await prisma.project.findUnique({ where: { id: "arta" } }))!.handledBy).toEqual(HANDLED);

    const feed = (await pull("0")).records.filter((x) => x.recordId === "arta");
    expect(feed).toHaveLength(1);
    expect(feed[0]!.data).toMatchObject({ handledBy: HANDLED });
  });

  it("pull ke client kedua: nama tetap utuh meski TAK ada baris DeviceToken", async () => {
    await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    const snap = (await snapshot("project", "arta"))!;

    // "client kedua": buang barisnya, lalu terapkan record dari feed apa adanya.
    await prisma.project.deleteMany();
    expect(await prisma.deviceToken.count()).toBe(0);
    await upsertLocal("project", "arta", snap.version, snap.data);

    const landed = await prisma.project.findUnique({ where: { id: "arta" } });
    expect(landed!.handledBy).toEqual(HANDLED);
  });

  it("mengosongkan penanda ikut menyeberang (bukan diabaikan diam-diam)", async () => {
    await applyPush("project", "arta", 0, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: HANDLED,
    });
    const r = await applyPush("project", "arta", 1, {
      name: "arta", desc: "d", kind: "existing", stack: "", gitRemote: null, handledBy: null,
    });
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await prisma.project.findUnique({ where: { id: "arta" } }))!.handledBy).toBeNull();
  });

  // Kelas gagal-senyap ADR-0090/0093/0105 diuji dari sisi kebalikannya: kalau `handledBy` sampai
  // hilang dari FIELDS, snapshot berhenti membawanya dan test ini yang jatuh lebih dulu.
  it("snapshot project SELALU menyebut handledBy", async () => {
    await prisma.project.create({ data: { id: "polos", name: "polos", desc: "d", kind: "existing" } });
    const snap = (await snapshot("project", "polos"))!;
    expect(Object.keys(snap.data)).toContain("handledBy");
    expect(snap.data.handledBy).toBeNull();
  });
});
