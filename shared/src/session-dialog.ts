import { z } from "zod";

// SPEC-899 · ADR-0142 · bentuk dialog pilihan sebuah sesi, sebagaimana diserahkan server ke
// dashboard. Ini CERMIN `DialogScreen` milik server/src/services/tui-dialog.ts, bukan tipe itu
// sendiri: modul tersebut tahu soal tmux dan teks pane, dan frontend tak boleh mengimpornya.
export type SessionDialogOption = {
  n: number;
  label: string;
  /** Keadaan kotak centang; `null` untuk dialog yang memang tak punya kotak (single-select). */
  checked: boolean | null;
};

export type SessionDialog = {
  /** Judul pertanyaan; "" bila layarnya tak punya (dialog tanpa tab strip: trust, prompt izin). */
  title: string;
  /** Widget `multiSelect`: opsinya berkotak dan dikirim lewat tombol Submit tanpa nomor. */
  multi: boolean;
  /** Nomor baris kolom jawaban bebas, atau `null` bila dialog ini tak punya. */
  freeIndex: number | null;
  /** Varian ber-`preview`: tak ada baris kolom bebas; jalan masuk prosa lewat kolom catatan. */
  notes: boolean;
  /** Baris yang boleh dipilih — tanpa baris kolom bebas dan tanpa "Chat about this". */
  options: SessionDialogOption[];
  /** Strip pertanyaan dialog berantai (SPEC-474); `[]` untuk dialog satu pertanyaan. */
  tabs: { header: string; answered: boolean }[];
};

export type SessionDialogPayload = { dialog: SessionDialog; screenHash: string };

// `choice`/`choices` selalu NOMOR BARIS yang dipancarkan GET (`SessionDialogOption.n`), bukan
// indeks array: nomor itulah yang ditekan di pane, dan menerjemahkannya dua kali adalah cara
// paling mudah memilih opsi yang salah.
export const zSessionDialogAnswer = z.object({
  screenHash: z.string().min(1),
  choice: z.number().int().positive().optional(),
  choices: z.array(z.number().int().positive()).max(32).optional(),
  text: z.string().trim().min(1).max(16_000).optional(),
})
  .refine((v) => !(v.choice !== undefined && v.choices !== undefined),
    { message: "choice dan choices tak boleh dikirim bersamaan" })
  .refine((v) => v.choice !== undefined || v.choices !== undefined || v.text !== undefined,
    { message: "jawaban kosong" });

export type SessionDialogAnswer = z.infer<typeof zSessionDialogAnswer>;
