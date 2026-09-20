import type { PresenceView } from "@hanoman/shared";

// Device lokal membawa `lastSeenAt` = jam build server, jadi frame `presence` berbeda di setiap
// build walau isinya sama. Kunci ini mengabaikannya agar klien tak me-render ulang tiap frame.
export const presenceKeyOf = (v: PresenceView): string => JSON.stringify({
  ...v, devices: v.devices.map((d) => (d.local ? { ...d, lastSeenAt: null } : d)),
});
