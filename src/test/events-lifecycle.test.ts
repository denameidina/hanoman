import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// QA Chrome (ui-ux-audit): badge "koneksi terputus" tampil padahal browser tak pernah membuat
// WebSocket — `POST /api/ws-tickets` 200 sekali, lalu 0 event websocket. Berkas ini mereproduksi
// siklus langganan vs. tiket yang masih terbang, pada `api/events.ts` yang sebenarnya.
//
// FakeWS meniru browser: `close()` TIDAK memanggil onclose seketika — ia datang belakangan.
// Tiket dikendalikan penuh oleh test (`grant`), supaya urutan kembalinya bisa dipaksa.

class FakeWS {
  static instances: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onerror?: () => void; onmessage?: (e: { data: string }) => void;
  readyState = 0; url: string; protocols: string[];
  constructor(url: string, protocols: string[] = []) { this.url = url; this.protocols = protocols; FakeWS.instances.push(this); }
  close() { this.readyState = 2; }
  fireOpen() { this.readyState = 1; this.onopen?.(); }
  fireClose() { this.readyState = 3; this.onclose?.(); }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  get ticket(): string | undefined { return this.protocols[0]?.replace("hanoman-ticket.", ""); }
}

type PendingTicket = { resolve: (v: { ticket: string }) => void; settled: boolean };
let tickets: PendingTicket[] = [];

// `vi.resetModules()` memberi `api/events` instansi `api/client` yang BARU; tiket wajib di-mock lewat
// modul yang sama (jebakan yang sudah dicatat di events.test.ts).
async function load() {
  const { api } = await import("../src/api/client");
  vi.spyOn(api, "issueWsTicket").mockImplementation(() => new Promise<{ ticket: string }>((resolve) => {
    tickets.push({ resolve, settled: false });
  }));
  return import("../src/api/events");
}

const flush = async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); };

// Menyelesaikan tiket ke-i (urutan panggilan `issueWsTicket`). Nilainya `t<i>` agar test bisa
// membedakan tiket mana yang dipakai socket.
async function grant(i: number) {
  const t = tickets[i]!;
  t.settled = true;
  t.resolve({ ticket: `t${i}` });
  await flush();
}
async function grantAll() {
  for (let i = 0; i < tickets.length; i++) if (!tickets[i]!.settled) await grant(i);
}

function hidden(value: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeWS.instances = [];
  tickets = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("siklus langganan vs tiket yang masih terbang (QA: socket tak pernah dibuka)", () => {
  it("StrictMode: subscribe → unsubscribe → subscribe sinkron → tepat SATU socket setelah tiket kembali", async () => {
    const { subscribe } = await load();
    const got: string[] = [];
    subscribe(() => {})();                       // mount pertama StrictMode, langsung dilepas
    subscribe((m) => got.push(m.t));             // mount kedua, sebelum tiket pertama kembali
    await grantAll();
    expect(FakeWS.instances).toHaveLength(1);
    FakeWS.instances[0]!.fireOpen();
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    expect(got).toEqual(["specs"]);
  });

  it("subscriber datang sebelum tiket pertama kembali: tiket usang dibuang, tiket baru membuka socket", async () => {
    const { subscribe } = await load();
    subscribe(() => {})();
    subscribe(() => {});
    expect(tickets).toHaveLength(2);             // subscriber kedua langsung meminta tiketnya sendiri
    await grant(0);                              // tiket usang kembali lebih dulu
    expect(FakeWS.instances).toHaveLength(0);
    await grant(1);
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0]!.ticket).toBe("t1");
  });

  it("tiket didapat lalu tak ada subscriber: tak ada socket dan tak ada retry; subscriber baru membuka socket", async () => {
    const { subscribe } = await load();
    const off = subscribe(() => {});
    off();
    await grant(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWS.instances).toHaveLength(0);
    expect(tickets).toHaveLength(1);             // tanpa subscriber tak ada yang minta tiket lagi
    subscribe(() => {});
    await grantAll();
    expect(FakeWS.instances).toHaveLength(1);
  });

  it("unsubscribe semua setelah socket hidup, lalu subscribe lagi: socket baru; onclose socket lama yang terlambat TIDAK menimpanya", async () => {
    const { subscribe } = await load();
    const off = subscribe(() => {});
    await grant(0);
    FakeWS.instances[0]!.fireOpen();
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    off();                                       // close() dipanggil; onclose socket lama belum datang
    const got: string[] = [];
    subscribe((m) => got.push(m.t));
    await grant(1);
    expect(FakeWS.instances).toHaveLength(2);
    const [old, cur] = FakeWS.instances as [FakeWS, FakeWS];
    cur.fireOpen();
    old.fireClose();                             // datang terlambat dari socket yang sudah ditutup
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tickets).toHaveLength(2);             // tak ada tiket atau socket ekstra dari onclose basi
    expect(FakeWS.instances).toHaveLength(2);
    cur.emit({ t: "specs", specs: [] });
    expect(got).toEqual(["specs"]);
  });

  it("tab disembunyi lalu terlihat lagi selagi tiket terbang: tepat satu socket, dari tiket terakhir", async () => {
    const { subscribe } = await load();
    subscribe(() => {});                         // tiket t0 terbang
    hidden(true);                                // close(): tiket t0 dibatalkan
    hidden(false);                               // open() harus benar-benar meminta tiket baru
    expect(tickets).toHaveLength(2);
    await grant(0);
    expect(FakeWS.instances).toHaveLength(0);
    await grant(1);
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0]!.ticket).toBe("t1");
  });

  it("tiket gagal terus-menerus: retry ber-backoff yang tumbuh, tak pernah rapat", async () => {
    const { api } = await import("../src/api/client");
    const spy = vi.spyOn(api, "issueWsTicket").mockRejectedValue(new Error("down"));
    const { subscribe } = await import("../src/api/events");
    subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    // Jadwal backoff 0 → 0,5 → 1,5 → 3,5 → 7,5 dtk: lima percobaan dalam 10 dtk, bukan puluhan.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("retry yang sudah terjadwal lalu tab disembunyi-terlihat: satu percobaan, timer lama tak menambah tiket", async () => {
    const { subscribe } = await load();
    subscribe(() => {});
    await grant(0);
    FakeWS.instances[0]!.fireOpen();
    FakeWS.instances[0]!.emit({ t: "specs", specs: [] });
    FakeWS.instances[0]!.fireClose();            // putus → retry 500 dtk terjadwal
    hidden(true);
    hidden(false);                               // kembali sebelum retry jatuh tempo
    expect(tickets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tickets).toHaveLength(2);             // timer yang tertunda tak meminta tiket ketiga
    await grant(1);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it("status: tanpa langganan = idle (bukan putus); langganan masuk → tidak idle; lepas semua → idle lagi", async () => {
    const { subscribe, eventsStatus } = await load();
    expect(eventsStatus().idle).toBe(true);
    const off = subscribe(() => {});
    expect(eventsStatus().idle).toBe(false);
    off();
    expect(eventsStatus().idle).toBe(true);
    expect(eventsStatus().connected).toBe(false);
  });
});
