import type { Spec } from "@prisma/client";
import { grantsCapability } from "@hanoman/shared";
import { prisma } from "../db";

type PrincipalSource = {
  user?: { id: string; email: string } | null;
  agent?: { id: string; capabilities: string[] } | null;
};

export function launchPrincipal(source: PrincipalSource): string | null {
  if (source.user) return `user:${source.user.email}`;
  if (source.agent && grantsCapability(source.agent.capabilities, "sessions:write"))
    return `agent:${source.agent.id}`;
  return null;
}

export async function approveLaunch(specId: string, principal: string): Promise<void> {
  await prisma.spec.updateMany({
    where: { id: specId, launchApprovedAt: null },
    data: { launchApprovedAt: new Date(), launchApprovedBy: principal },
  });
}

export function assertLaunchApproved(spec: Pick<Spec, "id" | "launchApprovedAt">): void {
  if (!spec.launchApprovedAt) throw new Error(`launch ${spec.id} belum disetujui principal sessions:write`);
}
