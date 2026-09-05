import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import type { WorktreeCleanupView } from "@hanoman/shared";
import { realGit } from "@hanoman/runner";
import { prisma } from "../db";
import { resolveRepoDir } from "./local-binding";
import { recordCleanupFailure } from "./notifications";

// SPEC-742 · ADR-0116 · PENGHAPUS byte worktree yang sudah dilepas dari path-nya.
//
// Menutup sesi dulu menjalankan `realGit.removeWorktree` di dalam request: `git worktree remove
// --force` (spawnSync) lalu `rmSync`, dua penghapusan pohon penuh yang memblokir SELURUH event
// loop — terukur 1 370 ms dengan 1 364 ms di antaranya tanpa satu tick pun. Itu sebabnya bukan
// hanya request penutupnya yang menggantung melainkan setiap pekerjaan lain di server.
//
// Sekarang route hanya me-`rename` worktree-nya ke `.trash` (1 ms) lalu membalas; modul ini yang
// menghapus byte-nya, dengan `fs.promises.rm` (lag event loop terukur 3 ms untuk pekerjaan yang
// sama). Yang membuat seluruh desain ini bebas kunci: **domainnya `<repoDir>/.worktrees/.trash/**`
// dan HANYA itu**. Tak ada path hidup dalam jangkauannya, jadi penutupan sesi yang tumpang tindih
// dan sesi baru yang lahir selagi penyapuan jalan aman menurut konstruksi, bukan menurut urutan.
//
// `.trash` sekaligus catatan durable-nya (ADR-0018/0019): isinya menurut konstruksi sampah, jadi
// crash di tengah penghapusan tak menghasilkan apa pun selain entri yang tersapu di boot berikutnya.

const TICK_MS = 60_000;

export const trashDirOf = (repoDir: string): string => resolve(repoDir, ".worktrees", ".trash");

export type ReaperDeps = {
  trash?: (repoDir: string, cwd: string) => string | null;
  rm: (path: string) => Promise<void>;
  /** Membatalkan registrasi worktree yang direktorinya sudah lenyap. Sekali per repo per sapuan. */
  prune: (repoDir: string) => Promise<void>;
  /** Project yang punya checkout lokal → repoDir-nya (binding lokal menang, SPEC-213). */
  repos: () => Promise<{ projectId: string; repoDir: string }[]>;
};

const exec = promisify(execFile);

export const prodReaperDeps: ReaperDeps = {
  rm: (path) => rm(path, { recursive: true, force: true }),
  prune: async (repoDir) => {
    try { await exec("git", ["worktree", "prune"], { cwd: repoDir, timeout: 30_000 }); }
    catch { /* repo tak terbaca — registrasi basi bukan alasan menahan penghapusan */ }
  },
  repos: async () => {
    const projects = await prisma.project.findMany({ select: { id: true } });
    const seen = new Set<string>();
    const out: { projectId: string; repoDir: string }[] = [];
    for (const p of projects) {
      const repoDir = await resolveRepoDir(p.id);
      if (!repoDir || seen.has(repoDir)) continue;   // dua project satu checkout = satu sapuan
      seen.add(repoDir);
      out.push({ projectId: p.id, repoDir });
    }
    return out;
  },
};

type Pending = {
  path: string; repoDir: string; projectId: string;
  sessionId: string; entry: string; since: number; error?: string;
};

// Read model, BUKAN sumber. Diisi ulang dari `.trash` tiap sapuan (dan karena itu tiap boot), jadi
// mempercayainya sebagai sumber berarti restart di tengah penghapusan meninggalkan sampah yang tak
// seorang pun tahu ada. Berkunci path trash — unik per entri.
const pending = new Map<string, Pending>();

// Nama entri `<sesi>.<stempel>`; id sesi disanitasi ke `[a-z0-9_-]` (pty.ts `idFor`) jadi tak
// pernah bertitik. Ini satu-satunya cara "milik sesi mana" bertahan melewati restart tanpa tabel.
const sessionIdOf = (entry: string): string => entry.split(".")[0] ?? entry;

/**
 * Lepaskan worktree sebuah sesi dari path-nya SEKARANG, lalu serahkan ke penyapu. Mengembalikan
 * nama entri trash-nya, atau `null` bila tak ada yang perlu dibersihkan.
 *
 * Pemanggil WAJIB sudah lewat `ownsWorktree` — `rename` sama merusaknya dengan `rm` bila targetnya
 * checkout project (SPEC-362). `rename` yang mustahil (mis. lintas filesystem) jatuh ke penghapusan
 * SINKRON lama: lambat, tapi benar. Yang tak boleh dilakukan adalah menghapus path ASLINYA di
 * latar — path itu bisa direbut peluncuran berikutnya, dan penghapusan latar akan memakan worktree
 * sesi yang baru lahir.
 *
 * Pemindahan, pencatatan, dan tendangan penyapu jadi SATU panggilan: memisahkannya berarti tiap
 * call site baru harus mengingat ketiganya, dan efek samping yang disalin ke call site adalah kelas
 * bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481).
 */
export function releaseWorktree(
  repoDir: string, cwd: string, projectId: string, deps: ReaperDeps = prodReaperDeps,
): string | null {
  try {
    return releaseWorktreeToTrash(repoDir, cwd, projectId, deps);
  } catch {
    realGit.removeWorktree(repoDir, cwd);
    return null;
  }
}

// ADR-0162: pemungutan yatim tidak boleh menghapus pohon sinkron ketika rename gagal.
export function releaseWorktreeToTrash(
  repoDir: string, cwd: string, projectId: string, deps: ReaperDeps = prodReaperDeps,
): string | null {
  const path = (deps.trash ?? realGit.trashWorktree)(repoDir, cwd);
  if (!path) return null;
  const entry = path.slice(trashDirOf(repoDir).length + 1);
  pending.set(path, { path, repoDir, projectId, entry, sessionId: sessionIdOf(entry), since: Date.now() });
  reapSoon(repoDir, projectId, deps);
  return entry;
}

export const listCleanups = (): WorktreeCleanupView[] =>
  [...pending.values()]
    .sort((a, b) => a.since - b.since)
    .map((p) => ({
      sessionId: p.sessionId, projectId: p.projectId, entry: p.entry,
      since: new Date(p.since).toISOString(),
      state: p.error ? "failed" : "closing",
      ...(p.error ? { error: p.error } : {}),
    }));

/** Hapus seluruh entri `.trash` milik satu repo. Mengembalikan jumlah yang benar-benar terhapus.
 *  Entri yang gagal DIPERTAHANKAN — ia sampah, dan sampah yang gagal dihapus tetap sampah. */
export async function sweepRepo(
  repoDir: string, projectId: string, deps: ReaperDeps = prodReaperDeps,
): Promise<number> {
  const dir = trashDirOf(repoDir);
  let entries: string[];
  try { entries = await readdir(dir); } catch { return 0; }   // belum pernah ada penutupan di repo ini

  let removed = 0;
  for (const entry of entries) {
    const path = join(dir, entry);
    // Entri yang ada di disk tapi tak ada di peta = peninggalan sebelum restart. Ia tetap harus
    // terlihat operator, jadi peta diisi dari disk lebih dulu.
    const known = pending.get(path);
    const row: Pending = known
      ?? { path, repoDir, projectId, entry, sessionId: sessionIdOf(entry), since: Date.now() };
    pending.set(path, row);
    try {
      await deps.rm(path);
      pending.delete(path);
      removed++;
    } catch (e) {
      row.error = (e as Error).message;
      // Satu baris per ENTRI (dedup lewat `key`), bukan satu per tick — sapuan berjalan tiap menit
      // dan kegagalan yang sama akan berulang sampai operator membereskan disknya.
      await recordCleanupFailure(row.sessionId, row.projectId, entry, row.error);
    }
  }
  if (removed) await deps.prune(repoDir);
  return removed;
}

export async function sweepAll(deps: ReaperDeps = prodReaperDeps): Promise<number> {
  let removed = 0;
  for (const { projectId, repoDir } of await deps.repos()) {
    removed += await sweepRepo(repoDir, projectId, deps).catch(() => 0);
  }
  return removed;
}

// Sapuan yang sedang berjalan per repo. Dua sapuan serentak atas repo yang sama tak merusak apa pun
// (`rm` ber-`force` menelan ENOENT), tapi mereka membuang I/O dan bisa saling melaporkan kegagalan
// palsu atas entri yang baru saja dihapus yang lain.
const inFlight = new Set<string>();

/** Tendangan langsung sesudah sebuah sesi ditutup — fire-and-forget, tak pernah menahan respons. */
export function reapSoon(repoDir: string, projectId: string, deps: ReaperDeps = prodReaperDeps): void {
  if (inFlight.has(repoDir)) return;
  inFlight.add(repoDir);
  void sweepRepo(repoDir, projectId, deps)
    .catch((e) => console.error("sapuan worktree:", e))
    .finally(() => inFlight.delete(repoDir));
}

let timer: NodeJS.Timeout | undefined;

/** Dipasang dari server.ts saja (app.ts bebas-timer, ADR-0072/0103). Sapuan boot adalah pemulihan
 *  crash: entri yang tertinggal karena proses mati di tengah penghapusan dibereskan di sini. */
export function startWorktreeReaper(deps: ReaperDeps = prodReaperDeps): void {
  if (timer) return;
  void sweepAll(deps).catch((e) => console.error("sapuan worktree saat boot:", e));
  timer = setInterval(() => { void sweepAll(deps).catch(() => {}); }, TICK_MS);
  timer.unref();
}

/** Test-only. */
export function __resetReaper(): void {
  pending.clear();
  inFlight.clear();
  if (timer) { clearInterval(timer); timer = undefined; }
}
