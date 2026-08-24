import type { Client } from "./pty";
import { listSessionsAsync } from "./pty";
import { liveSpecs } from "./live-specs";
import { notificationsFeed } from "./notifications";
import { getLimits } from "./limits";
import { getCodexLimits } from "./codex-limits";
import { getUpdateStatus } from "./update";
import { isDeciding } from "./lead/deciding";
import { liveAsks } from "./lead/ask";
import { listCleanups } from "./worktree-reaper";
import { presenceView } from "./presence/view";
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
  // SPEC-909 · ADR-0146 · pertanyaan sesi yang HIDUP, langsung dari payload hook agennya — bukan
  // dari scrape layar saat panel pet dibuka. Membaca peta di memori (`lead/ask.ts`): nol I/O, nol
  // tmux, nol DB per tick, dan dedup signature membuat frame lahir hanya saat daftarnya berubah
  // (nyaris selalu kosong). Grup SENDIRI, bukan hiasan di `sessions`: frame itu sudah yang terbesar
  // di dashboard dan pembacanya jauh lebih banyak daripada pembaca daftar pendek ini.
  { everyTicks: 1,  last: "", build: async () => ({ t: "leadAsks", asks: liveAsks() }) },
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
  // SPEC-919 · ADR-0147 · sesi hidup lintas device. 3 dtk: presence berdenyut 30 dtk, jadi kadens
  // lebih rapat hanya menambah build tanpa menambah informasi. `presenceView` menyegarkan sesi
  // mesin ini sendiri di dalamnya — satu `tmux list-panes` asinkron, tak menahan event loop.
  { everyTicks: 3, last: "", build: async () => ({ t: "presence", ...(await presenceView()) }) },
];

// SPEC-908 · klien yang `send`-nya melempar harus dilepas dari `clients` DAN dari peta langganan.
// Menyapu `clients` saja meninggalkan entri hidup untuk penonton yang sudah tak ada — dan entri
// `git` berarti `git log` + `git status` + `git stash list` tiap 4 dtk untuk nol pembaca.
function broadcast(msg: WireMsg): void {
  const s = JSON.stringify(msg);
  for (const c of clients) sendTo(c, s);
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

// SPEC-908 · dua pagar kerja, keduanya lahir dari review keamanan yang MENGUKUR jalurnya.
//
// (1) `MAX_INFLIGHT` membatasi berapa build boleh berjalan bersamaan di seluruh hub. `e.inflight`
// sendirian hanya men-dedup DI DALAM satu entri, dan entri baru selalu lahir `inflight:false` —
// terukur, 32 `buildGitLive` serentak (5 spawn git masing-masing) menahan event loop **505 ms**,
// event loop yang sama yang melayani PTY terminal (kelas regresi SPEC-812/878).
//
// (2) `IMMEDIATE_PER_MIN` membatasi build DI LUAR JADWAL per klien. Semantik ganti-penuh membuat
// tiap frame `sub` bisa memperkenalkan 16 kunci "baru" lagi, dan kuota 120 frame/menit karena itu
// terukur menjadi **1 920 build/menit dari satu socket** (≈160 fork `git`/dtk). Entri yang
// kehabisan jatah tidak hilang — ia hanya menunggu slot `everyTicks`-nya seperti entri lain.
const MAX_INFLIGHT = 4;
const IMMEDIATE_PER_MIN = 30;
let inflight = 0;

const immediateBudget = new WeakMap<Client, { left: number; resetAt: number }>();
function takeImmediate(c: Client, now = Date.now()): boolean {
  let b = immediateBudget.get(c);
  if (!b || now >= b.resetAt) { b = { left: IMMEDIATE_PER_MIN, resetAt: now + 60_000 }; immediateBudget.set(c, b); }
  if (b.left <= 0) return false;
  b.left--;
  return true;
}

// Satu recompute untuk SEMUA pelanggan entri ini. TIDAK PERNAH di-await oleh __tick: satu
// `git log` lambat tak boleh menunda grup `sessions`/`specs` yang berkadens 1 dtk — event loop
// yang sama melayani PTY terminal (pelajaran terukur SPEC-479/812).
async function runEntry(e: SubEntry): Promise<void> {
  if (e.inflight || inflight >= MAX_INFLIGHT) return;   // yang terlewat ikut tick berikutnya
  e.inflight = true;
  inflight++;
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
  } finally { e.inflight = false; inflight--; }
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
    // Muatan pertama SEGERA: dari cache bila entri sudah punya (NOL biaya, jadi tak memakai
    // jatah), atau satu build di luar jadwal bila belum. Tanpa ini, kembali dari tab tersembunyi —
    // socket ditutup atas permintaan kita sendiri, api/events.ts — berarti layar diam sampai tick
    // berikutnya. Yang kehabisan jatah tetap terpasang; ia cuma menunggu tick.
    if (e.last) sendTo(c, e.last);
    else if (takeImmediate(c)) void runEntry(e);
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
export async function attach(c: Client, o: { maySubscribe?: boolean } = {}): Promise<void> {
  clients.add(c);
  startLoop();
  // SPEC-908 · advertensi kemampuan, dikirim PALING DULU. Server lama tak mengirim frame ini sama
  // sekali — ketiadaannya itulah sinyal yang dipakai klien untuk tetap men-poll HTTP (ADR-0087).
  // Daftarnya per-KONEKSI, bukan per-server: principal yang frame `sub`-nya akan dibuang gerbang
  // `canSubscribeTopics` harus melihat daftar KOSONG, kalau tidak ia menyimpulkan "didukung" dan
  // tak pernah menyalakan fallback-nya — layar diam selamanya tanpa satu pun error.
  const topics = o.maySubscribe === false ? [] : TOPIC_NAMES;
  try { c.send(JSON.stringify({ t: "hello", topics } satisfies EventMsg)); } catch { return; }
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
export function __reset(): void { clients.clear(); entries.clear(); inflight = 0; stopLoop(); }
