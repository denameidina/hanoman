import type { FastifyInstance } from "fastify";
import { listHistory, getHistory, transcriptOf, purgeHistory } from "../services/session-history";

// SPEC-362 · ADR-0079 · baca & purge riwayat sesi terminal. Path sengaja di bawah /terminal:
// capabilityForRoute() sudah memetakan seluruh top-level `terminal` ke sessions:read|write, jadi
// endpoint ini tergerbang tanpa menambah domain capability baru (ADR-0065).
export default async function (app: FastifyInstance) {
  app.get("/terminal/history", async (req) => {
    const q = req.query as {
      projectId?: string; specId?: string; kind?: string; q?: string; page?: string; limit?: string;
    };
    return listHistory(q);
  });

  app.get("/terminal/history/:id", async (req, reply) => {
    const r = await getHistory((req.params as { id: string }).id);
    return r ?? reply.code(404).send({ error: "not found" });
  });

  app.get("/terminal/history/:id/transcript", async (req, reply) => {
    const t = await transcriptOf((req.params as { id: string }).id);
    // Tak ada transkrip dan riwayat tak ada sama-sama 404: dari sisi pemanggil keduanya berarti
    // "tak ada yang bisa ditampilkan", dan membedakannya tak mengubah apa pun di UI.
    return t ?? reply.code(404).send({ error: "not found" });
  });

  app.delete("/terminal/history", async (req, reply) => {
    const { projectId, before } = req.query as { projectId?: string; before?: string };
    // Cermin DELETE /session-results (ADR-0047): append-only, purge WAJIB ber-scope — tanpa
    // parameter, satu request salah ketik akan menghapus seluruh riwayat.
    if (!projectId && !before) return reply.code(400).send({ error: "purge butuh projectId dan/atau before" });
    let cut: Date | undefined;
    if (before) {
      cut = new Date(before);
      if (Number.isNaN(cut.getTime())) return reply.code(400).send({ error: "before bukan tanggal valid" });
    }
    // SPEC-845 · ADR-0126 · barisnya memang terhapus meski berkasnya tidak, jadi ini tetap 200 —
    // `transcriptsFailed` yang menyatakan sukses SEBAGIAN. Berkas yang tertinggal jadi yatim dan
    // dipungut `reconcileTranscripts()` di sweep retensi berikutnya.
    return purgeHistory({ projectId, before: cut });
  });
}
