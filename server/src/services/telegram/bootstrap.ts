import type { FastifyInstance } from "fastify";
import { mkdirSync } from "node:fs";
import { resolveHome } from "@hanoman/runner";
import type { Setting } from "@hanoman/shared";
import { prisma } from "../../db";
import { effectiveStr } from "../../config";
import { verifyAgentToken as verifyAgentTokenReal } from "../agent-token";
import { ensureCodexTrust } from "../codex-trust";
import { getSetting as getSettingReal } from "../settings";
import { createSession, getSession, killSession, sendToPane } from "../pty";
import { TelegramApiClient } from "./client";
import { setTelegramEngine, telegramAgentDefaults, telegramEngineContext } from "./config";
import { TelegramGateway } from "./gateway";
import { TelegramSessionCoordinator, type TelegramSessionCoordinatorDeps } from "./session";
import { TelegramStore } from "./store";
import { registerTelegramRuntimeStop, setTelegramRuntime, stopTelegramRuntime } from "./runtime";

export const TELEGRAM_REQUIRED_CAPABILITIES = [
  "projects:read", "projects:write", "backlog:read", "backlog:write",
  "sessions:read", "sessions:write", "docs:read", "docs:write",
  "ide:read", "ide:write", "vps:read", "vps:write",
  "settings:read", "settings:write", "support:read", "support:write",
  "notifications:read", "notifications:write", "lead:read", "lead:write",
  "agents:read", "telegram:read", "telegram:write",
  // ADR-0155 · empat capability berbahaya yang dipecah dari `:write`. Gateway menjalankan pekerjaan
  // operator PENUH — termasuk membuka sesi — jadi ia menuntut semuanya.
  //
  // Konsekuensi yang DISENGAJA: token gateway lama berhenti menyalakan gateway sampai manusia
  // mencentang keempatnya, karena `credentials.ts` menolak start bila satu pun kurang (bukan 403
  // per-panggilan). Itu kelas kegagalan SPEC-491, jadi panel Settings menampilkan daftar yang
  // kurang dan release note menyebutnya breaking change.
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec",
] as const;

type RuntimeAgent = { id: string; capabilities: string[] };
type GatewayLifecycle = { start(): Promise<void>; stop(): Promise<void> };

export type TelegramGatewayFactoryInput = {
  apiBase: string;
  botToken: string;
  agentToken: string;
  allowedUserIds: ReadonlySet<string>;
  progress: boolean;
};
export type TelegramGatewayFactory = (input: TelegramGatewayFactoryInput) => Promise<{
  gateway: GatewayLifecycle;
  botUsername: string | null;
}>;

type BootstrapOptions = {
  apiBase: string;
  /**
   * SPEC-477 · ADR-0097 · kredensial datang dari resolver config (DB → env → default), BUKAN
   * `process.env` langsung. Itulah yang membuat Settings menang atas `.env` sekaligus menjaga
   * instance lama tetap hidup. `env` (seam SPEC-476) tetap didukung dan berarti
   * "baca dari peta ini".
   */
  read?: (key: string) => string | undefined;
  env?: Record<string, string | undefined>;
  getSetting?: () => Promise<Setting>;
  verifyAgentToken?: (token: string) => Promise<RuntimeAgent | null>;
  factory?: TelegramGatewayFactory;
};

export function parseTelegramAllowedUserIds(raw: string): Set<string> {
  const ids = raw.split(/[\s,]+/).filter(Boolean);
  if (!ids.length) throw new Error("Telegram allowlist wajib berisi numeric user id");
  if (ids.some((id) => !/^\d+$/.test(id))) throw new Error("Telegram allowlist hanya menerima numeric user id");
  return new Set(ids);
}

type ReadConfig = (key: string) => string | undefined;

const configuredFrom = (read: ReadConfig): boolean =>
  Boolean(read("HANOMAN_TELEGRAM_BOT_TOKEN")?.trim()
    && read("HANOMAN_TELEGRAM_ALLOWED_USER_IDS")?.trim()
    && read("HANOMAN_TELEGRAM_AGENT_TOKEN")?.trim());

/**
 * SPEC-492 · deps coordinator diberi nama supaya `defaults` bisa dibuktikan tanpa jaringan —
 * `productionFactory` memanggil `client.getMe()` di baris pertamanya. Ini menamai sesuatu yang
 * sudah ada di sana, bukan seam yang diarang demi test.
 */
export function telegramSessionDeps(input: {
  apiBase: string; agentToken: string; store: TelegramStore;
}): TelegramSessionCoordinatorDeps {
  return {
    store: input.store,
    port: { getSession, createSession, sendToPane, killSession },
    // SPEC-492 · BUKAN `sessionAgentDefaults`: sesi operator Telegram sebagian besar membaca API
    // lalu merangkum, bukan menulis kode, jadi ia boleh punya runtime/model/effort sendiri.
    defaults: telegramAgentDefaults,
    engine: { read: telegramEngineContext, write: setTelegramEngine },
    personality: async (id, projectId) => {
      if (!id) return null;
      const row = await prisma.customAgent.findUnique({ where: { id } });
      if (!row?.enabled || (row.projectId !== null && row.projectId !== projectId)) return null;
      return { name: row.name, description: row.description, instructions: row.instructions };
    },
    ensureCodexTrust,
    home: resolveHome(),
    apiBase: input.apiBase,
    agentToken: input.agentToken,
    ensureDir: (path) => mkdirSync(path, { recursive: true }),
  };
}

async function productionFactory(input: TelegramGatewayFactoryInput) {
  const client = new TelegramApiClient(input.botToken);
  const me = await client.getMe();
  const store = new TelegramStore(prisma);
  const coordinator = new TelegramSessionCoordinator(telegramSessionDeps({
    apiBase: input.apiBase, agentToken: input.agentToken, store,
  }));
  const gateway = new TelegramGateway({
    client,
    store,
    dispatcher: coordinator,
    allowedUserIds: input.allowedUserIds,
    rateLimit: { limit: 20, windowMs: 60_000 },
    exactSecrets: [input.botToken, input.agentToken],
    progress: input.progress,
  });
  return { gateway, botUsername: me.username ?? null };
}

/** Dipanggil dari server.ts sesudah listen, custom-agent cache, dan history hook siap. */
export async function installTelegramGateway(_app: FastifyInstance, options: BootstrapOptions): Promise<void> {
  lastBootstrap = { app: _app, options };
  const env = options.env;
  // Tanpa `read` maupun `env` eksplisit, sumbernya resolver config — BUKAN `process.env`.
  const read: ReadConfig = options.read ?? (env ? (key) => env[key] : effectiveStr);
  const setting = await (options.getSetting ?? getSettingReal)();
  const configured = configuredFrom(read);
  const base = {
    configured,
    enabled: setting.telegram.enabled,
    running: false,
    botUsername: null,
    allowlistCount: 0,
    agentTokenConfigured: Boolean(read("HANOMAN_TELEGRAM_AGENT_TOKEN")?.trim()),
    missingCapabilities: [] as string[],
    lastUpdateAt: null,
    lastError: null,
  };
  if (!setting.telegram.enabled) {
    setTelegramRuntime({ status: { ...base, readiness: "disabled" } });
    return;
  }
  if (!configured) {
    setTelegramRuntime({ status: { ...base, readiness: "misconfigured", lastError: "kredensial Telegram belum lengkap" } });
    return;
  }

  let allowedUserIds: Set<string>;
  try {
    allowedUserIds = parseTelegramAllowedUserIds(read("HANOMAN_TELEGRAM_ALLOWED_USER_IDS")!);
  } catch (error) {
    setTelegramRuntime({ status: { ...base, readiness: "misconfigured", lastError: (error as Error).message } });
    return;
  }
  const verify = options.verifyAgentToken ?? verifyAgentTokenReal;
  const agent = setting.agentAccessEnabled ? await verify(read("HANOMAN_TELEGRAM_AGENT_TOKEN")!) : null;
  const missing = agent
    ? TELEGRAM_REQUIRED_CAPABILITIES.filter((capability) => !agent.capabilities.includes(capability))
    : [...TELEGRAM_REQUIRED_CAPABILITIES];
  if (!agent || missing.length) {
    setTelegramRuntime({
      agentTokenId: agent?.id ?? null,
      status: {
        ...base,
        allowlistCount: allowedUserIds.size,
        missingCapabilities: missing,
        readiness: "misconfigured",
        lastError: agent ? "capability AgentToken Telegram belum lengkap" : "AgentToken Telegram tidak valid atau akses agent mati",
      },
    });
    return;
  }

  try {
    const built = await (options.factory ?? productionFactory)({
      apiBase: options.apiBase,
      botToken: read("HANOMAN_TELEGRAM_BOT_TOKEN")!,
      agentToken: read("HANOMAN_TELEGRAM_AGENT_TOKEN")!,
      allowedUserIds,
      progress: setting.telegram.progress,
    });
    await built.gateway.start();
    setTelegramRuntime({
      agentTokenId: agent.id,
      status: {
        ...base,
        configured: true,
        enabled: true,
        running: true,
        readiness: "running",
        botUsername: built.botUsername,
        allowlistCount: allowedUserIds.size,
        missingCapabilities: [],
      },
    });
    registerTelegramRuntimeStop(() => built.gateway.stop());
  } catch {
    setTelegramRuntime({
      agentTokenId: agent.id,
      status: {
        ...base,
        allowlistCount: allowedUserIds.size,
        readiness: "error",
        lastError: "gagal memverifikasi atau memulai Telegram Bot API",
      },
    });
  }
}

// Pemasangan terakhir, supaya reload bisa memakai apiBase & seam yang sama tanpa server.ts
// menyimpannya sendiri.
let lastBootstrap: { app: FastifyInstance; options: BootstrapOptions } | null = null;

/**
 * SPEC-477 · ADR-0097 · terapkan perubahan kredensial/toggle TANPA restart proses.
 * Menghentikan gateway lama dulu: satu bot hanya boleh dipoll satu proses (ADR-0096 konsekuensi 1),
 * dan dua loop `getUpdates` atas token yang sama akan saling mencuri update (Telegram 409).
 */
export async function reloadTelegramGateway(): Promise<void> {
  if (!lastBootstrap) return;
  await stopTelegramRuntime();
  await installTelegramGateway(lastBootstrap.app, lastBootstrap.options);
}
