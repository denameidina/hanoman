import { resolveTools, MENTION_MAX_HOPS, MENTION_TOOL } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "./code-style";
import { DECIDER } from "./prompt";
import { READ_ONLY_POLICY } from "./agent-readonly";

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
  /**
   * ADR-0164 · `phase` = agen fase dari `buildPhaseAgents`: instruksi dirender APA ADANYA, tanpa
   * kunci `tools` (mewarisi seluruh tool sesi — Skill/Agent/MCP) dan tanpa klausa policy/delegasi
   * custom agent. Absen = custom agent.
   */
  kind?: "custom" | "phase";
  /** ADR-0164 · nama fase PIPELINES milik agen fase; ikut roster tmux sebagai bukti. */
  phase?: string;
  /**
   * ADR-0164 amandemen 2026-09-23 (T2) · konteks bersama agen fase (backlog/project/brief/PRD),
   * TERPISAH dari `instructions` supaya renderer claude bisa merujuknya lewat satu berkas alih-alih
   * menyalinnya ke tiap agen. Dirakit oleh `phasePromptOf`.
   */
  context?: string;
};

export const PHASE_CONTEXT_HEADER = "=== KONTEKS ===";

/** Berkas konteks bersama agen fase yang sudah ditulis pemanggil (claude saja). */
export type PhaseContextFile = { context: string; path: string };

/**
 * ADR-0164 amandemen 2026-09-23 (T2) · prompt agen fase = instruksi + blok KONTEKS. Tanpa berkas:
 * konteks inline — byte-identik dengan sebelum konteks dipisah (codex selalu begini: TOML lewat
 * `config_file`, tak kena batas argv). Dengan berkas yang ISINYA sama persis: hanya path-nya, sebab
 * `--agents` claude adalah SATU argumen exec dan Linux menolak argumen > 128 KiB (MAX_ARG_STRLEN) —
 * menyalin payload 25 KB ke tiap fase sudah memberi 168 KB.
 */
export function phasePromptOf(def: AgentDef, file?: PhaseContextFile): string {
  if (def.context === undefined) return def.instructions;
  const body = file && file.context === def.context
    ? `Konteks sesi ini (backlog/project/brief/PRD) ada di berkas \`${file.path}\`. Baca berkas itu UTUH `
      + "dengan tool Read SEBELUM mengerjakan apa pun — isinya bagian dari instruksimu, bukan lampiran "
      + "opsional. Berkas itu hanya-baca dan berada di luar worktree; jangan menyalin atau meng-commit-nya."
    : def.context;
  return `${def.instructions}\n\n${PHASE_CONTEXT_HEADER}\n${body}`;
}

/** Mention yang benar-benar bisa dituju: nama di luar roster dibuang, agar prosa tak berbohong. */
const liveMentions = (def: AgentDef, roster: AgentDef[]): string[] => {
  if (def.workspacePolicy === "read-only") return [];
  const names = new Set(roster.map((r) => r.name));
  return def.mentions.filter((m) => names.has(m) && m !== def.name);
};

type WorkspacePolicy = NonNullable<AgentDef["workspacePolicy"]>;
const policyOf = (def: AgentDef): WorkspacePolicy => def.workspacePolicy ?? "inherit";

/**
 * Audit custom agent 2026-09-25 · P1-1 · yang DISEBUT ditolak oleh prosa read-only. Diekspor supaya
 * test mengikat tiap butir ke `readOnlyDecision`; prosa dirakit dari daftar ini, bukan diketik ulang.
 */
export const READ_ONLY_DENIED_OPERATORS = ["|", ";", "&&", "<", ">", "$", "`"] as const;
export const READ_ONLY_DENIED_COMMANDS = [
  "cat", "grep", "find", "git blame", "git grep", "git rev-parse", "git merge-base", "pnpm", "node", "curl",
] as const;

/** `cat, grep, find, git blame/grep/rev-parse/merge-base, pnpm, …` — subperintah git dirangkai di tempat git pertama. */
const deniedCommandsProse = (): string => {
  const git = READ_ONLY_DENIED_COMMANDS.filter((c) => c.startsWith("git ")).map((c) => c.slice(4));
  const out: string[] = [];
  for (const c of READ_ONLY_DENIED_COMMANDS) {
    if (!c.startsWith("git ")) out.push(c);
    else if (!out.some((o) => o.startsWith("git "))) out.push(`git ${git.join("/")}`);
  }
  return out.join(", ");
};

const readOnlyAllowlistLines = (): string[] => {
  const shell = READ_ONLY_POLICY.shellCommands.map((c) => "`" + c + "`").join(", ");
  const gitReads = READ_ONLY_POLICY.gitCommands.filter((c) => c !== "status").join("|");
  const operators = READ_ONLY_DENIED_OPERATORS.map((o) => (o === "`" ? "backtick" : "`" + o + "`")).join(" ");
  return [
    `Bash hanya menerima: ${shell} (sed hanya \`sed -n 'A,Bp' <berkas>\`), \`git status\`, dan`,
    `\`git ${gitReads}\` yang WAJIB membawa \`--no-ext-diff --no-textconv\`.`,
    `Ditolak: ${operators} — juga di dalam kutip — serta ${deniedCommandsProse()}.`,
    "Regex (termasuk alternasi `a|b`) pakai tool Grep; isi berkas pakai tool Read. Diff kandidat:",
    "`git diff --no-ext-diff --no-textconv <baseSha>` + `git status --porcelain` untuk berkas baru;",
    "SHA wajib literal heksadesimal.",
  ];
};

const NO_FAKE_EXPERIMENT = "Jangan mengklaim eksperimen telah dijalankan tanpa output yang benar-benar kamu terima.";

/**
 * Bagian policy yang SAMA untuk semua agen ber-policy itu — kandidat berkas kontrak bersama (P1-11).
 * Baris khas satu agen (root-causer) ada di `ownPolicyLines`, selalu inline.
 */
const policyLines = (policy: WorkspacePolicy): string[] => {
  if (policy === "read-only") {
    return [
      "Policy efektif: read-only. Inspeksi statis saja; jangan mengubah workspace atau menjalankan",
      "operasi yang ditolak validator read-only.",
      ...readOnlyAllowlistLines(),
      NO_FAKE_EXPERIMENT,
    ];
  }
  if (policy === "isolated-worktree") {
    // Audit P0-2 · worktree isolasi lahir dari COMMIT; perubahan dirty parent tak pernah ikut, dan
    // hasil anak tak kembali sendiri. Kontraknya: kandidat SHA literal masuk, SHA hasil keluar.
    return [
      "Policy efektif: isolated-worktree. Semua tulisan, test patch, reproduksi, dan eksperimen",
      "harus tetap di worktree terisolasi yang diberikan; jangan menyentuh worktree parent.",
      "Worktree ini lahir dari sebuah COMMIT, bukan dari pohon kerja parent: perubahan parent yang belum",
      "di-commit TIDAK ada di sini. Langkah 0, sebelum kerja apa pun: jalankan `git rev-parse HEAD` dan",
      "`git status --porcelain`, lalu bandingkan dengan `Kandidat SHA` dari parent. Bila berbeda, pindah",
      "dengan `git checkout --detach <kandidat>` (penulis: `git checkout -B <nama-task> <kandidat>`). Bila",
      "parent tidak memberi SHA literal atau checkout gagal, laporkan `Status: terhalang` dan berhenti.",
      "Worktree baru belum punya dependensi/artefak generate: siapkan SEKALI sesuai resep test di",
      "AGENTS.md/CLAUDE.md proyek (termasuk isolasi DB test). Bila gagal, `Status: terhalang`.",
      // Audit P0-5 · pertahanan kedua: env pane bisa mewarisi DATABASE_URL operasional hanoman.
      "Jangan menjalankan migrate/db push/test terhadap `DATABASE_URL` yang menunjuk `~/.hanoman`;",
      "pakai DB sekali-pakai.",
      "Hasilmu tidak otomatis sampai ke parent: commit dengan `git add <path>` eksplisit, lalu laporkan",
      "`SHA dasar`, `SHA hasil`, nama branch, dan path worktree agar parent bisa `git cherry-pick`.",
      NO_FAKE_EXPERIMENT,
    ];
  }
  return [
    "Policy efektif: inherit. Ikuti izin workspace sesi parent dan jangan memperluas scope sendiri.",
    NO_FAKE_EXPERIMENT,
  ];
};

const ownPolicyLines = (def: AgentDef): string[] => {
  if (def.name !== "root-causer") return [];
  const policy = policyOf(def);
  if (policy === "read-only") {
    return [
      "Untuk root-causer, lakukan diagnosis statis dari bukti yang sudah tersedia. Labeli tiap hipotesis",
      "`terbukti-statis`/`belum-terbukti`/`gugur` dan berikan rencana eksperimen untuk parent; jangan",
      "menjalankan reproduksi yang memerlukan eksekusi atau mutasi di workspace ini.",
    ];
  }
  if (policy === "isolated-worktree") {
    return ["Untuk root-causer, kamu boleh mereproduksi dan menjalankan eksperimen hanya di worktree terisolasi ini."];
  }
  return [];
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

const STATUS_LINE = "`Status: selesai | sebagian | terhalang | menunggu-keputusan`";

const handoffClause = (): string[] => [
  "Kontrak serah-terima:",
  "- Masukan yang harus kamu gunakan: tujuan, scope, base SHA dan kandidat SHA sebagai NILAI heksadesimal",
  "  (bukan nama variabel), bukti sebelumnya, dan aturan verifikasi. Bila ada yang hilang, nyatakan batasnya.",
  `- Awali laporan dengan ${STATUS_LINE}.`,
  "- Laporkan simpulan, jangkar bukti, tingkat keyakinan, scope yang belum diperiksa, dan langkah",
  "  berikutnya. Batas laporan: maksimal 12 temuan utama dan maksimal 1200 kata.",
  // ADR-0167 · batas temuan di atas bukan batas pertanyaan: keputusan terbuka tak berbatas.
  "- `Keputusan terbuka:` (wajib) setiap hal yang masih ambigu dan akan mempengaruhi hasil — data",
  "  model, kontrak API, scope, asumsi yang terpaksa diambil — sebagai pertanyaan bernomor diakhiri `?`",
  "  beserta opsi dan rekomendasimu, tanpa batas jumlah; `-` bila tak ada.",
  "  Jangan memutuskannya sendiri: bila ada, laporkan `Status: menunggu-keputusan` dan berhenti.",
  `  Yang menjawab ${DECIDER}.`,
];

/**
 * Audit P1-11 · kontrak kerja bersama per policy: bagian policy generik + serah-terima + gaya kode.
 * Isinya identik untuk setiap custom agent ber-policy sama, jadi claude menuliskannya SEKALI ke
 * berkas di temp dir sesi dan tiap prompt merujuk path-nya (pola `phaseContextFile`, ADR-0164 T2)
 * alih-alih menyalinnya ke tiap agen di dalam SATU argumen `--agents`.
 */
export function agentContractOf(policy: WorkspacePolicy): string {
  return [
    "Kontrak kerja custom agent hanoman — bagian dari instruksimu, bukan lampiran opsional.",
    "",
    ...policyLines(policy),
    "",
    ...handoffClause(),
    "",
    CODE_STYLE_CLAUSE,
    "",
  ].join("\n");
}

/** Berkas kontrak bersama yang sudah ditulis pemanggil (claude saja); dirujuk hanya bila isinya sama persis. */
export type AgentContractFile = { policy: WorkspacePolicy; content: string; path: string };

const contractReference = (def: AgentDef, path: string): string[] => [
  `Policy efektif: ${policyOf(def)}. Rincian policy ini, kontrak serah-terima, dan gaya kode ada di berkas`,
  `\`${path}\`. Baca berkas itu UTUH dengan tool Read SEBELUM mengerjakan apa pun — isinya bagian dari`,
  "instruksimu, bukan lampiran opsional. Berkas itu hanya-baca dan berada di luar worktree; jangan menyalin",
  `atau meng-commit-nya. Laporanmu tetap diawali ${STATUS_LINE}.`,
];

export function agentPromptOf(
  def: AgentDef,
  roster: AgentDef[],
  runtime: "claude" | "codex" = "claude",
  /** P1-11 · path berkas `agentContractOf(policy)`; absen = kontrak inline (codex selalu begini). */
  contractPath?: string,
): string {
  const can = liveMentions(def, roster);
  const contract = contractPath
    ? [
      def.instructions,
      "",
      "---",
      ...contractReference(def, contractPath),
      ...ownPolicyLines(def),
      ...workLimitClause(def, runtime),
    ]
    : [
      def.instructions,
      "",
      "---",
      ...policyLines(policyOf(def)),
      ...ownPolicyLines(def),
      ...workLimitClause(def, runtime),
      "",
      ...handoffClause(),
    ];
  // SPEC-543/950 · ADR-0108/0159 · subagent kedua runtime lahir dengan konteks TERPISAH, jadi
  // klausa gaya kode harus ikut di developer instructions masing-masing (atau di berkas kontraknya).
  const style = contractPath ? [] : ["", CODE_STYLE_CLAUSE];
  if (can.length === 0) {
    return [
      ...contract,
      "",
      "---",
      "Kamu TIDAK boleh mendelegasikan ke agen lain. Selesaikan sendiri lalu laporkan hasilnya.",
      ...style,
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
    ...style,
  ].join("\n");
}

/**
 * JSON untuk `claude --agents`. String KOSONG bila tak ada agen — pemanggil memakai itu sebagai
 * gerbang "jangan pasang flag sama sekali", supaya argv sesi tanpa custom agent byte-identik
 * dengan sebelum SPEC-450.
 */
type RenderAgentsOptions = {
  readOnlyHookCommand?: string; promptSuffix?: string;
  /** T2 · konteks bersama agen fase sudah ditulis ke berkas ini; agen fase yang konteksnya sama merujuknya. */
  phaseContextFile?: PhaseContextFile;
  /** P1-11 · kontrak bersama custom agent per policy sudah ditulis ke berkas-berkas ini. */
  agentContractFiles?: readonly AgentContractFile[];
};

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "Bash", "WebFetch", "WebSearch"]);

export function renderAgentsJson(defs: AgentDef[], options: RenderAgentsOptions = {}): string {
  if (defs.length === 0) return "";
  const out: Record<string, Record<string, unknown>> = {};
  for (const d of defs) {
    if (d.kind === "phase") {
      out[d.name] = {
        description: d.description,
        prompt: phasePromptOf(d, options.phaseContextFile),
        ...(d.model ? { model: d.model } : {}),
        ...(d.effort ? { effort: d.effort } : {}),
      };
      continue;
    }
    const resolvedTools = resolveTools({ tools: d.tools, mentions: d.mentions });
    const readOnly = d.workspacePolicy === "read-only";
    const tools = readOnly ? resolvedTools.filter((tool) => READ_ONLY_TOOLS.has(tool)) : resolvedTools;
    // Rujukan berkas hanya bila agen sanggup MEMBACANYA (Read) dan isinya kontrak policy-nya persis;
    // selain itu inline — agen tanpa Read tak boleh kehilangan kontraknya.
    const policy = policyOf(d);
    const contract = tools.includes("Read")
      ? options.agentContractFiles?.find((f) => f.policy === policy && f.content === agentContractOf(policy))
      : undefined;
    out[d.name] = {
      description: d.description,
      prompt: agentPromptOf(d, defs, "claude", contract?.path) + (options.promptSuffix ?? ""),
      tools,
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
  // ADR-0164 · agen fase bukan custom agent: kontrak delegasinya ada di prompt orchestrator,
  // jadi mereka tak pernah ikut klausa ini — di kedua runtime, dari satu tempat.
  if (defs.every((def) => def.kind === "phase")) return "";
  const codex = runtime === "codex";
  // ADR-0167 · relay yang sama dengan orchestrator langkah 4; codex tak punya AskUserQuestion (M-6).
  const relay = codex
    ? "ajukan semuanya di terminal ini (bernomor, tiap pertanyaan diakhiri `?`), lalu teruskan jawabannya "
      + "lewat send_input ke agent id yang sama"
    : "ajukan semuanya lewat AskUserQuestion (pecah per 4 pertanyaan), lalu teruskan jawabannya lewat "
      + "SendMessage ke agent ID yang sama";
  return [
    "",
    "",
    `Delegasikan tugas yang relevan melalui ${codex ? "spawn_agent" : MENTION_TOOL}. `
      + "Sertakan tujuan, scope, base SHA dan kandidat SHA sebagai nilai literal, bukti sebelumnya, "
      + "dan aturan verifikasi. Agen isolated-worktree hanya melihat COMMIT: commit kandidat dulu, "
      + "lalu ambil hasilnya dari SHA yang ia laporkan (`git cherry-pick <sha>`). Tinjau hasil subagent sebelum digunakan. "
      + `Bila laporannya memuat \`Keputusan terbuka:\` yang bukan \`-\`, JANGAN menjawabnya sendiri: ${relay}. `
      + `Yang menjawab ${DECIDER}.`,
    "",
  ].join("\n");
}
