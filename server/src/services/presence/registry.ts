import { PRESENCE_OFFLINE_MS, type PresenceSession, type PresenceSessionView } from "@hanoman/shared";

/* SPEC-919 · ADR-0148 · keadaan hidup per-device, DI MEMORI.

   Ia tak menyentuh Prisma sama sekali — bukan "tabel yang kebetulan tak masuk `FIELDS`", tapi
   baris yang tak pernah lahir. Itu yang membuatnya mustahil membanjiri `SyncLog` walau suatu hari
   seseorang menambah entitas ke `SYNCED` tanpa membaca ADR ini. Ukurannya bukan selera: ADR-0131
   mengukur satu tulisan tersync per 5 menit per VPS menjadi 83% isi DB hub; presence berdenyut
   tiap 30 detik per device.

   Restart hub = peta kosong; klien mengisinya lagi dalam satu siklus reconnect. Keadaan basi punah
   dengan sendirinya, dan itu memang yang diminta. */

type Tracked = { session: PresenceSession; statusAt: number };
type Device = { sessions: Map<string, Tracked>; lastFrameAt: number };

export type PresenceEntry = { deviceId: string; sessions: PresenceSessionView[] };

const devices = new Map<string, Device>();

/** Ganti-penuh: frame membawa seluruh daftar sesi mesin itu, jadi yang tak disebut memang hilang.
    `statusAt` dicap di SINI supaya "bekerja" punya stempel yang jujur — klien tak bisa
    memberikannya tanpa mengirim aktivitas pane yang bergerak tiap detik. */
export function recordPresence(deviceId: string, sessions: PresenceSession[], now = Date.now()): void {
  const prev = devices.get(deviceId)?.sessions;
  const next = new Map<string, Tracked>();
  for (const session of sessions) {
    const before = prev?.get(session.sessionId);
    next.set(session.sessionId, {
      session,
      statusAt: before && before.session.status === session.status ? before.statusAt : now,
    });
  }
  devices.set(deviceId, { sessions: next, lastFrameAt: now });
}

/** Socket putus = device offline seketika; tak perlu menunggu ambang denyut. */
export function dropPresence(deviceId: string): void { devices.delete(deviceId); }

/** Device yang denyutnya berhenti melewati ambang disapu di sini — tak ada timer yang perlu hidup. */
export function presenceEntries(now = Date.now()): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [deviceId, d] of devices) {
    if (now - d.lastFrameAt >= PRESENCE_OFFLINE_MS) { devices.delete(deviceId); continue; }
    out.push({
      deviceId,
      sessions: [...d.sessions.values()].map((t) => ({
        ...t.session, statusAt: new Date(t.statusAt).toISOString(),
      })),
    });
  }
  return out;
}

/** Test-only: kosongkan peta. */
export function __resetPresence(): void { devices.clear(); }
