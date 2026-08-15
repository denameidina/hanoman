import { Prisma } from "@prisma/client";
import {
  type TerminalWorkspaceSnapshot,
  type TerminalWorkspaceWrite,
  zTerminalWorkspaceV1,
} from "@hanoman/shared";
import { prisma } from "../db";

export class InvalidStoredTerminalWorkspaceError extends Error {
  constructor() {
    super("stored terminal workspace is invalid");
  }
}

export async function readTerminalWorkspace(userId: string): Promise<TerminalWorkspaceSnapshot> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      terminalWorkspace: true,
      terminalWorkspaceRevision: true,
      terminalWorkspaceUpdatedAt: true,
    },
  });

  if (user.terminalWorkspace === null) {
    return {
      workspace: null,
      revision: user.terminalWorkspaceRevision,
      updatedAt: user.terminalWorkspaceUpdatedAt?.toISOString() ?? null,
    };
  }

  const parsed = zTerminalWorkspaceV1.safeParse(user.terminalWorkspace);
  if (!parsed.success) throw new InvalidStoredTerminalWorkspaceError();
  return {
    workspace: parsed.data,
    revision: user.terminalWorkspaceRevision,
    updatedAt: user.terminalWorkspaceUpdatedAt?.toISOString() ?? null,
  };
}

export async function writeTerminalWorkspace(
  userId: string,
  input: TerminalWorkspaceWrite,
): Promise<{ ok: boolean; current: TerminalWorkspaceSnapshot }> {
  // Jangan jadikan PUT valid sebagai repair diam-diam untuk row yang korup. Operator perlu melihat
  // 422 yang sama dari GET/PUT; revision CAS melindungi perubahan sah setelah validasi ini.
  await readTerminalWorkspace(userId);
  const updatedAt = new Date();
  const changed = await prisma.user.updateMany({
    where: { id: userId, terminalWorkspaceRevision: input.baseRevision },
    data: {
      terminalWorkspace: input.workspace as Prisma.InputJsonValue,
      terminalWorkspaceRevision: { increment: 1 },
      terminalWorkspaceUpdatedAt: updatedAt,
    },
  });
  if (changed.count === 1) {
    return {
      ok: true,
      current: {
        workspace: input.workspace,
        revision: input.baseRevision + 1,
        updatedAt: updatedAt.toISOString(),
      },
    };
  }
  return { ok: false, current: await readTerminalWorkspace(userId) };
}
