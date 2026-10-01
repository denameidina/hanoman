import { describe, expect, it } from "vitest";
import { qaStats, type QaReportDetail } from "@hanoman/shared";
import { writeDocx, type DocxImage } from "../src/services/qa-docx";
import { readZip } from "../src/services/zip";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const at = "2026-10-01T10:30:00.000Z";
const base = { createdAt: at, updatedAt: at };
const cases = [
  { ...base, id: "c1", reportId: "r1", code: "TC-01", title: "Login & <aman>", steps: "1. buka\n2. isi", expected: "masuk", actual: "masuk", status: "pass" as const, order: 1 },
  { ...base, id: "c2", reportId: "r1", code: "TC-02", title: "Bayar", steps: "", expected: "form bayar", actual: "diam", status: "fail" as const, order: 2 },
];
const findings = [{
  ...base, id: "f1", reportId: "r1", code: "F-01", caseId: "c2", caseCode: "TC-02", title: 'Tombol "bayar" mati',
  severity: "major" as const, priority: "P1" as const, area: "checkout", steps: ["buka keranjang", "klik bayar"],
  expected: "form bayar", actual: "tidak ada reaksi\nkonsol error", status: "sent" as const, backlogId: "SPEC-212",
  spec: { id: "SPEC-212", stage: "executing", priority: "tinggi" },
}];
const att = (id: string, ownerType: "report" | "case" | "finding", ownerId: string, filename: string, mimeType: string) =>
  ({ id, reportId: "r1", ownerType, ownerId, filename, mimeType, size: 2048, sha256: "x", syncState: "local-only" as const, createdAt: at });
const detail: QaReportDetail = {
  ...base, id: "r1", projectId: "p1", code: "QA-007", title: "Smoke checkout 0.9", buildVersion: "0.9.12",
  environment: { os: "macOS", browser: "Chrome" }, scope: "checkout\nlogin", tester: "Dena",
  summary: "Hasil baik dengan satu masalah.", status: "submitted", verdict: "conditional",
  stats: qaStats(cases, findings), cases, findings,
  attachments: [
    att("a1", "report", "r1", "ringkas.pdf", "application/pdf"),
    att("a2", "finding", "f1", "layar.png", "image/png"),
    att("a3", "case", "c2", "log.txt", "text/plain"),
  ],
};
const images = new Map<string, DocxImage>([["a2", { data: PNG, ext: "png", w: 1200, h: 800 }]]);

/** Pemeriksa well-formed sederhana: tag harus seimbang. Word menolak berkas bila satu saja tak seimbang. */
function assertWellFormed(xml: string) {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?[\s\S]*?\?>/g, "").matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { expect(stack.pop(), `penutup </${name}>`).toBe(name); } else stack.push(name!);
  }
  expect(stack).toEqual([]);
  // tak ada `<` / `&` mentah di dalam teks
  expect(xml.replace(/<[^>]*>/g, "")).not.toMatch(/[<]|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i);
}

describe("writeDocx", () => {
  const files = readZip(writeDocx(detail, images));
  const doc = files.get("word/document.xml")!.toString("utf8");
  it("bagian paket wajib + media gambar", () => {
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/document.xml", "word/media/image1.png", "word/styles.xml",
    ]);
    expect(files.get("word/media/image1.png")!.equals(PNG)).toBe(true);
    expect(files.get("[Content_Types].xml")!.toString("utf8")).toContain('Extension="png"');
    expect(files.get("word/_rels/document.xml.rels")!.toString("utf8")).toMatch(/Id="rIdImg1"[^>]*Target="media\/image1\.png"/);
  });
  it("setiap bagian XML well-formed dan teks ter-escape", () => {
    for (const [name, buf] of files) if (/\.(xml|rels)$/.test(name)) assertWellFormed(buf.toString("utf8"));
  });
  it("memuat judul, ringkasan angka, tabel test case, dan blok temuan", () => {
    expect(doc).toContain("QA-007 · Smoke checkout 0.9");
    expect(doc).toContain("Login &amp; &lt;aman&gt;");                      // escape
    expect(doc).toContain("F-01 · [major/P1] Tombol &quot;bayar&quot; mati");
    expect(doc).toContain("Langkah reproduksi");
    expect(doc).toContain("1. buka keranjang");
    expect(doc).toContain("2. klik bayar");
    expect(doc).toContain("SPEC-212");
    expect(doc).toMatch(/pass rate 50%/);
    expect(doc).toContain("conditional");
  });
  it("status test case diwarnai (pass hijau, fail merah) dan header tabel berulang", () => {
    expect(doc).toContain('w:fill="E3F1E3"');
    expect(doc).toContain('w:fill="F8D7D2"');
    expect(doc).toContain("<w:tblHeader/>");
  });
  it("gambar tertanam sebagai drawing inline ber-rasio terjaga & dibatasi lebar halaman; non-gambar hanya dicantumkan", () => {
    expect(doc.match(/<w:drawing>/g)).toHaveLength(1);
    expect(doc).toContain('r:embed="rIdImg1"');
    const ext = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(doc)!;
    const [cx, cy] = [Number(ext[1]), Number(ext[2])];
    expect(cx).toBeLessThanOrEqual(5486400);                                // ≤ 6 inci
    expect(Math.abs(cx / cy - 1200 / 800)).toBeLessThan(0.01);               // rasio 3:2
    expect(doc).toContain("ringkas.pdf");
    expect(doc).toContain("log.txt");
    expect(doc).not.toContain("• layar.png");                                  // gambar ditanam, bukan dicantumkan sebagai butir
  });
  it("tanpa gambar/temuan/test case: tetap dokumen valid", () => {
    const empty: QaReportDetail = { ...detail, cases: [], findings: [], attachments: [], stats: qaStats([], []) };
    const f = readZip(writeDocx(empty, new Map()));
    expect([...f.keys()].some((k) => k.startsWith("word/media/"))).toBe(false);
    assertWellFormed(f.get("word/document.xml")!.toString("utf8"));
    expect(f.get("word/document.xml")!.toString("utf8")).toContain("Belum ada test case");
  });
});
