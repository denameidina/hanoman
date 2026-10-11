import { describe, expect, it } from "vitest";
import { redactKeepingFresh, redactSecrets, redactToken, secretValues } from "../src/mcp/redact";

describe("redaksi rahasia integrasi (ADR-0193)", () => {
  it("bot token Telegram disensor lewat BENTUKNYA, bukan hanya nilainya", () => {
    const bot = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
    expect(redactToken(`getMe gagal untuk ${bot}`, "hnm_agt_x")).toBe("getMe gagal untuk «token disembunyikan»");
  });
  it("tak merusak teks biasa yang mirip rasio/waktu", () => {
    expect(redactToken("jam 12:30 skor 3:1", "hnm_agt_x")).toBe("jam 12:30 skor 3:1");
  });
  it("redactSecrets menyensor nilai yang diberikan dan mengabaikan nilai terlalu pendek", () => {
    expect(redactSecrets("pass=abc12345 ok", ["abc12345"])).toBe("pass=«token disembunyikan» ok");
    expect(redactSecrets("a b c", ["a"])).toBe("a b c");
  });
  it("secretValues hanya mengambil argumen bertanda rahasia yang berisi string", () => {
    expect(secretValues(["password", "x"], { password: "p4ssword", email: "a@b", x: 5 })).toEqual(["p4ssword"]);
    expect(secretValues(undefined, { password: "p4ssword" })).toEqual([]);
  });
});

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
