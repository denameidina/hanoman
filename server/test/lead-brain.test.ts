import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { leadArgv, leadEnv, leadFailureReason, leadProcess, think } from "../src/services/lead/brain";

// SPEC-448 (QA) · `brain.ts` adalah titik spawn agen KEDUA di hanoman — satu-satunya di luar
// `services/pty.ts` — dan sampai spec ini ia tak punya satu pun test. Dua kegagalan yang membuat
// lead tak pernah memutuskan sekalipun di instance yang servernya jalan sebagai root hidup persis
// di celah itu:
//
//   (a) execFile memberi anak pipa stdin yang TAK PERNAH ditutup. `claude -p` membaca stdin
//       sebagai sumber prompt alternatif, jadi ia menunggu 3 detik ("Warning: no stdin data
//       received in 3s"), memakan anggaran waktu lead (SPEC-432) dan mengotori stderr — persis
//       stderr yang dipakai `think()` menyusun pesan galatnya, sehingga sebab yang sebenarnya
//       terdorong ke baris kedua.
//   (b) gerbang root claude (`IS_SANDBOX=1`) sudah dibuka SPEC-403 — tapi hanya di `pty.ts`.
//       Kedua commit itu lahir di worktree paralel di hari yang sama dan `e5c73ac` bukan leluhur
//       `a16465e`, jadi titik spawn kedua ini tak pernah mewarisinya. Di VPS (deploy-vps.md
//       menetapkan `User=root`) claude mencetak "--dangerously-skip-permissions cannot be used
//       with root/sudo privileges" lalu `process.exit(1)` — lead exit tanpa keluaran, SETIAP kali.

// SPEC-472 (QA) · lead yang GAGAL harus mengatakan kenapa. Sebelum spec ini alasannya disusun dari
// `(stderr || err.message).trim().slice(0, 500)`, dan untuk kegagalan yang paling sering terjadi di
// lapangan — kunci API ditolak 401 — ketiga bagian itu meleset sekaligus: Claude Code menaruh
// penjelasannya di **stdout** (terukur: `stderr === ""`), `err.message` `execFile` diawali SELURUH
// argv yang argumen terakhirnya adalah prompt lead (9 856 B di instance produksi), dan potongan 500
// char karena itu hanya memuat pembuka prompt. Terukur: 152 baris jejak `gagal` berturut-turut,
// semuanya sepanjang 552 char, semuanya berbunyi sama, nol informasi diagnostik.

const FAKE_AGENT = fileURLToPath(new URL("./fixtures/fake-lead-agent.sh", import.meta.url));
const FAKE_REFUSING = fileURLToPath(new URL("./fixtures/fake-lead-invalid-key.sh", import.meta.url));
chmodSync(FAKE_AGENT, 0o755);
chmodSync(FAKE_REFUSING, 0o755);

const withBin = (key: "HANOMAN_CLAUDE_BIN" | "HANOMAN_CODEX_BIN") => {
  process.env[key] = FAKE_AGENT;
};
beforeEach(() => { process.env.HANOMAN_SESSION_SANDBOX = "off"; });
afterEach(() => {
  delete process.env.HANOMAN_CLAUDE_BIN;
  delete process.env.HANOMAN_CODEX_BIN;
  delete process.env.HANOMAN_SESSION_SANDBOX;
});

describe("leadEnv · gerbang root claude (SPEC-403 di titik spawn kedua)", () => {
  it("memasang IS_SANDBOX=1 untuk claude saat uid 0", () => {
    expect(leadEnv("claude", { PATH: "/x" }, 0)).toEqual({ PATH: "/x", IS_SANDBOX: "1" });
  });

  it("tak memasang apa pun untuk claude di uid biasa", () => {
    expect(leadEnv("claude", { PATH: "/x" }, 1000)).toEqual({ PATH: "/x" });
  });

  it("tak memasang apa pun untuk codex — codex tak punya gerbang root", () => {
    expect(leadEnv("codex", { PATH: "/x" }, 0)).toEqual({ PATH: "/x" });
  });

  it("env pemanggil menang: IS_SANDBOX yang sudah ada tak ditimpa jadi berbeda", () => {
    expect(leadEnv("claude", { IS_SANDBOX: "1" }, 0)).toEqual({ IS_SANDBOX: "1" });
  });
});

describe("think · stdin ditutup, env sampai ke proses", () => {
  it("menutup stdin anak sehingga agen one-shot tak menggantung menunggu masukan", async () => {
    withBin("HANOMAN_CLAUDE_BIN");
    // Batas waktu sengaja jauh DI BAWAH 3 detik yang ditunggu claude sungguhan: pipa stdin yang
    // dibiarkan menganga membuat panggilan ini gagal "kehabisan waktu", bukan lambat-tapi-berhasil.
    const out = await think("halo", { agent: "claude", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain("stdin: EOF");
  });

  it("meneruskan gerbang root ke proses anak sesuai uid yang berlaku", async () => {
    withBin("HANOMAN_CLAUDE_BIN");
    const out = await think("halo", { agent: "claude", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain(`IS_SANDBOX=${process.getuid?.() === 0 ? "1" : ""}`);
  });

  it("sesi codex ikut menutup stdin", async () => {
    withBin("HANOMAN_CODEX_BIN");
    const out = await think("halo", { agent: "codex", model: "", effort: "", timeoutMs: 1500 });
    expect(out).toContain("stdin: EOF");
  });
});

describe("leadProcess · boundary agen one-shot", () => {
  it("production memakai Podman, mount repo read-only, dan prompt private lewat berkas", () => {
    const process = leadProcess("UNTRUSTED secret prompt", {
      agent: "claude", model: "", effort: "", cwd: "/srv/repo", timeoutMs: 1_500,
    }, {
      NODE_ENV: "production",
      HANOMAN_SESSION_SANDBOX: "podman",
      HANOMAN_AGENT_CREDENTIAL_DIR: "/srv/agent-credentials",
      HANOMAN_EGRESS_PROXY: "http://egress.internal:3128",
    });
    try {
      expect(process.file).toBe("podman");
      expect(process.args).toContain("/srv/repo:/workspace:ro");
      expect(process.args.join(" ")).not.toContain("UNTRUSTED secret prompt");
      expect(process.promptFile).toBeTruthy();
      expect(readFileSync(process.promptFile!, "utf8")).toBe("UNTRUSTED secret prompt");
      expect(statSync(process.promptFile!).mode & 0o777).toBe(0o600);
    } finally {
      process.cleanup();
    }
  });
});

describe("leadFailureReason · alasan gagal yang bisa dibaca (SPEC-472)", () => {
  const fail = (over: Partial<Parameters<typeof leadFailureReason>[2]> = {}) =>
    ({ message: "Command failed: claude -p …", code: 1, ...over }) as Parameters<typeof leadFailureReason>[2];

  it("mengambil keterangan CLI dari stdout saat stderr kosong", () => {
    const r = leadFailureReason("claude", 600_000, fail(), "Invalid API key · Fix external API key\n", "");
    expect(r).toContain("Invalid API key · Fix external API key");
  });

  // Terukur in-vivo: dengan kunci API yang ditolak, claude menaruh nasihat yang PALING berguna di
  // stderr ("ANTHROPIC_API_KEY … takes precedence over your claude.ai login · Unset it") dan
  // vonisnya di stdout ("Invalid API key"). Membuang salah satunya mengulang bug ini dalam bentuk
  // kecil, jadi keduanya disimpan — stderr dulu, karena di sanalah galat yang biasanya lebih spesifik.
  it("menyimpan KEDUA stream saat keduanya berisi, stderr lebih dulu", () => {
    const r = leadFailureReason("claude", 600_000, fail(), "Invalid API key", "⚠ ANTHROPIC_API_KEY … Unset it");
    expect(r).toContain("⚠ ANTHROPIC_API_KEY … Unset it");
    expect(r).toContain("Invalid API key");
    expect(r.indexOf("Unset it")).toBeLessThan(r.indexOf("Invalid API key"));
  });

  // Inti bugnya: `err.message` execFile = `Command failed: <bin> <argv…>`, dan argumen terakhirnya
  // adalah prompt lead. Ia tak boleh dipotong — ia tak boleh DIPAKAI.
  it("tak pernah menggemakan pesan execFile yang memuat argv (prompt hidup di sana)", () => {
    const message = `Command failed: claude -p --dangerously-skip-permissions ${"Kamu adalah **hanoman-lead**: ".repeat(200)}`;
    const r = leadFailureReason("claude", 600_000, fail({ message }), "", "");
    expect(r).not.toContain("hanoman-lead");
    expect(r).not.toContain("Command failed");
    expect(r).toContain("tanpa keluaran");
  });

  it("menyebut exit code sehingga keluar-diam pun tetap terbaca", () => {
    expect(leadFailureReason("claude", 600_000, fail({ code: 1 }), "", "")).toContain("exit 1");
  });

  it("menyebut sinyal saat anak mati karena sinyal", () => {
    const r = leadFailureReason("codex", 600_000, fail({ code: undefined, signal: "SIGKILL" }), "", "");
    expect(r).toContain("SIGKILL");
  });

  // Kegagalan spawn membawa kode string dan pesannya TIDAK memuat argv — itu satu-satunya pesan
  // execFile yang aman dipakai apa adanya.
  it("mempertahankan galat spawn yang informatif", () => {
    const r = leadFailureReason("claude", 600_000, fail({ message: "spawn claude ENOENT", code: "ENOENT" }), "", "");
    expect(r).toContain("ENOENT");
  });

  it("kehabisan waktu tetap dilaporkan sebagai kehabisan waktu", () => {
    expect(leadFailureReason("claude", 1_234, fail({ killed: true }), "", "")).toBe("lead claude kehabisan waktu 1234 ms");
  });

  // Pesan galat hidup di EKOR keluaran (cermin transcript-store, ADR-0079). Memotong kepala adalah
  // persis kesalahan yang membuat bug ini tak terbaca.
  it("menyimpan ekor keluaran panjang, bukan kepalanya", () => {
    const out = `${"x".repeat(4000)}\nAPI Error: 401 unauthorized`;
    const r = leadFailureReason("claude", 600_000, fail(), out, "");
    expect(r).toContain("API Error: 401 unauthorized");
    expect(r.length).toBeLessThan(700);
  });
});

describe("think · agen yang menolak menjawab", () => {
  it("meneruskan penolakan stdout-saja sampai ke pesan galatnya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = FAKE_REFUSING;
    await expect(think("halo", { agent: "claude", model: "", effort: "", timeoutMs: 5_000 }))
      .rejects.toThrow(/Invalid API key/);
  });
});

describe("leadArgv · bentuk argv tiap agen (tak berubah oleh SPEC-448)", () => {
  it("claude memakai -p + --dangerously-skip-permissions dan prompt positional terakhir", () => {
    expect(leadArgv({ agent: "claude", model: "claude-opus-5", effort: "xhigh", prompt: "P" }))
      .toEqual(["-p", "--model", "claude-opus-5", "--effort", "xhigh", "--dangerously-skip-permissions", "P"]);
  });

  it("codex memakai exec + bypass approvals, effort lewat -c", () => {
    expect(leadArgv({ agent: "codex", model: "gpt-5.6-sol", effort: "high", prompt: "P" }))
      .toEqual(["exec", "-m", "gpt-5.6-sol", "-c", 'model_reasoning_effort="high"',
        "--dangerously-bypass-approvals-and-sandbox", "P"]);
  });
});
