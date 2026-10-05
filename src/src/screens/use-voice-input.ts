import React from "react";
import {
  initialVoiceState, readLang, voiceReducer, writeLang, type SpeechEngine,
} from "./speech-engine";
import { createWebSpeechEngine } from "./web-speech-engine";

const ERROR_TTL_MS = 6000;

export function useVoiceInput({ onFinalText, enabled = true, engine }: {
  /** Dipanggil untuk tiap potongan teks FINAL. Interim tak pernah lewat sini. */
  onFinalText: (text: string) => void;
  enabled?: boolean;
  /** Hanya untuk tes / engine lain; default Web Speech. */
  engine?: SpeechEngine;
}) {
  // Satu engine per pane. Dibuat sekali: `engine` dari luar dianggap stabil.
  const eng = React.useMemo(() => engine ?? createWebSpeechEngine(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [state, dispatch] = React.useReducer(voiceReducer, initialVoiceState);
  const [lang, setLangState] = React.useState(readLang);
  const finalRef = React.useRef(onFinalText);
  finalRef.current = onFinalText;

  React.useEffect(() => {
    eng.onInterim((text) => dispatch({ type: "interim", text }));
    eng.onFinal((text) => { finalRef.current(text); dispatch({ type: "final" }); });
    eng.onError((error) => dispatch({ type: "error", error }));
    eng.onEnd(() => dispatch({ type: "end" }));
    // Pane ditutup / sesi berpindah: mic tak boleh tertinggal menyala.
    return () => { eng.stop(); };
  }, [eng]);

  React.useEffect(() => {
    if (!state.error) return;
    const t = setTimeout(() => dispatch({ type: "dismiss" }), ERROR_TTL_MS);
    return () => clearTimeout(t);
  }, [state.error]);

  const toggle = () => {
    if (!enabled) return;
    if (state.status === "listening") { eng.stop(); return; }
    dispatch({ type: "start" });
    eng.start(lang);
  };
  const setLang = (l: string) => { writeLang(l); setLangState(l); };

  return {
    supported: enabled && eng.supported,
    status: state.status, interim: state.interim, error: state.error,
    lang, setLang, toggle,
  };
}

export type VoiceInput = ReturnType<typeof useVoiceInput>;
