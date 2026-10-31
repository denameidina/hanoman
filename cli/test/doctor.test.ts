import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_METHOD, METHODS, methodSkills, methodStatus } from "@hanoman/shared";
import { doctorReport, resolveDoctorCodexBin, resolveDoctorAntigravityBin, probeDoctorVersion } from "../src/commands/doctor";

const ok = {
  node: "v22.0.0", git: "git version 2.44.0", tmux: "tmux 3.4",
  claude: "1.0.0", codex: null, gh: null, curl: "curl 8.7.1", web: true, db: "/h/.hanoman/hanoman.db",
  // SPEC-846 · path data efektif dilaporkan satu per satu; home fatal, turunannya memperingatkan.
  dirs: [
    { label: "data dir", path: "/h/.hanoman", writable: true, fatal: true },
    { label: "transkrip", path: "/h/.hanoman/transcripts", writable: true, fatal: false },
    { label: "upload", path: "/h/.hanoman/uploads", writable: true, fatal: false },
    { label: "key SSH", path: "/h/.hanoman", writable: true, fatal: false },
  ],
  methods: [],   // SPEC-739 · kosong = tak ada metode yang dilaporkan
  podman: null, sandboxRequired: false, sandboxReady: false,
};

describe("doctorReport", () => {
  // SPEC-884 · ADR-0139 · sandbox hanya prasyarat bagi instance yang MINTA dikeraskan. Menandainya
  // ✗ fatal di laptop membuat `doctor` berkata hanoman tak bisa menjalankan sesi — padahal bisa.
  it("sandbox non-fatal saat hardening mati (SPEC-884)", () => {
    const r = doctorReport({ ...ok, podman: null, sandboxRequired: false, sandboxReady: false });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("!");
  });

  it("sandbox fatal saat hardening menyala (SPEC-884)", () => {
    const r = doctorReport({ ...ok, podman: null, sandboxRequired: true, sandboxReady: false });
    expect(r.ok).toBe(false);
  });

  it("semua ada → ok", () => {
    const r = doctorReport(ok);
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("git");
  });
  it("git absen → tidak ok", () => {
    expect(doctorReport({ ...ok, git: null }).ok).toBe(false);
  });
  it("tmux absen → tidak ok (sesi mustahil tanpa tmux)", () => {
    expect(doctorReport({ ...ok, tmux: null }).ok).toBe(false);
  });
  it("node di bawah 20 → tidak ok", () => {
    expect(doctorReport({ ...ok, node: "v18.20.0" }).ok).toBe(false);
  });
  it("kedua agen absen → tidak ok", () => {
    expect(doctorReport({ ...ok, claude: null, codex: null }).ok).toBe(false);
  });
  it("satu agen cukup", () => {
    expect(doctorReport({ ...ok, claude: null, codex: "0.146.0" }).ok).toBe(true);
  });
  it("Codex lama diperingatkan sebagai tidak mendukung custom agent native", () => {
    const r = doctorReport({ ...ok, codex: "codex-cli 0.150.0" });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/! codex .*custom agent native.*0\.151\.0/i);
  });
  it("Codex minimum terukur ditandai siap untuk custom agent native", () => {
    expect(doctorReport({ ...ok, codex: "codex-cli 0.151.0" }).lines.join("\n"))
      .toMatch(/✓ codex .*custom agent native/i);
  });
  // SPEC-846 · operator tak bisa mendefinisikan batas backup/restore bila perintah kesehatan tak
  // pernah menyebut direktori mana yang sebenarnya dipakai.
  it("setiap path data efektif tercetak", () => {
    const text = doctorReport(ok).lines.join("\n");
    for (const d of ok.dirs) expect(text).toContain(d.path);
    expect(text).toContain("transkrip");
    expect(text).toContain("upload");
    expect(text).toContain("key SSH");
  });
  it("data dir tak bisa ditulis → tidak ok", () => {
    const dirs = ok.dirs.map((d) => (d.label === "data dir" ? { ...d, writable: false } : d));
    const r = doctorReport({ ...ok, dirs });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("TAK bisa ditulis");
  });
  // Direktori turunan lahir saat dipakai; absennya izin tulis di situ adalah peringatan, bukan
  // alasan menyatakan hanoman tak bisa menjalankan sesi.
  it("direktori turunan tak bisa ditulis → peringatan, tetap ok", () => {
    const dirs = ok.dirs.map((d) => (d.label === "transkrip" ? { ...d, writable: false } : d));
    const r = doctorReport({ ...ok, dirs });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("! transkrip");
  });
  it("aset web absen → peringatan, tetap ok (API tetap jalan)", () => {
    const r = doctorReport({ ...ok, web: false });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("dashboard");
  });
  it("path db selalu dilaporkan", () => {
    expect(doctorReport(ok).lines.join("\n")).toContain("/h/.hanoman/hanoman.db");
  });
  it("public production gagal bila sandbox rootless belum siap", () => {
    expect(doctorReport({ ...ok, sandboxRequired: true, sandboxReady: false }).ok).toBe(false);
    expect(doctorReport({ ...ok, sandboxRequired: true, sandboxReady: true, podman: "podman 5" }).ok).toBe(true);
  });
  // SPEC-471 · `gh` opsional (cermin claude/codex): absen TIDAK boleh menggagalkan doctor —
  // jalur REST + GITHUB_TOKEN tetap bekerja tanpa biner itu.
  it("SPEC-471 · gh absen = baris informatif, BUKAN fatal", () => {
    const tanpa = doctorReport({ ...ok, gh: null });
    expect(tanpa.ok).toBe(true);
    expect(tanpa.lines.join("\n")).toContain("GITHUB_TOKEN");
    const dengan = doctorReport({ ...ok, gh: "gh version 2.96.0" });
    expect(dengan.ok).toBe(true);
    expect(dengan.lines.join("\n")).toContain("gh version 2.96.0");
  });

  // SPEC-950 · event sesi normal memakai spool; curl kini hanya fallback bila env spool tak ada.
  it("curl absen hanya memperingatkan fallback event, BUKAN telemetry utama", () => {
    const tanpa = doctorReport({ ...ok, curl: null });
    expect(tanpa.ok).toBe(true);
    expect(tanpa.lines.join("\n")).toContain("fallback event");
    expect(tanpa.lines.join("\n")).not.toContain("tak akan menerima pertanyaan sesi");
    expect(doctorReport({ ...ok, curl: "curl 8.7.1" }).lines.join("\n")).toContain("curl 8.7.1");
  });
});

describe("doctor Codex binary resolution", () => {
  it("uses RuntimeConfig from the effective DB before env/default", async () => {
    const reads: Array<{ dbUrl: string; key: string }> = [];
    const value = await resolveDoctorCodexBin(
      { HANOMAN_CODEX_BIN: "/env/codex" },
      "file:/state/hanoman.db",
      async (dbUrl, key) => { reads.push({ dbUrl, key }); return "/db/codex"; },
    );
    expect(value).toBe("/db/codex");
    expect(reads).toEqual([{ dbUrl: "file:/state/hanoman.db", key: "HANOMAN_CODEX_BIN" }]);
  });

  it("falls back to env/default when DB inspection is unavailable", async () => {
    await expect(resolveDoctorCodexBin(
      { HANOMAN_CODEX_BIN: "/env/codex" }, "file:/missing.db",
      async () => { throw new Error("table missing"); },
    )).resolves.toBe("/env/codex");
    await expect(resolveDoctorCodexBin({}, "file:/missing.db", async () => null))
      .resolves.toBe("codex");
  });
});

// SPEC-739 · ADR-0114 · metode default yang tak siap dilaporkan seperti aset dashboard yang
// hilang: ditandai `!`, TIDAK fatal. Skill yang kurang tak mematikan sesi — ia menghapus
// gerbang yang disebut prompt, dan itulah yang perlu terbaca operator.
describe("doctorReport · metode default (SPEC-739)", () => {
  const method = METHODS[DEFAULT_METHOD]!;

  it("tak siap → tanda `!` NON-FATAL + perintah pemasangannya", () => {
    const st = methodStatus(method, "codex", { skills: [], packages: [] });
    const r = doctorReport({ ...ok, methods: [st] });
    const text = r.lines.join("\n");
    expect(text).toContain("!");
    expect(text).toContain(DEFAULT_METHOD);
    expect(text).toContain("Codex CLI");
    expect(text).toContain(method.install.codex[0]!);
    expect(r.ok).toBe(true);   // hanoman tetap bisa menjalankan sesi
  });

  it("siap → tanda `✓`, tanpa perintah", () => {
    const st = methodStatus(method, "claude", { skills: methodSkills(method), packages: [...method.requires] });
    const r = doctorReport({ ...ok, methods: [st] });
    const text = r.lines.join("\n");
    expect(text).toContain(`✓ metode ${DEFAULT_METHOD}`);
    expect(text).not.toContain(method.install.claude[0]!);
  });

  it("tanpa metode yang dilaporkan, laporan lama tak berubah", () => {
    expect(doctorReport(ok).lines.join("\n")).not.toContain("metode ");
    expect(doctorReport(ok).ok).toBe(true);
  });
});


describe("SPEC-1442 · doctor Antigravity", () => {
  it("counts an AG-only host as ready and labels authentication manual", () => {
    const r = doctorReport({ ...ok, claude: null, codex: null, antigravity: "1.3.4" });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toMatch(/Antigravity CLI.*1\.3\.4.*manual/i);
  });
  it("never treats AG as a production sandbox runtime", () => {
    const r = doctorReport({ ...ok, claude: null, codex: null, antigravity: "1.3.4", sandboxRequired: true, sandboxReady: true });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/Antigravity.*sandbox.*belum didukung/i);
  });
  it("missing optional AG does not fail a working Claude host", () => {
    const r = doctorReport({ ...ok, antigravity: null });
    expect(r.ok).toBe(true);
    expect(r.lines.join("\n")).toContain("Antigravity CLI — tak ada");
  });
  it("method unavailability remains explicit even when native skills exist", () => {
    const m = METHODS[DEFAULT_METHOD]!;
    const st = methodStatus(m, "antigravity", { skills: methodSkills(m), packages: [...m.requires] });
    const r = doctorReport({ ...ok, antigravity: "1.3.4", methods: [st] });
    expect(r.lines.join("\n")).toContain(st.availabilityReason!);
    expect(r.lines.join("\n")).toContain("Antigravity CLI");
    expect(r.lines.join("\n")).not.toContain("— siap");
  });
  it("resolves DB before environment and falls back safely", async () => {
    const reads: string[] = [];
    expect(await resolveDoctorAntigravityBin({ HANOMAN_ANTIGRAVITY_BIN: "/env/agy" }, "file:/state/db", async (_, key) => { reads.push(key); return "/db/agy"; })).toBe("/db/agy");
    expect(reads).toEqual(["HANOMAN_ANTIGRAVITY_BIN"]);
    expect(await resolveDoctorAntigravityBin({ HANOMAN_ANTIGRAVITY_BIN: "/env/agy" }, "file:/state/db", async () => { throw new Error("unavailable"); })).toBe("/env/agy");
    expect(await resolveDoctorAntigravityBin({}, "file:/state/db", async () => null)).toBe("agy");
  });
});


describe("SPEC-1442 · real doctor child environment", () => {
  it("strips AG provider secrets from unrelated probes and bounds safe AG output", () => {
    const dir = mkdtempSync(join(tmpdir(), "h1442-doctor-"));
    const bin = join(dir, "cli with spaces");
    try {
      writeFileSync(bin, '#!/bin/sh\nif [ -n "${GEMINI_API_KEY:-}${GOOGLE_GEMINI_BASE_URL:-}" ]; then echo "credential_SENTINEL"; else echo "1.3.4"; fi\n', { mode: 0o700 });
      const env = { ...process.env, GEMINI_API_KEY: "fake", GOOGLE_GEMINI_BASE_URL: "fake" };
      expect(probeDoctorVersion(bin, ["--version"], env)).toBe("1.3.4");
      expect(probeDoctorVersion(bin, ["--version"], env, "antigravity")).toBeNull();
      writeFileSync(bin, '#!/bin/sh\nprintf "1.3.4\\n"\n', { mode: 0o700 });
      expect(probeDoctorVersion(bin, ["--version"], env, "antigravity")).toBe("1.3.4");
      expect(probeDoctorVersion(bin, ["--version"], { ...env, HANOMAN_HARDENING: "1" }, "antigravity")).toBeNull();
      writeFileSync(bin, '#!/bin/sh\nif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}${ANTHROPIC_API_KEY:-}" ]; then exit 3; else echo "1.3.4"; fi\n', { mode: 0o700 });
      expect(probeDoctorVersion(bin, ["--version"], { ...env, CLAUDE_CODE_OAUTH_TOKEN: "claude-fixture", ANTHROPIC_API_KEY: "anthropic-fixture" }, "antigravity")).toBe("1.3.4");
      expect(probeDoctorVersion(join(dir, "missing"), ["--version"], env, "antigravity")).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ADR-0233 · fase Mockup di runtime non-codex menggambar lewat codex exec — tanpa codex: peringatan, bukan fatal.
describe("doctor · fase Mockup butuh codex (ADR-0233)", () => {
  it("claude tanpa codex → peringatan `codex login`, tetap ok", () => {
    const r = doctorReport({ ...ok, codex: null });
    expect(r.lines.join("\n")).toContain("! fase Mockup di runtime non-codex butuh codex CLI yang sudah login (`codex login`)");
    expect(r.ok).toBe(true);
  });
  it("codex ada → tanpa peringatan Mockup", () => {
    expect(doctorReport({ ...ok, codex: "codex-cli 0.151.0" }).lines.join("\n")).not.toContain("fase Mockup");
  });
});
