import { describe, expect, it, vi } from "vitest";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { buildMcpServer } from "../src/mcp/server";
import type { CallResult, Caller } from "../src/mcp/client";
import type { McpConfig } from "../src/mcp/config";

/** Transport in-memory: `serveStdio` menerima `options.transport`, jadi loop protokol asli diuji. */
class PairedTransport {
  sent: Record<string, any>[] = [];
  onmessage?: (m: unknown) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
  async start(): Promise<void> { /* noop */ }
  async send(m: Record<string, unknown>): Promise<void> { this.sent.push(m); }
  async close(): Promise<void> { this.onclose?.(); }
  feed(m: unknown): void { this.onmessage?.(m); }
}

const cfg: McpConfig = { host: "http://h", token: "hnm_agt_secret", level: "default", maxBytes: 24576, problems: [] };
const tick = () => new Promise((r) => setTimeout(r, 40));
type CallArgs = Parameters<Caller>;
const okCall = () =>
  vi.fn(async (..._a: CallArgs): Promise<CallResult> => ({ ok: true, body: { items: [], total: 0, page: 1, pageSize: 20 } }));

async function boot(over: Partial<McpConfig> = {}, call = okCall()) {
  const t = new PairedTransport();
  serveStdio(() => buildMcpServer({ ...cfg, ...over }, call, "9.9.9"), { transport: t as never });
  t.feed({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  await tick();
  return { t, call };
}
const reply = (t: PairedTransport, id: number) => t.sent.find((m) => m.id === id) as { result?: any };

describe("buildMcpServer", () => {
  it("initialize membawa instructions yang menyebut versi skema tool", async () => {
    const { t } = await boot();
    expect(reply(t, 1)?.result.instructions).toContain("versi 1");
    expect(reply(t, 1)?.result.serverInfo.name).toBe("hanoman");
  });

  // Angka tool TIDAK di-hardcode di sini: katalog memang tumbuh, dan angka mati hanya membuat
  // berkas ini disunting berulang tanpa menjaga apa pun. Yang dijaga adalah SIFATNYA — tingkat
  // yang lebih sempit adalah HIMPUNAN BAGIAN yang lebih kecil, dan tool tulis benar-benar HILANG
  // dari baca-saja alih-alih hanya menolak saat dipanggil (ADR-0099 §5).
  it("tools/list menyusut menurut tingkat, dan tool tulis HILANG di baca-saja", async () => {
    const listAt = async (over: Partial<McpConfig>) => {
      const { t } = await boot(over);
      t.feed({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      await tick();
      return (reply(t, 2) as { result: { tools: { name: string }[] } }).result.tools.map((x) => x.name);
    };
    const ro = await listAt({ level: "read-only" });
    const def = await listAt({ level: "default" });
    const dg = await listAt({ level: "danger" });

    expect(ro.length).toBeLessThan(def.length);
    expect(def.length).toBeLessThan(dg.length);
    for (const n of ro) expect(def, n).toContain(n);
    for (const n of def) expect(dg, n).toContain(n);

    expect(ro).not.toContain("hanoman_backlog_create");
    expect(def).toContain("hanoman_backlog_create");
    // Tool berbahaya hanya ada di tingkat danger.
    expect(def).not.toContain("hanoman_session_create");
    expect(dg).toContain("hanoman_session_create");
  });

  it("tools/call menerjemahkan argumen jadi permintaan REST yang benar", async () => {
    const call = okCall();
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: { project: "hanoman", startable: true } } });
    await tick();
    expect(call.mock.calls[0]?.[0]).toMatchObject({ method: "GET", path: "/specs", query: { project: "hanoman", startable: "true" } });
  });

  it("payload yang tak cocok dengan source DITOLAK KLIEN — tak pernah sampai ke REST", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: {} }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "hanoman_backlog_create", arguments: {
      project: "p", source: "qa", title: "t", priority: "tinggi",
      payload: { context: "a", outcome: "b", constraints: "c", priority: "tinggi" },
    } } });
    await tick();
    expect(reply(t, 4)?.result.isError).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it("galat REST jadi isError berisi kalimat, bukan lemparan protokol", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: false, message: "Token kurang capability `backlog:write`." }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: {} } });
    await tick();
    expect(reply(t, 5)?.result.isError).toBe(true);
    expect(reply(t, 5)?.result.content[0].text).toContain("backlog:write");
  });

  it("hasil dipotong pada plafon byte dan ditandai truncated", async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: `SPEC-${i}`, projectId: "p", title: "x".repeat(120), stage: "planned", priority: "sedang",
      objective: "o", createdAt: "c", startedAt: null, source: "brief", branchFrom: null,
      dependsOn: [], blockedBy: [], baseSha: null,
    }));
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { items: many, total: 300, page: 1, pageSize: 300 } }));
    const { t } = await boot({ maxBytes: 3000 }, call);
    t.feed({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "hanoman_backlog_search", arguments: {} } });
    await tick();
    const text = reply(t, 6)?.result.content[0].text as string;
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(JSON.parse(text).truncated).toBe(true);
  });

  it("hanoman_about menyebut host, mode, versi skema — dan TIDAK menyebut token", async () => {
    const { t } = await boot();
    t.feed({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "hanoman_about", arguments: {} } });
    await tick();
    const text = reply(t, 7)?.result.content[0].text as string;
    const about = JSON.parse(text) as Record<string, unknown>;
    expect(about).toMatchObject({ host: "http://h", mode: "default", toolSchemaVersion: 1, hanomanCli: "9.9.9" });
    // ADR-0155 · `hanoman_about` wajib menyatakan bahwa tingkat mode bukan gerbang keamanan:
    // agen yang menemukan sebuah tool tak ada tak boleh menyimpulkan ia berhak memanggilnya.
    expect(String(about.modeNote)).toMatch(/bukan kontrol keamanan/i);
    expect(text).not.toContain("hnm_agt_secret");
    expect(JSON.stringify(about)).not.toMatch(/token/i);
  });

  it("hanoman_about tetap menjawab meski konfigurasi bermasalah, dan menyebut keluhannya", async () => {
    const { t } = await boot({ token: "", problems: ["HANOMAN_AGENT_TOKEN belum diisi."] });
    t.feed({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "hanoman_about", arguments: {} } });
    await tick();
    expect(reply(t, 8)?.result.content[0].text).toContain("HANOMAN_AGENT_TOKEN belum diisi");
  });

  it("token tak pernah lolos ke hasil tool", async () => {
    const call = vi.fn(async (): Promise<CallResult> => ({ ok: true, body: { bocor: "hnm_agt_secret" } }));
    const { t } = await boot({}, call);
    t.feed({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "hanoman_ticket_get", arguments: { ticket: "t1" } } });
    await tick();
    expect(reply(t, 9)?.result.content[0].text).not.toContain("hnm_agt_secret");
  });
});
