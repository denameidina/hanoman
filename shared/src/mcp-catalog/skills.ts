// shared/src/mcp-catalog/skills.ts
// Skills library · tool domain `skills`. MENURUT METHOD: skill global hanoman disuntik ke setiap
// sesi baru, jadi izin baca tak pernah cukup untuk menulisnya.
import { enumStr, obj, str } from "../mcp-schema";
import { enc, query, s } from "./helpers";
import type { McpToolDef } from "./types";

export const SKILLS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_skills_list",
    title: "Daftar skill",
    description:
      "Skill dari semua sumber: global hanoman ($HANOMAN_HOME/skills, disuntik ke setiap sesi), user (~/.claude|~/.codex|~/.agents), plugin (baca-saja), dan per project (.claude/.agents/.codex/skills + folder lain berisi SKILL.md). Tanpa `project`: global + satu grup per project. Dengan `project`: global (bertanda shadowedBy bila ditimpa) + skill project itu.",
    inputSchema: obj({ properties: { project: str("Id project. Kosongkan untuk semua grup.") } }),
    mode: "read", capability: "skills:read",
    samplePath: "/skills", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: "/skills", query: query(s(a.project) ? { projectId: s(a.project) } : { scope: "all" }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_read",
    title: "Baca skill",
    description: "Tanpa `path`: pohon berkas skill. Dengan `path`: isi berkas + `hash` (dipakai sebagai baseHash saat menulis). Berkas biner/>1 MB hanya metadata.",
    inputSchema: obj({
      properties: { key: str("Key skill dari hanoman_skills_list."), path: str("Path relatif berkas, mis. SKILL.md.") },
      required: ["key"],
    }),
    mode: "read", capability: "skills:read",
    samplePath: "/skills/{key}/tree", sampleMethod: "GET",
    build: (a) => s(a.path)
      ? { method: "GET", path: `/skills/${enc(String(a.key))}/file`, query: query({ path: s(a.path) }) }
      : { method: "GET", path: `/skills/${enc(String(a.key))}/tree` },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_write",
    title: "Tulis berkas skill",
    description: "Menulis satu berkas di skill. `baseHash` = hash dari hanoman_skill_read (409 bila berkas berubah sejak dibaca); kosongkan untuk berkas baru. Skill plugin → 403. Menyunting skill global hanoman mempengaruhi SETIAP sesi berikutnya di semua project.",
    inputSchema: obj({
      properties: {
        key: str("Key skill."), path: str("Path relatif berkas."), content: str("Isi berkas lengkap."),
        baseHash: str("Hash saat dibaca; kosongkan untuk berkas baru."),
      },
      required: ["key", "path", "content"],
    }),
    mode: "write", capability: "skills:write",
    samplePath: "/skills/{key}/file", sampleMethod: "PUT",
    build: (a) => ({
      method: "PUT", path: `/skills/${enc(String(a.key))}/file`, query: query({ path: String(a.path) }),
      body: { content: String(a.content), baseHash: s(a.baseHash) ?? null },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_create",
    title: "Buat skill",
    description: "Membuat skill baru berisi kerangka SKILL.md. `layer`: hanoman (global, disuntik ke SETIAP sesi di semua project), user (~/.claude|~/.codex|~/.agents lewat `source`), atau project (`project` wajib; `source` .claude/.agents/.codex). Nama kebab-case maks 64; nama terpakai → 409.",
    inputSchema: obj({
      properties: {
        layer: enumStr(["hanoman", "user", "project"], "Lapis tujuan."),
        name: str("Nama skill (kebab-case)."),
        description: str("Deskripsi — diawali kapan skill dipakai, mis. \"Use when …\"."),
        source: enumStr([".claude", ".agents", ".codex"], "Sumber untuk lapis user/project. Default .claude."),
        project: str("Id project (wajib untuk layer project)."),
      },
      required: ["layer", "name", "description"],
    }),
    mode: "write", capability: "skills:write",
    samplePath: "/skills", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/skills",
      body: { layer: String(a.layer), name: String(a.name), description: String(a.description), source: s(a.source), projectId: s(a.project) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_fork",
    title: "Fork skill",
    description: "Menyalin skill mana pun (termasuk plugin yang baca-saja) ke global hanoman atau ke project, supaya bisa disunting. `name` default = nama asal.",
    inputSchema: obj({
      properties: {
        key: str("Key skill sumber."),
        layer: enumStr(["hanoman", "project"], "Tujuan. Default hanoman."),
        project: str("Id project (wajib untuk layer project)."),
        source: enumStr([".claude", ".agents", ".codex"], "Sumber tujuan untuk layer project."),
        name: str("Nama baru (opsional)."),
      },
      required: ["key"],
    }),
    mode: "write", capability: "skills:write",
    samplePath: "/skills/hanoman~-~hanoman~contoh/fork", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/skills/${enc(String(a.key))}/fork`,
      body: { layer: s(a.layer) ?? "hanoman", projectId: s(a.project), source: s(a.source), name: s(a.name) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_entry",
    title: "Buat / hapus berkas atau folder skill",
    description: "`action` create membuat berkas kosong atau folder (`kind`); delete menghapus berkas/folder (rekursif). SKILL.md tak bisa dihapus — hapus skill-nya. Skill plugin → 403.",
    inputSchema: obj({
      properties: {
        key: str("Key skill."), path: str("Path relatif, mis. references/api.md."),
        action: enumStr(["create", "delete"], "Operasi."),
        kind: enumStr(["file", "dir"], "Untuk create. Default file."),
      },
      required: ["key", "path", "action"],
    }),
    mode: "write", capability: "skills:write",
    samplePath: "/skills/hanoman~-~hanoman~contoh/entry", sampleMethod: "POST",
    build: (a) => a.action === "delete"
      ? { method: "DELETE", path: `/skills/${enc(String(a.key))}/entry`, query: query({ path: String(a.path) }) }
      : { method: "POST", path: `/skills/${enc(String(a.key))}/entry`, body: { path: String(a.path), kind: s(a.kind) ?? "file" } },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_skill_delete",
    title: "Hapus skill (BERBAHAYA)",
    description: "BERBAHAYA — menghapus SELURUH folder skill dari disk — tak ada tempat sampah. Skill plugin → 403. Menghapus skill global hanoman mencabutnya dari setiap sesi berikutnya di semua project. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { key: str("Key skill.") }, required: ["key"] }),
    mode: "danger", capability: "skills:write",
    samplePath: "/skills/hanoman~-~hanoman~contoh", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/skills/${enc(String(a.key))}` }),
    shape: (raw) => raw,
  },
];
