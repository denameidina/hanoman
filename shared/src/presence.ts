import { z } from "zod";

/* SPEC-919 · ADR-0147/0148 · kontrak "sesi apa yang hidup di device mana".
   Muatannya sengaja RINGKAS: hub sudah memegang baris Spec & Project yang menyeberang sync,
   jadi judul/nama/stage di-resolve di sana — beda sadar dari HandledByEntry (ADR-0135) yang
   HARUS membawa `name` karena penerimanya client yang tak punya katalog device. */

export const PRESENCE_PROTOCOL = 1;

/** Plafon jumlah sesi per frame. 100 × ±200 B ≈ 20 KB, jauh di bawah `maxPayload` 64 KiB
    milik plugin WebSocket — frame yang melewatinya akan ditutup 1009 oleh `ws` SEBELUM
    handler kita sempat mengabaikannya, dan socket itu mengangkut changefeed sync. */
export const MAX_PRESENCE_SESSIONS = 100;

/** Kadens pembangunan snapshot di klien (satu `tmux list-panes` asinkron). */
export const PRESENCE_TICK_MS = 3_000;
/** Denyut jaring pengaman: dikirim walau isinya tak berubah. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Tanpa frame selama ini, device dianggap offline — 3× denyut, jadi satu denyut hilang tak menghukum. */
export const PRESENCE_OFFLINE_MS = 90_000;
/** Polisi tidur laju frame per socket. Denyut normal 2/menit; 60 memberi ruang 30×. */
export const PRESENCE_MAX_FRAMES_PER_MIN = 60;

/** deviceId sintetis mesin tempat instance ini berjalan. Bukan `DeviceToken.id` mana pun:
    hub tak menerbitkan token untuk dirinya sendiri, dan penanda di layar tetap harus seragam. */
export const LOCAL_DEVICE_ID = "local";

/* Kosakata status memakai bit yang SUDAH ada, bukan yang ketiga: `waiting` adalah
   `SessionInfo.decision` apa adanya (SPEC-903 · ADR-0143), `exited` adalah `pane_dead`. */
export type PresenceStatus = "working" | "waiting" | "exited";

export const zPresenceSession = z.object({
  sessionId: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  specId: z.string().max(200).optional(),
  flow: z.string().max(40).optional(),
  /** Fase `active` dari `readPhases()`. Absen = sesi tanpa berkas fase (mis. konsol VPS). */
  phase: z.string().max(80).optional(),
  agent: z.enum(["claude", "codex"]),
  status: z.enum(["working", "waiting", "exited"]),
  startedAt: z.string().max(40),
}).strict();
export type PresenceSession = z.infer<typeof zPresenceSession>;

export const zPresenceFrame = z.object({
  t: z.literal("presence"),
  v: z.literal(PRESENCE_PROTOCOL),
  sessions: z.array(zPresenceSession).max(MAX_PRESENCE_SESSIONS),
  deviceId: z.string().optional(),
});
export type PresenceFrame = z.infer<typeof zPresenceFrame>;

/** `statusAt` dicap HUB, bukan klien: "bekerja" tak punya stempel yang jujur di sisi klien
    (aktivitas pane bergerak tiap detik → signature berubah tiap denyut → banjir frame). */
export type PresenceSessionView = PresenceSession & { statusAt: string };

export type PresenceDeviceView = {
  deviceId: string;
  name: string;
  /** Mesin tempat instance ini sendiri berjalan. */
  local: boolean;
  online: boolean;
  /** `DeviceToken.lastSeenAt` — ditulis jalur sync yang sudah ada, bukan oleh kanal ini. */
  lastSeenAt: string | null;
  sessions: PresenceSessionView[];
};

export type PresenceView = {
  /** Instalasi ini memang punya lebih dari satu mesin. `false` → layar tak berubah sama sekali. */
  enabled: boolean;
  devices: PresenceDeviceView[];
};

/** Dedup pengirim. Urutan pane dari tmux tak dijamin stabil, jadi signature diurutkan dulu —
    tanpa itu satu pergeseran urutan mengirim frame yang isinya identik. */
export function presenceSignature(sessions: PresenceSession[]): string {
  return JSON.stringify(
    [...sessions]
      .sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
      .map((s) => [s.sessionId, s.projectId, s.specId ?? "", s.flow ?? "", s.phase ?? "",
        s.agent, s.status, s.startedAt]),
  );
}
