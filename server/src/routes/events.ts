import type { FastifyInstance } from "fastify";
import { attach, detach } from "../services/events";
import type { Client } from "../services/pty";
import { admitBrowserWs, openWsConnection, revalidateWsPrincipal } from "../services/ws-admission";

// SPEC-199 · WebSocket siar dashboard (ADR-0039). Auth diwarisi gate onRequest scope /api
// (cookie same-origin), sama seperti WS terminal. Read-only feed: frame masuk diabaikan.
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
    void attach(client);
    const revalidate = setInterval(() => {
      void revalidateWsPrincipal(req, principal).then((ok) => { if (!ok) socket.close(1008, "session revoked"); });
    }, 60_000);
    revalidate.unref?.();
    socket.on("close", () => { clearInterval(revalidate); release(); detach(client); });
  });
}
