import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "../src/ds/icon";

// SPEC-906 · lucide 0.400 memindahkan ikon ke nama kanonik baru dan menyisakan nama lama sebagai
// alias di level modul saja. Selama lookup hanya melihat peta `icons`, 15 nama yang masih dipakai
// di UI ini dirender sebagai lingkaran kosong TANPA satu pun error — kegagalan yang tak bisa
// dilihat dari test mana pun yang cuma memeriksa teks.
const cls = (el: HTMLElement, name: string) =>
  el.querySelector<SVGElement>(`[data-icon="${name}"]`)!.getAttribute("class") ?? "";

afterEach(() => vi.restoreAllMocks());

describe("Icon", () => {
  it("nama kanonik dirender apa adanya", () => {
    const { container } = render(<Icon name="triangle-alert" />);
    expect(cls(container, "triangle-alert")).toContain("lucide-triangle-alert");
  });

  it.each([
    ["alert-triangle", "lucide-triangle-alert"],
    ["x-circle", "lucide-circle-x"],
    ["arrow-up-circle", "lucide-circle-arrow-up"],
    ["terminal-square", "lucide-square-terminal"],
    ["loader-2", "lucide-loader-circle"],
    ["more-horizontal", "lucide-ellipsis"],
    // Pasangan yang MUDAH tertukar bila nama lama diganti dengan tangan: `check-circle` adalah
    // lingkaran centang TEBAL, `check-circle-2` yang tipis — bukan sebaliknya.
    ["check-circle", "lucide-circle-check-big"],
    ["check-circle-2", "lucide-circle-check"],
  ])("nama lama %s tetap dapat ikonnya, bukan lingkaran kosong", (name, expected) => {
    const { container } = render(<Icon name={name} />);
    expect(cls(container, name)).toContain(expected);
  });

  it("nama tak dikenal jatuh ke lingkaran DAN berteriak sekali di dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = render(<Icon name="tak-ada-ikon-begini" />);
    expect(cls(container, "tak-ada-ikon-begini")).toContain("lucide-circle");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("tak-ada-ikon-begini");
  });
});

// Audit UI/UX 2026-10 · Fase 2B · ikon dekoratif disembunyikan dari pembaca layar secara default.
describe("Icon · aksesibilitas (Fase 2B)", () => {
  const node = (container: HTMLElement, name: string) => container.querySelector<SVGElement>(`[data-icon="${name}"]`)!;

  it("tanpa aria-label/aria-labelledby/title: aria-hidden=true", () => {
    const { container } = render(<Icon name="check" />);
    expect(node(container, "check").getAttribute("aria-hidden")).toBe("true");
    expect(node(container, "check").getAttribute("role")).toBeNull();
  });

  it("dengan aria-label: tak disembunyikan dan berperan sebagai img bernama", () => {
    const { container } = render(<Icon name="alert-triangle" aria-label="Peringatan" />);
    expect(node(container, "alert-triangle").getAttribute("aria-hidden")).toBeNull();
    expect(node(container, "alert-triangle").getAttribute("role")).toBe("img");
    expect(node(container, "alert-triangle").getAttribute("aria-label")).toBe("Peringatan");
  });

  it("dengan aria-labelledby juga bernama; aria-hidden eksplisit tetap dihormati", () => {
    const { container } = render(<>
      <Icon name="info" aria-labelledby="teks-info" />
      <Icon name="x" aria-hidden={false} />
    </>);
    expect(node(container, "info").getAttribute("role")).toBe("img");
    expect(node(container, "info").getAttribute("aria-hidden")).toBeNull();
    expect(node(container, "x").getAttribute("aria-hidden")).toBe("false");
  });
});
