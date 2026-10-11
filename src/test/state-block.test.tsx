import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button, StateBlock } from "../src/ds";

describe("StateBlock", () => {
  it("loading marks itself busy and has no action", () => {
    render(<StateBlock kind="loading" title="Memuat…" />);
    expect(screen.getByText("Memuat…").closest("[aria-busy]")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("error announces itself and retries", () => {
    const retry = vi.fn();
    render(<StateBlock kind="error" title="Gagal" action={retry} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    screen.getByText("Coba lagi").click();
    expect(retry).toHaveBeenCalled();
  });

  it("empty shows hint + call to action, not an alert", () => {
    render(<StateBlock kind="empty" title="Kosong" hint="Tambah dulu" action={() => {}} actionLabel="Buat" />);
    expect(screen.getByText("Tambah dulu")).toBeInTheDocument();
    expect(screen.getByText("Buat")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("spinner loading", () => {
  it("tombol dan StateBlock loading tak menyisipkan <style> ke DOM; keyframes hn-spin hidup di forms.css", () => {
    const { container } = render(<><Button loading>Simpan</Button><StateBlock kind="loading" title="Memuat…" /></>);
    expect(container.querySelector("style")).toBeNull();
    expect(screen.getByRole("button").textContent).toBe("Simpan");
    const css = readFileSync(resolve(import.meta.dirname, "../src/ds/components/forms.css"), "utf8");
    expect(css).toMatch(/@keyframes hn-spin\s*\{/);
  });
});
