import {
  CODEX_MODELS, claudeEfforts, MODELS, codexEfforts, coerceCodexEffort,
  type Agent, type AgentEngine,
} from "@hanoman/shared";

/**
 * SPEC-492 · empat command runtime yang DICEGAT server, bukan diteruskan ke pane operator.
 * Alasannya bukan selera: (1) ia soal transport, dan agen tak bisa mengubah model proses yang
 * sedang menjalankan dirinya sendiri; (2) giliran agen terukur 14-95 detik — menukar effort tak
 * boleh membayar itu; (3) ia harus bekerja justru saat agennya macet, yaitu keadaan yang paling
 * mungkin membuat orang ingin menurunkan effort. Presedennya sudah ada: gateway mencegat update
 * `callback` konfirmasi sebelum `dispatch`.
 *
 * Berkas ini MURNI: nol DB, nol IO, nol Telegram. Semua keadaan masuk lewat `EngineContext`.
 */

const AGENT_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex CLI" };

/**
 * `kind` outbox untuk balasan yang DIKARANG server. Sengaja di luar `TELEGRAM_REPLY_KINDS`:
 * `dedupeKey` outbox adalah `chat:update:kind`, jadi memakai kind milik sesi operator akan
 * membuat baris ini menelan reply agen untuk update yang sama (SPEC-491).
 */
export const TELEGRAM_CONTROL_KIND = "gateway-control";

export type EngineTriple = { agent: Agent; model: string; effort: string };

export type EngineContext = {
  /** `Setting.telegram.engine.enabled` — sedang memakai setelan sendiri atau mewarisi. */
  enabled: boolean;
  /** Yang BERLAKU untuk sesi operator berikutnya (= `telegramAgentDefaults()`). */
  effective: EngineTriple;
  /** Blok global claude — dipakai saat `/runtime claude` (cermin `pickAgent` di UI). */
  claude: { model: string; effort: string };
  /** Blok global codex — dipakai saat `/runtime codex`. */
  codex: { model: string; effort: string };
};

export type EngineCommand =
  | { kind: "show" }
  | { kind: "restart" }
  | { kind: "set"; engine: AgentEngine; label: string }
  | { kind: "invalid"; message: string };

const claudeModels = (): string[] => MODELS.map((m) => m.id);
const codexModels = (): string[] => CODEX_MODELS.map((m) => m.id);
const effortsFor = (t: EngineTriple): readonly string[] =>
  t.agent === "codex" ? codexEfforts(t.model) : claudeEfforts(t.model);

const usage = [
  "Setelan runtime sesi operator Telegram:",
  "`/engine` — lihat setelan sekarang",
  "`/runtime claude|codex` — tukar runtime",
  "`/model <id>` — tukar model",
  "`/effort <nilai>` — tukar effort",
  "`/engine off` — kembali ikut default global sesi kerja",
  "`/engine restart` — tutup sesi operator supaya setelan berlaku sekarang",
].join("\n");

/**
 * `null` = BUKAN command runtime → pemanggil melanjutkan jalur lama persis seperti sebelumnya
 * (fail-closed: yang tak dikenali tak pernah ditelan).
 */
export function parseEngineCommand(text: string, ctx: EngineContext): EngineCommand | null {
  const match = text.trim().match(/^\/(engine|runtime|model|effort)(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  const verb = match[1]!.toLowerCase();
  const arg = (match[2] ?? "").trim();

  if (verb === "engine") {
    if (!arg) return { kind: "show" };
    const word = arg.toLowerCase();
    if (word === "off" || word === "mati") {
      return {
        kind: "set",
        engine: { enabled: false, ...ctx.effective },
        label: "Setelan operator Telegram → ikut default global sesi kerja",
      };
    }
    if (word === "restart" || word === "ulang") return { kind: "restart" };
    return { kind: "invalid", message: usage };
  }

  if (verb === "runtime") {
    const word = arg.toLowerCase();
    if (word !== "claude" && word !== "codex") {
      return { kind: "invalid", message: "Runtime hanya `claude` atau `codex`. Contoh: `/runtime codex`" };
    }
    const agent = word as Agent;
    const base = agent === "codex" ? ctx.codex : ctx.claude;
    const effort = agent === "codex" ? coerceCodexEffort(base.model, base.effort) : base.effort;
    return {
      kind: "set",
      engine: { enabled: true, agent, model: base.model, effort },
      label: `Runtime → ${AGENT_LABEL[agent]}`,
    };
  }

  if (verb === "model") {
    const agent = ctx.effective.agent;
    const own = agent === "codex" ? codexModels() : claudeModels();
    const other = agent === "codex" ? claudeModels() : codexModels();
    if (!own.includes(arg)) {
      if (other.includes(arg)) {
        const swap: Agent = agent === "codex" ? "claude" : "codex";
        return {
          kind: "invalid",
          message: `\`${arg}\` adalah model ${AGENT_LABEL[swap]}, sedangkan runtime aktif `
            + `${AGENT_LABEL[agent]}. Jalankan \`/runtime ${swap}\` dulu.`,
        };
      }
      return { kind: "invalid", message: `Model ${AGENT_LABEL[agent]} yang sah: ${own.join(", ")}.` };
    }
    const effort = agent === "codex" ? coerceCodexEffort(arg, ctx.effective.effort) : ctx.effective.effort;
    return {
      kind: "set",
      engine: { enabled: true, agent, model: arg, effort },
      label: `Model → ${arg}`,
    };
  }

  // verb === "effort"
  const allowed = effortsFor(ctx.effective);
  if (!arg || !allowed.includes(arg)) {
    return {
      kind: "invalid",
      message: `Effort yang sah untuk \`${ctx.effective.model}\`: ${allowed.join(", ")}.`,
    };
  }
  return {
    kind: "set",
    engine: { enabled: true, ...ctx.effective, effort: arg },
    label: `Effort → ${arg}`,
  };
}

const triple = (t: EngineTriple): string =>
  `${AGENT_LABEL[t.agent]} · \`${t.model}\` · \`${t.effort}\``;

export function formatEngineStatus(ctx: EngineContext, sessionAlive: boolean): string {
  return [
    `Sesi operator berikutnya: ${triple(ctx.effective)}`,
    ctx.enabled
      ? "Sumber: setelan sendiri untuk kanal Telegram."
      : "Sumber: default global sesi kerja (belum pakai setelan sendiri).",
    sessionAlive
      ? "Sesi operator sekarang masih hidup dan tetap memakai setelan lamanya — `/engine restart` untuk menutupnya."
      : "Belum ada sesi operator yang hidup; pesan berikutnya lahir dengan setelan di atas.",
    "",
    usage,
  ].join("\n");
}

export function formatEngineApplied(next: AgentEngine, label: string, sessionAlive: boolean): string {
  const head = next.enabled
    ? `${label}. Sesi operator berikutnya: ${triple(next)}`
    : `${label}. Sesi operator berikutnya mengikuti default global sesi kerja.`;
  return [
    head,
    sessionAlive
      ? "Sesi yang sedang jalan tidak diubah — ia satu proses, satu model seumur hidup. `/engine restart` menutupnya; ringkasan & memory tetap tersimpan."
      : "Berlaku untuk sesi operator berikutnya yang dibuat.",
  ].join("\n");
}
