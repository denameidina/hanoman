// Pet hidup (spec A) · mesin berkeliaran di tepi bawah. Murni: `stepWalk` menerima keadaan +
// masukan + rng dan mengembalikan keadaan baru, baris yang harus diputar, dan perpindahan yang harus
// dijalankan komponen (`translateX` + durasi transisi). Tak ada timer di sini — komponen menjadwalkan
// SATU timeout pada `state.until` dan memanggil ulang saat `transitionend`/masukan berubah.
import type { ResponsiveTier } from "../ds/responsive";
import type { PetPose } from "./pet-state";
import { POSE_ROW, type PetRowKey } from "./pet-sprite";

export const WALK_PX_PER_S = 40;
export const STAND_MS: readonly [number, number] = [4000, 12000];
export const WALK_MS: readonly [number, number] = [2000, 6000];
export const LANE_MARGIN = 16;
// Perpindahan lebih pendek dari ini bukan "jalan-jalan", cuma geser — arah dibalik atau diam.
export const MIN_WALK_PX = 24;

export type PetFacing = "right" | "left";
export type PetWalkMode = "stand" | "walk" | "home";
export type PetWalkState = {
  x: number;            // posisi tujuan/tempat berdiri (px dari kiri jalur)
  facing: PetFacing;
  mode: PetWalkMode;
  until: number;        // kapan keadaan ini selesai (ms epoch); Infinity = menunggu masukan
};
export type PetWalkInput = {
  now: number;
  currentX: number;     // posisi aktual (dibaca komponen saat transisi dipotong)
  laneWidth: number;
  petWidth: number;
  pose: PetPose;
  hovered: boolean;     // pointer hover ∨ fokus keyboard pada tombol
  panelOpen: boolean;
  documentHidden: boolean;
  roam: boolean;
  reduced: boolean;
  tier: ResponsiveTier;
};
export type PetMove = { x: number; durationMs: number };
export type PetWalkStep = { state: PetWalkState; row: PetRowKey; move: PetMove | null };
export type Rng = () => number;

const ATTENTION: ReadonlySet<PetPose> = new Set(["waiting", "blocked"]);
const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);
const walkRow = (facing: PetFacing): PetRowKey => (facing === "right" ? "walk-right" : "walk-left");

export const homeX = (laneWidth: number, petWidth: number): number =>
  Math.max(LANE_MARGIN, laneWidth - petWidth - LANE_MARGIN);

export const clampX = (x: number, laneWidth: number, petWidth: number): number =>
  Math.min(Math.max(x, LANE_MARGIN), homeX(laneWidth, petWidth));

export const anchored = (input: Pick<PetWalkInput, "roam" | "reduced" | "tier">): boolean =>
  !input.roam || input.reduced || input.tier === "mobile";

export function initialWalkState(laneWidth: number, petWidth: number, now: number): PetWalkState {
  return { x: homeX(laneWidth, petWidth), facing: "right", mode: "stand", until: now + STAND_MS[0] };
}

export function stepWalk(state: PetWalkState, input: PetWalkInput, rng: Rng): PetWalkStep {
  const { now, laneWidth, petWidth, pose } = input;
  const home = homeX(laneWidth, petWidth);
  const poseRow = POSE_ROW[pose];
  const cur = clampX(input.currentX, laneWidth, petWidth);
  const moving = state.mode !== "stand";
  const stand = (x: number, until: number, facing: PetFacing = state.facing): PetWalkState =>
    ({ x, facing, mode: "stand", until });
  const cut = (x: number): PetMove | null => (moving || Math.abs(cur - x) > 0.5 ? { x, durationMs: 0 } : null);
  const walkTo = (to: number, mode: "walk" | "home"): PetWalkStep => {
    const durationMs = Math.round((Math.abs(to - cur) / WALK_PX_PER_S) * 1000);
    const facing: PetFacing = to >= cur ? "right" : "left";
    return { state: { x: to, facing, mode, until: now + durationMs }, row: walkRow(facing), move: { x: to, durationMs } };
  };

  // 1 · terjangkar (mobile / reduced / roam mati): rumah, menghadap kanan, tanpa transisi.
  if (anchored(input)) return { state: stand(home, Infinity, "right"), row: poseRow, move: cut(home) };

  // 2 · jeda: hover, panel terbuka, tab tersembunyi — berhenti di tempat.
  if (input.hovered || input.panelOpen || input.documentHidden)
    return { state: stand(cur, Infinity), row: poseRow, move: moving ? { x: cur, durationMs: 0 } : null };

  // 3 · pose perhatian: pulang ke pojok kanan dulu, lalu berdiri memutar baris pose.
  if (ATTENTION.has(pose)) {
    if (Math.abs(cur - home) > 1) {
      if (state.mode === "home" && now < state.until) return { state, row: walkRow(state.facing), move: null };
      return walkTo(home, "home");
    }
    return { state: stand(home, Infinity, "right"), row: poseRow, move: moving ? { x: home, durationMs: 0 } : null };
  }

  // 4 · shipped: berhenti di tempat; baris sekali-putarnya diurus komponen.
  if (pose === "shipped")
    return { state: stand(cur, Infinity), row: poseRow, move: moving ? { x: cur, durationMs: 0 } : null };

  // 5 · pose tenang: bergantian berdiri / jalan.
  if (moving) {
    if (now < state.until) return { state, row: walkRow(state.facing), move: null };
    return { state: stand(state.x, now + between(rng, STAND_MS)), row: poseRow, move: null };   // tiba
  }
  if (state.until === Infinity) return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  if (now < state.until) return { state, row: poseRow, move: null };

  const dist = (between(rng, WALK_MS) * WALK_PX_PER_S) / 1000;
  let dir = rng() < 0.5 ? -1 : 1;
  let target = clampX(cur + dir * dist, laneWidth, petWidth);
  if (Math.abs(target - cur) < MIN_WALK_PX) {
    dir = -dir;
    target = clampX(cur + dir * dist, laneWidth, petWidth);
  }
  if (Math.abs(target - cur) < MIN_WALK_PX)   // jalur terlalu sempit untuk jalan-jalan
    return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
  return walkTo(target, "walk");
}
