import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "../src/db";
import { sessionPhasesBySpec } from "../src/services/pty";
import { liveSpecs } from "../src/services/live-specs";
import { completeSpecManually } from "../src/services/spec-complete";
import { resetDb, makeProject, makeSpec } from "./factory";

vi.mock("../src/services/pty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/pty")>();
  return { ...actual, sessionPhasesBySpec: vi.fn(() => new Map()) };
});

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
});

describe("SPEC-804 · penandaan manual tak ditimpa overlay stage-live", () => {
  // Batasan spec: "jangan sekadar menulis kolom DB yang lalu ditimpa penurunan stage". Overlay
  // `liveSpecs` forward-only dan `done` stage terakhir — tapi itu bergantung pada satu
  // perbandingan indeks di berkas lain, jadi ia dikunci di sini, bukan diasumsikan.
  it("sesi yang masih melaporkan Execute tak menyeret item kembali dari done", async () => {
    await makeSpec({ id: "SPEC-820", projectId: "p1", stage: "executing", title: "judul" });
    await completeSpecManually((await prisma.spec.findUnique({ where: { id: "SPEC-820" } }))!, { by: "dena@x" });
    vi.mocked(sessionPhasesBySpec).mockReturnValue(new Map([["SPEC-820", {
      phases: [
        { name: "Brainstorm", state: "done" as const }, { name: "Objective", state: "done" as const },
        { name: "Spec", state: "done" as const }, { name: "Plan", state: "done" as const },
        { name: "Execute", state: "active" as const },
      ],
      cwd: "/tmp/tidak-ada-worktree",
    }]]));

    const out = await liveSpecs({ project: "p1" });
    expect(out.find((s) => s.id === "SPEC-820")!.stage).toBe("done");
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-820" } }))!.stage).toBe("done");
  });
});
