import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
const coarse = css.slice(
  css.indexOf("@media (pointer: coarse), (max-width: 767px)"),
  css.indexOf(".hn-responsive-panels"),
);

describe("responsive touch targets", () => {
  it("overrides compact inline dimensions for semantic and reset-style controls", () => {
    for (const selector of [
      ".hn-touch-target",
      ".hn-terminal-unplaced-action",
      '[role="button"][tabindex="0"]',
    ]) expect(coarse).toContain(selector);
    expect(coarse).toMatch(/min-width:\s*var\(--touch-target\)\s*!important/);
    expect(coarse).toMatch(/min-height:\s*var\(--touch-target\)\s*!important/);
  });
});

// QA Chrome (P2) · Switch (role=switch) 40×22 px: area sentuh 24 px tinggi di pointer halus dan 44 px di
// pointer kasar. Aturannya berdampingan dengan komponennya (ds/components/forms.css), bukan di app.css.
const formsCss = readFileSync(resolve(import.meta.dirname, "../src/ds/components/forms.css"), "utf8");

describe("switch: area sentuh 24 px di pointer halus, 44 px di pointer kasar", () => {
  it("batas minimum dasar 24 px ada di luar blok coarse, jadi berlaku di desktop", () => {
    const base = formsCss.indexOf(".hn-choice-control { min-width: 24px; min-height: 24px; }");
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(formsCss.indexOf("@media (pointer: coarse), (max-width: 767px)"));
  });

  it("pointer kasar/ponsel: kotak kontrol pilihan 44 px lewat --touch-target", () => {
    const coarseBlock = formsCss.slice(formsCss.indexOf("@media (pointer: coarse), (max-width: 767px)"));
    expect(coarseBlock).toMatch(/\.hn-choice-control \{ min-width: var\(--touch-target\); min-height: var\(--touch-target\); \}/);
  });

  it("Switch memuat stylesheet ini lewat komponennya (bukan hanya tersedia di berkas)", () => {
    const forms = readFileSync(resolve(import.meta.dirname, "../src/ds/components/forms.tsx"), "utf8");
    expect(forms).toContain('import "./forms.css";');
  });
});
