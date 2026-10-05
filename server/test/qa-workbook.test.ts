import { describe, expect, it } from "vitest";
import { parseQaWorkbook, qaTemplateWorkbook } from "../src/services/qa-workbook";
import { readZip } from "../src/services/zip";
import { readXlsx, writeXlsx } from "../src/services/xlsx";

const sheets = () => ["Panduan", "Ringkasan", "Test case", "Temuan", "Lampiran"].map((name) => ({ name, rows: readXlsx(qaTemplateWorkbook(), { sheet: name }) }));
describe("QA workbook validation", () => {
  it("provides dropdowns and readable row heights in Excel", () => {
    const parts = readZip(qaTemplateWorkbook());
    const summary = parts.get("xl/worksheets/sheet2.xml")!.toString();
    expect(summary).toContain('sqref="B7"');
    expect(summary).toContain("go,no-go,conditional");
    expect(parts.get("xl/worksheets/sheet1.xml")!.toString()).toMatch(/ht="[3-9][0-9]"/);
  });
  it("rejects missing sheets rather than reading a different sheet silently", () => {
    expect(() => parseQaWorkbook(writeXlsx(sheets().filter((s) => s.name !== "Temuan")))).toThrow(/Temuan.*wajib ada/);
  });
  it("supports Indonesian case statuses and multiline cells", () => {
    const s = sheets(); s[2]!.rows[1]![5] = "lulus";
    expect(parseQaWorkbook(writeXlsx(s)).cases[0]).toMatchObject({ status: "pass", steps: expect.stringContaining("\n") });
  });
  it("parses Lingkungan with CRLF (Excel Alt+Enter) and ';' separators, still rejecting keyless lines", () => {
    const s = sheets(); const row = s[1]!.rows.find((r) => r[0] === "Lingkungan")!;
    row[1] = "os=Windows 11\r\nbrowser=Chrome 130\r\nurl=https://x.id";
    expect(parseQaWorkbook(writeXlsx(s)).environment).toEqual({ os: "Windows 11", browser: "Chrome 130", url: "https://x.id" });
    row[1] = "os=macOS 15; browser=Chrome 130";
    expect(parseQaWorkbook(writeXlsx(s)).environment).toEqual({ os: "macOS 15", browser: "Chrome 130" });
    row[1] = "os=macOS\nChrome 130";
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Ringkasan, baris 9.*kunci=nilai/);
  });
  it("rejects invalid finding enums with sheet and row", () => {
    const s = sheets(); s[3]!.rows[1]![2] = "invalid";
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Temuan, baris 2/);
  });
  it("rejects nonexistent attachment owners and unsafe paths", () => {
    const s = sheets(); s[4]!.rows.push(["F-99", "layar.png"]);
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Lampiran, baris 2.*Pemilik/);
    s[4]!.rows[1] = ["F-01", "../layar.png"];
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Lampiran, baris 2.*aman/);
  });
  it("maps report, case and finding attachments separately", () => {
    const s = sheets(); s[4]!.rows.push(["Laporan", "log.txt"], ["TC-01", "uji.png"], ["F-01", "bug.png"]);
    const p = parseQaWorkbook(writeXlsx(s));
    expect(p.attachments).toEqual(["log.txt"]); expect(p.cases[0]!.attachments).toEqual(["uji.png"]); expect(p.findings[0]!.attachments).toEqual(["bug.png"]);
  });
  it("rejects duplicate codes, duplicate refs, unknown case references and oversized fields", () => {
    const s = sheets(); s[2]!.rows.push([...s[2]!.rows[1]!]);
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Test case, baris 3.*unik/);
    s[2]!.rows.pop(); s[3]!.rows[1]![6] = "TC-99";
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Temuan, baris 2.*tidak ditemukan/);
    s[3]!.rows[1]![6] = "TC-01"; s[2]!.rows[1]![1] = "a".repeat(301);
    expect(() => parseQaWorkbook(writeXlsx(s))).toThrow(/Test case, baris 2.*title/);
  });
});
