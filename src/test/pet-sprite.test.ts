import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PET_ATLAS_URL, PET_MANIFEST, PET_ROW_KEYS, POSE_ROW, durationMs, parsePetManifest, rowIndex, rowOf, thenOf,
} from "../src/screens/pet-sprite";
import type { PetPose } from "../src/screens/pet-state";

const POSES: PetPose[] = ["ready", "sleeping", "working", "deciding", "waiting", "blocked", "review",
  "shipped", "docs-updated", "offline"];

describe("manifest atlas pet (PET-001)", () => {
  it("pet.json yang dikomit lolos validasi dan barisnya berurutan", () => {
    expect(PET_MANIFEST.id).toBe("PET-001");
    expect(PET_MANIFEST.rows.map((r) => r.key)).toEqual([...PET_ROW_KEYS]);
    expect(PET_MANIFEST.cell).toEqual({ w: 192, h: 208 });
    expect(PET_MANIFEST.columns).toBe(8);
    expect(PET_MANIFEST.character.h).toBeLessThanOrEqual(PET_MANIFEST.cell.h);
    expect(PET_ATLAS_URL).toMatch(/\.webp$/);
  });

  it("memuat baris SPEC-897/898/904 di ekor, indeks baris lama tak bergeser", () => {
    expect(PET_MANIFEST.version).toBe(2);
    expect(PET_MANIFEST.rows.length).toBe(16);
    expect(PET_MANIFEST.rows.map((r) => r.key).slice(10)).toEqual(
      ["deciding", "sleep", "thanks", "held", "falling", "dizzy"]);
    expect(rowIndex("wave")).toBe(9);
    expect(rowIndex("deciding")).toBe(10);
    expect(rowIndex("sleep")).toBe(11);
    // SPEC-898 · baris reaksi, bukan pose: ia hanya bisa dipilih oleh `oneShot`.
    expect(rowIndex("thanks")).toBe(12);
    expect(rowOf("thanks").loop).toBe(false);
    expect(thenOf("thanks")).toBe("idle");
    expect(Object.values(POSE_ROW)).not.toContain("thanks");
    expect(durationMs("deciding")).toBe(Math.round((8 / 6) * 1000));
    expect(durationMs("sleep")).toBe(2000);   // 8 frame @ 4 fps
    expect(rowOf("sleep").loop).toBe(true);
    expect(thenOf("sleep")).toBeNull();
  });

  it("tiga baris SPEC-904 duduk di ekor dan bukan pose", () => {
    expect(rowIndex("held")).toBe(13);
    expect(rowIndex("falling")).toBe(14);
    expect(rowIndex("dizzy")).toBe(15);
    // `held`/`falling` diputar selama seretan berlangsung → loop tanpa `then`.
    for (const key of ["held", "falling"] as const) {
      expect(rowOf(key).loop).toBe(true);
      expect(thenOf(key)).toBeNull();
      expect(durationMs(key)).toBe(1000);     // 8 frame @ 8 fps
    }
    // `dizzy` sekali putar lalu pet BERDIRI LAGI.
    expect(rowOf("dizzy").loop).toBe(false);
    expect(thenOf("dizzy")).toBe("idle");
    expect(durationMs("dizzy")).toBe(1000);
    // Ketiganya baris interaksi, bukan pose mesin: `POSE_ROW` tak menyentuhnya.
    for (const key of ["held", "falling", "dizzy"] as const) {
      expect(Object.values(POSE_ROW)).not.toContain(key);
    }
  });

  it("indeks baris, durasi satu putaran, dan rantai then", () => {
    expect(rowIndex("idle")).toBe(0);
    expect(rowIndex("wave")).toBe(9);
    expect(durationMs("idle")).toBe(Math.round(8 / 6 * 1000));
    expect(durationMs("walk-right")).toBe(800);
    expect(thenOf("shipped")).toBe("idle");
    expect(thenOf("wave")).toBe("idle");
    expect(thenOf("idle")).toBeNull();
  });

  it("POSE_ROW total atas sepuluh pose; hanya ready, sleeping, dan offline berganti nama", () => {
    for (const pose of POSES) expect(PET_ROW_KEYS).toContain(POSE_ROW[pose]);
    expect(Object.keys(POSE_ROW).sort()).toEqual([...POSES].sort());
    expect(POSES.filter((p) => POSE_ROW[p] !== p)).toEqual(["ready", "sleeping", "offline"]);
    expect(POSE_ROW.ready).toBe("idle");
    expect(POSE_ROW.sleeping).toBe("sleep");
    // `offline` sengaja menumpang `idle`: pudar + kalimat sudah mengatakan "aku tak tahu".
    expect(POSE_ROW.offline).toBe("idle");
  });

  it("menolak manifest yang barisnya kurang, salah urutan, atau then pada baris loop", () => {
    const ok = JSON.parse(JSON.stringify(PET_MANIFEST)) as { rows: Record<string, unknown>[] };
    expect(() => parsePetManifest({ ...ok, rows: ok.rows.slice(1) })).toThrow(new RegExp(`butuh ${PET_ROW_KEYS.length} baris`));
    const swapped = { ...ok, rows: [ok.rows[1], ok.rows[0], ...ok.rows.slice(2)] };
    expect(() => parsePetManifest(swapped)).toThrow(/rows\[0\]/);
    const badThen = { ...ok, rows: ok.rows.map((r, i) => (i === 0 ? { ...r, then: "wave" } : r)) };
    expect(() => parsePetManifest(badThen)).toThrow(/then hanya untuk/);
    const noThen = { ...ok, rows: ok.rows.map((r) => (r.key === "wave" ? { key: "wave", fps: 10, loop: false } : r)) };
    expect(() => parsePetManifest(noThen)).toThrow(/tanpa then/);
  });
});

// `import.meta.url` di bawah transform Vite bukan URL ber-skema `file:`, jadi berkasnya dicari
// dari cwd — yang berbeda antara run tingkat-paket (`src/`) dan tingkat-root.
function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

describe("CSS sprite pet (kontrak rule terparse)", () => {
  const style = document.createElement("style");
  style.textContent = read("src/app.css");
  document.head.append(style);
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const keyframes = rules.filter((rule): rule is CSSKeyframesRule =>
    rule.type === CSSRule.KEYFRAMES_RULE && (rule as CSSKeyframesRule).name.startsWith("hn-pet-"));

  it("hanya keyframe interaksi + frame sprite yang tersisa; katalog idle/pose SPEC-648 dicabut", () => {
    expect(keyframes.map((rule) => rule.name)).toEqual([
      "hn-pet-frames", "hn-pet-click", "hn-pet-panel-in", "hn-pet-panel-out", "hn-pet-reveal",
      "hn-pet-bubble-in", "hn-pet-heart",
    ]);
  });

  it("setiap keyframe pet hanya mengubah transform/opacity", () => {
    for (const rule of keyframes) {
      for (const frame of [...rule.cssRules] as CSSKeyframeRule[]) {
        const properties = Array.from({ length: frame.style.length }, (_, i) => frame.style[i]!);
        expect(properties.length, `${rule.name} ${frame.keyText}`).toBeGreaterThan(0);
        expect(properties.every((p) => p === "transform" || p === "opacity"), `${rule.name} ${frame.keyText}`).toBe(true);
      }
    }
  });

  it("baris dipilih lewat --row pada .hn-pet-rowshift dan hover dikecualikan saat reduced-motion", () => {
    const styleRules = rules.filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE);
    const rowshift = styleRules.find((rule) => rule.selectorText === ".hn-pet-rowshift");
    expect(rowshift?.style.transform).toBe("translateY(calc(var(--row, 0) * -100%))");
    expect(styleRules.map((rule) => rule.selectorText)).toContain(
      '.hn-pet-stage:not([data-reduced-motion="true"]):hover .hn-pet-reactor');
    expect(styleRules.some((rule) => rule.selectorText === ".hn-sr-only")).toBe(true);
  });
});
