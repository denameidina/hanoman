import { resolveTools, MENTION_MAX_HOPS, MENTION_TOOL } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "./code-style";

// SPEC-450 · ADR-0094 · render custom agent ke dua permukaan: JSON `--agents` (claude, native)
// dan blok roster prosa (codex). Murni & tanpa I/O — pemanggil (pty.ts) yang menulis berkas.

export type AgentDef = {
  name: string;
  description: string;
  instructions: string;
  tools: string[] | null;
  model: string | null;
  mentions: string[];
};

/** Mention yang benar-benar bisa dituju: nama di luar roster dibuang, agar prosa tak berbohong. */
const liveMentions = (def: AgentDef, roster: AgentDef[]): string[] => {
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
  // SPEC-543 · ADR-0108 · subagent claude lahir dengan konteks TERPISAH — prompt sesi tak
  // menjangkaunya, jadi klausa gaya kode harus ikut di sini atau ia tak pernah sampai. Jalur codex
  // (`agentRosterBlock`) sengaja tak mengulanginya: roster itu ditempel ke prompt sesi yang sudah
  // membawa klausa.
  if (can.length === 0) {
    return [
      def.instructions,
      "",
      "---",
      "Kamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.",
      "",
      CODE_STYLE_CLAUSE,
    ].join("\n");
  }
  const list = can.map((m) => `@${m}`).join(", ");
  return [
    def.instructions,
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
export function renderAgentsJson(defs: AgentDef[]): string {
  if (defs.length === 0) return "";
  const out: Record<string, { description: string; prompt: string; tools: string[]; model?: string }> = {};
  for (const d of defs) {
    out[d.name] = {
      description: d.description,
      prompt: agentPromptOf(d, defs),
      tools: resolveTools({ tools: d.tools, mentions: d.mentions }),
      ...(d.model ? { model: d.model } : {}),
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
