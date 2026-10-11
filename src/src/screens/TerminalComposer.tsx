import React from "react";
import { Input } from "../ds/components/forms";
import * as C from "./terminal-composer";
import { appendFinal } from "./speech-engine";

// Berapa lama "terkirim" bertahan sesudah Enter. Cukup untuk dibaca, tak cukup untuk jadi latar.
const SENT_FLASH_MS = 1500;

// SPEC-882 · kolom ketik untuk tablet & ponsel. Presentasional: seluruh aritmetika delta hidup di
// `terminal-composer.ts`; yang di sini hanya irama (debounce) dan jalur peristiwa DOM.
//
// Keadaan otoritatifnya dipegang di REF, bukan di state React: `external` dipanggil pane secara
// sinkron dari dalam `term.onData`, dan closure yang tertinggal satu render akan menguras teks yang
// sudah basi. `text` yang jadi state hanya melayani nilai `<input>` yang terkendali.
export function TerminalComposer({ sessionId, send, external, linkState, queue, voiceAppend, onDraft }: {
  sessionId: string;
  /** Pintu keluar byte SPEC-878 milik pane (`sendKey.current`). */
  send: (d: string) => void;
  /** Diisi komponen ini; dipanggil pane saat byte lahir DI LUAR kolom. */
  external: React.MutableRefObject<() => void>;
  linkState: string;
  queue: { n: number; held: boolean };
  /** Dikte suara: diisi komponen ini; memanggilnya menambahkan teks FINAL ke kolom lewat jalur
   *  `change` yang sama dengan ketikan (debounce/delta tak berubah, dan tak pernah mengirim `\r`). */
  voiceAppend?: React.MutableRefObject<(text: string) => void>;
  /** Dipanggil tiap isi kolom berubah: `true` bila berisi. Pane memakainya untuk menyembunyikan
   *  kolom (di desktop) begitu mic berhenti dan kolom kosong. */
  onDraft?: (nonEmpty: boolean) => void;
}) {
  const [text, setText] = React.useState("");
  const state = React.useRef<C.ComposerState>(C.initialState());
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const debounce = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const forced = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Konfirmasi "terkirim" sesaat sesudah Enter saja (lihat `statusFor`), bukan tiap kuras debounce.
  const [sentRecently, setSentRecently] = React.useState(false);
  const sentTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

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
  React.useEffect(() => () => { stop(); clearTimeout(sentTimer.current); }, []);

  const change = (next: string) => {
    state.current = C.onText(state.current, next);
    setText(next);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(flush, C.DEBOUNCE_MS);
    // Kuras paksa TIDAK di-restart tiap ketikan: itulah yang membuat mengetik tanpa jeda tetap
    // menyeberang ke pty tiap detik, bukan tertahan sampai jari berhenti.
    if (!forced.current) forced.current = setTimeout(flush, C.MAX_HOLD_MS);
  };
  const submit = () => {
    emit(C.onSubmit(state.current));
    setText("");
    setSentRecently(true);
    clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSentRecently(false), SENT_FLASH_MS);
  };

  // Sama alasannya dengan `external`: dipasang saat render agar selalu menunjuk teks terbaru.
  if (voiceAppend) voiceAppend.current = (t) => change(appendFinal(state.current.text, t));
  React.useEffect(() => () => { if (voiceAppend) voiceAppend.current = () => {}; }, [voiceAppend]);
  const onDraftRef = React.useRef(onDraft);
  onDraftRef.current = onDraft;
  React.useEffect(() => { onDraftRef.current?.(text !== ""); }, [text]);

  const status = C.statusFor(linkState, queue, sentRecently);
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
      {/* Live region dipasang permanen (kosong saat diam): pembaca layar hanya mengumumkan
          perubahan pada region yang sudah ada di DOM. */}
      <span role="status" data-testid="terminal-composer-status"
        className={status ? `hn-terminal-composer-status hn-terminal-composer-status--${status.kind}` : undefined}>
        {status?.text ?? ""}
      </span>
    </div>
  );
}
