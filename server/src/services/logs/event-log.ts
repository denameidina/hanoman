import { hostname } from "node:os";
import { Prisma } from "@prisma/client";
import {
  LOCAL_DEVICE_ID, LOG_DATA_MAX_BYTES, LOG_MSG_MAX_BYTES, nextSeq, redactText, splitUtf8, utf8Bytes,
  type LogEntryView, type LogLane, type LogLevel,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { registerSessionHooks } from "../pty";
import { knownSecrets } from "./redact-known";
import { saveTranscript } from "../transcript-store";

/* SPEC-1215 · ADR-0166 · lajur `event` instance ini (`deviceId` "local"). Semua event — lahir/tutup
   sesi, audit aksi jarak jauh, perubahan grant — masuk lewat SATU pintu ini, supaya seq HLC hanya
   punya satu penulis. Pengiriman ke hub milik SPEC-1217; di A baris ini sudah menjadi audit lokal
   yang bisa dibaca operator klien di panel Kendali jarak jauh. */

export type EventInput = {
  kind: string; msg: string; level?: LogLevel;
  projectId?: string | null; specId?: string | null; sessionId?: string | null;
  data?: Record<string, unknown> | null; at?: Date;
};

let lastSeq: number | null = null;
// Serial: dua `appendEvent` serentak yang sama-sama membaca `lastSeq` akan menghasilkan seq kembar
// dan P2002 pada unique (deviceId, lane, seq).
let tail: Promise<void> = Promise.resolve();

async function loadLastSeq(): Promise<number> {
  const row = await prisma.logEntry.findFirst({
    where: { deviceId: LOCAL_DEVICE_ID, lane: "event" }, orderBy: { seq: "desc" }, select: { seq: true },
  });
  return row ? Number(row.seq) : 0;
}

function boundedData(data: Record<string, unknown> | null | undefined): { json: Record<string, unknown> | null; bytes: number } {
  if (!data) return { json: null, bytes: 0 };
  const bytes = utf8Bytes(JSON.stringify(data));
  if (bytes <= LOG_DATA_MAX_BYTES) return { json: data, bytes };
  const marker = { truncated: true, bytes };
  return { json: marker, bytes: utf8Bytes(JSON.stringify(marker)) };
}

/** Fire-and-forget yang aman: TAK PERNAH reject. Audit yang gagal ditulis tak boleh menggagalkan
    aksi yang diauditnya, dan kegagalannya tetap terlihat di log server. */
export function appendEvent(e: EventInput): Promise<void> {
  const run = tail.then(async () => {
    lastSeq ??= await loadLastSeq();
    const at = e.at ?? new Date();
    const seq = nextSeq(lastSeq, at.getTime());
    const msg = splitUtf8(e.msg, LOG_MSG_MAX_BYTES)[0] ?? "";
    const data = boundedData(e.data);
    await prisma.logEntry.create({
      data: {
        deviceId: LOCAL_DEVICE_ID, lane: "event", seq: BigInt(seq), ts: at, level: e.level ?? "info",
        kind: e.kind, projectId: e.projectId ?? null, specId: e.specId ?? null, sessionId: e.sessionId ?? null,
        msg, ...(data.json ? { data: data.json as Prisma.InputJsonValue } : {}), bytes: utf8Bytes(msg) + data.bytes,
      },
    });
    lastSeq = seq;
  });
  const settled = run.catch((err: unknown) => {
    lastSeq = null; // muat ulang dari DB: kegagalan bisa berarti seq di memori sudah basi
    console.error(`log event ${e.kind} gagal dicatat:`, err);
  });
  tail = settled;
  return settled;
}

/** AC-D3/AC-D4 · satu pintu untuk mencatat kehilangan (spool penuh, redaksi gagal, batch ditolak
    hub). `lost` default 1: kebanyakan pemanggil kehilangan tepat satu entri per kejadian. */
export async function appendGap(
  reason: string, opts: { lost?: number; fromSeq?: string; toSeq?: string } = {},
): Promise<void> {
  await appendEvent({
    kind: "log.gap", level: "warn", msg: `celah log: ${reason}`,
    data: { lost: opts.lost ?? 1, reason, fromSeq: opts.fromSeq ?? null, toSeq: opts.toSeq ?? null },
  });
}

type LogRow = Awaited<ReturnType<typeof prisma.logEntry.findMany>>[number];

export function toLogEntryView(r: LogRow): LogEntryView {
  return {
    id: r.id, deviceId: r.deviceId, deviceName: r.deviceId === LOCAL_DEVICE_ID ? hostname() : r.deviceId,
    lane: r.lane as LogLane, seq: r.seq.toString(), ts: r.ts.toISOString(), receivedAt: r.receivedAt.toISOString(),
    level: r.level as LogLevel, kind: r.kind, projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    msg: r.msg, data: (r.data as Record<string, unknown> | null) ?? null, hasTranscript: !!r.transcriptKey,
  };
}

/** Audit yang ditampilkan ke operator KLIEN: apa yang dilakukan hub di mesinnya (K7 transparansi). */
export async function recentAudit(limit = 50): Promise<LogEntryView[]> {
  const rows = await prisma.logEntry.findMany({
    where: {
      deviceId: LOCAL_DEVICE_ID, lane: "event",
      OR: [{ kind: { startsWith: "remote." } }, { kind: "grant.changed" }],
    },
    orderBy: [{ ts: "desc" }, { id: "desc" }], take: limit,
  });
  return rows.map(toLogEntryView);
}

/** `cwd` dan transkrip SENGAJA tak dicatat: keduanya milik mesin ini (alasan yang sama dengan
    presence, ADR-0148). Transkrip menyeberang hanya lewat lajur `transcript` opt-in (SPEC-1217). */
export function installEventTap(
  opts: { transcriptEnabled: () => Promise<boolean> } = { transcriptEnabled: async () => false },
): () => void {
  return registerSessionHooks({
    onBirth: (b) => {
      void appendEvent({
        kind: "session.start", msg: `sesi ${b.sessionId} lahir`,
        projectId: b.projectId, specId: b.specId ?? null, sessionId: b.sessionId,
        data: { kind: b.kind, flow: b.flow ?? null, agent: b.agent, model: b.model ?? null, effort: b.effort ?? null, branch: b.branch ?? null },
      });
    },
    onDeath: (d) => {
      void appendEvent({
        kind: "session.end", level: d.exitCode !== null && d.exitCode !== 0 ? "warn" : "info",
        msg: `sesi ${d.sessionId} ditutup (exit ${d.exitCode ?? "?"})`, sessionId: d.sessionId,
        data: { exitCode: d.exitCode },
      });
      void (async () => {
        if (!(await opts.transcriptEnabled())) return;
        const text = d.transcript ?? "";
        if (!text.trim()) return;
        let redacted: string;
        try { redacted = redactText(text, knownSecrets()); }
        catch { await appendGap("redaction-failed"); return; }
        const saved = await saveTranscript(redacted).catch(() => null);
        if (!saved || !saved.key) return;
        await appendEvent({
          kind: "session.transcript", sessionId: d.sessionId,
          msg: `transkrip sesi ${d.sessionId}`, data: { bytes: saved.bytes, truncated: saved.truncated },
        }).then(async () => {
          // `appendEvent` tak mengembalikan id baris; tulis transcriptKey lewat update terakhir
          // yang cocok (deviceId "local", lane "event", kind "session.transcript", sessionId).
          await prisma.logEntry.updateMany({
            where: { deviceId: LOCAL_DEVICE_ID, lane: "event", kind: "session.transcript", sessionId: d.sessionId },
            data: { transcriptKey: saved.key },
          });
        });
      })();
    },
  });
}

/** Test-only: lupakan seq di memori (mensimulasikan restart). */
export function __resetEventLog(): void { lastSeq = null; }
