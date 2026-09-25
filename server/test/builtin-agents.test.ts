import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/db";
import {
  QA_SAFETY_POLICY, seedBuiltinAgents, builtinFingerprint, legacyBuiltinFingerprint,
  BUILTIN_FINGERPRINT_HISTORY, rowFingerprint,
} from "../src/services/builtin-agents";
import { getSetting } from "../src/services/settings";
import { writeTombstone } from "../src/services/tombstone";
import { installCustomAgents, agentDefsFor, loadCustomAgents } from "../src/services/custom-agents";
import { BUILTIN_AGENTS, customAgentId } from "@hanoman/shared";

// SPEC-881 · ADR-0136 · seed katalog agen bawaan. Yang diuji di sini bukan "barisnya lahir" —
// itu bagian yang mudah — melainkan tiga janji yang membuat pendekatan seed bisa hidup melewati
// upgrade: penghapusan operator BERTAHAN, suntingan operator TAK PERNAH ditimpa, dan saklar
// enabled tetap miliknya.

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.syncTombstone.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const idOf = (name: string) => customAgentId(null, name);
const scout = BUILTIN_AGENTS.find((a) => a.name === "scout")!;

describe("seedBuiltinAgents — kelahiran", () => {
  it("melahirkan seluruh katalog sebagai baris global", async () => {
    await seedBuiltinAgents();
    const rows = await prisma.customAgent.findMany();
    expect(rows).toHaveLength(BUILTIN_AGENTS.length);
    for (const r of rows) {
      expect(r.projectId).toBeNull();
      expect(r.id).toBe(idOf(r.name));
      expect(r.mentions).toEqual([]);
      expect(r.model).toBeNull();
      expect(r.runtime).toBeNull();
      const builtin = BUILTIN_AGENTS.find((a) => a.name === r.name)!;
      expect((r as unknown as Record<string, unknown>).activation).toBe(builtin.activation);
      expect((r as unknown as Record<string, unknown>).effort).toBe(builtin.effort);
      expect((r as unknown as Record<string, unknown>).workspacePolicy).toBe(builtin.workspacePolicy);
      expect((r as unknown as Record<string, unknown>).maxTurns).toBe(builtin.maxTurns);
      expect((r as unknown as Record<string, unknown>).timeoutSeconds).toBe(builtin.timeoutSeconds);
    }
  });

  it("menghormati enabledByDefault", async () => {
    await seedBuiltinAgents();
    for (const a of BUILTIN_AGENTS) {
      const row = await prisma.customAgent.findUnique({ where: { id: idOf(a.name) } });
      expect(row!.enabled).toBe(a.enabledByDefault);
    }
  });

  it("mencatat sidik jari tiap agen di Setting", async () => {
    await seedBuiltinAgents();
    const s = await getSetting();
    for (const a of BUILTIN_AGENTS) {
      expect(s.builtinAgents[a.name]).toBe(builtinFingerprint(a));
    }
  });
});

describe("seedBuiltinAgents — idempoten", () => {
  it("boot kedua tak menggerakkan updatedAt maupun version", async () => {
    await seedBuiltinAgents();
    const before = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    await seedBuiltinAgents();
    const after = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(after!.updatedAt.getTime()).toBe(before!.updatedAt.getTime());
    expect(after!.version).toBe(before!.version);
  });
});

describe("seedBuiltinAgents — penghapusan bertahan", () => {
  it("baris bertombstone tidak dibangkitkan", async () => {
    await seedBuiltinAgents();
    await prisma.customAgent.delete({ where: { id: idOf("scout") } });
    await writeTombstone("customAgent", idOf("scout"), 99, {});
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf("scout") } })).toBeNull();
  });

  it("agen lain tetap lahir walau satu bertombstone", async () => {
    await writeTombstone("customAgent", idOf("scout"), 1, {});
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf("qa-verifier") } })).not.toBeNull();
  });
});

describe("seedBuiltinAgents — upgrade", () => {
  /** Tulis stempel sidik jari satu agen — cara mensimulasikan "seed versi lain pernah jalan". */
  const stempel = async (name: string, fp: string) => {
    const s = await getSetting();
    const data = { ...s, builtinAgents: { ...s.builtinAgents, [name]: fp } };
    await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  it("upgrade delapan lama melahirkan delapan baru sekali tanpa menimpa edit, saklar, atau tombstone", async () => {
    const oldNames = ["scout", "root-causer", "qa-verifier", "edge-case-hunter",
      "blast-radius", "spec-auditor", "security-reviewer", "dep-auditor"];
    const old = BUILTIN_AGENTS.filter((a) => oldNames.includes(a.name));
    for (const a of old) {
      await prisma.customAgent.create({ data: {
        id: idOf(a.name), projectId: null, name: a.name, description: a.description,
        instructions: a.instructions, tools: [...a.tools], model: null, mentions: [], runtime: null,
        activation: a.activation, effort: a.effort, workspacePolicy: a.workspacePolicy,
        maxTurns: a.maxTurns, timeoutSeconds: a.timeoutSeconds, enabled: a.enabledByDefault,
      } });
      await stempel(a.name, builtinFingerprint(a));
    }
    // The existing eight-agent release already applied this one-time QA policy.
    const setting = await getSetting();
    await prisma.setting.update({ where: { id: 1 }, data: { data: { ...setting,
      builtinAgentPolicies: { "qa-verifier": QA_SAFETY_POLICY } } } });
    await prisma.customAgent.update({ where: { id: idOf("scout") }, data: { instructions: "milik operator" } });
    await prisma.customAgent.update({ where: { id: idOf("blast-radius") }, data: { enabled: false } });
    await prisma.customAgent.delete({ where: { id: idOf("dep-auditor") } });
    await writeTombstone("customAgent", idOf("dep-auditor"), 99, {});
    const before = await prisma.customAgent.findMany({ orderBy: { name: "asc" } });

    await seedBuiltinAgents();
    const once = await prisma.customAgent.findMany({ orderBy: { name: "asc" } });
    const added = once.filter((a) => !oldNames.includes(a.name));
    expect(added).toHaveLength(BUILTIN_AGENTS.length - oldNames.length);
    expect(added.every((a) => !a.enabled && a.model === null && a.runtime === null)).toBe(true);
    expect(once.filter((a) => oldNames.includes(a.name))).toEqual(before);
    expect(await prisma.customAgent.findUnique({ where: { id: idOf("dep-auditor") } })).toBeNull();
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findMany({ orderBy: { name: "asc" } })).toEqual(once);
    for (const a of added) {
      expect((await getSetting()).builtinAgents[a.name])
        .toBe(builtinFingerprint(BUILTIN_AGENTS.find((b) => b.name === a.name)!));
    }
  });

  it("memperbarui baris yang belum disunting", async () => {
    await seedBuiltinAgents();
    // Baris ini SEOLAH ditulis seed versi sebelumnya: isinya beda dari katalog terpasang, tapi
    // stempelnya cocok dengan isinya — jadi "belum disentuh operator", hanya versi lama.
    const lama = { ...scout, instructions: "isi versi lama", maxTurns: null };
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: lama.instructions, maxTurns: lama.maxTurns } });
    await stempel("scout", builtinFingerprint(lama));

    await seedBuiltinAgents();

    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(row!.instructions).toBe(scout.instructions);
    expect(row!.maxTurns).toBe(20);
    expect((await getSetting()).builtinAgents.scout).toBe(builtinFingerprint(scout));
  });

  it("TIDAK menyentuh baris yang sudah disunting operator", async () => {
    await seedBuiltinAgents();
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: "punya operator" } });
    // Stempel dibiarkan menunjuk isi BAWAAN — jadi isi baris tak lagi cocok dengannya, dan itulah
    // tanda "disunting operator" yang dibaca seed.
    await seedBuiltinAgents();
    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(row!.instructions).toBe("punya operator");
  });

  it("TIDAK menimpa batas turn yang sudah disunting operator", async () => {
    await seedBuiltinAgents();
    await prisma.customAgent.update({ where: { id: idOf("scout") }, data: { maxTurns: 77 } });
    await seedBuiltinAgents();
    expect((await prisma.customAgent.findUnique({ where: { id: idOf("scout") } }))!.maxTurns)
      .toBe(77);
  });

  it("upgrade memperbarui isi tapi TIDAK pernah mengembalikan saklar enabled operator", async () => {
    await seedBuiltinAgents();
    // Baris versi lama yang belum disunting, TAPI sudah dimatikan operator.
    const lama = { ...scout, instructions: "isi versi lama" };
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: lama.instructions, enabled: false } });
    await stempel("scout", builtinFingerprint(lama));

    await seedBuiltinAgents();

    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    // Isi ikut versi baru …
    expect(row!.instructions).toBe(scout.instructions);
    // … saklarnya tidak. `enabled` sengaja BUKAN bagian sidik jari: mematikan satu agen tak boleh
    // terbaca sebagai "disunting", karena baris itu lalu tak pernah lagi menerima perbaikan.
    expect(row!.enabled).toBe(false);
  });

  it("mematikan qa-verifier seed lama yang belum disunting tepat sekali", async () => {
    const qa = BUILTIN_AGENTS.find((a) => a.name === "qa-verifier")!;
    const lama = { ...qa, instructions: "instruksi qa seed lama" };
    await prisma.customAgent.create({ data: {
      id: idOf(qa.name), projectId: null, name: qa.name,
      description: lama.description, instructions: lama.instructions,
      tools: [...lama.tools] as never, model: null, mentions: [] as never, runtime: null,
      enabled: true,
    } });
    await stempel(qa.name, legacyBuiltinFingerprint(lama));

    await seedBuiltinAgents();
    const once = await prisma.customAgent.findUnique({ where: { id: idOf(qa.name) } });
    expect(once!.enabled).toBe(false);
    expect((await getSetting()).builtinAgentPolicies[qa.name]).toBe(QA_SAFETY_POLICY);

    await prisma.customAgent.update({ where: { id: idOf(qa.name) }, data: { enabled: true } });
    await seedBuiltinAgents();
    expect((await prisma.customAgent.findUnique({ where: { id: idOf(qa.name) } }))!.enabled)
      .toBe(true);
  });

  it("tidak mematikan qa-verifier yang isinya sudah disunting operator", async () => {
    const qa = BUILTIN_AGENTS.find((a) => a.name === "qa-verifier")!;
    const lama = { ...qa, instructions: "instruksi qa seed lama" };
    await prisma.customAgent.create({ data: {
      id: idOf(qa.name), projectId: null, name: qa.name,
      description: lama.description, instructions: "instruksi milik operator",
      tools: [...lama.tools] as never, model: null, mentions: [] as never, runtime: null,
      enabled: true,
    } });
    await stempel(qa.name, legacyBuiltinFingerprint(lama));

    await seedBuiltinAgents();
    const row = await prisma.customAgent.findUnique({ where: { id: idOf(qa.name) } });
    expect(row!.enabled).toBe(true);
    expect(row!.instructions).toBe("instruksi milik operator");
    expect((await getSetting()).builtinAgentPolicies[qa.name]).toBe(QA_SAFETY_POLICY);
  });
});

describe("seedBuiltinAgents — tak pernah menggagalkan boot", () => {
  it("menelan galat DB dan kembali normal", async () => {
    // SENGAJA bukan `vi.spyOn(...).mockRestore()`: pada klien Prisma, `mockRestore()` MENGHAPUS
    // method-nya alih-alih memulihkannya, dan test berikutnya lalu berjalan tanpa `findUnique` —
    // seed diam-diam mengembalikan katalog kosong dan kegagalannya muncul di test yang lain.
    const asli = prisma.customAgent.findUnique;
    (prisma.customAgent as unknown as Record<string, unknown>).findUnique =
      () => Promise.reject(new Error("DB mati"));
    try {
      await expect(seedBuiltinAgents()).resolves.toBeUndefined();
    } finally {
      (prisma.customAgent as unknown as Record<string, unknown>).findUnique = asli;
    }
    // Pulih sungguhan — bukan sekadar tak melempar.
    await expect(prisma.customAgent.findMany()).resolves.toBeDefined();
  });
});

describe("installCustomAgents — urutan mengikat", () => {
  // Urutan terbalik = sesi PERTAMA sesudah boot lahir tanpa agen bawaan, lalu gejalanya hilang
  // sendiri di boot berikutnya. Bug yang tak bisa direproduksi kalau urutannya tak diuji.
  it("cache sudah berisi agen bawaan begitu install selesai", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
    await installCustomAgents();
    const names = agentDefsFor("p1", "claude").map((a) => a.name).sort();
    expect(names).toEqual(["blast-radius", "scout", "security-reviewer"]);
  });
});


describe("effort tak dipancarkan untuk model claude tanpa effort (audit P1-12)", () => {
  it("scout (haiku, effort low): definisi claude tanpa effort; codex tetap membawanya", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
    await installCustomAgents();
    expect(agentDefsFor("p1", "claude").find((a) => a.name === "scout"))
      .toMatchObject({ model: "haiku", effort: null });
    expect(agentDefsFor("p1", "claude").find((a) => a.name === "security-reviewer"))
      .toMatchObject({ model: "sonnet", effort: "high" });
    expect(agentDefsFor("p1", "codex").find((a) => a.name === "scout")).toMatchObject({ effort: "low" });
  });
});

describe("app/support — profil efektif dari seed", () => {
  it("memilih model per runtime dan mempertahankan override operator", async () => {
    const names = ["product-designer", "feature-builder", "performance-engineer", "product-analyst",
      "solution-architect", "operations-engineer", "support-triager", "knowledge-maintainer"];
    await seedBuiltinAgents();
    await prisma.customAgent.updateMany({ where: { name: { in: names } }, data: { enabled: true } });
    await loadCustomAgents();
    const claude = agentDefsFor("p1", "claude").filter((a) => names.includes(a.name));
    expect(claude).toHaveLength(8);
    const recommended = (name: string) => BUILTIN_AGENTS.find((b) => b.name === name)!.models;
    // Audit 2026-09-25 · solution-architect → opus / gpt-5.6-sol; sisanya sonnet / gpt-5.6-terra.
    expect(claude.every((a) => a.model === recommended(a.name).claude && a.mentions.length === 0)).toBe(true);
    expect(claude.find((a) => a.name === "solution-architect")!.model).toBe("opus");
    const codex = agentDefsFor("p1", "codex").filter((a) => names.includes(a.name));
    expect(codex.map((a) => a.name).sort()).toEqual(["product-analyst", "solution-architect", "support-triager"]);
    expect(codex.every((a) => a.model === recommended(a.name).codex && a.workspacePolicy === "read-only")).toBe(true);
    await prisma.customAgent.update({ where: { id: idOf("product-analyst") }, data: { model: "gpt-5.6", effort: "high" } });
    await loadCustomAgents();
    expect(agentDefsFor("p1", "codex").find((a) => a.name === "product-analyst"))
      .toMatchObject({ model: "gpt-5.6", effort: "high", workspacePolicy: "read-only" });
  });
});

// Audit custom agent 2026-09-25 · P0-3 · baris aplikasi yang didaftarkan lewat API sebelum seed
// mengenalnya tak berstempel. Fixture = katalog PERSIS seperti dirilis di commit historis.
type HistDef = {
  name: string; description: string; instructions: string; tools: string[];
  activation: string; effort: string | null; workspacePolicy: string;
  maxTurns: number | null; timeoutSeconds: number | null;
};
const history = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/builtin-app-agents-history.json"), "utf8",
)) as { versions: Record<string, HistDef[]> };

describe("seedBuiltinAgents — adopsi baris tanpa stempel (P0-3)", () => {
  const registerViaApi = (d: HistDef, over: Record<string, unknown> = {}) =>
    prisma.customAgent.create({ data: {
      id: idOf(d.name), projectId: null, name: d.name,
      description: d.description, instructions: d.instructions, tools: [...d.tools] as never,
      // Registrasi API 2026-09-05 menulis override runtime/model dan menyalakan agennya.
      model: "sonnet", runtime: "claude", mentions: [] as never, enabled: true,
      activation: d.activation, effort: d.effort, workspacePolicy: d.workspacePolicy,
      maxTurns: d.maxTurns, timeoutSeconds: d.timeoutSeconds, ...over,
    } });

  it("riwayat sidik jari cocok byte-per-byte dengan setiap versi yang pernah dirilis", () => {
    for (const [sha, defs] of Object.entries(history.versions)) {
      for (const d of defs) {
        expect(BUILTIN_FINGERPRINT_HISTORY[d.name], `${d.name}@${sha}`).toContain(rowFingerprint(d));
      }
    }
  });

  it("baris byte-identik versi historis ter-upgrade; override model/runtime/enabled bertahan", async () => {
    for (const d of history.versions["0b90ab3c"]!) await registerViaApi(d);
    await seedBuiltinAgents();
    const stamps = (await getSetting()).builtinAgents;
    for (const d of history.versions["0b90ab3c"]!) {
      const now = BUILTIN_AGENTS.find((a) => a.name === d.name)!;
      const row = await prisma.customAgent.findUnique({ where: { id: idOf(d.name) } });
      expect(row!.instructions).toBe(now.instructions);
      expect(row!.description).toBe(now.description);
      expect(row!.maxTurns).toBe(now.maxTurns);
      expect(row!.effort).toBe(now.effort);
      expect(row).toMatchObject({ model: "sonnet", runtime: "claude", enabled: true });
      expect(stamps[d.name]).toBe(builtinFingerprint(now));
    }
  });

  it("versi ADR-0167 (ff98a8f6) ikut teradopsi", async () => {
    const d = history.versions["ff98a8f6"]!.find((x) => x.name === "operations-engineer")!;
    await registerViaApi(d);
    await seedBuiltinAgents();
    const now = BUILTIN_AGENTS.find((a) => a.name === d.name)!;
    expect((await prisma.customAgent.findUnique({ where: { id: idOf(d.name) } }))!.instructions)
      .toBe(now.instructions);
  });

  it("baris tanpa stempel yang sudah disunting TIDAK tersentuh dan tak distempel", async () => {
    const d = history.versions["0b90ab3c"]!.find((x) => x.name === "feature-builder")!;
    await registerViaApi(d, { instructions: `${d.instructions}\nTambahan operator.` });
    const before = await prisma.customAgent.findUnique({ where: { id: idOf(d.name) } });
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf(d.name) } })).toEqual(before);
    expect((await getSetting()).builtinAgents[d.name]).toBeUndefined();
  });

  it("baris tanpa stempel yang sudah sama dengan katalog terpasang hanya distempel", async () => {
    const now = BUILTIN_AGENTS.find((a) => a.name === "solution-architect")!;
    await registerViaApi(now as unknown as HistDef);
    const before = await prisma.customAgent.findUnique({ where: { id: idOf(now.name) } });
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf(now.name) } })).toEqual(before);
    expect((await getSetting()).builtinAgents[now.name]).toBe(builtinFingerprint(now));
  });

  it("stempel ditulis per iterasi: galat di agen belakang tak membuang stempel agen depan", async () => {
    const last = BUILTIN_AGENTS[BUILTIN_AGENTS.length - 1]!;
    const asli = prisma.customAgent.findUnique;
    (prisma.customAgent as unknown as Record<string, unknown>).findUnique =
      (args: { where: { id: string } }) => args.where.id === idOf(last.name)
        ? Promise.reject(new Error("DB mati"))
        : asli.call(prisma.customAgent, args as never);
    try {
      await seedBuiltinAgents();
    } finally {
      (prisma.customAgent as unknown as Record<string, unknown>).findUnique = asli;
    }
    const stamps = (await getSetting()).builtinAgents;
    expect(stamps[BUILTIN_AGENTS[0]!.name]).toBe(builtinFingerprint(BUILTIN_AGENTS[0]!));
    expect(stamps[last.name]).toBeUndefined();
  });
});
