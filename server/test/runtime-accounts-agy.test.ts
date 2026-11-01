import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetSecretKeyCache } from "../src/services/secret-box";
import {
  activateAgyAccount, activeAgyAccount, captureActiveSlot, probeAgyLogin, readSlot, type AgyIo,
} from "../src/services/runtime-accounts/antigravity-swap";

// ADR-0234 · agy menyimpan login di Keychain ber-nama TETAP; multi-akun = menukar isi slot. Keychain &
// berkas token dipalsukan lewat `AgyIo`, slot terenkripsi ditulis ke direktori tmp sungguhan.
const blob = (email: string) => JSON.stringify({ token: { access_token: `at-${email}`, expiry: "2099-01-01T00:00:00Z" }, id_token_email: email });

let dir: string, keychain: string | null, files: Map<string, string>, live: string[];
const io = (): AgyIo => ({
  run: (args, input) => {
    if (args[0] === "find-generic-password") { if (keychain === null) throw new Error("44"); return keychain; }
    if (args[0] === "delete-generic-password") { if (keychain === null) throw new Error("44"); keychain = null; return ""; }
    if (args[0] === "-i") {
      const m = /-w '((?:[^']|'\\'')*)'/.exec(input ?? "");
      keychain = m ? m[1]!.replace(/'\\''/g, "'") : null;
      return "";
    }
    throw new Error(`tak terduga: ${args.join(" ")}`);
  },
  readFile: (p) => files.get(p) ?? null,
  writeFile: (p, s) => { files.set(p, s); },
  removeFile: (p) => { files.delete(p); },
  tokenFile: "/agy/antigravity-oauth-token",
  accountsDir: dir,
  liveAgyAccountIds: () => live,
});

const prevHome = process.env.HANOMAN_HOME;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ra-agy-"));
  process.env.HANOMAN_HOME = dir;   // kunci secret-box ikut tmp
  resetSecretKeyCache();
  keychain = blob("bawaan@x"); files = new Map(); live = [];
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HANOMAN_HOME; else process.env.HANOMAN_HOME = prevHome;
  resetSecretKeyCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("mode tukar agy", () => {
  it("awal: akun aktif = bawaan", () => { expect(activeAgyAccount(io())).toBe("default:antigravity"); });

  it("tukar ke akun baru (slot kosong): login bawaan diselamatkan ke slotnya, Keychain dikosongkan", () => {
    activateAgyAccount("a1b2c3d4", io());
    expect(readSlot("default:antigravity", io())?.keychain).toBe(blob("bawaan@x"));
    expect(keychain).toBeNull();
    expect(activeAgyAccount(io())).toBe("a1b2c3d4");
  });

  it("login akun baru lalu tukar balik: kedua login utuh", () => {
    activateAgyAccount("a1b2c3d4", io());
    keychain = blob("kantor@x");                       // operator login agy
    activateAgyAccount("default:antigravity", io());  // menangkap slot a1b2c3d4 lebih dulu
    expect(keychain).toBe(blob("bawaan@x"));
    expect(readSlot("a1b2c3d4", io())?.keychain).toBe(blob("kantor@x"));
    expect(probeAgyLogin("a1b2c3d4", io())).toEqual({ loggedIn: true, identity: { email: "kantor@x" } });
  });

  it("berkas token ikut ditukar", () => {
    files.set("/agy/antigravity-oauth-token", blob("berkas@x"));
    activateAgyAccount("a1b2c3d4", io());
    expect(files.has("/agy/antigravity-oauth-token")).toBe(false);
    activateAgyAccount("default:antigravity", io());
    expect(files.get("/agy/antigravity-oauth-token")).toBe(blob("berkas@x"));
  });

  it("ada sesi agy hidup dengan akun lain → antigravity-account-busy, tak ada yang berubah", () => {
    live = ["default:antigravity"];
    let err: unknown;
    try { activateAgyAccount("a1b2c3d4", io()); } catch (e) { err = e; }
    expect(err).toMatchObject({ code: "antigravity-account-busy", status: 409 });
    expect(keychain).toBe(blob("bawaan@x"));
    expect(activeAgyAccount(io())).toBe("default:antigravity");
  });

  it("tukar ke akun yang sudah aktif = no-op walau ada sesi hidup", () => {
    live = ["default:antigravity"];
    expect(() => activateAgyAccount("default:antigravity", io())).not.toThrow();
  });

  it("captureActiveSlot menyimpan token hasil refresh agy", () => {
    activateAgyAccount("a1b2c3d4", io());
    keychain = blob("refresh@x");
    captureActiveSlot(io());
    expect(readSlot("a1b2c3d4", io())?.keychain).toBe(blob("refresh@x"));
  });

  it("slot tersimpan terenkripsi (bukan teks polos)", () => {
    activateAgyAccount("a1b2c3d4", io());
    const raw = readFileSync(join(dir, "default", "slot.enc"), "utf8");
    expect(raw.startsWith("enc:v1:")).toBe(true);
    expect(raw).not.toContain("bawaan@x");
  });

  it("probe akun yang belum pernah login → tak login", () => {
    expect(probeAgyLogin("ffffffff", io())).toEqual({ loggedIn: false, identity: null });
  });
});
