import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// SPEC-851 · Gerbang provenance rilis. `release.yml` dipicu setiap tag `v*` dan satu-satunya
// gerbang terhadap SUMBER-nya adalah `tag == package.json.version` — tak ada yang memeriksa
// apakah commit yang ditag sudah masuk `main`, sementara `gh api` atas repo hidup membalas
// `rulesets: []` / `protection_rules: []` / `deployment_branch_policy: null`. Jadi mendorong tag
// = menerbitkan ke npm, dari commit mana pun. Gerbangnya hidup di skrip terpisah justru supaya
// ia bisa dipagari test di sini; kegagalannya kalau tidak hanya kelihatan di CI, jauh dari sini.
const repoRoot = resolve(__dirname, "..", "..");
const gate = join(repoRoot, "scripts", "assert-release-ancestry.sh");

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

const runGate = (cwd: string, ...args: string[]) =>
  spawnSync("bash", [gate, ...args], { cwd, encoding: "utf8" });

let upstream = "";
const temps: string[] = [];
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};

// Riwayat nyata, bukan mock: `merge-base` menjawab dari objek git, jadi hanya repo git betulan
// yang bisa membuktikan gerbangnya. `main` delapan commit, tag `vmerged` pada commit ke-6 dari
// ujung (jelas ada di main), tag `vstray` pada branch yang belum pernah merge.
beforeAll(() => {
  upstream = temp("hanoman-rel-up-");
  git(upstream, "init", "-q", "--initial-branch=main");
  git(upstream, "config", "user.email", "t@t");
  git(upstream, "config", "user.name", "t");
  for (let i = 1; i <= 8; i++) {
    writeFileSync(join(upstream, `f${i}`), `${i}\n`);
    git(upstream, "add", "-A");
    git(upstream, "commit", "-qm", `c${i}`);
  }
  git(upstream, "tag", "vmerged", git(upstream, "rev-parse", "main~5").stdout.trim());
  git(upstream, "checkout", "-qb", "feature");
  writeFileSync(join(upstream, "stray"), "x\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-qm", "bump di branch yang belum direview");
  git(upstream, "tag", "vstray");
  git(upstream, "checkout", "-q", "main");
});

afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

// Meniru `actions/checkout` pada push bertag: ia mengambil HANYA refspec tag itu, jadi
// `refs/remotes/origin/main` tak pernah lahir dan harus di-fetch sendiri.
const checkoutTag = (tag: string, opts: { full: boolean; fetchMain?: boolean }) => {
  const work = temp("hanoman-rel-wt-");
  git(work, "init", "-q", "--initial-branch=main");
  git(work, "remote", "add", "origin", upstream);
  const depth = opts.full ? [] : ["--depth", "1"];
  git(work, "fetch", "--no-tags", ...depth, "origin", `+refs/tags/${tag}:refs/tags/${tag}`);
  git(work, "checkout", "-q", `refs/tags/${tag}`);
  if (opts.fetchMain !== false) {
    git(work, "fetch", "--no-tags", ...depth, "origin", "+refs/heads/main:refs/remotes/origin/main");
  }
  return work;
};

describe("gerbang ancestry rilis", () => {
  it("commit yang sudah masuk main lulus", () => {
    const r = runGate(checkoutTag("vmerged", { full: true }), "HEAD", "origin/main");
    expect(r.stdout + r.stderr).toContain("origin/main");
    expect(r.status).toBe(0);
  });

  it("tag pada branch yang belum merge DITOLAK", () => {
    const r = runGate(checkoutTag("vstray", { full: true }), "HEAD", "origin/main");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("::error::");
  });

  // Clone dangkal menjawab SALAH satu jurusan: terukur, commit ke-6 dari ujung `main` ditolak
  // walau ia jelas ada di sana (`rev-list --count origin/main` 1 vs 8). Gerbang wajib fail closed
  // dengan alasan "riwayat tak cukup", bukan menuduh commitnya — kalau tidak, kegagalan palsu itu
  // yang akan memancing orang mencabut gerbangnya.
  it("repo dangkal ditolak sebagai riwayat tak cukup, bukan sebagai commit liar", () => {
    const r = runGate(checkoutTag("vmerged", { full: false }), "HEAD", "origin/main");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/dangkal|shallow/i);
  });

  it("ref rilis yang tak bisa di-resolve gagal tertutup", () => {
    const r = runGate(checkoutTag("vmerged", { full: true, fetchMain: false }), "HEAD", "origin/main");
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toContain("origin/main");
  });

  // `merge-base` sendiri sudah mengupas objek tag, jadi tag beranotasi lulus dengan atau tanpa
  // `^{commit}` — diverifikasi lewat mutasi. Yang dibeli `^{commit}` adalah SHA yang DILAPORKAN:
  // tanpa ia, log rilis menyebut sha objek tag dan menamainya "commit", sehingga jejak audit
  // menunjuk objek yang tak pernah ada di `main`.
  it("SHA yang dilaporkan adalah commit, bukan objek tag beranotasi", () => {
    const work = checkoutTag("vmerged", { full: true });
    git(work, "tag", "-a", "vsigned", "-m", "rilis", "HEAD");
    const commit = git(work, "rev-parse", "HEAD").stdout.trim();
    const tagObject = git(work, "rev-parse", "vsigned").stdout.trim();
    expect(tagObject).not.toBe(commit);

    const r = runGate(work, "vsigned", "origin/main");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(commit);
    expect(r.stdout).not.toContain(tagObject);
  });
});

describe("release.yml memasang gerbangnya", () => {
  const wf = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");

  // Tanpa ini checkout membawa `fetch-depth: 1` dan gerbangnya menolak rilis yang sah.
  it("checkout mengambil riwayat penuh", () => {
    expect(wf).toMatch(/actions\/checkout@v\d+\s*\n\s*with:\s*\n\s*(#[^\n]*\n\s*)*fetch-depth:\s*0/);
  });

  it("gerbang ancestry dipanggil", () => {
    expect(wf).toContain("scripts/assert-release-ancestry.sh");
    expect(wf).toContain("+refs/heads/main:refs/remotes/origin/main");
  });

  // Workflow memanggil skripnya langsung; bit exec yang hilang = setiap rilis merah.
  it("skrip gerbang dapat dieksekusi", () => {
    expect(statSync(gate).mode & 0o111).toBeGreaterThan(0);
  });

  // Acceptance criteria issue #2: gagal SEBELUM build/OIDC/publish.
  it("gerbang mendahului install, build, dan publish", () => {
    const at = wf.indexOf("scripts/assert-release-ancestry.sh");
    expect(at).toBeGreaterThan(-1);
    for (const later of ["pnpm install --frozen-lockfile", "pnpm release", "npm publish"]) {
      expect(wf.indexOf(later)).toBeGreaterThan(at);
    }
  });

  // Dua gerbang yang menjawab pertanyaan berbeda; menggabungkannya membuat salah satunya hilang
  // diam-diam saat yang lain disunting.
  it("gerbang tag == package.json.version tetap berdiri terpisah", () => {
    expect(wf).toContain("tidak cocok dengan package.json");
  });
});
