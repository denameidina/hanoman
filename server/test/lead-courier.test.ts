import { describe, it, expect, beforeEach } from "vitest";
import {
  deliver, markLeadIdle, isLeadIdle, onLeadStop, __resetCourier,
  type CourierDeps, type StopDeps,
} from "../src/services/lead/courier";

// ADR-0228 · kurir batch event ke pane lead.

beforeEach(() => __resetCourier());
const ev = (id: string, kind = "ask") => ({ id, kind, question: "q", payload: { prompt: `P-${id}` } });
type Rec = { sent: string[]; written: string[]; marked: string[][]; ensured: string[] };
const deps = (over: Partial<CourierDeps> = {}): CourierDeps & Rec => {
  const rec: Rec = { sent: [], written: [], marked: [], ensured: [] };
  return {
    ...rec,
    live: async () => true,
    quiet: async () => false,
    batch: async () => [ev("e1"), ev("e2", "pulse")] as never,
    human: () => null,
    brief: async () => "BRIEF",
    write: (_p, text) => { rec.written.push(text); return "/home/lead-batches/p/1.md"; },
    send: async (_id, line) => { rec.sent.push(line); return true; },
    markDelivered: async (ids) => { rec.marked.push(ids); },
    ensure: async (p) => { rec.ensured.push(p); },
    now: () => 1_000_000,
    ...over,
  };
};

describe("kurir", () => {
  it("menulis batch ke berkas dan mengetik satu baris penunjuk saat pane diam", async () => {
    markLeadIdle("lead-p");
    const d = deps();
    expect(await deliver("p", d)).toBe(2);
    expect(d.written[0]).toContain("eventId=e1");
    expect(d.written[0]).toContain("P-e2");
    expect(d.written[0]).toContain("BRIEF");
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toContain("cat /home/lead-batches/p/1.md");
    expect(d.sent[0]).toContain("1 pertanyaan");
    expect(d.marked).toEqual([["e1", "e2"]]);
    expect(isLeadIdle("lead-p")).toBe(false);
  });
  it("tak mengirim saat pane sibuk", async () => {
    const d = deps();
    expect(await deliver("p", d)).toBe(0);
    expect(d.sent).toEqual([]);
  });
  it("sesudah restart (penanda diam hilang), pane yang hening dianggap diam dan diantari", async () => {
    const d = deps({ quiet: async () => true });
    expect(await deliver("p", d)).toBe(2);
  });
  it("tak mengirim saat manusia baru mengetik", async () => {
    markLeadIdle("lead-p");
    const d = deps({ human: () => 1_000_000 - 30_000 });
    expect(await deliver("p", d)).toBe(0);
    expect(isLeadIdle("lead-p")).toBe(true);
  });
  it("mengirim lagi setelah manusia diam dua menit", async () => {
    markLeadIdle("lead-p");
    expect(await deliver("p", deps({ human: () => 1_000_000 - 121_000 }))).toBe(2);
  });
  it("pane mati → minta dilahirkan, tak mengirim", async () => {
    markLeadIdle("lead-p");
    const d = deps({ live: async () => false });
    expect(await deliver("p", d)).toBe(0);
    expect(d.ensured).toEqual(["p"]);
  });
  it("inbox kosong → tak mengetik apa pun", async () => {
    markLeadIdle("lead-p");
    const d = deps({ batch: async () => [] });
    expect(await deliver("p", d)).toBe(0);
    expect(d.sent).toEqual([]);
  });
  it("ketikan gagal → event tetap open dan pane tetap diam", async () => {
    markLeadIdle("lead-p");
    const d = deps({ send: async () => false });
    expect(await deliver("p", d)).toBe(0);
    expect(d.marked).toEqual([]);
    expect(isLeadIdle("lead-p")).toBe(true);
  });
});

const stop = (over: Partial<StopDeps> = {}): StopDeps & { rotated: string[] } => {
  const rotated: string[] = [];
  return {
    rotated, rotateAfter: async () => 40, delivered: () => 0, openCount: async () => 0,
    rotate: async (p) => { rotated.push(p); }, deliver: async () => 0, ...over,
  };
};
describe("onLeadStop", () => {
  it("rotasi saat ambang tercapai dan inbox kosong", async () => {
    const d = stop({ delivered: () => 40 });
    expect(await onLeadStop("lead-p", "p", d)).toBe("rotated");
    expect(d.rotated).toEqual(["p"]);
    expect(isLeadIdle("lead-p")).toBe(true);
  });
  it("tak merotasi selama masih ada event terbuka", async () => {
    const d = stop({ delivered: () => 40, openCount: async () => 1, deliver: async () => 1 });
    expect(await onLeadStop("lead-p", "p", d)).toBe("delivered");
    expect(d.rotated).toEqual([]);
  });
  it("di bawah ambang → kirim batch berikutnya, atau diam bila kosong", async () => {
    expect(await onLeadStop("lead-p", "p", stop({ deliver: async () => 2 }))).toBe("delivered");
    expect(await onLeadStop("lead-p", "p", stop())).toBe("idle");
  });
});
