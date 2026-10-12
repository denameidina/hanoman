// Audit UI/UX 2026-10 · P3-3: `aria-controls` tak boleh menunjuk panel yang belum dirender (pemicu tertutup).
// Polanya `open ? id : undefined`. Dua pemicu punya perilaku di test masing-masing (account-menu.test.tsx,
// limit-indicator-a11y.test.tsx); dua lainnya (CabangPanel, GitGraph) dikunci di sumbernya karena panelnya
// bersyarat di JSX dan jsdom tak memberi layout yang perlu diuji.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(import.meta.dirname, "..", rel), "utf8");

describe("aria-controls: pemicu hanya menunjuk panel yang sedang terbuka", () => {
  it("CabangPanel: #cabang-opsi hanya saat opsi pembersihan terbuka", () => {
    expect(read("src/screens/CabangPanel.tsx")).toMatch(/aria-controls=\{showOpts \? "cabang-opsi" : undefined\}/);
  });

  it("GitGraph: #ide-graph-view hanya saat panel tampilan terbuka", () => {
    expect(read("src/screens/GitGraph.tsx")).toMatch(/aria-controls=\{showView \? "ide-graph-view" : undefined\}/);
  });

  it("AccountMenu dan LimitIndicator tak lagi memakai popover.panelId mentah tanpa syarat", () => {
    for (const file of ["src/auth/AccountMenu.tsx", "src/screens/LimitIndicator.tsx"]) {
      expect(read(file), file).not.toMatch(/aria-controls=\{popover\.panelId\}/);
      expect(read(file), file).toMatch(/aria-controls=\{open \? popover\.panelId : undefined\}/);
    }
  });
});
