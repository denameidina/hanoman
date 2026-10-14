import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";

type Receipt = { directory: string; ino: number; dev: number; hash: string };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

// This function also runs in the pane before exec, using only non-secret receipt arguments.
function consume(receipt: Receipt, io: typeof fs, hashOf: (bytes: Buffer) => string, parent: string, paths: { join: typeof join; dirname: typeof dirname; basename: typeof basename }): void {
  if (!receipt || typeof receipt.directory !== "string" || paths.dirname(receipt.directory) !== parent
    || !paths.basename(receipt.directory).startsWith("hanoman-ag-env-")) return;
  try {
    const dir = io.lstatSync(receipt.directory), path = paths.join(receipt.directory, "launch.sh"), st = io.lstatSync(path);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.() || (dir.mode & 0o777) !== 0o700
      || !st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid?.() || st.ino !== receipt.ino || st.dev !== receipt.dev
      || st.size > 1024 * 1024 || hashOf(io.readFileSync(path)) !== receipt.hash) return;
    io.unlinkSync(path);
    const metadata = paths.join(receipt.directory, "receipt.json"), meta = io.lstatSync(metadata);
    if (meta.isFile() && !meta.isSymbolicLink() && meta.uid === process.getuid?.()) io.unlinkSync(metadata);
    io.rmdirSync(receipt.directory);
  } catch { /* Missing state or operator replacements are preserved. */ }
}
const hashOf = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function cleanupAntigravityEnvBootstrap(receipt: unknown): void {
  consume(receipt as Receipt, fs, hashOf, tmpdir(), { join, dirname, basename });
}

export function createAntigravityEnvBootstrap(command: string, env: NodeJS.ProcessEnv) {
  const directory = fs.mkdtempSync(join(tmpdir(), "hanoman-ag-env-")); fs.chmodSync(directory, 0o700);
  const path = join(directory, "launch.sh"), metadata = join(directory, "receipt.json");
  // The shell has already opened its script; consuming that file does not change its exec PID.
  const cleaner = `const fs=require('node:fs'),{createHash}=require('node:crypto'),{join,dirname,basename}=require('node:path'); (${consume.toString()})(JSON.parse(fs.readFileSync(process.argv[1],'utf8')),fs,b=>createHash('sha256').update(b).digest('hex'),${JSON.stringify(tmpdir())},require('node:path'));`;
  const exports = ["GEMINI_API_KEY", "GOOGLE_GEMINI_BASE_URL"].map(key => env[key] === undefined ? `unset ${key}` : `export ${key}=${quote(env[key]!)}`);
  const content = `unset GEMINI_API_KEY GOOGLE_GEMINI_BASE_URL CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY\n${quote(process.execPath)} -e ${quote(cleaner)} ${quote(metadata)} || exit 1\ntest ! -e ${quote(path)} || exit 1\n${exports.join("\n")}\nexec ${command}\n`;
  try {
    fs.writeFileSync(path, content, { mode: 0o600, flag: "wx" });
    const st = fs.lstatSync(path), receipt = { directory, ino: st.ino, dev: st.dev, hash: hashOf(Buffer.from(content)) };
    fs.writeFileSync(metadata, JSON.stringify(receipt), { mode: 0o600, flag: "wx" });
    return { directory, path, receipt, command: `exec /bin/sh ${quote(path)}` };
  } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}
