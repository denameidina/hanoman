import { createHash } from "node:crypto";
import type { Agent, AgentEngine } from "@hanoman/shared";
import { buildTelegramOperatorPrompt } from "@hanoman/runner";
import {
  TELEGRAM_CONTROL_KIND, formatEngineApplied, formatEngineStatus, parseEngineCommand,
  type EngineContext,
} from "./engine-command";
import type { AcceptedTelegramInput } from "./protocol";
import type { TelegramStore } from "./store";

type SessionRef = { id: string; exited: boolean; reused?: true };
type SessionCreateOptions = {
  id: string;
  prompt: string;
  agent: Agent;
  model: string;
  effort: string;
  env: Record<string, string>;
};

export type TelegramSessionPort = {
  getSession(id: string): SessionRef | undefined | Promise<SessionRef | undefined>;
  createSession(projectId: string, cwd: string, opts: SessionCreateOptions): SessionRef | Promise<SessionRef>;
  sendToPane(id: string, text: string): Promise<boolean>;
  /** SPEC-492 · dipakai `/engine restart`: satu-satunya cara setelan runtime berlaku SEKARANG. */
  killSession(id: string): boolean;
};

type Personality = { name: string; description: string; instructions: string };

export type TelegramSessionCoordinatorDeps = {
  store: TelegramStore;
  port: TelegramSessionPort;
  defaults(): Promise<{ agent: Agent; model: string; effort: string }>;
  /** SPEC-492 · permukaan setelan runtime dari dalam chat (`/engine`, `/runtime`, …). */
  engine: {
    read(): Promise<EngineContext>;
    /** `unknown` supaya `setTelegramEngine` (yang mengembalikan nilai tersimpan) langsung pas. */
    write(next: AgentEngine): Promise<unknown>;
  };
  personality(id: string | null, projectId: string | null): Promise<Personality | null>;
  ensureCodexTrust(cwd: string): void;
  home: string;
  apiBase: string;
  agentToken: string;
  ensureDir(path: string): void;
};

const chatHash = (chatId: string): string => createHash("sha256").update(chatId).digest("hex").slice(0, 16);
export const telegramOperatorSessionId = (chatId: string): string => `telegram-${chatHash(chatId)}`;
export const formatTelegramTurn = (input: AcceptedTelegramInput): string =>
  `[Telegram update ${input.updateId} · chat ${input.chatId} · kind ${input.kind}]\n${input.text}`;

export class TelegramSessionCoordinator {
  constructor(private readonly deps: TelegramSessionCoordinatorDeps) {}

  async dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean; control?: true }> {
    if (input.kind === "command") {
      const handled = await this.control(input);
      if (handled) return handled;
    }

    let context = await this.deps.store.chatContext(input.chatId);
    if (!context) {
      const seed = await this.deps.defaults();
      await this.deps.store.ensureChat({
        chatId: input.chatId,
        userId: input.userId,
        agent: seed.agent,
        model: seed.model,
        effort: seed.effort,
      });
      context = await this.deps.store.chatContext(input.chatId);
    }
    if (!context) throw new Error("gagal membuat binding chat Telegram");

    const sessionId = telegramOperatorSessionId(input.chatId);
    const live = await this.deps.port.getSession(sessionId);
    if (live && !live.exited) {
      if (!await this.deps.port.sendToPane(sessionId, formatTelegramTurn(input))) {
        throw new Error("pane operator tidak menerima steer");
      }
      if (context.sessionId !== sessionId) await this.deps.store.bindSession(input.chatId, sessionId);
      return { sessionId, created: false };
    }

    // SPEC-492 · resolver dibaca ULANG di tiap KELAHIRAN sesi. `TelegramChat.agent/model/effort`
    // ditulis sekali saat chat pertama menyapa (`ensureChat` ber-`update:{userId}`) dan tak punya
    // penulis lain — memakainya di sini membuat setelan runtime nol efek untuk setiap chat yang
    // sudah ada, yaitu semua chat di instalasi yang sudah jalan (kelas bug SPEC-487).
    const engine = await this.deps.defaults();
    await this.deps.store.setChatEngine(input.chatId, engine);

    const hash = chatHash(input.chatId);
    const projectId = `telegram:${hash}`;
    const cwd = `${this.deps.home.replace(/\/$/, "")}/telegram/${hash}`;
    this.deps.ensureDir(cwd);
    // Gotcha SPEC-377/ADR-0081: trust diturunkan dari agen HASIL resolver, bukan dari baris chat.
    if (engine.agent === "codex") this.deps.ensureCodexTrust(cwd);
    const personality = await this.deps.personality(context.personalityAgentId, context.activeProjectId);
    const prompt = buildTelegramOperatorPrompt({
      update: input,
      personality,
      summary: context.summary,
      memories: context.memories,
    });
    const born = await this.deps.port.createSession(projectId, cwd, {
      id: sessionId,
      prompt,
      agent: engine.agent,
      model: engine.model,
      effort: engine.effort,
      env: {
        HANOMAN_API_BASE: this.deps.apiBase,
        HANOMAN_TELEGRAM_AGENT_TOKEN: this.deps.agentToken,
        HANOMAN_TELEGRAM_CHAT_ID: input.chatId,
      },
    });
    if (born.id !== sessionId || born.exited) throw new Error("pane operator gagal lahir");
    // Another dispatch may have created this deterministic pane while admission was pending.
    // Its initial prompt contains that turn; this turn must still reach the live operator.
    if (born.reused && !await this.deps.port.sendToPane(sessionId, formatTelegramTurn(input))) {
      throw new Error("pane operator tidak menerima steer");
    }
    await this.deps.store.bindSession(input.chatId, sessionId);
    return { sessionId, created: !born.reused };
  }

  /**
   * SPEC-492 · empat command runtime tak pernah menyentuh pane: ia soal transport, bukan isi
   * hanoman, dan harus tetap bekerja saat agennya justru macet. `null` = bukan command runtime →
   * pemanggil melanjutkan jalur lama persis seperti sebelumnya.
   *
   * Sengaja TIDAK mengetik `/model`/`/effort` ke pane hidup: ADR-0061 mencabut matrix per-fase
   * karena mekanisme itu tak andal, dan SPEC-487 mengukur kelasnya (ketikan ke pane yang sedang
   * menjalankan giliran mendarat sebagai pesan liar). Jalur yang dijanjikan ke operator adalah
   * `/engine restart` — deterministik, dan konteksnya selamat lewat ringkasan + curated memory.
   */
  private async control(
    input: AcceptedTelegramInput,
  ): Promise<{ sessionId: string; created: false; control: true } | null> {
    const ctx: EngineContext = await this.deps.engine.read();
    const cmd = parseEngineCommand(input.text, ctx);
    if (!cmd) return null;

    const sessionId = telegramOperatorSessionId(input.chatId);
    const live = await this.deps.port.getSession(sessionId);
    const alive = Boolean(live && !live.exited);

    let text: string;
    if (cmd.kind === "show") {
      text = formatEngineStatus(ctx, alive);
    } else if (cmd.kind === "invalid") {
      text = cmd.message;
    } else if (cmd.kind === "restart") {
      if (alive) {
        this.deps.port.killSession(sessionId);
        // Aman: pane hidup selalu berarti baris chat-nya sudah ada (`patchChat` melempar bila tidak).
        await this.deps.store.patchChat(input.chatId, { sessionId: null });
        text = "Sesi operator ditutup. Pesan berikutnya lahir dengan setelan sekarang — "
          + "ringkasan & curated memory tetap tersimpan.";
      } else {
        text = "Tak ada sesi operator yang sedang hidup. Pesan berikutnya lahir dengan setelan sekarang.";
      }
    } else {
      await this.deps.engine.write(cmd.engine);
      text = formatEngineApplied(cmd.engine, cmd.label, alive);
    }

    await this.deps.store.enqueueReply({
      chatId: input.chatId, updateId: input.updateId, kind: TELEGRAM_CONTROL_KIND, text,
    });
    return { sessionId, created: false, control: true };
  }
}
