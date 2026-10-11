// ADR-0099 · katalog tool domain `notifications`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, obj, str } from "../mcp-schema";
import { shapeNotification } from "../mcp-shape";
import { enc, localPage } from "./helpers";
import type { McpToolDef } from "./types";

const CORE: readonly McpToolDef[] = [
  {
    name: "hanoman_notifications_list",
    title: "Notifikasi",
    description:
      "Notifikasi terbaru (50 teratas dari server) berikut jumlah yang belum dibaca. `type`: `done` (backlog selesai), `decision` (sesi menunggu jawaban manusia), `ticket`, `fail`, `lead`.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "notifications:read", samplePath: "/notifications", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/notifications" }),
    shape: (raw, a) => localPage(raw, a, shapeNotification, (r) => ({ unread: r.unread ?? 0 })),
  },
  {
    name: "hanoman_notifications_mark_read",
    title: "Tandai notifikasi terbaca",
    description: "Tandai SELURUH notifikasi sebagai sudah dibaca. Untuk satu notifikasi saja pakai hanoman_notification_mark_read.",
    inputSchema: obj({ properties: {} }),
    mode: "write", capability: "notifications:write", samplePath: "/notifications/read", sampleMethod: "POST",
    build: () => ({ method: "POST", path: "/notifications/read", body: {} }),
    shape: (raw) => raw,
  },
  // ADR-0204 · varian per-item. Idempoten (waktu baca pertama dipertahankan); id tak dikenal = 404.
  {
    name: "hanoman_notification_mark_read",
    title: "Tandai satu notifikasi terbaca",
    description:
      "Tandai SATU notifikasi sebagai sudah dibaca, berdasarkan `id` dari hanoman_notifications_list. Notifikasi yang sudah terbaca dijawab sukses tanpa mengubah waktu bacanya; id yang tak ada dijawab 404. Untuk seluruh daftar sekaligus pakai hanoman_notifications_mark_read.",
    inputSchema: obj({ properties: { id: str("Id notifikasi, dari hanoman_notifications_list.") }, required: ["id"] }),
    mode: "write", capability: "notifications:write",
    samplePath: "/notifications/n1/read", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/notifications/${enc(String(a.id))}/read` }),
    shape: (raw) => raw,
  },
];

// ADR-0155 · pembersihan notifikasi. Destruktif tapi capability-nya tetap `notifications:write`:
// tak ada pecahan `danger` di domain ini, jadi mode `danger`-nya murni ergonomi.
const MORE: readonly McpToolDef[] = [
  {
    name: "hanoman_notifications_clear",
    title: "Bersihkan notifikasi (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus SELURUH notifikasi secara permanen, bukan sekadar menandainya terbaca. Untuk menandai terbaca tanpa menghapus, pakai hanoman_notifications_mark_read. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: {} }),
    mode: "danger", capability: "notifications:write",
    samplePath: "/notifications", sampleMethod: "DELETE",
    build: () => ({ method: "DELETE", path: "/notifications" }),
    shape: (raw) => raw,
  },
];

export const NOTIFICATIONS_TOOLS: readonly McpToolDef[] = [...CORE, ...MORE];
