// SPEC-293 · deep-link backlog. Sejak ADR-0160 dashboard punya router URL: URL kanonik satu backlog
// = `${origin}/backlog/<SPEC-ID>` (dibangun `routes.ts`). Bentuk hash lama ADR-0071
// (`#spec=<id>`, `#changelog=<projectId>[&cl=<id>]`) TETAP di-parse App saat mount dan ditulis ulang
// ke path — link yang sudah beredar di email/tiket tak boleh mati. Modul murni: App (parse) +
// Triase/Changelog/Scheduler (build).
import { absoluteRouteUrl } from "../routes";

// Ekstrak SPEC-ID dari hash `#spec=<id>` (juga `#a=1&spec=<id>`). null bila tak ada.
export function parseSpecHash(hash: string): string | null {
  const m = /(?:^|[#&])spec=([^&]+)/.exec(hash || "");
  return m && m[1] ? decodeURIComponent(m[1]) : null;
}

// Bangun URL absolut ke satu backlog dari lokasi saat ini.
export function specDeepLink(id: string, loc: { origin: string } = window.location): string {
  return absoluteRouteUrl({ section: "backlog", specId: id }, loc);
}

// SPEC-519 · deep-link changelog, siklus hidup yang sama dengan `#spec=` (ADR-0071):
// `#changelog=<projectId>` membuka halaman changelog project itu, `&cl=<id>` langsung memilih satu
// rilis. Di-parse SEKALI saat mount lalu dialihkan ke `/changelog/<projectId>[/<id>]`.
export function parseChangelogHash(hash: string): { projectId: string; changelogId: string | null } | null {
  const m = /(?:^|[#&])changelog=([^&]+)/.exec(hash || "");
  if (!m || !m[1]) return null;
  const c = /(?:^|[#&])cl=([^&]+)/.exec(hash);
  return { projectId: decodeURIComponent(m[1]), changelogId: c && c[1] ? decodeURIComponent(c[1]) : null };
}

// Bangun URL absolut ke halaman changelog (opsional: satu rilis) dari lokasi saat ini.
export function changelogDeepLink(projectId: string, changelogId?: string | null,
  loc: { origin: string } = window.location): string {
  return absoluteRouteUrl({ section: "changelog", projectId, changelogId: changelogId ?? null }, loc);
}
