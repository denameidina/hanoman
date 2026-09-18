import type { FastifyInstance, InjectOptions } from "fastify";
import {
  RELAY_ACTOR_HEADER, RELAY_HEADER, RELAY_MAX_INFLIGHT, RELAY_REQUEST_BODY_MAX_BYTES, RELAY_RESPONSE_MAX_BYTES,
  relayBodyAllowed, relayRouteAllowed, splitUtf8, utf8Bytes, zHubToClientFrame, type RelayReqFrame,
} from "@hanoman/shared";
import { controlHost, loadIngressPolicy } from "../ingress-policy";
import { appendEvent } from "../logs/event-log";
import { encodeRelayActor } from "./gate";
import { relaySecret } from "./secret";

/* SPEC-1215 · ADR-0165 §2 · sisi KLIEN: menjalankan ulang request hub lewat route yang SAMA.
   Tak ada handler bisnis di sini — hanya amplop, anggaran, dan audit. "Hasil identik dengan aksi
   lokal" terpenuhi by construction karena `app.inject` melewati gate, preValidation, dan handler
   yang persis sama dengan request dari dashboard lokal. */

export type InjectResponse = { statusCode: number; headers: Record<string, unknown>; body: string };
export type InjectedWs = {
  send(data: string): void;
  on(ev: "message" | "close", cb: (...a: any[]) => void): void;
  close(code?: number, reason?: string): void;
};
export type InjectableApp = {
  inject(o: { method: string; url: string; headers: Record<string, string>; payload?: string }): Promise<InjectResponse>;
  // Koreksi (Global Constraints #1): spec teknis §T5 berhenti di level frame, tak menyebut
  // perluasan `InjectableApp` — ini SATU-SATUNYA tempat `injectWS` sesungguhnya dipanggil di
  // klien. Opsional supaya mock lama yang cuma punya `inject` (test dispatcher yang ada) tak pecah.
  injectWS?(path: string, o: { headers: Record<string, string> }, hooks: { onOpen: (ws: InjectedWs) => void }): Promise<void>;
};
export type RemoteRequestAudit = { kind: "remote.request"; level: "info" | "warn" | "error"; msg: string; data: Record<string, unknown> };

export function injectableFrom(app: FastifyInstance): InjectableApp {
  return {
    async inject(o) {
      const r = await app.inject({
        method: o.method as InjectOptions["method"], url: o.url, headers: o.headers,
        ...(o.payload !== undefined ? { payload: o.payload } : {}),
      });
      return { statusCode: r.statusCode, headers: r.headers as Record<string, unknown>, body: r.body };
    },
    async injectWS(path, o, hooks) { await app.injectWS(path, o as any, hooks as any); },
  };
}

// `classifyIngress` menjawab 404 untuk host asing (spike S0a), dan `inject` tanpa host = `localhost:80`.
const defaultHost = (): string => controlHost(loadIngressPolicy(process.env)) ?? "127.0.0.1";
const JSON_TYPE = "application/json; charset=utf-8";

export function createRelayDispatcher(o: {
  app: InjectableApp;
  send: (json: string) => void;
  host?: () => string;
  audit?: (e: RemoteRequestAudit) => void;
  now?: () => number;
  // SPEC-1216 · ADR-0165 §11 · disuntik relay/client.ts (default syncNow di sana, bukan di sini —
  // dispatcher tak boleh mengimpor sync-client langsung, cermin kenapa audit disuntikkan).
  syncOnce?: () => Promise<unknown>;
}) {
  const host = o.host ?? defaultHost;
  const audit = o.audit ?? ((e: RemoteRequestAudit) => { void appendEvent(e); });
  const now = o.now ?? Date.now;
  const syncOnce = o.syncOnce ?? (async () => {});
  const inflight = new Map<string, { cancelled: boolean }>();

  const send = (frame: Record<string, unknown>): void => {
    try { o.send(JSON.stringify(frame)); } catch { /* socket tertutup — hub menganggap offline */ }
  };
  const reply = (id: string, status: number, contentType: string, body: string): void => {
    const parts = splitUtf8(body);
    parts.forEach((part, i) => {
      const end = i === parts.length - 1;
      send(i === 0 ? { t: "res", id, status, contentType, part, end } : { t: "res", id, part, end });
    });
  };
  const fail = (id: string, status: number, error: string): void => reply(id, status, JSON_TYPE, JSON.stringify({ error }));

  async function handleReq(f: RelayReqFrame): Promise<void> {
    const started = now();
    const record = (status: number, extra: Record<string, unknown> = {}): void => audit({
      kind: "remote.request", level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      msg: `${f.method} ${f.path} → ${status}`,
      data: { actor: f.actor, method: f.method, path: f.path, status, ms: now() - started, ...extra },
    });
    if (inflight.has(f.id)) return; // id kembar dari hub — frame pertama yang menang
    if (inflight.size >= RELAY_MAX_INFLIGHT) { fail(f.id, 429, "relay-busy"); record(429); return; }
    const payload = f.body === undefined ? undefined : JSON.stringify(f.body);
    if (payload !== undefined && utf8Bytes(payload) > RELAY_REQUEST_BODY_MAX_BYTES) {
      fail(f.id, 413, "relay-body-too-large"); record(413); return;
    }
    const url = f.query ? `${f.path}?${f.query.replace(/^\?/, "")}` : f.path;
    // AC-A7 · diperiksa SEBELUM inject: handler route yang tak diizinkan tak pernah jalan sama sekali.
    // Gate `remote` di app.ts menilai ulang (lapis kedua), jadi dispatcher yang salah tetap tertahan.
    if (!relayRouteAllowed(f.method, url) || !relayBodyAllowed(f.method, f.path, f.body)) {
      fail(f.id, 403, "relay route not allowed"); record(403); return;
    }
    const entry = { cancelled: false };
    inflight.set(f.id, entry);
    try {
      const isSpawn = f.method === "POST" && f.path === "/api/terminal/sessions" && f.body && typeof f.body === "object" && "spec" in (f.body as any);
      const doInject = () => o.app.inject({
        method: f.method, url,
        headers: {
          host: host(), [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(f.actor),
          ...(payload !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(payload !== undefined ? { payload } : {}),
      });
      let res = await doInject();
      let retried = false;
      if (isSpawn && res.statusCode === 404 && entry.cancelled === false) {
        const parsed = (() => { try { return JSON.parse(res.body); } catch { return null; } })();
        if (parsed?.error === "spec not found") {
          record(404, { attempt: 1 }); // percobaan pertama, tercatat sendiri
          await syncOnce().catch(() => {});
          if (!entry.cancelled) { res = await doInject(); retried = true; }
        }
      }
      if (!retried) record(res.statusCode);
      else audit({
        kind: "remote.request", level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        msg: `${f.method} ${f.path} → ${res.statusCode}`,
        data: { actor: f.actor, method: f.method, path: f.path, status: res.statusCode, ms: now() - started, retried: true },
      });
      if (entry.cancelled) return;
      if (utf8Bytes(res.body) > RELAY_RESPONSE_MAX_BYTES) { fail(f.id, 502, "relay-response-too-large"); return; }
      reply(f.id, res.statusCode, String(res.headers["content-type"] ?? "application/octet-stream"), res.body);
    } catch {
      record(502);
      if (!entry.cancelled) fail(f.id, 502, "relay-dispatch-failed");
    } finally {
      inflight.delete(f.id);
    }
  }

  return {
    onMessage(raw: string): void {
      let parsed: ReturnType<typeof zHubToClientFrame.safeParse>;
      try { parsed = zHubToClientFrame.safeParse(JSON.parse(raw)); } catch { return; }
      if (!parsed.success) return;
      const f = parsed.data;
      if (f.t === "req") { void handleReq(f); return; }
      if (f.t === "cancel") { const e = inflight.get(f.id); if (e) e.cancelled = true; return; }
      // Keputusan Plan P10 · stream milik SPEC-1218. Jawab tutup, jangan diam: hub versi C yang
      // bicara ke klien versi A tak perlu menunggu RELAY_OPEN_TIMEOUT_MS.
      if (f.t === "open") send({ t: "close", sid: f.sid, code: 4502, reason: "stream relay belum didukung klien ini" });
    },
    cancelAll(): void { for (const e of inflight.values()) e.cancelled = true; },
    inflight: (): number => inflight.size,
  };
}
export type RelayDispatcher = ReturnType<typeof createRelayDispatcher>;
