// Audit UI/UX 2026-10 · varian danger resmi Button (ds/components/forms.tsx + forms.css). jsdom tak memuat
// stylesheet, jadi warna dan cincin fokus diikat dua kali: kelasnya di DOM, dan aturannya di forms.css.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Button } from "../src/ds";

afterEach(cleanup);

const formsCss = readFileSync(join(resolve(import.meta.dirname, "../src/ds/components"), "forms.css"), "utf8");
const code = formsCss.replace(/\/\*[\s\S]*?\*\//g, "");

describe("Button · varian danger", () => {
  it("danger (solid) dan danger-outline memakai kelasnya, tanpa warna inline", () => {
    render(<>
      <Button variant="danger">Hapus spec</Button>
      <Button variant="danger-outline">Reset</Button>
    </>);
    const solid = screen.getByRole("button", { name: "Hapus spec" });
    const outline = screen.getByRole("button", { name: "Reset" });
    expect(solid).toHaveClass("hn-btn-danger");
    expect(outline).toHaveClass("hn-btn-danger-outline");
    expect(solid.style.background).toBe("");
    expect(outline.style.color).toBe("");
    expect(outline.style.borderColor).toBe("");
  });

  it("varian danger tidak mematikan outline bawaan, supaya cincin fokus berlaku", () => {
    render(<Button variant="danger-outline">Reset</Button>);
    expect(screen.getByRole("button", { name: "Reset" }).style.outline).toBe("");
  });

  it("varian lain juga tanpa outline inline; cincin fokus datang dari :focus-visible global", () => {
    render(<Button variant="secondary">Batal</Button>);
    const btn = screen.getByRole("button", { name: "Batal" });
    expect(btn.style.outline).toBe("");
    expect(btn).not.toHaveClass("hn-btn-danger");
    expect(btn).not.toHaveClass("hn-btn-danger-outline");
  });

  it("danger-outline bisa dinonaktifkan dan tetap berkelas danger", () => {
    render(<Button variant="danger-outline" disabled>Reset</Button>);
    const btn = screen.getByRole("button", { name: "Reset" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveClass("hn-btn-danger-outline");
  });

  it("danger sebagai tautan (as=a) tetap berkelas danger", () => {
    render(<Button variant="danger-outline" as="a" href="#x">Unduh</Button>);
    expect(screen.getByRole("link", { name: "Unduh" })).toHaveClass("hn-btn-danger-outline");
  });
});

describe("forms.css · varian danger", () => {
  it("danger-outline: teks dan border merah, hover memakai tint galat, fokus memakai cincin DS", () => {
    expect(code).toMatch(/\.hn-btn-danger-outline\s*\{[^}]*color:\s*var\(--clay-600\)/);
    expect(code).toMatch(/\.hn-btn-danger-outline\s*\{[^}]*border:\s*1px solid var\(--clay-500\)/);
    expect(code).toMatch(/\.hn-btn-danger-outline:not\(:disabled\):not\(\[aria-disabled="true"\]\):hover\s*\{[^}]*var\(--status-err-tint\)/);
    expect(code).toMatch(/\.hn-btn-danger:focus-visible,\s*\.hn-btn-danger-outline:focus-visible\s*\{\s*outline:\s*2px solid var\(--border-focus\)/);
  });

  it("danger solid: fill clay-600 dengan teks putih", () => {
    expect(code).toMatch(/\.hn-btn-danger\s*\{\s*background:\s*var\(--clay-600\);\s*color:\s*#fff/);
  });
});
