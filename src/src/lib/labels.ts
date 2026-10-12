// Audit UI/UX 2026-10 · Fase 2D — peta label Bahasa Indonesia TERPUSAT.
//
// Satu sumber untuk setiap nilai enum yang tampil ke operator. Layar mengimpor dari sini (atau dari
// re-export berkas lama yang masih dipertahankan), tidak menyalin peta ke berkas layar. Panduan lengkap:
// internal/docs/frontend/glossary.md.
//
// - Tipe ketat: setiap peta memakai union dari @hanoman/shared. Enum baru yang belum dipetakan gagal
//   di typecheck, bukan tampil sebagai nilai mentah.
// - Fallback aman saat jalan: nilai yang tak dikenal (data server lebih baru dari klien) lewat
//   `labelOf` → `humanize`: "weird_value" → "Weird value". Tanpa crash, tanpa kapital aneh, dan
//   kosong/null → "—".
// - Sentence case untuk badge dan tombol. Frasa yang disisipkan di kalimat (aria, tooltip) boleh
//   huruf kecil bila itu bagian dari kalimat, dan ditandai di bawah.
import {
  AGENT_RUNTIME_LABELS, SESSION_KIND_LABEL as SHARED_SESSION_KIND_LABEL, zDocStatus, zProjectKind, zTicketStatus,
  type AgentRuntime, type LeadConfidence, type LeadFlowStatus, type LeadKind, type OrchestrationFlow, type PrdStatus,
  type Priority, type QaCaseStatus, type QaFindingStatus, type QaPriority, type QaReportStatus, type QaSeverity,
  type QaVerdict, type Severity, type SpecSource, type Stage, type TaskStatus, type VpsItemStatus, type VpsSeverity,
  type ComponentStatus, type LimitSeverity, type LeadStatus,
} from "@hanoman/shared";

/** Nilai enum dari `z.enum` shared, tanpa mengimpor zod ke frontend. */
type EnumOf<T extends { options: readonly string[] }> = T["options"][number];

/** Huruf pertama kapital, separator `-`/`_` jadi spasi. Dipakai hanya sebagai fallback. */
export function humanize(raw: string): string {
  const s = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

/**
 * Label untuk `value`: nilai yang dipetakan dipakai apa adanya; yang tak dikenal dirapikan
 * (`humanize`); kosong/null/undefined → "—". Tak pernah melempar, tak pernah mengembalikan
 * properti bawaan objek (`constructor`, `__proto__`) sebagai label.
 */
export function labelOf(map: Readonly<Record<string, string>>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Object.prototype.hasOwnProperty.call(map, value) ? (map as Record<string, string>)[value]! : humanize(value);
}

// ── Prioritas & severity ───────────────────────────────────────────────────────────────

export const PRIORITY_LABEL: Record<Priority, string> = { tinggi: "Tinggi", sedang: "Sedang", rendah: "Rendah" };

/** Cakupan worktree di filter Backlog (ADR-0214). Bukan enum shared: `worktree` = `baseSha` terisi. */
export const WORKTREE_SCOPE_LABEL: Record<"all" | "worktree", string> = { all: "Semua item", worktree: "Ber-worktree" };

/** Cakupan "Perlu ditinjau" di filter Backlog (gelombang 7). Predikatnya sesi item yang menunggu jawaban
 *  manusia, bukan status tinjau diff: lihat `screens/backlog-worktree.ts` (`reviewSpecIdsOf`). */
export const REVIEW_SCOPE_LABEL: Record<"all" | "review", string> = { all: "Semua item", review: "Perlu ditinjau" };

/** Severity QA. `blocker` = tak bisa dipakai; `trivial` = hanya tampilan. */
export const QA_SEVERITY_LABEL: Record<QaSeverity, string> = {
  blocker: "Tidak bisa digunakan", critical: "Kritis", major: "Fitur terganggu", minor: "Gangguan kecil", trivial: "Tampilan saja",
};

/** Severity item backlog (sumber QA/audit). Tiga tingkat yang sama dengan QA, jadi kata yang sama. */
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: QA_SEVERITY_LABEL.critical, major: QA_SEVERITY_LABEL.major, minor: QA_SEVERITY_LABEL.minor,
};

/** Prioritas QA (P0 = paling mendesak). Kode P0..P3 tetap ditampilkan karena operator mengenalnya. */
export const QA_PRIORITY_LABEL: Record<QaPriority, string> = {
  P0: "P0 · Segera", P1: "P1 · Tinggi", P2: "P2 · Normal", P3: "P3 · Rendah",
};

export const VPS_SEVERITY_LABEL: Record<VpsSeverity, string> = { critical: "Kritis", high: "Tinggi", medium: "Sedang", low: "Rendah" };

export const LIMIT_SEVERITY_LABEL: Record<LimitSeverity, string> = { normal: "aman", warning: "peringatan", critical: "kritis" };

// ── Status QA ──────────────────────────────────────────────────────────────────────────

export const FINDING_STATUS_LABEL: Record<QaFindingStatus, string> = {
  open: "Perlu diperbaiki", sent: "Sudah di backlog", wontfix: "Tidak akan diperbaiki",
};
export const CASE_STATUS_LABEL: Record<QaCaseStatus, string> = {
  todo: "Belum diuji", pass: "Lulus", fail: "Gagal", blocked: "Terhambat", skipped: "Dilewati",
};
export const REPORT_STATUS_LABEL: Record<QaReportStatus, string> = { draft: "Draf", submitted: "Diajukan", closed: "Selesai · terkunci" };
export const VERDICT_LABEL: Record<QaVerdict, string> = {
  go: "Siap digunakan", "no-go": "Belum siap digunakan", conditional: "Siap dengan catatan",
};

// ── Status item, tiket, dan dokumen ────────────────────────────────────────────────────

/** Tahap Spec yang diturunkan dari fase sesi. Kata yang dilihat operator di kartu dan panggung Dalang. */
export const STAGE_LABEL: Record<Stage, string> = {
  brainstorming: "Brainstorm", objective: "Tujuan", "spec-ready": "Spek siap", planned: "Rencana siap",
  executing: "Dikerjakan", done: "Selesai",
};

/** Status triase tiket (Help Center). */
export const TICKET_STATUS_LABEL: Record<EnumOf<typeof zTicketStatus>, string> = {
  new: "Belum ditinjau", accepted: "Diterima", rejected: "Ditutup",
};

/** Kolom papan tim. Milik manusia, bukan turunan fase. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Menunggu", doing: "Dikerjakan", review: "Review", done: "Selesai",
};

export const DOC_STATUS_LABEL: Record<EnumOf<typeof zDocStatus>, string> = {
  ok: "Sesuai standar", drift: "Tidak sinkron", broken: "Belum sesuai",
};

export const PRD_STATUS_LABEL: Record<PrdStatus, string> = { draft: "Draf", dieskalasi: "Dieskalasi", terwujud: "Terwujud" };

export const PROJECT_KIND_LABEL: Record<EnumOf<typeof zProjectKind>, string> = {
  "from-scratch": "Dari nol", existing: "Repo sudah ada",
};

/** Jenis asal item backlog (lencana & opsi dialog). `brief` = feature brief. */
export const SOURCE_LABEL: Record<SpecSource, string> = {
  brief: "Feature brief", qa: "QA finding", audit: "Audit", help: "Help Center", goal: "Goal", no_effort: "Tanpa effort",
};

export const QUEUE_SOURCE_LABEL: Record<"backlog" | "triase", string> = { backlog: "Backlog", triase: "Triase" };

/** Status antrean dan riwayat run penjadwal. Huruf kecil dipertahankan: dipakai di dalam kalimat. */
export const QUEUE_STATUS_LABEL: Record<"queued" | "launched" | "done" | "failed" | "canceled" | "skipped", string> = {
  queued: "menunggu", launched: "berjalan", done: "selesai", failed: "gagal", canceled: "dibatalkan", skipped: "dilewati",
};

export const VPS_ITEM_STATUS_LABEL: Record<VpsItemStatus, string> = {
  pass: "Lulus", fail: "Gagal", warn: "Perlu perhatian", na: "Tidak berlaku", unknown: "Belum diketahui",
};

/** Status komponen VPS. `partial` = ada tapi belum siap (bukan galat). */
export const COMPONENT_STATUS_LABEL: Record<ComponentStatus, string> = { ok: "terpasang", partial: "belum siap", absent: "belum ada" };

// ── Flow, sesi, dan orkestrasi ─────────────────────────────────────────────────────────

/** Nama flow orkestrasi. Dipakai Dalang, Overview, dan Settings orkestrasi: satu kata per flow. */
export const FLOW_LABEL: Record<OrchestrationFlow, string> = {
  feature: "Fitur", qa: "QA", scaffold: "Scaffold", reverse: "Reverse docs", prd: "PRD", audit: "Audit",
  breakdown: "Breakdown PRD", goal: "Goal", no_effort: "Tanpa effort",
};

/** Jenis sesi terminal. Sumbernya tetap di @hanoman/shared; diekspor ulang agar satu pintu impor. */
export const SESSION_KIND_LABEL = SHARED_SESSION_KIND_LABEL;

/** Runtime agen. Sumbernya tetap di @hanoman/shared. */
export const RUNTIME_LABEL: Record<AgentRuntime, string> = AGENT_RUNTIME_LABELS;

/** Keadaan proyek di "Aktivitas terbaru" (Overview). Server mengirim `idle` atau `running · <flow>` sebagai
 *  teks `activity`; keduanya tak pernah tampil mentah, keadaannya cukup satu label ini. */
export const PROJECT_ACTIVITY_LABEL: Record<"running" | "idle", string> = { running: "Berjalan", idle: "Diam" };

/** Status chip fase (aria): dibaca di dalam kalimat `Fase X: selesai · …`, jadi huruf kecil. */
export const PHASE_STATUS_LABEL: Record<"done" | "running" | "pending" | "skipped" | "failed" | "abandoned", string> = {
  done: "selesai", running: "berjalan", pending: "menunggu", skipped: "dilewati", failed: "terputus", abandoned: "ditinggalkan",
};

// ── Lead (keputusan & alur) ────────────────────────────────────────────────────────────

export const LEAD_CONFIDENCE_LABEL: Record<LeadConfidence, string> = { tinggi: "yakin tinggi", sedang: "yakin sedang", ragu: "ragu-ragu" };
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { berlaku: "Berlaku", ditimpa: "Ditimpa", dibatalkan: "Dibatalkan", gagal: "Gagal" };
export const LEAD_KIND_LABEL: Record<LeadKind, string> = {
  answer: "jawaban", order: "urutan kerja", collision: "tabrakan area", quality: "mutu hasil", refusal: "tindakan ditolak",
};
export const LEAD_FLOW_STATUS_LABEL: Record<LeadFlowStatus, string> = {
  menunggu: "Menunggu kamu", sebagian: "Sebagian terjawab", selesai: "Selesai", dibatalkan: "Dibatalkan",
};
export const LEAD_FLOW_CLOSE_LABEL: Record<"tunggal" | "submit" | "operator" | "kedaluwarsa", string> = {
  tunggal: "sekali jalan", submit: "dikirim", operator: "ditutup oleh kamu", kedaluwarsa: "kedaluwarsa",
};
export const LEAD_GATE_LABEL: Record<"contract" | "detected" | "pulse", string> = {
  contract: "kontrak", detected: "deteksi otomatis", pulse: "pemeriksaan berkala",
};
export const LEAD_ACTION_LABEL: Record<
  "answer-session" | "start-session" | "stop-session" | "resume-session" | "restart-session" | "order-queue"
  | "hold-work" | "push-branch" | "integrate-main" | "run-migration", string
> = {
  "answer-session": "jawab di sesi", "start-session": "mulai sesi", "stop-session": "hentikan sesi",
  "resume-session": "lanjutkan sesi", "restart-session": "ulangi dari awal", "order-queue": "atur urutan antrean",
  "hold-work": "tunda pekerjaan", "push-branch": "dorong branch", "integrate-main": "integrasi ke main",
  "run-migration": "jalankan migrasi lokal",
};

// ── Portal & komponen lain yang sudah punya peta sendiri ───────────────────────────────

/** Tipe percakapan portal (ChatPanel klien). */
export const PORTAL_CHAT_TYPE_LABEL: Record<"brainstorm" | "tanya", string> = { brainstorm: "Brainstorming", tanya: "Bertanya" };

// ── Notifikasi & sesi yang sudah berakhir ──────────────────────────────────────────────

/** SPEC-184 · notifikasi (atau palet) menunjuk sesi yang sudah tak hidup, atau tak pernah ada. */
export const SESSION_ENDED_NOTICE = "Sesi itu sudah berakhir.";
/** Aksi toast bila riwayat sesi itu tercatat. Sama dengan item menu "Riwayat sesi" di Terminal. */
export const SESSION_HISTORY_ACTION = "Riwayat sesi";

// ── Izin yang dilaporkan perangkat remote (Klien · Perangkat, ADR-0216 opsi D) ──────────

/** Keadaan izin yang DILAPORKAN perangkat remote ke server ini. Hanya dibaca di sini: pengubahnya ada di perangkat itu.
 *  `khusus` = grant di luar tiga tingkat. `tidak-diketahui` = tak ada laporan (offline, kendali mati, versi lama).
 *  `protokol-tidak-cocok` tampil dengan label yang sama dengan `tidak-diketahui`, tetapi alasannya berbeda. */
export type ReportedAccessKey = "lihat" | "kerja" | "tulis" | "khusus" | "nonaktif" | "tidak-diketahui" | "protokol-tidak-cocok";

export const REPORTED_ACCESS_LABEL: Record<ReportedAccessKey, string> = {
  lihat: "Lihat", kerja: "Kerja", tulis: "Tulis", khusus: "Khusus",
  nonaktif: "Nonaktif", "tidak-diketahui": "Tidak diketahui", "protokol-tidak-cocok": "Tidak diketahui",
};

/** Penanda baca-saja di samping tingkat. Menjawab "siapa yang boleh mengubah ini" tanpa tombol. */
export const REPORTED_ACCESS_OWNER = "Diatur di perangkat itu";

/** Awalan baris tingkat akses perangkat remote. */
export const REPORTED_ACCESS_PREFIX = "Tingkat akses";

/** Penjelasan singkat di bawah tingkat. Selalu menyebut bahwa pengaturannya hanya dari perangkat itu. */
export const REPORTED_ACCESS_HINT: Record<ReportedAccessKey, string> = {
  lihat: "Server ini hanya menampilkan izin yang dilaporkan perangkat itu. Pengaturannya hanya bisa diubah dari perangkat itu, tidak dari sini.",
  kerja: "Server ini hanya menampilkan izin yang dilaporkan perangkat itu. Pengaturannya hanya bisa diubah dari perangkat itu, tidak dari sini.",
  tulis: "Server ini hanya menampilkan izin yang dilaporkan perangkat itu. Pengaturannya hanya bisa diubah dari perangkat itu, tidak dari sini.",
  khusus: "Kombinasi izin yang tidak sama dengan tingkat mana pun. Pengaturannya hanya bisa diubah dari perangkat itu, tidak dari sini.",
  nonaktif: "Kendali aktif di perangkat itu, tetapi tanpa izin apa pun. Tidak ada yang bisa dibuka dari sini.",
  "tidak-diketahui": "Perangkat tidak melaporkan izinnya ke server ini, misalnya karena sedang offline, kendali jarak jauh dimatikan, atau versinya lama.",
  "protokol-tidak-cocok": "Versi protokol perangkat tidak cocok dengan server ini, jadi izinnya tidak bisa dibaca dengan pasti.",
};

/** Alasan tombol "Lihat (baca saja)" mati karena izin yang dilaporkan perangkat remote (ADR-0216 opsi D). */
export const OPEN_BLOCK_NO_GRANT = "Perangkat ini tidak memberi izin apa pun, jadi tidak ada yang bisa dibuka dari sini.";
export const OPEN_BLOCK_NO_READ = "Perangkat ini belum memberi izin Lihat sesi, jadi tampilannya tidak bisa dibuka.";
