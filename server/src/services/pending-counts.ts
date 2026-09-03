import { EMPTY_PENDING, OPEN_LEAD_FLOW_STATUSES, type PendingCounts } from "@hanoman/shared";
import { prisma } from "../db";
import { listAllPrds } from "./project-prds";

// SPEC-961 · berapa yang masih menunggu pengajuan operator, untuk badge sidebar. Definisi tiap
// angka ada di `shared/src/pending.ts`; di sini hanya cara membacanya dari sumbernya.
//
// Tiga dari empat angka adalah `count()` DB — sepele, dan `where`-nya sudah ter-index
// (`Ticket@@index([projectId, createdAt])`, `GithubIssue@@index([projectId, status])`,
// `LeadFlow@@index([status])`). Yang keempat TIDAK: PRD bukan entitas DB (ADR-0041), jadi
// menghitungnya berarti menyusuri berkas tiap project + membaca isinya. Karena itu ia satu-satunya
// yang di-cache.

// PRD ber-cache 60 dtk. Grup siarnya berdetak tiap 5 dtk (events.ts), jadi tanpa pagar ini satu tab
// dashboard yang terbuka = `listAllPrds()` 12× semenit selamanya: walk repo + `readFileSync` per PRD
// per project, SINKRON, di event loop yang sama yang melayani PTY terminal (kelas regresi yang
// diukur SPEC-812/878 dan yang membuat `runEntry` tak pernah di-await). PRD baru karena itu muncul
// di badge paling lambat semenit kemudian — harga yang sepadan: PRD lahir dari sesi yang berjalan
// menit-menitan, bukan dari klik.
const PRD_TTL_MS = 60_000;
let prdCache: { at: number; count: number } | null = null;

// Sumber PRD disuntik, bukan di-mock: `listAllPrds` diimpor statis, dan menukarnya lewat
// `vi.spyOn` di sisi test hanya mengganti properti namespace — pemanggil di sini tetap memegang
// binding aslinya (kelas gagal-senyap yang sudah pernah dibayar repo ini).
export type PrdLister = typeof listAllPrds;

async function prdDraftCount(now: number, prds: PrdLister): Promise<number> {
  if (prdCache && now - prdCache.at < PRD_TTL_MS) return prdCache.count;
  try {
    const count = (await prds()).filter((p) => p.status === "draft").length;
    prdCache = { at: now, count };
  } catch {
    // Project yang repoDir-nya hilang/tak terbaca tak boleh menjatuhkan SELURUH frame — tiga angka
    // lainnya masih sah. Stempel tetap dimajukan supaya kegagalan tak berubah jadi retry tiap tick;
    // nilai terakhir yang diketahui dipertahankan (0 pada kegagalan pertama).
    prdCache = { at: now, count: prdCache?.count ?? 0 };
  }
  return prdCache.count;
}

/** Test-only: lupakan cache PRD supaya kasus berikutnya membaca disk lagi. */
export function __resetPendingCache(): void { prdCache = null; }

export async function pendingCounts(now = Date.now(), prds: PrdLister = listAllPrds): Promise<PendingCounts> {
  const [tickets, issues, backlog, lead, prd] = await Promise.all([
    prisma.ticket.count({ where: { status: "new" } }),
    prisma.githubIssue.count({ where: { status: "new" } }),
    // `startedAt` = kapan sesi PERTAMA lahir (ADR-0090), null = belum pernah dikerjakan. Stage
    // `done` dikecualikan karena item bisa ditandai selesai manual tanpa sesi (SPEC-804/ADR-0120) —
    // tanpa gerbang itu ia terhitung selamanya sebagai pekerjaan yang belum diajukan.
    prisma.spec.count({ where: { startedAt: null, stage: { not: "done" } } }),
    prisma.leadFlow.count({ where: { status: { in: [...OPEN_LEAD_FLOW_STATUSES] } } }),
    prdDraftCount(now, prds),
  ]);
  return { ...EMPTY_PENDING, triage: tickets + issues, backlog, prd, lead };
}
