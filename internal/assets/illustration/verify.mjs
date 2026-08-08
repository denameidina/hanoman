import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const inventory = JSON.parse(readFileSync(join(root, "inventory.json"), "utf8"));
const errors = [];

function parseWebp(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("invalid RIFF/WEBP signature");
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let alpha = false;

  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (data + size > buffer.length) throw new Error(`truncated ${type} chunk`);

    if (type === "VP8X" && size >= 10) {
      alpha ||= (buffer[data] & 0x10) !== 0;
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    } else if (type === "VP8L" && size >= 5 && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      width ||= 1 + (bits & 0x3fff);
      height ||= 1 + ((bits >>> 14) & 0x3fff);
      alpha ||= ((bits >>> 28) & 1) === 1;
    } else if (type === "VP8 " && size >= 10 && buffer[data + 3] === 0x9d && buffer[data + 4] === 0x01 && buffer[data + 5] === 0x2a) {
      width ||= buffer.readUInt16LE(data + 6) & 0x3fff;
      height ||= buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (type === "ALPH") {
      alpha = true;
    }

    offset = data + size + (size % 2);
  }

  if (width <= 0 || height <= 0) throw new Error("missing positive dimensions");
  return { width, height, alpha };
}

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
  try {
    const metadata = parseWebp(readFileSync(path));
    const expected = expectedOrientation(asset.ratio);
    const actual = orientationOf(metadata);
    if (actual !== expected) errors.push(`${asset.id}: ${actual} ${metadata.width}x${metadata.height}, expected ${expected}`);
    if (asset.transparent && !metadata.alpha) errors.push(`${asset.id}: missing alpha channel`);
  } catch (error) {
    errors.push(`${asset.id}: ${error.message}`);
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
  console.log("PASS: 41/41 catalog masters are valid WebP files");
}
