import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { paths } from "@hanoman/shared";
import type { Phase } from "../api/client";
import { api } from "../api/client";
import { clipboardIntent } from "./terminal-clipboard";
import { clampFontSize, FONT_DEFAULT, TERMINAL_KEYS } from "./terminal-chrome";

// SPEC-800 · socket terminal bisa tertutup tanpa salah siapa pun: revalidasi principal ADR-0117
// (per frame dan tiap 60 dtk), kuota pesan, restart server saat update (SPEC-405), jaringan mobile.
// Sebelum ini tak ada satu pun `onclose`, jadi `pendingInput` menumpuk pada buffer yang tak punya
// pembaca dan ketikan hilang tanpa satu tanda pun.
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000];
const RECONNECT_MAX = RECONNECT_BACKOFF_MS.length;

type LinkState =
  | { state: "connecting" | "open" | "gone" | "lost" }
  | { state: "retrying"; attempt: number };

export function TerminalPane({ sessionId, onExit, onPhases, fontSize = FONT_DEFAULT, showKeys = false }: {
  sessionId: string; onExit: (code: number) => void;
  // SPEC-433 · frame phase membawa VERDICT-nya juga: `complete` = seluruh fase tercatat DAN plan
  // tak menyisakan `- [ ]`. Tanpa itu sel tak punya satu pun kabar "selesai" — `exited` cuma
  // berarti prosesnya mati, dan TUI agen tak pernah mati sendiri sesudah fase terakhir.
  onPhases?: (p: Phase[], complete: boolean) => void;
  fontSize?: number;
  showKeys?: boolean;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  // Dipegang di ref supaya effect koneksi tetap hanya bergantung pada `sessionId`: mengubah
  // ukuran font tak boleh melahirkan socket baru.
  const fontSizeRef = React.useRef(fontSize);
  fontSizeRef.current = fontSize;
  const view = React.useRef<{ term: Terminal; fit: FitAddon; send: (m: unknown) => void } | null>(null);
  // onExit boleh berubah tiap render; menaruhnya di ref menjaga effect ini
  // hanya bergantung pada sessionId — remount = sesi yang benar-benar berbeda.
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;
  const phaseRef = React.useRef(onPhases);
  phaseRef.current = onPhases;
  const [link, setLink] = React.useState<LinkState>({ state: "connecting" });
  const retryNow = React.useRef<() => void>(() => {});
  const sendKey = React.useRef<(d: string) => void>(() => {});

  React.useEffect(() => {
    const el = host.current;
    if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const token = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
    const term = new Terminal({
      fontFamily: token("--font-mono", "monospace"),
      fontSize: clampFontSize(fontSizeRef.current), cursorBlink: true,
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
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const send = (m: unknown) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
    view.current = { term, fit, send };
    let pendingInput = "";
    const sendInput = (d: string) => {
      if (ws?.readyState === WebSocket.OPEN) send({ t: "in", d });
      else pendingInput += d;
    };
    sendKey.current = sendInput;

    const connect = () => {
      void api.issueWsTicket(`terminal:${sessionId}`).then(({ ticket }) => {
        if (disposed) return;
        const scheme = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${scheme}//${location.host}${paths.terminalWs(sessionId)}`, [`hanoman-ticket.${ticket}`]);
        ws = socket;

        socket.onopen = () => {
          attempt = 0;
          setLink({ state: "open" });
          // Dikuras di SETIAP open, bukan hanya yang pertama: itu yang mengubah buffer SPEC-771
          // dari penyembunyi kegagalan menjadi penyelamat ketikan.
          if (pendingInput) {
            const d = pendingInput;
            pendingInput = "";
            send({ t: "in", d });
          }
          if (!visibleRect()) return;
          const finePointer = typeof window.matchMedia !== "function"
            || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
          if (finePointer) term.focus();
          send({ t: "resize", cols: term.cols, rows: term.rows });
        };
        socket.onmessage = (ev) => {
          const f = JSON.parse(ev.data as string) as {
            t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean;
          };
          if (f.t === "data") term.write(f.d ?? "");
          // Server menyiarkan fase saat attach dan setiap kali agen menutup satu (SPEC-162).
          // SPEC-433 · sejak sekarang juga saat `complete` berubah tanpa daftar fase berubah —
          // kotak `- [ ]` terakhir di plan dicentang sesudah `Execute done`.
          else if (f.t === "phase") phaseRef.current?.(f.phases ?? [], f.complete === true);
          else if (f.t === "exit") {
            finished = true;
            term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
            exitRef.current(f.code ?? 0);
          }
        };
        // 4004 = sesi tmux-nya memang sudah lenyap; menyambung ulang hanya menghasilkan badai 404.
        socket.onclose = (event) => {
          if (disposed || finished) return;
          if (event.code === 4004) { setLink({ state: "gone" }); return; }
          retry();
        };
        socket.onerror = () => { /* onclose selalu menyusul; keputusannya cukup di satu tempat */ };
      }).catch(() => {
        if (disposed) return;
        term.write("\r\n\x1b[31mWebSocket admission gagal\x1b[0m\r\n");
        retry();
      });
    };

    const retry = () => {
      if (attempt >= RECONNECT_MAX) { setLink({ state: "lost" }); return; }
      const wait = RECONNECT_BACKOFF_MS[attempt]!;
      attempt += 1;
      setLink({ state: "retrying", attempt });
      timer = setTimeout(connect, wait);
    };

    retryNow.current = () => {
      if (disposed) return;
      clearTimeout(timer);
      attempt = 0;
      setLink({ state: "retrying", attempt: 1 });
      connect();
    };

    connect();
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
        void navigator.clipboard?.readText().then((t) => { if (t) sendInput(t); });
        return false;
      }
      return true;
    });
    // SPEC-800 · xterm mematikan wheel-nya sendiri begitu protokol mouse aktif (Viewport.ts) dan
    // tmux `mouse on` (SPEC-209) memang mengambilnya untuk copy-mode. Wheel polos karena itu
    // DIBIARKAN lewat — riwayat 50 000 baris ada di tmux, bukan di buffer xterm. Shift+wheel adalah
    // satu-satunya jalur gulir yang tak pernah melewati mouse-mode, jadi ia tetap hidup saat dialog
    // claude memegang mouse.
    term.attachCustomWheelEventHandler((event) => {
      if (!event.shiftKey) return true;
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return true;
      const lineHeight = rect.height / term.rows;
      const lines = Math.trunc(event.deltaY / lineHeight) || Math.sign(event.deltaY);
      if (lines) term.scrollLines(lines);
      return false;
    });
    const typed = term.onData(sendInput);

    // SPEC-771 · viewport internal xterm 6 tak memiliki pemilik gesture touch. Tanpa handler
    // passive-false ini swipe bubble ke page scroller meski scrollback terminal masih tersedia.
    let touchY: number | null = null;
    let touchRemainder = 0;
    const resetTouch = () => { touchY = null; touchRemainder = 0; };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { resetTouch(); return; }
      touchY = event.touches[0]!.clientY;
      touchRemainder = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY === null || event.touches.length !== 1) { resetTouch(); return; }
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return;
      const nextY = event.touches[0]!.clientY;
      touchRemainder += touchY - nextY;
      touchY = nextY;
      const lineHeight = rect.height / term.rows;
      const lines = Math.trunc(touchRemainder / lineHeight);
      if (lines !== 0) {
        term.scrollLines(lines);
        touchRemainder -= lines * lineHeight;
      }
      event.preventDefault();
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", resetTouch, { passive: true });
    el.addEventListener("touchcancel", resetTouch, { passive: true });

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect ?? el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      fit.fit();
      send({ t: "resize", cols: term.cols, rows: term.rows });
    });
    ro.observe(el);

    return () => {
      disposed = true;
      clearTimeout(timer);
      retryNow.current = () => {};
      sendKey.current = () => {};
      view.current = null;
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", resetTouch);
      el.removeEventListener("touchcancel", resetTouch);
      ro.disconnect();
      typed.dispose();
      ws?.close();
      term.dispose();
    };
  }, [sessionId]);

  // Ukuran font diterapkan tanpa me-remount: remount berarti socket baru, tiket baru, dan layar
  // kosong sampai tmux menggambar ulang. `cols`/`rows` PTY turunan ukuran font, jadi frame resize
  // wajib menyusul — tanpa itu tmux tetap menggambar untuk geometri lama.
  React.useEffect(() => {
    const current = view.current;
    const el = host.current;
    if (!current || !el) return;
    const size = clampFontSize(fontSize);
    if (current.term.options.fontSize === size) return;
    current.term.options.fontSize = size;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    current.fit.fit();
    current.send({ t: "resize", cols: current.term.cols, rows: current.term.rows });
  }, [fontSize]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Diam adalah cacatnya (audit SPEC-800 §3); diam tak boleh jadi bagian perbaikannya. */}
      {link.state !== "open" && link.state !== "connecting" && (
        <div data-testid="terminal-link" style={{
          display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto",
          padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 11,
          background: link.state === "retrying" ? "var(--status-warn-tint)" : "var(--status-err-tint)",
          color: "var(--text-body)",
        }}>
          {link.state === "retrying"
            ? `menyambung ulang… (${link.attempt}/${RECONNECT_MAX})`
            : link.state === "gone"
              ? "sesi tidak ditemukan di tmux"
              : <>
                  <span>terputus</span>
                  <button type="button" className="hn-terminal-action hn-terminal-action--text"
                    onClick={() => retryNow.current()}>Sambungkan lagi</button>
                </>}
        </div>
      )}
      <div ref={host} data-testid="terminal-host" style={{ flex: 1, minHeight: 0, width: "100%",
        background: "var(--term-bg)", padding: 8, borderRadius: "var(--radius-sm)",
        touchAction: "pan-x pinch-zoom", overscrollBehavior: "contain" }} />
      {showKeys && <TerminalKeys onKey={(seq) => sendKey.current(seq)} />}
    </div>
  );
}

// SPEC-800 · keyboard virtual ponsel tak punya panah/Esc/Tab, dan Esc adalah satu-satunya jalan
// keluar dari copy-mode tmux. SPEC-452 · tiap tekan mengirim SATU keystroke: dialog AskUserQuestion
// adalah daftar Ink yang menelan burst >1 karakter bulat-bulat.
function TerminalKeys({ onKey }: { onKey: (seq: string) => void }) {
  return (
    <div className="hn-terminal-keys" role="group" aria-label="Tombol terminal">
      {TERMINAL_KEYS.map((key) => (
        <button key={key.id} type="button" className="hn-terminal-key" aria-label={key.aria}
          title={key.aria} onClick={() => onKey(key.seq)}>{key.label}</button>
      ))}
    </div>
  );
}
