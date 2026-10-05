// Dikte suara (spec 2026-10-05-voice-input-design). Modul MURNI: tanpa DOM, tanpa React, supaya
// penggabung transkrip dan mesin-keadaan mic bisa diuji tanpa browser. Engine sungguhan
// (`web-speech-engine.ts`, kelak Whisper) hanya perlu memenuhi `SpeechEngine`.

export type SpeechError =
  "not-allowed" | "no-speech" | "network" | "insecure-context" | "unsupported" | "other";

export interface SpeechEngine {
  readonly supported: boolean;
  start(lang: string): void;
  stop(): void;
  /** Teks sementara (berubah-ubah). Boleh string kosong = "tak ada interim lagi". */
  onInterim(cb: (text: string) => void): void;
  /** Satu potong teks yang sudah final. */
  onFinal(cb: (text: string) => void): void;
  onError(cb: (e: SpeechError) => void): void;
  /** Engine berhenti, entah karena `stop()`, jeda diam, atau galat. */
  onEnd(cb: () => void): void;
}

export const DEFAULT_LANG = "id-ID";
export const LANG_KEY = "hanoman.voice.lang";
export const LANGS: { value: string; label: string }[] = [
  { value: "id-ID", label: "Indonesia" },
  { value: "en-US", label: "English" },
];

export const ERROR_MESSAGES: Record<SpeechError, string> = {
  "not-allowed": "Izin mikrofon ditolak. Aktifkan di pengaturan browser.",
  "no-speech": "Tidak ada suara terdengar.",
  "network": "Layanan suara tak terjangkau.",
  "insecure-context": "Mikrofon butuh HTTPS atau localhost.",
  "unsupported": "Browser ini tak mendukung dikte suara.",
  "other": "Dikte suara gagal.",
};

/** Menambahkan teks final ke draf composer: satu spasi pemisah, tanpa spasi ganda, kapitalisasi
 *  dibiarkan. Teks final kosong tak mengubah apa pun. */
export function appendFinal(draft: string, finalText: string): string {
  const t = finalText.trim();
  if (!t) return draft;
  if (!draft) return t;
  return /\s$/.test(draft) ? draft + t : `${draft} ${t}`;
}

export type VoiceState = { status: "idle" | "listening"; interim: string; error: SpeechError | null };
export type VoiceAction =
  | { type: "start" }
  | { type: "interim"; text: string }
  | { type: "final" }
  | { type: "error"; error: SpeechError }
  | { type: "end" }
  | { type: "dismiss" };

export const initialVoiceState: VoiceState = { status: "idle", interim: "", error: null };

/** Tak ada aksi "stop": `stop()` pada engine tak mengubah status — status baru kembali `idle` saat
 *  engine melapor `end`. Alasannya: Web Speech masih bisa menyerahkan potongan final TERAKHIR
 *  sesudah `stop()`; jika UI sudah idle (dan composer tersembunyi), teks itu hilang. */
export function voiceReducer(s: VoiceState, a: VoiceAction): VoiceState {
  switch (a.type) {
    case "start": return { status: "listening", interim: "", error: null };
    case "interim": return { ...s, interim: a.text };
    case "final": return { ...s, interim: "" };
    case "error": return { status: "idle", interim: "", error: a.error };
    // Browser memicu `error` lalu `end`: galat harus selamat dari `end`.
    case "end": return { ...s, status: "idle", interim: "" };
    case "dismiss": return { ...s, error: null };
  }
}

export function readLang(): string {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.some((l) => l.value === v) ? (v as string) : DEFAULT_LANG;
  } catch { return DEFAULT_LANG; }
}

export function writeLang(lang: string): void {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* mode privat / storage diblokir */ }
}
