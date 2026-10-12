import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

// QA Chrome (ui-ux-audit): "koneksi terputus · menyambung ulang…" tampil di /dalang dan /triage
// padahal tak ada WebSocket yang pernah dibuat. Berkas ini memakai modul `api/events` yang
// SUNGGUHAN (bukan stub), supaya lencana diuji di atas siklus langganan yang sama dengan browser.

class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string; protocols: string[];
  constructor(url: string, protocols: string[] = []) { this.url = url; this.protocols = protocols; FakeWS.instances.push(this); }
  close() { this.readyState = 2; }
  fireOpen() { this.readyState = 1; this.onopen?.(); }
  fireClose() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

type PendingTicket = { resolve: (v: { ticket: string }) => void; settled: boolean };
let tickets: PendingTicket[] = [];

async function load() {
  const { api } = await import("../src/api/client");
  vi.spyOn(api, "issueWsTicket").mockImplementation(() => new Promise<{ ticket: string }>((resolve) => {
    tickets.push({ resolve, settled: false });
  }));
  const events = await import("../src/api/events");
  const { LiveConnectionBadge } = await import("../src/ds/components/live");
  return { ...events, LiveConnectionBadge };
}

const flush = async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); };
async function grantAll() {
  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i]!;
    if (t.settled) continue;
    t.settled = true;
    t.resolve({ ticket: `t${i}` });
    await flush();
  }
}

const BADGE = /koneksi terputus/i;
const badgeShown = () => screen.queryByText(BADGE) !== null;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeWS.instances = [];
  tickets = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("lencana koneksi (QA ui-ux-audit)", () => {
  it("tanpa langganan sama sekali, lencana TAK PERNAH muncul — idle, bukan terputus", async () => {
    const { LiveConnectionBadge } = await load();
    render(<LiveConnectionBadge />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(badgeShown()).toBe(false);
    expect(tickets).toHaveLength(0);
  });

  it("StrictMode: komponen yang berlangganan di efek membuka tepat satu socket, dan lencana diam setelah frame pertama", async () => {
    const { LiveConnectionBadge, subscribe } = await load();
    function Subscriber() {
      React.useEffect(() => subscribe(() => {}), []);
      return null;
    }
    render(<React.StrictMode><LiveConnectionBadge /><Subscriber /></React.StrictMode>);
    await act(async () => { await grantAll(); });
    expect(FakeWS.instances).toHaveLength(1);
    act(() => {
      FakeWS.instances[0]!.fireOpen();
      FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(badgeShown()).toBe(false);
  });

  it("langganan aktif tetapi tiket tak pernah kembali: lencana muncul setelah grace 6 dtk", async () => {
    const { LiveConnectionBadge, subscribe } = await load();
    render(<LiveConnectionBadge />);
    act(() => { subscribe(() => {}); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(badgeShown()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(badgeShown()).toBe(true);
  });

  it("socket tersambung lalu putus: lencana muncul setelah grace, hilang saat tersambung lagi", async () => {
    const { LiveConnectionBadge, subscribe } = await load();
    render(<LiveConnectionBadge />);
    act(() => { subscribe(() => {}); });
    await act(async () => { await grantAll(); });
    act(() => {
      FakeWS.instances[0]!.fireOpen();
      FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    });
    expect(badgeShown()).toBe(false);
    act(() => { FakeWS.instances[0]!.fireClose(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(badgeShown()).toBe(true);
    // Retry ber-backoff (500 dtk) meminta tiket baru; socket kedua tersambung dan mengirim frame.
    await act(async () => { await grantAll(); });
    expect(FakeWS.instances).toHaveLength(2);
    act(() => {
      FakeWS.instances[1]!.fireOpen();
      FakeWS.instances[1]!.emit({ t: "specs", specs: [] });
    });
    expect(badgeShown()).toBe(false);
  });

  it("tab tersembunyi dengan langganan aktif: tak ada lencana (paused, bukan gangguan)", async () => {
    const { LiveConnectionBadge, subscribe } = await load();
    render(<LiveConnectionBadge />);
    act(() => { subscribe(() => {}); });
    await act(async () => { await grantAll(); });
    act(() => {
      FakeWS.instances[0]!.fireOpen();
      FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    });
    act(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(badgeShown()).toBe(false);
  });

  it("lencana sedang tampil lalu semua langganan lepas: lencana hilang (idle)", async () => {
    const { LiveConnectionBadge, subscribe } = await load();
    render(<LiveConnectionBadge />);
    let off = () => {};
    act(() => { off = subscribe(() => {}); });
    await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
    expect(badgeShown()).toBe(true);
    act(() => { off(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(badgeShown()).toBe(false);
  });
});
