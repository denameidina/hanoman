import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PortalProject, UserView } from "@hanoman/shared";
import { ClientPortal } from "./ClientPortal";

// ADR-0211 · tab "Tanya & ide" mengikuti `chatEnabled` dari proyeksi project, BUKAN dari probe
// ke /chat/sessions. Tanpa flag, tak ada request chat sama sekali sebelum klien membuka tab itu.
const listProjects = vi.fn();
const listBacklog = vi.fn();
const listTickets = vi.fn();
const listChatSessions = vi.fn();
const getChatQuota = vi.fn();

vi.mock("../api/portal", () => ({
  portalApi: {
    listProjects: (...a: unknown[]) => listProjects(...a),
    listBacklog: (...a: unknown[]) => listBacklog(...a),
    listTickets: (...a: unknown[]) => listTickets(...a),
    listChatSessions: (...a: unknown[]) => listChatSessions(...a),
    getChatQuota: (...a: unknown[]) => getChatQuota(...a),
    getChatSession: vi.fn(),
    startChatSession: vi.fn(),
    sendChatMessage: vi.fn(),
    logout: vi.fn(),
  },
}));

const KOSONG = { items: [], total: 0, page: 1, pageSize: 20 };
const USER = { id: "u1", email: "klien@x.co", role: "client", createdAt: "2026-08-01T00:00:00.000Z" } as UserView;
const proyek = (over: Partial<PortalProject>[]): { items: PortalProject[]; total: number; page: number; pageSize: number } => {
  const items = over.map((o, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, chatEnabled: false, ...o }));
  return { items, total: items.length, page: 1, pageSize: items.length };
};

const renderPortal = () => render(<ClientPortal user={USER} onLoggedOut={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  listBacklog.mockResolvedValue(KOSONG);
  listTickets.mockResolvedValue(KOSONG);
  listChatSessions.mockResolvedValue(KOSONG);
  getChatQuota.mockResolvedValue({ enabled: true, brainstorm: { terpakai: 0, jatah: 2, sisa: 2 },
    tanya: { terpakai: 0, jatah: 30, sisa: 30 }, resetPada: "2026-09-01T00:00:00.000Z" });
});

describe("ClientPortal · tab chat (ADR-0211)", () => {
  it("chatEnabled false: tab 'Tanya & ide' tak tampil dan tak ada probe ke /chat/sessions", async () => {
    listProjects.mockResolvedValue(proyek([{ chatEnabled: false }]));
    renderPortal();
    await screen.findByText("Keluhan saya");
    expect(screen.queryByText("Tanya & ide")).toBeNull();
    expect(listChatSessions).not.toHaveBeenCalled();
  });

  it("chatEnabled true: tab tampil, dan daftar sesi baru dimuat saat tab dibuka", async () => {
    listProjects.mockResolvedValue(proyek([{ chatEnabled: true }]));
    renderPortal();
    fireEvent.click(await screen.findByText("Tanya & ide"));
    await waitFor(() => expect(listChatSessions).toHaveBeenCalledWith("p1", { page: 1, limit: 20 }));
  });

  it("pindah ke project tanpa chat saat tab 'Tanya' terbuka: kembali ke Keluhan, ChatPanel tak dirender", async () => {
    listProjects.mockResolvedValue(proyek([{ chatEnabled: true }, { chatEnabled: false }]));
    renderPortal();
    fireEvent.click(await screen.findByText("Tanya & ide"));
    expect(await screen.findByText("Brainstorming")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "P2" }));
    await waitFor(() => expect(screen.queryByText("Brainstorming")).toBeNull());
    expect(screen.queryByText("Tanya & ide")).toBeNull();
    expect(listChatSessions).not.toHaveBeenCalledWith("p2", expect.anything());
  });
});
