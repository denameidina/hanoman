import { describe, it, expect } from "vitest";
import {
  parseEngineCommand, formatEngineStatus, formatEngineApplied, type EngineContext,
} from "../src/services/telegram/engine-command";

const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({
  enabled: false,
  effective: { agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  claude: { model: "claude-opus-5", effort: "xhigh" },
  codex: { model: "gpt-5.6-sol", effort: "xhigh" },
  ...over,
});

describe("SPEC-492 · parser command runtime Telegram", () => {
  // Fail-closed: apa pun yang bukan command runtime WAJIB kembali null supaya jalur lama
  // (diteruskan ke pane operator) tetap persis seperti sebelumnya.
  it("teks biasa & command lain kembali null", () => {
    for (const t of ["status proyek", "/help", "/status", "/projects", "/models", "", "runtime codex"]) {
      expect(parseEngineCommand(t, ctx())).toBeNull();
    }
  });

  it("/engine tanpa argumen = tampilkan", () => {
    expect(parseEngineCommand("/engine", ctx())).toEqual({ kind: "show" });
  });

  it("/engine off mematikan override tanpa mengubah triple-nya", () => {
    const cmd = parseEngineCommand("/engine off", ctx({
      enabled: true, effective: { agent: "codex", model: "gpt-5.5", effort: "medium" },
    }));
    expect(cmd).toMatchObject({
      kind: "set", engine: { enabled: false, agent: "codex", model: "gpt-5.5", effort: "medium" },
    });
  });

  it("/engine restart", () => {
    expect(parseEngineCommand("/engine restart", ctx())).toEqual({ kind: "restart" });
  });

  it("/engine kata-asing = invalid yang menerangkan cara pakai", () => {
    const cmd = parseEngineCommand("/engine turbo", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("/runtime");
  });

  // Menyetel nilai lalu tak terjadi apa-apa adalah jebakan yang sama dengan bug yang diperbaiki
  // spec ini. Menyebut runtime/model/effort = memilih memakainya.
  it("/runtime codex menyalakan override dan menukar model+effort sekalian", () => {
    expect(parseEngineCommand("/runtime codex", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    });
  });

  it("/runtime selain claude|codex ditolak", () => {
    expect(parseEngineCommand("/runtime gemini", ctx())?.kind).toBe("invalid");
  });

  it("/model memakai katalog runtime yang sedang berlaku", () => {
    expect(parseEngineCommand("/model haiku", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "claude", model: "haiku", effort: "xhigh" },
    });
  });

  // SPEC-339 · effort adalah properti MODEL: Luna tak mendukung `ultra`.
  it("/model codex mengoersi effort ke katalog model barunya", () => {
    const c = ctx({ enabled: true, effective: { agent: "codex", model: "gpt-5.6-sol", effort: "ultra" } });
    expect(parseEngineCommand("/model gpt-5.6-luna", c)).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" },
    });
  });

  it("/model milik agen SEBERANG menyebut jalan keluarnya, bukan sekadar 'tidak valid'", () => {
    const cmd = parseEngineCommand("/model gpt-5.6-sol", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("/runtime codex");
  });

  it("/model asing menolak dan menyebut daftar yang sah", () => {
    const cmd = parseEngineCommand("/model gpt-9-belum-ada", ctx());
    expect(cmd?.kind).toBe("invalid");
    expect((cmd as { message: string }).message).toContain("opus");
  });

  it("/effort menerima nilai katalog dan menolak sisanya", () => {
    expect(parseEngineCommand("/effort low", ctx())).toMatchObject({
      kind: "set", engine: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "low" },
    });
    expect(parseEngineCommand("/effort santai", ctx())?.kind).toBe("invalid");
  });

  it("/effort codex hanya menawarkan effort model aktif", () => {
    const c = ctx({ enabled: true, effective: { agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" } });
    expect(parseEngineCommand("/effort ultra", c)?.kind).toBe("invalid");
    expect(parseEngineCommand("/effort max", c)?.kind).toBe("set");
  });

  it("status menyebut sumber nilai dan keadaan sesi", () => {
    expect(formatEngineStatus(ctx(), false)).toContain("default global");
    const on = formatEngineStatus(ctx({ enabled: true }), true);
    expect(on).toContain("setelan sendiri");
    expect(on).toContain("/engine restart");
  });

  // AC-6 · sesi yang sedang jalan TIDAK di-restart diam-diam; balasannya harus mengatakannya.
  it("balasan 'tersimpan' menerangkan kapan berlaku", () => {
    const next = { enabled: true, agent: "claude" as const, model: "claude-haiku-4-5", effort: "low" };
    expect(formatEngineApplied(next, "Model → claude-haiku-4-5", true)).toContain("/engine restart");
    expect(formatEngineApplied(next, "Model → claude-haiku-4-5", false)).toContain("berikutnya");
  });
});
