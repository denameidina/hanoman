import { describe, it, expect } from "vitest";
import { PIPELINES, WORK_PHASES, startGoalPrompt } from "./prompt";
import { defaultGoalCondition } from "./goal";
import type { SpecBrief } from "./types";

const spec: SpecBrief = {
  id: "SPEC-825", title: "Ganti label tombol Simpan", source: "no_effort", priority: "rendah",
  objective: "Tombol Simpan berbunyi Terapkan",
  payload: { goal: "Tombol Simpan berbunyi Terapkan", done: "", constraints: "hanya copy", priority: "rendah" },
};

describe("SPEC-825 · pipeline no_effort", () => {
  it("satu fase bernama Kerjakan", () => {
    expect(PIPELINES.no_effort).toEqual(["Kerjakan"]);
  });

  // Peta REACHED di server berkunci NAMA FASE saja, jadi nama yang dipakai dua flow merusak
  // deteksi fase KEDUANYA (alasan yang sama melahirkan `Goal`/`Verifikasi` di ADR-0089).
  it("Kerjakan tak dipakai flow lain mana pun", () => {
    const other = Object.entries(PIPELINES)
      .filter(([flow]) => flow !== "no_effort")
      .flatMap(([, phases]) => [...phases]);
    expect(other).not.toContain("Kerjakan");
  });

  it("WORK_PHASES memuat setiap fase kerja yang dikenal", () => {
    expect([...WORK_PHASES]).toEqual(["Execute", "Goal", "Kerjakan"]);
  });

  // Gerbang `writesCode` diturunkan dari WORK_PHASES, jadi flow dokumen tetap di luar.
  it("setiap flow ber-fase kerja diakui menulis kode, flow dokumen tidak", () => {
    const writes = (Object.keys(PIPELINES) as (keyof typeof PIPELINES)[])
      .filter((f) => PIPELINES[f].some((p) => (WORK_PHASES as readonly string[]).includes(p)));
    expect(writes.sort()).toEqual(["feature", "goal", "no_effort", "qa"]);
  });
});

describe("SPEC-825 · prompt sesi no_effort", () => {
  const p = startGoalPrompt("no_effort", spec, "hanoman/spec-825", { verifyScope: "changed" });

  it("menyebut fase Kerjakan dan TIDAK menyebut fase Verifikasi", () => {
    expect(p).toContain("Kerjakan fase berurutan: Kerjakan.");
    expect(p).not.toContain("Verifikasi");
  });

  it("mengeja isi payload sebagai prosa, bukan JSON", () => {
    expect(p).toContain("Goal: Tombol Simpan berbunyi Terapkan");
    expect(p).toContain("Batasan: hanya copy");
    expect(p).not.toContain('{"goal"');
  });

  it("tetap flow penulis-kode: klausa scope verifikasi & gaya kode terpasang", () => {
    expect(p).toContain("Scope verifikasi: HANYA yang berubah.");
    expect(p).toContain("Gaya kode — berlaku setiap kali kamu menulis atau mengubah kode:");
  });

  it("melarang ritual perencanaan dan penambahan fase", () => {
    expect(p).toContain("jangan menulis plan berkotak");
    expect(p).toContain("jangan menambah fase sendiri");
  });

  it("kondisi Stop hook menuntut fase Kerjakan, bukan fase flow goal", () => {
    const c = defaultGoalCondition({
      flow: "no_effort", specId: "SPEC-825", branchTo: "hanoman/spec-825", spec,
    });
    expect(c).toContain("Kerjakan");
    expect(c).not.toContain("Verifikasi");
    expect(c).toContain("Tombol Simpan berbunyi Terapkan");
  });
});

// Flow `goal` dirakit builder yang SAMA sejak spec ini; teksnya tak boleh bergeser sedikit pun.
describe("SPEC-825 · prompt flow goal tak berubah", () => {
  const p = startGoalPrompt("goal", { ...spec, source: "goal" }, "hanoman/spec-407", { verifyScope: "changed" });

  it("masih dua fase dan masih membawa klausa fase Verifikasi", () => {
    expect(p).toContain("Kerjakan fase berurutan: Goal → Verifikasi.");
    expect(p).toContain("Fase Verifikasi bukan formalitas");
    expect(p).toContain("hanoman goal — sesi ini mengejar SATU goal sampai tercapai.");
  });
});
