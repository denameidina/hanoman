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
    name: "hanoman_limits_antigravity",
    title: "Sisa kuota Antigravity",
    description:
      "Sisa kuota Antigravity CLI (agy) per grup model (Gemini; Claude/GPT) untuk jendela mingguan dan 5 jam, berikut kapan resetnya. Dibaca live dari Cloud Code API Google memakai token agy yang sedang hidup dan di-cache 60 detik; token yang kedaluwarsa (agy tak berjalan) memberi `stale` atau `unavailable`, bukan angka karangan. Endpoint terpisah dari hanoman_limits karena sumbernya beda. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/limits/antigravity", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/limits/antigravity" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_overview_get",
    title: "Ringkasan kinerja hari ini (Overview)",
    description:
      "Agregat kinerja workspace hari ini vs kemarin, persis yang tampil di layar Overview \"Koran Pagi\": spec mendarat, sesi agen tumbang, menit agen menunggu jawaban manusia, token agen tercatat (hanya subagen/agen fase), prakiraan kapan limit habis dibanding reset, peta panas jam kerja agen 7×24, streak/rekor, dan headline-nya. Menit menunggu & prakiraan limit direkam di memori server dan hilang saat restart (`recordingSince`). Panel `null` = sumbernya gagal dibaca. Tak menuntut capability apa pun.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: null, samplePath: "/overview", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/overview" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_update_status",
    title: "Status versi & pembaruan",
    description:
      "Versi hanoman yang berjalan, versi terbaru di registry npm, dan apakah instance ini PUNYA supervisor yang bisa memasangnya (`canApply`). Baca-saja dan tak menuntut capability apa pun. Memasang pembaruan me-restart instance: itu hanoman_update_apply (capability `instance:admin`, tingkat `--danger`), dan hanya bila `canApply` true.",
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
