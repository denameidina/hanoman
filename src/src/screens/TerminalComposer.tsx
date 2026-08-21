import React from "react";
import { Input } from "../ds/components/forms";
import * as C from "./terminal-composer";

// SPEC-882 · kolom ketik untuk tablet & ponsel. Presentasional: seluruh aritmetika delta hidup di
// `terminal-composer.ts`; yang di sini hanya irama (debounce) dan jalur peristiwa DOM.
//
// Keadaan otoritatifnya dipegang di REF, bukan di state React: `external` dipanggil pane secara
// sinkron dari dalam `term.onData`, dan closure yang tertinggal satu render akan menguras teks yang
// sudah basi. `text` yang jadi state hanya melayani nilai `<input>` yang terkendali.
export function TerminalComposer({ sessionId, send, external, linkState, queue }: {
  sessionId: string;
  /** Pintu keluar byte SPEC-878 milik pane (`sendKey.current`). */
  send: (d: string) => void;
  /** Diisi komponen ini; dipanggil pane saat byte lahir DI LUAR kolom. */
  external: React.MutableRefObject<() => void>;
  linkState: string;
  queue: { n: number; held: boolean };
}) {
  const [text, setText] = React.useState("");
  const state = React.useRef<C.ComposerState>(C.initialState());
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const debounce = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const forced = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    clearTimeout(debounce.current);
    debounce.current = undefined;
    clearTimeout(forced.current);
    forced.current = undefined;
  };
  const emit = (r: { state: C.ComposerState; send: string }) => {
    stop();
    state.current = r.state;
    if (r.send) sendRef.current(r.send);
  };
  const flush = () => emit(C.onFlush(state.current));

  // Dipasang saat render, bukan di dalam effect: pane memanggilnya SINKRON di awal `onTyped`, jadi
  // ia harus sudah menunjuk ke teks paling mutakhir sebelum effect apa pun sempat berjalan.
  external.current = () => { emit(C.onExternalInput(state.current)); setText(""); };
  React.useEffect(() => () => { external.current = () => {}; }, [external]);
  React.useEffect(() => stop, []);

  const change = (next: string) => {
    state.current = C.onText(state.current, next);
    setText(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(flush, C.DEBOUNCE_MS);
    // Kuras paksa TIDAK di-restart tiap ketikan: itulah yang membuat mengetik tanpa jeda tetap
    // menyeberang ke pty tiap detik, bukan tertahan sampai jari berhenti.
    if (!forced.current) forced.current = setTimeout(flush, C.MAX_HOLD_MS);
  };
  const submit = () => { emit(C.onSubmit(state.current)); setText(""); };

  const status = C.statusFor(linkState, queue);
  return (
    <div className="hn-terminal-composer">
      <Input size="lg" mono value={text} data-testid="terminal-composer"
        aria-label={`Ketik untuk sesi ${sessionId}`}
        placeholder="mis. pnpm vitest --run"
        autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off"
        enterKeyHint="send"
        style={{ flex: "1 1 160px", minWidth: 0 }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value)}
        onBlur={() => flush()}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          // `isComposing` menutup papan ketik IME: di sana Enter menutup kandidat, bukan mengirim
          // baris — tanpa gerbang ini kalimat yang belum selesai disusun ikut ter-submit.
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit();
        }} />
      {status && (
        <span data-testid="terminal-composer-status"
          className={`hn-terminal-composer-status hn-terminal-composer-status--${status.kind}`}>
          {status.text}
        </span>
      )}
    </div>
  );
}
