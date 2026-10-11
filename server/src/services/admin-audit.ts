import type { FastifyRequest } from "fastify";
import { appendEvent } from "./logs/event-log";

// ADR-0196..0198 · jejak audit untuk aksi ADMIN yang dilakukan AGENT TOKEN (kredensial, akun, grant
// jarak jauh, retensi log, relay). Manusia berkuki cookie tidak dicatat di sini — perilakunya tak
// berubah; yang baru adalah permukaan yang dulu tertutup bagi agen, dan jejaknya wajib ada.
//
// Isi `data` TIDAK PERNAH memuat plaintext token/password: hanya id, nama, dan himpunan capability.

/** Penanda pelaku di `createdBy`/`by`/audit: `agent:<id>` untuk agent token, email untuk manusia. */
export function adminActor(req: Pick<FastifyRequest, "user" | "agent">): string {
  if (req.agent) return `agent:${req.agent.id}`;
  return req.user?.email ?? "unknown";
}

export function auditAgentAdmin(
  req: Pick<FastifyRequest, "agent">, kind: string, msg: string, data: Record<string, unknown> = {},
  level: "info" | "warn" = "warn",
): Promise<void> {
  if (!req.agent) return Promise.resolve();
  return appendEvent({
    kind: `admin.${kind}`, level, msg: `${msg} (oleh agent:${req.agent.id})`,
    data: { ...data, actor: { kind: "agent", agentTokenId: req.agent.id } },
  });
}
