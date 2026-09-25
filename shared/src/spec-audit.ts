// Audit custom agent 2026-09-25 · P1-6. Kosakata putusan per kriteria yang DIPAKAI BERSAMA oleh
// builtin `spec-auditor` (builtin-agents.ts) dan reviewer fase ADR-0170 (runner/src/phase-agents.ts).
// Satu sumber: reviewer diturunkan dari spec-auditor, dan dua daftar yang menyimpang berarti dua agen
// menilai hal yang sama dengan skala berbeda.
export const SPEC_AUDIT_VERDICTS = [
  "terpenuhi oleh perubahan",
  "sudah terpenuhi di base",
  "tak terpenuhi",
  "terpenuhi BERBEDA dari yang diminta",
  "belum terverifikasi",
  "tidak berlaku",
] as const;

export type SpecAuditVerdict = (typeof SPEC_AUDIT_VERDICTS)[number];

/** Putusan dirangkai untuk prompt: `a · b · c`. */
export const SPEC_AUDIT_VERDICT_LIST = SPEC_AUDIT_VERDICTS.join(" · ");
