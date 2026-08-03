import { z } from "zod";

// SPEC-520 · status PRD adalah NILAI TURUNAN dari backlog yang lahir darinya, bukan kolom.
// PRD sendiri bukan entitas DB (ADR-0041) — tak ada tempat menyimpannya sekalipun kita mau —
// dan relasi yang sudah ada memang cukup menentukan (ADR-0018/0019: turunkan bila bisa dihitung
// ulang dari sumber lain; cermin `ticket-status.ts` SPEC-293).
//
//   draft      = belum ada satu pun backlog turunan → masih perlu ditindaklanjuti
//   dieskalasi = ada turunan, belum semuanya `done`
//   terwujud   = ada turunan dan SEMUANYA `done` → bukan pekerjaan siapa pun lagi
export const PRD_STATUSES = ["draft", "dieskalasi", "terwujud"] as const;
export const zPrdStatus = z.enum(PRD_STATUSES);
export type PrdStatus = (typeof PRD_STATUSES)[number];

// Baris `Spec` seperlunya. Sengaja BUKAN tipe Prisma: `shared` tak boleh tahu DB, dan `payload`
// memang `Json?` sehingga null / bentuk qa / bentuk lama semuanya sah dan tak boleh melempar.
export type PrdSpecTrace = { stage: string; payload: unknown; branchFrom: string | null };

const PRD_DIR = "docs/prd/";

// docs/prd/<slug>.md → prd/<slug>, branch yang dibuat sesi prd (SPEC-244). null bila bukan PRD.
export function prdBranchFor(prdPath: string): string | null {
  if (!prdPath.startsWith(PRD_DIR) || !prdPath.endsWith(".md")) return null;
  const slug = prdPath.slice(PRD_DIR.length, -3);
  return slug ? `prd/${slug}` : null;
}

// Nilai payload yang bisa memuat path PRD. Ketiga jalur eskalasi menulis salah satunya:
//   take → brief : context = "Dari PRD: <path>"                        (PrdScreen)
//   take → goal  : goal    = "Wujudkan PRD <path>"                     (ADR-0089)
//   breakdown    : context = "Dari PRD (breakdown): <path>\n\n…"       (ADR-0069, routes/specs.ts)
function payloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const p = payload as Record<string, unknown>;
  return [p.context, p.goal].filter((v): v is string => typeof v === "string").join("\n");
}

// DUA kunci.
// K1 — path PRD **utuh** muncul di payload. Utuh, bukan kata "PRD": di DB nyata SPEC-244/273/407
//      menyebut "PRD" di prosanya tanpa path apa pun, dan pencocokan berbasis kata akan
//      menempelkan ketiganya ke PRD acak. Akhiran `.md` sekaligus membuat slug berawalan sama tak
//      saling cocok (`docs/prd/auth.md` bukan substring `docs/prd/auth-device.md`).
// K2 — `branchFrom` = branch PRD-nya. Terukur nol tambahan hari ini (jalur take-single selalu
//      menulis K1 sekaligus), tetap dipasang karena backlog yang dibuat manual dari branch PRD
//      adalah turunan PRD itu juga dan hanya K2 yang melihatnya.
export function specDerivesFromPrd(spec: PrdSpecTrace, prdPath: string): boolean {
  const branch = prdBranchFor(prdPath);
  if (!branch) return false;                     // bukan PRD → tak pernah punya turunan
  if (spec.branchFrom === branch) return true;
  return payloadText(spec.payload).includes(prdPath);
}

export type PrdStatusResult = { status: PrdStatus; specCount: number; doneCount: number };

// `specs` WAJIB sudah disaring ke project PRD-nya oleh pemanggil: dua project boleh punya
// `docs/prd/<slug>.md` bernama sama, dan tanpa penyaringan itu keduanya saling mewarnai.
export function prdStatusOf(prdPath: string, specs: readonly PrdSpecTrace[]): PrdStatusResult {
  const derived = specs.filter((s) => specDerivesFromPrd(s, prdPath));
  const specCount = derived.length;
  const doneCount = derived.filter((s) => s.stage === "done").length;
  const status: PrdStatus =
    specCount === 0 ? "draft" : doneCount === specCount ? "terwujud" : "dieskalasi";
  return { status, specCount, doneCount };
}
