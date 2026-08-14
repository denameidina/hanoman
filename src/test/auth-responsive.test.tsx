import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthScreen } from "../src/screens/AuthScreen";

vi.mock("../src/api/client", () => ({
  api: { login: vi.fn(), setup: vi.fn() },
  ApiError: class extends Error { status = 0; },
}));

describe("AuthScreen responsive viewport", () => {
  it("owns a dynamic-viewport scroller so the virtual keyboard cannot hide the form", () => {
    render(<AuthScreen needsSetup={false} onDone={() => {}} />);
    expect(screen.getByTestId("auth-scroll")).toHaveStyle({
      minHeight: "100dvh",
      overflowY: "auto",
    });
  });
});
