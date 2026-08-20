import { prisma } from "../db";

// SPEC-617 · ADR-0110 · allowlist permukaan untuk `User.role === "client"`. Cermin
// `capabilityForRoute` (SPEC-257/ADR-0065), tapi berbentuk **allowlist** bukan peta: route baru
// tertutup bagi klien sampai seseorang sengaja menaruhnya di sini. Denylist akan menyebar
// kewajiban ke setiap route yang lahir nanti — kelas bug "satu definisi, N call site".
// `path` = req.url tanpa query, memuat prefix `/api`.

const segments = (path: string) =>
  path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);

// SPEC-626 · ADR-0111 · satu-satunya jalur TULIS di permukaan klien, dinyatakan sebagai BENTUK
// PATH yang persis — bukan "portal boleh POST". Route portal apa pun yang lahir nanti tetap
// tertutup sampai seseorang sengaja menambahkan bentuknya di sini (deny-by-default, ADR-0110).
const isPortalTicketSubmit = (method: string, seg: string[]): boolean =>
  method === "POST" && seg.length === 4 && seg[1] === "projects" && seg[3] === "tickets";

// SPEC-854 · ADR-0129 · dua bentuk tulis chat, masing-masing PERSIS. Alasan yang sama dengan
// ADR-0111: melonggarkan METHOD membuat setiap route portal yang lahir nanti ikut terbuka tanpa
// seorang pun memutuskannya. `POST …/sessions/:sid/prd` (materialisasi PRD) sengaja TIDAK ada di
// sini — itu keputusan operator, bukan klien.
const isPortalChatStart = (method: string, seg: string[]): boolean =>
  method === "POST" && seg.length === 5 && seg[1] === "projects"
  && seg[3] === "chat" && seg[4] === "sessions";

const isPortalChatSend = (method: string, seg: string[]): boolean =>
  method === "POST" && seg.length === 7 && seg[1] === "projects"
  && seg[3] === "chat" && seg[4] === "sessions" && seg[6] === "messages";

export function clientRouteAllowed(method: string, path: string): boolean {
  const seg = segments(path);
  // `..` tak pernah muncul di route sah; menolaknya di sini menutup normalisasi path yang
  // berbeda antara gate dan router.
  if (seg.includes("..")) return false;
  const top = seg[0] ?? "";
  const read = method === "GET" || method === "HEAD";

  if (top === "portal")
    return read || isPortalTicketSubmit(method, seg)
      || isPortalChatStart(method, seg) || isPortalChatSend(method, seg);
  // Help Center sudah publik tanpa login (app.ts mem-bypass gate untuknya). Menolaknya di sini
  // membuat klien yang login justru punya hak LEBIH SEDIKIT daripada pengunjung anonim.
  if (top === "help") return true;
  if (top === "auth") {
    const sub = seg[1] ?? "";
    return method === "POST" && (sub === "logout" || sub === "change-password");
  }
  return false;
}

/** Id project yang boleh dilihat sebuah akun klien. Urut naik supaya respons stabil. */
export async function clientProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.clientProjectAccess.findMany({
    where: { userId }, select: { projectId: true }, orderBy: { projectId: "asc" },
  });
  return rows.map((r) => r.projectId);
}

export async function hasProjectAccess(userId: string, projectId: string): Promise<boolean> {
  return (await prisma.clientProjectAccess.count({ where: { userId, projectId } })) > 0;
}
