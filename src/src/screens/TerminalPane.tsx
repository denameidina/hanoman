import React from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isTerminalResponse, paths } from "@hanoman/shared";
import type { Phase } from "../api/client";
import { api } from "../api/client";
import { clipboardIntent, imageFilesFrom, hasImageDrag } from "./terminal-clipboard";
import { clampFontSize, dialogChoiceAt, FONT_DEFAULT, TERMINAL_KEYS } from "./terminal-chrome";
import * as P from "./terminal-predict";

// SPEC-800 · socket terminal bisa tertutup tanpa salah siapa pun: revalidasi principal ADR-0117
// (per frame dan tiap 60 dtk), kuota pesan, restart server saat update (SPEC-405), jaringan mobile.
// Sebelum ini tak ada satu pun `onclose`, jadi `pendingInput` menumpuk pada buffer yang tak punya
// pembaca dan ketikan hilang tanpa satu tanda pun.
// Anggarannya ~76 dtk (5 langkah naik lalu plafon 8 dtk): restart server saat update terukur
// memakan lebih dari 20 dtk pada smoke SPEC-800, dan menyerah lebih cepat memaksa operator
// menekan tombol untuk kejadian yang paling rutin. Plafon 8 dtk menjaga satu pane tetap jauh
// dari "generator koneksi" yang dilarang SPEC-761.
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000, 8_000, 8_000, 8_000];
const RECONNECT_MAX = RECONNECT_BACKOFF_MS.length;

// SPEC-878 · ADR-0134 · antrean adalah penyelamat ketikan (SPEC-800), bukan tempat penyimpanan.
// 4 KiB memuat satu paragraf yang di-paste dan tetap menghentikan antrean yang lari.
const MAX_PENDING_INPUT = 4_096;
// Layar operator sudah basi berdetik-detik saat antrean mendarat, jadi `\r` di dalamnya adalah
// jawaban atas pertanyaan yang mungkin bukan lagi yang ada di layar — `capture-pane` membuktikan
// baris yang salah benar-benar ter-submit ke agen. Antrean karena itu tak pernah mengirim byte
// yang men-submit sendiri; ia ditahan seluruhnya sampai operator memutuskan.
const SUBMIT = /[\r\n]/;

type LinkState =
  | { state: "connecting" | "open" | "gone" | "lost" }
  | { state: "retrying"; attempt: number };

export function TerminalPane({ sessionId, onExit, onPhases, fontSize = FONT_DEFAULT, showKeys = false,
  predict = true }: {
  sessionId: string; onExit: (code: number) => void;
  // SPEC-433 · frame phase membawa VERDICT-nya juga: `complete` = seluruh fase tercatat DAN plan
  // tak menyisakan `- [ ]`. Tanpa itu sel tak punya satu pun kabar "selesai" — `exited` cuma
  // berarti prosesnya mati, dan TUI agen tak pernah mati sendiri sesudah fase terakhir.
  onPhases?: (p: Phase[], complete: boolean) => void;
  fontSize?: number;
  showKeys?: boolean;
  // SPEC-856 · sakelar echo prediktif, dipegang di ref bersama fontSize: mematikannya tak boleh
  // melahirkan socket baru.
  predict?: boolean;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  // Dipegang di ref supaya effect koneksi tetap hanya bergantung pada `sessionId`: mengubah
  // ukuran font tak boleh melahirkan socket baru.
  const fontSizeRef = React.useRef(fontSize);
  fontSizeRef.current = fontSize;
  const predictRef = React.useRef(predict);
  predictRef.current = predict;
  const view = React.useRef<{ term: Terminal; fit: FitAddon; send: (m: unknown) => void } | null>(null);
  // onExit boleh berubah tiap render; menaruhnya di ref menjaga effect ini
  // hanya bergantung pada sessionId — remount = sesi yang benar-benar berbeda.
  const exitRef = React.useRef(onExit);
  exitRef.current = onExit;
  const phaseRef = React.useRef(onPhases);
  phaseRef.current = onPhases;
  const [link, setLink] = React.useState<LinkState>({ state: "connecting" });
  const [queue, setQueue] = React.useState<{ n: number; held: boolean; full: boolean }>(
    { n: 0, held: false, full: false });
  const retryNow = React.useRef<() => void>(() => {});
  const sendKey = React.useRef<(d: string) => void>(() => {});
  const sendHeld = React.useRef<() => void>(() => {});
  const dropHeld = React.useRef<() => void>(() => {});

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
    let held = false;
    let full = false;
    // SPEC-878 · ADR-0134 · penomoran frame masuk. `unacked` satu-satunya hal yang boleh menyalakan
    // jam TTL prediksi: selama ia > 0, diamnya server tak memisahkan "pty bungkam" dari "byte
    // belum sampai".
    let seq = 0;
    let unacked = 0;
    // 4004 = sesi tmux-nya memang sudah lenyap. Satu-satunya keadaan di mana byte yang diantre
    // TIDAK akan pernah terkirim — jadi satu-satunya yang menutup `deliverable`.
    let gone = false;
    const sendFrame = (d: string) => {
      seq += 1;
      unacked += 1;
      send({ t: "in", d, seq });
    };
    const publishQueue = () => setQueue({ n: pendingInput.length, held, full });
    // Byte tak pernah menyalip antrean yang belum terkuras: FIFO secara konstruksi, bukan karena
    // jendela 16 ms kebetulan tak kena.
    const sendInput = (d: string) => {
      if (!held && !pendingInput && ws?.readyState === WebSocket.OPEN) { sendFrame(d); return; }
      // Balasan handshake milik sambungan yang sudah mati tak berarti apa pun bagi sambungan
      // berikutnya, dan blob campuran menembus gerbang `isTerminalResponse` di server (SPEC-860).
      if (gone || isTerminalResponse(d)) return;
      if (pendingInput.length + d.length > MAX_PENDING_INPUT) { full = true; publishQueue(); return; }
      pendingInput += d;
      publishQueue();
    };

    // SPEC-856 · echo prediktif.
    let pred = P.initialState();
    const batcher = P.createInputBatcher(sendInput);
    // SPEC-878 · SATU pintu keluar untuk SEMUA jalur input. Yang melewati batcher bisa mendarat di
    // pty SEBELUM ketikan yang masih ditahan jendela 16 ms — terukur `["\x1b","z"]` untuk `z` lalu
    // Escape. `coalesce=false` menguras antrean lebih dulu lalu meneruskan payload UTUH dalam satu
    // frame, jadi "satu tekan = satu keystroke" (SPEC-452) dan "paste utuh" (SPEC-289) tak berubah.
    const sendRaw = (d: string) => batcher.push(d, false);
    sendKey.current = sendRaw;
    const viewOf = (): P.View => {
      const buf = term.buffer.active;
      return {
        cursorX: buf.cursorX, cols: term.cols, deliverable: !gone && !full,
        line: buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "",
      };
    };
    // Jam TTL baru boleh berjalan sesudah SELURUH frame yang sudah dikirim diakui server.
    const clockIfDelivered = () => {
      if (unacked === 0 && ws?.readyState === WebSocket.OPEN) pred = P.onDelivered(pred, Date.now());
    };
    const flushQueue = () => {
      if (!pendingInput || ws?.readyState !== WebSocket.OPEN) { publishQueue(); return; }
      const d = pendingInput;
      pendingInput = "";
      full = false;
      publishQueue();
      sendFrame(d);
    };
    const drainPending = () => {
      // Apa pun yang masih ditahan jendela 16 ms milik antrean ini juga — menguras antrean
      // sebelum batcher akan menukar urutannya.
      batcher.flush();
      if (!pendingInput) { publishQueue(); return; }
      if (SUBMIT.test(pendingInput)) { held = true; publishQueue(); return; }
      flushQueue();
    };
    sendHeld.current = () => { held = false; flushQueue(); };
    dropHeld.current = () => { pendingInput = ""; held = false; full = false; publishQueue(); };
    const onTyped = (d: string) => {
      const wasPredicting = pred.pending.length > 0;
      const r = P.onInput(pred, d, viewOf(), Date.now(), predictRef.current);
      pred = r.state;
      if (r.write) term.write(r.write);
      batcher.push(d, wasPredicting || r.write.length > 0);
    };
    // TTL adalah satu-satunya sinyal yang memisahkan "pty diam" — password dan tombol yang ditelan
    // dialog sama-sama terukur membalas NOL byte — dari "jaringan lambat".
    const ttl = setInterval(() => {
      const r = P.onTick(pred, Date.now());
      pred = r.state;
      if (r.write) term.write(r.write);
    }, 100);

    const connect = () => {
      void api.issueWsTicket(`terminal:${sessionId}`).then(({ ticket }) => {
        if (disposed) return;
        const scheme = location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${scheme}//${location.host}${paths.terminalWs(sessionId)}`, [`hanoman-ticket.${ticket}`]);
        ws = socket;

        socket.onopen = () => {
          attempt = 0;
          seq = 0;
          unacked = 0;
          // SPEC-878 · prediksi yang lahir selama outage adalah satu-satunya yang menulis ke
          // terminal selama itu, jadi kursor duduk persis di ujungnya dan rollback CUB+`\x1b[K`
          // masih sah — prasyarat yang sama yang sudah dipegang modul. Ia ditulis SEBELUM apa pun
          // dari server; apa yang benar-benar ada di pty digambar ulang tmux sesudahnya.
          const back = P.rollbackSeq(pred.pending.length);
          if (back) term.write(back);
          // tmux memutar ulang layar penuh saat attach — tak ada prediksi yang boleh diwarisi.
          pred = P.onReattach();
          setLink({ state: "open" });
          if (visibleRect()) {
            const finePointer = typeof window.matchMedia !== "function"
              || window.matchMedia("(hover: hover) and (pointer: fine)").matches;
            if (finePointer) term.focus();
            // Geometri yang berubah selagi putus hilang senyap (`send` no-op saat socket mati),
            // jadi ia wajib mendahului byte antrean — kalau tidak TUI menggambar blob itu untuk
            // geometri lama lalu me-rewrap seluruh layar.
            send({ t: "resize", cols: term.cols, rows: term.rows });
          }
          // Dikuras di SETIAP open, bukan hanya yang pertama: itu yang mengubah buffer SPEC-771
          // dari penyembunyi kegagalan menjadi penyelamat ketikan.
          drainPending();
        };
        socket.onmessage = (ev) => {
          const f = JSON.parse(ev.data as string) as {
            t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean;
            on?: boolean; seq?: number;
          };
          if (f.t === "data") {
            const r = P.onServerData(pred, f.d ?? "", Date.now());
            pred = r.state;
            // Rollback dan data server WAJIB satu panggilan write: keadaan antara tak boleh pernah
            // dirender, dan itulah yang membuat layar byte-identik dengan tanpa prediksi.
            term.write(r.write);
            if (r.tail) {
              const buf = term.buffer.active;
              const line = buf.getLine(buf.viewportY + buf.cursorY)?.translateToString(true) ?? "";
              const tail = r.tail.slice(P.echoedPrefixLen(line.slice(0, buf.cursorX), r.tail));
              const back = P.reapply(pred, tail, viewOf(), Date.now(), predictRef.current);
              pred = back.state;
              if (back.write) term.write(back.write);
            }
            clockIfDelivered();
          }
          // SPEC-878 · ADR-0134 · pengakuan pengiriman: satu-satunya titik nol jam TTL prediksi.
          else if (f.t === "ack") { unacked = Math.max(0, unacked - 1); clockIfDelivered(); }
          // Server menyiarkan fase saat attach dan setiap kali agen menutup satu (SPEC-162).
          // SPEC-433 · sejak sekarang juga saat `complete` berubah tanpa daftar fase berubah —
          // kotak `- [ ]` terakhir di plan dicentang sesudah `Execute done`.
          else if (f.t === "phase") phaseRef.current?.(f.phases ?? [], f.complete === true);
          // SPEC-863 · alternate screen PANE. Ia tak bisa dibaca dari aliran: tmux tak pernah
          // meneruskan `?1049h/l` milik program di dalam pane, dan `?1049h` yang memang sampai
          // adalah milik klien tmux sendiri — menyala di byte pertama, tak pernah padam.
          else if (f.t === "alt") pred = P.onPaneAltScreen(pred, f.on === true);
          else if (f.t === "exit") {
            finished = true;
            term.write(`\r\n\x1b[33m— sesi berakhir (exit ${f.code}) —\x1b[0m\r\n`);
            exitRef.current(f.code ?? 0);
          }
        };
        // 4004 = sesi tmux-nya memang sudah lenyap; menyambung ulang hanya menghasilkan badai 404.
        socket.onclose = (event) => {
          if (disposed || finished) return;
          if (event.code === 4004) {
            gone = true;
            // Byte yang diantre tak akan pernah punya tujuan, jadi layar tak boleh terus
            // menampilkannya seolah ia akan sampai.
            const back = P.rollbackSeq(pred.pending.length);
            if (back) term.write(back);
            pred = P.onReattach();
            pendingInput = "";
            held = false;
            full = false;
            publishQueue();
            setLink({ state: "gone" });
            return;
          }
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
        void navigator.clipboard?.readText().then((t) => { if (t) sendRaw(t); });
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
    const typed = term.onData(onTyped);

    // SPEC-771 · viewport internal xterm 6 tak memiliki pemilik gesture touch. Tanpa handler
    // passive-false ini swipe bubble ke page scroller meski scrollback terminal masih tersedia.
    let touchY: number | null = null;
    let touchRemainder = 0;
    let touchScrolled = false;
    const resetTouch = () => { touchY = null; touchRemainder = 0; touchScrolled = false; };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { resetTouch(); return; }
      touchY = event.touches[0]!.clientY;
      touchRemainder = 0;
      touchScrolled = false;
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
        touchScrolled = true;
      }
      event.preventDefault();
    };
    // SPEC-800 · xterm tak menerjemahkan sentuhan menjadi laporan mouse, jadi tap tak pernah sampai
    // ke dialog claude. SPEC-452 mengukur jalur yang sampai: SATU digit memilih baris bernomor itu.
    // Gerbangnya footer dialog Ink — di layar kerja biasa tap tak mengirim apa pun.
    const onTouchEnd = (event: TouchEvent) => {
      const tapped = touchY !== null && !touchScrolled;
      const clientY = event.changedTouches?.[0]?.clientY ?? touchY;
      resetTouch();
      if (!tapped || clientY === null || clientY === undefined) return;
      const rect = visibleRect();
      if (!rect || term.rows <= 0) return;
      const row = Math.floor((clientY - rect.top) / (rect.height / term.rows));
      const buffer = term.buffer.active;
      const lines = Array.from({ length: term.rows },
        (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? "");
      const choice = dialogChoiceAt(lines, row);
      if (choice) sendRaw(choice);
    };
    // SPEC-816 · lampiran gambar. Yang bisa dikirim ke PTY hanyalah teks, jadi berkasnya diunggah
    // lebih dulu dan yang masuk ke prompt adalah PATH-nya — agen membacanya sendiri dengan Read.
    // Ini juga yang membuatnya lepas dari clipboard mesin server: umur sesi tak lagi jadi variabel.
    const attach = async (files: File[]) => {
      for (const file of files) {
        try {
          const { path } = await api.uploadTerminalAttachment(sessionId, file);
          // Spasi, bukan Enter: operator melanjutkan mengetik kalimatnya di sebelah path.
          // sendInput menampung ke `pendingInput` bila socket sedang menyambung ulang.
          sendRaw(`${path} `);
        } catch (e) {
          term.write(`\r\n\x1b[31mlampiran gagal: ${(e as Error).message}\x1b[0m\r\n`);
        }
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      const files = imageFilesFrom(event.clipboardData);
      if (!files.length) return;      // teks polos tetap milik jalur lama
      event.preventDefault();
      void attach(files as File[]);
    };
    const onDragOver = (event: DragEvent) => {
      if (hasImageDrag(event.dataTransfer)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      const files = imageFilesFrom(event.dataTransfer);
      if (!files.length) return;
      event.preventDefault();
      void attach(files as File[]);
    };
    el.addEventListener("paste", onPaste);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
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
      sendHeld.current = () => {};
      dropHeld.current = () => {};
      view.current = null;
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", resetTouch);
      ro.disconnect();
      clearInterval(ttl);
      batcher.dispose();
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
      {/* Diam adalah cacatnya (audit SPEC-800 §3); diam tak boleh jadi bagian perbaikannya.
          SPEC-878 · strip juga bicara saat sambungan sehat: antrean yang ditahan karena memuat
          Enter adalah keputusan yang menunggu operator, bukan keadaan koneksi. */}
      {((link.state !== "open" && link.state !== "connecting") || queue.held || queue.full) && (
        <div data-testid="terminal-link" style={{
          display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto", flexWrap: "wrap",
          padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 11,
          background: link.state === "retrying" || queue.held
            ? "var(--status-warn-tint)" : "var(--status-err-tint)",
          color: "var(--text-body)",
        }}>
          {link.state === "retrying" && <span>menyambung ulang… ({link.attempt}/{RECONNECT_MAX})</span>}
          {link.state === "gone" && <span>sesi tidak ditemukan di tmux</span>}
          {link.state === "lost" && <>
            <span>terputus</span>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => retryNow.current()}>Sambungkan lagi</button>
          </>}
          {queue.n > 0 && !queue.held && (
            <span data-testid="terminal-queue">{queue.n} ketikan diantre</span>
          )}
          {queue.held && <>
            <span data-testid="terminal-held">{queue.n} ketikan tertahan — belum dikirim</span>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => sendHeld.current()}>Kirim</button>
            <button type="button" className="hn-terminal-action hn-terminal-action--text"
              onClick={() => dropHeld.current()}>Buang</button>
          </>}
          {queue.full && <span data-testid="terminal-queue-full">antrean penuh</span>}
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
