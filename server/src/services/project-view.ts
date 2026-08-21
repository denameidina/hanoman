import { prisma } from "../db";
import { STAGES } from "./stage-machine";
import { scanRepoDocs } from "./scan";
import { getBinding, resolveRepoDir } from "./local-binding";
import { docStatusFor } from "./coverage";
import { sessionPhases, type SessionInfo } from "./pty";
import type { Project } from "@prisma/client";
import type { ProjectView } from "@hanoman/shared";
import { autoMergeOf, handledByOf, type HandledByView } from "@hanoman/shared";

const IDLE = { status: "idle" as const, phase: null as string | null, flow: null as string | null };

// Sesi tmux adalah satu-satunya sumber kebenaran soal pekerjaan yang sedang berjalan
// (ADR-0016). Tak ada baris DB yang bisa basi saat prosesnya mati. Sesi project biasa
// (tanpa specId) tidak dihitung: itu terminal, bukan pekerjaan atas backlog item.
// SPEC-197 · snapshot `sessions` dioper dari pemanggil (satu listSessions per request),
// bukan re-scan tmux per project.
function sessionOf(projectId: string, sessions: SessionInfo[]) {
  const s = sessions.find((x) => x.projectId === projectId && x.specId && !x.exited);
  if (!s) return { session: IDLE, commit: "belum ada commit" };
  const phase = sessionPhases(s.id)?.find((p) => p.state === "active")?.name ?? null;
  return {
    session: { status: "running" as const, phase, flow: s.flow ?? null },
    commit: `→ hanoman/${s.id}`,
  };
}

// SPEC-880 · ADR-0135 · indeks device instance ini, dipakai memperkaya penanda "ditangani oleh".
// `DeviceToken` TIDAK ikut SYNCED, jadi di client peta ini kosong dan `handledByView` jatuh ke
// nama snapshot — itulah sebabnya `name` ikut tersimpan.
export type DeviceIndex = Map<string, { name: string; revoked: boolean }>;

export async function loadDeviceIndex(): Promise<DeviceIndex> {
  const rows = await prisma.deviceToken.findMany({ select: { id: true, name: true, revokedAt: true } });
  return new Map(rows.map((d) => [d.id, { name: d.name, revoked: d.revokedAt !== null }]));
}

// Nama HIDUP menang saat barisnya ada (rename device ikut terlihat); snapshot jadi jaring
// pengamannya. `revoked` selalu false di instance yang tak memegang katalog device.
function handledByView(raw: unknown, devices: DeviceIndex): HandledByView[] {
  return handledByOf(raw).map((e) => {
    const d = devices.get(e.deviceId);
    return { deviceId: e.deviceId, name: d?.name ?? e.name, revoked: d?.revoked ?? false };
  });
}

// SPEC-197 · terima baris project + snapshot sesi dari pemanggil: buang N+1 findUniqueOrThrow
// (baris sudah ada di GET /projects) dan re-scan tmux per project.
// SPEC-880 · `devices` OPSIONAL, cermin `sessions`: GET /projects memuat indeksnya SEKALI per
// request; pemanggil satuan boleh mengabaikannya dan biarkan service memuatnya sendiri.
export async function toProjectView(
  p: Project, sessions: SessionInfo[], devices?: DeviceIndex,
): Promise<ProjectView> {
  const deviceIndex = devices ?? await loadDeviceIndex();
  const specs = await prisma.spec.findMany({ where: { projectId: p.id } });
  // Coverage adalah nilai turunan, bukan state tersimpan (ADR-0018). SPEC-217 · pindai path
  // EFEKTIF (binding lokal per-mesin ?? Project.repoDir), bukan repoDir mentah — agar dashboard
  // menghormati checkout lokal. null / bukan git repo -> 0 -> "broken".
  const { coverage } = await scanRepoDocs(await resolveRepoDir(p.id));
  // SPEC-217 · override repoDir per-mesin (null = pakai Project.repoDir) — biar UI tahu apakah
  // path efektif berasal dari checkout lokal atau default project.
  const binding = await getBinding(p.id);
  const open = specs.filter((s) => s.stage !== "done");
  const { session, commit } = sessionOf(p.id, sessions);
  const topStage = open.length
    ? open.map((s) => s.stage).sort((a, b) => STAGES.indexOf(b as any) - STAGES.indexOf(a as any))[0]!
    : "spec";
  return {
    id: p.id, name: p.name, desc: p.desc, kind: p.kind as any, repoDir: p.repoDir,
    binding,
    gitRemote: p.gitRemote ?? null,
    stack: p.stack, docStatus: docStatusFor(coverage), coverage, createdAt: p.createdAt.toISOString(),
    backlog: open.length, topStage,
    session,
    activity: session.status === "running" ? `running · ${session.flow ?? "sesi"}` : "idle",
    commit,
    // SPEC-253 · Help Center publik aktif.
    helpEnabled: p.helpEnabled,
    // SPEC-294 · opt-in scheduler otonom (lokal per-instance).
    schedulerOptIn: p.schedulerOptIn,
    // SPEC-409 · ADR-0091 · opt-in hanoman-lead (lokal per-instance, cermin schedulerOptIn).
    leadOptIn: p.leadOptIn,
    // SPEC-880 · ADR-0135 · penanda "ditangani oleh" (DISYNC — beda dari repoDir/binding di atas
    // yang fakta mesin ini saja).
    handledBy: handledByView((p as { handledBy?: unknown }).handledBy, deviceIndex),
    // SPEC-486 · ADR-0103 · kebijakan auto-merge (lokal per-instance, cermin schedulerOptIn).
    autoMerge: autoMergeOf((p as { autoMerge?: unknown }).autoMerge),
  };
}
