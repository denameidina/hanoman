import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMultipart, receiveDownload, resolveTransferPolicy, safeFilename, secretReason, type TransferPolicy,
} from "../src/mcp/transfer";

// ADR-0183 · lapisan transfer berkas. Semuanya diuji di disk SUNGGUHAN (direktori sementara), bukan
// mock fs: yang dijaga adalah perilaku symlink/realpath, dan itu tak bisa dipalsukan.
let work: string;     // direktori kerja MCP (cwd)
let outside: string;  // di luar semua root
let tmp: string;      // pengganti os.tmpdir()
let policy: TransferPolicy;

const policyFor = (over: Partial<TransferPolicy> = {}): TransferPolicy => ({ ...policy, ...over });

beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "hnm-transfer-")));
  work = join(base, "work"); outside = join(base, "outside"); tmp = join(base, "tmp");
  for (const d of [work, outside, tmp]) mkdirSync(d);
  policy = resolveTransferPolicy([], {}, { cwd: work, home: join(base, "home"), tmp }).policy;
});
afterEach(() => { rmSync(join(work, ".."), { recursive: true, force: true }); });

const names = async (r: ReturnType<typeof buildMultipart>) => {
  const x = await r;
  if (!x.ok) throw new Error(x.message);
  return [...x.form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : (v as File).name]);
};
const fail = async (r: ReturnType<typeof buildMultipart>) => {
  const x = await r;
  if (x.ok) throw new Error("seharusnya ditolak");
  return x.message;
};
const upload = (filePath: string, over: Partial<TransferPolicy> = {}) =>
  buildMultipart(policyFor(over), { files: [{ field: "file", filePath }] });

describe("resolveTransferPolicy", () => {
  it("root default = direktori sementara MCP + cwd", () => {
    expect(policy.roots).toEqual([join(tmp, "hanoman-mcp"), work]);
    expect(policy.maxBytes).toBe(100 * 1024 * 1024);
  });

  it("cwd `/` atau $HOME TIDAK ikut jadi root — terlalu lebar", () => {
    const a = resolveTransferPolicy([], {}, { cwd: "/", home: "/home/u", tmp });
    expect(a.policy.roots).toEqual([join(tmp, "hanoman-mcp")]);
    const b = resolveTransferPolicy([], {}, { cwd: "/home/u", home: "/home/u", tmp });
    expect(b.policy.roots).toEqual([join(tmp, "hanoman-mcp")]);
  });

  it("root tambahan dari env dan --transfer-dir; akar filesystem ditolak keras", () => {
    const r = resolveTransferPolicy(["--transfer-dir", "/srv/a"], { HANOMAN_MCP_TRANSFER_DIRS: "/srv/b:/srv/c" }, { cwd: work, home: "/h", tmp });
    expect(r.policy.roots).toEqual(expect.arrayContaining(["/srv/a", "/srv/b", "/srv/c"]));
    const bad = resolveTransferPolicy([], { HANOMAN_MCP_TRANSFER_DIRS: "/" }, { cwd: work, home: "/h", tmp });
    expect(bad.problems.join()).toMatch(/akar filesystem/);
    expect(bad.policy.roots).not.toContain("/");
  });

  it("batas ukuran: env diterima, nilai sampah jatuh ke default", () => {
    expect(resolveTransferPolicy([], { HANOMAN_MCP_TRANSFER_MAX_BYTES: "4096" }, { cwd: work, home: "/h", tmp }).policy.maxBytes).toBe(4096);
    expect(resolveTransferPolicy([], { HANOMAN_MCP_TRANSFER_MAX_BYTES: "abc" }, { cwd: work, home: "/h", tmp }).policy.maxBytes).toBe(100 * 1024 * 1024);
    expect(resolveTransferPolicy([], { HANOMAN_MCP_TRANSFER_MAX_BYTES: "5" }, { cwd: work, home: "/h", tmp }).policy.maxBytes).toBe(100 * 1024 * 1024);
  });
});

describe("unggah · penilaian path", () => {
  it("berkas di dalam cwd lolos; nama & part sesuai; relatif dihitung dari cwd", async () => {
    writeFileSync(join(work, "shot.png"), "PNGDATA");
    expect(await names(upload(join(work, "shot.png")))).toEqual([["file", "shot.png"]]);
    expect(await names(upload("shot.png"))).toEqual([["file", "shot.png"]]);
  });

  it("isi benar-benar terbaca & field teks tetap di depan berkas (urutan dijaga)", async () => {
    writeFileSync(join(work, "a.txt"), "halo");
    const r = await buildMultipart(policy, { fields: [["dir", "x"], ["manifest", "[]"]], files: [{ field: "file", filePath: join(work, "a.txt"), name: "sub/a.txt" }] });
    if (!r.ok) throw new Error(r.message);
    const entries = [...r.form.entries()];
    expect(entries.map(([k]) => k)).toEqual(["dir", "manifest", "file"]);
    const f = entries[2]![1] as File;
    expect(f.name).toBe("sub/a.txt");
    expect(await f.text()).toBe("halo");
  });

  it("segmen `..` ditolak mentah-mentah, juga bila hasil akhirnya masih di dalam root", async () => {
    writeFileSync(join(work, "a.txt"), "x");
    // `join()` menormalkan `..` sebelum sampai ke kode — string mentahlah yang dikirim model.
    expect(await fail(upload(`${work}/sub/../a.txt`))).toMatch(/traversal/);
    expect(await fail(upload("../outside/x"))).toMatch(/traversal/);
    expect(await fail(upload("a.txt\0.png"))).toMatch(/karakter terlarang/);
  });

  it("berkas di luar semua root ditolak, dengan petunjuk cara mengizinkan", async () => {
    writeFileSync(join(outside, "rahasia.txt"), "x");
    const msg = await fail(upload(join(outside, "rahasia.txt")));
    expect(msg).toMatch(/di luar direktori transfer/);
    expect(msg).toMatch(/HANOMAN_MCP_TRANSFER_DIRS/);
  });

  it("symlink di dalam root yang MENUNJUK KE LUAR ditolak (realpath yang dinilai)", async () => {
    writeFileSync(join(outside, "rahasia.txt"), "x");
    symlinkSync(join(outside, "rahasia.txt"), join(work, "inocent.txt"));
    expect(await fail(upload(join(work, "inocent.txt")))).toMatch(/di luar direktori transfer/);
    symlinkSync(outside, join(work, "linkdir"));
    expect(await fail(upload(join(work, "linkdir", "rahasia.txt")))).toMatch(/di luar direktori transfer/);
  });

  it("symlink yang tetap di dalam root boleh", async () => {
    writeFileSync(join(work, "asli.txt"), "ok");
    symlinkSync(join(work, "asli.txt"), join(work, "alias.txt"));
    expect(await names(upload(join(work, "alias.txt")))).toEqual([["file", "alias.txt"]]);
  });

  it("berkas rahasia ditolak walau di dalam root: .env, kunci, direktori .ssh/.git", async () => {
    mkdirSync(join(work, ".ssh")); mkdirSync(join(work, ".git"));
    for (const p of [".env", ".env.production", "id_rsa", "server.pem", "deploy.key", ".ssh/config", ".git/config", ".npmrc"]) {
      writeFileSync(join(work, p), "x");
      expect(await fail(upload(join(work, p))), p).toMatch(/ditolak/);
    }
    writeFileSync(join(work, ".env.example"), "A=");   // templat bukan rahasia
    expect(await names(upload(join(work, ".env.example")))).toEqual([["file", ".env.example"]]);
  });

  it("root yang SENDIRI berada di bawah `.hanoman`/`.git` tidak menolak dirinya (hanya bagian di bawah root dinilai)", async () => {
    const inner = join(work, ".hanoman", "wt"); mkdirSync(inner, { recursive: true });
    writeFileSync(join(inner, "ok.txt"), "x");
    expect(await names(upload(join(inner, "ok.txt"), { roots: [inner], cwd: inner }))).toEqual([["file", "ok.txt"]]);
    expect(secretReason("/a/.hanoman/wt/ok.txt", "/a/.hanoman/wt")).toBeNull();
    expect(secretReason("/a/.hanoman/agent-token")).toMatch(/\.hanoman/);
  });

  it("direktori, berkas hilang, dan berkas melebihi batas ditolak dengan kalimat yang jelas", async () => {
    mkdirSync(join(work, "d"));
    expect(await fail(upload(join(work, "d")))).toMatch(/bukan berkas biasa/);
    expect(await fail(upload(join(work, "tidak-ada.txt")))).toMatch(/tidak ditemukan/);
    writeFileSync(join(work, "besar.bin"), Buffer.alloc(2048));
    expect(await fail(upload(join(work, "besar.bin"), { maxBytes: 1024 }))).toMatch(/melebihi batas transfer 1024/);
  });

  it("total beberapa berkas juga dibatasi, dan satu yang ditolak membatalkan SELURUH panggilan", async () => {
    writeFileSync(join(work, "a.bin"), Buffer.alloc(700)); writeFileSync(join(work, "b.bin"), Buffer.alloc(700));
    const r = await buildMultipart(policyFor({ maxBytes: 1024 }), { files: [
      { field: "file", filePath: join(work, "a.bin") }, { field: "file", filePath: join(work, "b.bin") }] });
    expect(r.ok).toBe(false);
    const r2 = await buildMultipart(policy, { files: [
      { field: "file", filePath: join(work, "a.bin") }, { field: "file", filePath: join(outside, "x") }] });
    expect(r2.ok).toBe(false);
  });
});

const dl = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
  new Response(body as BodyInit, { status: 200, headers: { "content-type": "image/png", ...headers } });
const file = (over: { savePath?: string; overwrite?: boolean } = {}) => ({ mode: "file" as const, fallbackName: "lampiran", ...over });

describe("unduh · simpan ke disk lokal", () => {
  it("default: direktori sementara MCP yang dibuat 0700; hasil path+ukuran+mime+sha256, tanpa byte", async () => {
    const r = await receiveDownload(policy, dl("ISI", { "content-disposition": 'attachment; filename="bukti.png"' }), file(), 4096);
    if (!r.ok) throw new Error(r.message);
    const b = r.body as { savedTo: string; filename: string; bytes: number; mime: string; sha256: string };
    expect(b).toMatchObject({ filename: "bukti.png", bytes: 3, mime: "image/png" });
    expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.savedTo.startsWith(join(tmp, "hanoman-mcp"))).toBe(true);
    expect(readFileSync(b.savedTo, "utf8")).toBe("ISI");
    expect(statSync(join(tmp, "hanoman-mcp")).mode & 0o077).toBe(0);
    expect(statSync(b.savedTo).mode & 0o077).toBe(0);
    expect(JSON.stringify(r.body)).not.toContain("ISI");
  });

  it("savePath di dalam root: ditulis; sudah ada → TOLAK tanpa overwrite, timpa dengan overwrite:true", async () => {
    const dest = join(work, "out.png");
    expect((await receiveDownload(policy, dl("satu"), file({ savePath: dest }), 4096)).ok).toBe(true);
    const again = await receiveDownload(policy, dl("dua"), file({ savePath: dest }), 4096);
    expect(again.ok).toBe(false);
    expect((again as { message: string }).message).toMatch(/overwrite:true/);
    expect(readFileSync(dest, "utf8")).toBe("satu");
    expect((await receiveDownload(policy, dl("dua"), file({ savePath: dest, overwrite: true }), 4096)).ok).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("dua");
    expect(readdirSync(work).filter((n) => n.endsWith(".part"))).toEqual([]);
  });

  it("savePath berupa direktori memakai nama dari server (dibersihkan)", async () => {
    const r = await receiveDownload(policy, dl("x", { "content-disposition": 'attachment; filename="../../etc/passwd"' }), file({ savePath: `${work}/` }), 4096);
    if (!r.ok) throw new Error(r.message);
    expect((r.body as { savedTo: string }).savedTo).toBe(join(work, "passwd"));
  });

  it("savePath di luar root, dengan `..`, atau di direktori rahasia ditolak", async () => {
    for (const savePath of [join(outside, "x.png"), `${work}/sub/../x.png`, join(work, ".ssh", "authorized_keys"), join(work, ".env")]) {
      mkdirSync(join(work, ".ssh"), { recursive: true });
      const r = await receiveDownload(policy, dl("x"), file({ savePath }), 4096);
      expect(r.ok, savePath).toBe(false);
    }
    expect(readdirSync(outside)).toEqual([]);
  });

  it("symlink tujuan TIDAK PERNAH ditimpa — bahkan dengan overwrite:true, dan target symlink tak tersentuh", async () => {
    writeFileSync(join(outside, "korban.txt"), "UTUH");
    symlinkSync(join(outside, "korban.txt"), join(work, "link.png"));
    const r = await receiveDownload(policy, dl("JAHAT"), file({ savePath: join(work, "link.png"), overwrite: true }), 4096);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/symlink/);
    expect(readFileSync(join(outside, "korban.txt"), "utf8")).toBe("UTUH");
  });

  it("direktori tujuan yang symlink ke luar root ditolak; direktori yang belum ada tidak dibuat", async () => {
    symlinkSync(outside, join(work, "keluar"));
    expect((await receiveDownload(policy, dl("x"), file({ savePath: join(work, "keluar", "x.png") }), 4096)).ok).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
    const r = await receiveDownload(policy, dl("x"), file({ savePath: join(work, "baru", "x.png") }), 4096);
    expect((r as { message: string }).message).toMatch(/belum ada/);
  });

  it("melebihi batas: Content-Length ditolak sebelum menulis; tanpa header dibatalkan SAAT mengalir dan berkas parsial dihapus", async () => {
    const small = policyFor({ maxBytes: 1024 });
    const head = await receiveDownload(small, dl("x", { "content-length": "99999" }), file({ savePath: join(work, "a.bin") }), 4096);
    expect((head as { message: string }).message).toMatch(/melebihi batas transfer/);
    const stream = new Response(new ReadableStream({
      start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(400)); c.close(); },
    }), { status: 200, headers: { "content-type": "application/octet-stream" } });
    const r = await receiveDownload(small, stream, file({ savePath: join(work, "b.bin") }), 4096);
    expect(r.ok).toBe(false);
    expect(readdirSync(work)).toEqual([]);
  });

  it("direktori sementara milik pengguna lain / symlink ditolak", async () => {
    const hostile = join(tmp, "hanoman-mcp");
    symlinkSync(outside, hostile);
    const r = await receiveDownload(policy, dl("x"), file(), 4096);
    expect(r.ok).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe("unduh · inline", () => {
  const txt = (s: string) => new Response(s, { status: 200, headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="QA-001.md"' } });

  it("teks kecil dikembalikan inline TANPA menyentuh disk", async () => {
    const r = await receiveDownload(policy, txt("# Laporan"), { mode: "inline", fallbackName: "x.md" }, 4096);
    expect(r).toMatchObject({ ok: true, body: { filename: "QA-001.md", mime: "text/markdown", bytes: 9, content: "# Laporan" } });
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("kebesaran → GAGAL (bukan dipotong), menunjuk tool unduh-ke-berkas", async () => {
    const r = await receiveDownload(policy, txt("x".repeat(5000)), { mode: "inline", fallbackName: "x.md" }, 1000);
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(/unduh-ke-berkas/);
  });

  it("balasan biner tak pernah inline", async () => {
    const r = await receiveDownload(policy, dl("PNG"), { mode: "inline", fallbackName: "x.md" }, 4096);
    expect(r.ok).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe("safeFilename", () => {
  it("membuang path, kontrol, dan titik di depan; mendukung filename*", () => {
    expect(safeFilename('attachment; filename="a/b/../c.png"', "f")).toBe("c.png");
    expect(safeFilename('attachment; filename="..\\..\\x.txt"', "f")).toBe("x.txt");
    expect(safeFilename("attachment; filename*=UTF-8''laporan%20QA.pdf", "f")).toBe("laporan QA.pdf");
    expect(safeFilename('attachment; filename=".bashrc"', "f")).toBe("bashrc");
    expect(safeFilename(null, "lampiran")).toBe("lampiran");
    expect(safeFilename('attachment; filename=".."', "lampiran")).toBe("lampiran");
    expect(safeFilename('attachment; filename="a\u0001b:c.txt"', "f")).toBe("a_b_c.txt");
  });

  it("nama panjang dipotong dengan ekstensi dipertahankan", () => {
    const n = safeFilename(`attachment; filename="${"a".repeat(300)}.xlsx"`, "f");
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith(".xlsx")).toBe(true);
  });
});
