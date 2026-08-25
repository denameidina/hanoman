// ADR-0099 · ADR-0155 · katalog tool domain `agents`: persona custom yang dipakai sesi.
// Dipetakan MENURUT METHOD (ADR-0094): menulis definisi agen mengubah apa yang dilihat SETIAP sesi
// baru di seluruh workspace, jadi izin baca tak pernah cukup untuk itu.
import { bool, enumStr, obj, str, strArray } from "../mcp-schema";
import { enc, query, s } from "./helpers";
import type { McpToolDef } from "./types";

export const AGENTS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_agents_catalog",
    title: "Katalog bahan custom agent",
    description:
      "Bahan yang boleh dipakai saat membuat custom agent: daftar tool yang sah, model per runtime, dan runtime yang tersedia. Panggil ini SEBELUM hanoman_agent_create — tool atau model di luar katalog ditolak 400.",
    inputSchema: obj({
      properties: { project: str("Id project. Mengisinya memuat juga tool khusus repo project itu.") },
    }),
    mode: "read", capability: "agents:read",
    samplePath: "/custom-agents/catalog", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/custom-agents/catalog", query: query({ projectId: s(a.project) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agents_list",
    title: "Daftar custom agent",
    description:
      "Persona custom yang aktif. Tanpa `project` hanya yang global; dengan `project` ia menggabung global + milik project, dan nama yang ditimpa project muncul SEKALI dengan versi project yang menang.",
    inputSchema: obj({
      properties: { project: str("Id project. Kosongkan untuk hanya persona global.") },
    }),
    mode: "read", capability: "agents:read",
    samplePath: "/custom-agents", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/custom-agents", query: query({ projectId: s(a.project) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_create",
    title: "Buat custom agent",
    description:
      "Membuat persona agen baru. Definisinya dipakai SETIAP SESI BARU di seluruh workspace (atau di satu project bila `project` diisi) — persona yang keliru akan mempengaruhi setiap pekerjaan berikutnya, bukan hanya satu sesi. `tools` dan `model` divalidasi terhadap hanoman_agents_catalog. `runtime` adalah PENYARING mesin sesi, bukan pemilih proses: null berarti ikut sesi induk.",
    inputSchema: obj({
      properties: {
        name: str("Nama persona. Menjadi bagian id, dan TAK BISA diubah nanti — ganti nama = hapus lalu buat baru."),
        description: str("Deskripsi singkat (1–500 karakter)."),
        instructions: str("Instruksi persona (1–20.000 karakter). Inilah yang dibaca agen."),
        project: str("Id project. Kosongkan untuk persona GLOBAL yang berlaku di semua project."),
        tools: strArray("Tool yang boleh dipakai persona ini. Harus ada di hanoman_agents_catalog. Kosongkan untuk mewarisi."),
        model: str("Model. Harus sah untuk `runtime` yang dipilih."),
        mentions: strArray("Nama persona lain yang boleh dipanggil."),
        runtime: enumStr(["claude", "codex"], "Penyaring mesin sesi. Kosongkan untuk mengikuti sesi induk."),
        enabled: bool("Aktif atau tidak. Default aktif."),
      },
      required: ["name", "description", "instructions"],
    }),
    mode: "write", capability: "agents:write",
    samplePath: "/custom-agents", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = {
        name: String(a.name), description: String(a.description), instructions: String(a.instructions),
      };
      if (s(a.project)) body.projectId = s(a.project);
      for (const k of ["model", "runtime"]) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      for (const k of ["tools", "mentions"]) if (Array.isArray(a[k])) body[k] = a[k];
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      return { method: "POST", path: "/custom-agents", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_update",
    title: "Ubah custom agent",
    description:
      "Mengubah persona agen. `name` dan `project` TIDAK bisa diubah — id diturunkan dari keduanya, dan sync tak punya operasi hapus, sehingga rename akan meninggalkan baris yatim di setiap instance lain. Ganti nama = hapus lalu buat baru; server menolaknya eksplisit dengan 400, bukan mengabaikannya diam-diam.",
    inputSchema: obj({
      properties: {
        agent: str("Id custom agent, dari hanoman_agents_list."),
        description: str("Deskripsi baru."),
        instructions: str("Instruksi baru."),
        tools: strArray("Daftar tool baru."),
        model: str("Model baru."),
        mentions: strArray("Daftar mention baru."),
        runtime: enumStr(["claude", "codex"], "Penyaring mesin sesi."),
        enabled: bool("Aktif atau tidak."),
      },
      required: ["agent"],
    }),
    mode: "write", capability: "agents:write",
    samplePath: "/custom-agents/global:reviewer", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      for (const k of ["description", "instructions", "model", "runtime"]) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      for (const k of ["tools", "mentions"]) if (Array.isArray(a[k])) body[k] = a[k];
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      return { method: "PATCH", path: `/custom-agents/${enc(String(a.agent))}`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_delete",
    title: "Hapus custom agent (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus persona agen. Sesi yang sedang berjalan tak terpengaruh, tapi SETIAP SESI BARU kehilangan persona itu, dan penghapusannya MENYEBERANG SYNC ke instance lain. Instruksinya tak tersimpan di tempat lain. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { agent: str("Id custom agent yang dihapus.") }, required: ["agent"] }),
    mode: "danger", capability: "agents:write",
    samplePath: "/custom-agents/global:reviewer", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/custom-agents/${enc(String(a.agent))}` }),
    shape: (raw) => raw,
  },
];
