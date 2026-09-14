import {
  PRESENCE_HEARTBEAT_MS, PRESENCE_TICK_MS, presenceFrameJson, presenceSignature,
  trimPresenceToBudget, capacityFrameJson, capacitySignature, type LaunchStatus, type PresenceSession,
} from "@hanoman/shared";
import { buildLocalPresence, buildLocalCapacity } from "./snapshot";

/* SPEC-919 · ADR-0147 · sisi KLIEN: menaikkan snapshot sesi mesin ini ke hub.

   `send` disuntik, bukan diimpor. Itu yang membuat modul ini bisa diuji tanpa satu pun WebSocket,
   dan yang membuat "kanal status tak boleh menjatuhkan sync" terbaca dari tipenya: modul ini tak
   memegang socket dan tak bisa menutupnya. */

export type PresenceSender = { tick(now: number): Promise<void> };

export function createPresenceSender(o: {
  send: (json: string) => void;
  build: () => Promise<PresenceSession[]>;
  /** SPEC-1215 · ADR-0165 §9 · absen = tak ada frame capacity (test lama, dan pemakaian tanpa gerbang). */
  capacity?: () => Promise<LaunchStatus>;
  heartbeatMs?: number;
}): PresenceSender {
  const heartbeatMs = o.heartbeatMs ?? PRESENCE_HEARTBEAT_MS;
  let lastSignature: string | null = null;
  let lastSentAt = 0;
  let lastCapacity: string | null = null;
  let lastCapacityAt = 0;
  const trySend = (json: string): void => {
    try { o.send(json); } catch { /* socket sudah tertutup — siklus reconnect yang mengurusnya */ }
  };

  async function tickPresence(now: number): Promise<void> {
    let sessions: PresenceSession[];
    // tmux mati / belum jalan bukan alasan untuk mengganggu socket sync.
    try { sessions = trimPresenceToBudget(await o.build()); } catch { return; }
    // Signature dihitung atas daftar yang SUDAH dipotong — kalau tidak, mesin di atas anggaran
    // akan mengirim ulang byte yang identik tiap tick karena signature-nya terus berubah.
    const signature = presenceSignature(sessions);
    const due = lastSignature === null || signature !== lastSignature || now - lastSentAt >= heartbeatMs;
    if (!due) return;
    lastSignature = signature;
    lastSentAt = now;
    trySend(presenceFrameJson(sessions));
  }

  // Blok terpisah dari presence: kegagalan satu tak boleh membungkam yang lain. Guard hub
  // (`PRESENCE_MAX_FRAMES_PER_MIN` = 60) menghitung keduanya: ≤ 20 + ≤ 20 frame/menit.
  async function tickCapacity(now: number): Promise<void> {
    if (!o.capacity) return;
    let admission: LaunchStatus;
    try { admission = await o.capacity(); } catch { return; }
    const signature = capacitySignature(admission);
    if (lastCapacity !== null && signature === lastCapacity && now - lastCapacityAt < heartbeatMs) return;
    lastCapacity = signature;
    lastCapacityAt = now;
    trySend(capacityFrameJson(admission));
  }

  return {
    async tick(now: number): Promise<void> {
      await tickPresence(now);
      await tickCapacity(now);
    },
  };
}

/** Pembungkus `setInterval` untuk pemakaian nyata. Timer di-`unref` supaya tak menahan proses. */
export function startPresenceSender(o: {
  send: (json: string) => void;
  build?: () => Promise<PresenceSession[]>;
  capacity?: () => Promise<LaunchStatus>;
  tickMs?: number;
  heartbeatMs?: number;
}): { stop(): void } {
  const sender = createPresenceSender({
    send: o.send, build: o.build ?? buildLocalPresence, capacity: o.capacity ?? buildLocalCapacity, heartbeatMs: o.heartbeatMs,
  });
  void sender.tick(Date.now());
  const timer = setInterval(() => { void sender.tick(Date.now()); }, o.tickMs ?? PRESENCE_TICK_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}
