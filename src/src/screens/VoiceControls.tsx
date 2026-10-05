import React from "react";
import { Icon } from "../ds/icon";
import { IconButton } from "../ds/components/forms";
import { ERROR_MESSAGES, LANGS } from "./speech-engine";
import type { VoiceInput } from "./use-voice-input";

// Presentasional: seluruh keadaan ada di `useVoiceInput`. Tak merender apa pun bila engine tak
// didukung / pane baca-saja, supaya browser tanpa Web Speech tak melihat tombol mati.
export function VoiceControls({ voice }: { voice: VoiceInput }) {
  if (!voice.supported) return null;
  const listening = voice.status === "listening";
  return (
    <div className="hn-terminal-voice" data-testid="terminal-voice">
      <IconButton icon="mic" size="sm" variant={listening ? "solid" : "outline"}
        label={listening ? "Hentikan dikte suara" : "Mulai dikte suara"}
        aria-pressed={listening} data-testid="voice-toggle"
        className={listening ? "hn-voice-rec" : ""} onClick={voice.toggle} />
      <select className="hn-terminal-voice-lang" data-testid="voice-lang" aria-label="Bahasa dikte"
        value={voice.lang} onChange={(e) => voice.setLang(e.target.value)}>
        {LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
      <span className="hn-terminal-voice-hint" role="img" aria-label="Audio diproses oleh layanan browser Anda"
        title="Audio diproses oleh layanan suara browser Anda (di Chrome: Google).">
        <Icon name="info" size={14} />
      </span>
      {listening && voice.interim && (
        <span className="hn-terminal-voice-interim" data-testid="voice-interim">{voice.interim}</span>
      )}
      {voice.error && (
        <span className="hn-terminal-voice-error" role="status" data-testid="voice-error">
          {ERROR_MESSAGES[voice.error]}
        </span>
      )}
    </div>
  );
}
