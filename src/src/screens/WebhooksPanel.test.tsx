import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhooksPanel } from "./WebhooksPanel";

const endpoint = {
  id: "w1", name: "Dashboard internal", url: "https://contoh.id/hook",
  events: ["spec.*"], projectIds: null, enabled: true, allowPrivate: false, apiVersion: 1,
  maxPerMinute: 60, secretHint: "9f2c", disabledAt: null, disabledReason: null,
  lastSuccessAt: "2026-08-01T09:00:00.000Z", lastFailureAt: null, failureStreak: 0, pending: 0,
  createdAt: "2026-08-01T08:00:00.000Z", updatedAt: "2026-08-01T09:00:00.000Z",
};
const delivery = {
  id: "d1", endpointId: "w1", eventId: "evt_1", eventType: "spec.stage_changed", projectId: "hanoman",
  status: "failed", attempt: 6, maxAttempts: 6, httpStatus: 500, durationMs: 120,
  error: "HTTP 500", nextAttemptAt: null, createdAt: "2026-08-01T09:10:00.000Z",
  sentAt: null, payload: {},
};

const json = (value: unknown, statusCode = 200) =>
  Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => value } as Response);

function mockFetch(over: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/deliveries")) return json({ items: [delivery] });
    if (url.endsWith("/test")) return json(over.test ?? { ok: true, httpStatus: 200, durationMs: 88, error: null });
    if (url.endsWith("/api/webhooks")) return json({ endpoints: over.endpoints ?? [endpoint], eventTypes: ["spec.created"] });
    return json({});
  });
}

afterEach(() => vi.restoreAllMocks());

describe("WebhooksPanel", () => {
  it("menampilkan endpoint beserta URL dan petunjuk secret, tanpa secret utuh", async () => {
    mockFetch();
    render(<WebhooksPanel />);
    expect(await screen.findByText("Dashboard internal")).toBeTruthy();
    expect(screen.getByText(/contoh\.id\/hook/)).toBeTruthy();
    expect(screen.getByText(/9f2c/)).toBeTruthy();
  });

  it("keadaan kosong mengajak membuat endpoint pertama", async () => {
    mockFetch({ endpoints: [] });
    render(<WebhooksPanel />);
    expect(await screen.findByText(/belum ada endpoint/i)).toBeTruthy();
  });

  it("endpoint yang dinonaktifkan otomatis diberi penanda beserta alasannya", async () => {
    mockFetch({
      endpoints: [{
        ...endpoint, enabled: false, disabledAt: "2026-08-01T09:30:00.000Z",
        disabledReason: "5 pengiriman gagal beruntun",
      }],
    });
    render(<WebhooksPanel />);
    expect(await screen.findByText(/dinonaktifkan otomatis/i)).toBeTruthy();
    expect(screen.getByText(/5 pengiriman gagal beruntun/)).toBeTruthy();
  });

  it("tombol Test mengirim ping dan melaporkan hasilnya", async () => {
    const f = mockFetch();
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^test$/i }));
    await waitFor(() => expect(f.mock.calls.some(([u, i]) =>
      String(u).endsWith("/test") && (i as RequestInit)?.method === "POST")).toBe(true));
    expect(await screen.findByText(/HTTP 200/)).toBeTruthy();
  });

  it("tombol Test yang gagal memperlihatkan pesan galatnya, bukan sekadar `gagal`", async () => {
    mockFetch({ test: { ok: false, httpStatus: null, durationMs: 10_002, error: "timeout 10000 ms" } });
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^test$/i }));
    expect(await screen.findByText(/timeout 10000 ms/)).toBeTruthy();
  });

  it("riwayat pengiriman memperlihatkan status, kode HTTP, percobaan, dan galat", async () => {
    mockFetch();
    render(<WebhooksPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /^riwayat$/i }));
    expect(await screen.findByText("spec.stage_changed")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("6 / 6")).toBeTruthy();
    expect(screen.getByText("HTTP 500")).toBeTruthy();
    expect(screen.getByRole("button", { name: /antre ulang/i })).toBeTruthy();
  });

  it("menautkan halaman dokumentasi", async () => {
    mockFetch();
    const onOpenDocs = vi.fn();
    render(<WebhooksPanel onOpenDocs={onOpenDocs} />);
    fireEvent.click(await screen.findByRole("button", { name: /dokumentasi webhook/i }));
    expect(onOpenDocs).toHaveBeenCalled();
  });

  // Anggaran gaya inline (Z3): layout lewat kelas `hn-wh-*` di integrations.css.
  it("layout lewat kelas: gaya inline tinggal ≤ 6", () => {
    const src = readFileSync(resolve(import.meta.dirname, "WebhooksPanel.tsx"), "utf8");
    expect((src.match(/style=\{\{/g) ?? []).length).toBeLessThanOrEqual(6);
  });
});
