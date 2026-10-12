// Audit UI/UX 2026-10 · Fase 3E · logika murni rail sesi (urutan, status, fokus, keyboard).
import { describe, it, expect } from "vitest";
import type { TerminalSession } from "../src/api/client";
import {
  isTerminalView, railStartedMs, railStatus, railTarget, resolveFocus, sortRail,
} from "../src/screens/terminal-rail";

const s = (id: string, extra: Partial<TerminalSession> = {}): TerminalSession =>
  ({ id, projectId: "p1", cwd: "", exited: false, ...extra }) as TerminalSession;

describe("railStatus", () => {
  it("exited dengan kode ≠ 0 = Gagal, dengan kode 0/undefined = Selesai", () => {
    expect(railStatus(s("a", { exited: true, exitCode: 143 }), false))
      .toEqual({ tone: "failed", label: "Gagal · exit 143" });
    expect(railStatus(s("a", { exited: true, exitCode: 0 }), false))
      .toEqual({ tone: "done", label: "Selesai" });
    expect(railStatus(s("a", { exited: true }), false).tone).toBe("done");
  });

  it("decision = Menunggu keputusan; deciding menang atasnya (Lead memutuskan)", () => {
    expect(railStatus(s("a", { decision: true }), false))
      .toEqual({ tone: "attention", label: "Menunggu keputusan" });
    expect(railStatus(s("a", { decision: true, deciding: true }), false))
      .toEqual({ tone: "attention", label: "Lead memutuskan" });
  });

  it("exited menang atas decision (sesi yang sudah beku tak lagi menunggu)", () => {
    expect(railStatus(s("a", { exited: true, decision: true, exitCode: 0 }), false).tone).toBe("done");
  });

  it("plan tuntas di pane hidup = Selesai; selain itu Berjalan", () => {
    expect(railStatus(s("a"), true)).toEqual({ tone: "done", label: "Selesai" });
    expect(railStatus(s("a", { specId: "SPEC-1" }), false)).toEqual({ tone: "running", label: "Berjalan" });
    // Sesi bebas (tanpa spec) tidak diklaim "Berjalan": ia hanya terbuka.
    expect(railStatus(s("a"), false)).toEqual({ tone: "open", label: "Terbuka" });
  });
});

describe("sortRail", () => {
  it("mengelompokkan: butuh keputusan → berjalan → gagal → selesai", () => {
    const sessions = [
      s("done", { exited: true, exitCode: 0 }), s("fail", { exited: true, exitCode: 2 }), s("run"),
      s("att", { decision: true, decisionAt: "2026-10-11T08:00:00.000Z" }),
    ];
    expect(sortRail(sessions, new Set()).map((x) => x.id)).toEqual(["att", "run", "fail", "done"]);
  });

  it("tuntas lewat finishedIds memindahkan sesi berjalan ke grup Selesai", () => {
    const sessions = [s("run"), s("other")];
    expect(sortRail(sessions, new Set(["run"])).map((x) => x.id)).toEqual(["other", "run"]);
  });

  it("'butuh keputusan' yang paling lama menunggu tampil lebih dulu; tanpa stempel di belakang", () => {
    const sessions = [
      s("baru", { decision: true, decisionAt: "2026-10-11T09:00:00.000Z" }),
      s("tanpa", { decision: true }),
      s("lama", { decision: true, decisionAt: "2026-10-11T07:00:00.000Z" }),
    ];
    expect(sortRail(sessions, new Set()).map((x) => x.id)).toEqual(["lama", "baru", "tanpa"]);
  });

  it("grup lain mempertahankan urutan masuk (baris tak melompat tiap frame WS)", () => {
    const sessions = [s("r2"), s("r1"), s("r3")];
    expect(sortRail(sessions, new Set()).map((x) => x.id)).toEqual(["r2", "r1", "r3"]);
  });
});

describe("resolveFocus", () => {
  const ordered = [s("a"), s("b")];
  it("memakai focusId bila masih hidup", () => {
    expect(resolveFocus(ordered, "b")?.id).toBe("b");
  });
  it("jatuh ke baris pertama rail bila focusId null atau sudah lenyap", () => {
    expect(resolveFocus(ordered, null)?.id).toBe("a");
    expect(resolveFocus(ordered, "hilang")?.id).toBe("a");
  });
  it("null bila tak ada sesi", () => {
    expect(resolveFocus([], "a")).toBeNull();
  });
});

describe("railTarget", () => {
  it("↑/↓ tanpa berputar di ujung; Home/End ke ujung", () => {
    expect(railTarget(0, "ArrowDown", 3)).toBe(1);
    expect(railTarget(2, "ArrowDown", 3)).toBe(2);
    expect(railTarget(0, "ArrowUp", 3)).toBe(0);
    expect(railTarget(1, "Home", 3)).toBe(0);
    expect(railTarget(0, "End", 3)).toBe(2);
  });
  it("indeks -1 (belum ada fokus) dianggap baris pertama", () => {
    expect(railTarget(-1, "ArrowDown", 3)).toBe(1);
  });
  it("tombol lain dan daftar kosong tak menghasilkan tujuan", () => {
    expect(railTarget(0, "Enter", 3)).toBeNull();
    expect(railTarget(0, "ArrowDown", 0)).toBeNull();
  });
});

describe("railStartedMs & isTerminalView", () => {
  it("startedAt server (detik epoch) dikonversi ke ms; 0/absen = tak diketahui", () => {
    expect(railStartedMs({ ...s("a"), startedAt: 1_780_000_000 } as TerminalSession)).toBe(1_780_000_000_000);
    expect(railStartedMs({ ...s("a"), startedAt: 0 } as TerminalSession)).toBeNull();
    expect(railStartedMs(s("a"))).toBeNull();
  });
  it("hanya 'focus' dan 'grid' yang sah", () => {
    expect(isTerminalView("focus")).toBe(true);
    expect(isTerminalView("grid")).toBe(true);
    expect(isTerminalView("tabs")).toBe(false);
    expect(isTerminalView(1)).toBe(false);
  });
});
