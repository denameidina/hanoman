// ADR-0099 · katalog tool domain `about`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { obj } from "../mcp-schema";
import type { McpToolDef } from "./types";

export const ABOUT_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_about",
    title: "Tentang sambungan ini",
    description:
      "Instance hanoman mana yang sedang tersambung, versi skema tool, mode (baca-tulis / baca-saja), dan daftar tool yang aktif. Panggil ini lebih dulu bila ada tool yang menjawab 401 atau 403 — jawabannya menyebut host yang dipakai. Tool ini tak butuh token dan tak pernah menampilkan token.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/health", sampleMethod: "GET",
    build: () => null,
    shape: (raw) => raw,
  },
];
