import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ORCHESTRATION_DEFAULTS } from "@hanoman/shared";
import { OrchestrationPanel } from "../src/screens/OrchestrationPanel";

// Audit UI/UX 2026-10 · 1G · matriks orkestrasi: kontrol flow yang dimatikan benar-benar `disabled`
// (bukan hanya diredupkan), dan tabel yang lebih lebar dari layar digulir di wadah LocalOverflow.

describe("OrchestrationPanel · flow nonaktif", () => {
  it("kontrol flow yang dimatikan benar-benar disabled", () => {
    const orch = { ...ORCHESTRATION_DEFAULTS, feature: { ...ORCHESTRATION_DEFAULTS.feature, enabled: false } };
    render(<OrchestrationPanel orchestration={orch} onChange={vi.fn()} />);
    const selects = within(screen.getByTestId("orch-flow-feature")).getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s).toBeDisabled();
  });

  it("flow yang aktif kontrolnya tetap bisa dipakai", () => {
    const orch = { ...ORCHESTRATION_DEFAULTS, feature: { ...ORCHESTRATION_DEFAULTS.feature, enabled: true } };
    render(<OrchestrationPanel orchestration={orch} onChange={vi.fn()} />);
    const selects = within(screen.getByTestId("orch-flow-feature")).getAllByRole("combobox");
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      if (s.getAttribute("aria-label")?.startsWith("Effort ") && s.getAttribute("aria-label")?.endsWith(" antigravity")) expect(s).toBeDisabled();
      else expect(s).toBeEnabled();
    }
  });

  it("tabel matriks dibungkus LocalOverflow, bukan div overflow-x biasa", () => {
    render(<OrchestrationPanel orchestration={ORCHESTRATION_DEFAULTS} onChange={vi.fn()} />);
    const table = within(screen.getByTestId("orch-flow-feature")).getByRole("table");
    expect(table.closest(".hn-local-overflow")).not.toBeNull();
  });
});

// Fase 3I · varian `accordion` (hub Otonom · Setelan): satu baris per flow yang bisa dibuka. Varian
// default (kartu, dipakai Settings) tak boleh berubah.
describe("OrchestrationPanel · varian accordion", () => {
  it("tiap flow tertutup secara default dan dibuka lewat tombolnya", () => {
    render(<OrchestrationPanel variant="accordion" orchestration={ORCHESTRATION_DEFAULTS} onChange={vi.fn()} />);
    const head = within(screen.getByTestId("orch-flow-feature")).getByRole("button", { expanded: false });
    expect(screen.queryByRole("switch", { name: "Orkestrasi feature" })).not.toBeInTheDocument();
    fireEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("switch", { name: "Orkestrasi feature" })).toBeInTheDocument();
  });

  it("varian default tetap kartu: tak ada baris yang bisa dibuka", () => {
    render(<OrchestrationPanel orchestration={ORCHESTRATION_DEFAULTS} onChange={vi.fn()} />);
    expect(within(screen.getByTestId("orch-flow-feature")).queryByRole("button", { expanded: false })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Orkestrasi feature" })).toBeInTheDocument();
  });
});

it("SPEC-1442 native tier selection serializes effort null and explains reviewer limits", () => {
  const change = vi.fn();
  render(<OrchestrationPanel orchestration={ORCHESTRATION_DEFAULTS} onChange={change} />);
  const model = screen.getByRole("combobox", { name: "Model feature Brainstorm antigravity" });
  expect([...model.querySelectorAll("option")].map((o) => o.value)).toEqual(["inherit", "flash", "pro"]);
  fireEvent.change(model, { target: { value: "pro" } });
  expect(change.mock.calls[0]?.[0].feature.antigravity.Brainstorm).toEqual({ model: "pro", effort: null });
  expect(screen.getByRole("combobox", { name: "Effort feature Brainstorm antigravity" })).toBeDisabled();
  expect(screen.getAllByText(/Reviewer read-only instruksional/).length).toBeGreaterThan(0);
});
