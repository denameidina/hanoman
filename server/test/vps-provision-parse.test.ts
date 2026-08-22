// SPEC-883 · parser protokol baris provision.sh. Keluaran nyata bercampur peringatan apt,
// banner sudo, dan motd — baris di luar format WAJIB diabaikan, tak pernah melempar.
import { describe, it, expect } from "vitest";
import { parseComponents, parseProvisionSteps } from "../src/services/vps-provision";

describe("SPEC-883 · parseComponents", () => {
  it("membaca baris COMP sah", () => {
    expect(parseComponents("COMP node ok v22.11.0\nCOMP gh absent")).toEqual([
      { id: "node", status: "ok", detail: "v22.11.0" },
      { id: "gh", status: "absent", detail: "" },
    ]);
  });

  it("mengabaikan baris di luar format, tanpa melempar (pola parseAudit)", () => {
    expect(parseComponents("sudo: a password is required\nCOMP base ok x\nSTEP base ok y"))
      .toEqual([{ id: "base", status: "ok", detail: "x" }]);
  });

  it("status tak dikenal diabaikan — bukan diterima sebagai ok", () => {
    expect(parseComponents("COMP node maybe siapa-tahu")).toEqual([]);
  });

  it("id di luar katalog diabaikan", () => {
    expect(parseComponents("COMP wat ok x")).toEqual([]);
  });
});

describe("SPEC-883 · parseProvisionSteps", () => {
  it("membaca keempat status termasuk skip", () => {
    const out = [
      "STEP base ok terpasang",
      "STEP node skip blocked-by base",
      "STEP caddy fail dns-mismatch a != b",
      "STEP gh would akan dipasang",
    ].join("\n");
    expect(parseProvisionSteps(out)).toEqual([
      { item: "base", status: "ok", detail: "terpasang" },
      { item: "node", status: "skip", detail: "blocked-by base" },
      { item: "caddy", status: "fail", detail: "dns-mismatch a != b" },
      { item: "gh", status: "would", detail: "akan dipasang" },
    ]);
  });

  it("baris asing diabaikan", () => {
    expect(parseProvisionSteps("Reading package lists...\nSTEP base ok x")).toHaveLength(1);
  });
});
