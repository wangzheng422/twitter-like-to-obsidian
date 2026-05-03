#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = path.resolve(__dirname, "../icons");
const sizes = [16, 48, 128];
const scale = 4;

function rgba(hex, alpha = 255) {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
    alpha
  ];
}

function pointInRoundedRect(x, y, rect) {
  const { left, top, right, bottom, radius } = rect;
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const intersects = ((yi > y) !== (yj > y)) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function inHeart(x, y) {
  const nx = (x - 64) / 24;
  const ny = (y - 75) / 24;
  const value = (nx * nx + ny * ny - 1) ** 3 - nx * nx * ny ** 3;
  return value <= 0;
}

function colorAt(x, y) {
  const bgRect = { left: 6, top: 6, right: 122, bottom: 122, radius: 28 };
  if (!pointInRoundedRect(x, y, bgRect)) {
    return [0, 0, 0, 0];
  }

  let color = rgba("#f8fafc");
  const innerRect = { left: 11, top: 11, right: 117, bottom: 117, radius: 23 };
  if (!pointInRoundedRect(x, y, innerRect)) {
    color = rgba("#c7d2fe");
  }

  if (pointInPolygon(x, y, [[71, 16], [105, 46], [92, 104], [55, 116], [27, 83], [40, 31]])) {
    color = rgba("#6d28d9");
  }
  if (pointInPolygon(x, y, [[71, 16], [105, 46], [64, 48], [40, 31]])) {
    color = rgba("#a78bfa");
  }
  if (pointInPolygon(x, y, [[64, 48], [92, 104], [55, 116], [27, 83]])) {
    color = rgba("#4c1d95");
  }
  if (pointInPolygon(x, y, [[40, 31], [64, 48], [27, 83]])) {
    color = rgba("#8b5cf6");
  }

  const arrowWidth = 13 / 2;
  if (
    distanceToSegment(x, y, 26, 52, 63, 52) <= arrowWidth ||
    distanceToSegment(x, y, 55, 35, 76, 52) <= arrowWidth ||
    distanceToSegment(x, y, 76, 52, 55, 69) <= arrowWidth
  ) {
    color = rgba("#0ea5e9");
  }

  if (inHeart(x, y) && y >= 57 && y <= 104) {
    color = rgba("#fff7ed");
  }
  if (inHeart(x, y) && y >= 62 && y <= 100) {
    color = rgba("#ef4444");
  }

  return color;
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(width, height, pixels) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    header,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = scale * scale;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const ux = ((x + (sx + 0.5) / scale) / size) * 128;
          const uy = ((y + (sy + 0.5) / scale) / size) * 128;
          const color = colorAt(ux, uy);
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
          sum[3] += color[3];
        }
      }
      const index = (y * size + x) * 4;
      pixels[index] = Math.round(sum[0] / samples);
      pixels[index + 1] = Math.round(sum[1] / samples);
      pixels[index + 2] = Math.round(sum[2] / samples);
      pixels[index + 3] = Math.round(sum[3] / samples);
    }
  }
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size, size, pixels));
}

sizes.forEach(render);
