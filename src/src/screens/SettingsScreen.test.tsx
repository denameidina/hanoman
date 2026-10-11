import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen";
import { bundledModelCatalog } from "@hanoman/shared";
import { CODEX_DEFAULTS, CONFLICT_DEFAULTS, GOAL_DEFAULTS, LEAD_DEFAULTS, PORTAL_CHAT_DEFAULTS, SCHEDULER_DEFAULTS, TELEGRAM_DEFAULTS } from "@hanoman/shared";

const setting = {
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
  notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true,
  notifyDecisionSound: "alert", agentAccessEnabled: true, scheduler: SCHEDULER_DEFAULTS,
  goal: GOAL_DEFAULTS, agent: "claude", codex: CODEX_DEFAULTS, verifyScope: "changed",
  conflict: CONFLICT_DEFAULTS, lead: LEAD_DEFAULTS, telegram: TELEGRAM_DEFAULTS,
  portalChat: { ...PORTAL_CHAT_DEFAULTS, enabled: true },
};
const status = {
  configured: true, enabled: false, running: false, readiness: "ready", botUsername: "hanoman_bot",
  allowlistCount: 1, agentTokenConfigured: true, missingCapabilities: [], lastUpdateAt: null, lastError: null,
};

function json(value: unknown, statusCode = 200) {
  return Promise.resolve({ ok: statusCode < 400, status: statusCode, json: async () => value } as Response);
}

afterEach(() => vi.restoreAllMocks());

// SPEC-477 · ADR-0097 · test SPEC-476 di sini MENGUNCI perilaku lama sebagai kontrak
// ("tanpa input credential", "credential disimpan di env"). Ia sengaja diganti, bukan ditambahi:
// membiarkannya membuat merah yang benar terlihat seperti regresi (pola SPEC-433/475).
const credentials = {
  fields: [
    { key: "HANOMAN_TELEGRAM_BOT_TOKEN", label: "Bot token", kind: "secret", source: "db", hasValue: true, masked: "\u2022\u2022\u2022\u2022Dsaw" },
    { key: "HANOMAN_TELEGRAM_AGENT_TOKEN", label: "AgentToken gateway", kind: "secret", source: "env", hasValue: true, masked: "\u2022\u2022\u2022\u20223456" },
    { key: "HANOMAN_TELEGRAM_ALLOWED_USER_IDS", label: "Allowlist user id", kind: "string", source: "db", hasValue: true, value: "7" },
    { key: "HANOMAN_TELEGRAM_TARGET_CHAT_ID", label: "Chat / Channel ID target", kind: "string", source: "default", hasValue: false, value: null },
  ],
};

function telegramFetch(extra: (path: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const path = String(url);
    const custom = extra(path, init as RequestInit | undefined);
    if (custom) return custom;
    if (path === "/api/settings" && init?.method === "PUT") return json(setting);
    if (path === "/api/settings") return json(setting);
    if (path === "/api/codex/version") return json({ version: null, minRequired: "0.0.0", ok: true });
    if (path === "/api/telegram/status") return json(status);
    if (path === "/api/telegram/settings") return json(credentials);
    if (path === "/api/models") return json(bundledModelCatalog());
    throw new Error(`unexpected fetch ${path}`);
  });
}

async function openTelegramTab() {
  render(<SettingsScreen
    me={{ id: "u1", email: "dena@example.test", role: "admin", createdAt: "2026-08-01T00:00:00.000Z" }}
    onLoggedOut={() => {}}
  />);
  // Telegram kini bagian dari niat "Integrasi & akses": pilih niatnya, lalu bagiannya.
  fireEvent.click(screen.getByRole("button", { name: "Integrasi & akses" }));
  fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
  expect(await screen.findByText("Kredensial Telegram")).toBeInTheDocument();
}

describe("SettingsScreen Telegram kredensial (SPEC-477)", () => {
  it("merender empat field; secret masked & tak pernah menampilkan nilai utuh", async () => {
    telegramFetch();
    await openTelegramTab();
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Bot token")).toHaveAttribute("placeholder", "\u2022\u2022\u2022\u2022Dsaw");
    expect(screen.getByLabelText("AgentToken gateway")).toBeInTheDocument();
    expect((screen.getByLabelText("Allowlist user id") as HTMLInputElement).value).toBe("7");
    expect(screen.getByLabelText("Chat / Channel ID target")).toBeInTheDocument();
  });

  it("menandai field yang masih datang dari .env sebagai deprecated", async () => {
    telegramFetch();
    await openTelegramTab();
    expect(screen.getByText(/dari \.env . deprecated/i)).toBeInTheDocument();
  });

  it("Simpan mengirim hanya field yang diisi", async () => {
    let sent: unknown = null;
    telegramFetch((path, init) => {
      if (path === "/api/telegram/settings" && init?.method === "PUT") {
        sent = JSON.parse(String(init.body));
        return json(credentials);
      }
      return null;
    });
    await openTelegramTab();
    fireEvent.change(screen.getByLabelText("Chat / Channel ID target"), { target: { value: "-1001234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan kredensial" }));
    await waitFor(() => expect(sent).toEqual({ HANOMAN_TELEGRAM_TARGET_CHAT_ID: "-1001234567890" }));
  });

  it("Test Connection menampilkan hasil sukses", async () => {
    telegramFetch((path, init) =>
      path === "/api/telegram/test" && init?.method === "POST"
        ? json({ ok: true, botUsername: "bot_uji", chatId: "42" }) : null);
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/@bot_uji/)).toBeInTheDocument();
  });

  it("Test Connection menampilkan galat apa adanya", async () => {
    telegramFetch((path, init) =>
      path === "/api/telegram/test" && init?.method === "POST"
        ? json({ ok: false, error: "Telegram getMe gagal (401): Unauthorized" }) : null);
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/401/)).toBeInTheDocument();
  });

  it("Hapus kredensial meminta konfirmasi lalu memanggil DELETE", async () => {
    let deleted = false;
    telegramFetch((path, init) => {
      if (path === "/api/telegram/credentials" && init?.method === "DELETE") {
        deleted = true;
        return json({ cleared: ["HANOMAN_TELEGRAM_BOT_TOKEN"], envFallback: [] });
      }
      return null;
    });
    await openTelegramTab();
    fireEvent.click(screen.getByRole("button", { name: "Hapus kredensial" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Keempat nilai dihapus dari database/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus kredensial" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("toggle gateway & progress tetap ada dan mem-PUT settings", async () => {
    const fetchMock = telegramFetch();
    await openTelegramTab();
    // Tiga sakelar: gateway, progress, dan "Pakai setelan sendiri" agen operator (satu komponen override).
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    fireEvent.click(screen.getByRole("switch", { name: "Gateway aktif" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ method: "PUT" })));
  });
});

// SPEC-854 · ADR-0130 · kartu jatah obrolan portal. Ia SENGAJA tak menawarkan pilihan runtime:
// gerbang tool yang menjaga fitur ini adalah flag claude (ADR-0129 gotcha 5).
describe("SettingsScreen obrolan portal klien (SPEC-854)", () => {
  it("kartu ada, jatah terbaca, dan tak ada pemilih agen", async () => {
    telegramFetch();
    render(<SettingsScreen
      me={{ id: "u1", email: "dena@example.test", role: "admin", createdAt: "2026-08-01T00:00:00.000Z" }}
      onLoggedOut={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Agen & model" }));
    expect(await screen.findByText("Obrolan portal klien")).toBeInTheDocument();
    expect((screen.getByLabelText("Jatah brainstorming") as HTMLInputElement).value)
      .toBe(String(PORTAL_CHAT_DEFAULTS.brainstormPerMonth));
    expect((screen.getByLabelText("Jatah pertanyaan") as HTMLInputElement).value)
      .toBe(String(PORTAL_CHAT_DEFAULTS.askPerMonth));
    expect(screen.queryByLabelText("Runtime obrolan portal")).toBeNull();
  });

  it("mengubah jatah menyimpannya lewat PUT /api/settings", async () => {
    const puts: unknown[] = [];
    telegramFetch((path, init) => {
      if (path === "/api/settings" && init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return json(setting);
      }
      return null;
    });
    render(<SettingsScreen
      me={{ id: "u1", email: "dena@example.test", role: "admin", createdAt: "2026-08-01T00:00:00.000Z" }}
      onLoggedOut={() => {}}
    />);
    fireEvent.click(screen.getByRole("button", { name: "Agen & model" }));
    const input = await screen.findByLabelText("Jatah brainstorming");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { portalChat: { brainstormPerMonth: number } }).portalChat.brainstormPerMonth).toBe(5);
  });
});

// Audit UI/UX 2026-10 (P0 Settings): simpan harus jujur — toast sukses hanya setelah PUT berhasil,
// kegagalan membalikkan tampilan, dan kondisi goal tersimpan saat kolom ditinggalkan (bukan per ketikan).
describe("SettingsScreen · simpan jujur (audit P0)", () => {
  const me = { id: "u1", email: "dena@example.test", role: "admin" as const, createdAt: "2026-08-01T00:00:00.000Z" };

  // Sakelar "Notifikasi backlog selesai" adalah sakelar pertama di tab Sesi (belum ber-aria-label).
  const doneSwitch = async () => {
    await screen.findByText("Notifikasi backlog selesai");
    return screen.getAllByRole("switch")[0]!;
  };

  function settingsFetch(put: (init?: RequestInit) => Promise<Response>) {
    const puts: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
      const path = String(url);
      if (path === "/api/settings" && init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return put(init as RequestInit);
      }
      if (path === "/api/settings") return json(setting);
      if (path === "/api/codex/version") return json({ version: null, minRequired: "0.0.0", ok: true });
      // Tab Sesi memuat daftar project untuk pemasangan skill; galatnya kini tampil sebagai toast,
      // jadi mock harus menjawabnya — kalau tidak, toast galat mengotori assertion "belum ada toast".
      if (path.startsWith("/api/projects")) return json({ items: [], total: 0, page: 1, pageSize: 100 });
      if (path === "/api/models") return json(bundledModelCatalog());
      if (path === "/api/telegram/status") return json(status);
      throw new Error(`unexpected fetch ${path}`);
    });
    return puts;
  }

  it("toast sukses menunggu PUT selesai; belum apa-apa saat PUT masih berjalan", async () => {
    localStorage.clear();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const puts = settingsFetch(() => gate.then(() => json(setting)));
    const onToast = vi.fn();
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={onToast} />);
    fireEvent.click(await doneSwitch());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(onToast).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onToast).toHaveBeenCalledWith("Notifikasi backlog selesai · nonaktif", "ok", "check-circle-2"));
  });

  it("PUT gagal: sakelar kembali ke nilai semula dan galat diberi tahu, tanpa toast sukses", async () => {
    localStorage.clear();
    settingsFetch(() => json({ error: "boom" }, 500));
    const onToast = vi.fn();
    render(<SettingsScreen me={me} onLoggedOut={() => {}} onToast={onToast} />);
    const toggle = await doneSwitch();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Gagal menyimpan pengaturan"), "err", "alert-triangle"));
    expect(onToast.mock.calls.some(([msg]) => String(msg).includes("nonaktif"))).toBe(false);
    await waitFor(() => expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true"));
  });

  it("kondisi goal tersimpan saat kolom ditinggalkan, bukan per ketikan", async () => {
    localStorage.clear();
    const puts = settingsFetch(() => json(setting));
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    const area = await screen.findByLabelText("Kondisi mode goal");
    fireEvent.change(area, { target: { value: "s" } });
    fireEvent.change(area, { target: { value: "se" } });
    fireEvent.change(area, { target: { value: "sel" } });
    expect(puts).toHaveLength(0);
    fireEvent.blur(area);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { goal: { condition: string } }).goal.condition).toBe("sel");
  });

  it("Reset ke default meminta konfirmasi dengan daftar dampak sebelum mengirim apa pun", async () => {
    localStorage.clear();
    const puts = settingsFetch(() => json(setting));
    render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
    // Reset tinggal di Lanjutan › Zona bahaya (bukan lagi di tab Umum).
    fireEvent.click(await screen.findByRole("button", { name: "Lanjutan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zona bahaya" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reset ke default" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Kendali jarak jauh, pengiriman log, dan retensi log/i)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Kembalikan ke default" }));
    await waitFor(() => expect(puts).toHaveLength(1));
  });
});
