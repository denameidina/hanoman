// ADR-0099 · katalog tool domain `projects`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, bool, enumStr, obj, str } from "../mcp-schema";
import { shapeProject, shapeProjectDetail } from "../mcp-shape";
import { enc, localPage, s } from "./helpers";
import type { McpToolDef } from "./types";

const CORE: readonly McpToolDef[] = [
  {
    name: "hanoman_projects_list",
    title: "Daftar proyek",
    description:
      "Daftar seluruh proyek yang dikelola hanoman, dipadatkan ke field yang dipakai agen: id, nama, jenis, jumlah backlog, stage tertinggi, coverage docs, dan opt-in scheduler/lead. Untuk detail satu proyek pakai hanoman_project_get.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "projects:read", samplePath: "/projects", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/projects" }),
    shape: (raw, a) => localPage(raw, a, shapeProject),
  },
  {
    name: "hanoman_project_get",
    title: "Detail proyek",
    description:
      "Detail satu proyek: stack, remote git, status & coverage docs, ringkasan sesi berjalan, aktivitas terakhir, dan opt-in scheduler/lead. Path repo per-mesin sengaja tidak dikembalikan.",
    inputSchema: obj({
      properties: { project: str("Id proyek (slug huruf kecil), mis. `hanoman`. Ambil dari hanoman_projects_list.") },
      required: ["project"],
    }),
    mode: "read", capability: "projects:read", samplePath: "/projects/hanoman", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}` }),
    shape: (raw) => shapeProjectDetail((raw ?? {}) as Record<string, unknown>),
  },
];

// ADR-0155 · sisa permukaan domain `projects`. Dua tool bermode `danger` dengan capability
// `projects:write` biasa — tak ada pecahan `danger` di domain ini (`projects:destroy` sengaja TIDAK
// dibuat), jadi mode `danger`-nya murni ergonomi: ia mencegah salah pilih, bukan menahan niat.
// Keduanya karena itu terdaftar di `DESTRUCTIVE_BUT_WRITE` pada uji katalog.
const MORE: readonly McpToolDef[] = [
  {
    name: "hanoman_project_create",
    title: "Buat project",
    description:
      "Membuat project baru. Id-nya DITURUNKAN server dari `name` (huruf kecil, spasi jadi tanda hubung) — jangan mengirim id. `kind: \"from-scratch\"` dengan `repoDir` akan menjalankan git init di direktori itu; `existing` tidak. Menjawab 409 bila id turunannya sudah dipakai.",
    inputSchema: obj({
      properties: {
        name: str("Nama project. Id diturunkan darinya."),
        kind: enumStr(["from-scratch", "existing"], "`from-scratch` = repo di-git-init; `existing` = repo sudah ada."),
        repoDir: str("Path absolut repo di mesin server. Kosongkan bila belum ada."),
        gitRemote: str("URL remote resmi, dipakai hanoman_project_clone di device lain."),
        desc: str("Deskripsi singkat."),
      },
      required: ["name", "kind"],
    }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/projects",
      body: {
        name: String(a.name), kind: String(a.kind),
        ...(s(a.repoDir) ? { repoDir: s(a.repoDir) } : {}),
        ...(s(a.gitRemote) ? { gitRemote: s(a.gitRemote) } : {}),
        ...(s(a.desc) ? { desc: s(a.desc) } : {}),
      },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_update",
    title: "Ubah project",
    description:
      "Mengubah field project. TIDAK bisa mengganti id — itu operasi tersendiri (hanoman_project_rename). Body kosong sah dan berarti no-op. `repoDir` di sini adalah default server, bukan binding per-device.",
    inputSchema: obj({
      properties: {
        project: str("Id project."),
        name: str("Nama tampilan baru."),
        desc: str("Deskripsi baru."),
        gitRemote: str("URL remote resmi."),
        repoDir: str("Path repo default di server."),
        schedulerOptIn: bool("Ikutkan project ini di scheduler otonom (lokal, tak disync)."),
        leadOptIn: bool("Ikutkan project ini di hanoman-lead (lokal, tak disync)."),
      },
      required: ["project"],
    }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      for (const k of ["name", "desc", "gitRemote", "repoDir"]) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      for (const k of ["schedulerOptIn", "leadOptIn"]) if (typeof a[k] === "boolean") body[k] = a[k];
      return { method: "PATCH", path: `/projects/${enc(String(a.project))}`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_branches",
    title: "Branch project",
    description:
      "Branch lokal & remote project beserta default branch-nya. repoDir kosong atau bukan repo git menjawab daftar KOSONG, bukan galat.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "read", capability: "projects:read",
    samplePath: "/projects/hanoman/branches", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/branches` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_binding_get",
    title: "Binding repo lokal",
    description:
      "Override repoDir khusus MESIN INI. `repoDir: null` berarti tak ada override dan path efektifnya jatuh ke Project.repoDir. Binding bersifat lokal per-device dan TIDAK disync antar-instance.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "read", capability: "projects:read",
    samplePath: "/projects/hanoman/binding", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/binding` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_binding_set",
    title: "Setel binding repo lokal",
    description:
      "Menunjuk checkout lokal yang dipakai instance ini untuk project tersebut. Lokal per-device, tak disync. Tak memindahkan berkas apa pun — ia hanya mengubah path yang dipakai sesi & operasi git.",
    inputSchema: obj({
      properties: { project: str("Id project."), repoDir: str("Path absolut checkout di mesin ini.") },
      required: ["project", "repoDir"],
    }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman/binding", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: `/projects/${enc(String(a.project))}/binding`, body: { repoDir: String(a.repoDir) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_binding_clear",
    title: "Hapus binding repo lokal",
    description:
      "Membuang override per-mesin sehingga path efektif jatuh kembali ke Project.repoDir. Tak menghapus berkas apa pun di disk.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman/binding", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/projects/${enc(String(a.project))}/binding` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_clone",
    title: "Clone repo project ke mesin ini",
    description:
      "Menjalankan `git clone` dari `gitRemote` project ke direktori yang kamu sebut, lalu memasangnya sebagai binding lokal. Menjawab 409 bila project tak punya gitRemote, atau bila clone-nya gagal (stderr git ikut di `detail`).",
    inputSchema: obj({
      properties: { project: str("Id project."), dir: str("Direktori tujuan clone di mesin ini.") },
      required: ["project", "dir"],
    }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman/clone", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/projects/${enc(String(a.project))}/clone`, body: { dir: String(a.dir) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_help_center_get",
    title: "Status Help Center project",
    description: "Apakah Help Center publik project aktif, beserta URL publiknya.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "read", capability: "projects:read",
    samplePath: "/projects/hanoman/help-center", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/projects/${enc(String(a.project))}/help-center` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_help_center_enable",
    title: "Aktifkan Help Center project",
    description:
      "Menyalakan Help Center PUBLIK project — halaman yang bisa dibuka siapa pun tanpa login untuk mengirim tiket. URL-nya terikat id project.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman/help-center", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/projects/${enc(String(a.project))}/help-center` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_help_center_disable",
    title: "Nonaktifkan Help Center project",
    description: "Mematikan Help Center publik project. Tiket yang sudah masuk TIDAK dihapus.",
    inputSchema: obj({ properties: { project: str("Id project.") }, required: ["project"] }),
    mode: "write", capability: "projects:write",
    samplePath: "/projects/hanoman/help-center", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/projects/${enc(String(a.project))}/help-center` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_rename",
    title: "Ganti id project (BERBAHAYA)",
    description:
      "BERBAHAYA — mengganti id project. Id project adalah kunci yang MENYEBERANG SYNC: instance lain yang belum melihat rename akan memperlakukan project ini sebagai project BARU, dan riwayat sync-nya tak menyatu kembali sendiri. URL Help Center publiknya juga berubah, sehingga tautan lama mati. Ditolak bila ada sesi aktif. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: str("Id project sekarang."),
        newId: str("Id baru. Huruf kecil/angka, tanda hubung hanya di tengah — bukan di awal atau akhir."),
      },
      required: ["project", "newId"],
    }),
    mode: "danger", capability: "projects:write",
    samplePath: "/projects/hanoman/rename", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/projects/${enc(String(a.project))}/rename`, body: { newId: String(a.newId) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_project_delete",
    title: "Hapus project (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus project beserta SELURUH backlog, tiket, custom agent, dan task miliknya lewat cascade. Penghapusan ini MENYEBERANG SYNC: instance lain akan ikut kehilangannya. Ditolak 409 bila masih ada sesi aktif. Berkas di disk tidak dihapus. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { project: str("Id project yang dihapus.") }, required: ["project"] }),
    mode: "danger", capability: "projects:write",
    samplePath: "/projects/hanoman", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/projects/${enc(String(a.project))}` }),
    shape: (raw) => raw,
  },
];

export const PROJECTS_TOOLS: readonly McpToolDef[] = [...CORE, ...MORE];
