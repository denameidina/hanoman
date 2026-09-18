/* SPEC-1215 §S9 AC-D10 · ADR-0166 §2 · sadapan console.* — keluaran ASLI selalu diteruskan
   lebih dulu (AC-D10), redaksi dan spool sesudahnya. Baris identik beruntun dalam
   LOG_REPEAT_WINDOW_MS digabung (`data.repeat`): kemunculan PERTAMA langsung ditulis, repeat
   beruntun sesudahnya ditekan dan diringkas satu baris `data.repeat` sekali di akhir jendela —
   bukan ditulis satu-satu tiap baris identik. */
import { LOG_REPEAT_WINDOW_MS, type LogWireEntry } from "@hanoman/shared";
import { redactText } from "@hanoman/shared";
import { appendSpool } from "./spool";
import { knownSecrets } from "./redact-known";
import { appendEvent } from "./event-log";

type Level = "log" | "info" | "warn" | "error" | "debug";
const LEVEL_MAP: Record<Level, "debug" | "info" | "warn" | "error"> = {
  log: "info", info: "info", warn: "warn", error: "error", debug: "debug",
};

let installed = false;
let originals: Partial<Record<Level, (...a: unknown[]) => void>> = {};
let last: { level: Level; msg: string; repeats: number; timer: NodeJS.Timeout | null } | null = null;
let seqLocal = 0;

function spoolNow(level: Level, rawMsg: string, repeats: number): void {
  let redacted: string;
  try { redacted = redactText(rawMsg, knownSecrets()); }
  catch {
    void appendEvent({
      kind: "log.gap", level: "warn", msg: "redaksi console gagal",
      data: { lost: 1, reason: "redaction-failed" },
    });
    return;
  }
  const entry: LogWireEntry = {
    seq: String(++seqLocal), ts: new Date().toISOString(), level: LEVEL_MAP[level],
    kind: "console", msg: repeats > 1 ? `${redacted} (×${repeats})` : redacted,
    ...(repeats > 1 ? { data: { repeat: repeats } } : {}),
  };
  void appendSpool("server", entry).catch(() => {
    void appendEvent({
      kind: "log.gap", level: "warn", msg: "spool tak bisa ditulis",
      data: { lost: 1, reason: "spool-write" },
    });
  });
}

/** Menutup baris "aktif" saat ini: bila ia sempat berulang, ringkas SATU baris `data.repeat`
    (repeat pertama sudah ditulis lewat `spoolNow` di kemunculan pertama). */
function flushRepeatSummary(): void {
  if (!last) return;
  const l = last;
  last = null;
  if (l.timer) clearTimeout(l.timer);
  if (l.repeats > 0) spoolNow(l.level, l.msg, l.repeats + 1);
}

function tap(level: Level) {
  return (...args: unknown[]) => {
    originals[level]?.apply(console, args); // AC-D10 · keluaran asli lebih dulu, tanpa perubahan
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (last && last.level === level && last.msg === msg) {
      last.repeats++;
      last.timer ??= setTimeout(flushRepeatSummary, LOG_REPEAT_WINDOW_MS);
      last.timer.unref?.();
      return;
    }
    flushRepeatSummary(); // baris sebelumnya (bila berulang) diringkas sebelum baris baru mulai
    spoolNow(level, msg, 1); // kemunculan PERTAMA baris ini — ditulis langsung, tanpa menunggu
    last = { level, msg, repeats: 0, timer: null };
  };
}

export function installConsoleTap(): void {
  if (installed) return;
  (["log", "info", "warn", "error", "debug"] as Level[]).forEach((level) => {
    originals[level] = console[level];
    console[level] = tap(level);
  });
  installed = true;
}

export function uninstallConsoleTap(): void {
  if (!installed) return;
  flushRepeatSummary();
  (Object.keys(originals) as Level[]).forEach((level) => { console[level] = originals[level]!; });
  originals = {};
  installed = false;
}

export function isConsoleTapInstalled(): boolean { return installed; }
