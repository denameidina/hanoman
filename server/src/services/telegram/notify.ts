import { effectiveStr } from "../../config";
import { getSetting as getSettingReal } from "../settings";
import { TelegramApiClient, type TelegramInlineKeyboardMarkup, type TelegramTransport } from "./client";
import { sanitizeTelegramOutput } from "./protocol";

/**
 * ADR-0226 · dorong notifikasi "sesi menunggu keputusan" ke Telegram operator. Sengaja TIDAK lewat
 * gateway percakapan (`runtime.ts`): ia butuh AgentToken ber-capability penuh dan bisa mati tanpa
 * memengaruhi kredensial bot — padahal push cuma perlu bot token + allowlist. Private chat Telegram
 * memakai user id sebagai chat id, jadi allowlist sudah cukup sebagai daftar penerima.
 */
export type DecisionPush = {
  title: string;
  specId: string | null;
  sessionId: string;
};

export type DecisionPushDeps = {
  getSetting?: typeof getSettingReal;
  read?: (key: string) => string | undefined;
  transport?: TelegramTransport;
  /** Origin dashboard; default = host control pertama di `HANOMAN_CONTROL_ORIGINS`. */
  origin?: string | null;
  timeoutMs?: number;
};

const SEND_TIMEOUT_MS = 10_000;
const TITLE_MAX = 200;

/** Allowlist lunak: entri bukan angka dibuang alih-alih menggagalkan seluruh push. */
function recipients(raw: string | undefined): string[] {
  return (raw ?? "").split(/[\s,]+/).filter((id) => /^\d+$/.test(id));
}

/**
 * Tautan hanya bila origin dashboard DIKETAHUI dari konfigurasi (`HANOMAN_CONTROL_ORIGINS`) —
 * tak pernah ditebak dari host request, karena push lahir di pemindai latar tanpa request.
 */
export function dashboardOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const first = env.HANOMAN_CONTROL_ORIGINS?.split(",").map((o) => o.trim()).find(Boolean);
  if (!first) return null;
  try { return new URL(first).origin; } catch { return null; }
}

export function decisionMessage(push: DecisionPush, origin: string | null): string {
  const title = push.title.length > TITLE_MAX ? `${push.title.slice(0, TITLE_MAX - 1)}…` : push.title;
  return [
    "Sesi menunggu keputusanmu",
    title,
    push.specId ? `${push.specId} · sesi ${push.sessionId}` : `sesi ${push.sessionId}`,
    ...(origin ? [`${origin}/terminal`] : []),
  ].join("\n");
}

/**
 * Best-effort: tak pernah melempar. Mengembalikan jumlah penerima yang berhasil dikirimi, supaya
 * pemanggil/test bisa mengamati tanpa mengandalkan efek samping jaringan.
 */
export async function pushDecisionToTelegram(push: DecisionPush, deps: DecisionPushDeps = {}): Promise<number> {
  return pushToAllowlist((origin) => ({ text: decisionMessage(push, origin) }), deps);
}

/**
 * ADR-0228 · tindakan hanoman-lead yang menunggu izin. Toggle yang sama (`notifyDecisionTelegram`)
 * — "sesuatu menunggu keputusanmu" bagi operator adalah satu kategori. Tombolnya `tgla:<id>:…`,
 * ditangani gateway percakapan; bila gateway mati, tautan dashboard tetap ada di pesannya.
 */
export type ApprovalPush = { id: string; title: string; reason: string; report: string[] };

export function approvalMessage(push: ApprovalPush, origin: string | null): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  return [
    "Lead minta izin",
    clip(push.title, TITLE_MAX),
    `Alasan: ${clip(push.reason, 600)}`,
    ...(push.report.length ? [`Gerbang: ${clip(push.report.join("; "), 600)}`] : []),
    ...(origin ? [`${origin}/lead`] : []),
  ].join("\n");
}

export async function pushApprovalToTelegram(push: ApprovalPush, deps: DecisionPushDeps = {}): Promise<number> {
  return pushToAllowlist((origin) => ({
    text: approvalMessage(push, origin),
    replyMarkup: { inline_keyboard: [[
      { text: "Setujui", callback_data: `tgla:${push.id}:approve` },
      { text: "Tolak", callback_data: `tgla:${push.id}:deny` },
    ]] },
  }), deps);
}

/** Satu jalur kirim untuk kedua push: bot token + allowlist, timeout, galat per penerima dicatat. */
async function pushToAllowlist(
  build: (origin: string | null) => { text: string; replyMarkup?: TelegramInlineKeyboardMarkup },
  deps: DecisionPushDeps,
): Promise<number> {
  try {
    const read = deps.read ?? effectiveStr;
    const setting = await (deps.getSetting ?? getSettingReal)();
    if (!setting.notifyDecisionTelegram) return 0;
    const botToken = read("HANOMAN_TELEGRAM_BOT_TOKEN")?.trim();
    const ids = recipients(read("HANOMAN_TELEGRAM_ALLOWED_USER_IDS"));
    if (!botToken || ids.length === 0) return 0;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? SEND_TIMEOUT_MS);
    const send = deps.transport ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const client = new TelegramApiClient(botToken, (url, init) => send(url, { ...init, signal: controller.signal }));
    const msg = build(deps.origin === undefined ? dashboardOrigin() : deps.origin);
    try {
      const results = await Promise.allSettled(ids.map((chatId) => client.sendMessage({ chatId, ...msg })));
      let sent = 0;
      for (const [i, r] of results.entries()) {
        if (r.status === "fulfilled") { sent++; continue; }
        // Penerima yang belum /start bot menjawab 403 — kasus operator yang paling lazim.
        console.warn(`telegram: push keputusan ke ${ids[i]} gagal:`,
          sanitizeTelegramOutput((r.reason as Error).message, [botToken]));
      }
      return sent;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.warn("telegram: push keputusan gagal:", (error as Error).message);
    return 0;
  }
}
