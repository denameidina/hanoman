import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Illustration,
  MascotIllustration,
  ProductStateIllustration,
  SpotIllustration,
  StickerIllustration,
} from "../src/ds";

describe("Illustration", () => {
  it("renders an informative catalog asset with responsive defaults", () => {
    render(<Illustration id="HRO-001" />);

    const image = screen.getByRole("img", { name: /documented intent crosses/i });
    expect(image).toHaveAttribute("data-illustration-id", "HRO-001");
    expect(image).toHaveAttribute("data-illustration-family", "hero");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveStyle({ width: "100%", height: "auto", objectFit: "contain" });
  });

  it("lets priority and caller layout override non-semantic defaults", () => {
    render(<Illustration id="SOC-003" priority fit="cover" style={{ width: 320 }} />);

    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("loading", "eager");
    expect(image).toHaveAttribute("fetchpriority", "high");
    expect(image).toHaveStyle({ width: "320px", objectFit: "cover" });
  });

  it("makes decorative artwork silent even when an alt override is supplied", () => {
    render(<StickerIllustration id="STK-005" decorative alt="Do not expose this" />);

    const image = screen.getByTestId("illustration-STK-005");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders each semantic family wrapper through the same catalog contract", () => {
    render(
      <>
        <ProductStateIllustration id="PST-002" />
        <MascotIllustration id="MPS-004" />
        <SpotIllustration id="SPT-006" />
        <StickerIllustration id="STK-008" />
      </>,
    );

    expect(screen.getByTestId("illustration-PST-002")).toHaveAttribute("data-illustration-family", "product-state");
    expect(screen.getByTestId("illustration-MPS-004")).toHaveAttribute("data-illustration-family", "mascot-pose");
    expect(screen.getByTestId("illustration-SPT-006")).toHaveAttribute("data-illustration-family", "spot");
    expect(screen.getByTestId("illustration-STK-008")).toHaveAttribute("data-illustration-family", "sticker");
  });
});
