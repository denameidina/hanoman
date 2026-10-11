// SPEC-171 · ADR-0213 · kontrak layar Review: `GET /specs/:id/review` dan `GET /specs/:id/review/*`.
// Dipakai server (services/spec-review), klien (api/client), dan tool MCP. Bentuk sesi project
// (`GET /terminal/sessions/:id/review`) sama, tetapi keadaan kosongnya tetap 409 (ADR-0213, Konsekuensi).
import { z } from "zod";

export const zChangedFile = z.object({
  path: z.string(),
  add: z.number().int(),
  del: z.number().int(),
  status: z.enum(["A", "M", "D"]),
  binary: z.boolean(),
});
export type ChangedFile = z.infer<typeof zChangedFile>;

/** ADR-0213 · alasan belum ada yang bisa ditinjau. `no-worktree`: item belum pernah dimulai (tanpa
 *  `baseSha`). `no-commit`: item sudah dimulai (`baseSha` tercatat), worktree-nya sudah lenyap, dan
 *  tak ada commit yang bisa ditinjau. */
export const zReviewEmptyReason = z.enum(["no-worktree", "no-commit"]);
export type ReviewEmptyReason = z.infer<typeof zReviewEmptyReason>;

export const zSpecReview = z.object({
  base: z.string(),
  files: z.array(z.string()),
  changed: z.array(zChangedFile),
  /** Hanya hadir (`true`) bila belum ada worktree maupun commit. `base`, `files`, dan `changed` kosong. */
  empty: z.literal(true).optional(),
  reason: zReviewEmptyReason.optional(),
});
export type SpecReview = z.infer<typeof zSpecReview>;

export const zReviewFile = z.object({
  path: z.string(),
  status: z.enum(["A", "M", "D"]).nullable(),
  binary: z.boolean(),
  truncated: z.boolean(),
  diff: z.string().nullable(),
  content: z.string().nullable(),
});
export type ReviewFile = z.infer<typeof zReviewFile>;
