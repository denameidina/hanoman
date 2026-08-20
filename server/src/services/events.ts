import type { Client } from "./pty";
import { listSessions } from "./pty";
import { liveSpecs } from "./live-specs";
import { notificationsFeed } from "./notifications";
import { getLimits } from "./limits";
import { getCodexLimits } from "./codex-limits";
import { getUpdateStatus } from "./update";
import { isDeciding } from "./lead/deciding";
import { listCleanups } from "./worktree-reaper";
import { prisma } from "../db";
import { effectiveInt } from "../config";

// SPEC-199 · satu WebSocket siar untuk seluruh data real-time dashboard (ADR-0039). Meniru
// pola siar services/pty.ts: satu Set klien, satu loop ref-counted, frame lahir hanya saat
// isinya berubah. Sumber (tmux/berkas/DB) poll-only — server yang men-poll, klien didorong.
//
// Tipe frame di-longgar (bukan shared EventMsg) di sisi server: build memakai baris Prisma
// (tanggal Date) yang JSON serialize jadi string sesuai wire type. Klien-lah yang menegakkan
// `EventMsg`. Sama persis konvensi route lain yang mengembalikan baris Prisma mentah.
type WireMsg = { t: string; [k: string]: unknown };

const clients = new Set<Client>();
// SPEC-215 · dibaca per-pakai (cfg live). Test menurunkan tick agar cepat; prod 1s. Loop cuma jalan saat ada klien.
const tickMs = () => effectiveInt("HANOMAN_EVENTS_TICK_MS") ?? 1000;

// SPEC-857 · ADR-0131 · `failing` menggerbangi log agar kegagalan build TERLIHAT tanpa membanjiri
// journal: grup `specs` di-recompute tiap detik, jadi hub yang tercekik `P1008 Socket timeout`
// dulu melahirkan `catch { continue; }` senyap 86.400 kali sehari — klien membeku pada snapshot
// terakhir tanpa satu pun jejak kenapa. Dicatat sekali saat mulai gagal, sekali saat pulih.
type Group = { everyTicks: number; last: string; build: () => Promise<WireMsg>; failing?: boolean };
// everyTicks = recompute tiap N detik: board 1s, notif 3s, vps 15s, limits 30s (cache 30s service).
const GROUPS: Group[] = [
  // SPEC-409 · ADR-0091 · AC-3 · `deciding` menandai sesi yang sedang DISUSUN keputusannya oleh
  // hanoman-lead. Tanpa penanda ini sesi yang justru sedang dilayani terbaca persis seperti sesi
  // yang mandek — bentuknya sama: diam, marker keputusan terisi. Dihias DI SINI, bukan di pty.ts:
  // service itu sengaja tak tahu apa-apa soal lead maupun DB.
  { everyTicks: 1,  last: "", build: async () => ({
    t: "sessions",
    sessions: listSessions().map((s) => (isDeciding(s.id) ? { ...s, deciding: true } : s)),
  }) },
  { everyTicks: 1,  last: "", build: async () => ({ t: "specs", specs: await liveSpecs() }) },
  { everyTicks: 3,  last: "", build: async () => ({ t: "notifications", ...(await notificationsFeed()) }) },
  // SPEC-742 · ADR-0116 · pembersihan worktree yang masih jalan. `listCleanups()` membaca peta di
  // memori, bukan disk — nol I/O per tick, dan dedup signature membuat frame lahir hanya saat
  // daftarnya berubah (nyaris selalu kosong).
  { everyTicks: 3,  last: "", build: async () => ({ t: "cleanups", cleanups: listCleanups() }) },
  // ponytail: cermin GET /vps (orderBy createdAt asc). Query sepele — tak diekstrak.
  { everyTicks: 15, last: "", build: async () => ({ t: "vps", vps: await prisma.vps.findMany({ orderBy: { createdAt: "asc" } }) }) },
  { everyTicks: 30, last: "", build: async () => ({ t: "limits", limits: await getLimits() }) },
  // SPEC-338 · ADR-0074 · limit codex — grup TERPISAH dari `limits`. Bacaan berkas lokal berbatas
  // ekor + cache 30s, jadi biayanya jauh di bawah panggilan jaringan claude. Frame lahir hanya saat
  // isinya berubah (dedup signature), dan snapshot codex baru bergerak saat ada sesi codex jalan.
  { everyTicks: 30, last: "", build: async () => ({ t: "codexLimits", limits: await getCodexLimits() }) },
  // SPEC-214 · deteksi update jarang berubah; recompute tiap 300 dtk, dedup signature → siar hanya
  // saat status berubah. getUpdateStatus cache 15s + fetch ter-gate (server.ts) → attach tak menahan.
  { everyTicks: 300, last: "", build: async () => ({ t: "update", update: await getUpdateStatus() }) },
];

function broadcast(msg: WireMsg): void {
  const s = JSON.stringify(msg);
  for (const c of clients) { try { c.send(s); } catch { clients.delete(c); } }
}

let tick = 0;
let busy = false;
let timer: NodeJS.Timeout | undefined;

// Satu iterasi: tiap grup yang jatuh temponya di-recompute; broadcast hanya saat signature berubah.
export async function __tick(): Promise<void> {
  if (busy) return;             // build bisa > TICK_MS (DB/tmux); jangan menumpuk
  busy = true;
  tick++;
  try {
    for (const g of GROUPS) {
      if (tick % g.everyTicks !== 0) continue;
      let msg: WireMsg;
      try { msg = await g.build(); }
      catch (e) {
        if (!g.failing) { g.failing = true; console.error("siar dashboard gagal membangun frame:", e); }
        continue;
      }
      if (g.failing) { g.failing = false; console.log(`siar dashboard pulih: ${msg.t}`); }
      const sig = JSON.stringify(msg);
      if (sig === g.last) continue;
      g.last = sig;
      broadcast(msg);
    }
  } finally { busy = false; }
}

function startLoop(): void {
  if (timer) return;
  timer = setInterval(() => { void __tick(); }, tickMs());
  timer.unref();
}
function stopLoop(): void {
  if (timer) { clearInterval(timer); timer = undefined; }
  tick = 0;
  for (const g of GROUPS) g.last = "";   // klien berikut mulai dari state segar
}

// Klien baru dapat snapshot penuh SEGERA (tak menunggu tick) — late joiner langsung tersinkron,
// persis scrollback di pty.attach. Dibangun fresh, lepas dari dedup broadcast.
export async function attach(c: Client): Promise<void> {
  clients.add(c);
  startLoop();
  for (const g of GROUPS) {
    let msg: WireMsg;
    try { msg = await g.build(); } catch { continue; }
    try { c.send(JSON.stringify(msg)); } catch { return; }
  }
}

export function detach(c: Client): void {
  clients.delete(c);
  if (clients.size === 0) stopLoop();
}

// Test-only: kosongkan klien + hentikan loop + reset signature.
export function __reset(): void { clients.clear(); stopLoop(); }
