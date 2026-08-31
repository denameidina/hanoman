import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import { customAgentId } from "@hanoman/shared";
import { agentDefsFor } from "../src/services/custom-agents";
import { seedBuiltinAgents } from "../src/services/builtin-agents";

const app = buildApp({ requireAuth: false });
const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => {
  await clean();
  await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
});
afterAll(clean);

const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/custom-agents", payload });

// SPEC-405 · kelas bug yang tak boleh terulang: prefix dipetakan ke izin BACA tanpa melihat method.
describe("capabilityForRoute · agents (ADR-0094 keputusan 8)", () => {
  it("dipetakan MENURUT METHOD", () => {
    expect(capabilityForRoute("GET", "/api/custom-agents")).toBe("agents:read");
    expect(capabilityForRoute("POST", "/api/custom-agents")).toBe("agents:write");
    expect(capabilityForRoute("PATCH", "/api/custom-agents/global:agn-a")).toBe("agents:write");
    expect(capabilityForRoute("DELETE", "/api/custom-agents/global:agn-a")).toBe("agents:write");
  });
});

describe("POST /api/custom-agents", () => {
  it("membuat agen global dengan id deterministik", async () => {
    const r = await post({ name: "rev", description: "tinjau", instructions: "kamu peninjau" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("global:rev");
    expect(r.json().projectId).toBeNull();
  });

  it("membuat agen project", async () => {
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
    expect(r.json().id).toBe("p1:rev");
  });

  it("menyimpan profil eksekusi lengkap", async () => {
    const r = await post({
      name: "profiled", description: "d", instructions: "i",
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 40, timeoutSeconds: 900,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      activation: "smart", effort: "high", workspacePolicy: "read-only",
      maxTurns: 40, timeoutSeconds: 900,
    });
  });

  it("menolak effort yang tidak didukung runtime/model", async () => {
    const invalidValue = await post({
      name: "bad-effort", description: "d", instructions: "i", effort: "turbo",
    });
    expect(invalidValue.statusCode).toBe(400);

    const invalidPair = await post({
      name: "luna-ultra", description: "d", instructions: "i",
      runtime: "codex", model: "gpt-5.6-luna", effort: "ultra",
    });
    expect(invalidPair.statusCode).toBe(400);
    expect(invalidPair.json()).toMatchObject({ effort: "ultra", runtime: "codex" });
  });

  it("menolak 400 untuk nama yang bukan slug", async () => {
    expect((await post({ name: "Rev", description: "d", instructions: "i" })).statusCode).toBe(400);
  });

  it("menolak 400 untuk projectId yang tak ada", async () => {
    const r = await post({ projectId: "hantu", name: "agn-a", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(400);
  });

  it("menolak 409 untuk nama yang sudah dipakai di scope yang sama", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ name: "rev", description: "d2", instructions: "i2" });
    expect(r.statusCode).toBe(409);
  });

  it("nama yang sama di scope BERBEDA diterima", async () => {
    await post({ name: "rev", description: "d", instructions: "i" });
    const r = await post({ projectId: "p1", name: "rev", description: "d", instructions: "i" });
    expect(r.statusCode).toBe(201);
  });

  it("menolak 400 untuk mention ke nama yang tak terlihat", async () => {
    const r = await post({ name: "agn-a", description: "d", instructions: "i", mentions: ["hantu"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().unknown).toEqual(["hantu"]);
  });

  it("menolak 409 saat mention menutup SIKLUS, dan menyebut jalurnya", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    await post({ name: "agn-b", description: "d", instructions: "i", mentions: ["agn-a"] });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a", payload: { mentions: ["agn-b"] },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().cycle).toEqual(["agn-a", "agn-b", "agn-a"]);
    expect(r.json().scope).toBe("global");
  });

  it("menolak 409 untuk siklus yang HANYA muncul karena project menimpa global", async () => {
    // Urutan mengikat: rujukan divalidasi di boundary, jadi yang DITUJU harus lahir lebih dulu
    // (cermin `dependsOn`, ADR-0093). Global agn-g -> agn-h asiklik; yang memecahkannya adalah
    // agen PROJECT bernama sama yang menunjuk balik.
    await post({ name: "agn-h", description: "d", instructions: "i" });
    await post({ name: "agn-g", description: "d", instructions: "i", mentions: ["agn-h"] });
    const r = await post({ projectId: "p1", name: "agn-h", description: "d", instructions: "i", mentions: ["agn-g"] });
    expect(r.statusCode).toBe(409);
    expect(r.json().scope).toBe("p1");
  });
});

describe("GET /api/custom-agents", () => {
  it("tanpa query mengembalikan agen global saja", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "agn-l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json().map((a: { name: string }) => a.name)).toEqual(["agn-g"]);
  });

  it("dengan projectId mengembalikan himpunan EFEKTIF, ditandai inherited", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i" });
    await post({ projectId: "p1", name: "agn-l", description: "d", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" });
    const rows = r.json() as { name: string; inherited: boolean }[];
    expect(rows.map((a) => a.name)).toEqual(["agn-g", "agn-l"]);
    expect(rows.find((a) => a.name === "agn-g")!.inherited).toBe(true);
    expect(rows.find((a) => a.name === "agn-l")!.inherited).toBe(false);
  });

  it("nama yang ditimpa project hanya muncul SEKALI — versi project yang menang", async () => {
    await post({ name: "rev", description: "GLOBAL", instructions: "i" });
    await post({ projectId: "p1", name: "rev", description: "PROJECT", instructions: "i" });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" });
    const rows = r.json() as { name: string; description: string; inherited: boolean }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("PROJECT");
    expect(rows[0]!.inherited).toBe(false);
  });

  it("agen yang dimatikan tetap terlihat di daftar (UI harus bisa menghidupkannya lagi)", async () => {
    await post({ name: "agn-g", description: "d", instructions: "i", enabled: false });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents" });
    expect(r.json()).toHaveLength(1);
    expect(r.json()[0].enabled).toBe(false);
  });

  it("menurunkan availability dan alasan terhadap runtime yang diminta", async () => {
    await post({
      name: "claude-only", description: "d", instructions: "i", runtime: "claude",
      workspacePolicy: "isolated-worktree",
    });
    const codex = await app.inject({
      method: "GET", url: "/api/custom-agents?runtime=codex",
    });
    expect(codex.statusCode).toBe(200);
    expect(codex.json()[0]).toMatchObject({
      available: false,
      availabilityReason: "hanya tersedia untuk runtime claude",
    });

    const claude = await app.inject({
      method: "GET", url: "/api/custom-agents?runtime=claude",
    });
    expect(claude.json()[0]).toMatchObject({ available: true });
    expect(claude.json()[0].availabilityReason).toBeUndefined();
  });

  it("menjelaskan isolated-worktree yang unavailable di Codex walau runtime diwarisi", async () => {
    await prisma.customAgent.create({ data: {
      id: "global:isolated", projectId: null, name: "isolated", description: "d", instructions: "i",
      runtime: null, workspacePolicy: "isolated-worktree",
    } });
    const r = await app.inject({ method: "GET", url: "/api/custom-agents?runtime=codex" });
    expect(r.json()[0]).toMatchObject({
      available: false,
      availabilityReason: "isolated-worktree belum tersedia untuk subagent Codex",
    });
  });

  it("menolak runtime query asing", async () => {
    expect((await app.inject({
      method: "GET", url: "/api/custom-agents?runtime=gemini",
    })).statusCode).toBe(400);
  });
});

describe("PATCH /api/custom-agents/:id", () => {
  it("menolak 400 saat mencoba mengubah nama (changefeed tak punya operasi hapus)", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a", payload: { name: "agn-b" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("mengubah instruksi & enabled", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a",
      payload: { instructions: "baru", enabled: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().instructions).toBe("baru");
    expect(r.json().enabled).toBe(false);
  });

  it("mengubah profil eksekusi dan mengembalikan nilai efektif", async () => {
    await post({ name: "agn-a", description: "d", instructions: "i" });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:agn-a",
      payload: {
        activation: "smart", effort: "medium", workspacePolicy: "read-only",
        maxTurns: 25, timeoutSeconds: 300,
      },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      activation: "smart", effort: "medium", workspacePolicy: "read-only",
      maxTurns: 25, timeoutSeconds: 300,
    });
  });

  it("menolak perubahan model yang membuat effort tersimpan tidak sah", async () => {
    await post({
      name: "sol-ultra", description: "d", instructions: "i",
      runtime: "codex", model: "gpt-5.6-sol", effort: "ultra",
    });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:sol-ultra",
      payload: { model: "gpt-5.6-luna" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ effort: "ultra", model: "gpt-5.6-luna" });
  });

  it("menolak isolated-worktree bila runtime efektifnya Codex", async () => {
    await post({
      name: "cdx-isolated", description: "d", instructions: "i", runtime: "codex",
    });
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:cdx-isolated",
      payload: { workspacePolicy: "isolated-worktree" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("404 untuk id yang tak ada", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:hantu", payload: { enabled: false },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("DELETE /api/custom-agents/:id", () => {
  it("menghapus agen DAN mencabut namanya dari mentions agen lain", async () => {
    await post({ name: "agn-b", description: "d", instructions: "i" });
    await post({ name: "agn-a", description: "d", instructions: "i", mentions: ["agn-b"] });
    const r = await app.inject({ method: "DELETE", url: "/api/custom-agents/global:agn-b" });
    expect(r.statusCode).toBe(204);
    const a = await prisma.customAgent.findUnique({ where: { id: customAgentId(null, "agn-a") } });
    expect(a?.mentions).toEqual([]);
  });

  it("404 untuk id yang tak ada", async () => {
    expect((await app.inject({ method: "DELETE", url: "/api/custom-agents/global:hantu" })).statusCode).toBe(404);
  });
});

// ADR-0094 keputusan 7 · setiap mutasi WAJIB me-refresh cache: tanpa itu sesi yang lahir
// sesudahnya memakai katalog basi, dan gejalanya senyap (agen lama tetap muncul).
describe("cache di-invalidasi tiap mutasi", () => {
  it("agen baru langsung terbaca sumber sinkron", async () => {
    await post({ name: "baru", description: "d", instructions: "i" });
    expect(agentDefsFor("p1", "claude").map((a) => a.name)).toContain("baru");
    await app.inject({ method: "DELETE", url: "/api/custom-agents/global:baru" });
    expect(agentDefsFor("p1", "claude").map((a) => a.name)).not.toContain("baru");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPEC-484 · ADR-0101 · katalog + validasi keras
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/custom-agents/catalog", () => {
  it("mengembalikan tools, models, dan runtimes", async () => {
    const r = await app.inject({ method: "GET", url: "/api/custom-agents/catalog" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.tools[0].id).toBe("*");
    expect(b.tools.map((t: { id: string }) => t.id)).toContain("Read");
    expect(b.models.map((m: { id: string }) => m.id)).toContain("claude-opus-5");
    expect(b.models.map((m: { id: string }) => m.id)).toContain("gpt-5.6-sol");
    expect(b.runtimes.map((x: { id: string }) => x.id)).toEqual(["claude", "codex"]);
  });

  it("dipetakan ke agents:read (baca, bukan tulis)", () => {
    expect(capabilityForRoute("GET", "/api/custom-agents/catalog")).toBe("agents:read");
  });
});

describe("validasi keras katalog (ADR-0101 keputusan 5)", () => {
  it("menolak 400 tool di luar katalog, menyebut nilainya", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", tools: ["Read", "read"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().unknownTools).toEqual(["read"]);
  });

  it("menerima tool bawaan", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", tools: ["Read", "Bash"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().tools).toEqual(["Read", "Bash"]);
  });

  it("menerima ['*'] sebagai satu-satunya entri", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", tools: ["*"] });
    expect(r.statusCode).toBe(201);
    expect(r.json().tools).toEqual(["*"]);
  });

  // GOTCHA ADR-0101 #3 · "semua tool DAN Read" tak punya makna berbeda dari "semua tool";
  // menerimanya berarti dua representasi untuk satu keadaan.
  it("menolak 400 '*' yang bercampur nama lain", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", tools: ["*", "Read"] });
    expect(r.statusCode).toBe(400);
  });

  it("menolak 400 model di luar katalog runtime-nya", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", runtime: "claude", model: "gpt-5.6-sol" });
    expect(r.statusCode).toBe(400);
    expect(r.json().model).toBe("gpt-5.6-sol");
  });

  it("menerima model codex untuk runtime codex", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", runtime: "codex", model: "gpt-5.6-sol" });
    expect(r.statusCode).toBe(201);
    expect(r.json().runtime).toBe("codex");
  });

  it("runtime null (warisi) menerima model kedua katalog", async () => {
    expect((await post({ name: "aa", description: "d", instructions: "i", model: "claude-opus-5" })).statusCode).toBe(201);
    expect((await post({ name: "bb", description: "d", instructions: "i", model: "gpt-5.6-sol" })).statusCode).toBe(201);
  });

  it("menolak 400 runtime di luar {claude,codex}", async () => {
    const r = await post({ name: "aa", description: "d", instructions: "i", runtime: "gemini" });
    expect(r.statusCode).toBe(400);
  });
});

describe("PATCH · validasi HANYA atas field yang ada di payload", () => {
  // ADR-0101 keputusan 5 klausa kedua: tanpa ini gerbang keras mengunci saklar aktif/nonaktif
  // SETIAP baris warisan yang nilainya tak lagi ada di katalog mesin ini.
  it("PATCH {enabled} pada baris ber-model asing tetap 200", async () => {
    const id = customAgentId(null, "lawas");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "lawas", description: "d", instructions: "i",
      tools: ["ToolYangSudahTiada"] as never, model: "model-yang-sudah-tiada", mentions: [] as never,
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { enabled: false } });
    expect(r.statusCode).toBe(200);
    expect(r.json().enabled).toBe(false);
  });

  // GOTCHA ADR-0101 #4 · runtime EFEKTIF = payload.runtime bila ada, selain itu nilai baris.
  it("PATCH {model} divalidasi terhadap runtime BARIS, bukan gabungan", async () => {
    const id = customAgentId(null, "cdx");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "cdx", description: "d", instructions: "i", mentions: [] as never,
      runtime: "codex",
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { model: "claude-opus-5" } });
    expect(r.statusCode).toBe(400);
  });

  it("PATCH {runtime} saja tetap memvalidasi model yang SUDAH tersimpan", async () => {
    const id = customAgentId(null, "sw");
    await prisma.customAgent.create({ data: {
      id, projectId: null, name: "sw", description: "d", instructions: "i", mentions: [] as never,
      model: "claude-opus-5",
    } });
    const r = await app.inject({ method: "PATCH", url: `/api/custom-agents/${id}`, payload: { runtime: "codex" } });
    expect(r.statusCode).toBe(400);
  });
});

// SPEC-881 · ADR-0136 · status "bawaan" DITURUNKAN di lapis response, bukan kolom. Kolom baru
// berarti kolom baru di changefeed sync, dan hub versi lama menolak SELURUH push yang membawanya.
describe("field turunan agen bawaan", () => {
  const list = async () =>
    (await app.inject({ method: "GET", url: "/api/custom-agents" }))
      .json() as Array<Record<string, unknown>>;

  it("menandai baris bawaan", async () => {
    await seedBuiltinAgents();
    const scout = (await list()).find((a) => a.name === "scout")!;
    expect(scout.builtin).toBe(true);
    expect(scout.builtinEdited).toBe(false);
  });

  it("menandai baris bawaan yang sudah disunting", async () => {
    await seedBuiltinAgents();
    await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:scout",
      payload: { instructions: "punya operator" },
    });
    const scout = (await list()).find((a) => a.name === "scout")!;
    expect(scout.builtin).toBe(true);
    expect(scout.builtinEdited).toBe(true);
  });

  it("baris buatan operator tidak ditandai bawaan", async () => {
    await post({ name: "punyaku", description: "d", instructions: "i" });
    const mine = (await list()).find((a) => a.name === "punyaku")!;
    expect(mine.builtin).toBe(false);
    expect(mine.builtinEdited).toBe(false);
  });

  // Nama bawaan yang dipakai sebagai agen PROJECT adalah baris milik operator, bukan bawaan —
  // bawaan selalu global (ADR-0094: project menimpa global).
  it("agen project bernama sama tidak ditandai bawaan", async () => {
    await post({ projectId: "p1", name: "scout", description: "d", instructions: "i" });
    const list1 = (await app.inject({ method: "GET", url: "/api/custom-agents?projectId=p1" }))
      .json() as Array<Record<string, unknown>>;
    const proj = list1.find((a) => a.projectId === "p1")!;
    expect(proj.builtin).toBe(false);
  });
});
