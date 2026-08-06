import { z } from "zod";
import { zPriority, zSeverity, zSpecSource } from "./enums";

// SPEC-546 · ADR-0109 · SELURUH pengetahuan murni tentang "source mana memakai bentuk payload
// mana" hidup di berkas ini. Sebelumnya predikat itu inline di `zCreateSpec.superRefine`, jadi
// jalur konversi baru hanya bisa memakainya dengan MENYALIN — dan salinan predikat adalah kelas
// bug yang sudah menggigit repo ini berkali-kali (SPEC-431/448/475/481). Di sini ia satu.
export type SpecSource = z.infer<typeof zSpecSource>;
export type Priority = z.infer<typeof zPriority>;
export type Severity = z.infer<typeof zSeverity>;

/** Lima source dilayani TIGA bentuk payload (SPEC-197 · SPEC-407 · ADR-0089). */
export type PayloadShape = "brief" | "qa" | "goal";

/** source → bentuk yang WAJIB dipakai payload-nya. */
export function payloadShapeFor(source: string): PayloadShape {
  return source === "qa" ? "qa" : source === "goal" ? "goal" : "brief";
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
