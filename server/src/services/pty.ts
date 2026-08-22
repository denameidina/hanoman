import { spawn, type IPty } from "node-pty";
import { execFile, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  goalOneLine, goalChunks, agentFlags, codexGoalScript, ensureSpawnHelperOnce,
  renderAgentsJson, agentRosterBlock, agentDelegationClause, type AgentDef, type Flow, type Agent,
} from "@hanoman/runner";
import { coerceCodexEffort, isTerminalResponse, resolveChoices, type SessionKind } from "@hanoman/shared";
import { readPhases, sessionComplete, type Phase } from "./session-phases";
import { sessionIdForSpec } from "./session-id";
import { dropSessionUploads } from "./uploads";
import {
  answerChoiceDialog, answerMultiSelectDialog, answerNotesDialog, readDialogScreen, submitReview,
  type PaneIO,
} from "./tui-dialog";
import { effectiveStr } from "../config";
import { sandboxCommand } from "./session-sandbox";

// Sesi hidup di dalam tmux server, bukan di proses API (ADR-0016). Restart `pnpm dev`
// tidak lagi membunuh claude yang sedang bekerja, dan refresh browser hanya menyambung
// ulang klien. Yang dipegang proses ini cuma klien `tmux attach` di atas node-pty.
//
// Socket sendiri (`-L`) memisahkan hanoman dari tmux milik pengguna — `killAll` di test
// tidak boleh menyentuh sesi kerja siapa pun. `-f /dev/null` membuang ~/.tmux.conf yang
// bisa menyalakan status bar atau mengubah prefix, dan merusak TUI claude.
const socket = () => effectiveStr("HANOMAN_TMUX_SOCKET") ?? "hanoman";
const PREFIX = "hanoman-";

// Cukup untuk mengembalikan satu layar penuh plus riwayat, tanpa menahan memori tak
// terbatas untuk sesi yang menyala berhari-hari.
export const MAX_SCROLLBACK = 256 * 1024;
// SPEC-812 · `(scrollback + d).slice(-MAX)` meratakan cons-string, jadi memotong tiap chunk
// membayar salinan ±512 KB per chunk 1 KB — terukur 178 µs/chunk = 210 ms CPU per 10 dtk per pane,
// dan justru saat keluaran deras. Slack membuat pemotongan itu satu kali per slack, bukan per
// chunk; yang dibeli batas atas memori sedikit lebih longgar, dan itu tetap BERBATAS.
export const SCROLLBACK_SLACK = 64 * 1024;
const POLL_MS = 500;

// SPEC-196 · marker keputusan (.worktrees/.decisions/<id>) yang terisi = sesi sedang menunggu
// manusia. Satu definisi dipakai listSessions (pembeda terminal) dan scanDecisions (notifikasi).
// statSync gagal (berkas belum ada) → false.
export const markerFilled = (f: string): boolean => {
  try { return statSync(f).size > 0; } catch { return false; }
};

export type Frame =
  | { t: "data"; d: string }
  | { t: "exit"; code: number }
  // SPEC-433 · `complete` = verdict, bukan daftar nama: seluruh fase pipeline sudah tercatat DAN
  // plan spec-nya tak menyisakan `- [ ]` (ADR-0029). Terminal tak punya sumber lain untuk
  // "selesai" — `exited` hanya berarti prosesnya mati, dan TUI agen tak pernah mati sendiri.
  | { t: "phase"; phases: Phase[]; complete: boolean }
  // SPEC-863 · ADR-0133 · alternate screen PANE. Ia tak bisa diturunkan dari aliran byte: tmux
  // mengemulasi terminal pane, jadi `\x1b[?1049h/l` milik program di dalamnya tak pernah
  // diteruskan ke klien luar — yang sampai ke sana hanya `smcup` milik klien tmux sendiri, di
  // byte pertama dan tanpa pasangan `l` selama sambungan hidup. Satu-satunya yang tahu adalah
  // tmux, lewat `#{alternate_on}`.
  | { t: "alt"; on: boolean };
// Sengaja bukan `WebSocket`: service ini tidak boleh tahu soal transport, dan test
// menyuntikkan perekam frame biasa.
export type Client = { send(msg: string): void; close(): void };

export type SessionInfo = {
  id: string; projectId: string; specId?: string; flow?: Flow; cwd: string; exited: boolean;
  // SPEC-402 · kode keluar pane MATI (`#{pane_dead_status}`); undefined selama pane hidup. Tanpa ini
  // UI cuma punya `exited` dan melabeli agen yang dihentikan di tengah kerja (mis. di-SIGTERM
  // `pkill -f` sesi tetangga → 143) sebagai "Selesai" hijau — persis keluhan SPEC-402.
  exitCode?: number;
  branch?: string; decision: boolean;
  // SPEC-338 · ADR-0074 · mesin sesi. Sesi lama (tanpa opsi tmux ini) dibaca sebagai "claude".
  agent: Agent;
};
type Pane = SessionInfo & {
  code: number; phaseFile?: string; decisionFile?: string;
  // SPEC-863 · `#{alternate_on}` pane — TUI layar penuh (vim) 1, shell dan TUI agen 0.
  altScreen: boolean;
};

// Satu attachment per sesi: satu klien tmux melayani semua WebSocket yang menonton.
// `lastPhases` menahan JSON fase terakhir yang disiarkan — frame lahir hanya saat berubah.
// `lastAlt` melakukan hal yang sama untuk alternate screen pane (SPEC-863).
// `pending` menahan keluaran yang belum disiarkan (SPEC-812) — lihat flushOutput.
type Attachment = {
  pty: IPty; scrollback: string; clients: Set<Client>; lastPhases: string;
  lastAlt?: boolean;
  pending: string; flushTimer?: NodeJS.Timeout;
};
const attached = new Map<string, Attachment>();

// Variabel yang sama yang dipakai runner/src/claude-cli.ts.
const claudeBin = () => effectiveStr("HANOMAN_CLAUDE_BIN") ?? "claude";
// SPEC-236 · shell untuk "terminal biasa" non-claude. HANOMAN_SHELL menang (dipakai test),
// lalu $SHELL operator, lalu /bin/bash. Diserahkan ke createSession({command:[shellBin()]}) —
// cabang argv mentah yang sama dipakai Console VPS (ADR-0042).
export const shellBin = (): string => effectiveStr("HANOMAN_SHELL") ?? process.env.SHELL ?? "/bin/bash";
// SPEC-338 · ADR-0074 · cermin HANOMAN_CLAUDE_BIN untuk Codex CLI.
const codexBin = () => effectiveStr("HANOMAN_CODEX_BIN") ?? "codex";
const agentBin = (agent: Agent): string => (agent === "codex" ? codexBin() : claudeBin());

// Claude CLI menolak `--dangerously-skip-permissions` saat uid 0 ("cannot be used with root/sudo
// privileges for security reasons") dan langsung `process.exit(1)` — sesi lahir lalu MATI seketika.
// Ini tersisa untuk local/test legacy; production sejak SPEC-761 menolak service uid 0.
// Gerbangnya di CLI punya jalan keluar resmi: `IS_SANDBOX=1`. Kita memasangnya hanya bila memang
// uid 0 — di mesin non-root env ini tak perlu dan tak boleh mengubah perilaku claude apa pun.
// Permission bypass production berada di dalam rootless sandbox ADR-0117, bukan di host.
export const rootBypassEnv = (uid = process.getuid?.()): Record<string, string> =>
  uid === 0 ? { IS_SANDBOX: "1" } : {};

const frame = (f: Frame): string => JSON.stringify(f);
const name = (id: string): string => PREFIX + id;

// SPEC-223 · berkas prompt awal sesi, dibaca `"$(cat …)"` saat sesi lahir (lihat createSession).
// Di tmpdir: ephemeral, always-writable, tak bergantung cwd sesi. id sudah tersanitasi ([a-z0-9_-]).
export const promptFilePath = (id: string): string => `${tmpdir()}/hanoman-prompts/${id}`;

// SPEC-338 · skrip gate mode goal sesi codex. Sekamar dengan berkas prompt: ephemeral, di tmpdir,
// tak bergantung cwd sesi (worktree bisa lenyap saat sesi ditutup). id sudah tersanitasi.
export const goalGatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.sh`;
// Berkas penghitung penolakan gate (pagar anti-loop) — bersebelahan dengan skripnya.
const goalStatePath = (id: string): string => `${tmpdir()}/hanoman-goal-gates/${id}.count`;

// SPEC-450 · ADR-0094 · berkas JSON `claude --agents`. Sekamar dengan berkas prompt & alasannya
// sama persis (SPEC-223): instruksi agen adalah PROSA, dan tmux membatasi SATU command ±16 KB —
// JSON inline akan menembusnya dan sesi mati dengan `command too long`. Di tmpdir, bukan turunan
// cwd: cwd bisa homedir (sesi VPS) yang tak boleh dikotori, dan worktree bisa lenyap.
export const agentsFilePath = (id: string): string => `${tmpdir()}/hanoman-agents/${id}.json`;

// SPEC-862 · skrip askpass milik hanoman. Sekamar dengan berkas prompt (SPEC-223) dan sengaja
// TIDAK ber-id sesi: isinya sama untuk semua sesi dan tak memuat apa pun yang khas satu sesi.
export const askpassDenyPath = (): string => `${tmpdir()}/hanoman-askpass/deny.sh`;

// Tak sebaris pun boleh ke stdout: apa pun yang dicetak di sana dibaca ssh SEBAGAI passphrase.
const ASKPASS_DENY = `#!/bin/sh
echo "hanoman: tak ada manusia di pane ini — permintaan ketikan ditolak: $1" >&2
echo "hanoman: buka kuncinya di luar sesi (mis. ssh-add ~/.ssh/id_rsa), lalu ulangi." >&2
exit 1
`;

/**
 * SPEC-862 · pane sesi agen tak punya manusia, tapi `ssh` tak tahu itu: `read_passphrase()`
 * membuka **`/dev/tty` langsung**, bukan stdin, jadi ia merebut tty dari widget Ink milik agen
 * yang sedang memegangnya dalam raw mode (SPEC-452). Keduanya lalu menjadi pembaca atas satu tty.
 * Terukur di tmux nyata: urutan escape panah operator tak pernah sampai utuh — pembelahannya tak
 * deterministik, dan salah satu bentuknya membuat `Enter` mengirim pilihan **pertama** ke agen
 * sebagai jawaban yang tak dipilih siapa pun. Redraw TUI lalu menghapus prompt ssh dari layar,
 * jadi sesi macet dengan tampilan yang terlihat sehat.
 *
 * Penalarannya dipakai ulang dari `vps-ssh.ts` (SPEC-165): tanpa password, ssh tak boleh punya
 * prompt sama sekali. Bedanya di sini hanoman tak memanggil ssh sendiri — yang memanggilnya agen,
 * lewat `git`, dengan argv yang bukan milik kita. Maka gerbangnya di env sesi, satu-satunya kanal
 * yang kita pegang; `BatchMode` gugur karena ia hanya ada sebagai opsi `-o`/config.
 * `SSH_ASKPASS_REQUIRE=force` membuat askpass dipakai untuk SELURUH input passphrase tanpa peduli
 * `DISPLAY`, dan ssh **tidak** jatuh balik ke tty saat askpass gagal.
 *
 * `GIT_TERMINAL_PROMPT=0` menyertainya karena menyetel `SSH_ASKPASS` saja justru setengah jalan:
 * git mencari askpass `GIT_ASKPASS` → `core.askPass` → **`SSH_ASKPASS`**, lalu tetap bertanya di
 * terminal bila semuanya gagal — pesan kita, lalu menggantung sama saja.
 *
 * Di dalam sandbox ADR-0117 berkas ini tak ter-mount, jadi `exec` askpass gagal — dan itu tetap
 * menghasilkan `Permission denied` seketika tanpa menyentuh tty (terverifikasi). Yang hilang di
 * sana hanya pesannya, bukan perlindungannya.
 */
export function noTtyPromptEnv(): Record<string, string> {
  const path = askpassDenyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, ASKPASS_DENY, { mode: 0o700 });
  return { SSH_ASKPASS: path, SSH_ASKPASS_REQUIRE: "force", GIT_TERMINAL_PROMPT: "0" };
}

// SPEC-402 · "tmux gagal" BUKAN "tak ada sesi". Hanya dua sinyal di bawah yang benar-benar berarti
// belum/tak ada tmux server di socket ini; sisanya (fork gagal saat mesin penuh proses, socket knob
// salah, server kedip) adalah keadaan TAK DIKETAHUI. Membacanya sebagai daftar kosong sama dengan
// memberi tahu setiap terminal yang terbuka bahwa sesinya berakhir `exit 0` — padahal agennya masih
// bekerja. Pola sengaja sempit: `error connecting to …` sudah mencakup socket yang tak ada, jadi
// "no such file or directory" telanjang tak perlu ikut (dan bisa datang dari kegagalan lain).
const NO_SERVER = /no server running|error connecting to/i;
export class TmuxError extends Error {
  constructor(message: string, readonly noServer: boolean) { super(message); }
}

function tmux(...args: string[]): string {
  try {
    // stderr di-pipe, bukan diwariskan: `list-panes` pada tmux server yang belum jalan
    // adalah keadaan normal (belum ada sesi), bukan sesuatu yang layak dicetak ke log.
    return execFileSync("tmux", ["-L", socket(), "-f", "/dev/null", ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    // tmux hilang dari PATH adalah salah-konfigurasi, bukan "belum ada sesi" — jangan pernah
    // ditelan sebagai daftar kosong.
    if (err.code === "ENOENT") {
      throw new TmuxError("tmux tidak ada di PATH — sesi terminal hanoman hidup di dalam tmux (ADR-0016). Pasang: brew install tmux", false);
    }
    const detail = (err.stderr ?? err.message).trim();
    throw new TmuxError(`tmux ${args[0]} gagal: ${detail}`, NO_SERVER.test(detail));
  }
}

// Kembaran asinkron `tmux()` untuk pemanggil yang berjalan TERUS-MENERUS (loop poll 500 ms dan
// siar events 1 dtk). `execFileSync` memblokir seluruh event loop selama spawn: terukur 7–9 ms
// saat mesin tenang, tapi avg 80–256 ms dan maks 916 ms saat mesin sibuk (load 28) — dan selama
// itu tak satu pun frame ketikan terminal dibaca maupun echo-nya ditulis. Pemetaan error identik
// dengan `tmux()`; pemanggil sekali-jalan (route, launch) tetap memakai yang sinkron.
function tmuxAsync(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", ["-L", socket(), "-f", "/dev/null", ...args], { encoding: "utf8" },
      (e, stdout, stderr) => {
        if (!e) { resolve(stdout); return; }
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          reject(new TmuxError("tmux tidak ada di PATH — sesi terminal hanoman hidup di dalam tmux (ADR-0016). Pasang: brew install tmux", false));
          return;
        }
        const detail = (stderr || err.message).trim();
        reject(new TmuxError(`tmux ${args[0]} gagal: ${detail}`, NO_SERVER.test(detail)));
      });
  });
}

// tmux menyatukan sisa argv-nya jadi satu string lalu menyerahkannya ke shell. Tanpa
// kutip, JSON `--settings` pecah di setiap spasi dan claude mati sebelum lahir.
const sq = (s: string): string => `'${s.split("'").join("'\\''")}'`;

// SPEC-475 · definisinya pindah ke `./session-id` supaya `spec-deps.ts` bisa memakainya tanpa
// ikut memuat `node-pty`; di-re-export di sini agar seluruh pemakai lama tak berubah.
export { sessionIdForSpec };
const idFor = (specId?: string) =>
  specId ? sessionIdForSpec(specId) : randomUUID().slice(0, 8);

const FMT = [
  "#{session_name}", "#{@hanoman_project}", "#{@hanoman_spec}", "#{@hanoman_flow}",
  "#{@hanoman_phase_file}", "#{@hanoman_cwd}", "#{pane_dead}", "#{pane_dead_status}",
  "#{@hanoman_decision_file}", "#{@hanoman_branch}", "#{@hanoman_agent}", "#{alternate_on}",
].join("\t");

// Satu-satunya sumber kebenaran soal sesi adalah tmux server. Tidak ada map yang perlu
// dihidrasi ulang saat API restart: daftar ini selalu apa adanya.
function listPanes(): Pane[] {
  let out: string;
  try { out = tmux("list-panes", "-a", "-F", FMT); }
  catch (e) {
    // tmux server belum jalan — belum ada sesi sama sekali. SPEC-402 · kegagalan LAIN dilempar:
    // pemanggilnya harus memutuskan sendiri, dan "tak diketahui" tak boleh menjadi "semua berakhir".
    if (e instanceof TmuxError && e.noServer) return [];
    throw e;
  }
  return parsePanes(out);
}

// Kembaran asinkron `listPanes()` — semantik kegagalan SAMA PERSIS (server belum jalan → [],
// kegagalan lain dilempar), hanya tak menahan event loop selama tmux menjawab.
async function listPanesAsync(): Promise<Pane[]> {
  let out: string;
  try { out = await tmuxAsync("list-panes", "-a", "-F", FMT); }
  catch (e) {
    if (e instanceof TmuxError && e.noServer) return [];
    throw e;
  }
  return parsePanes(out);
}

function parsePanes(out: string): Pane[] {
  return out.split("\n").filter(Boolean).flatMap((line) => {
    const [n, projectId, specId, flow, phaseFile, cwd, dead, code, decisionFile, branch, agent,
      alternate] = line.split("\t");
    if (!n?.startsWith(PREFIX)) return [];
    const exited = dead === "1";
    return [{
      id: n.slice(PREFIX.length), projectId: projectId ?? "", specId: specId || undefined,
      flow: (flow || undefined) as Flow | undefined, phaseFile: phaseFile || undefined,
      cwd: cwd ?? "", exited, code: Number(code) || 0,
      decisionFile: decisionFile || undefined,
      // SPEC-230 · branch integrasi sesi project-level (PRD: prd/<slug>). Kosong = tak ada.
      branch: branch || undefined,
      // SPEC-196 · sesi hidup dengan marker keputusan terisi = menunggu manusia.
      decision: !exited && !!decisionFile && markerFilled(decisionFile),
      // SPEC-338 · sesi yang lahir sebelum ADR-0074 tak punya opsi ini → claude.
      agent: (agent === "codex" ? "codex" : "claude") as Agent,
      altScreen: alternate === "1",
    }];
  });
}

const toSessionInfo = ({ id, projectId, specId, flow, cwd, exited, code, branch, decision, agent }: Pane): SessionInfo => ({
  id, projectId, specId, flow, cwd, exited, branch, decision, agent,
  // Hanya untuk pane mati: `pane_dead_status` kosong pada pane hidup, dan `exitCode: 0` di sana
  // akan terbaca sebagai "sudah berakhir sukses".
  ...(exited ? { exitCode: code } : {}),
});

export const listSessions = (): SessionInfo[] => listPanes().map(toSessionInfo);

// Untuk siar events (tiap detik): daftar yang sama, tanpa memblokir event loop — lihat `tmuxAsync`.
export const listSessionsAsync = async (): Promise<SessionInfo[]> => (await listPanesAsync()).map(toSessionInfo);

// SPEC-184 · sesi hidup yang punya marker keputusan — masukan scanDecisions().
export const liveDecisions = (): { id: string; specId?: string; projectId: string; decisionFile: string }[] =>
  listPanes()
    .filter((p) => !p.exited && p.decisionFile)
    .map((p) => ({ id: p.id, specId: p.specId, projectId: p.projectId, decisionFile: p.decisionFile! }));

export const getSession = (id: string): Pane | undefined => listPanes().find((p) => p.id === id);

// SPEC-362 · ADR-0079 · riwayat sesi. pty.ts sengaja TETAP nol dependensi DB: ia hanya menembakkan
// dua peristiwa, dan services/session-history.ts yang mendaftarkan diri lewat server.ts (pola
// registerSchedulerSource, SPEC-294). createSession & killSession adalah SATU-SATUNYA pintu lahir
// & mati sesi — seluruh pemanggil (routes/terminal, session-launch, specs, ide, vps) lewat sini,
// jadi dua titik ini menangkap semuanya tanpa menyentuh 12 call site.
export type SessionBirth = {
  sessionId: string; projectId: string; specId?: string; flow?: string; kind: SessionKind;
  agent: Agent; model?: string; effort?: string; branch?: string; cwd: string;
};
export type SessionDeath = { sessionId: string; exitCode: number | null; transcript: string | null };
type SessionHooks = { onBirth?: (b: SessionBirth) => void; onDeath?: (d: SessionDeath) => void };
let hooks: SessionHooks = {};
export function registerSessionHooks(h: SessionHooks): void { hooks = h; }
// Fire-and-forget: riwayat tak boleh memblokir atau menggagalkan kelahiran/penutupan sesi.
const emitBirth = (b: SessionBirth): void => { try { hooks.onBirth?.(b); } catch { /* riwayat opsional */ } };
const emitDeath = (d: SessionDeath): void => { try { hooks.onDeath?.(d); } catch { /* riwayat opsional */ } };

// SPEC-450 · ADR-0094 keputusan 7 · katalog custom agent. `pty.ts` tetap NOL DEPENDENSI DB — ia
// hanya memanggil sumber yang mendaftarkan diri (services/custom-agents.ts, dipasang dari
// server.ts), persis pola registerSessionHooks di atas & registerSchedulerSource. Karena ia dibaca
// di `createSession` — pintu SATU-SATUNYA semua kelahiran sesi — tak ada call site yang perlu
// diubah dan tak ada yang bisa lupa memasangnya (kelas bug SPEC-431/ADR-0093).
//
// Sumbernya SINKRON, bukan Promise: definisi agen harus sudah ada saat argv dirakit, bukan sesaat
// sesudahnya. Yang menjembatani Prisma yang async adalah cache di sisi service (pola effectiveStr,
// ADR-0049).
//
// SPEC-484 · ADR-0101 · sumber kini menerima AGEN SESI: `runtime` di definisi agen adalah
// PENYARING, dan yang dipakai wajib agen sesi yang sebenarnya (`agentForDefs` di `createSession`),
// bukan `Setting.agent` — sesi bisa lahir dengan override per-request, dan membaca yang salah
// mengulang bug SPEC-377 dalam bentuk baru.
type CustomAgentSource = (projectId: string, agent: Agent) => AgentDef[];
let customAgentSource: CustomAgentSource = () => [];
export function registerCustomAgentSource(fn: CustomAgentSource): void { customAgentSource = fn; }
// Gagal baca → daftar KOSONG. Katalog agen tak pernah boleh menggagalkan kelahiran sesi.
const customAgentsFor = (projectId: string, agent: Agent): AgentDef[] => {
  try { return customAgentSource(projectId, agent); } catch { return []; }
};

// Jenis sesi diturunkan saat LAHIR, saat opsinya masih di tangan — sesudah itu tmux hanya menyimpan
// sebagian (tak ada jejak `command` maupun `prompt`). Fungsi murni supaya bisa diuji tanpa tmux.
export function sessionKind(
  o: { id: string; specId?: string; flow?: string; command?: string[] }, projectId: string, cwd: string,
): SessionKind {
  if (o.specId) return "spec";
  if (o.flow === "reverse" || o.flow === "prd" || o.flow === "scaffold" || o.flow === "breakdown") return o.flow;
  if (projectId.startsWith("telegram:")) return "telegram";
  if (projectId.startsWith("vps")) return "vps";           // routes/vps.ts: "vps:<id>" & "vps-console:<id>"
  if (o.command) return "shell";
  if (cwd.includes("/.worktrees/")) return "worktree";     // sesi konflik merge/integrate
  return "terminal";
}

// Scrollback lenyap bersama pane: ini WAJIB dipanggil sebelum `tmux kill-session`. Tanpa `-e`
// (kebalikan attach() untuk pane mati) — arsip disimpan sebagai teks polos: bisa dicari, aman
// dirender di <pre>, tak menyuntikkan ANSI ke DOM.
function captureTranscript(id: string): string | null {
  try {
    const out = tmux("capture-pane", "-p", "-J", "-S", "-50000", "-t", name(id));
    return out.trim() ? out : null;
  } catch { return null; }
}


export type CreateOpts = {
  id?: string; specId?: string; flow?: Flow; branch?: string; prompt?: string; phaseFile?: string;
  decisionFile?: string; model?: string; effort?: string; command?: string[];
  // SPEC-332 · ADR-0073 · kondisi mode goal; kosong = mode goal mati untuk sesi ini.
  goal?: string;
  // SPEC-338 · ADR-0074 · mesin sesi; kosong = claude (default historis).
  agent?: Agent;
  // SPEC-843 · ADR-0124 · direktori lampiran backlog yang dimaterialisasi server.
  attachmentsDir?: string;
  // Env tambahan di depan argv sesi (mis. HANOMAN_BASE_SHA / HANOMAN_VERIFY_SCOPE).
  env?: Record<string, string>;
};

export function createSession(projectId: string, cwd: string, opts: CreateOpts = {}): SessionInfo {
  // Sesi project-level (reverse) tak punya spec: id-nya dipasok route agar tetap
  // deterministik — Start kedua harus menyambung, bukan melahirkan sesi baru (SPEC-166).
  const id = opts.id ?? idFor(opts.specId);
  // Sesi sebuah backlog item itu tunggal: menekan Start lagi harus menyambung ke `claude`
  // yang sudah jalan, bukan menyalakan yang kedua di atas worktree yang sama (ADR-0015).
  // SPEC-394 · ADR-0084 · tapi hanya pane HIDUP yang berarti "sudah jalan". Pane MATI ditahan
  // `remain-on-exit` semata agar layar terakhirnya masih terbaca; mengembalikannya sebagai sesi
  // membuat setiap tombol yang melahirkannya kembali (Start backlog, Console VPS, sesi konflik,
  // "Mulai lagi") DIAM. Ini titik cekik semua kelahiran sesi, jadi satu gerbang di sini menutup
  // juga jalur yang tak punya gerbang sendiri: `merge-<spec>` (routes/specs), `finishGraphOp`
  // (routes/ide), `vpsc-<id>` (routes/vps). `attach()` pada pane mati TETAP sah — itu justru cara
  // membaca layar terakhir sesi yang sudah selesai.
  const existing = getSession(id);
  if (existing && !existing.exited) return existing;
  if (existing) killSession(id);

  // `--dangerously-skip-permissions` melewati prompt izin, bukan sistem hook. Sejak ADR-0037
  // tak ada lagi hook deny — `--settings` di sini hanya memasang marker keputusan (SPEC-184),
  // digabung dengan settings pengguna. Agen dipercaya penuh; isolasi murni lewat worktree.
  // Console VPS (SPEC-211) memasok argv sendiri (mis. `ssh -t …`): shell mentah, bukan
  // claude — `--dangerously-skip-permissions`/`--settings` hanya relevan untuk claude.
  // SPEC-223 · prompt bisa BESAR: scaffold/reverse memuat STANDAR DOCS (~7KB) dan ide/objective
  // bisa panjang. tmux membatasi panjang SATU command (~16KB) — prompt inline menembusnya dan
  // `new-session` mati dengan `command too long` (dilaporkan sebagai `tmux set-option gagal` karena
  // set-option adalah args[0] invokasi gabungan). Tulis prompt ke file lalu serahkan lewat
  // `"$(cat <file>)"`: sh -c yang menjalankan sesi meng-expand-nya saat lahir, jadi claude
  // menerima prompt penuh via ARG_MAX (jauh > 16KB) sementara command tmux tetap pendek. Isi file
  // TIDAK dipindai ulang oleh shell (hasil command-substitution dikutip ganda) → aman dari injeksi.
  // Ditulis ke tmpdir (bukan turunan cwd): cwd bisa homedir (sesi VPS) yang tak boleh dikotori dan
  // parent-nya tak selalu writable. Dibaca sekali saat lahir; OS yang membersihkan tmpdir.
  // SPEC-450 · ADR-0094 · custom agent. Dihitung SEBELUM berkas prompt ditulis: jalur codex
  // menempelkan roster ke prompt, jadi ia harus sudah ada saat berkasnya dibuat. Sesi ber-
  // `opts.command` (shell mentah ADR-0056, konsol VPS) tak menerima apa pun — tak ada agen di sana.
  const agentForDefs: Agent = opts.agent ?? "claude";
  const customDefs = opts.command ? [] : customAgentsFor(projectId, agentForDefs);
  // codex tak punya padanan `--agents` yang bisa diverifikasi (ADR-0094 M5: kunci `-c` tak dikenal
  // diterima diam-diam), jadi rosternya lewat kanal yang memang milik hanoman sendiri: prompt.
  // Mengembalikan "" saat katalog kosong → prompt sesi lain byte-identik seperti sebelumnya.
  // SPEC-881 · ADR-0136 · dua kanal, satu titik. Codex mengadopsi peran INLINE lewat roster; claude
  // menerima definisi lewat `--agents` dan hanya perlu DORONGAN untuk menoleh ke sana. Keduanya
  // mengembalikan "" saat katalog kosong → prompt sesi byte-identik seperti sebelumnya.
  const rosterBlock = agentForDefs === "codex"
    ? agentRosterBlock(customDefs)
    : agentDelegationClause(customDefs);

  let promptArg = "";
  let promptFile: string | undefined;
  if (!opts.command && opts.prompt) {
    promptFile = promptFilePath(id);
    mkdirSync(dirname(promptFile), { recursive: true, mode: 0o700 });
    writeFileSync(promptFile, opts.prompt + rosterBlock, { mode: 0o600 });
    promptArg = `"$(cat ${sq(promptFile)})"`;
  }
  // SPEC-338 · ADR-0074 · perbedaan CLI antar agen dirakit `agentFlags`; di sini tinggal
  // mengutip & merangkai, persis seperti sebelumnya untuk claude.
  const agent: Agent = opts.agent ?? "claude";
  let argv: string;
  if (opts.command) {
    argv = opts.command.map(sq).join(" ");
  } else {
    // SPEC-338 · mode goal codex = gate deterministik (hook codex hanya dukung type="command").
    // Skripnya ditulis sekarang supaya sudah ada saat hook pertama menembak.
    let goalGate: string | undefined;
    if (agent === "codex" && opts.goal && opts.flow && opts.specId) {
      goalGate = goalGatePath(id);
      mkdirSync(dirname(goalGate), { recursive: true, mode: 0o700 });
      writeFileSync(goalGate, codexGoalScript({
        flow: opts.flow, specId: opts.specId, condition: opts.goal,
        phaseFile: opts.phaseFile ?? "", worktree: cwd, stateFile: goalStatePath(id),
      }), { mode: 0o700 });
    }
    // SPEC-339 · titik cekik tunggal: effort yang tak didukung model codex diturunkan ke fallback
    // model SEBELUM argv dirakit. Ditaruh di sini, bukan di route, karena SEMUA kelahiran sesi
    // bermuara ke createSession — termasuk jalur ber-AgentToken yang tak lewat picker UI.
    // Hanya dikoersi bila keduanya ada: tanpa effort, `agentFlags` memang tak memasang flag apa pun.
    const effort = agent === "codex" && opts.model && opts.effort
      ? coerceCodexEffort(opts.model, opts.effort)
      : opts.effort;
    // SPEC-450 · ADR-0094 gotcha 4 · JSON `--agents` lewat BERKAS, bukan inline: instruksi agen
    // adalah prosa dan tmux membatasi SATU command ±16 KB — kelas kegagalan SPEC-223, dibayar
    // sekali dan dipakai ulang. Hasil command-substitution dikutip ganda, jadi isinya tak dipindai
    // ulang shell (aman dari injeksi) dan batasnya ARG_MAX, bukan 16 KB.
    let agentsFile: string | undefined;
    if (agent === "claude") {
      const json = renderAgentsJson(customDefs);
      if (json) {
        agentsFile = agentsFilePath(id);
        mkdirSync(dirname(agentsFile), { recursive: true, mode: 0o700 });
        writeFileSync(agentsFile, json, { mode: 0o600 });
      }
    }
    // Prompt (bila ada) = argumen positional pertama agen, TANPA sq (sudah dikutip ganda).
    const flags = agentFlags({
      agent, model: opts.model, effort,
      decisionFile: opts.decisionFile, goal: opts.goal, goalGate,
    }).map(sq).join(" ");
    // GOTCHA ADR-0094 #4: `--agents` TIDAK boleh ikut `.map(sq)` seperti flag lain — ia harus tetap
    // berbentuk `"$(cat …)"` supaya `sh -c` yang melahirkan sesi meng-expand-nya. Di-`sq` sekali
    // saja, claude menerima literal `$(cat /tmp/…)` sebagai definisi agen — dan itu tepat
    // kegagalan-senyapnya: JSON tak sah DIABAIKAN tanpa pesan, exit 0, NOL agen.
    const agentsArg = agentsFile ? `--agents "$(cat ${sq(agentsFile)})"` : "";
    argv = [sq(agentBin(agent)), promptArg, flags, agentsArg].filter(Boolean).join(" ");
  }

  // Env di depan perintah, bukan `new-session -e`: tmux menyerahkan sisa argv-nya ke shell,
  // jadi penugasan env bekerja di semua versi tmux sementara `-e` baru ada sejak 3.0.
  // Direktorinya dibuat di sini — `echo >> berkas` milik agen tak membuat direktori induk.
  const envPairs: string[] = [];
  // Hanya untuk agen claude: Console VPS / terminal biasa (`opts.command`) adalah shell mentah,
  // dan codex tak punya gerbang root ini. Dipasang sebelum env pemanggil supaya tetap bisa ditimpa.
  if (!opts.command && agent === "claude") {
    for (const [k, v] of Object.entries(rootBypassEnv())) envPairs.push(`${k}=${sq(v)}`);
  }
  // SPEC-862 · kedua agen, karena pembedanya bukan mesin sesinya melainkan siapa yang memegang tty.
  // Console VPS (ADR-0042) & terminal biasa (SPEC-236) sengaja di luar: di sana manusia MEMANG
  // mengetik, dan memaksa ssh gagal akan mematikan fiturnya.
  if (!opts.command) {
    for (const [k, v] of Object.entries(noTtyPromptEnv())) envPairs.push(`${k}=${sq(v)}`);
  }
  if (opts.phaseFile) {
    mkdirSync(dirname(opts.phaseFile), { recursive: true });
    envPairs.push(`HANOMAN_PHASE_FILE=${sq(opts.phaseFile)}`);
  }
  if (opts.attachmentsDir) envPairs.push(`HANOMAN_ATTACHMENTS_DIR=${sq(opts.attachmentsDir)}`);
  // Env tambahan dari pemanggil lewat jalur yang sama.
  for (const [k, v] of Object.entries(opts.env ?? {})) envPairs.push(`${k}=${sq(v)}`);
  let cmd = envPairs.length ? `${envPairs.join(" ")} ${argv}` : argv;
  if (!opts.command) cmd = sandboxCommand({
    command: cmd, worktree: cwd, phaseFile: opts.phaseFile, promptFile,
    attachmentsDir: opts.attachmentsDir,
  });
  // SPEC-184 · direktori marker keputusan; hook Notification menulis absolute path di dalamnya.
  if (opts.decisionFile) mkdirSync(dirname(opts.decisionFile), { recursive: true });

  // Opsi global mendahului `new-session` dalam satu invokasi: window lahir sudah membawa
  // `remain-on-exit`, jadi proses yang mati seketika pun meninggalkan pane mati yang masih
  // bisa dibaca. Menyetelnya setelah new-session akan balapan dengan proses yang cepat mati.
  tmux(
    // tmux menyerahkan argumen perintah `new-session` ke `default-shell`, dan defaultnya adalah
    // shell login pemanggil di /etc/passwd. Saat hanoman jalan sebagai user service ber-shell
    // `/usr/sbin/nologin`, SETIAP pane lahir langsung mati ("Attempted login by UNKNOWN") dan tak
    // satu pun sesi terminal bisa hidup. Dipatok eksplisit — dan wajib mendahului `new-session`,
    // sama seperti remain-on-exit di bawah.
    "set-option", "-g", "default-shell", shellBin(), ";",
    "set-option", "-g", "remain-on-exit", "on", ";",
    "set-option", "-g", "status", "off", ";",
    // Prefix mati: tmux di sini adalah detail implementasi, dan C-b harus sampai ke claude.
    "set-option", "-g", "prefix", "None", ";",
    // SPEC-209 · riwayat claude hidup di scrollback pane tmux; klien hanya menerima layar
    // yang terlihat (ADR-0016). `mouse on` membuat tmux mengaktifkan mouse-reporting di terminal
    // klien, jadi wheel di xterm.js diteruskan → tmux → copy-mode → scroll riwayat ke atas/bawah.
    // history-limit dinaikkan dari default 2000 agar run panjang tak terpotong (capture pane mati
    // sudah baca -2000). ponytail: 50000 baris/pane; turunkan bila memori sesi berhari-hari mepet.
    "set-option", "-g", "mouse", "on", ";",
    "set-option", "-g", "history-limit", "50000", ";",
    "set-option", "-g", "default-terminal", "screen-256color", ";",
    "new-session", "-d", "-s", name(id), "-c", cwd, cmd, ";",
    "set-option", "-t", name(id), "@hanoman_project", projectId, ";",
    "set-option", "-t", name(id), "@hanoman_cwd", cwd,
  );
  if (opts.specId) tmux("set-option", "-t", name(id), "@hanoman_spec", opts.specId);
  if (opts.flow) tmux("set-option", "-t", name(id), "@hanoman_flow", opts.flow);
  // SPEC-230 · branch integrasi sesi (mis. PRD prd/<slug>) → dipakai review/integrate ber-skop sesi.
  if (opts.branch) tmux("set-option", "-t", name(id), "@hanoman_branch", opts.branch);
  // SPEC-338 · mesin sesi ikut tersimpan di tmux — sumber kebenaran sesi tetap tmux, bukan DB.
  tmux("set-option", "-t", name(id), "@hanoman_agent", agent);
  if (opts.phaseFile) tmux("set-option", "-t", name(id), "@hanoman_phase_file", opts.phaseFile);
  if (opts.decisionFile) tmux("set-option", "-t", name(id), "@hanoman_decision_file", opts.decisionFile);
  // SPEC-332 · fire-and-forget: respons HTTP tak boleh menunggu TUI siap. Gagal = diam, karena
  // jaminan mode goal sudah dipegang hook Stop di argv di atas.
  // SPEC-397 · ADR-0085 · kedua agen: codex-cli ≥ 0.146 punya mode goal native yang di-arm lewat
  // `/goal` yang sama. Tak ada gerbang versi CLI — pada codex lama `/goal` cuma jadi pesan chat yang
  // tak dipahami, verifikasi melaporkan gagal, dan gate sh tetap memegang jaminannya.
  if (opts.goal && !opts.command) void armGoalInTui(id, opts.goal, { agent }).catch(() => { /* best-effort */ });
  // SPEC-362 · sesi benar-benar BARU (cabang `existing` di atas sudah return lebih dulu — re-attach
  // ADR-0015 bukan sesi baru dan tak boleh melahirkan baris riwayat kedua).
  emitBirth({
    sessionId: id, projectId, specId: opts.specId, flow: opts.flow,
    kind: sessionKind({ id, specId: opts.specId, flow: opts.flow, command: opts.command }, projectId, cwd),
    agent, model: opts.model, effort: opts.effort, branch: opts.branch, cwd,
  });
  return { id, projectId, specId: opts.specId, flow: opts.flow, cwd, branch: opts.branch, exited: false, decision: false, agent };
}

// SPEC-332 · ADR-0073 — jalur KEDUA mode goal. Hook Stop (claude: `--settings`; codex: gate sh di
// `-c hooks.Stop`) adalah JAMINANNYA; ini jalur yang memasang mekanisme goal milik agen sendiri.
//
// claude: mengetik `/goal <kondisi>` membuat Claude Code men-set `activeGoal` miliknya, jadi `/goal`
// menampilkan status dan goal ikut dipulihkan saat sesi di-resume. Keduanya tak saling menghapus:
// sumber yang dibaca `/goal` saat mencari goal lama hanya session hooks registry, sementara hook
// kita hidup di settings.
//
// SPEC-397 · ADR-0085 — codex JUGA lewat sini. codex-cli 0.146.0 punya mode goal native (feature
// `goals`, tabel `thread_goals`, status line `Pursuing goal`/`Goal achieved`) yang MELANJUTKAN
// SENDIRI sesudah turn berakhir sampai objektif tercapai. Premis ADR-0074 ("codex tak punya padanan
// terverifikasi") benar di 0.142.5, salah di 0.146.0. Gate sh tetap terpasang — ia satu-satunya yang
// benar-benar membaca berkas fase & kotak `- [ ]`; konsekuensinya satu percobaan berhenti dievaluasi
// dua kali, dan itu diterima sadar (sudah begitu di claude sejak ADR-0073).
export type GoalArmOpts = {
  pollMs?: number; readyTries?: number; settleMs?: number; verifyTries?: number;
  // SPEC-397 · agen sesi: menentukan penanda apa yang dihitung sebagai "goal terpasang".
  agent?: Agent;
  // SPEC-397 · jeda antar potongan keystroke, dan berapa kali arming diulang bila tak terverifikasi.
  chunkMs?: number; sendTries?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const paneText = (id: string): string => {
  try { return tmux("capture-pane", "-p", "-t", name(id)); } catch { return ""; }
};

/**
 * SPEC-409 · ADR-0091 · baca layar sebuah pane. Dipakai pintu deteksi otomatis hanoman-lead untuk
 * menurunkan pertanyaan sesi yang menunggu. Tanpa `-e` (cermin captureTranscript): lead menalar
 * atas teks polos, dan ANSI hanya jadi derau di prompt-nya. Pane mati pun boleh dibaca — itu
 * justru cara melihat layar terakhirnya (lihat `attach`).
 */
export function capturePane(id: string, lines = 200): string {
  try { return tmux("capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", name(id)); }
  catch { return ""; }
}

/**
 * SPEC-409 · ADR-0091 · AC-8 · ketikkan jawaban ke pane sesi, lalu Enter. Sesi melanjutkan
 * pekerjaannya tanpa perubahan apa pun pada prompt maupun kontraknya — ia tak tahu siapa yang
 * menjawab.
 *
 * Dipotong ber-jeda dengan `goalChunks` yang sama seperti arming goal, karena jebakannya sama
 * (ADR-0085): TUI codex mengubah masukan yang datang dalam SATU burst ≥ 1024 karakter menjadi
 * `[Pasted Content N chars]`. Jawaban lead gampang melewati batas itu, dan degradasinya SENYAP —
 * pane tetap terlihat menerima teks.
 *
 * Baris baru diratakan jadi spasi: Enter di tengah teks akan mengirim jawaban setengah jadi.
 *
 * SPEC-452 · pane TIDAK selalu berupa kolom teks. Saat agen menampilkan dialog pilihan
 * (`AskUserQuestion`) layarnya widget daftar: burst apa pun yang lebih dari SATU karakter ditelan
 * tanpa jejak, dan `Enter` memilih baris yang sedang disorot — jadi jalur di bawah menjawab
 * "opsi 1" untuk setiap pertanyaan, apa pun isi keputusannya, tanpa satu pun sinyal gagal. Dialog
 * ber-kolom-jawaban-bebas karena itu dijawab lewat `answerChoiceDialog`; selain itu perilakunya
 * tak berubah satu byte pun.
 */
export async function sendToPane(id: string, text: string, chunkMs = 50, choices: string[] = []): Promise<boolean> {
  const p = getSession(id);
  if (!p || p.exited) return false;          // AC-10 · pane mati bukan sesi yang menunggu
  const line = text.replace(/\s*\r?\n\s*/g, " ").trim();
  if (!line) return false;
  try {
    const io = dialogIO(id);
    const screen = readDialogScreen(io.capture());
    // SPEC-474 · layar rekap dialog berantai: tak ada yang perlu diketik, ia tinggal ditutup.
    // Prosa di sini ditelan tanpa jejak dan `Enter` kebetulan juga men-submit — menekan
    // tombolnya secara eksplisit adalah satu-satunya bentuk yang tak bergantung baris mana
    // yang sedang tersorot.
    if (screen?.kind === "review") return await submitReview(io, screen.submitRow);
    if (screen?.kind === "question") {
      // SPEC-485 · ADR-0102 · dialog multiSelect dijawab dengan MENCENTANG. Labelnya dipetakan ke
      // nomor baris lewat `resolveChoices` terhadap opsi LAYAR ITU SENDIRI, jadi kecocokannya
      // persis. Tanpa satu pun pilihan yang cocok, prosanya tetap disampaikan lewat kolom bebas —
      // dialognya tetap maju, hanya tanpa kotak tercentang.
      if (screen.multi && screen.submit.present) {
        const pick = resolveChoices(choices, screen.options).choices.map((c) => c.index);
        return await answerMultiSelectDialog(io, { pick, line, freeIndex: screen.freeIndex }, chunkMs);
      }
      if (screen.freeIndex !== null) return await answerChoiceDialog(io, screen.freeIndex, line, chunkMs);
      // SPEC-474 · varian ber-`preview` tak punya kolom bebas; catatannya dibuka tombol `n`.
      if (screen.notes) return await answerNotesDialog(io, line, chunkMs);
      // Dialog TANPA kolom bebas dan tanpa catatan (trust, prompt izin) sengaja tak disentuh:
      // di sana `Enter` memilih baris 1 yang memang berarti "ya", dan mengubahnya menukar bug
      // ini dengan regresi.
    }
    for (const chunk of goalChunks(line)) {
      io.literal(chunk);
      await sleep(chunkMs);
    }
    io.enter();
    return true;
  } catch { return false; }                   // sesi lenyap di tengah pengetikan
}

/** Interrupt satu pane agen tanpa menyentuh proses/sesi tetangga. Escape adalah kontrak TUI
 * Claude/Codex untuk menghentikan giliran yang sedang berjalan; target tmux selalu id eksak. */
export function interruptPane(id: string): boolean {
  const pane = getSession(id);
  if (!pane || pane.exited) return false;
  try {
    tmux("send-keys", "-t", name(id), "Escape");
    return true;
  } catch {
    return false;
  }
}

/**
 * SPEC-474 · tutup dialog berantai yang SELURUH pertanyaannya sudah dijawab.
 *
 * Dipakai pintu deteksi lead sebagai langkah MEKANIS — tak ada yang perlu dipertimbangkan untuk
 * menekan `Submit answers`, jadi tak ada agen yang dipanggil untuknya. `false` bila layarnya
 * bukan layar rekap (fail-closed: jangan menekan apa pun di layar yang belum tentu itu).
 */
export async function submitPaneDialog(id: string): Promise<boolean> {
  const p = getSession(id);
  if (!p || p.exited) return false;
  try {
    const io = dialogIO(id);
    const screen = readDialogScreen(io.capture());
    if (screen?.kind !== "review") return false;
    return await submitReview(io, screen.submitRow);
  } catch { return false; }
}

// Primitif pane untuk SELURUH interaksi dialog. Satu tempat supaya `sendToPane` dan
// `submitPaneDialog` tak bisa berselisih soal cara mengetik (dua titik tulis yang tak sepakat
// adalah pola kegagalan SPEC-431/448).
const dialogIO = (id: string): PaneIO => ({
  capture: () => capturePane(id, DIALOG_CAPTURE_LINES),
  literal: (s) => { tmux("send-keys", "-t", name(id), "-l", s); },
  enter: () => { tmux("send-keys", "-t", name(id), "Enter"); },
  // SPEC-485 · SATU panah per pemanggilan: terukur, empat `Down` dalam satu `send-keys` memindahkan
  // fokus satu baris saja (jebakan burst ADR-0085, kali ini pada tombol kendali).
  down: () => { tmux("send-keys", "-t", name(id), "Down"); },
  sleep,
});

// Cukup untuk satu layar dialog penuh (pertanyaan + opsi + keterangan + footer) tanpa menyeret
// scrollback panjang ke dalam setiap pengetikan.
const DIALOG_CAPTURE_LINES = 60;

// SPEC-397 · penanda "goal BENAR-BENAR terpasang", per agen.
//
// codex TIDAK boleh diverifikasi dengan substring `/goal`: saat kondisi terkirim sebagai burst
// ≥ 1024 karakter, TUI mengubahnya jadi `[Pasted Content N chars]`, slash-dispatch tak jalan, dan
// kondisinya masuk sebagai PESAN CHAT — yang pane-nya tetap menampilkan sebagai `/goal …`. Assertion
// substring karena itu lulus palsu persis untuk kegagalan yang paling mungkin terjadi. Penanda di
// bawah adalah teks yang hanya dipancarkan runtime goal codex sendiri.
//
// claude sengaja tetap memakai penanda lamanya: tak ada bukti terukur soal penanda mana yang
// dipancarkan Claude Code saat goal terpasang, dan menggantinya dengan tebakan hanya memindahkan
// risiko ke agen yang hari ini bekerja.
const GOAL_ARMED_MARKERS: Record<Agent, string[]> = {
  claude: ["/goal"],
  codex: ["Goal active", "Pursuing goal", "Goal achieved"],
};

const goalArmed = (id: string, agent: Agent): boolean => {
  const text = paneText(id);
  return GOAL_ARMED_MARKERS[agent].some((m) => text.includes(m));
};

export async function armGoalInTui(id: string, condition: string, o: GoalArmOpts = {}): Promise<boolean> {
  const pollMs = o.pollMs ?? 500, readyTries = o.readyTries ?? 20;
  const settleMs = o.settleMs ?? 1200, verifyTries = o.verifyTries ?? 12;
  const chunkMs = o.chunkMs ?? 50, sendTries = o.sendTries ?? 3;
  const agent: Agent = o.agent ?? "claude";
  const line = goalOneLine(condition);
  if (!line) return false;
  // Tunggu pane menggambar sesuatu (TUI sudah hidup). Habis percobaan → kirim saja: yang hilang
  // hanyalah jalur kedua, sementara jaminan sudah dipegang hook Stop.
  for (let i = 0; i < readyTries; i++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    if (paneText(id).trim()) break;
    await sleep(pollMs);
  }
  await sleep(settleMs);
  // SPEC-397 · kirim → verifikasi → kirim ulang. Aman JUSTRU karena verifikasinya akurat: retry
  // hanya terjadi bila tak ada goal yang terpasang, jadi ia tak pernah menimpa goal yang hidup.
  // (Larangan "SEKALI kirim" yang lama lahir dari verifikasi yang tak bisa membedakan berhasil dari
  // gagal — dengan penanda per-agen, larangan itu tak lagi diperlukan.)
  for (let attempt = 0; attempt < sendTries; attempt++) {
    const p = getSession(id);
    if (!p || p.exited) return false;
    try {
      // `-l` = literal: tmux tak menafsirkan isi kondisi sebagai nama tombol. Dikirim TERPOTONG
      // ber-jeda karena deteksi paste codex bekerja per-burst PTY (ADR-0085).
      tmux("send-keys", "-t", name(id), "-l", "/goal ");
      for (const chunk of goalChunks(line)) {
        tmux("send-keys", "-t", name(id), "-l", chunk);
        await sleep(chunkMs);
      }
      tmux("send-keys", "-t", name(id), "Enter");
    } catch { return false; }   // sesi lenyap di tengah jalan
    for (let i = 0; i < verifyTries; i++) {
      if (goalArmed(id, agent)) return true;
      await sleep(pollMs);
    }
  }
  return false;
}

// Fase dibaca dari berkasnya, tidak disimpan: sesi yang selamat dari restart API tetap
// melaporkan fase yang benar tanpa map yang perlu dihidrasi ulang.
export function sessionPhases(id: string): Phase[] | null {
  const p = getSession(id);
  if (!p?.flow || !p.phaseFile) return null;
  return readPhases(p.phaseFile, p.flow);
}

// Fase per spec untuk semua sesi tmux, dalam satu `list-panes` — dipakai GET /specs untuk
// menurunkan stage live tanpa satu tmux call per spec (SPEC-168). Tak difilter `exited`:
// berkas fase pane mati (belum di-DELETE) tetap kebenaran terakhirnya; forward-only di
// pemanggil (stageFor + guard STAGES.indexOf) menjaga tak ada stage yang mundur.
export function sessionPhasesBySpec(): Map<string, { phases: Phase[]; cwd: string }> {
  const out = new Map<string, { phases: Phase[]; cwd: string }>();
  // SPEC-402 · sengaja LUNAK di sini (peta kosong saat tmux tak bisa dibaca): overlay stage
  // forward-only (stageFor + guard STAGES.indexOf), jadi satu bacaan tanpa overlay hanya berarti
  // "stage DB apa adanya" — tak ada stage yang mundur dan tak ada sesi yang dinyatakan berakhir.
  let panes: Pane[];
  try { panes = listPanes(); } catch { return out; }
  for (const p of panes) {
    if (!p.specId || !p.flow || !p.phaseFile) continue;
    // cwd = worktree run-nya: GET /specs menggerbang `done` dengan plan di dalamnya (SPEC-173).
    out.set(p.specId, { phases: readPhases(p.phaseFile, p.flow), cwd: p.cwd });
  }
  return out;
}

function broadcast(a: Attachment, f: Frame): void {
  const msg = frame(f);
  for (const c of a.clients) c.send(msg);
}

// SPEC-812 · node-pty membaca dengan buffer tetap 1024 byte, jadi satu frame per chunk berarti
// ±128 frame/detik ≈ 966 kbit/detik per pane saat sesi ramai keluaran — untuk aliran yang terukur
// 26× kompresibel. Di localhost itu tak terasa; lewat tunnel ke ponsel ia terus mengisi antrean
// kirim, dan echo ketikan lahir di belakangnya. Jendela satu frame animasi menggabungkan tiap
// redraw menjadi satu frame (terukur 128 → 20 frame/detik) tanpa menambah latensi yang terasa
// untuk ketikan tunggal saat sesi diam.
const COALESCE_MS = 16;
// Burst yang lebih besar dari ini tak perlu menunggu jendelanya habis — ia sudah cukup besar untuk
// membayar ongkos framing-nya sendiri.
const COALESCE_MAX_BYTES = 64 * 1024;

export const trimScrollback = (s: string): string =>
  s.length > MAX_SCROLLBACK + SCROLLBACK_SLACK ? s.slice(-MAX_SCROLLBACK) : s;

// `pending` masuk ke `scrollback` HANYA di sini. Itu yang membuat replay scrollback ke klien baru
// tak pernah bisa menduplikasi byte yang masih menunggu siaran: scrollback selalu berakhir persis
// di tempat `pending` mulai.
function flushOutput(a: Attachment): void {
  if (a.flushTimer) { clearTimeout(a.flushTimer); a.flushTimer = undefined; }
  if (!a.pending) return;
  const d = a.pending;
  a.pending = "";
  a.scrollback = trimScrollback(a.scrollback + d);
  broadcast(a, { t: "data", d });
}

// Klien tmux mati bukan berarti sesi berakhir: kita bisa di-detach paksa, atau server API
// ditutup. Yang menentukan akhir adalah pane-nya — itulah yang di-poll di bawah.
function open(id: string): Attachment {
  const pty = spawnPty("attach-session", "-d", "-t", name(id));
  const a: Attachment = { pty, scrollback: "", clients: new Set(), lastPhases: "", pending: "" };
  pty.onData((d) => {
    a.pending += d;
    if (a.pending.length >= COALESCE_MAX_BYTES) flushOutput(a);
    else if (!a.flushTimer) a.flushTimer = setTimeout(() => flushOutput(a), COALESCE_MS);
  });
  pty.onExit(() => { if (attached.get(id) === a) drop(id); });
  attached.set(id, a);
  startPoll();
  return a;
}

// Lepas klien tmux; sesi tmux-nya jalan terus.
function drop(id: string): void {
  const a = attached.get(id);
  if (!a) return;
  // Byte terakhir sebuah sesi lahir tepat sebelum kliennya dilepas; menutup socket dengan
  // `pending` masih terisi berarti membuangnya.
  flushOutput(a);
  attached.delete(id);
  a.pty.kill();
  for (const c of a.clients) c.close();
  a.clients.clear();
}

// Pane-nya benar-benar mati: kabari penonton sebelum melepas klien.
function end(id: string, code: number): void {
  const a = attached.get(id);
  if (!a) return;
  // `exit` tak boleh mendahului keluaran yang mendahuluinya.
  flushOutput(a);
  broadcast(a, { t: "exit", code });
  drop(id);
}

// Fase yang dilaporkan agen (SPEC-162). Frame hanya lahir saat isinya berubah — kalau tidak,
// tiap tick poll akan membanjiri klien dengan daftar fase yang sama persis.
// Terima Pane yang sudah dipegang loop poll (punya flow+phaseFile): baca berkas fase langsung
// tanpa sessionPhases→getSession→listPanes lagi. SPEC-197: menghindari 1+K spawn `tmux list-panes`
// sinkron per tick 500ms saat K terminal terbuka.
// SPEC-433 · kunci dedup WAJIB memuat `complete`, bukan hanya `phases`. `complete` bisa berubah
// tanpa satu baris fase pun berubah: agen menulis `Execute done` (frame terkirim, complete=false
// karena plan masih `- [ ]`) lalu mencentang kotak terakhir. Dedup berkunci `phases` saja akan
// menelan frame itu dan pil "Selesai" tak pernah muncul — persis bentuk dedup lengket
// services/events.ts yang membuat pil palsu SPEC-402 tak bisa dikoreksi.
const phaseKey = (phases: Phase[], complete: boolean): string => JSON.stringify({ phases, complete });

// SPEC-433 · verdict "pekerjaan sesi ini sudah selesai", diturunkan dari sebuah Pane yang sudah di
// tangan. `sessionComplete` menyentuh disk hanya sesudah cek fase murni lolos — biayanya di ekor
// sesi, bukan sepanjang hidupnya.
const paneComplete = (p: Pane): boolean =>
  !!p.flow && !!p.phaseFile && sessionComplete(readPhases(p.phaseFile, p.flow), p.cwd, p.specId);

/**
 * SPEC-451 · verdict yang sama untuk pembaca DI LUAR jembatan WebSocket — denyut hanoman-lead
 * memutuskan nasib backlog yang sudah selesai dan tak punya klien terpasang. Sengaja satu fungsi
 * bersama `pollPhases`/`attach`: predikat yang disalin ke pemakai kedua adalah kelas bug SPEC-431
 * (`baseSha IS NULL`) dan SPEC-448 (`rootBypassEnv` yang tak menyeberang ke titik spawn kedua).
 *
 * `exited` sengaja TIDAK ikut ditanya: itulah seluruh isi SPEC-433 — di jalur sukses pane tak
 * pernah mati sendiri, jadi keduanya adalah fakta yang berdiri sendiri-sendiri.
 *
 * Ia BUKAN field di `SessionInfo`: `listSessions()` dipanggil governor tiap 10 dtk dan oleh siaran
 * events, dan verdict ini akan membayar `readdir` + `readFile` sepanjang hidup setiap sesi.
 */
export const sessionFinished = (id: string): boolean => {
  const p = getSession(id);
  return !!p && paneComplete(p);
};

function pollPhases(p: Pane, a: Attachment): void {
  if (!p.flow || !p.phaseFile) return;
  const phases = readPhases(p.phaseFile, p.flow);
  const complete = paneComplete(p);
  const json = phaseKey(phases, complete);
  if (json === a.lastPhases) return;
  a.lastPhases = json;
  broadcast(a, { t: "phase", phases, complete });
}

// SPEC-863 · cermin pollPhases: frame lahir hanya saat berubah, dan sumbernya `Pane` yang sudah
// dipegang loop poll — tak ada invokasi tmux tambahan, `#{alternate_on}` ikut di `FMT`.
function pollAlt(p: Pane, a: Attachment): void {
  if (p.altScreen === a.lastAlt) return;
  a.lastAlt = p.altScreen;
  broadcast(a, { t: "alt", on: p.altScreen });
}

let poll: NodeJS.Timeout | undefined;
// ponytail: satu `tmux list-panes` + satu bacaan berkas fase per 500ms untuk semua sesi
// terbuka. Ganti dengan hook `pane-died` + `wait-for` kalau terminal yang terbuka bersamaan
// pernah sampai puluhan.
let polling = false;
function startPoll(): void {
  if (poll) return;
  poll = setInterval(() => {
    // Tick yang masih menunggu jawaban tmux tak ditumpuk: saat mesin sibuk satu jawaban terukur
    // sampai 916 ms, dan tick berikutnya hanya akan menanyakan hal yang sama.
    if (polling) return;
    polling = true;
    // Snapshot attachment diambil SEBELUM tmux ditanya: attachment yang lahir atau diganti selagi
    // jawaban dalam perjalanan tak boleh dinilai dengan daftar pane yang lebih tua darinya — sesi
    // yang baru dilahirkan ulang dengan id yang sama akan terbaca "sudah mati".
    const snapshot = [...attached.entries()];
    // SPEC-402 · tick yang tak bisa bertanya ke tmux DILEWATI. Sebelumnya kegagalan invokasi
    // dibaca sebagai daftar kosong → `end(id, 0)` untuk setiap sesi yang sedang ditonton, yaitu
    // "— sesi berakhir (exit 0) —" pada agen yang masih bekerja. Diperparah dedup siaran di
    // services/events.ts: kebenaran (`exited:false`) tak pernah dikirim ulang, jadi pil "Selesai"
    // palsu itu LENGKET. Keadaan tak diketahui bukan bukti kematian.
    listPanesAsync().then((panes) => {
      const live = new Map(panes.map((p) => [p.id, p]));
      for (const [id, a] of snapshot) {
        if (attached.get(id) !== a) continue;   // dilepas atau diganti selagi tmux ditanya
        const p = live.get(id);
        if (!p) end(id, 0);            // sesinya dibunuh dari luar
        else if (p.exited) end(id, p.code);
        else {
          pollPhases(p, a);
          pollAlt(p, a);
        }
      }
    }, () => { /* tak bisa bertanya ke tmux: tick dilewati (SPEC-402) */ }).finally(() => {
      polling = false;
      if (attached.size === 0 && poll) { clearInterval(poll); poll = undefined; }
    });
  }, POLL_MS);
  poll.unref();
}

// SPEC-860 · Replay adalah GAMBAR, bukan percakapan. Aliran pty memuat PERTANYAAN terminal —
// handshake attach tmux (`\x1b[c`, `\x1b[>c`, `\x1b[>q`, `\x1b[?996n`, `\x1b]10;?`, `\x1b]11;?`)
// dan pertanyaan program yang diteruskan tmux (`\x1b]4;n;?`, laporan ukuran XTWINOPS). Memutar
// ulangnya apa adanya membuat setiap klien baru MENJAWAB pertanyaan lama; tmux sudah lewat
// handshake DA-nya (`TTY_HAVEDA`) sehingga jawaban itu diteruskan ke pane sebagai KETIKAN —
// satu salinan `[?1;2c[>0;276;0c` di baris prompt agen per attach, menumpuk tiap reconnect.
// Tak satu pun bentuk di bawah ini menggambar apa pun, jadi membuangnya dari replay tak
// mengubah satu sel pun. Aliran HIDUP sengaja tak disentuh: di sana tmux memang menunggu
// jawabannya, dan attach pertama terukur bersih.
const TERMINAL_QUERY = new RegExp([
  "\\x1b\\[[?>=]?[0-9;]*c",                 // Device Attributes 1/2/3
  "\\x1b\\[>[0-9;]*q",                      // XTVERSION — `>` wajib, DECSCUSR `\\x1b[2 q` bukan ini
  "\\x1b\\[\\??[0-9;]*n",                   // DSR/DECDSR, termasuk `?996n` (skema warna)
  "\\x1b\\[\\??[0-9;]*\\$[py]",             // DECRQM & balasannya
  "\\x1b\\][0-9][0-9;]*\\?(?:\\x07|\\x1b\\\\)",   // OSC 4/10/11/12 `…;?`
  "\\x1bP[0-9]*[$+][a-z][^\\x1b]*\\x1b\\\\",      // DECRQSS & XTGETTCAP
  "\\x1b\\[(?:11|13|14|15|16|18|19|20|21)t",      // XTWINOPS laporan — berparameter TUNGGAL
].join("|"), "g");

export const stripTerminalQueries = (s: string): string => s.replace(TERMINAL_QUERY, "");

// SPEC-878 · definisinya pindah ke `@hanoman/shared` karena klien memakainya juga (balasan
// handshake milik sambungan yang sudah mati tak boleh ikut mengantre di klien). Diekspor
// ulang di sini supaya call site server dan test SPEC-860 tak bergeser.
export { isTerminalResponse };

export function attach(id: string, c: Client): void {
  const p = getSession(id);
  if (!p) { c.close(); return; }
  // Pane mati tidak butuh klien tmux — attach ke sana tidak menggambar ulang apa pun.
  // Putar ulang layarnya lalu tutup, persis seperti membuka kembali tab sesi yang berakhir.
  if (p.exited) {
    const screen = tmux("capture-pane", "-p", "-e", "-J", "-S", "-2000", "-t", name(id));
    if (screen.trim()) {
      c.send(frame({ t: "data", d: stripTerminalQueries(screen.replace(/\n/g, "\r\n")) }));
    }
    c.send(frame({ t: "exit", code: p.code }));
    c.close();
    return;
  }
  const a = attached.get(id) ?? open(id);
  a.clients.add(c);
  // Scrollback lebih dulu untuk klien kedua; klien pertama digambar ulang oleh tmux sendiri.
  if (a.scrollback) c.send(frame({ t: "data", d: stripTerminalQueries(a.scrollback) }));
  // SPEC-863 · alasan yang sama dengan `phase` di bawah: siaran hanya lahir saat BERUBAH, jadi
  // klien yang mendarat di tengah alternate screen tak akan pernah mendapatnya. Prediksi klien
  // default `false`, dan tanpa baris ini ia akan meramal di dalam TUI layar penuh.
  a.lastAlt = p.altScreen;
  c.send(frame({ t: "alt", on: p.altScreen }));
  // Fase dikirim ke klien ini saja: `lastPhases` milik attachment sudah terisi kalau klien
  // pertama menerimanya, dan siaran ulang tak akan pernah sampai ke klien kedua.
  // SPEC-433 · dibaca dari `p` yang sudah di tangan, bukan `sessionPhases(id)` yang memanggil
  // getSession→listPanes lagi — dan verdict `complete` memang butuh cwd+specId milik pane itu.
  // Lewat sinilah pil "Selesai" selamat dari refresh & pindah sel: klien baru langsung diberi
  // verdict-nya, tak perlu menunggu berkas fase berubah lagi (yang takkan pernah terjadi).
  if (p.flow && p.phaseFile) {
    const phases = readPhases(p.phaseFile, p.flow);
    const complete = paneComplete(p);
    a.lastPhases = phaseKey(phases, complete);
    c.send(frame({ t: "phase", phases, complete }));
  }
}

export const detach = (id: string, c: Client): void => { attached.get(id)?.clients.delete(c); };

// SPEC-860 · satu attachment menyiarkan ke SEMUA klien, jadi setiap penonton menjawab pertanyaan
// terminal yang sama; program hanya membaca satu, sisanya mendarat sebagai ketikan. Penjawabnya
// klien pertama attachment — ia pergi, penerusnya yang menjawab. `from` opsional: pemanggil
// internal (dialog TUI, papan tombol) bukan terminal dan tak pernah membalas apa pun.
export function writeTo(id: string, d: string, from?: Client): void {
  const a = attached.get(id);
  if (!a) return;
  if (from && isTerminalResponse(d) && a.clients.values().next().value !== from) return;
  a.pty.write(d);
}

export function resize(id: string, cols: number, rows: number): void {
  attached.get(id)?.pty.resize(cols, rows);
}

export function killSession(id: string): boolean {
  const p = getSession(id);
  if (!p) return false;
  // SPEC-362 · capture SEBELUM kill: sesudah `kill-session` scrollback-nya tak ada lagi.
  const transcript = captureTranscript(id);
  drop(id);
  tmux("kill-session", "-t", name(id));
  emitDeath({ sessionId: id, exitCode: p.exited ? p.code : null, transcript });
  // SPEC-816 · lampiran gambar sesi ini ikut mati. Fire-and-forget: `rm` async (rmSync memblokir
  // event loop, SPEC-742/ADR-0116) dan kegagalannya tak boleh menahan penutupan sesi.
  void dropSessionUploads(id).catch(() => { /* berkas sisa tak fatal */ });
  return true;
}

// Untuk test: buang tmux server hanoman seluruhnya.
export function killAll(): void {
  for (const id of [...attached.keys()]) drop(id);
  try { tmux("kill-server"); } catch { /* belum jalan */ }
}

// Untuk shutdown API: lepaskan klien tmux, biarkan sesinya jalan terus.
export function detachAll(): void {
  for (const id of [...attached.keys()]) drop(id);
}

// node-pty mem-publish prebuilds/*/spawn-helper dengan mode 0644. Tanpa exec bit setiap
// fork mati dengan "posix_spawnp failed", pesan yang tidak menyebut node-pty sama sekali.
// `postinstall` di package.json memperbaikinya, tapi pnpm melewati script itu saat tree
// sudah up-to-date — jadi terjemahkan errornya alih-alih membiarkan orang menebak.
//
// SPEC-403 (lanjutan, 2026-08-14) · penawarnya dipasang DI SINI, bukan di jalur boot mana pun.
// `ensureSpawnHelperOnce` sebelumnya hanya dipanggil `hanoman start`; deployment yang menjalankan
// `node dist/server.js` langsung melewatinya, jadi setiap `npm i -g hanoman` mengembalikan
// terminal ke blank hitam sementara REST, tmux, dan WebSocket-nya semua sehat. `spawnPty` adalah
// satu-satunya tempat proses ini meng-exec node-pty: memasangnya di sini berarti tak ada jalur
// masuk yang bisa terlewat. Biayanya beberapa `stat` sekali seumur proses (memoized).
function spawnPty(...args: string[]): IPty {
  ensureSpawnHelperOnce(createRequire(import.meta.url).resolve, (m) => process.stdout.write(m));
  try {
    return spawn("tmux", ["-L", socket(), "-f", "/dev/null", ...args], {
      name: "xterm-256color", cols: 80, rows: 24,
      env: process.env as Record<string, string>,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.includes("posix_spawnp")) throw e;
    throw new Error(
      `${msg} — spawn-helper node-pty kemungkinan kehilangan exec bit. ` +
      `Jalankan: pnpm --filter ./server run postinstall`,
    );
  }
}
