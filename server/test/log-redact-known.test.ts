import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { knownSecrets } from "../src/services/logs/redact-known";

describe("knownSecrets", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it("menyertakan env bernama rahasia yang panjangnya >= 8", () => {
    process.env.HANOMAN_TEST_SECRET_TOKEN = "abcdefgh12345";
    expect(knownSecrets()).toContain("abcdefgh12345");
  });

  it("mengabaikan env rahasia yang lebih pendek dari 8 karakter", () => {
    process.env.HANOMAN_TEST_SECRET_TOKEN = "short";
    expect(knownSecrets()).not.toContain("short");
  });

  it("mengabaikan env yang namanya tak cocok kosakata rahasia", () => {
    process.env.HANOMAN_TEST_PLAIN_NAME = "abcdefgh12345";
    expect(knownSecrets()).not.toContain("abcdefgh12345");
  });
});
