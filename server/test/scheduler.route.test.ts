import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueue, queueItemForSpec, markLaunched } from "../src/services/scheduler/queue";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.schedulerQueueItem.deleteMany(); await prisma.setting.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("scheduler routes", () => {
  it("GET /config returns all-off defaults", async () => {
    const r = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
    expect(r.json().sources.backlog.enabled).toBe(false);
    expect(r.json().sources.triase.everyMin).toBe(30);
    // SPEC-384 · source `errors` dicabut (ADR-0092) — blok setelannya tak boleh lahir kembali.
    expect(r.json().sources.errors).toBeUndefined();
  });
  it("PUT /config sets knobs incl. pause, GET reflects them", async () => {
    const body = { enabled: true, paused: true, maxConcurrent: 4, autonomy: "full-control",
      sources: { backlog: { enabled: true, everyMin: 5 }, triase: { enabled: false, everyMin: 30 } } };
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: body });
    expect(r.statusCode).toBe(200);
    const g = await app.inject({ method: "GET", url: "/api/scheduler/config" });
    expect(g.json().paused).toBe(true);
    expect(g.json().maxConcurrent).toBe(4);
    expect(g.json().sources.backlog.everyMin).toBe(5);
  });
  it("PUT /config rejects invalid body (maxConcurrent 0)", async () => {
    const r = await app.inject({ method: "PUT", url: "/api/scheduler/config", payload: { maxConcurrent: 0 } });
    expect(r.statusCode).toBe(400);
  });
  it("GET /state exposes cap, queue contents, and per-source next/last-run shape", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    const r = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.cap).toBe(2);
    expect(b.queue.length).toBe(1);
    expect(b.queue[0].specId).toBe("SPEC-1");
    expect(b.sources.map((s: any) => s.id).sort()).toEqual(["backlog", "triase"]);
  });

  // SPEC-522 · endpoint pembatalan. Ia satu-satunya jalan keluar dari antrean yang tak menyentuh
  // rem global (Pause/Stop menghentikan SELURUH antrean demi satu baris).
  it("POST /queue/:id/cancel menutup baris queued dan mencatat alasannya", async () => {
    await enqueue({ specId: "SPEC-r1", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r1"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("canceled");
    expect(r.json().note).toBe("dibatalkan operator");
    // dan ia hilang dari antrean yang dibaca panel
    const s = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(s.json().queue.filter((q: any) => q.status === "queued").length).toBe(0);
    expect(s.json().queue.filter((q: any) => q.status === "canceled").length).toBe(1);
  });

  it("POST /queue/:id/cancel menyertakan reason ke dalam note", async () => {
    await enqueue({ specId: "SPEC-r2", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r2"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel`,
      payload: { reason: "salah project" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toBe("dibatalkan operator: salah project");
  });

  // Kendala spec: item yang sudah punya sesi aktif tak boleh dibunuh diam-diam. Penolakannya
  // harus MENJELASKAN — "409" telanjang tak bisa ditindaklanjuti operator.
  it("POST /queue/:id/cancel menolak baris launched dengan 409 + status saat ini", async () => {
    await enqueue({ specId: "SPEC-r3", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-r3"))!;
    await markLaunched(row.id, "spec_r3");
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    expect(r.statusCode).toBe(409);
    expect(r.json().status).toBe("launched");
    expect(r.json().error).toMatch(/Terminal/);
    expect((await queueItemForSpec("SPEC-r3"))!.status).toBe("launched");
  });

  it("POST /queue/:id/cancel atas id tak dikenal → 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/scheduler/queue/tak-ada/cancel" });
    expect(r.statusCode).toBe(404);
  });

  it("POST /queue/:id/requeue mengembalikan baris canceled ke antrean", async () => {
    await enqueue({ specId: "SPEC-r4", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-r4"))!;
    await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel` });
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue` });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("queued");
    expect(r.json().note).toBeNull();
    // requeue kedua ditolak — barisnya sudah di antrean
    const again = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue` });
    expect(again.statusCode).toBe(409);
    expect(again.json().status).toBe("queued");
  });

  it("POST /queue/:id/cancel menolak reason kelewat panjang", async () => {
    await enqueue({ specId: "SPEC-r5", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-r5"))!;
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/cancel`,
      payload: { reason: "x".repeat(201) } });
    expect(r.statusCode).toBe(400);
    expect((await queueItemForSpec("SPEC-r5"))!.status).toBe("queued");
  });
});
