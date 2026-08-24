import { hostname } from "node:os";
import {
  LOCAL_DEVICE_ID, type PresenceDeviceView, type PresenceSession, type PresenceView,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { buildLocalPresence } from "./snapshot";
import { presenceEntries, recordPresence } from "./registry";

/* SPEC-919 · ADR-0148 · gabungan katalog device (DB, persisten) + keadaan hidup (memori).

   Nama device TIDAK disimpan di registry: ia sudah hidup di `DeviceToken` dan mengambilnya dari
   satu tempat saja meniadakan pertanyaan "salinan mana yang benar sesudah rename" — kebalikan
   sadar dari `HandledByEntry` (ADR-0135), yang HARUS menyimpan snapshot nama justru karena
   penerimanya client yang tak punya katalog device sama sekali.

   `presenceView` menyegarkan sesi mesin ini sebagai efek samping: satu-satunya pemanggilnya
   adalah build grup siar dan route fallback-nya, dan keduanya memang ingin angka terbaru. */

export async function presenceView(
  o: { local?: () => Promise<PresenceSession[]>; now?: number } = {},
): Promise<PresenceView> {
  const now = o.now ?? Date.now();
  const local = o.local ?? buildLocalPresence;

  // Requirement 5 · sesi mesin ini masuk lewat pintu yang SAMA dengan device remote, supaya
  // `statusAt` dan bentuk barisnya lahir dari satu rumus.
  recordPresence(LOCAL_DEVICE_ID, await local().catch(() => []), now);

  const live = new Map(presenceEntries(now).map((e) => [e.deviceId, e.sessions]));
  const rows = await prisma.deviceToken.findMany({
    where: { revokedAt: null }, orderBy: { createdAt: "asc" },
  });

  const devices: PresenceDeviceView[] = [{
    deviceId: LOCAL_DEVICE_ID, name: hostname(), local: true, online: true,
    lastSeenAt: new Date(now).toISOString(), sessions: live.get(LOCAL_DEVICE_ID) ?? [],
  }];
  for (const r of rows) {
    const sessions = live.get(r.id);
    devices.push({
      deviceId: r.id, name: r.name, local: false, online: !!sessions,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      sessions: sessions ?? [],
    });
  }

  // Gerbang requirement 7: instalasi satu mesin (nol device token) tak berubah tampilannya.
  return { enabled: rows.length > 0, devices };
}
