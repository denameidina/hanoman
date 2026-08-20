import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toPortalSpec, toPortalTicket, type PortalSpec, type PortalTicket } from "@hanoman/shared";
import { prisma } from "../../db";
import { liveSpecs } from "../live-specs";
import { listPrds, readPrd } from "../project-prds";

// SPEC-854 · ADR-0129 · LAPIS 2 — "worktree khusus portal yang hanya memuat dokumen".
//
// Ini BUKAN git worktree project: `repoDir` sering null (project clone/hub) dan worktree produk
// memuat source code yang tak boleh disentuh klien. Yang dibangun adalah direktori temp berisi
// HANYA proyeksi yang sudah boleh dibaca klien — proyeksi yang SAMA dengan yang dilayani
// `routes/portal.ts`, bukan query kedua yang kebetulan sepakat.
//
// Dari situ lahir invarian yang bisa diuji langsung: apa pun yang bisa dikatakan agen berasal
// dari berkas di sini, dan berkas di sini tak pernah memuat isi project lain. Containment cwd
// milik claude (Read/Glob/Grep tak bisa keluar dari cwd — terukur 7/7 percobaan ditolak) yang
// mengunci agen di dalamnya.

export const WORKSPACE_FILES = ["project.md", "pekerjaan.md", "laporan.md", "catatan-rilis.md"] as const;

// Kosakata yang dibaca klien, bukan stage internal — cermin `STAGE_LABEL` ClientPortal.tsx.
const STAGE_LABEL: Record<string, string> = {
  brainstorming: "Dirumuskan", objective: "Dirumuskan", "spec-ready": "Disiapkan",
  planned: "Direncanakan", executing: "Sedang dikerjakan", done: "Selesai",
};

const tanggal = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export function renderProjectDoc(p: { name: string; desc: string }): string {
  return `# ${p.name}\n\n${p.desc || "Belum ada keterangan."}\n`;
}

export function renderBacklogDoc(specs: PortalSpec[]): string {
  if (!specs.length) return "# Pekerjaan\n\nBelum ada pekerjaan tercatat.\n";
  const baris = specs.map((s) =>
    `## ${s.title}\n\n- Status: ${STAGE_LABEL[s.stage] ?? s.stage}\n- Prioritas: ${s.priority}\n`
    + `- Dibuat: ${tanggal(s.createdAt)} · Mulai: ${tanggal(s.startedAt)} · Selesai: ${tanggal(s.doneAt)}\n\n`
    + `${s.objective}\n`);
  return `# Pekerjaan\n\n${baris.join("\n")}`;
}

export function renderTicketDoc(tickets: PortalTicket[]): string {
  if (!tickets.length) return "# Laporan yang pernah dikirim\n\nBelum ada laporan.\n";
  const baris = tickets.map((t) =>
    `## ${t.title}\n\n- Jenis: ${t.category}\n- Status: ${t.status}\n- Dikirim: ${tanggal(t.createdAt)}\n`);
  return `# Laporan yang pernah dikirim\n\n${baris.join("\n")}`;
}

export function renderChangelogDoc(rows: { title: string; body: string; createdAt: Date }[]): string {
  if (!rows.length) return "# Catatan rilis\n\nBelum ada catatan rilis.\n";
  const baris = rows.map((c) =>
    `## ${c.title}\n\n${tanggal(c.createdAt.toISOString())}\n\n${c.body}\n`);
  return `# Catatan rilis\n\n${baris.join("\n")}`;
}

export type ChatWorkspace = { dir: string; files: string[]; cleanup(): void };

/**
 * Bangun workspace untuk SATU giliran. Dibangun ulang tiap giliran dan dihapus sesudahnya: tak
 * ada state di disk yang bisa basi, bocor, atau terpakai giliran project lain.
 *
 * Pemanggil WAJIB memanggil `cleanup()` di `finally`.
 */
export async function buildChatWorkspace(projectId: string): Promise<ChatWorkspace> {
  const dir = mkdtempSync(join(tmpdir(), "hanoman-portal-chat-"));
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId }, select: { name: true, desc: true } });
    if (!project) throw new Error("project tak ditemukan");

    const specs = (await liveSpecs({ project: projectId })).map(toPortalSpec);
    const tickets = await prisma.ticket.findMany({
      where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 });
    const changelogs = await prisma.changelog.findMany({
      where: { projectId }, orderBy: { createdAt: "desc" }, take: 20,
      select: { title: true, body: true, createdAt: true } });

    const files: string[] = [];
    const tulis = (rel: string, isi: string) => {
      writeFileSync(join(dir, rel), isi, { mode: 0o600 });
      files.push(rel);
    };
    tulis("project.md", renderProjectDoc(project));
    tulis("pekerjaan.md", renderBacklogDoc(specs));
    tulis("laporan.md", renderTicketDoc(tickets.map((t) => toPortalTicket(t, null))));
    tulis("catatan-rilis.md", renderChangelogDoc(changelogs));

    // PRD project ini — dokumen PRODUK, memang ditulis untuk dibaca pemilik project. Hanya ada
    // bila project punya checkout; project tanpa repoDir tetap dapat workspace yang sah.
    const prds = await listPrds(projectId);
    if (prds.length) {
      mkdirSync(join(dir, "dokumen"), { mode: 0o700 });
      for (const prd of prds) {
        const isi = await readPrd(projectId, prd.path);
        if (!isi) continue;
        tulis(join("dokumen", `${prd.slug.replaceAll("/", "-")}.md`), isi);
      }
    }
    return { dir, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
