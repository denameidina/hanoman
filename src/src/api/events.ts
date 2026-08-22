import { paths, subKey, MAX_SUBS, type EventMsg, type EventTopic, type TopicParams } from "@hanoman/shared";
import { api } from "./client";

// SPEC-199 · satu koneksi WS dibagi semua consumer (ref-count, pola api/limits.ts). Server
// mendorong frame per-grup; tiap consumer filter berdasarkan msg.t. Reconnect backoff +
// tutup saat tab hidden (server kirim snapshot penuh tiap connect → state re-sync sendiri).
const subs = new Set<(m: EventMsg) => void>();
let ws: WebSocket | undefined;
let backoff = 500;
let intentionalClose = false;
let opening = false;

// SPEC-897 · status koneksi diturunkan dari socket yang SAMA — tanpa channel, endpoint, atau poll
// baru (ADR-0039). `connected` menyala pada FRAME PERTAMA, bukan pada `onopen`: socket terbuka
// adalah fakta transport, bukan fakta pengiriman (pelajaran terukur SPEC-878/ADR-0134). `paused`
// terpisah karena tab hidden menutup socket dengan SENGAJA — menyebutnya gangguan berarti tiap
// kembali dari tab lain memudarkan pet.
export type EventsStatus = { connected: boolean; since: number; paused: boolean };

const statusSubs = new Set<(s: EventsStatus) => void>();
let status: EventsStatus = {
  connected: false, since: Date.now(),
  paused: typeof document !== "undefined" && document.hidden,
};

function setStatus(next: Partial<EventsStatus>): void {
  const merged = { ...status, ...next };
  if (merged.connected === status.connected && merged.since === status.since
    && merged.paused === status.paused) return;
  status = merged;
  for (const s of statusSubs) s(status);
}

export const eventsStatus = (): EventsStatus => status;

// Pengamat murni: TIDAK membuka socket. Yang membuka tetap `subscribe`, dan App sudah
// memanggilnya untuk `specs`/`sessions` (plus NotificationsContext).
export function subscribeStatus(handler: (s: EventsStatus) => void): () => void {
  statusSubs.add(handler);
  return () => { statusSubs.delete(handler); };
}

// SPEC-908 · langganan BERPARAMETER di atas socket yang SAMA — tanpa koneksi kedua, karena kuota
// MAX_CONNECTIONS_PER_PRINCIPAL = 8 tak boleh naik (services/ws-admission.ts). Server menjawab
// dengan frame ber-`key` = subKey(topic, params), dihitung fungsi yang sama di sini.
type Sub = { topic: EventTopic; params: Record<string, unknown>; refs: number };
const topicSubs = new Map<string, Sub>();
let subsDirty = false;
// Keterbukaan socket dilacak sendiri, bukan lewat `WebSocket.OPEN`: test mengganti global
// `WebSocket` dengan palsu yang tak punya konstanta statiknya.
let wsOpen = false;

// Frame terakhir yang benar-benar diantar socket. `null` = socket belum pernah mengantar apa pun —
// dipakai `useLiveTopic` untuk mengenali WS yang terhalang proxy (socket terbuka ≠ fakta
// pengiriman, pelajaran terukur SPEC-878/ADR-0134).
let lastFrameAt: number | null = null;
export const eventsSilentSince = (): number | null => lastFrameAt;

// Daftar topik yang didukung server, dari frame `hello`. Server lama tak mengirimnya sama sekali —
// ketiadaannya itulah sinyal degradasi (ADR-0087). SENGAJA tak dikosongkan saat socket tertutup:
// server yang sama akan mengirim `hello` lagi saat reconnect, dan mengosongkannya di antara
// menyalakan fallback poll tanpa sebab.
let topics: EventTopic[] = [];
// Daftar KOSONG adalah jawaban yang sah — server memberikannya kepada koneksi yang tak boleh
// berlangganan. Tanpa bit terpisah, "hello tiba tapi kosong" tak bisa dibedakan dari "belum ada
// hello", dan fallback poll tak pernah menyala.
let helloSeen = false;
const topicsSubs = new Set<(t: EventTopic[]) => void>();
export const eventsTopics = (): EventTopic[] => topics;
export const eventsHelloSeen = (): boolean => helloSeen;
export function subscribeTopics(cb: (t: EventTopic[]) => void): () => void {
  topicsSubs.add(cb);
  return () => { topicsSubs.delete(cb); };
}

// Empat QueueSection yang mount dalam satu render = SATU frame, bukan empat.
function flushSubs(): void {
  subsDirty = false;
  if (!ws || !wsOpen) return;
  // Plafon ditegakkan di sini juga, bukan hanya di zod server: frame yang melewatinya GAGAL
  // parse seutuhnya dan dibuang senyap, server menahan himpunan lama, dan karena `hello` sudah
  // menyatakan topiknya didukung, fallback poll tetap mati — SEMUA layar realtime membeku
  // sekaligus. Memotong ekornya membuat sebagian besar tetap hidup.
  const subs = [...topicSubs.values()].slice(0, MAX_SUBS)
    .map((s) => ({ topic: s.topic, params: s.params }));
  try { ws.send(JSON.stringify({ t: "sub", subs })); } catch { /* onclose yang menangani */ }
}
function markSubsDirty(): void {
  if (subsDirty) return;
  subsDirty = true;
  queueMicrotask(flushSubs);
}

export function subscribeTopic<T extends EventTopic>(
  topic: T, params: TopicParams[T], onData: (m: Extract<EventMsg, { t: T }>) => void,
): () => void {
  const key = subKey(topic, params as Record<string, unknown>);
  let s = topicSubs.get(key);
  if (!s) { s = { topic, params: params as Record<string, unknown>, refs: 0 }; topicSubs.set(key, s); }
  s.refs++;
  markSubsDirty();
  // Socket dibuka & ditutup oleh ref-count yang SAMA dengan consumer grup global. Tiap pemanggil
  // memasang listener-nya SENDIRI: kalau listener ini mengiterasi himpunan handler bersama, dua
  // consumer pada kunci yang sama menerima tiap frame dua kali (N listener × N handler).
  const offFrames = subscribe((m) => {
    if (m.t !== topic) return;
    if ((m as { key?: string }).key !== key) return;   // frame halaman lain tak boleh mendarat
    onData(m as Extract<EventMsg, { t: T }>);
  });
  return () => {
    offFrames();
    const cur = topicSubs.get(key);
    if (cur && --cur.refs <= 0) topicSubs.delete(key);
    markSubsDirty();
  };
}

async function open(): Promise<void> {
  if (ws || opening || (typeof document !== "undefined" && document.hidden)) return;
  opening = true;
  intentionalClose = false;
  let ticket: string;
  try { ({ ticket } = await api.issueWsTicket("events")); }
  catch { opening = false; scheduleReconnect(); return; }
  if (intentionalClose || !subs.size) { opening = false; return; }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}${paths.eventsWs}`, [`hanoman-ticket.${ticket}`]);
  opening = false;
  ws.onopen = () => { backoff = 500; wsOpen = true; flushSubs(); };
  ws.onmessage = (ev) => {
    let m: EventMsg;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    lastFrameAt = Date.now();
    if (!status.connected) setStatus({ connected: true, since: Date.now() });
    if (m.t === "hello") {
      topics = m.topics;
      helloSeen = true;
      for (const cb of topicsSubs) cb(topics);
    }
    for (const s of subs) s(m);
  };
  ws.onclose = () => {
    ws = undefined;
    wsOpen = false;
    if (status.connected) setStatus({ connected: false, since: Date.now() });
    scheduleReconnect();
  };
  ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
}

function scheduleReconnect(): void {
  if (intentionalClose || !subs.size) return;
  setTimeout(() => { if (subs.size) void open(); }, backoff);
  backoff = Math.min(backoff * 2, 10_000);
}

function close(): void { intentionalClose = true; try { ws?.close(); } catch { /* noop */ } ws = undefined; wsOpen = false; }

function onVisibility(): void {
  if (document.hidden) {
    // `paused` dulu, baru tutup: onclose yang menyusul harus sudah membawa paused = true.
    setStatus({ paused: true });
    close();
  } else {
    setStatus(status.connected ? { paused: false } : { paused: false, since: Date.now() });
    if (subs.size) void open();
  }
}

export function subscribe(handler: (m: EventMsg) => void): () => void {
  subs.add(handler);
  if (subs.size === 1) {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    void open();
  }
  return () => {
    subs.delete(handler);
    if (subs.size === 0) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      close();
    }
  };
}
