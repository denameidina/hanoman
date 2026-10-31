import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageViewer, type ViewerImage } from "../src/ds/ImageViewer";

// ADR-0233 · penampil mockup ber-zoom. jsdom tak me-layout gambar (natural 0×0), jadi Fit jatuh ke 100%:
// yang diuji di sini adalah kontrolnya — label zoom, navigasi, tutup — bukan piksel.
const imgs: ViewerImage[] = [
  { src: "/m/01-a.png", name: "01-a.png" },
  { src: "/m/02-b.png", name: "02-b.png" },
];
const zoom = () => screen.getByTestId("image-viewer-zoom").textContent;

function setup(images = imgs, index = 0) {
  const onIndex = vi.fn();
  const onClose = vi.fn();
  render(<ImageViewer images={images} index={index} onIndex={onIndex} onClose={onClose} />);
  return { onIndex, onClose };
}

describe("ImageViewer (ADR-0233)", () => {
  it("tombol Perbesar/Perkecil mengubah label zoom; Fit mengembalikannya", () => {
    setup();
    expect(zoom()).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Perbesar" }));
    expect(zoom()).toBe("125%");
    fireEvent.click(screen.getByRole("button", { name: "Perbesar" }));
    expect(zoom()).toBe("156%");
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    expect(zoom()).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Perkecil" }));
    expect(zoom()).toBe("80%");
  });

  it("keyboard: + memperbesar, - memperkecil, 0 kembali ke Fit; batas bawah 10%", () => {
    setup();
    fireEvent.keyDown(window, { key: "+" });
    expect(zoom()).toBe("125%");
    fireEvent.keyDown(window, { key: "0" });
    expect(zoom()).toBe("100%");
    for (let i = 0; i < 30; i++) fireEvent.keyDown(window, { key: "-" });
    expect(zoom()).toBe("10%");
  });

  it("tombol 100% kembali ke ukuran asli sesudah zoom", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Perbesar" }));
    fireEvent.click(screen.getByRole("button", { name: "100%" }));
    expect(zoom()).toBe("100%");
  });

  it("panah kanan/kiri dan tombol navigasi berpindah gambar (melingkar)", () => {
    const { onIndex } = setup();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndex).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onIndex).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
  });

  it("thumbnail menandai gambar aktif dan klik memilih gambar lain", () => {
    const { onIndex } = setup();
    expect(screen.getByRole("button", { name: "1: 01-a.png" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "2: 02-b.png" }));
    expect(onIndex).toHaveBeenCalledWith(1);
    expect(screen.getByText("1 / 2 · 01-a.png")).toBeTruthy();
  });

  it("Esc dan tombol Tutup memanggil onClose", () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("satu gambar: tanpa strip thumbnail dan tanpa tombol navigasi; tautan Buka asli ke href", () => {
    setup([{ src: "/m/01-a.png", name: "01-a.png", href: "/asli/01-a.png" }]);
    expect(screen.queryByRole("group", { name: "Daftar gambar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Berikutnya" })).toBeNull();
    expect(screen.getByRole("link", { name: /Buka asli/ }).getAttribute("href")).toBe("/asli/01-a.png");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
