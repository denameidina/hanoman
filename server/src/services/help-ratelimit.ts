// SPEC-253 · ADR-0062 · rate-limit token-bucket in-memory untuk submit keluhan publik — per IP DAN
// per project (cermin error-ingest.ts). Single-process, patuh "tanpa queue/Redis" (ADR-0024).
import { effectiveInt } from "../config";
import { setBounded } from "./bounded-rate-limit";

type Bucket = { tokens: number; ts: number };
const ipBuckets = new Map<string, Bucket>();
const projBuckets = new Map<string, Bucket>();
const acctBuckets = new Map<string, Bucket>();

function take(map: Map<string, Bucket>, k: string, cap: number, now: number): boolean {
  const b = map.get(k) ?? { tokens: cap, ts: now };
  b.tokens = Math.min(cap, b.tokens + ((now - b.ts) * cap) / 60_000); // isi ulang kontinu cap/menit
  b.ts = now;
  if (b.tokens < 1) { setBounded(map, k, b, 4_096); return false; }
  b.tokens -= 1;
  setBounded(map, k, b, 4_096);
  return true;
}

export function helpRateOk(projectId: string, ip: string, now = Date.now()): boolean {
  const ipCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_IP") ?? 5;
  const projCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_PROJECT") ?? 20;
  // SPEC-352 · short-circuit disengaja. Sebelumnya kedua bucket SELALU dikuras, jadi tiap
  // percobaan yang sudah pasti ditolak karena jatah IP habis tetap memakan satu token dari
  // bucket per-project yang dipakai BERSAMA semua pelapor lain — satu pembanjir cukup untuk
  // membuat pelapor sah dari IP lain ikut kena 429.
  return take(ipBuckets, ip, ipCap, now) && take(projBuckets, projectId, projCap, now);
}

// SPEC-626 · ADR-0111 · jalur portal: pelapornya SESI BER-LOGIN, jadi identitasnya akun (yang
// bisa dicabut operator), bukan IP — membatasi per IP justru menghukum satu kantor bersama-sama.
// Bucket per-project TETAP dipakai bersama jalur publik supaya satu project punya satu atap laju
// masuk tiket, dengan short-circuit SPEC-352 yang sama: percobaan yang sudah pasti ditolak jatah
// akun tak ikut mengurasnya.
export function portalTicketRateOk(userId: string, projectId: string, now = Date.now()): boolean {
  const acctCap = effectiveInt("HANOMAN_PORTAL_TICKET_RATE_PER_MIN") ?? 5;
  const projCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_PROJECT") ?? 20;
  return take(acctBuckets, userId, acctCap, now) && take(projBuckets, projectId, projCap, now);
}

export function __resetHelpBuckets() { ipBuckets.clear(); projBuckets.clear(); acctBuckets.clear(); }
