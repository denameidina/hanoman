import { describe, it, expect } from "vitest";
import { zSetting, zTerminalSession, paths } from "../src/index";
import { zSpecSource, zTicketCategory, zTicketStatus } from "../src/enums";
import { flowForSource } from "../src/dto";

// SPEC-253 · Help Center: source `help`, enum kategori & status tiket.
describe("SPEC-253 · Help Center enums", () => {
  it("zSpecSource menerima help; flowForSource(help) = feature", () => {
    expect(zSpecSource.safeParse("help").success).toBe(true);
    expect(flowForSource("help")).toBe("feature");
  });
  it("zTicketCategory valid & tolak lainnya", () => {
    for (const c of ["bug", "fitur", "pertanyaan", "lainnya"]) expect(zTicketCategory.parse(c)).toBe(c);
    expect(zTicketCategory.safeParse("spam").success).toBe(false);
  });
  it("zTicketStatus valid & tolak lainnya", () => {
    for (const s of ["new", "accepted", "rejected"]) expect(zTicketStatus.parse(s)).toBe(s);
    expect(zTicketStatus.safeParse("closed").success).toBe(false);
  });
});

// SPEC-237 · source+flow audit (audit-only: dokumen, tanpa perbaikan).
describe("SPEC-237 · source audit", () => {
  it("zSpecSource menerima brief, qa, audit", () => {
    for (const s of ["brief", "qa", "audit"]) expect(zSpecSource.safeParse(s).success).toBe(true);
    expect(zSpecSource.safeParse("hantu").success).toBe(false);
  });
  it("flowForSource memetakan source → flow", () => {
    expect(flowForSource("brief")).toBe("feature");
    expect(flowForSource("qa")).toBe("qa");
    expect(flowForSource("audit")).toBe("audit");
    expect(flowForSource("apapun")).toBe("feature");
  });
});

// SPEC-157 (`awaiting`, zAsk, zAnswer) dicabut bersama runner headless: agen bertanya di
// terminalnya sendiri, dan manusia menjawab di sana (SPEC-162).
describe("SPEC-162 · kontrak sesi interaktif", () => {
  it("zSetting memberi model + effort default", () => {
    const s = zSetting.parse({ autoDefault: true, autoScaffold: true, notifyFail: true });
    expect(s.model).toBe("sonnet");
    expect(s.effort).toBe("medium");
  });

  it("zTerminalSession menerima sesi project maupun sesi backlog", () => {
    expect(zTerminalSession.safeParse({ project: "p1" }).success).toBe(true);
    expect(zTerminalSession.safeParse({ spec: "SPEC-1", flow: "feature" }).success).toBe(true);
  });

  // `flow` wajib: prompt awal tak bisa disusun tanpanya, dan default diam-diam akan
  // menjalankan pipeline yang salah untuk backlog item qa.
  it("zTerminalSession menolak spec tanpa flow, dan flow yang tak dikenal", () => {
    expect(zTerminalSession.safeParse({ spec: "SPEC-1" }).success).toBe(false);
    expect(zTerminalSession.safeParse({ spec: "SPEC-1", flow: "hantu" }).success).toBe(false);
  });

  it("paths.terminalPhases", () =>
    expect(paths.terminalPhases("spec-1")).toBe("/api/terminal/sessions/spec-1/phases"));
});

// SPEC-407 · source `goal`: backlog yang langsung dikejar sesi mode goal, tanpa fase perencanaan.
describe("SPEC-407 · source goal", () => {
  it("zSpecSource menerima goal", () => {
    expect(zSpecSource.safeParse("goal").success).toBe(true);
  });
  it("flowForSource(goal) = goal, source lain tak bergeser", () => {
    expect(flowForSource("goal")).toBe("goal");
    expect(flowForSource("brief")).toBe("feature");
    expect(flowForSource("qa")).toBe("qa");
    expect(flowForSource("audit")).toBe("audit");
  });
});
