// ADR-0099 · katalog tool domain `sessions`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, obj } from "../mcp-schema";
import { shapeSession } from "../mcp-shape";
import { localPage } from "./helpers";
import type { McpToolDef } from "./types";

export const SESSIONS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_sessions_list",
    title: "Sesi berjalan",
    description:
      "Sesi agen yang hidup sekarang (sumber kebenarannya tmux, bukan database). `exited: true` berarti prosesnya sudah mati — `exitCode` bukan 0 berarti gagal. Tool ini hanya MEMBACA; membuat sesi baru tidak tersedia lewat MCP.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "sessions:read", samplePath: "/terminal/sessions", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/terminal/sessions" }),
    shape: (raw, a) => localPage(raw, a, shapeSession),
  },
];
