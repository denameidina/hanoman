import { z } from "zod";

// SPEC-516 · ADR-0105 · kontrak changelog yang dipakai bersama server & web.

export const CHANGELOG_MODES = ["backlog", "commit", "version"] as const;
export const zChangelogMode = z.enum(CHANGELOG_MODES);
export type ChangelogMode = z.infer<typeof zChangelogMode>;

// Tanggal kalender, bukan timestamp: operator memilih hari di kalendernya sendiri dan batasnya
// diresolve ke awal/akhir hari LOKAL di server (services/date-range.ts, ADR-0090).
const zDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "format tanggal harus YYYY-MM-DD");

export const zChangelogRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("backlog"), from: zDay.optional(), to: zDay.optional() }),
  z.object({ mode: z.literal("commit"), fromSha: z.string().trim().min(4), toSha: z.string().trim().min(4) }),
  z.object({ mode: z.literal("version"), fromTag: z.string().trim().min(1).optional(), toTag: z.string().trim().min(1) }),
]).superRefine((v, ctx) => {
  // Perbandingan string sah untuk YYYY-MM-DD (leksikografis == kronologis) dan tak menyeret
  // satu pun konversi zona waktu ke dalam validasi.
  if (v.mode === "backlog" && v.from && v.to && v.from > v.to)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["from"],
      message: "rentang tanggal terbalik — `from` harus lebih awal atau sama dengan `to`" });
});
export type ChangelogRequest = z.infer<typeof zChangelogRequest>;

export const zChangelogView = z.object({
  id: z.string(),
  projectId: z.string(),
  mode: zChangelogMode,
  title: z.string(),
  params: z.unknown(),
  body: z.string(),
  generator: z.enum(["agent", "fallback"]),
  warning: z.string().nullable(),
  itemCount: z.number().int(),
  createdAt: z.string(),
});
export type ChangelogView = z.infer<typeof zChangelogView>;

/** Bahan yang dibutuhkan form sebelum operator menekan Bangkitkan. `reason` terisi untuk keadaan
 *  SAH yang bukan galat: repo belum ditautkan, repo tanpa tag. */
export type ChangelogSources = {
  hasRepo: boolean;
  tags: string[];
  head: string | null;
  reason: string | null;
  backlog: { doneCount: number; earliest: string | null; latest: string | null };
  defaultRange: { from: string; to: string };
};

export const DEFAULT_RANGE_DAYS = 30;

/** `YYYY-MM-DD` dari komponen LOKAL. `toISOString()` memberi hari UTC dan di WIB itu bisa
 *  meleset satu hari penuh di ujung rentang (pelajaran ADR-0090). */
export function dayString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rentang wajar saat operator tak mengisi apa pun: 30 hari terakhir, inklusif di kedua ujung. */
export function defaultRange(today: Date): { from: string; to: string } {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DEFAULT_RANGE_DAYS - 1));
  return { from: dayString(from), to: dayString(today) };
}

/** SPEC-519 · predikat cari daftar rilis. Case-insensitive atas judul, isi, dan mode.
 *  `q` kosong / spasi doang → semua lolos: kotak cari yang belum diketik tak boleh mengosongkan
 *  daftar. Dipakai `GET /projects/:id/changelog?q=` — saring dulu, baru `paginate`, supaya
 *  `total` menghitung hasil cari (ADR-0038). */
export function changelogMatches(row: { title: string; body: string; mode: string }, q: string): boolean {
  const needle = (q ?? "").trim().toLowerCase();
  if (!needle) return true;
  return row.title.toLowerCase().includes(needle)
    || row.body.toLowerCase().includes(needle)
    || row.mode.toLowerCase().includes(needle);
}
