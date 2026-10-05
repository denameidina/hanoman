import { describe, expect, it } from "vitest";
import {
  assignCodes, qaCodeKey, qaPriorityToSpec, qaSeverityToSpec, qaStats, zCreateQaCase, zCreateQaFinding, zCreateQaReport, zPatchQaReport,
} from "./qa";

describe("zCreateQaReport", () => {
  it("hanya title yang wajib; sisanya default", () => {
    const r = zCreateQaReport.parse({ title: "Smoke 0.9.12" });
    expect(r).toMatchObject({ title: "Smoke 0.9.12", buildVersion: "", environment: {}, scope: "", tester: "", summary: "", verdict: null });
  });
  it("menolak title kosong dan environment > 20 entri", () => {
    expect(zCreateQaReport.safeParse({ title: " " }).success).toBe(false);
    const env = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect(zCreateQaReport.safeParse({ title: "x", environment: env }).success).toBe(false);
  });
  it("patch tak menulis ulang default (partial mematikannya)", () => {
    expect(zPatchQaReport.parse({ summary: "ok" })).toEqual({ summary: "ok" });
  });
  it("patch menerima status tetapi create tidak", () => {
    expect(zPatchQaReport.parse({ status: "closed" })).toEqual({ status: "closed" });
    expect(zCreateQaReport.parse({ title: "x", status: "closed" })).not.toHaveProperty("status");
  });
});

describe("zCreateQaFinding / zCreateQaCase", () => {
  it("finding: default severity major, prioritas P2, status open", () => {
    expect(zCreateQaFinding.parse({ title: "Tombol mati" })).toMatchObject({
      severity: "major", priority: "P2", area: "", steps: [], status: "open", caseId: null,
    });
  });
  it("finding menolak severity/prioritas liar dan status `sent` (hanya server yang boleh)", () => {
    expect(zCreateQaFinding.safeParse({ title: "x", severity: "gawat" }).success).toBe(false);
    expect(zCreateQaFinding.safeParse({ title: "x", priority: "P9" }).success).toBe(false);
    expect(zCreateQaFinding.safeParse({ title: "x", status: "sent" }).success).toBe(false);
  });
  it("case: default status todo", () => {
    expect(zCreateQaCase.parse({ title: "Login" })).toMatchObject({ status: "todo", steps: "", expected: "", actual: "" });
  });
});

describe("assignCodes", () => {
  const t = (s: string) => new Date(s);
  it("urut createdAt, seri dipecah id; urutan input dipertahankan", () => {
    const rows = [
      { id: "b", createdAt: t("2026-10-01T10:00:00Z") },
      { id: "a", createdAt: t("2026-10-01T10:00:00Z") },
      { id: "c", createdAt: t("2026-09-30T10:00:00Z") },
    ];
    const out = assignCodes(rows, "F-", 2);
    expect(out.map((r) => [r.id, r.code])).toEqual([["b", "F-03"], ["a", "F-02"], ["c", "F-01"]]);
  });
  it("menerima createdAt string ISO dan melebar melewati pad", () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ id: `i${String(i).padStart(3, "0")}`, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }));
    expect(assignCodes(rows, "QA-", 3)[100]!.code).toBe("QA-101");
  });
});

describe("qaStats", () => {
  it("menghitung status case, passRate atas yang dieksekusi, dan temuan per severity", () => {
    const s = qaStats(
      [{ status: "pass" }, { status: "pass" }, { status: "fail" }, { status: "blocked" }, { status: "skipped" }, { status: "todo" }],
      [{ severity: "major", status: "open" }, { severity: "minor", status: "wontfix" }, { severity: "major", status: "sent" }],
    );
    expect(s.cases).toMatchObject({ total: 6, pass: 2, fail: 1, blocked: 1, skipped: 1, todo: 1 });
    expect(s.passRate).toBeCloseTo(0.5);
    expect(s.findings).toMatchObject({ total: 3, major: 2, minor: 1, blocker: 0, open: 1 });
  });
  it("passRate null bila belum ada yang dieksekusi", () => {
    expect(qaStats([{ status: "todo" }], []).passRate).toBeNull();
  });
});

describe("pemetaan QA → backlog (lossy, dinyatakan)", () => {
  it("severity lima tingkat → tiga tingkat payload qa", () => {
    expect(qaSeverityToSpec("blocker")).toBe("critical");
    expect(qaSeverityToSpec("critical")).toBe("critical");
    expect(qaSeverityToSpec("major")).toBe("major");
    expect(qaSeverityToSpec("minor")).toBe("minor");
    expect(qaSeverityToSpec("trivial")).toBe("minor");
  });
  it("prioritas P0–P3 → tinggi/sedang/rendah", () => {
    expect(qaPriorityToSpec("P0")).toBe("tinggi");
    expect(qaPriorityToSpec("P1")).toBe("tinggi");
    expect(qaPriorityToSpec("P2")).toBe("sedang");
    expect(qaPriorityToSpec("P3")).toBe("rendah");
  });
});

describe("assignCodes · kode bebas (ADR-0176)", () => {
  const at = (n: number) => new Date(1_700_000_000_000 + n);
  it("memakai kode bebas apa adanya dan nomor otomatis melewati kode yang terpakai", () => {
    const rows = [
      { id: "a", createdAt: at(1), code: "LOGIN-1" }, { id: "b", createdAt: at(2), code: null },
      { id: "c", createdAt: at(3), code: "tc-02" }, { id: "d", createdAt: at(4) },
    ];
    const taken = new Set(rows.filter((r) => r.code).map((r) => qaCodeKey(r.code!)));
    expect(assignCodes(rows, "TC-", 2, taken).map((r) => r.code)).toEqual(["LOGIN-1", "TC-01", "tc-02", "TC-03"]);
  });
});
