import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { SYNCED, snapshot, applyPush, __FIELDS } from "../src/services/sync";
import { PG_ORDER } from "../../cli/src/commands/migrate-pg";
import { customAgentId } from "@hanoman/shared";

// SPEC-450 · ADR-0094 gotcha 7 · entitas baru WAJIB ikut PG_ORDER dan seluruh kolomnya wajib ada
// di FIELDS: `upsert` yang tak menyebut kolom ber-default TETAP BERHASIL, jadi kolom yang terlewat
// menyeberang sebagai default palsu tanpa satu pun error (kelas ADR-0090/0093).

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean);
afterAll(clean);

describe("wiring sync entitas customAgent", () => {
  it("customAgent ada di SYNCED", () => {
    expect(SYNCED as readonly string[]).toContain("customAgent");
  });

  it("CustomAgent ada di PG_ORDER", () => {
    expect(PG_ORDER as readonly string[]).toContain("CustomAgent");
  });

  it("snapshot membawa SELURUH kolom yang punya arti", async () => {
    await prisma.project.create({ data: { id: "demo", name: "D", desc: "", kind: "web" } });
    const id = customAgentId("demo", "rev");
    await prisma.customAgent.create({ data: {
      id, projectId: "demo", name: "rev", description: "d", instructions: "i",
      tools: ["Read"], model: "haiku", mentions: ["lain"], enabled: false,
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 40, timeoutSeconds: 900,
    } });
    const snap = await snapshot("customAgent", id);
    expect(snap).not.toBeNull();
    expect(Object.keys(snap!.data).sort()).toEqual([
      "activation", "createdAt", "description", "effort", "enabled", "instructions",
      "maxTurns", "mentions", "model", "name", "projectId", "runtime", "timeoutSeconds",
      "tools", "updatedAt", "workspacePolicy",
    ]);
    expect(snap!.data.mentions).toEqual(["lain"]);
    expect(snap!.data.enabled).toBe(false);
  });

  it("applyPush menulis baris asal-hub tanpa kehilangan enabled/mentions", async () => {
    const id = customAgentId(null, "glob");
    const r = await applyPush("customAgent", id, 0, {
      projectId: null, name: "glob", description: "d", instructions: "i",
      tools: null, model: null, mentions: ["x"], enabled: false, activation: "smart",
      effort: "medium", workspacePolicy: "read-only", maxTurns: 25, timeoutSeconds: 300,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const row = await prisma.customAgent.findUnique({ where: { id } });
    expect(row?.enabled).toBe(false);
    expect(row?.mentions).toEqual(["x"]);
    expect(row).toMatchObject({
      activation: "smart", effort: "medium", workspacePolicy: "read-only",
      maxTurns: 25, timeoutSeconds: 300,
    });
    expect(row?.createdAt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("menghapus project menghapus agen project-nya (cascade)", async () => {
    await prisma.project.create({ data: { id: "demo", name: "D", desc: "", kind: "web" } });
    await prisma.customAgent.create({ data: {
      id: customAgentId("demo", "a"), projectId: "demo", name: "a", description: "d", instructions: "i",
    } });
    await prisma.project.delete({ where: { id: "demo" } });
    expect(await prisma.customAgent.count()).toBe(0);
  });

  // SPEC-484 · GOTCHA ADR-0101 #1 / ADR-0094 gotcha 7 · kolom yang terlewat di FIELDS menyeberang
  // sebagai DEFAULT PALSU tanpa satu pun error — `upsert` yang tak menyebut kolom nullable tetap
  // berhasil, jadi agen ber-runtime `codex` akan mendarat sebagai "warisi" di setiap mesin lain.
  it("runtime ikut FIELDS.customAgent dan menyeberang lewat applyPush", async () => {
    expect(__FIELDS.customAgent).toContain("runtime");
    const id = customAgentId(null, "rt");
    const r = await applyPush("customAgent", id, 0, {
      projectId: null, name: "rt", description: "d", instructions: "i",
      tools: null, model: null, mentions: [], runtime: "codex", enabled: true,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const row = await prisma.customAgent.findUnique({ where: { id } });
    expect(row?.runtime).toBe("codex");
  });
});
