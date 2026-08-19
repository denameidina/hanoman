import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import {
  appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createSession, getSession, listSessions, killSession, killAll, detachAll, attach, writeTo,
  sessionPhases, sessionFinished, markerFilled, promptFilePath, armGoalInTui, goalGatePath,
  sessionKind, registerSessionHooks, rootBypassEnv, sendToPane, shellBin,
  MAX_SCROLLBACK, SCROLLBACK_SLACK, trimScrollback,
  type SessionBirth, type SessionDeath,
} from "../src/services/pty";
import { phaseFilePath, type Phase } from "../src/services/session-phases";

// createSession SELALU menambahkan --dangerously-skip-permissions, jadi binary pengganti
// harus menoleransi flag itu. /bin/cat tidak: ia mati seketika dengan "illegal option".
const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.sh", import.meta.url));

// SPEC-397 · berdiri sebagai `codex`: memantulkan stdin DAN memancarkan penanda runtime goal codex
// begitu menerima `/goal …`. fake-claude.sh dipakai sebagai kontrol negatif (ia memantulkan `/goal`
// tapi tak pernah memancarkan penanda goal).
const FAKE_CODEX_GOAL = fileURLToPath(new URL("./fixtures/fake-codex-goal.sh", import.meta.url));

// SPEC-452 · berdiri sebagai agen yang sedang menampilkan dialog `AskUserQuestion`.
const FAKE_DIALOG = fileURLToPath(new URL("./fixtures/fake-dialog.sh", import.meta.url));
const FAKE_REVIEW = fileURLToPath(new URL("./fixtures/fake-review.sh", import.meta.url));
const FAKE_NOTES = fileURLToPath(new URL("./fixtures/fake-notes-dialog.sh", import.meta.url));

// SPEC-812 · TUI redraw penuh berjeda: satu-satunya bentuk keluaran yang benar-benar tiba di klien
// sebagai burst (tmux menggabungkan keluaran tanpa jeda sebelum sempat meninggalkan pane).
const BURST_TUI = fileURLToPath(new URL("./fixtures/burst-tui.mjs", import.meta.url));

// SPEC-402 · `tmux` yang gagal karena sebab SELAIN "tak ada server". Ditaruh di PATH sebagai satu
// berkas bernama `tmux` — pty.ts memanggil `execFileSync("tmux", …)` tanpa path absolut, jadi ini
// cara paling dekat dengan kegagalan sungguhan (fork gagal saat mesin penuh proses).
const FAKE_TMUX_FAIL = fileURLToPath(new URL("./fixtures/fake-tmux-fail.sh", import.meta.url));
const withFailingTmux = async (fn: () => void | Promise<void>): Promise<void> => {
  const real = process.env.PATH;
  const dir = mkdtempSync(join(tmpdir(), "hanoman-tmuxfail-"));
  copyFileSync(FAKE_TMUX_FAIL, join(dir, "tmux"));
  chmodSync(join(dir, "tmux"), 0o755);
  process.env.PATH = dir;
  // finally menunggu fn selesai (termasuk yang async): memulihkan PATH lebih awal akan membuat
  // tick poll berikutnya kembali melihat tmux asli dan menguji keadaan yang salah.
  try { await fn(); } finally { process.env.PATH = real; }
};

// Klien palsu yang merekam frame — cukup untuk menguji kontrak broadcast.
function fakeClient() {
  const frames: { t: string; d?: string; code?: number; phases?: Phase[]; complete?: boolean }[] = [];
  let closed = false;
  return {
    frames, wasClosed: () => closed,
    send: (m: string) => { frames.push(JSON.parse(m)); },
    close: () => { closed = true; },
  };
}
const waitFor = async (ok: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};
// SPEC-362 · mengintip pane langsung (bukan lewat attach) untuk membuktikan transkrip yang
// ditangkap hook benar-benar berasal dari scrollback tmux sebelum pane dibunuh.
const tmuxCapture = (id: string): string | null => {
  try {
    return execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman-test",
      "-f", "/dev/null", "capture-pane", "-p", "-t", `hanoman-${id}`], { encoding: "utf8" });
  } catch { return null; }
};
const tmuxShowOption = (name: string): string | null => {
  try {
    return execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman-test",
      "-f", "/dev/null", "show-option", "-gv", name], { encoding: "utf8" }).trim();
  } catch { return null; }
};
const lastFrame = (c: ReturnType<typeof fakeClient>) => c.frames[c.frames.length - 1];
const allData = (c: ReturnType<typeof fakeClient>) =>
  c.frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join("");
const exited = (id: string) => getSession(id)?.exited === true;
const phaseFrames = (c: ReturnType<typeof fakeClient>) => c.frames.filter((f) => f.t === "phase");

let repoDir = "";
beforeEach(() => { repoDir = mkdtempSync(join(tmpdir(), "hanoman-pty-")); });
afterEach(() => { killAll(); });

describe("pty service", () => {
  it("spawns the claude binary with --dangerously-skip-permissions and reports its exit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(c)).toEqual({ t: "exit", code: 0 });
    expect(c.wasClosed()).toBe(true);
  });

  // SPEC-403 · claude CLI menolak --dangerously-skip-permissions saat uid 0 dan langsung exit(1)
  // → di VPS (hanoman jalan sebagai root) SEMUA sesi mati saat lahir. IS_SANDBOX=1 membuka gerbang.
  it("rootBypassEnv memasang IS_SANDBOX hanya saat uid 0", () => {
    expect(rootBypassEnv(0)).toEqual({ IS_SANDBOX: "1" });
    expect(rootBypassEnv(1000)).toEqual({});
    // Tanpa argumen: uid proses yang berlaku.
    expect(rootBypassEnv()).toEqual(process.getuid?.() === 0 ? { IS_SANDBOX: "1" } : {});
  });

  it("sesi claude mewarisi IS_SANDBOX sesuai uid proses; sesi non-claude tidak", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const expected = process.getuid?.() === 0 ? "IS_SANDBOX=1" : "IS_SANDBOX=";
    const s = createSession("sbx1", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("env:"));
    expect(allData(c).replace(/\s+/g, " ")).toContain(`env: ${expected}`);

    // Console VPS / terminal biasa: argv mentah, tak ada gerbang root untuk dibuka.
    const raw = createSession("sbx2", process.cwd(), { command: [FAKE_CLAUDE] });
    const c2 = fakeClient();
    attach(raw.id, c2);
    await waitFor(() => allData(c2).includes("env:"));
    expect(allData(c2).replace(/\s+/g, " ")).toContain("env: IS_SANDBOX=");
    expect(allData(c2).replace(/\s+/g, " ")).not.toContain("env: IS_SANDBOX=1");
  });

  // SPEC-332 · ADR-0073 · mode goal: Stop hook bertipe prompt ikut lahir bersama sesi.
  it("goal opt menaruh Stop hook bertipe prompt di argv --settings", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("goal1", process.cwd(), { goal: "berhenti hanya bila SELESAI-332" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    const out = allData(c).replace(/\s+/g, " ");
    expect(out).toContain('"Stop"');
    expect(out).toContain('"type":"prompt"');
    expect(out).toContain("SELESAI-332");
  });

  it("tanpa goal opt tak ada hook Stop di argv", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("goal2", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).not.toContain('"Stop"');
  });

  // SPEC-338 · ADR-0074 · sesi codex lahir dengan argv codex, bukan claude.
  it("agent codex memakai biner & flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("cx1", process.cwd(), { agent: "codex", model: "gpt-5.5", effort: "high" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    const out = allData(c).replace(/\s+/g, " ");
    expect(out).toContain("-m gpt-5.5");
    expect(out).toContain('model_reasoning_effort="high"');
    expect(out).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(out).toContain("--dangerously-bypass-hook-trust");
    expect(out).not.toContain("--dangerously-skip-permissions");
  });

  it("agent tercatat di tmux & terbaca listSessions", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("p-cx2", process.cwd(), { id: "cx2", agent: "codex" });
    expect(s.agent).toBe("codex");
    expect(getSession("cx2")?.agent).toBe("codex");
    expect(listSessions().find((x) => x.id === "cx2")?.agent).toBe("codex");
  });

  it("tanpa opts.agent sesi tetap claude (default historis)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("cx3", process.cwd());
    expect(s.agent).toBe("claude");
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--dangerously-skip-permissions");
  });

  it("goal codex menulis skrip gate & memasangnya sebagai Stop hook", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const phaseFile = phaseFilePath(repoDir, "cx4");
    const s = createSession("cx4", process.cwd(), {
      agent: "codex", flow: "feature", specId: "SPEC-338", phaseFile,
      goal: "KONDISI-338",
    });
    await waitFor(() => exited(s.id));
    const gate = goalGatePath(s.id);
    expect(readFileSync(gate, "utf8")).toContain("KONDISI-338");
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c).replace(/\s+/g, " ")).toContain(gate);
  });

  // SPEC-332 · ADR-0073 · jalur KEDUA: teks `/goal …` benar-benar sampai ke pane. fake-claude
  // (`exec cat` di atas tty) memantulkan apa pun yang diketik, jadi capture-pane membuktikannya
  // tanpa memanggil claude sungguhan.
  it("armGoalInTui mengetik /goal ke pane dan meratakan kondisi multi-baris", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("goal3", process.cwd());
    const ok = await armGoalInTui(s.id, "baris satu\nbaris dua", {
      pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 30,
    });
    expect(ok).toBe(true);
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("/goal"));
    expect(allData(c).replace(/\s+/g, " ")).toContain("/goal baris satu baris dua");
  });

  it("armGoalInTui menyerah diam-diam pada sesi yang tak ada", async () => {
    expect(await armGoalInTui("tidak-ada", "kondisi", { pollMs: 5, readyTries: 2, settleMs: 5, verifyTries: 2 }))
      .toBe(false);
  });

  // SPEC-397 · ADR-0085 · sesi codex ikut memasang goal NATIVE codex lewat `/goal`.
  it("armGoalInTui memasang goal di sesi codex dan mengenalinya dari penanda runtime goal", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const s = createSession("goal-cx1", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, "kondisi codex", {
      agent: "codex", pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 40, chunkMs: 1,
    });
    expect(ok).toBe(true);
    expect(tmuxCapture(s.id) ?? "").toContain("Pursuing goal");
  });

  // Jebakan yang dijaga: pane yang HANYA memuat teks `/goal` — persis yang terjadi saat kondisi
  // ter-degradasi jadi `[Pasted Content …]` dan slash-dispatch tak jalan — TIDAK boleh dihitung
  // sebagai goal terpasang untuk codex. Verifikasi lama `includes("/goal")` lulus palsu di sini.
  it("armGoalInTui TIDAK menganggap sesi codex ter-arm hanya karena pane memuat /goal", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CLAUDE;
    const s = createSession("goal-cx2", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, "kondisi codex", {
      agent: "codex", pollMs: 10, readyTries: 30, settleMs: 40, verifyTries: 3, chunkMs: 1, sendTries: 1,
    });
    expect(ok).toBe(false);
    expect(tmuxCapture(s.id) ?? "").toContain("/goal kondisi codex");
  });

  // Kondisi multi-potongan dikirim sebagai BANYAK `send-keys` (ADR-0085: satu burst ≥ 1024 karakter
  // diubah TUI codex jadi `[Pasted Content N chars]` dan `/goal` mati diam). Yang dijaga di sini
  // adalah properti yang bisa diamati dari luar: pemotongan tak boleh MENGUBAH apa yang sampai —
  // tak ada potongan hilang, terduplikasi, atau tertukar urutan sepanjang jalur tmux.
  //
  // 900 karakter = 2 potongan (500 + 400), dan angkanya SENGAJA di bawah ~1,2 KB. Fixture ini adalah
  // `sh read` di tty mode KANONIKAL, dan antrean masukan tty punya batas yang bergantung timing
  // pengurasan echo: terukur di mesin ini 900–1200 selalu sampai, sementara 1300–1500 kadang sampai
  // kadang tidak (1500 lolos dengan potongan 500, gagal dengan potongan 400). Itu batasan FIXTURE,
  // bukan hanoman maupun codex — codex sungguhan membaca tty-nya di mode raw dengan buffer sendiri,
  // dan objektif 4000 karakter terbukti diterimanya. Jangan "memperbaiki" test ini dengan menaikkan
  // panjangnya: yang didapat cuma flake.
  //
  // Batas "tak ada potongan ≥ 1024" sendiri dijaga unit test `goalChunks` di runner — di sana ia
  // deterministik, di sini tidak.
  it("kondisi multi-potongan tiba utuh & berurutan di pane", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const cond = "z".repeat(900);
    const s = createSession("goal-cx3", process.cwd(), { agent: "codex" });
    const ok = await armGoalInTui(s.id, cond, {
      agent: "codex", pollMs: 40, readyTries: 30, settleMs: 40, verifyTries: 40, chunkMs: 5,
    });
    expect(ok).toBe(true);
    // capture-pane melipat baris; buang pembungkusnya sebelum mencocokkan isi.
    expect((tmuxCapture(s.id) ?? "").replace(/\s+/g, "")).toContain("/goal" + cond);
  }, 15000);

  // SPEC-397 · gerbang `agent === "claude"` di createSession dicabut: sesi codex ber-goal ikut
  // menerima keystroke, bukan hanya gate sh.
  it("createSession codex ber-goal ikut mengetik /goal ke pane", async () => {
    process.env.HANOMAN_CODEX_BIN = FAKE_CODEX_GOAL;
    const phaseFile = phaseFilePath(repoDir, "goal-cx4");
    const s = createSession("goal-cx4", process.cwd(), {
      agent: "codex", flow: "feature", specId: "SPEC-397", phaseFile, goal: "KONDISI-397",
    });
    await waitFor(() => (tmuxCapture(s.id) ?? "").includes("Pursuing goal"), 20000);
    expect((tmuxCapture(s.id) ?? "").replace(/\s+/g, " ")).toContain("KONDISI-397");
    // 25 dtk: arming di jalur ini memakai timing DEFAULT `armGoalInTui` (settleMs 1200 + poll 500 ms)
    // karena createSession memanggilnya tanpa opsi — di atas testTimeout bawaan vitest 5 dtk.
  }, 25000);

  // SPEC-211 · Open Console memasok argv sendiri (mis. `ssh -t …`) — shell mentah, bukan claude.
  it("command opt menjalankan perintah non-claude, tanpa flag claude", async () => {
    const s = createSession("con1", process.cwd(), { command: ["/bin/echo", "halo-console"] });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("halo-console");
    expect(allData(c)).not.toContain("--dangerously-skip-permissions");
  });

  // tmux menyerahkan argumen perintah `new-session` ke `default-shell`, yang defaultnya diambil
  // dari /etc/passwd milik user pemanggil. Di VPS user service-nya `/usr/sbin/nologin` → SETIAP
  // pane lahir langsung mati ("Attempted login by UNKNOWN") dan tak ada sesi terminal yang jalan.
  // Karena itu default-shell dipatok eksplisit ke shellBin(), bukan diwariskan dari passwd.
  // HANOMAN_SHELL dipakai supaya nilainya BERBEDA dari shell login user yang menjalankan test —
  // menyamakan keduanya membuat assert lulus tanpa perbaikan apa pun.
  it("memaku default-shell tmux ke shellBin(), tidak mewarisi shell login user", async () => {
    process.env.HANOMAN_SHELL = "/bin/sh";
    try {
      const s = createSession("shl1", process.cwd(), { command: ["/bin/echo", "halo"] });
      await waitFor(() => exited(s.id));
      expect(shellBin()).toBe("/bin/sh");
      expect(tmuxShowOption("default-shell")).toBe("/bin/sh");
    } finally { delete process.env.HANOMAN_SHELL; }
  });

  // `remain-on-exit` menahan pane yang sudah mati: output terakhir sesi yang gagal masih
  // terbaca setelah refresh, dan kode keluarnya yang asli — bukan kode klien tmux.
  it("keeps a dead session listed, carrying its real exit code", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/usr/bin/false";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    expect(listSessions()).toMatchObject([{ id: s.id, exited: true }]);
    const c = fakeClient();
    attach(s.id, c);
    expect(lastFrame(c)).toEqual({ t: "exit", code: 1 });
  });

  it("replays the dead pane's screen to a client that attaches after the process exited", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const late = fakeClient();
    attach(s.id, late);
    expect(allData(late)).toContain("--dangerously-skip-permissions");
    expect(lastFrame(late)).toEqual({ t: "exit", code: 0 });
  });

  it("forwards stdin to a live process and keeps it listed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p2", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("args: --dangerously-skip-permissions"));
    writeTo(s.id, "halo\n");
    await waitFor(() => allData(c).includes("halo"));
    expect(listSessions()[0]).toMatchObject({ id: s.id, projectId: "p2", cwd: process.cwd(), exited: false });
    expect(getSession(s.id)).toMatchObject({ id: s.id, projectId: "p2" });
  });

  // SPEC-812 · node-pty membaca dengan buffer tetap 1024 byte, jadi satu frame per chunk berarti
  // ±128 frame/detik untuk sesi yang ramai keluaran. Karena tak ada chunk node-pty yang melewati
  // ±1026 byte, satu frame `data` yang lebih besar dari itu adalah bukti langsung coalescing.
  it("menggabungkan burst keluaran PTY menjadi frame data yang jauh lebih besar dari satu chunk", async () => {
    const s = createSession("p9", process.cwd(), { command: [process.execPath, BURST_TUI, "20"] });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("BURSTDONE"), 30_000);

    const sizes = c.frames.filter((f) => f.t === "data").map((f) => (f.d ?? "").length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThan(20_000);
    expect(Math.max(...sizes)).toBeGreaterThan(4 * 1024);
  });

  // SPEC-812 · trim scrollback diamortisasi (satu potong per slack, bukan per chunk), jadi
  // batasnya bergeser dari MAX_SCROLLBACK menjadi MAX_SCROLLBACK + SCROLLBACK_SLACK. Yang tak
  // boleh bergeser: ia tetap BERBATAS, dan yang dibuang selalu kepala — sesi yang menyala
  // berhari-hari tak boleh menahan memori, dan riwayat TERBARU tak boleh ikut terbuang.
  it("trimScrollback menahan batas atas dan selalu menyisakan ekor", () => {
    const at = (n: number) => "x".repeat(n);
    expect(trimScrollback(at(MAX_SCROLLBACK + SCROLLBACK_SLACK)).length)
      .toBe(MAX_SCROLLBACK + SCROLLBACK_SLACK);
    expect(trimScrollback(at(MAX_SCROLLBACK + SCROLLBACK_SLACK + 1)).length).toBe(MAX_SCROLLBACK);

    const grown = trimScrollback(`${at(MAX_SCROLLBACK + SCROLLBACK_SLACK)}EKOR`);
    expect(grown.length).toBe(MAX_SCROLLBACK);
    expect(grown.endsWith("EKOR")).toBe(true);
  });

  // Inti ADR-0016: sesi hidup di tmux server, bukan di proses API. Menutup server — atau
  // me-restartnya lewat `pnpm dev` — hanya melepas klien, tidak membunuh claude.
  it("survives the API letting go: detachAll leaves the session running and re-attachable", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p4", process.cwd());
    const first = fakeClient();
    attach(s.id, first);
    await waitFor(() => allData(first).includes("args:"));

    detachAll();
    expect(listSessions()).toMatchObject([{ id: s.id, exited: false }]);

    const second = fakeClient();
    attach(s.id, second); // klien tmux baru; tmux menggambar ulang layar yang sama
    await waitFor(() => allData(second).includes("args:"));
    expect(lastFrame(second)?.t).not.toBe("exit");
  });

  // Sesi sebuah backlog item itu tunggal: menekan Start lagi harus menyambung, bukan
  // menyalakan `claude` kedua di atas worktree yang sama (ADR-0015).
  it("reuses a backlog item's existing session instead of spawning a second claude", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const a = createSession("p1", process.cwd(), { specId: "SPEC-7", flow: "feature", prompt: "x" });
    const b = createSession("p1", process.cwd(), { specId: "SPEC-7", flow: "feature", prompt: "x" });
    expect(b.id).toBe(a.id);
    expect(listSessions()).toHaveLength(1);
  });

  // Guardrail deny PreToolUse dicabut (SPEC-197, ADR-0037): sesi tetap membawa `--settings`
  // (untuk marker keputusan SPEC-184) tapi TAK ada lagi hook deny `hook pretooluse`.
  it("tidak lagi mendaftarkan guard hook PreToolUse (ADR-0037)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", process.cwd());
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("--settings");
    expect(allData(c)).not.toContain("hook pretooluse");
    expect(allData(c)).not.toContain("PreToolUse");
  });

  it("sesi backlog membawa specId + flow, dan id-nya diturunkan dari spec", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", repoDir, { specId: "SPEC-162", flow: "feature", prompt: "halo" });
    expect(s.id).toBe("spec-162");
    expect(listSessions().find((x) => x.id === "spec-162")).toMatchObject({
      specId: "SPEC-162", flow: "feature",
    });
  });

  it("prompt awal + model + effort sampai ke argv claude", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p1", repoDir, {
      specId: "SPEC-A", flow: "feature", prompt: "kerjakan ini", model: "claude-opus-5", effort: "xhigh",
    });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c)).toContain("kerjakan ini");
    expect(allData(c)).toContain("--model claude-opus-5");
    expect(allData(c)).toContain("--effort xhigh");
  });

  // SPEC-223 · prompt scaffold/reverse (STANDAR DOCS) + ide panjang bisa >16KB; menaruhnya inline
  // di command tmux memicu "tmux set-option gagal: command too long". Prompt harus lewat file yang
  // dibaca `$(cat …)` saat sesi lahir — command tmux tetap pendek, claude tetap terima prompt penuh.
  it("prompt sangat besar tak melebihi batas command tmux — ditulis ke file (SPEC-223)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const big = "MULAI " + "x".repeat(60_000) + " SELESAI";
    let s!: ReturnType<typeof createSession>;
    expect(() => { s = createSession("p1", repoDir, { specId: "SPEC-BIG", flow: "feature", prompt: big }); })
      .not.toThrow();
    expect(getSession(s.id)).toBeTruthy();
    // Prompt penuh diserahkan lewat file (dibaca $(cat) saat sesi lahir), bukan argv tmux.
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe(big);
  });

  it("menyiarkan frame phase saat berkas fase berubah, sekali per perubahan", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-b");
    const s = createSession("p1", repoDir, { specId: "SPEC-B", flow: "feature", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    // Klien yang baru menempel langsung melihat fase, tanpa menunggu perubahan.
    await waitFor(() => phaseFrames(c).length > 0);
    expect(phaseFrames(c)[0]!.phases![0]).toEqual({ name: "Brainstorm", state: "active" });

    appendFileSync(phaseFile, "Brainstorm done\n");
    await waitFor(() => phaseFrames(c).some((f) => f.phases![0]!.state === "done"));

    const count = phaseFrames(c).length;
    await new Promise((r) => setTimeout(r, 1200)); // dua tick poll tanpa perubahan berkas
    expect(phaseFrames(c).length).toBe(count);
  });

  // SPEC-433 · frame fase membawa VERDICT-nya, bukan cuma daftar nama. Tanpa ini Terminal tak
  // punya satu pun masukan soal "sudah selesai": satu-satunya gerbangnya `exited` (⇐ pane_dead),
  // dan TUI agen tak pernah keluar sendiri sesudah fase terakhir.
  it("frame phase membawa complete: false selama masih ada fase yang belum tercatat", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-c1");
    const s = createSession("p1", repoDir, { specId: "SPEC-C1", flow: "qa", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => phaseFrames(c).length > 0);
    expect(phaseFrames(c)[0]!.complete).toBe(false);
  });

  it("seluruh fase tercatat + tanpa plan → frame phase complete: true walau pane MASIH HIDUP", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-c2");
    const s = createSession("p1", repoDir, { specId: "SPEC-C2", flow: "qa", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => phaseFrames(c).length > 0);

    appendFileSync(phaseFile, "Audit done\nSpec skipped\nPlan skipped\nExecute done\n");
    await waitFor(() => phaseFrames(c).some((f) => f.complete === true));
    // Pane-nya memang belum mati — itulah inti temuannya.
    expect(getSession(s.id)?.exited).toBe(false);
  });

  // Gerbang ADR-0029 ikut menyeberang: `Execute done` dengan plan bersisa `- [ ]` BUKAN selesai.
  // Tanpa ini "tak pernah hijau" cuma bertukar jadi "hijau palsu" (kelas kesalahan SPEC-402).
  it("Execute done tapi plan masih - [ ] → complete tetap false", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-c3");
    mkdirSync(join(repoDir, "docs/superpowers/plans"), { recursive: true });
    writeFileSync(join(repoDir, "docs/superpowers/plans/plan-spec-c3.md"), "- [x] a\n- [ ] b\n");
    const s = createSession("p1", repoDir, { specId: "SPEC-C3", flow: "qa", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => phaseFrames(c).length > 0);

    appendFileSync(phaseFile, "Audit done\nSpec skipped\nPlan skipped\nExecute done\n");
    await waitFor(() => phaseFrames(c).some((f) => f.phases!.every((p) => p.state !== "active")));
    expect(phaseFrames(c).every((f) => f.complete === false)).toBe(true);
  });

  // JEBAKAN yang mengikat implementasi: `complete` berubah TANPA daftar fase berubah — agen
  // mencentang kotak terakhir di plan sesudah menulis `Execute done`. Kunci dedup pollPhases
  // yang hanya memuat `phases` akan menelan frame itu dan pil "Selesai" tak pernah muncul —
  // bentuk yang sama dengan dedup lengket services/events.ts di SPEC-402.
  it("kotak plan terakhir dicentang (berkas fase TAK berubah) tetap menyiarkan complete: true", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-c4");
    const plan = join(repoDir, "docs/superpowers/plans/plan-spec-c4.md");
    mkdirSync(join(repoDir, "docs/superpowers/plans"), { recursive: true });
    writeFileSync(plan, "- [x] a\n- [ ] b\n");
    const s = createSession("p1", repoDir, { specId: "SPEC-C4", flow: "qa", prompt: "x", phaseFile });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => phaseFrames(c).length > 0);

    appendFileSync(phaseFile, "Audit done\nSpec skipped\nPlan skipped\nExecute done\n");
    await waitFor(() => phaseFrames(c).some((f) => f.phases!.every((p) => p.state !== "active")));
    expect(phaseFrames(c).every((f) => f.complete === false)).toBe(true);

    writeFileSync(plan, "- [x] a\n- [x] b\n");   // berkas fase sengaja TIDAK disentuh
    await waitFor(() => phaseFrames(c).some((f) => f.complete === true));
  });

  // SPEC-451 · verdict yang sama harus bisa dibaca pembaca DI LUAR jembatan WebSocket — denyut
  // hanoman-lead memutuskan nasib backlog yang sudah selesai, dan ia tak punya klien terpasang.
  // Satu definisi dipakai keduanya; menyalinnya adalah kelas bug SPEC-431 & SPEC-448.
  it("sessionFinished(id) menjawab true untuk sesi selesai yang panenya MASIH HIDUP", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const phaseFile = phaseFilePath(repoDir, "spec-c5");
    const s = createSession("p1", repoDir, { specId: "SPEC-C5", flow: "qa", prompt: "x", phaseFile });
    expect(sessionFinished(s.id)).toBe(false);

    writeFileSync(phaseFile, "Audit done\nSpec skipped\nPlan skipped\nExecute done\n");
    expect(sessionFinished(s.id)).toBe(true);
    expect(getSession(s.id)?.exited).toBe(false);   // inti temuannya: selesai TANPA pane mati
  });

  it("sessionFinished(id) menjawab false untuk sesi yang tak dikenal", () => {
    expect(sessionFinished("tidak-ada")).toBe(false);
  });

  // SPEC-209 · riwayat claude hidup di scrollback pane tmux, tapi klien hanya menerima layar
  // yang terlihat (ADR-0016) — tak ada jalan scroll ke atas. `mouse on` membuat tmux mengabari
  // klien mengaktifkan mouse-reporting (DECSET 1000/1006); xterm.js lalu meneruskan wheel ke
  // tmux → copy-mode → scroll riwayat. Bukti fix sampai ke klien: urutan enable itu ada di aliran.
  it("mengaktifkan mouse tmux agar browser bisa scroll riwayat pane (SPEC-209)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("\x1b[?1000h"));
  });

  it("sesi project (tanpa spec) tak punya fase", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p1", repoDir);
    expect(sessionPhases(s.id)).toBe(null);
  });

  it("killSession stops the process and forgets the session; a second kill is false", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p3", process.cwd());
    expect(killSession(s.id)).toBe(true);
    expect(listSessions()).toEqual([]);
    expect(getSession(s.id)).toBeUndefined();
    expect(killSession(s.id)).toBe(false);
  });

  it("markerFilled: absent/empty → false, non-empty → true (SPEC-196)", () => {
    const f = join(repoDir, "marker");
    expect(markerFilled(f)).toBe(false);        // berkas belum ada
    appendFileSync(f, "menunggu");
    expect(markerFilled(f)).toBe(true);
  });

  it("listSessions melaporkan decision saat marker keputusan terisi (SPEC-196)", () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const decisionFile = join(repoDir, ".worktrees", ".decisions", "spec-d");
    const s = createSession("p1", repoDir, { specId: "SPEC-D", flow: "feature", prompt: "x", decisionFile });
    const find = () => listSessions().find((x) => x.id === s.id)!;
    expect(find().decision).toBe(false);        // sesi hidup, marker belum ditulis
    appendFileSync(decisionFile, "menunggu\n");  // hook Notification menulis marker
    expect(find().decision).toBe(true);
  });

  // SPEC-339 · koersi ditaruh di createSession, bukan di route: SEMUA kelahiran sesi lewat sini,
  // termasuk POST ber-AgentToken yang tak pernah menyentuh picker UI.
  it("effort yang tak didukung model codex diturunkan sebelum masuk argv", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("p-339", process.cwd(), {
      agent: "codex", model: "gpt-5.6-luna", effort: "ultra",
    });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    // tmux membungkus baris pada lebar viewport — buang seluruh whitespace sebelum mencocokkan,
    // kalau tidak token bisa terpotong di tengah dan assert-nya gagal palsu.
    const flat = allData(c).replace(/\s+/g, "");
    expect(flat).toContain('model_reasoning_effort="xhigh"');
    expect(flat).not.toContain('model_reasoning_effort="ultra"');
  });

  it("effort yang didukung diteruskan apa adanya", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    const s = createSession("p-339b", process.cwd(), {
      agent: "codex", model: "gpt-5.6-sol", effort: "ultra",
    });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c).replace(/\s+/g, "")).toContain('model_reasoning_effort="ultra"');
  });

  it("sesi claude tak tersentuh koersi codex", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const s = createSession("p-339c", process.cwd(), { model: "claude-opus-5", effort: "ultracode" });
    await waitFor(() => exited(s.id));
    const c = fakeClient();
    attach(s.id, c);
    expect(allData(c).replace(/\s+/g, "")).toContain("--effortultracode");
  });
});

// SPEC-402 · "sesi selesai padahal belum selesai". Dua sumber kebohongan, keduanya di sini:
// kode keluar pane yang tak pernah menyeberang ke SessionInfo, dan kegagalan invokasi tmux
// yang dibaca sebagai "tak ada sesi sama sekali".
describe("kejujuran akhir sesi (SPEC-402)", () => {
  // Pane mati status ≠ 0 = pekerjaan TERPUTUS, bukan tuntas. Tanpa kode keluar di SessionInfo,
  // UI hanya punya `exited` dan melabeli agen yang di-SIGTERM sebagai "Selesai" (hijau).
  it("exitCode pane mati ikut ke listSessions", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/usr/bin/false";
    const s = createSession("p402a", process.cwd());
    await waitFor(() => exited(s.id));
    // `.find` alih-alih mencocokkan seluruh array: socket `hanoman-test` dibagi antar worktree,
    // jadi daftarnya bisa memuat sesi milik run tetangga (gagal palsu yang menyesatkan).
    expect(listSessions().find((x) => x.id === s.id))
      .toMatchObject({ id: s.id, exited: true, exitCode: 1 });
  });

  it("sesi hidup tak punya exitCode", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p402b", process.cwd());
    const live = listSessions().find((x) => x.id === s.id)!;
    expect(live.exited).toBe(false);
    expect(live.exitCode).toBeUndefined();
  });

  // Socket tanpa tmux server memang berarti "belum ada sesi sama sekali" — kontrol positif
  // supaya perbaikan di bawah tidak berlebihan dan melempar untuk keadaan normal ini.
  it("socket tanpa tmux server tetap daftar kosong", () => {
    const real = process.env.HANOMAN_TMUX_SOCKET;
    process.env.HANOMAN_TMUX_SOCKET = "hanoman-test-402-tak-pernah-ada";
    try { expect(listSessions()).toEqual([]); }
    finally { process.env.HANOMAN_TMUX_SOCKET = real; }
  });

  it("kegagalan invokasi tmux melempar, bukan menyamar sebagai daftar kosong", async () => {
    await withFailingTmux(() => { expect(() => listSessions()).toThrow(); });
  });

  // Inti keluhannya: satu tick poll yang gagal bertanya ke tmux tidak boleh memberi tahu setiap
  // terminal terbuka bahwa sesinya berakhir sukses. Keadaan tak diketahui bukan bukti kematian.
  it("tmux yang gagal TIDAK menyiarkan exit ke klien yang sedang menonton", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
    const s = createSession("p402c", process.cwd());
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => allData(c).includes("args:"));
    // Lebih panjang dari beberapa tick poll 500 ms — cukup untuk tick gagal berkali-kali.
    await withFailingTmux(async () => { await new Promise((r) => setTimeout(r, 1700)); });
    expect(c.frames.filter((f) => f.t === "exit")).toEqual([]);
    expect(c.wasClosed()).toBe(false);
    // Dan sesinya memang tak pernah mati: tmux yang sebenarnya masih memegangnya.
    expect(listSessions().find((x) => x.id === s.id)).toMatchObject({ id: s.id, exited: false });
  });
});

// SPEC-362 · ADR-0079 · hook riwayat sesi. pty.ts tetap nol dependensi DB: ia hanya menembakkan
// dua peristiwa dari dua titik cekik (createSession/killSession).
describe("hook riwayat sesi (SPEC-362)", () => {
  afterEach(() => { registerSessionHooks({}); });  // singleton modul — jangan bocor ke test lain

  it("sessionKind menurunkan jenis dari opsi kelahiran, bukan dari tebakan belakangan", () => {
    expect(sessionKind({ id: "spec-1", specId: "SPEC-1" }, "p1", "/r/.worktrees/spec-1")).toBe("spec");
    expect(sessionKind({ id: "prd-x", flow: "prd" }, "p1", "/r/.worktrees/prd-x")).toBe("prd");
    expect(sessionKind({ id: "reverse-p1", flow: "reverse" }, "p1", "/r/.worktrees/reverse-p1")).toBe("reverse");
    expect(sessionKind({ id: "vpsc-1", command: ["ssh"] }, "vps-console:1", "/home/x")).toBe("vps");
    expect(sessionKind({ id: "abc", command: ["/bin/bash"] }, "p1", "/r")).toBe("shell");
    expect(sessionKind({ id: "merge-x" }, "p1", "/r/.worktrees/merge-x")).toBe("worktree");
    expect(sessionKind({ id: "abc" }, "p1", "/r")).toBe("terminal");
  });

  it("onBirth menembak sekali saat sesi lahir dan TIDAK menembak saat Start kedua (re-attach)", () => {
    const births: SessionBirth[] = [];
    registerSessionHooks({ onBirth: (b) => { births.push(b); } });
    const id = "hook-birth";
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "sleep 30"] });
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "sleep 30"] }); // re-attach
    expect(births.filter((b) => b.sessionId === id)).toHaveLength(1);
    expect(births[births.length - 1]).toMatchObject({
      sessionId: id, projectId: "p-hook", kind: "shell", agent: "claude",
    });
    killSession(id);
  });

  it("onDeath membawa transkrip yang di-capture SEBELUM pane dibunuh", async () => {
    const deaths: SessionDeath[] = [];
    registerSessionHooks({ onDeath: (d) => { deaths.push(d); } });
    const id = "hook-death";
    createSession("p-hook", process.cwd(), { id, command: ["/bin/sh", "-c", "echo PENANDA-RIWAYAT; sleep 30"] });
    await waitFor(() => (tmuxCapture(id) ?? "").includes("PENANDA-RIWAYAT"));
    killSession(id);
    const d = deaths.find((x) => x.sessionId === id);
    expect(d).toBeDefined();
    expect(d!.transcript).toContain("PENANDA-RIWAYAT");
  });

  // SPEC-452 · sendToPane selama ini mengasumsikan pane SELALU kolom teks. Untuk dialog
  // `AskUserQuestion` asumsi itu salah: burst > 1 karakter ditelan dan `Enter` memilih baris
  // tersorot (baris 1), jadi keputusan lead tak pernah menyeberang.
  describe("sendToPane · dialog pilihan (SPEC-452)", () => {
    it("mengetik nomor kolom bebas lebih dulu saat pane menampilkan dialog", async () => {
      const id = "dlg-1";
      createSession("p-dlg", process.cwd(), { id, command: [FAKE_DIALOG] });
      await waitFor(() => (tmuxCapture(id) ?? "").includes("Type something."));
      await sendToPane(id, "Tanpa cache dulu");
      // `4` dikirim sebagai send-keys TERSENDIRI, mendahului prosanya. Fixture cuma meng-echo,
      // jadi urutan yang terbaca di pane adalah urutan yang benar-benar dikirim hanoman.
      await waitFor(() => (tmuxCapture(id) ?? "").includes("4Tanpa cache dulu"));
      killSession(id);
    });

    // Gerbang terpenting: fixture tak pernah mengisi baris 4, jadi Enter TIDAK boleh ditekan —
    // menekannya berarti memilih baris 1 dan mengulang bug ini lewat jalur baru.
    it("mengembalikan false — bukan menekan Enter — bila teks tak mendarat di kolom bebas", async () => {
      const id = "dlg-2";
      createSession("p-dlg", process.cwd(), { id, command: [FAKE_DIALOG] });
      await waitFor(() => (tmuxCapture(id) ?? "").includes("Type something."));
      expect(await sendToPane(id, "Tanpa cache dulu")).toBe(false);
      killSession(id);
    });

    // SPEC-474 · layar rekap dialog berantai adalah langkah MEKANIS: yang dikirim satu digit,
    // tanpa prosa dan tanpa Enter. Fixture cuma meng-echo, jadi yang terbaca di pane persis
    // yang benar-benar dikirim hanoman.
    it("menekan nomor Submit answers — bukan prosa — saat pane menampilkan layar rekap", async () => {
      const id = "dlg-review";
      createSession("p-dlg", process.cwd(), { id, command: [FAKE_REVIEW] });
      await waitFor(() => (tmuxCapture(id) ?? "").includes("Ready to submit your answers?"));
      // Fixture hanya meng-echo, jadi layar rekapnya tak pernah pergi → submit dilaporkan GAGAL.
      // Itu justru gerbangnya: hanoman tak boleh mengaku menutup dialog yang masih terbuka.
      expect(await sendToPane(id, "jawaban lead yang tak relevan di sini")).toBe(false);
      const pane = (tmuxCapture(id) ?? "").trimEnd();
      expect(pane).not.toContain("jawaban lead yang tak relevan");   // prosa tak pernah dikirim
      expect(pane.endsWith("1")).toBe(true);                          // yang dikirim: satu digit
      killSession(id);
    }, 15_000);

    // SPEC-474 · varian ber-preview tak punya kolom jawaban bebas; prosanya masuk lewat kolom
    // catatan, dan `n` harus dikirim sebagai keystroke tersendiri lebih dulu.
    it("membuka kolom catatan dengan `n` saat dialog tak punya kolom jawaban bebas", async () => {
      const id = "dlg-notes";
      createSession("p-dlg", process.cwd(), { id, command: [FAKE_NOTES] });
      await waitFor(() => (tmuxCapture(id) ?? "").includes("press n to add notes"));
      await sendToPane(id, "Pakai map, lebih ekspresif");
      await waitFor(() => (tmuxCapture(id) ?? "").includes("nPakai map, lebih ekspresif"));
      killSession(id);
    });

    // Kolom chat biasa TIDAK boleh ikut berubah: di sana jalur lama (prosa + Enter) adalah yang benar.
    it("pane tanpa dialog tetap menerima prosa apa adanya", async () => {
      process.env.HANOMAN_CLAUDE_BIN = FAKE_CLAUDE;
      const s = createSession("p-dlg2", process.cwd(), { id: "dlg-3" });
      await waitFor(() => (tmuxCapture(s.id) ?? "").includes("args:"));
      expect(await sendToPane(s.id, "jawaban biasa")).toBe(true);
      await waitFor(() => (tmuxCapture(s.id) ?? "").includes("jawaban biasa"));
      expect(tmuxCapture(s.id) ?? "").not.toContain("4jawaban biasa");
      killSession(s.id);
    });
  });
});
