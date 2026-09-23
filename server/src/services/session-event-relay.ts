import type { FastifyInstance } from "fastify";
import type { AgentRelayStatus } from "@hanoman/shared";
import { constants } from "node:fs";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sessionEventToken } from "./session-event-token";
import { sessionEventSpoolRoot } from "./session-event-spool";
import { controlHost, loadIngressPolicy } from "./ingress-policy";

const MAX_EVENT_BYTES = 1_000_000;
const MAX_FILES_PER_DRAIN = 1_000;
const SESSION_ID_RE = /^[a-z0-9_-]+$/;

type RelayRequest = {
  method: "POST";
  url: "/api/session-events";
  headers: {
    authorization: string; "x-hanoman-session": string; host?: string; "x-hanoman-event-at"?: string;
  };
  payload: Record<string, unknown>;
};
type Injectable = { inject(request: RelayRequest): Promise<{ statusCode: number }> };
const observations = new Map<string, AgentRelayStatus>();
export function sessionEventRelayStatus(root = sessionEventSpoolRoot()): AgentRelayStatus {
  return { ...(observations.get(root) ?? {
    state: "unobserved", checkedAt: null, lastDeliveryAt: null, lastIssueAt: null,
    retryPending: 0, retryAttempts: 0, droppedEvents: 0,
  }) };
}

/**
 * Counters describe this relay process, not whether every runtime emits hooks.
 *
 * `host` = host control (`HANOMAN_CONTROL_ORIGINS`) bila gerbang ingress menyala. Tanpanya inject
 * membawa Host default `localhost:80`, gerbang menjawab 404, dan setiap event dibuang — kembaran
 * `HANOMAN_EVENT_HOST` milik jalur curl hook (sessionEventEnv, pty.ts).
 */
export async function drainSessionEventSpool(
  app: Injectable, root = sessionEventSpoolRoot(), host: string | null = null,
): Promise<number> {
  const previous = sessionEventRelayStatus(root);
  const current = { retries: 0, dropped: 0, rejected: new Map<number, number>() };
  let delivered = 0;
  let failed = false;
  try {
    delivered = await drainSpool(app, root, current, host);
    return delivered;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // Event yang ditolak route tak bisa dicoba ulang, tapi tak boleh lenyap tanpa jejak: satu baris
    // per drain, bukan per event, supaya salah-konfigurasi yang menetap tak membanjiri log.
    if (current.rejected.size) {
      const summary = [...current.rejected].map(([code, n]) => `${n}× ${code}`).join(", ");
      console.warn(`session event relay: route menolak event (${summary}) — event dibuang`);
    }
    const now = new Date().toISOString();
    observations.set(root, {
      state: failed || current.retries > 0 ? "degraded" : "ready", checkedAt: now,
      lastDeliveryAt: delivered ? now : previous.lastDeliveryAt,
      lastIssueAt: failed || current.retries || current.dropped ? now : previous.lastIssueAt,
      retryPending: current.retries, retryAttempts: previous.retryAttempts + current.retries,
      droppedEvents: previous.droppedEvents + current.dropped,
    });
  }
}

/** Drain best-effort: setiap berkas invalid/terproses dibuang agar satu payload tak membuat loop. */
async function drainSpool(
  app: Injectable,
  root: string,
  observation: { retries: number; dropped: number; rejected: Map<number, number> },
  host: string | null,
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
    // S1 · urut kronologis: nama berkas hook = `<Date.now()>-<pid>-<uuid>.json` dan readdir tak
    // menjamin urutan (ext4 berurut hash). Start/Stop satu subagent harus tiba sesuai kejadiannya.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const eventAt = /^(\d{1,15})-/.exec(entry.name)?.[1];
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
        observation.dropped++;
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
            ...(host ? { host } : {}),
            // S1 · waktu KEJADIAN event (bukan waktu drain) — route memakainya untuk membedakan
            // replay dari lanjutan relay subagent yang sama.
            ...(eventAt ? { "x-hanoman-event-at": eventAt } : {}),
          },
          payload,
        });
        if (response.statusCode === 429 || response.statusCode >= 500) {
          observation.retries++;
          continue;
        }
        await rm(path, { force: true }).catch(() => {});
        if (response.statusCode >= 200 && response.statusCode < 300) delivered++;
        else {
          observation.dropped++;
          observation.rejected.set(response.statusCode, (observation.rejected.get(response.statusCode) ?? 0) + 1);
        }
      } catch { observation.retries++; } // simpan berkas untuk tick berikutnya
    }
  }
  return delivered;
}

export function startSessionEventRelay(
  app: FastifyInstance,
  options: { intervalMs?: number; root?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const root = options.root ?? sessionEventSpoolRoot();
  const host = controlHost(loadIngressPolicy(options.env ?? process.env));
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await drainSessionEventSpool({ inject: async (request) => app.inject(request) }, root, host);
    } catch (error) {
      console.error("session event relay gagal:", error);
    } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, options.intervalMs ?? 250);
  timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); });
  void tick();
}
