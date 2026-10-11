import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db";

// ADR-0195 · siapa akun klien yang sedang "dilihat" oleh route `/api/portal/**`.
//
// Route portal menurunkan project yang boleh dilihat dari id AKUN KLIEN. Sesi cookie klien
// membawanya di `req.user`. Agent token tak punya `req.user`, jadi (hanya untuk method BACA, dan
// hanya bila gate `capabilityForRoute` meloloskannya dengan `portal:read`) ia WAJIB menyebut akun
// itu eksplisit lewat `?asClient=<id>`.
//
// Urutan prioritas tidak boleh dibalik: `req.user` MENANG. Klien yang menyisipkan
// `?asClient=<akun lain>` tetap hanya melihat dirinya sendiri — parameter itu hanya dibaca untuk
// principal agent. Tanpa itu, parameter ini jadi IDOR antar-klien.

const NOT_A_CLIENT = { error: "akun klien tidak ditemukan" };

/**
 * Id akun klien yang jadi sudut pandang request ini, atau `null` bila jawaban sudah dikirim ke
 * `reply` (handler cukup `return reply`).
 */
export async function portalUserId(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  if (req.user) return req.user.id;

  if (!req.agent) {
    // Tak ada principal sama sekali (mis. instance tanpa auth). Dulu ini `req.user!.id` yang
    // melempar TypeError → 500; 401 adalah jawaban yang benar.
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  // Defense in depth: gate sudah memetakan non-baca ke COOKIE_ONLY, tapi izin bertindak-atas-nama
  // tak boleh bergantung pada satu lapis. Agen tak pernah menulis sebagai klien.
  if (req.method !== "GET" && req.method !== "HEAD") {
    await reply.code(403).send({ error: "agent token hanya boleh membaca portal" });
    return null;
  }

  const raw = (req.query as { asClient?: unknown } | undefined)?.asClient;
  const asClient = typeof raw === "string" ? raw.trim() : "";
  if (!asClient) {
    await reply.code(400).send({ error: "asClient wajib: sebutkan id akun klien yang dilihat" });
    return null;
  }
  // Hanya role "client": akun operator bukan sudut pandang portal, dan tanpa filter ini parameter
  // ini jadi cara menanyakan "id ini akun operator?".
  const acc = await prisma.user.findFirst({
    where: { id: asClient, role: "client" }, select: { id: true },
  });
  if (!acc) {
    await reply.code(404).send(NOT_A_CLIENT);
    return null;
  }
  return acc.id;
}
