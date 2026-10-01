import { describe, expect, it } from "vitest";
import { ZipError, crc32, readZip, writeZip } from "../src/services/zip";

describe("zip", () => {
  it("crc32 nilai baku", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("round-trip: stored + deflate, biner & nama unicode", () => {
    const bin = Buffer.from([0, 1, 2, 255, 254, 0, 7]);
    const txt = Buffer.from("halo dunia ".repeat(200));
    const zip = writeZip([
      { name: "report.md", data: txt, deflate: true },
      { name: "attachments/layar ✓.png", data: bin },
      { name: "kosong.txt", data: Buffer.alloc(0), deflate: true },
    ]);
    expect(zip.length).toBeLessThan(txt.length); // deflate benar-benar memampatkan
    const out = readZip(zip);
    expect([...out.keys()]).toEqual(["report.md", "attachments/layar ✓.png", "kosong.txt"]);
    expect(out.get("report.md")!.equals(txt)).toBe(true);
    expect(out.get("attachments/layar ✓.png")!.equals(bin)).toBe(true);
    expect(out.get("kosong.txt")!.length).toBe(0);
  });
  it("menolak bukan-ZIP, nama tak aman, terlalu banyak entri, dan melewati batas ukuran", () => {
    expect(() => readZip(Buffer.from("bukan zip"))).toThrow(ZipError);
    expect(() => readZip(writeZip([{ name: "../evil.txt", data: Buffer.from("x") }]))).toThrow(/tak aman/);
    expect(() => readZip(writeZip([{ name: "/abs.txt", data: Buffer.from("x") }]))).toThrow(/tak aman/);
    const many = writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from("x") })));
    expect(() => readZip(many, { maxEntries: 3 })).toThrow(/terlalu banyak/);
    expect(() => readZip(writeZip([{ name: "a.bin", data: Buffer.alloc(100) }]), { maxTotalBytes: 50 })).toThrow(/melebihi batas/);
  });
  it("mendeteksi entri rusak (CRC)", () => {
    const zip = Buffer.from(writeZip([{ name: "a.txt", data: Buffer.from("halo") }]));
    const at = 30 + "a.txt".length;
    zip[at] = zip[at]! ^ 0xff; // balik satu byte data
    expect(() => readZip(zip)).toThrow(/rusak/);
  });
});
