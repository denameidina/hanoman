/* SPEC-1215 §S4.1/§S4.3 · ADR-0166 §2 · spool NDJSON bersegmen untuk lajur `server` — NOL tulisan
   SQLite per baris console. Path: $HANOMAN_HOME/log-spool/<lane>/<epochMs>-<n>.ndjson. */
import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";
import { LOG_SPOOL_SEGMENT_BYTES, type LogWireEntry } from "@hanoman/shared";

export function spoolDir(lane: "server"): string {
  return join(resolveDataDirs().home, "log-spool", lane);
}

let segCounter = 0;
let currentFile: string | null = null;
let currentBytes = 0;

async function currentSegment(lane: "server"): Promise<string> {
  const dir = spoolDir(lane);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (currentFile && currentBytes < LOG_SPOOL_SEGMENT_BYTES) return currentFile;
  currentFile = join(dir, `${Date.now()}-${++segCounter}.ndjson`);
  currentBytes = 0;
  return currentFile;
}

/** Menambah satu baris. Kembalikan `{dropped: null}` — pemangkas tekanan (buang tertua) adalah
    tanggung jawab pemanggil (shipper/console-tap), bukan `appendSpool` sendiri, supaya jejak
    `log.gap` tetap ditulis lewat `appendEvent` di lajur `event`. */
export async function appendSpool(lane: "server", entry: LogWireEntry): Promise<{ dropped: null }> {
  const file = await currentSegment(lane);
  const line = JSON.stringify(entry) + "\n";
  await appendFile(file, line, { encoding: "utf8", mode: 0o600 });
  currentBytes += Buffer.byteLength(line, "utf8");
  return { dropped: null };
}

export async function readSpoolSegments(lane: "server"): Promise<{ file: string; entries: LogWireEntry[] }[]> {
  const dir = spoolDir(lane);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const files = names.filter((n) => n.endsWith(".ndjson")).sort();
  const out: { file: string; entries: LogWireEntry[] }[] = [];
  for (const name of files) {
    const file = join(dir, name);
    const raw = await readFile(file, "utf8").catch(() => "");
    const entries = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogWireEntry);
    out.push({ file, entries });
  }
  return out;
}

export async function removeSpoolSegment(file: string): Promise<void> {
  await rm(file, { force: true });
  if (file === currentFile) { currentFile = null; currentBytes = 0; }
}

export async function spoolTotalBytes(lane: "server"): Promise<number> {
  const dir = spoolDir(lane);
  let names: string[];
  try { names = await readdir(dir); } catch { return 0; }
  let total = 0;
  for (const name of names.filter((n) => n.endsWith(".ndjson"))) {
    total += (await stat(join(dir, name)).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Test-only: reset penulis segmen di memori (baru untuk tiap `HANOMAN_HOME` temp yang berbeda). */
export function __resetSpoolWriter(): void { currentFile = null; currentBytes = 0; }
