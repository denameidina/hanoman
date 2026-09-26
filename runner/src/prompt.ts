import type { Flow, SpecBrief, ProjectBrief, PrdBrief, AuditDoc, BreakdownPrd, Autonomy, VerifyScope, ResumeCtx, AttachmentCtx } from "./types";
import { resolveMethod, FLOW_PHASES, type ExecuteMode, type MethodDef, type PhasePlan } from "@hanoman/shared";
import { REVERSE_STANDARD } from "./reverse-standard";
import { verifyScopeClause } from "./verify-scope";
import { CODE_STYLE_CLAUSE } from "./code-style";
import { readGoalPayload } from "./goal-spec";

// ADR-0164 · daftar fase pindah ke @hanoman/shared (`FLOW_PHASES`) supaya Settings & modal Start
// membaca sumber yang sama; nama lama tetap diekspor untuk semua pemakai runner/server.
export const PIPELINES: Record<Flow, readonly string[]> = FLOW_PHASES;

// SPEC-825 · daftar fase KERJA — "sesi ini menulis kode". Dipakai DUA gerbang di DUA paket:
// `writesCode` di bawah (verifyScope + klausa gaya kode + exitSkills) dan aturan "fase kerja yang
// sedang aktif sudah berarti stage `executing`" di `stageFor` (server/services/session-phases.ts).
// Sebelumnya keduanya rantai `||` berisi nama yang sama, dan suku yang lupa ditambah saat flow
// baru lahir tak menghasilkan error apa pun — cuma klausa yang diam-diam hilang.
export const WORK_PHASES = ["Execute", "Goal", "Kerjakan"] as const;

// SPEC-252 · ADR-0061 — model & effort kini PER SESI (dipilih saat Start, argv saat lahir), bukan per
// fase. Matrix per-fase + injeksi `/model`+`/effort` oleh agen (resolvePhaseModels/phaseModelInstruction,
// ADR-0058) dicabut: tak andal karena bergantung agen menembus batas fase. Prompt tak lagi memuat blok itu.

// SPEC-187 · ADR-0035 — sesi spec-flow menggerakkan dirinya sendiri melewati seluruh fase
// (ADR-0024): tak ada runner yang menyuntik giliran berikutnya. Skill superpowers punya
// checkpoint "review/approval"; di sesi tak-berpenunggu itu BUKAN titik berhenti, dan agen
// yang mematuhinya akan mandek diam menunggu review yang tak akan datang. Berhenti hanya untuk
// keputusan manusia sejati, yang agen surface sebagai pertanyaan di terminalnya (ADR-0024).
// Sengaja tak dipakai startProjectPrompt: fase Wawancara reverse memang interaktif.
// ADR-0167 · siapa yang memutuskan TIDAK ditulis ke prompt sebagai keadaan: status lead bisa berubah
// di tengah sesi, sedangkan prompt terkunci saat lahir. Agen selalu bertanya; `admitAsk` (ADR-0146)
// memilih lead bila `leadActive`, selain itu pertanyaannya menunggu manusia.
export const DECIDER = "hanoman-lead bila aktif untuk project ini, selain itu manusia";

// ADR-0167 · netral-agen tanpa cabang runtime (pola ADR-0074). Claude WAJIB lewat AskUserQuestion:
// pertanyaan teks biasa dari claude tak terbaca lead sejak ADR-0146 (pemicunya PreToolUse). Codex tak
// punya tool itu; lead membacanya dari hook `Stop` lewat ASK_SIGNALS (baris diakhiri `?`, bernomor).
const ASK_ROUTE =
  "ajukan lewat AskUserQuestion bila agenmu punya tool itu (paling banyak 4 pertanyaan per panggilan — "
  + "pecah sisanya ke panggilan berikutnya); bila tidak, tanyakan di terminal ini sekaligus, tiap "
  + "pertanyaan bernomor dan diakhiri `?` beserta opsinya, lalu tunggu jawabannya. Tak ada batas jumlah "
  + "pertanyaan: selama masih ambigu dan akan mempengaruhi hasil, tanyakan. Yang menjawab ditentukan "
  + `hanoman — ${DECIDER}; jangan menjawabnya sendiri.`;

const AMBIGUOUS =
  "hal yang masih ambigu dan akan mempengaruhi hasil (data model, kontrak API, scope, perilaku yang "
  + "terlihat pengguna, atau asumsi yang terpaksa kamu ambil agar bisa lanjut)";

export const AUTONOMY_CLAUSE =
  "Jalankan seluruh pipeline sampai tuntas tanpa berhenti di batas antar-fase. Checkpoint "
  + "\"review\"/\"approval\"/\"need review\" milik skill superpowers BUKAN titik berhenti di sini — "
  + `lanjut saja ke fase berikutnya. Berhenti HANYA untuk ${AMBIGUOUS}: JANGAN memutuskannya sendiri, `
  + `${ASK_ROUTE} Selain itu, terus lanjut.`;

// SPEC-298 · varian sesi scheduler. ADR-0167 mengamandemennya: full-control dulu menyuruh agen
// memutuskan SETIAP percabangan sendiri; kini ia hanya mencabut checkpoint & menunggu persetujuan —
// keputusan ambigu tetap ditanyakan, dan sesi boleh tertahan bila lead mati (pilihan operator).
// Merge tetap manual (ADR-0031).
const AUTONOMY_CLAUSE_FULL =
  "Kamu diluncurkan scheduler — mungkin tak ada manusia yang sedang menonton terminal ini. Tembus "
  + "seluruh pipeline sampai stage `done`, lalu commit & push: checkpoint \"review\"/\"approval\" milik "
  + "skill BUKAN titik berhenti dan jangan menunggu persetujuan siapa pun. Tetapi JANGAN memutuskan "
  + `sendiri ${AMBIGUOUS}: ${ASK_ROUTE} Catat keputusan penting di pesan commit. Merge ke branch `
  + "utama tetap dilakukan manusia, bukan kamu.";

// SPEC-298 · pilih klausa per mode. undefined (peluncuran manual) → klausa tanya (lama): sesi
// manual berpengawas, manusia menonton & boleh menjawab.
export const autonomyClause = (mode?: Autonomy): string =>
  mode === "full-control" ? AUTONOMY_CLAUSE_FULL : AUTONOMY_CLAUSE;

// Agen yang melapor, server yang menonton: di PTY tak ada batas giliran yang terbaca mesin.
// Append, bukan tulis-timpa — keadaan penuh selalu ada di berkasnya, jadi tak ada transisi
// yang bisa terlewat kalau server sedang tidak menonton. Berkasnya di luar worktree, jadi
// `git add -A` milik agen tak mungkin men-stage-nya.
const phaseInstruction = (phases: readonly string[], method: MethodDef) => {
  const base =
    `Kerjakan fase berurutan: ${phases.join(" → ")}.\n`
    + `Setiap kali sebuah fase selesai (atau kamu putuskan dilewati), append satu baris ke berkas `
    + `di $HANOMAN_PHASE_FILE — persis: \`echo "<Nama Fase> done" >> "$HANOMAN_PHASE_FILE"\`, `
    + `atau \`skipped\` sebagai ganti \`done\`. Nama fase ditulis apa adanya seperti di atas.`;
  // Flow ber-fase Plan+Execute saja (feature, qa): Execute belum selesai selama plan masih
  // punya kotak `- [ ]`. Cermin server-side gate (SPEC-173, ADR-0029) di prompt-nya.
  if (!phases.includes("Plan") || !phases.includes("Execute")) return base;
  return base
    + `\nExecute BELUM selesai selama plan (\`${method.planDir}/**\`) masih punya task `
    + `\`- [ ]\`: kerjakan SEMUA PR/task sampai tiap kotak jadi \`- [x]\` sebelum menulis `
    + `\`Execute done\`. hanoman menahan backlog di \`executing\`, bukan \`done\`, selama masih ada \`- [ ]\`.`;
};

// SPEC-734 · ADR-0113 · peta fase → skill datang dari registry metode (`METHODS` di
// @hanoman/shared), bukan konstanta di sini. Objective dan Spec adalah keluaran skill brainstorming
// yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri. Fase reverse dipandu standar
// docs di prompt-nya, bukan skill. Aturan `exitSkills` huni di `phaseSkillsFor` (ADR-0164):
// digabung ke fase TERAKHIR hanya untuk flow penulis-kode (INVARIAN 2 ADR-0113).
const skillInstruction = (
  flow: Flow, phases: readonly string[], method: MethodDef,
) => {
  const lines = phases
    .map((p) => {
      const skills = phaseSkillsFor(flow, p, method);
      return skills.length ? `- ${p}: ${skills.join(", ")}` : "";
    })
    .filter(Boolean);
  // SPEC-338 · ADR-0074 · netral-agen: Claude Code meng-invoke skill lewat Skill tool, Codex CLI
  // memuatnya secara native. Prompt menyebut HASIL yang diminta, bukan mekanismenya — satu prompt
  // melayani kedua agen tanpa percabangan.
  return lines.length
    ? `Skills ${method.label} WAJIB: sebelum mengerjakan fase di bawah, muat & ikuti skill-nya dengan `
      + `mekanisme yang tersedia di agenmu — bila skill relevan tersedia, pakai.\n${lines.join("\n")}`
    : "";
};

// ADR-0164 · satu baris panduan fase dari guide bergaris `- <Fase>: …` (REVERSE/SCAFFOLD). Agen
// fase memakai baris yang SAMA dengan prompt sesi tunggal, bukan salinan yang bisa berselisih.
export function guideLine(guide: string, phase: string): string {
  return guide.split("\n").find((line) => line.startsWith(`- ${phase}:`)) ?? "";
}

// ADR-0164 · skill satu fase — aturan `skillInstruction` untuk satu baris: `exitSkills` digabung ke
// fase TERAKHIR hanya untuk flow penulis-kode (INVARIAN 2 ADR-0113).
// ADR-0170 P2 · `agentRuntime` = fase dikerjakan agen fase runtime itu. Hanya claude yang memakai
// `orchestratedPhaseSkills` (subagent foreground bersarang terukur di claude 2.1.282); codex & mode
// tunggal tetap `phaseSkills`.
// Amandemen ADR-0170 P2 · dan hanya bila operator memilih `executeMode: "subagent"` untuk flow itu —
// default `inline` (subagent per task terukur terlalu lambat untuk dipakai tanpa diminta).
export function phaseSkillsFor(
  flow: Flow, phase: string, method: MethodDef, agentRuntime?: "claude" | "codex",
  executeMode: ExecuteMode = "inline",
): string[] {
  const orchestrated = agentRuntime === "claude" && executeMode === "subagent";
  const own = (orchestrated ? method.orchestratedPhaseSkills?.[phase] : undefined)
    ?? method.phaseSkills[phase] ?? [];
  const phases = PIPELINES[flow];
  return writesCode(flow) && phase === phases[phases.length - 1]
    ? [...new Set([...own, ...method.exitSkills])]
    : [...own];
}

// ADR-0164 · kontrak orchestrator. Yang mengikat model/effort tiap fase adalah DEFINISI subagent
// (argv saat lahir); klausa ini hanya menyuruh mendelegasikan — dan setiap delegasi meninggalkan
// bukti SubagentStart/Stop, jadi pelanggarannya terlihat, tidak diam seperti ADR-0058.
// Deskripsi pemanggilan `Fase <Nama Fase>` wajib: stdin `subagentStatusLine` claude hanya membawa
// deskripsi itu sebagai label, tanpa nama agen (terukur 2026-09-14).
//
// Live smoke 2026-09-14 (claude 2.1.270, orchestrator Haiku 4.5/low, dibandingkan Opus 5/medium yang
// benar) menemukan DUA cacat di versi klausa ini — lihat progress.md T14 Step 3:
// (A) Langkah 2 bukan gerbang wajib: orchestrator lemah menyimpulkan fase selesai dari laporan lalu
//     langsung commit/push TANPA pernah menulis $HANOMAN_PHASE_FILE — backlog tak pernah maju
//     (sessionComplete/reconcile/session-close semua membaca berkas itu). Sekarang menulis+`tail -1`
//     verifikasi jadi tindakan PERTAMA, wajib sebelum fase berikutnya/commit/push.
// (B) Baris pertama blok serah-terima dulu `Fase <n>/<total>: <Nama Fase>` — persis bersebelahan
//     dengan instruksi "isi deskripsi pemanggilan persis `Fase <Nama Fase>`" — sehingga model
//     menyalin header blok sebagai deskripsi (`Fase 1/1: Kerjakan`, bukan `Fase Kerjakan`). Header
//     diganti `Urutan: <n>/<total> · <Nama Fase>`; aturan deskripsi kini kalimat sendiri yang
//     eksplisit menyebut BUKAN baris pertama blok.
export function orchestratorClause(plan: PhasePlan, o: { fastPath?: boolean } = {}): string {
  const codex = plan.runtime === "codex";
  const call = codex
    ? "spawn_agent"
    : "tool Agent dengan parameter `subagent_type` berisi persis nama agen fase di daftar (mis. "
      + `\`${plan.phases[0]?.agentName ?? "hanoman-fase-<fase>"}\`)`;
  const resume = codex ? "send_input ke agent id yang sama" : "SendMessage ke agent ID yang kamu catat";
  // Audit R5 · transkrip nyata: spec-1218 memanggil Agent TANPA `subagent_type` (lima fase jatuh ke
  // general-purpose dengan model orchestrator); spec-1299 memakai `Agent(to=…)` untuk melanjutkan agen
  // yang sama sehingga lahir agen duplikat. Codex (spawn_agent/send_input) tak punya kedua jebakan itu.
  const describeRule = codex
    ? "Deskripsi/label pemanggilan diisi persis `Fase <Nama Fase>` — tanpa nomor urut, dan BUKAN baris "
      + "pertama blok serah-terima di atas."
    : "Deskripsi pemanggilan (parameter `description`) diisi persis `Fase <Nama Fase>` — tanpa nomor "
      + "urut, dan BUKAN baris pertama blok serah-terima di atas.\n"
      + "JANGAN pernah memanggil tool Agent tanpa `subagent_type` atau dengan `general-purpose`: fase itu "
      + "jatuh ke agen umum ber-model orchestrator dan model/effort fasenya hilang. Sebelum memanggil, periksa "
      + "ulang bahwa `subagent_type` = nama agen fase itu; bila tool menolaknya, itu galat langkah 3 — bukan "
      + "alasan beralih ke agen umum. Catat agent ID yang dikembalikan hasil pemanggilan: itulah satu-satunya "
      + "pegangan untuk melanjutkan agen yang SAMA. Melanjutkan agen itu (relay jawaban langkah 4) HANYA "
      + "lewat SendMessage — tool Agent tak punya parameter `to`, dan memanggilnya lagi melahirkan agen BARU "
      + "tanpa konteks (duplikat).";
  const retry = codex ? "" : " (pemanggilan tool Agent BARU dengan `subagent_type` yang sama)";
  // M-6 · codex tak punya tool AskUserQuestion — pemanggilan tool yang tak ada bukan instruksi yang
  // bisa dipatuhi. Orchestrator codex bertanya di terminal sesi ini sendiri (sama seperti klausa
  // otonomi menyuruh manusia dijawab di terminal); orchestrator claude tetap AskUserQuestion.
  const askEscalation = codex
    ? "tanyakan di terminal ini lalu tunggu jawaban"
    : "tanyakan lewat AskUserQuestion";
  // ADR-0167 · tanpa batas jumlah: batas 4 milik tool AskUserQuestion, bukan kebijakan — dipecah.
  const askDecisions = codex
    ? "di terminal ini sekaligus dalam satu pesan, tiap pertanyaan bernomor dan diakhiri `?` beserta "
      + "opsinya, lalu tunggu jawaban"
    : "lewat AskUserQuestion — tool itu memuat paling banyak 4 pertanyaan per panggilan, jadi pecah "
      + "sisanya ke panggilan berikutnya sampai semuanya terjawab";
  // Audit R4 · fase bergiliran dengan manusia (Wawancara reverse, Brainstorm prd/scaffold) kini melapor
  // satu topik per putaran lewat `Keputusan terbuka:` — relaynya langkah 4 yang SAMA. Dulu claude
  // disuruh bertanya "di terminal ini" untuk fase itu; teks biasa claude tak terbaca lead (ADR-0167 #6).
  const turnTaking = plan.flow === "reverse" || plan.flow === "scaffold" || plan.flow === "prd"
    ? " Fase yang bergiliran dengan manusia (Wawancara, Brainstorm prd/scaffold) melapor satu topik per "
      + "putaran — relay tiap putaran dengan cara yang sama, bawa konteks & opsi dari laporannya, dan "
      + "biarkan jawaban bebas."
    : "";
  const handoff = plan.phases.some((p) => p.phase === "Serah terima")
    ? "Sesudah fase Serah terima tercatat, tampilkan bagian `Ringkasan serah terima:` dari laporannya APA "
      + "ADANYA ke manusia di terminal ini (teks biasa — informasi, bukan pertanyaan) sebelum menutup "
      + "pekerjaan."
    : "";
  const phaseList = plan.phases
    .map((p, i) => `${i + 1}. ${p.phase} → \`${p.agentName}\` · ${p.model} · ${p.effort}`)
    .join("\n");
  // ADR-0170 P2 · reviewer independen Execute (feature/qa). Bukan fase: tak punya baris marker, dan
  // invocation-nya tercatat di bawah Execute (roster `phase`).
  const reviewer = plan.reviewer && plan.phases.some((p) => p.phase === plan.reviewer!.phase)
    ? plan.reviewer : undefined;
  const list = reviewer
    ? `${phaseList}\nReviewer Execute → \`${reviewer.agentName}\` · ${reviewer.model} · ${reviewer.effort} `
      + "(bukan fase — hanya dipanggil di langkah R)"
    : phaseList;
  const hasExecute = plan.phases.some((p) => p.phase === "Execute");
  // ADR-0170 P2 · path plan PERSIS (Plan melapor `<YYYY-MM-DD>-<spec-id>-<slug>.md`), bukan glob.
  const artefactRule = "Baris `Artefak fase sebelumnya:` diisi path PERSIS yang dilaporkan fase sebelumnya di "
    + "`Artefak:` laporannya"
    + (hasExecute ? " — untuk Execute: dokumen spec DAN berkas plan yang dilaporkan fase Plan" : "")
    + ", bukan pola glob.";
  const reviewStep = reviewer
    ? "R. Review Execute: sesudah agen Execute melapor `Status: selesai` dengan bukti dan tanpa keputusan "
      + "terbuka, SEBELUM menulis `Execute done`, panggil "
      + (codex ? `\`${reviewer.agentName}\` lewat spawn_agent`
        : `tool Agent dengan \`subagent_type\` \`${reviewer.agentName}\``)
      + " (deskripsi `Review Execute`) dengan blok serah-terima:\n"
      + "Tujuan: <objective backlog>\nBase SHA: $HANOMAN_BASE_SHA\n"
      + "Artefak: <path PERSIS dokumen spec & berkas plan> (qa yang melewati Spec & Plan: dokumen audit)\n"
      + "Laporan Execute: <tabel AC → bukti dari laporannya>\nPutaran rework: <r>/2\n\n"
      + "`Verdict: lulus` → langkah 2 (tulis `Execute done`). `Verdict: rework` → lanjutkan agen Execute yang "
      + `SAMA lewat ${resume} dengan \`Temuan wajib diperbaiki:\` reviewer apa adanya; sesudah ia melapor `
      + `\`selesai\` lagi, lanjutkan reviewer yang SAMA lewat ${resume} dengan laporan barunya. Batasnya `
      + "maks 2 putaran rework: masih `rework` sesudah putaran ke-2 → perlakukan temuan tersisa sebagai "
      + "`Keputusan terbuka` langkah 4 (tanyakan, teruskan jawabannya ke agen Execute, lalu review lagi). "
      + "Putaran rework bukan percobaan ulang langkah 3; reviewer galat atau tanpa baris `Verdict:` → "
      + "langkah 3 berlaku padanya, `menunggu-keputusan` → langkah 4. JANGAN memperbaiki temuan sendiri dan "
      + "JANGAN menulis `Execute done` tanpa `Verdict: lulus`."
    : "";
  return [
    "Sesi ini ORCHESTRATOR. Setiap fase dikerjakan subagent fase miliknya dengan model & effort yang "
      + "sudah terkunci di definisinya — kamu TIDAK mengerjakan isi fase sendiri.",
    `Fase berurutan:\n${list}`,
    "Untuk SETIAP fase, berurutan:",
    `1. Panggil subagent fasenya lewat ${call}, tugasnya berupa blok serah-terima berbentuk tetap:\n`
      + "Urutan: <n>/<total> · <Nama Fase>\nTujuan: <objective backlog/project>\n"
      + "Base SHA: $HANOMAN_BASE_SHA (atau -)\nArtefak fase sebelumnya: <path yang dilaporkan, atau ->\n"
      + "Keputusan manusia sejauh ini: <ringkas, atau ->\nLampiran: <path INDEX.md lampiran, atau ->\n"
      + `Percobaan: <k>/2\n\n${artefactRule} ${describeRule}`,
    "2. Baca laporannya. `Status: selesai` DENGAN bukti → SEBELUM hal lain (memanggil fase berikutnya, "
      + "commit, atau push): jalankan persis `echo \"<Nama Fase> done\" >> \"$HANOMAN_PHASE_FILE\"`, lalu "
      + "verifikasi dengan `tail -1 \"$HANOMAN_PHASE_FILE\"` bahwa barisnya benar tertulis. Kamu "
      + "satu-satunya penulis berkas itu."
      + (reviewer ? " Khusus Execute: langkah R dulu; marker ditulis sesudah `Verdict: lulus`." : ""),
    "3. `Status: sebagian`/`terhalang`, galat, atau laporan tanpa bukti → delegasikan ULANG SEKALI ke "
      + `subagent fase yang sama${retry} dengan laporan gagalnya disertakan (\`Percobaan: 2/2\`). Gagal lagi → `
      + `BERHENTI dan ${askEscalation} apa yang harus dilakukan. Aturan ini berlaku walau `
      + "klausa otonomi di prompt ini menyuruhmu tak bertanya.",
    "4. `Status: menunggu-keputusan` atau `Keputusan terbuka:` yang bukan `-` → SEBELUM menulis marker fase "
      + `atau memanggil fase berikutnya, ajukan SEMUA pertanyaannya ${askDecisions}, lalu LANJUTKAN subagent `
      + `yang SAMA lewat ${resume} dengan seluruh jawabannya. Ulangi selama subagent masih melaporkan `
      + "keputusan terbuka — tak ada batas jumlah pertanyaan maupun putaran, dan giliran relay ini bukan "
      + `percobaan ulang. JANGAN pernah menjawab sendiri, termasuk di sesi scheduler: yang menjawab ${DECIDER} `
      + `— hanoman yang merutekannya, kamu cukup bertanya.${turnTaking}`,
    o.fastPath
      ? "5. `Rekomendasi fase: jalur-cepat` sesudah Audit → SEBELUM lanjut ke Execute: jalankan `echo "
        + "\"Spec skipped\" >> \"$HANOMAN_PHASE_FILE\"` lalu `echo \"Plan skipped\" >> \"$HANOMAN_PHASE_FILE\"` "
        + "(gerbang yang sama seperti langkah 2), lalu lanjut ke Execute. `penuh` → Spec → Plan → Execute."
      : "",
    reviewStep,
    handoff,
    "DILARANG mengerjakan isi fase sendiri — termasuk saat subagent gagal. Menulis `skipped` untuk fase "
      + "yang dilewati bukan mengerjakannya.",
    "Pekerjaan ini BELUM selesai sampai SEMUA fase di daftar di atas punya baris `done` atau `skipped` di "
      + "$HANOMAN_PHASE_FILE — JANGAN commit/push final atau menyatakan tuntas sebelum itu. Periksa dengan "
      + "`cat \"$HANOMAN_PHASE_FILE\"` sebelum commit terakhir.",
  ].filter(Boolean).join("\n\n");
}

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

// I-2 · ADR-0164 · varian ORCHESTRATOR dari auditContinuationInstruction. Teks sesi tunggal di atas
// bicara ke agen yang MENGERJAKAN fasenya sendiri ("BACA dokumen itu ... pakai sebagai bahan",
// "ambil keputusan pasca-Audit"); dipakai apa adanya di mode orchestrator, itu berarti menyuruh
// ORCHESTRATOR mengerjakan isi fase sendiri — persis larangan `orchestratorClause`. Feature: dokumen
// audit jadi bahan AGEN FASE Brainstorm lewat handoff (`Artefak fase sebelumnya:`), bukan dibaca
// orchestrator untuk merancang. qa: orchestrator sendiri yang menandai Audit `skipped` (agen fase
// Audit tak pernah dipanggil pada kontinuitas ini), lalu meneruskan dokumennya ke agen fase Spec;
// satu-satunya keputusan yang boleh diambil orchestrator dari isi dokumen itu adalah ROUTING
// (jalur-cepat atau penuh) — bukan investigasi ulang maupun rancangan perbaikan.
export const auditContinuationForOrchestrator = (flow: Flow, spec: SpecBrief): string => {
  if (flow !== "qa" && flow !== "feature") return "";
  const fromAudit = spec.payload && typeof spec.payload === "object"
    ? (spec.payload as { fromAudit?: unknown }).fromAudit : undefined;
  if (typeof fromAudit !== "string" || !fromAudit) return "";
  const doc = `internal/docs/research/audit-${fromAudit.toLowerCase()}-*.md`;
  if (flow === "feature")
    return `Backlog brief ini LANJUTAN dari audit ${fromAudit}. Worktree ini lahir dari branch audit `
      + `itu, jadi dokumen audit sudah ada di ${doc}. Saat memanggil agen fase Brainstorm, cantumkan `
      + "path itu di baris `Artefak fase sebelumnya:` blok serah-terima — JANGAN membacanya sendiri "
      + "untuk merancang fitur ini. Saat memanggil agen fase Objective, baris itu biasanya sudah "
      + "membawa path artefak Brainstorm (dokumen spec yang ditulis fase itu); tambahkan path dokumen "
      + "audit di samping path itu, bukan menggantikannya. Temuannya sudah terbukti, tapi bentuk "
      + "solusinya belum; itu tetap dikerjakan agen fasenya masing-masing, bukan olehmu.";
  // Final fix A2 · dua pemicu jalur cepat qa (langkah 5 orchestratorClause, berbasis frasa `Rekomendasi
  // fase: jalur-cepat` dari agen Audit vs keputusan ROUTING orchestrator dari dokumen audit di sini)
  // bersambung tanpa kalimat penyelaras: Audit tak pernah dipanggil pada kontinuitas ini, jadi frasa itu
  // tak akan pernah muncul — literal, orchestrator bisa jatuh SELALU ke jalur penuh, atau mendelegasikan
  // ulang Audit demi frasa itu (melanggar larangan di atas). Kalimat di bawah eksplisit: keputusan
  // routing di sini MENGGANTIKAN langkah 5, bukan menunggunya.
  return `Backlog qa ini LANJUTAN dari audit ${fromAudit}. Temuannya sudah terbukti di ${doc} — `
    + "JANGAN mendelegasikan ulang fase Audit. Sebelum fase lain: jalankan persis "
    + '`echo "Audit skipped" >> "$HANOMAN_PHASE_FILE"`, verifikasi dengan `tail -1 "$HANOMAN_PHASE_FILE"` '
    + "bahwa barisnya benar tertulis (gerbang yang sama seperti langkah 2), lalu cantumkan path dokumen "
    + "audit itu di baris `Artefak fase sebelumnya:` saat memanggil agen fase Spec. Keputusan routing di "
    + "sini menggantikan langkah 5 di atas — JANGAN menunggu frasa `Rekomendasi fase: jalur-cepat` dari "
    + "agen Audit karena Audit tidak dijalankan pada kelanjutan ini. Kamu diizinkan mengambil SATU "
    + "keputusan ROUTING dari isi dokumen audit itu SAJA, dibaca langsung dari kriterianya: temuan "
    + "berconfidence tinggi dan perbaikan langsung berdiff kecil → tandai `Spec skipped` lalu `Plan "
    + "skipped` (gerbang yang sama) lalu panggil agen fase Execute; selebihnya panggil Spec → Plan → "
    + "Execute penuh lewat agen fasenya masing-masing. Kamu TIDAK menginvestigasi ulang maupun merancang "
    + "perbaikannya sendiri — itu tetap pekerjaan agen fase.";
};

// SPEC-376 · ADR-0080 — klausa scope verifikasi hanya untuk flow yang MENULIS KODE. Flow
// dokumen (audit, prd, breakdown, reverse, scaffold) tak punya test untuk
// dijalankan, jadi klausanya cuma menambah token. Ditentukan dari kehadiran fase Execute —
// sumber kebenaran yang sama dengan gate plan di phaseInstruction.
// SPEC-407 · flow goal MENULIS KODE juga, meski pipeline-nya tak punya fase `Execute`. Tanpa
// klausa ini ia jatuh ke DoD repo target dan menjalankan suite penuh — persis lubang ADR-0080.
// SPEC-825 · daftarnya `WORK_PHASES`, bukan rantai `||` yang tumbuh satu suku tiap flow baru.
export const writesCode = (flow: Flow): boolean =>
  PIPELINES[flow].some((p) => (WORK_PHASES as readonly string[]).includes(p));
export const scopeClause = (flow: Flow, scope?: VerifyScope): string =>
  scope && writesCode(flow) ? verifyScopeClause(scope) : "";

// SPEC-543 · ADR-0108 — klausa gaya kode. Gerbangnya `writesCode` yang SAMA dengan scopeClause;
// menyalin daftar flow-nya berarti dua definisi "sesi ini menulis kode" yang bisa berselisih saat
// flow baru lahir. Tak ber-knob, sengaja berbeda dari verifyScope: tak ada keadaan di mana
// "sesi ini boleh menulis komentar yang mengulang kode" masuk akal untuk ditawarkan.
export const codeStyleClause = (flow: Flow): string => writesCode(flow) ? CODE_STYLE_CLAUSE : "";

// SPEC-734 · ADR-0113 · klausa khas metode (mis. "sesi ini tak berpenunggu"). Metode tanpa
// `extraClause` menghasilkan string kosong → `filter(Boolean)` membuangnya → prompt tak berubah
// sedikit pun, yang membuat default `superpowers` byte-identik dengan sebelum spec ini.
export const methodClause = (method: MethodDef): string => method.extraClause ?? "";

// SPEC-843 · ADR-0124 · lampiran backlog. Directive AKTIF dengan path absolut — kebalikan SADAR dari
// lampiran tiket, yang dibingkai UNTRUSTED dan sengaja TANPA path host (SPEC-761). Bedanya asal,
// bukan derajat: lampiran backlog diunggah operator yang sudah lolos gate, sumber kepercayaan yang
// SAMA dengan `Spec.objective` dan `payload` yang memang sudah masuk prompt apa adanya.
//
// Kalimat "baca ulang di awal setiap fase" adalah inti fiturnya, bukan hiasan: prompt ditulis SEKALI
// saat sesi lahir (ADR-0024), jadi daftar di bawah basi begitu operator menambah lampiran.
// Manifest-lah yang selalu segar — server merekonsiliasinya tiap perubahan.
const attachmentClause = (ctx?: AttachmentCtx): string => {
  if (!ctx || ctx.items.length === 0) return "";
  const list = ctx.items.map((a) =>
    `- \`${a.path}\` — ${a.filename} (${a.mimeType}, ${a.size} byte)`).join("\n");
  return `LAMPIRAN backlog item ini (${ctx.items.length} berkas) sudah tersedia sebagai berkas di mesin ini:\n`
    + `${list}\n`
    + "BACA semuanya SEBELUM mengerjakan fase pertama — dokumen teks (.md/.txt/.log/.json/.csv) baca "
    + "langsung, PDF dan gambar baca lewat path berkasnya. Ini konteks yang dipegang manusia saat "
    + "memfilekan item ini; mengabaikannya berarti bekerja dengan konteks yang lebih miskin darinya.\n"
    + "Lampiran bisa BERTAMBAH atau BERKURANG selagi sesi berjalan. Di AWAL SETIAP FASE, baca ulang "
    + `manifest \`${ctx.dir}/INDEX.md\` lalu baca lampiran yang belum pernah kamu baca — daftar di atas `
    + "adalah keadaan saat sesi ini lahir, bukan keadaan tetap.";
};

// ADR-0170 P2 · varian ORCHESTRATOR. Orchestrator tak mengerjakan fase, jadi menyuruhnya membaca SEMUA
// lampiran hanya membakar konteks model orchestrator; agen fase sudah disuruh membaca manifest yang
// diteruskan lewat baris `Lampiran:` (ATTACHMENT_NOTE phase-agents.ts). Mode tunggal tetap di atas.
const orchestratorAttachmentClause = (ctx?: AttachmentCtx): string => {
  if (!ctx || ctx.items.length === 0) return "";
  return `LAMPIRAN backlog item ini: ${ctx.items.length} berkas saat sesi lahir, manifestnya `
    + `\`${ctx.dir}/INDEX.md\` (selalu segar — lampiran bisa bertambah/berkurang). JANGAN membaca lampiran `
    + "untuk mengerjakan fase: cantumkan path manifest itu di baris `Lampiran:` blok serah-terima SETIAP "
    + "fase — agen fase yang membacanya.";
};

// Sesi project-level (reverse/scaffold/prd/breakdown) TAK punya baris `Spec`, jadi tak punya metode
// tersimpan; ketiganya juga flow dokumen, yang katalog mattpocock tak layani. Mereka tetap di metode
// default — dinyatakan, bukan kebetulan (ADR-0113).
export const PROJECT_METHOD = resolveMethod();

// ADR-0164 · blok konteks di ekor prompt. Diekspor karena agen fase lahir dengan konteks TERPISAH
// (subagent tak melihat prompt parent), jadi server menyematkan blok yang SAMA ke instruksinya.
export const specContext = (spec: SpecBrief): string => {
  const detail = spec.payload ? `\nDetail: ${JSON.stringify(spec.payload)}` : "";
  return `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
    + `Judul: ${spec.title}\nObjective: ${spec.objective}${detail}`;
};
export const goalDetail = (spec: SpecBrief): string => {
  const g = readGoalPayload(spec.payload);
  return [
    `Goal: ${g?.goal ?? spec.objective}`,
    g?.done ? `Selesai bila: ${g.done}` : "",
    g?.constraints ? `Batasan: ${g.constraints}` : "",
  ].filter(Boolean).join("\n");
};
export const goalBlock = (spec: SpecBrief): string =>
  `Backlog item ${spec.id} · sumber ${spec.source} · prioritas ${spec.priority}\n`
    + `Judul: ${spec.title}`;
export const goalContext = (spec: SpecBrief): string => `${goalDetail(spec)}\n\n${goalBlock(spec)}`;
export const projectContext = (project: ProjectBrief): string =>
  `Project ${project.id} · ${project.name}\nDeskripsi: ${project.desc || "—"}\nStack: ${project.stack || "—"}`;
export const scaffoldContext = (project: ProjectBrief): string =>
  `Project ${project.id} · ${project.name}\nIde awal: ${project.desc || "—"}\nStack: ${project.stack || "—"}`;
export const prdBriefBlock = (project: ProjectBrief, brief: PrdBrief): string =>
  `Project ${project.id} · ${project.name}\nBrief — Judul: ${brief.title}\nKonteks: ${brief.context}\n`
    + `Outcome: ${brief.outcome}${brief.constraints ? `\nBatasan: ${brief.constraints}` : ""}`;
export const prdAuditBlock = (audit?: AuditDoc): string => audit
  ? `=== DOKUMEN AUDIT ${audit.id} (${audit.path}) ===\nPRD ini adalah TINDAK LANJUT audit di bawah. `
    + "Pakai temuannya sebagai bahan brainstorm — jangan menginvestigasi ulang, dan jangan pula "
    + `menyalinnya mentah-mentah ke PRD.\n\n${audit.content}`
  : "";
export const prdContext = (project: ProjectBrief, brief: PrdBrief, audit?: AuditDoc): string =>
  [prdBriefBlock(project, brief), prdAuditBlock(audit)].filter(Boolean).join("\n\n");
export const breakdownContext = (project: ProjectBrief, prd: BreakdownPrd): string =>
  `Project ${project.id} · ${project.name}\n=== PRD: ${prd.title} (${prd.path}) ===\n${prd.content}`;

// ADR-0164 · baris panduan fase PRD & breakdown dipakai DUA jalur: prompt sesi tunggal di bawah dan
// instruksi agen fase (phase-agents.ts). String dipindah APA ADANYA dari pembangunnya.
export const prdPhaseLines = (slug: string): Record<"Brainstorm" | "PRD", string> => ({
  Brainstorm: `- Brainstorm: pandu PM secara interaktif. Ajukan SATU pertanyaan per giliran ke manusia di `
    + `terminal ini, tunggu jawabannya, perdalam brief sampai jelas (masalah, pengguna, scope, `
    + `metrik sukses). Jangan mengarang; topik yang PM belum jawab tandai sebagai open question.`,
  PRD: `- PRD: tulis dokumen ke \`docs/prd/${slug}.md\`. Awali dengan heading \`# <judul PRD>\`, lalu `
    + `bagian: Ringkasan · Masalah & konteks · Persona/pengguna · Goals & non-goals · Scope `
    + `(in/out) · User stories · Acceptance criteria (gaya EARS) · Metrik sukses · Open questions. `
    + `Isi lengkap dan spesifik dari hasil brainstorm, bukan kerangka kosong.`,
});
export const breakdownPhaseLines = (slug: string, title: string): Record<"Analisis" | "Breakdown", string> => ({
  Analisis: `- Analisis: baca PRD (di bawah) sampai paham SELURUH scope in-PRD. Petakan pekerjaan menjadi `
    + `unit-unit yang: (a) kecil & terukur — tiap unit tuntas dalam satu sesi; (b) non-overlapping `
    + `— cakupan tak tumpang tindih; (c) TANPA cross-dependency — urutan bebas, bisa jalan bersamaan; `
    + `(d) gabungannya MENUTUP seluruh scope PRD. Bila dua unit terpaksa berurutan, gabung jadi satu.`,
  Breakdown: `- Breakdown: tulis manifest ke \`docs/prd/${slug}.breakdown.md\`. Awali heading `
    + `\`# Breakdown: ${title}\`, lalu prosa: ringkasan + untuk TIAP backlog satu paragraf `
    + `(judul, cakupan, dan SATU kalimat kenapa aman-paralel / tak bergantung yang lain). `
    + `Di AKHIR dokumen sertakan TEPAT SATU blok kode berpagar json berisi kontrak mesin PERSIS `
    + `bentuk ini (tanpa komentar, priority ∈ tinggi|sedang|rendah):\n`
    + "```json\n"
    + `{ "items": [ { "title": "…", "context": "…", "outcome": "…", "priority": "sedang" } ] }\n`
    + "```\n"
    + `\`context\` = bagian PRD yang dicakup; \`outcome\` = kondisi selesai terukur; \`title\` ringkas. `
    + `Minimal 2 item bila PRD memang kompleks; bila PRD ternyata sekecil 1 unit, katakan itu di `
    + `prosa dan tetap tulis 1 item.`,
});

export function startPrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx, plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  const head = `hanoman ${flow}. Ikuti internal/docs sebagai Source of Truth; perbarui docs yang tersentuh `
    + `dan link-nya di index, dalam commit yang sama.`;
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  // ADR-0164 · orchestrator: CARA mengerjakan fase (skill, panduan, scope, gaya kode, keputusan
  // pasca-Audit) hidup di definisi agen fase — prompt parent hanya membawa kontrak delegasi.
  if (plan) {
    return [
      head, orchestratorClause(plan, { fastPath: flow === "qa" }), auditContinuationForOrchestrator(flow, spec),
      autonomyClause(autonomy), orchestratorAttachmentClause(attachments), push, specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    phaseInstruction(PIPELINES[flow], m),
    auditDecisionInstruction(flow),
    auditContinuationInstruction(flow, spec),
    auditOnlyInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(flow, PIPELINES[flow], m),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}

// SPEC-172 · reopen sesi backlog item yang keburu ditandai `done` padahal kerjanya belum
// tuntas (mis. spec ber-banyak-PR, baru sebagian beres). Beda dari startPrompt: TIDAK
// menggiring pipeline dari awal — spec & plan sudah ada, jadi sesi lanjut langsung di
// Execute. Kontinuitas: plan di docs/superpowers/plans/** menandai task `[x]`/`[ ]`, dan
// kerja yang selesai umumnya sudah ter-merge ke branchFrom (worktree lahir dari sana).
export function continuePrompt(
  flow: Flow, spec: SpecBrief, branchTo: string, autonomy?: Autonomy, verifyScope?: VerifyScope,
  method?: string, attachments?: AttachmentCtx, plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  const head = `hanoman ${flow} — MELANJUTKAN backlog item yang sebelumnya ditandai selesai padahal `
    + `pekerjaannya belum tuntas. Ikuti internal/docs sebagai Source of Truth; perbarui `
    + `docs yang tersentuh dan link-nya di index, dalam commit yang sama.`;
  const push = `Setelah selesai: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Worktree `
    + `ini detached HEAD — itu memang disengaja.`;
  if (plan) {
    return [
      head,
      `JANGAN mengulang fase awal — spec & plan sudah ada di ${m.planDir}/**. Lanjutkan HANYA fase `
        + "Execute lewat subagent fasenya.",
      // S3 · berkas fase tak pernah dikosongkan: baris `Execute done` run lama masih ada dan akan
      // memenuhi gerbang penutup sebelum agen Execute sesi ini bekerja sama sekali.
      "$HANOMAN_PHASE_FILE masih memuat baris `Execute done` LAMA dari sesi sebelumnya — baris itu "
        + "TIDAK berlaku untuk sesi ini dan tidak memenuhi gerbang penutup. Sesudah agen fase Execute "
        + "SESI INI melapor `Status: selesai` (dan lolos langkah R bila ada), tulis baris `Execute done` BARU "
        + "(verifikasi `tail -1`); "
        + "commit/push final baru sah sesudah baris baru itu.",
      orchestratorClause(plan), autonomyClause(autonomy), orchestratorAttachmentClause(attachments), push,
      specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    `JANGAN mengulang fase awal — spec & plan sudah ada. Lanjut di fase Execute: baca plan `
      + `di ${m.planDir}/** untuk backlog item ini, periksa task yang sudah \`[x]\` `
      + `dan selesaikan yang masih \`[ ]\`. Verifikasi nyata sebelum klaim selesai.`,
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(flow, ["Execute"], m),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}

// SPEC-394 · ADR-0084 — sesi backlog yang DILANJUTKAN. Beda dari continuePrompt (SPEC-172, yang
// melayani spec keburu-`done` dan karena itu melompat ke Execute): di sini pipeline-nya UTUH dan
// yang berubah hanya titik masuknya. Agen tak bisa menurunkan sendiri "fase mana yang sudah
// selesai" — berkas fase hidup di luar worktree dan tak ikut ter-checkout — jadi server yang
// menyebutkannya. Sengaja TIDAK menyalin baris fase ke phase file: berkas itu milik agen.
// SPEC-407 · `hasPlan` = pipeline-nya memang punya fase Plan. Sesi goal tak punya plan berkotak,
// dan menyuruhnya mencari plan justru mengundangnya membuat satu — persis ritual yang dihapus.
const resumeClause = (
  r: ResumeCtx, branchTo: string, planDir: string, hasPlan = true,
): string => {
  const fase = r.recorded.length
    ? `Fase yang SUDAH tercatat di $HANOMAN_PHASE_FILE: ${r.recorded.join(" · ")}. `
      + "JANGAN mengulang fase itu dan JANGAN menulis ulang barisnya."
    : "Belum ada fase yang tercatat di $HANOMAN_PHASE_FILE — worktree ini sendiri yang jadi "
      + "alasan melanjutkan.";
  const lanjut = r.next
    ? `Lanjutkan dari fase: ${r.next}.`
    : hasPlan
      ? `Semua fase sudah tercatat. Periksa apakah plan di \`${planDir}/**\` masih `
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
      + `\`${planDir}/**\` untuk backlog item ini (\`- [x]\` sudah selesai, \`- [ ]\` belum). `
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
  autonomy?: Autonomy, verifyScope?: VerifyScope, method?: string, attachments?: AttachmentCtx,
  plan?: PhasePlan | null,
): string {
  const m = resolveMethod(method);
  // Keputusan pasca-Audit (ADR-0040) hanya relevan selama Audit belum tercatat. Sesudah itu
  // keputusannya SUDAH diambil dan sudah mewujud sebagai baris `Spec skipped`/`Spec done` di
  // berkas fase — menyuruh agen memutuskannya lagi berarti mengundangnya membatalkan keputusan
  // sesi sebelumnya.
  const auditDecided = resume.recorded.some((line) => line.startsWith("Audit "));
  const head = `hanoman ${flow} — MELANJUTKAN sesi backlog yang sudah berjalan. Ikuti internal/docs sebagai `
    + `Source of Truth; perbarui docs yang tersentuh dan link-nya di index, dalam commit yang sama.`;
  const resumed = resumeClause(resume, branchTo, m.planDir, PIPELINES[flow].includes("Plan"));
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  if (plan) {
    return [
      head, resumed, orchestratorClause(plan, { fastPath: flow === "qa" && !auditDecided }),
      autonomyClause(autonomy), orchestratorAttachmentClause(attachments), push, specContext(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    resumed,
    phaseInstruction(PIPELINES[flow], m),
    auditDecided ? "" : auditDecisionInstruction(flow),
    autonomyClause(autonomy),
    scopeClause(flow, verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(attachments),
    skillInstruction(flow, PIPELINES[flow], m),
    push,
    specContext(spec),
  ].filter(Boolean).join("\n\n");
}

// SPEC-407 · ADR-0089 · sesi backlog GOAL. Sengaja bukan cabang di dalam startPrompt: yang
// berbeda bukan satu-dua kalimat melainkan KERANGKA-nya — tak ada fase perencanaan, tak ada
// keputusan pasca-Audit, tak ada skill Brainstorm/Plan, tak ada blok Detail berisi JSON payload
// (isi payload sudah dieja sebagai Goal/Selesai bila/Batasan). Mode goal (Stop hook ADR-0073)
// dipasang di sisi server saat sesi lahir, bukan lewat prompt ini.
//
// SPEC-825 · ADR-0123 · flow `no_effort` memakai KERANGKA yang sama persis — payload bentuk yang
// sama, tanpa fase perencanaan, isi payload dieja sebagai prosa — jadi ia diparametrisasi flow,
// bukan disalin. Yang berbeda hanya kepala prompt dan ada/tidaknya klausa fase Verifikasi.
export function startGoalPrompt(
  flow: "goal" | "no_effort", spec: SpecBrief, branchTo: string,
  opts: { autonomy?: Autonomy; verifyScope?: VerifyScope; resume?: ResumeCtx; method?: string;
          attachments?: AttachmentCtx; plan?: PhasePlan | null } = {},
): string {
  const m = resolveMethod(opts.method);
  const noEffort = flow === "no_effort";
  const head = noEffort
    ? "hanoman no-effort — sesi ini mengerjakan SATU pekerjaan remeh lalu berhenti. TIDAK ada "
      + "fase Brainstorm, Objective, Spec, Plan, maupun fase pembuktian terpisah: jangan menulis "
      + "design doc, jangan menulis plan berkotak, jangan memecah pekerjaan ini jadi backlog "
      + "baru, dan jangan menambah fase sendiri. Langsung kerjakan, buktikan seperlunya di fase "
      + "yang sama, lalu berhenti. Tetap ikuti internal/docs sebagai Source of Truth; perbarui "
      + "docs yang tersentuh dan link-nya di index, dalam commit yang sama."
    : "hanoman goal — sesi ini mengejar SATU goal sampai tercapai. TIDAK ada fase Brainstorm, "
      + "Objective, Spec, maupun Plan: jangan menulis design doc, jangan menulis plan berkotak, "
      + "jangan memecah pekerjaan ini jadi backlog baru. Langsung kerjakan goal-nya. Tetap ikuti "
      + "internal/docs sebagai Source of Truth; perbarui docs yang tersentuh dan link-nya di "
      + "index, dalam commit yang sama.";
  const resumed = opts.resume ? resumeClause(opts.resume, branchTo, m.planDir, false) : "";
  const push = `Setelah fase terakhir: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. `
    + `Worktree ini detached HEAD — itu memang disengaja.`;
  if (opts.plan) {
    return [
      head, resumed, goalDetail(spec), orchestratorClause(opts.plan), autonomyClause(opts.autonomy),
      orchestratorAttachmentClause(opts.attachments), push, goalBlock(spec),
    ].filter(Boolean).join("\n\n");
  }
  return [
    head,
    resumed,
    goalDetail(spec),
    phaseInstruction(PIPELINES[flow], m),
    noEffort ? ""
      : "Fase Verifikasi bukan formalitas: jalankan perintah yang membuktikan goal-nya tercapai "
        + "(test/typecheck/benchmark/perintah yang relevan) dan baca outputnya. Klaim tanpa output "
        + "bukan bukti.",
    autonomyClause(opts.autonomy),
    scopeClause(flow, opts.verifyScope),
    codeStyleClause(flow),
    methodClause(m),
    attachmentClause(opts.attachments),
    skillInstruction(flow, PIPELINES[flow], m),
    push,
    goalBlock(spec),
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
export const REVERSE_PHASE_GUIDE = [
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

export function startProjectPrompt(flow: Flow, project: ProjectBrief, branchTo: string, plan?: PhasePlan | null): string {
  const push = `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
    + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
    + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
    + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`;
  if (plan) {
    return [
      `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/** lewat subagent `
        + "fase; STANDAR DOCS ada di definisi agen fase penulis docs.",
      orchestratorClause(plan), push, projectContext(project),
    ].join("\n\n");
  }
  return [
    `hanoman ${flow}. Susun Source of Truth repo ini dari kodenya di internal/docs/**, `
      + `mengikuti STANDAR DOCS di bagian bawah prompt ini.`,
    phaseInstruction(PIPELINES[flow], PROJECT_METHOD),
    REVERSE_PHASE_GUIDE,
    push,
    projectContext(project),
    `=== STANDAR DOCS ===\n${REVERSE_STANDARD}`,
  ].join("\n\n");
}

// SPEC-210 · sesi prd: PM/PO menyusun SATU dokumen PRD dari brief + brainstorm interaktif.
// Project-level (tanpa Spec), meniru startProjectPrompt. Keluaran HANYA dokumen — tak menulis
// kode fitur. Brainstorm interaktif (satu pertanyaan per giliran; PM menonton terminal), lalu
// tulis PRD terstruktur, commit, push ke branch prd/<slug>; manusia yang merge. Tak membawa
// AUTONOMY_CLAUSE: seperti Wawancara reverse, brainstorm PRD memang berjalan bergiliran dgn PM.
export function startPrdPrompt(
  project: ProjectBrief, brief: PrdBrief, branchTo: string, audit?: AuditDoc, plan?: PhasePlan | null,
): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  const push = `Setelah PRD ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
    + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
    + `ini detached HEAD — memang disengaja. Manusia yang me-review lalu merge branch ${branchTo}.`;
  if (plan) {
    return [
      "hanoman prd. Kamu memimpin penyusunan SATU dokumen PRD untuk project ini lewat subagent fase. "
        + "Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.",
      orchestratorClause(plan), push, prdBriefBlock(project, brief),
    ].join("\n\n");
  }
  const lines = prdPhaseLines(slug);
  return [
    `hanoman prd. Kamu memandu PM/PO menyusun SATU dokumen PRD untuk project ini dari brief + `
      + `brainstorm. Keluaranmu HANYA dokumen PRD — JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.prd, PROJECT_METHOD),
    lines.Brainstorm,
    lines.PRD,
    skillInstruction("prd", PIPELINES.prd, PROJECT_METHOD),
    push,
    prdBriefBlock(project, brief),
    prdAuditBlock(audit),
  ].filter(Boolean).join("\n\n");
}

// SPEC-273 · sesi breakdown: pecah SATU PRD kompleks → BEBERAPA backlog kecil yang PARALEL-aman
// (tanpa saling bergantung). Project-level (tanpa Spec), meniru startPrdPrompt. Isi PRD disematkan
// (lepas dari status merge). Keluaran HANYA manifest doc — tak menulis kode fitur. Autonomous
// (analisis, bukan brainstorm bergiliran) → memakai AUTONOMY_CLAUSE.
export function startBreakdownPrompt(
  project: ProjectBrief, prd: BreakdownPrd, branchTo: string, plan?: PhasePlan | null,
): string {
  const slug = branchTo.slice(branchTo.lastIndexOf("/") + 1);
  const push = `Setelah manifest ditulis: commit, lalu \`git push origin HEAD:refs/heads/${branchTo}\`. Bila remote `
    + `origin tidak ada, lewati push dan catat itu di terminal — jangan gagal diam-diam. Worktree `
    + `ini detached HEAD — memang disengaja. Manusia me-review manifest lalu materialize backlog darinya.`;
  if (plan) {
    return [
      "hanoman breakdown. Kamu memimpin pemecahan SATU PRD kompleks menjadi BEBERAPA backlog kecil yang "
        + "bisa dikerjakan PARALEL lewat subagent fase. Keluaranmu HANYA dokumen manifest — JANGAN "
        + "menulis kode fitur.",
      orchestratorClause(plan), AUTONOMY_CLAUSE, push,
      `Project ${project.id} · ${project.name}\nPRD: ${prd.title} (${prd.path})`,
    ].join("\n\n");
  }
  const lines = breakdownPhaseLines(slug, prd.title);
  return [
    `hanoman breakdown. Kamu memecah SATU PRD kompleks menjadi BEBERAPA backlog kecil yang bisa `
      + `dikerjakan PARALEL tanpa saling bergantung. Keluaranmu HANYA dokumen manifest — `
      + `JANGAN menulis kode fitur.`,
    phaseInstruction(PIPELINES.breakdown, PROJECT_METHOD),
    lines.Analisis,
    lines.Breakdown,
    AUTONOMY_CLAUSE,
    push,
    breakdownContext(project, prd),
  ].filter(Boolean).join("\n\n");
}

// SPEC-222 · panduan per fase scaffold (project-level, from-scratch). Reverse tanpa Scan:
// tak ada kode untuk dipindai, jadi Brainstorm interaktif menggali ide jadi objective, lalu
// Doc index menulis seluruh internal/docs/** dari ide+objective+jawaban. Brainstorm memang
// bergiliran dengan manusia — karena itu SATU pertanyaan per giliran, tanpa AUTONOMY_CLAUSE.
export const SCAFFOLD_PHASE_GUIDE = [
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
export function startScaffoldPrompt(project: ProjectBrief, branchTo: string, plan?: PhasePlan | null): string {
  const push = `Setiap fase selesai: commit hasilnya, lalu \`git push origin HEAD:refs/heads/${branchTo}\` — `
    + `push per fase, supaya pekerjaan tak hilang bila worktree lenyap. Bila remote origin tidak ada, `
    + `lewati push dan catat itu di laporan akhir — jangan gagal diam-diam. Worktree ini `
    + `detached HEAD — memang disengaja. Manusia yang me-review dan merge branch ${branchTo}.`;
  if (plan) {
    return [
      "hanoman scaffold. Susun Source of Truth LENGKAP untuk project from-scratch ini di internal/docs/** "
        + "DARI IDE-nya lewat subagent fase; STANDAR DOCS ada di definisi agen fase Doc index. Belum ada "
        + "kode — docs dulu.",
      orchestratorClause(plan), push, scaffoldContext(project),
    ].join("\n\n");
  }
  return [
    `hanoman scaffold. Susun Source of Truth LENGKAP untuk project from-scratch ini di internal/docs/** `
      + `DARI IDE-nya, mengikuti STANDAR DOCS di bagian bawah prompt ini. Belum ada kode — docs dulu.`,
    phaseInstruction(PIPELINES.scaffold, PROJECT_METHOD),
    SCAFFOLD_PHASE_GUIDE,
    push,
    skillInstruction("scaffold", PIPELINES.scaffold, PROJECT_METHOD),
    scaffoldContext(project),
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
