import { PORTAL_CHAT_REPLY_SCHEMA } from "@hanoman/shared";
import { effectiveStr } from "../../config";
import { sandboxArgvFromEnv } from "../session-sandbox";

// SPEC-854 · ADR-0129 · LAPIS 3 — batas runtime yang DIBUKTIKAN dari sisi hanoman, bukan
// diasumsikan dari perilaku agen.
//
// Terukur pada claude 2.1.235 sebelum baris ini ditulis: dengan `--tools "Read,Glob,Grep"` dan
// cwd = workspace, tujuh percobaan keluar (Read relatif `../`, Read absolut, Glob `../*.txt`,
// Glob absolut, Grep `..`, Grep absolut, Glob `**`) SEMUANYA ditolak, dan yang sampai ke tool
// tercatat di `permission_denials` keluaran JSON — jadi percobaan keluar bahkan bisa dilihat
// operator. Containment itu berlaku TANPA podman dan TANPA flag bypass; podman lapis kedua,
// bukan satu-satunya.

export const PORTAL_CHAT_TOOLS = "Read,Glob,Grep";

/**
 * Flag yang tak boleh muncul, apa pun alasannya. Daftar EKSPLISIT, bukan "pokoknya jangan":
 * test mengadu argv ke daftar ini, jadi seseorang yang menambahkannya nanti akan tahu bahwa ia
 * sedang membongkar penjagaan, bukan sedang memperbaiki bug.
 */
export const FLAG_TERLARANG = [
  "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox", "--add-dir", "--mcp-config",
  "--worktree", "-w", "--permission-mode", "--settings", "--agents", "--plugin-dir",
  "--plugin-url", "--chrome", "--ide", "--brief", "--bg", "--background", "--resume", "-c",
  "--continue", "--file", "--append-system-prompt",
] as const;

export type ChatArgvInput = {
  model: string; effort: string; systemPrompt: string; prompt: string;
};

/**
 * Argv `claude` untuk satu giliran. Prompt SELALU argumen terakhir supaya isi pesan klien tak
 * pernah bisa terbaca sebagai flag.
 */
export function portalChatArgv(o: ChatArgvInput): string[] {
  return [
    "-p",
    "--model", o.model,
    "--effort", o.effort,
    "--tools", PORTAL_CHAT_TOOLS,
    "--setting-sources", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--system-prompt", o.systemPrompt,
    "--output-format", "json",
    "--json-schema", JSON.stringify(PORTAL_CHAT_REPLY_SCHEMA),
    o.prompt,
  ];
}

const shellQuote = (v: string): string => `'${v.replace(/'/g, `'"'"'`)}'`;

export type ChatProcess = { file: string; args: string[]; cwd?: string };

/**
 * Proses yang benar-benar dijalankan. Di produksi sandbox OS WAJIB (fail closed) — cermin
 * `assertRuntimeBoundary`, dan justru KEBALIKAN jalur sesi pty yang jatuh ke `mode "off"` di luar
 * produksi. Di luar produksi chat tetap boleh jalan karena penjaganya bukan podman melainkan
 * workspace dokumen + tool set di atas. Jangan menyeragamkan keduanya "demi konsistensi".
 */
export function portalChatProcess(
  o: ChatArgvInput & { workspace: string },
  env: NodeJS.ProcessEnv = process.env,
): ChatProcess {
  const file = effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";
  const args = portalChatArgv(o);
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (env.NODE_ENV === "production" ? "required" : "off");
  if (mode === "off") {
    if (env.NODE_ENV === "production")
      throw new Error("chat portal menolak jalan: sandbox sesi wajib di production");
    return { file, args, cwd: o.workspace };
  }
  const command = [file, ...args].map(shellQuote).join(" ");
  const sandbox = sandboxArgvFromEnv({
    command, worktree: o.workspace, worktreeMode: "ro", env });
  if (!sandbox) throw new Error("chat portal menolak jalan: sandbox sesi tidak terkonfigurasi");
  return { file: sandbox[0]!, args: sandbox.slice(1) };
}
