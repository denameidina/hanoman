import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ClientPortal } from "../src/portal/ClientPortal";
import type { UserView } from "@hanoman/shared";

vi.mock("../src/api/portal", () => ({
  portalApi: {
    listProjects: vi.fn(), listBacklog: vi.fn(), listTickets: vi.fn(),
    getSpec: vi.fn(), getTicket: vi.fn(), logout: vi.fn(), createTicket: vi.fn(),
  },
}));
import { portalApi } from "../src/api/portal";

const USER: UserView = { id: "u1", email: "klien@x.co", role: "client", createdAt: "2026-08-01T00:00:00Z" };

beforeEach(() => {
  (portalApi.listProjects as any).mockResolvedValue({ items: [{ id: "p1", name: "Toko Mekar" }] });
  (portalApi.listBacklog as any).mockResolvedValue({ items: [{
    id: "SPEC-1", title: "Checkout gagal", priority: "tinggi", stage: "executing",
    objective: "Checkout kembali jalan",
    createdAt: "2026-08-01T00:00:00Z", startedAt: "2026-08-02T00:00:00Z", doneAt: null }], total: 1, page: 1, pageSize: 1 });
  (portalApi.listTickets as any).mockResolvedValue({ items: [{
    id: "t1", number: 3, category: "bug", title: "Tombol bayar mati",
    status: "Sedang dikerjakan", createdAt: "2026-08-01T00:00:00Z" }], total: 1, page: 1, pageSize: 1 });
  (portalApi.getSpec as any).mockResolvedValue({
    id: "SPEC-1", title: "Checkout gagal", priority: "tinggi", stage: "executing",
    objective: "Checkout kembali jalan",
    createdAt: "2026-08-01T00:00:00Z", startedAt: "2026-08-02T00:00:00Z", doneAt: null });
  (portalApi.getTicket as any).mockResolvedValue({
    id: "t1", number: 3, category: "bug", title: "Tombol bayar mati", status: "Sedang dikerjakan",
    createdAt: "2026-08-01T00:00:00Z", detail: "Klik bayar tak terjadi apa-apa" });
  (portalApi.logout as any).mockResolvedValue(undefined);
});

describe("ClientPortal (SPEC-617)", () => {
  it("menampilkan project yang ditugaskan, backlog, dan tiketnya", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText("Toko Mekar")).toBeTruthy();
    expect(await screen.findByText("Checkout gagal")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    expect(await screen.findByText("Tombol bayar mati")).toBeTruthy();
    expect(screen.getByText("Sedang dikerjakan")).toBeTruthy();
  });

  it("detail backlog terbuka baca-saja", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Checkout gagal"));
    expect(await screen.findByText("Checkout kembali jalan")).toBeTruthy();
    await waitFor(() => expect(portalApi.getSpec).toHaveBeenCalledWith("p1", "SPEC-1"));
  });

  // Sidebar operator (Terminal/VPS/Settings/IDE) tak boleh muncul — bukan karena rahasia,
  // melainkan karena setiap entrinya adalah 403 yang menunggu diklik.
  it("tak merender navigasi operator satu pun", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    for (const label of ["Terminal", "VPS", "Settings", "IDE", "Scheduler", "Lead", "Docs · SoT", "PRD"])
      expect(screen.queryByText(label), label).toBeNull();
  });

  it("tanpa project yang ditugaskan → keadaan kosong, bukan halaman rusak", async () => {
    (portalApi.listProjects as any).mockResolvedValue({ items: [] });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText(/belum ada project/i)).toBeTruthy();
  });

  it("tombol keluar memanggil logout lalu melapor ke pemanggil", async () => {
    const onLoggedOut = vi.fn();
    render(<ClientPortal user={USER} onLoggedOut={onLoggedOut} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /keluar/i }));
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled());
  });

  // Gagal jaringan tak boleh terbaca sebagai "Anda memang belum diberi project".
  it("gagal memuat dibedakan dari kosong", async () => {
    (portalApi.listProjects as any).mockRejectedValue(new Error("boom"));
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    expect(await screen.findByText(/gagal memuat/i)).toBeTruthy();
  });

  // Warna berbeda antara baris daftar dan modal untuk tiket yang SAMA adalah bug yang sedang
  // diperbaiki — dijaga di sini supaya tak direplikasi.
  it("badge tiket berwarna sama di baris daftar dan di modal detail", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    const row = await screen.findByText("Tombol bayar mati");
    const rowPill = within(row.closest('[role="button"]') as HTMLElement)
      .getByText("Sedang dikerjakan");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("modal-body")).toBeInTheDocument());
    const modalPill = within(screen.getByTestId("modal-body")).getByText("Sedang dikerjakan");
    expect(modalPill.parentElement!.style.background).toBe(rowPill.parentElement!.style.background);
    // …dan bukan abu-abu `idle` yang lama.
    expect(rowPill.parentElement!.style.background).not.toBe("var(--bone-200)");
  });

  it("klien mengirim keluhan dari dalam portal, tiketnya langsung tampak", async () => {
    (portalApi.createTicket as any).mockResolvedValue({
      id: "t9", number: 9, category: "bug", title: "Struk tak keluar",
      status: "Sedang ditinjau", createdAt: "2026-08-10T00:00:00Z" });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");

    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Struk tak keluar" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "Setelah bayar, struk kosong" } });
    fireEvent.click(screen.getByRole("button", { name: /^kirim$/i }));

    await waitFor(() => expect(portalApi.createTicket).toHaveBeenCalled());
    const [projectId, form] = (portalApi.createTicket as any).mock.calls[0];
    expect(projectId).toBe("p1");
    expect(form.get("title")).toBe("Struk tak keluar");
    expect(form.get("detail")).toBe("Setelah bayar, struk kosong");
    expect(form.get("category")).toBe("bug");
    // Email tak pernah diketik ulang — server mengambilnya dari akun.
    expect(form.get("email")).toBeNull();
    // Sesudah terkirim: tab pindah ke Help desk dan daftarnya dimuat ulang dari server.
    await waitFor(() => expect((portalApi.listTickets as any).mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText("Tombol bayar mati")).toBeTruthy();
  });

  it("hanya project yang boleh diakses yang bisa dipilih sebagai tujuan", async () => {
    (portalApi.listProjects as any).mockResolvedValue({
      items: [{ id: "p1", name: "Toko Mekar" }, { id: "p3", name: "Warung Sari" }] });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    const opts = Array.from((screen.getByLabelText("Project") as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toEqual(["p1", "p3"]);
  });

  it("gagal kirim menampilkan pesan, tak menutup form", async () => {
    (portalApi.createTicket as any).mockRejectedValue(new Error("boom"));
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /^kirim$/i }));
    expect(await screen.findByText(/gagal mengirim/i)).toBeTruthy();
    expect(screen.getByLabelText("Judul")).toBeTruthy();
  });
});
