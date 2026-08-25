import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueAgentToken } from "../src/services/agent-token";

// ADR-0155 · gerbang KEDUA, sadar-body: `PATCH /specs/:id {stage}` menuntut `backlog:lifecycle`.
// Ia hidup di handler, BUKAN di `capabilityForRoute`, karena fungsi itu sengaja tetap murni
// (method, path) — kemurnian itulah yang membuat uji kontrak katalog MCP mungkin. Konsekuensinya:
// gerbang ini tak terlihat uji kontrak mana pun, jadi berkas inilah satu-satunya yang menjaganya.
const app = buildApp();
const clean = async () => {
  await prisma.spec.deleteMany(); await prisma.project.deleteMany();
  await prisma.agentToken.deleteMany(); await prisma.setting.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const blob = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short",
  notifyDecision: true, notifyDecisionSound: "alert", agentAccessEnabled: true,
};

async function seed() {
  await prisma.setting.upsert({ where: { id: 1 }, update: { data: blob }, create: { id: 1, data: blob } });
  await prisma.project.create({
    data: { id: "proj", name: "proj", desc: "uji", kind: "app", repoDir: "/tmp/proj" },
  });
  await prisma.spec.create({
    data: {
      id: "SPEC-1", projectId: "proj", title: "judul", source: "feature",
      stage: "planned", priority: "P2", author: "test", objective: "tujuan",
    },
  });
}
const bearer = async (caps: string[]) =>
  ({ authorization: `Bearer ${(await issueAgentToken({ name: "bot", capabilities: caps })).token}` });

describe("PATCH /specs/:id — {stage} menuntut backlog:lifecycle", () => {
  it("backlog:write TANPA lifecycle → 403 yang menyebut capability-nya", async () => {
    await seed();
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: await bearer(["backlog:write"]), payload: { stage: "objective" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "backlog:lifecycle" });
    // Gerbang harus mendahului efek samping: stage TIDAK boleh bergeser.
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.stage).toBe("planned");
  });

  it("token yang SAMA tetap boleh menyunting field non-stage", async () => {
    await seed();
    // konten hanya bisa diedit selagi masih brainstorming & belum dimulai (SPEC-186)
    await prisma.spec.update({ where: { id: "SPEC-1" }, data: { stage: "brainstorming" } });
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: await bearer(["backlog:write"]), payload: { title: "judul baru" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("backlog:lifecycle → stage bergeser", async () => {
    await seed();
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: await bearer(["backlog:write", "backlog:lifecycle"]), payload: { stage: "objective" },
    });
    expect(r.statusCode).toBe(200);
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.stage).toBe("objective");
  });

  it("lifecycle SENDIRIAN tak cukup — ia tak mengimplikasikan backlog:write/read", async () => {
    await seed();
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: await bearer(["backlog:lifecycle"]), payload: { stage: "objective" },
    });
    // Ditolak gate umum di app.ts, sebelum handler: route menuntut backlog:write.
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "backlog:write" });
  });

  it("sesi cookie tak tersentuh gerbang ini — ia hanya berlaku bagi agent token", async () => {
    await seed();
    const setup = await app.inject({
      method: "POST", url: "/api/auth/setup",
      payload: { email: "a@x.id", password: "rahasia-panjang-sekali" },
    });
    const cookie = String(setup.headers["set-cookie"]).split(";")[0];
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1", headers: { cookie }, payload: { stage: "objective" },
    });
    expect(r.statusCode).toBe(200);
  });
});
