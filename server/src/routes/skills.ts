// server/src/routes/skills.ts
// Skills library (desain 2026-09-26) · lihat & sunting skill tiga lapis. Tulis ke plugin → 403.
import type { FastifyInstance, FastifyReply } from "fastify";
import { basename } from "node:path";
import {
  SkillError, copySkillDir, createSkillDir, createSkillEntry, deleteSkillDir, deleteSkillEntry,
  readSkillFile, skillTree, writeSkillFile,
} from "@hanoman/runner";
import { skillKey } from "@hanoman/shared";
import { libraryAll, libraryForProject, resolveSkill, targetParent } from "../services/skill-library";

const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof SkillError) return reply.code(e.status).send({ error: e.message });
  throw e;
};
const editable = async (key: string) => {
  const s = await resolveSkill(key);
  if (!s.editable) throw new SkillError(403, "skill plugin baca-saja — fork untuk menyunting");
  return s;
};
const created = (layer: "hanoman" | "user" | "project", source: string | undefined, projectId: string | undefined, dir: string) =>
  skillKey(layer, layer === "project" ? projectId! : null, layer === "hanoman" ? "hanoman" : (source ?? ".claude"), basename(dir));

export default async function skills(app: FastifyInstance) {
  app.get("/skills", async (req) => {
    const q = req.query as { scope?: string; projectId?: string };
    if (q.projectId) return libraryForProject(q.projectId);
    const all = await libraryAll();
    return q.scope === "all" ? all : all.global;
  });

  app.get("/skills/:key/tree", async (req, reply) => {
    try { return skillTree((await resolveSkill((req.params as { key: string }).key)).dir); }
    catch (e) { return fail(reply, e); }
  });

  app.get("/skills/:key/file", async (req, reply) => {
    try {
      const s = await resolveSkill((req.params as { key: string }).key);
      return readSkillFile(s.dir, String((req.query as { path?: string }).path ?? ""));
    } catch (e) { return fail(reply, e); }
  });

  app.put("/skills/:key/file", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      const b = req.body as { content?: unknown; baseHash?: unknown };
      if (typeof b?.content !== "string") return reply.code(400).send({ error: "content wajib string" });
      const base = typeof b.baseHash === "string" ? b.baseHash : null;
      return writeSkillFile(s.dir, String((req.query as { path?: string }).path ?? ""), b.content, base);
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills/:key/entry", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      const b = req.body as { path?: unknown; kind?: unknown };
      if (typeof b?.path !== "string" || (b.kind !== "file" && b.kind !== "dir")) return reply.code(400).send({ error: "path & kind (file|dir) wajib" });
      createSkillEntry(s.dir, b.path, b.kind);
      return reply.code(201).send({ ok: true });
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/skills/:key/entry", async (req, reply) => {
    try {
      const s = await editable((req.params as { key: string }).key);
      deleteSkillEntry(s.dir, String((req.query as { path?: string }).path ?? ""));
      return reply.code(204).send();
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills", async (req, reply) => {
    try {
      const b = req.body as { layer?: string; source?: string; projectId?: string; name?: string; description?: string };
      if (typeof b?.name !== "string" || typeof b.description !== "string") return reply.code(400).send({ error: "name & description wajib" });
      const layer = b.layer as "hanoman" | "user" | "project";
      const dir = createSkillDir(await targetParent(String(b.layer), b.source, b.projectId), b.name, b.description);
      return reply.code(201).send(await resolveSkill(created(layer, b.source, b.projectId, dir)));
    } catch (e) { return fail(reply, e); }
  });

  app.post("/skills/:key/fork", async (req, reply) => {
    try {
      const src = await resolveSkill((req.params as { key: string }).key);
      const b = req.body as { layer?: string; source?: string; projectId?: string; name?: string };
      const layer = (b?.layer ?? "hanoman") as "hanoman" | "user" | "project";
      const dir = copySkillDir(src.dir, await targetParent(layer, b?.source, b?.projectId), b?.name ?? src.name);
      return reply.code(201).send(await resolveSkill(created(layer, b?.source, b?.projectId, dir)));
    } catch (e) { return fail(reply, e); }
  });

  app.delete("/skills/:key", async (req, reply) => {
    try {
      deleteSkillDir((await editable((req.params as { key: string }).key)).dir);
      return reply.code(204).send();
    } catch (e) { return fail(reply, e); }
  });
}
