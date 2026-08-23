import { z } from "zod";
import type { Agent } from "./entities";

// SPEC-909 · ADR-0146 · bentuk PERTANYAAN sebuah sesi sebagaimana dikirim hook agennya sendiri.
//
// Ini bukan cermin layar (bandingkan `session-dialog.ts`, yang memang membaca pane): ia payload
// tool `AskUserQuestion` apa adanya. Pembacanya dua — pintu deteksi lead dan panel pet — dan
// keduanya membaca bentuk YANG SAMA, supaya "apa yang ditanyakan" tak pernah punya dua definisi.

export const ASK_QUESTION_MAX = 2_000;
export const ASK_MESSAGE_MAX = 4_000;

export type SessionAskOption = { label: string; description?: string };
export type SessionAskQuestion = {
  header: string;
  question: string;
  multiSelect: boolean;
  options: SessionAskOption[];
};

/** Peristiwa hook yang sudah dinormalkan; `null` dari `parseHookEvent` = bukan pertanyaan. */
export type HookEvent = {
  source: "ask-tool" | "turn-end";
  /** Kunci idempotensi milik AGEN: `tool_use_id` (claude) / `turn_id` (codex). */
  askId: string;
  questions: SessionAskQuestion[];
  /** Teks giliran terakhir codex; "" untuk claude, yang pertanyaannya terstruktur. */
  message: string;
};

/** Keadaan satu tanya hidup — dipakai pintu deteksi DAN frame siar `leadAsks`. */
export type SessionAsk = {
  sessionId: string;
  agent: Agent;
  source: HookEvent["source"];
  askId: string;
  askedAt: string;
  questions: SessionAskQuestion[];
  message: string;
  /** Langkah yang sedang dikerjakan (0-based) dari `total`. */
  at: number;
  total: number;
  state: "queued" | "deciding" | "answered" | "taken-over" | "failed";
  flowId: string | null;
  step: number | null;
};

// POTONG DULU, baru rapikan. `s.replace(/\s+$/g, "").slice(0, max)` menjalankan regex atas string
// PENUH, dan `/\s+$/` pada deretan whitespace yang tak berakhir di ujung adalah backtracking
// KUADRATIK — terukur 556 ms untuk body 30 kB dan 2 195 ms untuk 60 kB (rasio 3,95× per
// penggandaan), yang berarti ±11 menit pada batas body 1 MiB. Sinkron, tanpa satu pun `await`, jadi
// seluruh event loop beku: WS terminal mati, siar dashboard mati, `/api/health` mati. Dan ia duduk
// SEBELUM ember token (`lead/ask.ts`), jadi batas laju tak melindungi apa pun di sini.
// `trimEnd()` linear, dan `slice` lebih dulu membuat inputnya berbatas.
const clip = (s: unknown, max: number): string =>
  typeof s === "string" ? s.slice(0, max).trimEnd() : "";

/**
 * Batas JUMLAH dinyatakan di parser, bukan disimpulkan dari `bodyLimit` Fastify.
 *
 * Tanpa ini satu payload sah (863 kB, 46 000 opsi) terukur melahirkan: prompt agen **627 kB** yang
 * diserahkan ke `claude -p` sebagai SATU elemen argv (`MAX_ARG_STRLEN` Linux 128 kB → `E2BIG`),
 * frame siar `leadAsks` **863 kB** yang di-`JSON.stringify` ulang TIAP DETIK untuk dedup lalu
 * dikirim ke setiap dashboard, dan kolom `LeadDecision.options` **403 kB** per baris jejak.
 * `MAX_CHAIN_STEPS` di hilir hanya menghitung `questions`; `options` tak pernah dihitung siapa pun.
 *
 * Angkanya dari kontrak tool `AskUserQuestion` sendiri: maksimum 4 pertanyaan. Plafon di sini
 * sedikit longgar supaya rilis agen yang menaikkannya tak langsung jatuh — yang dijaga adalah
 * BESARAN, bukan angka persisnya.
 */
export const ASK_MAX_QUESTIONS = 8;
export const ASK_MAX_OPTIONS = 32;

// Yang dibatasi JUMLAH, bukan panjang: teks yang kepanjangan DIPOTONG `clip()` (linear sejak
// perbaikan ReDoS di atas), sementara menolaknya berarti pertanyaan sah yang kebetulan panjang
// hilang diam-diam — sesi menggantung tanpa satu pun jejak. Jumlah tak bisa diperlakukan begitu:
// ia yang mengalikan biaya di prompt, frame siar, dan kolom jejak sekaligus.
const zOption = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const zQuestion = z.object({
  question: z.string().min(1),
  header: z.string().default(""),
  multiSelect: z.boolean().default(false),
  options: z.array(zOption).max(ASK_MAX_OPTIONS).default([]),
});

// Payload hook adalah kontrak AGEN, bukan kontrak kita: skema di bawah hanya memvalidasi field yang
// benar-benar dipakai. Field baru dari rilis agen berikutnya tak boleh menjatuhkan jalur ini —
// yang menjatuhkannya hanya field yang HILANG.
const zAskTool = z.object({
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.literal("AskUserQuestion"),
  tool_use_id: z.string().min(1),
  tool_input: z.object({ questions: z.array(zQuestion).min(1).max(ASK_MAX_QUESTIONS) }),
});

const zTurnEnd = z.object({
  hook_event_name: z.literal("Stop"),
  turn_id: z.string().min(1),
  last_assistant_message: z.string().optional(),
  // Codex menyalakan bendera ini saat Stop dipicu oleh hook Stop lain. Melayani giliran yang
  // dibangkitkan gate mode goal (ADR-0074) berarti lead menjawab dirinya sendiri.
  stop_hook_active: z.boolean().optional(),
});

export function parseHookEvent(body: unknown): HookEvent | null {
  const ask = zAskTool.safeParse(body);
  if (ask.success) {
    return {
      source: "ask-tool",
      askId: ask.data.tool_use_id,
      questions: ask.data.tool_input.questions.map((q) => ({
        header: clip(q.header, 200),
        question: clip(q.question, ASK_QUESTION_MAX),
        multiSelect: q.multiSelect,
        options: q.options.map((o) => ({
          label: clip(o.label, 200),
          ...(o.description ? { description: clip(o.description, 400) } : {}),
        })),
      })),
      message: "",
    };
  }
  const turn = zTurnEnd.safeParse(body);
  if (turn.success && !turn.data.stop_hook_active) {
    return {
      source: "turn-end",
      askId: turn.data.turn_id,
      questions: [],
      message: clip(turn.data.last_assistant_message, ASK_MESSAGE_MAX),
    };
  }
  return null;
}
