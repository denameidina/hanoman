// ADR-0178 · aturan murni memori project: tanpa DB, tanpa git, tanpa jam. Semua keputusan
// "boleh/tidak" yang bisa diuji tanpa I/O tinggal di sini.
import type { MemoryKind, MemoryStatus } from "@hanoman/shared";

/** `host/owner/repo` huruf kecil tanpa `.git`; null bila bukan remote jaringan yang dikenali. */
export function normalizeRemote(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  let host: string; let path: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(t);
  if (scp && !t.includes("://")) { host = scp[1]!; path = scp[2]!; }
  else {
    let u: URL;
    try { u = new URL(t); } catch { return null; }
    if (!/^(https?|ssh|git):$/.test(u.protocol)) return null;
    host = u.hostname; path = u.pathname;
  }
  path = path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  if (!host || !path.includes("/")) return null;
  return `${host.toLowerCase()}/${path.toLowerCase()}`;
}

const RANK: Record<MemoryStatus, number> = { proposed: 0, active: 1, invalidated: 2, rejected: 2 };
export const statusRank = (s: MemoryStatus): number => RANK[s];
export const canTransition = (from: MemoryStatus, to: MemoryStatus): boolean => RANK[to] > RANK[from];
/** Lattice monoton: yang lebih tinggi menang; seri → `a` (yang tercatat lebih dulu). */
export const mergeStatus = (a: MemoryStatus, b: MemoryStatus): MemoryStatus => (RANK[b] > RANK[a] ? b : a);

export type ReviewReason = "decision" | "no-anchor" | "anchor-unverified" | "untrusted-source";
export function reviewReason(i: {
  kind: MemoryKind; anchorsCount: number; anchorsVerified: boolean; trusted: boolean;
}): ReviewReason | null {
  if (i.kind === "decision") return "decision";
  if (i.anchorsCount === 0) return "no-anchor";
  if (!i.anchorsVerified) return "anchor-unverified";
  if (!i.trusted) return "untrusted-source";
  return null;
}

export const tokens = (text: string): string[] =>
  text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((w) => w.length >= 2);

/** Jaccard token ≥ 0.8. Sengaja kasar: tujuannya mengarahkan agen ke `supersede`, bukan dedup semantik. */
export function isNearDuplicate(a: string, b: string): boolean {
  const A = new Set(tokens(a)); const B = new Set(tokens(b));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.8;
}

const SECRETS: [string, RegExp][] = [
  ["hanoman-token", /hnm_(agt|dev)_[0-9a-f]{16,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["aws-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["api-key", /\bsk-[A-Za-z0-9_-]{20,}/],
];
export function findSecret(text: string): string | null {
  for (const [name, re] of SECRETS) if (re.test(text)) return name;
  return null;
}

export const safeRepoPath = (p: string): boolean =>
  p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes("..");

const globCache = new Map<string, RegExp>();
export function globMatch(glob: string, path: string): boolean {
  let re = globCache.get(glob);
  if (!re) {
    let src = "";
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i]!;
      if (c === "*" && glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; src += "(?:.*/)?"; } else src += ".*";
      } else if (c === "*") src += "[^/]*";
      else if (c === "?") src += "[^/]";
      else src += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    re = new RegExp(`^${src}$`);
    globCache.set(glob, re);
  }
  return re.test(path);
}

export const scopeMatches = (scopePaths: string[], paths: string[]): boolean =>
  scopePaths.length === 0 || paths.some((p) => scopePaths.some((g) => globMatch(g, p)));
