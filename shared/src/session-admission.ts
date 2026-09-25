import { z } from "zod";

/** ADR-0161 · snapshot shared by scheduler state and rejected structured launches. */
export const zLaunchStatus = z.object({
  enabled: z.boolean(),
  liveCount: z.number().int().nonnegative(),
  liveAgentCount: z.number().int().nonnegative(),
  maxConcurrent: z.number().int().positive(),
  loadPerCore: z.number().finite().nonnegative().nullable(),
  maxLoadPerCore: z.number().finite().positive(),
  loadStatus: z.enum(["available", "unsupported", "unavailable"]),
  // P3 · SPEC-1267 · persentase memori TERSEDIA (darwin: kern.memorystatus_level, linux:
  // MemAvailable/MemTotal). null = platform tak memasok angka, bukan "penuh".
  memAvailablePct: z.number().finite().min(0).max(100).nullable(),
  minMemAvailablePct: z.number().finite().min(0).max(100),
  memStatus: z.enum(["available", "unavailable"]),
});
export type LaunchStatus = z.infer<typeof zLaunchStatus>;

export const zLaunchRejection = z.object({
  error: z.string(),
  kind: z.enum(["capacity", "host-load", "host-memory"]),
  admission: zLaunchStatus,
});
export type LaunchRejection = z.infer<typeof zLaunchRejection>;
