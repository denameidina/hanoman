import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveHome } from "@hanoman/runner";
import { prisma } from "../db";

// ADR-0192 · gerbang "agen tak boleh menjawab dialog sesinya sendiri".
//
// `sessions:decide` (ADR-0190) menjawab "token mana yang BOLEH memutuskan". Berkas ini menjawab
// pertanyaan kedua yang tak bisa dijawab capability: "boleh memutuskan UNTUK sesi yang mana".
// Token yang sama bisa duduk di dua tempat sekaligus — di klien MCP milik manusia, dan di
// konfigurasi `claude` yang dipakai sesi hanoman itu sendiri (konfigurasi tingkat-user diwarisi
// setiap sesi). Capability mengikuti TOKEN, bukan pemanggilnya, jadi tanpa gerbang ini token yang
// sama membiarkan sesi menjawab pertanyaannya sendiri.
//
// BATAS YANG DINYATAKAN APA ADANYA: server tak bisa MEMBUKTIKAN siapa di balik sebuah request
// Bearer. Sesi tidak menerima agent token dari hanoman (hanya `HANOMAN_EVENT_TOKEN` turunan, yang
// tak pernah diterima gerbang agent token — 401), jadi tak ada ikatan token↔sesi di sisi server
// untuk diperiksa. Yang bisa ditegakkan adalah TIGA bukti, masing-masing menutup satu jalan:
//   1. peluncur   — token yang MELUNCURKAN sesi (REST/MCP `POST /terminal/sessions`) dicatat, dan
//                   ditolak memutuskan sesi itu. Tahan restart (berkas) dan tak butuh skema DB.
//   2. approver   — `Spec.launchApprovedBy = agent:<id>` untuk sesi yang lahir sebelum pencatatan
//                   (1) ada; kolomnya sudah ada.
//   3. di-dalam-sesi — proses MCP yang berjalan di dalam sesi hanoman mengirim `x-hanoman-session`
//                   (dari `HANOMAN_SESSION_ID` yang diwarisi). Header itu ada ⇒ pemanggil adalah
//                   agen di dalam sebuah sesi ⇒ ditolak untuk SEMUA sesi, bukan hanya miliknya.
// (3) bisa dihindari oleh klien yang sengaja melepas header-nya (curl dengan token yang sama). Itu
// bukan lubang yang bisa ditutup server; yang menutupnya adalah praktik yang dijelaskan di ADR-0192:
// token ber-`sessions:decide` tak boleh dipasang di konfigurasi yang dibaca sesi hanoman.

export const SESSION_HEADER = "x-hanoman-session";

export type DecisionRefusal = {
  reason: "self" | "in-session" | "launcher";
  error: string;
};

const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;
const launchers = new Map<string, Set<string>>();
const STALE_MS = 30 * 24 * 60 * 60_000;

const launcherDir = (env: NodeJS.ProcessEnv = process.env): string =>
  join(resolveHome(env), "session-launchers");

/** Catat token yang meluncurkan (atau MENYAMBUNG) sesi. Himpunan, bukan satu nilai: token kedua
    yang menyambung sesi milik token pertama tak boleh membebaskan token pertama — keduanya
    pernah menggerakkan sesi itu. Gagal menulis TIDAK menggagalkan peluncuran: gerbang ini lapis
    tambahan, dan sesi yang sudah lahir tak boleh mati karena disk penuh. */
export function recordLauncher(sessionId: string, agentId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!SAFE_ID.test(sessionId)) return;
  const known = launchersFor(sessionId, env);
  known.add(agentId);
  try {
    const dir = launcherDir(env);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, sessionId), [...known].join("\n"), { mode: 0o600 });
    // Sesi yang mati tak punya hook pembersih di sini; berkas tua dipangkas oportunistik. Isinya
    // id token, bukan rahasia, jadi sisa berkas tak bocor apa pun — hanya membengkak pelan.
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      try { if (now - statSync(join(dir, f)).mtimeMs > STALE_MS) rmSync(join(dir, f), { force: true }); }
      catch { /* berkas tetangga yang hilang di tengah jalan */ }
    }
  } catch { /* lihat komentar fungsi */ }
}

function launchersFor(sessionId: string, env: NodeJS.ProcessEnv): Set<string> {
  const hot = launchers.get(sessionId);
  if (hot) return hot;
  const ids = new Set<string>();
  try {
    for (const l of readFileSync(join(launcherDir(env), sessionId), "utf8").split("\n")) if (l.trim()) ids.add(l.trim());
  } catch { /* tak tercatat */ }
  launchers.set(sessionId, ids);
  return ids;
}

export function launchedBy(sessionId: string, agentId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return SAFE_ID.test(sessionId) && launchersFor(sessionId, env).has(agentId);
}

const headerValue = (h: string | string[] | undefined): string =>
  (Array.isArray(h) ? h[0] : h)?.trim() ?? "";

/**
 * `null` = boleh. Hanya dipanggil untuk principal AGEN; cookie (manusia) dan relay (operator hub)
 * tak melewati sini.
 */
export async function refuseSelfDecision(input: {
  agentId: string;
  sessionId: string;
  specId?: string;
  header: string | string[] | undefined;
}): Promise<DecisionRefusal | null> {
  const claimed = headerValue(input.header);
  if (claimed) {
    return claimed === input.sessionId
      ? { reason: "self", error: "agen tak boleh memutuskan dialog sesinya sendiri" }
      : {
        reason: "in-session",
        error: "panggilan ini datang dari dalam sebuah sesi hanoman — agen di dalam sesi tak boleh memutuskan dialog; pakai token terpisah di luar sesi, atau serahkan ke manusia",
      };
  }
  if (launchedBy(input.sessionId, input.agentId))
    return { reason: "launcher", error: "token ini yang meluncurkan sesi tersebut — agen tak boleh menjawab pertanyaan sesi yang ia luncurkan sendiri" };
  if (input.specId) {
    const spec = await prisma.spec.findUnique({ where: { id: input.specId }, select: { launchApprovedBy: true } });
    if (spec?.launchApprovedBy === `agent:${input.agentId}`)
      return { reason: "launcher", error: "token ini yang menyetujui peluncuran backlog sesi tersebut — agen tak boleh menjawab pertanyaan sesi yang ia luncurkan sendiri" };
  }
  return null;
}

/** Test-only. */
export function __resetLaunchers(): void { launchers.clear(); }
