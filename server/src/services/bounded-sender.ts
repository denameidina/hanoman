// SPEC-1267 · backpressure kanal WS terminal. Tanpa batas, klien lambat (tunnel, ponsel) membuat
// antrean kirim `ws` tumbuh tanpa henti dan echo ketikan lahir makin jauh di belakang. Di atas plafon
// `high` frame ditahan; bila tertahan melewati `cap`, frame `data` terlama dibuang dan `onResync`
// meminta layar penuh sebagai gantinya. Frame kontrol (phase/alt/exit) tak pernah dibuang.
type Sink = { send(s: string): void; bufferedAmount: number };

export type BoundedSender = { send(frame: string): void; dispose(): void };

const HIGH = 1024 * 1024;
const CAP = 256 * 1024;
const DRAIN_MS = 20;

const isData = (frame: string): boolean => frame.startsWith('{"t":"data"');

export function createBoundedSender(
  ws: Sink,
  o: { high?: number; cap?: number; drainMs?: number; onResync?: () => void } = {},
): BoundedSender {
  const high = o.high ?? HIGH;
  const cap = o.cap ?? CAP;
  const drainMs = o.drainMs ?? DRAIN_MS;
  let pending: string[] = [];
  let pendingBytes = 0;
  let timer: NodeJS.Timeout | undefined;
  let resyncNeeded = false;

  const trim = (): void => {
    for (let i = 0; i < pending.length && pendingBytes > cap; ) {
      if (!isData(pending[i]!)) { i++; continue; }
      pendingBytes -= pending[i]!.length;
      pending.splice(i, 1);
      resyncNeeded = true;
    }
  };

  const drain = (): void => {
    timer = undefined;
    if (ws.bufferedAmount > high) { timer = setTimeout(drain, drainMs); timer.unref?.(); return; }
    const out = pending;
    pending = [];
    pendingBytes = 0;
    for (const f of out) ws.send(f);
    if (resyncNeeded) { resyncNeeded = false; o.onResync?.(); }
  };

  return {
    send(frame) {
      if (pending.length === 0 && ws.bufferedAmount <= high) { ws.send(frame); return; }
      pending.push(frame);
      pendingBytes += frame.length;
      trim();
      if (!timer) { timer = setTimeout(drain, drainMs); timer.unref?.(); }
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending = [];
      pendingBytes = 0;
    },
  };
}
