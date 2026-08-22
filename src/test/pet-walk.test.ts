import { describe, expect, it } from "vitest";
import { durationMs } from "../src/screens/pet-sprite";
import {
  FALL_MIN_MS, FALL_PX_PER_S, LANE_MARGIN, MIN_WALK_PX, STAND_MS, WALK_MS, WALK_PX_PER_S,
  anchored, clampX, clampY, homeX, initialWalkState, isHandled, stepWalk,
  type PetWalkInput, type PetWalkState,
} from "../src/screens/pet-walk";

const LANE = 1000;
const LANE_H = 800;
const PET = 128;
const PET_H = 139;
const HOME = LANE - PET - LANE_MARGIN;
const CEILING = LANE_H - PET_H;

function input(over: Partial<PetWalkInput> = {}): PetWalkInput {
  return {
    now: 100_000, currentX: HOME, laneWidth: LANE, laneHeight: LANE_H, petWidth: PET, petHeight: PET_H,
    pose: "ready", hovered: false, panelOpen: false, documentHidden: false, roam: true, reduced: false,
    tier: "desktop", dragging: false, pointerX: 0, pointerY: 0,
    ...over,
  };
}
const standing = (x: number, until = Infinity, facing: "right" | "left" = "right"): PetWalkState =>
  ({ x, y: 0, facing, mode: "stand", until, parkedX: null });
const walking = (x: number, until: number, facing: "right" | "left" = "left"): PetWalkState =>
  ({ x, y: 0, facing, mode: "walk", until, parkedX: null });
const held = (x: number, y: number): PetWalkState =>
  ({ x, y, facing: "right", mode: "held", until: Infinity, parkedX: null });
// rng deterministik: urutan nilai yang ditentukan test.
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };

describe("mesin berkeliaran pet", () => {
  it("rumah = pojok kanan dikurangi margin, dan x selalu di-clamp ke jalur", () => {
    expect(homeX(LANE, PET)).toBe(HOME);
    expect(clampX(-50, LANE, PET)).toBe(LANE_MARGIN);
    expect(clampX(5000, LANE, PET)).toBe(HOME);
    expect(initialWalkState(LANE, PET, 0)).toEqual({
      x: HOME, y: 0, facing: "right", mode: "stand", until: STAND_MS[0], parkedX: null,
    });
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
    expect(step.move).toEqual({ x: HOME, y: 0, durationMs: 0, ease: "linear" });
    // sudah di rumah & berdiri → tak ada perpindahan
    expect(stepWalk(standing(HOME), input(over), seq(0.5)).move).toBeNull();
  });

  it("jeda saat hover/panel/tab tersembunyi: berhenti di posisi aktual, baris pose", () => {
    for (const over of [{ hovered: true }, { panelOpen: true }, { documentHidden: true }]) {
      const step = stepWalk(walking(300, 200_000), input({ ...over, currentX: 412, pose: "working" }), seq(0.5));
      expect(step.state).toEqual(standing(412, Infinity, "left"));   // arah jalan dipertahankan
      expect(step.row).toBe("working");
      expect(step.move).toEqual({ x: 412, y: 0, durationMs: 0, ease: "linear" });
    }
    // sudah berdiri → jeda tak memindahkan apa pun
    expect(stepWalk(standing(412), input({ hovered: true, currentX: 412 }), seq(0.5)).move).toBeNull();
  });

  it("pose perhatian: pulang ke pojok kanan dengan baris jalan, lalu berdiri memutar pose", () => {
    const away = stepWalk(standing(300), input({ pose: "waiting", currentX: 300 }), seq(0.5));
    expect(away.state.mode).toBe("home");
    expect(away.state.facing).toBe("right");
    expect(away.row).toBe("walk-right");
    expect(away.move).toEqual({ x: HOME, y: 0, ease: "linear",
      durationMs: Math.round(((HOME - 300) / WALK_PX_PER_S) * 1000) });
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
    expect(step.move).toEqual({ x: 350, y: 0, durationMs: 0, ease: "linear" });
  });

  it("pose tenang: berdiri 1,2–4,5 dtk, lalu jalan 5–14 dtk @ 40 px/s ke arah acak di dalam jalur", () => {
    // berdiri sampai `until`; rng pertama (0.5) → jalan 9,5 dtk = 380 px; rng kedua (0.9) → ke kanan
    const wait = stepWalk(standing(300, 100_500), input({ currentX: 300 }), seq(0.5, 0.9));
    expect(wait.move).toBeNull();
    expect(wait.row).toBe("idle");
    const go = stepWalk(standing(300, 100_000), input({ currentX: 300 }), seq(0.5, 0.9));
    expect(go.row).toBe("walk-right");
    expect(go.move).toEqual({ x: 680, y: 0, durationMs: 9500, ease: "linear" });
    expect(go.state).toEqual({ x: 680, y: 0, facing: "right", mode: "walk", until: 109_500, parkedX: null });
    // jalan sampai tiba, lalu berdiri STAND_MS[0]..[1] (rng 0 → 1,2 dtk)
    const onTheWay = stepWalk(go.state, input({ currentX: 500, now: 105_000 }), seq(0));
    expect(onTheWay.move).toBeNull();
    expect(onTheWay.row).toBe("walk-right");
    const arrived = stepWalk(go.state, input({ currentX: 680, now: 109_500 }), seq(0));
    expect(arrived.state).toEqual({ x: 680, y: 0, facing: "right", mode: "stand", until: 109_500 + STAND_MS[0], parkedX: null });
    expect(arrived.row).toBe("idle");
  });

  it("berjalan lebih sering daripada berdiri — itulah isi perubahan angkanya", () => {
    // Rata-rata satu siklus tenang: berdiri (1,2+4,5)/2 = 2,85 dtk, jalan (5+14)/2 = 9,5 dtk.
    const standAvg = (STAND_MS[0] + STAND_MS[1]) / 2;
    const walkAvg = (WALK_MS[0] + WALK_MS[1]) / 2;
    expect(walkAvg / (walkAvg + standAvg)).toBeGreaterThan(0.7);
  });

  it("di tepi jalur membalik arah; jalur yang terlalu sempit membuatnya diam", () => {
    // di rumah, rng arah 0.9 (kanan) → tak ada ruang → balik ke kiri sejauh 380 px
    const flip = stepWalk(standing(HOME, 100_000), input({ currentX: HOME }), seq(0.5, 0.9));
    expect(flip.row).toBe("walk-left");
    expect(flip.move).toEqual({ x: HOME - 380, y: 0, durationMs: 9500, ease: "linear" });
    // jalur selebar pet + 2 margin + sedikit: tak ada arah yang memberi ≥ MIN_WALK_PX
    const narrow = LANE_MARGIN * 2 + PET + MIN_WALK_PX - 1;
    const stuck = stepWalk(standing(LANE_MARGIN, 100_000), input({ laneWidth: narrow, currentX: LANE_MARGIN }), seq(0.5, 0.9));
    expect(stuck.move).toBeNull();
    expect(stuck.state.mode).toBe("stand");
    expect(stuck.state.until).toBeGreaterThan(100_000);
  });

  it("berdiri tanpa batas (sehabis jeda) mendapat jadwal baru saat jeda berakhir", () => {
    const step = stepWalk(standing(420), input({ currentX: 420 }), seq(0.25));
    expect(step.state).toEqual({
      x: 420, y: 0, facing: "right", mode: "stand", parkedX: null,
      until: 100_000 + STAND_MS[0] + 0.25 * (STAND_MS[1] - STAND_MS[0]),
    });
    expect(step.move).toBeNull();
  });

  it("durasi jalan mengikuti jarak sebenarnya setelah clamp, bukan angka acak", () => {
    // rng: jalan 14 dtk (0.999… → ~560 px) ke kanan dari 700 → clamp ke HOME (856): 156 px = 3900 ms
    const step = stepWalk(standing(700, 100_000), input({ currentX: 700 }), seq(1 - 1e-9, 0.9));
    expect(step.move!.x).toBe(HOME);
    expect(step.move!.durationMs).toBe(Math.round(((HOME - 700) / WALK_PX_PER_S) * 1000));
    expect(WALK_MS[1] * WALK_PX_PER_S / 1000).toBe(560);
  });
});

describe("SPEC-897 — pose baru", () => {
  it.each([["offline", "idle"], ["sleeping", "sleep"]] as const)(
    "`%s` diam di tempat: tak pulang ke pojok, transisi dipotong", (pose, row) => {
      const step = stepWalk(walking(300, 200_000), input({ pose, currentX: 420 }), seq(0.5));
      expect(step.state).toEqual(standing(420, Infinity, "left"));   // berhenti mid-stride, tak berbalik
      expect(step.row).toBe(row);
      expect(step.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });
    });

  it("tak bergerak lagi saat sudah berdiri terputus/tidur", () => {
    const step = stepWalk(standing(420), input({ pose: "sleeping", currentX: 420 }), seq(0.5));
    expect(step.move).toBeNull();
    expect(step.state.until).toBe(Infinity);
  });

  it("`deciding` ikut aturan pose tenang: boleh jalan-jalan", () => {
    const step = stepWalk(standing(600, 99_000), input({ pose: "deciding", currentX: 600 }), seq(0.9, 0.1));
    expect(step.state.mode).toBe("walk");
    expect(step.row).toMatch(/^walk-/);
  });

  it("`deciding` memutar barisnya sendiri saat berdiri", () => {
    const step = stepWalk(standing(600, 200_000), input({ pose: "deciding", currentX: 600 }), seq(0.5));
    expect(step.row).toBe("deciding");
  });
});

describe("SPEC-905 — pet diseret", () => {
  it("diseret menang atas SEMUA cabang lain: terjangkar, jeda hover, pose perhatian, tidur", () => {
    for (const over of [
      { roam: false }, { reduced: true }, { tier: "mobile" as const },
      { hovered: true }, { panelOpen: true }, { documentHidden: true },
      { pose: "waiting" as const }, { pose: "sleeping" as const },
    ]) {
      const step = stepWalk(standing(300), input({ ...over, dragging: true, pointerX: 420, pointerY: 260 }), seq(0.5));
      expect(step.row).toBe("held");
      expect(step.state.mode).toBe("held");
      expect(step.state.until).toBe(Infinity);
      expect(step.move).toEqual({ x: 420, y: 260, durationMs: 0, ease: "linear" });
    }
  });

  it("mengikuti pointer di dua sumbu, di-clamp jalur dan plafon angkat", () => {
    expect(clampY(-40, LANE_H, PET_H)).toBe(0);
    expect(clampY(5_000, LANE_H, PET_H)).toBe(CEILING);
    const high = stepWalk(held(300, 100), input({ dragging: true, pointerX: 5_000, pointerY: 5_000 }), seq(0.5));
    expect(high.state.x).toBe(HOME);
    expect(high.state.y).toBe(CEILING);
    const low = stepWalk(held(300, 100), input({ dragging: true, pointerX: -900, pointerY: -900 }), seq(0.5));
    expect(low.state.x).toBe(LANE_MARGIN);
    expect(low.state.y).toBe(0);
  });

  it("dilepas dari ketinggian: jatuh dengan easing percepatan, durasi dari jaraknya", () => {
    const drop = stepWalk(held(420, 480), input({ currentX: 420 }), seq(0.5));
    expect(drop.row).toBe("falling");
    expect(drop.state.mode).toBe("falling");
    expect(drop.state.y).toBe(0);
    expect(drop.state.until).toBe(100_000 + 2_000);
    expect(drop.move).toEqual({ x: 420, y: 0, durationMs: 2_000, ease: "fall" });
    expect(Math.round((480 / FALL_PX_PER_S) * 1000)).toBe(2_000);
    // jatuhan sependek 20 px tetap terbaca sebagai jatuh
    expect(stepWalk(held(420, 20), input({ currentX: 420 }), seq(0.5)).move!.durationMs).toBe(FALL_MIN_MS);
  });

  it("selagi jatuh tak ada perpindahan baru, dan pergantian pose tak memotongnya", () => {
    const falling: PetWalkState = { x: 420, y: 0, facing: "right", mode: "falling", until: 102_000, parkedX: 420 };
    for (const over of [{}, { pose: "waiting" as const }, { hovered: true }, { roam: false }]) {
      const step = stepWalk(falling, input({ ...over, currentX: 420, now: 101_000 }), seq(0.5));
      expect(step.state).toBe(falling);
      expect(step.row).toBe("falling");
      expect(step.move).toBeNull();
    }
  });

  it("mendarat → pusing sekali putar → pose mesin dengan jadwal berdiri baru, di x tempat dilepas", () => {
    const falling: PetWalkState = { x: 420, y: 0, facing: "right", mode: "falling", until: 102_000, parkedX: 420 };
    const landed = stepWalk(falling, input({ currentX: 420, now: 102_000 }), seq(0.5));
    expect(landed.row).toBe("dizzy");
    expect(landed.state.mode).toBe("dizzy");
    expect(landed.state.until).toBe(102_000 + durationMs("dizzy"));
    expect(landed.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });
    // selagi pusing: tetap pusing, tak ada perpindahan
    const mid = stepWalk(landed.state, input({ currentX: 420, now: 102_500 }), seq(0.5));
    expect(mid.state).toBe(landed.state);
    expect(mid.row).toBe("dizzy");
    // selesai: baris pose mesin, berdiri di 420 — BUKAN melompat ke pojok, BUKAN langsung jalan lagi
    const done = stepWalk(landed.state, input({ currentX: 420, now: 103_100, pose: "working" }), seq(0.5));
    expect(done.row).toBe("working");
    expect(done.state).toEqual({
      x: 420, y: 0, facing: "right", mode: "stand", until: 103_100 + 1200 + 0.5 * 3300, parkedX: 420,
    });
    expect(done.move).toBeNull();
  });

  it("reduced-motion: jatuh seketika dan pusing DILEWATI", () => {
    const drop = stepWalk(held(420, 480), input({ currentX: 420, reduced: true }), seq(0.5));
    expect(drop.row).toBe("idle");                 // baris pose, bukan falling/dizzy
    expect(drop.state.mode).toBe("stand");
    expect(drop.state.y).toBe(0);
    expect(drop.state.parkedX).toBe(420);
    expect(drop.move).toEqual({ x: 420, y: 0, durationMs: 0, ease: "linear" });
  });

  it("dilepas tanpa terangkat (y = 0) melewati jatuh dan langsung pusing", () => {
    const drop = stepWalk(held(420, 0), input({ currentX: 420 }), seq(0.5));
    expect(drop.row).toBe("dizzy");
    expect(drop.state.parkedX).toBe(420);
  });

  it("terjangkar berdiri di tempat manusia meletakkannya, bukan melompat balik ke pojok", () => {
    const parked: PetWalkState = { x: 240, y: 0, facing: "right", mode: "stand", until: Infinity, parkedX: 240 };
    for (const over of [{ roam: false }, { reduced: true }, { tier: "mobile" as const }]) {
      const step = stepWalk(parked, input({ ...over, currentX: 240 }), seq(0.5));
      expect(anchored(input(over))).toBe(true);
      expect(step.state.x).toBe(240);
      expect(step.move).toBeNull();          // sudah di sana → tak ada perpindahan
    }
    // belum pernah diseret → tetap rumah (perilaku ADR-0140, tak berubah)
    expect(stepWalk(standing(300), input({ roam: false, currentX: 300 }), seq(0.5)).state.x).toBe(HOME);
  });

  it("jangkar mengikuti seret walau terjangkar: seret → lepas → berdiri di sana", () => {
    const dragged = stepWalk(standing(HOME), input({ tier: "mobile", dragging: true, pointerX: 200, pointerY: 300 }), seq(0.5));
    expect(dragged.state.mode).toBe("held");
    const dropped = stepWalk(dragged.state, input({ tier: "mobile", currentX: 200 }), seq(0.5));
    expect(dropped.state.parkedX).toBe(200);
    const next = stepWalk({ ...dropped.state, mode: "stand", until: Infinity }, input({ tier: "mobile", currentX: 200 }), seq(0.5));
    expect(next.state.x).toBe(200);
    expect(next.move).toBeNull();
  });

  it("jangkar yang keluar jalur sesudah resize di-clamp, tidak menggantung", () => {
    // Jalur menyempit 1000 → 400 sesudah pet diparkir di 900. `currentX` di dalam jalur baru supaya
    // yang diuji memang clamp-nya `parkedX`, bukan clamp `currentX` yang sudah dilakukan lebih dulu.
    const parked: PetWalkState = { x: 900, y: 0, facing: "right", mode: "stand", until: Infinity, parkedX: 900 };
    const step = stepWalk(parked, input({ roam: false, laneWidth: 400, currentX: 100 }), seq(0.5));
    expect(step.state.x).toBe(homeX(400, PET));
    expect(step.move).toEqual({ x: homeX(400, PET), y: 0, durationMs: 0, ease: "linear" });
  });

  it("isHandled menamai tiga mode yang memegang panggung sendiri", () => {
    expect((["held", "falling", "dizzy"] as const).every(isHandled)).toBe(true);
    expect((["stand", "walk", "home"] as const).some(isHandled)).toBe(false);
  });
});
