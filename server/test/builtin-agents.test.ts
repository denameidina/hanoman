import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { seedBuiltinAgents, builtinFingerprint } from "../src/services/builtin-agents";
import { getSetting } from "../src/services/settings";
import { writeTombstone } from "../src/services/tombstone";
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
    await prisma.setting.update({ where: { id: 1 },
      data: { data: { ...s, builtinAgents: { ...s.builtinAgents, [name]: fp } } } });
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
});

describe("seedBuiltinAgents — tak pernah menggagalkan boot", () => {
  it("menelan galat DB dan kembali normal", async () => {
    const spy = vi.spyOn(prisma.customAgent, "findUnique").mockRejectedValue(new Error("DB mati"));
    await expect(seedBuiltinAgents()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
