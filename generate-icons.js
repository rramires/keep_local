/**
 * Generate PNG icons for KeepLocal Chrome Extension
 * Uses pure Node.js (no dependencies) to create minimal PNG files
 * Icon: Notepad emoji (📝) style — white page with blue lines on blue (#4285f4) rounded background
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, drawFunc) {
  const pixels = Buffer.alloc(width * height * 4, 0);

  drawFunc(pixels, width, height);

  // Build raw image data with filter byte per row
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // No filter
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData) >>> 0, 0);
  return Buffer.concat([len, typeB, data, crc]);
}

// CRC32 implementation
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc ^ -1;
}

function setPixel(pixels, width, x, y, r, g, b, a) {
  if (x < 0 || x >= width || y < 0) return;
  const height = pixels.length / (width * 4);
  if (y >= height) return;
  const idx = (y * width + x) * 4;
  // Alpha blend
  if (a < 255 && pixels[idx + 3] > 0) {
    const srcA = a / 255;
    const dstA = pixels[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    pixels[idx]     = Math.round((r * srcA + pixels[idx] * dstA * (1 - srcA)) / outA);
    pixels[idx + 1] = Math.round((g * srcA + pixels[idx + 1] * dstA * (1 - srcA)) / outA);
    pixels[idx + 2] = Math.round((b * srcA + pixels[idx + 2] * dstA * (1 - srcA)) / outA);
    pixels[idx + 3] = Math.round(outA * 255);
  } else {
    pixels[idx] = r;
    pixels[idx + 1] = g;
    pixels[idx + 2] = b;
    pixels[idx + 3] = a;
  }
}

function fillCircle(pixels, width, cx, cy, radius, r, g, b, a) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        setPixel(pixels, width, Math.round(cx + dx), Math.round(cy + dy), r, g, b, a);
      }
    }
  }
}

function fillRoundedRect(pixels, width, x, y, w, h, radius, r, g, b, a) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let inside = false;
      // Check corners
      if (px < x + radius && py < y + radius) {
        // top-left corner
        const dx = px - (x + radius);
        const dy = py - (y + radius);
        inside = (dx * dx + dy * dy) <= radius * radius;
      } else if (px >= x + w - radius && py < y + radius) {
        // top-right
        const dx = px - (x + w - radius - 1);
        const dy = py - (y + radius);
        inside = (dx * dx + dy * dy) <= radius * radius;
      } else if (px < x + radius && py >= y + h - radius) {
        // bottom-left
        const dx = px - (x + radius);
        const dy = py - (y + h - radius - 1);
        inside = (dx * dx + dy * dy) <= radius * radius;
      } else if (px >= x + w - radius && py >= y + h - radius) {
        // bottom-right
        const dx = px - (x + w - radius - 1);
        const dy = py - (y + h - radius - 1);
        inside = (dx * dx + dy * dy) <= radius * radius;
      } else {
        inside = true;
      }
      if (inside) {
        setPixel(pixels, width, px, py, r, g, b, a);
      }
    }
  }
}

function fillRect(pixels, width, x, y, w, h, r, g, b, a) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(pixels, width, px, py, r, g, b, a);
    }
  }
}

function drawIcon(pixels, width, height) {
  const s = width / 128; // scale factor

  // Background: Blue rounded square (#4285f4)
  const bgRadius = Math.round(24 * s);
  fillRoundedRect(pixels, width, 0, 0, width, height, bgRadius, 0x42, 0x85, 0xf4, 255);

  // Page: White rounded rectangle (slightly smaller, centered)
  const pageMargin = Math.round(24 * s);
  const pageW = width - pageMargin * 2;
  const pageH = height - pageMargin * 2;
  const pageRadius = Math.round(8 * s);
  fillRoundedRect(pixels, width, pageMargin, pageMargin, pageW, pageH, pageRadius, 255, 255, 255, 255);

  // Folded corner (top-right) — small triangle
  const foldSize = Math.round(16 * s);
  const foldX = pageMargin + pageW - foldSize;
  const foldY = pageMargin;
  // Draw fold as a colored triangle overlay
  for (let dy = 0; dy < foldSize; dy++) {
    for (let dx = foldSize - dy; dx < foldSize; dx++) {
      setPixel(pixels, width, foldX + dx, foldY + dy, 0xd0, 0xd0, 0xd0, 255);
    }
  }

  // Lines on the page (representing text)
  const lineH = Math.max(2, Math.round(3 * s));
  const lineMarginX = Math.round(34 * s);
  const lineStartY = Math.round(48 * s);
  const lineGap = Math.round(14 * s);
  const lineWidths = [0.7, 0.85, 0.6, 0.75, 0.5]; // relative widths

  for (let i = 0; i < lineWidths.length; i++) {
    const ly = lineStartY + i * lineGap;
    if (ly + lineH > pageMargin + pageH - Math.round(8 * s)) break;
    const maxLineW = width - lineMarginX - pageMargin - Math.round(10 * s);
    const lw = Math.round(maxLineW * lineWidths[i]);
    fillRect(pixels, width, lineMarginX, ly, lw, lineH, 0x42, 0x85, 0xf4, 120);
  }

  // Pencil icon (bottom-right of page) — simple diagonal line with yellow body
  const pencilLen = Math.round(20 * s);
  const pencilStartX = width - pageMargin - Math.round(12 * s);
  const pencilStartY = height - pageMargin - Math.round(12 * s);

  for (let i = 0; i < pencilLen; i++) {
    const px = pencilStartX - i;
    const py = pencilStartY - i;
    // Pencil body (yellow)
    const thickness = Math.max(2, Math.round(3 * s));
    for (let t = -thickness; t <= thickness; t++) {
      if (i < 3 * s) {
        // Tip (dark)
        setPixel(pixels, width, px + t, py, 0x33, 0x33, 0x33, 200);
      } else {
        // Body (yellow-orange)
        setPixel(pixels, width, px + t, py, 0xFB, 0xBC, 0x04, 220);
      }
    }
  }
}

// Generate icons
const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'chrome-extension', 'icons');

for (const size of sizes) {
  const png = createPNG(size, size, drawIcon);
  const outFile = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outFile, png);
  console.log(`Created ${outFile} (${png.length} bytes)`);
}

console.log('Done! Icons generated successfully.');
