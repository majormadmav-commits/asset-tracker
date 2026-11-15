import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function fill(width, height, paint) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y, width, height);
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

const NAVY = [0x0b, 0x0d, 0x4d, 255];
const GOLD = [0xe9, 0xa8, 0x25, 255];

function distToSeg(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy));
}

// Navy field, gold medallion, navy "A". The medallion sits inside the
// maskable safe zone (center circle, radius 40% of the icon).
function iconPixel(x, y, size) {
  const nx = (x + 0.5) / size;
  const ny = (y + 0.5) / size;
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  if (dx * dx + dy * dy > 0.3 * 0.3) return NAVY;
  const stroke = 0.026;
  const apex = [0.5, 0.375];
  const left = [0.395, 0.645];
  const right = [0.605, 0.645];
  const onLeg =
    distToSeg(nx, ny, apex[0], apex[1], left[0], left[1]) <= stroke ||
    distToSeg(nx, ny, apex[0], apex[1], right[0], right[1]) <= stroke;
  const barY = 0.53;
  const t = (barY - apex[1]) / (left[1] - apex[1]);
  const leftX = apex[0] + (left[0] - apex[0]) * t;
  const rightX = apex[0] + (right[0] - apex[0]) * t;
  const onBar = Math.abs(ny - barY) <= stroke * 0.85 && nx >= leftX && nx <= rightX;
  return onLeg || onBar ? NAVY : GOLD;
}

mkdirSync("site/icons", { recursive: true });
mkdirSync("tests/e2e/fixtures", { recursive: true });

for (const size of [180, 192, 512]) {
  const name = size === 180 ? "site/icons/apple-touch-icon.png" : `site/icons/icon-${size}.png`;
  writeFileSync(name, encodePng(size, size, fill(size, size, iconPixel)));
}
writeFileSync("site/icons/icon-maskable-512.png", encodePng(512, 512, fill(512, 512, iconPixel)));

const wideW = 2000;
const wideH = 1000;
writeFileSync(
  "tests/e2e/fixtures/wide.png",
  encodePng(
    wideW,
    wideH,
    fill(wideW, wideH, (x, y) => {
      const stripe = Math.floor(x / 100) % 2 === 0;
      return stripe ? [0xc6, 0x53, 0x1a, 255] : [0x1d, 0x1a, 0x16, 255];
    }),
  ),
);

console.log("wrote icons and tests/e2e/fixtures/wide.png");
