// SPEC-585 · pemetaan status sesi & backlog → pose maskot. Murni, tanpa React/DOM, supaya tabel
// prioritasnya bisa diuji langsung — pola yang sama dipakai terminal-layout.ts & source-meta.ts.
//
// Kosakata sesinya SENGAJA identik dengan sel Terminal (`TerminalScreen`): `awaiting` = hidup &&
// decision, `deciding` menang atasnya, `failed` = exited && exitCode bukan nol. Pet yang memakai
// rumus lain akan mengatakan hal yang berlawanan dengan sel di layar yang sama.
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";

export type PetPose = "ready" | "working" | "waiting" | "blocked" | "review" | "shipped" | "docs-updated";

// Artwork pose hidup di atlas sprite PET-001 (`pet-sprite.ts`, spec Pet hidup A); sticker STK-*
// tak lagi dipakai pet.

export const POSE_LABEL: Record<PetPose, string> = {
  ready: "siap",
  working: "sedang bekerja",
  waiting: "menunggu jawabanmu",
  blocked: "tertahan",
  shipped: "baru saja selesai",
  review: "menunggu review",
  "docs-updated": "dokumen baru terbit",
};

// Umur keadaan transient (`shipped`/`docs-updated`) sejak notifikasinya lahir.
export const PET_TRANSIENT_MS = 45_000;

export const PET_HIDDEN_KEY = "hanoman.pet.hidden";

// Pet hidup A · berkeliaran di tepi bawah (desktop/tablet). "1" = berkeliaran (default), "0" = diam
// di pojok. Tier mobile mengabaikannya: selalu diam (SPEC-763, tap nyasar).
export const PET_ROAM_KEY = "hanoman.pet.roam";

export type PetTarget = { section: "terminal" | "backlog"; sessionId?: string };

export type PetView = {
  pose: PetPose;
  headline: string;
  detail: string;
  target: PetTarget;
  // Non-null HANYA saat pose-nya sendiri transient: itulah satu-satunya saat keadaan bisa berubah
  // tanpa data baru, jadi itu satu-satunya saat komponen perlu menjadwalkan hitung ulang.
  transientUntil: number | null;
};

export type PetInput = {
  sessions: TerminalSession[];
  backlog: Spec[];
  notifications: Notification[];
  now: number;
};

// `automerge` tak ada di enum `zNotification` walau server menulisnya, jadi perbandingannya lewat
// Set<string> — bukan penyempitan tipe yang justru akan menolak nilai yang benar-benar datang.
const SHIPPED_TYPES = new Set<string>(["done", "automerge"]);

// Urutan daftar sesi datang dari `tmux list-panes -a`; menstabilkannya di sini membuat headline
// tak berganti nama tiap frame siar hanya karena urutan pane bergeser.
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const sessionName = (s: TerminalSession): string => s.specId ?? s.id;

const specOf = (backlog: Spec[], s: TerminalSession): Spec | undefined =>
  (s.specId ? backlog.find((x) => x.id === s.specId) : undefined);

const others = (count: number): string => (count > 1 ? ` · +${count - 1} lainnya` : "");

export function derivePetState({ sessions, backlog, notifications, now }: PetInput): PetView {
  const done = new Set(backlog.filter((s) => s.stage === "done").map((s) => s.id));
  const audit = new Set(backlog.filter((s) => s.source === "audit").map((s) => s.id));

  const live = byId(sessions.filter((s) => !s.exited));
  const failed = byId(sessions.filter((s) => s.exited && !!s.exitCode));
  const waiting = live.filter((s) => !!s.decision && !s.deciding);
  const reviewing = byId(sessions.filter((s) => !!s.specId && done.has(s.specId)));
  const working = live.filter((s) => !(s.specId && done.has(s.specId)));

  const blockedSpecs = byId(backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) > 0));
  const readySpecs = backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) === 0);

  const fresh = notifications.filter((n) => Date.parse(n.createdAt) + PET_TRANSIENT_MS > now);
  const newest = (rows: Notification[]): Notification | undefined =>
    [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shipped = newest(fresh.filter((n) =>
    SHIPPED_TYPES.has(n.type) && !(n.specId && audit.has(n.specId))));
  const docs = newest(fresh.filter((n) => n.type === "done" && !!n.specId && audit.has(n.specId)));

  // 1 · sesi gagal selalu menang. Backlog yang tertahan dependency HANYA memblokir saat tak ada
  // sesi hidup: `blockedBy` adalah keadaan normal & berumur panjang di project ber-`dependsOn`
  // (ADR-0093), dan tanpa gerbang itu pet terkunci di satu pose selamanya lalu berhenti memberi
  // tahu apa pun. Backlog yang menunggu giliran tak sedang meminta apa-apa dari manusia.
  const dead = failed[0];
  if (dead) {
    return {
      pose: "blocked",
      headline: `${sessionName(dead)} · sesi gagal`,
      detail: `Keluar dengan exit ${dead.exitCode}${others(failed.length)}`,
      target: { section: "terminal", sessionId: dead.id },
      transientUntil: null,
    };
  }
  const stuck = blockedSpecs[0];
  if (live.length === 0 && stuck) {
    return {
      pose: "blocked",
      headline: `${stuck.id} · tertahan dependency`,
      detail: `Menunggu ${(stuck.blockedBy ?? []).map((b) => b.id).join(", ")}${others(blockedSpecs.length)}`,
      target: { section: "backlog" },
      transientUntil: null,
    };
  }

  // 2 · sesi yang memang menunggu manusia. `deciding` dikecualikan: sesi yang sedang disusunkan
  // keputusannya oleh hanoman-lead terlihat identik di layar (diam, marker terisi), dan membacanya
  // sebagai "butuh kamu" adalah alarm palsu.
  const asks = waiting[0];
  if (asks) {
    return {
      pose: "waiting",
      headline: `Menunggu jawabanmu · ${sessionName(asks)}`,
      detail: `${specOf(backlog, asks)?.title ?? "Sesi terminal"}${others(waiting.length)}`,
      target: { section: "terminal", sessionId: asks.id },
      transientUntil: null,
    };
  }

  // 3–4 · kabar yang meluruh. Menang atas keadaan mapan (kabar baru lebih informatif), kalah dari
  // gagal & menunggu — perayaan tak boleh menutupi permintaan tolong.
  if (shipped) {
    return {
      pose: "shipped",
      headline: `${shipped.specId ?? "Backlog"} · selesai`,
      detail: shipped.title,
      target: { section: "backlog" },
      transientUntil: Date.parse(shipped.createdAt) + PET_TRANSIENT_MS,
    };
  }
  if (docs) {
    return {
      pose: "docs-updated",
      headline: `${docs.specId ?? "Audit"} · dokumen terbit`,
      detail: docs.title,
      target: { section: "backlog" },
      transientUntil: Date.parse(docs.createdAt) + PET_TRANSIENT_MS,
    };
  }

  // 5 · sesi hidup yang backlog-nya BELUM done. Pengecualian itu yang membuat pintu `review` di
  // bawah bisa menyala sama sekali: pada jalur sukses pane agen tak pernah mati (SPEC-433), jadi
  // "selesai" hanya terbaca dari `Spec.stage` — yang diturunkan server dari bukti yang sama
  // (fase terminal + plan terceklist, ADR-0029).
  const busy = working[0];
  if (busy) {
    return {
      pose: "working",
      headline: `${sessionName(busy)} · sedang berjalan`,
      detail: `${specOf(backlog, busy)?.title ?? "Sesi terminal"}${others(working.length)}`,
      target: { section: "terminal", sessionId: busy.id },
      transientUntil: null,
    };
  }

  const ready = reviewing[0];
  if (ready) {
    return {
      pose: "review",
      headline: `${sessionName(ready)} · menunggu review`,
      detail: `${specOf(backlog, ready)?.title ?? "Sesi terminal"}${others(reviewing.length)}`,
      target: { section: "terminal", sessionId: ready.id },
      transientUntil: null,
    };
  }

  // 7 · lantai. Selalu benar, jadi pet tak pernah kehabisan pose.
  return {
    pose: "ready",
    headline: readySpecs.length > 0 ? `${readySpecs.length} backlog siap dikerjakan` : "Tidak ada pekerjaan siap",
    detail: "Tak ada sesi yang berjalan",
    target: { section: "backlog" },
    transientUntil: null,
  };
}

export function loadPetHidden(): boolean {
  try { return localStorage.getItem(PET_HIDDEN_KEY) === "1"; } catch { return false; }
}

export function savePetHidden(hidden: boolean): void {
  try { localStorage.setItem(PET_HIDDEN_KEY, hidden ? "1" : "0"); } catch { /* mode privat / kuota penuh */ }
}

export function loadPetRoam(): boolean {
  try { return localStorage.getItem(PET_ROAM_KEY) !== "0"; } catch { return true; }
}

export function savePetRoam(roam: boolean): void {
  try { localStorage.setItem(PET_ROAM_KEY, roam ? "1" : "0"); } catch { /* mode privat / kuota penuh */ }
}
