import { describe, expect, it } from "vitest";
import {
  MAX_CONFIG_RESTARTS, MAX_UPDATE_RESTARTS, planSupervisorStep, resolveChildExit, spawnEnv,
} from "../src/commands/start";
import {
  CONFIG_RESTART_EXIT, MANUAL_RESTART_EXIT, UPDATE_RESTART_EXIT, formatExitIntent,
} from "@hanoman/shared";

// ADR-0227 · server yang macet di process.exit dibunuh SIGKILL oleh watchdog-nya sendiri; kode
// sentinel-nya (75/76/77) hanya tersisa di berkas maksud keluar.
describe("resolveChildExit (ADR-0227)", () => {
  const killed = (pid: number) => ({ code: null, signal: "SIGKILL" as const, pid });

  it("SIGKILL + maksud ber-PID sama = kode dari maksud, ditandai paksa", () => {
    expect(resolveChildExit(killed(10), formatExitIntent(10, UPDATE_RESTART_EXIT)))
      .toEqual({ code: UPDATE_RESTART_EXIT, forced: true });
  });

  it("maksud basi dari PID lain diabaikan", () => {
    expect(resolveChildExit(killed(10), formatExitIntent(9, MANUAL_RESTART_EXIT)))
      .toEqual({ code: 0, forced: false });
  });

  it("exit normal: kode aslinya yang dipakai walau berkas maksud ada", () => {
    expect(resolveChildExit({ code: CONFIG_RESTART_EXIT, signal: null, pid: 10 }, formatExitIntent(10, 0)))
      .toEqual({ code: CONFIG_RESTART_EXIT, forced: false });
  });

  it("SIGKILL tanpa maksud / maksud rusak: perilaku lama (0)", () => {
    expect(resolveChildExit(killed(10), null)).toEqual({ code: 0, forced: false });
    expect(resolveChildExit(killed(10), "sampah")).toEqual({ code: 0, forced: false });
  });
});

describe("supervisor (SPEC-884)", () => {
  it("exit 76 = jalankan ulang TANPA memasang apa pun", () => {
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, 0, 0)).toEqual({ action: "restart" });
  });

  it("jatah restart config terpisah dari jatah update", () => {
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, MAX_UPDATE_RESTARTS, 0)).toEqual({ action: "restart" });
    expect(planSupervisorStep(CONFIG_RESTART_EXIT, 0, MAX_CONFIG_RESTARTS))
      .toEqual({ action: "exit", code: CONFIG_RESTART_EXIT });
  });

  it("exit 77 (tombol Mulai ulang) = jalankan ulang tanpa jatah", () => {
    expect(planSupervisorStep(MANUAL_RESTART_EXIT, MAX_UPDATE_RESTARTS, MAX_CONFIG_RESTARTS)).toEqual({ action: "restart" });
  });

  it("perilaku lama tak berubah", () => {
    expect(planSupervisorStep(UPDATE_RESTART_EXIT, 0, 0)).toEqual({ action: "update" });
    expect(planSupervisorStep(0, 0, 0)).toEqual({ action: "exit", code: 0 });
    expect(planSupervisorStep(1, 0, 0)).toEqual({ action: "exit", code: 1 });
  });
});

describe("presedensi env spawn (SPEC-884)", () => {
  const file = { HANOMAN_HARDENING: "1", HANOMAN_DEPLOYMENT: "public", ONLY_FILE: "f" };
  const proc = { HANOMAN_HARDENING: "", PATH: "/bin" };
  const server = { NODE_ENV: "production", HANOMAN_SUPERVISOR: "1" };

  it("env proses (systemd/shell) MENGALAHKAN config.env", () => {
    expect(spawnEnv(file, proc, server).HANOMAN_HARDENING).toBe("");
  });

  it("kunci yang hanya ada di berkas tetap terbawa", () => {
    expect(spawnEnv(file, proc, server).ONLY_FILE).toBe("f");
    expect(spawnEnv(file, proc, server).HANOMAN_DEPLOYMENT).toBe("public");
  });

  it("serverEnv() tetap paling kuat", () => {
    expect(spawnEnv({ NODE_ENV: "development" }, { NODE_ENV: "test" }, server).NODE_ENV).toBe("production");
    expect(spawnEnv(file, proc, server).HANOMAN_SUPERVISOR).toBe("1");
  });
});
