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
  ticketBytes: 10 * 1024 * 1024,
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

type Input = {
  buffer: Buffer; clientName: string; clientMime: string; projectId: string; ticketBytes: number;
};
type Deps = {
  storageDir?: string;
  scanner?: (path: string) => Promise<void>;
  usage?: (projectId: string) => Promise<{ project: number; global: number }>;
};
export type SafeUpload = {
  storageKey: string; filename: string; mimeType: keyof typeof TYPES; extension: string;
  size: number; width: number; height: number;
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

function scannerFromEnv(path: string): Promise<void> {
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

export async function processUpload(input: Input, deps: Deps = {}): Promise<SafeUpload> {
  if (input.buffer.byteLength === 0 || input.buffer.byteLength > UPLOAD_LIMITS.fileBytes)
    throw new UploadError("UPLOAD_QUOTA", "file quota exceeded");
  if (input.ticketBytes + input.buffer.byteLength > UPLOAD_LIMITS.ticketBytes)
    throw new UploadError("UPLOAD_QUOTA", "ticket quota exceeded");
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

  const storageDir = deps.storageDir ?? uploadDir();
  const quarantineDir = join(storageDir, ".quarantine");
  await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  const quarantine = join(quarantineDir, `${randomUUID()}.upload`);
  const storageKey = `${randomUUID()}${type.extension}`;
  await writeFile(quarantine, normalized, { mode: 0o600, flag: "wx" });
  try {
    await timeout((deps.scanner ?? scannerFromEnv)(quarantine), UPLOAD_LIMITS.scanMs, "UPLOAD_SCAN");
    const finalUsage = await (deps.usage ?? defaultUsage)(input.projectId);
    if (finalUsage.project + normalized.byteLength > UPLOAD_LIMITS.projectBytes
      || finalUsage.global + normalized.byteLength > UPLOAD_LIMITS.globalBytes)
      throw new UploadError("UPLOAD_QUOTA", "storage quota exceeded");
    await rename(quarantine, join(storageDir, storageKey));
  } catch (error) {
    await unlink(quarantine).catch(() => {});
    if (error instanceof UploadError) throw error;
    throw new UploadError("UPLOAD_SCAN", "malware scan failed");
  }
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
