// SPEC-739 · ADR-0114 — vonis kesiapan metode: katalog ↔ hasil deteksi.
//
// MURNI dan di `shared` karena bentuk yang sama dipakai server (endpoint) DAN web (checklist
// Settings, catatan picker Start). Berkas ini tak menyentuh filesystem sama sekali — yang
// memindai disk adalah `runner/src/skills.ts`.
import type { Agent } from "./entities";
import type { MethodDef } from "./method-catalog";

export interface MethodSkillStatus {
  readonly method: string;
  readonly label: string;
  readonly agent: Agent;
  readonly ready: boolean;
  /** Dari `MethodDef.requires` — nama PAKET. */
  readonly missingPackages: string[];
  /** Dari `phaseSkills` ∪ `exitSkills` — id SKILL yang benar-benar dipanggil prompt. */
  readonly missingSkills: string[];
  readonly install: string[];
}

export interface MethodStatusResponse {
  readonly agents: Array<{ agent: Agent; home: string; roots: string[]; skills: number }>;
  readonly methods: MethodSkillStatus[];
}

/** Skill konkret yang dipanggil prompt metode ini. */
export function methodSkills(m: MethodDef): string[] {
  return [...new Set([...Object.values(m.phaseSkills).flat(), ...m.exitSkills])];
}

/**
 * PENCOCOKAN KETAT & id persis. "Fail-open" spec ini adalah sifat GERBANG (Start tak pernah
 * ditolak), bukan sifat vonis: menganggap sesuatu terpasang tanpa bukti adalah persis kegagalan
 * senyap yang SPEC-739 ada untuk menghapus.
 *
 * AMANDEMEN — ketat tetap ketat, yang bertambah adalah BUKTInya. Semula instalasi datar `npx
 * skills add` dilaporkan kurang selamanya, karena skill-nya hanya bernama `<n>`. Ternyata jalur itu
 * meninggalkan `~/.agents/.skill-lock.json` yang menyebut `pluginName` tiap skill; `scanAgentSkills`
 * kini menerbitkan `<pkg>:<n>` DAN `<n>` dari situ. Yang tak berubah: tanpa lock, tak ada paket —
 * nama polos tak pernah dinaikkan pangkat dengan menebak.
 */
export function methodStatus(
  m: MethodDef, agent: Agent,
  installed: { skills: readonly string[]; packages: readonly string[] },
): MethodSkillStatus {
  const haveSkills = new Set(installed.skills);
  const havePackages = new Set(installed.packages);
  const missingPackages = m.requires.filter((p) => !havePackages.has(p));
  const missingSkills = methodSkills(m).filter((id) => !haveSkills.has(id));
  return {
    method: m.id, label: m.label, agent,
    ready: missingPackages.length === 0 && missingSkills.length === 0,
    missingPackages, missingSkills,
    install: [...m.install[agent]],
  };
}
