import { resolveTools, MENTION_MAX_HOPS, MENTION_TOOL } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "./code-style";

// SPEC-450 · ADR-0094 · render custom agent ke dua permukaan: JSON `--agents` (claude, native)
// dan blok roster prosa (codex). Murni & tanpa I/O — pemanggil (pty.ts) yang menulis berkas.

export type AgentDef = {
  /** Soft-link local untuk telemetry; tidak dirender ke konfigurasi runtime. */
  id?: string;
  name: string;
  description: string;
  instructions: string;
  tools: string[] | null;
  model: string | null;
  mentions: string[];
  activation?: "always" | "smart";
  effort?: string | null;
  workspacePolicy?: "inherit" | "read-only" | "isolated-worktree";
  maxTurns?: number | null;
  timeoutSeconds?: number | null;
};

/** Mention yang benar-benar bisa dituju: nama di luar roster dibuang, agar prosa tak berbohong. */
const liveMentions = (def: AgentDef, roster: AgentDef[]): string[] => {
  if (def.workspacePolicy === "read-only") return [];
  const names = new Set(roster.map((r) => r.name));
  return def.mentions.filter((m) => names.has(m) && m !== def.name);
};

/**
 * ADR-0094 keputusan 5 lapis 3 · anggaran hop DALAM prosa. Bukan jaminan — jaminannya graf asiklik
 * (lapis 1) dan ketiadaan `Task` (lapis 2). Ia ada karena SPEC-432 sudah mengukur harganya: agen
 * berbatas yang TAK diberi tahu batasnya membakar seluruh anggaran tanpa hasil.
 */
export function agentPromptOf(def: AgentDef, roster: AgentDef[]): string {
  const can = liveMentions(def, roster);
  const instructions = def.timeoutSeconds
    ? `${def.instructions}\n\nBatas waktu Hanoman untuk pekerjaan ini ${def.timeoutSeconds} detik. Prioritaskan putusan dan bukti sebelum batas itu.`
    : def.instructions;
  // SPEC-543 · ADR-0108 · subagent claude lahir dengan konteks TERPISAH — prompt sesi tak
  // menjangkaunya, jadi klausa gaya kode harus ikut di sini atau ia tak pernah sampai. Jalur codex
  // (`agentRosterBlock`) sengaja tak mengulanginya: roster itu ditempel ke prompt sesi yang sudah
  // membawa klausa.
  if (can.length === 0) {
    return [
      instructions,
      "",
      "---",
      "Kamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.",
      "",
      CODE_STYLE_CLAUSE,
    ].join("\n");
  }
  const list = can.map((m) => `@${m}`).join(", ");
  return [
    instructions,
    "",
    "---",
    `Kamu boleh mendelegasikan HANYA ke: ${list}. Panggil lewat ${MENTION_TOOL} dengan nama agennya.`,
    `Anggaran rantai delegasi seluruh sesi ini ${MENTION_MAX_HOPS} hop. Bila kamu sudah berada di hop ke-${MENTION_MAX_HOPS}, JANGAN mendelegasikan lagi — selesaikan sendiri lalu laporkan.`,
    "Sebutkan hop keberapa kamu berada saat mendelegasikan, dan jangan pernah memanggil agen yang sudah ada di rantai yang membawamu ke sini.",
    "",
    CODE_STYLE_CLAUSE,
  ].join("\n");
}

/**
 * JSON untuk `claude --agents`. String KOSONG bila tak ada agen — pemanggil memakai itu sebagai
 * gerbang "jangan pasang flag sama sekali", supaya argv sesi tanpa custom agent byte-identik
 * dengan sebelum SPEC-450.
 */
type RenderAgentsOptions = { readOnlyHookCommand?: string };

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"]);

export function renderAgentsJson(defs: AgentDef[], options: RenderAgentsOptions = {}): string {
  if (defs.length === 0) return "";
  const out: Record<string, Record<string, unknown>> = {};
  for (const d of defs) {
    const resolvedTools = resolveTools({ tools: d.tools, mentions: d.mentions });
    const readOnly = d.workspacePolicy === "read-only";
    out[d.name] = {
      description: d.description,
      prompt: agentPromptOf(d, defs),
      tools: readOnly ? resolvedTools.filter((tool) => READ_ONLY_TOOLS.has(tool)) : resolvedTools,
      ...(d.model ? { model: d.model } : {}),
      ...(d.effort ? { effort: d.effort } : {}),
      ...(typeof d.maxTurns === "number" ? { maxTurns: d.maxTurns } : {}),
      ...(d.workspacePolicy === "isolated-worktree" ? { isolation: "worktree" } : {}),
      ...(readOnly ? { permissionMode: "plan" } : {}),
      ...(readOnly && options.readOnlyHookCommand ? {
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: "command", command: options.readOnlyHookCommand, timeout: 5,
            }],
          }],
        },
      } : {}),
    };
  }
  return JSON.stringify(out);
}

/**
 * Blok roster untuk codex — ditempel ke AKHIR prompt sesi. Codex 0.146 tak punya padanan
 * `--agents` yang bisa diverifikasi (ADR-0094 M5: kunci `-c` tak dikenal diterima diam-diam),
 * jadi hanoman memakai kanal yang memang miliknya sendiri. Codex mengadopsi peran INLINE — tak
 * ada proses kedua, jadi risiko loop di codex struktural nol.
 */
export function agentRosterBlock(defs: AgentDef[]): string {
  if (defs.length === 0) return "";
  const lines: string[] = [
    "",
    "## Custom agent hanoman",
    "",
    "Peran berikut tersedia untuk sesi ini. Saat sebuah tugas cocok dengan salah satunya, ADOPSI",
    "perannya (baca instruksinya, kerjakan dengan sudut pandang itu) lalu kembali ke peranmu sendiri.",
    "Jangan melahirkan proses agen baru.",
    "",
  ];
  for (const d of defs) {
    const can = liveMentions(d, defs);
    lines.push(`### @${d.name} — ${d.description}`);
    lines.push("");
    lines.push(d.instructions);
    lines.push("");
    lines.push(
      can.length
        ? `Boleh berkonsultasi ke: ${can.map((m) => `@${m}`).join(", ")} (maks ${MENTION_MAX_HOPS} hop berantai).`
        : "Tidak boleh berkonsultasi ke peran lain.",
    );
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * SPEC-881 · ADR-0136 · klausa untuk jalur CLAUDE. Codex sudah menerima `agentRosterBlock` yang
 * menyuruhnya MENGADOPSI peran; claude menerima definisinya lewat `--agents` tapi tak menerima
 * satu pun dorongan untuk menoleh ke sana — dan katalog yang tak pernah dipanggil sama saja dengan
 * katalog kosong.
 *
 * Menyebut agen yang BENAR-BENAR ada di roster sesi ini, bukan daftar statis: operator yang
 * mematikan sebuah agen tak boleh menerima prompt yang menyuruh memanggilnya.
 *
 * Kosong saat roster kosong — invarian "prompt byte-identik saat katalog kosong" (ADR-0094).
 */
export function agentDelegationClause(
  defs: AgentDef[],
  runtime: "claude" | "codex" = "claude",
): string {
  if (defs.length === 0) return "";
  return [
    "",
    "## Subagent yang tersedia",
    "",
    "Sesi ini punya subagent berikut. Delegasikan saat tugasnya cocok — konteks mereka TERPISAH",
    "dari milikmu, jadi menyerahkan penyapuan & verifikasi ke mereka MENGHEMAT konteksmu sendiri,",
    "bukan memboroskannya.",
    "",
    ...defs.map((d) => `- **${d.name}** — ${d.description}`),
    "",
    runtime === "codex"
      ? "Panggil target bernama persis lewat `spawn_agent`."
      : `Panggil lewat tool ${MENTION_TOOL} dengan nama agennya.`,
    "Mereka tak bisa mendelegasikan lagi,",
    "jadi tak ada rantai panggilan yang perlu kamu jaga. Laporan mereka adalah MASUKAN — kamu yang",
    "memutuskan, dan kamu yang bertanggung jawab atas hasilnya.",
    "",
  ].join("\n");
}
