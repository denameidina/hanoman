// Audit UI/UX 2026-10 · Fase 2B · antrean toast: maks 3 terlihat, durasi per toast (2,6 dtk; 7 dtk bila
// ada aksi), jeda saat hover/fokus, aksi "Urungkan", dan wadah live region yang selalu ada di DOM.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useToast, Toast, ToastHost, type ShowToast } from "../src/ds/kit";

function Harness({ onReady }: { onReady: (show: ShowToast) => void }) {
  const [toast, show] = useToast();
  onReady(show);
  return <Toast toast={toast} />;
}

function mount() {
  let show!: ShowToast;
  const utils = render(<Harness onReady={(s) => { show = s; }} />);
  return { ...utils, show: (...args: Parameters<ShowToast>) => act(() => show(...args)) };
}

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const itemOf = (text: string) => screen.getByText(text).closest(".hn-toast") as HTMLElement;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("ToastHost · wadah live region", () => {
  it("wadah role=status selalu ada di DOM, meski tak ada toast", () => {
    const { container } = mount();
    const region = container.querySelector("[data-hn-toast-host]") as HTMLElement;
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
  });

  it("toast biasa masuk ke wadah status; toast bernada err adalah role=alert assertive", () => {
    const { show } = mount();
    show("Tersimpan");
    show("Gagal menyimpan", "err");
    expect(screen.getByRole("status")).toHaveTextContent("Tersimpan");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Gagal menyimpan");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(itemOf("Tersimpan")).not.toHaveAttribute("role");
  });

  it("ToastData tunggal (bentuk lama) tetap dirender dan hilang sendiri", () => {
    render(<ToastHost toast={{ message: "lama", tone: "ok", k: 1 }} />);
    expect(screen.getByRole("status")).toHaveTextContent("lama");
    tick(2600);
    expect(screen.queryByText("lama")).toBeNull();
  });
});

describe("useToast · antrean", () => {
  it("maksimal tiga toast terlihat; yang keempat menunggu sampai ada slot kosong", () => {
    const { show } = mount();
    show("A"); show("B"); show("C"); show("D");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
    expect(screen.queryByText("D")).toBeNull();
    tick(2600);
    // A–C selesai bersamaan; D baru masuk dan timernya mulai saat ia terlihat.
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("D")).toBeInTheDocument();
    tick(2599);
    expect(screen.getByText("D")).toBeInTheDocument();
    tick(1);
    expect(screen.queryByText("D")).toBeNull();
  });

  it("setiap toast hilang sendiri setelah 2,6 dtk secara default", () => {
    const { show } = mount();
    show("Biasa");
    tick(2599);
    expect(screen.getByText("Biasa")).toBeInTheDocument();
    tick(1);
    expect(screen.queryByText("Biasa")).toBeNull();
  });

  it("toast ber-aksi bertahan 7 dtk", () => {
    const { show } = mount();
    show("Dihapus", "ok", undefined, { action: { label: "Urungkan", onAction: () => {} } });
    tick(2600);
    expect(screen.getByText("Dihapus")).toBeInTheDocument();
    tick(4399);
    expect(screen.getByText("Dihapus")).toBeInTheDocument();
    tick(1);
    expect(screen.queryByText("Dihapus")).toBeNull();
  });

  it("opts.duration menggantikan durasi bawaan", () => {
    const { show } = mount();
    show("Cepat", "ok", undefined, { duration: 500 });
    tick(499);
    expect(screen.getByText("Cepat")).toBeInTheDocument();
    tick(1);
    expect(screen.queryByText("Cepat")).toBeNull();
  });

  it("tombol aksi memanggil onAction sekali dan langsung menutup toast", () => {
    const onAction = vi.fn();
    const { show } = mount();
    show("Entri dibuang", "ok", undefined, { action: { label: "Urungkan", onAction } });
    fireEvent.click(screen.getByRole("button", { name: "Urungkan" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText("Entri dibuang")).toBeNull();
  });

  it("hover menjeda timer; sisa waktu dilanjutkan saat kursor pergi", () => {
    const { show } = mount();
    show("Disorot");
    tick(1000);
    fireEvent.mouseEnter(itemOf("Disorot"));
    tick(10_000);
    expect(screen.getByText("Disorot")).toBeInTheDocument();
    fireEvent.mouseLeave(itemOf("Disorot"));
    tick(1599);
    expect(screen.getByText("Disorot")).toBeInTheDocument();
    tick(1);
    expect(screen.queryByText("Disorot")).toBeNull();
  });

  it("fokus ke tombol aksi juga menjeda timer", () => {
    const { show } = mount();
    show("Fokus", "ok", undefined, { action: { label: "Urungkan", onAction: () => {} } });
    tick(3000);
    act(() => { screen.getByRole("button", { name: "Urungkan" }).focus(); });
    tick(60_000);
    expect(screen.getByText("Fokus")).toBeInTheDocument();
  });
});
