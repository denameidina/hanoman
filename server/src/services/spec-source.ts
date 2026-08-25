import { flowForSource, convertPayload, payloadMatchesSource, type SourceChange } from "@hanoman/shared";

// SPEC-546 · ADR-0109 · gerbang & perakit jejak untuk konversi type backlog item.
// SELURUH isi berkas ini MURNI (tanpa DB, tanpa git, tanpa jam sistem — `at` diserahkan
// pemanggil): keputusan "boleh atau tidak" adalah bagian yang paling mudah salah dan paling
// pantas diuji tanpa harness.

export type SourceGate =
  | { ok: true; payload: Record<string, unknown>; dropped: string[]; reset: boolean }
  | { ok: false; code: number; error: string };

type SpecLike = { source: string; stage: string; baseSha: string | null; payload: unknown };

/**
 * Boleh tidak item ini pindah ke `to`, isi apa yang berlaku sesudahnya, dan perlukah item itu
 * dikembalikan ke `brainstorming`.
 *
 * ADR-0109 dulu MENGUNCI flow: item yang sudah dimulai hanya boleh pindah ke source se-flow.
 * Diagnosisnya sah — sesi yang sudah lahir menulis nama fase `PIPELINES[flow]` ke berkas fase,
 * jadi item ber-flow `feature` (lima fase) yang pindah ke `goal` (dua fase) meninggalkan berkas
 * yang TAK AKAN PERNAH memuaskan `phasesComplete` flow barunya (bentuk SPEC-433: keadaan yang
 * secara struktural tak bisa tercapai). Obatnyalah yang salah. Melarang perpindahan membuat
 * empat dari enam source — yang masing-masing sendirian di flow-nya — tak punya tujuan sama
 * sekali begitu itemnya dimulai, dan penolakan itu sampai ke operator sebagai tombol yang diam.
 * ADR-0149 menggantinya dengan `reset`: perpindahan lintas-alur diizinkan, dengan syarat berkas
 * yang mengganggu itu dibuang dan itemnya kembali ke titik nol.
 *
 * `reset: false` untuk dua keadaan yang tak punya berkas fase bermasalah: item yang belum pernah
 * dimulai, dan perpindahan SE-ALUR (`brief ↔ help`) yang tak mengubah apa pun yang dipegang
 * sesi — flow sama, bentuk payload sama, prompt sama.
 */
export function checkSourceChange(spec: SpecLike, to: string, payload?: unknown): SourceGate {
  const started = spec.stage !== "brainstorming" || spec.baseSha !== null;
  if (started && flowForSource(spec.source) === flowForSource(to)) {
    // Konversi se-flow selalu se-bentuk, jadi tak ada field yang perlu diisi operator; dan
    // membuka payload di sini berarti membatalkan gerbang SPEC-186 lewat pintu belakang.
    if (payload !== undefined)
      return { ok: false, code: 409, error: "backlog item sudah dimulai — isinya tak bisa diubah" };
    return { ok: true, payload: (spec.payload ?? {}) as Record<string, unknown>, dropped: [], reset: false };
  }
  if (payload !== undefined) {
    // Bentuknya sudah dijamin `zChangeSpecSource` di batas HTTP; diperiksa lagi di sini supaya
    // pemanggil non-HTTP tak bisa menyelundupkan bentuk salah lewat service.
    if (!payloadMatchesSource(to, payload))
      return { ok: false, code: 400, error: "bentuk payload tak cocok dengan source" };
    return { ok: true, payload: payload as Record<string, unknown>, dropped: [], reset: started };
  }
  const c = convertPayload(to, spec.payload);
  return { ok: true, payload: c.payload, dropped: c.dropped, reset: started };
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
