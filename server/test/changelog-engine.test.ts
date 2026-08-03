import { describe, it, expect, beforeEach } from "vitest";
import { changelogAgentDefaults } from "../src/services/changelog/config";
import { generateChangelog } from "../src/services/changelog/generate";
import type { ThinkOpts } from "../src/services/lead/brain";
import { resetDb, makeProject, makeSpec, makeSetting } from "./factory";

// SPEC-518 · runtime/model/effort agen changelog disetel operator — dan setelan itu harus
// benar-benar SAMPAI ke panggilan agen, bukan sekadar tersimpan. Tanpa blok kedua di berkas ini,
// "tersimpan tapi tak pernah dipakai" terlihat PERSIS SAMA dengan berhasil: seluruh test SPEC-516
// menyuntik `think` sebagai stub dan tak satu pun memeriksa opts-nya.
//
// Rantainya: Setting.data.changelog → changelogAgentDefaults() → generateChangelog() → think(opts).
// Ruas terakhir (`think` → argv) sudah dikunci `leadArgv` + `lead-engine-argv.test.ts`; yang belum
// pernah ada adalah ruas-ruas di atasnya.

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);
const RANGE = { mode: "backlog", from: "2026-07-01", to: "2026-07-31" } as const;

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

/** Menangkap opts yang benar-benar diterima agen. */
function spyThink() {
  const seen: ThinkOpts[] = [];
  const think = async (_p: string, o: ThinkOpts) => { seen.push(o); return "# Changelog\n\n- apa saja\n"; };
  return { seen, think };
}

describe("changelogAgentDefaults (SPEC-518)", () => {
  it("override MATI → mewarisi default sesi global (akar claude)", async () => {
    await makeSetting({ agent: "claude", model: "claude-fable-5", effort: "medium" });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Warisan wajib mengikuti BLOK yang benar. Membaca `model`/`effort` akar saat agennya codex
  // adalah bug SPEC-377 dalam bentuk baru (`codex -m claude-opus-5`).
  it("override MATI → mewarisi blok codex saat agen global codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("override HIDUP → memakai triple sendiri, bukan default global", async () => {
    await makeSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" },
    });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "claude", model: "claude-fable-5", effort: "low" });
  });

  // SPEC-339 · effort adalah properti MODEL. `gpt-5.6-luna` tak mendukung `ultra`; menyimpannya
  // apa adanya berarti panggilan agen ditolak codex. Koersi hidup di RESOLVER, bukan hanya di
  // picker — nilai bisa masuk lewat PUT /settings ber-AgentToken yang tak lewat UI mana pun.
  it("override HIDUP + codex → effort dikoersi ke yang didukung model", async () => {
    await makeSetting({
      changelog: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" },
    });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });
});

describe("generateChangelog memakai setelan changelog (SPEC-518)", () => {
  it("meneruskan triple hasil resolver ke think()", async () => {
    await makeSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      changelog: { enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "low" },
    });
    const { seen, think } = spyThink();
    const r = await generateChangelog("p1", RANGE, { think });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
  });

  it("override mati → think() menerima default sesi global", async () => {
    await makeSetting({ agent: "claude", model: "claude-fable-5", effort: "medium" });
    const { seen, think } = spyThink();
    await generateChangelog("p1", RANGE, { think });
    expect(seen[0]).toMatchObject({ agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Dibaca TIAP panggilan, tanpa cache → ganti setelan berlaku pada pembangkitan berikutnya tanpa
  // restart. Pola yang sama dikunci `lead-engine-argv.test.ts` untuk lead.
  it("setelan dibaca tiap panggilan — ganti setelan berlaku tanpa restart", async () => {
    const { seen, think } = spyThink();
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } });
    await generateChangelog("p1", RANGE, { think });
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" } });
    await generateChangelog("p1", RANGE, { think });
    expect(seen.map((o) => o.model)).toEqual(["claude-opus-5", "claude-fable-5"]);
  });

  // Anggaran waktu TIDAK ikut jadi setelan (di luar scope brief) — ia disebut di dalam prompt
  // (SPEC-432), jadi angka yang bisa digeser diam-diam akan berbohong kepada agennya.
  it("anggaran waktu tetap konstan, bukan turunan setelan", async () => {
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" } });
    const { seen, think } = spyThink();
    await generateChangelog("p1", RANGE, { think });
    expect(seen[0]!.timeoutMs).toBe(180_000);
  });
});
