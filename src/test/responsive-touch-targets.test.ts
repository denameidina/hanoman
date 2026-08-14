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
      ".hn-project-open",
      ".hn-terminal-unplaced-action",
      '[role="button"][tabindex="0"]',
    ]) expect(coarse).toContain(selector);
    expect(coarse).toMatch(/min-width:\s*var\(--touch-target\)\s*!important/);
    expect(coarse).toMatch(/min-height:\s*var\(--touch-target\)\s*!important/);
  });
});
