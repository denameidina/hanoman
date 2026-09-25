// ADR-0169 · auto-resume sesi backlog yang tadinya berjalan lalu terputus paksa (reboot OS,
// tmux/proses crash, tmux dibunuh manual). Dipanggil SEKALI saat boot, sesudah reconcileHistory()
// menutup baris yang panenya lenyap. Jalur peluncurannya PERSIS startSpecSession (ADR-0084,
// keadaan `resume`) — tak ada mekanisme baru, hanya pemicunya yang jadi otomatis.
import type { Spec } from "@prisma/client";
import { flowForSource } from "@hanoman/shared";
import { prisma } from "../db";
import { reconciledRuntimesSince, reconciledSpecIdsSince, type SessionRuntime } from "./session-history";
import { startSpecSession, type StartSpecResult } from "./session-launch";
import { LaunchAdmissionError } from "./session-admission";
import { recordFailure } from "./notifications";

export type ResumeDeps = {
  // S4c · `runtime` = agen/model/effort sesi asal (SessionHistory); absen → default Setting global.
  startSpec: (spec: Spec, runtime?: SessionRuntime) => Promise<StartSpecResult>;
  recordFail: (specId: string, title: string, projectId: string | null, reason: string) => Promise<void>;
  // ADR-0170 · amandemen ADR-0169 keputusan #4: kandidat yang ditolak gerbang kapasitas/beban
  // host dicatat TERPISAH dari kegagalan sungguhan (worktree rusak dst) — operator melanjutkannya
  // manual lewat tombol "Lanjutkan" yang sudah ada (ADR-0084), bukan retry otomatis.
  recordDeferred: (specId: string, title: string, projectId: string | null, reason: string) => Promise<void>;
};

const prodDeps: ResumeDeps = {
  // ADR-0170 · mengamandemen ADR-0169 keputusan #4: `bypassCapacity` DICABUT. Auto-resume kini
  // tunduk cap/beban host seperti "Lanjutkan" manual — mesin 8 GB operator sudah dua kali kernel
  // panic akibat batch sesi paralel tepat SAAT boot (memori mac-mini-8gb-panic-agen-paralel),
  // titik waktu paling rawan menumpuk kandidat resume. Gerbang dependency ADR-0093 tak berubah.
  startSpec: (spec, runtime) => startSpecSession(spec, { flow: flowForSource(spec.source), ...(runtime ?? {}) }),
  recordFail: recordFailure,
  recordDeferred: recordFailure,
};

export type ResumeReport = { resumed: string[]; failed: string[]; deferred: string[] };

export async function resumeReconciledSessions(cutoff: Date, deps: ResumeDeps = prodDeps): Promise<ResumeReport> {
  const report: ResumeReport = { resumed: [], failed: [], deferred: [] };
  const specIds = await reconciledSpecIdsSince(cutoff);
  if (!specIds.length) return report;
  // stage "done" · item sudah selesai sebelum reboot, tak perlu dilanjutkan meski baris
  // riwayatnya kena reconcile (mis. sesi ditutup tepat saat mesin mati).
  const specs = await prisma.spec.findMany({ where: { id: { in: specIds }, stage: { not: "done" } } });
  const runtimes = await reconciledRuntimesSince(cutoff);
  // Berurutan — bukan Promise.all: operasi worktree/git antar item tak boleh saling tabrak
  // (rebuild worktree dari headSha, dsb), dan setiap item yang berhasil lahir mengisi cap yang
  // dibaca item berikutnya — urutan itulah yang membuat resume "bertahap" tanpa antrean baru.
  for (const spec of specs) {
    try {
      await deps.startSpec(spec, runtimes.get(spec.id));
      report.resumed.push(spec.id);
    } catch (e) {
      if (e instanceof LaunchAdmissionError) {
        await deps.recordDeferred(spec.id, spec.title, spec.projectId,
          `ditunda — cap/beban host penuh saat boot (${e.kind}). Lanjutkan manual saat slot kosong.`);
        report.deferred.push(spec.id);
        continue;
      }
      const reason = e instanceof Error ? e.message : String(e);
      await deps.recordFail(spec.id, spec.title, spec.projectId, `gagal dilanjutkan otomatis — ${reason}`);
      report.failed.push(spec.id);
    }
  }
  return report;
}
