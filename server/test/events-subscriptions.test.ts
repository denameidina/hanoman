import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subKey } from "@hanoman/shared";
import { attach, detach, subscribeClient, __tick, __reset } from "../src/services/events";
import { TOPICS } from "../src/services/events-topics";
import { resetDb } from "./factory";
import { killAll } from "../src/services/pty";
import { _resetLimitsCache } from "../src/services/limits";
import { _resetUpdateCache } from "../src/services/update";

// SPEC-908 · hub langganan berparameter. Yang diuji di sini adalah PAGAR BIAYA-nya: entri hanya
// untuk parameter yang benar-benar ada pelanggannya, satu build untuk N klien, dedup signature,
// kadens per-topik, dan build lambat yang tak boleh menunda grup 1 dtk.

function fakeClient() {
  const frames: { t: string; [k: string]: unknown }[] = [];
  return { frames, send: (m: string) => frames.push(JSON.parse(m)), close: () => {} };
}
const framesOf = (c: ReturnType<typeof fakeClient>, t: string) => c.frames.filter((f) => f.t === t);
const flush = () => new Promise((r) => setTimeout(r, 0));

const TICKETS_PARAMS = { page: 1, limit: 20 };
const GIT_PARAMS = { projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true };
const ticketsBody = (total: number) => ({ data: { items: [], total, page: 1, pageSize: 20, unreviewed: 0 } });
const gitBody = () => ({
  graph: { commits: [], current: "", total: 0 },
  status: { branch: "", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [], clean: true },
  stashes: [],
});

beforeEach(async () => {
  process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "hanoman-cfg-"));
  _resetLimitsCache();
  _resetUpdateCache();
  killAll();
  await resetDb();
  __reset();
});
afterEach(() => { __reset(); _resetUpdateCache(); vi.restoreAllMocks(); });

describe("SPEC-908 · hub langganan berparameter", () => {
  it("mengirim frame `hello` berisi daftar topik SEBELUM snapshot grup", async () => {
    const c = fakeClient();
    await attach(c);
    expect(c.frames[0]!.t).toBe("hello");
    expect(c.frames[0]!.topics).toContain("tickets");
    expect(c.frames[0]!.topics).toContain("git");
    detach(c);
  });

  it("`hello` mengiklankan daftar KOSONG ke koneksi yang tak boleh berlangganan", async () => {
    // `canSubscribeTopics` membuang frame `sub` dari principal non-cookie DIAM-DIAM. Kalau `hello`
    // tetap menyebut kelima topik, klien menyimpulkan "didukung", tak pernah menyalakan fallback,
    // dan layarnya diam selamanya tanpa satu pun error.
    const c = fakeClient();
    await attach(c, { maySubscribe: false });
    expect(c.frames[0]!.t).toBe("hello");
    expect(c.frames[0]!.topics).toEqual([]);
    detach(c);
  });

  it("entri tanpa pelanggan TIDAK PERNAH dihitung", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build");
    const c = fakeClient();
    await attach(c);
    for (let i = 0; i < 10; i++) { await __tick(); await flush(); }
    expect(spy).not.toHaveBeenCalled();
    detach(c);
  });

  it("mengirim muatan pertama SEGERA saat berlangganan — tak menunggu tick", async () => {
    vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    const f = framesOf(c, "tickets");
    expect(f).toHaveLength(1);
    expect(f[0]!.key).toBe(subKey("tickets", TICKETS_PARAMS));
    detach(c);
  });

  it("dua klien berparameter identik = SATU build dan frame byte-identik", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const a = fakeClient(), b = fakeClient();
    await attach(a); await attach(b);
    subscribeClient(a, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    spy.mockClear();
    // Urutan kunci sengaja dibalik: `subKey` mengkanonkannya jadi entri yang SAMA.
    subscribeClient(b, [{ topic: "tickets", params: { limit: 20, page: 1 } }]);
    await flush();
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(framesOf(a, "tickets")[0])).toBe(JSON.stringify(framesOf(b, "tickets")[0]));
    detach(a); detach(b);
  });

  it("dedup signature: build mengembalikan data sama → tak ada frame kedua", async () => {
    vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    for (let i = 0; i < 20; i++) { await __tick(); await flush(); }
    expect(framesOf(c, "tickets")).toHaveLength(1);
    detach(c);
  });

  it("kadens per-topik dihormati — `git` tak dihitung tiap tick", async () => {
    const spy = vi.spyOn(TOPICS.git, "build").mockResolvedValue(gitBody());
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "git", params: GIT_PARAMS }]);
    await flush();
    spy.mockClear();
    for (let i = 0; i < 4; i++) { await __tick(); await flush(); }
    // everyTicks git = 4 (tick 1 dtk) → tepat satu recompute dalam empat tick.
    expect(spy).toHaveBeenCalledTimes(1);
    detach(c);
  });

  it("build yang MELEMPAR tak menghapus frame lama dan tak menjatuhkan tick berikutnya", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build")
      .mockResolvedValueOnce(ticketsBody(1))
      .mockRejectedValueOnce(new Error("DB mati"))
      .mockResolvedValue(ticketsBody(2));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    for (let i = 0; i < 9; i++) { await __tick(); await flush(); }
    const f = framesOf(c, "tickets") as unknown as { data: { total: number } }[];
    expect(f[0]!.data.total).toBe(1);
    expect(f.at(-1)!.data.total).toBe(2);
    expect(spy.mock.calls.length).toBeGreaterThan(2);
    detach(c);
  });

  it("frame `sub` MENGGANTI seluruh himpunan — langganan lama berhenti dihitung", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    subscribeClient(c, [{ topic: "tickets", params: { page: 2, limit: 20 } }]);
    await flush();
    spy.mockClear();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) expect((call[0] as { page: number }).page).toBe(2);
    detach(c);
  });

  it("topik tak dikenal dilewati PER-ENTRI, yang dikenal tetap terpasang (ADR-0087)", async () => {
    vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [
      { topic: "topikMasaDepan", params: {} },
      { topic: "tickets", params: TICKETS_PARAMS },
    ]);
    await flush();
    expect(framesOf(c, "tickets")).toHaveLength(1);
    detach(c);
  });

  it("parameter cacat dibuang tanpa melempar", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build");
    const c = fakeClient();
    await attach(c);
    expect(() => subscribeClient(c, [{ topic: "tickets", params: { page: 0, limit: 99_999 } }])).not.toThrow();
    await flush();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    expect(spy).not.toHaveBeenCalled();
    detach(c);
  });

  it("detach menyapu langganan — build berhenti setelah klien terakhir lepas", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const keep = fakeClient();          // klien kedua menjaga loop tetap hidup
    const c = fakeClient();
    await attach(keep); await attach(c);
    subscribeClient(c, [{ topic: "tickets", params: TICKETS_PARAMS }]);
    await flush();
    detach(c);
    spy.mockClear();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    expect(spy).not.toHaveBeenCalled();
    detach(keep);
  });

  // Kedua test berikut mengunci pagar yang lahir dari review keamanan SPEC-908 (terukur:
  // 1 920 build/menit dari satu socket, dan 32 build serentak menahan event loop 505 ms).
  it("build di luar jadwal berbatas per klien — sisanya menunggu tick, bukan menghilang", async () => {
    const spy = vi.spyOn(TOPICS.tickets, "build").mockResolvedValue(ticketsBody(0));
    const c = fakeClient();
    await attach(c);
    // 40 kunci distinct, dikirim 16-per-frame (plafon MAX_SUBS) dengan semantik ganti-penuh.
    for (let i = 0; i < 40; i++) {
      subscribeClient(c, [{ topic: "tickets", params: { page: i + 1, limit: 20 } }]);
      await flush();
    }
    // Jatah build seketika 30/menit; sisanya tak dibangun di luar jadwal.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(30);
    // Langganan TERAKHIR tetap terpasang: ia terbangun di tick berikutnya.
    spy.mockClear();
    for (let i = 0; i < 6; i++) { await __tick(); await flush(); }
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) expect((call[0] as { page: number }).page).toBe(40);
    detach(c);
  });

  it("build serentak berbatas — satu socket tak bisa memfork tanpa plafon", async () => {
    let peak = 0, live = 0;
    vi.spyOn(TOPICS.git, "build").mockImplementation(() => {
      live++; peak = Math.max(peak, live);
      return new Promise((r) => setTimeout(() => { live--; r(gitBody()); }, 30));
    });
    const c = fakeClient();
    await attach(c);
    const subs = Array.from({ length: 16 }, (_, i) => ({
      topic: "git", params: { ...GIT_PARAMS, limit: 100 + i },
    }));
    subscribeClient(c, subs);
    await new Promise((r) => setTimeout(r, 120));
    expect(peak).toBeLessThanOrEqual(4);
    detach(c);
  });

  it("build lambat tak menunda __tick — grup 1 dtk tetap terbit tepat waktu", async () => {
    vi.spyOn(TOPICS.git, "build").mockImplementation(
      () => new Promise((r) => setTimeout(() => r(gitBody()), 120)),
    );
    const c = fakeClient();
    await attach(c);
    subscribeClient(c, [{ topic: "git", params: GIT_PARAMS }]);
    const before = Date.now();
    for (let i = 0; i < 4; i++) await __tick();
    // __tick tak pernah menunggu build langganan; empat tick jauh di bawah 120 ms.
    expect(Date.now() - before).toBeLessThan(100);
    detach(c);
  });
});
