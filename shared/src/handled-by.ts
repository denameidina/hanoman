import { z } from "zod";

// SPEC-880 · ADR-0135 · penanda "ditangani oleh": daftar hanoman client yang memegang sebuah
// project. Murni INFORMASIONAL — tak menggerbangi start sesi, worktree, auto-merge, scheduler,
// maupun lead.
//
// Tiap entri adalah SNAPSHOT device, bukan sekadar FK. `DeviceToken` tak ikut `SYNCED` (ia
// server-local di hub), jadi client penerima TAK punya baris device untuk di-join: tanpa `name`
// yang ikut tersimpan, chip di client tampil kosong tanpa satu pun error — kelas gagal-senyap
// ADR-0090/0093/0105.
//
// `revoked` sengaja TIDAK disimpan: ia turunan baris `DeviceToken` lokal dan berbeda per instance.
// Menyimpannya berarti membekukan fakta hub ke dalam record yang menyeberang.
export const zHandledByEntry = z.object({
  deviceId: z.string().min(1),
  name: z.string().min(1),
});
export type HandledByEntry = z.infer<typeof zHandledByEntry>;

// Batas atas supaya satu record project tak pernah mendekati plafon 1 MiB `MAX_SYNC_RECORD_BYTES`.
export const HANDLED_BY_MAX = 32;

export const zHandledBy = z.array(zHandledByEntry).max(HANDLED_BY_MAX)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    for (const e of list) {
      if (seen.has(e.deviceId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `deviceId duplikat: ${e.deviceId}` });
        return;
      }
      seen.add(e.deviceId);
    }
  });
export type HandledBy = z.infer<typeof zHandledBy>;

// Bentuk TAMPILAN (turunan, tak pernah disimpan): `revoked` dihitung `toProjectView` dari baris
// DeviceToken instance ini. Di client yang tak punya barisnya, ia selalu false.
export const zHandledByView = zHandledByEntry.extend({ revoked: z.boolean().default(false) });
export type HandledByView = z.infer<typeof zHandledByView>;

/** Kolom `Json` bisa berisi apa saja. Bentuk rusak → `[]` = "belum ditetapkan", bukan melempar:
 *  daftar project tak boleh mati karena satu baris cacat (preseden `autoMergeOf`, ADR-0103). */
export function handledByOf(raw: unknown): HandledByEntry[] {
  if (raw === null || raw === undefined) return [];
  const p = zHandledBy.safeParse(raw);
  return p.success ? p.data : [];
}
