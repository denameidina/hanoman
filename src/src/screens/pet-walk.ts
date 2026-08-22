// Pet hidup (spec A) · mesin berkeliaran di tepi bawah. Murni: `stepWalk` menerima keadaan +
// masukan + rng dan mengembalikan keadaan baru, baris yang harus diputar, dan perpindahan yang harus
// dijalankan komponen (`translate` + durasi transisi). Tak ada timer di sini — komponen menjadwalkan
// SATU timeout pada `state.until` dan memanggil ulang saat `transitionend`/masukan berubah.
// SPEC-905 · mesin ini juga memegang pet yang DISERET: keadaan seret masuk sebagai masukan
// (`dragging`/`pointerX`/`pointerY`), keluar sebagai mode `held` → `falling` → `dizzy`.
import type { ResponsiveTier } from "../ds/responsive";
import type { PetPose } from "./pet-state";
import { POSE_ROW, durationMs, type PetRowKey } from "./pet-sprite";

export const WALK_PX_PER_S = 40;
// SPEC-905 · pet berjalan LEBIH SERING daripada berdiri. Rasionya disengaja, bukan selera: satu
// siklus tenang rata-rata kini 2,85 dtk berdiri + 9,5 dtk jalan (±72 % berjalan), kebalikan dari
// ±33 % milik [4000,12000]/[2000,6000] milik ADR-0140 — yang membuat sprite berjalan jarang
// terlihat berjalan. `WALK_PX_PER_S` tak ikut naik: yang kurang adalah DURASInya, bukan lajunya.
export const STAND_MS: readonly [number, number] = [1200, 4500];
export const WALK_MS: readonly [number, number] = [5000, 14000];
export const LANE_MARGIN = 16;
// Perpindahan lebih pendek dari ini bukan "jalan-jalan", cuma geser — arah dibalik atau diam.
export const MIN_WALK_PX = 24;
// SPEC-905 · jatuh ringan, bukan batu: ±1,7 dtk dari plafon 400 px. Percepatannya datang dari
// easing `fall` di komponen; yang linear di sini hanyalah laju rata-ratanya.
export const FALL_PX_PER_S = 240;
// Jatuhan sependek 20 px tetap harus terbaca sebagai jatuh, bukan sebagai kedip.
export const FALL_MIN_MS = 220;

export type PetFacing = "right" | "left";
export type PetWalkMode = "stand" | "walk" | "home" | "held" | "falling" | "dizzy";
export type PetEase = "linear" | "fall";
export type PetWalkState = {
  x: number;            // posisi tujuan/tempat berdiri (px dari kiri jalur)
  y: number;            // px DI ATAS lantai jalur; 0 = menapak
  facing: PetFacing;
  mode: PetWalkMode;
  until: number;        // kapan keadaan ini selesai (ms epoch); Infinity = menunggu masukan
  parkedX: number | null;   // tempat manusia terakhir meletakkannya; null = belum pernah diseret
};
export type PetWalkInput = {
  now: number;
  currentX: number;     // posisi aktual (dibaca komponen saat transisi dipotong)
  laneWidth: number;
  laneHeight: number;   // tinggi jalur yang boleh dipakai; sudah menghormati safe-area
  petWidth: number;
  petHeight: number;
  pose: PetPose;
  hovered: boolean;     // pointer hover ∨ fokus keyboard pada tombol
  panelOpen: boolean;
  documentHidden: boolean;
  roam: boolean;
  reduced: boolean;
  tier: ResponsiveTier;
  dragging: boolean;
  // Posisi yang DIMINTA untuk sudut kiri-bawah sprite, dalam koordinat jalur — bukan posisi pointer
  // mentah. Pengurangan titik pegang adalah aritmetika DOM dan hidup di komponen; yang murni —
  // clamp ke jalur dan ke plafon angkat — hidup di sini.
  pointerX: number;
  pointerY: number;
};
export type PetMove = { x: number; y: number; durationMs: number; ease: PetEase };
export type PetWalkStep = { state: PetWalkState; row: PetRowKey; move: PetMove | null };
export type Rng = () => number;

const ATTENTION: ReadonlySet<PetPose> = new Set(["waiting", "blocked"]);
// SPEC-897 · terputus & tidur = berhenti di tempat. Pulang ke pojok adalah gestur "kabar penting
// selalu di tempat yang sama"; di dua keadaan ini justru ketiadaan kabar yang sedang dikatakan.
const STILL: ReadonlySet<PetPose> = new Set(["offline", "sleeping"]);
const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);
const walkRow = (facing: PetFacing): PetRowKey => (facing === "right" ? "walk-right" : "walk-left");

export const homeX = (laneWidth: number, petWidth: number): number =>
  Math.max(LANE_MARGIN, laneWidth - petWidth - LANE_MARGIN);

export const clampX = (x: number, laneWidth: number, petWidth: number): number =>
  Math.min(Math.max(x, LANE_MARGIN), homeX(laneWidth, petWidth));

export const clampY = (y: number, laneHeight: number, petHeight: number): number =>
  Math.min(Math.max(y, 0), Math.max(0, laneHeight - petHeight));

// SPEC-905 · tiga mode yang memegang panggung sendiri: selama salah satunya berjalan, baris
// sekali-putar milik komponen (`wave`/`thanks`) tak boleh menumpang di atasnya.
export const isHandled = (mode: PetWalkMode): boolean =>
  mode === "held" || mode === "falling" || mode === "dizzy";

export const anchored = (input: Pick<PetWalkInput, "roam" | "reduced" | "tier">): boolean =>
  !input.roam || input.reduced || input.tier === "mobile";

export function initialWalkState(laneWidth: number, petWidth: number, now: number): PetWalkState {
  return {
    x: homeX(laneWidth, petWidth), y: 0, facing: "right", mode: "stand",
    until: now + STAND_MS[0], parkedX: null,
  };
}

export function stepWalk(state: PetWalkState, input: PetWalkInput, rng: Rng): PetWalkStep {
  const { now, laneWidth, laneHeight, petWidth, petHeight, pose } = input;
  const home = homeX(laneWidth, petWidth);
  const poseRow = POSE_ROW[pose];
  const cur = clampX(input.currentX, laneWidth, petWidth);
  // Hanya jalan kaki yang punya transisi untuk DIPOTONG. Jatuh juga punya, tetapi memotongnya sama
  // dengan menghapus jatuhnya — cabang seret sudah `return` sebelum `cut` bisa terpanggil.
  const moving = state.mode === "walk" || state.mode === "home";
  const settled = state.mode === "dizzy";   // pusingnya baru saja habis (cabang 0d melewatkan yang belum)
  const stand = (x: number, until: number, facing: PetFacing = state.facing): PetWalkState =>
    ({ x, y: 0, facing, mode: "stand", until, parkedX: state.parkedX });
  const cut = (x: number): PetMove | null =>
    (moving || Math.abs(cur - x) > 0.5 ? { x, y: 0, durationMs: 0, ease: "linear" } : null);
  const walkTo = (to: number, mode: "walk" | "home"): PetWalkStep => {
    const durationMs = Math.round((Math.abs(to - cur) / WALK_PX_PER_S) * 1000);
    const facing: PetFacing = to >= cur ? "right" : "left";
    return {
      state: { x: to, y: 0, facing, mode, until: now + durationMs, parkedX: state.parkedX },
      row: walkRow(facing),
      move: { x: to, y: 0, durationMs, ease: "linear" },
    };
  };
  // Mendarat. Pusing sekali putar lalu kembali ke pose mesin lewat `until` — BUKAN lewat
  // `thenOf("dizzy")`: manifest menulis `then: "idle"`, dan rantai itu berbohong saat pose mesinnya
  // `working` (pet berdiri diam padahal ada sesi berjalan). Perpindahan `y → 0` selalu dipancarkan,
  // termasuk pada jalur reduced yang tak pernah melewati `falling` — tanpa itu sprite tertinggal
  // di udara karena komponen menyimpan `move` terakhir.
  const land = (x: number): PetWalkStep => {
    const move: PetMove = { x, y: 0, durationMs: 0, ease: "linear" };
    if (input.reduced) return { state: { ...stand(x, Infinity), parkedX: x }, row: poseRow, move };
    return {
      state: { x, y: 0, facing: state.facing, mode: "dizzy", until: now + durationMs("dizzy"), parkedX: x },
      row: "dizzy", move,
    };
  };

  // 0a · diseret. Menang atas SEMUA cabang lain: fisika tak boleh diinterupsi pergantian pose, dan
  // `anchored()` melarang gerak OTONOM — bukan manipulasi langsung yang diminta manusia. Karena itu
  // seret nyala di semua tier, termasuk mobile (keputusan spec SPEC-905 §5.2).
  if (input.dragging) {
    const x = clampX(input.pointerX, laneWidth, petWidth);
    const y = clampY(input.pointerY, laneHeight, petHeight);
    return {
      state: { x, y, facing: state.facing, mode: "held", until: Infinity, parkedX: state.parkedX },
      row: "held",
      move: { x, y, durationMs: 0, ease: "linear" },
    };
  }

  // 0b · dilepas. `parkedX` dicap di sini: tempat manusia meletakkannya adalah posisi baru pet.
  if (state.mode === "held") {
    if (input.reduced || state.y === 0) return land(state.x);
    const fallMs = Math.max(FALL_MIN_MS, Math.round((state.y / FALL_PX_PER_S) * 1000));
    return {
      state: { x: state.x, y: 0, facing: state.facing, mode: "falling", until: now + fallMs, parkedX: state.x },
      row: "falling",
      move: { x: state.x, y: 0, durationMs: fallMs, ease: "fall" },
    };
  }

  // 0c · sedang jatuh: tak ada perpindahan baru sampai mendarat.
  if (state.mode === "falling") {
    if (now < state.until) return { state, row: "falling", move: null };
    return land(state.x);
  }

  // 0d · sedang pusing.
  if (state.mode === "dizzy" && now < state.until) return { state, row: "dizzy", move: null };

  // 1 · terjangkar (mobile / reduced / roam mati): berdiri di tempat manusia meletakkannya, atau di
  // rumah bila belum pernah diseret. Predikat `anchored()` tak berubah — hanya TITIK jangkarnya.
  if (anchored(input)) {
    const at = clampX(state.parkedX ?? home, laneWidth, petWidth);
    return { state: stand(at, Infinity, "right"), row: poseRow, move: cut(at) };
  }

  // 2 · jeda: hover, panel terbuka, tab tersembunyi — berhenti di tempat.
  if (input.hovered || input.panelOpen || input.documentHidden)
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 3 · terputus / tidur: berhenti di tempat, baris pose diputar.
  if (STILL.has(pose))
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 4 · pose perhatian: pulang ke pojok kanan dulu, lalu berdiri memutar baris pose.
  if (ATTENTION.has(pose)) {
    if (Math.abs(cur - home) > 1) {
      if (state.mode === "home" && now < state.until) return { state, row: walkRow(state.facing), move: null };
      return walkTo(home, "home");
    }
    return { state: stand(home, Infinity, "right"), row: poseRow, move: cut(home) };
  }

  // 5 · shipped: berhenti di tempat; baris sekali-putarnya diurus komponen.
  if (pose === "shipped")
    return { state: stand(cur, Infinity), row: poseRow, move: cut(cur) };

  // 6 · pose tenang: bergantian berdiri / jalan.
  if (moving) {
    if (now < state.until) return { state, row: walkRow(state.facing), move: null };
    return { state: stand(state.x, now + between(rng, STAND_MS)), row: poseRow, move: null };   // tiba
  }
  // Baru selesai pusing mendapat jadwal BERDIRI, bukan langsung jalan lagi — sama seperti berdiri
  // tanpa batas yang jedanya berakhir.
  if (settled || state.until === Infinity)
    return { state: stand(cur, now + between(rng, STAND_MS)), row: poseRow, move: null };
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
