import { createHash } from "node:crypto";
import { zSpecSlim, type SpecSlim, type Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { sessionPhasesBySpecAsync, type LivePhases } from "./live-phases";
import { planCompleteAsync, phasesComplete, stageForRunAsync } from "./session-phases";
import { STAGES } from "./stage-machine";
import { recordCompletion } from "./notifications";
import { notifySynced } from "./sync-notify";
import { decorateBlocked } from "./spec-deps";
import { recordHeadSha } from "./spec-head";

// SPEC-199 · dulu inline di GET /specs; kini dipakai route HTTP DAN hub siar (services/events.ts)
// supaya push WS dan pull HTTP tak pernah drift. Stage live diturunkan dari berkas fase sesi
// (SPEC-168), hanya maju (ADR-0008), write-through CAS (SPEC-197).
// Nomor SPEC hidup di kolom STRING, jadi `orderBy: { id: "desc" }` mengurutkannya leksikografis:
// "SPEC-999" > "SPEC-140" > "SPEC-1015". Begitu backlog tembus empat digit, item TERBARU jatuh ke
// EKOR daftar — dan karena list view dipaginasi 20/halaman, ia terbaca sebagai "spec 1000 ke atas
// tidak tampil". SQLite tak bisa mengurut numerik di kolom itu, tapi biayanya nol: `findMany` di
// bawah memang memuat set penuh (paginasi terjadi di layer response, routes/specs.ts).
// Id tanpa angka jatuh ke 0 — ia tetap ikut terbawa, hanya duduk di belakang.
const specNum = (id: string) => Number.parseInt(id.match(/\d+/)?.[0] ?? "0", 10);

type Filter = { project?: string; source?: string };

// Kolom siar `specs`: turunan `zSpecSlim` supaya select dan tipe frame tak bisa berselisih.
// `blockedBy` bukan kolom (dihias `decorateBlocked`); `dependsOn` kolom Json dan tetap dipilih.
const SLIM_SELECT = Object.fromEntries(
  Object.keys(zSpecSlim.shape).filter((k) => k !== "blockedBy").map((k) => [k, true]),
) as { id: true };

const phases = (): Promise<LivePhases> => sessionPhasesBySpecAsync().catch(() => new Map());

const sortByNumber = <T extends { id: string }>(rows: T[]) => rows.sort((a, b) => specNum(b.id) - specNum(a.id));

type Slim = Parameters<typeof decorateBlocked>[0][number] & { id: string; stage: string; title: string };

type Advance = { id: string; from: Stage; stage: Stage; cwd: string };

// Overlay stage live di atas baris DB: hanya maju (ADR-0008). Murni terhadap DB — penulisan
// (write-through CAS + notifikasi) ada di `liveOverlayTick`, jadi jalur baca tak punya efek samping.
async function applyOverlay<T extends { id: string; stage: string; title: string; projectId: string }>(
  specs: T[], live: LivePhases,
): Promise<{ out: T[]; advanced: Advance[]; doneNow: { specId: string; title: string; projectId: string | null }[] }> {
  const advanced: Advance[] = [];
  const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
  const out = await Promise.all(specs.map(async (s) => {
    const entry = live.get(s.id);
    if (!entry) return s;
    // stageForRun menahan `done` bila plan di worktree (entry.cwd) masih `- [ ]` (SPEC-173).
    const next = await stageForRunAsync(entry.phases, entry.cwd, s.id);
    if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
    advanced.push({ id: s.id, from: s.stage as Stage, stage: next, cwd: entry.cwd });
    if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
    return { ...s, stage: next };
  }));
  return { out, advanced, doneNow };
}

// SPEC-1267 · efek (persist stage maju) dipisah dari penyajian: efek jalan tiap tick siar walau
// digest tak berubah — kemajuan fase hidup di berkas/tmux, bukan di DB, jadi digest DB tak melihatnya.
export async function liveOverlayTick(): Promise<void> {
  const live = await phases();
  if (live.size === 0) return;
  const specs = await prisma.spec.findMany({
    where: { id: { in: [...live.keys()] } }, select: { id: true, stage: true, title: true, projectId: true },
  });
  const { advanced, doneNow } = await applyOverlay(specs, live);
  // Write-through pada kemajuan (forward-only dijamin guard di atas). CAS `stage = from`: revert
  // konkuren (PATCH mundur + hapus docs) tak boleh ter-overwrite maju lagi (SPEC-197).
  // SPEC-267 · CAS yang benar-benar menulis (count > 0) HARUS mengantre outbox — kemajuan stage
  // otomatis adalah cara dominan status backlog berubah; tanpa ini ia tak pernah ter-push ke hub
  // dan status lokal vs server desync. Best-effort seperti call-site outbox lain.
  await Promise.all(advanced.map(async (a) => {
    const res = await prisma.spec
      .updateMany({ where: { id: a.id, stage: a.from }, data: { stage: a.stage } })
      .catch(() => ({ count: 0 }));
    if (res.count === 0) return;
    // SPEC-475 · jalur persist `done` untuk sesi yang di-Start MANUAL — item seperti itu tak
    // punya baris antrean, jadi reconcile tak pernah menyentuhnya (terukur: SPEC-453, dependency
    // yang jadi biang keluhan). Hanya saat MENCAPAI `done`: rentang review ADR-0030 berakhir
    // ketika item selesai, bukan ketika fase perencanaannya lewat.
    if (a.stage === "done") await recordHeadSha(a.id, a.cwd);
    await notifySynced("spec", a.id); // SPEC-267/268 · advance → feed (hub publish / client push)
  }));
  // SPEC-180 · notif dibuat sesudah persist stage; recordCompletion idempoten (key unik).
  await Promise.all(doneNow.map((d) => recordCompletion(d.specId, d.title, d.projectId)));
}

// SPEC-447 · ADR-0093 · dependency dihias DI SINI supaya GET /specs dan grup siar WS `specs`
// membaca nilai yang sama (SPEC-199). Nol biaya untuk backlog yang tak memakai dependency.
export async function listSpecsLive(filter: Filter = {}) {
  const specs = sortByNumber(await prisma.spec.findMany({
    where: { projectId: filter.project, source: filter.source }, orderBy: { id: "desc" },
  }));
  return decorateBlocked((await applyOverlay(specs, await phases())).out);
}

export async function listSpecsSlim(): Promise<SpecSlim[]> {
  const rows = sortByNumber(await prisma.spec.findMany({ select: SLIM_SELECT, orderBy: { id: "desc" } }));
  const { out } = await applyOverlay(rows as unknown as Slim[], await phases());
  return (await decorateBlocked(out)) as unknown as SpecSlim[];
}

// Overlay baca-saja satu baris, untuk GET /specs/:id: stage maju di respons tanpa menulis DB.
export async function overlayOne<T extends { id: string; stage: string; title: string; projectId: string }>(spec: T): Promise<T> {
  const live = await phases();
  return (await applyOverlay([spec], live)).out[0]!;
}

// Sidik jari keadaan sesi hidup yang memengaruhi stage tersaji: status fase per sesi, plus untuk
// sesi yang seluruh fasenya tuntas apakah plan-nya masih menyisakan `- [ ]` (gerbang SPEC-173).
export async function liveSignature(): Promise<string> {
  const live = await phases();
  const parts = await Promise.all([...live.entries()].sort(([a], [b]) => a.localeCompare(b)).map(
    async ([id, e]) => `${id}:${e.phases.map((p) => p.state[0]).join("")}${
      phasesComplete(e.phases) ? `:${await planCompleteAsync(e.cwd, id)}` : ""}`));
  return parts.join("|");
}

// SPEC-1267 · dedup siar `specs`: count + max(updatedAt) + sum(version) menangkap tambah/hapus/ubah
// tanpa membaca set penuh, dan `liveSignature` menutup perubahan yang hanya hidup di fase sesi.
export async function specsDigest(): Promise<string> {
  const agg = await prisma.spec.aggregate({ _count: { _all: true }, _max: { updatedAt: true }, _sum: { version: true } });
  const db = `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}:${agg._sum.version ?? 0}`;
  return createHash("sha1").update(`${db}|${await liveSignature()}`).digest("hex");
}

export async function liveSpecs(filter: Filter = {}) {
  await liveOverlayTick();
  return listSpecsLive(filter);
}
