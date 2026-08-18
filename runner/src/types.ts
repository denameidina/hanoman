// SPEC-407 · ADR-0089 · +goal · sesi backlog dua fase (Goal → Verifikasi), tanpa fase perencanaan.
// SPEC-825 · ADR-0123 · +no_effort · sesi backlog SATU fase (Kerjakan) untuk task remeh.
export type Flow = "feature" | "qa" | "scaffold" | "reverse" | "prd" | "audit" | "breakdown" | "goal" | "no_effort";

// SPEC-298 · mode autonomy sesi scheduler (Setting.scheduler.autonomy). full-control = putuskan
// sendiri & tembus sampai done tanpa berhenti bertanya; butuh-keputusan = berhenti di titik
// keputusan (klausa lama). Dipilih saat governor meluncurkan sesi; sesi manual tak memakainya.
export type Autonomy = "full-control" | "butuh-keputusan";

// SPEC-338 · ADR-0074 · mesin sesi. Cermin `zAgent` di @hanoman/shared (pola yang sama dipakai
// Flow/zFlow): zod untuk validasi di batas HTTP, union TS untuk lapis runner/server.
export type Agent = "claude" | "codex";

// SPEC-376 · ADR-0080 · scope verifikasi sesi. Cermin `zVerifyScope` di @hanoman/shared (pola
// yang sama dipakai Flow/zFlow dan Agent/zAgent).
export type VerifyScope = "changed" | "full";

// Backlog item yang dikerjakan sebuah sesi. Id-nya saja tak berarti apa-apa di dalam
// worktree yang masih segar (spec hidup di Postgres, bukan di repo), jadi ia harus
// dieja lengkap di dalam prompt awal.
export type SpecBrief = {
  id: string; title: string; source: string; priority: string;
  objective: string; payload?: unknown;
};

// SPEC-394 · keadaan yang HANYA diketahui server saat sebuah sesi backlog dilanjutkan. Dipisah
// dari SpecBrief karena isinya bukan properti backlog item melainkan properti peluncuran ini.
export type ResumeCtx = {
  /** Baris yang SUDAH tercatat di $HANOMAN_PHASE_FILE, apa adanya ("Audit done"/"Spec skipped"). */
  recorded: readonly string[];
  /** Fase pertama yang belum tercatat; undefined bila seluruh pipeline sudah tercatat. */
  next?: string;
  /** true = worktree sesi sebelumnya dipakai apa adanya (kerja belum-commit masih ada);
   *  false = worktree dibangun ulang dari tip branch sesi (hanya commit yang selamat). */
  worktreeKept: boolean;
};

// Identitas project untuk sesi project-level (reverse): tak ada backlog item, jadi
// konteksnya diambil dari baris Project (SPEC-166).
export type ProjectBrief = { id: string; name: string; desc: string; stack: string };

// SPEC-210 · brief awal PRD (sesi prd project-level). Disisipkan ke prompt sesi.
export type PrdBrief = { title: string; context: string; outcome: string; constraints?: string };
// SPEC-340 · ADR-0076 · dokumen audit yang disematkan ke prompt sesi PRD hasil eskalasi audit.
// Isinya disematkan (bukan sekadar path) supaya prompt self-contained — cermin BreakdownPrd.
export type AuditDoc = { id: string; path: string; content: string };

// SPEC-273 · PRD yang dipecah sesi breakdown. content = isi PRD tersemat langsung ke prompt,
// jadi breakdown lepas dari status merge PRD (tak perlu PRD sudah ada di default branch).
export type BreakdownPrd = { title: string; path: string; content: string };

export interface GitOps {
  /** Mengembalikan baseSha — commit tempat worktree ini lahir. */
  addWorktree(repo: string, path: string, branchFrom: string): string;
  removeWorktree(repo: string, path: string): void;
  /** SPEC-742 · ADR-0116 · bebaskan path worktree dalam waktu O(1) dengan MEMINDAHKANNYA ke
   *  `<repo>/.worktrees/.trash/<basename>.<stempel>`; byte-nya dihapus penyapu latar. Mengembalikan
   *  path trash-nya, atau `null` bila tak ada yang dipindah (path absen, atau sudah di dalam trash —
   *  penutupan ganda karena itu idempoten). MELEMPAR bila pemindahannya mustahil: pemanggil jatuh
   *  ke `removeWorktree` yang sinkron, tak pernah ke penghapusan latar atas path aslinya. */
  trashWorktree(repo: string, path: string): string | null;
  /** HEAD worktree sekarang — dibaca sebelum removeWorktree untuk simpan headSha (SPEC-176). */
  headSha(worktree: string): string;
  /** Menyiapkan repo siap-worktree untuk project from-scratch: git init + satu commit
   *  bila belum ada HEAD. Idempoten; membuat direktori bila belum ada (SPEC-222). */
  initRepo(dir: string): void;
  /** SPEC-394 · true hanya bila `path` adalah AKAR sebuah worktree git yang masih bisa dipakai.
   *  Bukan `existsSync`: direktori telanjang di dalam repo pun "ada", dan worktree yang gitdir-nya
   *  sudah dipangkas tetap menyisakan direktori. Murni-baca. */
  worktreeAlive(path: string): boolean;
  /** SPEC-394 · resolve rev secara LITERAL (tanpa DWIM `origin/` milik addWorktree) — `null` bila
   *  tak resolve, tak pernah melempar. Dipakai memilih basis worktree saat sesi dilanjutkan. */
  revParse(repo: string, rev: string): string | null;
  /** SPEC-447 · apakah `sha` sudah ada di dalam `ref` (dependency backlog sudah ter-merge)?
   *  Murni-baca, TAK PERNAH melempar: ref/sha tak resolve, repo tak terbaca, atau exit di luar
   *  0|1 → `false`. Fail-closed disengaja — "tak bisa dipastikan" bukan "aman". */
  isAncestor(repo: string, sha: string, ref: string): boolean;
}
