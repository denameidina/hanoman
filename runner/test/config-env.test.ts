import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configEnvPath, formatConfigEnv, parseConfigEnv, readConfigEnv, writeConfigEnv,
} from "../src/config-env";

const home = (): string => mkdtempSync(join(tmpdir(), "hanoman-cfgenv-"));

describe("config.env", () => {
  it("mengabaikan komentar, baris kosong, dan baris tanpa '='", () => {
    expect(parseConfigEnv([
      "# komentar",
      "",
      "   ",
      "HANOMAN_HARDENING=1",
      "tanpa-sama-dengan",
      "  HANOMAN_DEPLOYMENT = public  ",
    ].join("\n"))).toEqual({ HANOMAN_HARDENING: "1", HANOMAN_DEPLOYMENT: "public" });
  });

  it("mempertahankan '=' di dalam nilai", () => {
    expect(parseConfigEnv("HANOMAN_EGRESS_PROXY=http://p:3128/?a=b")).toEqual({
      HANOMAN_EGRESS_PROXY: "http://p:3128/?a=b",
    });
  });

  it("round-trip format → parse", () => {
    const values = { HANOMAN_DEPLOYMENT: "public", HANOMAN_HARDENING: "1" };
    expect(parseConfigEnv(formatConfigEnv(values))).toEqual(values);
  });

  it("membuang nilai kosong saat memformat", () => {
    expect(formatConfigEnv({ A: "1", B: "" })).toBe("A=1\n");
  });

  it("berkas yang tak ada dibaca sebagai kosong, bukan melempar", () => {
    expect(readConfigEnv(home())).toEqual({});
  });

  it("menulis 0600 dan bisa dibaca kembali", () => {
    const dir = home();
    writeConfigEnv(dir, { HANOMAN_HARDENING: "1" });
    expect(readConfigEnv(dir)).toEqual({ HANOMAN_HARDENING: "1" });
    expect(statSync(configEnvPath(dir)).mode & 0o777).toBe(0o600);
    expect(readFileSync(configEnvPath(dir), "utf8")).toContain("HANOMAN_HARDENING=1");
  });

  it("menulis ulang mengganti isi, tidak menambahkan", () => {
    const dir = home();
    writeConfigEnv(dir, { HANOMAN_HARDENING: "1" });
    writeConfigEnv(dir, { HANOMAN_DEPLOYMENT: "local" });
    expect(readConfigEnv(dir)).toEqual({ HANOMAN_DEPLOYMENT: "local" });
  });
});
