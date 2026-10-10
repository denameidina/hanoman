// SPEC-293 · deep-link backlog. Sejak ADR-0160 dashboard punya router URL: URL kanonik satu backlog
// = `${origin}/backlog/<SPEC-ID>` (dibangun `routes.ts`). Bentuk hash lama ADR-0071
// (`#spec=<id>`) TETAP di-parse App saat mount dan ditulis ulang
// ke path — link yang sudah beredar di email/tiket tak boleh mati. Modul murni: App (parse) +
// Triase/Scheduler (build).
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
