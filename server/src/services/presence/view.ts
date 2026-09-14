import { hostname } from "node:os";
import {
  LOCAL_DEVICE_ID, type LaunchStatus, type PresenceDeviceView, type PresenceSession, type PresenceView,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { buildLocalPresence, buildLocalCapacity } from "./snapshot";
import { presenceEntries, recordPresence, capacityFor } from "./registry";
import { relayControlFor } from "../relay/hub";

/* SPEC-919 · ADR-0148 · gabungan katalog device (DB, persisten) + keadaan hidup (memori).

   Nama device TIDAK disimpan di registry: ia sudah hidup di `DeviceToken` dan mengambilnya dari
   satu tempat saja meniadakan pertanyaan "salinan mana yang benar sesudah rename" — kebalikan
   sadar dari `HandledByEntry` (ADR-0135), yang HARUS menyimpan snapshot nama justru karena
   penerimanya client yang tak punya katalog device sama sekali.

   `presenceView` menyegarkan sesi mesin ini sebagai efek samping: satu-satunya pemanggilnya
   adalah build grup siar dan route fallback-nya, dan keduanya memang ingin angka terbaru. */

export async function presenceView(
  o: { local?: () => Promise<PresenceSession[]>; localCapacity?: () => Promise<LaunchStatus>; now?: number } = {},
): Promise<PresenceView> {
  const now = o.now ?? Date.now();
  const local = o.local ?? buildLocalPresence;

  // Requirement 5 · sesi mesin ini masuk lewat pintu yang SAMA dengan device remote, supaya
  // `statusAt` dan bentuk barisnya lahir dari satu rumus.
  recordPresence(LOCAL_DEVICE_ID, await local().catch(() => []), now);
  // SPEC-1215 · hub juga target Start ("tanpa kandidat → hub ini"), jadi kapasitasnya ikut tampil.
  const localCapacity = await (o.localCapacity ?? buildLocalCapacity)().catch(() => null);

  const live = new Map(presenceEntries(now).map((e) => [e.deviceId, e.sessions]));
  const rows = await prisma.deviceToken.findMany({
    where: { revokedAt: null }, orderBy: { createdAt: "asc" },
  });

  const devices: PresenceDeviceView[] = [{
    deviceId: LOCAL_DEVICE_ID, name: hostname(), local: true, online: true,
    lastSeenAt: new Date(now).toISOString(), sessions: live.get(LOCAL_DEVICE_ID) ?? [],
    control: null, capacity: localCapacity,
  }];
  for (const r of rows) {
    const sessions = live.get(r.id);
    devices.push({
      deviceId: r.id, name: r.name, local: false, online: !!sessions,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      sessions: sessions ?? [],
      // SPEC-1215 · `control` dari hello socket relay (bisa hidup/mismatch walau presence belum tiba);
      // `capacity` hanya untuk device yang online — angka basi tak boleh mengusulkan target.
      control: relayControlFor(r.id),
      capacity: sessions ? capacityFor(r.id, now) : null,
    });
  }

  // Gerbang requirement 7: instalasi satu mesin (nol device token) tak berubah tampilannya.
  return { enabled: rows.length > 0, devices };
}
