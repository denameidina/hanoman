import type { FastifyInstance, FastifyReply } from "fastify";
import {
  isBuiltinAccountId, zRuntimeAccountCreate, zRuntimeAccountDefault, zRuntimeAccountLogin, zRuntimeAccountPatch,
} from "@hanoman/shared";
import { listSessions } from "../services/pty";
import { sessionSandboxOn } from "../services/session-sandbox";
import {
  AccountError, checkAccount, createAccount, deleteAccount, listAccountDTOs, renameAccount, setDefaultAccount,
} from "../services/runtime-accounts/registry";
import { openLoginSession } from "../services/runtime-accounts/login";

// ADR-0234 · akun runtime. Baca & set default = settings:*; sisanya COOKIE_ONLY (agent-capabilities.ts).
const fail = (reply: FastifyReply, e: unknown) => {
  if (e instanceof AccountError) return reply.code(e.status).send({ error: e.code, message: e.message });
  throw e;
};
const liveAccountIds = (): string[] =>
  listSessions().filter((s) => !s.exited && s.accountId).map((s) => s.accountId!);
const builtinRefused = (reply: FastifyReply) =>
  reply.code(400).send({ error: "akun bawaan tak bisa diubah atau dihapus" });
const listBody = () => ({ accounts: listAccountDTOs(), sandbox: sessionSandboxOn() });

export default async function (app: FastifyInstance) {
  app.get("/runtime-accounts", async () => listBody());

  app.post("/runtime-accounts", async (req, reply) => {
    const p = zRuntimeAccountCreate.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return reply.code(201).send(await createAccount(p.data.runtime, p.data.label)); }
    catch (e) { return fail(reply, e); }
  });

  app.patch("/runtime-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltinAccountId(id)) return builtinRefused(reply);
    const p = zRuntimeAccountPatch.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return await renameAccount(id, p.data.label); } catch (e) { return fail(reply, e); }
  });

  app.delete("/runtime-accounts/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (isBuiltinAccountId(id)) return builtinRefused(reply);
    try { await deleteAccount(id, liveAccountIds); return reply.code(204).send(); }
    catch (e) { return fail(reply, e); }
  });

  app.put("/runtime-accounts/default", async (req, reply) => {
    const p = zRuntimeAccountDefault.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try {
      await setDefaultAccount(p.data.runtime, p.data.accountId, sessionSandboxOn());
      return listBody();
    } catch (e) { return fail(reply, e); }
  });

  app.post("/runtime-accounts/:id/login", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = zRuntimeAccountLogin.safeParse(req.body ?? {});
    if (!p.success) return reply.code(400).send({ error: "invalid body" });
    try { return reply.code(201).send(await openLoginSession(id, p.data)); } catch (e) { return fail(reply, e); }
  });

  app.post("/runtime-accounts/:id/check", async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return await checkAccount(id); } catch (e) { return fail(reply, e); }
  });
}
