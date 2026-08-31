import type { FastifyInstance } from "fastify";
import { constants } from "node:fs";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sessionEventToken } from "./session-event-token";
import { sessionEventSpoolRoot } from "./session-event-spool";

const MAX_EVENT_BYTES = 1_000_000;
const MAX_FILES_PER_DRAIN = 1_000;
const SESSION_ID_RE = /^[a-z0-9_-]+$/;

type RelayRequest = {
  method: "POST";
  url: "/api/session-events";
  headers: { authorization: string; "x-hanoman-session": string };
  payload: Record<string, unknown>;
};
type Injectable = { inject(request: RelayRequest): Promise<{ statusCode: number }> };

/** Drain best-effort: setiap berkas invalid/terproses dibuang agar satu payload tak membuat loop. */
export async function drainSessionEventSpool(
  app: Injectable,
  root = sessionEventSpoolRoot(),
): Promise<number> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  let delivered = 0;
  let examined = 0;
  let readBuffer: Buffer | undefined;
  for (const session of await readdir(root, { withFileTypes: true })) {
    if (!session.isDirectory() || !SESSION_ID_RE.test(session.name)) continue;
    const dir = join(root, session.name);
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { continue; } // sesi bisa ditutup tepat di antara scan root dan scan direktorinya
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (++examined > MAX_FILES_PER_DRAIN) return delivered;
      const path = join(dir, entry.name);
      let payload: Record<string, unknown>;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        // O_NOFOLLOW menutup swap ke symlink; read dibatasi MAX+1 agar pertumbuhan setelah stat
        // tetap tidak membuat relay mengalokasikan/membaca payload tak berbatas.
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_EVENT_BYTES) throw new Error("payload terlalu besar");
        readBuffer ??= Buffer.allocUnsafe(MAX_EVENT_BYTES + 1);
        const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, 0);
        if (bytesRead > MAX_EVENT_BYTES) throw new Error("payload terlalu besar");
        const parsed = JSON.parse(readBuffer.subarray(0, bytesRead).toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("payload event bukan object");
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        await rm(path, { force: true }).catch(() => {});
        continue;
      } finally {
        await handle?.close().catch(() => {});
      }
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/session-events",
          headers: {
            authorization: `Bearer ${sessionEventToken(session.name)}`,
            "x-hanoman-session": session.name,
          },
          payload,
        });
        if (response.statusCode === 429 || response.statusCode >= 500) continue;
        await rm(path, { force: true }).catch(() => {});
        if (response.statusCode >= 200 && response.statusCode < 300) delivered++;
      } catch { /* server sesaat gagal: simpan berkas untuk tick berikutnya */ }
    }
  }
  return delivered;
}

export function startSessionEventRelay(
  app: FastifyInstance,
  options: { intervalMs?: number; root?: string } = {},
): void {
  const root = options.root ?? sessionEventSpoolRoot();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await drainSessionEventSpool({ inject: async (request) => app.inject(request) }, root);
    } catch (error) {
      console.error("session event relay gagal:", error);
    } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, options.intervalMs ?? 250);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  void tick();
}
