import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { prisma } from "../../db";
import { dayStart, dayEnd, inDayRange } from "../date-range";
import { scrubSubject, scrubBody } from "./scrub";
import type { ChangelogInput, ChangelogItem } from "./render";

// SPEC-516 · ADR-0105 · kumpulkan bahan changelog per mode. Keadaan SAH yang bukan galat
// (rentang kosong, repo belum ditautkan, tanpa tag, revisi tak dikenal) dipulangkan sebagai
// `{ ok:false, reason }` berbahasa manusia — route menerjemahkannya ke 422, bukan 500.
// Constraint eksplisit brief: "bukan error 500".
export type CollectResult = { ok: true; input: ChangelogInput } | { ok: false; reason: string };

const toItem = (label: string, detail: string): ChangelogItem | null => {
  const l = scrubSubject(label);
  return l ? { label: l, detail: scrubBody(detail) } : null;
};

/** Mode 1 — backlog yang SELESAI dalam rentang tanggal. Stempelnya `Spec.doneAt` (ADR-0105);
 *  `updatedAt` sengaja tak dipakai — mesin sync mem-bump `version` dan overlay stage-live menulis
 *  tiap `GET /specs` dibaca, jadi ia bergerak tanpa ada manusia (ADR-0090). */
export async function collectBacklog(projectId: string, from: string, to: string): Promise<CollectResult> {
  const f = dayStart(from), t = dayEnd(to);
  const rows = await prisma.spec.findMany({
    where: { projectId, stage: "done" },
    select: { title: true, objective: true, doneAt: true },
    orderBy: [{ doneAt: "asc" }, { id: "asc" }],
  });
  const stampless = rows.filter((r) => r.doneAt === null).length;
  const hit = rows.filter((r) => inDayRange(r.doneAt, f, t));
  const items = hit.map((r) => toItem(r.title, r.objective ?? "")).filter((x): x is ChangelogItem => x !== null);
  if (items.length === 0)
    return { ok: false, reason: `tak ada backlog yang selesai antara ${from} dan ${to}` };
  const notes: string[] = [];
  if (stampless > 0)
    notes.push(`${stampless} item selesai tanpa stempel waktu (selesai sebelum stempel ini ada) dan tak ikut dihitung.`);
  return { ok: true, input: { mode: "backlog", title: `${from} – ${to}`, items, notes } };
}

const exec = promisify(execFile);
const GIT = { maxBuffer: 1 << 24, encoding: "utf8" as const };
const US = "\x1f";   // pemisah field dalam satu record (cermin git-ide.ts)
const RS = "\x1e";   // pemisah antar-record — badan commit multi-baris

const NO_REPO = "project ini belum ditautkan ke repo di mesin ini";
const NO_TAG = "repo project ini belum punya tag rilis";

const usable = (repoDir: string | null): repoDir is string => !!repoDir && existsSync(repoDir);

/** Daftar tag, terbaru lebih dulu. `reason` terisi untuk keadaan SAH yang bukan galat. */
export async function listTags(repoDir: string | null): Promise<{ tags: string[]; head: string | null; reason: string | null }> {
  if (!usable(repoDir)) return { tags: [], head: null, reason: NO_REPO };
  try {
    const { stdout } = await exec("git", ["tag", "--list", "--sort=-creatordate"], { cwd: repoDir, ...GIT });
    const tags = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    const head = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: repoDir, ...GIT })
      .then((r) => r.stdout.trim()).catch(() => null);
    return { tags, head, reason: tags.length ? null : NO_TAG };
  } catch {
    return { tags: [], head: null, reason: NO_TAG };
  }
}

/**
 * Tag rilis SEBELUMNYA menurut RIWAYAT, bukan menurut tanggal. `git describe --abbrev=0 <tag>^`
 * memberi tag terdekat yang terjangkau dari induk `<tag>` — itulah arti "versi sebelumnya" yang
 * sebenarnya, dan ia kebal dua masalah yang menghancurkan pendekatan urut-tanggal: tanggal tag
 * anotasi beresolusi DETIK (dua rilis di menit yang sama berakhir seri, dan git lalu jatuh ke
 * urutan nama — terukur di fixture test: `v1.0.0` mendahului `v1.1.0`), dan tag di branch lain
 * bisa menyelip di antara dua rilis yang berurutan di branch ini. `null` = `<tag>` adalah rilis
 * pertama, dan pemanggil mengambil seluruh riwayat sampai ke sana.
 */
async function previousTag(repoDir: string, tag: string): Promise<string | null> {
  return exec("git", ["describe", "--tags", "--abbrev=0", "--end-of-options", `${tag}^`], { cwd: repoDir, ...GIT })
    .then((r) => r.stdout.trim() || null).catch(() => null);
}

/** Revisi ada? `--end-of-options` mencegah nilai berawalan `-` dibaca sebagai flag. */
async function revExists(repoDir: string, rev: string): Promise<boolean> {
  return exec("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], { cwd: repoDir, ...GIT })
    .then(() => true).catch(() => false);
}

async function logRange(repoDir: string, range: string[]): Promise<ChangelogItem[]> {
  const { stdout } = await exec("git",
    ["log", "--no-merges", `--pretty=format:%s${US}%b${RS}`, ...range], { cwd: repoDir, ...GIT });
  return stdout.split(RS)
    .map((rec) => rec.replace(/^\n+/, ""))
    .filter((rec) => rec.trim())
    .map((rec) => { const [subject, body] = rec.split(US); return toItem(subject ?? "", body ?? ""); })
    .filter((x): x is ChangelogItem => x !== null);
}

/** Mode 2 — commit di antara dua revisi. SHA sengaja TIDAK ikut ke dalam bahan: cara terkuat
 *  menjaga changelog bebas hash adalah tak pernah mengumpulkannya. */
export async function collectCommits(repoDir: string | null, fromSha: string, toSha: string): Promise<CollectResult> {
  if (!usable(repoDir)) return { ok: false, reason: NO_REPO };
  for (const rev of [fromSha, toSha])
    if (!await revExists(repoDir, rev)) return { ok: false, reason: `revisi "${rev}" tak dikenal di repo project` };
  try {
    const items = await logRange(repoDir, ["--end-of-options", `${fromSha}..${toSha}`]);
    if (!items.length) return { ok: false, reason: `tak ada perubahan antara "${fromSha}" dan "${toSha}"` };
    const short = (s: string) => s.slice(0, 7);
    return { ok: true, input: { mode: "commit", title: `${short(fromSha)} → ${short(toSha)}`, items, notes: [] } };
  } catch (e) {
    return { ok: false, reason: `git menolak rentang itu: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** Mode 3 — perubahan yang masuk ke sebuah versi. Tanpa `fromTag`, batas bawahnya adalah tag
 *  SEBELUMNYA menurut tanggal pembuatan; bila `toTag` adalah tag pertama, seluruh riwayat sampai
 *  ke sana yang diambil. */
export async function collectVersions(
  repoDir: string | null, fromTag: string | undefined, toTag: string,
): Promise<CollectResult> {
  const { tags, reason } = await listTags(repoDir);
  if (reason) return { ok: false, reason };
  if (!usable(repoDir)) return { ok: false, reason: NO_REPO };
  if (!tags.includes(toTag)) return { ok: false, reason: `tag "${toTag}" tak ada di repo project` };
  if (fromTag && !tags.includes(fromTag)) return { ok: false, reason: `tag "${fromTag}" tak ada di repo project` };
  const prev = fromTag ?? await previousTag(repoDir, toTag);
  try {
    const items = await logRange(repoDir, ["--end-of-options", prev ? `${prev}..${toTag}` : toTag]);
    if (!items.length) return { ok: false, reason: `tak ada perubahan yang masuk ke "${toTag}"` };
    const title = fromTag ? `${fromTag} → ${toTag}` : toTag;
    return { ok: true, input: { mode: "version", title, items, notes: [] } };
  } catch (e) {
    return { ok: false, reason: `git menolak rentang itu: ${(e as Error).message.split("\n")[0]}` };
  }
}
