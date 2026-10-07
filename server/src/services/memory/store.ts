// ADR-0178 · store memori project. Setiap fungsi menerima lingkup yang SUDAH diresolusi
// (resolve.ts) dan tak pernah membaca projectId dari input pemanggil. Semua query baca/tulis
// difilter `projectId` — id milik project lain berperilaku persis seperti id yang tak ada (404).
import type {
  MemoryAnchor, MemoryEventView, MemoryKind, MemoryStatus, MemoryView, zMemoryAnchorIn, zMemoryPropose,
} from "@hanoman/shared";
import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "../../db";
import { blobShaAt } from "./git";
import type { MemoryScope } from "./resolve";
import {
  canTransition, findSecret, isNearDuplicate, reviewReason, safeRepoPath, scopeMatches, tokens,
} from "./rules";

export type MemoryProposeInput = z.infer<typeof zMemoryPropose>;
export type MemoryAnchorIn = z.infer<typeof zMemoryAnchorIn>;
export type Actor = { kind: "user"; id: string } | { kind: "token"; id: string };
export type StoreFail = { ok: false; status: 404 | 409 | 422; body: Record<string, unknown> };
type Ok<T> = { ok: true } & T;
type Row = Prisma.ProjectMemoryGetPayload<object>;
// `prisma` adalah klien ter-`$extends` (db.ts), jadi tipe tx-nya bukan `Prisma.TransactionClient`.
type Tx = Parameters<Extract<Parameters<typeof prisma.$transaction>[0], (tx: never) => unknown>>[0];

const SEARCH_CAP = 500;
const fail = (status: StoreFail["status"], error: string, extra: Record<string, unknown> = {}): StoreFail =>
  ({ ok: false, status, body: { error, ...extra } });

export function toMemoryView(r: Row): MemoryView {
  return {
    id: r.id, projectId: r.projectId, kind: r.kind as MemoryKind, content: r.content,
    scopePaths: (r.scopePaths as string[]) ?? [], anchors: (r.anchors as MemoryAnchor[]) ?? [],
    status: r.status as MemoryStatus, supersedesId: r.supersedesId, reviewReason: r.reviewReason,
    trusted: r.trusted,
    source: {
      runtime: r.sourceRuntime as MemoryView["source"]["runtime"], sessionId: r.sourceSessionId,
      tokenId: r.sourceTokenId, deviceId: r.sourceDeviceId, commitSha: r.commitSha,
    },
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

const actorKind = (a: Actor) => (a.kind === "user" ? "user" : "token");

function validate(input: MemoryProposeInput): StoreFail | null {
  const secret = findSecret(input.content);
  if (secret) return fail(422, "content tampak berisi kredensial; memori tak boleh menyimpan secret", { reason: secret });
  for (const p of [...input.scopePaths, ...input.anchors.map((a) => a.path)])
    if (!safeRepoPath(p)) return fail(422, "path harus relatif root repo tanpa `..`", { path: p });
  return null;
}

/** Server menimpa blobSha bila ia bisa membaca commit-nya; selain itu blobSha klien wajib ada. */
async function verifyAnchors(scope: MemoryScope, anchors: MemoryAnchorIn[]):
  Promise<Ok<{ anchors: MemoryAnchor[]; verified: boolean }> | StoreFail> {
  if (!anchors.length) return { ok: true, anchors: [], verified: false };
  const out: MemoryAnchor[] = [];
  if (scope.repoDir && scope.head && scope.headVerified) {
    for (const a of anchors) {
      const actual = await blobShaAt(scope.repoDir, scope.head, a.path);
      if (!actual) return fail(422, "jangkar tidak ditemukan pada commit pengusul", { anchor: a.path });
      if (a.blobSha && a.blobSha !== actual) return fail(422, "blob SHA jangkar tidak cocok", { anchor: a.path });
      out.push({ path: a.path, blobSha: actual, ...(a.lines ? { lines: a.lines } : {}) });
    }
    return { ok: true, anchors: out, verified: true };
  }
  for (const a of anchors) {
    if (!a.blobSha) return fail(422, "jangkar tanpa blobSha tak dapat diverifikasi di mesin ini", { anchor: a.path });
    out.push({ path: a.path, blobSha: a.blobSha, ...(a.lines ? { lines: a.lines } : {}) });
  }
  return { ok: true, anchors: out, verified: false };
}

/** Saat sebuah memori menjadi active, yang digantikannya (bila masih bisa) menjadi invalidated. */
async function retireSuperseded(tx: Tx, m: Row, actor: { kind: string; id: string | null }) {
  if (!m.supersedesId) return;
  const old = await tx.projectMemory.findFirst({ where: { id: m.supersedesId, projectId: m.projectId } });
  if (!old || !canTransition(old.status as MemoryStatus, "invalidated")) return;
  await tx.projectMemory.update({ where: { id: old.id }, data: { status: "invalidated", version: { increment: 1 } } });
  await tx.memoryEvent.create({
    data: { memoryId: old.id, op: "supersede", actorKind: actor.kind, actorId: actor.id, reason: `digantikan ${m.id}` },
  });
}

async function create(
  scope: MemoryScope, actor: Actor, input: MemoryProposeInput,
  opts: { supersedesId?: string; skipDuplicate?: boolean } = {},
): Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const bad = validate(input);
  if (bad) return bad;
  const v = await verifyAnchors(scope, input.anchors);
  if (!v.ok) return v;

  if (!opts.skipDuplicate) {
    const actives = await prisma.projectMemory.findMany({
      where: { projectId: scope.projectId, status: "active", ...(opts.supersedesId ? { id: { not: opts.supersedesId } } : {}) },
      select: { id: true, content: true }, take: SEARCH_CAP,
    });
    const dup = actives.find((a) => isNearDuplicate(a.content, input.content));
    if (dup) return fail(409, "memori serupa sudah ada; pakai supersede bila ingin mengoreksinya", { duplicateOf: dup.id });
  }

  const trusted = true; // ADR-0178 · tahap 1: semua sumber tepercaya; sesi tak tepercaya lahir di tahap 2.
  const reason = reviewReason({ kind: input.kind, anchorsCount: v.anchors.length, anchorsVerified: v.verified, trusted });
  const status: MemoryStatus = reason ? "proposed" : "active";
  const who = { kind: actorKind(actor), id: actor.id };

  const row = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMemory.create({
      data: {
        projectId: scope.projectId, kind: input.kind, content: input.content,
        scopePaths: input.scopePaths, anchors: v.anchors, status, reviewReason: reason,
        supersedesId: opts.supersedesId ?? null,
        sourceRuntime: actor.kind === "user" ? "human" : "external",
        sourceTokenId: actor.kind === "token" ? actor.id : null,
        commitSha: scope.head, trusted,
      },
    });
    await tx.memoryEvent.create({ data: { memoryId: m.id, op: "propose", actorKind: who.kind, actorId: who.id, reason } });
    if (status === "active") {
      await tx.memoryEvent.create({ data: { memoryId: m.id, op: "activate", actorKind: "system", actorId: null, reason: "auto: jangkar terverifikasi" } });
      await retireSuperseded(tx, m, who);
    }
    return m;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export const proposeMemory = (scope: MemoryScope, actor: Actor, input: MemoryProposeInput) => create(scope, actor, input);

async function findActive(projectId: string, id: string): Promise<Row | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (m.status !== "active") return fail(409, `memori berstatus ${m.status}, bukan active`);
  return m;
}

export async function supersedeMemory(scope: MemoryScope, actor: Actor, id: string, input: MemoryProposeInput) {
  const old = await findActive(scope.projectId, id);
  if ("ok" in old) return old;
  return create(scope, actor, input, { supersedesId: old.id });
}

export async function reverifyMemory(scope: MemoryScope, actor: Actor, id: string, anchors: MemoryAnchorIn[]) {
  const old = await findActive(scope.projectId, id);
  if ("ok" in old) return old;
  return create(scope, actor, {
    kind: old.kind as MemoryKind, content: old.content, scopePaths: old.scopePaths as string[], anchors,
  }, { supersedesId: old.id, skipDuplicate: true });
}

export async function invalidateMemory(scope: MemoryScope, actor: Actor, id: string, reason: string):
  Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId: scope.projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (!canTransition(m.status as MemoryStatus, "invalidated")) return fail(409, `memori berstatus ${m.status}`);
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.projectMemory.update({ where: { id }, data: { status: "invalidated", version: { increment: 1 } } });
    await tx.memoryEvent.create({ data: { memoryId: id, op: "invalidate", actorKind: actorKind(actor), actorId: actor.id, reason } });
    return u;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export async function reviewMemory(projectId: string, userId: string, id: string, decision: "activate" | "reject", reason?: string):
  Promise<Ok<{ memory: MemoryView }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({ where: { id, projectId } });
  if (!m) return fail(404, "memori tidak ditemukan");
  if (m.status !== "proposed") return fail(409, `hanya memori proposed yang bisa direview (sekarang ${m.status})`);
  if (decision === "reject" && !reason?.trim()) return fail(422, "penolakan wajib menyertakan alasan");
  const to: MemoryStatus = decision === "activate" ? "active" : "rejected";
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.projectMemory.update({ where: { id }, data: { status: to, version: { increment: 1 } } });
    await tx.memoryEvent.create({ data: { memoryId: id, op: decision, actorKind: "user", actorId: userId, reason: reason?.trim() || null } });
    if (to === "active") await retireSuperseded(tx, u, { kind: "user", id: userId });
    return u;
  });
  return { ok: true, memory: toMemoryView(row) };
}

export async function getMemory(projectId: string, id: string):
  Promise<Ok<{ memory: MemoryView; events: MemoryEventView[] }> | StoreFail> {
  const m = await prisma.projectMemory.findFirst({
    where: { id, projectId }, include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!m) return fail(404, "memori tidak ditemukan");
  return {
    ok: true, memory: toMemoryView(m),
    events: m.events.map((e) => ({
      id: e.id, op: e.op, actorKind: e.actorKind, actorId: e.actorId, reason: e.reason, createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function searchMemories(projectId: string, q: { q?: string; paths?: string[]; status?: MemoryStatus }):
  Promise<{ items: MemoryView[]; total: number }> {
  const rows = await prisma.projectMemory.findMany({
    where: { projectId, status: q.status ?? "active" }, orderBy: { createdAt: "desc" }, take: SEARCH_CAP,
  });
  const want = q.q ? tokens(q.q) : [];
  const items = rows
    .filter((r) => want.every((w) => r.content.toLowerCase().includes(w)))
    .filter((r) => !q.paths?.length || scopeMatches(r.scopePaths as string[], q.paths))
    .map(toMemoryView);
  return { items, total: items.length };
}
