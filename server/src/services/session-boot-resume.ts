// ADR-0169 · auto-resume sesi backlog yang tadinya berjalan lalu terputus paksa (reboot OS,
// tmux/proses crash, tmux dibunuh manual). Dipanggil SEKALI saat boot, sesudah reconcileHistory()
// menutup baris yang panenya lenyap. Jalur peluncurannya PERSIS startSpecSession (ADR-0084,
// keadaan `resume`) — tak ada mekanisme baru, hanya pemicunya yang jadi otomatis.
import type { Spec } from "@prisma/client";
import { flowForSource } from "@hanoman/shared";
import { prisma } from "../db";
import { reconciledRuntimesSince, reconciledSpecIdsSince, type SessionRuntime } from "./session-history";
import { startSpecSession, type StartSpecResult } from "./session-launch";
import { recordFailure } from "./notifications";

export type ResumeDeps = {
  // S4c · `runtime` = agen/model/effort sesi asal (SessionHistory); absen → default Setting global.
  startSpec: (spec: Spec, runtime?: SessionRuntime) => Promise<StartSpecResult>;
  recordFail: (specId: string, title: string, projectId: string | null, reason: string) => Promise<void>;
};

const prodDeps: ResumeDeps = {
  // ADR-0169 · `bypassCapacity: true` — SATU-SATUNYA jalur yang melewati cap ADR-0161; gerbang
  // dependency ADR-0093 TETAP berlaku (tak diberi `force`). Keputusan sadar risiko: mesin 8 GB
  // operator sudah pernah kernel panic akibat sesi paralel berlebih (memori
  // mac-mini-8gb-panic-agen-paralel) — operator memilih "semua kembali" di atas throttle.
  startSpec: (spec, runtime) => startSpecSession(spec, {
    flow: flowForSource(spec.source), bypassCapacity: true, ...(runtime ?? {}),
  }),
  recordFail: recordFailure,
};

export type ResumeReport = { resumed: string[]; failed: string[] };

export async function resumeReconciledSessions(cutoff: Date, deps: ResumeDeps = prodDeps): Promise<ResumeReport> {
  const report: ResumeReport = { resumed: [], failed: [] };
  const specIds = await reconciledSpecIdsSince(cutoff);
  if (!specIds.length) return report;
  // stage "done" · item sudah selesai sebelum reboot, tak perlu dilanjutkan meski baris
  // riwayatnya kena reconcile (mis. sesi ditutup tepat saat mesin mati).
  const specs = await prisma.spec.findMany({ where: { id: { in: specIds }, stage: { not: "done" } } });
  const runtimes = await reconciledRuntimesSince(cutoff);
  // Berurutan — bukan Promise.all: operasi worktree/git antar item tak boleh saling tabrak
  // (rebuild worktree dari headSha, dsb). Murni menghindari race, BUKAN throttle kapasitas —
  // kapasitas sudah sengaja dilewati lewat bypassCapacity di atas.
  for (const spec of specs) {
    try {
      await deps.startSpec(spec, runtimes.get(spec.id));
      report.resumed.push(spec.id);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await deps.recordFail(spec.id, spec.title, spec.projectId, `gagal dilanjutkan otomatis — ${reason}`);
      report.failed.push(spec.id);
    }
  }
  return report;
}
