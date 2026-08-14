export type RateLimitOptions = { windowMs: number; limit: number; maxKeys: number };
type Entry = { count: number; resetAt: number; touchedAt: number };

export class BoundedRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly opts: RateLimitOptions) {
    if (opts.windowMs <= 0 || opts.limit <= 0 || opts.maxKeys <= 0)
      throw new Error("rate limiter options must be positive");
  }

  hit(key: string, now = Date.now()): { blocked: boolean; retryAfterMs: number } {
    this.prune(now);
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + this.opts.windowMs, touchedAt: now };
    entry.count += 1;
    entry.touchedAt = now;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.evict();
    return { blocked: entry.count > this.opts.limit, retryAfterMs: Math.max(0, entry.resetAt - now) };
  }

  clear(key: string): void { this.entries.delete(key); }
  get size(): number { return this.entries.size; }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }

  private evict(): void {
    while (this.entries.size > this.opts.maxKeys) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxKeys: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > maxKeys) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
