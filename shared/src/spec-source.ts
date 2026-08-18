import { z } from "zod";
import { zPriority, zSeverity, zSpecSource } from "./enums";

// SPEC-546 · ADR-0109 · SELURUH pengetahuan murni tentang "source mana memakai bentuk payload
// mana" hidup di berkas ini. Sebelumnya predikat itu inline di `zCreateSpec.superRefine`, jadi
// jalur konversi baru hanya bisa memakainya dengan MENYALIN — dan salinan predikat adalah kelas
// bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481). Di sini ia satu.
export type SpecSource = z.infer<typeof zSpecSource>;
export type Priority = z.infer<typeof zPriority>;
export type Severity = z.infer<typeof zSeverity>;

/** Enam source dilayani TIGA bentuk payload (SPEC-197 · SPEC-407 · SPEC-825 · ADR-0089). */
export type PayloadShape = "brief" | "qa" | "goal";

// SPEC-825 · ADR-0123 · `no_effort` menumpang bentuk `goal`, bukan bentuk keempat: field yang
// dibutuhkannya persis sama, dan bentuk keempat yang tak terbedakan dari ISI-nya membuat
// `shapeOfPayload` — yang menjaga `payloadMatchesSource` — tak bisa ditulis sama sekali.
const GOAL_SHAPED_SOURCES = new Set(["goal", "no_effort"]);

/** source → bentuk yang WAJIB dipakai payload-nya. */
export function payloadShapeFor(source: string): PayloadShape {
  return source === "qa" ? "qa" : GOAL_SHAPED_SOURCES.has(source) ? "goal" : "brief";
}

/**
 * payload → bentuk yang sebenarnya ia pakai. Kunci pembedanya field yang hanya dimiliki satu
 * bentuk (`severity` milik qa, `goal` milik goal); union zod sendiri tak menjaganya karena
 * objeknya non-strict. `null` (kolom `payload` nullable) dibaca sebagai brief — bentuk default
 * item lama — supaya pemanggil server tak perlu menjaga cabang null sendiri-sendiri.
 */
export function shapeOfPayload(payload: unknown): PayloadShape {
  const p = (payload ?? {}) as Record<string, unknown>;
  return "severity" in p ? "qa" : "goal" in p ? "goal" : "brief";
}

export function payloadMatchesSource(source: string, payload: unknown): boolean {
  return shapeOfPayload(payload) === payloadShapeFor(source);
}

/**
 * Cermin aturan yang sudah dipakai `deriveSpecFields` sejak SPEC-186: severity `minor` → prioritas
 * `sedang`, selain itu `tinggi`. Diekspor supaya `deriveSpecFields` memakai fungsi INI, bukan
 * menyalin ternarinya.
 */
export function priorityFromSeverity(severity: unknown): Priority {
  return severity === "minor" ? "sedang" : "tinggi";
}

/**
 * Invers yang sengaja LOSSY: prioritas punya tiga nilai, severity yang bisa diturunkan darinya
 * hanya dua (`tinggi` ⇒ `major`, sisanya `minor`). Konsekuensinya `rendah → minor → sedang` —
 * dinyatakan di ADR-0109 dan diuji, bukan disembunyikan.
 */
export function severityFromPriority(priority: unknown): Severity {
  return priority === "tinggi" ? "major" : "minor";
}

export interface PayloadConversion {
  /** Payload dalam bentuk source tujuan. */
  payload: Record<string, unknown>;
  /** Field payload LAMA yang tak punya tujuan — utuh tersimpan di `Spec.sourceHistory`. */
  dropped: string[];
  /** Field WAJIB bentuk tujuan yang lahir kosong; dialog memintanya ke operator. */
  missing: string[];
}

/**
 * Field bentuk tujuan yang dianggap harus terisi. `constraints` sengaja TIDAK di sini: kosong
 * itu keadaan normal untuk KETIGA bentuk (SPEC-826 membawanya ke qa juga), dan menandainya
 * "kurang" tiap konversi jadi kebisingan. `severity`/`priority` juga tidak: keduanya selalu
 * punya nilai turunan.
 */
export const SHAPE_REQUIRED: Record<PayloadShape, readonly string[]> = {
  brief: ["context", "outcome"],
  qa: ["steps", "expected", "actual", "env"],
  goal: ["goal", "done"],
};

/**
 * Peta konversi payload antar-bentuk. MURNI, dipakai DUA pemanggil: dialog UI memakainya untuk
 * prefill form, server memakainya sebagai default saat `payload` tak dikirim (jalur agen lewat
 * REST). Satu definisi — pola `resolveAutoMerge`/`flowForSource`.
 *
 * Bentuk ASAL dibaca dari payload-nya sendiri, bukan dari `source` lama: baris yang keduanya
 * terlanjur berselisih (mis. datang lewat sync dari klien versi lama) tetap dikonversi berdasar
 * isi yang benar-benar ada.
 *
 * Aturan yang mengikat: **field-ke-field, tak pernah menyambung dua field jadi satu.** Prosa yang
 * disambung tak bisa diurai lagi, sementara operator toh ada di depan form. Yang tak punya padanan
 * masuk `dropped`, diberitahukan di dialog, dan tersimpan UTUH di `Spec.sourceHistory` — itulah
 * yang membuat kehilangan di sini tak pernah jadi kehilangan sungguhan.
 */
export function convertPayload(to: string, payload: unknown): PayloadConversion {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const prio = (): Priority =>
    p.priority === "tinggi" || p.priority === "rendah" ? p.priority : "sedang";
  const nonEmpty = (fields: string[]) => fields.filter((f) => str(f) !== "");
  const fromShape = shapeOfPayload(payload);
  const toShape = payloadShapeFor(to);
  const fromAudit = str("fromAudit");

  // `missing` DIHITUNG dari SHAPE_REQUIRED, tak didaftar per-pasangan: satu aturan, dan ia tetap
  // benar untuk payload yang field asalnya kebetulan kosong.
  const done = (out: Record<string, unknown>, dropped: string[]): PayloadConversion => ({
    payload: out, dropped,
    missing: SHAPE_REQUIRED[toShape].filter((f) => typeof out[f] !== "string" || out[f] === ""),
  });

  // Sebentuk (brief ↔ audit ↔ help): payload tak berubah sama sekali.
  if (fromShape === toShape) return { payload: { ...p }, dropped: [], missing: [] };

  if (toShape === "qa") {
    if (fromShape === "brief")
      return done({
        severity: severityFromPriority(prio()), steps: "", expected: str("outcome"),
        actual: str("context"), env: "", constraints: str("constraints"),
        ...(fromAudit ? { fromAudit } : {}),
      }, []);
    return done({
      severity: severityFromPriority(prio()), steps: "", expected: str("goal"),
      actual: "", env: "", constraints: str("constraints"),
    }, nonEmpty(["done"]));
  }

  if (toShape === "goal") {
    if (fromShape === "brief") {
      const goal = str("outcome") || str("context");
      // `context` hanya hilang bila ia TAK dipakai sebagai goal.
      return done({ goal, done: "", constraints: str("constraints"), priority: prio() },
        nonEmpty([...(str("outcome") ? ["context"] : []), "fromAudit"]));
    }
    return done({
      goal: str("expected"), done: "", constraints: str("constraints"),
      priority: priorityFromSeverity(p.severity),
    }, nonEmpty(["steps", "actual", "env", "fromAudit"]));
  }

  // → bentuk brief (brief | audit | help)
  if (fromShape === "qa")
    return done({
      context: str("actual"), outcome: str("expected"), constraints: str("constraints"),
      priority: priorityFromSeverity(p.severity), ...(fromAudit ? { fromAudit } : {}),
    }, nonEmpty(["steps", "env"]));
  return done({
    context: "", outcome: str("goal"), constraints: str("constraints"), priority: prio(),
  }, nonEmpty(["done"]));
}

/**
 * Satu baris jejak konversi (`Spec.sourceHistory`). `payload` = bentuk LAMA utuh — itulah yang
 * membuat `dropped` di atas bukan kehilangan sungguhan. Tipenya milik skema (`zSourceChange` di
 * `entities.ts`); di sini cukup dirujuk supaya pemakai `spec-source.ts` tak perlu tahu asalnya.
 */
export type { SourceChange } from "./entities";
