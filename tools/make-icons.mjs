import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = path.join(process.cwd(), "icons");
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, rgba) {
  const header = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([header, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function drawRoundedSquare(px, size, color) {
  const radius = size * 0.22;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const inCorner = dx < radius && dy < radius;
      if (!inCorner || ((dx - radius) ** 2 + (dy - radius) ** 2 <= radius ** 2)) {
        const i = (y * size + x) * 4;
        px[i] = color[0];
        px[i + 1] = color[1];
        px[i + 2] = color[2];
        px[i + 3] = 255;
      }
    }
  }
}

function line(px, size, x0, y0, x1, y1, width, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 1.5;
  for (let i = 0; i <= steps; i += 1) {
    const t = steps ? i / steps : 0;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (let oy = -width; oy <= width; oy += 1) {
      for (let ox = -width; ox <= width; ox += 1) {
        const xx = Math.round(x + ox);
        const yy = Math.round(y + oy);
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const idx = (yy * size + xx) * 4;
        px[idx] = color[0];
        px[idx + 1] = color[1];
        px[idx + 2] = color[2];
        px[idx + 3] = 255;
      }
    }
  }
}

function make(size) {
  const px = Buffer.alloc(size * size * 4);
  drawRoundedSquare(px, size, [59, 63, 143]);
  const white = [255, 255, 255];
  const w = Math.max(4, Math.round(size * 0.045));
  line(px, size, size * 0.22, size * 0.22, size * 0.34, size * 0.78, w, white);
  line(px, size, size * 0.34, size * 0.78, size * 0.50, size * 0.42, w, white);
  line(px, size, size * 0.50, size * 0.42, size * 0.66, size * 0.78, w, white);
  line(px, size, size * 0.66, size * 0.78, size * 0.78, size * 0.22, w, white);
  return png(size, size, px);
}

fs.writeFileSync(path.join(outDir, "icon-192.png"), make(192));
fs.writeFileSync(path.join(outDir, "icon-512.png"), make(512));
