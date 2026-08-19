import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { prisma } from "../db";
import { uploadDir } from "./uploads";

export const UPLOAD_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  parentBytes: 10 * 1024 * 1024,
  projectBytes: 250 * 1024 * 1024,
  globalBytes: 1024 * 1024 * 1024,
  pixels: 40_000_000,
  dimension: 12_000,
  decodeMs: 5_000,
  scanMs: 15_000,
} as const;

const TYPES = {
  "image/png": { extension: ".png", format: "png" as const },
  "image/jpeg": { extension: ".jpg", format: "jpeg" as const },
  "image/webp": { extension: ".webp", format: "webp" as const },
};

export class UploadError extends Error {
  constructor(public readonly code: "UPLOAD_TYPE" | "UPLOAD_DECODE" | "UPLOAD_PIXELS" | "UPLOAD_QUOTA" | "UPLOAD_SCAN", message: string) {
    super(message);
  }
}

// `parentBytes` = byte yang sudah terpakai INDUK unggahan ini (tiket atau backlog item). Dulu
// bernama `ticketBytes`: pipeline ini kini melayani dua domain (SPEC-843), dan nama lama berbohong
// di salah satunya.
type Input = {
  buffer: Buffer; clientName: string; clientMime: string; projectId: string; parentBytes: number;
};
type Deps = {
  storageDir?: string;
  scanner?: (path: string) => Promise<void>;
  usage?: (projectId: string) => Promise<{ project: number; global: number }>;
};
export type SafeUpload = {
  storageKey: string; filename: string; mimeType: string; extension: string;
  size: number; width?: number; height?: number;
};

function timeout<T>(promise: Promise<T>, ms: number, code: UploadError["code"]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new UploadError(code, "upload operation timed out")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function defaultUsage(projectId: string): Promise<{ project: number; global: number }> {
  const [project, global] = await Promise.all([
    prisma.ticketAttachment.aggregate({ where: { projectId }, _sum: { size: true } }),
    prisma.ticketAttachment.aggregate({ _sum: { size: true } }),
  ]);
  return { project: project._sum.size ?? 0, global: global._sum.size ?? 0 };
}

export function scannerFromEnv(path: string): Promise<void> {
  const command = process.env.HANOMAN_UPLOAD_SCANNER?.trim();
  if (!command) {
    if (process.env.NODE_ENV === "production") return Promise.reject(new UploadError("UPLOAD_SCAN", "scanner required"));
    return Promise.resolve();
  }
  if (!isAbsolute(command)) return Promise.reject(new UploadError("UPLOAD_SCAN", "scanner path must be absolute"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, [path], { shell: false, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new UploadError("UPLOAD_SCAN", "scanner timeout")); }, UPLOAD_LIMITS.scanMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new UploadError("UPLOAD_SCAN", `scanner exit ${code}`));
    });
  });
}

function safeFilename(input: string, extension: string): string {
  const stem = basename(input).replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180).trim();
  return `${stem || "upload"}${extension}`;
}

// Karantina → scan → promosi. Diangkat dari badan `processUpload` supaya jalur dokumen memakai
// gerbang malware yang SAMA, bukan salinan yang bisa berselisih. `wx` disengaja: nama karantina
// uuid, jadi berkas yang sudah ada berarti tabrakan sungguhan.
async function commitToStorage(
  buffer: Buffer, extension: string,
  deps: { storageDir?: string; scanner?: (path: string) => Promise<void> },
  beforePromote?: () => Promise<void>,
): Promise<string> {
  const storageDir = deps.storageDir ?? uploadDir();
  const quarantineDir = join(storageDir, ".quarantine");
  await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const quarantine = join(quarantineDir, `${randomUUID()}.upload`);
  const storageKey = `${randomUUID()}${extension}`;
  await writeFile(quarantine, buffer, { mode: 0o600, flag: "wx" });
  try {
    await timeout((deps.scanner ?? scannerFromEnv)(quarantine), UPLOAD_LIMITS.scanMs, "UPLOAD_SCAN");
    await beforePromote?.();
    await rename(quarantine, join(storageDir, storageKey));
  } catch (error) {
    await unlink(quarantine).catch(() => {});
    if (error instanceof UploadError) throw error;
    throw new UploadError("UPLOAD_SCAN", "malware scan failed");
  }
  return storageKey;
}

export async function processUpload(input: Input, deps: Deps = {}): Promise<SafeUpload> {
  if (input.buffer.byteLength === 0 || input.buffer.byteLength > UPLOAD_LIMITS.fileBytes)
    throw new UploadError("UPLOAD_QUOTA", "file quota exceeded");
  if (input.parentBytes + input.buffer.byteLength > UPLOAD_LIMITS.parentBytes)
    throw new UploadError("UPLOAD_QUOTA", "parent quota exceeded");
  const detected = await fileTypeFromBuffer(input.buffer);
  if (!detected || !(detected.mime in TYPES) || detected.mime !== input.clientMime)
    throw new UploadError("UPLOAD_TYPE", "file signature and MIME do not match");
  const mimeType = detected.mime as keyof typeof TYPES;
  const type = TYPES[mimeType];

  let width: number; let height: number; let normalized: Buffer;
  try {
    const source = sharp(input.buffer, { failOn: "error", limitInputPixels: UPLOAD_LIMITS.pixels, sequentialRead: true });
    const metadata = await timeout(source.metadata(), UPLOAD_LIMITS.decodeMs, "UPLOAD_DECODE");
    width = metadata.width ?? 0; height = metadata.height ?? 0;
    if (!width || !height || width > UPLOAD_LIMITS.dimension || height > UPLOAD_LIMITS.dimension
      || width * height > UPLOAD_LIMITS.pixels) throw new UploadError("UPLOAD_PIXELS", "image dimensions exceed policy");
    normalized = await timeout(
      sharp(input.buffer, { failOn: "error", limitInputPixels: UPLOAD_LIMITS.pixels, sequentialRead: true })
        .rotate().toFormat(type.format).toBuffer(),
      UPLOAD_LIMITS.decodeMs,
      "UPLOAD_DECODE",
    );
  } catch (error) {
    if (error instanceof UploadError) throw error;
    throw new UploadError("UPLOAD_DECODE", "image decode failed");
  }

  const usage = await (deps.usage ?? defaultUsage)(input.projectId);
  if (usage.project + normalized.byteLength > UPLOAD_LIMITS.projectBytes
    || usage.global + normalized.byteLength > UPLOAD_LIMITS.globalBytes)
    throw new UploadError("UPLOAD_QUOTA", "storage quota exceeded");

  const storageKey = await commitToStorage(normalized, type.extension, deps, async () => {
    const finalUsage = await (deps.usage ?? defaultUsage)(input.projectId);
    if (finalUsage.project + normalized.byteLength > UPLOAD_LIMITS.projectBytes
      || finalUsage.global + normalized.byteLength > UPLOAD_LIMITS.globalBytes)
      throw new UploadError("UPLOAD_QUOTA", "storage quota exceeded");
  });
  return {
    storageKey,
    filename: safeFilename(input.clientName, type.extension),
    mimeType,
    extension: type.extension,
    size: normalized.byteLength,
    width,
    height,
  };
}

// SPEC-843 · ADR-0124 · tipe dokumen. Peta mime → ekstensi yang SAH untuknya: gerbangnya PASANGAN,
// bukan salah satunya, jadi `.md` ber-mime image/png ditolak dan sebaliknya.
export const DOCUMENT_TYPES: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "text/markdown": [".md"],
  "text/plain": [".txt", ".log"],
  "application/json": [".json"],
  "text/csv": [".csv"],
};

// Tipe yang punya magic bytes; sisanya teks polos. `file-type` memang TAK mengenali teks polos —
// menuntut sniff untuknya berarti menolak semua .md. Gerbang penggantinya `isUtf8Text`.
const SNIFFABLE = new Set(["application/pdf"]);

// Byte NUL tak pernah ada di teks yang sah, dan `TextDecoder` fatal menolak byte UTF-8 tak sah.
// Keduanya bersama menolak biner yang menyamar sebagai .txt/.md/.json/.csv.
function isUtf8Text(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); return true; }
  catch { return false; }
}

// Dokumen disimpan APA ADANYA — tak ada padanan decode/re-encode `sharp` untuk teks/pdf, dan
// menulis ulangnya justru merusak isi yang mau dibaca agen. Jaring pengamannya: ekstensi terkunci,
// `Content-Disposition: attachment`, `nosniff`, dan CSP sandbox di route penyaji.
export async function processDocumentUpload(
  input: { buffer: Buffer; clientName: string; clientMime: string; clientExt: string },
  deps: { storageDir?: string; scanner?: (path: string) => Promise<void> } = {},
): Promise<SafeUpload> {
  const extension = input.clientExt.toLowerCase();
  const allowed = DOCUMENT_TYPES[input.clientMime];
  if (!allowed || !allowed.includes(extension))
    throw new UploadError("UPLOAD_TYPE", "file type and extension do not match");
  if (SNIFFABLE.has(input.clientMime)) {
    const detected = await fileTypeFromBuffer(input.buffer);
    if (detected?.mime !== input.clientMime)
      throw new UploadError("UPLOAD_TYPE", "file signature and MIME do not match");
  } else if (!isUtf8Text(input.buffer)) {
    throw new UploadError("UPLOAD_TYPE", "file is not valid UTF-8 text");
  }
  const storageKey = await commitToStorage(input.buffer, extension, deps);
  return {
    storageKey, filename: safeFilename(input.clientName, extension),
    mimeType: input.clientMime, extension, size: input.buffer.byteLength,
  };
}
