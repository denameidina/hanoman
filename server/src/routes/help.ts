// SPEC-253 · ADR-0062 · endpoint PUBLIK Help Center — pengecualian sah gate /api (bypass cookie di
// app.ts; otorisasi helpEnabled + kunci opaque tiket, bukan sesi login). Same-origin (hanoman
// menyajikan SPA + API) → tanpa CORS. Submit = multipart/form-data (field + lampiran gambar).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zTicketCategory } from "@hanoman/shared";
import { prisma } from "../db";
import { hashAccessKey, publicStatus } from "../services/ticket";
import { intakeTicket, parseTicketUpload } from "../services/ticket-intake";
import { helpRateOk } from "../services/help-ratelimit";

const CATEGORIES = ["bug", "fitur", "pertanyaan", "lainnya"];
// SPEC-352 · nama field honeypot WAJIB netral bagi heuristik autofill. Nama lama `hp` berarti
// "handphone" dalam bahasa Indonesia — di form berbahasa Indonesia yang juga punya field email,
// autofill browser mengisinya untuk pelapor sungguhan, sehingga submit mereka tertelan sukses
// palsu tanpa jejak. `hp` sengaja TIDAK lagi dianggap honeypot: tab lama yang masih memegang
// bundle basi pun kini menghasilkan tiket, bukan hilang diam-diam.
const HONEYPOT_FIELD = "hc_trap";

const zField = z.object({
  category: zTicketCategory,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(10_000),
  email: z.string().min(3).max(200),
});

export default async function (app: FastifyInstance) {
  // Info halaman publik. 404 generik bila project tak ada / helpEnabled=false (tak membocorkan project).
  app.get("/help/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    return { projectName: p.name, categories: CATEGORIES };
  });

  // Submit keluhan (multipart). Honeypot `hc_trap` terisi → sukses palsu tanpa membuat tiket.
  app.post("/help/:slug/tickets", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    if (!helpRateOk(slug, req.ip)) return reply.code(429).send({ error: "terlalu banyak permintaan" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const upload = await parseTicketUpload(req);
    if (!upload) return reply.code(400).send({ error: "unggahan tak valid" });
    const { fields, files } = upload;

    // honeypot: bot → sukses palsu, tak buat tiket. Jejak log wajib — tanpa ini sebuah false
    // positive tak meninggalkan bukti apa pun (tak ada tiket, notifikasi, maupun baris feed).
    if (fields[HONEYPOT_FIELD]) {
      console.warn(`help: honeypot terpicu · project=${slug} ip=${req.ip}`);
      return reply.code(200).send({ ok: true });
    }

    const parsed = zField.safeParse({
      category: fields.category, title: fields.title, detail: fields.detail, email: fields.email,
    });
    if (!parsed.success) return reply.code(400).send({ error: "field wajib tak lengkap / tak valid" });

    const { ticket, key } = await intakeTicket({
      projectId: slug, projectName: p.name, category: parsed.data.category,
      title: parsed.data.title, detail: parsed.data.detail, reporterEmail: parsed.data.email, files,
    });

    const statusPath = `/help/${encodeURIComponent(slug)}/status/${encodeURIComponent(key)}`;
    return reply.code(201).send({ number: ticket.number, key, statusPath });
  });

  // Cek status publik by kunci opaque. Scoped ke slug (isolasi). 404 tanpa membocorkan keberadaan.
  // SPEC-293 · `key` boleh kunci pelapor (accessKeyHash) ATAU shareToken bagikan operator.
  app.get("/help/:slug/tickets/:key", async (req, reply) => {
    const { slug, key } = req.params as { slug: string; key: string };
    const t = await prisma.ticket.findFirst({
      where: { projectId: slug, OR: [{ accessKeyHash: hashAccessKey(key) }, { shareToken: key }] },
    });
    if (!t) return reply.code(404).send({ error: "not found" });
    let stage: string | null = null;
    if (t.specId) stage = (await prisma.spec.findUnique({ where: { id: t.specId } }))?.stage ?? null;
    return {
      number: t.number, category: t.category, title: t.title,
      status: publicStatus(t.status, stage), createdAt: t.createdAt.toISOString(),
    };
  });
}
