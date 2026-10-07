import { z } from "zod";

// ADR-0178 · memori project bersama lintas runtime. Satu sumber untuk server, CLI MCP, dan UI.
export const MEMORY_KINDS = ["convention", "gotcha", "decision", "fact"] as const;
export const MEMORY_STATUSES = ["proposed", "active", "invalidated", "rejected"] as const;
// `human` = dibuat dari dashboard (cookie). `external` = agent token di luar sesi hanoman.
export const MEMORY_RUNTIMES = ["claude", "codex", "external", "human"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryRuntime = (typeof MEMORY_RUNTIMES)[number];

export const MEMORY_CONTENT_MAX = 500;
const SHA = /^[0-9a-f]{40,64}$/;

export const zMemoryAnchorIn = z.object({
  path: z.string().min(1).max(500),
  lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
  // Diisi PROSES (CLI MCP), bukan model. Server menimpanya bila checkout project tersedia.
  blobSha: z.string().regex(SHA).optional(),
}).strict();

export const zMemoryPropose = z.object({
  kind: z.enum(MEMORY_KINDS),
  content: z.string().trim().min(1).max(MEMORY_CONTENT_MAX),
  scopePaths: z.array(z.string().min(1).max(300)).max(20).default([]),
  anchors: z.array(zMemoryAnchorIn).max(10).default([]),
}).strict();

export const zMemoryReverify = z.object({ anchors: z.array(zMemoryAnchorIn).min(1).max(10) }).strict();
export const zMemoryInvalidate = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export const zMemoryReview = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const zRepoIdentity = z.object({
  remote: z.string().min(1).max(500),
  rootCommit: z.string().regex(SHA),
  head: z.string().regex(SHA),
}).strict();
export type RepoIdentity = z.infer<typeof zRepoIdentity>;

// Header, bukan body/query: model tak pernah melihat atau mengisinya lewat inputSchema tool.
export const REPO_HEADER = "x-hanoman-repo";
// ADR-0179 · kredensial sesi hanoman (HANOMAN_SESSION_ID + HANOMAN_EVENT_TOKEN) yang diteruskan CLI MCP.
export const SESSION_HEADER = "x-hanoman-session";
export const SESSION_TOKEN_HEADER = "x-hanoman-session-token";
// base64url lewat TextEncoder + btoa/atob: berkas ini ikut dibundel ke browser, jadi tanpa `Buffer`.
const toB64Url = (s: string): string => {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string): string => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export const encodeRepoHeader = (r: RepoIdentity): string => toB64Url(JSON.stringify(r));
export function decodeRepoHeader(v: unknown): RepoIdentity | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const p = zRepoIdentity.safeParse(JSON.parse(fromB64Url(v)));
    return p.success ? p.data : null;
  } catch { return null; }
}

export type MemoryAnchor = { path: string; blobSha: string; lines?: [number, number] };

export type MemoryView = {
  id: string; projectId: string; kind: MemoryKind; content: string;
  scopePaths: string[]; anchors: MemoryAnchor[]; status: MemoryStatus;
  supersedesId: string | null; reviewReason: string | null; trusted: boolean;
  source: {
    runtime: MemoryRuntime; sessionId: string | null; tokenId: string | null;
    deviceId: string | null; commitSha: string | null;
  };
  createdAt: string; updatedAt: string;
};

export type MemoryEventView = {
  id: string; op: string; actorKind: string; actorId: string | null;
  reason: string | null; createdAt: string;
};
