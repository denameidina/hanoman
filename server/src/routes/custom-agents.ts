import type { FastifyInstance } from "fastify";
import {
  activationOf, effortOf, maxTurnsOf, timeoutSecondsOf, workspacePolicyOf,
  zCreateCustomAgent, zUpdateCustomAgent, customAgentId, mentionsOf, toolsOf, runtimeOf,
  modelsForRuntime, ALL_TOOLS, AGENT_RUNTIMES, AGENT_RUNTIME_LABELS, BUILTIN_AGENT_NAMES,
  type AgentRuntime, type AgentCatalogView,
} from "@hanoman/shared";
import { prisma } from "../db";
import { notifySynced } from "../services/sync-notify";
import { deleteSynced } from "../services/sync-delete";
import { resolveRepoDir } from "../services/local-binding";
import { agentToolCatalog, agentToolIds } from "../services/agent-tool-catalog";
import { getSetting } from "../services/settings";
import { rowFingerprint } from "../services/builtin-agents";
import {
  loadCustomAgents, validateGraph, unknownMentions, type CustomAgentRow,
} from "../services/custom-agents";

// SPEC-450 · ADR-0094 · CRUD katalog custom agent. Integritas ditegakkan DI BOUNDARY (rujukan,
// siklus, duplikat) karena kolom `mentions` adalah `Json` tanpa FK — pola `dependsOn` (ADR-0093).
// SPEC-484 · ADR-0101 · ditambah gerbang KATALOG (tools/model/runtime) di boundary yang sama.

const rowsOf = async (): Promise<CustomAgentRow[]> =>
  (await prisma.customAgent.findMany()) as unknown as CustomAgentRow[];

/**
 * SPEC-881 · ADR-0136 · peta sidik jari agen bawaan. Dibaca SEKALI per request, bukan per baris —
 * `view` sinkron sementara `getSetting()` tidak.
 */
const stampsOf = async (): Promise<Record<string, string>> => (await getSetting()).builtinAgents;

/** Satu tempat yang tahu bentuk respons; `inherited` hanya bermakna saat diminta per-project. */
const view = (r: CustomAgentRow, projectId?: string, stamps: Record<string, string> = {}) => {
  // Bawaan SELALU global: nama yang sama dipakai sebagai agen project adalah baris milik operator
  // yang menimpa bawaan (ADR-0094), bukan bawaan itu sendiri.
  const builtin = r.projectId === null && BUILTIN_AGENT_NAMES.includes(r.name);
  return {
    id: r.id, projectId: r.projectId, name: r.name,
    description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
    runtime: runtimeOf(r.runtime),
    activation: activationOf(r.activation), effort: effortOf(r.effort),
    workspacePolicy: workspacePolicyOf(r.workspacePolicy),
    maxTurns: maxTurnsOf(r.maxTurns), timeoutSeconds: timeoutSecondsOf(r.timeoutSeconds),
    enabled: r.enabled,
    builtin,
    // Sidik jari yang tak tercatat (baris menyeberang sync dari mesin lain, seed di sini belum
    // pernah menyentuhnya) dibaca sebagai "disunting" — lebih baik menandai berlebih daripada
    // menjanjikan "asli bawaan" untuk isi yang tak bisa kita buktikan.
    builtinEdited: builtin ? stamps[r.name] !== rowFingerprint(r) : false,
    ...(projectId ? { inherited: r.projectId === null } : {}),
  };
};

/** repoDir project (bila ada) — sumber `<repoDir>/.mcp.json` & `~/.claude.json` projects[<repoDir>]. */
const repoDirOf = async (projectId?: string | null): Promise<string | null> =>
  projectId ? await resolveRepoDir(projectId) : null;

/**
 * SPEC-484 · ADR-0101 keputusan 5 · gerbang katalog. Mengembalikan bentuk respons galat atau null.
 * Dipanggil HANYA atas field yang ada di payload — `PATCH {enabled}` pada baris warisan tak boleh
 * ikut terkunci oleh nilai yang tak lagi ada di katalog mesin ini.
 */
function toolsProblem(tools: string[] | null | undefined, catalogIds: string[]) {
  if (!tools || tools.length === 0) return null;
  if (tools.includes(ALL_TOOLS) && tools.length > 1) {
    // GOTCHA #3 · "semua tool DAN Read" bukan keadaan yang berbeda dari "semua tool"; menerimanya
    // berarti dua representasi untuk satu keadaan — yang satu ter-expand, yang lain tidak.
    return { error: "pintasan * harus jadi satu-satunya pilihan tools", unknownTools: [] as string[] };
  }
  const unknownTools = tools.filter((t) => !catalogIds.includes(t));
  return unknownTools.length ? { error: "tool tak dikenal di mesin ini", unknownTools } : null;
}

function modelProblem(model: string | null | undefined, runtime: AgentRuntime | null) {
  if (!model) return null;
  const ok = modelsForRuntime(runtime).some((m) => m.id === model);
  return ok ? null : { error: "model tak dikenal untuk runtime ini", model, runtime };
}

export default async function (app: FastifyInstance) {
  // SPEC-484 · ADR-0101 · sumber daftar tools/model/runtime untuk form. Daftar MENTION sengaja tak
  // di sini: ia sudah hidup di `GET /custom-agents?projectId=` lengkap dengan aturan
  // project-menimpa-global, dan dua sumber untuk satu daftar adalah cara dua daftar mulai berbeda.
  // Didaftarkan SEBELUM route lain hanya demi keterbacaan — `PATCH /:id` beda method, tak bentrok.
  app.get("/custom-agents/catalog", async (req): Promise<AgentCatalogView> => {
    const projectId = (req.query as { projectId?: string }).projectId;
    return {
      tools: agentToolCatalog(await repoDirOf(projectId)),
      models: modelsForRuntime(null),
      runtimes: AGENT_RUNTIMES.map((id) => ({ id, label: AGENT_RUNTIME_LABELS[id] })),
    };
  });

  app.get("/custom-agents", async (req) => {
    const projectId = (req.query as { projectId?: string }).projectId;
    const rows = await prisma.customAgent.findMany({
      where: projectId ? { OR: [{ projectId: null }, { projectId }] } : { projectId: null },
      orderBy: { name: "asc" },
    }) as unknown as CustomAgentRow[];
    // Nama yang ditimpa project hanya boleh muncul SEKALI — versi project yang menang, cermin
    // `effectiveAgents`. Dua baris bernama sama di UI adalah pertanyaan "lalu yang mana yang jalan".
    const byName = new Map<string, CustomAgentRow>();
    for (const r of rows) if (r.projectId === null) byName.set(r.name, r);
    for (const r of rows) if (r.projectId !== null) byName.set(r.name, r);
    const stamps = await stampsOf();
    return [...byName.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => view(r, projectId, stamps));
  });

  app.post("/custom-agents", async (req, reply) => {
    const parsed = zCreateCustomAgent.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const p = parsed.data;
    const projectId = p.projectId ?? null;

    if (projectId && !(await prisma.project.findUnique({ where: { id: projectId } })))
      return reply.code(400).send({ error: "project tak ditemukan", projectId });

    const tp = toolsProblem(p.tools ?? null, agentToolIds(await repoDirOf(projectId)));
    if (tp) return reply.code(400).send(tp);
    const mp = modelProblem(p.model ?? null, p.runtime ?? null);
    if (mp) return reply.code(400).send(mp);

    const id = customAgentId(projectId, p.name);
    if (await prisma.customAgent.findUnique({ where: { id } }))
      return reply.code(409).send({ error: "nama sudah dipakai di scope ini", id });

    const candidate: CustomAgentRow = {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: p.tools ?? null, model: p.model ?? null, mentions: p.mentions ?? [],
      runtime: p.runtime ?? null,
      activation: p.activation ?? "always", effort: p.effort ?? null,
      workspacePolicy: p.workspacePolicy ?? "inherit",
      maxTurns: p.maxTurns ?? null, timeoutSeconds: p.timeoutSeconds ?? null,
      enabled: p.enabled ?? true,
    };
    const all = [...(await rowsOf()), candidate];
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.create({ data: {
      id, projectId, name: p.name, description: p.description, instructions: p.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, runtime: candidate.runtime as string | null,
      activation: candidate.activation as string,
      effort: candidate.effort as string | null,
      workspacePolicy: candidate.workspacePolicy as string,
      maxTurns: candidate.maxTurns as number | null,
      timeoutSeconds: candidate.timeoutSeconds as number | null,
      enabled: candidate.enabled,
    } });
    // Cache WAJIB di-refresh tiap mutasi: tanpa itu sesi yang lahir sesudahnya memakai katalog
    // basi, dan gejalanya senyap (agen lama tetap muncul, agen baru tak pernah).
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return reply.code(201).send(view(row as unknown as CustomAgentRow, undefined, await stampsOf()));
  });

  app.patch("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // `name`/`projectId` sengaja DI LUAR skema update: id diturunkan dari keduanya, dan changefeed
    // tak punya operasi hapus (ADR-0094 keputusan 2). Ditolak eksplisit, bukan diabaikan senyap —
    // "ganti nama diterima lalu tak terjadi apa-apa" adalah bug yang tak terlihat operator.
    const body = (req.body ?? {}) as Record<string, unknown>;
    if ("name" in body || "projectId" in body)
      return reply.code(400).send({ error: "name & projectId tak bisa diubah — hapus lalu buat baru" });

    const parsed = zUpdateCustomAgent.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });
    const before = existing as unknown as CustomAgentRow;

    // GOTCHA ADR-0101 #4 · runtime EFEKTIF, bukan `parsed.data.runtime ?? null`: tanpa ini setiap
    // PATCH {model} pada agen ber-runtime codex divalidasi terhadap GABUNGAN katalog dan lolos
    // untuk model claude. `"runtime" in parsed.data` membedakan "tak dikirim" dari "dikirim null".
    const effRuntime: AgentRuntime | null =
      "runtime" in parsed.data ? (parsed.data.runtime ?? null) : runtimeOf(before.runtime);
    const effWorkspacePolicy = "workspacePolicy" in parsed.data
      ? parsed.data.workspacePolicy ?? "inherit"
      : workspacePolicyOf(before.workspacePolicy);
    if (("runtime" in parsed.data || "workspacePolicy" in parsed.data)
      && effWorkspacePolicy === "isolated-worktree" && effRuntime !== "claude") {
      return reply.code(400).send({
        error: "isolated-worktree hanya tersedia untuk agen ber-runtime Claude Code",
      });
    }
    if (parsed.data.tools !== undefined) {
      const tp = toolsProblem(parsed.data.tools, agentToolIds(await repoDirOf(before.projectId)));
      if (tp) return reply.code(400).send(tp);
    }
    // `model` diperiksa juga saat HANYA runtime yang berubah — menukar runtime bisa membuat model
    // tersimpan jadi tak sah, dan menerimanya diam-diam mengembalikan bug yang spec ini tutup.
    if (parsed.data.model !== undefined || "runtime" in parsed.data) {
      const mp = modelProblem(
        parsed.data.model !== undefined ? parsed.data.model : before.model,
        effRuntime,
      );
      if (mp) return reply.code(400).send(mp);
    }

    const candidate: CustomAgentRow = {
      ...before,
      ...parsed.data,
      mentions: parsed.data.mentions ?? mentionsOf(before.mentions),
      tools: parsed.data.tools !== undefined ? parsed.data.tools : toolsOf(before.tools),
      runtime: effRuntime,
      activation: parsed.data.activation ?? activationOf(before.activation),
      effort: parsed.data.effort !== undefined ? parsed.data.effort : effortOf(before.effort),
      workspacePolicy: effWorkspacePolicy,
      maxTurns: parsed.data.maxTurns !== undefined ? parsed.data.maxTurns : maxTurnsOf(before.maxTurns),
      timeoutSeconds: parsed.data.timeoutSeconds !== undefined
        ? parsed.data.timeoutSeconds : timeoutSecondsOf(before.timeoutSeconds),
    };
    const all = (await rowsOf()).map((r) => (r.id === id ? candidate : r));
    const unknown = unknownMentions(candidate, all);
    if (unknown.length) return reply.code(400).send({ error: "mention tak dikenal", unknown });
    const cycle = validateGraph(all);
    if (cycle) return reply.code(409).send({ error: "mention membentuk siklus", ...cycle });

    const row = await prisma.customAgent.update({ where: { id }, data: {
      description: candidate.description, instructions: candidate.instructions,
      tools: candidate.tools as never, model: candidate.model,
      mentions: candidate.mentions as never, runtime: candidate.runtime as string | null,
      activation: candidate.activation as string,
      effort: candidate.effort as string | null,
      workspacePolicy: candidate.workspacePolicy as string,
      maxTurns: candidate.maxTurns as number | null,
      timeoutSeconds: candidate.timeoutSeconds as number | null,
      enabled: candidate.enabled,
    } });
    await loadCustomAgents();
    await notifySynced("customAgent", id);
    return view(row as unknown as CustomAgentRow, undefined, await stampsOf());
  });

  app.delete("/custom-agents/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.customAgent.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "not found" });

    await deleteSynced("customAgent", id);
    // Cabut namanya dari mentions agen lain — tanpa ini rujukan yatim mengunci UI dan setiap
    // penyuntingan berikutnya ditolak "mention tak dikenal" (cermin DELETE /specs/:id, ADR-0093).
    const name = (existing as unknown as CustomAgentRow).name;
    for (const r of await rowsOf()) {
      const m = mentionsOf(r.mentions);
      if (!m.includes(name)) continue;
      await prisma.customAgent.update({
        where: { id: r.id }, data: { mentions: m.filter((x) => x !== name) as never },
      });
      await notifySynced("customAgent", r.id);
    }
    await loadCustomAgents();
    return reply.code(204).send();
  });
}
