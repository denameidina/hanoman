// SPEC-482 · ADR-0099 · `hanoman mcp` — MCP server stdio yang berperan sebagai klien REST hanoman.
//
// DUA aturan yang mengikat berkas ini:
//  1. stdout milik JSON-RPC. Satu byte diagnostik di sana merusak protokol dan klien MCP akan
//     melaporkannya sebagai "server rusak" tanpa sebab yang bisa dibaca. Semua ke stderr.
//  2. Konfigurasi kurang TIDAK mematikan proses. Klien MCP menyembunyikan stderr, jadi proses yang
//     mati hanya tampak sebagai "server gagal start". Server tetap berdiri, `tools/list` tetap
//     jalan, dan setiap panggilan menjawab dengan kalimat yang menyebut variabel yang harus diisi
//     — `hanoman_about` bahkan menjawab tanpa token sama sekali.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHome } from "@hanoman/runner";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import type { Ctx } from "../router";
import { currentVersion } from "../router";
import { resolveMcpConfig } from "../mcp/config";
import { createCaller } from "../mcp/client";
import { buildMcpServer } from "../mcp/server";
import { redactToken } from "../mcp/redact";

// SPEC-846 · lewat `resolveHome()`, bukan salinan logikanya: salinan sebelumnya tak mem-`trim()`
// sehingga `HANOMAN_HOME` berisi spasi membuat token tak pernah ketemu dan MCP berjalan tanpa
// autentikasi — kegagalan yang hanya terbaca sebagai satu baris peringatan di stderr.
export const agentTokenPath = (env: Ctx["env"]): string => join(resolveHome(env), "agent-token");

const tokenFile = (env: Ctx["env"]): string | null => {
  try { return readFileSync(agentTokenPath(env), "utf8"); } catch { return null; }
};

export default async function mcp(argv: string[], ctx: Ctx): Promise<number> {
  const cfg = resolveMcpConfig(argv, ctx.env, () => tokenFile(ctx.env));
  const say = (s: string) => ctx.stderr(redactToken(s, cfg.token) + "\n");

  say(`hanoman mcp ${currentVersion()} · host ${cfg.host || "(belum diisi)"} · mode ${cfg.readOnly ? "baca-saja" : "baca-tulis"}`);
  for (const p of cfg.problems) say(`peringatan: ${p}`);

  const call = createCaller(cfg, fetch);
  const handle = serveStdio(() => buildMcpServer(cfg, call, currentVersion()), {
    onerror: (e: unknown) => say(`galat transport: ${String((e as Error)?.message ?? e)}`),
  });

  // Jalur test: berdiri, laporkan, lalu pulang tanpa menahan proses.
  if (argv.includes("--exit-after-boot")) { await handle.close(); return 0; }

  // Proses hidup selama klien memegang stdin. Saat klien menutupnya, transport tutup dan kita pulang.
  await new Promise<void>((resolve) => {
    process.stdin.once("close", resolve);
    process.stdin.once("end", resolve);
  });
  return 0;
}
