import { describe, expect, it } from "vitest";
import { redactKeepingFresh, redactToken } from "../src/mcp/redact";

describe("redactToken", () => {
  it("mengganti token yang dipakai, di mana pun ia muncul", () => {
    expect(redactToken("gagal auth hnm_agt_deadbeef di /api", "hnm_agt_deadbeef"))
      .toBe("gagal auth «token disembunyikan» di /api");
  });
  it("mengganti token LAIN juga — bentuknya, bukan cuma nilainya", () => {
    expect(redactToken("bocor: hnm_agt_0011aabb", "hnm_agt_zzzz")).toBe("bocor: «token disembunyikan»");
  });
  it("token kosong tak membuat seluruh teks tergantikan", () => {
    expect(redactToken("halo", "")).toBe("halo");
  });
  it("aman untuk token yang memuat karakter regex", () => {
    expect(redactToken("x a.b*c y", "a.b*c")).toBe("x «token disembunyikan» y");
  });
  it("field password berbentuk JSON disensor, termasuk yang memuat tanda kutip ter-escape", () => {
    expect(redactToken('{"password":"abc","ok":1}', "")).toBe('{"password":"«token disembunyikan»","ok":1}');
    expect(redactToken('{"newPassword" : "a\\"b"}', "")).toBe('{"newPassword" : "«token disembunyikan»"}');
    expect(redactToken('{"passwordHash":"$argon2id$x"}', "")).toBe('{"passwordHash":"«token disembunyikan»"}');
    expect(redactToken('{"email":"a@b.co"}', "")).toBe('{"email":"a@b.co"}');
  });
});

describe("redactKeepingFresh", () => {
  it("meloloskan token BARU, tapi tetap menyembunyikan token konfigurasi dan field password", () => {
    expect(redactKeepingFresh('baru hnm_agt_NEW lama hnm_agt_cfg {"password":"p"}', "hnm_agt_cfg"))
      .toBe('baru hnm_agt_NEW lama «token disembunyikan» {"password":"«token disembunyikan»"}');
  });
});
