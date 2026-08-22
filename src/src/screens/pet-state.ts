// SPEC-585 · pemetaan status sesi & backlog → pose maskot. Murni, tanpa React/DOM, supaya tabel
// prioritasnya bisa diuji langsung — pola yang sama dipakai terminal-layout.ts & source-meta.ts.
//
// Kosakata sesinya SENGAJA identik dengan sel Terminal (`TerminalScreen`): `awaiting` = hidup &&
// decision, `deciding` menang atasnya, `failed` = exited && exitCode bukan nol. Pet yang memakai
// rumus lain akan mengatakan hal yang berlawanan dengan sel di layar yang sama.
import type { Notification, Spec } from "@hanoman/shared";
import type { TerminalSession } from "../api/client";

export type PetPose = "ready" | "sleeping" | "working" | "deciding" | "waiting" | "blocked"
  | "review" | "shipped" | "docs-updated" | "offline";

// Artwork pose hidup di atlas sprite PET-001 (`pet-sprite.ts`, spec Pet hidup A); sticker STK-*
// tak lagi dipakai pet.

export const POSE_LABEL: Record<PetPose, string> = {
  ready: "siap",
  sleeping: "tidur",
  working: "sedang bekerja",
  deciding: "sedang diputuskan lead",
  waiting: "menunggu jawabanmu",
  blocked: "tertahan",
  shipped: "baru saja selesai",
  review: "menunggu review",
  "docs-updated": "dokumen baru terbit",
  offline: "tak terhubung",
};

// SPEC-897 · `kind` BUKAN `pose`: sesi gagal dan backlog tertahan dependency memakai pose `blocked`
// yang sama tetapi dihitung, didaftar, dan dibuka secara berbeda.
export type PetConditionKind = "offline" | "failed" | "blocked" | "waiting" | "deciding"
  | "shipped" | "docs-updated" | "working" | "review" | "ready";

// Satuan untuk angka di lencana: "2" telanjang di pojok sprite tak punya makna bagi pembaca layar.
export const KIND_NOUN: Record<PetConditionKind, string> = {
  offline: "koneksi terputus",
  failed: "sesi gagal",
  blocked: "backlog tertahan dependency",
  waiting: "sesi menunggu jawabanmu",
  deciding: "sesi sedang diputuskan lead",
  shipped: "kabar selesai",
  "docs-updated": "dokumen terbit",
  working: "sesi berjalan",
  review: "sesi menunggu review",
  ready: "backlog siap dikerjakan",
};

// Umur keadaan transient (`shipped`/`docs-updated`) sejak notifikasinya lahir.
export const PET_TRANSIENT_MS = 45_000;

// SPEC-897 · backoff reconnect `events` mulai 500 ms dan berlipat sampai 10 dtk; tanpa jeda ini
// satu blip jaringan memudarkan pet dan membuat lencana berkedip.
export const PET_OFFLINE_MS = 6_000;
// Sepi selama ini = tidur. Bukan denyut: komponen memakai `recheckAt` untuk satu timeout.
export const PET_SLEEP_MS = 30 * 60_000;
// SPEC-898 · sesi yang menunggu selama ini = mendesak. Ambangnya tinggal di sini bersama ambang
// waktu pet lainnya; `pet-speech.ts` mengimpornya, tak pernah sebaliknya.
export const PET_URGENT_MS = 10 * 60_000;

export const PET_HIDDEN_KEY = "hanoman.pet.hidden";

// Pet hidup A · berkeliaran di tepi bawah (desktop/tablet). "1" = berkeliaran (default), "0" = diam
// di pojok. Tier mobile mengabaikannya: selalu diam (SPEC-763, tap nyasar).
export const PET_ROAM_KEY = "hanoman.pet.roam";

export type PetTarget = { section: "terminal" | "backlog"; sessionId?: string };

// SPEC-897 · status socket `events` yang sudah ada — bukan channel baru (lihat api/events.ts).
export type PetConnection = { connected: boolean; since: number; paused: boolean };

export type PetCondition = {
  kind: PetConditionKind;
  pose: PetPose;
  headline: string;
  detail: string;
  // Berapa hal sejenis; dibawa lencana & daftar panel, bukan lagi sufiks "+N lainnya" di `detail`.
  count: number;
  // Pokok kalimat (id backlog / nama sesi). `headline` ditulis untuk daftar panel selebar 268 px;
  // gelembung butuh pokoknya saja, dan memparsing headline untuk mendapatkannya adalah tebakan.
  subject: string | null;
  // ms epoch kapan kondisi ini MULAI, bila diketahui. null = tak ada stempelnya.
  since: number | null;
  // null = tak ada yang bisa dibuka (kondisi `offline`); memberinya target palsu berarti tombol
  // yang membuka layar yang salah.
  target: PetTarget | null;
  // Kapan kondisi INI berhenti benar tanpa data baru. Menggantikan `transientUntil`: tiga hal
  // memakainya sekarang (luruh transient, habisnya grace terputus, onset tidur) dan ketiganya
  // dilayani satu `setTimeout` di komponen.
  recheckAt: number | null;
};

export type PetView = PetCondition & { conditions: PetCondition[] };

export type PetInput = {
  sessions: TerminalSession[];
  backlog: Spec[];
  notifications: Notification[];
  now: number;
  connection?: PetConnection;   // kosong = dianggap terhubung
  quietSince?: number;          // kosong = tak pernah tidur
};

// `automerge` tak ada di enum `zNotification` walau server menulisnya, jadi perbandingannya lewat
// Set<string> — bukan penyempitan tipe yang justru akan menolak nilai yang benar-benar datang.
export const SHIPPED_TYPES: ReadonlySet<string> = new Set(["done", "automerge"]);

const ONLINE: PetConnection = { connected: true, since: 0, paused: false };

// Urutan daftar sesi datang dari `tmux list-panes -a`; menstabilkannya di sini membuat headline
// tak berganti nama tiap frame siar hanya karena urutan pane bergeser.
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const sessionName = (s: TerminalSession): string => s.specId ?? s.id;

const specOf = (backlog: Spec[], s: TerminalSession): Spec | undefined =>
  (s.specId ? backlog.find((x) => x.id === s.specId) : undefined);

const hhmm = (t: number): string =>
  new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const newestNotifiedAt = (rows: Notification[]): string =>
  rows.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");

// Tanda tangan "ada kehidupan" di dashboard: id sesi hidup + notifikasi terbaru. Komponen mencap
// ulang `quietSince` tiap kali nilai ini berubah — itulah seluruh mekanisme bangun tidur.
export const petPulse = (sessions: TerminalSession[], notifications: Notification[]): string =>
  `${sessions.filter((s) => !s.exited).map((s) => s.id).sort().join(",")}|${newestNotifiedAt(notifications)}`;

export const doneSpecIds = (backlog: Spec[]): Set<string> =>
  new Set(backlog.filter((s) => s.stage === "done").map((s) => s.id));

// Tiap sesi tepat SATU kondisi: panel yang mendaftar semuanya akan menyebut sesi yang sama dua
// kali kalau himpunannya tumpang tindih (sesi ber-`decision` juga memenuhi syarat `working`).
// Urutan di sini ADALAH urutan spesifisitas, dan ia cermin sel Terminal. Diekspor karena rekap
// "selama kamu pergi" (pet-speech.ts) harus memakai klasifikasi yang SAMA — tabel yang disalin ke
// pemakai kedua adalah kelas bug SPEC-431/448.
export function sessionKind(s: TerminalSession, doneSpecs: ReadonlySet<string>): PetConditionKind | null {
  const reviewable = !!s.specId && doneSpecs.has(s.specId);
  if (s.exited) return s.exitCode ? "failed" : reviewable ? "review" : null;
  if (s.decision && !s.deciding) return "waiting";
  if (s.deciding) return "deciding";
  return reviewable ? "review" : "working";
}

export function derivePetConditions(input: PetInput): PetCondition[] {
  const { sessions, backlog, notifications, now } = input;
  const conn = input.connection ?? ONLINE;
  const out: PetCondition[] = [];

  // 1 · terputus menang atas segalanya: apa pun di bawahnya adalah data terakhir, dan pet yang
  // tetap berkata "sedang bekerja" atas data beku adalah bentuk paling murni dari berbohong.
  // `paused` (tab hidden) sengaja BUKAN gangguan — socket ditutup atas permintaan kita sendiri.
  if (!conn.connected && !conn.paused && now - conn.since >= PET_OFFLINE_MS) {
    out.push({
      kind: "offline", pose: "offline",
      headline: `Tak terhubung sejak ${hhmm(conn.since)}`,
      detail: "Dashboard menyambung ulang sendiri; yang tertulis di bawah adalah data terakhir.",
      count: 1, subject: null, since: conn.since, target: null, recheckAt: null,
    });
  }

  const done = doneSpecIds(backlog);
  const audit = new Set(backlog.filter((s) => s.source === "audit").map((s) => s.id));

  const live = sessions.filter((s) => !s.exited);

  const grouped = new Map<PetConditionKind, TerminalSession[]>();
  for (const s of byId(sessions)) {
    const k = sessionKind(s, done);
    if (k) grouped.set(k, [...(grouped.get(k) ?? []), s]);
  }
  const rows = (k: PetConditionKind): TerminalSession[] => grouped.get(k) ?? [];

  const blockedSpecs = byId(backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) > 0));

  const sessionCond = (kind: PetConditionKind, pose: PetPose, of: TerminalSession[],
    headline: (first: TerminalSession) => string, since: number | null = null): PetCondition => ({
    kind, pose, headline: headline(of[0]!),
    detail: specOf(backlog, of[0]!)?.title ?? "Sesi terminal",
    count: of.length, subject: sessionName(of[0]!), since,
    target: { section: "terminal", sessionId: of[0]!.id }, recheckAt: null,
  });

  // Yang TERTUA yang menentukan: sesi yang paling lama tak dijawab adalah yang paling mendesak.
  const oldestDecisionAt = (of: TerminalSession[]): number | null => {
    const stamps = of.map((s) => (s.decisionAt ? Date.parse(s.decisionAt) : NaN))
      .filter((n) => Number.isFinite(n));
    return stamps.length > 0 ? Math.min(...stamps) : null;
  };

  // 2 · sesi gagal. Ia meminta ditengok; backlog yang menunggu giliran tidak.
  const failed = rows("failed");
  const dead = failed[0];
  if (dead) {
    out.push({
      kind: "failed", pose: "blocked",
      headline: `${sessionName(dead)} · sesi gagal`,
      detail: `Keluar dengan exit ${dead.exitCode}`,
      count: failed.length, subject: sessionName(dead), since: null,
      target: { section: "terminal", sessionId: dead.id }, recheckAt: null,
    });
  }

  const stuck = blockedSpecs[0];
  const blockedCond = (): PetCondition => ({
    kind: "blocked", pose: "blocked",
    headline: `${stuck!.id} · tertahan dependency`,
    detail: `Menunggu ${(stuck!.blockedBy ?? []).map((b) => b.id).join(", ")}`,
    count: blockedSpecs.length, subject: stuck!.id, since: null,
    target: { section: "backlog" }, recheckAt: null,
  });
  // 3 · gerbang SPEC-585 dipertahankan: `blockedBy` adalah keadaan normal & berumur panjang di
  // project ber-`dependsOn` (ADR-0093), jadi ia hanya boleh jadi POSE saat tak ada sesi hidup.
  // Saat ada, ia turun ke EKOR daftar — tetap terlihat di panel, tak pernah memimpin.
  if (stuck && live.length === 0) out.push(blockedCond());

  // 4–5 · sesi yang memang menunggu manusia, lalu sesi yang sedang dilayani lead. Yang kedua tak
  // meminta apa-apa darimu (`TerminalSession.deciding`, ADR-0091) — karena itu ia di bawah, dan
  // karena itu pula ia tak boleh menyamar jadi `working` seperti sebelum SPEC-897.
  if (rows("waiting").length) {
    const since = oldestDecisionAt(rows("waiting"));
    out.push({
      ...sessionCond("waiting", "waiting", rows("waiting"), (s) => `Menunggu jawabanmu · ${sessionName(s)}`, since),
      // Pet jadi mendesak TEPAT pada menit ke-10 lewat timeout yang sudah ada — tanpa denyut.
      recheckAt: since !== null && now - since < PET_URGENT_MS ? since + PET_URGENT_MS : null,
    });
  }
  if (rows("deciding").length)
    out.push(sessionCond("deciding", "deciding", rows("deciding"), (s) => `${sessionName(s)} · lead sedang memutuskan`));

  // 6–7 · kabar yang meluruh. Menang atas keadaan mapan (kabar baru lebih informatif), kalah dari
  // gagal & menunggu — perayaan tak boleh menutupi permintaan tolong.
  const fresh = notifications.filter((n) => Date.parse(n.createdAt) + PET_TRANSIENT_MS > now);
  const newest = (rows: Notification[]): Notification | undefined =>
    [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shippedRows = fresh.filter((n) =>
    SHIPPED_TYPES.has(n.type) && !(n.specId && audit.has(n.specId)));
  const docRows = fresh.filter((n) => n.type === "done" && !!n.specId && audit.has(n.specId));
  const shipped = newest(shippedRows);
  const docs = newest(docRows);
  if (shipped) {
    out.push({
      kind: "shipped", pose: "shipped",
      headline: `${shipped.specId ?? "Backlog"} · selesai`, detail: shipped.title,
      count: shippedRows.length, subject: shipped.specId ?? "Backlog", since: null,
      target: { section: "backlog" },
      recheckAt: Date.parse(shipped.createdAt) + PET_TRANSIENT_MS,
    });
  }
  if (docs) {
    out.push({
      kind: "docs-updated", pose: "docs-updated",
      headline: `${docs.specId ?? "Audit"} · dokumen terbit`, detail: docs.title,
      count: docRows.length, subject: docs.specId ?? "Audit", since: null,
      target: { section: "backlog" },
      recheckAt: Date.parse(docs.createdAt) + PET_TRANSIENT_MS,
    });
  }

  // 8–9 · sesi hidup yang backlog-nya BELUM done. Pengecualian itu yang membuat pintu `review` di
  // bawahnya bisa menyala sama sekali: pada jalur sukses pane agen tak pernah mati (SPEC-433), jadi
  // "selesai" hanya terbaca dari `Spec.stage` — yang diturunkan server dari bukti yang sama (fase
  // terminal + plan terceklist, ADR-0029).
  if (rows("working").length)
    out.push(sessionCond("working", "working", rows("working"), (s) => `${sessionName(s)} · sedang berjalan`));
  if (rows("review").length)
    out.push(sessionCond("review", "review", rows("review"), (s) => `${sessionName(s)} · menunggu review`));

  // 10 · ekor: lihat gerbang di #3.
  if (stuck && live.length > 0) out.push(blockedCond());

  return out;
}

// Yang paling awal di antara kandidat yang masih di depan; null bila tak ada.
const earliest = (now: number, ...cands: (number | null)[]): number | null => {
  const future = cands.filter((c): c is number => c !== null && c > now);
  return future.length > 0 ? Math.min(...future) : null;
};

export function derivePetState(input: PetInput): PetView {
  const { backlog, now, quietSince } = input;
  const conn = input.connection ?? ONLINE;
  const conditions = derivePetConditions(input);

  // Lantai. Selalu benar, jadi pet tak pernah kehabisan pose. `count` sengaja 1: jumlah backlog
  // siap sudah ada di headline, dan lencana adalah alarm — ia tak boleh menyala saat istirahat.
  const readySpecs = backlog.filter((s) => s.stage !== "done" && (s.blockedBy?.length ?? 0) === 0);
  const asleep = quietSince !== undefined && now - quietSince >= PET_SLEEP_MS;
  const floor: PetCondition = {
    kind: "ready", pose: asleep ? "sleeping" : "ready",
    headline: asleep
      ? "Tidur — tak ada kabar 30 menit terakhir"
      : readySpecs.length > 0 ? `${readySpecs.length} backlog siap dikerjakan` : "Tidak ada pekerjaan siap",
    detail: asleep ? "Bangun sendiri begitu ada sesi atau notifikasi baru." : "Tak ada sesi yang berjalan",
    count: 1, subject: null, since: null, target: { section: "backlog" }, recheckAt: null,
  };

  const list = conditions.length > 0 ? conditions : [floor];
  const top = list[0]!;
  // Selama grace berjalan pose tetap yang lama, tapi kita harus bangun tepat saat ia habis.
  const offlineAt = !conn.connected && !conn.paused ? conn.since + PET_OFFLINE_MS : null;
  // Tidur HANYA menggantikan lantai: selama satu kondisi masih terdaftar, ada yang meminta.
  const sleepAt = conditions.length === 0 && quietSince !== undefined && !asleep
    ? quietSince + PET_SLEEP_MS : null;

  return { ...top, recheckAt: earliest(now, top.recheckAt, offlineAt, sleepAt), conditions: list };
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
