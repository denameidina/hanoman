import { createHash } from "node:crypto";
import {
  activationOf, effortOf, maxTurnsOf, timeoutSecondsOf, workspacePolicyOf,
  BUILTIN_AGENTS, customAgentId, toolsOf, type BuiltinAgentDef,
} from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "./settings";
import { findTombstone } from "./tombstone";
import { notifySynced } from "./sync-notify";

// SPEC-881 · ADR-0136 · penyemaian katalog agen bawaan. Satu-satunya penulis baris bawaan.
//
// BUKAN `upsert` buta: baris yang sudah disunting operator tak tersentuh selamanya. `enabled`
// milik operator setelah seed, kecuali policy sekali-jalan QA yang menutup insiden SPEC-950.

/**
 * `enabled` SENGAJA di luar sidik jari: mematikan satu agen tak boleh terbaca sebagai "disunting",
 * karena baris itu lalu tak pernah lagi menerima perbaikan instruksi.
 * `projectId`/`model`/`mentions`/`runtime` juga di luar — keempatnya konstan untuk semua bawaan.
 */
const digest = (parts: readonly string[]): string =>
  createHash("sha256").update(parts.join(" ")).digest("hex").slice(0, 16);

const legacyFingerprint = (
  name: string, description: string, instructions: string, tools: readonly string[],
): string => digest([name, description, instructions, [...tools].join(",")]);

type FingerprintableProfile = {
  name: string;
  description: string;
  instructions: string;
  tools: unknown;
  activation?: unknown;
  effort?: unknown;
  workspacePolicy?: unknown;
  maxTurns?: unknown;
  timeoutSeconds?: unknown;
};

const fingerprint = (a: FingerprintableProfile): string => digest([
  a.name, a.description, a.instructions, (toolsOf(a.tools) ?? []).join(","),
  activationOf(a.activation), effortOf(a.effort) ?? "",
  workspacePolicyOf(a.workspacePolicy), String(maxTurnsOf(a.maxTurns) ?? ""),
  String(timeoutSecondsOf(a.timeoutSeconds) ?? ""),
]);

export const builtinFingerprint = (a: BuiltinAgentDef): string =>
  fingerprint(a);

/** Sidik jari versi ADR-0136, hanya untuk mengenali row upgrade dari sebelum SPEC-950. */
export const legacyBuiltinFingerprint = (a: BuiltinAgentDef): string =>
  legacyFingerprint(a.name, a.description, a.instructions, a.tools);

export const rowFingerprint = (
  r: FingerprintableProfile,
): string => fingerprint(r);

const legacyRowFingerprint = (
  r: { name: string; description: string; instructions: string; tools: unknown },
): string => legacyFingerprint(r.name, r.description, r.instructions, toolsOf(r.tools) ?? []);

export const QA_SAFETY_POLICY = "disable-unedited-v1";

export async function seedBuiltinAgents(): Promise<void> {
  try {
    const setting = await getSetting();
    const stamps: Record<string, string> = { ...setting.builtinAgents };
    const policies: Record<string, string> = { ...setting.builtinAgentPolicies };
    let changed = false;

    for (const a of BUILTIN_AGENTS) {
      const id = customAgentId(null, a.name);
      const fp = builtinFingerprint(a);
      const row = await prisma.customAgent.findUnique({ where: { id } });
      const qaPolicyPending = a.name === "qa-verifier"
        && policies[a.name] !== QA_SAFETY_POLICY;

      if (!row) {
        // ADR-0119 · penghapusan operator bertahan lintas boot DAN lintas upgrade. Seed yang
        // membangkitkan baris yang sudah dibuang adalah fitur yang tak bisa dimatikan.
        if (await findTombstone("customAgent", id)) {
          if (qaPolicyPending) {
            policies[a.name] = QA_SAFETY_POLICY;
            changed = true;
          }
          continue;
        }
        await prisma.customAgent.create({ data: {
          id, projectId: null, name: a.name,
          description: a.description, instructions: a.instructions,
          tools: [...a.tools] as never, model: null, mentions: [] as never, runtime: null,
          activation: a.activation, effort: a.effort, workspacePolicy: a.workspacePolicy,
          maxTurns: a.maxTurns, timeoutSeconds: a.timeoutSeconds,
          enabled: a.enabledByDefault,
        } });
        await notifySynced("customAgent", id);
        stamps[a.name] = fp; changed = true;
        if (qaPolicyPending) policies[a.name] = QA_SAFETY_POLICY;
        continue;
      }

      // SATU-SATUNYA jalur perbaruan, dan ia menuntut DUA hal: isi baris masih persis sidik jari
      // yang terakhir ditulis seed (= belum disentuh operator) DAN versi terpasang membawa isi yang
      // berbeda. Tanpa syarat pertama, upgrade menimpa kerja operator; tanpa syarat kedua, setiap
      // boot menulis ulang baris yang sudah mutakhir — `updatedAt` bergerak tanpa sebab dan
      // menyeberang sync sebagai mutasi palsu ke setiap mesin lain.
      const stamped = stamps[a.name];
      const unedited = Boolean(stamped)
        && (stamped === rowFingerprint(row) || stamped === legacyRowFingerprint(row));
      const data: Record<string, unknown> = {};

      if (unedited && stamped !== fp) {
        Object.assign(data, {
          description: a.description, instructions: a.instructions,
          tools: [...a.tools], activation: a.activation, effort: a.effort,
          workspacePolicy: a.workspacePolicy, maxTurns: a.maxTurns,
          timeoutSeconds: a.timeoutSeconds,
        });
        stamps[a.name] = fp;
        changed = true;
      }
      // Satu-satunya pengecualian terhadap "enabled milik operator": QA versi lama yang isi
      // seed-nya masih utuh sudah terbukti dapat mengotori worktree parent (SPEC-950).
      if (qaPolicyPending && unedited) data.enabled = false;

      if (Object.keys(data).length > 0) {
        await prisma.customAgent.update({ where: { id }, data });
        await notifySynced("customAgent", id);
      }
      if (qaPolicyPending) {
        policies[a.name] = QA_SAFETY_POLICY;
        changed = true;
      }
    }

    if (changed) {
      const data = { ...setting, builtinAgents: stamps, builtinAgentPolicies: policies };
      await prisma.setting.upsert({
        where: { id: 1 }, update: { data }, create: { id: 1, data },
      });
    }
  } catch {
    // ADR-0094 keputusan 7 · katalog agen tak pernah boleh menggagalkan boot maupun kelahiran
    // sesi. Gagal di sini = katalog apa adanya, bukan server yang tak menyala.
  }
}
