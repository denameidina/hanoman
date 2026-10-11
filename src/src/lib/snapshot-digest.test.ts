import { describe, it, expect, vi } from "vitest";
import { applyIfChanged, digestOf } from "./snapshot-digest";

describe("digestOf", () => {
  it("sama untuk isi sama walau referensi beda", () => {
    expect(digestOf([{ id: "a", n: 1 }])).toBe(digestOf(structuredClone([{ id: "a", n: 1 }])));
  });
  it("berbeda saat isi berubah atau item bertambah/hilang", () => {
    const d = digestOf([{ id: "a", n: 1 }]);
    expect(digestOf([{ id: "a", n: 2 }])).not.toBe(d);
    expect(digestOf([{ id: "a", n: 1 }, { id: "b", n: 1 }])).not.toBe(d);
    expect(digestOf([])).not.toBe(d);
  });
  it("tetap berupa string untuk undefined (tak melempar)", () => {
    expect(digestOf(undefined)).toBe("");
    expect(digestOf(null)).toBe("null");
  });
});

describe("applyIfChanged", () => {
  it("tak memanggil setter bila isi sama — frame identik tak menyentuh state", () => {
    const set = vi.fn();
    const shown = [{ id: "s1", exited: false }];
    const applied = applyIfChanged(shown, [{ id: "s1", exited: false }], set);
    expect(applied).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("memanggil setter dengan nilai baru bila isi berubah", () => {
    const set = vi.fn();
    const next = [{ id: "s1", exited: true }];
    const applied = applyIfChanged([{ id: "s1", exited: false }], next, set);
    expect(applied).toBe(true);
    expect(set).toHaveBeenCalledWith(next);
  });

  it("menerima digest khusus, mis. mengabaikan kolom yang selalu berganti", () => {
    const set = vi.fn();
    const digest = (v: { id: string; at: number }) => v.id;
    expect(applyIfChanged({ id: "x", at: 1 }, { id: "x", at: 2 }, set, digest)).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("nilai null tampil sebagai belum ada frame, frame pertama selalu menang", () => {
    const set = vi.fn();
    expect(applyIfChanged<{ triage: number } | null>(null, { triage: 0 }, set)).toBe(true);
    expect(set).toHaveBeenCalledWith({ triage: 0 });
  });
});
