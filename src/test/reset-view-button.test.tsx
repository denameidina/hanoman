import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResetViewButton, usePersistedState, uiKey, readUiState } from "../src/ui-state";

beforeEach(() => localStorage.clear());

function Screen() {
  const [q, setQ] = usePersistedState("demo", "q", "");
  return (
    <div>
      <button onClick={() => setQ("invoice")}>set</button>
      <span data-testid="q">{q}</span>
      <ResetViewButton screen="demo" active={q ? 1 : 0} />
    </div>
  );
}

describe("ResetViewButton", () => {
  it("lencana muncul hanya saat ada filter aktif", () => {
    render(<Screen />);
    expect(screen.queryByText("1 filter aktif")).toBeNull();
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByText("1 filter aktif")).toBeTruthy();
  });

  it("tombol mati saat tak ada filter aktif", () => {
    render(<Screen />);
    expect(screen.getByRole("button", { name: "Reset tampilan" })).toBeDisabled();
  });

  it("mengembalikan filter ke default dan mengosongkan storage", () => {
    render(<Screen />);
    fireEvent.click(screen.getByText("set"));
    expect(readUiState(uiKey("demo", "q"), "")).toBe("invoice");
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(screen.getByTestId("q").textContent).toBe("");
    expect(readUiState(uiKey("demo", "q"), "")).toBe("");
  });

  it("memanggil onReset untuk state yang hidup di luar layar", () => {
    const onReset = vi.fn();
    render(<ResetViewButton screen="demo" active={2} onReset={onReset} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset tampilan" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
