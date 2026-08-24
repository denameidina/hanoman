import type { PresenceView } from "@hanoman/shared";

/* SPEC-919 · ADR-0147 · indeks murni supaya penanda di Backlog/Projects punya SATU rumus.
   `activeSpecs` di App tetap ada dan tetap berarti hal lain: "ada sesi di MESIN INI yang bisa
   dibuka" — ia menggerbangi tombol, bukan penanda. */

const push = (m: Map<string, string[]>, key: string, name: string) => {
  const names = m.get(key);
  if (!names) { m.set(key, [name]); return; }
  if (!names.includes(name)) names.push(name);
};

export function presenceIndex(view: PresenceView): {
  bySpec: Map<string, string[]>; byProject: Map<string, string[]>;
} {
  const bySpec = new Map<string, string[]>();
  const byProject = new Map<string, string[]>();
  if (!view.enabled) return { bySpec, byProject };
  for (const d of view.devices) {
    if (!d.online) continue;
    for (const s of d.sessions) {
      if (s.status === "exited") continue;
      if (s.specId) push(bySpec, s.specId, d.name);
      push(byProject, s.projectId, d.name);
    }
  }
  return { bySpec, byProject };
}
