import React from "react";
import type { EventMsg, EventTopic, TopicParams } from "@hanoman/shared";
import {
  subscribeTopic, eventsTopics, subscribeTopics, eventsSilentSince, eventsHelloSeen,
  eventsStatus, subscribeStatus, type EventsStatus,
} from "./events";

// SPEC-908 · socket yang bisu selama ini tanpa satu pun frame = WS terhalang (proxy yang menolak
// upgrade) padahal HTTP hidup. Baru di situ polling HTTP dihidupkan lagi.
const FALLBACK_AFTER_MS = 15_000;

// SPEC-897 · status socket `events` yang sudah ada — pengamat, tak membuka koneksi sendiri.
export function useEventsStatus(): EventsStatus {
  const [status, setStatus] = React.useState(eventsStatus);
  React.useEffect(() => {
    setStatus(eventsStatus());   // bisa sudah berubah antara render pertama dan efek ini
    return subscribeStatus(setStatus);
  }, []);
  return status;
}

/**
 * SPEC-908 · satu tempat untuk "kapan menyegarkan". Muat AWAL tetap HTTP (layar memanggil
 * `load()`-nya sendiri); hook ini hanya mendorong pembaruan.
 *
 * `apply` sengaja tak diberi akses ke state loading/error layar — sifat silent refresh karena itu
 * dijaga secara KONSTRUKSI, bukan oleh disiplin pemanggil.
 *
 * `setInterval` fallback menyala hanya pada dua keadaan yang bisa DIBUKTIKAN: server menjawab
 * `hello` tanpa topik ini, atau socket bisu melewati FALLBACK_AFTER_MS. Selama WS sehat: nol
 * interval dan nol request HTTP berkala.
 */
export function useLiveTopic<T extends EventTopic>(o: {
  topic: T; params: TopicParams[T];
  apply: (m: Extract<EventMsg, { t: T }>) => void;
  refetch: () => void; pollMs: number;
}): void {
  const { topic, params, pollMs } = o;
  const applyRef = React.useRef(o.apply); applyRef.current = o.apply;
  const refetchRef = React.useRef(o.refetch); refetchRef.current = o.refetch;
  // `params` objek baru tiap render; yang stabil kuncinya, bukan referensinya.
  const paramsKey = JSON.stringify(params);

  // Daftar topik disimpan sebagai STATE, bukan dibaca dari modul saat render: kalau hanya
  // "didukung/tidak" yang di-state-kan, transisi [] → ["git"] pada layar `tickets` tak mengubah
  // nilainya (tetap false), React membatalkan render, dan keputusan fallback membeku.
  const [topics, setTopics] = React.useState<EventTopic[]>(() => eventsTopics());
  React.useEffect(() => {
    setTopics(eventsTopics());   // bisa sudah berubah antara render pertama dan efek ini
    return subscribeTopics(setTopics);
  }, []);
  const supported = topics.includes(topic);

  React.useEffect(
    () => subscribeTopic(topic, params, (m) => applyRef.current(m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topic, paramsKey],
  );

  // `hello` yang TIBA adalah jawabannya, bukan isinya: daftar kosong sah (koneksi yang tak boleh
  // berlangganan), dan membacanya sebagai "belum menjawab" membuat layar diam selamanya.
  const answered = eventsHelloSeen() || topics.length > 0;
  const [blind, setBlind] = React.useState(false);
  React.useEffect(() => {
    if (supported || answered) { setBlind(false); return; }
    const t = setTimeout(() => { if (eventsSilentSince() === null) setBlind(true); }, FALLBACK_AFTER_MS);
    return () => clearTimeout(t);
  }, [supported, answered]);

  const polling = !supported && (blind || answered);
  React.useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => { if (!document.hidden) refetchRef.current(); }, pollMs);
    return () => clearInterval(t);
  }, [polling, pollMs, paramsKey]);
}
