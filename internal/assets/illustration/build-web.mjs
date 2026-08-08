// Merakit turunan web dari master ilustrasi.
//
// Master di direktori ini adalah Source of Truth dan sengaja near-lossless (~1,5 MB per keping).
// Frontend TIDAK boleh mem-bundle-nya: `import.meta.glob` eager di
// `src/src/ds/illustration-registry.ts` menyalin apa pun yang cocok ke `src/dist/assets`, dan dari
// situ ia masuk ke tarball npm — terukur sekali: paket `hanoman` melonjak 5,5 MB → 46,1 MB semata
// karena master ikut terangkut. Karena itu registry mem-glob `web/`, bukan direktori ini.
//
// Turunan di-COMMIT, bukan dirakit saat build: `cwebp` tak ada di runner GitHub Actions yang
// menjalankan `pnpm release`. Jalankan skrip ini di mesin dev setiap master berubah, lalu commit
// hasilnya bersama masternya.
//
//   node internal/assets/illustration/build-web.mjs [--check]
//
// `--check` tak menulis apa pun; ia membandingkan `web/manifest.json` dengan hash master yang ada
// sekarang dan exit 1 bila ada yang hilang/usang. Kesegaran diukur dari HASH, bukan mtime: git tak
// mengawetkan mtime, jadi checkout segar akan selalu terbaca "usang" kalau memakai stempel waktu.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebp } from "./webp-meta.mjs";

const MAX_EDGE = 768;
const QUALITY = 78;

const root = dirname(fileURLToPath(import.meta.url));
const webDir = join(root, "web");
const manifestPath = join(webDir, "manifest.json");
const checkOnly = process.argv.includes("--check");

const inventory = JSON.parse(readFileSync(join(root, "inventory.json"), "utf8"));
const previous = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { maxEdge: null, quality: null, masters: {} };

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const settingsChanged = previous.maxEdge !== MAX_EDGE || previous.quality !== QUALITY;

function haveCwebp() {
  const probe = spawnSync("cwebp", ["-version"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function resizeArgs({ width, height }) {
  if (Math.max(width, height) <= MAX_EDGE) return [];
  return width >= height ? ["-resize", String(MAX_EDGE), "0"] : ["-resize", "0", String(MAX_EDGE)];
}

const stale = [];
const errors = [];
const masters = {};
const built = [];

if (!checkOnly) {
  if (!haveCwebp()) {
    console.error("FAIL: `cwebp` tak ditemukan. Pasang dengan `brew install webp` lalu ulangi.");
    process.exit(1);
  }
  mkdirSync(webDir, { recursive: true });
}

for (const asset of inventory) {
  const masterPath = join(root, asset.filename);
  const derivativePath = join(webDir, asset.filename);

  if (!existsSync(masterPath)) {
    errors.push(`${asset.id}: master ${asset.filename} tak ada`);
    continue;
  }

  const master = readFileSync(masterPath);
  const digest = sha256(master);
  masters[asset.filename] = digest;

  const fresh = existsSync(derivativePath)
    && !settingsChanged
    && previous.masters?.[asset.filename] === digest;
  if (fresh) continue;

  if (checkOnly) {
    stale.push(`${asset.id}: turunan web ${existsSync(derivativePath) ? "usang" : "hilang"}`);
    continue;
  }

  const result = spawnSync("cwebp", [
    "-quiet",
    "-q", String(QUALITY),
    ...resizeArgs(parseWebp(master)),
    "-metadata", "none",
    masterPath,
    "-o", derivativePath,
  ]);

  if (result.status !== 0) {
    errors.push(`${asset.id}: cwebp gagal (${result.status}) ${result.stderr?.toString().trim() ?? ""}`);
    continue;
  }

  built.push({ from: master.length, to: statSync(derivativePath).size });
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} masalah saat merakit turunan web`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(`FAIL: ${stale.length} turunan web hilang/usang — jalankan \`node internal/assets/illustration/build-web.mjs\``);
    for (const item of stale) console.error(`- ${item}`);
    process.exit(1);
  }
  console.log(`PASS: ${inventory.length}/${inventory.length} turunan web sinkron dengan masternya`);
  process.exit(0);
}

writeFileSync(manifestPath, `${JSON.stringify({ maxEdge: MAX_EDGE, quality: QUALITY, masters }, null, 2)}\n`);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const from = built.reduce((total, item) => total + item.from, 0);
const to = built.reduce((total, item) => total + item.to, 0);
console.log(
  built.length === 0
    ? `PASS: ${inventory.length}/${inventory.length} turunan web sudah mutakhir`
    : `PASS: ${built.length} turunan web dirakit — ${mb(from)} → ${mb(to)} (maks ${MAX_EDGE}px, q${QUALITY})`,
);
