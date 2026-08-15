import type { FastifyInstance } from "fastify";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { prisma } from "../db";
import { zCreateVps, zPatchVps, zMarkNa, zMarkNaBulk, zAttest, zRemediate, type VpsCheck } from "@hanoman/shared";
import { byId } from "../vps/catalog/catalog";
import { remediate } from "../services/vps-remediate";
import { sshExec, consoleArgv } from "../services/vps-ssh";
import { runAudit, scriptPath } from "../services/vps-audit";
import { buildChecklist } from "../vps/checklist";
import { bootstrapKey } from "../services/vps-bootstrap";
import { createSession } from "../services/pty";
import { sessionModel } from "../services/settings";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";

// Audit (dan nanti harden/session) = eksekusi remote via SSH dengan key milik mesin ini.
// Tanpa auth — pagarnya bind 127.0.0.1 di server.ts, sama seperti /api/terminal
// (lihat komentar routes/terminal.ts). Bila HOST dibuka, gembok route ini bersamanya.
// SPEC-213 · ADR-0044 · gate aksi SSH pada keberadaan key di mesin INI (AC-28). keyPath diset
// tapi berkasnya tak ada → key hilang. keyPath null = andalkan key default ssh (jangan blok —
// perilaku lama hub). keyPath TIDAK PERNAH disync (AC-29), jadi ini murni keputusan per-mesin.
function keyMissing(v: { keyPath: string | null }): boolean {
  return !!v.keyPath && !existsSync(v.keyPath);
}

export default async function (app: FastifyInstance) {
  app.get("/vps", async () => prisma.vps.findMany({ orderBy: { createdAt: "asc" } }));

  // `password` transien (SPEC-165): dipakai memasang key hanoman, lalu hilang bersama
  // request ini. Bootstrap dijalankan SEBELUM baris lahir — gagal berarti tak ada sampah.
  app.post("/vps", async (req, reply) => {
    const p = zCreateVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { password, ...data } = p.data;
    if (password) {
      const bs = await bootstrapKey({ host: data.host, port: data.port, user: data.user }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    const created = await prisma.vps.create({ data });
    await notifySynced("vps", created.id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed (tanpa keyPath)
    return reply.code(201).send(created);
  });

  app.patch("/vps/:id", async (req, reply) => {
    const p = zPatchVps.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const { id } = req.params as { id: string };
    const { password, ...data } = p.data;
    const current = await prisma.vps.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "not found" });
    if (password) {
      // Bootstrap ulang memakai nilai SESUDAH patch: mengganti host & password sekaligus harus bekerja.
      const bs = await bootstrapKey({
        host: data.host ?? current.host, port: data.port ?? current.port, user: data.user ?? current.user,
      }, password);
      if (!bs.ok) return reply.code(502).send({ error: "bootstrap key gagal lewat ssh", out: bs.out });
      data.keyPath = bs.keyPath;
    }
    const updated = await prisma.vps.update({ where: { id }, data });
    await notifySynced("vps", id); // SPEC-213/330 · sadar-peran: client antre push, hub publish ke feed
    return updated;
  });

  app.delete("/vps/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // SPEC-799 · ADR-0119 · `false` = barisnya memang tak ada; try/catch lama tak lagi dibutuhkan.
    if (!(await deleteSynced("vps", id))) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  app.post("/vps/:id/audit", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const r = await runAudit(v);
    if (!r.ok) return reply.code(502).send({ error: "audit gagal lewat ssh", out: r.out });
    return { audit: r.audit, hardened: r.hardened, scoreTotal: r.scoreTotal, scoreBySection: r.scoreBySection, drift: r.drift };
  });

  // SPEC-220 · checklist kepatuhan 232 item + status + skor per-seksi/total (AC-9).
  app.get("/vps/:id/checklist", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    return buildChecklist(v.id);
  });

  // SPEC-220 · tandai/lepas N/A (AC-10) — item keluar dari denominator skor, jejak pelaku dari sesi auth.
  app.post("/vps/:id/items/:itemId/na", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const v = await prisma.vps.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (!byId(itemId)) return reply.code(404).send({ error: "item tidak dikenal di katalog" });
    const p = zMarkNa.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const actorEmail = req.user?.email ?? null;
    await prisma.vpsItemState.upsert({
      where: { vpsId_itemId: { vpsId: id, itemId } },
      create: { vpsId: id, itemId, na: p.data.na, naReason: p.data.reason ?? null, actorEmail },
      update: { na: p.data.na, naReason: p.data.reason ?? null, actorEmail, updatedAt: new Date() },
    });
    return { ok: true };
  });

  // SPEC-221 · tandai N/A banyak item sekaligus (untuk "tandai seksi N/A" app-layer advisory).
  // itemId asing DALAM batch → tolak SELURUH batch (400), jangan sebagian.
  app.post("/vps/:id/items/na-bulk", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const p = zMarkNaBulk.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const unknown = p.data.itemIds.filter((id) => !byId(id));
    if (unknown.length) return reply.code(400).send({ error: `item tidak dikenal: ${unknown.join(", ")}` });
    const actorEmail = req.user?.email ?? null;
    await prisma.$transaction(p.data.itemIds.map((itemId) => prisma.vpsItemState.upsert({
      where: { vpsId_itemId: { vpsId: v.id, itemId } },
      create: { vpsId: v.id, itemId, na: p.data.na, naReason: p.data.reason ?? null, actorEmail },
      update: { na: p.data.na, naReason: p.data.reason ?? null, actorEmail, updatedAt: new Date() },
    })));
    return { ok: true, count: p.data.itemIds.length };
  });

  // SPEC-220 · attest item INFO (AC-11) — dihitung terpenuhi, jejak pelaku. Non-INFO ditolak.
  app.post("/vps/:id/items/:itemId/attest", async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    const v = await prisma.vps.findUnique({ where: { id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    const item = byId(itemId);
    if (!item) return reply.code(404).send({ error: "item tidak dikenal di katalog" });
    if (item.mode !== "INFO") return reply.code(400).send({ error: "hanya item INFO yang bisa di-attest" });
    const p = zAttest.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const actorEmail = req.user?.email ?? null;
    await prisma.vpsItemState.upsert({
      where: { vpsId_itemId: { vpsId: id, itemId } },
      create: { vpsId: id, itemId, attested: true, attestNote: p.data.note ?? null, actorEmail },
      update: { attested: true, attestNote: p.data.note ?? null, actorEmail, updatedAt: new Date() },
    });
    return { ok: true };
  });

  // SPEC-220 · validasi seleksi remediasi: semua item harus AUTO/remediable (AC-16).
  function badRemediateItems(items: string[]): string | null {
    for (const id of items) {
      const it = byId(id);
      if (!it) return `item tak dikenal di katalog: ${id}`;
      if (!it.remediable) return `item bukan AUTO/remediable: ${id}`;
    }
    return null;
  }

  // SPEC-220 · preview dry-run remediasi (AC-13) — tak menyentuh VPS.
  app.post("/vps/:id/remediate/preview", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const p = zRemediate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const bad = badRemediateItems(p.data.items);
    if (bad) return reply.code(400).send({ error: bad });
    const r = await remediate(v, p.data.items, true);
    if (!r.ok) return reply.code(502).send({ error: "preview gagal lewat ssh", out: r.out });
    return { steps: r.steps };
  });

  // SPEC-220 · apply remediasi item AUTO (AC-14) → verifikasi koneksi → re-audit (AC-17).
  app.post("/vps/:id/remediate", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const p = zRemediate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    const bad = badRemediateItems(p.data.items);
    if (bad) return reply.code(400).send({ error: bad });
    const r = await remediate(v, p.data.items, false);
    if (!r.ok) return reply.code(502).send({ error: "remediasi gagal lewat ssh", transcript: r.out });
    const verify = await sshExec(v, "true", { timeoutMs: 30_000 });
    if (verify.code !== 0) {
      return reply.code(502).send({
        error: "verifikasi koneksi pasca-remediasi gagal — periksa akses ssh secara manual",
        transcript: r.out, verify: verify.out });
    }
    const audit = await runAudit(v);
    return { steps: r.steps, audit: audit.ok ? audit.audit : null,
      scoreTotal: audit.ok ? audit.scoreTotal : null, scoreBySection: audit.ok ? audit.scoreBySection : null };
  });

  // Harden TIDAK PERNAH terjadwal — hanya dari tombol (SPEC-164 §5). Urutan anti-lockout:
  // apply (script sendiri allow port SSH sebelum enable firewall + sshd -t sebelum reload)
  // → verifikasi lewat KONEKSI BARU → audit ulang supaya status di list langsung jujur.
  app.post("/vps/:id/harden", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    // SSH_USER menentukan PermitRootLogin no vs prohibit-password; user/port sudah
    // divalidasi zod (trust boundary di zCreateVps), aman dirangkai ke perintah.
    const r = await sshExec(v, `sudo -n env SSH_PORT=${v.port} SSH_USER=${v.user} bash -s`,
      { stdin: readFileSync(scriptPath("harden.sh"), "utf8"), timeoutMs: 300_000 });
    if (r.code !== 0) return reply.code(502).send({ error: "harden gagal lewat ssh", transcript: r.out });
    const verify = await sshExec(v, "true", { timeoutMs: 30_000 });
    if (verify.code !== 0) {
      return reply.code(502).send({
        error: "verifikasi koneksi pasca-harden gagal — periksa akses ssh secara manual",
        transcript: r.out, verify: verify.out });
    }
    const audit = await runAudit(v);
    return { transcript: r.out, audit: audit.ok ? audit.audit : null, hardened: audit.ok && audit.hardened };
  });

  // SPEC-211 · test connection — cek ssh key-only berhasil sekarang. Transien, tak sentuh DB.
  // Gagal koneksi bukan error HTTP: 200 { ok:false, out } supaya UI bisa menampilkan transcript.
  app.post("/vps/:id/test", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const r = await sshExec(v, "true", { timeoutMs: 15_000 });
    return { ok: r.code === 0, out: r.out };
  });

  // SPEC-211 · Open Console — shell ssh MENTAH (bukan claude) di dalam tmux hanoman (ADR-0042).
  // id deterministik: tekan Console dua kali menyambung, bukan menumpuk sesi ssh.
  app.post("/vps/:id/console", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const s = createSession(`vps-console:${v.id}`, homedir(), { id: `vpsc-${v.id}`, command: consoleArgv(v) });
    return reply.code(201).send({ id: s.id });
  });

  // Escape hatch (SPEC-164 §6): kasus yang script tak tangani dikerjakan Claude interaktif.
  // cwd = home server (bukan repo siapa pun); konteks + perintah ssh dibawa prompt awal.
  app.post("/vps/:id/session", async (req, reply) => {
    const v = await prisma.vps.findUnique({ where: { id: (req.params as { id: string }).id } });
    if (!v) return reply.code(404).send({ error: "not found" });
    if (keyMissing(v)) return reply.code(409).send({ error: "key VPS tidak ada di mesin ini", keyMissing: true });
    const checks = (v.audit as VpsCheck[] | null) ?? [];
    const { model, effort } = await sessionModel();
    const s = createSession(`vps:${v.id}`, homedir(), {
      model, effort,
      prompt: [
        `Kamu membantu hardening lanjutan VPS "${v.name}" (${v.user}@${v.host} port ${v.port}).`,
        `Akses: ssh -p ${v.port}${v.keyPath ? ` -i ${v.keyPath}` : ""} ${v.user}@${v.host}`,
        checks.length ? "Hasil audit terakhir:" : "Belum pernah diaudit.",
        ...checks.map((c) => `- ${c.check}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`),
        "Kerjakan hanya yang diminta lewat terminal ini; konfirmasi dulu sebelum perubahan berisiko.",
      ].join("\n"),
    });
    return reply.code(201).send({ id: s.id });
  });
}
