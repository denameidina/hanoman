import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { paths } from "@hanoman/shared";
import type { Phase } from "../api/client";
import { api } from "../api/client";
import { clipboardIntent } from "./terminal-clipboard";

export function TerminalPane({ sessionId, onExit, onPhases }: {
  sessionId: string; onExit: (code: number) => void;
  // SPEC-433 · frame phase membawa VERDICT-nya juga: `complete` = seluruh fase tercatat DAN plan
  // tak menyisakan `- [ ]`. Tanpa itu sel tak punya satu pun kabar "selesai" — `exited` cuma
  // berarti prosesnya mati, dan TUI agen tak pernah mati sendiri sesudah fase terakhir.
  onPhases?: (p: Phase[], complete: boolean) => void;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  // onExit boleh berubah tiap render; menaruhnya di ref menjaga effect ini
  // hanya bergantung pada sessionId — remount = sesi yang benar-benar berbeda.
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;
  const phaseRef = React.useRef(onPhases);
  phaseRef.current = onPhases;

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const token = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
    const term = new Terminal({
      fontFamily: token("--font-mono", "monospace"),
      fontSize: 13, cursorBlink: true,
      // SPEC-511 · tmux lahir dengan `mouse on` (SPEC-209) supaya wheel browser menggulir riwayat
      // pane; harganya, tmux menyalakan mouse-reporting di terminal klien (terukur: `?1000h`
      // `?1002h` `?1006h`) — dan xterm memanggil `SelectionService.disable()` begitu ada protokol
      // mouse aktif. Di macOS satu-satunya jalan keluarnya `altKey && macOptionClickForcesSelection`;
      // tanpa opsi ini drag polos MAUPUN Option+drag sama-sama nol karakter, `hasSelection()`
      // selamanya false, dan wiring salin SPEC-289 tak pernah punya apa pun untuk disalin.
      // Mematikan `mouse on` bukan alternatif: TUI claude menyalakan mode yang sama sendiri.
      macOptionClickForcesSelection: true,
      theme: { background: token("--term-bg", "#1c1810"), foreground: token("--term-fg", "#e9e0cd") },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const visibleRect = () => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : null;
    };
    if (visibleRect()) fit.fit();

    let ws: WebSocket | undefined;
    let disposed = false;
    const send = (m: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

    void api.issueWsTicket(`terminal:${sessionId}`).then(({ ticket }) => {
      if (disposed) return;
      const scheme = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${scheme}//${location.host}${paths.terminalWs(sessionId)}`, [`hanoman-ticket.${ticket}`]);

      ws.onopen = () => {
        if (!visibleRect()) return;
        const finePointer = typeof window.matchMedia !== "function"
          || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        if (finePointer) term.focus();
        send({ t: "resize", cols: term.cols, rows: term.rows });
      };
      ws.onmessage = (ev) => {
        const f = JSON.parse(ev.data as string) as {
          t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean;
        };
        if (f.t === "data") term.write(f.d ?? "");
        // Server menyiarkan fase saat attach dan setiap kali agen menutup satu (SPEC-162).
        // SPEC-433 · sejak sekarang juga saat `complete` berubah tanpa daftar fase berubah —
        // kotak `- [ ]` terakhir di plan dicentang sesudah `Execute done`.
        else if (f.t === "phase") phaseRef.current?.(f.phases ?? [], f.complete === true);
        else if (f.t === "exit") {
          term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
          exitRef.current(f.code ?? 0);
        }
      };
    }).catch(() => { if (!disposed) term.write("\r\n\x1b[31mWebSocket admission gagal\x1b[0m\r\n"); });
    // Salin/tempel: xterm merender seleksi sendiri, jadi Cmd/Ctrl+C tak menyalin apa pun
    // tanpa wiring ini (SPEC-289). Return false = jangan teruskan ke terminal (mis. supaya
    // Cmd+C tak jadi input). Ctrl+C polos dilewatkan agar tetap jadi SIGINT.
    term.attachCustomKeyEventHandler((e) => {
      const intent = clipboardIntent(e, term.hasSelection());
      if (intent === "copy") {
        void navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      if (intent === "paste") {
        void navigator.clipboard?.readText().then((t) => { if (t) send({ t: "in", d: t }); });
        return false;
      }
      return true;
    });
    const typed = term.onData((d) => send({ t: "in", d }));
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect ?? el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      fit.fit();
      send({ t: "resize", cols: term.cols, rows: term.rows });
    });
    ro.observe(el);

    return () => { disposed = true; ro.disconnect(); typed.dispose(); ws?.close(); term.dispose(); };
  }, [sessionId]);

  return <div ref={host} style={{ height: "100%", width: "100%", background: "var(--term-bg)", padding: 8, borderRadius: "var(--radius-sm)" }} />;
}
