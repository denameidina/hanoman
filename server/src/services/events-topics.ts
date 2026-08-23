import type { EventMsg, EventTopic, TopicParams } from "@hanoman/shared";
import { zTopicParams } from "@hanoman/shared";
import { buildSchedulerState } from "./scheduler/state";
import { buildQueuePage } from "./scheduler/queue";
import { buildTicketsPage } from "./tickets-list";
import { buildLeadStatus, buildLeadDecisions, buildLeadFlows } from "./lead/views";
import { buildGitLive } from "./git-ide";
import { repoOf } from "./repo-dir";

// SPEC-908 · registry topik langganan: tahu APA yang dihitung dan seberapa sering, tak tahu siapa
// pelanggannya (itu urusan services/events.ts). `build` mengembalikan BADAN frame tanpa `t`/`key` —
// hub yang memasangnya, jadi nama topik dan `t` frame tak bisa berselisih diam-diam.
type Body<T extends EventTopic> = Omit<Extract<EventMsg, { t: T }>, "t" | "key">;

export type Topic<T extends EventTopic> = {
  everyTicks: number;
  build: (params: TopicParams[T]) => Promise<Body<T>>;
};

// everyTicks dihitung terhadap tick 1 dtk. Semuanya ≤ kadens polling klien yang digantikan
// (5/5/5/5/4 dtk), dan biayanya cuma lahir untuk parameter yang benar-benar ada yang menonton.
export const TOPICS: { [K in EventTopic]: Topic<K> } = {
  schedulerState: { everyTicks: 2, build: async () => ({ state: await buildSchedulerState() }) },
  schedulerQueue: { everyTicks: 3, build: async (p) => ({ data: await buildQueuePage(p) }) },
  tickets: { everyTicks: 3, build: async (p) => ({ data: await buildTicketsPage(p) }) },
  lead: {
    everyTicks: 4,
    build: async (p) => ({
      status: await buildLeadStatus(),
      decisions: await buildLeadDecisions({ projectId: p.projectId, page: p.decPage, limit: p.limit }),
      // SPEC-485 · rantai boleh tak ada di instance lama; kegagalannya tak menjatuhkan panel.
      flows: await buildLeadFlows({ projectId: p.projectId, page: p.flowPage, limit: p.limit })
        .catch(() => ({ items: [], total: 0, page: 1, pageSize: p.limit })),
    }),
  },
  git: { everyTicks: 4, build: async (p) => buildGitLive((await repoOf(p.projectId)) ?? null, p) },
};

export const TOPIC_NAMES = Object.keys(TOPICS) as EventTopic[];

export function isTopic(t: string): t is EventTopic {
  return Object.prototype.hasOwnProperty.call(TOPICS, t);
}

/** Parse parameter satu entri `sub`; `undefined` = tolak entri ITU, bukan seluruh frame. */
export function parseParams<T extends EventTopic>(topic: T, params: unknown): TopicParams[T] | undefined {
  const r = zTopicParams[topic].safeParse(params);
  return r.success ? (r.data as TopicParams[T]) : undefined;
}
