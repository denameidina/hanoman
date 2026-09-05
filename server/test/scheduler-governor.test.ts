import { LaunchAdmissionError } from "../src/services/session-admission";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { enqueue, queueItemForSpec, listQueue, markCanceled } from "../src/services/scheduler/queue";
import { drain, canceledRaceNote, type GovernorDeps } from "../src/services/scheduler/governor";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const clean = () => prisma.schedulerQueueItem.deleteMany();
beforeEach(clean); afterAll(clean);
const cfg = (over = {}) => ({ ...SCHEDULER_DEFAULTS, enabled: true, ...over });

describe("governor.drain", () => {
  it("host admission postpones an item in the existing queue instead of failing it", async () => {
    await enqueue({ specId: "SPEC-wait", projectId: "p1", source: "backlog", priority: "sedang" });
    await enqueue({ specId: "SPEC-wait2", projectId: "p1", source: "backlog", priority: "sedang" });
    let attempts = 0;
    const deps: GovernorDeps = {
      drainCrons: async (s) => s, liveCount: async () => 0, isLive: () => null,
      isDone: async () => false, blockers: async () => [],
      launch: async () => { attempts++; throw new LaunchAdmissionError("host-load", {
        enabled: true, liveCount: 0, liveAgentCount: 0, maxConcurrent: 2,
        loadPerCore: 3.75, maxLoadPerCore: 2.5, loadStatus: "available",
      }); },
    };
    await drain(cfg(), deps);
    expect(await queueItemForSpec("SPEC-wait")).toMatchObject({ status: "queued", sessionId: null });
    expect((await queueItemForSpec("SPEC-wait"))!.note).toContain("3.75");
    expect(attempts).toBe(1);
    expect((await queueItemForSpec("SPEC-wait2"))!.status).toBe("queued");
  });

  it("never launches beyond cap (live count invariant)", async () => {
    for (const p of ["a", "b", "c", "d"]) await enqueue({ specId: `SPEC-${p}`, projectId: "p1", source: "backlog", priority: "sedang" });
    let launched = 0;
    const deps: GovernorDeps = { drainCrons: async (s) => s, liveCount: () => launched, isLive: () => null, isDone: async () => false, blockers: async () => [], launch: async () => { launched++; return `s${launched}`; } };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launched).toBe(2);                                   // cap dihormati
    expect((await listQueue("launched")).length).toBe(2);
    expect((await listQueue("queued")).length).toBe(2);        // sisanya tertahan
  });
  it("does nothing when live already at cap", async () => {
    await enqueue({ specId: "SPEC-x", projectId: "p1", source: "backlog", priority: "tinggi" });
    let launches = 0;
    const deps: GovernorDeps = { drainCrons: async (s) => s, liveCount: () => 3, isLive: () => null, isDone: async () => false, blockers: async () => [], launch: async () => { launches++; return "s"; } };
    await drain(cfg({ maxConcurrent: 3 }), deps);
    expect(launches).toBe(0);
    expect((await listQueue("queued")).length).toBe(1);
  });
  it("idempotent: a spec already live is marked launched without consuming a slot", async () => {
    await enqueue({ specId: "SPEC-live", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-new", projectId: "p1", source: "backlog", priority: "sedang" });
    let launches = 0;
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 1,                                        // SPEC-live sudah dihitung live
      isLive: (specId) => (specId === "SPEC-live" ? "spec_live" : null),
      isDone: async () => false, blockers: async () => [],
      launch: async () => { launches++; return "spec_new"; },
    };
    await drain(cfg({ maxConcurrent: 2 }), deps);
    expect(launches).toBe(1);                                   // hanya SPEC-new benar-benar di-launch
    expect((await queueItemForSpec("SPEC-live"))!.status).toBe("launched");
    expect((await queueItemForSpec("SPEC-live"))!.sessionId).toBe("spec_live");
    expect((await queueItemForSpec("SPEC-new"))!.status).toBe("launched");
  });
  // SPEC-431 · gerbang terakhir sebelum sebuah baris antrean jadi sesi tmux sungguhan. Memperbaiki
  // checker saja tidak cukup: 27 baris `queued` yang telanjur ada di DB produksi menunjuk spec yang
  // sudah `done` dan akan tetap meluncur. Ini juga menutup balapan nyata — operator menyelesaikan
  // item itu SELAGI ia mengantre.
  it("never launches a spec that is already done; the stale row is closed instead", async () => {
    await enqueue({ specId: "SPEC-old", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-open", projectId: "p1", source: "backlog", priority: "sedang" });
    const launched: string[] = [];
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null,
      isDone: async (specId) => specId === "SPEC-old", blockers: async () => [],
      launch: async (item) => { launched.push(item.specId); return "s_open"; },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect(launched).toEqual(["SPEC-open"]);                    // item selesai tak pernah di-launch
    const old = (await queueItemForSpec("SPEC-old"))!;
    expect(old.status).toBe("done");                            // ditutup, bukan dibiarkan mengantre
    expect(old.sessionId).toBeNull();                           // tak ada sesi yang bisa diklaim
    expect(old.note).toBe("spec sudah selesai — tak diluncurkan");
  });

  it("a spec closed by the done gate does not consume a slot", async () => {
    for (const p of ["done1", "done2", "open"]) {
      await enqueue({ specId: `SPEC-${p}`, projectId: "p1", source: "backlog", priority: "sedang" });
    }
    let launches = 0;
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null,
      isDone: async (specId) => specId.startsWith("SPEC-done"), blockers: async () => [],
      launch: async () => { launches++; return `s${launches}`; },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);               // satu slot saja
    expect(launches).toBe(1);                                   // dan slot itu jatuh ke SPEC-open
    expect((await queueItemForSpec("SPEC-open"))!.status).toBe("launched");
  });

  it("marks an item failed when launch throws (no retry, next item still processed)", async () => {
    await enqueue({ specId: "SPEC-bad", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-ok", projectId: "p1", source: "backlog", priority: "sedang" });
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [],
      launch: async (item) => { if (item.specId === "SPEC-bad") throw new Error("needs-bind"); return "s_ok"; },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-bad"))!.status).toBe("failed");
    expect((await queueItemForSpec("SPEC-bad"))!.note).toBe("needs-bind");
    expect((await queueItemForSpec("SPEC-ok"))!.status).toBe("launched");
  });
  // SPEC-447 · ADR-0093 · gerbang KEDUA — pola SPEC-431. Checker yang benar tak cukup sendirian:
  // baris `queued` bisa sudah ada sebelum dependency-nya ditulis, dan sebuah dependency bisa
  // berbalik jadi belum-siap selagi item mengantre (stage dikembalikan mundur, ADR-0027).
  it("melewati item terblokir tanpa memakai slot, barisnya tetap queued", async () => {
    await enqueue({ specId: "SPEC-blk", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-free", projectId: "p1", source: "backlog", priority: "sedang" });
    const launched: string[] = [];
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => false,
      blockers: async (specId) =>
        (specId === "SPEC-blk" ? [{ id: "SPEC-dep", reason: "unmerged" as const }] : []),
      launch: async (item) => { launched.push(item.specId); return "s_free"; },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);           // cap 1: slot HARUS jatuh ke SPEC-free
    expect(launched).toEqual(["SPEC-free"]);
    const blk = (await queueItemForSpec("SPEC-blk"))!;
    expect(blk.status).toBe("queued");                      // bukan failed — pemblokirnya akan selesai
    expect(blk.note).toBe("menunggu SPEC-dep (belum ter-merge)");
    expect(blk.sessionId).toBeNull();
  });

  // Governor berdenyut tiap 10 detik; menulis note identik tiap tick = ~8.640 write/hari untuk
  // informasi yang sama. Buktinya dari jumlah panggilan `update`, bukan dari bentuk barisnya.
  it("tak menulis ulang note yang sama", async () => {
    await enqueue({ specId: "SPEC-blk2", projectId: "p1", source: "backlog", priority: "tinggi" });
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => false,
      blockers: async () => [{ id: "SPEC-dep", reason: "unfinished" as const }],
      launch: async () => "s",
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    // `mockRestore()` MENGHAPUS metodenya alih-alih mengembalikannya: delegate Prisma menyajikan
    // `update` lewat proxy, jadi begitu vitest membuang own-property yang dipasangnya tak ada yang
    // mengambil alih — dan SETIAP test sesudahnya di berkas ini kehilangan `prisma
    // .schedulerQueueItem.update` (terukur: `typeof` → "undefined"). Simpan & pasang balik sendiri.
    const orig = prisma.schedulerQueueItem.update;
    const spy = vi.spyOn(prisma.schedulerQueueItem, "update");
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect(spy).not.toHaveBeenCalled();
    prisma.schedulerQueueItem.update = orig;
    expect(typeof prisma.schedulerQueueItem.update).toBe("function");
    expect((await queueItemForSpec("SPEC-blk2"))!.note).toBe("menunggu SPEC-dep (belum selesai)");
  });

  // SPEC-522 · gerbang PERTAMA. `queued()` sudah menyaring `canceled`, tapi itu snapshot: drain
  // memproses item berurutan dan tiap spawn hitungan detik, jadi baris di ekor daftar bisa
  // dibatalkan SESUDAH snapshotnya diambil. Dibatalkan dari dalam `launch` item pertama =
  // simulasi tepat dari operator yang menekan Batalkan selagi drain bekerja.
  it("tak meluncurkan baris yang dibatalkan sesudah snapshot antrean diambil", async () => {
    await enqueue({ specId: "SPEC-first", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-late", projectId: "p1", source: "backlog", priority: "sedang" });
    const late = (await queueItemForSpec("SPEC-late"))!;
    const launched: string[] = [];
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [],
      launch: async (item) => {
        launched.push(item.specId);
        if (item.specId === "SPEC-first") await markCanceled(late.id, "dibatalkan operator");
        return `s_${item.specId}`;
      },
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect(launched).toEqual(["SPEC-first"]);                  // SPEC-late tak pernah di-spawn
    const row = (await queueItemForSpec("SPEC-late"))!;
    expect(row.status).toBe("canceled");                       // statusnya bertahan
    expect(row.sessionId).toBeNull();
  });

  // SPEC-522 · gerbang PERTAMA melindungi SEMUA mutasi di badan loop, bukan hanya `launch`:
  // tanpa itu gerbang "spec sudah selesai" (SPEC-431) menimpa baris canceled jadi `done`.
  it("gerbang spec-sudah-selesai tak menimpa baris yang dibatalkan", async () => {
    await enqueue({ specId: "SPEC-cd", projectId: "p1", source: "backlog", priority: "tinggi" });
    const row = (await queueItemForSpec("SPEC-cd"))!;
    await markCanceled(row.id, "dibatalkan operator");
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => true, blockers: async () => [],
      launch: async () => "s",
    };
    await drain(cfg({ maxConcurrent: 5 }), deps);
    expect((await queueItemForSpec("SPEC-cd"))!.status).toBe("canceled");
    expect((await queueItemForSpec("SPEC-cd"))!.note).toBe("dibatalkan operator");
  });

  // SPEC-522 · gerbang KEDUA: sisa jendelanya adalah durasi satu spawn. CAS `markLaunched` yang
  // gagal TIDAK ditelan — sesinya nyata, jadi ia tetap memakan slot dan operator diberi id-nya.
  // Sesi TIDAK dibunuh (kendala: sesi hidup tak pernah dimatikan diam-diam).
  it("pembatalan selama launch menang; sesi yang telanjur lahir dicatat, bukan dibunuh", async () => {
    await enqueue({ specId: "SPEC-race", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-next", projectId: "p1", source: "backlog", priority: "rendah" });
    const race = (await queueItemForSpec("SPEC-race"))!;
    const launched: string[] = [];
    const deps: GovernorDeps = { drainCrons: async (s) => s,
      liveCount: () => 0, isLive: () => null, isDone: async () => false, blockers: async () => [],
      launch: async (item) => {
        // dibatalkan DI TENGAH spawn: barisnya masih `queued` saat gerbang pertama lewat
        if (item.specId === "SPEC-race") await markCanceled(race.id, "dibatalkan operator");
        launched.push(item.specId);
        return `s_${item.specId}`;
      },
    };
    await drain(cfg({ maxConcurrent: 1 }), deps);              // satu slot: dipakai sesi SPEC-race
    expect(launched).toEqual(["SPEC-race"]);
    const row = (await queueItemForSpec("SPEC-race"))!;
    expect(row.status).toBe("canceled");                       // TIDAK berbalik jadi launched
    expect(row.sessionId).toBeNull();
    expect(row.note).toBe(canceledRaceNote("s_SPEC-race"));    // operator tahu ada sesi yatim
    expect((await queueItemForSpec("SPEC-next"))!.status).toBe("queued");  // slotnya memang terpakai
    expect((await listQueue("launched")).length).toBe(0);
  });
});
