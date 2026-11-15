import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";

const NAVY = [0x0b, 0x0d, 0x4d, 255];
const GOLD = [0xe9, 0xa8, 0x25, 255];
const PAGES = "https://majormadmav-commits.github.io/asset-tracker/";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function pngSizeAndPixel(path, x, y) {
  const buf = readFileSync(new URL(path, import.meta.url));
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(buf[24], 8);
  assert.equal(buf[25], 6);
  let offset = 8;
  const parts = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") parts.push(data);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  let src = 0;
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    const filter = raw[src];
    src += 1;
    assert.equal(filter, 0);
    rows.push(raw.subarray(src, src + stride));
    src += stride;
  }
  const i = x * 4;
  return { width, height, pixel: [rows[y][i], rows[y][i + 1], rows[y][i + 2], rows[y][i + 3]] };
}

test("manifest is installable at the GitHub Pages subpath", () => {
  const manifest = JSON.parse(read("../site/manifest.webmanifest"));
  const base = new URL("manifest.webmanifest", PAGES);
  const start = new URL(manifest.start_url, base);
  const scope = new URL(manifest.scope, base);
  const id = new URL(manifest.id, base);
  assert.equal(manifest.name, "Asset Tracker");
  assert.equal(manifest.short_name, "Asset Tracker");
  assert.equal(start.href, PAGES);
  assert.equal(scope.href, PAGES);
  assert.equal(id.href, PAGES);
  assert.ok(start.href.startsWith(scope.href));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#fafafa");
  assert.equal(manifest.theme_color, "#0b0d4d");
  assert.equal(manifest.prefer_related_applications, undefined);

  const icons = manifest.icons;
  const any192 = icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
  const any512 = icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
  const maskable = icons.find((icon) => icon.purpose === "maskable");
  assert.ok(any192);
  assert.ok(any512);
  assert.ok(maskable);
  assert.equal(maskable.sizes, "512x512");
  for (const icon of [any192, any512, maskable]) {
    assert.equal(icon.type, "image/png");
    const resolved = new URL(icon.src, base);
    assert.ok(resolved.href.startsWith(PAGES));
    assert.equal(resolved.origin, "https://majormadmav-commits.github.io");
  }
});

test("icons are opaque navy and gold at the promised sizes", () => {
  const files = [
    ["../site/icons/icon-192.png", 192],
    ["../site/icons/icon-512.png", 512],
    ["../site/icons/icon-maskable-512.png", 512],
    ["../site/icons/apple-touch-icon.png", 180],
  ];
  for (const [path, size] of files) {
    const corner = pngSizeAndPixel(path, 0, 0);
    const disc = pngSizeAndPixel(path, Math.floor(size / 2), Math.floor(size * 0.3));
    assert.equal(corner.width, size);
    assert.equal(corner.height, size);
    assert.deepEqual(corner.pixel, NAVY);
    assert.deepEqual(disc.pixel, GOLD);
    const opposite = pngSizeAndPixel(path, size - 1, size - 1);
    assert.deepEqual(opposite.pixel, NAVY);
  }
});

test("the page links the manifest and the home-screen icons", () => {
  const html = read("../site/index.html");
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#0b0d4d">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Asset Tracker">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /<link rel="icon" href="icons\/icon-192\.png"/);
});

test("the service worker does not cache the app or Google responses", () => {
  const sw = read("../site/sw.js");
  assert.match(sw, /caches\.delete/);
  assert.match(sw, /no-store/);
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(sw, /cache\.put|caches\.put|cache\.addAll|cache\.add\(|caches\.match|caches\.open/);
  assert.doesNotMatch(sw, /SHELL|index\.html|drive-store|googleapis/);
});
