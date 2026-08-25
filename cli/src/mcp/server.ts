// SPEC-482 · ADR-0099 · merakit McpServer dari katalog. Berkas ini sengaja tipis: seluruh
// pengetahuan produk ada di katalog (`@hanoman/shared`), seluruh pengetahuan jaringan ada di
// `client.ts`. Yang tersisa di sini hanya perekatan protokol.
import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import { MCP_INSTRUCTIONS, MCP_TOOL_SCHEMA_VERSION, mcpToolsFor, renderResult } from "@hanoman/shared";
import type { McpConfig } from "./config";
import type { Caller } from "./client";
import { redactToken } from "./redact";

export function buildMcpServer(cfg: McpConfig, call: Caller, cliVersion: string): McpServer {
  const server = new McpServer({ name: "hanoman", version: cliVersion }, { instructions: MCP_INSTRUCTIONS });
  const tools = mcpToolsFor(cfg.level);
  const mask = (s: string) => redactToken(s, cfg.token);
  const text = (s: string, isError = false) =>
    ({ content: [{ type: "text" as const, text: mask(s) }], ...(isError ? { isError: true } : {}) });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        // Capability disebut di deskripsi supaya 403 bisa diantisipasi agen SEBELUM memanggil.
        description: tool.capability
          ? `${tool.description}\n\nButuh capability \`${tool.capability}\` pada agent token.`
          : tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema as never),
      },
      // `fromJsonSchema` menyerahkan argumen bertipe `unknown` — validasinya sudah dijalankan SDK
      // terhadap skema di katalog sebelum handler ini dipanggil, jadi penyempitannya di sini murni
      // urusan tipe, bukan gerbang keamanan yang hilang.
      async (raw: unknown) => {
        const args = (raw ?? {}) as Record<string, unknown>;
        if (tool.name === "hanoman_about") {
          return text(renderResult({
            host: cfg.host || "(belum diisi)",
            mode: cfg.level,
            // ADR-0155 · disebut di SINI, bukan hanya di dokumen: agen yang menemukan sebuah tool
            // tak ada perlu tahu bahwa menyalakan tingkat bukan berarti ia berhak memanggilnya.
            // Kata "token" sengaja DIHINDARI di kalimat ini — uji `hanoman_about` melarangnya
            // muncul di mana pun dalam balasan ini, dan larangan itulah yang menjaga rahasia tak
            // pernah bocor lewat pintu ini.
            modeNote: "Tingkat mode menentukan tool mana yang TERLIHAT; ia BUKAN kontrol keamanan. Yang menahan sungguhan adalah capability yang dicentang manusia di Settings — sebuah tool bisa terlihat dan tetap menjawab 403.",
            toolSchemaVersion: MCP_TOOL_SCHEMA_VERSION,
            hanomanCli: cliVersion,
            tools: tools.map((t) => ({ name: t.name, mode: t.mode, capability: t.capability })),
            // Keluhan konfigurasi ikut di sini supaya manusia punya satu tempat untuk melihat
            // kenapa semua tool lain menolak — klien MCP menyembunyikan stderr.
            problems: cfg.problems,
          }, cfg.maxBytes));
        }

        const req = tool.build(args);
        if (!req) return text(`Tool ${tool.name} tak punya panggilan REST.`, true);

        const r = await call(req, tool.name);
        if (!r.ok) return text(r.message, true);
        return text(renderResult(tool.shape(r.body, args), cfg.maxBytes));
      },
    );
  }
  return server;
}
