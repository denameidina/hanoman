import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTING } from "../src/services/settings";
import { dashboardOrigin, decisionMessage, pushDecisionToTelegram } from "../src/services/telegram/notify";
import type { TelegramTransport } from "../src/services/telegram/client";

const TOKEN = "123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz";
const PUSH = { title: "Rapikan modul pembayaran", specId: "SPEC-77", sessionId: "spec-77" };

const config = (env: Record<string, string | undefined>) => (key: string) => env[key];
const settings = (notifyDecisionTelegram: boolean) => async () => ({ ...DEFAULT_SETTING, notifyDecisionTelegram });

function recorder(respond: (chatId: string) => Response = () => ok()) {
  const calls: { url: string; body: { chat_id: string; text: string } }[] = [];
  const transport: TelegramTransport = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), body });
    return respond(body.chat_id);
  };
  return { calls, transport };
}
const ok = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1, date: 1, chat: { id: 1, type: "private" } } }));

describe("pushDecisionToTelegram (ADR-0226)", () => {
  const live = { BOT: TOKEN, IDS: "11 22" };
  const read = config({ HANOMAN_TELEGRAM_BOT_TOKEN: live.BOT, HANOMAN_TELEGRAM_ALLOWED_USER_IDS: live.IDS });

  it("mengirim satu pesan ke tiap user id allowlist, berisi judul, spec, sesi, dan tautan", async () => {
    const { calls, transport } = recorder();
    const sent = await pushDecisionToTelegram(PUSH, {
      getSetting: settings(true), read, transport, origin: "https://hanoman.example.com",
    });
    expect(sent).toBe(2);
    expect(calls.map((c) => c.body.chat_id)).toEqual(["11", "22"]);
    expect(calls[0]!.url).toContain(`/bot${TOKEN}/sendMessage`);
    expect(calls[0]!.body.text).toContain("Rapikan modul pembayaran");
    expect(calls[0]!.body.text).toContain("SPEC-77 · sesi spec-77");
    expect(calls[0]!.body.text).toContain("https://hanoman.example.com/terminal");
  });

  it("toggle mati → tak ada pengiriman", async () => {
    const { calls, transport } = recorder();
    expect(await pushDecisionToTelegram(PUSH, { getSetting: settings(false), read, transport })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["bot token kosong", { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "11" }],
    ["allowlist kosong", { HANOMAN_TELEGRAM_BOT_TOKEN: TOKEN }],
    ["allowlist tanpa id numerik", { HANOMAN_TELEGRAM_BOT_TOKEN: TOKEN, HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "abc" }],
  ])("%s → tak ada pengiriman", async (_label, env) => {
    const { calls, transport } = recorder();
    expect(await pushDecisionToTelegram(PUSH, { getSetting: settings(true), read: config(env), transport })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("galat transport tak melempar; penerima lain tetap dikirimi", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { calls, transport } = recorder((chatId) =>
      chatId === "11" ? new Response("{}", { status: 403 }) : ok());
    const sent = await pushDecisionToTelegram(PUSH, { getSetting: settings(true), read, transport, origin: null });
    expect(sent).toBe(1);
    expect(calls).toHaveLength(2);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("transport yang melempar & setting yang gagal dibaca tidak lolos sebagai galat", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const boom: TelegramTransport = async () => { throw new Error(`koneksi putus ${TOKEN}`); };
    await expect(pushDecisionToTelegram(PUSH, { getSetting: settings(true), read, transport: boom })).resolves.toBe(0);
    await expect(pushDecisionToTelegram(PUSH, {
      getSetting: async () => { throw new Error("db mati"); }, read, transport: boom,
    })).resolves.toBe(0);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(TOKEN);
    warn.mockRestore();
  });

  it("Telegram yang menggantung dipotong timeout, bukan dibiarkan selamanya", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hang: TelegramTransport = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    expect(await pushDecisionToTelegram(PUSH, { getSetting: settings(true), read, transport: hang, timeoutMs: 20 })).toBe(0);
    warn.mockRestore();
  });
});

describe("tautan dashboard & isi pesan", () => {
  it("origin diambil dari host control pertama; tanpa konfigurasi tidak ada tautan", () => {
    expect(dashboardOrigin({ HANOMAN_CONTROL_ORIGINS: "https://a.example.com, https://b.example.com" }))
      .toBe("https://a.example.com");
    expect(dashboardOrigin({})).toBeNull();
    expect(dashboardOrigin({ HANOMAN_CONTROL_ORIGINS: "bukan-url" })).toBeNull();
    expect(decisionMessage(PUSH, null)).not.toContain("http");
  });

  it("judul panjang dipotong; backlog tanpa spec tetap terbaca", () => {
    const text = decisionMessage({ title: "x".repeat(500), specId: null, sessionId: "s1" }, null);
    expect(text.split("\n")[1]!.length).toBe(200);
    expect(text).toContain("sesi s1");
  });
});

describe("scanDecisions memicu push (ADR-0226)", () => {
  const push = vi.fn();
  beforeEach(() => { push.mockReset(); vi.resetModules(); });

  async function scanner() {
    vi.doMock("../src/services/telegram/notify", () => ({ pushDecisionToTelegram: push }));
    const mod = await import("../src/services/notifications");
    const db = await import("./factory");
    await db.resetDb();
    mod.__resetAwaiting();
    return mod;
  }
  const marker = () => {
    const f = join(mkdtempSync(join(tmpdir(), "hanoman-push-")), "sess");
    writeFileSync(f, "waiting\n");
    return f;
  };

  it("satu episode → satu push, scan ulang tak menggandakan", async () => {
    push.mockResolvedValue(1);
    const { scanDecisions } = await scanner();
    const f = marker();
    const read = () => [{ id: "sess1", specId: undefined, projectId: "p1", decisionFile: f, waiting: true }];
    await scanDecisions(read);
    await scanDecisions(read);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ title: "sess1", specId: null, sessionId: "sess1" });
  });

  it("sesi yang tak benar-benar menunggu tidak memicu push", async () => {
    const { scanDecisions } = await scanner();
    const f = marker();
    await scanDecisions(() => [{ id: "s2", specId: undefined, projectId: "p1", decisionFile: f, waiting: false }]);
    expect(push).not.toHaveBeenCalled();
  });

  it("push yang menggantung selamanya tidak menahan scanDecisions", async () => {
    push.mockReturnValue(new Promise(() => {}));
    const { scanDecisions } = await scanner();
    const f = marker();
    await scanDecisions(() => [{ id: "s3", specId: undefined, projectId: "p1", decisionFile: f, waiting: true }]);
    expect(push).toHaveBeenCalledTimes(1);
  });
});
