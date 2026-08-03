// SPEC-293 · deep-link backlog lewat hash fragment (SPA hanoman tak punya router; ADR-0071).
// URL kanonik satu backlog = `${origin}${pathname}#spec=<SPEC-ID>`. App mem-parse-nya sekali saat
// mount lalu membuka SpecDetail. Modul murni ini dipakai App (parse) + Triase (build).

// Ekstrak SPEC-ID dari hash `#spec=<id>` (juga `#a=1&spec=<id>`). null bila tak ada.
export function parseSpecHash(hash: string): string | null {
  const m = /(?:^|[#&])spec=([^&]+)/.exec(hash || "");
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

// Bangun URL absolut ke satu backlog dari lokasi saat ini.
export function specDeepLink(id: string, loc: { origin: string; pathname: string } = window.location): string {
  return `${loc.origin}${loc.pathname}#spec=${encodeURIComponent(id)}`;
}

// SPEC-519 · deep-link changelog, pola & siklus hidup yang sama dengan `#spec=` (ADR-0071):
// `#changelog=<projectId>` membuka halaman changelog project itu, `&cl=<id>` langsung memilih satu
// rilis. Di-parse SEKALI saat mount lalu hash dibersihkan agar tak memicu ulang.
export function parseChangelogHash(hash: string): { projectId: string; changelogId: string | null } | null {
  const m = /(?:^|[#&])changelog=([^&]+)/.exec(hash || "");
  if (!m || !m[1]) return null;
  const c = /(?:^|[#&])cl=([^&]+)/.exec(hash);
  return { projectId: decodeURIComponent(m[1]), changelogId: c && c[1] ? decodeURIComponent(c[1]) : null };
}

// Bangun URL absolut ke halaman changelog (opsional: satu rilis) dari lokasi saat ini.
export function changelogDeepLink(projectId: string, changelogId?: string | null,
  loc: { origin: string; pathname: string } = window.location): string {
  const cl = changelogId ? `&cl=${encodeURIComponent(changelogId)}` : "";
  return `${loc.origin}${loc.pathname}#changelog=${encodeURIComponent(projectId)}${cl}`;
}
