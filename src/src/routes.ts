// ADR-0160 · navigasi dashboard lewat URL (react-router), menggantikan `section` sebagai satu-satunya
// sumber kebenaran halaman. Modul ini MURNI (tanpa React, tanpa router) supaya pemetaan
// path ⇄ section bisa diuji langsung; App yang menyambungkannya ke `useLocation`/`useNavigate`.
//
// Bentuk URL:
//   /<section>                         halaman bernavigasi (`HN_NAV`, mis. /backlog, /settings)
//   /projects/<projectId>              detail satu project (section transien `project`)
//   /backlog/<specId>                  Backlog dengan SpecDetail item itu terbuka
//   /changelog/<projectId>[/<clId>]    changelog satu project, opsional satu rilis terpilih
//   /review/<spec|session>/<id>        layar review worktree (section transien `review`)
//   /                                  → dialihkan ke halaman terakhir yang tersimpan (ADR-0115)
//
// Hash lama `#spec=<id>` / `#changelog=<projectId>[&cl=<id>]` (ADR-0071) TETAP dibaca saat mount
// lalu ditulis ulang ke bentuk path di atas — link yang sudah beredar tak boleh mati.

// Satu bentuk longgar, bukan discriminated union: pembaca di App mengakses parameter lewat
// `route?.projectId` tanpa harus menyempitkan `section` dulu; `parseRoute` yang menjamin field
// mana yang terisi untuk section mana (dikunci `routes.test.ts`).
export type Route = {
  section: string;
  /** `project` dan `changelog` */
  projectId?: string;
  /** `backlog` dengan SpecDetail terbuka */
  specId?: string;
  /** `changelog`: rilis terpilih, null = daftar saja */
  changelogId?: string | null;
  /** `review` */
  kind?: "spec" | "session";
  id?: string;
};

const seg = (s: string) => encodeURIComponent(s);
const unseg = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Path untuk sebuah rute. Kebalikan persis dari `parseRoute`. */
export function routePath(r: Route): string {
  switch (r.section) {
    case "project": return `/projects/${seg(r.projectId!)}`;
    case "backlog": return r.specId ? `/backlog/${seg(r.specId)}` : "/backlog";
    case "changelog":
      if (!r.projectId) return "/changelog";
      return `/changelog/${seg(r.projectId)}${r.changelogId ? `/${seg(r.changelogId)}` : ""}`;
    case "review": return `/review/${r.kind}/${seg(r.id!)}`;
    default: return `/${r.section}`;
  }
}

/**
 * Rute dari `pathname`. `null` = tak dikenal (termasuk `/`): App mengalihkannya ke halaman
 * terakhir yang tersimpan, jadi key mati (`runs`/`triggers`, SPEC-162) tak pernah mendarat di
 * layar kosong. `navKeys` = `NAV_KEYS` dari `ds/shell.tsx`, diteruskan supaya modul ini bebas impor DS.
 */
export function parseRoute(pathname: string, navKeys: readonly string[]): Route | null {
  const parts = pathname.split("/").filter(Boolean).map(unseg);
  if (parts.length === 0) return null;
  const [head, a, b] = parts;
  if (parts.length === 1) return navKeys.includes(head!) ? { section: head! } : null;
  if (head === "projects" && parts.length === 2) return { section: "project", projectId: a };
  if (head === "backlog" && parts.length === 2) return { section: "backlog", specId: a };
  if (head === "changelog" && parts.length <= 3) return { section: "changelog", projectId: a, changelogId: b ?? null };
  if (head === "review" && parts.length === 3 && (a === "spec" || a === "session")) return { section: "review", kind: a, id: b };
  return null;
}

/** URL absolut yang bisa dibagikan untuk sebuah rute (dipakai tombol "salin link"). */
export function absoluteRouteUrl(r: Route, loc: { origin: string } = window.location): string {
  return `${loc.origin}${routePath(r)}`;
}
