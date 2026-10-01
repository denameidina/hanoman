import { describe, expect, it } from "vitest";
import { CASE_COLUMNS, QaTableError, casesToRows, csvDecode, csvEncode, parseCaseRows } from "./qa-tabular";

describe("csv", () => {
  it("encode: BOM, CRLF, kutip untuk koma/kutip/baris baru, kutip digandakan", () => {
    const out = csvEncode([["a", "b,c", 'd"e', "f\ng"], ["", " spasi ", "x", "y"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toBe('﻿a,"b,c","d""e","f\ng"\r\n,\" spasi \",x,y\r\n');
  });
  it("decode: round-trip termasuk baris baru & kutip di dalam sel", () => {
    const rows = [["Kode", "Catatan"], ["TC-01", 'dia bilang "ok",\nlalu pergi'], ["TC-02", ""]];
    expect(csvDecode(csvEncode(rows))).toEqual(rows);
  });
  it("decode: BOM dibuang; CRLF/LF/CR semuanya diterima", () => {
    expect(csvDecode("﻿a,b\r\nc,d\ne,f\rg,h")).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
  });
  it("decode: titik-koma terdeteksi (Excel locale Indonesia menyimpan CSV dengan `;`)", () => {
    expect(csvDecode("Kode;Judul\nTC-01;Login, valid")).toEqual([["Kode", "Judul"], ["TC-01", "Login, valid"]]);
  });
  it("decode: kutip yang tak tertutup → galat berbaris", () => {
    expect(() => csvDecode('a,b\n"belum ditutup,c')).toThrow(QaTableError);
  });
});

describe("casesToRows / parseCaseRows", () => {
  const cases = [
    { id: "c1", code: "TC-01", title: "Login", steps: "1. buka\n2. isi", expected: "masuk", actual: "masuk", status: "pass" },
    { id: "c2", code: "TC-02", title: "Bayar", steps: "", expected: "form", actual: "diam", status: "fail" },
  ];
  it("baris ekspor: header baku + satu baris per case, Ref = id", () => {
    const rows = casesToRows(cases);
    expect(rows[0]).toEqual([...CASE_COLUMNS]);
    expect(rows[1]).toEqual(["TC-01", "Login", "1. buka\n2. isi", "masuk", "masuk", "pass", "c1"]);
    expect(rows).toHaveLength(3);
  });
  it("round-trip ekspor → parse", () => {
    const parsed = parseCaseRows(casesToRows(cases));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ row: 2, ref: "c1", code: "TC-01", title: "Login", status: "pass", steps: "1. buka\n2. isi" });
    expect(parsed[1]).toMatchObject({ row: 3, ref: "c2", actual: "diam", status: "fail" });
  });
  it("header tak peka huruf/spasi/alias, urutan kolom bebas; baris sebelum header diabaikan", () => {
    const rows = [
      ["Laporan QA smoke"], [""],
      ["REF", "Hasil Aktual", "judul test case", "STATUS", "Langkah Uji"],
      ["c1", "masuk", "Login", "Lulus", "buka"],
      ["", "", "Baru", "", ""],
    ];
    const p = parseCaseRows(rows);
    expect(p[0]).toMatchObject({ row: 4, ref: "c1", title: "Login", actual: "masuk", status: "pass", steps: "buka" });
    expect(p[1]).toMatchObject({ row: 5, ref: null, title: "Baru", status: null });
  });
  it("alias status Indonesia/Inggris; kosong = null (biarkan); tak dikenal = galat berbaris", () => {
    const mk = (s: string) => parseCaseRows([["Judul", "Status"], ["x", s]])[0]!.status;
    expect([mk("PASS"), mk("passed"), mk("gagal"), mk("Failed"), mk("terblokir"), mk("skip"), mk("belum"), mk("")])
      .toEqual(["pass", "pass", "fail", "fail", "blocked", "skipped", "todo", null]);
    expect(() => parseCaseRows([["Judul", "Status"], ["x", "mungkin"]])).toThrowError(/baris 2.*status/i);
  });
  it("baris kosong total dilewati; baris berisi tanpa judul & tanpa Ref → galat; tanpa kolom Judul → galat", () => {
    expect(parseCaseRows([["Judul", "Aktual"], ["", ""], ["a", "b"]])).toHaveLength(1);
    expect(() => parseCaseRows([["Judul", "Aktual"], ["", "isi saja"]])).toThrowError(/baris 2.*judul/i);
    expect(() => parseCaseRows([["Kolom A", "Kolom B"], ["1", "2"]])).toThrowError(/header/i);
  });
  it("kolom yang TAK ADA di lembar → undefined (bedakan dari sel kosong, yang berarti kosongkan)", () => {
    const p = parseCaseRows([["Judul", "Aktual", "Ref"], ["x", "", "c1"]]);
    expect(p[0]!.steps).toBeUndefined();
    expect(p[0]!.expected).toBeUndefined();
    expect(p[0]!.actual).toBe("");           // kolom ada, selnya kosong
  });
  it("baris ber-Ref boleh tanpa judul (judul lama dipertahankan oleh pemanggil)", () => {
    const p = parseCaseRows([["Judul", "Aktual", "Ref"], ["", "diam", "c9"]]);
    expect(p[0]).toMatchObject({ ref: "c9", title: "", actual: "diam" });
  });
});
