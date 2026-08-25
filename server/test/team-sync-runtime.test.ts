import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../src/db";
import { validateSyncData, snapshot } from "../src/services/sync";
import { applyRemote } from "../src/services/sync-client";
import { writeTombstone } from "../src/services/tombstone";
import { resetDb, makeProject } from "./factory";

// SPEC-945 · ADR-0150 · dua kelas gagal-senyap yang tak tersentuh test kontrak berbasis daftar:
// keduanya lolos selama `order` kebetulan 0 dan assignee-nya kebetulan tak pernah dihapus.

beforeEach(async () => {
  await resetDb();
  await prisma.syncTombstone.deleteMany();
  await makeProject({ id: "p1" });
});

describe("order pecahan menyeberang sync", () => {
  // `order` Float ADA supaya drop di antara dua kartu bisa menulis titik tengah tetangganya.
  // Memvalidasinya sebagai bilangan bulat berarti kartu pertama yang benar-benar diseret akan
  // ditolak — dan di arah pull penolakan itu melempar di LUAR try/catch per-record, jadi kursor
  // tak pernah maju dan SELURUH sync client mandek permanen di balik satu baris log.
  it("validateSyncData menerima order pecahan", () => {
    expect(() => validateSyncData("task", {
      projectId: "p1", title: "Desain", detail: null, status: "backlog", priority: "sedang",
      memberId: null, startDate: null, dueDate: null, order: 1.5, specId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    })).not.toThrow();
  });

  it("menolak order yang bukan angka", () => {
    const base = {
      projectId: null, title: "x", detail: null, status: "backlog", priority: "sedang",
      memberId: null, startDate: null, dueDate: null, specId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    };
    expect(() => validateSyncData("task", { ...base, order: "1.5" })).toThrow(/tipe invalid/);
    expect(() => validateSyncData("task", { ...base, order: Infinity })).toThrow(/tipe invalid/);
    expect(() => validateSyncData("task", { ...base, order: NaN })).toThrow(/tipe invalid/);
  });

  it("record ber-order pecahan benar-benar mendarat, dengan nilai utuh", async () => {
    const r = await applyRemote("task", "t1", 1, {
      projectId: "p1", title: "Desain", detail: null, status: "backlog", priority: "sedang",
      memberId: null, startDate: null, dueDate: null, order: 2.25, specId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(r).toBe("applied");
    expect((await prisma.task.findUnique({ where: { id: "t1" } }))!.order).toBe(2.25);
    // Dan ia bisa berputar balik: snapshot yang dibaca ulang harus lolos validator yang sama.
    const snap = await snapshot("task", "t1");
    expect(() => validateSyncData("task", snap!.data)).not.toThrow();
  });
});

describe("induk SetNull tidak menjatuhkan anaknya", () => {
  // `PARENTS` lahir dari FK, tapi tak semua FK berarti hal yang sama saat induknya bertombstone.
  // `member` adalah induk `onDelete: SetNull` PERTAMA di peta itu: kontraknya "task jadi belum
  // ditugaskan, TIDAK ikut terhapus". Memperlakukannya seperti induk Cascade membuat kartu itu
  // lenyap senyap di setiap mesin yang belum memilikinya.
  it("task dengan assignee bertombstone tetap mendarat, memberId dikosongkan", async () => {
    await writeTombstone("member", "a@x.id", 2, { name: "Adi", email: "a@x.id" });
    const r = await applyRemote("task", "t1", 1, {
      projectId: "p1", title: "Nego", detail: null, status: "doing", priority: "sedang",
      memberId: "a@x.id", startDate: null, dueDate: null, order: 0, specId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(r).toBe("applied");
    const t = await prisma.task.findUnique({ where: { id: "t1" } });
    expect(t).not.toBeNull();
    expect(t!.memberId).toBeNull();
    expect(t!.title).toBe("Nego");
  });

  // Kontrol positif: induk Cascade TETAP menjatuhkan anaknya — perbaikan di atas tak boleh
  // membuka kembali anak yatim yang ADR-0119 sengaja buang.
  it("task dengan project bertombstone TETAP dibuang", async () => {
    await writeTombstone("project", "p9", 2, { name: "p9" });
    const r = await applyRemote("task", "t2", 1, {
      projectId: "p9", title: "Desain", detail: null, status: "backlog", priority: "sedang",
      memberId: null, startDate: null, dueDate: null, order: 0, specId: null,
      createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(r).toBe("dropped");
    expect(await prisma.task.count()).toBe(0);
  });
});
