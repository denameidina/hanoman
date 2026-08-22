// SPEC-884 · ADR-0139 · wizard setup awal. Permukaan tak ber-auth SELAMA belum ada satu pun user —
// gerbangnya di `app.ts` dan syaratnya sama persis dengan `needsSetup` di /auth/status.
//
// Konsekuensi yang diterima sadar: instance yang sudah terjangkau internet sebelum wizard selesai
// bisa diklaim orang pertama yang membukanya. Urutan amannya: selesaikan wizard di localhost, baru
// sambungkan domain. Ini bukan regresi — sebelum SPEC-884 pintu itu ditutup setup token; menjadikan
// token opsional membukanya, dan itu harga yang disebut eksplisit di ADR-0139.
import type { FastifyInstance } from "fastify";
import {
  allReady, collectProbeFacts, prerequisites, resolveDeployment, resolveHardening,
} from "@hanoman/runner";
import { zSetupApply, type SetupStatus } from "@hanoman/shared";
import { prisma } from "../db";
import { BoundedRateLimiter } from "../services/bounded-rate-limit";
import { applySetup, hardeningLocked, setupDone } from "../services/setup-config";
import { requestConfigRestart } from "../services/restart";

export default async function (
  app: FastifyInstance, opts: { home: string; env: Record<string, string | undefined> },
) {
  // Permukaan tak ber-auth kedua tak boleh lahir tanpa limiter (cermin /auth/setup).
  const attempts = new BoundedRateLimiter({ windowMs: 60_000, limit: 10, maxKeys: 4_096 });
  const env = opts.env;

  const status = async (): Promise<SetupStatus> => ({
    // Dua syarat, bukan satu: belum ada user DAN wizard belum pernah dijawab.
    needed: (await prisma.user.count()) === 0 && !setupDone(opts.home),
    deployment: resolveDeployment(env),
    hardening: resolveHardening(env),
    hardeningLocked: hardeningLocked(opts.home, env),
    supervised: env.HANOMAN_SUPERVISOR === "1",
    setupTokenRequired: resolveHardening(env),
    prerequisites: prerequisites(env, collectProbeFacts(env)),
  });

  app.get("/setup/status", async () => status());

  app.post("/setup", async (req, reply) => {
    if (attempts.hit(req.ip).blocked) return reply.code(429).send({ error: "too many attempts" });
    const p = zSetupApply.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.flatten() });
    if (hardeningLocked(opts.home, env) && !p.data.hardening)
      return reply.code(409).send({ error: "hardening-locked" });
    if (p.data.hardening) {
      // Menulis HANOMAN_HARDENING=1 tanpa prasyarat lengkap melahirkan instance yang MENOLAK BOOT
      // pada restart berikutnya — kegagalan yang spec ini ada untuk mencabut, cuma dipindah tempat.
      const rows = prerequisites(env, collectProbeFacts(env));
      if (!allReady(rows))
        return reply.code(400).send({
          error: "prerequisites-missing",
          missing: rows.filter((r) => !r.ok).map((r) => r.id),
        });
    }
    applySetup(opts.home, { deployment: p.data.deployment, hardening: p.data.hardening });
    attempts.clear(req.ip);
    // Tanpa supervisor tak ada yang menghidupkan server lagi — keluar berarti instance MATI karena
    // menekan tombol setup. Simpan saja, dan katakan restart-nya manual.
    if (env.HANOMAN_SUPERVISOR !== "1") return { restart: "manual" as const };
    // Keluar SESUDAH response terkirim: keluar lebih dulu membuat wizard melihat koneksi putus,
    // bukan konfirmasi.
    reply.raw.on("finish", () => requestConfigRestart());
    return { restart: "self" as const };
  });
}
