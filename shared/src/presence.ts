import { z } from "zod";

/* SPEC-919 · ADR-0147/0148 · kontrak "sesi apa yang hidup di device mana".
   Muatannya sengaja RINGKAS: hub sudah memegang baris Spec & Project yang menyeberang sync,
   jadi judul/nama/stage di-resolve di sana — beda sadar dari HandledByEntry (ADR-0135) yang
   HARUS membawa `name` karena penerimanya client yang tak punya katalog device. */

export const PRESENCE_PROTOCOL = 1;

/** Plafon jumlah sesi per frame — pagar kewarasan skema, BUKAN pagar byte. */
export const MAX_PRESENCE_SESSIONS = 100;

/** Pagar yang sesungguhnya mengikat, dan ia dihitung per BYTE (pola `PULL_MAX_BYTES`, ADR-0138).
    Plafon jumlah saja tak cukup: panjang maksimum yang SAH untuk `sessionId`/`projectId`/`specId`
    membuat 100 sesi menjadi **86 KB** — di atas `maxPayload` 64 KiB plugin WebSocket, yang
    ditegakkan `ws` dengan close 1009 SEBELUM handler kita sempat mengabaikan apa pun. Socket itu
    mengangkut changefeed sync, jadi frame status yang kebesaran akan menjatuhkan sync — persis
    yang ADR-0147 §4 nyatakan tak boleh terjadi. Setengah `maxPayload` memberi margin 2×. */
export const PRESENCE_MAX_FRAME_BYTES = 32 * 1024;

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
}).strict();
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

/** Potong daftar sesi sampai frame utuhnya muat di `PRESENCE_MAX_FRAME_BYTES`.
    Murni dan dipakai PENGIRIM sebelum `send` — di situlah satu-satunya tempat ukuran frame
    sebenarnya diketahui. Selalu memulangkan minimal nol sesi (daftar kosong tetap frame sah:
    ia berarti "mesin ini tak menjalankan apa pun"). */
export function trimPresenceToBudget(
  sessions: PresenceSession[], maxBytes = PRESENCE_MAX_FRAME_BYTES,
): PresenceSession[] {
  let out = sessions.slice(0, MAX_PRESENCE_SESSIONS);
  while (out.length > 0 && Buffer.byteLength(presenceFrameJson(out)) > maxBytes) {
    // Buang dari EKOR: `listPanesAsync` memulangkan pane dalam urutan tmux, dan yang di depan
    // adalah yang lebih dulu ada — memotong dari sana akan menyembunyikan sesi tertua duluan.
    out = out.slice(0, Math.max(0, Math.floor(out.length / 2)));
  }
  return out;
}

/** Satu-satunya tempat amplop frame dirakit, supaya anggaran byte diukur atas byte yang
    BENAR-BENAR dikirim, bukan atas taksiran. */
export const presenceFrameJson = (sessions: PresenceSession[]): string =>
  JSON.stringify({ t: "presence", v: PRESENCE_PROTOCOL, sessions });

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
