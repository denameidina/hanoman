import {
  configEntry, grantsCapability, maskSecret, parseConfigValue, TELEGRAM_CONFIG_KEYS,
  type Capability, type TelegramConfigKey, type TelegramInboundReadinessView,
} from "@hanoman/shared";
import { clearConfig, effectiveStr, setConfig, sourceOf } from "../../config";
import { verifyAgentToken as verifyAgentTokenReal } from "../agent-token";
import { getSetting as getSettingReal } from "../settings";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "./bootstrap";
import { TelegramApiClient, type TelegramTransport } from "./client";
import { sanitizeTelegramOutput } from "./protocol";
import { telegramRuntimeStatus } from "./runtime";

/**
 * SPEC-477 · ADR-0097 · permukaan kredensial Telegram. Semua I/O lewat resolver config
 * (ADR-0049) dan port `transport`, sehingga berkas ini bisa dites tanpa server maupun jaringan.
 */
export type TelegramCredentialField = {
  key: TelegramConfigKey;
  label: string;
  help?: string;
  kind: "secret" | "string";
  source: "db" | "env" | "default";
  hasValue: boolean;
  masked?: string | null;   // hanya kind secret
  value?: string | null;    // hanya kind non-secret
};
export type TelegramCredentialsView = { fields: TelegramCredentialField[] };
/**
 * SPEC-491 · kesiapan jalur MASUK. Test Connection lama hanya `getMe` + `sendMessage` dengan bot
 * token, jadi hijau-nya bisa berdampingan dengan inbound yang mati total — persis kegagalan yang
 * dilaporkan. Ini gerbang yang sama dengan `installTelegramGateway`, dibaca ulang segar.
 */
export type TelegramInboundReadiness = TelegramInboundReadinessView;
export type TelegramTestResult =
  | { ok: true; botUsername: string | null; chatId: string; inbound: TelegramInboundReadiness }
  | { ok: false; error: string; inbound: TelegramInboundReadiness };

export type TelegramGateDeps = {
  agentToken?: string;
  verify?: (token: string) => Promise<{ id: string; capabilities: string[] } | null>;
  getSetting?: typeof getSettingReal;
  polling?: boolean;
};

/**
 * Gerbang yang menilai TOKEN-nya sendiri — cermin `installTelegramGateway`. Sengaja tak melihat
 * master switch maupun polling: keduanya setelan yang bisa dinyalakan kapan saja, sementara token
 * tak dikenal / capability kurang adalah sifat kredensialnya yang tak akan berubah sendiri.
 */
export async function verifyTelegramAgentToken(token: string, deps: TelegramGateDeps = {}):
  Promise<{ ok: true } | { ok: false; reason: string; missing: string[] }> {
  const agent = await (deps.verify ?? verifyAgentTokenReal)(token);
  if (!agent) {
    return {
      ok: false,
      missing: [...TELEGRAM_REQUIRED_CAPABILITIES],
      reason: "AgentToken tidak dikenal atau sudah dicabut — salin plaintext `hnm_agt_…` dari Akses AI Agent, bukan hash-nya.",
    };
  }
  const missing = TELEGRAM_REQUIRED_CAPABILITIES.filter((c) => !agent.capabilities.includes(c));
  return missing.length
    ? { ok: false, missing, reason: `AgentToken kurang ${missing.length} capability.` }
    : { ok: true };
}

export async function telegramInboundReadiness(deps: TelegramGateDeps = {}): Promise<TelegramInboundReadiness> {
  const polling = deps.polling ?? telegramRuntimeStatus().running;
  const empty: string[] = [];
  const token = deps.agentToken ?? effectiveStr("HANOMAN_TELEGRAM_AGENT_TOKEN")?.trim();
  if (!token) {
    return { ok: false, reason: "AgentToken gateway belum diisi.", missingCapabilities: [...TELEGRAM_REQUIRED_CAPABILITIES], polling };
  }
  const setting = await (deps.getSetting ?? getSettingReal)();
  if (!setting.agentAccessEnabled) {
    return { ok: false, reason: "Akses agent mati — nyalakan master switch di Akses AI Agent.", missingCapabilities: empty, polling };
  }
  const gate = await verifyTelegramAgentToken(token, deps);
  if (!gate.ok) return { ok: false, reason: gate.reason, missingCapabilities: gate.missing, polling };
  if (!polling) {
    return { ok: false, reason: "Kredensial sudah sah tapi gateway belum polling — nyalakan “Gateway aktif”.", missingCapabilities: empty, polling };
  }
  return { ok: true, reason: null, missingCapabilities: empty, polling };
}

const KEYS = TELEGRAM_CONFIG_KEYS;

/** Bot token & AgentToken TAK PERNAH keluar utuh — hanya `masked` + `hasValue`. */
export function telegramCredentialView(): TelegramCredentialsView {
  return {
    fields: KEYS.map((key): TelegramCredentialField => {
      const entry = configEntry(key)!;
      const eff = effectiveStr(key);
      const base = {
        key, label: entry.label, help: entry.help,
        source: sourceOf(key), hasValue: eff !== undefined && eff !== "",
      };
      return entry.kind === "secret"
        ? { ...base, kind: "secret", masked: eff ? maskSecret(eff) : null }
        : { ...base, kind: "string", value: eff ?? null };
    }),
  };
}

/**
 * ADR-0193 · tak ada eskalasi diri lewat kredensial. Gateway Telegram menjalankan pekerjaan operator
 * DENGAN capability AgentToken-nya, atas perintah user yang ada di allowlist. Jadi siapa pun yang
 * boleh mengganti bot token, allowlist, atau AgentToken gateway pada dasarnya menentukan siapa yang
 * mewarisi capability token gateway itu. Untuk pemanggil ber-AGENT TOKEN (bukan cookie manusia),
 * token gateway EFEKTIF — yang baru dikirim di patch, atau yang sudah tersimpan — tidak boleh
 * memegang capability yang tak dimiliki pemanggil. `null` = lolos.
 *
 * Token yang tak bisa diverifikasi (belum diisi / tak dikenal) tak memicu penolakan di sini: gateway
 * dengan token seperti itu tak bisa berjalan (`installTelegramGateway` menolaknya), dan
 * `saveTelegramCredentials` sendiri menolak token baru yang kurang capability.
 */
export async function gatewayEscalation(
  callerCaps: readonly string[],
  patch: Record<string, unknown>,
  deps: Pick<TelegramGateDeps, "verify"> = {},
): Promise<{ error: string; missing: string[] } | null> {
  const key = "HANOMAN_TELEGRAM_AGENT_TOKEN";
  const sent = typeof patch[key] === "string" ? (patch[key] as string).trim() : "";
  const token = sent || effectiveStr(key)?.trim();
  if (!token) return null;
  const target = await (deps.verify ?? verifyAgentTokenReal)(token);
  if (!target) return null;
  const missing = target.capabilities.filter((c) => !grantsCapability([...callerCaps], c as Capability));
  return missing.length
    ? {
      error: "eskalasi ditolak: token gateway Telegram memegang capability yang tak dimiliki token pemanggil — "
        + "mengubah kredensial gateway berarti menentukan siapa yang mewarisinya",
      missing,
    }
    : null;
}

/**
 * Secret dengan string kosong = PERTAHANKAN nilai lama (cermin `PUT /config`), sehingga form
 * bisa dikirim ulang tanpa mengetik ulang token. Validasi lewat `parseConfigValue` — satu jalur
 * dengan `PUT /config`, jadi tak ada dua definisi "token yang sah".
 */
export async function saveTelegramCredentials(
  patch: Record<string, unknown>,
  deps: TelegramGateDeps = {},
): Promise<{ ok: true } | { ok: false; key: string; error: string }> {
  const writes: [TelegramConfigKey, string][] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(KEYS as readonly string[]).includes(key)) return { ok: false, key, error: "key bukan kredensial Telegram" };
    if (typeof raw !== "string") return { ok: false, key, error: "nilai harus string" };
    const entry = configEntry(key)!;
    if (raw.trim() === "") {
      if (entry.kind === "secret") continue;                       // pertahankan yang lama
      return { ok: false, key, error: "tak boleh kosong" };
    }
    const parsed = parseConfigValue(entry, raw);
    if (!parsed.ok) return { ok: false, key, error: parsed.error };
    writes.push([key as TelegramConfigKey, parsed.value]);
  }
  // SPEC-491 · pola `^\S{20,}$` menerima apa saja yang panjang — termasuk digest sha256 64-hex,
  // yang persis tersimpan di instalasi yang melaporkan "diam total". Nilai seperti itu membuat
  // `installTelegramGateway` `return` di gerbang readiness SEBELUM poller lahir: nol `getUpdates`,
  // nol `TelegramUpdate`, nol audit, nol pesan galat. Diadu ke tabel di sini — saat operator masih
  // memandangi formulirnya dan bisa memperbaikinya.
  const agentToken = writes.find(([key]) => key === "HANOMAN_TELEGRAM_AGENT_TOKEN")?.[1];
  if (agentToken !== undefined) {
    const gate = await verifyTelegramAgentToken(agentToken, deps);
    if (!gate.ok) {
      const detail = gate.missing.length < TELEGRAM_REQUIRED_CAPABILITIES.length
        ? `${gate.reason} Kurang: ${gate.missing.join(", ")}.`
        : gate.reason;
      return { ok: false, key: "HANOMAN_TELEGRAM_AGENT_TOKEN", error: detail };
    }
  }
  // Validasi SELURUH patch dulu, baru tulis: satu field salah tak boleh meninggalkan
  // separuh kredensial tersimpan.
  for (const [key, value] of writes) await setConfig(key, value);
  return { ok: true };
}

/**
 * Nilai `.env` lama, bila ada, akan dipakai KEMBALI oleh resolver sesudah baris DB dihapus —
 * itu memang semantik ADR-0049. Dilaporkan eksplisit supaya tak jadi kejutan diam.
 */
export async function clearTelegramCredentials(): Promise<{ cleared: string[]; envFallback: string[] }> {
  const cleared: string[] = [];
  for (const key of KEYS) {
    if (sourceOf(key) === "db") { await clearConfig(key); cleared.push(key); }
  }
  return { cleared, envFallback: KEYS.filter((k) => sourceOf(k) === "env") };
}

export type TestConnectionDeps = TelegramGateDeps & {
  botToken?: string;
  chatId?: string;
  transport?: TelegramTransport;
  timeoutMs?: number;
  now?: () => Date;
};

/**
 * Klien SEKALI PAKAI — bukan klien gateway yang sedang long-poll. Klien itu memegang
 * `AbortController` loop-nya; menumpang di sana menukar "uji koneksi" dengan "putuskan polling".
 */
export async function testTelegramConnection(deps: TestConnectionDeps = {}): Promise<TelegramTestResult> {
  // SPEC-491 · dibaca SELALU, apa pun hasil bot token: keluhan "diam total" justru berasal dari
  // Test Connection hijau yang berdampingan dengan inbound mati. Uji koneksi tanpa kabar soal
  // gerbang masuk adalah uji yang menyesatkan.
  const inbound = await telegramInboundReadiness(deps);
  const botToken = deps.botToken ?? effectiveStr("HANOMAN_TELEGRAM_BOT_TOKEN");
  if (!botToken) return { ok: false, error: "Bot token belum diisi.", inbound };
  const chatId = deps.chatId ?? resolveTestChatId();
  if (!chatId) {
    return { ok: false, inbound, error: "Isi Chat / Channel ID target — atau isi allowlist dengan tepat satu user id." };
  }
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const send = deps.transport ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const transport: TelegramTransport = (url, init) => send(url, { ...init, signal: controller.signal });
  const client = new TelegramApiClient(botToken, transport);
  try {
    const me = await client.getMe();
    const stamp = (deps.now?.() ?? new Date()).toISOString();
    await client.sendMessage({ chatId, text: `hanoman: uji koneksi Telegram berhasil (${stamp}).` });
    return { ok: true, botUsername: me.username ?? null, chatId, inbound };
  } catch (error) {
    const raw = (error as Error).message || "gagal menghubungi Telegram";
    const message = controller.signal.aborted ? `Timeout ${timeoutMs} ms — Telegram tidak menjawab.` : raw;
    // Lapis kedua di atas `TelegramApiClient.safe()`: token & pola credential dibuang total.
    return { ok: false, inbound, error: sanitizeTelegramOutput(message, [botToken]).slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/** Target = field khusus, atau — bila kosong — satu-satunya id di allowlist. */
function resolveTestChatId(): string | null {
  const target = effectiveStr("HANOMAN_TELEGRAM_TARGET_CHAT_ID")?.trim();
  if (target) return target;
  const ids = (effectiveStr("HANOMAN_TELEGRAM_ALLOWED_USER_IDS") ?? "").split(/[\s,]+/).filter(Boolean);
  return ids.length === 1 ? ids[0]! : null;
}
