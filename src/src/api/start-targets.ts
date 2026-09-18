import { LOCAL_DEVICE_ID, type PresenceView, type HandledByEntry, type LaunchStatus } from "@hanoman/shared";

// SPEC-1216 · ADR-0165 §9/§11 · murni: urutan tampil + kelayakan target dialog Start. Presence
// tak pernah meluluskan — fungsi ini hanya MENGUSULKAN; peluncuran tetap butuh klik manusia.
export type TargetReason = "offline" | "control-off" | "protocol-mismatch" | "no-spawn" | "capacity-full";
export type StartTarget = { deviceId: string; name: string; eligible: boolean; reason?: TargetReason };

function capacityFull(c: LaunchStatus): boolean {
  if (!c.enabled) return true;
  if (c.liveAgentCount >= c.maxConcurrent) return true;
  if (c.loadStatus === "unavailable") return true;
  if (c.loadPerCore !== null && c.loadPerCore > c.maxLoadPerCore) return true;
  return false;
}

export function startTargets(view: PresenceView, handledBy: HandledByEntry[]): StartTarget[] {
  const byId = new Map(view.devices.map((d) => [d.deviceId, d]));
  const order = [
    LOCAL_DEVICE_ID,
    ...handledBy.map((h) => h.deviceId),
    ...view.devices.map((d) => d.deviceId).filter((id) => id !== LOCAL_DEVICE_ID && !handledBy.some((h) => h.deviceId === id)),
  ];
  const seen = new Set<string>();
  const out: StartTarget[] = [];
  for (const deviceId of order) {
    if (seen.has(deviceId)) continue;
    seen.add(deviceId);
    const d = byId.get(deviceId);
    const name = d?.name ?? handledBy.find((h) => h.deviceId === deviceId)?.name ?? deviceId;
    if (!d) { out.push({ deviceId, name, eligible: false, reason: "offline" }); continue; }
    if (!d.online) { out.push({ deviceId, name: d.name, eligible: false, reason: "offline" }); continue; }
    if (deviceId !== LOCAL_DEVICE_ID) {
      if (!d.control) { out.push({ deviceId, name: d.name, eligible: false, reason: "control-off" }); continue; }
      if (d.control.state === "protocol-mismatch") { out.push({ deviceId, name: d.name, eligible: false, reason: "protocol-mismatch" }); continue; }
      if (!d.control.capabilities.includes("sessions:spawn")) { out.push({ deviceId, name: d.name, eligible: false, reason: "no-spawn" }); continue; }
    }
    if (d.capacity && capacityFull(d.capacity)) { out.push({ deviceId, name: d.name, eligible: false, reason: "capacity-full" }); continue; }
    out.push({ deviceId, name: d.name, eligible: true });
  }
  return out;
}
