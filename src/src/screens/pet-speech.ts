// SPEC-898 · kalimat pet — templat murni, tanpa LLM dan tanpa React/DOM, supaya tiap barisnya bisa
// diuji tabel. Pemisahan yang sama dengan pet-state.ts: kalimat yang lahir di dalam komponen hanya
// bisa diuji lewat render.
//
// Himpunan kabar yang bergelembung SENGAJA tertutup: `Toast` design system sudah melaporkan aksi
// pengguna di tengah-bawah, dan keadaan mapan (`working`/`review`/`blocked`/`deciding`/`ready`)
// yang bergelembung tiap kali sebuah sesi lahir adalah kebisingan, bukan kabar.
import {
  doneSpecIds, newestNotifiedAt, PET_URGENT_MS, sessionKind, SHIPPED_TYPES,
  type PetCondition, type PetConditionKind, type PetInput, type PetView,
} from "./pet-state";

export const PET_SPEECH_MS = 5_000;
// Rekap hidup lebih lama: ia membawa aksi, dan operator yang baru kembali belum tentu sedang melihat.
export const PET_RECAP_MS = 12_000;
export const PET_AWAY_MS = 5 * 60_000;

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

// Dicap saat tab jadi HIDDEN, dibandingkan saat tab terlihat lagi. Mengambilnya saat visible berarti
// ia dicap ulang tiap render dan diff-nya selalu kosong.
export type PetSnapshot = {
  at: number;
  sessions: Record<string, PetConditionKind>;   // id sesi → kondisinya saat snapshot
  notifiedAt: string;                           // createdAt notifikasi terbaru saat snapshot
};

export function petSnapshot(input: PetInput): PetSnapshot {
  const done = doneSpecIds(input.backlog);
  const sessions: Record<string, PetConditionKind> = {};
  for (const s of input.sessions) {
    const kind = sessionKind(s, done);
    if (kind) sessions[s.id] = kind;
  }
  return { at: input.now, sessions, notifiedAt: newestNotifiedAt(input.notifications) };
}

/**
 * Rekap perubahan sejak snapshot; `null` bila tak ada yang berubah.
 *
 * Kabar "selesai" dihitung dari FEED, bukan dari kondisi yang sedang menyala: `shipped` meluruh
 * 45 detik (PET_TRANSIENT_MS) dan operator yang pergi 20 menit tak akan pernah melihatnya.
 */
export function petRecap(before: PetSnapshot, input: PetInput): PetSpeech | null {
  const after = petSnapshot(input);
  const fresh = (kind: PetConditionKind): number =>
    Object.entries(after.sessions).filter(([id, k]) => k === kind && before.sessions[id] !== kind).length;
  const shipped = input.notifications
    .filter((n) => SHIPPED_TYPES.has(n.type) && n.createdAt > before.notifiedAt).length;
  const waiting = fresh("waiting");
  const failed = fresh("failed");
  const parts = [
    shipped > 0 ? `${shipped} selesai` : "",
    waiting > 0 ? `${waiting} menunggu` : "",
    failed > 0 ? `${failed} gagal` : "",
  ].filter(Boolean);
  return parts.length > 0 ? { kind: "recap", text: parts.join(" · "), ttl: PET_RECAP_MS } : null;
}
