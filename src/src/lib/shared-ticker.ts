// SPEC-1267 · satu `setInterval` 1 dtk untuk seluruh pelanggan (PhaseStrip per sel), hidup hanya
// selama ada pelanggan — dulu satu interval per sel.
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

export function subscribeTick(fn: () => void): () => void {
  subs.add(fn);
  if (!timer) timer = setInterval(() => { for (const f of [...subs]) f(); }, 1000);
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && timer) { clearInterval(timer); timer = undefined; }
  };
}
