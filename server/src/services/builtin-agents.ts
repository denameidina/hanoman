import { createHash } from "node:crypto";
import {
  activationOf, effortOf, maxTurnsOf, timeoutSecondsOf, workspacePolicyOf,
  BUILTIN_AGENTS, customAgentId, mentionsOf, toolsOf, type BuiltinAgentDef,
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
 * `projectId`/`model`/`runtime` juga di luar — ketiganya konstan untuk semua bawaan. `mentions` MASUK
 * hanya bila tak kosong (amandemen ADR-0094 2026-09-25): sidik jari agen tanpa mention byte-identik
 * dengan sebelumnya, jadi stempel lama tetap cocok dan tak ada baris yang mendadak "disunting".
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
  mentions?: unknown;
};

const mentionPart = (v: unknown): string[] => {
  const m = mentionsOf(v);
  return m.length === 0 ? [] : [`mentions:${m.join(",")}`];
};

const fingerprint = (a: FingerprintableProfile): string => digest([
  a.name, a.description, a.instructions, (toolsOf(a.tools) ?? []).join(","),
  activationOf(a.activation), effortOf(a.effort) ?? "",
  workspacePolicyOf(a.workspacePolicy), String(maxTurnsOf(a.maxTurns) ?? ""),
  String(timeoutSecondsOf(a.timeoutSeconds) ?? ""),
  ...mentionPart(a.mentions),
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

/**
 * Audit custom agent 2026-09-25 · P0-3 · sidik jari (`rowFingerprint`) setiap versi katalog yang
 * PERNAH dirilis, per agen. Delapan agen aplikasi didaftarkan lewat API (2026-09-05) sebelum seed
 * mengenalnya: id deterministik, tetapi tanpa stempel — dan seed membaca "tanpa stempel" sebagai
 * "disunting operator", sehingga baris itu tak pernah lagi menerima perbaikan katalog.
 *
 * Baris tanpa stempel DIADOPSI hanya bila isinya byte-identik dengan salah satu versi di sini
 * (atau dengan versi terpasang). Suntingan operator sekecil apa pun mengubah sidik jari → tak
 * teradopsi → tak tersentuh. `model`/`runtime` di luar sidik jari, jadi override registrasi
 * (`runtime=claude`/`model=sonnet`) tetap bertahan. Isi dikunci
 * `server/test/fixtures/builtin-app-agents-history.json` (hasil `git show <sha>:shared/src/builtin-app-agents.ts`).
 */
export const BUILTIN_FINGERPRINT_HISTORY: Readonly<Record<string, readonly string[]>> = {
  //                       0b90ab3c (app roles)  ff98a8f6 (ADR-0167, s.d. 8cea296c)
  "product-designer":     ["6cc1027cf73ce6fd", "dfd313ae2b402734"],
  "feature-builder":      ["8a28ec2d98cb7055", "6d9c335a4577e695"],
  "performance-engineer": ["82e1f7418f7c8769", "005ed47095939e66"],
  "product-analyst":      ["96a3b765139f5d74", "83324b9f112bd340"],
  "solution-architect":   ["184a27b8830309e8", "4871cbe89c9da02f"],
  "operations-engineer":  ["c21bfe010211d33a", "d47396055a549866"],
  "support-triager":      ["6fab97e398ed88ad", "42a08ae21d354f06"],
  "knowledge-maintainer": ["f6bf5100faa2028e", "e1c696442299cd53"],
};

export async function seedBuiltinAgents(): Promise<void> {
  try {
    const setting = await getSetting();
    const stamps: Record<string, string> = { ...setting.builtinAgents };
    const policies: Record<string, string> = { ...setting.builtinAgentPolicies };
    let changed = false;
    // Stempel ditulis PER ITERASI (bukan sekali di akhir): galat di agen ke-k tak boleh membuang
    // stempel agen 1..k-1 yang barisnya sudah ter-upgrade — baris tanpa stempel yang cocok itu
    // terbaca "disunting operator" selamanya.
    const flush = async () => {
      if (!changed) return;
      const data = { ...setting, builtinAgents: stamps, builtinAgentPolicies: policies };
      await prisma.setting.upsert({
        where: { id: 1 }, update: { data }, create: { id: 1, data },
      });
      changed = false;
    };

    for (const a of BUILTIN_AGENTS) {
      await flush();
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
          tools: [...a.tools] as never, model: null, mentions: [...(a.mentions ?? [])] as never, runtime: null,
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
      if (!stamps[a.name]) {
        const current = rowFingerprint(row);
        if (current === fp || (BUILTIN_FINGERPRINT_HISTORY[a.name] ?? []).includes(current)) {
          stamps[a.name] = current;
          changed = true;
        }
      }
      const stamped = stamps[a.name];
      const unedited = Boolean(stamped)
        && (stamped === rowFingerprint(row) || stamped === legacyRowFingerprint(row));
      const data: Record<string, unknown> = {};

      if (unedited && stamped !== fp) {
        Object.assign(data, {
          description: a.description, instructions: a.instructions,
          tools: [...a.tools], activation: a.activation, effort: a.effort,
          workspacePolicy: a.workspacePolicy, maxTurns: a.maxTurns,
          timeoutSeconds: a.timeoutSeconds, mentions: [...(a.mentions ?? [])],
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

    await flush();
  } catch {
    // ADR-0094 keputusan 7 · katalog agen tak pernah boleh menggagalkan boot maupun kelahiran
    // sesi. Gagal di sini = katalog apa adanya, bukan server yang tak menyala.
  }
}
