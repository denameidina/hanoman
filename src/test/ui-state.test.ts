import { describe, it, expect, beforeEach } from "vitest";
import {
  UI_PREFIX, UI_VERSION, scoped, uiKey, uiScreenPrefix,
  readUiState, writeUiState, resetUiState, pruneUiState, onUiReset,
  isNum, nullableStr, oneOf, strList,
} from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

describe("bentuk kunci", () => {
  it("berversi & ber-namespace", () => {
    expect(uiKey("backlog", "q")).toBe("hn.ui.v1.backlog.q");
    expect(UI_PREFIX).toBe("hn.ui");
    expect(UI_VERSION).toBe("v1");
  });
  it("scope project menyisip sebelum field", () => {
    expect(uiKey(scoped("changelog", "erp"), "q")).toBe("hn.ui.v1.changelog@erp.q");
  });
  it("scope kosong tak mengubah screen", () => {
    expect(scoped("changelog", "")).toBe("changelog");
    expect(scoped("changelog", null)).toBe("changelog");
  });
  it("prefix layar mengunci pada titik pemisah field", () => {
    expect(uiScreenPrefix("backlog")).toBe("hn.ui.v1.backlog.");
  });
});

describe("baca/tulis", () => {
  it("round-trip", () => {
    writeUiState(uiKey("backlog", "q"), "invoice");
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("invoice");
  });
  it("kunci kosong → default", () => {
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(1);
  });
  it("JSON rusak → default, tanpa melempar", () => {
    localStorage.setItem(uiKey("backlog", "q"), "{bukan json");
    expect(() => readUiState(uiKey("backlog", "q"), "")).not.toThrow();
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
  });
  it("tipe tak cocok default → default", () => {
    writeUiState(uiKey("backlog", "page"), "abc");
    expect(readUiState(uiKey("backlog", "page"), 1)).toBe(1);
  });
  it("angka tak hingga ditolak", () => {
    localStorage.setItem(uiKey("backlog", "scroll"), "null");
    expect(readUiState(uiKey("backlog", "scroll"), 0)).toBe(0);
  });
  it("accept menolak nilai di luar union", () => {
    const view = oneOf("grid", "list", "board");
    writeUiState(uiKey("backlog", "view"), "kanban");
    expect(readUiState(uiKey("backlog", "view"), "grid", view)).toBe("grid");
    writeUiState(uiKey("backlog", "view"), "list");
    expect(readUiState(uiKey("backlog", "view"), "grid", view)).toBe("list");
  });
  it("nullableStr menerima null maupun string", () => {
    writeUiState(uiKey("backlog", "detailId"), null);
    expect(readUiState<string | null>(uiKey("backlog", "detailId"), null, nullableStr)).toBeNull();
    writeUiState(uiKey("backlog", "detailId"), "SPEC-1");
    expect(readUiState<string | null>(uiKey("backlog", "detailId"), null, nullableStr)).toBe("SPEC-1");
  });
  it("strList menolak array bercampur", () => {
    writeUiState(uiKey("triage", "picked"), ["a", 2]);
    expect(readUiState<string[]>(uiKey("triage", "picked"), [], strList)).toEqual([]);
  });
  it("isNum dipakai sebagai accept eksplisit", () => {
    writeUiState(uiKey("lead", "decPage"), 3);
    expect(readUiState(uiKey("lead", "decPage"), 1, isNum)).toBe(3);
  });
});

describe("versi", () => {
  it("nilai versi lama tak terbaca", () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
  });
  it("prune membuang versi lain & menyisakan versi berjalan", () => {
    localStorage.setItem("hn.ui.v0.backlog.q", JSON.stringify("lama"));
    writeUiState(uiKey("backlog", "q"), "baru");
    pruneUiState();
    expect(localStorage.getItem("hn.ui.v0.backlog.q")).toBeNull();
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("baru");
  });
  it("prune tak menyentuh kunci di luar namespace", () => {
    localStorage.setItem("hanoman.terminal.workspace", "{}");
    pruneUiState();
    expect(localStorage.getItem("hanoman.terminal.workspace")).toBe("{}");
  });
});

describe("reset", () => {
  it("hanya menghapus kunci layar itu", () => {
    writeUiState(uiKey("backlog", "q"), "a");
    writeUiState(uiKey("triage", "q"), "b");
    resetUiState("backlog");
    expect(readUiState(uiKey("backlog", "q"), "")).toBe("");
    expect(readUiState(uiKey("triage", "q"), "")).toBe("b");
  });
  it("reset ber-scope tak menyentuh project lain", () => {
    writeUiState(uiKey(scoped("changelog", "a"), "q"), "qa");
    writeUiState(uiKey(scoped("changelog", "b"), "q"), "qb");
    resetUiState(scoped("changelog", "a"));
    expect(readUiState(uiKey(scoped("changelog", "a"), "q"), "")).toBe("");
    expect(readUiState(uiKey(scoped("changelog", "b"), "q"), "")).toBe("qb");
  });
  it("memancarkan prefix ke pendengar", () => {
    const seen: string[] = [];
    const off = onUiReset((p) => seen.push(p));
    resetUiState("backlog");
    off();
    resetUiState("triage");
    expect(seen).toEqual(["hn.ui.v1.backlog."]);
  });
});
