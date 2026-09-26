import {
  PHASE_AGENT_PREFIX, REVIEWER_CELL, SPEC_AUDIT_VERDICT_LIST, phaseAgentName, type MethodDef, type PhasePlan, type PhasePlanEntry,
} from "@hanoman/shared";
import type { AgentDef } from "./custom-agents";
import type { Flow, VerifyScope } from "./types";
import {
  DECIDER, ESCALATION_CONTRACT, REVERSE_PHASE_GUIDE, SCAFFOLD_PHASE_GUIDE, WORK_PHASES, breakdownPhaseLines,
  codeStyleClause, guideLine, methodClause, phaseSkillsFor, prdPhaseLines, scopeClause,
} from "./prompt";
import { REVERSE_STANDARD } from "./reverse-standard";

// ADR-0164 · agen fase. Setiap fase flow dikerjakan subagent native `hanoman-fase-<slug>` yang
// model/effort-nya terkunci saat sesi lahir. Instruksinya potongan prompt yang di mode sesi tunggal
// hidup di prompt parent — dipindah ke fase pemiliknya, supaya kedua mode tak berselisih soal CARA
// sebuah fase dikerjakan.

export type PhaseAgentContext = {
  flow: Flow;
  method: MethodDef;
  verifyScope?: VerifyScope;
  /** Blok ekor prompt sesi tunggal (backlog/project/brief/PRD). Subagent lahir dengan konteks
   *  TERPISAH dan tak pernah melihat prompt parent, jadi blok ini wajib ikut di instruksinya. */
  context: string;
  /** flow prd: slug `docs/prd/<slug>.md`; flow breakdown: slug + judul PRD. */
  prd?: { slug: string; title?: string };
  /** id backlog audit asal (`payload.fromAudit`) untuk feature/qa lanjutan audit. */
  fromAudit?: string;
  /** S2 · SPEC-394 · sesi ini MELANJUTKAN sesi sebelumnya (backlog: `ResumeCtx`; project: worktree
   *  dipakai ulang). Subagent tak melihat `resumeClause` orchestrator, jadi ia dapat catatannya sendiri.
   *  undefined → instruksi byte-identik dengan sebelum field ini ada. */
  resume?: { worktreeKept: boolean; recorded: readonly string[] };
};

const REVIEWER_AGENT_NAME = phaseAgentName(REVIEWER_CELL);
const PROJECT_FLOWS: ReadonlySet<Flow> = new Set(["reverse", "scaffold", "prd", "breakdown"]);
const DOC_WRITING_PHASES: ReadonlySet<string> = new Set(["Docs teknis", "Konvensi & index", "Doc index"]);

// ADR-0167 · 166 run agen fase terukur, 0 pertanyaan: versi lama membuka dengan "lanjut sampai tuntas /
// JANGAN bertanya" dan hanya muat SATU pertanyaan, jadi asumsi jatuh ke prosa yang tak dibaca
// orchestrator. Larangan memutuskan kini didahulukan, dan daftarnya tak berbatas.
const PHASE_AGENT_AUTONOMY =
  "Kamu dipanggil orchestrator sesi hanoman, bukan manusia. Checkpoint \"review\"/\"approval\" milik "
  + "skill BUKAN titik berhenti. Tetapi kamu TIDAK BOLEH memutuskan sendiri hal yang masih ambigu dan "
  + "akan mempengaruhi hasil — percabangan data model, kontrak API, scope, perilaku yang terlihat "
  + "pengguna, atau asumsi yang terpaksa kamu ambil agar bisa lanjut — dan kamu tak bisa bertanya "
  + "langsung. Daftarkan SEMUANYA di bagian `Keputusan terbuka:` laporanmu (tanpa batas jumlah; tiap "
  + "butir berupa pertanyaan bernomor diakhiri `?` beserta opsi dan rekomendasimu), begitu juga bila "
  + "panduan fase menyuruhmu bertanya ke manusia, lalu tulis `Status: menunggu-keputusan` dan berhenti. "
  + "Jawabannya datang sebagai pesan susulan ke agen yang sama — lanjutkan dari sana; bila jawaban itu "
  + "memunculkan ambiguitas baru, laporkan lagi dengan cara yang sama. Yang menjawab ditentukan hanoman "
  + `— ${DECIDER}.`;

const PHASE_AGENT_RULES = [
  "Batas peran fase:",
  "- JANGAN menulis `$HANOMAN_PHASE_FILE` — orchestrator satu-satunya penulis marker fase.",
  "- JANGAN `git push` — push milik orchestrator. Commit artefak fasemu sendiri sebelum melapor.",
  `- JANGAN memanggil agen berawalan \`${PHASE_AGENT_PREFIX}\`. Custom agent lain boleh dipanggil bila relevan.`,
  "- Kerjakan HANYA fase ini; fase lain dikerjakan agen fasenya sendiri.",
  // T1 · ADR-0164 amandemen 2026-09-23 · 22 laporan tanpa `Status:` di audit: agen fase mengakhiri
  // gilirannya sambil menunggu proses latarnya sendiri, dan teks "menunggu" itu dibaca orchestrator
  // sebagai laporan final. Giliranmu yang berakhir = laporanmu, jadi menunggu harus terjadi DI DALAM giliran.
  "- JANGAN mengakhiri giliran atau melapor selama masih menunggu proses/tugas latar milikmu sendiri "
    + "(test/build/server yang kamu jalankan di latar, subagent yang kamu panggil): tunggu sampai selesai "
    + "dan baca hasilnya, lalu tulis laporan lengkap berawalan `Status:`. Akhir giliranmu dibaca "
    + "orchestrator sebagai laporan final — teks \"menunggu proses latar\" bukan laporan.",
].join("\n");

const PHASE_AGENT_REPORT = [
  "Kontrak laporan (wajib, di akhir):",
  "- Baris pertama: `Status: selesai | sebagian | terhalang | menunggu-keputusan`.",
  "- `Artefak:` path berkas yang kamu tulis/ubah.",
  "- `Bukti:` perintah yang dijalankan beserta hasil yang benar-benar kamu baca.",
  "- `Keputusan terbuka:` (wajib) daftar pertanyaan, atau `-` bila tak ada. `selesai` hanya sah bila isinya `-`.",
  "- `Rekomendasi fase:` (opsional) mis. `jalur-cepat` sesudah Audit qa.",
  "Klaim tanpa bukti bukan bukti. Maksimal 1200 kata.",
].join("\n");

const ATTACHMENT_NOTE =
  "Bila serah-terima menyebut manifest lampiran (`INDEX.md`), baca manifest itu dan lampiran yang "
  + "relevan di awal fase.";

// S2 · cermin `resumeClause` (prompt.ts) untuk subagent: tanpa ini agen fase yang lahir di worktree
// sesi sebelumnya menulis ulang pekerjaan belum-commit, atau Brainstorm membuat dokumen spec KEDUA.
function resumeNoteFor(r: NonNullable<PhaseAgentContext["resume"]>): string {
  return "=== MELANJUTKAN ===\n" + [
    "Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya untuk tugas yang sama — bukan memulai dari nol.",
    r.worktreeKept
      ? "Worktree ini adalah worktree sesi sebelumnya apa adanya — termasuk perubahan yang belum di-commit."
      : "Worktree ini DIBANGUN ULANG dari tip branch sesi: commit sesi sebelumnya ada, tetapi perubahan "
        + "yang belum sempat di-commit TIDAK ada.",
    r.recorded.length
      ? `Fase yang SUDAH tercatat di $HANOMAN_PHASE_FILE: ${r.recorded.join(" · ")}.`
      : "",
    "Sebelum menulis apa pun: baca `git log --oneline` dan `git status`, lalu artefak fasemu yang "
      + "mungkin sudah ada (dokumen spec/plan/docs untuk tugas ini). Lanjutkan & perbarui berkas itu — "
      + "JANGAN membuat dokumen baru kedua dan JANGAN menulis ulang yang sudah ada.",
  ].filter(Boolean).join(" ");
}

/** Defensif seperti `readSpecMethod`: payload datang dari kolom Json. */
export function fromAuditOf(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>).fromAudit;
  return typeof value === "string" && value ? value : undefined;
}

function backlogGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  const m = ctx.method;
  switch (phase) {
    case "Brainstorm":
      return "- Brainstorm: gali konteks, alternatif, dan keputusan untuk backlog ini dari Source of Truth "
        + `dan kode. Tulis hasilnya sebagai bagian \`## Konteks & keputusan\` di dokumen spec baru di `
        + `\`${m.specDir}/\` (nama berkas \`<YYYY-MM-DD>-<spec-id>-<slug>-design.md\`) dan laporkan path-nya.`
        + (ctx.fromAudit
          ? ` Backlog ini LANJUTAN audit ${ctx.fromAudit}: baca \`internal/docs/research/audit-`
            + `${ctx.fromAudit.toLowerCase()}-*.md\` lebih dulu dan pakai temuannya sebagai bahan — jangan `
            + "menginvestigasi ulang dari nol."
          : "");
    case "Objective":
      return "- Objective: baca dokumen spec dari fase Brainstorm (path-nya di serah-terima), lalu tambahkan "
        + "bagian `## Objective` berisi SATU objective terukur beserta kriteria suksesnya.";
    case "Spec":
      // I-2 · ADR-0164 · qa lanjutan audit (`fromAudit`): orchestrator menandai Audit `skipped`
      // SENDIRI (lihat `auditContinuationForOrchestrator`) — agen fase Audit tak pernah dipanggil
      // pada kontinuitas ini. Spec-lah fase PERTAMA yang benar-benar dipanggil, jadi catatan dokumen
      // audit asal harus ikut di sini, bukan di Audit (yang di flow ini tak dieksekusi).
      return flow === "qa"
        ? `- Spec: tulis dokumen spec perbaikan di \`${m.specDir}/\` dari dokumen audit fase Audit (path-nya `
          + "di serah-terima): akar masalah, bentuk perbaikan, dan acceptance criteria gaya EARS."
          + (ctx.fromAudit
            ? ` Backlog ini LANJUTAN audit ${ctx.fromAudit} — fase Audit sengaja DILEWATI orchestrator, `
              + `jadi baca dokumennya di \`internal/docs/research/audit-${ctx.fromAudit.toLowerCase()}-*.md\` `
              + "(path juga ada di serah-terima) sebagai temuan; jangan menginvestigasi ulang dari nol."
            : "")
        : "- Spec: lengkapi dokumen spec yang sama — arsitektur, komponen, kontrak data/API, penanganan "
          + "galat, dan acceptance criteria gaya EARS. Perbarui docs Source of Truth yang tersentuh.";
    // ADR-0170 P2 · gerbang plan server mencocokkan spec-id di NAMA berkas; plan tanpa spec-id (nama
    // default skill) lolos hampa. Nama dikunci seperti Brainstorm, dan path persisnya diteruskan
    // orchestrator ke Execute & reviewer — bukan pola glob yang bisa mencocoki plan backlog lain.
    case "Plan":
      return "- Plan: tulis plan implementasi berkotak `- [ ]` untuk backlog ini dari dokumen spec-nya (path di "
        + `serah-terima) ke SATU berkas \`${m.planDir}/<YYYY-MM-DD>-<spec-id>-<slug>.md\` (spec-id backlog `
        + "ini huruf kecil, mis. `2026-09-25-spec-123-ekspor-csv.md` — nama tanpa spec-id membuat hanoman tak "
        + "menemukan plan-nya). Laporkan path PERSIS berkas itu di `Artefak:`; orchestrator meneruskannya "
        + "ke Execute.";
    case "Execute":
      return "- Execute: kerjakan plan backlog ini — path persisnya di baris `Artefak fase sebelumnya:` "
        + `serah-terima (bila tak ada: berkas di \`${m.planDir}/\` yang namanya memuat spec-id backlog ini). `
        + "Execute BELUM selesai selama plan masih punya task `- [ ]`: kerjakan SEMUA task sampai tiap kotak "
        + "jadi `- [x]` sebelum melapor `Status: selesai`. hanoman menahan backlog di `executing`, bukan "
        + "`done`, selama masih ada `- [ ]`. Laporan `Status: selesai` wajib memuat tabel `AC → bukti`: "
        + "setiap acceptance criteria dokumen spec (qa jalur-cepat: dokumen audit) → perintah yang kamu "
        + "jalankan beserta hasil yang kamu baca, atau path:baris yang membuktikannya. AC tanpa bukti = "
        + "belum selesai; laporanmu diperiksa ulang sebelum fase ditutup.";
    case "Audit":
      return flow === "audit"
        ? "- Audit: ini audit-only — investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Telusuri akar "
          + "masalah / log / jawaban dan nilai apakah issue terdefinisi dengan baik. Laporkan temuan beserta "
          + "buktinya; dokumennya ditulis fase Laporan."
        : "- Audit: telusuri akar masalah dengan bukti (reproduksi, log, kode) dan tulis dokumen audit ke "
          + "`internal/docs/research/audit-<spec-id>-<slug>.md`. Lalu putuskan jalurnya dari hasil Audit, "
          + "bukan default: bila temuan berconfidence tinggi dan perbaikannya bisa dikerjakan langsung (diff "
          + "kecil, akar masalah jelas), tulis `Rekomendasi fase: jalur-cepat` beserta alasannya — "
          + "orchestrator akan melewati Spec & Plan dan dokumen audit menjadi doc-of-record perbaikan itu. "
          + "Bila temuan luas, berisiko, atau ambigu, tulis `Rekomendasi fase: penuh`.";
    case "Laporan":
      return "- Laporan: tulis DOKUMEN AUDIT ke Source of Truth `internal/docs/research/audit-<spec-id>-<slug>.md` "
        + "(ikuti konvensi audit yang ada), tautkan di `internal/docs/README.md`, memuat: keluhan/pertanyaan, "
        + "temuan (dengan bukti/log), apakah issue terdefinisi baik, dan rekomendasi tindak lanjut. Commit "
        + "dokumen itu. Tak ada kode fitur.\n\n" + ESCALATION_CONTRACT;
    case "Goal":
      return "- Goal: kerjakan goal di blok KONTEKS sampai tercapai. TIDAK ada design doc, plan berkotak, "
        + "maupun backlog baru.";
    case "Verifikasi":
      return "- Verifikasi: bukan formalitas — jalankan perintah yang membuktikan goal-nya tercapai "
        + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output bukan bukti.";
    case "Kerjakan":
      return "- Kerjakan: SATU pekerjaan remeh. Langsung kerjakan dan buktikan seperlunya di fase yang sama. "
        + "Jangan menulis design doc, plan berkotak, backlog baru, atau fase tambahan.";
    default:
      return "";
  }
}

// Audit R4 · baris panduan fase bergiliran (Wawancara reverse, Brainstorm scaffold/prd) dan Serah
// terima reverse ditulis untuk sesi tunggal yang BERHADAPAN dengan manusia lewat terminal. Agen fase
// tak punya jalur itu — pertanyaannya hanya sampai lewat laporan yang di-relay orchestrator
// (langkah 4). Kalimat terminal diganti HANYA di instruksi agen fase; sumbernya (dan prompt sesi
// tunggal, golden test) tak berubah. Bila kalimat sumber bergeser, test phase-agents memerah.
const TERMINAL_ASK = /([Aa])jukan SATU pertanyaan per giliran ke manusia di terminal ini, tunggu jawabannya(?=[,.])/;
const PHASE_AGENT_ASK =
  "jukan pertanyaannya sebagai butir `Keputusan terbuka:` di laporanmu — satu topik per putaran, beserta "
  + "konteks & opsinya, karena kamu tak berhadapan langsung dengan manusia — lalu tulis `Status: "
  + "menunggu-keputusan` dan berhenti; jawabannya datang sebagai pesan susulan ke agen yang sama";
const TERMINAL_HANDOFF = "tulis ringkasan hasil + daftar pertanyaan yang belum terjawab ke terminal.";
const PHASE_AGENT_HANDOFF =
  "tulis bagian `Ringkasan serah terima:` di laporanmu berisi ringkasan hasil + daftar pertanyaan yang "
  + "belum terjawab (informasi untuk manusia, BUKAN `Keputusan terbuka:`) — orchestrator yang "
  + "menampilkannya ke manusia.";
const forPhaseAgent = (line: string): string =>
  line.replace(TERMINAL_ASK, (_m, a: string) => a + PHASE_AGENT_ASK).replace(TERMINAL_HANDOFF, PHASE_AGENT_HANDOFF);

function projectGuide(flow: Flow, phase: string, ctx: PhaseAgentContext): string {
  if (flow === "reverse") return forPhaseAgent(guideLine(REVERSE_PHASE_GUIDE, phase));
  if (flow === "scaffold") return forPhaseAgent(guideLine(SCAFFOLD_PHASE_GUIDE, phase));
  const slug = ctx.prd?.slug ?? flow;
  const lines: Record<string, string> = flow === "prd"
    ? prdPhaseLines(slug)
    : breakdownPhaseLines(slug, ctx.prd?.title ?? slug);
  return forPhaseAgent(lines[phase] ?? "");
}

/** Instruksi agen fase TANPA blok KONTEKS — konteks bersama dirakit `phasePromptOf` (T2). */
export function phaseAgentInstructions(
  entry: PhasePlanEntry, index: number, plan: PhasePlan, ctx: PhaseAgentContext,
): string {
  const { flow, method } = ctx;
  const phase = entry.phase;
  const guide = PROJECT_FLOWS.has(flow) ? projectGuide(flow, phase, ctx) : backlogGuide(flow, phase, ctx);
  const executeMode = plan.executeMode ?? "inline";
  const skills = phaseSkillsFor(flow, phase, method, plan.runtime, executeMode);
  // Amandemen ADR-0170 P2 · skill subagent-driven punya final whole-branch review sendiri; saat
  // reviewer `hanoman-fase-review` ada, itu review akhir KEDUA atas diff yang sama — dilewati.
  const skipSkillFinalReview = phase === "Execute" && plan.runtime === "claude" && executeMode === "subagent"
    && !!plan.reviewer && skills.includes("superpowers:subagent-driven-development");
  const work = (WORK_PHASES as readonly string[]).includes(phase);
  // ADR-0170 P2 · Verifikasi (goal) menjalankan test/typecheck — tanpa klausa scope ia jatuh ke DoD
  // repo target (suite penuh), lubang yang sama dengan ADR-0080. Gaya kode tetap hanya fase kerja.
  const verifies = work || phase === "Verifikasi";
  return [
    `Kamu agen fase "${phase}" (fase ${index + 1}/${plan.phases.length}) flow ${flow} hanoman. Ikuti `
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam "
      + "commit yang sama.",
    guide,
    DOC_WRITING_PHASES.has(phase) ? `=== STANDAR DOCS ===\n${REVERSE_STANDARD}` : "",
    skills.length
      ? `Skills ${method.label} WAJIB untuk fase ini — muat & ikuti dengan mekanisme yang tersedia di agenmu: `
        + skills.join(", ")
      : "",
    skipSkillFinalReview
      ? "LEWATI final whole-branch review milik skill subagent-driven-development: review akhir dipegang "
        + "reviewer `hanoman-fase-review` yang dipanggil orchestrator sesudah fase ini. Review per task tetap jalan."
      : "",
    verifies ? scopeClause(flow, ctx.verifyScope) : "",
    work ? codeStyleClause(flow) : "",
    methodClause(method),
    ATTACHMENT_NOTE,
    PHASE_AGENT_AUTONOMY,
    PHASE_AGENT_RULES,
    PHASE_AGENT_REPORT,
    // S2 · catatan resume kecil & khas sesi → tetap di instruksi; konteks bersama yang besar dirakit
    // terpisah oleh `phasePromptOf` (T2) supaya tak disalin ke tiap agen.
    ctx.resume ? resumeNoteFor(ctx.resume) : "",
  ].filter(Boolean).join("\n\n");
}

export function buildPhaseAgents(plan: PhasePlan, ctx: PhaseAgentContext): AgentDef[] {
  const phases: AgentDef[] = plan.phases.map((entry, index) => ({
    kind: "phase" as const,
    phase: entry.phase,
    name: entry.agentName,
    description: `Fase ${entry.phase} flow ${plan.flow} hanoman — hanya dipanggil orchestrator sesi ini.`,
    instructions: phaseAgentInstructions(entry, index, plan, ctx),
    // T2 · konteks bersama dibawa TERPISAH (lihat `phasePromptOf`): claude merujuknya lewat satu
    // berkas di temp dir sesi, codex tetap inline.
    context: ctx.context,
    tools: null,
    model: entry.model,
    effort: entry.effort,
    mentions: [],
    executeMode: plan.executeMode ?? "inline",
  }));
  // ADR-0170 P2 · reviewer hanya bila rencana memuat Execute (continue: rencana = Execute saja).
  const r = plan.reviewer;
  if (!r || !plan.phases.some((p) => p.phase === r.phase)) return phases;
  return [...phases, {
    kind: "phase" as const,
    phase: r.phase,
    name: r.agentName,
    description: `Reviewer independen hasil fase Execute flow ${plan.flow} hanoman — hanya dipanggil `
      + "orchestrator sesi ini, sesudah Execute melapor selesai.",
    instructions: reviewerInstructions(plan, ctx),
    context: ctx.context,
    tools: null,
    model: r.model,
    effort: r.effort,
    mentions: [],
  }];
}

// ADR-0170 P2 · reviewer independen. Diturunkan dari `spec-auditor` (builtin-agents.ts) + gerbang
// bukti: audit 2026-09-25 — 98% sesi `done` hanya berdasar klaim agen, 7/200 sesi memanggil reviewer.
// Read-only lewat instruksi (bukan `tools`): ia butuh Bash untuk test, dan agen fase dirender tanpa
// kunci `tools` (ADR-0164 keputusan 3). Kosakata putusan per kriteria SATU sumber dengan spec-auditor
// (`SPEC_AUDIT_VERDICTS`, audit custom agent P1-6): dua daftar yang menyimpang = dua skala berbeda.
const REVIEWER_RULES = [
  "Batas peran reviewer:",
  "- JANGAN mengubah, membuat, atau menghapus berkas apa pun di worktree, JANGAN commit, JANGAN "
    + "`git push`/`git stash`/`git checkout`/`git reset`. Kamu membaca dan menjalankan perintah verifikasi saja.",
  "- JANGAN menulis `$HANOMAN_PHASE_FILE` dan JANGAN memperbaiki temuanmu sendiri — perbaikan milik agen "
    + "Execute, marker milik orchestrator.",
  `- JANGAN memanggil agen berawalan \`${PHASE_AGENT_PREFIX}\`.`,
  "- JANGAN mengakhiri giliran atau melapor selama masih menunggu proses/tugas latar milikmu sendiri "
    + "(test yang kamu jalankan di latar): tunggu sampai selesai dan baca hasilnya, lalu tulis laporan "
    + "lengkap berawalan `Status:`.",
].join("\n");

function reviewerInstructions(plan: PhasePlan, ctx: PhaseAgentContext): string {
  const m = ctx.method;
  return [
    `Kamu reviewer independen hasil fase Execute flow ${plan.flow} hanoman. Kamu dipanggil orchestrator `
      + "sesudah agen Execute melapor `Status: selesai` dan SEBELUM fase itu ditutup. Kamu pengadu janji: "
      + "yang kamu nilai bukan bagus-tidaknya kode, melainkan apakah yang DIMINTA benar-benar ada dan "
      + "TERBUKTI pada keadaan akhir worktree ini.",
    "Prosedur:",
    [
      "1. Baca dokumen spec & plan dari baris `Artefak:` serah-terima (qa jalur-cepat: dokumen audit adalah "
        + `doc-of-record; bila path tak ada, cari berkas ber-spec-id di \`${m.specDir}/\` & \`${m.planDir}/\`). `
        + "Plan yang menyimpang dari spec adalah temuan.",
      "2. Ubah acceptance criteria jadi daftar yang diperiksa SATU PER SATU. Kalimat tak terukur ditandai "
        + "tak terukur, bukan ditafsirkan.",
      '3. Baca `git diff "$HANOMAN_BASE_SHA"...HEAD` dan `git status --porcelain` (perubahan belum di-commit '
        + "adalah temuan). Laporan Execute dan kotak `- [x]` hanyalah klaim.",
      "4. Jalankan test yang relevan dengan berkas yang berubah, sesuai scope verifikasi di bawah, dan baca "
        + "outputnya sendiri.",
      `5. Per kriteria putuskan salah satu: ${SPEC_AUDIT_VERDICT_LIST}. Kriteria tanpa jangkar di diff `
        + "bukan otomatis gagal — cari bukti keadaan akhir; tak bisa dibuktikan → belum terverifikasi.",
    ].join("\n"),
    scopeClause(plan.flow as Flow, ctx.verifyScope),
    REVIEWER_RULES,
    PHASE_AGENT_AUTONOMY,
    [
      "Kontrak laporan (wajib, di akhir, maksimal 1000 kata):",
      "- Baris pertama: `Status: selesai` (review tuntas) | `terhalang` | `menunggu-keputusan`.",
      "- Tabel: AC · putusan · bukti (perintah + hasil yang kamu baca, atau path:baris).",
      "- Satu baris `Verdict: lulus` atau `Verdict: rework`.",
      "- `Temuan wajib diperbaiki:` daftar bernomor (path:baris, apa yang kurang terhadap AC, buktinya), "
        + "atau `-`.",
      "- `Catatan (tak memblokir):` selera, gaya, refactor opsional, pekerjaan di luar yang diminta.",
      "- `Keputusan terbuka:` (wajib) AC yang bisa dibaca lebih dari satu cara, atau `-`. `selesai` hanya sah "
        + "bila isinya `-`.",
      "`rework` HANYA untuk kekurangan nyata: AC tak terpenuhi / terpenuhi berbeda / tak terbukti karena "
        + "buktinya memang tak ada, test merah, regresi, perubahan belum di-commit, atau plan masih `- [ ]` — "
        + "bukan selera. Tanpa temuan semacam itu, `lulus`.",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

// ADR-0170 P2 · klausa delegasi agen fase. Hanya berarti sejak subagent FOREGROUND (env
// `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`, 6a249ae2 — amandemen ADR-0164 T1): agen fase kini
// menunggu anaknya, dan beberapa pemanggilan dalam satu pesan berjalan paralel (maks 3 per sesi).
// Disusun di `createSession` (roster custom agent baru pasti di sana) — BUKAN di prompt orchestrator.
type DelegationRole = "research" | "execute" | "execute-inline" | "none";
const roleOf = (phase: string): DelegationRole =>
  phase === "Execute" || phase === "Goal" ? "execute"
    : phase === "Kerjakan" || phase === "Verifikasi" ? "none" : "research";

/** Custom agent yang BENAR-BENAR hidup: codex tak memuat isolated-worktree (materializeCodexAgents). */
const liveCustoms = (roster: AgentDef[], runtime: "claude" | "codex"): AgentDef[] =>
  roster.filter((d) => d.kind !== "phase" && !(runtime === "codex" && d.workspacePolicy === "isolated-worktree"));

export function phaseDelegationClause(
  phase: string, roster: AgentDef[], runtime: "claude" | "codex", executeMode: "inline" | "subagent" = "inline",
): string {
  // Amandemen ADR-0170 P2 · claude `inline` (default): agen fase kerja mengerjakan task SENDIRI.
  // codex tak disentuh setelan ini — subagent bersarang di sana belum pernah diukur.
  const base = roleOf(phase);
  const role: DelegationRole = base === "execute" && runtime === "claude" && executeMode === "inline"
    ? "execute-inline" : base;
  if (role === "none") return "";
  const codex = runtime === "codex";
  const call = codex ? "spawn_agent" : "tool Agent";
  const live = liveCustoms(roster, runtime);
  // Audit P0-2 · agen isolated-worktree hanya melihat COMMIT: tanpa tanda ini implementer Execute
  // mendelegasikan pekerjaan yang belum di-commit dan hasilnya tak pernah kembali ke worktree fase.
  const tag = (d: AgentDef): string =>
    [d.workspacePolicy === "read-only" ? "read-only"
      : d.workspacePolicy === "isolated-worktree" ? "worktree terpisah: commit kandidat dulu, hasil via SHA → cherry-pick" : "",
     d.model ?? "model sesi"].filter(Boolean).join(" · ");
  const who = live.length
    ? `Agen di sesi ini: ${live.map((d) => `\`${d.name}\` (${tag(d)})`).join(", ")}. Pilih `
      + (codex ? "nama agen" : "`subagent_type`") + " dari daftar ini sesuai deskripsinya."
    : "Tak ada custom agent di sesi ini: bila mendelegasikan, pakai subagent bawaan runtime yang read-only "
      + "untuk pencarian.";
  const when = role === "execute-inline"
    ? "Kerjakan task plan SENDIRI, berurutan, di agen ini — JANGAN mendelegasikan implementasi task ke "
      + "subagent (satu subagent per task terukur terlalu lambat; operator memilih mode inline). Subagent "
      + "hanya untuk pembacaan read-only yang menyapu banyak berkas: pecah jadi 2–3 pencarian sempit dan "
      + "panggil dalam SATU pesan (paralel) ke agen read-only termurah. Worktree ini sudah terisolasi — jangan "
      + "membuat worktree/branch baru; merge & push milik orchestrator."
    : role === "research"
    ? "Kapan: pertanyaan yang butuh menyapu banyak berkas — pecah jadi 2–3 pencarian sempit & independen, "
      + "panggil semuanya dalam SATU pesan (berjalan paralel) ke agen read-only termurah, lalu sintesis "
      + "dan tulis artefak fasemu SENDIRI. Satu berkas/simbol yang sudah kamu tahu: cari sendiri."
    : "Kapan: satu implementer per task plan, BERURUTAN (implementer paralel di satu worktree saling "
      + "tabrak), lalu review task itu sebelum menandai `- [x]`. Paralel (dalam SATU pesan) hanya untuk "
      + "pembacaan read-only: pencarian konteks atau review. Worktree ini sudah terisolasi — jangan membuat "
      + "worktree/branch baru; merge & push milik orchestrator.";
  return [
    "=== DELEGASI ===",
    `Subagent yang kamu panggil lewat ${call} berjalan foreground: kamu menunggu hasilnya.`,
    when,
    who,
    (codex
      ? "Hindari agen umum untuk pencarian — ia mewarisi model sesi yang mahal."
      : "Jangan pakai `general-purpose` untuk pencarian — ia mewarisi model sesi yang mahal"
        + (role === "execute"
          ? "; bila terpaksa (implementer tanpa agen yang cocok), isi parameter `model` eksplisit."
          : "."))
      + " JANGAN memanggil `hanoman-fase-*`.",
    "Serah-terima ke anak: tujuan, scope berkas, Base SHA (NILAI hasil `echo $HANOMAN_BASE_SHA`, bukan nama "
      + "variabelnya), jangkar path:baris yang "
      + "sudah kamu tahu, dan bentuk laporan yang kamu minta. Anak DILARANG `git push` dan `git stash`, "
      + "dan commit hanya dengan `git add <path>` eksplisit.",
    "Baca SEMUA laporan anak sebelum melapor — klaim anak bukan bukti sampai kamu periksa. `Keputusan "
      + "terbuka:` anak diteruskan ke `Keputusan terbuka:` laporanmu, jangan dijawab sendiri.",
  ].join("\n");
}

/** ADR-0170 P2 · tempel klausa delegasi ke instruksi tiap agen fase (bukan reviewer) sesuai roster. */
export function withPhaseDelegation(
  phaseDefs: AgentDef[], roster: AgentDef[], runtime: "claude" | "codex",
): AgentDef[] {
  return phaseDefs.map((def) => {
    if (def.kind !== "phase" || !def.phase || def.name === REVIEWER_AGENT_NAME) return def;
    const clause = phaseDelegationClause(def.phase, roster, runtime, def.executeMode ?? "inline");
    return clause ? { ...def, instructions: `${def.instructions}\n\n${clause}` } : def;
  });
}
