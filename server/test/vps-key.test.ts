import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHanomanKey, keyDir } from "../src/services/vps-key";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "hanoman-key-")); process.env.HANOMAN_SSH_KEY_DIR = dir; });
afterEach(() => { delete process.env.HANOMAN_SSH_KEY_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("ensureHanomanKey (SPEC-165)", () => {
  it("membuat keypair ed25519 dengan mode 600, pub bertanda hanoman", () => {
    const k = ensureHanomanKey();
    expect(k.privPath).toBe(join(dir, "id_ed25519"));
    expect(k.pub).toMatch(/^ssh-ed25519 AAAA/);
    expect(k.pub).toContain("hanoman");
    expect(statSync(k.privPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(k.pubPath, "utf8").trim()).toBe(k.pub);
  });
  it("idempotent: panggilan kedua memakai key yang sama, tidak membuat ulang", () => {
    const a = ensureHanomanKey();
    const priv = readFileSync(a.privPath, "utf8");
    const b = ensureHanomanKey();
    expect(b.pub).toBe(a.pub);
    expect(readFileSync(b.privPath, "utf8")).toBe(priv);
  });
});

// SPEC-846 · identitas SSH hanoman harus hidup DI DALAM `$HANOMAN_HOME`: itulah batas
// backup/restore yang dijanjikan runbook. Sebelum ini `keyDir()` diturunkan dari `homedir()`,
// jadi backup home tak pernah memuat key-nya dan dua instance yang dipisah `HANOMAN_HOME` diam-diam
// berbagi satu identitas.
describe("keyDir mengikuti HANOMAN_HOME (SPEC-846)", () => {
  let home: string;      // HANOMAN_HOME
  let osHome: string;    // $HOME — lokasi legacy `~/.hanoman`
  let prevHome: string | undefined;

  beforeEach(() => {
    delete process.env.HANOMAN_SSH_KEY_DIR;
    home = mkdtempSync(join(tmpdir(), "hanoman-home-"));
    osHome = mkdtempSync(join(tmpdir(), "hanoman-oshome-"));
    process.env.HANOMAN_HOME = home;
    prevHome = process.env.HOME;
    process.env.HOME = osHome;
  });
  afterEach(() => {
    delete process.env.HANOMAN_HOME;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(osHome, { recursive: true, force: true });
  });

  it("key lahir di bawah HANOMAN_HOME, bukan di ~/.hanoman", () => {
    expect(keyDir()).toBe(home);
    const k = ensureHanomanKey();
    expect(k.privPath).toBe(join(home, "id_ed25519"));
    expect(existsSync(join(osHome, ".hanoman", "id_ed25519"))).toBe(false);
  });

  // Memindahkan default TANPA memungut key lama akan membuat instance yang sudah berjalan
  // melahirkan identitas baru — dan setiap VPS yang sudah di-bootstrap menolaknya diam-diam.
  it("memungut key lama di ~/.hanoman alih-alih melahirkan identitas baru", () => {
    const legacy = join(osHome, ".hanoman");
    mkdirSync(legacy, { recursive: true, mode: 0o700 });
    process.env.HANOMAN_SSH_KEY_DIR = legacy;
    const lama = ensureHanomanKey();
    delete process.env.HANOMAN_SSH_KEY_DIR;

    const baru = ensureHanomanKey();
    expect(baru.privPath).toBe(join(home, "id_ed25519"));
    expect(baru.pub).toBe(lama.pub);
    expect(statSync(baru.privPath).mode & 0o777).toBe(0o600);
    expect(existsSync(lama.privPath)).toBe(false);
    expect(existsSync(lama.pubPath)).toBe(false);
  });

  // Key kanonik yang sudah ada tak boleh ditimpa oleh sisa key lama.
  it("key kanonik menang atas key lama", () => {
    const kanonik = ensureHanomanKey();
    const legacy = join(osHome, ".hanoman");
    mkdirSync(legacy, { recursive: true, mode: 0o700 });
    writeFileSync(join(legacy, "id_ed25519"), "lama", { mode: 0o600 });
    writeFileSync(join(legacy, "id_ed25519.pub"), "ssh-ed25519 AAAAlama hanoman\n", { mode: 0o600 });
    expect(ensureHanomanKey().pub).toBe(kanonik.pub);
  });

  it("HANOMAN_SSH_KEY_DIR eksplisit tetap menang dan tak dipindah", () => {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-keydir-"));
    process.env.HANOMAN_SSH_KEY_DIR = dir;
    try {
      expect(keyDir()).toBe(dir);
      expect(ensureHanomanKey().privPath).toBe(join(dir, "id_ed25519"));
    } finally {
      delete process.env.HANOMAN_SSH_KEY_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
