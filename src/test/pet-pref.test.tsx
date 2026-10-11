// Preferensi pet (ui-state `hn.ui.v1.pet.enabled`): default per tier, dan nilai yang sama terbaca oleh setiap
// pemakainya. Palet menulis, App membaca — dua pembaca harus langsung sinkron tanpa reload.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  petVisibleOn, readPetEnabled, usePetEnabled, writePetEnabled,
} from "../src/ui-state/pet-pref";

const KEY = "hn.ui.v1.pet.enabled";

beforeEach(() => {
  localStorage.clear();
  writePetEnabled(null);   // mulai dari "belum dipilih"; juga mengosongkan nilai di memori modul
});
afterEach(() => { vi.restoreAllMocks(); });

describe("petVisibleOn: preferensi eksplisit menang; tanpa itu tier yang memutuskan", () => {
  it("belum dipilih: desktop tampil, tablet dan ponsel mati (lajur 0)", () => {
    expect(petVisibleOn(null, "desktop")).toBe(true);
    expect(petVisibleOn(null, "tablet")).toBe(false);
    expect(petVisibleOn(null, "mobile")).toBe(false);
  });

  it("dinyalakan eksplisit: tampil di tier mana pun", () => {
    expect(petVisibleOn(true, "mobile")).toBe(true);
    expect(petVisibleOn(true, "tablet")).toBe(true);
  });

  it("dimatikan eksplisit: mati di tier mana pun, termasuk desktop", () => {
    expect(petVisibleOn(false, "desktop")).toBe(false);
  });
});

describe("penyimpanan ui-state", () => {
  it("menulis ke kunci hn.ui.v1.pet.enabled dan membacanya kembali", () => {
    writePetEnabled(true);
    expect(localStorage.getItem(KEY)).toBe("true");
    expect(readPetEnabled()).toBe(true);
  });

  it("nilai rusak di storage jatuh ke default (belum dipilih), bukan ke tipe yang salah", async () => {
    // Modul baru: memori belum terisi, jadi pembacaan benar-benar dari storage.
    vi.resetModules();
    const fresh = await import("../src/ui-state/pet-pref");
    localStorage.setItem(KEY, JSON.stringify("ya"));
    expect(fresh.readPetEnabled()).toBeNull();
    localStorage.setItem(KEY, "false");
    expect(fresh.readPetEnabled()).toBe(false);
  });

  it("storage yang melempar (mode privat) tak membuat pilihan hilang di sesi ini", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("private"); });
    writePetEnabled(false);
    expect(readPetEnabled()).toBe(false);
  });
});

describe("usePetEnabled: satu sumber untuk semua pemakai", () => {
  it("penulisan dari satu pemakai langsung terlihat oleh pemakai lain (palet → pet)", () => {
    const palette = renderHook(() => usePetEnabled());
    const pet = renderHook(() => usePetEnabled());
    expect(pet.result.current[0]).toBeNull();

    act(() => { palette.result.current[1](true); });
    expect(pet.result.current[0]).toBe(true);
    expect(palette.result.current[0]).toBe(true);

    act(() => { pet.result.current[1](false); });
    expect(palette.result.current[0]).toBe(false);
  });
});
