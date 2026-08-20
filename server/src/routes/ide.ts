import type { FastifyInstance } from "fastify";
import { basename, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { CODE_STYLE_CLAUSE } from "@hanoman/runner";
import { listRemotes, addRemote, setRemoteUrl, removeRemote, prUrl } from "../services/git-remotes";
import { downloadFormat, sendDocDownload, sendReviewDownload } from "../services/doc-export";
import { prisma } from "../db";
import { resolveRepoDir } from "../services/local-binding";
import { listSessions, createSession } from "../services/pty";
import { conflictSessionDefaults } from "../services/settings";
import { ensureCodexTrust } from "../services/codex-trust";
import { mergeIntoCurrent, rebaseOntoCurrent, pullIntoCurrent, dropCommit, sourceBranch, type GraphMergeResult } from "../services/integrate";
import { listUnusedBranches, deleteBranches, type BranchScope } from "../services/branch-cleanup";
import { listWorktrees, worktreeStats, deleteWorktrees, type WorktreeInputs } from "../services/worktree-list";
import { closeSession } from "../services/session-close";
import { releaseWorktree } from "../services/worktree-reaper";
import { sessionIdForSpec } from "../services/session-id";
import {
  listRepoTree, readRepoFile, writeRepoFile, listGraph, commitDetail, commitFileDiff, compareCommits, compareFile,
  searchCommits, runGitOp, validateGitOp, touchesTree, repoStatus, listStashes,
  workingStatus, workingFileDiff, type GitOp, type GraphOpts,
} from "../services/git-ide";
import {
  createEntry, renameEntry, deleteEntry, saveUpload, joinRel,
  EntryExistsError, EntryMissingError, EntryTargetInsideError,
} from "../services/repo-fs";

// undefined = project tak ada (→404); null = ada tapi tanpa checkout lokal; string = repoDir.
// SPEC-213 · binding lokal per-device menang atas Project.repoDir (AC-6).
async function repoOf(id: string): Promise<string | null | undefined> {
  const p = await prisma.project.findUnique({ where: { id } });
  if (!p) return undefined;
  return (await resolveRepoDir(id)) ?? null;
}
const activeSessions = (id: string) => listSessions().filter((s) => s.projectId === id && !s.exited).length;

// SPEC-360 · ADR-0077 · sinyal NON-git yang mengunci sebuah branch dari penghapusan. Dikumpulkan
// di route (yang boleh menyentuh DB & tmux) lalu diserahkan ke service sebagai himpunan nama
// branch — service tetap murni & bisa dites tanpa DB maupun tmux.
async function lockInputs(id: string) {
  const open = await prisma.spec.findMany({
    where: { projectId: id, stage: { not: "done" } }, select: { id: true } });
  // Sesi backlog lahir TANPA opts.branch (session-launch.ts) → SessionInfo.branch undefined;
  // nama branch-nya diturunkan dari id sesi yang deterministik dari id spec (ADR-0015).
  // Sesi PRD/breakdown memang membawa `branch`. Keduanya harus terlindungi.
  const sessions = listSessions()
    .filter((s) => s.projectId === id && !s.exited)
    .map((s) => s.branch || (s.specId ? `hanoman/${s.id}` : ""))
    .filter(Boolean);
  return {
    openSpecBranches: new Set(open.map((s) => sourceBranch(s.id))),
    sessionBranches: new Set(sessions),
  };
}

// SPEC-861 · ADR-0132 · sinyal NON-git sebuah worktree, dikumpulkan di route dengan alasan yang
// sama dengan `lockInputs` di atas: service-nya murni. Kunci `specs` adalah id sesi yang
// deterministik dari id spec (ADR-0015) — sama dengan `basename` worktree-nya.
async function worktreeInputs(id: string): Promise<WorktreeInputs> {
  const specs = await prisma.spec.findMany({ where: { projectId: id }, select: { id: true, stage: true } });
  return {
    specs: new Map(specs.map((s) => [sessionIdForSpec(s.id), { id: s.id, stage: s.stage }])),
    sessions: new Map(listSessions()
      .filter((s) => s.projectId === id && !s.exited)
      .map((s) => [resolve(s.cwd), { id: s.id, specId: s.specId ?? null }])),
  };
}

const execAsync = promisify(execFile);

// ADR-0121 · terjemahan seragam error service berkas → kode HTTP. Apa pun yang tak dikenal
// jatuh ke 400: seluruh sisanya adalah penolakan penjaga path, dan itu salah peminta.
function entryError(reply: import("fastify").FastifyReply, e: unknown) {
  if (e instanceof EntryMissingError) return reply.code(404).send({ error: "not found" });
  if (e instanceof EntryExistsError) return reply.code(409).send({ error: "sudah ada" });
  if (e instanceof EntryTargetInsideError) return reply.code(400).send({ error: "tujuan di dalam sumber" });
  return reply.code(400).send({ error: (e as Error).message });
}

// ADR-0121 · batas unggah IDE, PER-REQUEST. Registrasi global @fastify/multipart (app.ts:127)
// tetap 5 MB/12 berkas — itu milik lampiran gambar SPEC-816 dan tak boleh ikut naik.
const UPLOAD_LIMITS = {
  fileSize: 100 * 1024 * 1024, files: 1000, fields: 10, fieldSize: 1024 * 1024,
} as const;
const UPLOAD_TOTAL_MAX = 2 * 1024 * 1024 * 1024;

export default async function (app: FastifyInstance) {
  app.get("/projects/:id/tree", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const ref = (req.query as { ref?: string }).ref ?? "";
    return { ref, files: await listRepoTree(repoDir, ref) };
  });

  app.get("/projects/:id/file", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, ref } = req.query as { path?: string; ref?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await readRepoFile(repoDir, path, ref ?? "");
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-361 · ADR-0078 · unduh berkas teks; biner tak punya bentuk .md/.pdf yang berarti.
      const fmt = downloadFormat(req.query);
      if (fmt && !f.binary) {
        return sendDocDownload(reply, fmt, {
          content: f.content ?? "", name: path, prefix: ref ? `${id}-${ref}` : id,
          eyebrow: `hanoman · ${id}${ref ? ` · ${ref}` : ""}`, path,
        });
      }
      return f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // SPEC-234 · status working tree utama (staged/unstaged). Read-only → TAK digerbang sesi (spt /tree).
  // path /working-status: dibedakan dari /status milik SPEC-233 (repoStatus untuk baris uncommitted di graph).
  app.get("/projects/:id/working-status", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return workingStatus(repoDir);
  });

  // SPEC-234 · diff satu file working tree. staged=1 → index vs HEAD, else working tree vs index.
  app.get("/projects/:id/file-diff", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path, staged } = req.query as { path?: string; staged?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await workingFileDiff(repoDir, path, staged === "1" || staged === "true");
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang sedang dipratinjau dari pane diff Explorer.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, { prefix: id, eyebrow: `hanoman · ${id}`, path });
      return f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // PUT /file SENGAJA tak digerbang sesi: menulis file bukan operasi git & tak memindah HEAD.
  app.put("/projects/:id/file", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const b = req.body as { path?: string; content?: string };
    if (!b?.path || typeof b.content !== "string") return reply.code(400).send({ error: "path & content wajib" });
    try { await writeRepoFile(repoDir, b.path, b.content); return { path: b.path, content: b.content }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // ADR-0121 · operasi struktural berkas. SENGAJA tak digerbang sesi aktif, alasan yang sama
  // dengan PUT /file di atas: bukan operasi git, tak memindahkan HEAD, dan sesi hidup di
  // .worktrees/<id> yang terpisah. Yang menjaga hapus/rename adalah konfirmasi di UI.
  app.post("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { path?: string; kind?: string };
    if (!b?.path || typeof b.path !== "string") return reply.code(400).send({ error: "path wajib" });
    if (b.kind !== "file" && b.kind !== "dir") return reply.code(400).send({ error: "kind harus file atau dir" });
    try { return reply.code(201).send(await createEntry(repoDir, b.path, b.kind)); }
    catch (e) { return entryError(reply, e); }
  });

  app.patch("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { from?: string; to?: string };
    if (!b?.from || !b?.to || typeof b.from !== "string" || typeof b.to !== "string")
      return reply.code(400).send({ error: "from & to wajib" });
    try { return await renameEntry(repoDir, b.from, b.to); }
    catch (e) { return entryError(reply, e); }
  });

  app.delete("/projects/:id/entry", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try { return await deleteEntry(repoDir, path); }
    catch (e) { return entryError(reply, e); }
  });

  // ADR-0121 · unggah N berkas. Urutan part adalah kontrak: dir → overwrite → manifest → berkas.
  // Manifest (array path relatif) dipakai alih-alih `filename` karena nama multipart ber-`/`
  // tak punya jaminan lintas implementasi; ia yang membawa struktur folder dari webkitRelativePath.
  app.post("/projects/:id/upload", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    // Anggaran total dibaca PER-REQUEST supaya bisa diturunkan di test tanpa mengirim 2 GB.
    // Bukan knob produk: tak ada UI maupun Setting yang menulisnya.
    const totalMax = Number(process.env.HANOMAN_IDE_UPLOAD_MAX_BYTES) || UPLOAD_TOTAL_MAX;
    let dir = "", overwrite = false, manifest: string[] | null = null, seen = 0, total = 0;
    const written: string[] = [];
    const skipped: { path: string; reason: "exists" | "too-large" | "budget" | "denied" }[] = [];

    for await (const part of (req as any).parts({ limits: UPLOAD_LIMITS })) {
      if (part.type === "field") {
        if (part.fieldname === "dir") dir = String(part.value ?? "");
        else if (part.fieldname === "overwrite") overwrite = part.value === "1" || part.value === "true";
        else if (part.fieldname === "manifest") {
          try {
            const parsed = JSON.parse(String(part.value));
            if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) throw new Error("bentuk");
            manifest = parsed as string[];
          } catch { return reply.code(400).send({ error: "manifest tak sah" }); }
        }
        continue;
      }
      const name = manifest ? manifest[seen] : (part.filename as string | undefined);
      seen++;
      if (name === undefined) {
        part.file.resume();   // kuras stream, kalau tidak busboy menggantung
        return reply.code(400).send({ error: "manifest tak cocok dengan berkas" });
      }
      // Path ditampilkan apa adanya di `skipped` supaya operator melihat yang ia kirim,
      // bukan bentuk ternormalkan yang tak ia kenali.
      let rel = name;
      try {
        rel = joinRel(dir, name);
        if (total >= totalMax) { part.file.resume(); skipped.push({ path: rel, reason: "budget" }); continue; }
        const r = await saveUpload(repoDir, rel, part.file, {
          overwrite, isTruncated: () => part.file.truncated === true });
        if (r.status === "written") { written.push(rel); total += Number(part.file.bytesRead ?? 0); }
        else {
          // `exists` memulangkan keputusan TANPA membaca stream-nya; tanpa resume() busboy
          // menunggu part itu selesai selamanya dan seluruh request menggantung.
          part.file.resume();
          skipped.push({ path: rel, reason: r.status });
        }
      } catch {
        part.file.resume();
        skipped.push({ path: name, reason: "denied" });
      }
    }
    if (manifest && seen !== manifest.length)
      return reply.code(400).send({ error: "manifest tak cocok dengan berkas" });
    return { written, skipped };
  });

  app.get("/projects/:id/graph", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const q = req.query as { limit?: string; branches?: string; showRemote?: string; showTags?: string };
    const limit = Number(q.limit) || 200;
    const opts: GraphOpts = {
      branches: q.branches ? q.branches.split(",").filter(Boolean) : undefined,
      showRemote: q.showRemote === "false" ? false : undefined,
      showTags: q.showTags === "false" ? false : undefined,
    };
    return listGraph(repoDir, limit, opts);
  });

  // SPEC-233 · cari commit (message/author/hash/all) lintas semua ref.
  app.get("/projects/:id/graph/search", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { q, by } = req.query as { q?: string; by?: string };
    const kind = (["all", "message", "author", "hash"].includes(by ?? "") ? by : "all") as "all" | "message" | "author" | "hash";
    return { shas: await searchCommits(repoDir, q ?? "", kind) };
  });

  // SPEC-233 · status working tree untuk baris "uncommitted changes" di graph.
  app.get("/projects/:id/status", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return repoStatus(repoDir);
  });

  // SPEC-233 · daftar stash.
  app.get("/projects/:id/stashes", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return listStashes(repoDir);
  });

  // SPEC-233 · kelola remote (list/add/edit/hapus).
  app.get("/projects/:id/remotes", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return listRemotes(repoDir);
  });
  app.post("/projects/:id/remotes", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { name?: string; url?: string };
    if (!b?.name || !b?.url) return reply.code(400).send({ error: "name & url wajib" });
    const r = await addRemote(repoDir, b.name, b.url);
    return r.ok ? listRemotes(repoDir) : reply.code(409).send({ error: r.error });
  });
  app.patch("/projects/:id/remotes/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { url?: string };
    if (!b?.url) return reply.code(400).send({ error: "url wajib" });
    const r = await setRemoteUrl(repoDir, name, b.url);
    return r.ok ? listRemotes(repoDir) : reply.code(409).send({ error: r.error });
  });
  app.delete("/projects/:id/remotes/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const r = await removeRemote(repoDir, name);
    return r.ok ? listRemotes(repoDir) : reply.code(409).send({ error: r.error });
  });

  // SPEC-233 · URL "Create Pull Request" diturunkan dari remote origin project.
  app.get("/projects/:id/pr-url", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { branch, base } = req.query as { branch?: string; base?: string };
    if (!branch) return reply.code(400).send({ error: "branch wajib" });
    const origin = (await listRemotes(repoDir)).find((r) => r.name === "origin");
    return { url: origin ? prUrl(origin.push || origin.fetch, branch, base || "main") : null };
  });

  // SPEC-233 · unduh arsip (git archive) sebuah ref. format ∈ zip|tar. Stream langsung.
  app.get("/projects/:id/archive", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const q = req.query as { ref?: string; format?: string };
    const ref = q.ref || "HEAD";
    if (!/^[\w./@{}-]+$/.test(ref)) return reply.code(400).send({ error: "ref tidak valid" });
    const fmt = q.format === "tar" ? "tar" : "zip";
    const child = spawn("git", ["archive", `--format=${fmt}`, "--end-of-options", ref], { cwd: repoDir });
    reply.header("content-type", fmt === "zip" ? "application/zip" : "application/x-tar");
    reply.header("content-disposition", `attachment; filename="${basename(repoDir)}-${ref.replace(/[^\w.-]/g, "_")}.${fmt}"`);
    return reply.send(child.stdout);
  });

  app.get("/projects/:id/commit/:sha", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const d = await commitDetail(repoDir, sha);
    return d === null ? reply.code(404).send({ error: "not found" }) : d;
  });

  // SPEC-233 · compare dua commit: file yang beda + per-file diff.
  app.get("/projects/:id/compare", async (req, reply) => {
    const repoDir = await repoOf((req.params as { id: string }).id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) return reply.code(400).send({ error: "from & to wajib" });
    return compareCommits(repoDir, from, to);
  });

  app.get("/projects/:id/compare/file", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { from, to, path } = req.query as { from?: string; to?: string; path?: string };
    if (!from || !to || !path) return reply.code(400).send({ error: "from, to & path wajib" });
    try {
      const f = await compareFile(repoDir, from, to, path);
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang dipratinjau dari compare dua commit.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, {
        prefix: `${id}-${to.slice(0, 8)}`, eyebrow: `hanoman · ${from.slice(0, 8)}…${to.slice(0, 8)}`, path,
      });
      return f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // SPEC-233 · diff satu file di sebuah commit (vs parent), untuk viewer detail commit.
  app.get("/projects/:id/commit/:sha/file", async (req, reply) => {
    const { id, sha } = req.params as { id: string; sha: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: "path wajib" });
    try {
      const f = await commitFileDiff(repoDir, sha, path);
      if (f === null) return reply.code(404).send({ error: "not found" });
      // SPEC-385 · ADR-0078 · unduh berkas .md yang dipratinjau dari detail commit di Git Graph.
      const fmt = downloadFormat(req.query);
      if (fmt) return sendReviewDownload(reply, fmt, f, {
        prefix: `${id}-${sha.slice(0, 8)}`, eyebrow: `hanoman · ${id} · ${sha.slice(0, 8)}`, path,
      });
      return f;
    } catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  // Mutasi git. Gerbang sesi aktif (persis DELETE /projects); force melewatinya + menambah -f/-D.
  app.post("/projects/:id/git", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const op = req.body as GitOp & { force?: boolean };
    const err = validateGitOp(op);
    if (err) return reply.code(400).send({ error: err });
    // SPEC-233/ADR-0055 · hanya op yang menyentuh working tree digerbang sesi aktif; op ref-only
    // (tag/rename/push/fetch/stash-drop) aman berjalan berdampingan dengan sesi.
    if (!op.force && touchesTree(op)) {
      const n = activeSessions(id);
      if (n) return reply.code(409).send({ error: `project "${id}" punya ${n} sesi aktif; commit/stash atau paksa` });
    }
    const r = await runGitOp(repoDir, op);
    return r.ok ? r : reply.code(409).send({ error: r.stderr || "operasi git gagal", ...r });
  });

  // SPEC-229 · merge via git graph (ADR-0053): deterministik di worktree isolasi (working tree utama
  // tak pernah dirusak), konflik → spawn sesi agen di worktree itu. Tanpa gerbang sesi aktif —
  // isolasi + ff-aman menggantikan alasan 409 lama. Bentuk response mirror POST /specs/:id/integrate.
  app.post("/projects/:id/git/merge", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { source?: unknown; ff?: unknown; deleteBranch?: unknown };
    if (typeof b?.source !== "string" || !b.source) return reply.code(400).send({ error: "source wajib" });
    if (b.ff !== undefined && b.ff !== "no-ff" && b.ff !== "ff-only") return reply.code(400).send({ error: "ff harus no-ff atau ff-only" });
    if (b.deleteBranch !== undefined && !(typeof b.deleteBranch === "string" && b.deleteBranch)) return reply.code(400).send({ error: "deleteBranch harus string tak kosong" });
    const r = await mergeIntoCurrent(repoDir, b.source, {
      ff: b.ff as "no-ff" | "ff-only" | undefined, deleteBranch: b.deleteBranch as string | undefined });
    return finishGraphOp(reply, id, repoDir, r, "merge");
  });

  // SPEC-233/ADR-0055 · rebase branch current ke commit/branch (isolasi + konflik → sesi agen).
  app.post("/projects/:id/git/rebase", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { onto?: unknown };
    if (typeof b?.onto !== "string" || !b.onto) return reply.code(400).send({ error: "onto wajib" });
    return finishGraphOp(reply, id, repoDir, await rebaseOntoCurrent(repoDir, b.onto), "rebase");
  });

  // SPEC-233 · pull remote branch ke current (fetch + merge, isolasi + konflik → sesi agen).
  app.post("/projects/:id/git/pull", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { source?: unknown; ff?: unknown };
    if (typeof b?.source !== "string" || !b.source) return reply.code(400).send({ error: "source wajib" });
    if (b.ff !== undefined && b.ff !== "no-ff" && b.ff !== "ff-only") return reply.code(400).send({ error: "ff harus no-ff atau ff-only" });
    return finishGraphOp(reply, id, repoDir, await pullIntoCurrent(repoDir, b.source, { ff: b.ff as "no-ff" | "ff-only" | undefined }), "pull");
  });

  // SPEC-233 · buang satu commit dari branch current (isolasi + konflik → sesi agen).
  app.post("/projects/:id/git/drop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { sha?: unknown };
    if (typeof b?.sha !== "string" || !b.sha) return reply.code(400).send({ error: "sha wajib" });
    return finishGraphOp(reply, id, repoDir, await dropCommit(repoDir, b.sha), "drop");
  });

  // SPEC-360 · ADR-0077 · daftar branch yang sudah ter-merge ke base + alasan kunci per branch.
  // Read murni turunan git (ADR-0018) — tak digerbang sesi aktif.
  app.get("/projects/:id/branches/unused", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    const { base } = req.query as { base?: string };
    return listUnusedBranches(repoDir, { base, ...(await lockInputs(id)) });
  });

  // SPEC-360 · ADR-0077 · hapus batch. TAK memakai gerbang sesi-aktif global (touchesTree):
  // delete-branch adalah op ref-only (ADR-0055) dan pagarnya sudah per-branch & lebih tepat.
  // Selalu 200 bila body sah — kegagalan hidup di baris `results`, bukan di status HTTP.
  app.post("/projects/:id/branches/delete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { names?: unknown; scope?: unknown; base?: unknown };
    if (!Array.isArray(b?.names) || b.names.some((n) => typeof n !== "string" || !n))
      return reply.code(400).send({ error: "names wajib berisi nama branch" });
    if (b.scope !== undefined && b.scope !== "local" && b.scope !== "remote" && b.scope !== "both")
      return reply.code(400).send({ error: "scope harus local, remote, atau both" });
    return deleteBranches(repoDir, b.names as string[], {
      scope: (b.scope as BranchScope | undefined) ?? "both",
      base: typeof b.base === "string" && b.base ? b.base : undefined,
      ...(await lockInputs(id)),
    });
  });

  // SPEC-861 · ADR-0132 · worktree yang masih HIDUP. Read murni turunan git (ADR-0018) — tak
  // digerbang sesi aktif, cermin /branches/unused. Entri `.trash/**` tak muncul di sini: itu
  // wilayah reaper, dan permukaannya `GET /terminal/cleanups`.
  app.get("/projects/:id/worktrees", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    return listWorktrees(repoDir, await worktreeInputs(id));
  });

  // SPEC-861 · sinyal MAHAL per baris (ukuran disk, isi kotor, commit yatim) — sengaja terpisah
  // supaya daftar tak menunggu `du`. `name` divalidasi terhadap daftar TURUNAN: klien tak pernah
  // mengirim path, jadi tak ada permukaan traversal di sini.
  app.get("/projects/:id/worktrees/stats", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const { name } = req.query as { name?: string };
    const report = await listWorktrees(repoDir, await worktreeInputs(id));
    const w = report.worktrees.find((x) => x.name === name);
    if (!w) return reply.code(404).send({ error: "not found" });
    return worktreeStats(report.repoDir, w);
  });

  // SPEC-861 · ADR-0132 · hapus batch. Operasi destruktif; diperlakukan seperti /branches/delete —
  // selalu 200 bila body sah, kegagalan hidup di baris `results`. Penghapusan byte-nya TIDAK
  // terjadi di sini: worktree cuma di-`rename` ke `.trash` (SPEC-742) supaya event loop yang
  // melayani terminal PTY tak terblokir.
  app.post("/projects/:id/worktrees/delete", async (req, reply) => {
    const { id } = req.params as { id: string };
    const repoDir = await repoOf(id);
    if (repoDir === undefined) return reply.code(404).send({ error: "not found" });
    if (!repoDir) return reply.code(400).send({ error: "project tidak punya repoDir" });
    const b = req.body as { names?: unknown; deleteBranch?: unknown };
    if (!Array.isArray(b?.names) || b.names.some((n) => typeof n !== "string" || !n))
      return reply.code(400).send({ error: "names wajib berisi nama worktree" });
    const locks = await lockInputs(id);
    return deleteWorktrees(repoDir, b.names as string[], {
      withBranch: b.deleteBranch === true,
      ...(await worktreeInputs(id)),
      closeSession,
      release: (repo, path) => releaseWorktree(repo, path, id),
      prune: async (repo) => {
        // Gagal-diam: registrasi basi bukan alasan menahan penghapusan (cermin prodReaperDeps).
        try { await execAsync("git", ["worktree", "prune"], { cwd: repo, timeout: 30_000 }); } catch { /* */ }
      },
      // Pagar kunci ADR-0077 ikut apa adanya — satu-satunya jalur hapus branch di codebase.
      deleteBranch: async (repo, name) => {
        const r = await deleteBranches(repo, [name], { scope: "both", ...locks });
        const first = r.results[0];
        return { ok: !!first?.ok, ...(first?.error ? { error: first.error } : {}) };
      },
    });
  });
}

// SPEC-233 · penyelesaian seragam operasi graph isolasi (merge/rebase/pull/drop): error → kode;
// clean → { status, detail }; conflict → spawn sesi agen di worktree yang tertinggal → sessionId.
// SPEC-377 · ADR-0074 · agen/model/effort dari Setting (cermin POST /terminal/sessions/:id/integrate).
// `repoDir` diteruskan pemanggil — keempatnya sudah me-resolve-nya untuk menjalankan operasi git.
// SPEC-383 · ADR-0081 · `conflictSessionDefaults()` mendahulukan blok `Setting.conflict` bila
// dinyalakan; bila mati ia mendelegasikan ke default global — perilaku SPEC-377 tak berubah.
async function finishGraphOp(
  reply: import("fastify").FastifyReply, id: string, repoDir: string, r: GraphMergeResult, verb: string,
) {
  if (r.status === "error") return reply.code(r.code).send({ error: r.error });
  if (r.status === "clean") return { status: "clean", detail: r.detail };
  const { agent, model, effort } = await conflictSessionDefaults();
  // Gerbang trust codex dibuka untuk ROOT REPO; worktree `.worktrees/merge-*` mewarisinya.
  if (agent === "codex") ensureCodexTrust(repoDir);
  const prompt = [
    `hanoman · selesaikan konflik ${verb} \`${r.source}\` → \`${r.target}\`.`,
    `Kamu berada di worktree yang tertinggal di tengah ${verb} dengan konflik. Resolve konflik pada file bertanda, jaga kedua sisi perubahan sesuai maksudnya.`,
    r.finalize,
    // SPEC-543 · ADR-0108 · cermin pintu konflik backlog di routes/specs.ts.
    CODE_STYLE_CLAUSE,
    `${verb} via git graph project ${id}.`,
  ].join("\n\n");
  const s = createSession(id, r.worktree, { id: basename(r.worktree), model, effort, agent, prompt });
  return { status: "conflict", sessionId: s.id };
}
