import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceChip } from "../src/screens/PresenceChip";

describe("PresenceChip", () => {
  it("menyebut nama device", () => {
    render(<PresenceChip names={["mac-dena"]} />);
    expect(screen.getByTestId("presence-chip").textContent).toContain("mac-dena");
    expect(screen.getByTestId("presence-chip").textContent).toContain("dikerjakan di");
  });

  it("menggabungkan beberapa device", () => {
    render(<PresenceChip names={["mac-dena", "laptop"]} />);
    expect(screen.getByTestId("presence-chip").textContent).toContain("mac-dena, laptop");
  });

  // Gerbang requirement 7 di ujung terakhirnya: tanpa nama, tak ada apa pun yang dirender.
  it("tak merender apa-apa tanpa nama", () => {
    const { container } = render(<PresenceChip names={undefined} />);
    expect(container.innerHTML).toBe("");
  });

  it("tak merender apa-apa untuk daftar kosong", () => {
    const { container } = render(<PresenceChip names={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
