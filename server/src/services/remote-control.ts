import { Prisma } from "@prisma/client";
import type { RemoteControl, RemoteControlPut, RemoteControlView } from "@hanoman/shared";
import { prisma } from "../db";
import { appendEvent, recentAudit } from "./logs/event-log";
import { refreshRelayClient, relayClientStatus } from "./relay/client";
import { getSetting } from "./settings";

/* SPEC-1215 · ADR-0165 §4/§7 · ADR-0166 §8 · satu-satunya penulis `Setting.remoteControl` dan
   `Setting.logShipping`. `PUT /settings` sengaja tak bisa menyentuhnya (routes/settings.ts). */

export async function remoteControlView(): Promise<RemoteControlView> {
  const s = await getSetting();
  return { control: s.remoteControl, logs: s.logShipping, relay: relayClientStatus(), audit: await recentAudit(50) };
}

export async function updateRemoteControl(input: RemoteControlPut, by: string): Promise<RemoteControlView> {
  const before = await getSetting();
  // Kosakata sudah divalidasi route (`validateRemoteGrant`); dedup tanpa mengubah urutan pilihan operator.
  const control: RemoteControl = input.control
    ? { enabled: input.control.enabled, capabilities: [...new Set(input.control.capabilities)] as RemoteControl["capabilities"] }
    : before.remoteControl;
  const logs = input.logs ?? before.logShipping;
  const data = { ...before, remoteControl: control, logShipping: logs } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });

  const grantChanged = JSON.stringify(before.remoteControl) !== JSON.stringify(control);
  // AC-A5 · ditunggu: socket relay tertutup SEBELUM route membalas.
  if (grantChanged) {
    await refreshRelayClient();
    await appendEvent({
      kind: "grant.changed", level: "warn", msg: `grant kendali jarak jauh diubah oleh ${by}`,
      data: { scope: "control", from: before.remoteControl, to: control, by },
    });
  }
  if (JSON.stringify(before.logShipping) !== JSON.stringify(logs)) {
    await appendEvent({
      kind: "grant.changed", level: "warn", msg: `lajur log ke hub diubah oleh ${by}`,
      data: { scope: "logs", from: before.logShipping, to: logs, by },
    });
  }
  return remoteControlView();
}
