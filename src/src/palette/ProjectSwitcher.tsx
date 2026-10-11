// Project switcher tunggal di topbar (Audit UI/UX 2026-10 · Fase 2C). Ia hanya mengubah
// `projectFilter` App — state yang sama yang dipersistensi lewat ui-state dan dibaca Backlog,
// Tim, dan PRD. Tak ada state scope kedua: App menyediakan nilainya lewat konteks di bawah.
import React from "react";
import { Select } from "../ds/components/forms";

export type ProjectScopeValue = {
  /** `projectFilter` aktif: "all" = semua project. */
  value: string;
  projects: readonly { id: string; name: string }[];
  onChange: (projectId: string) => void;
};

/** Diisi App. Null = tak ada switcher (mis. Shell yang dirender sendirian di test). */
export const ProjectScopeContext = React.createContext<ProjectScopeValue | null>(null);

/**
 * Layar yang benar-benar membaca `projectFilter`. Switcher hanya tampil di sini: di layar lain ia
 * akan mengubah sesuatu yang tak terlihat, dan kontrol yang tak berefek adalah kebohongan UI.
 */
export const PROJECT_SCOPED_KEYS: ReadonlySet<string> = new Set(["backlog", "team", "prd"]);

export function scopeProjectName(scope: ProjectScopeValue): string | undefined {
  return scope.value === "all" ? undefined : scope.projects.find((p) => p.id === scope.value)?.name ?? scope.value;
}

export function ProjectSwitcher({ scope }: { scope: ProjectScopeValue }) {
  const options = React.useMemo(() => [
    { value: "all", label: "Semua project" },
    ...scope.projects.map((p) => ({ value: p.id, label: p.name })),
  ], [scope.projects]);
  return (
    <Select
      size="sm"
      aria-label="Project aktif"
      className="hn-shell-scope"
      value={scope.value}
      options={options}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => scope.onChange(e.target.value)}
    />
  );
}
