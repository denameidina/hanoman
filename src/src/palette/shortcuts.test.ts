import { describe, expect, it } from "vitest";
import { HN_NAV } from "../ds/shell";
import {
  CHORD_IDLE, CHORD_KEYS, CHORD_WINDOW_MS, isMacPlatform, paletteShortcutLabel, shortcutSections, stepChord,
} from "./shortcuts";

const NAV_KEYS = HN_NAV.map((n) => n.key);

describe("stepChord · g lalu huruf", () => {
  it("g menyalakan chord dan dikonsumsi; huruf dalam jendela memilih layar", () => {
    const armed = stepChord(CHORD_IDLE, "g", 1000, NAV_KEYS);
    expect(armed.consumed).toBe(true);
    expect(armed.state.armedAt).toBe(1000);
    const go = stepChord(armed.state, "b", 1000 + CHORD_WINDOW_MS, NAV_KEYS);
    expect(go.target).toBe("backlog");
    expect(go.state).toEqual(CHORD_IDLE);
  });

  it("huruf huruf sesudah jendela 1 dtk tak memilih layar", () => {
    const armed = stepChord(CHORD_IDLE, "g", 1000, NAV_KEYS);
    const late = stepChord(armed.state, "b", 1000 + CHORD_WINDOW_MS + 1, NAV_KEYS);
    expect(late.target).toBeUndefined();
    expect(late.consumed).toBe(false);
  });

  it("huruf kapital pun dikenali (Shift+G lalu B)", () => {
    const armed = stepChord(CHORD_IDLE, "G", 0, NAV_KEYS);
    expect(stepChord(armed.state, "B", 10, NAV_KEYS).target).toBe("backlog");
  });

  it("huruf yang tak punya peta membatalkan chord dan tidak dikonsumsi (agar ? dan / tetap jalan)", () => {
    const armed = stepChord(CHORD_IDLE, "g", 0, NAV_KEYS);
    const cancel = stepChord(armed.state, "?", 10, NAV_KEYS);
    expect(cancel.consumed).toBe(false);
    expect(cancel.state).toEqual(CHORD_IDLE);
  });

  it("layar yang tak ada di navKeys (mis. Klien saat gerbang mati) tak pernah dituju", () => {
    const armed = stepChord(CHORD_IDLE, "g", 0, NAV_KEYS.filter((k) => k !== "clients"));
    expect(stepChord(armed.state, "k", 10, NAV_KEYS.filter((k) => k !== "clients")).target).toBeUndefined();
  });

  it("g kedua menyalakan ulang chord, tidak membatalkannya", () => {
    const armed = stepChord(CHORD_IDLE, "g", 0, NAV_KEYS);
    const again = stepChord(armed.state, "g", 500, NAV_KEYS);
    expect(again.consumed).toBe(true);
    expect(stepChord(again.state, "t", 600, NAV_KEYS).target).toBe("terminal");
  });
});

describe("peta chord", () => {
  it("setiap entri HN_NAV punya huruf, dan setiap huruf menunjuk ke entri HN_NAV yang ada", () => {
    const targets = Object.values(CHORD_KEYS);
    for (const key of NAV_KEYS) expect(targets, `nav ${key} tak punya huruf`).toContain(key);
    for (const target of targets) expect(NAV_KEYS, `huruf menunjuk ${target} yang tak ada`).toContain(target);
  });

  it("huruf tiap layar unik (satu huruf = satu layar)", () => {
    const letters = Object.keys(CHORD_KEYS);
    expect(new Set(letters).size).toBe(letters.length);
  });
});

describe("shortcutSections", () => {
  it("daftar pindah layar mengikuti nav yang diberikan dan menampilkan huruf chord-nya", () => {
    const sections = shortcutSections(false, [{ key: "backlog", label: "Backlog" }, { key: "settings", label: "Settings" }]);
    const nav = sections.find((s) => s.title.startsWith("Pindah"))!;
    expect(nav.rows).toEqual([
      { keys: ["g", "b"], label: "Backlog" },
      { keys: ["g", "s"], label: "Settings" },
    ]);
  });

  it("label Mac memakai ⌘, lainnya Ctrl", () => {
    expect(shortcutSections(true, []).find((s) => s.title === "Global")!.rows[0]!.keys).toEqual(["⌘", "K"]);
    expect(shortcutSections(false, []).find((s) => s.title === "Global")!.rows[0]!.keys).toEqual(["Ctrl", "K"]);
    expect(paletteShortcutLabel(true)).toBe("⌘K");
    expect(paletteShortcutLabel(false)).toBe("Ctrl K");
  });

  it("isMacPlatform membaca platform dan user agent", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isMacPlatform({ platform: "Win32", userAgent: "Windows NT" })).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});
