import { describe, expect, it } from "vitest";
import { CONFIG_RESTART_EXIT, UPDATE_RESTART_EXIT, zSetupApply } from "../src/dto";
import { paths } from "../src/api";

describe("kontrak setup (SPEC-884)", () => {
  it("sentinel restart config terpisah dari sentinel update", () => {
    expect(CONFIG_RESTART_EXIT).toBe(76);
    expect(CONFIG_RESTART_EXIT).not.toBe(UPDATE_RESTART_EXIT);
  });

  it("zSetupApply menerima bentuk minimal dan menolak deployment asing", () => {
    expect(zSetupApply.safeParse({ deployment: "local", hardening: false }).success).toBe(true);
    expect(zSetupApply.safeParse({ deployment: "staging", hardening: false }).success).toBe(false);
    expect(zSetupApply.safeParse({ deployment: "public" }).success).toBe(false);
  });

  it("path setup terdaftar", () => {
    expect(paths.setupStatus).toBe("/api/setup/status");
    expect(paths.setupApply).toBe("/api/setup");
  });
});
