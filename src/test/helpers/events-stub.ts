import { subKey, type EventMsg, type EventTopic } from "@hanoman/shared";

// SPEC-908 · stub `../src/api/events` yang dipakai bersama oleh test useLiveTopic dan keempat
// layar. Satu berkas, bukan lima stub yang berselisih: `vi.mock` di-hoist ke puncak berkas, jadi
// objeknya wajib modul-level dan reset-nya fungsi terpisah.

type Handler = (m: EventMsg) => void;
type Status = { connected: boolean; since: number; paused: boolean };

const state = {
  topics: [] as EventTopic[],
  topicsSubs: new Set<(t: EventTopic[]) => void>(),
  frameSubs: new Map<string, Set<Handler>>(),
  subs: [] as { key: string; topic: EventTopic; params: Record<string, unknown> }[],
  silentSince: null as number | null,
  status: { connected: true, since: 0, paused: false } as Status,
  statusSubs: new Set<(s: Status) => void>(),
};

export function resetEventsStub(): void {
  state.topics = [];
  state.topicsSubs.clear();
  state.frameSubs.clear();
  state.subs = [];
  state.silentSince = null;
  state.status = { connected: true, since: Date.now(), paused: false };
  state.statusSubs.clear();
}

/** Menyalakan frame `hello` — daftar topik yang "server" dalam test ini dukung. */
export function setTopics(t: EventTopic[]): void {
  state.topics = t;
  for (const cb of [...state.topicsSubs]) cb(t);
}

/** Mendorong satu frame langganan; hanya mendarat di pelanggan yang `key`-nya cocok. */
export function emitTopic(m: EventMsg & { key: string }): void {
  state.silentSince = Date.now();
  for (const h of [...(state.frameSubs.get(m.key) ?? [])]) h(m);
}

export function setStatus(s: Partial<Status>): void {
  state.status = { ...state.status, ...s };
  for (const cb of [...state.statusSubs]) cb(state.status);
}

export function setSilentSince(v: number | null): void { state.silentSince = v; }

/** Parameter langganan terakhir untuk sebuah topik — `undefined` bila tak ada. */
export function lastSubParams(topic: EventTopic): Record<string, unknown> | undefined {
  return [...state.subs].reverse().find((s) => s.topic === topic)?.params;
}

/** Semua langganan aktif untuk sebuah topik (mis. empat QueueSection). */
export function allSubs(topic: EventTopic): Record<string, unknown>[] {
  return state.subs.filter((s) => s.topic === topic).map((s) => s.params);
}

export const eventsStub = {
  subscribeTopic: (topic: EventTopic, params: Record<string, unknown>, onData: Handler) => {
    const key = subKey(topic, params);
    const entry = { key, topic, params };
    state.subs.push(entry);
    let set = state.frameSubs.get(key);
    if (!set) { set = new Set(); state.frameSubs.set(key, set); }
    set.add(onData);
    return () => {
      set!.delete(onData);
      const i = state.subs.indexOf(entry);
      if (i >= 0) state.subs.splice(i, 1);
    };
  },
  eventsTopics: () => state.topics,
  subscribeTopics: (cb: (t: EventTopic[]) => void) => {
    state.topicsSubs.add(cb);
    return () => { state.topicsSubs.delete(cb); };
  },
  eventsSilentSince: () => state.silentSince,
  eventsStatus: () => state.status,
  subscribeStatus: (cb: (s: Status) => void) => {
    state.statusSubs.add(cb);
    return () => { state.statusSubs.delete(cb); };
  },
  subscribe: () => () => {},
};
