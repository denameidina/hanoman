import { randomUUID } from "node:crypto";
import {
  ACCESS_REQUEST_HISTORY_MAX, ACCESS_REQUEST_MAX_PER_WINDOW, ACCESS_REQUEST_TTL_MS, ACCESS_REQUEST_WINDOW_MS,
  type AccessRequestStatus, type AccessRequestView, type RequestTier,
} from "@hanoman/shared";

/* ADR-0217 · antrean permintaan tingkat akses DI PERANGKAT INI (sisi tujuan). Keadaan di MEMORI, tanpa
   skema dan tanpa Setting: permintaan hidup 10 menit, dan restart proses membuang antrean. Tak ada yang
   berlaku sebelum disetujui, jadi kehilangan antrean itu aman. Id-nya acak (randomUUID), BUKAN penghitung:
   penghitung yang mulai dari nol setiap restart memakai ulang `ar1`, dan kartu lama bisa menyetujui tingkat
   yang tak dilihat operator. Persetujuan karena itu harus mencocokkan id, tingkat, dan hub (lihat
   `takeAccessRequest`). Modul ini tak tahu apa-apa soal grant. Penerapan persetujuan ada di
   routes/remote-control.ts lewat `updateRemoteControl`, pagar yang sama dengan PUT lokal.

   Batas: satu permintaan TERTUNDA sekaligus (satu relay = satu hub peminta), dan paling banyak
   `ACCESS_REQUEST_MAX_PER_WINDOW` permintaan diterima per `ACCESS_REQUEST_WINDOW_MS`. Keduanya menutup
   spam kartu persetujuan di layar operator, bukan menggantikan persetujuan itu sendiri. */

export type Entry = {
  id: string; tier: RequestTier; state: "pending" | "approved" | "rejected";
  requestedAt: number; expiresAt: number; decidedAt: number | null; from: string; requestedBy: string;
};

/** Label bahasa biasa untuk pesan operator (sama dengan `remote-access-tier.ts` di layar). */
export const REQUEST_TIER_LABEL: Readonly<Record<RequestTier, string>> = { lihat: "Lihat", kerja: "Kerja", tulis: "Tulis" };

const entries: Entry[] = []; // terbaru di depan
const accepted: number[] = []; // stempel waktu permintaan yang DITERIMA, untuk jendela rate limit

/** Pesan 409 bila keputusan operator tak lagi cocok dengan permintaan tertunda (kartu sudah basi). */
export const STALE_REQUEST_MESSAGE = "Permintaan berubah, periksa lagi";

const statusOf = (e: Entry, now: number): AccessRequestStatus =>
  e.state === "pending" && now >= e.expiresAt ? "expired" : e.state;

export const viewOf = (e: Entry, now: number): AccessRequestView => ({
  id: e.id, tier: e.tier, status: statusOf(e, now),
  requestedAt: new Date(e.requestedAt).toISOString(), expiresAt: new Date(e.expiresAt).toISOString(),
  decidedAt: e.decidedAt === null ? null : new Date(e.decidedAt).toISOString(),
  from: e.from, requestedBy: e.requestedBy,
});

export type CreateOutcome =
  | { ok: true; view: AccessRequestView }
  | { ok: false; reason: "pending"; view: AccessRequestView }
  | { ok: false; reason: "rate-limited"; retryAfterMs: number };

export function createAccessRequest(
  input: { tier: RequestTier; from: string; requestedBy: string },
  now: number = Date.now(),
): CreateOutcome {
  const waiting = entries.find((e) => e.state === "pending" && now < e.expiresAt);
  if (waiting) return { ok: false, reason: "pending", view: viewOf(waiting, now) };
  while (accepted.length && accepted[0]! <= now - ACCESS_REQUEST_WINDOW_MS) accepted.shift();
  if (accepted.length >= ACCESS_REQUEST_MAX_PER_WINDOW)
    return { ok: false, reason: "rate-limited", retryAfterMs: accepted[0]! + ACCESS_REQUEST_WINDOW_MS - now };
  accepted.push(now);
  const entry: Entry = {
    id: randomUUID(), tier: input.tier, state: "pending", requestedAt: now, expiresAt: now + ACCESS_REQUEST_TTL_MS,
    decidedAt: null, from: input.from, requestedBy: input.requestedBy,
  };
  entries.unshift(entry);
  entries.length = Math.min(entries.length, ACCESS_REQUEST_HISTORY_MAX);
  return { ok: true, view: viewOf(entry, now) };
}

/** Terbaru dulu. `from` (bila diisi) menyaring ke permintaan dari hub itu saja — dipakai relay. */
export function listAccessRequests(now: number = Date.now(), from?: string): AccessRequestView[] {
  return entries.filter((e) => from === undefined || e.from === from).map((e) => viewOf(e, now));
}

export type TakeOutcome =
  | { ok: true; entry: Entry }
  | { ok: false; status: 404 | 409; error: string };

/** Keputusan atomik (sinkron): permintaan pending dan belum kedaluwarsa → berpindah ke `decision`.
    `expect` (dari persetujuan): tingkat dan hub yang DILIHAT operator di kartu harus masih cocok dengan
    permintaan dengan id itu. Id yang tak ada lagi (mis. sebelum restart) juga 409, bukan 404, karena kartu
    di layar yang basilah penyebabnya. Tak cocok → 409 tanpa mengubah apa pun.
    Pemanggil yang gagal menerapkannya WAJIB memanggil `revertAccessRequest`. */
export function takeAccessRequest(
  id: string, decision: "approved" | "rejected", now: number = Date.now(),
  expect?: { tier: RequestTier; from: string },
): TakeOutcome {
  const e = entries.find((x) => x.id === id);
  if (expect && (!e || e.tier !== expect.tier || e.from !== expect.from))
    return { ok: false, status: 409, error: STALE_REQUEST_MESSAGE };
  if (!e) return { ok: false, status: 404, error: "permintaan tak ditemukan" };
  if (e.state !== "pending") return { ok: false, status: 409, error: "permintaan sudah diputuskan" };
  if (now >= e.expiresAt) return { ok: false, status: 409, error: "permintaan sudah kedaluwarsa" };
  e.state = decision;
  e.decidedAt = now;
  return { ok: true, entry: e };
}

/** Membatalkan keputusan yang belum berhasil diterapkan: kembali pending (bila belum kedaluwarsa). */
export function revertAccessRequest(id: string): void {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  e.state = "pending";
  e.decidedAt = null;
}

export function viewById(id: string, now: number = Date.now()): AccessRequestView | null {
  const e = entries.find((x) => x.id === id);
  return e ? viewOf(e, now) : null;
}

/** Test-only. */
export function __resetAccessRequests(): void {
  entries.length = 0;
  accepted.length = 0;
}
