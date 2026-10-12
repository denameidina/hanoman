// Penempatan pet di Shell: footer sidebar di desktop, lajur di bawah <main> di tablet dan ponsel. Pet
// disalurkan lewat PetDockContext (dibuat sekali di App), jadi test ini cukup memakai penanda pengganti.
import { eventsStub } from "./helpers/events-stub";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { Shell } from "../src/ds";
import { PetDockContext } from "../src/ds/shell";
import { MOBILE_QUERY, TABLET_QUERY } from "../src/ds/responsive";

vi.mock("../src/api/client", async () => {
  const actual = await vi.importActual<any>("../src/api/client");
  return {
    ...actual,
    api: {
      listNotifications: vi.fn().mockResolvedValue({ items: [], unread: 0 }),
      getLimits: vi.fn().mockResolvedValue(null),
      getCodexLimits: vi.fn().mockResolvedValue(null),
      getUpdateStatus: vi.fn().mockResolvedValue({ current: "0.0.0", latest: null, canApply: false }),
      getMethodStatus: vi.fn().mockResolvedValue({ methods: [] }),
    },
  };
});

vi.mock("../src/api/events", () => ({
  ...eventsStub,
  eventsStatus: () => ({ connected: true, since: 0, paused: false }),
  subscribeStatus: () => () => {},
}));

function mockTier(tier: "mobile" | "tablet" | "desktop"): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: (tier === "mobile" && query === MOBILE_QUERY) || (tier === "tablet" && query === TABLET_QUERY),
      media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

const probe = <i data-testid="pet-probe">pet</i>;
const slot = (name: "sidebar" | "lane") => document.querySelector(`[data-pet-slot="${name}"]`) as HTMLElement;

function renderShell(node: ReactNode) {
  return render(
    <PetDockContext.Provider value={node}>
      <Shell active="prd" title="PRD" onNavigate={() => {}}>isi</Shell>
    </PetDockContext.Provider>,
  );
}

beforeEach(() => mockTier("desktop"));

describe("Shell menaruh pet di slot yang sesuai tier", () => {
  it("desktop: pet duduk di footer sidebar, lajur bawah kosong", () => {
    renderShell(probe);
    expect(slot("sidebar")).toContainElement(document.querySelector('[data-testid="pet-probe"]') as HTMLElement);
    expect(slot("lane").childElementCount).toBe(0);
    expect(slot("sidebar").closest("aside")).not.toBeNull();
  });

  it("tablet: pet di lajur, DI BAWAH <main> dalam kolom — area gulir berakhir di atasnya", () => {
    mockTier("tablet");
    renderShell(probe);
    const lane = slot("lane");
    expect(lane).toContainElement(document.querySelector('[data-testid="pet-probe"]') as HTMLElement);
    expect(lane.previousElementSibling?.tagName).toBe("MAIN");
    expect(lane.parentElement).toHaveClass("hn-shell-column");
    expect(slot("sidebar").childElementCount).toBe(0);
  });

  it("ponsel: sama dengan tablet — lajur di bawah <main>, footer sidebar kosong", () => {
    mockTier("mobile");
    renderShell(probe);
    expect(slot("lane")).toContainElement(document.querySelector('[data-testid="pet-probe"]') as HTMLElement);
    expect(slot("sidebar").childElementCount).toBe(0);
  });

  it("pet mati (konteks null): kedua slot kosong dan tak memesan ruang", () => {
    mockTier("desktop");
    renderShell(null);
    expect(slot("sidebar").childElementCount).toBe(0);
    expect(slot("lane").childElementCount).toBe(0);
  });
});
