import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@hanoman/shared";
import { effectiveStr } from "../../config";
import { rootBypassEnv } from "../pty";
import { sandboxArgvFromEnv } from "../session-sandbox";

// SPEC-409 · ADR-0091 · lead adalah AGEN, bukan aturan if/else: pertanyaan yang ia jawab berbentuk
// prosa dan jawabannya menuntut membaca docs/kode/riwayat. Ia dipanggil SEKALI-JALAN dan
// NON-INTERAKTIF (`claude -p` / `codex exec`), lalu keluar.
//
// Ini BUKAN menghidupkan kembali run headless yang dicabut ADR-0024. Yang dicabut itu adalah
// MENGERJAKAN pekerjaan lewat CLI headless bertahap (spec/plan/execute) — pekerjaan tetap milik
// sesi interaktif di tmux. Lead adalah panggilan penasihat berumur pendek yang keluarannya satu
// blok JSON; ia tak menyentuh worktree sesi mana pun dan tak punya fase.
//
// Konsekuensi yang diterima sadar (PRD OQ-1): pemakaian kuotanya menumpang langganan yang sama
// dengan sesi pekerja, dan itu terlihat di badge limit yang sudah ada — bukan akunting terpisah.

/** Cermin `claudeBin()`/`codexBin()` di pty.ts — knob yang sama, supaya test bisa menukar biner. */
const binFor = (agent: Agent): string =>
  agent === "codex"
    ? effectiveStr("HANOMAN_CODEX_BIN") ?? "codex"
    : effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";

/**
 * Argv one-shot per agen. TANPA `--settings`/hook: lead tak punya marker keputusan (ia tak boleh
 * bertanya balik — AC-22) dan tak punya berkas fase.
 *
 * `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` tetap dipasang
 * dengan alasan yang sama seperti sesi pekerja (ADR-0037): tanpa itu panggilan non-interaktif
 * menggantung di prompt izin yang tak ada manusianya. Batas kerasnya bukan di sini melainkan di
 * permukaan tindakan lead (shared/src/lead.ts + routes/lead.ts) — lead tak pernah men-shell-out
 * hasil pikirannya sendiri.
 */
export function leadArgv(o: { agent: Agent; model: string; effort: string; prompt: string }): string[] {
  if (o.agent === "codex") {
    return [
      "exec",
      ...(o.model ? ["-m", o.model] : []),
      ...(o.effort ? ["-c", `model_reasoning_effort="${o.effort}"`] : []),
      "--dangerously-bypass-approvals-and-sandbox",
      o.prompt,
    ];
  }
  return [
    "-p",
    ...(o.model ? ["--model", o.model] : []),
    ...(o.effort ? ["--effort", o.effort] : []),
    "--dangerously-skip-permissions",
    o.prompt,
  ];
}

/**
 * SPEC-448 (QA) · env proses lead. `brain.ts` adalah titik spawn agen KEDUA di hanoman — satu-satunya
 * di luar `pty.ts` — dan gerbang root claude yang dibuka SPEC-403 tak pernah menyeberang ke sini:
 * kedua commit lahir di worktree paralel di hari yang sama (`e5c73ac` bukan leluhur `a16465e`).
 * Akibatnya, di deployment lama yang menjalankan server sebagai root, claude mencetak
 * "--dangerously-skip-permissions cannot be used with
 * root/sudo privileges" lalu `process.exit(1)` sebelum berpikir, dan lead tak pernah sekalipun
 * menghasilkan keputusan.
 *
 * `rootBypassEnv` DIIMPOR dari `pty.ts`, bukan disalin: yang membuat bug ini ada adalah dua titik
 * spawn yang tak sepakat, dan definisi kedua akan mengundangnya kembali. Hanya untuk **claude** —
 * codex (0.146.0) tak punya gerbang root maupun rujukan ke `IS_SANDBOX`, cermin gerbang agen di
 * `pty.ts`. Env pemanggil ditumpuk BELAKANGAN supaya `IS_SANDBOX` yang sudah disetel operator
 * tetap menang, urutan yang sama dengan `envPairs` di sana.
 */
export const leadEnv = (
  agent: Agent,
  base: NodeJS.ProcessEnv = process.env,
  uid = process.getuid?.(),
): NodeJS.ProcessEnv => (agent === "claude" ? { ...rootBypassEnv(uid), ...base } : { ...base });

export type ThinkOpts = {
  agent: Agent; model: string; effort: string;
  cwd?: string; timeoutMs: number;
};

export type LeadProcess = {
  file: string; args: string[]; cwd?: string; promptFile?: string; cleanup(): void;
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

export function leadProcess(
  prompt: string,
  o: ThinkOpts,
  env: NodeJS.ProcessEnv = process.env,
): LeadProcess {
  const file = binFor(o.agent);
  const directArgs = leadArgv({ agent: o.agent, model: o.model, effort: o.effort, prompt });
  const mode = env.HANOMAN_SESSION_SANDBOX ?? (env.NODE_ENV === "production" ? "required" : "off");
  if (mode === "off") return { file, args: directArgs, cwd: o.cwd, cleanup: () => {} };

  const promptDir = join(tmpdir(), "hanoman-prompts");
  mkdirSync(promptDir, { recursive: true, mode: 0o700 });
  const promptFile = join(promptDir, `oneshot-${randomUUID()}`);
  writeFileSync(promptFile, prompt, { flag: "wx", mode: 0o600 });
  const workspace = o.cwd ?? join(tmpdir(), `hanoman-oneshot-${randomUUID()}`);
  if (!o.cwd) mkdirSync(workspace, { recursive: false, mode: 0o700 });
  try {
    const argsWithoutPrompt = directArgs.slice(0, -1);
    const command = [file, ...argsWithoutPrompt].map(shellQuote).join(" ")
      + ` "$(cat ${shellQuote(promptFile)})"`;
    const sandbox = sandboxArgvFromEnv({
      command, worktree: workspace, worktreeMode: "ro", promptFile, env,
    });
    if (!sandbox) throw new Error("sandbox one-shot tidak aktif");
    return {
      file: sandbox[0]!, args: sandbox.slice(1), promptFile,
      cleanup: () => {
        rmSync(promptFile, { force: true });
        if (!o.cwd) rmSync(workspace, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(promptFile, { force: true });
    if (!o.cwd) rmSync(workspace, { recursive: true, force: true });
    throw error;
  }
}

/** Bentuk galat `execFile` yang benar-benar dibaca — bukan seluruh `ErrnoException`. */
export type ExecFailure = {
  message: string;
  code?: number | string;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
};

/** Sebab gagal hidup di EKOR keluaran (cermin cap transkrip ADR-0079), bukan di kepalanya. */
const EXPLAIN_MAX = 500;
const tail = (s: string): string => {
  const t = s.trim();
  return t.length > EXPLAIN_MAX ? `…${t.slice(-EXPLAIN_MAX)}` : t;
};

/**
 * SPEC-472 (QA) · alasan gagal yang bisa DIBACA operator. Murni supaya bentuknya bisa dites tanpa
 * men-spawn apa pun; `think()` di bawah cuma menyalurkan hasilnya.
 *
 * Tiga keputusan, semuanya lahir dari satu kegagalan lapangan yang sama (152 baris jejak `gagal`
 * beruntun yang tak memberi satu pun petunjuk):
 *
 * 1. **KEDUA stream dibaca, stderr dulu.** Agen CLI tak sepakat soal stream: `claude -p` yang
 *    kuncinya ditolak mencetak "Invalid API key · Fix external API key" di **stdout** lalu `exit(1)`
 *    (terukur pada 2.1.220 dengan env ramping: `stderr === ""`), sementara dengan env server penuh
 *    nasihat yang justru paling berguna — "ANTHROPIC_API_KEY … takes precedence over your claude.ai
 *    login · Unset it" — datang di **stderr** dan vonisnya tetap di stdout. `stderr || …` membuang
 *    salah satunya, dan mana yang terbuang bergantung env; menyimpan keduanya menutup dua-duanya.
 * 2. **`err.message` tak pernah dipakai saat ia memuat argv.** `execFile` menyusunnya sebagai
 *    `Command failed: <bin> <args…>` dan argumen terakhir lead adalah PROMPT-nya (±10 KB), jadi
 *    memakainya berarti menyimpan prompt ke jejak alih-alih sebabnya. Galat spawn (`spawn … ENOENT`)
 *    tak berbentuk itu dan tetap berguna, jadi ia lolos.
 * 3. **Ekor, bukan kepala.** Pesan galat datang di akhir keluaran; `slice(0, 500)` pada keluaran
 *    panjang membuang persis bagian yang dicari.
 *
 * Kode keluar/sinyal selalu disebut: proses yang mati tanpa mengatakan apa-apa pun tetap harus bisa
 * dibedakan dari proses yang tak pernah lahir.
 */
export function leadFailureReason(
  agent: Agent, timeoutMs: number, err: ExecFailure, stdout: string, stderr: string,
): string {
  if (err.killed) return `lead ${agent} kehabisan waktu ${timeoutMs} ms`;
  // `Command failed:` = pesan rakitan execFile yang memuat seluruh argv → buang, bukan potong.
  const fromErr = err.message.startsWith("Command failed:") ? "" : err.message;
  const detail = [tail(stderr), tail(stdout)].filter(Boolean).join(" · ")
    || tail(fromErr) || "tanpa keluaran";
  const how = err.signal ? `sinyal ${err.signal}` : `exit ${err.code ?? "?"}`;
  return `lead ${agent} gagal (${how}): ${detail}`;
}

/**
 * Jalankan lead sekali dan kembalikan keluaran mentahnya. Melempar saat proses gagal/kehabisan
 * waktu — pemanggil (decide.ts) yang menerjemahkannya jadi baris jejak `gagal` + notifikasi (AC-4).
 *
 * `maxBuffer` dinaikkan: agen yang berpikir panjang mudah melewati 1 MiB default, dan kegagalan
 * ENOBUFS akan terbaca sebagai "lead tak bisa memutuskan" padahal ia sudah selesai.
 */
export function think(prompt: string, o: ThinkOpts): Promise<string> {
  const process = leadProcess(prompt, o);
  return new Promise((resolve, reject) => {
    const child = execFile(process.file, process.args, {
      cwd: process.cwd, timeout: o.timeoutMs, maxBuffer: 16 * 1024 * 1024,
      env: leadEnv(o.agent), encoding: "utf8", killSignal: "SIGTERM",
    }, (err, stdout, stderr) => {
      process.cleanup();
      if (err) {
        reject(new Error(leadFailureReason(o.agent, o.timeoutMs, err as unknown as ExecFailure, stdout, stderr)));
        return;
      }
      resolve(stdout);
    });
    // SPEC-448 (QA) · TUTUP stdin. `execFile` selalu melahirkan anak ber-`stdio:["pipe",…]` — opsi
    // `stdio` TIDAK diteruskan Node untuk execFile (hanya cwd/env/uid/shell/signal yang sampai ke
    // `spawn`), jadi menyetelnya di atas diam-diam tak berefek dan satu-satunya jalan adalah handle
    // ini. Tanpa `end()` anak melihat pipa hidup-tapi-bisu yang tak pernah EOF, dan `claude -p`
    // — yang membaca stdin sebagai sumber prompt alternatif — menunggunya 3 detik penuh sebelum
    // memperingatkan. Prompt lead sendiri lewat argv (leadArgv), bukan stdin, jadi tak ada yang
    // hilang dengan menutupnya. Terukur pada claude 2.1.220, prompt & anggaran 6 dtk yang sama:
    // pipa terbuka → 6551 ms, dibunuh saat batas waktu, stdout KOSONG; ditutup → 3554 ms, jawaban
    // benar. Tiga detik itu selisih antara ada jawaban dan tidak — kelas kegagalan SPEC-432, hanya
    // saja anggarannya habis SEBELUM agen mulai berpikir.
    child.stdin?.end();
  });
}
