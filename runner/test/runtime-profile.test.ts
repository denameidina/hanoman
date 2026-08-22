import { describe, expect, it } from "vitest";
import { resolveDeployment, resolveHardening } from "../src/runtime-profile";

describe("profil runtime", () => {
  it("instalasi npm polos: lokal, hardening mati", () => {
    // Persis tujuh variabel yang disuntik serverEnv() (cli/src/commands/start.ts:175-184).
    const env = {
      NODE_ENV: "production", DATABASE_URL: "file:/h/hanoman.db", PORT: "8787",
      HOST: "127.0.0.1", HANOMAN_HOME: "/h", HANOMAN_SUPERVISOR: "1", HANOMAN_WEB_DIR: "/w",
    };
    expect(resolveHardening(env)).toBe(false);
    expect(resolveDeployment(env)).toBe("local");
  });

  it("NODE_ENV=production sendirian TIDAK lagi menyalakan hardening", () => {
    expect(resolveHardening({ NODE_ENV: "production" })).toBe(false);
  });

  it("HANOMAN_HARDENING=1 menyalakannya", () => {
    expect(resolveHardening({ HANOMAN_HARDENING: "1" })).toBe(true);
    expect(resolveDeployment({ HANOMAN_HARDENING: "1" })).toBe("public");
  });

  it("nilai selain '1' tidak menyalakan apa pun", () => {
    for (const v of ["0", "true", "yes", "", " "])
      expect(resolveHardening({ HANOMAN_HARDENING: v })).toBe(false);
  });

  // Kompatibilitas mundur — ini yang menjaga hub produksi tak turun senyap saat upgrade.
  it.each([
    ["HANOMAN_SESSION_SANDBOX", "podman"],
    ["HANOMAN_PUBLIC_ORIGINS", "https://help.example"],
    ["HANOMAN_TRUST_PROXY", "127.0.0.1/32"],
  ])("env ADR-0117 lama (%s) dibaca sebagai hardening menyala", (key, value) => {
    const env = { [key]: value };
    expect(resolveHardening(env)).toBe(true);
    expect(resolveDeployment(env)).toBe("public");
  });

  it("HANOMAN_SESSION_SANDBOX=off tidak menyalakan hardening", () => {
    expect(resolveHardening({ HANOMAN_SESSION_SANDBOX: "off" })).toBe(false);
  });

  it("env kosong/whitespace tidak dianggap terisi", () => {
    expect(resolveHardening({ HANOMAN_PUBLIC_ORIGINS: "  " })).toBe(false);
    expect(resolveHardening({ HANOMAN_TRUST_PROXY: "" })).toBe(false);
  });

  it("deployment=public sendirian TIDAK menyalakan hardening", () => {
    const env = { HANOMAN_DEPLOYMENT: "public" };
    expect(resolveDeployment(env)).toBe("public");
    expect(resolveHardening(env)).toBe(false);
  });

  it("hardening menyala memaksa deployment public walau env bilang local", () => {
    expect(resolveDeployment({ HANOMAN_DEPLOYMENT: "local", HANOMAN_HARDENING: "1" })).toBe("public");
  });
});
