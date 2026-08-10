/* SPEC-626 · portal klien harus BENAR-BENAR bisa digulir.
   `#root { height: 100vh; overflow: hidden }` (app.css:5) benar untuk `Shell` operator yang
   mengelola scroll di panel dalamnya — tapi `ClientPortal` sengaja tidak memakai `Shell`
   (fork App.tsx) dan pembungkusnya cuma `minHeight: 100%`, jadi tak satu pun kontainer di
   portal bisa digulir: daftar yang lebih tinggi dari viewport tak terjangkau sama sekali.

   jsdom tak melayout, jadi yang diuji adalah RANTAI-nya: harus ada leluhur yang benar-benar
   scroller, dan tiap mata rantai di antaranya harus meneruskan batas tinggi (kolom flex yang
   boleh menyusut). Idiom ini menyalin `scroll-chain.test.tsx` (SPEC-393). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/portal", () => ({
  portalApi: {
    listProjects: vi.fn(), listBacklog: vi.fn(), listTickets: vi.fn(),
    getSpec: vi.fn(), getTicket: vi.fn(), logout: vi.fn(), createTicket: vi.fn(),
  },
}));
import { portalApi } from "../src/api/portal";
import { ClientPortal } from "../src/portal/ClientPortal";
import type { UserView } from "@hanoman/shared";

const USER: UserView = { id: "u1", email: "klien@x.co", role: "client", createdAt: "2026-08-01T00:00:00Z" };

const spec = (n: number) => ({
  id: `SPEC-${n}`, title: `Pekerjaan ${n}`, priority: "sedang", stage: "planned",
  objective: "x", createdAt: "2026-08-01T00:00:00Z", startedAt: null, doneAt: null,
});

beforeEach(() => {
  (portalApi.listProjects as any).mockResolvedValue({ items: [{ id: "p1", name: "Toko Mekar" }] });
  // Cukup panjang untuk melewati viewport mana pun — bug-nya justru tak terlihat di daftar pendek.
  (portalApi.listBacklog as any).mockResolvedValue({
    items: Array.from({ length: 60 }, (_, i) => spec(i + 1)), total: 60, page: 1, pageSize: 60 });
  (portalApi.listTickets as any).mockResolvedValue({
    items: Array.from({ length: 40 }, (_, i) => ({
      id: `t${i}`, number: i + 1, category: "bug", title: `Keluhan ${i + 1}`,
      status: "Sedang ditinjau", createdAt: "2026-08-01T00:00:00Z",
    })), total: 40, page: 1, pageSize: 40 });
  (portalApi.getSpec as any).mockResolvedValue(spec(1));
});

const scrolls = (n: HTMLElement) => n.style.overflow === "auto" || n.style.overflow === "scroll"
  || n.style.overflowY === "auto" || n.style.overflowY === "scroll";

/* Leluhur yang tingginya sudah pasti dengan sendirinya (root portal, atau overlay `fixed`)
   adalah SUMBER batas tinggi — ia tak perlu bisa menyusut, cukup meneruskan. */
const isFrame = (n: HTMLElement) => n.style.position === "fixed" || !!n.style.height || !!n.style.maxHeight;

/** Scroller pertama di atas `el` (null bila tak ada). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) if (scrolls(n)) return n;
  return null;
}

/* Sebuah pane `overflow: auto` hanya bisa menggulir kalau tingginya dibatasi DARI ATAS. Yang
   diperiksa karena itu rantai dari scroller ke ATAS — bukan dari daftar: di dalam scroller,
   pembungkus `display: block` yang tumbuh setinggi isinya justru yang benar. */
function brokenAbove(scroller: HTMLElement, root: HTMLElement): string[] {
  const broken: string[] = [];
  for (let n = scroller.parentElement; n; n = n.parentElement) {
    const display = n.style.display;
    const why: string[] = [];
    if (display !== "flex" && display !== "grid") why.push(`display "${display || "block"}"`);
    if (!isFrame(n) && n.style.minHeight !== "0" && n.style.minHeight !== "0px")
      why.push(`min-height "${n.style.minHeight || "auto"}"`);
    if (why.length) broken.push(`<${n.tagName.toLowerCase()} style="${n.getAttribute("style") ?? ""}"> → ${why.join(" + ")}`);
    if (n === root) break;
  }
  return broken;
}

describe("portal klien bisa digulir (SPEC-626)", () => {
  it("daftar Pekerjaan punya leluhur yang benar-benar menggulir", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    const list = await screen.findByTestId("portal-list");
    const scroller = scrollerOf(list);
    expect(scroller, "tak ada satu pun leluhur ber-overflow auto/scroll").not.toBeNull();
    expect(brokenAbove(scroller!, screen.getByTestId("portal-root"))).toEqual([]);
  });

  it("daftar Help desk memakai scroller yang sama", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByTestId("portal-list");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    const scroller = screen.getByTestId("portal-scroll");
    expect(scrolls(scroller)).toBe(true);
    expect(scrollerOf(await screen.findByTestId("portal-list"))).toBe(scroller);
    expect(brokenAbove(scroller, screen.getByTestId("portal-root"))).toEqual([]);
  });

  // Header di LUAR scroller adalah keputusan, bukan efek samping: itulah yang membuatnya tetap
  // terbaca saat daftar digulir.
  it("header tetap terbaca — ia bukan isi scroller", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByTestId("portal-list");
    const header = screen.getByRole("banner");
    expect(screen.getByTestId("portal-scroll").contains(header)).toBe(false);
    expect(screen.getByTestId("portal-root").contains(header)).toBe(true);
  });

  // Modal SUDAH bisa digulir hari ini (Modal: panel maxHeight 88vh + body overflow auto, dan
  // overlay `position: fixed` tak diklip `#root{overflow:hidden}` karena #root tak membuat
  // containing block). Test ini mengunci kontraknya supaya tak hilang diam-diam.
  it("badan modal detail bisa digulir", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Pekerjaan 1"));
    await waitFor(() => expect(screen.getByTestId("modal-body")).toBeInTheDocument());
    expect(scrolls(screen.getByTestId("modal-body"))).toBe(true);
  });
});
