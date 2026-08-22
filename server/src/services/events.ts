import type { Client } from "./pty";
import { listSessionsAsync } from "./pty";
import { liveSpecs } from "./live-specs";
import { notificationsFeed } from "./notifications";
import { getLimits } from "./limits";
import { getCodexLimits } from "./codex-limits";
import { getUpdateStatus } from "./update";
import { isDeciding } from "./lead/deciding";
import { listCleanups } from "./worktree-reaper";
import { prisma } from "../db";
import { effectiveInt } from "../config";
import { subKey, type EventMsg, type EventTopic } from "@hanoman/shared";
import { TOPICS, TOPIC_NAMES, isTopic, parseParams } from "./events-topics";

// SPEC-199 · satu WebSocket siar untuk seluruh data real-time dashboard (ADR-0039). Meniru
// pola siar services/pty.ts: satu Set klien, satu loop ref-counted, frame lahir hanya saat
// isinya berubah. Sumber (tmux/berkas/DB) poll-only — server yang men-poll, klien didorong.
//
// Badan frame tetap longgar di sisi server: build memakai baris Prisma (tanggal Date) yang JSON
// serialize jadi string sesuai wire type. Sama persis konvensi route lain yang mengembalikan baris
// Prisma mentah.
// SPEC-908 · yang TIDAK lagi longgar adalah `t`-nya. Dulu `{ t: string; … }`, sehingga `t` salah
// ketik lolos typecheck server lalu jatuh senyap di klien (`m.t === …` tak pernah cocok) — dan
// migrasi ini menambah enam varian di bawah tipe yang sama.
type WireMsg = { t: EventMsg["t"] } & Record<string, unknown>;

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
    // Asinkron: grup ini di-recompute tiap detik, dan `execFileSync` tmux memblokir seluruh event
    // loop — termasuk frame ketikan terminal — selama spawn (terukur sampai 916 ms saat mesin sibuk).
    sessions: (await listSessionsAsync()).map((s) => (isDeciding(s.id) ? { ...s, deciding: true } : s)),
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

// SPEC-908 · langganan BERPARAMETER, mengamandemen ADR-0039. Berkunci `subKey(topic, params)`
// yang dihitung fungsi yang SAMA di klien, sehingga N klien berparameter identik berbagi satu
// entri: satu build, satu JSON.stringify, satu dedup signature.
type SubEntry = {
  topic: EventTopic;
  params: unknown;
  key: string;
  subscribers: Set<Client>;
  tick: number;
  last: string;
  inflight: boolean;
  failing?: boolean;
};
const entries = new Map<string, SubEntry>();

function sendTo(c: Client, s: string): void {
  try { c.send(s); } catch { clients.delete(c); dropClientSubs(c); }
}

function dropClientSubs(c: Client): void {
  for (const [key, e] of entries) {
    if (!e.subscribers.delete(c)) continue;
    if (e.subscribers.size === 0) entries.delete(key);
  }
}

// Satu recompute untuk SEMUA pelanggan entri ini. TIDAK PERNAH di-await oleh __tick: satu
// `git log` lambat tak boleh menunda grup `sessions`/`specs` yang berkadens 1 dtk — event loop
// yang sama melayani PTY terminal (pelajaran terukur SPEC-479/812).
async function runEntry(e: SubEntry): Promise<void> {
  if (e.inflight) return;
  e.inflight = true;
  try {
    const body = await (TOPICS[e.topic].build as (p: unknown) => Promise<object>)(e.params);
    if (e.failing) { e.failing = false; console.log(`siar langganan pulih: ${e.key}`); }
    const s = JSON.stringify({ t: e.topic, key: e.key, ...body });
    if (s === e.last) return;
    e.last = s;
    for (const c of e.subscribers) sendTo(c, s);
  } catch (err) {
    // Frame lama SENGAJA tak dihapus: klien tak boleh di-blank karena satu build gagal.
    if (!e.failing) { e.failing = true; console.error(`siar langganan gagal membangun ${e.key}:`, err); }
  } finally { e.inflight = false; }
}

// Ganti-penuh: satu frame `sub` mengganti SELURUH himpunan langganan klien. Karena itu tak ada
// frame `unsubscribe` yang bisa hilang, dan re-kirim saat reconnect identik dengan pemasangan
// pertama (idempoten by construction).
export function subscribeClient(c: Client, subs: { topic: string; params: unknown }[]): void {
  const wanted = new Set<string>();
  for (const s of subs) {
    if (!isTopic(s.topic)) continue;                 // ADR-0087 · dashboard boleh lebih baru
    const params = parseParams(s.topic, s.params);
    if (params === undefined) continue;              // entri cacat dibuang, frame-nya tidak
    const key = subKey(s.topic, params as Record<string, unknown>);
    wanted.add(key);
    let e = entries.get(key);
    if (!e) {
      e = { topic: s.topic, params, key, subscribers: new Set(), tick: 0, last: "", inflight: false };
      entries.set(key, e);
    }
    if (e.subscribers.has(c)) continue;
    e.subscribers.add(c);
    // Muatan pertama SEGERA: dari cache bila entri sudah punya (nol biaya), atau satu build di
    // luar jadwal bila belum. Tanpa ini, kembali dari tab tersembunyi — socket ditutup atas
    // permintaan kita sendiri, api/events.ts:77 — berarti layar diam sampai tick berikutnya.
    if (e.last) sendTo(c, e.last);
    else void runEntry(e);
  }
  for (const [key, e] of entries) {
    if (wanted.has(key) || !e.subscribers.has(c)) continue;
    e.subscribers.delete(c);
    if (e.subscribers.size === 0) entries.delete(key);
  }
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
    // SPEC-908 · entri langganan ditick di loop yang sama tetapi TIDAK di-await (lihat runEntry).
    for (const e of entries.values()) {
      e.tick++;
      if (e.tick % TOPICS[e.topic].everyTicks !== 0) continue;
      void runEntry(e);
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
  // SPEC-908 · advertensi kemampuan, dikirim PALING DULU. Server lama tak mengirim frame ini sama
  // sekali — ketiadaannya itulah sinyal yang dipakai klien untuk tetap men-poll HTTP (ADR-0087).
  try { c.send(JSON.stringify({ t: "hello", topics: TOPIC_NAMES } satisfies EventMsg)); } catch { return; }
  for (const g of GROUPS) {
    let msg: WireMsg;
    try { msg = await g.build(); } catch { continue; }
    try { c.send(JSON.stringify(msg)); } catch { return; }
  }
}

export function detach(c: Client): void {
  clients.delete(c);
  dropClientSubs(c);
  if (clients.size === 0) stopLoop();
}

// Test-only: kosongkan klien + hentikan loop + reset signature.
export function __reset(): void { clients.clear(); entries.clear(); stopLoop(); }
