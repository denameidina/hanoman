import {
  zLeadProject, LEAD_AUTHORITY_DEFAULTS,
  type Lead, type LeadProject, type LeadAction, type LeadAuthorityMode,
} from "@hanoman/shared";

// ADR-0228 · setelan lead PER PROYEK (`Setting.lead.projects[<id>]`). Satu penggabung supaya
// default tak pernah disalin ke tiap pemanggil (kelas bug SPEC-431/448/475).
export function leadProjectConfig(cfg: Lead, projectId: string): LeadProject {
  return zLeadProject.parse(cfg.projects?.[projectId] ?? {});
}

/** Mode wewenang satu tindakan untuk satu proyek; tindakan yang tak disebut memakai default. */
export function authorityFor(cfg: Lead, projectId: string, action: LeadAction): LeadAuthorityMode {
  return leadProjectConfig(cfg, projectId).authority[action] ?? LEAD_AUTHORITY_DEFAULTS[action];
}
