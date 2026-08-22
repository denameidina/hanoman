// SPEC-898 · kalimat pet — templat murni, tanpa LLM dan tanpa React/DOM, supaya tiap barisnya bisa
// diuji tabel. Pemisahan yang sama dengan pet-state.ts: kalimat yang lahir di dalam komponen hanya
// bisa diuji lewat render.
//
// Himpunan kabar yang bergelembung SENGAJA tertutup: `Toast` design system sudah melaporkan aksi
// pengguna di tengah-bawah, dan keadaan mapan (`working`/`review`/`blocked`/`deciding`/`ready`)
// yang bergelembung tiap kali sebuah sesi lahir adalah kebisingan, bukan kabar.
import { PET_URGENT_MS, type PetCondition, type PetConditionKind, type PetView } from "./pet-state";

export const PET_SPEECH_MS = 5_000;

export type PetSpeech = { kind: "pose" | "recap"; text: string; ttl: number };

const BUBBLE_KINDS: ReadonlySet<PetConditionKind> = new Set(["shipped", "docs-updated", "waiting", "offline"]);

// Kata kerja gelembung — sengaja BUKAN `headline`: headline ditulis untuk daftar panel selebar
// 268 px berdampingan dengan detail, gelembung ditulis untuk dibaca sekilas di atas kepala pet.
const VERB: Partial<Record<PetConditionKind, string>> = {
  shipped: "selesai",
  "docs-updated": "dokumen terbit",
  waiting: "butuh jawabanmu",
};
// Satuan pendek untuk hitungan di dalam kalimat; `KIND_NOUN` terlalu panjang untuk gelembung.
const SPEECH_NOUN: Partial<Record<PetConditionKind, string>> = {
  shipped: "kabar", "docs-updated": "dokumen", waiting: "sesi",
};

export const isUrgent = (c: Pick<PetCondition, "kind" | "since">, now: number): boolean =>
  c.kind === "waiting" && c.since !== null && now - c.since >= PET_URGENT_MS;

export function humanAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))} detik`;
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} jam ${rest} menit` : `${hours} jam`;
}

/** Kalimat untuk pandangan pet; `null` = kondisi ini tak bergelembung. */
export function speechFor(view: PetView, now: number): PetSpeech | null {
  if (!BUBBLE_KINDS.has(view.kind)) return null;
  if (view.kind === "offline") return { kind: "pose", text: "Aku kehilangan sambungan", ttl: PET_SPEECH_MS };
  let text = `${view.subject ?? "Backlog"} ${VERB[view.kind]}`;
  if (view.count > 1) text += ` · ${view.count} ${SPEECH_NOUN[view.kind]}`;
  if (isUrgent(view, now)) text += ` — ${humanAge(now - view.since!)}`;
  return { kind: "pose", text, ttl: PET_SPEECH_MS };
}
