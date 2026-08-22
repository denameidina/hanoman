import { describe, it, expect } from "vitest";
import { packageJsonFor, copyPlan, RUNTIME_DEPS, REQUIRED_ARTIFACTS, PKG_NAME } from "../src/release/pack";

describe("packageJsonFor", () => {
  const pkg = packageJsonFor("1.2.3", { fastify: "^4.28.0", prisma: "^6.19.0" }) as Record<string, any>;

  it("nama & versi & bin", () => {
    expect(pkg.name).toBe(PKG_NAME);
    expect(pkg.version).toBe("1.2.3");
    expect(pkg.bin).toEqual({ hanoman: "bin/hanoman.mjs" });
  });
  it("ESM + engine node ≥20", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=20");
  });
  it("BUKAN private — paket ini memang diterbitkan", () => {
    expect(pkg.private).toBeUndefined();
  });
  it("hanya dependency yang disebutkan yang masuk", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["fastify", "prisma"]);
  });
  it("files memuat seluruh artefak runtime", () => {
    for (const f of ["bin", "dist", "web", "prisma"]) expect(pkg.files).toContain(f);
  });
  // SPEC-489 · tanpa "docs" di files, npm membuang naskah panduan dan `GET /api/agent-integration.md`
  // menjawab 404 di setiap instalasi npm — sementara di checkout dev semuanya terlihat sehat.
  it("files memuat docs (naskah panduan AI agent)", () => {
    expect(pkg.files).toContain("docs");
  });
  // Paket ini didistribusikan publik supaya orang `npm i -g` — "UNLICENSED" berarti "tak ada izin
  // pakai", yang bertentangan dengan maksudnya. 0.1.0 terbit dengan kesalahan itu; dipagari agar
  // tak terulang.
  it("berlisensi MIT, bukan UNLICENSED", () => {
    expect(pkg.license).toBe("MIT");
  });
  // Regresi: trusted publishing (OIDC) MENUNTUT `repository.url` cocok PERSIS dengan repo
  // GitHub yang membangun, dan provenance menuntut `repository` publik. Tanpa field ini
  // `npm publish` dari workflow rilis gagal — dan kegagalannya hanya muncul di CI, jauh dari
  // sini. Angka ajaib satu-satunya di paket ini, jadi ia dipagari test.
  it("membawa repository publik — wajib untuk trusted publishing & provenance", () => {
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/denameidina/hanoman.git",
    });
  });
  // Regresi: tanpa ini `npm i -g` sukses tapi server mati seketika dengan
  // "@prisma/client did not initialize yet" — client Prisma adalah kode ter-generate.
  it("postinstall men-generate Prisma client, non-fatal bila script dilewati", () => {
    expect(pkg.scripts.postinstall).toContain("prisma generate");
    expect(pkg.scripts.postinstall).toContain("prisma/schema.prisma");
    expect(pkg.scripts.postinstall).toContain("|| true");
  });
});

describe("copyPlan", () => {
  const plan = copyPlan("/repo");
  const to = plan.map((p) => p.to);

  it("membawa dua bundle, SPA, dan prisma", () => {
    expect(to).toContain("dist/server.js");
    expect(to).toContain("dist/cli.js");
    expect(to).toContain("web");
    expect(to).toContain("prisma/schema.prisma");
    expect(to).toContain("prisma/migrations");
  });
  // Berkas lisensinya harus benar-benar ikut, bukan cuma field `license` di package.json.
  it("menyalin LICENSE dari akar repo", () => {
    expect(to).toContain("LICENSE");
    expect(plan.find((p) => p.to === "LICENSE")?.from).toBe("/repo/LICENSE");
  });
  it("sumbernya di dalam repo yang diberikan", () => {
    for (const p of plan) expect(p.from.startsWith("/repo/")).toBe(true);
  });
  it("SPA & migrations disalin sebagai direktori", () => {
    expect(plan.find((p) => p.to === "web")?.dir).toBe(true);
    expect(plan.find((p) => p.to === "prisma/migrations")?.dir).toBe(true);
  });
  it("tak ada tujuan ganda", () => {
    expect(new Set(to).size).toBe(to.length);
  });
  it("menyalin naskah panduan AI agent ke root paket", () => {
    const doc = plan.find((i) => i.to === "docs/agent-integration.md");
    expect(doc).toBeDefined();
    expect(doc!.from).toBe("/repo/docs/agent-integration.md");
    expect(doc!.dir).toBeUndefined();   // berkas, bukan direktori
  });
});

describe("RUNTIME_DEPS", () => {
  it("memuat semua external esbuild server + prisma CLI + pg", () => {
    for (const d of ["fastify", "@fastify/static", "@fastify/websocket", "@fastify/cookie",
                     "@prisma/client", "node-pty", "pdfkit", "prisma", "pg"]) {
      expect(RUNTIME_DEPS).toContain(d);
    }
  });
  it("tak memuat paket workspace (semuanya sudah dibundel esbuild)", () => {
    for (const d of RUNTIME_DEPS) expect(d.startsWith("@hanoman/")).toBe(false);
  });
});

describe("REQUIRED_ARTIFACTS", () => {
  it("menuntut entry bin & index dashboard ada", () => {
    expect(REQUIRED_ARTIFACTS).toContain("bin/hanoman.mjs");
    expect(REQUIRED_ARTIFACTS).toContain("web/index.html");
    expect(REQUIRED_ARTIFACTS).toContain("prisma/schema.prisma");
  });
  it("menuntut LICENSE ada — paket publik tanpa berkas lisensi tak boleh terbit lagi", () => {
    expect(REQUIRED_ARTIFACTS).toContain("LICENSE");
  });
  // SPEC-489 · gerbang rilis: `hanoman __pack` memeriksa daftar ini sesudah menyalin. Naskah yang
  // hilang harus menggagalkan pack, bukan diam-diam terbit sebagai paket tanpa dokumentasi agen.
  it("menuntut naskah panduan AI agent ada", () => {
    expect(REQUIRED_ARTIFACTS).toContain("docs/agent-integration.md");
  });
});

// SPEC-883 · skrip VPS dibaca runtime oleh scriptPath(). Sebelum spec ini keempatnya TIDAK ikut
// terpaket sementara scriptPath menjangkar ke repoRoot() — di instalasi npm marker
// pnpm-workspace.yaml tak ada, repoRoot jatuh ke cwd, dan audit/harden/remediate melempar ENOENT.
describe("SPEC-883 · skrip VPS ikut terpaket", () => {
  it("copyPlan menyalin direktori scripts/vps", () => {
    const item = copyPlan("/repo").find((i) => i.to === "scripts/vps");
    expect(item).toBeDefined();
    expect(item!.from).toBe("/repo/server/scripts/vps");
    expect(item!.dir).toBe(true);
  });

  it("keempat skrip wajib ada di artefak", () => {
    for (const f of ["audit.sh", "harden.sh", "remediate.sh", "provision.sh"]) {
      expect(REQUIRED_ARTIFACTS).toContain(`scripts/vps/${f}`);
    }
  });
});
