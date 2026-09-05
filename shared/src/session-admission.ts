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
});
export type LaunchStatus = z.infer<typeof zLaunchStatus>;

export const zLaunchRejection = z.object({
  error: z.string(),
  kind: z.enum(["capacity", "host-load"]),
  admission: zLaunchStatus,
});
export type LaunchRejection = z.infer<typeof zLaunchRejection>;
