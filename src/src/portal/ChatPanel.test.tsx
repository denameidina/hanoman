import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

const listChatSessions = vi.fn();
const getChatSession = vi.fn();
const startChatSession = vi.fn();
const sendChatMessage = vi.fn();

vi.mock("../api/portal", () => ({
  portalApi: {
    listChatSessions: (...a: unknown[]) => listChatSessions(...a),
    getChatSession: (...a: unknown[]) => getChatSession(...a),
    startChatSession: (...a: unknown[]) => startChatSession(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
  },
}));

const KOSONG = { items: [], total: 0, page: 1, pageSize: 20 };
const SESI = {
  id: "s1", type: "tanya" as const, summary: "", prdSiap: false,
  createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  listChatSessions.mockResolvedValue(KOSONG);
  getChatSession.mockResolvedValue({ session: SESI, messages: KOSONG });
  startChatSession.mockResolvedValue(SESI);
  sendChatMessage.mockResolvedValue({
    id: "m2", seq: 2, role: "hanoman", text: "Sedang dikerjakan.",
    createdAt: "2026-08-19T00:00:01.000Z" });
});

describe("permukaan chat portal (SPEC-854)", () => {
  it("klien memilih tipe sesi saat memulai", async () => {
    render(<ChatPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("Brainstorming")).toBeTruthy());
    expect(screen.getByText("Bertanya")).toBeTruthy();
  });

  // Bedanya dari Help desk harus terbaca klien, bukan disimpulkan sendiri (constraint brief).
  it("menjelaskan bedanya dengan Help desk", async () => {
    render(<ChatPanel projectId="p1" />);
    const b = await screen.findByTestId("chat-beda-help");
    expect(b.textContent).toMatch(/Help desk/i);
  });

  it("mengirim pesan menampilkan giliran klien lalu jawaban hanoman", async () => {
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    const box = await screen.findByTestId("chat-input");
    fireEvent.change(box, { target: { value: "kapan selesai?" } });
    fireEvent.click(screen.getByTestId("chat-kirim"));
    await waitFor(() => expect(screen.getByText("Sedang dikerjakan.")).toBeTruthy());
    expect(screen.getByText("kapan selesai?")).toBeTruthy();
    expect(startChatSession).toHaveBeenCalledWith("p1", "tanya");
    expect(sendChatMessage).toHaveBeenCalledWith("p1", "s1", "kapan selesai?");
  });

  it("pesan kosong tak terkirim", async () => {
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    await screen.findByTestId("chat-input");
    fireEvent.click(screen.getByTestId("chat-kirim"));
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  // Gagal jaringan tak boleh memuntahkan kode status / nama route ke klien (huruf E).
  it("gagal kirim dijawab satu kalimat awam", async () => {
    sendChatMessage.mockRejectedValue(new Error("POST /api/portal/... → 500"));
    render(<ChatPanel projectId="p1" />);
    fireEvent.click(await screen.findByText("Bertanya"));
    fireEvent.change(await screen.findByTestId("chat-input"), { target: { value: "halo" } });
    fireEvent.click(screen.getByTestId("chat-kirim"));
    const galat = await screen.findByTestId("chat-galat");
    expect(galat.textContent).not.toMatch(/500|\/api\/|POST|Error/);
    expect(galat.textContent!.length).toBeGreaterThan(10);
  });
});
