import { describe, it, expect } from "vitest";
import { CONFIG_REGISTRY, configEntry, parseConfigValue, maskSecret } from "@hanoman/shared";

describe("config-registry", () => {
  it("key unik", () => {
    const keys = CONFIG_REGISTRY.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("parse int honor min", () => {
    const e = configEntry("SYNC_TICK_MS")!;
    expect(parseConfigValue(e, "500")).toEqual({ ok: false, error: "min 1000" });
    expect(parseConfigValue(e, "2000")).toEqual({ ok: true, value: "2000" });
    expect(parseConfigValue(e, "abc")).toEqual({ ok: false, error: "harus bilangan bulat" });
  });
  it("parse url http(s)", () => {
    const e = configEntry("SYNC_SERVER_URL")!;
    expect(parseConfigValue(e, "https://h.co").ok).toBe(true);
    expect(parseConfigValue(e, "ftp://h.co").ok).toBe(false);
    expect(parseConfigValue(e, "bukan url").ok).toBe(false);
  });
  it("parse bool normalisasi", () => {
    const e = configEntry("HANOMAN_UPDATE_FETCH")!;
    expect(parseConfigValue(e, "true")).toEqual({ ok: true, value: "1" });
    expect(parseConfigValue(e, "0")).toEqual({ ok: true, value: "0" });
  });
  it("mask last-4", () => {
    expect(maskSecret("abcdefgh")).toBe("••••efgh");
    expect(maskSecret("ab")).toBe("••••");
  });
  it("gitGraph namespace terdaftar + parse valid (SPEC-233)", () => {
    const style = configEntry("gitGraph.style");
    expect(style?.group).toBe("gitGraph");
    expect(style?.default).toBe("rounded");
    expect(parseConfigValue(style!, "angular")).toEqual({ ok: true, value: "angular" });
    const avatars = configEntry("gitGraph.fetchAvatars")!;
    expect(avatars.default).toBe("0");
    expect(parseConfigValue(avatars, "1")).toEqual({ ok: true, value: "1" });
    const load = configEntry("gitGraph.commitsInitialLoad")!;
    expect(parseConfigValue(load, "0")).toEqual({ ok: false, error: "min 1" });
    expect(CONFIG_REGISTRY.filter((e) => e.group === "gitGraph").length).toBeGreaterThanOrEqual(14);
  });
  // SPEC-471 · ADR-0095 · dua knob untuk tarik issue. Token BUKAN knob biasa: ia kredensial,
  // jadi kind `secret` (UI tak pernah menampilkan nilainya kembali).
  it("SPEC-471 · GITHUB_TOKEN & HANOMAN_GH_BIN terdaftar dengan kind yang benar", () => {
    const tok = CONFIG_REGISTRY.find((e) => e.key === "GITHUB_TOKEN");
    expect(tok).toBeDefined();
    expect(tok!.kind).toBe("secret");
    expect(tok!.category).toBe("credential");
    const bin = CONFIG_REGISTRY.find((e) => e.key === "HANOMAN_GH_BIN");
    expect(bin).toBeDefined();
    expect(bin!.kind).toBe("path");
    expect(bin!.default).toBe("gh");
  });
  // SPEC-477 · ADR-0097 · kredensial Telegram pindah dari .env ke store config.
  it("SPEC-477 · empat entri Telegram terdaftar dengan kind & category yang benar", () => {
    const byKey = (k: string) => CONFIG_REGISTRY.find((e) => e.key === k)!;
    for (const k of ["HANOMAN_TELEGRAM_BOT_TOKEN", "HANOMAN_TELEGRAM_AGENT_TOKEN"]) {
      expect(byKey(k).kind).toBe("secret");
      expect(byKey(k).category).toBe("credential");
      expect(byKey(k).group).toBe("telegram");
      expect(byKey(k).apply).toBe("live");
    }
    // allowlist BUKAN rahasia (operator harus bisa membacanya kembali) tapi ia memutuskan siapa
    // yang boleh memerintah bot → kategori credential agar ikut pagar cookie-only.
    expect(byKey("HANOMAN_TELEGRAM_ALLOWED_USER_IDS").kind).toBe("string");
    expect(byKey("HANOMAN_TELEGRAM_ALLOWED_USER_IDS").category).toBe("credential");
    expect(byKey("HANOMAN_TELEGRAM_TARGET_CHAT_ID").category).toBe("knob");
  });

  it("SPEC-477 · parseConfigValue menegakkan pattern", () => {
    const tok = configEntry("HANOMAN_TELEGRAM_BOT_TOKEN")!;
    expect(parseConfigValue(tok, "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"))
      .toEqual({ ok: true, value: "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" });
    expect(parseConfigValue(tok, "bukan-token").ok).toBe(false);
    const chat = configEntry("HANOMAN_TELEGRAM_TARGET_CHAT_ID")!;
    expect(parseConfigValue(chat, "-1001234567890")).toEqual({ ok: true, value: "-1001234567890" });
    expect(parseConfigValue(chat, "@kanal").ok).toBe(false);
    // entri tanpa pattern tak berubah perilakunya
    expect(parseConfigValue(configEntry("HANOMAN_CLAUDE_BIN")!, "claude")).toEqual({ ok: true, value: "claude" });
  });
});


it("Antigravity biner adalah knob executable new-session tanpa inherit credential", () => {
  expect(configEntry("HANOMAN_ANTIGRAVITY_BIN")).toMatchObject({ kind: "path", apply: "new-session", category: "knob", default: "agy" });
  expect(configEntry("HANOMAN_ANTIGRAVITY_BIN")?.inheritEnv).not.toBe(true);
});
