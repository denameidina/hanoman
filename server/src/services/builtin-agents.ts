import { createHash } from "node:crypto";
import { BUILTIN_AGENTS, customAgentId, toolsOf, type BuiltinAgentDef } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "./settings";
import { findTombstone } from "./tombstone";
import { notifySynced } from "./sync-notify";

// SPEC-881 · ADR-0136 · penyemaian katalog agen bawaan. Satu-satunya penulis baris bawaan.
//
// BUKAN `upsert` buta: baris yang sudah disunting operator tak tersentuh selamanya, dan `enabled`
// tak pernah ikut diperbarui — saklar itu milik operator sejak seed pertama.

/**
 * `enabled` SENGAJA di luar sidik jari: mematikan satu agen tak boleh terbaca sebagai "disunting",
 * karena baris itu lalu tak pernah lagi menerima perbaikan instruksi.
 * `projectId`/`model`/`mentions`/`runtime` juga di luar — keempatnya konstan untuk semua bawaan.
 */
const fingerprint = (
  name: string, description: string, instructions: string, tools: readonly string[],
): string =>
  createHash("sha256")
    .update([name, description, instructions, [...tools].join(",")].join(" "))
    .digest("hex")
    .slice(0, 16);

export const builtinFingerprint = (a: BuiltinAgentDef): string =>
  fingerprint(a.name, a.description, a.instructions, a.tools);

export const rowFingerprint = (
  r: { name: string; description: string; instructions: string; tools: unknown },
): string => fingerprint(r.name, r.description, r.instructions, toolsOf(r.tools) ?? []);

export async function seedBuiltinAgents(): Promise<void> {
  try {
    const setting = await getSetting();
    const stamps: Record<string, string> = { ...setting.builtinAgents };
    let changed = false;

    for (const a of BUILTIN_AGENTS) {
      const id = customAgentId(null, a.name);
      const fp = builtinFingerprint(a);
      const row = await prisma.customAgent.findUnique({ where: { id } });

      if (!row) {
        // ADR-0119 · penghapusan operator bertahan lintas boot DAN lintas upgrade. Seed yang
        // membangkitkan baris yang sudah dibuang adalah fitur yang tak bisa dimatikan.
        if (await findTombstone("customAgent", id)) continue;
        await prisma.customAgent.create({ data: {
          id, projectId: null, name: a.name,
          description: a.description, instructions: a.instructions,
          tools: [...a.tools] as never, model: null, mentions: [] as never, runtime: null,
          enabled: a.enabledByDefault,
        } });
        await notifySynced("customAgent", id);
        stamps[a.name] = fp; changed = true;
        continue;
      }

      // SATU-SATUNYA jalur perbaruan, dan ia menuntut DUA hal: isi baris masih persis sidik jari
      // yang terakhir ditulis seed (= belum disentuh operator) DAN versi terpasang membawa isi yang
      // berbeda. Tanpa syarat pertama, upgrade menimpa kerja operator; tanpa syarat kedua, setiap
      // boot menulis ulang baris yang sudah mutakhir — `updatedAt` bergerak tanpa sebab dan
      // menyeberang sync sebagai mutasi palsu ke setiap mesin lain.
      const stamped = stamps[a.name];
      if (!stamped || stamped === fp) continue;
      if (stamped !== rowFingerprint(row)) continue;

      await prisma.customAgent.update({ where: { id }, data: {
        description: a.description, instructions: a.instructions,
        tools: [...a.tools] as never,
        // `enabled` TIDAK di sini. Sengaja.
      } });
      await notifySynced("customAgent", id);
      stamps[a.name] = fp; changed = true;
    }

    if (changed) {
      const data = { ...setting, builtinAgents: stamps };
      await prisma.setting.upsert({
        where: { id: 1 }, update: { data }, create: { id: 1, data },
      });
    }
  } catch {
    // ADR-0094 keputusan 7 · katalog agen tak pernah boleh menggagalkan boot maupun kelahiran
    // sesi. Gagal di sini = katalog apa adanya, bukan server yang tak menyala.
  }
}
