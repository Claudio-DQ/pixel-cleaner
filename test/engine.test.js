'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = [
  [20, 20, 28],
  [238, 238, 242],
  [214, 66, 66],
  [68, 178, 92],
  [62, 112, 220],
  [230, 200, 60],
  [178, 92, 200],
  [42, 190, 190],
  [230, 140, 50],
  [120, 80, 50],
  [250, 250, 250],
  [15, 15, 15],
];

function makeImage(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}

function makeIndexed(indices, alpha) {
  const out = {
    indices: Int16Array.from(indices),
    alpha: alpha ? Uint8Array.from(alpha) : new Uint8Array(indices.length),
  };
  if (!alpha) {
    for (let i = 0; i < out.indices.length; i++) {
      if (out.indices[i] >= 0) out.alpha[i] = 255;
    }
  }
  return out;
}

function makeRandomArt(width, height, seed) {
  const rng = mulberry32(seed);
  const out = makeImage(width, height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const c = PALETTE[Math.floor(rng() * PALETTE.length)];
    out.data[p] = c[0];
    out.data[p + 1] = c[1];
    out.data[p + 2] = c[2];
    out.data[p + 3] = 255;
  }
  return out;
}

function makeBlockyArt(width, height, seed, palette) {
  palette = palette || PALETTE;
  const rng = mulberry32(seed);
  const out = makeImage(width, height);
  let prev = palette[Math.floor(rng() * palette.length)];
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p += 4) {
      const roll = rng();
      let c;
      if (roll < 0.38) {
        c = prev;
      } else if (x > 0 && roll < 0.5) {
        const left = (p - 4);
        c = [out.data[left], out.data[left + 1], out.data[left + 2]];
      } else if (y > 0 && roll < 0.6) {
        const up = p - width * 4;
        c = [out.data[up], out.data[up + 1], out.data[up + 2]];
      } else {
        c = palette[Math.floor(rng() * palette.length)];
      }
      out.data[p] = c[0];
      out.data[p + 1] = c[1];
      out.data[p + 2] = c[2];
      out.data[p + 3] = 255;
      prev = c;
    }
  }
  return out;
}

function upscaleNearest(src, scale) {
  const w = src.width * scale;
  const h = src.height * scale;
  const out = makeImage(w, h);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        let di = ((y * scale + dy) * w + x * scale) * 4;
        for (let dx = 0; dx < scale; dx++, di += 4) {
          out.data[di] = src.data[si];
          out.data[di + 1] = src.data[si + 1];
          out.data[di + 2] = src.data[si + 2];
          out.data[di + 3] = src.data[si + 3];
        }
      }
    }
  }
  return out;
}

function resampleNearest(src, width, height) {
  const out = makeImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / width));
      const si = (sy * src.width + sx) * 4;
      const di = (y * width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

function resampleBilinear(src, width, height) {
  const out = makeImage(width, height);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, ((y + 0.5) * src.height) / height - 0.5);
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, ((x + 0.5) * src.width) / width - 0.5);
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = src.data[(y0 * src.width + x0) * 4 + c];
        const b = src.data[(y0 * src.width + x1) * 4 + c];
        const d = src.data[(y1 * src.width + x0) * 4 + c];
        const e = src.data[(y1 * src.width + x1) * 4 + c];
        out.data[p + c] = Math.round(
          a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty
        );
      }
      out.data[p + 3] = 255;
    }
  }
  return out;
}

function padImage(src, left, top, right, bottom, color) {
  const w = src.width + left + right;
  const h = src.height + top + bottom;
  const out = makeImage(w, h);
  const c = color || [0, 0, 0, 0];
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    out.data[p] = c[0];
    out.data[p + 1] = c[1];
    out.data[p + 2] = c[2];
    out.data[p + 3] = c[3] == null ? 255 : c[3];
  }
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const si = (y * src.width + x) * 4;
      const di = ((y + top) * w + x + left) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

function boxBlur(src, radius) {
  const w = src.width;
  const h = src.height;
  const out = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const p = (yy * w + xx) * 4;
          const alpha = src.data[p + 3];
          r += src.data[p];
          g += src.data[p + 1];
          b += src.data[p + 2];
          a += alpha;
          n++;
        }
      }
      const p = (y * w + x) * 4;
      out.data[p] = Math.round(r / n);
      out.data[p + 1] = Math.round(g / n);
      out.data[p + 2] = Math.round(b / n);
      out.data[p + 3] = Math.round(a / n);
    }
  }
  return out;
}

function addNoise(src, amplitude, seed) {
  const rng = mulberry32(seed);
  const out = makeImage(src.width, src.height, new Uint8ClampedArray(src.data));
  for (let i = 0, p = 0; i < src.width * src.height; i++, p += 4) {
    const n = (rng() * 2 - 1) * amplitude;
    out.data[p] = src.data[p] + n;
    out.data[p + 1] = src.data[p + 1] + n;
    out.data[p + 2] = src.data[p + 2] + n;
    out.data[p + 3] = src.data[p + 3];
  }
  return out;
}

function colorDistance(a, b) {
  const la = engine.rgbToOklab(a[0], a[1], a[2]);
  const bb = Array.isArray(b) ? b : [b.r, b.g, b.b];
  const lb = engine.rgbToOklab(bb[0], bb[1], bb[2]);
  return Math.sqrt(
    (la.L - lb.L) ** 2 + (la.A - lb.A) ** 2 + (la.B - lb.B) ** 2
  );
}

function cellColor(cells, x, y) {
  const p = (y * cells.width + x) * 4;
  return [cells.data[p], cells.data[p + 1], cells.data[p + 2], cells.data[p + 3]];
}

function nearestPaletteDistance(rgb, palette) {
  let best = Infinity;
  for (const c of palette) {
    best = Math.min(best, colorDistance(rgb, c));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Grid detection
// ---------------------------------------------------------------------------

test('detectGrid finds exact integer upscale factors', () => {
  const scales = [2, 3, 4, 5, 7, 8, 10, 12, 16];
  for (const scale of scales) {
    const art = makeRandomArt(20, 14, 1000 + scale);
    const img = upscaleNearest(art, scale);
    const result = engine.detectGrid(img);
    assert.equal(result.scale, scale, `scale ${scale} (got ${result.scale}, confidence ${result.confidence.toFixed(2)})`);
    assert.equal(result.offsetX, 0, `offsetX for scale ${scale}`);
    assert.equal(result.offsetY, 0, `offsetY for scale ${scale}`);
  }
});

test('detectGrid recovers scale with an offset / padding', () => {
  const art = makeRandomArt(16, 12, 4242);
  const scaled = upscaleNearest(art, 8);
  const padded = padImage(scaled, 3, 2, 5, 1, [12, 34, 56, 255]);
  const result = engine.detectGrid(padded);
  assert.equal(result.scale, 8, `confidence ${result.confidence.toFixed(2)}`);
  assert.equal(result.offsetX, 3);
  assert.equal(result.offsetY, 2);
});

test('detectGrid survives blur and noise', () => {
  const art = makeRandomArt(24, 20, 9876);
  const scaled = upscaleNearest(art, 8);
  let img = boxBlur(scaled, 2);
  img = addNoise(img, 7, 555);
  const result = engine.detectGrid(img);
  assert.equal(result.scale, 8, `confidence ${result.confidence.toFixed(2)}`);

  const cells = engine.sampleCells(img, {
    scale: result.scale,
    offsetX: result.offsetX,
    offsetY: result.offsetY,
    marginRatio: 0.25,
    binaryAlpha: true,
  });
  assert.equal(cells.width, art.width);
  assert.equal(cells.height, art.height);

  // With soft edges, the centre sample should still be close to the art.
  let total = 0;
  let worst = 0;
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const a = cellColor(art, x, y);
      const b = cellColor(cells, x, y);
      const d = colorDistance(a, b);
      total += d;
      worst = Math.max(worst, d);
    }
  }
  const mean = total / (art.width * art.height);
  assert.ok(mean < 0.035, `mean color error ${mean.toFixed(4)}, worst ${worst.toFixed(4)}`);
});

test('detectGrid keeps detailed 74x74 native images at 1x', () => {
  const images = [
    makeRandomArt(74, 74, 42),
    makeBlockyArt(74, 74, 31337),
    resampleNearest(makeBlockyArt(48, 48, 9876), 74, 74),
    resampleBilinear(makeBlockyArt(48, 48, 9876), 74, 74),
  ];
  for (let i = 0; i < images.length; i++) {
    const result = engine.detectGrid(images[i]);
    assert.equal(result.scale, 1, `image ${i} (got ${result.scale}, confidence ${result.confidence.toFixed(2)})`);
    assert.deepEqual(result.suggestions, [1], `suggestions for image ${i}`);
  }
});

test('detectGrid only suggests evidence-backed scales', () => {
  const art = makeRandomArt(20, 14, 1612);
  const img = upscaleNearest(art, 12);
  const result = engine.detectGrid(img);
  assert.equal(result.scale, 12);
  assert.ok(Array.isArray(result.suggestions));
  assert.ok(result.suggestions.length >= 2 && result.suggestions.length <= 6);
  assert.equal(result.suggestions[0], 1);
  assert.ok(result.suggestions.includes(12));
  for (const scale of result.suggestions) {
    assert.equal(12 % scale, 0, `suggested scale ${scale} should divide 12`);
  }
  for (let i = 1; i < result.suggestions.length; i++) {
    assert.ok(result.suggestions[i] > result.suggestions[i - 1], 'suggestions should be ascending');
  }
});

test('detectGrid returns 1 for a natural-looking smooth image', () => {
  const rng = mulberry32(42);
  const img = makeImage(128, 128);
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const p = (y * 128 + x) * 4;
      img.data[p] = Math.round(120 + 80 * Math.sin(x / 17) * Math.cos(y / 23));
      img.data[p + 1] = Math.round(120 + 60 * Math.sin((x + y) / 29));
      img.data[p + 2] = Math.round(120 + 70 * Math.cos(x / 13));
      img.data[p + 3] = 255;
    }
  }
  const result = engine.detectGrid(img);
  assert.equal(result.scale, 1);
  assert.ok(result.confidence < 1.6);
});

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

test('sampleCells reconstructs exact blocks', () => {
  const art = makeBlockyArt(18, 13, 31337);
  const scale = 6;
  const img = upscaleNearest(art, scale);
  const cells = engine.sampleCells(img, { scale, offsetX: 0, offsetY: 0 });
  assert.equal(cells.width, art.width);
  assert.equal(cells.height, art.height);
  assert.deepEqual(Array.from(cells.data), Array.from(art.data));
});

test('sampleCells handles offsets', () => {
  const art = makeRandomArt(10, 9, 77);
  const scale = 5;
  const img = padImage(upscaleNearest(art, scale), 2, 3, 0, 0, [0, 0, 0, 255]);
  const cells = engine.sampleCells(img, { scale, offsetX: 2, offsetY: 3 });
  assert.equal(cells.width, art.width);
  assert.equal(cells.height, art.height);
  assert.deepEqual(Array.from(cells.data), Array.from(art.data));
});

test('sampleCells binarizes alpha', () => {
  const art = makeImage(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const p = (y * 8 + x) * 4;
      const opaque = x >= 2 && x < 6 && y >= 2 && y < 6;
      art.data[p] = 220;
      art.data[p + 1] = 40;
      art.data[p + 2] = 80;
      art.data[p + 3] = opaque ? 255 : 0;
    }
  }
  const img = upscaleNearest(art, 4);
  const cells = engine.sampleCells(img, { scale: 4, alphaThreshold: 128, binaryAlpha: true });
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const c = cellColor(cells, x, y);
      const expected = x >= 2 && x < 6 && y >= 2 && y < 6 ? 255 : 0;
      assert.equal(c[3], expected, `alpha at ${x},${y}`);
    }
  }
});

test('sampleCells keeps soft alpha when requested', () => {
  const art = makeImage(4, 4);
  for (let i = 0, p = 0; i < 16; i++, p += 4) {
    art.data[p] = 200;
    art.data[p + 1] = 100;
    art.data[p + 2] = 50;
    art.data[p + 3] = i < 8 ? 64 : 200;
  }
  const img = upscaleNearest(art, 5);
  const cells = engine.sampleCells(img, { scale: 5, binaryAlpha: false });
  assert.equal(cellColor(cells, 0, 0)[3], 64);
  assert.equal(cellColor(cells, 0, 3)[3], 200);
});

// ---------------------------------------------------------------------------
// Palette quantization
// ---------------------------------------------------------------------------

test('quantize (manual) recovers a clean palette from soft edges', () => {
  const base = PALETTE.slice(0, 8);
  const art = makeBlockyArt(24, 24, 2024, base);
  let img = upscaleNearest(art, 10);
  img = boxBlur(img, 2);
  img = addNoise(img, 5, 99);
  const cells = engine.sampleCells(img, { scale: 10, marginRatio: 0.25 });
  const q = engine.quantize(cells, { mode: 'manual', colors: 8 });

  assert.ok(q.palette.length <= 8);
  let total = 0;
  for (let i = 0, p = 0; i < cells.width * cells.height; i++, p += 4) {
    total += nearestPaletteDistance(
      [cells.data[p], cells.data[p + 1], cells.data[p + 2]],
      q.palette
    );
  }
  const mean = total / (cells.width * cells.height);
  assert.ok(mean < 0.04, `mean quantization error ${mean.toFixed(4)}`);
});

test('quantize (auto) collapses near-duplicate shades', () => {
  const base = [
    [210, 60, 60],
    [60, 180, 90],
    [60, 100, 220],
    [230, 200, 70],
  ];
  const width = 30;
  const height = 30;
  const rng = mulberry32(808);
  const cells = makeImage(width, height);
  for (let y = 0, p = 0; y < height; y++) {
    for (let x = 0; x < width; x++, p += 4) {
      const c = base[Math.floor(x / 8) % base.length];
      const jitter = Math.round((rng() * 2 - 1) * 7);
      cells.data[p] = c[0] + jitter;
      cells.data[p + 1] = c[1] + jitter;
      cells.data[p + 2] = c[2] + jitter;
      cells.data[p + 3] = 255;
    }
  }
  const q = engine.quantize(cells, {
    mode: 'auto',
    mergeThreshold: 0.05,
    maxAutoColors: 32,
  });
  assert.ok(q.palette.length >= 3 && q.palette.length <= 6, `palette ${q.palette.length}`);
});

test('quantize keeps transparency', () => {
  const cells = makeImage(4, 4);
  for (let i = 0, p = 0; i < 16; i++, p += 4) {
    cells.data[p] = 100;
    cells.data[p + 1] = 150;
    cells.data[p + 2] = 200;
    cells.data[p + 3] = 255;
  }
  // Pixel #5 is transparent.
  cells.data[5 * 4 + 3] = 0;
  const q = engine.quantize(cells, { mode: 'manual', colors: 4 });
  assert.deepEqual(Array.from(q.indices), [0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const composed = engine.composeImageData(q.indices, q.palette, 4, 4, q.alpha);
  assert.equal(composed.data[5 * 4 + 3], 0);
  assert.equal(composed.data[0 * 4 + 3], 255);
});

// ---------------------------------------------------------------------------
// Despeckle / compose / upscale
// ---------------------------------------------------------------------------

test('despeckle removes isolated pixels and keeps lines', () => {
  const w = 9;
  const h = 9;
  const idx = new Int16Array(w * h);
  idx.fill(0);
  idx[4 * w + 4] = 1; // isolated pixel
  idx[2 * w + 2] = 1; // vertical line of three
  idx[3 * w + 2] = 1;
  idx[4 * w + 2] = 1;

  const out = engine.despeckle(idx, w, h, 1);
  assert.equal(out[4 * w + 4], 0);
  assert.equal(out[2 * w + 2], 1);
  assert.equal(out[3 * w + 2], 1);
  assert.equal(out[4 * w + 2], 1);
});

test('despeckle removes an isolated opaque pixel in transparency', () => {
  const w = 7;
  const h = 7;
  const idx = new Int16Array(w * h);
  idx.fill(-1);
  idx[3 * w + 3] = 0;
  const out = engine.despeckle(idx, w, h, 1);
  assert.equal(out[3 * w + 3], -1);
});

test('despeckle strong removes pairs but keeps larger shapes', () => {
  const w = 9;
  const h = 9;
  const idx = new Int16Array(w * h);
  idx[2 * w + 2] = 1;
  idx[2 * w + 3] = 1; // 2px speck
  idx[6 * w + 5] = 2;
  idx[6 * w + 6] = 2;
  idx[6 * w + 7] = 2; // 3px line, must survive
  const out = engine.despeckle(idx, w, h, 2);
  assert.equal(out[2 * w + 2], 0);
  assert.equal(out[2 * w + 3], 0);
  assert.equal(out[6 * w + 5], 2);
  assert.equal(out[6 * w + 6], 2);
  assert.equal(out[6 * w + 7], 2);
});

test('rgbToHsl and hslToRgb round-trip primary colors', () => {
  const red = engine.rgbToHsl(255, 0, 0);
  assert.equal(Math.round(red.h), 0);
  assert.equal(Math.round(red.s), 100);
  assert.equal(Math.round(red.l), 50);

  const blue = engine.rgbToHsl(0, 0, 255);
  assert.equal(Math.round(blue.h), 240);
  assert.deepEqual(engine.hslToRgb(blue.h, blue.s, blue.l), { r: 0, g: 0, b: 255 });

  const green = engine.hslToRgb(120, 100, 50);
  assert.deepEqual(green, { r: 0, g: 255, b: 0 });

  const white = engine.rgbToHsl(255, 255, 255);
  assert.equal(Math.round(white.s), 0);
  assert.equal(Math.round(white.l), 100);
  assert.deepEqual(engine.hslToRgb(0, 0, 100), { r: 255, g: 255, b: 255 });
});

test('rgbToHsl round-trips arbitrary colors within one channel step', () => {
  const colors = [
    [45, 34, 66],
    [224, 122, 95],
    [134, 239, 172],
    [18, 52, 86],
    [250, 240, 120],
  ];
  for (const [r, g, b] of colors) {
    const hsl = engine.rgbToHsl(r, g, b);
    const out = engine.hslToRgb(hsl.h, hsl.s, hsl.l);
    assert.ok(Math.abs(out.r - r) <= 1, `red ${out.r} vs ${r}`);
    assert.ok(Math.abs(out.g - g) <= 1, `green ${out.g} vs ${g}`);
    assert.ok(Math.abs(out.b - b) <= 1, `blue ${out.b} vs ${b}`);
  }
});

test('compactPalette drops unused entries and sorts by usage', () => {
  const idx = new Int16Array([0, 1, 1, 2, 2, 2]);
  const palette = [
    { r: 255, g: 0, b: 0, count: 1 },
    { r: 0, g: 255, b: 0, count: 2 },
    { r: 0, g: 0, b: 255, count: 3 },
  ];
  const out = engine.compactPalette(idx, palette);
  assert.deepEqual(Array.from(out.indices), [2, 1, 1, 0, 0, 0]);
  assert.equal(out.palette.length, 3);
  assert.equal(out.palette[0].hex, '#0000ff');
  assert.equal(out.palette[0].count, 3);
  assert.equal(out.palette[2].count, 1);
});

test('upscaleImageData creates hard pixel blocks', () => {
  const img = makeImage(2, 2, new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]));
  const up = engine.upscaleImageData(img, 3);
  assert.equal(up.width, 6);
  assert.equal(up.height, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const expected = x < 3 ? (y < 3 ? [255, 0, 0] : [0, 0, 255]) : (y < 3 ? [0, 255, 0] : [255, 255, 0]);
      const p = (y * 6 + x) * 4;
      assert.deepEqual([up.data[p], up.data[p + 1], up.data[p + 2]], expected);
    }
  }
});

test('resizeImageDataNearest keeps hard pixels when scaling up or down', () => {
  const img = makeImage(2, 2, new Uint8ClampedArray([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 0, 255,
  ]));
  const up = engine.resizeImageDataNearest(img, 6, 6);
  assert.equal(up.width, 6);
  assert.equal(up.height, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const expected = x < 3 ? (y < 3 ? [255, 0, 0] : [0, 0, 255]) : (y < 3 ? [0, 255, 0] : [255, 255, 0]);
      const p = (y * 6 + x) * 4;
      assert.deepEqual([up.data[p], up.data[p + 1], up.data[p + 2], up.data[p + 3]], [...expected, 255]);
    }
  }

  const half = engine.resizeImageDataNearest(up, 3, 3);
  assert.equal(half.width, 3);
  assert.equal(half.height, 3);
  const centre = (1 * 3 + 1) * 4;
  assert.deepEqual(Array.from(half.data.slice(centre, centre + 4)), [255, 255, 0, 255]);

  const down = engine.resizeImageDataNearest(img, 1, 1);
  assert.equal(down.width, 1);
  assert.equal(down.height, 1);
  assert.deepEqual(Array.from(down.data), [255, 255, 0, 255]);
});

// ---------------------------------------------------------------------------
// Pixel-art diagnostics
// ---------------------------------------------------------------------------

function gridFromRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const indices = new Int16Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '#') indices[y * width + x] = 0;
    }
  }
  return { width, height, indices };
}

function gridFromColumns(width, height, columns) {
  const indices = new Int16Array(width * height).fill(-1);
  columns.forEach(([x, y0, y1]) => {
    for (let y = y0; y <= y1; y++) indices[y * width + x] = 0;
  });
  return { width, height, indices };
}

function maskPixels(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

function paletteOf(colors) {
  return colors.map(([r, g, b]) => ({ r, g, b }));
}

test('lintPixelArt leaves a clean 1px diagonal alone', () => {
  const g = gridFromRows([
    '#.........',
    '.#........',
    '..#.......',
    '...#......',
    '....#.....',
    '.....#....',
    '......#...',
    '.......#..',
    '........#.',
    '.........#',
  ]);
  const before = Array.from(g.indices);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(maskPixels(lint.doubles), 0);
  assert.equal(maskPixels(lint.jaggies), 0);
  assert.equal(maskPixels(lint.lines), 0);
  assert.equal(lint.patterns.perfect, 1);
  assert.equal(lint.patterns.irregular, 0);
  assert.equal(lint.patterns.perfectRatio, 1);
  assert.equal(lint.skipped, false);
  assert.deepEqual(Array.from(g.indices), before);
});

test('lintPixelArt finds double Z joints and counts grouped hotspots', () => {
  const g = gridFromRows([
    '#####.....',
    '....#####.',
    '........##',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.equal(lint.counts.doubles, 2);
  assert.equal(maskPixels(lint.doubles), 4);
  assert.deepEqual(lint.counts.jaggies, 0);
  assert.deepEqual(lint.counts.lines, 0);
});

test('lintPixelArt ignores Z edges on filled 2px-thick colour bands', () => {
  const g = gridFromRows([
    '##.....',
    '###....',
    '..###..',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(maskPixels(lint.doubles), 0);
});

test('lintPixelArt does not chain lines through filled 2px-wide bars', () => {
  const g = gridFromRows([
    '.....',
    '.##..',
    '.##..',
    '.##..',
    '.##..',
    '#....',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.total, 0);
  assert.equal(maskPixels(lint.patterns.mask), 0);
});

test('lintPixelArt ignores thick strokes and solid fills', () => {
  const g = gridFromRows([
    '##########',
    '##########',
    '##########',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.total, 0);
  assert.equal(lint.patterns.perfectRatio, null);
});

test('lintPixelArt flags a one-pixel rhythm break as a jaggy', () => {
  const g = gridFromColumns(5, 11, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 6], // one pixel longer than its 2px neighbours
    [3, 7, 8],
    [4, 9, 10],
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.equal(lint.counts.jaggies, 1);
  assert.equal(lint.counts.lines, 0);
  assert.equal(maskPixels(lint.jaggies), 3);
  assert.equal(lint.counts.doubles, 0);
});

test('lintPixelArt flags larger rhythm breaks as irregular lines', () => {
  const g = gridFromColumns(5, 12, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 7], // two pixels longer than its neighbours
    [3, 8, 9],
    [4, 10, 11],
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.equal(lint.counts.lines, 1);
  assert.equal(lint.counts.jaggies, 0);
  assert.equal(maskPixels(lint.lines), 4);
  assert.equal(lint.counts.doubles, 0);
});

test('lintPixelArt accepts alternating 2/3 segment rhythms', () => {
  const g = gridFromColumns(5, 12, [
    [0, 0, 1],
    [1, 2, 4],
    [2, 5, 6],
    [3, 7, 9],
    [4, 10, 11],
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.intermediate, 1);
  assert.equal(lint.patterns.perfect, 0);
  assert.equal(lint.patterns.irregular, 0);
  assert.equal(lint.patterns.perfectRatio, 0);
});

test('lintPixelArt accepts alternating 2/1 segment rhythms without false doubles', () => {
  const g = gridFromRows([
    '##....',
    '.#....',
    '..##..',
    '...#..',
    '....##',
    '.....#',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.intermediate, 1);
  assert.equal(lint.patterns.irregular, 0);
  assert.equal(lint.patterns.perfectRatio, 0);
});

test('lintPixelArt classifies 2:1 and 1:2 perfect lines without false doubles', () => {
  const shallow = gridFromRows([
    '##........',
    '.##.......',
    '..##......',
    '...##.....',
    '....##....',
    '.....##...',
  ]);
  const shallowLint = engine.lintPixelArt(shallow.indices, shallow.width, shallow.height);
  assert.equal(shallowLint.counts.doubles, 0);
  assert.equal(shallowLint.patterns.perfect, 1);
  assert.equal(shallowLint.patterns.intermediate, 0);
  assert.equal(shallowLint.patterns.irregular, 0);
  assert.equal(shallowLint.patterns.perfectRatio, 1);

  const steep = gridFromRows([
    '#.....',
    '#.....',
    '.#....',
    '.#....',
    '..#...',
    '..#...',
    '...#..',
    '...#..',
  ]);
  const steepLint = engine.lintPixelArt(steep.indices, steep.width, steep.height);
  assert.equal(steepLint.counts.doubles, 0);
  assert.equal(steepLint.patterns.perfect, 1);
  assert.equal(steepLint.patterns.irregular, 0);
});

test('lintPixelArt counts horizontal and vertical lines as perfect', () => {
  const horizontal = gridFromRows([
    '..........',
    '..........',
    '##########',
    '..........',
    '..........',
  ]);
  const horizontalLint = engine.lintPixelArt(
    horizontal.indices,
    horizontal.width,
    horizontal.height
  );
  assert.equal(horizontalLint.patterns.perfect, 1);
  assert.equal(horizontalLint.patterns.irregular, 0);

  const vertical = gridFromRows([
    '..#..',
    '..#..',
    '..#..',
    '..#..',
    '..#..',
  ]);
  const verticalLint = engine.lintPixelArt(vertical.indices, vertical.width, vertical.height);
  assert.equal(verticalLint.patterns.perfect, 1);
  assert.equal(verticalLint.patterns.irregular, 0);
});

test('lintPixelArt reports regular non-perfect slopes as intermediate', () => {
  const g = gridFromRows([
    '###.......',
    '...###....',
    '......###.',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.equal(lint.patterns.intermediate, 1);
  assert.equal(lint.patterns.perfect, 0);
  assert.equal(lint.patterns.irregular, 0);
});

test('lintPixelArt follows progressive curves without flagging them', () => {
  const g = gridFromRows([
    '................',
    '.....######.....',
    '...##......##...',
    '..#..........#..',
    '.#............#.',
    '.#............#.',
    '#..............#',
    '#..............#',
    '#..............#',
    '#..............#',
    '.#............#.',
    '.#............#.',
    '..#..........#..',
    '...##......##...',
    '.....######.....',
    '................',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.irregular, 0);
  assert.equal(maskPixels(lint.patterns.mask), 0);
  assert.ok(lint.patterns.curves >= 4);
  assert.equal(lint.patterns.perfect, 4);
});

test('lintPixelArt marks irregular line patterns', () => {
  const g = gridFromRows([
    '#...',
    '.#..',
    '..##',
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.irregular, 1);
  assert.equal(lint.patterns.total, 1);
  assert.equal(maskPixels(lint.patterns.mask), 4);
  assert.equal(lint.patterns.perfectRatio, 0);
});

test('lintPixelArt does not double-report rhythm breaks already flagged as jaggies', () => {
  const g = gridFromColumns(5, 11, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 6], // rhythm break
    [3, 7, 8],
    [4, 9, 10],
  ]);
  const lint = engine.lintPixelArt(g.indices, g.width, g.height);
  assert.equal(lint.counts.jaggies, 1);
  assert.equal(lint.patterns.irregular, 0);
  assert.equal(maskPixels(lint.patterns.mask), 0);
});

test('lintPixelArt skips oversized grids and reports the cap', () => {
  const indices = new Int16Array(25);
  const lint = engine.lintPixelArt(indices, 5, 5, { maxPixels: 24 });
  assert.equal(lint.skipped, true);
  assert.deepEqual(lint.counts, { doubles: 0, jaggies: 0, lines: 0 });
  assert.equal(lint.patterns.skipped, true);
  assert.equal(lint.patterns.total, 0);
  assert.equal(lint.patterns.mask.length, 25);
  assert.equal(lint.doubles.length, 25);
  assert.ok(engine.LINT_MAX_PIXELS >= 250000);
});

test('analyzePalette summarizes HSL hue and lightness levels', () => {
  const palette = paletteOf([
    [255, 0, 0],
    [0, 128, 0],
    [255, 255, 255],
  ]);
  const indices = Int16Array.from([0, 1, 2]);
  const p = engine.analyzePalette(indices, 3, 1, palette);

  assert.equal(p.skipped, false);
  assert.equal(p.colors, 3);
  assert.equal(p.hues, 2);
  assert.equal(p.valueBins, 3);
  assert.equal(p.saturation.min, 0);
  assert.equal(p.saturation.max, 100);
  assert.ok(p.lightness.spread > 70);
  assert.equal(p.contrast.edges, 2);
  assert.equal(p.contrast.lowPairs, 0);
  assert.equal(p.contrast.score, 1);
  assert.equal(p.nearDuplicateCount, 0);
});

test('analyzePalette flags near-duplicate palette colours', () => {
  const palette = paletteOf([
    [128, 128, 128],
    [138, 138, 138],
    [255, 0, 0],
  ]);
  const p = engine.analyzePalette(Int16Array.from([0, 1, 2]), 3, 1, palette);

  assert.equal(p.nearDuplicateCount, 1);
  assert.equal(p.nearDuplicates.length, 1);
  assert.equal(p.nearDuplicates[0].a, 0);
  assert.equal(p.nearDuplicates[0].b, 1);
  assert.ok(p.nearDuplicates[0].distance < 0.04);
});

test('groupSimilarColors groups near-duplicate palette entries', () => {
  const palette = paletteOf([
    [128, 128, 128],
    [138, 138, 138],
    [255, 0, 0],
    [252, 2, 2],
    [0, 0, 255],
  ]);
  const groups = engine.groupSimilarColors(palette, { threshold: 0.04 });

  assert.equal(groups.count, 3);
  assert.deepEqual(groups.groups[0], [0, 1]);
  assert.deepEqual(groups.groups[1], [2, 3]);
  assert.deepEqual(groups.groups[2], [4]);
  assert.equal(groups.groupOf[0], groups.groupOf[1]);
  assert.notEqual(groups.groupOf[1], groups.groupOf[2]);
  assert.equal(groups.threshold, 0.04);
});

test('groupSimilarColors supports transitive groups and exact matching', () => {
  const palette = paletteOf([
    [120, 120, 120],
    [124, 124, 124],
    [128, 128, 128],
  ]);
  const chain = engine.groupSimilarColors(palette, { threshold: 0.02 });
  assert.equal(chain.count, 1);
  assert.deepEqual(chain.groups[0], [0, 1, 2]);

  const exact = engine.groupSimilarColors(palette, { threshold: 0 });
  assert.equal(exact.count, 3);
  assert.deepEqual(exact.groups, [[0], [1], [2]]);
});

test('groupSimilarColors handles empty palettes', () => {
  const groups = engine.groupSimilarColors([]);
  assert.equal(groups.count, 0);
  assert.deepEqual(groups.groups, []);
  assert.equal(groups.groupOf.length, 0);
});

test('analyzePalette masks low-contrast edges without touching indices', () => {
  const palette = paletteOf([
    [128, 128, 128],
    [138, 138, 138],
    [255, 255, 255],
  ]);
  const indices = Int16Array.from([0, 1, 2]);
  const before = Array.from(indices);
  const p = engine.analyzePalette(indices, 3, 1, palette);

  assert.equal(p.contrast.edges, 2);
  assert.equal(p.contrast.lowPairs, 1);
  assert.equal(p.contrast.lowEdges, 1);
  assert.equal(p.contrast.score, 0.5);
  assert.deepEqual(Array.from(p.contrast.mask), [1, 1, 0]);
  assert.deepEqual(Array.from(indices), before);
  assert.equal(p.contrast.worst.length, 1);
  assert.equal(p.contrast.worst[0].a, 0);
  assert.equal(p.contrast.worst[0].b, 1);
});

test('analyzePalette keeps hue-separated colours out of low contrast', () => {
  const palette = paletteOf([
    [255, 0, 0],
    [0, 0, 255],
  ]);
  const p = engine.analyzePalette(Int16Array.from([0, 1]), 2, 1, palette);

  assert.equal(p.contrast.edges, 1);
  assert.equal(p.contrast.lowPairs, 0);
  assert.equal(p.contrast.score, 1);
});

test('analyzePalette ignores transparency and same-colour adjacency', () => {
  const palette = paletteOf([
    [255, 0, 0],
    [0, 0, 255],
  ]);
  const p = engine.analyzePalette(Int16Array.from([-1, 0, 1, -1]), 2, 2, palette);

  assert.equal(p.contrast.edges, 0);
  assert.equal(p.contrast.score, null);
  assert.equal(p.contrast.lowPairs, 0);
  assert.equal(maskPixels(p.contrast.mask), 0);

  const solid = engine.analyzePalette(Int16Array.from([0, 0, 0, 0]), 2, 2, palette);
  assert.equal(solid.contrast.edges, 0);
  assert.equal(solid.contrast.score, null);
});

test('analyzePalette reports a flat lightness range', () => {
  const palette = paletteOf([
    [100, 100, 100],
    [110, 110, 110],
    [120, 120, 120],
  ]);
  const p = engine.analyzePalette(Int16Array.from([0, 1, 2]), 3, 1, palette);

  assert.equal(p.flat, true);
  assert.ok(p.lightness.spread < 10);
});

test('analyzePalette skips oversized grids and reports the cap', () => {
  const p = engine.analyzePalette(
    new Int16Array(25),
    5,
    5,
    paletteOf([[0, 0, 0]]),
    { maxPixels: 24 }
  );

  assert.equal(p.skipped, true);
  assert.equal(p.contrast.skipped, true);
  assert.equal(p.contrast.mask.length, 25);
  assert.equal(p.colors, 0);
});

test('analyzeIslands flags a compact lone pixel', () => {
  const w = 7;
  const h = 7;
  const indices = new Int16Array(w * h).fill(1);
  indices[3 * w + 3] = 0;

  const islands = engine.analyzeIslands(indices, w, h);
  assert.equal(islands.skipped, false);
  assert.equal(islands.singles, 1);
  assert.equal(islands.clusters, 0);
  assert.equal(islands.hotspots, 1);
  assert.equal(islands.pixels, 1);
  assert.equal(maskPixels(islands.mask), 1);
  assert.equal(islands.mask[3 * w + 3], 1);
  assert.equal(islands.list[0].share, 1);
});

test('analyzeIslands ignores diagonal lines, border pixels and transparency', () => {
  const w = 9;
  const h = 9;
  const indices = new Int16Array(w * h).fill(1);
  for (let i = 1; i <= 6; i++) indices[i * w + i] = 0;
  indices[0 * w + 4] = 0;
  indices[4 * w + 8] = 0;
  indices[0 * w + 7] = -1;

  const islands = engine.analyzeIslands(indices, w, h);
  assert.equal(islands.hotspots, 0);
  assert.equal(maskPixels(islands.mask), 0);
});

test('analyzeIslands keeps compact pairs and clusters, skips short diagonal strokes', () => {
  const w = 12;
  const h = 12;
  const indices = new Int16Array(w * h).fill(1);

  indices[1 * w + 1] = 0;
  indices[2 * w + 2] = 0; // diagonal pair: not compact enough
  indices[5 * w + 5] = 0;
  indices[5 * w + 6] = 0; // horizontal pair
  indices[8 * w + 8] = 0;
  indices[8 * w + 9] = 0;
  indices[9 * w + 8] = 0;
  indices[9 * w + 9] = 0; // 2x2 cluster

  const before = Array.from(indices);
  const islands = engine.analyzeIslands(indices, w, h);
  assert.equal(islands.singles, 0);
  assert.equal(islands.clusters, 2);
  assert.equal(islands.hotspots, 2);
  assert.equal(islands.pixels, 6);
  assert.deepEqual(Array.from(indices), before);
});

test('analyzeIslands ignores a pixel at a balanced colour junction', () => {
  const w = 7;
  const h = 7;
  const indices = new Int16Array(w * h).fill(1);
  const neighbours = [1, 2, 3, 4, 1, 2, 3, 4];
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      indices[(3 + dy) * w + 3 + dx] = neighbours[n++];
    }
  }
  indices[3 * w + 3] = 0;

  const islands = engine.analyzeIslands(indices, w, h);
  assert.equal(islands.mask[3 * w + 3], 0);
});

test('analyzeIslands skips oversized grids and keeps a correctly sized mask', () => {
  const islands = engine.analyzeIslands(new Int16Array(25), 5, 5, { maxPixels: 24 });
  assert.equal(islands.skipped, true);
  assert.equal(islands.mask.length, 25);
  assert.equal(islands.hotspots, 0);
});

test('analyzeTiles reports layout and tile inventory', () => {
  const indices = Int16Array.from([
    0, 0, 1, 1,
    0, 0, 1, 1,
    2, 2, 3, 3,
    2, 2, 3, 3,
  ]);
  const before = Array.from(indices);
  const tiles = engine.analyzeTiles(indices, 4, 4, 2);

  assert.equal(tiles.skipped, false);
  assert.equal(tiles.cols, 2);
  assert.equal(tiles.rows, 2);
  assert.equal(tiles.tiles, 4);
  assert.equal(tiles.exact, true);
  assert.equal(tiles.truncated, false);
  assert.equal(tiles.uniqueTiles, 4);
  assert.equal(tiles.duplicateTiles, 0);
  assert.equal(tiles.emptyTiles, 0);
  assert.equal(tiles.seams.total, 2);
  assert.deepEqual(Array.from(indices), before);
});

test('analyzeTiles leaves seams alone when they continue the pattern', () => {
  const w = 6;
  const indices = new Int16Array(w * w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) indices[y * w + x] = Math.floor(y / 3) % 2;
  }
  const tiles = engine.analyzeTiles(indices, w, w, 2);

  assert.equal(tiles.cols, 3);
  assert.equal(tiles.rows, 3);
  assert.equal(tiles.uniqueTiles, 3);
  assert.equal(tiles.duplicateTiles, 6);
  assert.equal(tiles.seams.total, 4);
  assert.equal(tiles.seams.flagged, 0);
  assert.equal(tiles.seams.score, 1);
  assert.equal(maskPixels(tiles.seams.mask), 0);
});

test('analyzeTiles flags hard seams and marks one pixel per seam', () => {
  const indices = Int16Array.from([
    0, 0, 1, 1,
    0, 0, 1, 1,
    2, 2, 3, 3,
    2, 2, 3, 3,
  ]);
  const tiles = engine.analyzeTiles(indices, 4, 4, 2);

  // The four solid tiles have clean interiors and hard seams on both axes.
  assert.equal(tiles.seams.flagged, 2);
  assert.equal(tiles.seams.score, 0);
  assert.equal(maskPixels(tiles.seams.mask), 7);
  assert.equal(tiles.seams.list[0].flagged, true);
});

test('analyzeTiles counts duplicate and empty tiles', () => {
  const indices = new Int16Array(16).fill(-1);
  const tiles = engine.analyzeTiles(indices, 4, 4, 2);

  assert.equal(tiles.tiles, 4);
  assert.equal(tiles.uniqueTiles, 1);
  assert.equal(tiles.duplicateTiles, 3);
  assert.equal(tiles.emptyTiles, 4);
  assert.equal(tiles.seams.flagged, 0);
  assert.equal(tiles.seams.score, 1);
});

test('analyzeTiles reports a non-divisible sheet as truncated', () => {
  const indices = new Int16Array(5 * 4).fill(0);
  const tiles = engine.analyzeTiles(indices, 5, 4, 2);

  assert.equal(tiles.skipped, false);
  assert.equal(tiles.cols, 2);
  assert.equal(tiles.rows, 2);
  assert.equal(tiles.exact, false);
  assert.equal(tiles.truncated, true);
});

test('analyzeTiles skips invalid sizes and oversized grids', () => {
  const indices = new Int16Array(16);
  const off = engine.analyzeTiles(indices, 4, 4, 0);
  assert.equal(off.skipped, true);
  assert.equal(off.reason, 'size');

  const tooBig = engine.analyzeTiles(indices, 4, 4, 8);
  assert.equal(tooBig.skipped, true);
  assert.equal(tooBig.reason, 'size');

  const oversized = engine.analyzeTiles(indices, 4, 4, 2, { maxPixels: 15 });
  assert.equal(oversized.skipped, true);
  assert.equal(oversized.reason, 'grid');
  assert.equal(oversized.seams.mask.length, 16);
});

// ---------------------------------------------------------------------------
// Opt-in automatic fixes
// ---------------------------------------------------------------------------

test('autoFixLines repairs doubles and preserves the input grid', () => {
  const g = gridFromRows([
    '#####.....',
    '....#####.',
    '........##',
  ]);
  const before = Array.from(g.indices);
  const fix = engine.autoFixLines(g.indices, g.width, g.height, 'doubles');

  assert.equal(fix.skipped, false);
  assert.equal(fix.before.target, 2);
  assert.equal(fix.after.target, 0);
  assert.ok(fix.applied > 0);
  assert.equal(fix.reason, 'complete');
  assert.deepEqual(Array.from(g.indices), before);
  assert.notEqual(fix.indices, g.indices);
  assert.ok(fix.after.total <= fix.before.total);
});

test('autoFixLines repairs a one-pixel rhythm break', () => {
  const g = gridFromColumns(5, 11, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 6],
    [3, 7, 8],
    [4, 9, 10],
  ]);
  const fix = engine.autoFixLines(g.indices, g.width, g.height, 'jaggies');

  assert.equal(fix.before.target, 1);
  assert.equal(fix.after.target, 0);
  assert.equal(fix.reason, 'complete');
  assert.ok(fix.applied > 0);
  assert.ok(fix.after.total <= fix.before.total);
});

test('autoFixLines repairs larger rhythm breaks', () => {
  const g = gridFromColumns(5, 12, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 7],
    [3, 8, 9],
    [4, 10, 11],
  ]);
  const fix = engine.autoFixLines(g.indices, g.width, g.height, 'lines');

  assert.equal(fix.before.target, 1);
  assert.equal(fix.after.target, 0);
  assert.equal(fix.reason, 'complete');
  assert.ok(fix.applied > 0);
});

test('autoFixLines repairs irregular strokes', () => {
  const g = gridFromRows([
    '#...',
    '.#..',
    '..##',
  ]);
  const fix = engine.autoFixLines(g.indices, g.width, g.height, 'irregular');

  assert.equal(fix.before.target, 1);
  assert.equal(fix.after.target, 0);
  assert.equal(fix.reason, 'complete');
  assert.ok(fix.applied > 0);
  assert.ok(fix.after.total <= fix.before.total);
});

test('autoFixLines respects caps and rejects invalid categories', () => {
  const g = gridFromColumns(5, 11, [
    [0, 0, 1],
    [1, 2, 3],
    [2, 4, 6],
    [3, 7, 8],
    [4, 9, 10],
  ]);

  const noBudget = engine.autoFixLines(g.indices, g.width, g.height, 'jaggies', {
    maxEvaluations: 0,
  });
  assert.equal(noBudget.evaluations, 0);
  assert.equal(noBudget.applied, 0);
  assert.equal(noBudget.reason, 'limit');

  const noTarget = engine.autoFixLines(g.indices, g.width, g.height, 'jaggies', {
    maxTarget: 0,
  });
  assert.equal(noTarget.applied, 0);
  assert.equal(noTarget.reason, 'target-cap');

  const invalid = engine.autoFixLines(g.indices, g.width, g.height, 'unknown');
  assert.equal(invalid.skipped, true);
  assert.equal(invalid.reason, 'category');

  const oversized = engine.autoFixLines(g.indices, g.width, g.height, 'jaggies', {
    maxPixels: 10,
  });
  assert.equal(oversized.skipped, true);
  assert.equal(oversized.reason, 'grid');
});

test('removeIslands replaces a compact island with the dominant border colour', () => {
  const w = 7;
  const h = 7;
  const indices = new Int16Array(w * h).fill(1);
  indices[3 * w + 3] = 0;
  const before = Array.from(indices);

  const fix = engine.removeIslands(indices, w, h);
  assert.equal(fix.skipped, false);
  assert.equal(fix.before.hotspots, 1);
  assert.equal(fix.after.hotspots, 0);
  assert.equal(fix.applied, 1);
  assert.equal(fix.components, 1);
  assert.equal(fix.indices[3 * w + 3], 1);
  assert.equal(fix.reason, 'complete');
  assert.deepEqual(Array.from(indices), before);
});

test('removeIslands respects maxTarget and can be repeated', () => {
  const w = 9;
  const h = 9;
  const indices = new Int16Array(w * h).fill(1);
  indices[2 * w + 2] = 0;
  indices[6 * w + 6] = 0;

  const first = engine.removeIslands(indices, w, h, { maxTarget: 1 });
  assert.equal(first.applied, 1);
  assert.equal(first.components, 1);
  assert.equal(first.after.hotspots, 1);
  assert.equal(first.reason, 'target-cap');

  const second = engine.removeIslands(first.indices, w, h);
  assert.equal(second.before.hotspots, 1);
  assert.equal(second.after.hotspots, 0);
  assert.equal(second.reason, 'complete');
});

test('boostPaletteContrast separates a weak pair while preserving hue and saturation', () => {
  const palette = paletteOf([
    [140, 90, 70],
    [148, 98, 78],
    [255, 255, 255],
  ]);
  const indices = Int16Array.from([0, 1, 2]);
  const beforePalette = palette.map((c) => ({ ...c }));
  const beforeHsl = engine.rgbToHsl(140, 90, 70);

  const fix = engine.boostPaletteContrast(palette, indices, 3, 1);
  assert.equal(fix.skipped, false);
  assert.equal(fix.before.lowPairs, 1);
  assert.equal(fix.after.lowPairs, 0);
  assert.ok(fix.after.minDistance >= 0.06);
  assert.ok(fix.changes.length > 0);
  assert.equal(fix.reason, 'complete');
  assert.deepEqual(palette, beforePalette);

  const changed = fix.palette[fix.changes[0].index];
  const afterHsl = engine.rgbToHsl(changed.r, changed.g, changed.b);
  assert.ok(Math.abs(afterHsl.h - beforeHsl.h) < 2);
  assert.ok(Math.abs(afterHsl.s - beforeHsl.s) < 2);
  assert.notEqual(afterHsl.l, beforeHsl.l);
});

test('boostPaletteContrast leaves clean palettes and oversized grids alone', () => {
  const cleanPalette = paletteOf([
    [255, 0, 0],
    [0, 0, 255],
  ]);
  const clean = engine.boostPaletteContrast(
    cleanPalette,
    Int16Array.from([0, 1]),
    2,
    1
  );
  assert.equal(clean.before.lowPairs, 0);
  assert.equal(clean.changes.length, 0);
  assert.equal(clean.reason, 'clean');

  const oversized = engine.boostPaletteContrast(
    cleanPalette,
    Int16Array.from([0, 1, 0]),
    3,
    1,
    { maxPixels: 2 }
  );
  assert.equal(oversized.skipped, true);
  assert.equal(oversized.reason, 'grid');
  assert.equal(oversized.palette.length, cleanPalette.length);
});

test('fixTileSeams harmonizes flagged seams and preserves the input grid', () => {
  const indices = Int16Array.from([
    0, 0, 1, 1,
    0, 0, 1, 1,
    2, 2, 3, 3,
    2, 2, 3, 3,
  ]);
  const before = Array.from(indices);
  const fix = engine.fixTileSeams(indices, 4, 4, 2);

  assert.equal(fix.skipped, false);
  assert.equal(fix.before.flagged, 2);
  assert.equal(fix.after.flagged, 0);
  assert.equal(fix.reason, 'complete');
  assert.ok(fix.applied > 0);
  assert.deepEqual(Array.from(indices), before);
  assert.notEqual(fix.indices, indices);
});

test('fixTileSeams leaves clean sheets alone and rejects invalid sizes', () => {
  const clean = engine.fixTileSeams(new Int16Array(16).fill(0), 4, 4, 2);
  assert.equal(clean.before.flagged, 0);
  assert.equal(clean.applied, 0);
  assert.equal(clean.reason, 'clean');

  const invalid = engine.fixTileSeams(new Int16Array(16), 4, 4, 0);
  assert.equal(invalid.skipped, true);
  assert.equal(invalid.reason, 'size');

  const oversized = engine.fixTileSeams(new Int16Array(16), 4, 4, 2, {
    maxPixels: 15,
  });
  assert.equal(oversized.skipped, true);
  assert.equal(oversized.reason, 'grid');
});

// ---------------------------------------------------------------------------
// Indexed resize
// ---------------------------------------------------------------------------

const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const PURPLE = { r: 128, g: 0, b: 128 };

test('resizeIndexed fits the alpha bounds with a margin', () => {
  const source = makeIndexed(new Array(64).fill(-1));
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) source.indices[y * 8 + x] = 0;
  }
  for (let i = 0; i < 64; i++) source.alpha[i] = source.indices[i] >= 0 ? 255 : 0;

  const res = engine.resizeIndexed(source.indices, source.alpha, 8, 8, [RED], {
    width: 8,
    height: 8,
    margin: 1,
    method: 'area',
    fit: 'bounds',
  });

  assert.equal(res.skipped, false);
  assert.equal(res.contentWidth, 6);
  assert.equal(res.contentHeight, 6);
  assert.equal(res.offsetX, 1);
  assert.equal(res.offsetY, 1);
  assert.equal(res.alpha[0], 0);
  assert.equal(res.alpha[1 * 8 + 1], 255);
  assert.equal(res.alpha[6 * 8 + 6], 255);
  assert.equal(res.alpha[7 * 8 + 7], 0);
  assert.equal(res.indices[1 * 8 + 1], 0);
  assert.equal(res.indices[6 * 8 + 6], 0);
});

test('resizeIndexed area maps the covered average to the palette', () => {
  const source = makeIndexed([0, 1]);
  const palette = [RED, BLUE, PURPLE];

  const area = engine.resizeIndexed(source.indices, source.alpha, 2, 1, palette, {
    width: 1,
    height: 1,
    margin: 0,
    method: 'area',
    fit: 'canvas',
  });
  assert.equal(area.indices[0], 2);
  assert.equal(area.alpha[0], 255);

  const nearest = engine.resizeIndexed(source.indices, source.alpha, 2, 1, palette, {
    width: 1,
    height: 1,
    margin: 0,
    method: 'nearest',
    fit: 'canvas',
  });
  assert.equal(nearest.indices[0], 1);
  assert.equal(nearest.alpha[0], 255);
});

test('resizeIndexed area preserves a 1:1 grid and the input', () => {
  const source = makeIndexed([0, 1, 2, 0, 2, 1, 1, 0, 2, 2, 0, 1]);
  const beforeIndices = Array.from(source.indices);
  const beforeAlpha = Array.from(source.alpha);
  const palette = [
    { r: 20, g: 20, b: 28 },
    { r: 238, g: 238, b: 242 },
    { r: 214, g: 66, b: 66 },
  ];

  const res = engine.resizeIndexed(source.indices, source.alpha, 4, 3, palette, {
    width: 4,
    height: 3,
    margin: 0,
    method: 'area',
    fit: 'bounds',
  });

  assert.deepEqual(Array.from(res.indices), beforeIndices);
  assert.deepEqual(Array.from(res.alpha), beforeAlpha);
  assert.deepEqual(Array.from(source.indices), beforeIndices);
  assert.deepEqual(Array.from(source.alpha), beforeAlpha);
  assert.deepEqual(res.palette, palette);
});

test('resizeIndexed applies the alpha coverage threshold', () => {
  const source = makeIndexed([0, 0], [255, 0]);
  const options = {
    width: 1,
    height: 1,
    margin: 0,
    method: 'area',
    fit: 'canvas',
  };

  const hidden = engine.resizeIndexed(
    source.indices,
    source.alpha,
    2,
    1,
    [RED],
    { ...options, alphaThreshold: 0.6 }
  );
  assert.equal(hidden.alpha[0], 0);

  const visible = engine.resizeIndexed(
    source.indices,
    source.alpha,
    2,
    1,
    [RED],
    { ...options, alphaThreshold: 0.4 }
  );
  assert.equal(visible.alpha[0], 255);
  assert.equal(visible.indices[0], 0);
});

test('resizeIndexed fits the whole canvas without stretching', () => {
  const source = makeIndexed(new Array(8).fill(0));
  const res = engine.resizeIndexed(source.indices, source.alpha, 4, 2, [RED], {
    width: 4,
    height: 4,
    margin: 0,
    method: 'area',
    fit: 'canvas',
  });

  assert.equal(res.contentWidth, 4);
  assert.equal(res.contentHeight, 2);
  assert.equal(res.offsetY, 1);
  for (let x = 0; x < 4; x++) {
    assert.equal(res.alpha[x], 0);
    assert.equal(res.alpha[1 * 4 + x], 255);
    assert.equal(res.alpha[2 * 4 + x], 255);
    assert.equal(res.alpha[3 * 4 + x], 0);
  }
});

test('resizeIndexed upscales source pixels as hard blocks', () => {
  const source = makeIndexed([0, 1, 2, 3]);
  const palette = [
    { r: 10, g: 10, b: 10 },
    { r: 20, g: 20, b: 20 },
    { r: 30, g: 30, b: 30 },
    { r: 40, g: 40, b: 40 },
  ];
  const res = engine.resizeIndexed(source.indices, source.alpha, 2, 2, palette, {
    width: 4,
    height: 4,
    margin: 0,
    method: 'area',
    fit: 'canvas',
  });

  assert.equal(res.indices[0], 0);
  assert.equal(res.indices[1], 0);
  assert.equal(res.indices[2], 1);
  assert.equal(res.indices[3], 1);
  assert.equal(res.indices[2 * 4], 2);
  assert.equal(res.indices[2 * 4 + 2], 3);
  assert.equal(res.alpha.every((value) => value === 255), true);
});

test('resizeIndexed rejects invalid input and oversized targets', () => {
  const missingPalette = engine.resizeIndexed(
    new Int16Array(1),
    null,
    1,
    1,
    [],
    { width: 2, height: 2 }
  );
  assert.equal(missingPalette.skipped, true);
  assert.equal(missingPalette.reason, 'input');
  assert.equal(missingPalette.indices.length, 0);

  const oversized = engine.resizeIndexed(
    Int16Array.from([0]),
    Uint8Array.from([255]),
    1,
    1,
    [RED],
    { width: 2, height: 2, maxPixels: 1 }
  );
  assert.equal(oversized.skipped, true);
  assert.equal(oversized.reason, 'size');
  assert.equal(oversized.indices.length, 0);
});

test('resizeIndexed returns a transparent target for an empty source', () => {
  const source = makeIndexed(new Array(16).fill(-1));
  const res = engine.resizeIndexed(source.indices, source.alpha, 4, 4, [RED], {
    width: 8,
    height: 8,
    margin: 2,
    method: 'area',
  });

  assert.equal(res.skipped, false);
  assert.equal(res.contentWidth, 0);
  assert.equal(res.contentHeight, 0);
  assert.equal(res.alpha.every((value) => value === 0), true);
  assert.equal(res.indices.every((value) => value === -1), true);
});

// ---------------------------------------------------------------------------
// End-to-end synthetic pipeline
// ---------------------------------------------------------------------------

test('end-to-end: detect, sample, quantize, despeckle, compose', () => {
  const art = makeBlockyArt(20, 16, 123123, PALETTE.slice(0, 6));
  const scale = 9;
  let img = upscaleNearest(art, scale);
  img = boxBlur(img, 1);
  img = addNoise(img, 6, 4004);

  const grid = engine.detectGrid(img);
  assert.equal(grid.scale, scale);

  const cells = engine.sampleCells(img, {
    scale: grid.scale,
    offsetX: grid.offsetX,
    offsetY: grid.offsetY,
  });
  assert.equal(cells.width, art.width);
  assert.equal(cells.height, art.height);

  const q = engine.quantize(cells, {
    mode: 'auto',
    mergeThreshold: 0.045,
    maxAutoColors: 24,
  });
  assert.ok(q.palette.length > 0 && q.palette.length <= 24);

  const cleaned = engine.despeckle(q.indices, q.width, q.height, 1);
  const composed = engine.composeImageData(cleaned, q.palette, q.width, q.height, q.alpha);
  assert.equal(composed.width, art.width);
  assert.equal(composed.height, art.height);

  // Most cells should sit close to one of the original six colors.
  let close = 0;
  for (let i = 0, p = 0; i < cells.width * cells.height; i++, p += 4) {
    const d = nearestPaletteDistance(
      [composed.data[p], composed.data[p + 1], composed.data[p + 2]],
      PALETTE.slice(0, 6)
    );
    if (d < 0.08) close++;
  }
  const ratio = close / (cells.width * cells.height);
  assert.ok(ratio > 0.85, `only ${(ratio * 100).toFixed(1)}% cells close to source palette`);
});
