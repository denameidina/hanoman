import { prisma } from "../db";
import type { HandledByEntry } from "@hanoman/shared";

// SPEC-880 · ADR-0135 · gerbang tulis penanda "ditangani oleh".
export type HandledByGate = { ok: true } | { ok: false; code: number; error: string };

// Instance yang TAK punya satu pun baris `DeviceToken` (client) sengaja TIDAK menghakimi
// `deviceId`: katalog device hidup di hub dan tak ikut SYNCED, jadi menolak di sini berarti
// menolak nilai yang sah hanya karena mesin ini kebetulan bukan pemegang katalognya.
//
// Device yang SUDAH DICABUT tetap sah (AC-7): kalau tidak, satu PATCH yang cuma mengganti nama
// project akan menolak nilai `handledBy` yang sudah tersimpan — jejak historis harus tetap terbaca.
export async function checkHandledBy(list: HandledByEntry[]): Promise<HandledByGate> {
  const known = await prisma.deviceToken.findMany({ select: { id: true } });
  if (!known.length) return { ok: true };
  const ids = new Set(known.map((d) => d.id));
  const asing = list.filter((e) => !ids.has(e.deviceId)).map((e) => e.deviceId);
  if (asing.length) return { ok: false, code: 400, error: `device tak dikenal: ${asing.join(", ")}` };
  return { ok: true };
}
