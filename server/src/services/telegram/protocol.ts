import { createHash } from "node:crypto";

export type AcceptedTelegramInput = {
  updateId: number;
  chatId: string;
  userId: string;
  messageId: number;
  kind: "text" | "command" | "callback";
  text: string;
  callbackQueryId?: string;
  callbackToken?: string;
  callbackAction?: "approve" | "deny";
  /** ADR-0228 · tombol izin hanoman-lead (`tgla:<approvalId>:approve|deny`). */
  leadApprovalId?: string;
};

export type TelegramUpdateResult =
  | { ok: true; input: AcceptedTelegramInput }
  | { ok: false; updateId: number | null; reason: string; chatId?: string; userId?: string };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export function normalizeTelegramCommand(text: string): string {
  const clean = text.trim();
  const match = clean.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return clean;
  const args = match[2]?.trim().replace(/\s+/g, " ");
  return `/${match[1]!.toLowerCase()}${args ? ` ${args}` : ""}`;
}

export function parseConfirmationCallback(data: string): { token: string; action: "approve" | "deny" } | null {
  if (data.length > 64) return null;
  const match = data.match(/^tgcf:([A-Za-z0-9_-]{1,40}):(approve|deny)$/);
  return match ? { token: match[1]!, action: match[2] as "approve" | "deny" } : null;
}

/** ADR-0228 · `tgla:<approvalId>:approve|deny` — tombol izin tindakan hanoman-lead. */
export function parseLeadApprovalCallback(data: string): { approvalId: string; action: "approve" | "deny" } | null {
  if (data.length > 64) return null;
  const match = data.match(/^tgla:([A-Za-z0-9_-]{1,40}):(approve|deny)$/);
  return match ? { approvalId: match[1]!, action: match[2] as "approve" | "deny" } : null;
}

export function parseTelegramUpdate(update: unknown, allowlist: ReadonlySet<string>, maxText = 12_000): TelegramUpdateResult {
  const root = record(update);
  const updateId = root && Number.isInteger(root.update_id) && Number(root.update_id) >= 0
    ? Number(root.update_id)
    : null;
  if (!root || updateId === null) return { ok: false, updateId: null, reason: "malformed" };

  const callback = record(root.callback_query);
  const message = callback ? record(callback.message) : record(root.message);
  const from = callback ? record(callback.from) : record(message?.from);
  const chat = record(message?.chat);
  const chatId = typeof chat?.id === "number" && Number.isSafeInteger(chat.id) ? String(chat.id) : undefined;
  const userId = typeof from?.id === "number" && Number.isSafeInteger(from.id) ? String(from.id) : undefined;

  if (!message || !from || !chat || !chatId || !userId) return { ok: false, updateId, reason: "malformed", chatId, userId };
  if (chat.type !== "private") return { ok: false, updateId, reason: "group", chatId, userId };
  if (from.is_bot === true) return { ok: false, updateId, reason: "sender-bot", chatId, userId };
  if (!allowlist.has(userId)) return { ok: false, updateId, reason: "not-allowed", chatId, userId };
  const messageId = typeof message.message_id === "number" && Number.isInteger(message.message_id)
    ? message.message_id
    : null;
  if (messageId === null) return { ok: false, updateId, reason: "malformed", chatId, userId };

  if (callback) {
    const callbackQueryId = typeof callback.id === "string" ? callback.id : "";
    const data = typeof callback.data === "string" ? callback.data : "";
    const lead = parseLeadApprovalCallback(data);
    if (callbackQueryId && lead) {
      return {
        ok: true,
        input: {
          updateId, chatId, userId, messageId, kind: "callback", text: data,
          callbackQueryId, callbackAction: lead.action, leadApprovalId: lead.approvalId,
        },
      };
    }
    const parsed = parseConfirmationCallback(data);
    if (!callbackQueryId || !parsed) return { ok: false, updateId, reason: "invalid-callback", chatId, userId };
    return {
      ok: true,
      input: {
        updateId, chatId, userId, messageId, kind: "callback", text: data,
        callbackQueryId, callbackToken: parsed.token, callbackAction: parsed.action,
      },
    };
  }

  if (typeof message.text !== "string" || !message.text.trim()) {
    return { ok: false, updateId, reason: "non-text", chatId, userId };
  }
  const text = normalizeTelegramCommand(message.text);
  if (text.length > maxText) return { ok: false, updateId, reason: "too-long", chatId, userId };
  return {
    ok: true,
    input: {
      updateId, chatId, userId, messageId,
      kind: text.startsWith("/") ? "command" : "text",
      text,
    },
  };
}

export function inboundDigest(input: Pick<AcceptedTelegramInput, "updateId" | "chatId" | "userId" | "kind" | "text">): string {
  return createHash("sha256")
    .update(`${input.updateId}\0${input.chatId}\0${input.userId}\0${input.kind}\0${input.text}`, "utf8")
    .digest("hex");
}

const ANSI = /[\u001b\u009b](?:\][^\u0007]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g;
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const CREDENTIAL_PATTERNS = [
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g,
  /\bhnm_(?:agent_)?[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
];

export function sanitizeTelegramOutput(text: string, exactSecrets: readonly string[] = []): string {
  let clean = text.replace(ANSI, "").replace(CONTROLS, "");
  for (const secret of [...exactSecrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    clean = clean.split(secret).join("[REDACTED]");
  }
  for (const pattern of CREDENTIAL_PATTERNS) clean = clean.replace(pattern, "[REDACTED]");
  return clean.trim();
}

export function splitTelegramText(text: string, max = 4_096, exactSecrets: readonly string[] = []): string[] {
  if (!Number.isInteger(max) || max < 1) throw new Error("max harus integer positif");
  const clean = sanitizeTelegramOutput(text, exactSecrets);
  if (!clean) return [];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > max) {
    let cut = max;
    const before = rest.charCodeAt(cut - 1);
    const after = rest.charCodeAt(cut);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) cut--;
    const window = rest.slice(0, cut);
    const newline = window.lastIndexOf("\n");
    const space = window.lastIndexOf(" ");
    const boundary = Math.max(newline, space);
    if (boundary >= Math.floor(max / 2)) cut = boundary + 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * SPEC-491 · amplop yang DIKARANG gateway, di luar `TELEGRAM_REPLY_KINDS`: `dedupeKey` outbox
 * adalah `chat:update:kind`, jadi memakai kind milik session operator akan membuat baris gateway
 * MENELAN reply session untuk update yang sama.
 */
export const TELEGRAM_GATEWAY_FAILURE_KIND = "gateway-failure";

/**
 * SPEC-493 · balasan yang MENGAKHIRI giliran. Sesudahnya typing tak di-arm ulang — Telegram tak
 * punya API stop-typing, jadi cara menghentikannya adalah membiarkan timernya habis. `decision` dan
 * `confirmation` ikut final karena keduanya mengembalikan giliran ke manusia: mengetik "hanoman
 * sedang mengetik" sementara yang ditunggu justru jawaban user adalah kebohongan. Non-final hanya
 * `progress`.
 */
export const TELEGRAM_FINAL_REPLY_KINDS: ReadonlySet<string> = new Set([
  "final", "decision", "failure", "confirmation", TELEGRAM_GATEWAY_FAILURE_KIND,
]);
