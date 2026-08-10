import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POSE_ART, type PetPose } from "../src/screens/pet-state";
import { motionForPose } from "../src/screens/pet-motion";

function read(relative: string): string {
  const found = [resolve(process.cwd(), relative), resolve(process.cwd(), "src", relative)]
    .find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${relative} tak ketemu dari ${process.cwd()}`);
  return readFileSync(found, "utf8");
}

function isKeyframeRule(rule: CSSRule): rule is CSSKeyframeRule {
  return "keyText" in rule && "style" in rule;
}

const style = document.createElement("style");
style.textContent = read("src/app.css");
document.head.append(style);

const poses = Object.keys(POSE_ART) as PetPose[];
const expected: Record<PetPose, string> = {
  ready: "hn-pet-idle-ready",
  working: "hn-pet-idle-working",
  waiting: "hn-pet-idle-waiting",
  blocked: "hn-pet-idle-blocked",
  review: "hn-pet-idle-review",
  shipped: "hn-pet-idle-shipped",
  "docs-updated": "hn-pet-idle-docs",
};

describe("motion Pet Hanoman (SPEC-648)", () => {
  it("memberi ketujuh pose identitas idle yang berbeda", () => {
    expect(Object.fromEntries(poses.map((pose) => [pose, motionForPose(pose).keyframe])))
      .toEqual(expected);
    expect(new Set(poses.map((pose) => motionForPose(pose).keyframe)).size).toBe(poses.length);
  });

  it("memakai token durasi/easing, bukan durasi literal", () => {
    for (const pose of poses) {
      const animation = motionForPose(pose).animation;
      expect(animation).toContain("var(--dur-");
      expect(animation).toContain("var(--ease-");
      expect(animation).not.toMatch(/\b\d+(?:\.\d+)?m?s\b/);
    }
  });

  it("pose shipped flourish sekali lalu menenang", () => {
    expect(motionForPose("shipped").animation).toBe(
      "hn-pet-celebrate var(--dur-pet-flourish) var(--ease-out) 1 both, "
      + "hn-pet-idle-shipped var(--dur-pet-calm) var(--ease-inout) "
      + "var(--dur-pet-flourish) infinite",
    );
  });
});

describe("CSS motion Pet Hanoman (SPEC-648)", () => {
  const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const keyframes = rules.filter((rule): rule is CSSKeyframesRule =>
    rule.type === CSSRule.KEYFRAMES_RULE && (rule as CSSKeyframesRule).name.startsWith("hn-pet-"));

  it("mendefinisikan seluruh keyframe katalog dan interaksi", () => {
    expect(keyframes.map((rule) => rule.name)).toEqual([
      "hn-pet-idle-ready",
      "hn-pet-idle-working",
      "hn-pet-idle-waiting",
      "hn-pet-idle-blocked",
      "hn-pet-idle-review",
      "hn-pet-idle-shipped",
      "hn-pet-idle-docs",
      "hn-pet-celebrate",
      "hn-pet-pose-in",
      "hn-pet-pose-out",
      "hn-pet-click",
      "hn-pet-panel-in",
      "hn-pet-panel-out",
      "hn-pet-reveal",
    ]);
  });

  it("setiap keyframe pet hanya mengubah transform/opacity", () => {
    expect(keyframes).toHaveLength(14);
    for (const rule of keyframes) {
      for (const parsedRule of [...rule.cssRules]) {
        expect(isKeyframeRule(parsedRule), rule.name).toBe(true);
        if (!isKeyframeRule(parsedRule)) continue;
        const frame = parsedRule;
        const properties = Array.from(
          { length: frame.style.length },
          (_, index) => frame.style[index]!,
        );
        expect(properties.length, `${rule.name} ${frame.keyText}`).toBeGreaterThan(0);
        expect(properties.every((property) => property === "transform" || property === "opacity"),
          `${rule.name} ${frame.keyText}`).toBe(true);
      }
    }
  });

  it("hover dikecualikan saat reduced-motion", () => {
    const selectors = rules.filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
      .map((rule) => rule.selectorText);
    expect(selectors).toContain(
      '.hn-pet-stage:not([data-reduced-motion="true"]):hover .hn-pet-reactor');
  });
});
