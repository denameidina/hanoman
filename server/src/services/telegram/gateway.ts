import { createHash } from "node:crypto";
import type { TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate } from "./client";
import { TelegramApiError } from "./client";
import {
  TELEGRAM_FINAL_REPLY_KINDS, TELEGRAM_GATEWAY_FAILURE_KIND,
  inboundDigest, parseTelegramUpdate, sanitizeTelegramOutput, splitTelegramText,
  type AcceptedTelegramInput,
} from "./protocol";
import type { TelegramStore } from "./store";
import { telegramRuntimeStatus, updateTelegramRuntimeStatus } from "./runtime";
import { TelegramTypingIndicator, TYPING_MAX_WAIT_MS, pollTimeoutFor } from "./typing";

export type TelegramGatewayClient = {
  getUpdates(input: { offset: number; limit: number; timeout: number; signal?: AbortSignal }): Promise<TelegramUpdate[]>;
  sendMessage(input: { chatId: string; text: string; replyMarkup?: TelegramInlineKeyboardMarkup }): Promise<TelegramMessage>;
  answerCallbackQuery(input: { callbackQueryId: string; text?: string }): Promise<boolean>;
  sendChatAction(chatId: string, action: "typing"): Promise<boolean>;
};

export type TelegramInputDispatcher = {
  // SPEC-492 · `control: true` = command runtime yang sudah dijawab coordinator sendiri.
  dispatch(input: AcceptedTelegramInput): Promise<{ sessionId: string; created: boolean; control?: true }>;
};

type GatewayDeps = {
  client: TelegramGatewayClient;
  store: TelegramStore;
  dispatcher: TelegramInputDispatcher;
  allowedUserIds: ReadonlySet<string>;
  rateLimit: { limit: number; windowMs: number };
  exactSecrets: readonly string[];
  progress: boolean;
  pollTimeout?: number;
  typing?: TelegramTypingIndicator;
  /**
   * ADR-0228 · tombol izin hanoman-lead. Opsional: default memuat `lead/approvals` saat tombol
   * pertama ditekan, supaya gateway tak menarik seluruh modul lead saat boot.
   */
  decideLeadApproval?: (id: string, d: { approve: boolean; by: string }) => Promise<{ status: string } | null>;
};

const digestRaw = (update: unknown): string => createHash("sha256").update(JSON.stringify(update)).digest("hex");

export class TelegramGateway {
  private abort: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;
  private readonly typing: TelegramTypingIndicator;

  constructor(private readonly deps: GatewayDeps) {
    this.typing = deps.typing ?? new TelegramTypingIndicator({
      client: deps.client,
      enabled: deps.progress,
    });
  }

  async processUpdates(updates: readonly unknown[]): Promise<void> {
    for (const raw of updates) await this.processUpdate(raw);
  }

  private async processUpdate(raw: unknown): Promise<void> {
    const parsed = parseTelegramUpdate(raw, this.deps.allowedUserIds);
    const root = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const rawUpdateId = Number.isInteger(root.update_id) ? Number(root.update_id) : null;
    if (rawUpdateId === null || rawUpdateId < 0) return;
    const meta = parsed.ok
      ? {
          updateId: parsed.input.updateId,
          chatId: parsed.input.chatId,
          userId: parsed.input.userId,
          kind: parsed.input.kind,
          digest: inboundDigest(parsed.input),
        }
      : {
          updateId: rawUpdateId,
          chatId: parsed.chatId ?? null,
          userId: parsed.userId ?? null,
          kind: "rejected",
          digest: digestRaw(raw),
        };
    if (!await this.deps.store.recordUpdate(meta)) return;
    if (!parsed.ok) {
      await this.deps.store.rejectUpdate(rawUpdateId, parsed.reason);
      await this.deps.store.audit({
        chatId: parsed.chatId ?? null, userId: parsed.userId ?? null, updateId: rawUpdateId,
        action: "inbound", outcome: `rejected:${parsed.reason}`, correlationId: `tg:${rawUpdateId}`,
      });
      return;
    }
    const input = parsed.input;
    if (await this.deps.store.rateLimitExceeded(
      input.userId,
      new Date(Date.now() - this.deps.rateLimit.windowMs),
      this.deps.rateLimit.limit,
    )) {
      await this.deps.store.rejectUpdate(input.updateId, "rate-limit");
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "inbound", outcome: "rejected:rate-limit", correlationId: `tg:${input.updateId}`,
      });
      return;
    }
    if (!await this.deps.store.claimUpdate(input.updateId)) return;
    try {
      if (input.kind === "callback" && input.leadApprovalId && input.callbackAction && input.callbackQueryId) {
        // ADR-0228 · identitas pengirim sudah lolos allowlist di `parseTelegramUpdate`.
        const decide = this.deps.decideLeadApproval
          ?? (async (id: string, d: { approve: boolean; by: string }) => (await import("../lead/approvals")).decideApproval(id, d));
        const v = await decide(input.leadApprovalId, {
          approve: input.callbackAction === "approve", by: `telegram:${input.userId}`,
        }).catch(() => null);
        await this.deps.client.answerCallbackQuery({
          callbackQueryId: input.callbackQueryId,
          text: v ? (v.status === "approved" ? "Disetujui" : "Ditolak") : "Sudah diputuskan atau tak berlaku",
        });
        await this.deps.store.markDispatched(input.updateId);
        return;
      }
      if (input.kind === "callback" && input.callbackToken && input.callbackAction && input.callbackQueryId) {
        const outcome = await this.deps.store.resolveConfirmation({
          callbackToken: input.callbackToken,
          chatId: input.chatId,
          userId: input.userId,
          action: input.callbackAction,
        });
        const answer = outcome === "approved" ? "Disetujui"
          : outcome === "denied" ? "Dibatalkan"
            : outcome === "expired" ? "Konfirmasi kedaluwarsa" : "Konfirmasi tidak valid";
        await this.deps.client.answerCallbackQuery({ callbackQueryId: input.callbackQueryId, text: answer });
        if (outcome !== "approved" && outcome !== "denied") {
          await this.deps.store.markDispatched(input.updateId);
          return;
        }
        input.text = `[confirmation ${outcome}] ${input.callbackToken}`;
      }
      const target = await this.deps.dispatcher.dispatch(input);
      await this.deps.store.markDispatched(input.updateId);
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "dispatch",
        // SPEC-492 · command runtime dijawab gateway sendiri; jejaknya harus bisa dibedakan dari
        // pesan yang benar-benar sampai ke sesi operator.
        outcome: target.control ? "control" : target.created ? "session-created" : "session-reused",
        correlationId: `tg:${input.updateId}`,
      });
      // SPEC-493 · ADR-0104 (mengamandemen ADR-0096 §5) · gateway TAK LAGI mengarang pesan teks.
      // Kehadirannya sekarang indikator "typing…" yang tak meninggalkan jejak di chat, digerbangi
      // `Setting.telegram.progress` di dalam indikator. `arm` tak pernah melempar, jadi ia tak
      // butuh `catch` sendiri dan tak bisa mengubah dispatch yang SUDAH berhasil jadi kegagalan.
      // SPEC-492 · tak perlu lagi dilewati untuk command runtime (`target.control`): pengecualian
      // itu ada karena teks "Diterima. Diteruskan ke sesi operator." adalah kebohongan kecil di
      // belakang jawaban coordinator — indikator typing tak mengarang apa pun.
      await this.typing.arm(input.chatId);
      updateTelegramRuntimeStatus({ lastUpdateAt: new Date().toISOString(), lastError: null });
    } catch (error) {
      const reason = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 200);
      await this.deps.store.markUpdateUncertain(input.updateId, "dispatch-failed");
      await this.deps.store.audit({
        chatId: input.chatId, userId: input.userId, updateId: input.updateId,
        action: "dispatch", outcome: "uncertain", correlationId: `tg:${input.updateId}`,
      });
      // TIDAK digerbangi `progress`: kegagalan bukan progress. Tanpa baris ini update yang
      // tertangkap lalu gagal berakhir sebagai `uncertain` di DB dan DIAM TOTAL di chat.
      await this.deps.store.enqueueReply({
        chatId: input.chatId, updateId: input.updateId, kind: TELEGRAM_GATEWAY_FAILURE_KIND,
        text: `Pesan Anda tertangkap tapi gagal diteruskan ke sesi operator: ${reason || "sebab tak diketahui"}. `
          + "Kirim ulang setelah masalahnya beres — hanoman tidak pernah mengulanginya sendiri (at-most-once).",
      }).catch(() => {});
      updateTelegramRuntimeStatus({ lastError: reason });
      // Sengaja TIDAK dilempar ulang: satu update yang gagal tak boleh menghentikan sisa batch
      // (sebelumnya lemparan ini keluar sampai `loop`, jadi update berikutnya tak pernah diproses
      // dan `flushOutbox` pada siklus itu terlewat).
    }
  }

  async flushOutbox(): Promise<void> {
    for (;;) {
      const row = await this.deps.store.claimNextOutbox();
      if (!row) return;
      try {
        const text = sanitizeTelegramOutput(row.text, this.deps.exactSecrets);
        const chunks = splitTelegramText(text);
        if (!chunks.length) {
          await this.deps.store.markOutboxFailed(row.id, "empty-after-sanitize");
          continue;
        }
        const confirmation = row.confirmationId ? await this.deps.store.confirmation(row.confirmationId) : null;
        let messageId = 0;
        for (let index = 0; index < chunks.length; index++) {
          const isLast = index === chunks.length - 1;
          const replyMarkup = isLast && confirmation ? {
            inline_keyboard: [[
              { text: "Lanjutkan", callback_data: `tgcf:${confirmation.callbackToken}:approve` },
              { text: "Batalkan", callback_data: `tgcf:${confirmation.callbackToken}:deny` },
            ]],
          } : undefined;
          const message = await this.deps.client.sendMessage({ chatId: row.chatId, text: chunks[index]!, replyMarkup });
          messageId = message.message_id;
          // SPEC-493 · Telegram MENGHAPUS status typing begitu ada pesan masuk, jadi tiap chunk
          // harus mengembalikannya — kecuali chunk terakhir dari balasan final: di sana giliran
          // memang sudah selesai dan Telegram tak punya API stop-typing, jadi timernya dibiarkan
          // habis sendiri.
          if (!(isLast && TELEGRAM_FINAL_REPLY_KINDS.has(row.kind))) await this.typing.arm(row.chatId);
        }
        await this.deps.store.markOutboxSent(row.id, messageId);
      } catch (error) {
        const message = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 500);
        if (error instanceof TelegramApiError && error.code !== undefined) {
          await this.deps.store.markOutboxFailed(row.id, message);
        } else {
          await this.deps.store.markOutboxUncertain(row.id, message || "network-outcome-unknown");
        }
      }
    }
  }

  async start(): Promise<void> {
    if (this.loopPromise) return;
    await this.deps.store.recoverUncertainClaims();
    await this.deps.store.recoverUncertainOutbox();
    this.abort = new AbortController();
    updateTelegramRuntimeStatus({ running: true, readiness: "running", lastError: null });
    this.loopPromise = this.loop(this.abort.signal).finally(() => {
      this.loopPromise = null;
      this.abort = null;
      updateTelegramRuntimeStatus({ running: false });
    });
  }

  private async loop(signal: AbortSignal): Promise<void> {
    const idlePollTimeout = this.deps.pollTimeout ?? 25;
    while (!signal.aborted) {
      try {
        // SPEC-493 · ADR-0104 · long-poll adaptif = denyut typing TANPA timer baru (ADR-0024).
        // Refresh mendahului `getUpdates` supaya indikator sudah menyala saat poll mulai memblokir;
        // dengan pekerjaan in-flight timeout turun ke 4 dtk, jadi tiap iterasi jadi tick alami
        // untuk typing SEKALIGUS `flushOutbox()` — jeda kirim balasan 10-12 dtk ikut hilang.
        const waiting = await this.deps.store.chatsAwaitingReply(new Date(Date.now() - TYPING_MAX_WAIT_MS));
        await this.typing.refresh(waiting);
        const updates = await this.deps.client.getUpdates({
          offset: await this.deps.store.offset(), limit: 100,
          timeout: pollTimeoutFor(waiting.length, idlePollTimeout), signal,
        });
        // SPEC-491 · poll yang berhasil MEMULIHKAN status. Tanpa ini satu kedip jaringan
        // meninggalkan `readiness: "error"` selamanya — hanya `processUpdate` yang sukses yang
        // membersihkan `lastError`, dan itu tak terjadi pada poll kosong (kasus lazim).
        if (telegramRuntimeStatus().readiness === "error") {
          updateTelegramRuntimeStatus({ running: true, readiness: "running", lastError: null });
        }
        // `finally`: outbox tetap harus terkuras walau pemrosesan batch melempar — di dalamnya
        // ada justru pemberitahuan kegagalan yang harus sampai ke operator.
        try { await this.processUpdates(updates); } finally { await this.flushOutbox(); }
      } catch (error) {
        if (signal.aborted) return;
        const message = sanitizeTelegramOutput((error as Error).message, this.deps.exactSecrets).slice(0, 500);
        updateTelegramRuntimeStatus({ running: false, readiness: "error", lastError: message });
        if (error instanceof TelegramApiError && error.code === 409) return;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    await this.loopPromise;
  }

}
