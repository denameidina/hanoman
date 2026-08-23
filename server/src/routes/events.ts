import type { FastifyInstance } from "fastify";
import { attach, detach, subscribeClient } from "../services/events";
import type { Client } from "../services/pty";
import {
  admitBrowserWs, openWsConnection, revalidateWsPrincipal, canSubscribeTopics, WsMessageGuard,
} from "../services/ws-admission";
import { zEventsClientMsg } from "@hanoman/shared";

// SPEC-199 · WebSocket siar dashboard (ADR-0039). Auth diwarisi gate onRequest scope /api
// (cookie same-origin), sama seperti WS terminal.
// SPEC-908 · kanal ini kini menerima SATU jenis frame masuk (`{t:"sub"}`) untuk langganan
// berparameter, digerbangi principal (`canSubscribeTopics`) dan dibatasi `WsMessageGuard`.
// Frame `sub` lahir dari perubahan filter/halaman manusia, bukan ketikan — kuotanya kecil,
// bukan 6.000/menit milik terminal.
// Satu frame per perubahan filter/halaman; 120 semenit sudah jauh di atas kecepatan manusia.
const SUB_FRAMES_PER_MINUTE = 120;

export default async function (app: FastifyInstance, opts: { allowedOrigins?: Set<string> }) {
  app.get("/events/ws", {
    websocket: true,
    preValidation: async (req, reply) => {
      try { req.wsPrincipal = admitBrowserWs(req, "events", opts.allowedOrigins ?? new Set()); }
      catch { return reply.code(401).send({ error: "WebSocket admission rejected" }); }
    },
  }, (socket, req) => {
    const principal = req.wsPrincipal!;
    let release: () => void;
    try { release = openWsConnection(principal); }
    catch { socket.close(1008, "connection limit"); return; }
    const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
    const maySubscribe = canSubscribeTopics(principal);
    void attach(client, { maySubscribe });
    const guard = new WsMessageGuard({ perWindow: SUB_FRAMES_PER_MINUTE });
    socket.on("message", (raw: Buffer) => {
      const verdict = guard.accept(raw);
      if (!verdict.ok) { socket.close(verdict.code, verdict.reason); return; }
      if (!maySubscribe) return;
      let parsed: unknown;
      // ponytail: frame rusak dibuang diam-diam — pengirimnya UI kita sendiri.
      try { parsed = JSON.parse(raw.toString()); } catch { return; }
      const msg = zEventsClientMsg.safeParse(parsed);
      if (!msg.success) return;
      subscribeClient(client, msg.data.subs);
    });
    const revalidate = setInterval(() => {
      void revalidateWsPrincipal(req, principal).then((ok) => { if (!ok) socket.close(1008, "session revoked"); });
    }, 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); release(); detach(client); });
  });
}
