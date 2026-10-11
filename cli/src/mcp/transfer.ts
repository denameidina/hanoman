// ADR-0183 · ADR-0184 · SATU mekanisme transfer berkas untuk seluruh tool MCP. Server MCP ini
// berbicara JSON teks, jadi berkas tak pernah lewat model: unggah = path LOKAL yang dibaca di sini
// lalu dikirim multipart; unduh = byte ditulis ke disk LOKAL dan model hanya menerima path+ukuran.
//
// Yang dilindungi adalah DISK KLIEN, bukan server: argumen tool datang dari model, dan model bisa
// dibujuk (prompt injection dari isi tiket/laporan) untuk "mengunggah ~/.ssh/id_rsa" atau
// "menyimpan ke ~/.zshrc". Aturannya, seragam untuk unggah dan unduh:
//   1. path hanya boleh jatuh di dalam ROOT yang diizinkan: direktori kerja proses MCP, direktori
//      sementara milik MCP, dan direktori tambahan yang SENGAJA ditulis manusia di konfigurasi;
//   2. segmen `..` ditolak mentah-mentah; sesudahnya `realpath` memastikan symlink tak membawa path
//      keluar root (path hasil resolusi yang dinilai, bukan teks yang diketik model);
//   3. berkas/direktori rahasia (.env, kunci SSH, .git, .hanoman, …) ditolak di kedua arah;
//   4. unggah: hanya berkas biasa, dibuka O_NOFOLLOW, ukuran dibatasi; unduh: tidak menimpa tanpa
//      `overwrite`, tidak pernah menimpa symlink, ukuran dibatasi SAAT mengalir (bukan hanya header).
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { McpDownload, McpUploadFile } from "@hanoman/shared";

export type TransferPolicy = {
  /** Root yang diizinkan (belum di-realpath). */
  roots: readonly string[];
  /** Direktori sementara milik MCP — tujuan simpan default. Selalu salah satu `roots`. */
  downloadDir: string;
  /** Plafon per berkas DAN total satu panggilan unggah (byte). */
  maxBytes: number;
  /** Direktori acuan path relatif. */
  cwd: string;
};

export type TransferResult<T> = ({ ok: true } & T) | { ok: false; message: string };

export const DEFAULT_TRANSFER_MAX = 100 * 1024 * 1024;
const MIN_TRANSFER_MAX = 1024;
const HARD_TRANSFER_MAX = 2 * 1024 * 1024 * 1024;

export type TransferEnv = { cwd: string; home: string; tmp: string };

/**
 * Murni terhadap `argv`/`env`/`fsInfo`. `problems` diisi untuk konfigurasi yang SALAH (bukan sekadar
 * tak lengkap): root `/` meniadakan seluruh batasan, jadi ditolak keras alih-alih diturut.
 */
export function resolveTransferPolicy(
  argv: string[], env: Record<string, string | undefined>,
  info: TransferEnv = { cwd: process.cwd(), home: process.env.HOME ?? "", tmp: tmpdir() },
): { policy: TransferPolicy; problems: string[] } {
  const problems: string[] = [];
  const downloadDir = join(info.tmp, "hanoman-mcp");
  const roots: string[] = [downloadDir];

  // Direktori kerja ikut KECUALI terlalu lebar: klien desktop sering menjalankan MCP dengan cwd `/`
  // atau $HOME, dan mengizinkan itu sama saja dengan tak ada batas.
  const cwdParsed = parse(info.cwd);
  const cwdTooWide = info.cwd === cwdParsed.root || (info.home !== "" && resolve(info.cwd) === resolve(info.home));
  if (!cwdTooWide) roots.push(info.cwd);

  const extra: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === "--transfer-dir" && argv[i + 1]) extra.push(argv[++i]!);
  if (env.HANOMAN_MCP_TRANSFER_DIRS) extra.push(...env.HANOMAN_MCP_TRANSFER_DIRS.split(delimiter));
  for (const raw of extra.map((x) => x.trim()).filter(Boolean)) {
    const abs = resolve(info.cwd, raw);
    if (abs === parse(abs).root) {
      problems.push(`Direktori transfer "${raw}" adalah akar filesystem — itu meniadakan seluruh batasan transfer berkas. Sebut direktori yang spesifik.`);
      continue;
    }
    roots.push(abs);
  }

  const flagIdx = argv.indexOf("--transfer-max-bytes");
  const rawMax = (flagIdx >= 0 ? argv[flagIdx + 1] : undefined) ?? env.HANOMAN_MCP_TRANSFER_MAX_BYTES;
  const parsed = rawMax === undefined ? NaN : Number(rawMax);
  const maxBytes = Number.isFinite(parsed) && parsed >= MIN_TRANSFER_MAX
    ? Math.min(Math.floor(parsed), HARD_TRANSFER_MAX) : DEFAULT_TRANSFER_MAX;

  return { policy: { roots, downloadDir, maxBytes, cwd: info.cwd }, problems };
}

// ── penilaian path ──────────────────────────────────────────────────────────

const SECRET_DIRS = new Set([".ssh", ".aws", ".gnupg", ".git", ".hanoman", ".kube", ".docker", ".azure"]);
const SECRET_NAME = [
  /^\.env(\..+)?$/i, /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i, /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^\.?(npmrc|netrc|pgpass|git-credentials|htpasswd|pypirc)$/i, /^agent-token$/i, /^credentials(\.json)?$/i,
];
const ENV_TEMPLATE = /\.(example|sample|template|dist)$/i;

/**
 * Alasan penolakan, atau `null` bila aman. Dinilai pada path HASIL resolusi, segmen demi segmen.
 * `root` dikupas lebih dulu: yang dinilai hanya bagian DI BAWAH root yang diizinkan, supaya sesi yang
 * kebetulan bekerja di dalam `~/.hanoman/…` atau worktree di bawah `.git`-ish tak menolak dirinya sendiri.
 */
export function secretReason(path: string, root?: string): string | null {
  const below = root && within(root, path) ? relative(root, path) : path;
  const parts = below.split(/[\\/]/).filter(Boolean);
  for (const seg of parts) if (SECRET_DIRS.has(seg.toLowerCase())) return `berada di direktori rahasia \`${seg}\``;
  const name = parts[parts.length - 1] ?? "";
  if (ENV_TEMPLATE.test(name)) return null;
  if (SECRET_NAME.some((r) => r.test(name))) return `\`${name}\` tampak seperti berkas rahasia/kredensial`;
  return null;
}

const hasTraversal = (raw: string) => raw.split(/[\\/]/).includes("..");
const within = (root: string, p: string) => {
  const r = relative(root, p);
  return r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r));
};

async function realRoots(policy: TransferPolicy): Promise<string[]> {
  const out: string[] = [];
  for (const r of policy.roots) {
    try { out.push(await realpath(r)); } catch { /* root belum ada — tak mengizinkan apa pun */ }
  }
  return out;
}
const rootsHint = (policy: TransferPolicy) =>
  `Direktori yang diizinkan: ${policy.roots.join(", ")}. Manusia dapat menambahkan lewat HANOMAN_MCP_TRANSFER_DIRS di konfigurasi klien MCP ini.`;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

// ── unggah ──────────────────────────────────────────────────────────────────

export type ReadFile = { name: string; buf: Buffer };

async function readOne(policy: TransferPolicy, roots: string[], raw: string, budget: number): Promise<TransferResult<ReadFile>> {
  if (!raw || raw.includes("\0")) return { ok: false, message: "filePath kosong atau memuat karakter terlarang." };
  if (hasTraversal(raw)) return { ok: false, message: `Path "${raw}" memuat \`..\` — path traversal ditolak. Pakai path absolut tanpa \`..\`.` };
  const abs = resolve(policy.cwd, raw);
  let real: string;
  try { real = await realpath(abs); }
  catch { return { ok: false, message: `Berkas tidak ditemukan di mesin klien MCP: ${abs}` }; }
  const root = roots.find((r) => within(r, real));
  if (!root)
    return { ok: false, message: `Berkas ${real} berada di luar direktori transfer yang diizinkan (symlink yang keluar juga ditolak). ${rootsHint(policy)}` };
  const secret = secretReason(real, root);
  if (secret) return { ok: false, message: `Berkas ${real} ditolak: ${secret}.` };

  let fh;
  try { fh = await open(real, constants.O_RDONLY | NOFOLLOW); }
  catch { return { ok: false, message: `Berkas tidak bisa dibuka (symlink atau izin): ${real}` }; }
  try {
    const st = await fh.stat();
    if (!st.isFile()) return { ok: false, message: `${real} bukan berkas biasa.` };
    if (st.size > policy.maxBytes)
      return { ok: false, message: `Berkas ${real} berukuran ${st.size} byte, melebihi batas transfer ${policy.maxBytes} byte (HANOMAN_MCP_TRANSFER_MAX_BYTES).` };
    if (st.size > budget)
      return { ok: false, message: `Total berkas melebihi batas transfer ${policy.maxBytes} byte per panggilan.` };
    const buf = Buffer.allocUnsafe(st.size);
    let off = 0;
    while (off < st.size) {
      const { bytesRead } = await fh.read(buf, off, st.size - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    return { ok: true, name: basename(abs), buf: buf.subarray(0, off) };
  } finally { await fh.close(); }
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  zip: "application/zip", log: "text/plain", html: "text/html", svg: "image/svg+xml", mp4: "video/mp4",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const mimeOf = (name: string): string =>
  MIME_BY_EXT[(name.split(".").pop() ?? "").toLowerCase()] ?? "application/octet-stream";

/** Merakit `FormData` dari disk. Satu berkas ditolak = SELURUH panggilan batal (tak ada kiriman separuh). */
export async function buildMultipart(
  policy: TransferPolicy,
  mp: { fields?: readonly (readonly [string, string])[]; files: readonly McpUploadFile[] },
): Promise<TransferResult<{ form: FormData }>> {
  const roots = await realRoots(policy);
  const form = new FormData();
  for (const [k, v] of mp.fields ?? []) form.append(k, v);
  let budget = policy.maxBytes;
  for (const f of mp.files) {
    const r = await readOne(policy, roots, f.filePath, budget);
    if (!r.ok) return r;
    budget -= r.buf.length;
    const name = f.name ?? r.name;
    form.append(f.field, new Blob([r.buf as unknown as BlobPart], { type: mimeOf(name) }), name);
  }
  return { ok: true, form };
}

// ── unduh ───────────────────────────────────────────────────────────────────

/** Nama dasar tanpa path, karakter kontrol/terlarang, dan titik di depan. Kosong bila tak ada yang tersisa. */
export const cleanName = (n: string, keepDots = false): string => {
  // eslint-disable-next-line no-control-regex
  const base = basename(n.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim();
  return keepDots ? (/^\.*$/.test(base) ? "" : base) : base.replace(/^\.+/, "");
};

/** Nama berkas aman dari header `content-disposition`; jatuh ke `fallback` bila kosong/berbahaya. */
export function safeFilename(header: string | null, fallback: string): string {
  let raw: string | undefined;
  const star = header?.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) { try { raw = decodeURIComponent(star[1]!.trim()); } catch { /* pakai bentuk biasa */ } }
  if (!raw) raw = header?.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? header?.match(/filename\s*=\s*([^;]+)/)?.[1]?.trim();
  let name = cleanName(raw ?? "");
  if (!name) name = cleanName(fallback) || "unduhan";
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : "";
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name;
}

/** Membaca badan sampai `cap` byte; `null` bila melebihi (stream dibatalkan, tak dibaca habis). */
async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

type Target = { dir: string; name: string; dest: string; exists: boolean };

async function ensureOwnPrivateDir(dir: string): Promise<string | null> {
  try { await mkdir(dir, { recursive: true, mode: 0o700 }); } catch { return `Tidak bisa membuat direktori sementara ${dir}.`; }
  const st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return `${dir} bukan direktori biasa (symlink?) — ditolak.`;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && st.uid !== uid) return `${dir} dimiliki pengguna lain — ditolak.`;
  if ((st.mode & 0o022) !== 0) return `${dir} dapat ditulis grup/pengguna lain — ditolak.`;
  return null;
}

async function resolveTarget(
  policy: TransferPolicy, spec: Extract<McpDownload, { mode: "file" }>, filename: string,
): Promise<TransferResult<{ t: Target }>> {
  const roots = await realRoots(policy);
  let dir: string;
  let name: string;

  if (!spec.savePath) {
    const bad = await ensureOwnPrivateDir(policy.downloadDir);
    if (bad) return { ok: false, message: bad };
    dir = join(await realpath(policy.downloadDir), randomBytes(6).toString("hex"));
    await mkdir(dir, { mode: 0o700 });
    name = filename;
  } else {
    const raw = spec.savePath;
    if (raw.includes("\0")) return { ok: false, message: "savePath memuat karakter terlarang." };
    if (hasTraversal(raw)) return { ok: false, message: `savePath "${raw}" memuat \`..\` — path traversal ditolak.` };
    const abs = resolve(policy.cwd, raw);
    let isDir = /[\\/]$/.test(raw);
    if (!isDir) { try { isDir = (await stat(abs)).isDirectory(); } catch { /* belum ada → berkas */ } }
    const parent = isDir ? abs : dirname(abs);
    // Nama yang DIKETIK model dipertahankan apa adanya (titik di depan tak dibuang diam-diam:
    // `.env` harus tampak sebagai `.env` agar `secretReason` menolaknya, bukan berubah jadi `env`).
    name = isDir ? filename : (cleanName(basename(abs), true) || filename);
    try { dir = await realpath(parent); }
    catch { return { ok: false, message: `Direktori tujuan belum ada: ${parent}. Buat dulu; tool ini tidak membuat direktori di luar area sementara.` }; }
    const root = roots.find((r) => within(r, dir));
    if (!root)
      return { ok: false, message: `Tujuan ${dir} berada di luar direktori transfer yang diizinkan (symlink yang keluar juga ditolak). ${rootsHint(policy)}` };
    const secret = secretReason(join(dir, name), root);
    if (secret) return { ok: false, message: `Tujuan ${join(dir, name)} ditolak: ${secret}.` };
  }

  const dest = join(dir, name);
  let exists = false;
  try {
    const st = await lstat(dest);
    exists = true;
    if (st.isSymbolicLink()) return { ok: false, message: `${dest} adalah symlink — tidak pernah ditimpa.` };
    if (!st.isFile()) return { ok: false, message: `${dest} bukan berkas biasa.` };
    if (!spec.overwrite)
      return { ok: false, message: `${dest} sudah ada. Pilih savePath lain, atau kirim ulang dengan overwrite:true bila memang ingin menimpanya.` };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, message: `Tujuan ${dest} tak bisa diperiksa.` };
  }
  return { ok: true, t: { dir, name, dest, exists } };
}

export type DownloadOutcome = {
  savedTo: string; filename: string; bytes: number; mime: string; sha256: string;
} | { filename: string; mime: string; bytes: number; content: string };

/**
 * Menerima balasan berkas. Dipanggil HANYA untuk respons 2xx — galat HTTP tetap lewat jalur teks
 * biasa di `client.ts`. Menulis ke `*.part` (atau `wx`) dan membersihkannya bila gagal di tengah.
 */
export async function receiveDownload(
  policy: TransferPolicy, res: Response, spec: McpDownload, inlineCap: number,
): Promise<TransferResult<{ body: DownloadOutcome }>> {
  const filename = safeFilename(res.headers.get("content-disposition"), spec.fallbackName);
  const mime = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim() || "application/octet-stream";
  const declared = Number(res.headers.get("content-length"));

  if (spec.mode === "inline") {
    if (!/^text\/|json|markdown|csv|xml/.test(mime))
      return { ok: false, message: `Balasan bertipe ${mime} bukan teks — tidak bisa dikembalikan inline. Pakai tool unduh-ke-berkas.` };
    if (Number.isFinite(declared) && declared > inlineCap)
      return { ok: false, message: `Balasan ${declared} byte melebihi batas inline ${inlineCap} byte. Pakai tool unduh-ke-berkas.` };
    const buf = await readCapped(res, inlineCap);
    if (!buf) return { ok: false, message: `Balasan melebihi batas inline ${inlineCap} byte. Pakai tool unduh-ke-berkas.` };
    return { ok: true, body: { filename, mime, bytes: buf.length, content: buf.toString("utf8") } };
  }

  if (Number.isFinite(declared) && declared > policy.maxBytes)
    return { ok: false, message: `Berkas ${declared} byte melebihi batas transfer ${policy.maxBytes} byte (HANOMAN_MCP_TRANSFER_MAX_BYTES). Tidak diunduh.` };

  const tgt = await resolveTarget(policy, spec, filename);
  if (!tgt.ok) { await res.body?.cancel().catch(() => undefined); return tgt; }
  const { dest, dir, name, exists } = tgt.t;

  // Menimpa → tulis ke berkas sementara lalu rename (atomik; tak pernah mengikuti symlink di `dest`).
  // Baru → `wx` + O_NOFOLLOW: gagal bila ada yang menyelip membuat berkas itu di antara cek & tulis.
  const writePath = exists ? join(dir, `.${name}.${randomBytes(4).toString("hex")}.part`) : dest;
  let fh;
  try { fh = await open(writePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600); }
  catch (e) {
    await res.body?.cancel().catch(() => undefined);
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, message: code === "EEXIST" ? `${dest} sudah ada (dibuat bersamaan).` : `Tidak bisa menulis ${writePath} (${code ?? "galat"}).` };
  }
  const hash = createHash("sha256");
  let bytes = 0;
  let failure: string | null = null;
  try {
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > policy.maxBytes) {
          await reader.cancel().catch(() => undefined);
          failure = `Berkas melebihi batas transfer ${policy.maxBytes} byte saat mengalir; unduhan dibatalkan dan dihapus.`;
          break;
        }
        hash.update(value);
        await fh.write(value);
      }
    }
  } catch (e) { failure = `Unduhan terputus: ${(e as Error).message}`; }
  finally { await fh.close(); }

  if (failure) { await unlink(writePath).catch(() => undefined); return { ok: false, message: failure }; }
  if (exists) {
    try { await rename(writePath, dest); }
    catch { await unlink(writePath).catch(() => undefined); return { ok: false, message: `Gagal mengganti ${dest}.` }; }
  }
  return { ok: true, body: { savedTo: dest, filename: name, bytes, mime, sha256: hash.digest("hex") } };
}
