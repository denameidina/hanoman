import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnhardenedBanner } from "../src/screens/SetupWizard";
import type { SetupStatus } from "@hanoman/shared";

const s = (o: Partial<SetupStatus>): SetupStatus => ({
  needed: false, deployment: "local", hardening: false, hardeningLocked: false,
  supervised: false, setupTokenRequired: false, prerequisites: [], ...o,
});

describe("penanda instance tanpa hardening (SPEC-884)", () => {
  it("muncul saat publik tanpa hardening", () => {
    render(<UnhardenedBanner status={s({ deployment: "public", hardening: false })} />);
    expect(screen.getByTestId("unhardened-banner")).toBeTruthy();
    expect(screen.getByText(/tanpa hardening/)).toBeTruthy();
  });

  it("tak muncul di instance lokal", () => {
    render(<UnhardenedBanner status={s({ deployment: "local", hardening: false })} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });

  it("tak muncul saat hardening menyala", () => {
    render(<UnhardenedBanner status={s({ deployment: "public", hardening: true })} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });

  it("tak muncul saat status belum diketahui", () => {
    render(<UnhardenedBanner status={null} />);
    expect(screen.queryByTestId("unhardened-banner")).toBeNull();
  });
});
