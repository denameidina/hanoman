import type { Flow, SpecBrief, ProjectBrief, PrdBrief, AuditDoc, BreakdownPrd, Autonomy, VerifyScope, ResumeCtx } from "./types";
import { REVERSE_STANDARD } from "./reverse-standard";
import { verifyScopeClause } from "./verify-scope";
import { CODE_STYLE_CLAUSE } from "./code-style";
import { readGoalPayload } from "./goal-spec";

export const PIPELINES: Record<Flow, readonly string[]> = {
  feature: ["Brainstorm", "Objective", "Spec", "Plan", "Execute"],
  qa: ["Audit", "Spec", "Plan", "Execute"],
  scaffold: ["Brainstorm", "Objective", "Doc index"],
  reverse: ["Scan", "Docs teknis", "Wawancara", "Konvensi & index", "Serah terima"],
  prd: ["Brainstorm", "PRD"],
  audit: ["Audit", "Laporan"],
  breakdown: ["Analisis", "Breakdown"],
  // SPEC-337 · ADR-0075 · audit lintas project: fase & stage-map identik audit-only, scope-nya
  // yang berbeda (project utama + tetangga ProjectLink).
  // SPEC-407 · ADR-0089 · backlog goal: tak ada fase perencanaan sama sekali. `Goal` = kerjakan,
  // `Verifikasi` = buktikan. Kedua nama unik lintas PIPELINES — syarat peta REACHED di server,
  // yang berkunci nama fase saja.
  goal: ["Goal", "Verifikasi"],
};

// SPEC-252 · ADR-0061 — model & effort kini PER SESI (dipilih saat Start, argv saat lahir), bukan per
// fase. Matrix per-fase + injeksi `/model`+`/effort` oleh agen (resolvePhaseModels/phaseModelInstruction,
// ADR-0058) dicabut: tak andal karena bergantung agen menembus batas fase. Prompt tak lagi memuat blok itu.

// SPEC-187 · ADR-0035 — sesi spec-flow menggerakkan dirinya sendiri melewati seluruh fase
// (ADR-0024): tak ada runner yang menyuntik giliran berikutnya. Skill superpowers punya
// checkpoint "review/approval"; di sesi tak-berpenunggu itu BUKAN titik berhenti, dan agen
// yang mematuhinya akan mandek diam menunggu review yang tak akan datang. Berhenti hanya untuk
// keputusan manusia sejati, yang agen surface sebagai pertanyaan di terminalnya (ADR-0024).
// Sengaja tak dipakai startProjectPrompt: fase Wawancara reverse memang interaktif.
const AUTONOMY_CLAUSE =
  "Jalankan seluruh pipeline sampai tuntas tanpa berhenti di batas antar-fase. Checkpoint "
  + "\"review\"/\"approval\"/\"need review\" milik skill superpowers BUKAN titik berhenti di sini — "
  + "lanjut saja ke fase berikutnya. Berhenti HANYA saat butuh keputusan manusia sejati (percabangan "
  + "yang mengubah bentuk kerja: data model, kontrak API, scope); saat itu tanyakan di terminal ini "
  + "dan tunggu jawabannya. Selain itu, terus lanjut.";

// SPEC-298 · varian full-control untuk sesi scheduler tak-berpengawas: agen memutuskan sendiri di
// SETIAP percabangan (termasuk data model/kontrak API/scope) dan menembus sampai `done` tanpa pernah
// berhenti bertanya (tak ada manusia di terminal yang menjawab). Keputusan dicatat di commit agar
// bisa di-review pasca-fakta; merge tetap manual (ADR-0031). Lawan dari AUTONOMY_CLAUSE
// (butuh-keputusan) yang menyuruh berhenti & bertanya di terminal.
const AUTONOMY_CLAUSE_FULL =
  "Kamu berjalan TANPA pengawas — tak ada manusia yang menonton terminal ini untuk menjawab. "
  + "Putuskan sendiri di SETIAP percabangan (termasuk yang mengubah bentuk kerja: data model, "
  + "kontrak API, scope) berdasarkan Source of Truth dan penilaian terbaikmu; JANGAN berhenti "
  + "bertanya. Tembus seluruh pipeline sampai stage `done`, lalu commit & push. Jangan menunggu "
  + "review/persetujuan siapa pun — catat asumsi & keputusan penting di pesan commit agar bisa "
  + "di-review pasca-fakta. Merge ke branch utama tetap dilakukan manusia, bukan kamu.";

// SPEC-298 · pilih klausa per mode. undefined (peluncuran manual) → klausa tanya (lama): sesi
// manual berpengawas, manusia menonton & boleh menjawab.
const autonomyClause = (mode?: Autonomy): string =>
  mode === "full-control" ? AUTONOMY_CLAUSE_FULL : AUTONOMY_CLAUSE;

// Agen yang melapor, server yang menonton: di PTY tak ada batas giliran yang terbaca mesin.
// Append, bukan tulis-timpa — keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
// yang bisa terlewat kalau server sedang tidak menonton. Berkasnya di luar worktree, jadi
// `git add -A` milik agen tak mungkin men-stage-nya.
const phaseInstruction = (phases: readonly string[]) => {
  const base =
    `Kerjakan fase berurutan: ${phases.join(" → ")}.\n`
    + `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas `
    + `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, `
    + `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;
  // Flow ber-fase Plan+Execute saja (feature, qa): Execute belum selesai selama plan masih
  // punya kotak `- [ ]`. Cermin server-side gate (SPEC-173, ADR-0029) di prompt-nya.
  if (!phases.includes("Plan") || !phases.includes("Execute")) return base;
  return base
    + `\nExecute BELUM selesai selama plan (\`docs/superpowers/plans/**\`) masih punya task `
    + `\`- [ ]\`: kerjakan SEMUA PR/task sampai tiap kotak jadi \`- [x]\` sebelum menulis `
    + `\`Execute done\`. hanoman menahan backlog di \`executing\`, bukan \`done\`, selama masih ada \`- [ ]\`.`;
};

// Peta fase → skill superpowers (SPEC-166). Objective dan Spec adalah keluaran skill
// brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri.
// Fase reverse dipandu standar docs di prompt-nya, bukan skill.
const PHASE_SKILLS: Record<string, readonly string[]> = {
  Brainstorm: ["superpowers:brainstorming"],
  Audit: ["superpowers:systematic-debugging"],
  Plan: ["superpowers:writing-plans"],
  Execute: [
    "superpowers:executing-plans",
    "superpowers:test-driven-development",
    "superpowers:verification-before-completion",
  ],
  // SPEC-407 · fase `Goal` sengaja TANPA skill: seluruh inti flow ini adalah membebaskan sesi
  // dari proses kaku. Yang tetap dijaga cuma pintu keluarnya.
  Verifikasi: ["superpowers:verification-before-completion"],
};

const skillInstruction = (phases: readonly string[]) => {
  const lines = phases
    .filter((p) => PHASE_SKILLS[p])
    .map((p) => `- ${p}: ${PHASE_SKILLS[p]!.join(", ")}`);
  // SPEC-338 · ADR-0074 · netral-agen: Claude Code meng-invoke skill lewat Skill tool, Codex CLI
  // memuatnya secara native. Prompt menyebut HASIL yang diminta, bukan mekanismenya — satu prompt
  // melayani kedua agen tanpa percabangan.
  return lines.length
    ? "Skills superpowers WAJIB: sebelum mengerjakan fase di bawah, muat & ikuti skill-nya dengan "
      + `mekanisme yang tersedia di agenmu — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};

// SPEC-204 · ADR-0040 — jalur cepat qa: sesudah Audit, temuan berconfidence tinggi yang
// perbaikannya langsung (diff kecil, akar masalah jelas) melewati Spec+Plan. Keputusan
// diambil AGEN, disurface sebagai `skipped` di phase file (bukan artefak runner — mekanisme
// ADR-0020 disuperseded). Confidence hidup di sini, satu-bit; buktinya `reason` audit di log.
const auditDecisionInstruction = (flow: Flow): string =>
  flow !== "qa" ? "" :
    "Keputusan pasca-Audit (qa): bila temuan berconfidence tinggi dan perbaikannya bisa "
    + "dikerjakan langsung (diff kecil, akar masalah jelas), LEWATI Spec dan Plan — tandai "
    + "keduanya `skipped` (`echo \"Spec skipped\" >> \"$HANOMAN_PHASE_FILE\"` lalu "
    + "`echo \"Plan skipped\" >> \"$HANOMAN_PHASE_FILE\"`) dan langsung ke Execute; dokumen "
    + "audit menjadi doc-of-record perbaikan itu. Bila temuan luas, berisiko, atau ambigu, "
    + "jalankan Spec → Plan → Execute penuh. Keputusan ini milikmu berdasarkan hasil Audit, "
    + "bukan default — jangan bayar perencanaan yang tak perlu untuk perbaikan sepele.";

// SPEC-340 · ADR-0076 — rekomendasi tindak lanjut audit harus TERBACA MESIN, bukan prosa. Sesi
// audit menulis satu blok ```json kanonik di dokumen auditnya; server mem-parse-nya
// (services/audit-escalation.ts) dan UI menyorot target yang direkomendasikan. Pola manifest
// breakdown (ADR-0069): prosa untuk manusia + satu blok json untuk mesin, di dokumen yang sama.
export const ESCALATION_CONTRACT = [
  "REKOMENDASI ESKALASI (wajib, terbaca mesin). Di bagian akhir dokumen audit, tulis bagian",
  "`## Rekomendasi eskalasi` berisi penjelasan singkat untuk manusia, LALU tepat SATU blok ```json",
  "berbentuk persis seperti ini (satu-satunya blok json di dokumen itu):",
  "",
  "```json",
  '{ "escalation": { "target": "none|qa|brief|prd", "reason": "<alasan singkat>",',
  '  "alternatives": ["<target lain yang masuk akal>"],',
  '  "prefill": { "title": "", "context": "", "outcome": "", "constraints": "", "severity": "", "steps": "" } } }',
  "```",
  "",
  "Pilih `target` dari hasil auditmu, bukan default:",
  '- "qa" — bug / regresi / perilaku salah yang perlu diperbaiki. Isi `prefill.severity`',
  "  (critical|major|minor) dan `prefill.steps` (langkah reproduksi).",
  '- "brief" — kebutuhan/fitur yang bentuknya sudah jelas dan cakupannya satu backlog.',
  "  Isi `prefill.title`, `prefill.context`, `prefill.outcome`.",
  '- "prd" — kebutuhan produk yang besar, ambigu, atau lintas modul sehingga perlu dokumen PRD',
  "  lebih dulu. Isi `prefill.title`, `prefill.context`, `prefill.outcome`.",
  '- "none" — pertanyaannya sudah terjawab; tak perlu perbaikan maupun fitur baru.',
  "",
  "`alternatives` boleh array kosong. Jangan menulis blok json lain di dokumen itu.",
].join("\n");

// SPEC-237 · ADR-0057 — flow audit-only: investigasi + dokumen, TANPA perbaikan kode. Deliverable =
// dokumen audit SoT yang menilai apakah issue terdefinisi baik + rekomendasi tindak lanjut.
// SPEC-340 · ADR-0076 — rekomendasi itu kini bukan lagi prosa bebas "cukup jawaban / naik jadi QA":
// ia memuat blok json kanonik dengan salah satu dari EMPAT target (none/qa/brief/prd).
const auditOnlyInstruction = (flow: Flow): string =>
  flow !== "audit" ? "" :
    "Ini audit-only: investigasi SAJA, JANGAN menulis perbaikan kode apa pun. Fase Audit "
    + "(systematic-debugging): telusuri akar masalah / log / jawaban dan nilai apakah issue "
    + "terdefinisi dengan baik. Fase Laporan: tulis DOKUMEN AUDIT ke Source of Truth "
    + "`internal/docs/research/audit-<spec-id>-<slug>.md` (ikuti konvensi audit yang ada), tautkan "
    + "di `internal/docs/README.md`, memuat: keluhan/pertanyaan, temuan (dengan bukti/log), apakah "
    + "issue terdefinisi baik, dan rekomendasi tindak lanjut. Commit dokumen itu lalu push. "
    + "Tak ada kode fitur.\n\n" + ESCALATION_CONTRACT;

// SPEC-244 · ADR-0059 — qa yang DINAIKKAN dari audit (payload.fromAudit) berjalan di branch audit,
// jadi dokumen audit sudah ada di worktree. Lewati fase Audit (jangan investigasi ulang), baca
// dokumen itu, tandai `Audit skipped`, lalu keputusan pasca-Audit ADR-0040.
// SPEC-340 · ADR-0076 — brief pun bisa dinaikkan dari audit. Bedanya SADAR: dokumen audit memuat
// TEMUAN, bukan bentuk solusi, jadi tak ada fase yang dilewati — Brainstorm tetap berjalan, hanya
// diberi bahan awal supaya tak menginvestigasi ulang dari nol.
const auditContinuationInstruction = (flow: Flow, spec: SpecBrief): string => {
  if (flow !== "qa" && flow !== "feature") return "";
  const fromAudit = spec.payload && typeof spec.payload === "object"
    ? (spec.payload as { fromAudit?: unknown }).fromAudit : undefined;
  if (typeof fromAudit !== "string" || !fromAudit) return "";
  const doc = `internal/docs/research/audit-${fromAudit.toLowerCase()}-*.md`;
  if (flow === "feature")
    return `Backlog brief ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit itu, `
      + `jadi dokumen audit sudah ada di ${doc}. BACA dokumen itu lebih dulu dan pakai sebagai bahan `
      + "fase Brainstorm & Objective — temuannya sudah terbukti, jangan menginvestigasi ulang dari nol. "
      + "Semua fase tetap dijalankan: dokumen audit memuat TEMUAN, bukan bentuk solusi, jadi perancangan "
      + "fitur tetap pekerjaanmu.";
  return `Backlog qa ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit itu, `
    + `jadi dokumen audit sudah ada di ${doc}. `
    + "JANGAN mengulang investigasi fase Audit dari nol — baca dokumen audit itu sebagai temuan, "
    + "tandai fase Audit dilewati (`echo \"Audit skipped\" >> \"$HANOMAN_PHASE_FILE\"`), lalu ambil "
    + "keputusan pasca-Audit: perbaikan jelas & kecil → langsung Execute (tandai `Spec skipped` dan "
    + "`Plan skipped` bila sesuai); selain itu Spec → Plan → Execute penuh.";
};

// SPEC-376 · ADR-0080 — klausa scope verifikasi hanya untuk flow yang MENULIS KODE. Flow
// dokumen (audit, prd, breakdown, reverse, scaffold) tak punya test untuk
// dijalankan, jadi klausanya cuma menambah token. Ditentukan dari kehadiran fase Execute —
// sumber kebenaran yang sama dengan gate plan di phaseInstruction.
// SPEC-407 · flow goal MENULIS KODE juga, meski pipeline-nya tak punya fase `Execute`. Tanpa
// klausa ini ia jatuh ke DoD repo target dan menjalankan suite penuh — persis lubang ADR-0080.
const writesCode = (flow: Flow): boolean =>
  PIPELINES[flow].includes("Execute") || PIPELINES[flow].includes("Goal");
const scopeClause = (flow: Flow, scope?: VerifyScope): string =>
  scope && writesCode(flow) ? verifyScopeClause(scope) : "";

// SPEC-543 · ADR-0108 — klausa gaya kode. Gerbangnya `writesCode` yang SAMA dengan scopeClause;
// menyalin daftar flow-nya berarti dua definisi "sesi ini menulis kode" yang bisa berselisih saat
// flow baru lahir. Tak ber-knob, sengaja berbeda dari verifyScope: tak ada keadaan di mana
// "sesi ini boleh menulis komentar yang mengulang kode" masuk akal untuk ditawarkan.
const codeStyleClause = (flow: Flow): string => writesCode(flow) ? CODE_STYLE_CLAUSE : "";

export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
      + `dan link-nya di index, dalam commit yang sama.`,
    phaseInstruction(PIPELINES[flow]),
    auditDecisionInstruction(flow),
    auditContinuationInstruction(flow, spec),
    auditOnlyInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-172 · reopen sesi backlog item yang keburu ditandai `done` padahal kerjanya belum
// tuntas (mis. spec ber-banyak-PR, baru sebagian beres). Beda dari startPrompt: TIDAK
// menggiring pipeline dari awal — spec & plan sudah ada, jadi sesi lanjut langsung di
// Execute. Kontinuitas: plan di docs/superpowers/plans/** menandai task `[x]`/`[ ]`, dan
// kerja yang selesai umumnya sudah ter-merge ke branchFrom (worktree lahir dari sana).
export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return [
    `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
      + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
      + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di docs/superpowers/plans/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    skillInstruction(["Execute"]),
    `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
      + `ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-394 · ADR-0084 — sesi backlog yang DILANJUTKAN. Beda dari continuePrompt (SPEC-172, yang
// melayani spec keburu-`done` dan karena itu melompat ke Execute): di sini pipeline-nya UTUH dan
// yang berubah hanya titik masuknya. Agen tak bisa menurunkan sendiri "fase mana yang sudah
// selesai" — berkas fase hidup di luar worktree dan tak ikut ter-checkout — jadi server yang
// menyebutkannya. Sengaja TIDAK menyalin baris fase ke phase file: berkas itu milik agen.
// SPEC-407 · `hasPlan` = pipeline-nya memang punya fase Plan. Sesi goal tak punya plan berkotak,
// dan menyuruhnya mencari plan justru mengundangnya membuat satu — persis ritual yang dihapus.
const resumeClause = (r: ResumeCtx, branchTo: string, hasPlan = true): string => {
  const fase = r.recorded.length
    ? `Fase yang SUDAH tercatat di $HANOMAN_PHASE_FILE: ${r.recorded.join(" · ")}. `
      + "JANGAN mengulang fase itu dan JANGAN menulis ulang barisnya."
    : "Belum ada fase yang tercatat di $HANOMAN_PHASE_FILE — worktree ini sendiri yang jadi "
      + "alasan melanjutkan.";
  const lanjut = r.next
    ? `Lanjutkan dari fase: ${r.next}.`
    : hasPlan
      ? "Semua fase sudah tercatat. Periksa apakah plan di `docs/superpowers/plans/**` masih "
        + "menyisakan task `- [ ]` dan selesaikan sisanya; bila sudah bersih, tinggal commit & push."
      : "Semua fase sudah tercatat. Buktikan sekali lagi goal-nya benar-benar tercapai, lalu "
        + "commit & push.";
  const worktree = r.worktreeKept
    ? "Worktree ini adalah worktree sesi sebelumnya apa adanya — termasuk perubahan yang belum "
      + "di-commit."
    : `Worktree ini DIBANGUN ULANG dari tip branch sesi \`${branchTo}\`: commit sesi sebelumnya `
      + "ada, tetapi perubahan yang belum sempat di-commit TIDAK ada.";
  const baca = hasPlan
    ? "Sebelum menulis apa pun: baca `git log --oneline` dan `git status`, lalu plan di "
      + "`docs/superpowers/plans/**` untuk backlog item ini (`- [x]` sudah selesai, `- [ ]` belum). "
      + "Jangan menulis ulang yang sudah ada."
    : "Sebelum menulis apa pun: baca `git log --oneline` dan `git status` untuk melihat apa yang "
      + "sudah dikerjakan. Jangan menulis ulang yang sudah ada.";
  return [
    "Sesi ini MELANJUTKAN pekerjaan sesi sebelumnya untuk backlog item yang sama — bukan memulai "
      + "dari nol.",
    fase, lanjut, worktree, baca,
  ].join(" ");
};

export function resumePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, resume: ResumeCtx,
  autonomy?: Autonomy, verifyScope?: VerifyScope,
): string {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  // Keputusan pasca-Audit (ADR-0040) hanya relevan selama Audit belum tercatat. Sesudah itu
  // keputusannya SUDAH diambil dan sudah mewujud sebagai baris `Spec skipped`/`Spec done` di
  // berkas fase — menyuruh agen memutuskannya lagi berarti mengundangnya membatalkan keputusan
  // sesi sebelumnya.
  const auditDecided = resume.recorded.some((line) => line.startsWith("Audit "));
  return [
    `hanoman ${flow} — MELANJUTKAN sesi backlog yang sudah berjalan. Ikuti internal/docs sebagai `
      + `Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam commit yang sama.`,
    resumeClause(resume, branchTo, PIPELINES[flow].includes("Plan")),
    phaseInstruction(PIPELINES[flow]),
    auditDecided ? "" : auditDecisionInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    skillInstruction(PIPELINES[flow]),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-407 · ADR-0089 · sesi backlog GOAL. Sengaja bukan cabang di dalam startPrompt: yang
// berbeda bukan satu-dua kalimat melainkan KERANGKA-nya — tak ada fase perencanaan, tak ada
// keputusan pasca-Audit, tak ada skill Brainstorm/Plan, tak ada blok Detail berisi JSON payload
// (isi payload sudah dieja sebagai Goal/Selesai bila/Batasan). Mode goal (Stop hook ADR-0073)
// dipasang di sisi server saat sesi lahir, bukan lewat prompt ini.
export function startGoalPrompt(
  spec: SpecBrief, branchTo: string,
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx } = {},
): string {
  const g = readGoalPayload(spec.payload);
  const detail = [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
  return [
    "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.",
    opts.resume ? resumeClause(opts.resume, branchTo, false) : "",
    detail,
    phaseInstruction(PIPELINES.goal),
    "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
      + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
      + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause("goal", opts.verifyScope),
    codeStyleClause("goal"),
    skillInstruction(PIPELINES.goal),
    `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
      + `Worktree ini detached HEAD — itu memang disengaja.`,
    `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
      + `Judul: ${spec.title}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-394 · ADR-0084 · sesi project-level (reverse/scaffold/prd/breakdown) yang
// dilahirkan ulang di atas worktree sesi sebelumnya. Flow dokumen sengaja TIDAK memakai
// `resumePrompt` — deliverable-nya dokumen, bukan plan berkotak, jadi tak ada fase yang bisa
// "dilanjutkan" secara bermakna — tapi agen tetap harus tahu worktree-nya tak kosong. Tanpa ini
// ia menulis ulang dari nol di atas pekerjaan yang masih ada, dan itu tak terlihat olehnya.
export const RESUMED_WORKTREE_NOTE =
  "Catatan: worktree ini BUKAN kosong — ia berisi pekerjaan sesi sebelumnya untuk tugas yang "
  + "sama (sesi itu berhenti sebelum selesai). Baca `git log --oneline` dan `git status` lebih "
  + "dulu, lalu lanjutkan dari sana alih-alih menulis ulang semuanya dari awal.";

// Panduan per fase reverse (SPEC-166). Wawancara adalah fase interaktif: manusia menonton
// sesi ini lewat terminal dashboard dan menjawab di sana — karena itu SATU pertanyaan per
// giliran, bukan borongan.
const REVERSE_PHASE_GUIDE = [
  "- Scan: baca source code — stack, arsitektur, data model, API surface, perilaku domain. Belum menulis docs.",
  "- Docs teknis: tulis kategori yang bisa diturunkan dari kode (architecture, requirements + "
    + "EARS dari perilaku nyata, adr ber-Status accepted (reverse-engineered), operations, "
    + "security, design-system/frontend bila relevan). Isi lengkap dan spesifik, bukan kerangka.",
  "- Wawancara: untuk product, business, brand, research, entrypoints — ajukan SATU pertanyaan "
    + "per giliran ke manusia di terminal ini, tunggu jawabannya, isi docs dari jawaban. "
    + "Jangan mengarang. Topik tanpa jawaban tandai: Status: draft — menunggu input.",
  "- Konvensi & index: tulis internal/docs/README.md (index bernomor lengkap), CLAUDE.md, "
    + "AGENTS.md, .claude/settings.json + .claude/hooks/ensure-docs-updated.py persis seperti STANDAR DOCS.",
  "- Serah terima: pastikan setiap berkas docs terdaftar di index, lalu tulis ringkasan hasil "
    + "+ daftar pertanyaan yang belum terjawab ke terminal.",
].join("\n");

export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string): string {
  return [
    `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/**, `
      + `mengikuti STANDAR DOCS di bagian bawah prompt ini.`,
    phaseInstruction(PIPELINES[flow]),
    REVERSE_PHASE_GUIDE,
    `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
      + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
      + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].join("\n\n");
}

// SPEC-210 · sesi prd: PM/PO menyusun SATU dokumen PRD dari brief + brainstorm interaktif.
// Project-level (tanpa Spec), meniru startProjectPrompt. Keluaran HANYA dokumen — tak menulis
// kode fitur. Brainstorm interaktif (satu pertanyaan per giliran; PM menonton terminal), lalu
// tulis PRD terstruktur, commit, push ke branch prd/<slug>; manusia yang merge. Tak membawa
// AUTONOMY_CLAUSE: seperti Wawancara reverse, brainstorm PRD memang berjalan bergiliran dgn PM.
export function startPrdPrompt(project: ProjectBrief, brief: PrdBrief, branchTo: string, audit?: AuditDoc): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  // SPEC-340 · ADR-0076 · PRD hasil eskalasi audit: temuan audit adalah BAHAN brainstorm yang sudah
  // terbukti. Disematkan utuh (bukan path) agar prompt lepas dari status merge branch audit —
  // pola startBreakdownPrompt yang menyematkan isi PRD.
  const auditBlock = audit
    ? `=== DOKUMEN AUDIT ${audit.id} (${audit.path}) ===\nPRD ini adalah TINDAK LANJUT audit di bawah. `
      + "Pakai temuannya sebagai bahan brainstorm — jangan menginvestigasi ulang, dan jangan pula "
      + `menyalinnya mentah-mentah ke PRD.\n\n${audit.content}`
    : "";
  return [
    `hanoman prd. Kamu memandu PM/PO menyusun SATU dokumen PRD untuk project ini dari brief + `
      + `brainstorm. Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.prd),
    `- Brainstorm: pandu PM secara interaktif. Ajukan SATU pertanyaan per giliran ke manusia di `
      + `terminal ini, tunggu jawabannya, perdalam brief sampai jelas (masalah, pengguna, scope, `
      + `metrik sukses). Jangan mengarang; topik yang PM belum jawab tandai sebagai open question.`,
    `- PRD: tulis dokumen ke \`docs/prd/${slug}.md\`. Awali dengan heading \`# <judul PRD>\`, lalu `
      + `bagian: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope `
      + `(in/out) · User stories · Acceptance criteria (gaya EARS) · Metrik sukses · Open questions. `
      + `Isi lengkap dan spesifik dari hasil brainstorm, bukan kerangka kosong.`,
    skillInstruction(PIPELINES.prd),
    `Setelah PRD ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
      + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
      + `ini detached HEAD — memang disengaja. Manusia yang me-review lalu merge branch ${branchTo}.`,
    `Project ${project.id} · ${project.name}\nBrief — Judul: ${brief.title}\nKonteks: ${brief.context}\n`
      + `Outcome: ${brief.outcome}${brief.constraints ? `\nBatasan: ${brief.constraints}` : ""}`,
    auditBlock,
  ].filter(Boolean).join("\n\n");
}

// SPEC-273 · sesi breakdown: pecah SATU PRD kompleks → BEBERAPA backlog kecil yang PARALEL-aman
// (tanpa saling bergantung). Project-level (tanpa Spec), meniru startPrdPrompt. Isi PRD disematkan
// (lepas dari status merge). Keluaran HANYA manifest doc — tak menulis kode fitur. Autonomous
// (analisis, bukan brainstorm bergiliran) → memakai AUTONOMY_CLAUSE.
export function startBreakdownPrompt(project: ProjectBrief, prd: BreakdownPrd, branchTo: string): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  return [
    `hanoman breakdown. Kamu memecah SATU PRD kompleks menjadi BEBERAPA backlog kecil yang bisa `
      + `dikerjakan PARALEL tanpa saling bergantung. Keluaranmu HANYA dokumen manifest — `
      + `JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.breakdown),
    `- Analisis: baca PRD (di bawah) sampai paham SELURUH scope in-PRD. Petakan pekerjaan menjadi `
      + `unit-unit yang: (a) kecil & terukur — tiap unit tuntas dalam satu sesi; (b) non-overlapping `
      + `— cakupan tak tumpang tindih; (c) TANPA cross-dependency — urutan bebas, bisa jalan bersamaan; `
      + `(d) gabungannya MENUTUP seluruh scope PRD. Bila dua unit terpaksa berurutan, gabung jadi satu.`,
    `- Breakdown: tulis manifest ke \`docs/prd/${slug}.breakdown.md\`. Awali heading `
      + `\`# Breakdown: ${prd.title}\`, lalu prosa: ringkasan + untuk TIAP backlog satu paragraf `
      + `(judul, cakupan, dan SATU kalimat kenapa aman-paralel / tak bergantung yang lain). `
      + `Di AKHIR dokumen sertakan TEPAT SATU blok kode berpagar json berisi kontrak mesin PERSIS `
      + `bentuk ini (tanpa komentar, priority ∈ tinggi|sedang|rendah):\n`
      + "```json\n"
      + `{ "items": [ { "title": "…", "context": "…", "outcome": "…", "priority": "sedang" } ] }\n`
      + "```\n"
      + `\`context\` = bagian PRD yang dicakup; \`outcome\` = kondisi selesai terukur; \`title\` ringkas. `
      + `Minimal 2 item bila PRD memang kompleks; bila PRD ternyata sekecil 1 unit, katakan itu di `
      + `prosa dan tetap tulis 1 item.`,
    AUTONOMY_CLAUSE,
    `Setelah manifest ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
      + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
      + `ini detached HEAD — memang disengaja. Manusia me-review manifest lalu materialize backlog darinya.`,
    `Project ${project.id} · ${project.name}\n=== PRD: ${prd.title} (${prd.path}) ===\n${prd.content}`,
  ].filter(Boolean).join("\n\n");
}

// SPEC-222 · panduan per fase scaffold (project-level, from-scratch). Reverse tanpa Scan:
// tak ada kode untuk dipindai, jadi Brainstorm interaktif menggali ide jadi objective, lalu
// Doc index menulis seluruh internal/docs/** dari ide+objective+jawaban. Brainstorm memang
// bergiliran dengan manusia — karena itu SATU pertanyaan per giliran, tanpa AUTONOMY_CLAUSE.
const SCAFFOLD_PHASE_GUIDE = [
  "- Brainstorm: perdalam IDE project (di bawah) jadi masalah, pengguna, scope, dan metrik sukses. "
    + "Ajukan SATU pertanyaan per giliran ke manusia di terminal ini, tunggu jawabannya. Jangan "
    + "mengarang; topik yang belum dijawab tandai sebagai open question.",
  "- Objective: kunci SATU MVP objective yang terukur dari hasil brainstorm, tulis ringkas di docs.",
  "- Doc index: tulis SELURUH internal/docs/** dari ide+objective+jawaban, mengikuti STANDAR DOCS "
    + "di bawah — entrypoints, product, business, requirements (+EARS dari perilaku yang diinginkan), "
    + "research, architecture (stack/data-model/api-contract/nfr), adr awal (Status accepted), "
    + "design-system/frontend bila ada UI, operations, security, plus README index bernomor + "
    + "CLAUDE.md + AGENTS.md + Stop hook. Lengkap dan spesifik terhadap ide ini, BUKAN kerangka.",
].join("\n");

// SPEC-222 · sesi scaffold: dari ide → Source of Truth penuh untuk project from-scratch. Meniru
// startProjectPrompt (reverse) tetapi diseed oleh ide (project.desc), tanpa fase Scan. Tanpa
// AUTONOMY_CLAUSE: Brainstorm interaktif, manusia menjawab di terminal (seperti Wawancara reverse).
export function startScaffoldPrompt(project: ProjectBrief, branchTo: string): string {
  return [
    `hanoman scaffold. Susun Source of Truth LENGKAP untuk project from-scratch ini di internal/docs/** `
      + `DARI IDE-nya, mengikuti STANDAR DOCS di bagian bawah prompt ini. Belum ada kode — docs dulu.`,
    phaseInstruction(PIPELINES.scaffold),
    SCAFFOLD_PHASE_GUIDE,
    `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
      + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
      + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
      + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`,
    skillInstruction(PIPELINES.scaffold),
    `Project ${project.id} · ${project.name}\nIde awal: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].filter(Boolean).join("\n\n");
}


// SPEC-646 · ADR-0112 · sesi cron. TANPA `flow`: ia tak punya fase, tak punya plan berkotak, dan
// tak menggerakkan stage backlog mana pun — yang dikerjakannya pemeriksaan rutin, dan temuannya
// masuk antrean kerja sebagai backlog BARU, bukan sebagai commit di sesi ini.
//
// Instruksi operator disisipkan APA ADANYA. Memparafrasekannya berarti hanoman ikut menentukan apa
// yang diperiksa, dan itu persis yang tak boleh: kolom prompt adalah kontraknya dengan operator.
//
// CODE_STYLE_CLAUSE dipasang tanpa gerbang `writesCode` — sesi cron tak punya `Flow` untuk
// digerbangi, dan klausanya menggerbangi dirinya sendiri di baris pertama ("berlaku setiap kali
// kamu menulis atau mengubah kode", ADR-0108).
export function cronPrompt(project: ProjectBrief, cron: { name: string; prompt: string }): string {
  return [
    `hanoman cron "${cron.name}". Pemeriksaan rutin terjadwal di project ini — bukan sesi backlog: `
      + `tak ada fase, tak ada plan, tak ada stage yang harus digerakkan.`,
    `Bila kamu menemukan masalah yang layak dikerjakan, FILEKAN sebagai backlog item lewat `
      + `\`POST /api/specs\` (lihat docs/agent-integration.md untuk bentuk payload & auth), jangan `
      + `hanya melaporkannya ke terminal — temuan yang cuma tertulis di log sesi akan hilang. `
      + `Satu masalah = satu backlog item, judul spesifik.`,
    `Jangan mengerjakan sendiri perbaikan besar dalam sesi ini kecuali instruksi di bawah memintanya.`,
    CODE_STYLE_CLAUSE,
    `Worktree ini detached HEAD — memang disengaja. Bila kamu memang perlu meninggalkan perubahan `
      + `berkas, commit dan katakan itu di ringkasan akhir; jangan gagal diam-diam.`,
    `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`,
    `=== INSTRUKSI OPERATOR ===\n${cron.prompt}`,
  ].join("\n\n");
}
