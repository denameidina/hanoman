import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { subKey } from "@hanoman/shared";

// SPEC-908 · langganan berparameter di atas socket `events` yang SAMA (tanpa koneksi kedua).
// FakeWS di sini menambah `send` di atas pola src/test/events.test.ts — yang diuji justru
// frame yang KELUAR dari klien.
class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string; sent: string[] = [];
  constructor(url: string) { this.url = url; FakeWS.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  send(s: string) { this.sent.push(s); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

beforeEach(() => {
  vi.resetModules();
  FakeWS.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { vi.restoreAllMocks(); });

// `vi.resetModules()` memberi `api/events` instansi `api/client` yang BARU, jadi tiketnya wajib
// di-mock lewat modul yang sama (jebakan yang sudah dicatat di events.test.ts).
async function load(ticket = "t") {
  const { api } = await import("../src/api/client");
  vi.spyOn(api, "issueWsTicket").mockResolvedValue({ ticket });
  return import("../src/api/events");
}

const socket = async () => {
  await vi.waitFor(() => expect(FakeWS.instances.length).toBeGreaterThan(0));
  return FakeWS.instances.at(-1)!;
};
const subFrames = (ws: FakeWS) =>
  ws.sent.map((s) => JSON.parse(s) as { t: string; subs: { topic: string; params: Record<string, unknown> }[] })
    .filter((m) => m.t === "sub");

const TICKETS = { page: 1, limit: 20 };

describe("SPEC-908 · frame `sub` dari klien", () => {
  it("mengirim SATU frame untuk beberapa langganan yang dipasang bersamaan", async () => {
    const { subscribeTopic } = await load();
    const off1 = subscribeTopic("tickets", TICKETS, () => {});
    const off2 = subscribeTopic("schedulerQueue", { status: "queued", page: 1, limit: 10 }, () => {});
    const ws = await socket();
    ws.open();
    await vi.waitFor(() => expect(subFrames(ws).length).toBe(1));
    expect(subFrames(ws)[0]!.subs).toHaveLength(2);
    off1(); off2();
  });

  it("mengirim ULANG himpunan penuh setiap socket terbuka lagi", async () => {
    const { subscribeTopic } = await load();
    const off = subscribeTopic("tickets", { page: 3, limit: 20 }, () => {});
    const first = await socket();
    first.open();
    await vi.waitFor(() => expect(subFrames(first).length).toBe(1));
    first.close();
    await vi.waitFor(() => expect(FakeWS.instances.length).toBe(2), { timeout: 3000 });
    const second = FakeWS.instances[1]!;
    second.open();
    await vi.waitFor(() => expect(subFrames(second).length).toBe(1));
    expect(subFrames(second)[0]!.subs[0]!.params).toEqual({ page: 3, limit: 20 });
    off();
  });

  it("melepas langganan terakhir mengirim frame `sub` kosong selama socket masih dipakai", async () => {
    const { subscribe, subscribeTopic } = await load();
    // App selalu memegang satu `subscribe` global (specs/sessions); tanpanya socket ikut ditutup
    // oleh ref-count dan frame pelepasan jadi mubazir — `detach` di server yang menyapunya.
    const offGlobal = subscribe(() => {});
    const off = subscribeTopic("tickets", TICKETS, () => {});
    const ws = await socket();
    ws.open();
    await vi.waitFor(() => expect(subFrames(ws).length).toBe(1));
    off();
    await vi.waitFor(() => expect(subFrames(ws).length).toBe(2));
    expect(subFrames(ws)[1]!.subs).toEqual([]);
    offGlobal();
  });

  it("dua consumer pada parameter yang SAMA = satu entri di frame, satu panggilan per frame", async () => {
    const { subscribeTopic } = await load();
    const a: number[] = [], b: number[] = [];
    const off1 = subscribeTopic("tickets", TICKETS, () => a.push(1));
    const off2 = subscribeTopic("tickets", { limit: 20, page: 1 }, () => b.push(1));
    const ws = await socket();
    ws.open();
    await vi.waitFor(() => expect(subFrames(ws).length).toBe(1));
    expect(subFrames(ws)[0]!.subs).toHaveLength(1);
    ws.emit({ t: "tickets", key: subKey("tickets", TICKETS), data: {} });
    // Tepat sekali masing-masing: listener per-consumer, bukan iterasi himpunan handler bersama.
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    off1(); off2();
  });
});

describe("SPEC-908 · pencocokan frame masuk", () => {
  it("hanya meneruskan frame yang `key`-nya milik langganan ini", async () => {
    const { subscribeTopic } = await load();
    const seen: unknown[] = [];
    const off = subscribeTopic("tickets", TICKETS, (m) => seen.push(m));
    const ws = await socket();
    ws.open();
    ws.emit({ t: "tickets", key: subKey("tickets", { page: 2, limit: 20 }), data: {} });
    expect(seen).toHaveLength(0);
    ws.emit({ t: "tickets", key: subKey("tickets", TICKETS), data: {} });
    expect(seen).toHaveLength(1);
    off();
  });

  it("frame grup global tak pernah mendarat di pelanggan topik", async () => {
    const { subscribeTopic } = await load();
    const seen: unknown[] = [];
    const off = subscribeTopic("tickets", TICKETS, (m) => seen.push(m));
    const ws = await socket();
    ws.open();
    ws.emit({ t: "specs", specs: [] });
    expect(seen).toHaveLength(0);
    off();
  });
});

describe("SPEC-908 · negosiasi kemampuan lewat `hello`", () => {
  it("`eventsTopics()` kosong sebelum frame tiba, terisi sesudahnya", async () => {
    const { subscribeTopic, eventsTopics } = await load();
    const off = subscribeTopic("tickets", TICKETS, () => {});
    const ws = await socket();
    ws.open();
    expect(eventsTopics()).toEqual([]);
    ws.emit({ t: "hello", topics: ["tickets", "git"] });
    expect(eventsTopics()).toEqual(["tickets", "git"]);
    off();
  });

  it("`subscribeTopics` memberitahu pelanggan saat daftarnya tiba", async () => {
    const { subscribeTopic, subscribeTopics } = await load();
    const seen: string[][] = [];
    const offT = subscribeTopics((t) => seen.push([...t]));
    const off = subscribeTopic("tickets", TICKETS, () => {});
    const ws = await socket();
    ws.open();
    ws.emit({ t: "hello", topics: ["tickets"] });
    expect(seen.at(-1)).toEqual(["tickets"]);
    off(); offT();
  });

  it("`eventsSilentSince()` null sampai frame pertama tiba", async () => {
    const { subscribeTopic, eventsSilentSince } = await load();
    const off = subscribeTopic("tickets", TICKETS, () => {});
    const ws = await socket();
    ws.open();
    expect(eventsSilentSince()).toBeNull();
    ws.emit({ t: "hello", topics: [] });
    expect(eventsSilentSince()).not.toBeNull();
    off();
  });

  it("daftar topik BERTAHAN melintasi reconnect — mengosongkannya menyalakan fallback poll tanpa sebab", async () => {
    const { subscribeTopic, eventsTopics } = await load();
    const off = subscribeTopic("tickets", TICKETS, () => {});
    const first = await socket();
    first.open();
    first.emit({ t: "hello", topics: ["tickets"] });
    first.close();
    expect(eventsTopics()).toEqual(["tickets"]);
    off();
  });
});
