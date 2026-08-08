// Pembaca metadata WebP minimal — dipakai bersama `verify.mjs` (memeriksa master) dan
// `build-web.mjs` (memutuskan perlu-tidaknya resize). Sengaja tanpa dependency: skrip ini
// harus jalan di checkout yang belum `pnpm install`.
export function parseWebp(buffer) {
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
