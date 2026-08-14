import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../src/api/client";

// jsdom tak menyediakan WebSocket — kita pasang palsu sebelum modul memanggil `new WebSocket`.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

beforeEach(() => { FakeWS.instances = []; (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS; });
afterEach(() => { vi.restoreAllMocks(); });

describe("client events singleton", () => {
  it("membuka satu koneksi untuk banyak subscriber, meneruskan frame, menutup saat sub terakhir lepas", async () => {
    vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket: "ws-once" });
    const { subscribe } = await import("../src/api/events");
    const got: string[] = [];
    const un1 = subscribe((m) => { if (m.t === "specs") got.push("a"); });
    const un2 = subscribe((m) => { if (m.t === "specs") got.push("b"); });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1)); // satu koneksi dibagi
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    expect(got).toEqual(["a", "b"]);
    un1(); un2();
    expect(conn.readyState).toBe(3); // ditutup saat sub terakhir lepas
  });
});
