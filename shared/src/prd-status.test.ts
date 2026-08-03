import { describe, it, expect } from "vitest";
import {
  PRD_STATUSES, zPrdStatus, prdBranchFor, specDerivesFromPrd, prdStatusOf, type PrdSpecTrace,
} from "./prd-status";

const PRD = "docs/prd/jadwal-invoice.md";
// Bentuk baris Spec seperlunya; default = brief tanpa jejak PRD apa pun.
const spec = (over: Partial<PrdSpecTrace> = {}): PrdSpecTrace =>
  ({ stage: "planned", payload: { context: "", outcome: "", constraints: "", priority: "sedang" },
     branchFrom: null, ...over });

describe("kosakata", () => {
  it("tiga status, urutan tetap", () =>
    expect(PRD_STATUSES).toEqual(["draft", "dieskalasi", "terwujud"]));
  it("zod menolak status karangan", () =>
    expect(zPrdStatus.safeParse("terpakai").success).toBe(false));
});

describe("prdBranchFor", () => {
  it("docs/prd/<slug>.md → prd/<slug>", () =>
    expect(prdBranchFor(PRD)).toBe("prd/jadwal-invoice"));
  it("bukan PRD → null", () => {
    expect(prdBranchFor("internal/docs/README.md")).toBeNull();
    expect(prdBranchFor("docs/prd/x.txt")).toBeNull();
    expect(prdBranchFor("docs/prd/.md")).toBeNull();
  });
});

describe("specDerivesFromPrd — tiga jalur eskalasi yang sudah ada", () => {
  it("take → feature brief: context 'Dari PRD: <path>'", () =>
    expect(specDerivesFromPrd(spec({ payload: { context: `Dari PRD: ${PRD}` } }), PRD)).toBe(true));
  it("breakdown (ADR-0069): context 'Dari PRD (breakdown): <path>\\n\\n…'", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: `Dari PRD (breakdown): ${PRD}\n\nScope A blok ringkasan` } }), PRD)).toBe(true));
  it("take → goal (ADR-0089): payload.goal 'Wujudkan PRD <path>'", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { goal: `Wujudkan PRD ${PRD}`, done: "", constraints: "", priority: "sedang" } }), PRD)).toBe(true));
  it("K2: branchFrom prd/<slug> tanpa jejak payload", () =>
    expect(specDerivesFromPrd(spec({ branchFrom: "prd/jadwal-invoice" }), PRD)).toBe(true));
});

describe("specDerivesFromPrd — kontrol negatif", () => {
  // Bentuk SPEC-244/273/407 di DB nyata: prosanya menyebut "PRD" tanpa path apa pun.
  it("prosa menyebut kata PRD tanpa path → tidak cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "saat ini belum ada breakdown dari PRD yang complex" } }), PRD)).toBe(false));
  it("PRD lain di project yang sama → tidak cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: docs/prd/notifikasi.md" } }), PRD)).toBe(false));
  it("slug berawalan sama tidak saling cocok", () => {
    const auth = "docs/prd/auth.md";
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: docs/prd/auth-device.md" } }), auth)).toBe(false);
    expect(specDerivesFromPrd(spec({ branchFrom: "prd/auth-device" }), auth)).toBe(false);
  });
  it("payload null / bentuk qa / non-objek tak melempar", () => {
    expect(specDerivesFromPrd(spec({ payload: null }), PRD)).toBe(false);
    expect(specDerivesFromPrd(
      spec({ payload: { severity: "major", steps: "", expected: "", actual: "", env: "" } }), PRD)).toBe(false);
    expect(specDerivesFromPrd(spec({ payload: "Dari PRD: " + PRD }), PRD)).toBe(false);
  });
  it("path bukan PRD tak pernah cocok", () =>
    expect(specDerivesFromPrd(
      spec({ payload: { context: "Dari PRD: internal/docs/README.md" } }), "internal/docs/README.md")).toBe(false));
});

describe("prdStatusOf", () => {
  const from = (stage: string): PrdSpecTrace => spec({ stage, payload: { context: `Dari PRD: ${PRD}` } });
  it("nol turunan → draft", () =>
    expect(prdStatusOf(PRD, [])).toEqual({ status: "draft", specCount: 0, doneCount: 0 }));
  it("hanya backlog lain → tetap draft", () =>
    expect(prdStatusOf(PRD, [spec(), spec({ payload: { context: "Dari PRD: docs/prd/lain.md" } })]))
      .toEqual({ status: "draft", specCount: 0, doneCount: 0 }));
  it("ada turunan, belum semuanya done → dieskalasi", () =>
    expect(prdStatusOf(PRD, [from("done"), from("executing"), from("planned")]))
      .toEqual({ status: "dieskalasi", specCount: 3, doneCount: 1 }));
  it("semua turunan done → terwujud", () =>
    expect(prdStatusOf(PRD, [from("done"), from("done")]))
      .toEqual({ status: "terwujud", specCount: 2, doneCount: 2 }));
  it("satu turunan belum done → dieskalasi, bukan terwujud", () =>
    expect(prdStatusOf(PRD, [from("brainstorming")]).status).toBe("dieskalasi"));
});
