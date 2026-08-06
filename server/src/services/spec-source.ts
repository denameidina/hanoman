import { flowForSource, convertPayload, payloadMatchesSource, type SourceChange } from "@hanoman/shared";

// SPEC-546 · ADR-0109 · gerbang & perakit jejak untuk konversi type backlog item.
// SELURUH isi berkas ini MURNI (tanpa DB, tanpa git, tanpa jam sistem — `at` diserahkan
// pemanggil): keputusan "boleh atau tidak" adalah bagian yang paling mudah salah dan paling
// pantas diuji tanpa harness.

export type SourceGate =
  | { ok: true; payload: Record<string, unknown>; dropped: string[] }
  | { ok: false; code: number; error: string };

type SpecLike = { source: string; stage: string; baseSha: string | null; payload: unknown };

/**
 * Boleh tidak item ini pindah ke `to`, dan payload apa yang berlaku sesudahnya.
 *
 * Gerbangnya mengunci **flow, bukan label**. Yang dilindungi SPEC-186 adalah pekerjaan yang
 * sedang berjalan: sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke berkas fase,
 * jadi memindahkan item ber-flow `feature` (lima fase) ke `goal` (dua fase) meninggalkan berkas
 * fase yang TAK AKAN PERNAH memuaskan `phasesComplete` flow barunya — bentuk yang sama dengan
 * kelas bug SPEC-433, di mana sebuah keadaan secara struktural tak bisa tercapai. Sebaliknya
 * `brief → help` tak mengubah apa pun yang dipegang sesi — flow sama, bentuk payload sama,
 * prompt sama — jadi menguncinya berarti menolak justru kasus yang paling sering terjadi hanya
 * karena sesinya kebetulan sudah pernah jalan.
 */
export function checkSourceChange(spec: SpecLike, to: string, payload?: unknown): SourceGate {
  const started = spec.stage !== "brainstorming" || spec.baseSha !== null;
  if (started) {
    if (flowForSource(spec.source) !== flowForSource(to))
      return { ok: false, code: 409,
        error: "backlog item sudah dimulai — type hanya bisa pindah ke source dengan flow yang sama" };
    // Konversi se-flow selalu se-bentuk, jadi tak ada field yang perlu diisi operator; dan
    // membuka payload di sini berarti membatalkan gerbang SPEC-186 lewat pintu belakang.
    if (payload !== undefined)
      return { ok: false, code: 409, error: "backlog item sudah dimulai — isinya tak bisa diubah" };
    return { ok: true, payload: (spec.payload ?? {}) as Record<string, unknown>, dropped: [] };
  }
  if (payload !== undefined) {
    // Bentuknya sudah dijamin `zChangeSpecSource` di batas HTTP; diperiksa lagi di sini supaya
    // pemanggil non-HTTP tak bisa menyelundupkan bentuk salah lewat service.
    if (!payloadMatchesSource(to, payload))
      return { ok: false, code: 400, error: "bentuk payload tak cocok dengan source" };
    return { ok: true, payload: payload as Record<string, unknown>, dropped: [] };
  }
  const c = convertPayload(to, spec.payload);
  return { ok: true, payload: c.payload, dropped: c.dropped };
}

/** Satu entri jejak. `payload` = bentuk LAMA utuh — inilah yang membuat `dropped` tak fatal. */
export function sourceChangeEntry(
  spec: { source: string; payload: unknown }, to: string, by: string, at: Date,
): SourceChange {
  return { at: at.toISOString(), from: spec.source, to, by, payload: spec.payload ?? null };
}

/** Append-only, tahan kolom `null` maupun nilai tak terduga dari baris yang datang lewat sync. */
export function appendSourceHistory(current: unknown, entry: SourceChange): SourceChange[] {
  return [...(Array.isArray(current) ? (current as SourceChange[]) : []), entry];
}
