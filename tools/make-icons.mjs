// Wardbook home-screen icons. Dependency-free PNG writer (no build tooling).
//
// Design: 案1「Wモノグラム」 — CEO 2026-07-29 (5案比較から選定).
//   ground : Mitsuba brand navy #14456E as the gradient midpoint
//   strokes: softened off-white, NOT pure white. CEO asked to hold the
//            ground/stroke contrast down ("もう少し押さえて"), so the mark sits
//            around 7:1 instead of the ~14:1 that pure white on deep navy gives.
//   accent : the final upstroke only, in the brand green (dark-ground token).
// Brand tokens are the正本 in 5_開発部/設計/Mitsuba_UI骨子.md (CEO 2026-07-28).
//
// Two purposes, two files each (Android crops "maskable" itself, so a
// self-drawn rounded square there would be cropped twice — that was the old
// bug, fixed 2026-07-29):
//   icon-<n>.png           purpose "any"      rounded square, transparent corners
//   icon-<n>-maskable.png  purpose "maskable" full-bleed, art inside the safe circle
//
// Edges are anti-aliased by supersampling (SS x SS samples per pixel); strokes
// come from a distance-to-segment test, which gives round caps and joins for
// free. Run: node tools/make-icons.mjs

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const outDir = path.join(process.cwd(), "icons");
fs.mkdirSync(outDir, { recursive: true });

// ---- palette -------------------------------------------------------------
const BG_TOP = [0x1a, 0x53, 0x82];    // navy, lit
const BG_BOTTOM = [0x0f, 0x3a, 0x5e]; // navy, deep  (midpoint ≈ brand #14456E)
const INK = [0xd3, 0xe0, 0xec];       // softened off-white (~7:1 on the ground)
const GREEN = [0x4f, 0xbe, 0x92];     // brand green for dark grounds

// ---- geometry (fractions of the icon side) -------------------------------
// The W as four segments. The last one is the green upstroke.
const W_WHITE = [
  [0.250, 0.293, 0.383, 0.715],
  [0.383, 0.715, 0.500, 0.480],
  [0.500, 0.480, 0.617, 0.715]
];
const W_GREEN = [0.617, 0.715, 0.750, 0.293];
const STROKE = 0.1055;          // full stroke width
const CORNER = 0.22;            // rounded-square radius for the "any" icon
// The maskable art must stay inside the centre 80% circle (r = 0.40). At scale
// 1.0 the far corner of the W sits at 0.377 — inside, with room to spare.
const SCALE_MASKABLE = 1.0;
const SCALE_ANY = 1.10;         // no crop there, so the mark can breathe less

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
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
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
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([header, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function distToSegment(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = x0 + dx * t;
  const qy = y0 + dy * t;
  return Math.hypot(px - qx, py - qy);
}

function insideRoundedSquare(x, y, r) {
  const dx = Math.min(x, 1 - x);
  const dy = Math.min(y, 1 - y);
  if (dx >= r || dy >= r) return true;
  return (dx - r) ** 2 + (dy - r) ** 2 <= r * r;
}

// Scale a segment about the centre of the icon.
function scaled(seg, k) {
  return seg.map((v) => 0.5 + (v - 0.5) * k);
}

function make(size, { maskable }) {
  const k = maskable ? SCALE_MASKABLE : SCALE_ANY;
  const half = (STROKE * k) / 2;
  const white = W_WHITE.map((s) => scaled(s, k));
  const green = scaled(W_GREEN, k);

  const SS = 4;                       // subsamples per axis
  const px = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SS);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const u = (x * SS + sx + 0.5) * step;
          const v = (y * SS + sy + 0.5) * step;
          if (!maskable && !insideRoundedSquare(u, v, CORNER)) continue;
          let color;
          if (distToSegment(u, v, green[0], green[1], green[2], green[3]) <= half) {
            color = GREEN;
          } else if (white.some((s) => distToSegment(u, v, s[0], s[1], s[2], s[3]) <= half)) {
            color = INK;
          } else {
            const t = v;              // vertical gradient
            color = [
              BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
              BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
              BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
            ];
          }
          r += color[0];
          g += color[1];
          b += color[2];
          covered += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (!covered) continue;         // fully outside the rounded square
      px[i] = Math.round(r / covered);
      px[i + 1] = Math.round(g / covered);
      px[i + 2] = Math.round(b / covered);
      px[i + 3] = Math.round((covered / (SS * SS)) * 255);
    }
  }
  return png(size, size, px);
}

// 1024 exists because the PWA splash screen blows the icon up to roughly a
// third of the screen: on a 1080p+ phone that upscaled the 512 and the dots
// showed (CEO 2026-07-29). Chrome picks the closest size, so shipping the big
// one costs nothing at home-screen size.
for (const size of [192, 512, 1024]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), make(size, { maskable: false }));
  fs.writeFileSync(path.join(outDir, `icon-${size}-maskable.png`), make(size, { maskable: true }));
  console.log(`icon-${size}.png / icon-${size}-maskable.png`);
}
