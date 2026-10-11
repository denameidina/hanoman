import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { enqueue, markFailed, markCanceled, queueItemForSpec } from "../src/services/scheduler/queue";
import { issueAgentToken } from "../src/services/agent-token";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

// ADR-0204 · requeue lewat agent token, DIUJI SAMPAI KE ROUTE. Baris `failed` dijalankan ulang
// sebagai sesi agen (governor), jadi `settings:write` sendirian tak cukup untuk membangkitkannya —
// sama dengan cron (ADR-0191). Baris `canceled` tak dijaga: checker backlog akan mengantrekan ulang
// spec-nya sendiri, jadi tak ada kewenangan baru di sana. Penegakannya di handler, bukan peta
// capability (peta tak melihat status baris).
const cleanEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined };
const app = buildApp({ env: cleanEnv });

// Akses agen dinyalakan lewat Setting (agentAccessEnabled), sama seperti scheduler-cron-gate.test.ts.
const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
  scheduler: { ...SCHEDULER_DEFAULTS, enabled: true },
};
async function tokenWith(capabilities: string[]) {
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  const { token } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { authorization: `Bearer ${token}` };
}

const clean = async () => {
  await prisma.schedulerQueueItem.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(clean);
afterAll(clean);

describe("requeue baris failed: butuh sessions:spawn juga", () => {
  it("settings:write saja ditolak 403 (need sessions:spawn) dan barisnya tetap failed", async () => {
    await enqueue({ specId: "SPEC-g1", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-g1"))!;
    await markFailed(row.id, "sesi berakhir");
    const headers = await tokenWith(["settings:read", "settings:write"]);
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue`, headers });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "sessions:spawn", reason: "requeue-executes" });
    expect((await queueItemForSpec("SPEC-g1"))!.status).toBe("failed");
  });

  it("settings:write + sessions:spawn boleh mengembalikan baris failed ke antrean", async () => {
    await enqueue({ specId: "SPEC-g2", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-g2"))!;
    await markFailed(row.id, "sesi berakhir");
    const headers = await tokenWith(["settings:write", "sessions:spawn"]);
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("queued");
  });

  it("baris canceled tak dijaga: settings:write saja cukup", async () => {
    await enqueue({ specId: "SPEC-g3", projectId: "p1", source: "backlog", priority: "sedang" });
    const row = (await queueItemForSpec("SPEC-g3"))!;
    await markCanceled(row.id, "dibatalkan operator");
    const headers = await tokenWith(["settings:write"]);
    const r = await app.inject({ method: "POST", url: `/api/scheduler/queue/${row.id}/requeue`, headers });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("queued");
  });
});
