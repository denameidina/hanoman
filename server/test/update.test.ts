import { describe, it, expect } from "vitest";
import { composeUpdate, UPDATE_COMMAND } from "../src/services/update";

const base = {
  currentVersion: "0.1.0", latestVersion: null,
  registryStatus: "unavailable" as const, checkedAt: null, canApply: false,
};

describe("composeUpdate", () => {
  it("registry tak terjangkau → tak ada update, tanpa perintah", () => {
    const u = composeUpdate(base);
    expect(u.updateAvailable).toBe(false);
    expect(u.command).toBe("");
  });
  it("versi terbaru lebih tinggi → ada update + perintah npm", () => {
    const u = composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok", checkedAt: "2026-07-30T00:00:00Z" });
    expect(u.updateAvailable).toBe(true);
    expect(u.command).toBe(UPDATE_COMMAND);
    expect(u.registry).toEqual({ status: "ok", checkedAt: "2026-07-30T00:00:00Z" });
  });
  it("versi sama → tak ada update", () => {
    expect(composeUpdate({ ...base, latestVersion: "0.1.0", registryStatus: "ok" }).updateAvailable).toBe(false);
  });
  it("registry lebih tua dari yang jalan (dev di depan rilis) → tak ada update", () => {
    expect(composeUpdate({ ...base, currentVersion: "0.3.0", latestVersion: "0.2.0", registryStatus: "ok" }).updateAvailable).toBe(false);
  });
  it("latestVersion ada tapi status unavailable → tetap tak ada update (status yang menentukan)", () => {
    expect(composeUpdate({ ...base, latestVersion: "9.9.9" }).updateAvailable).toBe(false);
  });
  it("perintahnya memasang paket global bernama hanoman", () => {
    expect(UPDATE_COMMAND).toBe("npm i -g hanoman@latest --prefer-online");
  });
});

describe("canApply (SPEC-405 · ADR-0088)", () => {
  it("diwariskan apa adanya, tak diturunkan dari updateAvailable", () => {
    expect(composeUpdate({ ...base, canApply: true }).canApply).toBe(true);
    expect(composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok" }).canApply).toBe(false);
  });
  it("tak pernah menyalakan dirinya sendiri saat ada update", () => {
    const u = composeUpdate({ ...base, latestVersion: "0.2.0", registryStatus: "ok", canApply: false });
    expect(u.updateAvailable).toBe(true);
    expect(u.canApply).toBe(false);
  });
});
