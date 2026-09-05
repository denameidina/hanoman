import { resolveTools, MENTION_MAX_HOPS, MENTION_TOOL } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "./code-style";

// SPEC-450/950 · ADR-0094/0159 · bagian murni renderer native dua runtime. Claude menerima JSON
// `--agents`; Codex TOML dirakit di `codex-agent-config.ts`. Pemanggil yang menulis berkas temp.

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
const policyClause = (def: AgentDef): string[] => {
  const policy = def.workspacePolicy ?? "inherit";
  if (policy === "read-only") {
    const root = def.name === "root-causer" ? [
      "Untuk root-causer, lakukan diagnosis statis dari bukti yang sudah tersedia. Labeli hipotesis",
      "yang belum terbukti dan berikan rencana eksperimen untuk parent; jangan menjalankan reproduksi",
      "yang memerlukan eksekusi atau mutasi di workspace ini.",
    ] : [];
    return [
      "Policy efektif: read-only. Inspeksi statis saja; jangan mengubah workspace atau menjalankan",
      "operasi yang ditolak validator read-only.",
      ...root,
      "Jangan mengklaim eksperimen telah dijalankan tanpa output yang benar-benar kamu terima.",
    ];
  }
  if (policy === "isolated-worktree") {
    const root = def.name === "root-causer"
      ? ["Untuk root-causer, kamu boleh mereproduksi dan menjalankan eksperimen hanya di worktree terisolasi ini."]
      : [];
    return [
      "Policy efektif: isolated-worktree. Semua tulisan, test patch, reproduksi, dan eksperimen",
      "harus tetap di worktree terisolasi yang diberikan; jangan menyentuh worktree parent.",
      ...root,
      "Jangan mengklaim eksperimen telah dijalankan tanpa output yang benar-benar kamu terima.",
    ];
  }
  return [
    "Policy efektif: inherit. Ikuti izin workspace sesi parent dan jangan memperluas scope sendiri.",
    "Jangan mengklaim eksperimen telah dijalankan tanpa output yang benar-benar kamu terima.",
  ];
};

const workLimitClause = (def: AgentDef, runtime: "claude" | "codex"): string[] => {
  const lines: string[] = [];
  if (typeof def.maxTurns === "number") {
    lines.push(runtime === "claude"
      ? `Batas awal pekerjaan ${def.maxTurns} turn. Renderer juga mengirim maxTurns native ke Claude; ini batas turn, bukan hard kill wall-clock.`
      : `Batas awal pekerjaan ${def.maxTurns} turn adalah batas instruksional di Codex; bukan hard kill.`);
  }
  if (typeof def.timeoutSeconds === "number") {
    lines.push(
      `Batas waktu ${def.timeoutSeconds} detik adalah batas instruksional. Prioritaskan putusan dan bukti; ini bukan jaminan hard kill server.`,
    );
  }
  return lines;
};

const handoffClause = (): string[] => [
  "Kontrak serah-terima:",
  "- Masukan yang harus kamu gunakan: tujuan, scope, base SHA, kandidat yang diperiksa termasuk",
  "  dirty changes, bukti sebelumnya, dan aturan verifikasi. Bila ada yang hilang, nyatakan batasnya.",
  "- Awali laporan dengan `Status: selesai | sebagian | terhalang`.",
  "- Laporkan simpulan, jangkar bukti, tingkat keyakinan, scope yang belum diperiksa, dan langkah",
  "  berikutnya. Batas laporan: maksimal 12 temuan utama dan maksimal 1200 kata.",
];

export function agentPromptOf(
  def: AgentDef,
  roster: AgentDef[],
  runtime: "claude" | "codex" = "claude",
): string {
  const can = liveMentions(def, roster);
  const contract = [
    def.instructions,
    "",
    "---",
    ...policyClause(def),
    ...workLimitClause(def, runtime),
    "",
    ...handoffClause(),
  ];
  // SPEC-543/950 · ADR-0108/0159 · subagent kedua runtime lahir dengan konteks TERPISAH, jadi
  // klausa gaya kode harus ikut di developer instructions masing-masing.
  if (can.length === 0) {
    return [
      ...contract,
      "",
      "---",
      "Kamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.",
      "",
      CODE_STYLE_CLAUSE,
    ].join("\n");
  }
  const list = can.map((m) => `@${m}`).join(", ");
  return [
    ...contract,
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
type RenderAgentsOptions = { readOnlyHookCommand?: string; promptSuffix?: string };

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"]);

export function renderAgentsJson(defs: AgentDef[], options: RenderAgentsOptions = {}): string {
  if (defs.length === 0) return "";
  const out: Record<string, Record<string, unknown>> = {};
  for (const d of defs) {
    const resolvedTools = resolveTools({ tools: d.tools, mentions: d.mentions });
    const readOnly = d.workspacePolicy === "read-only";
    out[d.name] = {
      description: d.description,
      prompt: agentPromptOf(d, defs, "claude") + (options.promptSuffix ?? ""),
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
 * ADR-0136/0159 · parent mendapat arahan delegasi/handoff berukuran tetap.
 * Nama/deskripsi tersedia lewat registry native; instruksi lengkap ada di config child.
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
    "",
    `Delegasikan tugas yang relevan melalui ${runtime === "codex" ? "spawn_agent" : MENTION_TOOL}. `
      + "Sertakan tujuan, scope, base SHA, kandidat termasuk dirty changes, bukti sebelumnya, "
      + "dan aturan verifikasi. Tinjau hasil subagent sebelum digunakan.",
    "",
  ].join("\n");
}
