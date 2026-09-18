import { LOCAL_DEVICE_ID, type PresenceDeviceView } from "@hanoman/shared";

/* SPEC-1216 · ADR-0165 §5/§8 · satu-satunya tempat presence dibaca sebagai GERBANG (bukan info).
   `ok` bukan izin — pemanggil tetap menjalankan seluruh gerbang lain (dependency, admission).
   Murni: tak menyentuh Prisma/registry, supaya tabel positif/negatif diuji tanpa server. */

export type RecentlyOfflineEntry = { deviceId: string; name: string; specId: string; sessionId: string | null; at: number };
export type RemoteSessionVerdict =
  | { kind: "ok" }
  | { kind: "remote-session"; remote: { deviceId: string; name: string; sessionId: string } }
  | { kind: "confirm-required"; remote: { deviceId: string; name: string; sessionId: string | null; offline: true } };

const RECENTLY_OFFLINE_TTL_MS = 24 * 60 * 60_000;

export function remoteSessionVerdict(input: {
  specId: string;
  devices: PresenceDeviceView[];
  recentlyOffline: RecentlyOfflineEntry[];
  lastResultDeviceId: { deviceId: string; name: string } | null;
  now: number;
}): RemoteSessionVerdict {
  // 1. sesi working|waiting untuk specId di device ≠ LOCAL_DEVICE_ID (urutan presenceView = createdAt asc).
  for (const d of input.devices) {
    if (d.deviceId === LOCAL_DEVICE_ID) continue;
    const s = d.sessions.find((x) => x.specId === input.specId && (x.status === "working" || x.status === "waiting"));
    if (s) return { kind: "remote-session", remote: { deviceId: d.deviceId, name: d.name, sessionId: s.sessionId } };
  }
  // 2. recentlyOffline ≤ 24 jam untuk specId.
  const recent = input.recentlyOffline.find((e) => e.specId === input.specId && input.now - e.at <= RECENTLY_OFFLINE_TTL_MS);
  if (recent) return { kind: "confirm-required", remote: { deviceId: recent.deviceId, name: recent.name, sessionId: recent.sessionId, offline: true } };
  // 3. lastResultDeviceId ≠ null dan device itu tak online → confirm-required (sessionId null).
  if (input.lastResultDeviceId) {
    const online = input.devices.some((d) => d.deviceId === input.lastResultDeviceId!.deviceId);
    if (!online) return { kind: "confirm-required", remote: { ...input.lastResultDeviceId, sessionId: null, offline: true } };
  }
  return { kind: "ok" };
}
