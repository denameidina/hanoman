// SPEC-398 · ADR-0087 · rakit paket npm `hanoman` ke staging `dist-npm/`. Workspace TIDAK
// dipublikasikan: yang diterbitkan adalah satu paket self-contained berisi dua bundle esbuild,
// aset dashboard, dan skema+migrasi Prisma. Bagian yang bisa salah tanpa suara (daftar dependency,
// daftar berkas) dipisah ke fungsi murni supaya dijaga test.
import { join } from "node:path";

export const PKG_NAME = "hanoman";

// Trusted publishing (OIDC) memverifikasi bahwa yang mem-publish memang repo INI, dan
// provenance menyematkan asal-build. Keduanya membandingkan `repository.url` dengan repo
// pembangun **persis**, jadi nilai ini bukan metadata kosmetik: salah satu huruf → publish
// dari workflow rilis ditolak. Dipagari test karena kegagalannya hanya muncul di CI.
export const REPO_URL = "git+https://github.com/denameidina/hanoman.git";

// Wajib = seluruh `--external:` di build server, plus CLI prisma (`migrate deploy` di `hanoman
// start`) dan `pg` (`migrate-from-postgres`). Apa pun di luar daftar ini ikut dibundel esbuild.
export const RUNTIME_DEPS = [
  "fastify", "@fastify/static", "@fastify/websocket", "@fastify/cookie",
  "@prisma/client", "node-pty", "pdfkit", "sharp", "prisma", "pg",
] as const;

export const REQUIRED_ARTIFACTS = [
  "package.json", "bin/hanoman.mjs", "dist/cli.js", "dist/server.js",
  "prisma/schema.prisma", "web/index.html", "README.md", "LICENSE",
  // SPEC-489 · naskah panduan AI agent — dibaca runtime & disajikan di GET /api/agent-integration.md.
  // Tanpa gerbang ini paket bisa terbit tanpa dokumen dan endpoint-nya 404 di SETIAP instalasi npm,
  // sementara checkout dev terlihat sehat.
  "docs/agent-integration.md",
  // SPEC-883 · skrip VPS dibaca runtime oleh scriptPath(). Sebelum spec ini keempatnya TIDAK
  // ikut terpaket sementara scriptPath menjangkar ke repoRoot() — di instalasi npm marker
  // pnpm-workspace.yaml tak ada, repoRoot jatuh ke cwd, dan audit/harden/remediate melempar
  // ENOENT. Gerbang ini yang membuat kegagalan itu tak bisa terbit lagi.
  "scripts/vps/audit.sh", "scripts/vps/harden.sh",
  "scripts/vps/remediate.sh", "scripts/vps/provision.sh",
] as const;

export function packageJsonFor(version: string, deps: Record<string, string>): object {
  return {
    name: PKG_NAME,
    version,
    description: "Orchestrator + dashboard workflow docs-driven untuk sesi Claude Code / Codex",
    type: "module",
    repository: { type: "git", url: REPO_URL },
    bin: { hanoman: "bin/hanoman.mjs" },
    // `@prisma/client` dari npm adalah STUB sampai di-generate — tanpa langkah ini server mati
    // seketika dengan "@prisma/client did not initialize yet" (terukur di `npm i -g` nyata).
    // Non-fatal (`|| true`): bila npm melewati script (mis. --ignore-scripts), `hanoman start`
    // mendeteksi & menggenerate sendiri (ensurePrismaClient).
    scripts: {
      postinstall: "prisma generate --schema prisma/schema.prisma || true",
      // SPEC-403 · gerbang terakhir sebelum byte meninggalkan mesin. `hanoman@0.1.3` terbit tanpa
      // `prisma` karena `dist-npm/package.json` DIMUTASI sesudah dirakit — `npm i -g --prefix <dir>
      // <tarball>` dengan cwd di `dist-npm` menulis ulang berkas itu (terukur, bisa diulang), dan
      // smoke test itulah yang merusaknya. npm menjalankan `prepublishOnly` tepat sebelum publish,
      // jadi inilah satu-satunya lapis yang melihat isi berkas SEBENARNYA yang akan dikirim.
      prepublishOnly: "node dist/cli.js __verify",
    },
    engines: { node: ">=20" },
    files: ["bin", "dist", "web", "prisma", "docs", "scripts", "README.md", "LICENSE"],
    dependencies: deps,
    // MIT: paket ini didistribusikan publik supaya orang `npm i -g`. `UNLICENSED` berarti "tak ada
    // izin pakai" — 0.1.0 terbit dengan kontradiksi itu, dan versi terbit tak bisa diperbaiki.
    license: "MIT",
  };
}

/**
 * Memeriksa `package.json` paket hasil rakitan tepat sebelum publish. Mengembalikan daftar keluhan
 * (kosong = sehat). Hanya memeriksa yang HILANG: dependency ekstra tak pernah membuat paket mati,
 * sedangkan yang hilang membuatnya tak bisa start sama sekali — persis nasib `0.1.3` tanpa `prisma`.
 */
export function verifyPackedDeps(pkg: unknown): string[] {
  const deps = (pkg as { dependencies?: Record<string, string> })?.dependencies ?? {};
  return RUNTIME_DEPS.filter((d) => !deps[d]).map(
    (d) => `dependency wajib hilang dari package.json paket: ${d}`,
  );
}

export function copyPlan(repo: string): Array<{ from: string; to: string; dir?: boolean }> {
  return [
    { from: join(repo, "server/dist/server.js"), to: "dist/server.js" },
    { from: join(repo, "server/dist/build-info.json"), to: "dist/build-info.json" },
    { from: join(repo, "cli/dist/hanoman.js"), to: "dist/cli.js" },
    { from: join(repo, "src/dist"), to: "web", dir: true },
    { from: join(repo, "server/prisma/schema.prisma"), to: "prisma/schema.prisma" },
    { from: join(repo, "server/prisma/migrations"), to: "prisma/migrations", dir: true },
    { from: join(repo, "internal/docs/operations/npm-readme.md"), to: "README.md" },
    // SPEC-489 · dibaca runtime oleh pickGuideFile (kandidat `<pkg>/docs/…`). Bukan README:
    // README paket adalah npm-readme.md (berhadapan-MANUSIA), ini naskah berhadapan-AGEN.
    { from: join(repo, "docs/agent-integration.md"), to: "docs/agent-integration.md" },
    // SPEC-883 · skrip VPS (audit/harden/remediate/provision) dibaca runtime lewat scriptPath().
    { from: join(repo, "server/scripts/vps"), to: "scripts/vps", dir: true },
    { from: join(repo, "LICENSE"), to: "LICENSE" },
  ];
}

export const BIN_SHIM = `#!/usr/bin/env node
// SPEC-398 · shim tipis: seluruh logika ada di dist/cli.js (bundle esbuild).
import "../dist/cli.js";
`;
