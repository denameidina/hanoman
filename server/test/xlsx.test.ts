import { describe, expect, it } from "vitest";
import { XlsxError, readXlsx, writeXlsx } from "../src/services/xlsx";
import { readZip, writeZip } from "../src/services/zip";

const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${s}`, "utf8");

describe("writeXlsx / readXlsx", () => {
  it("round-trip: multi-baris, unicode, karakter XML, spasi di tepi, sel kosong, dua sheet", () => {
    const rows = [
      ["Kode", "Judul", "Catatan"],
      ["TC-01", 'Login <valid> & "aman"', "baris 1\nbaris 2"],
      ["TC-02", "  berspasi  ", ""],
      ["TC-03", "日本語 ✓ é", "1"],
    ];
    const buf = writeXlsx([{ name: "Test case", rows, widths: [10, 30, 40] }, { name: "Temuan", rows: [["x"]] }]);
    // Sheet PERTAMA. Sel kosong di UJUNG baris tak ditulis (Excel pun begitu), jadi barisnya kembali lebih
    // pendek; sel kosong di TENGAH tetap "" — keduanya dibaca sama oleh parseCaseRows (`?? ""`).
    expect(readXlsx(buf)).toEqual([rows[0], rows[1], ["TC-02", "  berspasi  "], rows[3]]);
  });
  it("struktur OOXML minimal yang dituntut Excel ada: content types, rels, workbook, styles, sheet", () => {
    const files = readZip(writeXlsx([{ name: "A", rows: [["h"], ["v"]] }, { name: "B", rows: [["h"]] }]));
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml",
      "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
    ]);
    const wb = files.get("xl/workbook.xml")!.toString("utf8");
    expect(wb).toContain('<sheet name="A" sheetId="1" r:id="rId1"/>');
    expect(wb).toContain('<sheet name="B" sheetId="2" r:id="rId2"/>');
    expect(files.get("xl/worksheets/sheet1.xml")!.toString("utf8")).toContain('<pane ySplit="1"');   // header beku
  });
  it("nama sheet disanitasi (≤31, tanpa []:*?/\\)", () => {
    const wb = readZip(writeXlsx([{ name: "A/B:C*[x]? " + "z".repeat(40), rows: [["h"]] }])).get("xl/workbook.xml")!.toString("utf8");
    const name = /<sheet name="([^"]*)"/.exec(wb)![1]!;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  });
  it("karakter kontrol XML-ilegal dibuang, teks > 32767 dipotong", () => {
    const out = readXlsx(writeXlsx([{ name: "S", rows: [["a\u0000b\u0007c", "z".repeat(40000)]] }]));
    expect(out[0]![0]).toBe("abc");
    expect(out[0]![1]!.length).toBe(32767);
  });
});

describe("readXlsx · pilih sheet menurut nama", () => {
  const buf = writeXlsx([
    { name: "Ringkasan", rows: [["ringkasan"]] }, { name: "Test case", rows: [["Judul"], ["x"]] }, { name: "Temuan", rows: [["temuan"]] },
  ]);
  it("memilih menurut nama (tak peka huruf/spasi tepi); nama tak ada → sheet pertama", () => {
    expect(readXlsx(buf, { sheet: "test case" })).toEqual([["Judul"], ["x"]]);
    expect(readXlsx(buf, { sheet: " TEMUAN " })).toEqual([["temuan"]]);
    expect(readXlsx(buf, { sheet: "tak ada" })).toEqual([["ringkasan"]]);
    expect(readXlsx(buf)).toEqual([["ringkasan"]]);
  });
});

describe("readXlsx · berkas bergaya Excel", () => {
  // Workbook dengan: sharedStrings (termasuk rich text & phonetic), sel lompat, angka, t="str", boolean,
  // inlineStr, entitas numerik, dan sheet pertama yang BUKAN sheet1.xml (rId order ≠ nama berkas).
  const excelLike = () => writeZip([
    { name: "[Content_Types].xml", data: xml("<Types/>") },
    { name: "xl/workbook.xml", data: xml('<workbook xmlns="x" xmlns:r="r"><sheets><sheet name="Hasil" sheetId="7" r:id="rId5"/><sheet name="Lain" sheetId="8" r:id="rId6"/></sheets></workbook>') },
    { name: "xl/_rels/workbook.xml.rels", data: xml('<Relationships><Relationship Id="rId6" Type="t" Target="worksheets/sheet1.xml"/><Relationship Type="t" Target="worksheets/sheet3.xml" Id="rId5"/></Relationships>') },
    { name: "xl/sharedStrings.xml", data: xml('<sst count="4" uniqueCount="4"><si><t>Judul</t></si><si><r><t>Log</t></r><r><rPr><b/></rPr><t xml:space="preserve">in </t></r><r><t>valid</t></r><rPh sb="0" eb="1"><t>IGNORED</t></rPh></si><si><t>Status</t></si><si><t xml:space="preserve">a &amp; b&#10;c</t></si></sst>') },
    { name: "xl/worksheets/sheet3.xml", data: xml('<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Ref</t></is></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>42</v></c><c r="C3" t="str"><v>pass</v></c><c r="D3" s="2"><v>c1</v></c><c r="E3" t="b"><v>1</v></c></row>'
      + '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="C4" t="e"><v>#N/A</v></c><c r="D4"/></row>'
      + '</sheetData></worksheet>') },
    { name: "xl/worksheets/sheet1.xml", data: xml('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>SALAH SHEET</t></is></c></row></sheetData></worksheet>') },
  ]);
  it("memilih sheet pertama menurut workbook.xml (bukan nama berkas), sel lompat jadi string kosong", () => {
    const rows = readXlsx(excelLike());
    expect(rows[0]).toEqual(["Judul", "", "Status", "Ref"]);
    expect(rows[1]).toEqual([]);                                       // baris 2 tak ada di berkas
    expect(rows[2]).toEqual(["Login valid", "42", "pass", "c1", "TRUE"]);   // rich text digabung, rPh dibuang
    expect(rows[3]![0]).toBe("a & b\nc");                              // entitas &amp; &#10;
    expect(rows[3]![2]).toBe("");                                      // t="e" (galat sel) → kosong
  });
  it("tanpa workbook.xml → jatuh ke xl/worksheets/sheet1.xml", () => {
    const z = writeZip([{ name: "xl/worksheets/sheet1.xml", data: xml('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>') }]);
    expect(readXlsx(z)).toEqual([["ok"]]);
  });
});

describe("readXlsx · penolakan", () => {
  it("bukan ZIP → XlsxError; ZIP tanpa sheet → XlsxError", () => {
    expect(() => readXlsx(Buffer.from("bukan xlsx"))).toThrow(XlsxError);
    expect(() => readXlsx(writeZip([{ name: "a.txt", data: Buffer.from("x") }]))).toThrow(/lembar/);
  });
  it("terlalu banyak baris/kolom ditolak", () => {
    const many = (n: number) => writeZip([{ name: "xl/worksheets/sheet1.xml", data: xml(`<worksheet><sheetData><row r="${n}"><c r="A${n}" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`) }]);
    expect(() => readXlsx(many(5001))).toThrow(/baris/);
    const wide = writeZip([{ name: "xl/worksheets/sheet1.xml", data: xml('<worksheet><sheetData><row r="1"><c r="BZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>') }]);
    expect(() => readXlsx(wide)).toThrow(/kolom/);
  });
});
