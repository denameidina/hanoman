import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PhaseStrip } from "../src/screens/TerminalScreen";
import { formatDuration, chipTone } from "../src/screens/phase-chip";
import type { Phase } from "../src/api/client";

const agent = (o: Partial<NonNullable<Phase["agent"]>> = {}): NonNullable<Phase["agent"]> => ({
  name: "hanoman-fase-spec", model: "claude-opus-5", effort: "high", status: "completed",
  startedAt: "2026-09-14T00:00:00.000Z", durationMs: 72_000, attempts: 1, evidence: "ok",
  inputTokens: 1_200, outputTokens: 300, cachedTokens: 5_000, resultExcerpt: "Status: selesai", ...o,
});

describe("phase-chip (ADR-0164)", () => {
  it("formatDuration & chipTone", () => {
    expect(formatDuration(72_000)).toBe("1m12s");
    expect(formatDuration(42_400)).toBe("42s");
    expect(chipTone({ name: "Plan", state: "skipped", agent: agent() })).toBe("skipped");
    expect(chipTone({ name: "Plan", state: "active", agent: agent({ status: "abandoned" }) })).toBe("abandoned");
    expect(chipTone({ name: "Plan", state: "active", agent: agent({ status: "running" }) })).toBe("running");
    expect(chipTone({ name: "Plan", state: "pending" })).toBe("pending");
  });
});

describe("PhaseStrip · chip agen fase (ADR-0164)", () => {
  it("fase selesai: nama · model · effort · durasi akhir", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    const chip = screen.getByRole("button", { name: "Detail fase Spec" });
    expect(chip).toHaveTextContent("Spec");
    expect(chip).toHaveTextContent("Opus 5");
    expect(chip).toHaveTextContent("high");
    expect(chip).toHaveTextContent("1m12s");
    expect(screen.getByText("Spec")).toHaveAttribute("data-state", "done");
  });
  it("fase berjalan: durasi dihitung dari startedAt", () => {
    render(<PhaseStrip now={Date.parse("2026-09-14T00:00:42.000Z")}
      phases={[{ name: "Plan", state: "active", agent: agent({ status: "running", durationMs: null }) }]} />);
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("42s");
  });
  it("percobaan ulang dan bukti yang tak diterima terlihat", () => {
    render(<PhaseStrip phases={[
      { name: "Spec", state: "done", agent: agent({ attempts: 2 }) },
      { name: "Plan", state: "done", agent: agent({ name: "hanoman-fase-plan", status: undefined, attempts: 0, evidence: "missing" }) },
    ]} />);
    expect(screen.getByText("↻2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "bukti subagent tak diterima" })).toBeInTheDocument();
  });
  it("mode ringkas: hanya fase aktif yang menampilkan model", () => {
    render(<PhaseStrip compact phases={[
      { name: "Spec", state: "done", agent: agent() },
      { name: "Plan", state: "active", agent: agent({ model: "claude-sonnet-5", status: "running" }) },
    ]} />);
    expect(screen.getByRole("button", { name: "Detail fase Spec" })).not.toHaveTextContent("Opus 5");
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("Sonnet 5");
  });
  it("klik chip membuka detail: token terpisah & cuplikan hasil", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Detail fase Spec" }));
    const detail = screen.getByRole("dialog", { name: "Detail fase Spec" });
    expect(within(detail).getByText(/in 1200 · out 300 · cache 5000/)).toBeInTheDocument();
    expect(within(detail).getByText("Status: selesai")).toBeInTheDocument();
  });
  it("fase dilewati ber-agen berlabel dilewati", () => {
    render(<PhaseStrip phases={[{ name: "Plan", state: "skipped", agent: agent({ status: undefined, attempts: 0, evidence: "pending" }) }]} />);
    expect(screen.getByRole("button", { name: "Detail fase Plan" })).toHaveTextContent("dilewati");
  });
});

// ADR-0164 · review: panel detail dulu hidup DI DALAM baris chip yang men-scroll (overflowX:
// auto), dan spec CSS overflow memaksa overflow-y strip jadi `auto` begitu overflow-x diset —
// panel `position:absolute; top:100%` pun jatuh ke area scroll vertikal setinggi baris chip itu
// sendiri, tak pernah terlihat di browser sungguhan (jsdom tak layout jadi test lama tetap hijau).
describe("PhaseStrip · panel detail tak terpotong (ADR-0164)", () => {
  it("panel detail BUKAN keturunan penggulung chip, tapi ADA di dalam wrapper strip", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Detail fase Spec" }));
    const dialog = screen.getByRole("dialog", { name: "Detail fase Spec" });
    expect(screen.getByTestId("phase-strip-scroller").contains(dialog)).toBe(false);
    expect(screen.getByTestId("phase-strip").contains(dialog)).toBe(true);
  });

  it("agen tanpa model: baris detail tak diawali '·'", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent({ model: undefined }) }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Detail fase Spec" }));
    const dialog = screen.getByRole("dialog", { name: "Detail fase Spec" });
    expect(within(dialog).getByText(/^high · completed$/)).toBeInTheDocument();
  });
});

// ADR-0164 · review 2: panel bisa setinggi ~242px (4 baris + `<pre>` maks 160px), tapi sel di
// grid padat cuma ~220px dan sel itu `overflow: hidden` — jadi containing block panel dipindah
// dari wrapper strip ini ke wrapper BADAN sel (lihat terminal-screen.test.tsx), dan wrapper strip
// ini sendiri sengaja LEPAS `position: relative` supaya bukan lagi containing block-nya. Panel
// jadi bergantung ke posisi statisnya (bukan `top`), dibatasi tinggi lewat `maxHeight` relatif +
// men-scroll sendiri kalau sel pendek.
describe("PhaseStrip · panel dibatasi tinggi badan sel, bukan wrapper strip (ADR-0164 review 2)", () => {
  it("wrapper phase-strip tak lagi jadi containing block: tanpa position, tanpa overflow", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    const strip = screen.getByTestId("phase-strip");
    expect(strip.style.position).toBe("");
    expect(strip.style.overflowX).toBe("");
    expect(strip.style.overflowY).toBe("");
    expect(screen.getByTestId("phase-strip-scroller")).toHaveStyle({ overflowX: "auto" });
  });

  it("panel: absolute tanpa top (posisi statis), overflow-y & maxHeight sendiri", () => {
    render(<PhaseStrip phases={[{ name: "Spec", state: "done", agent: agent() }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Detail fase Spec" }));
    const dialog = screen.getByRole("dialog", { name: "Detail fase Spec" });
    expect(dialog.style.position).toBe("absolute");
    expect(dialog.style.top).toBe("");
    expect(dialog.style.overflowY).toBe("auto");
    expect(dialog.style.maxHeight).toContain("100%");
  });
});
