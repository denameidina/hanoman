// SPEC-546 · ADR-0109 · SATU katalog UI untuk source backlog: lencana, opsi dialog, dan daftar
// field per bentuk payload. Sebelumnya semuanya hidup sebagai const lokal `BacklogScreen.tsx`,
// jadi dialog "Ubah type" hanya bisa memakainya dengan menyalin — dan katalog yang disalin pasti
// berselisih (pola `session-runtime.ts`, yang dipakai bersama picker Start & form "Sesi baru").
import { zSpecSource } from "@hanoman/shared";
import { PRIORITY_LABEL, SEVERITY_LABEL, SOURCE_LABEL } from "../lib/labels";

// SPEC-237 · satu peta source → tampilan. audit = audit-only (dokumen). brief adalah fallback
// untuk source tak dikenal.
// SPEC-546 · +help. Sebelum ini item Help Center jatuh ke fallback dan memakai lencana
// "feature brief"; sejak konversi ada, `help` adalah tujuan yang sah dan wajib punya wajah.
export const SOURCE_META: Record<string, { label: string; icon: string; tone: "err" | "brass" | "info"; color: string }> = {
  qa:    { label: SOURCE_LABEL.qa,    icon: "bug",       tone: "err",   color: "var(--clay-500)" },
  audit: { label: SOURCE_LABEL.audit, icon: "search",    tone: "info",  color: "var(--wind-600)" },
  brief: { label: SOURCE_LABEL.brief, icon: "lightbulb", tone: "brass", color: "var(--brass-500)" },
  // SPEC-407 · ADR-0089 · backlog goal: sesi dua fase (Goal → Verifikasi), tanpa perencanaan.
  goal:  { label: SOURCE_LABEL.goal,  icon: "target",    tone: "brass", color: "var(--brass-700)" },
  help:  { label: SOURCE_LABEL.help,  icon: "life-buoy", tone: "info",  color: "var(--wind-500)" },
  // SPEC-825 · ADR-0123 · task remeh: satu fase `Kerjakan`, tanpa perencanaan maupun verifikasi.
  no_effort: { label: SOURCE_LABEL.no_effort, icon: "zap", tone: "brass", color: "var(--brass-400)" },
};
export const sourceMeta = (s: string) => SOURCE_META[s] ?? SOURCE_META.brief!;

// Opsi dialog DITURUNKAN dari enum + katalog di atas: source baru di `zSpecSource` otomatis
// muncul, dan labelnya tak bisa berbeda dari lencananya.
export const SOURCE_OPTS = zSpecSource.options.map((v) => ({ value: v, label: sourceMeta(v).label }));

// SPEC-490 · elemen ketiga = placeholder (contoh nilai). Satu <HnTextarea> merender ketiga daftar
// ini, jadi contohnya milik katalog fieldnya — bukan call site.
// SPEC-826 · label batasan diseragamkan "Batasan" untuk KETIGA bentuk: form buat-backlog
// (`App.tsx`) sudah menulis "Batasan" untuk brief, jadi "Constraints" di sini membuat field yang
// sama bernama dua hal tergantung layar mana yang dibuka operator.
export const BRIEF_FIELDS = [
  ["context", "Konteks", "mis. operator harus membuka tiga layar untuk tahu sesi mana yang menunggu"],
  ["outcome", "Outcome", "mis. satu badge di Overview menunjukkan jumlah sesi yang menunggu"],
  ["constraints", "Batasan", "mis. reuse queue yang ada"],
] as const;
// SPEC-407 · ADR-0089 · bentuk payload backlog goal (zGoalPayload) — bukan konteks/outcome.
// SPEC-825 · dipakai source `goal` DAN `no_effort`: katalog berkunci BENTUK, bukan source.
export const GOAL_FIELDS = [
  ["goal", "Goal", "mis. p95 GET /api/specs di bawah 200 ms"],
  ["done", "Selesai bila", "mis. output benchmark menunjukkan < 200 ms"],
  ["constraints", "Batasan", "mis. tanpa cache eksternal"],
] as const;
export const QA_FIELDS = [
  ["severity", "Severity", ""],
  ["steps", "Langkah reproduksi", "1. Buka …\n2. Lakukan …\n3. Amati …"],
  ["expected", "Diharapkan", "mis. total funnel sama dengan jumlah baris laporan harian"],
  ["actual", "Aktual", "mis. total funnel dua kali lipat untuk sesi yang melewati tengah malam"],
  ["env", "Environment", "prod · web · v0.9.2"],
  // SPEC-826 · terakhir, cermin posisi constraints di brief & goal.
  ["constraints", "Batasan", "mis. jangan ubah kontrak API"],
] as const;

/** bentuk payload → daftar field yang dirender form. Kunci sama dengan `PayloadShape`. */
export const SHAPE_FIELDS: Record<string, readonly (readonly [string, string, string])[]> = {
  brief: BRIEF_FIELDS, qa: QA_FIELDS, goal: GOAL_FIELDS,
};

// SPEC-186 · opsi enum untuk form edit inline & dialog konversi.
export const PRIO_OPTS = [
  { value: "tinggi", label: PRIORITY_LABEL.tinggi }, { value: "sedang", label: PRIORITY_LABEL.sedang },
  { value: "rendah", label: PRIORITY_LABEL.rendah }];
export const SEV_OPTS = [
  { value: "critical", label: SEVERITY_LABEL.critical }, { value: "major", label: SEVERITY_LABEL.major },
  { value: "minor", label: SEVERITY_LABEL.minor }];
