// Audit UI/UX 2026-10 · Fase 2D — kontrak peta label terpusat (lib/labels.ts).
import { describe, expect, it } from "vitest";
import * as labels from "./labels";
import { CASE_LABEL, FINDING_STATUS_LABEL, SEVERITY_LABEL as QA_SEVERITY_ALIAS, VERDICT_LABEL } from "../screens/qa/qa-ui";
import { SOURCE_META } from "../screens/source-meta";

const { labelOf, humanize, PRIORITY_LABEL, QA_SEVERITY_LABEL, SEVERITY_LABEL, FLOW_LABEL, PROJECT_KIND_LABEL,
  SOURCE_LABEL, STAGE_LABEL, TASK_STATUS_LABEL, CASE_STATUS_LABEL } = labels;

describe("labelOf · fallback aman", () => {
  it("nilai yang dipetakan memakai labelnya", () => {
    expect(labelOf(PRIORITY_LABEL, "tinggi")).toBe("Tinggi");
    expect(labelOf(PROJECT_KIND_LABEL, "from-scratch")).toBe("Dari nol");
  });

  it("nilai tak dikenal dirapikan, bukan dibiarkan mentah atau dibuat kapital aneh", () => {
    expect(labelOf(PRIORITY_LABEL, "urgen_sekali")).toBe("Urgen sekali");
    expect(labelOf(PROJECT_KIND_LABEL, "monorepo-baru")).toBe("Monorepo baru");
  });

  it("kosong, null, dan undefined jadi em dash, tanpa melempar", () => {
    expect(labelOf(PRIORITY_LABEL, null)).toBe("—");
    expect(labelOf(PRIORITY_LABEL, undefined)).toBe("—");
    expect(labelOf(PRIORITY_LABEL, "")).toBe("—");
  });

  it("properti bawaan objek tidak pernah lolos sebagai label", () => {
    expect(labelOf(PRIORITY_LABEL, "constructor")).toBe("Constructor");
    expect(labelOf(PRIORITY_LABEL, "__proto__")).toBe("Proto");
    expect(labelOf(PRIORITY_LABEL, "toString")).toBe("ToString");
  });

  it("humanize: separator jadi spasi, huruf pertama kapital, kosong jadi em dash", () => {
    expect(humanize("no_effort")).toBe("No effort");
    expect(humanize("  a--b  ")).toBe("A b");
    expect(humanize("   ")).toBe("—");
  });
});

describe("peta label · isi yang dikunci", () => {
  it("tak ada label kosong, dan kunci berseparator (enum mentah) tak pernah lolos sebagai label", () => {
    const maps = Object.entries(labels).filter(([name, v]) => name.endsWith("_LABEL") && typeof v === "object") as
      [string, Record<string, string>][];
    expect(maps.length).toBeGreaterThan(20);
    for (const [name, map] of maps) {
      for (const [key, value] of Object.entries(map)) {
        expect(value.trim(), `${name}.${key}`).not.toBe("");
        // Kata biasa seperti "kedaluwarsa" sah sebagai label; yang dilarang kunci bersambung (`from-scratch`).
        if (/[-_]/.test(key)) expect(value, `${name}.${key}`).not.toBe(key);
      }
    }
  });

  it("severity item backlog memakai kata yang sama dengan severity QA", () => {
    expect(Object.keys(SEVERITY_LABEL).sort()).toEqual(["critical", "major", "minor"]);
    expect(SEVERITY_LABEL.critical).toBe(QA_SEVERITY_LABEL.critical);
    expect(SEVERITY_LABEL.major).toBe("Fitur terganggu");
  });

  it("satu makna, satu kata: flow dan source yang disepakati", () => {
    expect(FLOW_LABEL.no_effort).toBe("Tanpa effort");
    expect(SOURCE_LABEL.no_effort).toBe("Tanpa effort");
    expect(SOURCE_LABEL.brief).toBe("Feature brief");
    expect(STAGE_LABEL.done).toBe("Selesai");
    expect(TASK_STATUS_LABEL.done).toBe("Selesai");
  });

  it("status QA: nilai baku yang dipakai layar dan tes", () => {
    expect(CASE_STATUS_LABEL.blocked).toBe("Terhambat");
    expect(VERDICT_LABEL["no-go"]).toBe("Belum siap digunakan");
    expect(FINDING_STATUS_LABEL.wontfix).toBe("Tidak akan diperbaiki");
  });
});

describe("pertahankan peta lama sebagai re-export", () => {
  it("nama lama menunjuk ke peta yang sama (bukan salinan)", () => {
    expect(CASE_LABEL).toBe(CASE_STATUS_LABEL);
    expect(QA_SEVERITY_ALIAS).toBe(QA_SEVERITY_LABEL);
    expect(SOURCE_META["qa"]?.label).toBe(SOURCE_LABEL.qa);
  });
});
