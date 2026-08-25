// ADR-0099 · katalog tool domain `notifications`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, obj } from "../mcp-schema";
import { shapeNotification } from "../mcp-shape";
import { localPage } from "./helpers";
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
    description: "Tandai SELURUH notifikasi sebagai sudah dibaca. Tak ada varian per-item.",
    inputSchema: obj({ properties: {} }),
    mode: "write", capability: "notifications:write", samplePath: "/notifications/read", sampleMethod: "POST",
    build: () => ({ method: "POST", path: "/notifications/read", body: {} }),
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
