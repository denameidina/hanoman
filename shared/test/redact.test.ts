import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/redact";

describe("redactText", () => {
  it("menyamarkan header Bearer", () => {
    expect(redactText("Authorization: Bearer abc123XYZ")).toContain("«redacted:bearer»");
  });
  it("menyamarkan token hanoman hnm_agt_...", () => {
    expect(redactText("token=hnm_agt_abcdef1234567890")).toContain("«redacted:");
    expect(redactText("token=hnm_agt_abcdef1234567890")).not.toContain("hnm_agt_abcdef1234567890");
  });
  it("menyamarkan sk-ant-..., ghp_/github_pat_, AKIA, xox[abprs]-, blok PEM, JWT", () => {
    const cases = [
      "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ghp_1234567890abcdef1234567890abcdef1234",
      "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz",
      "AKIAABCDEFGHIJKLMNOP",
      "xoxb-aaaaaaaaaaaa-bbbbbbbbbbbb-ccccccccccccccccccccccc",
      "-----BEGIN PRIVATE KEY-----\nMIIBVQ==\n-----END PRIVATE KEY-----",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ];
    for (const c of cases) expect(redactText(c)).not.toBe(c);
  });
  it("menyamarkan baris NAMA=nilai dengan nama rahasia", () => {
    expect(redactText("DATABASE_PASSWORD=hunter2")).not.toContain("hunter2");
    expect(redactText("API_KEY=xyz")).not.toContain("xyz");
  });
  it("teks biasa yang menyerupai pola tapi tak cocok persis tak ikut tersamar", () => {
    const plain = "harga barang naik 20% bulan ini, bukan token apa pun";
    expect(redactText(plain)).toBe(plain);
  });
  it("menyamarkan nilai diketahui-proses, terpanjang dulu", () => {
    const known = ["short12345", "short123456789longer"];
    const out = redactText("nilai: short123456789longer sisanya", known);
    expect(out).not.toContain("short123456789longer");
  });
  it("idempoten: f(f(x)) === f(x)", () => {
    const x = "Authorization: Bearer abc123XYZ dan sk-ant-api03-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";
    const once = redactText(x);
    expect(redactText(once)).toBe(once);
  });
  it("murni: dua panggilan sama menghasilkan hasil sama, tak mengubah argumen", () => {
    const input = "Bearer abc123XYZ";
    const a = redactText(input);
    const b = redactText(input);
    expect(a).toBe(b);
    expect(input).toBe("Bearer abc123XYZ");
  });
});

describe("redactValue", () => {
  it("rekursif menyamarkan string di dalam objek/array JSON, mempertahankan bentuk", () => {
    const v = { a: "Bearer abc123XYZ", b: [1, "sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"], c: { d: 42 } };
    const out = redactValue(v);
    expect(out.a).not.toContain("abc123XYZ");
    expect((out.b[1] as string)).not.toContain("sk-ant-api03");
    expect(out.c.d).toBe(42);
  });
});
