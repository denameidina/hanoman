import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { usePersistedState } from "../src/ui-state/hooks";
import { uiKey, readUiState, resetUiState, writeUiState, oneOf } from "../src/ui-state/store";

beforeEach(() => localStorage.clear());

function Filter({ screenKey = "demo" }: { screenKey?: string }) {
  const [q, setQ] = usePersistedState(screenKey, "q", "");
  return (
    <div>
      <span data-testid="q">{q}</span>
      <button onClick={() => setQ("invoice")}>set</button>
      <button onClick={() => setQ((s) => s + "!")}>tambah</button>
    </div>
  );
}

describe("usePersistedState", () => {
  it("menulis ke storage saat berubah", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    expect(readUiState(uiKey("demo", "q"), "")).toBe("invoice");
  });

  it("bertahan lintas unmount/remount", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    cleanup();
    render(<Filter />);
    expect(screen.getByTestId("q").textContent).toBe("invoice");
  });

  it("menerima updater fungsi", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    fireEvent.click(screen.getByText("tambah"));
    expect(screen.getByTestId("q").textContent).toBe("invoice!");
  });

  it("nilai rusak di storage → nilai awal", () => {
    localStorage.setItem(uiKey("demo", "q"), "{rusak");
    render(<Filter />);
    expect(screen.getByTestId("q").textContent).toBe("");
  });

  it("reset mengembalikan komponen yang sedang ter-mount ke nilai awal", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    expect(screen.getByTestId("q").textContent).toBe("invoice");
    // resetUiState memancarkan setState di luar handler React → butuh act() eksplisit.
    act(() => resetUiState("demo"));
    expect(screen.getByTestId("q").textContent).toBe("");
  });

  it("reset layar lain tak menyentuh layar ini", () => {
    render(<Filter />);
    fireEvent.click(screen.getByText("set"));
    act(() => resetUiState("layar-lain"));
    expect(screen.getByTestId("q").textContent).toBe("invoice");
  });

  it("kunci berganti (scope project) → baca ulang, bukan bawa nilai lama", () => {
    writeUiState(uiKey("demo@a", "q"), "milik-a");
    writeUiState(uiKey("demo@b", "q"), "milik-b");
    const { rerender } = render(<Filter screenKey="demo@a" />);
    expect(screen.getByTestId("q").textContent).toBe("milik-a");
    rerender(<Filter screenKey="demo@b" />);
    expect(screen.getByTestId("q").textContent).toBe("milik-b");
    // nilai project A tetap utuh — bukan tertimpa nilai yang sedang tampil
    expect(readUiState(uiKey("demo@a", "q"), "")).toBe("milik-a");
  });

  it("accept menolak nilai di luar union", () => {
    writeUiState(uiKey("demo", "view"), "kanban");
    function View() {
      const [v] = usePersistedState("demo", "view", "grid", oneOf("grid", "list"));
      return <span data-testid="v">{v}</span>;
    }
    render(<View />);
    expect(screen.getByTestId("v").textContent).toBe("grid");
  });
});
