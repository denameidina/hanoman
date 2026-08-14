import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PublicHelpApp } from "../src/public/PublicHelpApp";

function setPath(p: string) { window.history.pushState({}, "", p); }

beforeEach(() => { vi.restoreAllMocks(); });

describe("SPEC-253 · PublicHelpApp routing", () => {
  it("owns a dynamic-viewport vertical scroller on mobile", async () => {
    setPath("/help/demo");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ projectName: "Demo", categories: ["bug"] }), { status: 200 }),
    );
    render(<PublicHelpApp />);
    await screen.findByText(/Demo/);
    expect(screen.getByTestId("public-help-scroll")).toHaveStyle({ height: "100dvh", overflowY: "auto" });
  });
  it("render form untuk /help/:slug (dari GET info)", async () => {
    setPath("/help/demo");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ projectName: "Demo", categories: ["bug", "fitur", "pertanyaan", "lainnya"] }), { status: 200 }),
    );
    render(<PublicHelpApp />);
    await waitFor(() => expect(screen.getByText(/Demo/)).toBeTruthy());
    expect(screen.getByLabelText(/detail/i)).toBeTruthy();
    expect(screen.getByLabelText(/judul/i)).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });

  it("render status untuk /help/:slug/status/:key", async () => {
    setPath("/help/demo/status/hnm_tkt_x");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ number: 3, category: "bug", title: "T", status: "Diterima", createdAt: new Date().toISOString() }), { status: 200 }),
    );
    render(<PublicHelpApp />);
    await waitFor(() => expect(screen.getByText(/Diterima/)).toBeTruthy());
    expect(screen.getByText(/Tiket #3/)).toBeTruthy();
  });

  it("submit valid → tampilkan nomor tiket + link status", async () => {
    setPath("/help/demo");
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation((url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/api/help/demo") && (!init || init.method === undefined))
        return Promise.resolve(new Response(JSON.stringify({ projectName: "Demo", categories: ["bug"] }), { status: 200 }));
      if (u.endsWith("/api/help/demo/tickets"))
        return Promise.resolve(new Response(JSON.stringify({ number: 7, key: "hnm_tkt_z", statusPath: "/help/demo/status/hnm_tkt_z" }), { status: 201 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    render(<PublicHelpApp />);
    await waitFor(() => screen.getByLabelText(/judul/i));
    fireEvent.change(screen.getByLabelText(/judul/i), { target: { value: "Rusak" } });
    fireEvent.change(screen.getByLabelText(/detail/i), { target: { value: "Detil masalah" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    await waitFor(() => expect(screen.getByText(/tiket #7/i)).toBeTruthy());
    expect(screen.getByText(/\/help\/demo\/status\/hnm_tkt_z/)).toBeTruthy();
    // submit memakai multipart FormData
    const submitCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/tickets"));
    expect((submitCall?.[1] as any)?.body instanceof FormData).toBe(true);
  });

  // SPEC-352 · honeypot menjawab 200 {ok:true} — bentuk yang BEDA dari sukses asli. Dulu klien
  // menelannya mentah dan merender "tiket #undefined" + tautan rusak `origin` + undefined.
  it("respons 200 tanpa number/statusPath → pesan gagal, bukan 'tiket #undefined'", async () => {
    setPath("/help/demo");
    vi.spyOn(global, "fetch").mockImplementation((url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith("/api/help/demo") && (!init || init.method === undefined))
        return Promise.resolve(new Response(JSON.stringify({ projectName: "Demo", categories: ["bug"] }), { status: 200 }));
      if (u.endsWith("/api/help/demo/tickets"))
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    render(<PublicHelpApp />);
    await waitFor(() => screen.getByLabelText(/judul/i));
    fireEvent.change(screen.getByLabelText(/judul/i), { target: { value: "Rusak" } });
    fireEvent.change(screen.getByLabelText(/detail/i), { target: { value: "Detil masalah" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    await waitFor(() => expect(screen.getByText(/gagal mengirim/i)).toBeTruthy());
    expect(screen.queryByText(/undefined/i)).toBeNull();
    expect(screen.queryByText(/terima kasih/i)).toBeNull();
  });

  // SPEC-352 · akar masalah: honeypot bernama `hp` (= "handphone") di form berbahasa Indonesia
  // diisi autofill browser. Nama netral + autocomplete yang benar-benar dihormati browser.
  it("field honeypot tak bernama `hp` dan memakai autocomplete yang dihormati browser", async () => {
    setPath("/help/demo");
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ projectName: "Demo", categories: ["bug"] }), { status: 200 }),
    );
    const { container } = render(<PublicHelpApp />);
    await waitFor(() => screen.getByLabelText(/judul/i));
    expect(container.querySelector('input[name="hp"]')).toBeNull();
    const trap = container.querySelector('input[name="hc_trap"]') as HTMLInputElement | null;
    expect(trap).toBeTruthy();
    expect(trap!.getAttribute("autocomplete")).toBe("new-password");
    expect(trap!.tabIndex).toBe(-1);
  });
});
