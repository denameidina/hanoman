import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, SCHEDULER_DEFAULTS, type Lead } from "@hanoman/shared";
import { setLead } from "../src/services/lead/config";
import {
  tick, __resetEngine, lastPulse, HOUSEKEEPING_MS, type LeadTickDeps,
} from "../src/services/lead/engine";
import type { PulseDeps } from "../src/services/lead/pulse";

// SPEC-409 · ADR-0091 · AC-12 · denyut in-process. `now` di-parameter agar cadence teruji
// deterministik (pola scheduler engine, SPEC-294).
//
// SPEC-909 · ADR-0146 · irama PINTU DETEKSI dicabut: pertanyaan sesi tiba sebagai event hook dan
// tak pernah lagi menunggu timer. Yang tersisa satu irama rumah tangga — penyapu rantai, pemangkas
// penghitung, sesi pra-pembaruan, dan jatuh tempo denyut proaktif. Test yang dulu menghitung
// "berapa kali pintu deteksi dipanggil per tick" karena itu hilang; penggantinya di
// `lead-ask.test.ts` (satu pekerjaan per sesi) dan `lead-detect-event.test.ts` (pagarnya).

const clean = async () => { await prisma.setting.deleteMany(); await prisma.leadDecision.deleteMany(); };
beforeEach(async () => { await clean(); __resetEngine(); });
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

// SPEC-432 · satu jam palsu dipakai BERSAMA oleh parameter `now` milik tick dan oleh dep `now`
// yang menstempel akhir denyut — kalau keduanya berjalan di jam berbeda, "jeda sejak denyut
// selesai" tak bisa diuji sama sekali.
function counters() {
  const c = { legacy: 0, prune: 0, pulse: 0 };
  const clock = { t: 0 };
  const pulse = {
    sessions: () => [], areas: async () => [], planDone: () => true, finished: () => false,
    decide: (async () => null) as unknown as PulseDeps["decide"],
    decideDeps: {} as PulseDeps["decideDeps"],
    apply: (async () => ({ ok: true, detail: "" })) as unknown as PulseDeps["apply"],
    enqueue: async () => { /* diam */ },
    notify: async () => { /* diam */ },
    optIn: async () => { c.pulse++; return []; },
    cfg: async () => cfg(),
    scheduler: async () => SCHEDULER_DEFAULTS,
  } as PulseDeps;
  const deps: LeadTickDeps = {
    pulse, now: () => clock.t,
    // SPEC-909 · tick membaca sesi hidup SEKALI untuk dua pekerjaan: sesi pra-pembaruan dan
    // pemangkasan penghitung. Default di sini kosong; test yang memang mengujinya menimpanya.
    live: () => [],
    legacy: async () => { c.legacy++; },
    prune: () => { c.prune++; },
  };
  /** Majukan jam ke `t` lalu jalankan satu tick di sana. */
  const at = (t: number) => { clock.t = t; return tick(t, deps); };
  return { c, deps, clock, at };
}

describe("lead engine tick", () => {
  it("is completely idle while the master switch is off (AC-30)", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    const { c, at } = counters();
    await at(1_000_000);
    expect(c).toEqual({ legacy: 0, prune: 0, pulse: 0 });
  });

  // SPEC-909 · ADR-0146 · iramanya RUMAH TANGGA, bukan lagi 5 detik: tak ada lagi yang menunggu
  // giliran tick untuk dijawab.
  it("beriramakan rumah tangga, bukan denyut deteksi", () => {
    expect(HOUSEKEEPING_MS).toBe(60_000);
  });

  it("memangkas penghitung sesi mati tiap tick", async () => {
    await setLead(cfg());
    const { c, at } = counters();
    await at(1_000_000);
    await at(1_000_000 + HOUSEKEEPING_MS);
    expect(c.prune).toBe(2);
  });

  it("runs the proactive pulse only once per everyMin window", async () => {
    await setLead(cfg({ everyMin: 5 }));
    const { c, at } = counters();
    const t0 = 1_000_000;
    await at(t0);                       // belum pernah → jatuh tempo
    expect(c.pulse).toBe(1);
    await at(t0 + 4 * 60_000);          // 4 mnt < 5 → lewat
    expect(c.pulse).toBe(1);
    await at(t0 + 5 * 60_000);          // 5 mnt → jatuh tempo lagi
    expect(c.pulse).toBe(2);
    expect(lastPulse()).toBe(t0 + 5 * 60_000);
  });

  // Pause = rem darurat, bukan matikan: pintu deteksi ikut diam lewat gerbangnya sendiri, dan
  // denyut proaktif tak pernah dijalankan.
  it("stops the proactive pulse while paused (AC-27)", async () => {
    await setLead(cfg({ paused: true }));
    const { c, at } = counters();
    await at(1_000_000);
    expect(c.pulse).toBe(0);
  });

  // AC-37 · lead yang mati (agennya crash, kuota habis, git gagal) tak boleh menjatuhkan proses
  // server maupun menghentikan sesi yang berjalan.
  it("survives a housekeeping job that throws, and still runs the pulse", async () => {
    await setLead(cfg());
    const { c, deps, at } = counters();
    deps.live = () => { throw new Error("tmux tak terbaca"); };
    await expect(at(1_000_000)).resolves.toBeUndefined();
    expect(c.pulse).toBe(1);
  });
  it("survives a pulse that throws", async () => {
    await setLead(cfg());
    const { deps, at } = counters();
    deps.pulse!.optIn = async () => { throw new Error("DB kedip"); };
    await expect(at(1_000_000)).resolves.toBeUndefined();
  });
});

// SPEC-432 · audit `research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md`.
//
// ADR-0091 §5 sengaja memisahkan dua irama: pintu deteksi tiap 5 detik (sesi mandek diukur dalam
// menit — M1 median ≤ 2 mnt) dan denyut proaktif tiap `everyMin`. `tick()` menyatukannya kembali
// lewat SATU flag `busy`: di mesin operator satu denyut = 3 project × 120 dtk timeout = 360 dtk,
// dan selama itu setiap tick 5 detik langsung `return` — pintu yang justru menjawab sesi mandek
// mati berkala oleh pekerjaan yang sudah terbukti nihil.
describe("lead engine · denyut lambat tak boleh melaparkan rumah tangga (audit SPEC-432)", () => {
  it("keeps doing housekeeping while a slow pulse is still in flight", async () => {
    await setLead(cfg());
    const { c, deps, at } = counters();
    let release: () => void = () => { /* diisi saat denyut mulai */ };
    deps.pulse!.optIn = async () => {
      c.pulse++;
      await new Promise<void>((r) => { release = r; });
      return [];
    };
    const slow = at(1_000_000);                       // denyut yang menggantung
    await new Promise((r) => setTimeout(r, 10));      // biarkan denyut benar-benar mulai
    await at(1_000_000 + HOUSEKEEPING_MS);            // tick berikutnya
    expect(c.prune).toBe(2);                          // rumah tangga TETAP jalan
    expect(c.pulse).toBe(1);                          // tapi denyut tak dimulai dua kali
    release();
    await slow;
  });

  // `lastPulseAt` distempel di AWAL denyut, jadi denyut yang lebih lama dari `everyMin` langsung
  // jatuh tempo lagi begitu ia selesai — `everyMin` berhenti jadi lantai, dan denyut berikutnya
  // menyentuh git (`specReview` per sesi hidup) tanpa jeda sama sekali.
  it("counts the everyMin gap from when the pulse FINISHED, not when it started", async () => {
    await setLead(cfg({ everyMin: 5 }));
    const { c, deps, clock, at } = counters();
    deps.pulse!.optIn = async () => { c.pulse++; clock.t += 6 * 60_000; return []; };   // denyut 6 mnt
    await at(1_000_000);
    expect(c.pulse).toBe(1);
    await tick(clock.t, deps);            // tick tepat sesudah denyut yang overrun selesai
    expect(c.pulse).toBe(1);
    await at(clock.t + 5 * 60_000);       // baru sesudah jeda tenang penuh
    expect(c.pulse).toBe(2);
  });
});

// SPEC-485 · ADR-0102 · rantai yang ditinggalkan punya UJUNG. Penyapunya MENUMPANG tick ini —
// ADR-0024 melarang timer/scheduler baru, dan pola ini sama dengan penguras antrean webhook
// (ADR-0100) & governor scheduler (ADR-0072).
describe("lead engine · penyapu rantai kedaluwarsa (SPEC-485)", () => {
  const expired = [{ id: "f1", projectId: "p", specId: null, sessionId: "s1", title: "q1" }];

  it("menutup rantai kedaluwarsa & menotifikasi sekali per alur", async () => {
    await setLead(cfg());
    const seen: string[] = [];
    const { deps } = counters();
    await tick(Date.now(), {
      ...deps,
      expire: async () => expired,
      notify: async (_id, title) => { seen.push(title); },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/rantai keputusan/i);
  });

  it("diam saat tak ada yang kedaluwarsa", async () => {
    await setLead(cfg());
    const seen: string[] = [];
    const { deps } = counters();
    await tick(Date.now(), { ...deps, expire: async () => [], notify: async () => { seen.push("x"); } });
    expect(seen).toEqual([]);
  });

  // AC-37 · lead yang mati tak boleh menjatuhkan proses server maupun menghentikan sesi berjalan.
  it("penyapu yang melempar tak menjatuhkan tick", async () => {
    await setLead(cfg());
    const { deps } = counters();
    await expect(tick(Date.now(), { ...deps, expire: async () => { throw new Error("db mati"); } }))
      .resolves.toBeUndefined();
  });

  it("tak menyapu apa pun selagi master switch mati (AC-30)", async () => {
    await setLead({ ...LEAD_DEFAULTS, enabled: false });
    let called = 0;
    const { deps } = counters();
    await tick(Date.now(), { ...deps, expire: async () => { called++; return []; } });
    expect(called).toBe(0);
  });
});

// SPEC-909 · ADR-0146 · sesi yang lahir SEBELUM pembaruan tak punya hook event, jadi lead tak akan
// menjawabnya. Yang tak boleh terjadi adalah ia menggantung tanpa siapa pun tahu.
describe("lead engine · sesi pra-pembaruan (SPEC-909)", () => {
  const LAMA = { id: "lama", projectId: "p1", specId: "SPEC-1", waiting: true, eventHook: false };
  const BARU = { id: "baru", projectId: "p1", specId: "SPEC-2", waiting: true, eventHook: true };

  it("menotifikasi sesi tanpa hook event, dan hanya sesi itu", async () => {
    await setLead(cfg());
    const seen: string[] = [];
    const { deps } = counters();
    await tick(1_000_000, {
      ...deps, live: () => [LAMA, BARU],
      legacy: async (id) => { seen.push(id); },
    });
    expect(seen).toEqual(["lama"]);
  });

  it("tak menotifikasi sesi yang memang tidak sedang menunggu", async () => {
    await setLead(cfg());
    const seen: string[] = [];
    const { deps } = counters();
    await tick(1_000_000, {
      ...deps, live: () => [{ ...LAMA, waiting: false }],
      legacy: async (id) => { seen.push(id); },
    });
    expect(seen).toEqual([]);
  });
});
