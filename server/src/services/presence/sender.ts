import {
  PRESENCE_HEARTBEAT_MS, PRESENCE_PROTOCOL, PRESENCE_TICK_MS, presenceSignature,
  type PresenceSession,
} from "@hanoman/shared";
import { buildLocalPresence } from "./snapshot";

/* SPEC-919 · ADR-0147 · sisi KLIEN: menaikkan snapshot sesi mesin ini ke hub.

   `send` disuntik, bukan diimpor. Itu yang membuat modul ini bisa diuji tanpa satu pun WebSocket,
   dan yang membuat "kanal status tak boleh menjatuhkan sync" terbaca dari tipenya: modul ini tak
   memegang socket dan tak bisa menutupnya. */

export type PresenceSender = { tick(now: number): Promise<void> };

export function createPresenceSender(o: {
  send: (json: string) => void;
  build: () => Promise<PresenceSession[]>;
  heartbeatMs?: number;
}): PresenceSender {
  const heartbeatMs = o.heartbeatMs ?? PRESENCE_HEARTBEAT_MS;
  let lastSignature: string | null = null;
  let lastSentAt = 0;

  return {
    async tick(now: number): Promise<void> {
      let sessions: PresenceSession[];
      // tmux mati / belum jalan bukan alasan untuk mengganggu socket sync.
      try { sessions = await o.build(); } catch { return; }

      const signature = presenceSignature(sessions);
      const due = lastSignature === null
        || signature !== lastSignature
        || now - lastSentAt >= heartbeatMs;
      if (!due) return;

      lastSignature = signature;
      lastSentAt = now;
      try { o.send(JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions })); }
      catch { /* socket sudah tertutup — siklus reconnect yang mengurusnya */ }
    },
  };
}

/** Pembungkus `setInterval` untuk pemakaian nyata. Timer di-`unref` supaya tak menahan proses. */
export function startPresenceSender(o: {
  send: (json: string) => void;
  build?: () => Promise<PresenceSession[]>;
  tickMs?: number;
  heartbeatMs?: number;
}): { stop(): void } {
  const sender = createPresenceSender({
    send: o.send, build: o.build ?? buildLocalPresence, heartbeatMs: o.heartbeatMs,
  });
  void sender.tick(Date.now());
  const timer = setInterval(() => { void sender.tick(Date.now()); }, o.tickMs ?? PRESENCE_TICK_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
