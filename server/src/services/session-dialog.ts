import { createHash } from "node:crypto";
import type { SessionDialogAnswer, SessionDialogPayload } from "@hanoman/shared";
import {
  answerChoiceDialog, answerMultiSelectDialog, answerNotesDialog, dialogKey, readDialogScreen,
  type DialogScreen, type PaneIO,
} from "./tui-dialog";
import { paneIO } from "./pty";

// SPEC-899 · ADR-0142 · membungkus tui-dialog.ts untuk MANUSIA di dashboard. Tak satu pun primitif
// di sana ditulis ulang: modul ini hanya memetakan layar → DTO, menjaga kesegarannya, lalu
// mendispatch ke jalur yang sama persis yang dipakai `sendToPane`.

/** Jeda antar potongan keystroke — nilai yang sama dengan default `sendToPane`. */
export const DIALOG_CHUNK_MS = 50;

/**
 * Identitas layar yang dijawab. Bersumber pada `dialogKey`, BUKAN pada teks pane mentah: teks pane
 * memuat kursor berkedip & spinner, jadi hash atasnya berbeda antar dua `capture-pane` berturut-
 * turut dan setiap jawaban akan ditolak. `dialogKey` sudah memikul dua pelajaran yang persis
 * dibutuhkan di sini — label kolom bebas tak ikut (SPEC-474) dan `☐/☒` tab strip layar multi
 * dibuang (gotcha ADR-0102 #1) — sehingga hash hanya berubah saat dialognya benar-benar berganti
 * atau terjawab. Di-hash supaya klien memperlakukannya sebagai token buram.
 */
export const screenHashOf = (paneText: string): string =>
  createHash("sha256").update(dialogKey(paneText)).digest("hex").slice(0, 16);

type Question = Extract<DialogScreen, { kind: "question" }>;

/**
 * Layar yang boleh dijawab dari dashboard. `null` untuk: bukan dialog, layar rekap rantai, dan
 * dialog TANPA kolom bebas maupun kolom catatan.
 *
 * Yang terakhir itu dialog trust & prompt izin. `sendToPane` sengaja tak menyentuhnya ("`Enter`
 * memilih baris 1 yang memang berarti 'ya'"), dan memasang tombol dashboard yang menjawabnya
 * adalah kebalikan penuh dari batas ADR-0037: kepercayaan penuh pada agen ditebus dengan isolasi
 * worktree, bukan dengan prompt izin yang bisa diklik dari jauh.
 */
const answerable = (paneText: string): Question | null => {
  const s = readDialogScreen(paneText);
  if (s?.kind !== "question") return null;
  if (!(s.multi && s.submit.present) && s.freeIndex === null && !s.notes) return null;
  return s;
};

export function readSessionDialog(io: PaneIO): SessionDialogPayload | null {
  const text = io.capture();
  const s = answerable(text);
  if (!s) return null;
  return {
    dialog: {
      title: s.title, multi: s.multi, freeIndex: s.freeIndex, notes: s.notes,
      options: s.rows.filter((r) => !r.free && !r.chat)
        .map((r) => ({ n: r.n, label: r.label, checked: r.checked })),
      tabs: s.tabs,
    },
    screenHash: screenHashOf(text),
  };
}

export type AnswerResult = { ok: true } | { ok: false; reason: "stale" | "shape" | "not-landed" };

/**
 * Dispatch-nya CERMIN `sendToPane`, tanpa cabang tambahan: multiSelect mencentang lalu menekan
 * Submit, dialog ber-kolom-bebas diketik lewat kolom itu, varian ber-`preview` lewat kolom catatan.
 *
 * Jawaban single-select dikirim sebagai TEKS berisi label opsi, bukan dengan menekan digitnya:
 * `answerChoiceDialog` membuktikan teksnya mendarat sebelum menekan `Enter`, sedangkan digit tak
 * punya titik pembatalan sama sekali — begitu byte-nya keluar, sesi sudah bergerak (spec §4.5).
 */
export async function answerSessionDialog(
  io: PaneIO, input: SessionDialogAnswer, chunkMs = DIALOG_CHUNK_MS,
): Promise<AnswerResult> {
  const text = io.capture();
  const s = answerable(text);
  if (!s) return { ok: false, reason: "stale" };
  if (screenHashOf(text) !== input.screenHash) return { ok: false, reason: "stale" };

  const optionLabel = (n: number): string | null =>
    s.rows.find((r) => r.n === n && !r.free && !r.chat)?.label ?? null;

  if (s.multi && s.submit.present) {
    if (input.choice !== undefined) return { ok: false, reason: "shape" };
    const pick = input.choices ?? [];
    if (pick.some((n) => optionLabel(n) === null)) return { ok: false, reason: "shape" };
    if (input.text && s.freeIndex === null) return { ok: false, reason: "shape" };
    const ok = await answerMultiSelectDialog(
      io, { pick, line: input.text ?? "", freeIndex: s.freeIndex }, chunkMs);
    return ok ? { ok: true } : { ok: false, reason: "not-landed" };
  }

  if (input.choices !== undefined) return { ok: false, reason: "shape" };
  const line = input.text ?? (input.choice !== undefined ? optionLabel(input.choice) : null);
  if (!line) return { ok: false, reason: "shape" };
  const ok = s.freeIndex !== null
    ? await answerChoiceDialog(io, s.freeIndex, line, chunkMs)
    : await answerNotesDialog(io, line, chunkMs);
  return ok ? { ok: true } : { ok: false, reason: "not-landed" };
}

// Satu jawaban pada satu waktu per sesi. Dua POST berbarengan menyilangkan keystroke di satu pane
// jadi sampah yang tak bisa ditarik kembali. In-memory dan sengaja begitu, cermin
// lead/deciding.ts: keadaan ini berumur satu panggilan dan tak boleh selamat dari restart.
const answering = new Set<string>();

export function beginAnswer(sessionId: string): boolean {
  if (answering.has(sessionId)) return false;
  answering.add(sessionId);
  return true;
}
export function endAnswer(sessionId: string): void { answering.delete(sessionId); }

// Seam pane: route memakai primitif tmux sungguhan, test menyuntikkan `PaneIO` palsu.
let paneIOFactory: (id: string) => PaneIO = paneIO;
export const sessionPaneIO = (id: string): PaneIO => paneIOFactory(id);

export function __setPaneIO(fn: (id: string) => PaneIO): void { paneIOFactory = fn; }
export function __resetPaneIO(): void { paneIOFactory = paneIO; }
export function __resetAnswering(): void { answering.clear(); }
