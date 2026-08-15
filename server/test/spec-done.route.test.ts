import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildApp } from "../src/app";
import { listSessions } from "../src/services/pty";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { resetDb, makeProject, makeSpec } from "./factory";

// Overlay stage-live & daftar sesi membaca tmux nyata; di test tak ada pane. Mock keduanya —
// `listSessions` adalah gerbang "ada sesi hidup untuk item ini", dan itu yang diuji di sini.
vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, sessionPhasesBySpec: vi.fn(() => new Map()), listSessions: vi.fn(() => []) };
});

const app = buildApp({ requireAuth: false });
const post = (id: string, body: unknown = {}) =>
  app.inject({ method: "POST", url: `/api/specs/${id}/done`, payload: body as object });

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  vi.mocked(listSessions).mockReturnValue([]);
});

describe("SPEC-804 · ADR-0120 · POST /specs/:id/done", () => {
  it("menandai selesai + menyimpan jejak, dan item hilang dari filter startable", async () => {
    await makeSpec({ id: "SPEC-810", projectId: "p1", stage: "planned", title: "judul" });
    const r = await post("SPEC-810", { reason: "sudah tercakup SPEC-799" });
    expect(r.statusCode).toBe(200);
    expect(r.json().stage).toBe("done");
    expect(r.json().manualDone).toMatchObject({ by: "system", reason: "sudah tercakup SPEC-799" });

    const list = await app.inject({ method: "GET", url: "/api/specs?project=p1&startable=true" });
    expect(list.json().items.map((s: { id: string }) => s.id)).not.toContain("SPEC-810");
  });

  it("body kosong sah — alasan opsional", async () => {
    await makeSpec({ id: "SPEC-811", projectId: "p1", stage: "brainstorming" });
    const r = await post("SPEC-811");
    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json().manualDone).sort()).toEqual(["at", "by"]);
  });

  it("alasan > 280 karakter ditolak 400", async () => {
    await makeSpec({ id: "SPEC-812", projectId: "p1", stage: "planned" });
    const r = await post("SPEC-812", { reason: "x".repeat(281) });
    expect(r.statusCode).toBe(400);
  });

  it("spec tak ada → 404", async () => {
    expect((await post("SPEC-NIHIL")).statusCode).toBe(404);
  });

  it("item yang sudah done → 409, dan jejaknya tak ditulis di atas penyelesaian lama", async () => {
    await makeSpec({ id: "SPEC-813", projectId: "p1", stage: "done" });
    const r = await post("SPEC-813");
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain("sudah selesai");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-813" } }))!.manualDone).toBeNull();
  });

  it("sesi hidup untuk item ini menuntut konfirmasi eksplisit lebih dulu", async () => {
    await makeSpec({ id: "SPEC-814", projectId: "p1", stage: "executing" });
    vi.mocked(listSessions).mockReturnValue([
      { id: "spec-814", projectId: "p1", specId: "SPEC-814", cwd: "/tmp/wt", exited: false, agent: "claude" },
    ] as unknown as ReturnType<typeof listSessions>);

    const first = await post("SPEC-814");
    expect(first.statusCode).toBe(409);
    expect(first.json().error).toBe("confirm-required");
    expect(first.json().session.id).toBe("spec-814");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-814" } }))!.stage).toBe("executing");

    const second = await post("SPEC-814", { confirm: true });
    expect(second.statusCode).toBe(200);
    expect(second.json().stage).toBe("done");
  });

  it("pane MATI untuk item ini bukan sesi hidup — tak menuntut konfirmasi", async () => {
    await makeSpec({ id: "SPEC-815", projectId: "p1", stage: "executing" });
    vi.mocked(listSessions).mockReturnValue([
      { id: "spec-815", projectId: "p1", specId: "SPEC-815", cwd: "/tmp/wt", exited: true, agent: "claude" },
    ] as unknown as ReturnType<typeof listSessions>);
    expect((await post("SPEC-815")).statusCode).toBe(200);
  });

  it("capability-nya backlog:write, bukan cookie-only", () => {
    expect(capabilityForRoute("POST", "/api/specs/SPEC-810/done")).toBe("backlog:write");
  });
});
