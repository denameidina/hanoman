import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import {
  QA_SAFETY_POLICY, seedBuiltinAgents, builtinFingerprint, legacyBuiltinFingerprint,
} from "../src/services/builtin-agents";
import { getSetting } from "../src/services/settings";
import { writeTombstone } from "../src/services/tombstone";
import { installCustomAgents, agentDefsFor } from "../src/services/custom-agents";
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

  it("memperbarui baris yang belum disunting", async () => {
    await seedBuiltinAgents();
    // Baris ini SEOLAH ditulis seed versi sebelumnya: isinya beda dari katalog terpasang, tapi
    // stempelnya cocok dengan isinya — jadi "belum disentuh operator", hanya versi lama.
    const lama = { ...scout, instructions: "isi versi lama" };
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: lama.instructions } });
    await stempel("scout", builtinFingerprint(lama));

    await seedBuiltinAgents();

    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(row!.instructions).toBe(scout.instructions);
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
