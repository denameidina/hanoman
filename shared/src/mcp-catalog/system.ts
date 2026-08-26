// ADR-0157 · katalog tool domain `system` — route yang `capabilityForRoute` nyatakan `GLOBAL_READ`:
// terjangkau SETIAP agent token yang sah, tanpa satu pun capability dicentang.
//
// Kenapa mereka lahir belakangan: gerbang cakupan (`server/test/mcp-coverage.test.ts`) me-`continue`
// pada `GLOBAL_READ`, jadi keempat route ini terlihat "tercakup" sementara tak ada tool yang
// menyentuhnya. Agen bisa memanggilnya dengan curl sejak hari pertama — yang hilang bukan
// kemampuannya, melainkan skema yang membimbing (persis argumen ADR-0155). Gerbang itu diperketat
// bersama berkas ini.
//
// `capability: null` di sini BERBEDA artinya dari `hanoman_about`: about tak memanggil `/api` sama
// sekali, keempat ini memanggil tapi tak menuntut apa pun. Assert di mcp-coverage menjaga agar null
// tak pernah bisa dipakai menyelundupkan route yang sebenarnya bergerbang.
import { obj, str } from "../mcp-schema";
import type { McpToolDef } from "./types";

export const SYSTEM_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_limits",
    title: "Sisa kuota langganan Claude",
    description:
      "Sisa kuota langganan Claude milik mesin ini berikut kapan jendelanya reset. Dibaca realtime dan di-cache 30 detik di server. Dipakai untuk memutuskan APAKAH pekerjaan berat layak dimulai sekarang — bukan gerbang: hanoman tak pernah menolak membuka sesi karena angka ini. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/limits", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/limits" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_limits_codex",
    title: "Sisa kuota Codex",
    description:
      "Sisa kuota codex, dibaca dari snapshot `rate_limits` di rollout sesi codex terakhir — TANPA panggilan jaringan, jadi kesegarannya seumur sesi codex terakhir di mesin ini, bukan realtime. Endpoint terpisah dari hanoman_limits karena sumber dan semantik kesegarannya memang beda. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/limits/codex", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/limits/codex" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_update_status",
    title: "Status versi & pembaruan",
    description:
      "Versi hanoman yang berjalan, versi terbaru di registry npm, dan apakah instance ini PUNYA supervisor yang bisa memasangnya (`canApply`). Baca-saja: memasang pembaruan me-restart instance dan sengaja tetap tindakan manusia di dashboard — tak ada tool untuk itu, apa pun tingkat modenya. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/update", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/update" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_fs_browse",
    title: "Telusuri folder mesin ini",
    description:
      "Sub-folder nyata di MESIN tempat hanoman berjalan, berikut path absolutnya — dipakai untuk mengisi `repoDir` saat mengikat project ke codebase yang sudah ada (hanoman_project_binding_set), yang tanpa ini hanya bisa ditebak. Hanya direktori, berkas tak ikut; yang berawalan titik disembunyikan. Tanpa `path`, ia mulai dari home. Tak menuntut capability apa pun.",
    inputSchema: obj({
      properties: {
        path: str("Path absolut folder yang dibuka. Kosong = folder home pengguna yang menjalankan hanoman. Folder yang tak terbaca menjawab 400, bukan daftar kosong."),
      },
    }),
    mode: "read", capability: null, samplePath: "/fs/browse", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/fs/browse",
      ...(typeof a.path === "string" && a.path !== "" ? { query: { path: a.path } } : {}),
    }),
    shape: (raw) => raw,
  },
];
