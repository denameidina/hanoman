import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDb, makeProject, makeSpec } from "./factory";

const app = buildApp({ requireAuth: false });
const brief = { context: "operator buka tiga layar", outcome: "satu badge di Overview", constraints: "reuse queue", priority: "sedang" };
const post = (id: string, body: unknown) =>
  app.inject({ method: "POST", url: `/api/specs/${id}/source`, payload: body as object });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "ps" });
});

describe("SPEC-546 · ADR-0109 · POST /specs/:id/source", () => {
  it("brief → qa in-place: id/dependency/createdAt tetap, payload & turunan berpindah", async () => {
    await makeSpec({ id: "SPEC-799", projectId: "ps", stage: "brainstorming" });
    await makeSpec({ id: "SPEC-800", projectId: "ps", source: "brief", stage: "brainstorming",
      priority: "sedang", payload: brief, dependsOn: ["SPEC-799"], branchFrom: null });
    const before = await prisma.spec.findUnique({ where: { id: "SPEC-800" } });
    const r = await post("SPEC-800", { source: "qa" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe("SPEC-800");                      // id SPEC-nnn TIDAK berubah
    expect(body.source).toBe("qa");
    expect(body.payload).toEqual({
      severity: "minor", steps: "", expected: "satu badge di Overview",
      actual: "operator buka tiga layar", env: "", constraints: "reuse queue",
    });
    expect(body.priority).toBe("sedang");                   // diturunkan dari severity
    expect(body.objective).toBe("operator buka tiga layar");
    expect(body.dependsOn).toEqual(["SPEC-799"]);           // dependency utuh
    expect(new Date(body.createdAt).toISOString()).toBe(before!.createdAt.toISOString());
    // Jejak: bentuk LAMA tersimpan utuh.
    expect(body.sourceHistory).toHaveLength(1);
    expect(body.sourceHistory[0]).toMatchObject({ from: "brief", to: "qa" });
    expect(body.sourceHistory[0].payload).toEqual(brief);
    // Tak ada baris baru: konversi adalah update in-place.
    expect(await prisma.spec.count({ where: { projectId: "ps" } })).toBe(2);
  });

  it("payload eksplisit dipakai; bentuk salah ditolak 400", async () => {
    await makeSpec({ id: "SPEC-801", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const bad = await post("SPEC-801", { source: "qa", payload: brief });
    expect(bad.statusCode).toBe(400);
    const ok = await post("SPEC-801", { source: "qa", payload: {
      severity: "critical", steps: "1. buka", expected: "e", actual: "a", env: "prod" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().priority).toBe("tinggi");   // critical → tinggi
  });

  it("source yang sama ditolak 400 — permintaan no-op adalah bug klien, bukan jejak baru", async () => {
    await makeSpec({ id: "SPEC-802", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const r = await post("SPEC-802", { source: "brief" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("tak berubah");
  });

  it("spec tak ada → 404; source tak dikenal → 400", async () => {
    expect((await post("SPEC-999", { source: "qa" })).statusCode).toBe(404);
    await makeSpec({ id: "SPEC-803", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    expect((await post("SPEC-803", { source: "cross-audit" })).statusCode).toBe(400);
  });

  it("item yang SUDAH DIMULAI: brief→help 200, brief→qa 409, brief→help+payload 409", async () => {
    await makeSpec({ id: "SPEC-804", projectId: "ps", source: "brief", stage: "executing",
      baseSha: "deadbeef", payload: brief });
    expect((await post("SPEC-804", { source: "qa" })).statusCode).toBe(409);
    expect((await post("SPEC-804", { source: "help", payload: brief })).statusCode).toBe(409);
    const ok = await post("SPEC-804", { source: "help" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().source).toBe("help");
    expect(ok.json().payload).toEqual(brief);   // isi tak tersentuh
  });

  it("goal ↔ brief bolak-balik: objective ikut bentuk yang berlaku", async () => {
    await makeSpec({ id: "SPEC-805", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    const toGoal = await post("SPEC-805", { source: "goal" });
    expect(toGoal.json().objective).toBe("satu badge di Overview");
    expect(toGoal.json().payload.goal).toBe("satu badge di Overview");
    const back = await post("SPEC-805", { source: "brief" });
    expect(back.json().objective).toBe("satu badge di Overview");
    expect(back.json().sourceHistory).toHaveLength(2);
  });

  it("tiap konversi menulis satu notifikasi ber-key unik", async () => {
    await makeSpec({ id: "SPEC-806", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    await post("SPEC-806", { source: "qa" });
    await post("SPEC-806", { source: "brief" });
    const rows = await prisma.notification.findMany({
      where: { specId: "SPEC-806", type: "spec-source" }, orderBy: { key: "asc" } });
    expect(rows.map((r) => r.key)).toEqual(["source:SPEC-806:1", "source:SPEC-806:2"]);
    expect(rows[0]!.title).toContain("brief → qa");
  });

  // Konstrain SPEC-546: perubahan source harus merambat lewat feed sync seperti perubahan field
  // lain. Env test tak punya SYNC_SERVER_URL ⇒ peran HUB ⇒ `notifySynced` menulis SyncLog
  // (cabang client/outbox sudah diuji sync-notify.test.ts). Yang diperiksa di sini bukan sekadar
  // "ada barisnya" melainkan ISI snapshot-nya: `source` baru DAN jejaknya ikut menyeberang.
  it("konversi merambat lewat feed sync, berikut jejaknya", async () => {
    await makeSpec({ id: "SPEC-807", projectId: "ps", source: "brief", stage: "brainstorming", payload: brief });
    await prisma.syncLog.deleteMany();
    await post("SPEC-807", { source: "help" });
    const rows = await prisma.syncLog.findMany({ where: { entity: "spec", recordId: "SPEC-807" } });
    expect(rows.length).toBeGreaterThan(0);
    const data = rows.at(-1)!.data as Record<string, unknown>;
    expect(data.source).toBe("help");
    expect((data.sourceHistory as unknown[])).toHaveLength(1);
  });
});
