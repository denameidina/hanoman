import type { Agent, HookEvent, SessionAsk } from "@hanoman/shared";
import { getLead } from "./config";
import { admitAsk, answerAsk, resetSession, type AdmitResult, type AskCtx } from "./detect";
import {
  markDeciding, clearDeciding, markQueued, clearQueued,
  markTakenOver, isTakenOver, clearTakeover,
} from "./deciding";
import { beginAnswer, endAnswer } from "../session-dialog";
import { listSessions } from "../pty";

// SPEC-909 · ADR-0146 · SATU-SATUNYA pemilik keadaan event pintu deteksi.
//
// In-memory dan sengaja begitu, dengan alasan yang sama seperti `lead/deciding.ts`: keadaan ini
// berumur satu episode dan tak boleh selamat dari restart server — pertanyaan yang tercatat di sini
// sesudah proses lead mati akan berbohong selamanya. Single-process (ADR-0024), jadi Map/Set biasa
// sudah cukup dan tak ada queue/worker/cron baru.

/** Ember token per sesi: 5 sekaligus, isi ulang 1 per 10 dtk (≤ 6/menit langgeng). */
export const ASK_BUCKET = { capacity: 5, refillMs: 10_000 };
/** Ember global: pagar terakhir bila banyak sesi meledak bersamaan. */
export const GLOBAL_BUCKET = { capacity: 20, refillMs: 500 };
/** Berapa `askId` terakhir diingat untuk idempotensi. */
const SEEN_MAX = 512;

type Entry = {
  ask: SessionAsk;
  ctx: AskCtx;
  /** Event yang tiba selagi sesi ini dikerjakan — yang TERBARU menang. */
  pending: { ask: SessionAsk; ctx: AskCtx } | null;
  running: boolean;
};

const entries = new Map<string, Entry>();
const seen: string[] = [];
const seenSet = new Set<string>();

type Bucket = { tokens: number; at: number };
const perSession = new Map<string, Bucket>();
let global: Bucket = { tokens: GLOBAL_BUCKET.capacity, at: 0 };

function take(b: Bucket, spec: { capacity: number; refillMs: number }, now: number): boolean {
  if (b.at === 0) b.at = now;
  const gained = Math.floor((now - b.at) / spec.refillMs);
  if (gained > 0) { b.tokens = Math.min(spec.capacity, b.tokens + gained); b.at += gained * spec.refillMs; }
  if (b.tokens <= 0) return false;
  b.tokens--;
  return true;
}

export type IntakeResult =
  | { status: "accepted" } | { status: "duplicate" }
  | { status: "rate-limited" } | { status: "rejected"; reason: string };

export type AskDeps = {
  admit: (s: { id: string; specId?: string; projectId: string }) => Promise<AdmitResult>;
  answer: (ask: SessionAsk, ctx: AskCtx) => Promise<{
    answered: boolean; reason: string; at: number; flowId: string | null; step: number | null;
  }>;
  reset: (sessionId: string) => void;
  live: () => string[];
  maxConcurrent: () => Promise<number>;
  now: () => number;
};

export const prodAskDeps: AskDeps = {
  admit: (s) => admitAsk(s),
  answer: (ask, ctx) => answerAsk(ask, ctx),
  reset: resetSession,
  // SPEC-402 · bacaan tmux yang gagal tak boleh berarti "semua sesi berakhir": daftar kosong akan
  // memangkas penghitung sesi yang sebenarnya hidup, dan pagar AC-11 lahir kembali dari nol.
  live: () => {
    try { return listSessions().filter((s) => !s.exited).map((s) => s.id); }
    catch { return [...entries.keys()]; }
  },
  maxConcurrent: async () => (await getLead()).maxConcurrent,
  now: Date.now,
};

export function __resetAsks(): void {
  entries.clear(); seen.length = 0; seenSet.clear();
  perSession.clear(); global = { tokens: GLOBAL_BUCKET.capacity, at: 0 };
  inFlight = 0; waiting.length = 0;
}

/** Daftar tanya hidup — sumber frame siar `leadAsks` (ADR-0039, tanpa kanal baru). */
export function liveAsks(): SessionAsk[] {
  return [...entries.values()].map((e) => ({
    ...e.ask,
    // Dibaca dari sumber yang SUDAH ada; menyalin bendera takeover ke `e.ask` saja akan melahirkan
    // definisi kedua yang bisa berselisih dengan gerbang route jawab-dialog.
    state: isTakenOver(e.ask.sessionId) ? "taken-over" : e.ask.state,
  }));
}

/**
 * AC-6 · operator merebut sesi dari lead.
 *
 * Pemenangnya ditentukan `beginAnswer()` — `Set` sinkron yang SAMA yang sudah mencegah dua POST
 * manusia menyilangkan keystroke (ADR-0142 §5), dan yang sejak SPEC-909 juga dilewati jalur lead.
 * Begitu lead memegangnya, takeover kalah dengan penolakan yang jelas; sebelum itu, lead yang kalah
 * dan batal sebelum satu byte pun keluar.
 */
export function takeOverAsk(sessionId: string): "taken" | "answering" | "none" {
  const e = entries.get(sessionId);
  if (!e) return "none";
  if (!beginAnswer(sessionId)) return "answering";
  endAnswer(sessionId);
  markTakenOver(sessionId);
  e.ask = { ...e.ask, state: "taken-over" };
  return "taken";
}

const toAsk = (o: { sessionId: string; agent: Agent; event: HookEvent; now: number }): SessionAsk => ({
  sessionId: o.sessionId, agent: o.agent, source: o.event.source, askId: o.event.askId,
  askedAt: new Date(o.now).toISOString(),
  questions: o.event.questions, message: o.event.message,
  at: 0, total: Math.max(1, o.event.questions.length),
  state: "queued", flowId: null, step: null,
});

export async function intakeAsk(
  input: {
    sessionId: string; agent: Agent; projectId: string; specId?: string; decisionFile?: string;
    event: HookEvent;
  },
  deps: AskDeps = prodAskDeps,
): Promise<IntakeResult> {
  const now = deps.now();
  // Kunci idempotensi datang dari AGENNYA sendiri (`tool_use_id` / `turn_id`), bukan dari hash
  // payload: hook bisa menembak ulang untuk panggilan yang sama, dan dua panggilan berbeda bisa
  // punya isi yang identik.
  const key = `${input.sessionId}:${input.event.askId}`;
  if (seenSet.has(key)) return { status: "duplicate" };

  const bucket = perSession.get(input.sessionId) ?? { tokens: ASK_BUCKET.capacity, at: now };
  perSession.set(input.sessionId, bucket);
  // Batas laju SEBELUM pagar: ditolak karena ramai tak boleh menulis baris jejak maupun
  // menotifikasi — ia hilang dengan menunggu, persis seperti `LeadBusyError` (SPEC-479).
  if (!take(bucket, ASK_BUCKET, now) || !take(global, GLOBAL_BUCKET, now))
    return { status: "rate-limited" };

  const verdict = await deps.admit({
    id: input.sessionId, specId: input.specId, projectId: input.projectId,
  });
  if (!verdict.ok) return { status: "rejected", reason: verdict.reason };

  seenSet.add(key); seen.push(key);
  while (seen.length > SEEN_MAX) { const old = seen.shift()!; seenSet.delete(old); }
  // Pertanyaan BARU membatalkan takeover pertanyaan sebelumnya: operator merebut satu episode,
  // bukan sesi itu selamanya.
  clearTakeover(input.sessionId);

  const ctx: AskCtx = {
    projectId: input.projectId, specId: input.specId, decisionFile: input.decisionFile,
  };
  const ask = toAsk({ sessionId: input.sessionId, agent: input.agent, event: input.event, now });
  const cur = entries.get(input.sessionId);
  // Satu sesi = satu pekerjaan. Event yang tiba selagi sesi ini dikerjakan menimpa "yang tertunda"
  // dan dijalankan sesudahnya — itulah yang membuat "event kembar tak melahirkan dua keputusan
  // paralel" benar secara KONSTRUKSI, bukan lewat penjagaan yang harus diingat.
  if (cur?.running) { cur.pending = { ask, ctx }; return { status: "accepted" }; }
  entries.set(input.sessionId, { ask, ctx, pending: null, running: false });

  prune(deps);
  void run(input.sessionId, deps);
  return { status: "accepted" };
}

/**
 * Buang penghitung sesi yang sudah tak hidup — pengganti `sweep()` yang dulu ikut pemindaian.
 *
 * Dipanggil dari dua tempat, dan keduanya perlu. Intake saja tak cukup: id sesi spec deterministik
 * dan bisa LAHIR LAGI, jadi sesi yang mati lalu dilahirkan ulang tanpa satu pun event di antaranya
 * akan mewarisi penghitung `answers`/`failures` milik nyawa sebelumnya — dan pagar AC-11 menutupnya
 * sebelum ia sempat bertanya sekali pun. Tick rumah tangga lead (engine.ts) memanggilnya sekali per
 * menit justru untuk menutup celah itu; dulu `sweep()` tiap 5 detik yang melakukannya.
 */
export function pruneAsks(deps: AskDeps = prodAskDeps): void { prune(deps); }

function prune(deps: AskDeps): void {
  const live = new Set(deps.live());
  for (const id of [...entries.keys()]) {
    if (live.has(id)) continue;
    entries.delete(id); perSession.delete(id); clearTakeover(id);
    deps.reset(id);
  }
}

// Kolam pekerja: batas yang SAMA dengan `runPool(ready, cfg.maxConcurrent)` yang digantikannya —
// yang berubah cuma umur antreannya, bukan angkanya. Satu rantai dialog mem-poll pane sampai 20×
// per langkah dan `tmux()` memblokir event loop 6,28 ms per panggilan; fan-out tanpa batas menukar
// kelaparan dengan server yang tersendat.
let inFlight = 0;
const waiting: string[] = [];

async function run(sessionId: string, deps: AskDeps): Promise<void> {
  const e = entries.get(sessionId);
  if (!e || e.running) return;
  const cap = Math.max(1, await deps.maxConcurrent().catch(() => 1));
  if (inFlight >= cap) { if (!waiting.includes(sessionId)) waiting.push(sessionId); return; }
  e.running = true;
  inFlight++;
  markQueued(sessionId);
  try {
    for (;;) {
      if (isTakenOver(sessionId)) { e.ask = { ...e.ask, state: "taken-over" }; break; }
      clearQueued(sessionId); markDeciding(sessionId);
      e.ask = { ...e.ask, state: "deciding" };
      // AC-3 · latensi jalur event, satu baris per keputusan. Ini satu-satunya angka yang
      // membedakan "event sudah jalan" dari "event terpasang tapi diam", dan ia gratis.
      console.log(`lead ask ${sessionId}: ${deps.now() - Date.parse(e.ask.askedAt)} ms sampai mulai menyusun`);
      const r = await deps.answer(e.ask, e.ctx).catch((err) => {
        console.error("lead ask:", err);
        return { answered: false, reason: "kesalahan tak terduga", at: 0, flowId: null, step: null };
      });
      clearDeciding(sessionId);
      if (!r.answered) console.log(`lead ask ${sessionId}: tak terjawab — ${r.reason}`);
      e.ask = {
        ...e.ask, at: r.at, flowId: r.flowId, step: r.step,
        state: r.answered ? "answered" : "failed",
      };
      if (!e.pending) break;
      const next = e.pending; e.pending = null;
      e.ask = next.ask; e.ctx = next.ctx;
    }
  } finally {
    clearQueued(sessionId); clearDeciding(sessionId);
    e.running = false;
    inFlight--;
    const nextId = waiting.shift();
    if (nextId) void run(nextId, deps);
  }
}
