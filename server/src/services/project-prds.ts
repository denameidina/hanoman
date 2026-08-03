import { prdStatusOf, type PrdDoc, type PrdSpecTrace } from "@hanoman/shared";
import { prisma } from "../db";
import { listRepoDocs, readDocFile } from "./scan";
import { resolveRepoDir } from "./local-binding";
import { listSessions } from "./pty";

// SPEC-210 · PRD adalah dokumen docs/prd/<slug>.md (bukan entitas DB, ADR-0011/0041). List/baca
// freshest-wins: worktree sesi prd hidup untuk project ini > repoDir (pola spec-docs.ts).
export type { PrdDoc };

const PRD_DIR = "docs/prd/";
// SPEC-273 · manifest breakdown (docs/prd/<slug>.breakdown.md) hidup di samping PRD tapi BUKAN PRD —
// jangan tampilkan di daftar/preview PRD, dan jangan gerbangkan readPrd untuknya.
const isPrd = (rel: string) => rel.startsWith(PRD_DIR) && rel.endsWith(".md") && !rel.endsWith(".breakdown.md");
const slugOf = (rel: string) => rel.slice(PRD_DIR.length, -3);
// Judul = heading `# ...` pertama; fallback slug.
const titleOf = (content: string | null, slug: string) => {
  const m = content?.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : slug;
};

// cwd sesi prd HIDUP untuk project ini (worktree, memuat draft belum di-merge) > repoDir.
// ponytail: PRD yang sesinya sudah ditutup TAPI branch belum di-merge tak muncul (hanya ada di
// origin/branch). Upgrade path bila perlu: list juga branch prd/*. Alur nyata (create→preview→
// take dalam satu sesi hidup, lalu merge) menutupinya.
async function resolveDir(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<{ dir: string | null; live: boolean }> {
  const live = sessions.find((s) => s.projectId === projectId && s.flow === "prd" && !s.exited && s.cwd);
  if (live) return { dir: live.cwd, live: true };
  // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
  return { dir: await resolveRepoDir(projectId), live: false };
}

// SPEC-520 · trace backlog untuk menghitung status PRD. Empat kolom saja dan TANPA filter di
// SQL: `payload` bertipe `Json` sehingga `string_contains` Prisma tak seragam di SQLite,
// sementara tabelnya kecil (337 baris / 294 KB payload di instalasi hidup terbesar) — menyaring
// di JS lebih jujur dan sudah cukup.
async function loadTraces(projectIds: string[]): Promise<Map<string, PrdSpecTrace[]>> {
  const map = new Map<string, PrdSpecTrace[]>(projectIds.map((id) => [id, []]));
  if (!projectIds.length) return map;
  const rows = await prisma.spec.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, stage: true, payload: true, branchFrom: true },
  });
  for (const r of rows)
    map.get(r.projectId)?.push({ stage: r.stage, payload: r.payload, branchFrom: r.branchFrom });
  return map;
}

export async function listPrds(
  projectId: string, sessions: ReturnType<typeof listSessions> = listSessions(),
  // SPEC-520 · trace boleh disuntik pemanggil supaya daftar lintas-project tak jadi N+1.
  traces?: readonly PrdSpecTrace[],
): Promise<PrdDoc[]> {
  const { dir, live } = await resolveDir(projectId, sessions);
  if (!dir) return [];
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const projectName = project?.name ?? projectId;
  // Dihitung SESUDAH gerbang repoDir: project tanpa repoDir tak menyumbang PRD sama sekali,
  // jadi tak perlu query trace-nya.
  const specs = traces ?? (await loadTraces([projectId])).get(projectId) ?? [];
  return (await listRepoDocs(dir))
    .filter(isPrd)
    .map((rel) => {
      const slug = slugOf(rel);
      const { status, specCount, doneCount } = prdStatusOf(rel, specs);
      return {
        slug, name: rel.slice(rel.lastIndexOf("/") + 1), path: rel,
        title: titleOf(readDocFile(dir, rel), slug), live, projectId, projectName,
        status, specCount, doneCount,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// perbaikan SPEC-210 · daftar PRD LINTAS-project (filter "Semua project"): iterasi tiap project
// (pola projects.ts) lalu concat listPrds-nya. Project tanpa repoDir → [] (tak menyumbang).
export async function listAllPrds(
  sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<PrdDoc[]> {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" }, select: { id: true },
  });
  // SPEC-520 · SATU query trace untuk semua project sekaligus; tanpa ini daftar lintas-project
  // menembak `loadTraces` sekali per project.
  const traces = await loadTraces(projects.map((p) => p.id));
  const nested = await Promise.all(
    projects.map((p) => listPrds(p.id, sessions, traces.get(p.id) ?? [])));
  return nested.flat();
}

export async function readPrd(
  projectId: string, path: string, sessions: ReturnType<typeof listSessions> = listSessions(),
): Promise<string | null> {
  if (!isPrd(path)) return null; // gerbang: hanya docs/prd/*.md
  const { dir } = await resolveDir(projectId, sessions);
  return dir ? readDocFile(dir, path) : null; // readDocFile menolak non-.md / path keluar repo
}
