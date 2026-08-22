import { describe, expect, it } from "vitest";
import {
  LANE_MARGIN, MIN_WALK_PX, STAND_MS, WALK_MS, WALK_PX_PER_S, anchored, clampX, homeX, initialWalkState,
  stepWalk, type PetWalkInput, type PetWalkState,
} from "../src/screens/pet-walk";

const LANE = 1000;
const PET = 128;
const HOME = LANE - PET - LANE_MARGIN;

function input(over: Partial<PetWalkInput> = {}): PetWalkInput {
  return {
    now: 100_000, currentX: HOME, laneWidth: LANE, petWidth: PET, pose: "ready",
    hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false, tier: "desktop",
    ...over,
  };
}
const standing = (x: number, until = Infinity, facing: "right" | "left" = "right"): PetWalkState =>
  ({ x, facing, mode: "stand", until });
const walking = (x: number, until: number, facing: "right" | "left" = "left"): PetWalkState =>
  ({ x, facing, mode: "walk", until });
// rng deterministik: urutan nilai yang ditentukan test.
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };

describe("mesin berkeliaran pet", () => {
  it("rumah = pojok kanan dikurangi margin, dan x selalu di-clamp ke jalur", () => {
    expect(homeX(LANE, PET)).toBe(HOME);
    expect(clampX(-50, LANE, PET)).toBe(LANE_MARGIN);
    expect(clampX(5000, LANE, PET)).toBe(HOME);
    expect(initialWalkState(LANE, PET, 0)).toEqual({ x: HOME, facing: "right", mode: "stand", until: STAND_MS[0] });
  });

  it.each([
    ["roam mati", { roam: false }],
    ["reduced-motion", { reduced: true }],
    ["tier mobile", { tier: "mobile" as const }],
  ])("terjangkar saat %s: di rumah, menghadap kanan, tanpa transisi", (_label, over) => {
    expect(anchored(input(over))).toBe(true);
    const step = stepWalk(walking(300, 200_000), input({ ...over, currentX: 420 }), seq(0.5));
    expect(step.state).toEqual(standing(HOME));
    expect(step.row).toBe("idle");
    expect(step.move).toEqual({ x: HOME, durationMs: 0 });
    // sudah di rumah & berdiri → tak ada perpindahan
    expect(stepWalk(standing(HOME), input(over), seq(0.5)).move).toBeNull();
  });

  it("jeda saat hover/panel/tab tersembunyi: berhenti di posisi aktual, baris pose", () => {
    for (const over of [{ hovered: true }, { panelOpen: true }, { documentHidden: true }]) {
      const step = stepWalk(walking(300, 200_000), input({ ...over, currentX: 412, pose: "working" }), seq(0.5));
      expect(step.state).toEqual(standing(412, Infinity, "left"));   // arah jalan dipertahankan
      expect(step.row).toBe("working");
      expect(step.move).toEqual({ x: 412, durationMs: 0 });
    }
    // sudah berdiri → jeda tak memindahkan apa pun
    expect(stepWalk(standing(412), input({ hovered: true, currentX: 412 }), seq(0.5)).move).toBeNull();
  });

  it("pose perhatian: pulang ke pojok kanan dengan baris jalan, lalu berdiri memutar pose", () => {
    const away = stepWalk(standing(300), input({ pose: "waiting", currentX: 300 }), seq(0.5));
    expect(away.state.mode).toBe("home");
    expect(away.state.facing).toBe("right");
    expect(away.row).toBe("walk-right");
    expect(away.move).toEqual({ x: HOME, durationMs: Math.round(((HOME - 300) / WALK_PX_PER_S) * 1000) });
    expect(away.state.until).toBe(100_000 + away.move!.durationMs);
    // di tengah jalan pulang: lanjut, tanpa perpindahan baru
    const mid = stepWalk(away.state, input({ pose: "waiting", currentX: 500, now: 101_000 }), seq(0.5));
    expect(mid.state).toBe(away.state);
    expect(mid.move).toBeNull();
    // tiba: berdiri di rumah, baris waiting
    const arrived = stepWalk(away.state, input({ pose: "blocked", currentX: HOME, now: 200_000 }), seq(0.5));
    expect(arrived.state).toEqual(standing(HOME));
    expect(arrived.row).toBe("blocked");
  });

  it("shipped berhenti di tempat dan memutar baris shipped", () => {
    const step = stepWalk(walking(300, 200_000), input({ pose: "shipped", currentX: 350 }), seq(0.5));
    expect(step.state).toEqual(standing(350, Infinity, "left"));
    expect(step.row).toBe("shipped");
    expect(step.move).toEqual({ x: 350, durationMs: 0 });
  });

  it("pose tenang: berdiri 4–12 dtk, lalu jalan 2–6 dtk @ 40 px/s ke arah acak di dalam jalur", () => {
    // berdiri sampai `until`; rng pertama (0.5) → jalan 4 dtk = 160 px; rng kedua (0.9) → ke kanan
    const wait = stepWalk(standing(500, 100_500), input({ currentX: 500 }), seq(0.5, 0.9));
    expect(wait.move).toBeNull();
    expect(wait.row).toBe("idle");
    const go = stepWalk(standing(500, 100_000), input({ currentX: 500 }), seq(0.5, 0.9));
    expect(go.row).toBe("walk-right");
    expect(go.move).toEqual({ x: 660, durationMs: 4000 });
    expect(go.state).toEqual({ x: 660, facing: "right", mode: "walk", until: 104_000 });
    // jalan sampai tiba, lalu berdiri STAND_MS[0]..[1] (rng 0 → 4 dtk)
    const onTheWay = stepWalk(go.state, input({ currentX: 600, now: 102_000 }), seq(0));
    expect(onTheWay.move).toBeNull();
    expect(onTheWay.row).toBe("walk-right");
    const arrived = stepWalk(go.state, input({ currentX: 660, now: 104_000 }), seq(0));
    expect(arrived.state).toEqual({ x: 660, facing: "right", mode: "stand", until: 104_000 + STAND_MS[0] });
    expect(arrived.row).toBe("idle");
  });

  it("di tepi jalur membalik arah; jalur yang terlalu sempit membuatnya diam", () => {
    // di rumah, rng arah 0.9 (kanan) → tak ada ruang → balik ke kiri sejauh 160 px
    const flip = stepWalk(standing(HOME, 100_000), input({ currentX: HOME }), seq(0.5, 0.9));
    expect(flip.row).toBe("walk-left");
    expect(flip.move).toEqual({ x: HOME - 160, durationMs: 4000 });
    // jalur selebar pet + 2 margin + sedikit: tak ada arah yang memberi ≥ MIN_WALK_PX
    const narrow = LANE_MARGIN * 2 + PET + MIN_WALK_PX - 1;
    const stuck = stepWalk(standing(LANE_MARGIN, 100_000), input({ laneWidth: narrow, currentX: LANE_MARGIN }), seq(0.5, 0.9));
    expect(stuck.move).toBeNull();
    expect(stuck.state.mode).toBe("stand");
    expect(stuck.state.until).toBeGreaterThan(100_000);
  });

  it("berdiri tanpa batas (sehabis jeda) mendapat jadwal baru saat jeda berakhir", () => {
    const step = stepWalk(standing(420), input({ currentX: 420 }), seq(0.25));
    expect(step.state).toEqual({ x: 420, facing: "right", mode: "stand", until: 100_000 + STAND_MS[0] + 0.25 * (STAND_MS[1] - STAND_MS[0]) });
    expect(step.move).toBeNull();
  });

  it("durasi jalan mengikuti jarak sebenarnya setelah clamp, bukan angka acak", () => {
    // rng: jalan 6 dtk (0.999… → ~240 px) ke kanan dari 700 → clamp ke HOME (856): 156 px = 3900 ms
    const step = stepWalk(standing(700, 100_000), input({ currentX: 700 }), seq(1 - 1e-9, 0.9));
    expect(step.move!.x).toBe(HOME);
    expect(step.move!.durationMs).toBe(Math.round(((HOME - 700) / WALK_PX_PER_S) * 1000));
    expect(WALK_MS[1] * WALK_PX_PER_S / 1000).toBe(240);
  });
});
