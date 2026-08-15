import { z } from "zod";

const zSessionId = z.string().trim().min(1).max(256);
const zTerminalGroup = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  layout: z.object({
    rows: z.number().int().min(1).max(12),
    cols: z.number().int().min(1).max(12),
    cells: z.array(zSessionId.nullable()).max(144),
  }).strict().superRefine((layout, ctx) => {
    if (layout.cells.length !== layout.rows * layout.cols) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cells"],
        message: "cells must match rows × cols",
      });
    }
  }),
}).strict();

export const zTerminalWorkspaceV1 = z.object({
  version: z.literal(1),
  groups: z.array(zTerminalGroup).min(1).max(24),
}).strict().superRefine((workspace, ctx) => {
  const groupIds = new Set<string>();
  const sessionIds = new Set<string>();

  workspace.groups.forEach((group, groupIndex) => {
    if (groupIds.has(group.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groups", groupIndex, "id"],
        message: "group id must be unique",
      });
    }
    groupIds.add(group.id);

    group.layout.cells.forEach((sessionId, cellIndex) => {
      if (sessionId === null) return;
      if (sessionIds.has(sessionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", groupIndex, "layout", "cells", cellIndex],
          message: "sessionId must be unique across the workspace",
        });
      }
      sessionIds.add(sessionId);
    });
  });
});

export type TerminalWorkspaceV1 = z.infer<typeof zTerminalWorkspaceV1>;

export const zTerminalWorkspaceWrite = z.object({
  baseRevision: z.number().int().min(0),
  workspace: zTerminalWorkspaceV1,
}).strict();

export type TerminalWorkspaceWrite = z.infer<typeof zTerminalWorkspaceWrite>;

export const zTerminalWorkspaceSnapshot = z.object({
  workspace: zTerminalWorkspaceV1.nullable(),
  revision: z.number().int().min(0),
  updatedAt: z.string().datetime().nullable(),
}).strict();

export type TerminalWorkspaceSnapshot = z.infer<typeof zTerminalWorkspaceSnapshot>;

export const sameTerminalWorkspace = (
  left: TerminalWorkspaceV1,
  right: TerminalWorkspaceV1,
): boolean => JSON.stringify(left) === JSON.stringify(right);
