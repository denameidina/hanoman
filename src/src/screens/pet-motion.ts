import type { PetPose } from "./pet-state";

export type PetMotionDefinition = {
  id: PetPose;
  keyframe: string;
  animation: string;
};

const PET_MOTION: Record<PetPose, PetMotionDefinition> = {
  ready: {
    id: "ready",
    keyframe: "hn-pet-idle-ready",
    animation: "hn-pet-idle-ready var(--dur-pet-calm) var(--ease-inout) infinite",
  },
  working: {
    id: "working",
    keyframe: "hn-pet-idle-working",
    animation: "hn-pet-idle-working var(--dur-pet-active) var(--ease-inout) infinite",
  },
  waiting: {
    id: "waiting",
    keyframe: "hn-pet-idle-waiting",
    animation: "hn-pet-idle-waiting var(--dur-pet-attention) var(--ease-inout) infinite",
  },
  blocked: {
    id: "blocked",
    keyframe: "hn-pet-idle-blocked",
    animation: "hn-pet-idle-blocked var(--dur-pet-heavy) var(--ease-inout) infinite",
  },
  review: {
    id: "review",
    keyframe: "hn-pet-idle-review",
    animation: "hn-pet-idle-review var(--dur-pet-attention) var(--ease-inout) infinite",
  },
  shipped: {
    id: "shipped",
    keyframe: "hn-pet-idle-shipped",
    animation: "hn-pet-celebrate var(--dur-pet-flourish) var(--ease-out) 1 both, "
      + "hn-pet-idle-shipped var(--dur-pet-calm) var(--ease-inout) "
      + "var(--dur-pet-flourish) infinite",
  },
  "docs-updated": {
    id: "docs-updated",
    keyframe: "hn-pet-idle-docs",
    animation: "hn-pet-idle-docs var(--dur-pet-attention) var(--ease-inout) infinite",
  },
};

export function motionForPose(pose: PetPose): PetMotionDefinition {
  return PET_MOTION[pose];
}
