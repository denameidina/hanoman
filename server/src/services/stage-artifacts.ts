import { PLAN_DIRS, SPEC_DIRS, type Stage } from "@hanoman/shared";
import { listRepoDocs } from "./scan";
import { resolveRepoDir } from "./local-binding";
import { STAGES } from "./stage-machine";

// Konvensi penamaan docs by spec-id adalah satu-satunya pemetaan fase→berkas yang andal di repo
// ini. Stage yang tak tercantum tak punya artefak berkas: `objective` hidup sebagai kolom DB, dan
// artefak Execute = kode/commit yang TAK PERNAH dihapus otomatis.
//
// SPEC-734 · ADR-0113 · DAFTAR direktori per stage, bukan satu: sebuah item bisa meninggalkan
// artefak di direktori metode LAIN (ia berpindah metode di tengah jalan), dan revert stage yang
// hanya membersihkan metode terpilih meninggalkan artefak basi yang nanti dibaca gerbang plan.
const ARTIFACT_DIR: Partial<Record<Stage, readonly string[]>> = {
  "spec-ready": SPEC_DIRS.map((d) => `${d}/`),
  planned: PLAN_DIRS.map((d) => `${d}/`),
};

// Berkas yang dihapus saat revert `current`→`target`: artefak tiap stage S dengan
// target < S <= current. Cocok bila path di bawah dir stage itu DAN memuat segmen spec-id
// dengan batas kiri non-alnum & kanan non-digit — `spec-16` tak menyerempet `spec-167`.
export async function artifactsToRemove(
  projectId: string, specId: string, target: Stage, current: Stage,
): Promise<string[]> {
  const ti = STAGES.indexOf(target), ci = STAGES.indexOf(current);
  const dirs = STAGES
    .filter((_, i) => i > ti && i <= ci)
    .flatMap((s) => ARTIFACT_DIR[s] ?? []);
  if (!dirs.length) return [];
  // SPEC-217 · path efektif (binding lokal per-mesin ?? Project.repoDir).
  const repoDir = await resolveRepoDir(projectId);
  if (!repoDir) return [];
  const id = specId.toLowerCase();
  const re = new RegExp(`(^|[^a-z0-9])${id}([^0-9]|$)`);
  const files = await listRepoDocs(repoDir);
  return files.filter((f) => dirs.some((d) => f.startsWith(d)) && re.test(f.toLowerCase()));
}
