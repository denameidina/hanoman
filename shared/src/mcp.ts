// SPEC-482 · ADR-0099 · permukaan publik katalog MCP.
export * from "./mcp-schema";
export * from "./mcp-shape";
export * from "./mcp-catalog";

import { MCP_TOOLS, type McpLevel, type McpToolDef } from "./mcp-catalog";

/**
 * Versi skema tool. Kontraknya:
 *   ADITIF dalam satu versi — menambah tool, menambah parameter OPSIONAL, memperluas deskripsi.
 *   NAIK VERSI — mengganti/menghapus nama tool, menghapus parameter, menjadikan parameter opsional
 *   jadi wajib, atau mengubah bentuk hasil.
 * Ditegakkan test snapshot di `mcp-catalog.test.ts`: perubahan yang memutus klien lama tak bisa
 * lolos tanpa seseorang sengaja memperbarui snapshot DAN angka ini.
 */
export const MCP_TOOL_SCHEMA_VERSION = 1;

/**
 * ADR-0155 · TIGA tingkat. Yang lebih sempit MENGHILANGKAN tool dari `tools/list`, bukan menolaknya
 * saat dipanggil (ADR-0099 §5): tool yang tak terlihat tak bisa dicoba, sementara menolak saat
 * dipanggil hanya menghasilkan percakapan yang membingungkan.
 *
 * Ini BUKAN kontrol keamanan. Token yang sama tetap bisa memanggil REST langsung; yang menahannya
 * adalah capability pada agent token (ADR-0155). Tingkat ini melindungi dari agen yang SALAH PILIH
 * tool, bukan dari agen yang BERNIAT.
 */
export function mcpToolsFor(level: McpLevel): readonly McpToolDef[] {
  if (level === "read-only") return MCP_TOOLS.filter((t) => t.mode === "read");
  if (level === "default") return MCP_TOOLS.filter((t) => t.mode !== "danger");
  return MCP_TOOLS;
}

export const MCP_INSTRUCTIONS = [
  `hanoman — orchestrator backlog + dashboard. Skema tool versi ${MCP_TOOL_SCHEMA_VERSION}.`,
  "",
  "Semua tool memanggil REST API hanoman dengan agent token yang dipasang manusia di konfigurasi klien MCP ini. Capability token menentukan apa yang boleh; bila sebuah tool menjawab kurang capability, sebutkan capability persisnya ke manusia — hanya manusia yang bisa menambahkannya di Settings → Akses AI Agent.",
  "",
  "Sebagian tool BERBAHAYA — membuka sesi agen di worktree, perintah VPS, merge/rebase, penghapusan backlog, perubahan stage. Semuanya hanya muncul bila manusia menyalakan tingkat `--danger` di konfigurasi klien MCP ini. Tingkat itu BUKAN kontrol keamanan: ia mencegah salah pilih tool, sementara yang menahan sungguhan adalah capability pada agent token. Deskripsi tiap tool berbahaya menyebut capability persisnya.",
  "",
  "Balasan tool dibatasi ukurannya. Tool daftar menerima `page`/`limit`; balasan yang dipotong ditandai `truncated: true` berikut `shown`/`total` — itu batas ukuran, bukan galat.",
].join("\n");
