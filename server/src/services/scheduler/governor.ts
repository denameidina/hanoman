import type { Scheduler } from "@hanoman/shared";
import type { SchedulerQueueItem } from "@prisma/client";
import { queued, markLaunched, markFailed, markDone, noteRow, isQueued } from "./queue";
import { blockedNote, type SpecBlocker } from "../spec-deps";

// SPEC-294 · ADR-0072 · governor concurrency. Deps di-inject agar teruji tanpa tmux/claude nyata;
// produksi mengikatnya ke pty + startSpecSession (engine.ts).
export type GovernorDeps = {
  liveCount: () => number;                                  // sesi hidup gabungan manual+scheduler (pty.listSessions)
  isLive: (specId: string) => string | null;               // sessionId hidup untuk spec, atau null
  isDone: (specId: string) => Promise<boolean>;            // SPEC-431 · spec sudah selesai → jangan pernah diluncurkan
  // SPEC-447 · ADR-0093 · dependency yang belum selesai/ter-merge. WAJIB (bukan opsional): satu-
  // satunya pembangun produksi adalah `prodDeps`, jadi tipe wajib = jaminan kompilasi bahwa
  // gerbangnya tak pernah lupa dipasang. Otomasi tak punya `force`.
  blockers: (specId: string) => Promise<SpecBlocker[]>;
  launch: (item: SchedulerQueueItem, autonomy?: string) => Promise<string>;   // spawn sesi → sessionId; throw = gagal. SPEC-298 · autonomy per mode (klausa prompt)
};

// SPEC-431 · alasan penutupan yang dibaca operator di panel scheduler (baris tanpa `launchedAt`).
export const ALREADY_DONE_NOTE = "spec sudah selesai — tak diluncurkan";

// SPEC-522 · baris dibatalkan tepat saat sesinya sudah terlanjur lahir (jendela = durasi satu
// spawn). Sesinya TIDAK dibunuh — kendala spec ini berlaku untuk sesi hidup mana pun, dan
// membunuh sesi dari dalam governor menambah permukaan yang tak dibutuhkan. Yang diberikan ke
// operator adalah id-nya, supaya ia bisa menutupnya sendiri dari Terminal.
export const canceledRaceNote = (sessionId: string) =>
  `dibatalkan saat sesi ${sessionId} sudah terlanjur lahir — sesi dibiarkan hidup, tutup dari Terminal bila tak diperlukan`;

// Reentrancy guard: satu drain jalan pada satu waktu (tick tak balapan dengan tick berikutnya).
let draining = false;

export async function drain(cfg: Scheduler, deps: GovernorDeps): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let slots = cfg.maxConcurrent - deps.liveCount();
    if (slots <= 0) return;
    for (const item of await queued()) {
      if (slots <= 0) break;
      // SPEC-522 · gerbang PERTAMA. `queued()` sudah menyaring `canceled`, tapi daftar itu
      // SNAPSHOT: drain memproses itemnya berurutan dan tiap `launch` men-spawn worktree + sesi
      // tmux (hitungan detik), jadi item di ekor daftar bisa duduk puluhan detik di sini sesudah
      // snapshotnya diambil. Dibaca ulang dari DB — pola `isDone` (SPEC-431) & `blockers`
      // (SPEC-447). Ditaruh PALING ATAS, bukan tepat sebelum `launch`, supaya ia melindungi semua
      // mutasi di badan loop: baris `canceled` tak boleh ditimpa jadi `done` oleh gerbang SPEC-431
      // maupun jadi `launched` oleh cabang idempoten `isLive` di bawah. Slot tak terpakai.
      if (!(await isQueued(item.id))) continue;
      // SPEC-431 · gerbang terakhir sebelum sebuah baris antrean jadi sesi tmux sungguhan. Checker
      // yang benar (`UNSTARTED_SPEC_WHERE`) tak cukup sendirian: baris `queued` yang telanjur ada
      // dari predikat lama tetap akan meluncur, dan sebuah item bisa saja diselesaikan operator
      // SELAGI ia mengantre. Ditutup `done` — bukan dihapus — supaya `enqueue` (upsert `update:{}`)
      // tak pernah menghidupkannya lagi. Sengaja BUKAN di `startSpecSession`: reopen manual item
      // `done` (SPEC-172) memang fitur; yang dilarang cuma otomasi memasukinya sendiri.
      if (await deps.isDone(item.specId)) { await markDone(item.id, ALREADY_DONE_NOTE); continue; }
      // SPEC-447 · ADR-0093 · item yang dependency-nya belum selesai & ter-merge DILEWATI —
      // barisnya tetap `queued` (pemblokirnya akan selesai, dan `enqueue` yang `upsert(update:{})`
      // tak bisa menghidupkan kembali baris yang sudah ditutup), slot TIDAK terpakai, dan drain
      // lanjut ke item berikutnya sehingga satu item terblokir tak menyumbat antrean.
      const blocked = await deps.blockers(item.specId);
      if (blocked.length) { await noteRow(item.id, blockedNote(blocked)); continue; }
      // Idempoten satu-sesi-per-spec: sesi spec sudah hidup (mis. di-Start manual) → tandai launched
      // tanpa makan slot (sudah terhitung di liveCount) & tanpa spawn kedua.
      const liveId = deps.isLive(item.specId);
      if (liveId) { await markLaunched(item.id, liveId); continue; }
      try {
        const sessionId = await deps.launch(item, cfg.autonomy);
        // SPEC-522 · gerbang KEDUA. Sisa jendelanya adalah durasi satu spawn; CAS gagal =
        // operator membatalkan selagi sesinya lahir, dan status `canceled` DIPERTAHANKAN alih-alih
        // ditimpa senyap. Sesinya nyata, jadi `slots--` tetap berlaku — cap concurrency tak boleh
        // dilanggar hanya karena barisnya dibatalkan.
        if (!(await markLaunched(item.id, sessionId))) await noteRow(item.id, canceledRaceNote(sessionId));
        slots--;
      } catch (e) {
        // Gagal (mis. project belum di-bind) → tandai, TANPA retry (PRD non-goal). Slot tak terpakai.
        await markFailed(item.id, (e as Error).message);
      }
    }
  } finally { draining = false; }
}
