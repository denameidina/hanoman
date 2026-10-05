import type { SpeechEngine, SpeechError } from "./speech-engine";

// Adaptor `SpeechRecognition` (Web Speech API) → `SpeechEngine`. Catatan privasi: di Chrome/Edge
// audio diproses server penyedia browser (ADR-0177).

type Alt = { transcript: string };
type Result = { isFinal: boolean; 0: Alt };
type ResultEvent = { resultIndex: number; results: ArrayLike<Result> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

/** `null` = bukan galat (mis. `aborted`: kita sendiri yang menghentikan). */
export function mapWebSpeechError(code: string): SpeechError | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed": return "not-allowed";
    case "no-speech": return "no-speech";
    case "network": return "network";
    case "aborted": return null;
    default: return "other";
  }
}

export function createWebSpeechEngine(win: Window = window): SpeechEngine {
  const w = win as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor; isSecureContext?: boolean };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  let rec: Recognition | null = null;
  let cbInterim: (t: string) => void = () => {};
  let cbFinal: (t: string) => void = () => {};
  let cbError: (e: SpeechError) => void = () => {};
  let cbEnd: () => void = () => {};

  const fail = (e: SpeechError) => { cbError(e); cbEnd(); };

  return {
    supported: Ctor !== undefined,
    start(lang) {
      if (!Ctor) return fail("unsupported");
      // `=== false`, bukan `!`: jsdom/browser lama tak punya properti ini dan tak boleh dianggap tak aman.
      if (w.isSecureContext === false) return fail("insecure-context");
      if (rec) return; // sudah merekam; hook yang menjaga toggle
      const r = new Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const item = e.results[i]!;
          if (item.isFinal) cbFinal(item[0].transcript);
          else interim += item[0].transcript;
        }
        cbInterim(interim);
      };
      r.onerror = (e) => { const m = mapWebSpeechError(e.error); if (m) cbError(m); };
      r.onend = () => { rec = null; cbEnd(); };
      rec = r;
      try { r.start(); } catch { rec = null; fail("other"); }
    },
    stop() { rec?.stop(); },
    onInterim(cb) { cbInterim = cb; },
    onFinal(cb) { cbFinal = cb; },
    onError(cb) { cbError = cb; },
    onEnd(cb) { cbEnd = cb; },
  };
}
