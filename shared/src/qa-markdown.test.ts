import { describe, expect, it } from "vitest";
import { qaStats, type QaReportDetail } from "./qa";
import { QaMarkdownError, parseQaMarkdown, qaTemplateMarkdown, renderQaMarkdown } from "./qa-markdown";

const at = "2026-10-01T10:00:00.000Z";
const base = { createdAt: at, updatedAt: at };
const cases = [
  { ...base, id: "c1", reportId: "r1", code: "TC-01", title: "Login | valid", steps: "1. buka\n2. isi", expected: "masuk", actual: "masuk", status: "pass" as const, order: 1 },
  { ...base, id: "c2", reportId: "r1", code: "TC-02", title: "Bayar", steps: "", expected: "form bayar", actual: "diam", status: "fail" as const, order: 2 },
];
const findings = [{
  ...base, id: "f1", reportId: "r1", code: "F-01", caseId: "c2", caseCode: "TC-02", title: "Tombol bayar mati",
  severity: "major" as const, priority: "P1" as const, area: "checkout", steps: ["buka keranjang", "klik bayar"],
  expected: "form bayar", actual: "tidak ada reaksi\nkonsol error", status: "open" as const, backlogId: null, spec: null,
}];
const att = (id: string, ownerType: "report" | "case" | "finding", ownerId: string, filename: string, mimeType: string) =>
  ({ id, reportId: "r1", ownerType, ownerId, filename, mimeType, size: 1, sha256: "x", syncState: "local-only" as const, createdAt: at });
const detail: QaReportDetail = {
  ...base, id: "r1", projectId: "p1", code: "QA-007", title: 'Smoke "checkout" 0.9', buildVersion: "0.9.12",
  environment: { os: "macOS", browser: "Chrome" }, scope: "checkout\nlogin", tester: "Dena",
  summary: "Hasil baik.\n## Bukan heading\n**Repro** bukan label\n\\garis miring", status: "submitted", verdict: "conditional",
  stats: qaStats(cases, findings), cases, findings,
  attachments: [
    att("a1", "report", "r1", "ringkas.pdf", "application/pdf"),
    att("a2", "finding", "f1", "layar.png", "image/png"),
    att("a3", "case", "c2", "log.txt", "text/plain"),
  ],
};
const paths = { a1: "attachments/QA-007-1-ringkas.pdf", a2: "attachments/F-01-1-layar.png", a3: "attachments/TC-02-1-log.txt" };

describe("renderQaMarkdown", () => {
  const md = renderQaMarkdown(detail, paths);
  it("memuat front-matter, judul, tabel, dan blok temuan yang terbaca manusia", () => {
    expect(md.startsWith("---\nhanoman-qa: 1\n")).toBe(true);
    expect(md).toContain("# QA-007 · Smoke \"checkout\" 0.9");
    expect(md).toContain("### F-01 · [major/P1] Tombol bayar mati");
    expect(md).toContain("**Test case:** TC-02");
    expect(md).toContain("1. buka keranjang\n2. klik bayar");
    expect(md).toContain("- ![layar.png](attachments/F-01-1-layar.png)");
    expect(md).toContain("- [ringkas.pdf](attachments/QA-007-1-ringkas.pdf)");
  });
  it("tanpa `paths`, tautan lampiran memakai attachments/<filename>", () => {
    expect(renderQaMarkdown(detail)).toContain("(attachments/layar.png)");
  });
});

describe("renderQaMarkdown · tautan backlog", () => {
  const sent = { ...detail, findings: [{ ...findings[0]!, status: "sent" as const, backlogId: "SPEC-212", spec: { id: "SPEC-212", stage: "executing", priority: "tinggi" } }] };
  it("menulis baris **Backlog:** dengan stage; tak merusak parse (status sent kembali apa adanya)", () => {
    const md = renderQaMarkdown(sent, paths);
    expect(md).toContain("**Backlog:** SPEC-212 · executing");
    const p = parseQaMarkdown(md);
    expect(p.findings[0]).toMatchObject({ status: "sent", title: "Tombol bayar mati", steps: ["buka keranjang", "klik bayar"] });
  });
  it("tautan putus (spec null) hanya menulis id", () => {
    expect(renderQaMarkdown({ ...sent, findings: [{ ...sent.findings[0]!, spec: null }] }, paths)).toContain("**Backlog:** SPEC-212\n");
  });
});

describe("renderQaMarkdown · mode preview", () => {
  const md = renderQaMarkdown(detail, paths, { preview: true });
  it("tanpa front-matter, tanpa kolom Ref, tanpa komentar metadata — hanya untuk dibaca", () => {
    expect(md.startsWith("# QA-007 ·")).toBe(true);
    expect(md).not.toContain("hanoman-qa:");
    expect(md).not.toContain("| Ref |");
    expect(md).not.toContain("<!-- hanoman:");
    expect(md).toContain("| Kode | Judul | Langkah | Diharapkan | Aktual | Status |");
    expect(md).toContain("### F-01 · [major/P1] Tombol bayar mati");
  });
  it("mode biasa tetap utuh (dipakai ekspor/impor)", () => {
    const full = renderQaMarkdown(detail, paths);
    expect(full).toContain("| Ref |");
    expect(full).toContain("<!-- hanoman:");
  });
});

describe("parseQaMarkdown · round-trip", () => {
  const p = parseQaMarkdown(renderQaMarkdown(detail, paths));
  it("meta laporan", () => {
    expect(p).toMatchObject({
      reportId: "r1", title: 'Smoke "checkout" 0.9', buildVersion: "0.9.12", tester: "Dena",
      scope: "checkout\nlogin", status: "submitted", verdict: "conditional", environment: { os: "macOS", browser: "Chrome" },
    });
  });
  it("teks bebas yang meniru struktur tetap utuh", () => {
    expect(p.summary).toBe("Hasil baik.\n## Bukan heading\n**Repro** bukan label\n\\garis miring");
  });
  it("test case, termasuk pipa & baris baru di sel", () => {
    expect(p.cases).toHaveLength(2);
    expect(p.cases[0]).toMatchObject({ id: "c1", code: "TC-01", title: "Login | valid", steps: "1. buka\n2. isi", status: "pass", attachments: [] });
    expect(p.cases[1]).toMatchObject({ id: "c2", status: "fail", attachments: [paths.a3] });
  });
  it("temuan lengkap", () => {
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({
      id: "f1", caseId: "c2", caseCode: "TC-02", title: "Tombol bayar mati", severity: "major", priority: "P1",
      area: "checkout", status: "open", steps: ["buka keranjang", "klik bayar"], expected: "form bayar",
      actual: "tidak ada reaksi\nkonsol error", attachments: [paths.a2],
    });
  });
  it("lampiran tingkat laporan", () => {
    expect(p.attachments).toEqual([paths.a1]);
  });
});

describe("parseQaMarkdown · galat berbaris", () => {
  const good = renderQaMarkdown(detail, paths);
  const lineOf = (needle: string) => good.split("\n").findIndex((l) => l.includes(needle)) + 1;
  const expectLine = (text: string, line: number) => {
    try { parseQaMarkdown(text); } catch (e) {
      expect(e).toBeInstanceOf(QaMarkdownError);
      expect((e as QaMarkdownError).line).toBe(line);
      return;
    }
    throw new Error("seharusnya melempar");
  };
  it("front-matter hilang → baris 1", () => expectLine("# hanya judul\n", 1));
  it("status tak dikenal → baris status", () => expectLine(good.replace("status: submitted", "status: selesai"), lineOf("status: submitted")));
  it("severity tak dikenal → baris judul temuan", () => {
    expectLine(good.replace("[major/P1]", "[gawat/P1]"), lineOf("### F-01"));
  });
  it("judul temuan tak berformat → baris itu", () => {
    expectLine(good.replace("### F-01 · [major/P1] Tombol bayar mati", "### Temuan bebas"), lineOf("### F-01"));
  });
  it("baris tabel test case bukan 7 kolom → baris itu", () => {
    const bad = good.split("\n").map((l) => (l.startsWith("| TC-02") ? "| TC-02 | cuma | tiga |" : l)).join("\n");
    expectLine(bad, lineOf("| TC-02"));
  });
  it("langkah repro tak bernomor → baris itu", () => {
    expectLine(good.replace("2. klik bayar", "klik bayar tanpa nomor"), lineOf("2. klik bayar"));
  });
});

describe("qaTemplateMarkdown", () => {
  it("dapat diurai apa adanya: tanpa reportId, satu contoh case dan satu temuan", () => {
    const p = parseQaMarkdown(qaTemplateMarkdown());
    expect(p.reportId).toBeNull();
    expect(p.status).toBe("draft");
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0]!.id).toBeNull();
    expect(p.findings).toHaveLength(1);
    expect(p.findings[0]).toMatchObject({ id: null, severity: "major", status: "open" });
  });
  it("memuat panduan pengisian", () => {
    expect(qaTemplateMarkdown()).toMatch(/Severity/i);
  });
});
