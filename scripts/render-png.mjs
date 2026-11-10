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

function iconPixel(x, y, size) {
  const nx = x / size;
  const ny = y / size;
  const dx = nx - 0.5;
  const dy = ny - 0.5;
  let color = [0x1d, 0x1a, 0x16, 255];
  if (dx * dx + dy * dy < 0.36 * 0.36) color = [0xc6, 0x53, 0x1a, 255];
  const line = (y0) => ny >= y0 && ny < y0 + 0.045 && nx > 0.32 && nx < 0.68;
  if (line(0.34) || line(0.46) || line(0.58)) color = [255, 250, 243, 255];
  return color;
}

mkdirSync("site/icons", { recursive: true });
mkdirSync("tests/e2e/fixtures", { recursive: true });

for (const size of [192, 512]) {
  writeFileSync(`site/icons/icon-${size}.png`, encodePng(size, size, fill(size, size, iconPixel)));
}

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
