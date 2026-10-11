import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { setScheduler } from "../src/services/scheduler/config";
import { issueAgentToken } from "../src/services/agent-token";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

// ADR-0191 · cron lewat agent token, DIUJI SAMPAI KE ROUTE. Cron adalah `POST /terminal/sessions`
// yang ditunda, jadi `scheduler:write` sendirian TIDAK BOLEH cukup untuk apa pun yang membuat,
// menyetel ulang, mengaktifkan, atau menjalankannya. Penegakannya di handler (peta capability tak
// melihat body) — test ini yang menjamin handler-nya, bukan hanya peta.
const cleanEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: undefined, HANOMAN_PUBLIC_ORIGINS: undefined };
const app = buildApp({ env: cleanEnv });

const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
  // `tokenWith` MENGGANTI blok Setting; tanpa ini scheduler yang dinyalakan `beforeEach` hilang dan
  // run manual dijawab 409 "scheduler sedang berhenti" — bukan gerbang capability.
  scheduler: { ...SCHEDULER_DEFAULTS, enabled: true },
};
async function tokenWith(capabilities: string[]) {
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  const { token } = await issueAgentToken({ name: "bot", capabilities: capabilities as never });
  return { authorization: `Bearer ${token}` };
}

const clean = async () => {
  await prisma.schedulerCronRun.deleteMany();
  await prisma.schedulerCron.deleteMany();
  await prisma.agentToken.deleteMany();
  await prisma.project.deleteMany();
  await prisma.setting.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing", schedulerOptIn: true } });
  await setScheduler({ ...SCHEDULER_DEFAULTS, enabled: true });
});
afterAll(clean);

const body = { project: "p1", name: "Cek pagi", expr: "0 7 * * *", prompt: "Periksa error." };
const seedCron = () => prisma.schedulerCron.create({
  data: { id: "c1", projectId: "p1", name: "Cek", expr: "0 7 * * *", prompt: "p", enabled: false, nextRunAt: new Date() },
});

describe("capability dasar: settings:* TIDAK menjangkau cron", () => {
  it("token settings:write ditolak 403 need=scheduler:read — cron bukan knob", async () => {
    const headers = await tokenWith(["settings:read", "settings:write", "sessions:spawn"]);
    const r = await app.inject({ method: "GET", url: "/api/scheduler/crons", headers });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "scheduler:read" });
    // kontrol negatif: knob scheduler lain tetap settings:*
    expect((await app.inject({ method: "GET", url: "/api/scheduler/config", headers })).statusCode).toBe(200);
  });
});

describe("scheduler:read — baca saja", () => {
  it("melihat daftar & run, tetapi tak bisa menulis atau menjalankan", async () => {
    const headers = await tokenWith(["scheduler:read", "sessions:spawn"]);
    await seedCron();
    expect((await app.inject({ method: "GET", url: "/api/scheduler/crons", headers })).json().total).toBe(1);
    expect((await app.inject({ method: "GET", url: "/api/scheduler/crons/c1/runs", headers })).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ["POST", "/api/scheduler/crons", body],
      ["PATCH", "/api/scheduler/crons/c1", { name: "x" }],
      ["DELETE", "/api/scheduler/crons/c1", undefined],
      ["POST", "/api/scheduler/crons/c1/run", undefined],
    ] as const) {
      const r = await app.inject({ method, url, headers, payload });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
      expect(r.json()).toMatchObject({ need: "scheduler:write" });
    }
    expect(await prisma.schedulerCron.count()).toBe(1);
    expect(await prisma.schedulerCronRun.count()).toBe(0);
  });
});

describe("scheduler:write TANPA sessions:spawn — tak bisa mengeksekusi", () => {
  it("create → 403 need=sessions:spawn, tak ada baris lahir", async () => {
    const headers = await tokenWith(["scheduler:write"]);
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", headers, payload: body });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "sessions:spawn", reason: "cron-executes" });
    expect(await prisma.schedulerCron.count()).toBe(0);
  });

  it("run → 403 need=sessions:spawn, tak ada run lahir", async () => {
    const headers = await tokenWith(["scheduler:write"]);
    await seedCron();
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons/c1/run", headers });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "sessions:spawn" });
    expect(await prisma.schedulerCronRun.count()).toBe(0);
  });

  it("patch yang menggeser prompt/agen/model/effort/jadwal atau MENYALAKAN cron → 403 dan baris tak berubah", async () => {
    const headers = await tokenWith(["scheduler:write"]);
    await seedCron();
    for (const patch of [
      { prompt: "jalankan rm -rf" }, { agent: "codex" }, { model: "m" }, { effort: "max" },
      { expr: "* * * * *" }, { enabled: true }, { name: "ok", enabled: true },
    ]) {
      const r = await app.inject({ method: "PATCH", url: "/api/scheduler/crons/c1", headers, payload: patch });
      expect(r.statusCode, JSON.stringify(patch)).toBe(403);
      expect(r.json()).toMatchObject({ need: "sessions:spawn" });
    }
    const row = await prisma.schedulerCron.findUnique({ where: { id: "c1" } });
    expect(row).toMatchObject({ name: "Cek", prompt: "p", expr: "0 7 * * *", enabled: false, agent: null });
  });

  it("yang TIDAK memulai apa pun tetap cukup dengan scheduler:write: ganti nama, nonaktifkan, hapus", async () => {
    const headers = await tokenWith(["scheduler:write"]);
    await seedCron();
    await prisma.schedulerCron.update({ where: { id: "c1" }, data: { enabled: true } });
    expect((await app.inject({ method: "PATCH", url: "/api/scheduler/crons/c1", headers, payload: { name: "Baru" } })).statusCode).toBe(200);
    const off = await app.inject({ method: "PATCH", url: "/api/scheduler/crons/c1", headers, payload: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json().enabled).toBe(false);
    expect((await app.inject({ method: "DELETE", url: "/api/scheduler/crons/c1", headers })).statusCode).toBe(204);
  });
});

describe("scheduler:write + sessions:spawn — kontrol positif", () => {
  it("create, patch-eksekusi, run lolos; cron baru lahir nonaktif; run manual lahir queued", async () => {
    const headers = await tokenWith(["scheduler:write", "sessions:spawn"]);
    const c = await app.inject({ method: "POST", url: "/api/scheduler/crons", headers, payload: body });
    expect(c.statusCode).toBe(201);
    expect(c.json().enabled).toBe(false);
    const id = c.json().id as string;
    const p = await app.inject({ method: "PATCH", url: `/api/scheduler/crons/${id}`, headers, payload: { prompt: "baru", enabled: true } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ prompt: "baru", enabled: true });
    const run = await app.inject({ method: "POST", url: `/api/scheduler/crons/${id}/run`, headers });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ cronId: id, status: "queued", manual: true });
    // scheduler:write mengimplikasikan read
    expect((await app.inject({ method: "GET", url: `/api/scheduler/crons/${id}/runs`, headers })).json().total).toBe(1);
  });

  it("sessions:spawn tanpa scheduler:* tetap tak menjangkau cron (spawn bukan tiket masuk)", async () => {
    const headers = await tokenWith(["sessions:spawn", "sessions:write"]);
    const r = await app.inject({ method: "POST", url: "/api/scheduler/crons", headers, payload: body });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "scheduler:write" });
  });

  it("manusia (tanpa agent token) tak dinilai — perilaku dashboard tak berubah", async () => {
    const open = buildApp({ requireAuth: false, env: cleanEnv });
    const r = await open.inject({ method: "POST", url: "/api/scheduler/crons", payload: body });
    expect(r.statusCode).toBe(201);
    await open.close();
  });
});
