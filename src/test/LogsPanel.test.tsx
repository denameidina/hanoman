import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LogsPanel } from "../src/screens/LogsPanel";
import * as client from "../src/api/client";

describe("LogsPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("merender StateBlock empty saat nol hasil", async () => {
    vi.spyOn(client, "logs").mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(client, "logRetention").mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 });
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText(/tidak ada/i)).toBeInTheDocument());
  });

  it("menampilkan galat rentang 400 apa adanya", async () => {
    vi.spyOn(client, "logs").mockRejectedValue(new Error("logs 400"));
    vi.spyOn(client, "logRetention").mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 });
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText(/400/)).toBeInTheDocument());
  });

  it("tombol Muat lagi memakai nextCursor, bukan nomor halaman", async () => {
    vi.spyOn(client, "logRetention").mockResolvedValue({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 });
    const spy = vi.spyOn(client, "logs")
      .mockResolvedValueOnce({ items: [{ id: 1, deviceId: "local", deviceName: "local", lane: "event",
        seq: "1", ts: new Date().toISOString(), receivedAt: new Date().toISOString(), level: "info",
        kind: "x", projectId: null, specId: null, sessionId: null, msg: "a", data: null, hasTranscript: false }],
        nextCursor: "abc" })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    screen.getByRole("button", { name: /muat lagi/i }).click();
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "abc" })));
  });
});
