import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWebp } from "./webp-meta.mjs";

const MAX_WEB_EDGE = 768;

const root = dirname(fileURLToPath(import.meta.url));
const webDir = join(root, "web");
const inventory = JSON.parse(readFileSync(join(root, "inventory.json"), "utf8"));
const errors = [];

function expectedOrientation(ratio) {
  if (["1x1"].includes(ratio)) return "square";
  if (["4x5", "9x16"].includes(ratio)) return "portrait";
  return "landscape";
}

function orientationOf({ width, height }) {
  if (Math.abs(width - height) <= Math.max(width, height) * 0.02) return "square";
  return width > height ? "landscape" : "portrait";
}

if (inventory.length !== 41) errors.push(`inventory contains ${inventory.length} records, expected 41`);
const ids = new Set(inventory.map(({ id }) => id));
const filenames = new Set(inventory.map(({ filename }) => filename));
if (ids.size !== inventory.length) errors.push("inventory IDs are not unique");
if (filenames.size !== inventory.length) errors.push("inventory filenames are not unique");

for (const asset of inventory) {
  const path = join(root, asset.filename);
  if (!existsSync(path)) {
    errors.push(`${asset.id}: missing ${asset.filename}`);
    continue;
  }
  let master;
  try {
    master = readFileSync(path);
    const metadata = parseWebp(master);
    const expected = expectedOrientation(asset.ratio);
    const actual = orientationOf(metadata);
    if (actual !== expected) errors.push(`${asset.id}: ${actual} ${metadata.width}x${metadata.height}, expected ${expected}`);
    if (asset.transparent && !metadata.alpha) errors.push(`${asset.id}: missing alpha channel`);
  } catch (error) {
    errors.push(`${asset.id}: ${error.message}`);
    continue;
  }

  // Turunan web — inilah yang benar-benar di-bundle frontend (`build-web.mjs`). Master yang sehat
  // tapi turunannya hilang = layar kosong di dashboard, bukan cuma aset besar.
  const derivativePath = join(webDir, asset.filename);
  if (!existsSync(derivativePath)) {
    errors.push(`${asset.id}: missing web/${asset.filename} — jalankan build-web.mjs`);
    continue;
  }
  try {
    const derivative = readFileSync(derivativePath);
    const metadata = parseWebp(derivative);
    if (Math.max(metadata.width, metadata.height) > MAX_WEB_EDGE) {
      errors.push(`${asset.id}: web derivative ${metadata.width}x${metadata.height} exceeds ${MAX_WEB_EDGE}px`);
    }
    if (asset.transparent && !metadata.alpha) errors.push(`${asset.id}: web derivative lost its alpha channel`);
    if (derivative.length >= master.length) {
      errors.push(`${asset.id}: web derivative is not smaller than its master`);
    }
  } catch (error) {
    errors.push(`${asset.id}: web derivative ${error.message}`);
  }
}

for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && [".png", ".jpg", ".jpeg"].includes(extname(entry.name).toLowerCase())) {
    errors.push(`unexpected raster format: ${entry.name}`);
  }
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} illustration delivery issue(s)`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${inventory.length}/${inventory.length} catalog masters are valid WebP files, each with a web derivative`);
}
