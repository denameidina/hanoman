// QA visual 2026-10 · P2: header ponsel membungkus (crumb 2–3 baris, kotak cari sendirian di baris kedua).
// Di ponsel crumb hub dilepas (judul sudah nama tab, dan tab ada di atas konten), dan crumb yang tersisa
// dipotong satu baris. Test ini menegaskan perbedaan DOM per tier; pemotongan dan urutan barisnya
// dijaga lewat CSS di responsive-chrome-css.test.ts.
import { eventsStub } from "./helpers/events-stub";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Shell } from "../src/ds";
import { MOBILE_QUERY } from "../src/ds/responsive";

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

// Tier dibaca dari matchMedia (ds/responsive.tsx); default jsdom tanpa matchMedia = lebar 1024 = tablet.
function mockViewport(mobile: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (query: string) => ({
      matches: mobile && query === MOBILE_QUERY, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => mockViewport(false));

describe("Shell · crumb di ponsel", () => {
  it("ponsel: crumb hub dilepas, deskripsi layar tetap ada dan dipotong satu baris", () => {
    mockViewport(true);
    render(<Shell active="prd" title="PRD" breadcrumb="brief → brainstorm → dokumen" onNavigate={() => {}}>isi</Shell>);
    expect(screen.queryByTestId("hub-crumb")).toBeNull();
    const desc = screen.getByText("brief → brainstorm → dokumen");
    expect(desc.closest(".hn-shell-crumb")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "PRD" })).toHaveClass("hn-shell-title");
  });

  it("ponsel: tanpa deskripsi tak ada crumb sama sekali (bukan baris kosong)", () => {
    mockViewport(true);
    render(<Shell active="prd" title="PRD" onNavigate={() => {}}>isi</Shell>);
    expect(screen.queryByTestId("hub-crumb")).toBeNull();
    expect(document.querySelector(".hn-shell-crumb")).toBeNull();
  });

  it("tablet/desktop: crumb 'Hub › Tab' tetap tampil seperti sebelumnya", () => {
    render(<Shell active="prd" title="PRD" breadcrumb="brief → brainstorm → dokumen" onNavigate={() => {}}>isi</Shell>);
    expect(screen.getByTestId("hub-crumb")).toHaveTextContent("Projects › PRD");
    expect(screen.getByText("brief → brainstorm → dokumen").closest(".hn-shell-crumb")).not.toBeNull();
  });
});

// QA run3 · P2 desktop 661 px: daftar hub meluap tanpa tanda, dan hub aktif bisa berada di bawah lipatan.
describe("Shell · daftar hub yang meluap", () => {
  const prevScrollIntoView = Element.prototype.scrollIntoView;
  afterEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = prevScrollIntoView;
  });

  it("meluap di bawah: cue gulir hanya di tepi bawah, dan hub aktif digulir ke layar (nearest)", () => {
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("hn-shell-nav") ? 600 : 0;
    });
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("hn-shell-nav") ? 400 : 0;
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Shell active="prd" title="PRD" onNavigate={() => {}}>isi</Shell>);
    const nav = document.querySelector(".hn-shell-nav")!;
    expect(nav).toHaveAttribute("data-cue-end", "true");
    expect(nav).not.toHaveAttribute("data-cue-start");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("tak meluap: tanpa cue sama sekali", () => {
    render(<Shell active="prd" title="PRD" onNavigate={() => {}}>isi</Shell>);
    const nav = document.querySelector(".hn-shell-nav")!;
    expect(nav).not.toHaveAttribute("data-cue-end");
    expect(nav).not.toHaveAttribute("data-cue-start");
  });
});
