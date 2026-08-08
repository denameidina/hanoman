import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/api/client", () => ({
  api: {
    setup: vi.fn(),
    login: vi.fn(),
    listBranches: vi.fn(async () => ({ branches: [], remotes: [] })),
    listSpecs: vi.fn(),
  },
  ApiError: class extends Error {},
}));

import { AuthScreen } from "../src/screens/AuthScreen";
import { BacklogScreen } from "../src/screens/BacklogScreen";

describe("product-state illustration placement", () => {
  it("uses onboarding artwork at the account entry", () => {
    render(<AuthScreen needsSetup onDone={vi.fn()} />);
    expect(screen.getByTestId("illustration-PST-001")).toBeInTheDocument();
  });

  it("uses empty-backlog artwork only for a truly empty backlog", () => {
    render(<BacklogScreen backlog={[]} projects={[{ id: "p", name: "p" }] as never}
      projectFilter="all" onProjectFilter={vi.fn()} />);
    expect(screen.getByText("Backlog masih kosong")).toBeInTheDocument();
    expect(screen.getByTestId("illustration-PST-002")).toBeInTheDocument();
  });
});
