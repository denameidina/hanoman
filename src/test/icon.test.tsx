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
