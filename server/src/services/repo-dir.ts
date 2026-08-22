import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";

// undefined = project tak ada (→404); null = ada tapi tanpa checkout lokal; string = repoDir.
// SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-6).
// SPEC-908 · dipindah dari routes/ide.ts supaya hub siar memakai resolusi yang SAMA — dua
// resolusi repoDir yang bisa berselisih adalah kelas bug yang tak memunculkan satu pun error.
export async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return undefined;
  return (await resolveRepoDir(id)) ?? null;
}
