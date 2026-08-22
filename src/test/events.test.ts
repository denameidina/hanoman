import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// jsdom tak menyediakan WebSocket — kita pasang palsu sebelum modul memanggil `new WebSocket`.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string;
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

// Modulnya singleton ber-state (koneksi + status koneksi); tiap test butuh instansi baru.
beforeEach(() => {
  vi.resetModules();
  FakeWS.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { vi.restoreAllMocks(); });

// `vi.resetModules()` memberi `api/events` instansi `api/client` yang BARU, jadi spy atas `api`
// yang di-import statis tak akan mengenainya — tiketnya wajib di-mock lewat modul yang sama.
async function load(ticket = "t") {
  const { api } = await import("../src/api/client");
  vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket });
  return import("../src/api/events");
}

function hidden(value: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("client events singleton", () => {
  it("membuka satu koneksi untuk banyak subscriber, meneruskan frame, menutup saat sub terakhir lepas", async () => {
    const { subscribe } = await load("ws-once");
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

describe("status koneksi events (SPEC-897)", () => {
  it("mulai tak terhubung dan menyalakan `connected` pada FRAME PERTAMA, bukan pada onopen", async () => {
    const { subscribe, subscribeStatus, eventsStatus } = await load("t");
    const seen: boolean[] = [];
    subscribeStatus((s) => seen.push(s.connected));
    expect(eventsStatus().connected).toBe(false);
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.onopen?.();
    expect(eventsStatus().connected).toBe(false);   // socket terbuka ≠ frame tiba
    expect(seen).toEqual([]);
    conn.emit({ t: "specs", specs: [] });
    expect(eventsStatus().connected).toBe(true);
    expect(seen).toEqual([true]);
  });

  it("frame kedua tak memanggil handler lagi (status yang tak berubah tak memicu render)", async () => {
    const { subscribe, subscribeStatus } = await load("t");
    const seen: boolean[] = [];
    subscribeStatus((s) => seen.push(s.connected));
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    conn.emit({ t: "specs", specs: [] });
    expect(seen).toEqual([true]);
  });

  it("onclose mematikan `connected` dan mencap ulang `since`", async () => {
    const { subscribe, subscribeStatus, eventsStatus } = await load("t");
    subscribeStatus(() => { });
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    const conn = FakeWS.instances[0]!;
    conn.emit({ t: "specs", specs: [] });
    const connectedAt = eventsStatus().since;
    conn.close();
    expect(eventsStatus().connected).toBe(false);
    expect(eventsStatus().since).toBeGreaterThanOrEqual(connectedAt);
    expect(eventsStatus().paused).toBe(false);
  });

  it("tab hidden = `paused`, bukan gangguan; tab aktif lagi menolkan jam putus", async () => {
    const { subscribe, subscribeStatus, eventsStatus } = await load("t");
    subscribeStatus(() => { });
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });

    let t = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);

    hidden(true);
    expect(eventsStatus().paused).toBe(true);
    expect(eventsStatus().connected).toBe(false);   // socket ditutup oleh onVisibility
    expect(eventsStatus().since).toBe(1_000_000);

    t = 1_500_000;
    hidden(false);
    expect(eventsStatus().paused).toBe(false);
    // Jam "tak terhubung sejak" DINOLKAN: tanpa ini `since` bernilai jam-jam lalu dan pet langsung
    // mengaku putus di detik pertama tab kembali.
    expect(eventsStatus().since).toBe(1_500_000);
  });

  it("berhenti memberi tahu setelah unsubscribe", async () => {
    const { subscribe, subscribeStatus } = await load("t");
    const seen: boolean[] = [];
    const off = subscribeStatus((s) => seen.push(s.connected));
    subscribe(() => { });
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(1));
    off();
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    expect(seen).toEqual([]);
  });
});
