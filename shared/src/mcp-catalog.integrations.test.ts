// ADR-0193..0195 · katalog integrasi. Yang diuji hanya sifat yang bisa salah DI KATALOG: bentuk
// permintaan yang dirakit `build()`, rahasia yang ditandai, dan batas tingkat mode. Gerbang route
// dan handler diuji di server/test/integrations-agent-access.test.ts.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog integrasi", () => {
  it("SEMUA tool kredensial Telegram menuntut telegram:admin dan hilang dari tingkat default", () => {
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    for (const n of [
      "hanoman_telegram_settings_get", "hanoman_telegram_settings_set",
      "hanoman_telegram_test", "hanoman_telegram_credentials_clear",
    ]) {
      expect(byName(n).capability, n).toBe("telegram:admin");
      expect(def.has(n), n).toBe(false);
    }
    // tool Telegram lama tak tersentuh: capability-nya tetap read/write
    expect(byName("hanoman_telegram_status").capability).toBe("telegram:read");
    expect(byName("hanoman_telegram_context_set").capability).toBe("telegram:write");
  });

  it("settings_set memetakan argumen ke key REST dan hanya mengirim yang disebut", () => {
    const t = byName("hanoman_telegram_settings_set");
    expect(t.build({ allowedUserIds: "1 2", targetChatId: "" })).toEqual({
      method: "PUT", path: "/telegram/settings", body: { HANOMAN_TELEGRAM_ALLOWED_USER_IDS: "1 2" },
    });
    expect(t.secretArgs).toEqual(["botToken", "agentToken"]);
  });

  it("webhook_create tak pernah mengirim allowPrivate/secret, bahkan bila model menyelipkannya", () => {
    const t = byName("hanoman_webhook_create");
    const body = t.build({
      name: "CI", url: "https://x.id/h", events: ["spec.*"], allowPrivate: true, secret: "abcdefghijklmnopqrst",
    })!.body as Record<string, unknown>;
    expect(body).toEqual({ name: "CI", url: "https://x.id/h", events: ["spec.*"] });
  });

  it("webhook_update: allProjects mengirim projectIds null; rotateSecret hanya bila true", () => {
    const t = byName("hanoman_webhook_update");
    expect(t.build({ webhook: "w1", allProjects: true, projectIds: ["p1"] })!.body).toEqual({ projectIds: null });
    expect(t.build({ webhook: "w1", rotateSecret: false })!.body).toEqual({});
    expect(t.build({ webhook: "w1", rotateSecret: true, enabled: false })!.body)
      .toEqual({ enabled: false, rotateSecret: true });
  });

  it("akun klien: password ditandai rahasia; update TIDAK pernah membawa password", () => {
    expect(byName("hanoman_client_account_create").secretArgs).toEqual(["password"]);
    expect(byName("hanoman_client_account_password_reset").secretArgs).toEqual(["password"]);
    const upd = byName("hanoman_client_account_update");
    expect(upd.inputSchema.properties.password).toBeUndefined();
    expect(upd.build({ account: "c1", password: "bocor-12345", disabled: true })!.body).toEqual({ disabled: true });
  });

  it("tool portal merakit path menurut argumen opsional dan selalu membawa asClient", () => {
    const backlog = byName("hanoman_portal_backlog");
    expect(backlog.build({ asClient: "c1", project: "p1" })).toMatchObject({
      path: "/portal/projects/p1/backlog", query: { asClient: "c1" },
    });
    expect(backlog.build({ asClient: "c1", project: "p1", spec: "SPEC-9" })).toMatchObject({
      path: "/portal/projects/p1/backlog/SPEC-9", query: { asClient: "c1" },
    });
    const chat = byName("hanoman_portal_chat_sessions");
    expect(chat.build({ asClient: "c1", project: "p1", session: "s1", page: 2 })).toMatchObject({
      path: "/portal/projects/p1/chat/sessions/s1", query: { asClient: "c1", page: "2" },
    });
    expect(chat.build({ asClient: "c1", project: "p/1" })!.path).toBe("/portal/projects/p%2F1/chat/sessions");
  });

  it("tool portal tampil di baca-saja (mode read), tool tulis integrasi tidak", () => {
    const ro = new Set(mcpToolsFor("read-only").map((t) => t.name));
    expect(ro.has("hanoman_portal_projects")).toBe(true);
    expect(ro.has("hanoman_webhooks_list")).toBe(true);
    expect(ro.has("hanoman_client_accounts_list")).toBe(true);
    expect(ro.has("hanoman_webhook_create")).toBe(false);
    expect(ro.has("hanoman_telegram_settings_get")).toBe(false);
  });
});
