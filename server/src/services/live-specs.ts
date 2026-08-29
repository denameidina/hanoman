import type { Stage } from "@hanoman/shared";
import { prisma } from "../db";
import { sessionPhasesBySpec } from "./pty";
import { stageForRun } from "./session-phases";
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

export async function liveSpecs(filter: { project?: string; source?: string } = {}) {
  const specs = (await prisma.spec.findMany({
    where: { projectId: filter.project, source: filter.source }, orderBy: { id: "desc" },
  })).sort((a, b) => specNum(b.id) - specNum(a.id));
  const live = sessionPhasesBySpec();
  // SPEC-447 · ADR-0093 · dependency dihias DI SINI supaya GET /specs dan grup siar WS `specs`
  // membaca nilai yang sama (SPEC-199). Nol biaya untuk backlog yang tak memakai dependency:
  // `decorateBlocked` keluar lebih awal saat tak ada satu pun `dependsOn`.
  if (live.size === 0) return decorateBlocked(specs);
  const advanced: { id: string; from: Stage; stage: Stage; cwd: string }[] = [];
  const doneNow: { specId: string; title: string; projectId: string | null }[] = [];
  const out = specs.map((s) => {
    const entry = live.get(s.id);
    if (!entry) return s;
    // stageForRun menahan `done` bila plan di worktree (entry.cwd) masih `- [ ]` (SPEC-173).
    const next = stageForRun(entry.phases, entry.cwd, s.id);
    if (!next || STAGES.indexOf(next) <= STAGES.indexOf(s.stage as Stage)) return s;
    advanced.push({ id: s.id, from: s.stage as Stage, stage: next, cwd: entry.cwd });
    if (next === "done") doneNow.push({ specId: s.id, title: s.title, projectId: s.projectId });
    return { ...s, stage: next };
  });
  // Write-through pada kemajuan (forward-only dijamin guard di atas). CAS `stage = from`: revert
  // konkuren (PATCH mundur + hapus docs) tak boleh ter-overwrite maju lagi (SPEC-197).
  // SPEC-267 · CAS yang benar-benar menulis (count > 0) HARUS mengantre outbox — kemajuan stage
  // otomatis adalah cara dominan status backlog berubah; tanpa ini ia tak pernah ter-push ke hub
  // dan status lokal vs server desync. Best-effort seperti call-site outbox lain.
  if (advanced.length)
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
  return decorateBlocked(out);
}
