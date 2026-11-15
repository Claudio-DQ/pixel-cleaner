/*
 * Pixel Cleaner — engine
 * Pure JS image-processing core. No DOM dependencies.
 *
 * Pipeline:
 *   1. buildGridProfiles()  -> edge profiles along rows/columns
 *   2. detectGridFromProfiles() -> detected pixel scale + offsets
 *   3. sampleCells()        -> reconstruct logical-resolution pixels
 *   4. quantize()           -> perceptual (OKLab) palette reduction
 *   5. despeckle()          -> remove isolated logical pixels
 *   6. composeImageData()   -> final RGBA image
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PixelEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  var MAX_GRID_SCALE = 256;
  var RESIZE_MAX_SIDE = 4096;
  var RESIZE_MAX_PIXELS = 4194304;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // -------------------------------------------------------------------------
  // Color science (sRGB <-> OKLab)
  // -------------------------------------------------------------------------

  var SRGB_LINEAR = (function () {
    var lut = new Float64Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i / 255;
      lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return lut;
  })();

  function rgbToOklab(r, g, b) {
    var lr = SRGB_LINEAR[r | 0];
    var lg = SRGB_LINEAR[g | 0];
    var lb = SRGB_LINEAR[b | 0];

    var l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    var m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    var s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    var l_ = Math.cbrt(l);
    var m_ = Math.cbrt(m);
    var s_ = Math.cbrt(s);

    return {
      L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
      A: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
      B: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
    };
  }

  function oklabDist2(l1, a1, b1, l2, a2, b2) {
    var dl = l1 - l2;
    var da = a1 - a2;
    var db = b1 - b2;
    return dl * dl + da * da + db * db;
  }

  function rgbToHex(r, g, b) {
    function h(v) {
      var s = (v | 0).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + h(r) + h(g) + h(b);
  }

  /**
   * Converts sRGB to HSL.
   * Returns hue in degrees (0-360), saturation and lightness in percent (0-100).
   */
  function rgbToHsl(r, g, b) {
    var rr = clamp(r, 0, 255) / 255;
    var gg = clamp(g, 0, 255) / 255;
    var bb = clamp(b, 0, 255) / 255;

    var max = Math.max(rr, gg, bb);
    var min = Math.min(rr, gg, bb);
    var l = (max + min) / 2;
    var h = 0;
    var s = 0;

    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
      else if (max === gg) h = (bb - rr) / d + 2;
      else h = (rr - gg) / d + 4;
      h *= 60;
    }

    return { h: h, s: s * 100, l: l * 100 };
  }

  /**
   * Converts HSL (hue degrees, saturation/lightness percent) back to sRGB.
   * Returns rounded 8-bit channels.
   */
  function hslToRgb(h, s, l) {
    var hh = mod(h, 360) / 360;
    var ss = clamp(s, 0, 100) / 100;
    var ll = clamp(l, 0, 100) / 100;

    if (ss === 0) {
      var gray = Math.round(ll * 255);
      return { r: gray, g: gray, b: gray };
    }

    var q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
    var p = 2 * ll - q;

    function channel(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      var v;
      if (t < 1 / 6) v = p + (q - p) * 6 * t;
      else if (t < 1 / 2) v = q;
      else if (t < 2 / 3) v = p + (q - p) * (2 / 3 - t) * 6;
      else v = p;
      return Math.round(clamp(v, 0, 1) * 255);
    }

    return {
      r: channel(hh + 1 / 3),
      g: channel(hh),
      b: channel(hh - 1 / 3),
    };
  }


  // -------------------------------------------------------------------------
  // 1) Edge profiles
  // -------------------------------------------------------------------------

  /**
   * Builds horizontal/vertical edge profiles, averaging the (thresholded)
   * color change between adjacent pixels along each column/row.
   *
   * image: { width, height, data: Uint8ClampedArray RGBA }
   */
  function buildGridProfiles(image, options) {
    options = options || {};
    var w = image.width | 0;
    var h = image.height | 0;
    var data = image.data;
    if (!w || !h || !data || data.length < w * h * 4) {
      throw new Error('Dati immagine non validi');
    }

    var maxScale = clamp(
      Math.round(options.maxScale || Math.min(MAX_GRID_SCALE, Math.floor(Math.min(w, h) / 4))),
      1,
      MAX_GRID_SCALE
    );
    var edgeThreshold = options.edgeThreshold == null ? 16 : Math.max(0, options.edgeThreshold);
    var pixels = w * h;
    var step = pixels > 12e6 ? 3 : pixels > 4e6 ? 2 : 1;

    var gx = new Float32Array(w);
    var gy = new Float32Array(h);
    var gxValid = new Uint8Array(w);
    var gyValid = new Uint8Array(h);

    var rowsSampled = Math.ceil(h / step);
    var colsSampled = Math.ceil(w / step);
    var y, x;

    // Horizontal transitions (between x and x+1), sampled rows.
    for (y = 0; y < h; y += step) {
      var row = y * w;
      for (x = 0; x < w - 1; x++) {
        var i = (row + x) << 2;
        var a1 = data[i + 3];
        var a2 = data[i + 7];
        var dr = Math.abs(data[i] * a1 - data[i + 4] * a2);
        var dg = Math.abs(data[i + 1] * a1 - data[i + 5] * a2);
        var db = Math.abs(data[i + 2] * a1 - data[i + 6] * a2);
        var d = (dr + dg + db) / 255 + Math.abs(a1 - a2) * 2;
        if (d >= edgeThreshold) {
          gx[x] += d;
        }
      }
    }

    // Vertical transitions (between y and y+1), sampled columns.
    for (x = 0; x < w; x += step) {
      for (y = 0; y < h - 1; y++) {
        var j = ((y * w) + x) << 2;
        var j2 = j + w * 4;
        var b1 = data[j + 3];
        var b2 = data[j2 + 3];
        var er = Math.abs(data[j] * b1 - data[j2] * b2);
        var eg = Math.abs(data[j + 1] * b1 - data[j2 + 1] * b2);
        var eb = Math.abs(data[j + 2] * b1 - data[j2 + 2] * b2);
        var e = (er + eg + eb) / 255 + Math.abs(b1 - b2) * 2;
        if (e >= edgeThreshold) {
          gy[y] += e;
        }
      }
    }

    // Average contribution per sampled line. Columns/rows without any strong
    // transition stay at zero but are still valid profile samples.
    var invRows = rowsSampled ? 1 / rowsSampled : 0;
    var invCols = colsSampled ? 1 / colsSampled : 0;
    for (x = 0; x < w - 1; x++) {
      gx[x] *= invRows;
      gxValid[x] = 1;
    }
    for (y = 0; y < h - 1; y++) {
      gy[y] *= invCols;
      gyValid[y] = 1;
    }

    return {
      width: w,
      height: h,
      gx: gx,
      gy: gy,
      gxValid: gxValid,
      gyValid: gyValid,
      maxScale: maxScale,
      step: step,
    };
  }

  // -------------------------------------------------------------------------
  // 2) Grid detection
  // -------------------------------------------------------------------------

  /**
   * Scores one axis for a candidate scale. Returns the best phase and how
   * much stronger the strongest boundary lines are compared to the rest.
   */
  function axisScore(profile, valid, scale) {
    var n = profile.length;
    var sums = new Float64Array(scale);
    var counts = new Uint32Array(scale);
    var x, p;

    for (x = 0; x < n; x++) {
      if (!valid[x]) continue;
      p = x % scale;
      sums[p] += profile[x];
      counts[p]++;
    }

    var totalSum = 0;
    var totalCount = 0;
    var bestPhase = 0;
    var bestAvg = -1;
    var bestCount = 0;

    for (p = 0; p < scale; p++) {
      var c = counts[p];
      if (!c) continue;
      var sum = sums[p];
      totalSum += sum;
      totalCount += c;
      var avg = sum / c;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestPhase = p;
        bestCount = c;
      }
    }

    if (!totalCount) {
      return { score: 0, phase: 0, boundary: 0, interior: 0, total: 0 };
    }

    var interiorSum = totalSum - sums[bestPhase];
    var interiorCount = totalCount - bestCount;
    var interiorAvg = interiorCount > 0 ? interiorSum / interiorCount : 0;
    var totalAvg = totalSum / totalCount;
    var score = bestAvg / (interiorAvg + totalAvg * 0.02 + 1e-9);

    return {
      score: score,
      phase: bestPhase,
      boundary: bestAvg,
      interior: interiorAvg,
      total: totalAvg,
    };
  }

  /**
   * Detection candidates are scored by the geometric mean of the x/y
   * boundary-to-interior contrast. True grid multiples lose because the
   * transitions that fall inside cells inflate the interior score.
   */
  function scoreScale(profiles, scale) {
    var sx = axisScore(profiles.gx, profiles.gxValid, scale);
    var sy = axisScore(profiles.gy, profiles.gyValid, scale);
    // A direction without any strong edges carries no periodicity signal;
    // don't penalise it (e.g. an image made of vertical stripes).
    var xScore = sx.total > 0 ? Math.max(0, sx.score) : 1;
    var yScore = sy.total > 0 ? Math.max(0, sy.score) : 1;
    var score = Math.sqrt(xScore * yScore);
    return {
      scale: scale,
      score: score,
      scoreX: sx.score,
      scoreY: sy.score,
      phaseX: sx.phase,
      phaseY: sy.phase,
      boundaryX: sx.boundary,
      boundaryY: sy.boundary,
      interiorX: sx.interior,
      interiorY: sy.interior,
    };
  }

  function snapOffset(offset, scale) {
    if (scale <= 1) return 0;
    var v = mod(offset, scale);
    // Anti-aliasing / rounding often moves the detected phase by one pixel.
    // Cell-centre sampling makes that harmless, but snapping keeps clean
    // images aligned to 0 and avoids tiny partial cells at the edges.
    if (v === 1 || v === scale - 1) return 0;
    return v;
  }

  function offsetsForScale(profiles, scale) {
    scale = clamp(Math.round(scale), 1, MAX_GRID_SCALE);
    if (scale <= 1) {
      return { offsetX: 0, offsetY: 0, score: 0, candidate: null };
    }
    var cand = scoreScale(profiles, scale);
    return {
      offsetX: snapOffset((cand.phaseX + 1) % scale, scale),
      offsetY: snapOffset((cand.phaseY + 1) % scale, scale),
      score: cand.score,
      candidate: cand,
    };
  }

  /**
   * Detects the pixel grid from precomputed profiles.
   * options: { forceScale?: number }
   */
  function detectGridFromProfiles(profiles, options) {
    options = options || {};
    var maxScale = Math.max(1, Math.min(profiles.maxScale, MAX_GRID_SCALE));

    if (options.forceScale != null) {
      var forced = clamp(Math.round(options.forceScale), 1, maxScale);
      var offs = offsetsForScale(profiles, forced);
      return {
        scale: forced,
        offsetX: offs.offsetX,
        offsetY: offs.offsetY,
        confidence: forced === 1 ? 1 : offs.score,
        candidates: offs.candidate ? [offs.candidate] : [],
        auto: false,
      };
    }

    if (maxScale < 2) {
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        confidence: 1,
        candidates: [],
        auto: true,
      };
    }

    var candidates = [];
    var best = null;
    for (var s = 2; s <= maxScale; s++) {
      var cand = scoreScale(profiles, s);
      candidates.push(cand);
      if (!best || cand.score > best.score) best = cand;
    }

    // No meaningful periodicity: fall back to native pixels.
    if (!best || best.score < 1.08) {
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        confidence: best ? best.score : 1,
        candidates: candidates,
        auto: true,
      };
    }

    return {
      scale: best.scale,
      offsetX: snapOffset((best.phaseX + 1) % best.scale, best.scale),
      offsetY: snapOffset((best.phaseY + 1) % best.scale, best.scale),
      confidence: best.score,
      candidates: candidates,
      auto: true,
    };
  }

  /**
   * Measures how "blocky" a candidate grid is. Central regions of cells are
   * sampled (same margin used later for reconstruction) and we compare the
   * variance between cells with the variance inside cells.
   *
   * A correct grid has almost no within-cell variance (B close to 1). A grid
   * that is too coarse mixes different logical pixels and drops sharply.
   */
  function measureBlockiness(image, scale, offsetX, offsetY, options) {
    options = options || {};
    scale = Math.max(1, Math.round(scale));
    var w = image.width | 0;
    var h = image.height | 0;
    var data = image.data;
    var margin = clamp(options.marginRatio == null ? 0.25 : options.marginRatio, 0, 0.45);
    var noiseFloor = options.noiseFloor == null ? 8 : Math.max(0, options.noiseFloor);
    var noiseVar = noiseFloor * noiseFloor;
    var ox = mod(Math.round(offsetX || 0), scale);
    var oy = mod(Math.round(offsetY || 0), scale);
    var cols = Math.max(1, Math.ceil((w - ox) / scale));
    var rows = Math.max(1, Math.ceil((h - oy) / scale));

    var N = 0;
    var sumR = 0, sumG = 0, sumB = 0, sumA = 0;
    var sumSq = 0;
    var cellTerm = 0;
    var cellCount = 0;

    for (var cy = 0; cy < rows; cy++) {
      var y0 = oy + cy * scale;
      var y1 = Math.min(h, y0 + scale);
      if (y0 >= h) break;
      var ch = y1 - y0;
      var insetY = Math.floor(ch * margin);
      var sy0 = y0 + insetY;
      var sy1 = y1 - insetY;
      if (sy1 <= sy0) {
        sy0 = y0;
        sy1 = y1;
      }

      for (var cx = 0; cx < cols; cx++) {
        var x0 = ox + cx * scale;
        var x1 = Math.min(w, x0 + scale);
        if (x0 >= w) break;
        var cw = x1 - x0;
        var insetX = Math.floor(cw * margin);
        var sx0 = x0 + insetX;
        var sx1 = x1 - insetX;
        if (sx1 <= sx0) {
          sx0 = x0;
          sx1 = x1;
        }

        var n = 0;
        var sr = 0, sg = 0, sb = 0, sa = 0;
        var ss = 0;
        for (var y = sy0; y < sy1; y++) {
          var row = y * w;
          for (var x = sx0; x < sx1; x++) {
            var p = (row + x) << 2;
            var alpha = data[p + 3];
            var af = alpha / 255;
            var r = data[p] * af;
            var g = data[p + 1] * af;
            var b = data[p + 2] * af;
            n++;
            sr += r;
            sg += g;
            sb += b;
            sa += alpha;
            ss += r * r + g * g + b * b + alpha * alpha;
          }
        }
        if (!n) continue;

        cellCount++;
        N += n;
        sumR += sr;
        sumG += sg;
        sumB += sb;
        sumA += sa;
        sumSq += ss;
        cellTerm += (sr * sr + sg * sg + sb * sb + sa * sa) / n;
      }
    }

    if (!N) {
      return { ratio: 0, within: 0, between: 0, cells: 0, pixels: 0 };
    }

    var globalTerm = (sumR * sumR + sumG * sumG + sumB * sumB + sumA * sumA) / N;
    var betweenSS = Math.max(0, cellTerm - globalTerm);
    var withinSS = Math.max(0, sumSq - cellTerm);
    var withinRaw = withinSS / (N * 4);
    // Ignore low-amplitude variation (JPEG blocking, AI gradients, sensor
    // noise) when judging whether cells are flat. Subtracting the noise
    // variance keeps the metric focused on real, visible pixel boundaries.
    var within = Math.max(0, withinRaw - noiseVar);

    return {
      ratio: betweenSS / (betweenSS + within * N * 4 + 1e-9),
      within: within,
      withinRaw: withinRaw,
      between: betweenSS / (N * 4),
      cells: cellCount,
      pixels: N,
    };
  }

  /**
   * Searches offsets around a detected alignment and keeps the one with the
   * purest cells (ties prefer the least movement from the hint).
   */
  function refineOffsets(image, scale, offsetX, offsetY, options) {
    options = options || {};
    scale = Math.max(1, Math.round(scale));
    if (scale <= 1) {
      return {
        offsetX: 0,
        offsetY: 0,
        measurement: measureBlockiness(image, 1, 0, 0, options),
      };
    }
    var hintX = mod(Math.round(offsetX || 0), scale);
    var hintY = mod(Math.round(offsetY || 0), scale);
    var search = options.search == null ? 1 : Math.max(0, Math.round(options.search));
    var best = null;

    for (var dy = -search; dy <= search; dy++) {
      for (var dx = -search; dx <= search; dx++) {
        var ox = mod(hintX + dx, scale);
        var oy = mod(hintY + dy, scale);
        var m = measureBlockiness(image, scale, ox, oy, options);
        var dist = Math.abs(dx) + Math.abs(dy);
        var purest = !best || m.within < best.measurement.within - 1e-6;
        if (
          purest ||
          (best &&
            Math.abs(m.within - best.measurement.within) <= 1e-6 &&
            (dist < best.dist ||
              (dist === best.dist && m.ratio > best.measurement.ratio)))
        ) {
          best = { offsetX: ox, offsetY: oy, measurement: m, dist: dist };
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Grid verification
  //
  // A real pixel-art grid has two independent properties:
  //   1. every cell is (nearly) flat in its centre and over most of its area;
  //   2. strong colour transitions sit on cell boundaries, not inside cells.
  //
  // Purity alone rejects native images with fine detail, while boundary
  // alignment alone is weak on sparse art. Requiring both, plus enough edge
  // support across the image, keeps a 74x74 native image at 1x and avoids
  // inventing a grid on JPEG blocks or smooth gradients.
  // -------------------------------------------------------------------------

  function histogramPercentile(hist, total, p) {
    if (total <= 0) return 0;
    var target = Math.max(1, Math.ceil(total * p));
    var acc = 0;
    for (var i = 0; i < hist.length; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return hist.length - 1;
  }

  /**
   * Measures cell flatness at a candidate scale/offset.
   * The inner sample excludes the edges (same 25% margin used by sampling);
   * the whole-cell sample keeps a little of the boundary so a grid that
   * really splits logical pixels cannot hide behind the margin.
   */
  function gridCellStats(image, scale, offsetX, offsetY, options) {
    options = options || {};
    var w = image.width | 0;
    var h = image.height | 0;
    var data = image.data;
    var margin = clamp(options.marginRatio == null ? 0.25 : options.marginRatio, 0, 0.45);
    var maxCells = options.maxCells == null ? 900 : Math.max(1, Math.round(options.maxCells));
    var ox = mod(Math.round(offsetX || 0), scale);
    var oy = mod(Math.round(offsetY || 0), scale);
    var cols = Math.floor((w - ox) / scale);
    var rows = Math.floor((h - oy) / scale);
    if (cols < 1 || rows < 1) return null;

    var cellStride = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / maxCells)));
    var inset = Math.min(Math.floor(scale * margin), Math.floor((scale - 1) / 2));
    if (inset < 0) inset = 0;
    var innerSize = Math.max(1, scale - inset * 2);
    var pixelStride = Math.max(1, Math.ceil(innerSize / 6));
    var wholeStride = Math.max(1, Math.ceil(scale / 8));
    var innerHist = new Uint32Array(257);
    var wholeHist = new Uint32Array(257);
    var values = new Float32Array(4 * 64);
    var sampled = 0;
    var flatInner = 0;
    var flatWhole = 0;

    for (var cy = 0; cy < rows; cy += cellStride) {
      var y0 = oy + cy * scale;
      var sy0 = y0 + inset;
      var sy1 = y0 + scale - inset;
      for (var cx = 0; cx < cols; cx += cellStride) {
        var x0 = ox + cx * scale;
        var sx0 = x0 + inset;
        var sx1 = x0 + scale - inset;
        var n = 0;
        var sr = 0;
        var sg = 0;
        var sb = 0;
        var sa = 0;
        var y;
        var x;
        var p;

        for (y = sy0; y < sy1; y += pixelStride) {
          var row = y * w;
          for (x = sx0; x < sx1; x += pixelStride) {
            p = (row + x) << 2;
            var alpha = data[p + 3];
            var af = alpha / 255;
            var r = data[p] * af;
            var g = data[p + 1] * af;
            var b = data[p + 2] * af;
            values[n * 4] = r;
            values[n * 4 + 1] = g;
            values[n * 4 + 2] = b;
            values[n * 4 + 3] = alpha;
            sr += r;
            sg += g;
            sb += b;
            sa += alpha;
            n++;
          }
        }
        if (!n) continue;

        var mr = sr / n;
        var mg = sg / n;
        var mb = sb / n;
        var ma = sa / n;
        var madIn = 0;
        for (var i = 0; i < n; i++) {
          madIn +=
            (Math.abs(values[i * 4] - mr) +
              Math.abs(values[i * 4 + 1] - mg) +
              Math.abs(values[i * 4 + 2] - mb)) /
              3 +
            Math.abs(values[i * 4 + 3] - ma);
        }
        madIn /= n;

        var nw = 0;
        var madWhole = 0;
        for (y = y0; y < y0 + scale; y += wholeStride) {
          var wholeRow = y * w;
          for (x = x0; x < x0 + scale; x += wholeStride) {
            p = (wholeRow + x) << 2;
            var wa = data[p + 3];
            var waf = wa / 255;
            madWhole +=
              (Math.abs(data[p] * waf - mr) +
                Math.abs(data[p + 1] * waf - mg) +
                Math.abs(data[p + 2] * waf - mb)) /
                3 +
              Math.abs(wa - ma);
            nw++;
          }
        }
        madWhole /= Math.max(1, nw);

        var binIn = Math.min(256, Math.round(madIn));
        var binWhole = Math.min(256, Math.round(madWhole));
        innerHist[binIn]++;
        wholeHist[binWhole]++;
        if (binIn <= 16) flatInner++;
        if (binWhole <= 24) flatWhole++;
        sampled++;
      }
    }

    if (!sampled) return null;
    return {
      cells: sampled,
      totalCells: cols * rows,
      innerP50: histogramPercentile(innerHist, sampled, 0.5),
      innerP90: histogramPercentile(innerHist, sampled, 0.9),
      innerP95: histogramPercentile(innerHist, sampled, 0.95),
      wholeP50: histogramPercentile(wholeHist, sampled, 0.5),
      wholeP90: histogramPercentile(wholeHist, sampled, 0.9),
      wholeP95: histogramPercentile(wholeHist, sampled, 0.95),
      purityInner16: flatInner / sampled,
      purityWhole24: flatWhole / sampled,
      coverage: (cols * rows * scale * scale) / (w * h),
    };
  }

  /**
   * Measures strong colour transitions and how many of them fall exactly on
   * candidate cell boundaries. `boundaryEstimate` is corrected for sampled
   * rows/columns so the support threshold behaves the same on large images.
   */
  function gridEdgeStats(image, scale, offsetX, offsetY, options) {
    options = options || {};
    var w = image.width | 0;
    var h = image.height | 0;
    var data = image.data;
    var strongThreshold =
      options.strongThreshold == null ? 28 : Math.max(1, options.strongThreshold);
    var maxPairs = options.maxEdgePairs == null ? 160000 : Math.max(1000, options.maxEdgePairs);
    var totalPairs = h * (w - 1) + w * (h - 1);
    var stride = Math.max(1, Math.ceil(Math.sqrt(totalPairs / maxPairs)));
    var ox = mod(Math.round(offsetX || 0), scale);
    var oy = mod(Math.round(offsetY || 0), scale);
    var horizontalBoundary = 0;
    var horizontalInterior = 0;
    var verticalBoundary = 0;
    var verticalInterior = 0;
    var strong = 0;
    var sampledPairs = 0;
    var x;
    var y;

    for (y = 0; y < h; y += stride) {
      sampledPairs += Math.max(0, w - 1);
      var row = y * w;
      for (x = 0; x < w - 1; x++) {
        var p = (row + x) << 2;
        var a1 = data[p + 3];
        var a2 = data[p + 7];
        var d =
          Math.max(
            Math.abs(data[p] * a1 - data[p + 4] * a2),
            Math.abs(data[p + 1] * a1 - data[p + 5] * a2),
            Math.abs(data[p + 2] * a1 - data[p + 6] * a2)
          ) /
            255 +
          Math.abs(a1 - a2);
        if (d < strongThreshold) continue;
        strong++;
        if (mod(x - ox + 1, scale) === 0) horizontalBoundary++;
        else horizontalInterior++;
      }
    }

    for (x = 0; x < w; x += stride) {
      sampledPairs += Math.max(0, h - 1);
      for (y = 0; y < h - 1; y++) {
        var q = (y * w + x) << 2;
        var q2 = q + w * 4;
        var b1 = data[q + 3];
        var b2 = data[q2 + 3];
        var e =
          Math.max(
            Math.abs(data[q] * b1 - data[q2] * b2),
            Math.abs(data[q + 1] * b1 - data[q2 + 1] * b2),
            Math.abs(data[q + 2] * b1 - data[q2 + 2] * b2)
          ) /
            255 +
          Math.abs(b1 - b2);
        if (e < strongThreshold) continue;
        strong++;
        if (mod(y - oy + 1, scale) === 0) verticalBoundary++;
        else verticalInterior++;
      }
    }

    var boundary = horizontalBoundary + verticalBoundary;
    var interior = horizontalInterior + verticalInterior;
    var edges = boundary + interior;
    var scaleFactor = sampledPairs ? totalPairs / sampledPairs : 1;
    var boundaryEstimate = boundary * scaleFactor;
    return {
      strong: strong,
      boundary: boundary,
      interior: interior,
      alignment: edges ? boundary / edges : null,
      coherence: edges ? (boundary / edges) * scale : null,
      boundaryEstimate: boundaryEstimate,
      support: boundaryEstimate / (w + h),
      stride: stride,
    };
  }

  /**
   * Builds the scales worth verifying. The profile top candidates are cheap
   * and usually contain the true scale; small scales are always measured so a
   * 4x grid cannot hide behind a 16x multiple; divisors and common upscale
   * factors cover weak or blurred profiles.
   */
  function collectGridScales(profiles, preliminary) {
    var maxScale = Math.max(1, Math.min(profiles.maxScale, MAX_GRID_SCALE));
    var all = preliminary.candidates || [];
    var sorted = all.slice().sort(function (a, b) {
      return b.score - a.score;
    });
    var byScale = {};
    var i;
    for (i = 0; i < all.length; i++) byScale[all[i].scale] = all[i];

    var seen = {};
    var list = [];
    function add(scale) {
      scale = Math.round(scale);
      if (scale < 2 || scale > maxScale || seen[scale]) return;
      seen[scale] = true;
      list.push(byScale[scale] || { scale: scale, score: 0 });
    }
    function addDivisors(n) {
      for (var d = 2; d * d <= n; d++) {
        if (n % d === 0) {
          add(d);
          add(n / d);
        }
      }
    }

    for (i = 0; i < Math.min(18, sorted.length); i++) {
      if (sorted[i].score >= 1.08) add(sorted[i].scale);
    }
    for (var small = 2; small <= Math.min(24, maxScale); small++) add(small);
    for (i = 0; i < Math.min(10, sorted.length); i++) addDivisors(sorted[i].scale);
    if (preliminary.scale > 1) add(preliminary.scale);

    var common = [28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 128];
    for (i = 0; i < common.length; i++) add(common[i]);
    return list;
  }

  function gridSuggestions(valid, chosenScale) {
    var out = [1];
    for (var i = 0; i < valid.length && out.length < 6; i++) {
      var s = valid[i].scale;
      if (s !== chosenScale && chosenScale % s !== 0) continue;
      if (out.indexOf(s) === -1) out.push(s);
    }
    out.sort(function (a, b) {
      return a - b;
    });
    return out;
  }

  /**
   * Verifies candidate scales with cell purity and boundary alignment, then
   * picks the largest scale that is genuinely plausible. Exact divisors of a
   * true grid all pass, so the largest accepted scale is the upscale factor.
   */
  function refineDetection(image, profiles, preliminary, options) {
    options = options || {};
    if (options.forceScale != null || profiles.maxScale < 2) {
      if (preliminary && !preliminary.suggestions) {
        preliminary.suggestions = [preliminary.scale || 1];
      }
      return preliminary;
    }

    var all = preliminary.candidates || [];
    if (!all.length) {
      preliminary.suggestions = [1];
      return preliminary;
    }

    var list = collectGridScales(profiles, preliminary);
    var margin = options.marginRatio == null ? 0.25 : options.marginRatio;
    var coverageLimit = options.coverageLimit == null ? 0.5 : options.coverageLimit;
    var minCells = options.minCells == null ? 4 : options.minCells;
    var coherenceLimit = options.coherenceLimit == null ? 0.95 : options.coherenceLimit;
    var supportLimit = options.supportLimit == null ? 3.0 : options.supportLimit;
    var weakSupportLimit = Math.max(supportLimit, 4);
    var minAlignment = options.minAlignment == null ? 0.16 : options.minAlignment;
    var minRingContrast = options.minRingContrast == null ? 7 : options.minRingContrast;
    var weakRingContrast = options.weakRingContrast == null ? 8 : options.weakRingContrast;

    // Scales backed by a meaningful profile peak (or by one of its divisors)
    // are plausible a priori. That is not enough on its own: LANCZOS-style
    // resampling and blur can make an unrelated scale look deceptively flat.
    // Other scales can still win when their cells are exceptionally clean, but
    // they need even stronger boundary support and ring contrast, otherwise a
    // coarse, unrelated scale can look plausible on a blurry native image.
    var i;
    var supported = {};
    for (i = 0; i < all.length; i++) {
      if (all[i].score < 1.08) continue;
      var peak = all[i].scale;
      supported[peak] = true;
      for (var d = 2; d * d <= peak; d++) {
        if (peak % d === 0) {
          supported[d] = true;
          supported[peak / d] = true;
        }
      }
    }

    var measured = [];
    for (i = 0; i < list.length; i++) {
      var c = list[i];
      var s = c.scale;
      var base = offsetsForScale(profiles, s);
      var offsetsSeen = {};
      var search = s <= 8 ? 2 : 1;
      var best = null;
      for (var dy = -search; dy <= search; dy++) {
        for (var dx = -search; dx <= search; dx++) {
          var ox = mod(base.offsetX + dx, s);
          var oy = mod(base.offsetY + dy, s);
          var key = ox + ',' + oy;
          if (offsetsSeen[key]) continue;
          offsetsSeen[key] = true;
          var st = gridCellStats(image, s, ox, oy, { marginRatio: margin });
          if (!st) continue;
          var dist = Math.abs(dx) + Math.abs(dy);
          if (
            !best ||
            st.wholeP90 < best.wholeP90 ||
            (st.wholeP90 === best.wholeP90 && st.innerP90 < best.innerP90) ||
            (st.wholeP90 === best.wholeP90 &&
              st.innerP90 === best.innerP90 &&
              st.coverage > best.coverage + 1e-9) ||
            (st.wholeP90 === best.wholeP90 &&
              st.innerP90 === best.innerP90 &&
              st.coverage === best.coverage &&
              dist < best.dist)
          ) {
            best = {
              scale: s,
              profile: c.score,
              profileSupported: !!supported[s],
              offsetX: ox,
              offsetY: oy,
              dist: dist,
              cells: st.cells,
              totalCells: st.totalCells,
              innerP50: st.innerP50,
              innerP90: st.innerP90,
              innerP95: st.innerP95,
              wholeP50: st.wholeP50,
              wholeP90: st.wholeP90,
              wholeP95: st.wholeP95,
              purityInner16: st.purityInner16,
              purityWhole24: st.purityWhole24,
              coverage: st.coverage,
            };
          }
        }
      }
      if (best) measured.push(best);
    }

    var pure = [];
    for (i = 0; i < measured.length; i++) {
      var m = measured[i];
      var wholeLimit = options.wholeP90Limit == null ? (m.scale <= 8 ? 40 : 34) : options.wholeP90Limit;
      var innerLimit = options.innerP90Limit == null ? (m.scale <= 8 ? 20 : 16) : options.innerP90Limit;
      // A smooth image can have a low whole-cell spread without any real
      // boundary structure. Real blurred pixel art concentrates variation on
      // the cell edges, so when the centre is not perfectly flat the ring
      // must be measurably worse than the centre. On 2-3 px cells there is no
      // separate ring to compare: the inner sample already covers the cell.
      var ringGap = m.wholeP90 - m.innerP90;
      var ringContrast = m.scale <= 3 || m.innerP90 <= 12 || ringGap >= minRingContrast;
      m.ringGap = ringGap;
      if (
        m.wholeP90 <= wholeLimit &&
        m.innerP90 <= innerLimit &&
        ringContrast &&
        m.coverage >= coverageLimit &&
        m.cells >= minCells
      ) {
        pure.push(m);
      }
    }

    var evidenceMaxAlign = 0;
    for (i = 0; i < pure.length; i++) {
      m = pure[i];
      var e = gridEdgeStats(image, m.scale, m.offsetX, m.offsetY, options);
      m.alignment = e.alignment;
      m.coherence = e.coherence;
      m.strong = e.strong;
      m.boundary = e.boundary;
      m.support = e.support;
      m.boundaryEstimate = e.boundaryEstimate;
      // On 2-3 px cells purity is almost meaningless (there is no interior),
      // so a small scale must show strong periodicity on its own, not just
      // inherit support from a larger divisor.
      m.profileBacked = m.scale <= 3 ? m.profile >= 1.08 : m.profileSupported;
      m.requiredSupport = m.profileBacked ? supportLimit : weakSupportLimit;
      if (
        e.alignment != null &&
        e.support >= m.requiredSupport &&
        m.profileBacked &&
        e.strong >= 8 &&
        e.alignment > evidenceMaxAlign
      ) {
        evidenceMaxAlign = e.alignment;
      }
    }

    var alignFloor = Math.max(minAlignment, evidenceMaxAlign * 0.3);
    var valid = [];
    for (i = 0; i < pure.length; i++) {
      m = pure[i];
      var evidence =
        m.profileBacked ||
        (m.scale >= 4 && m.ringGap >= weakRingContrast);
      if (
        m.alignment != null &&
        m.strong >= 8 &&
        evidence &&
        m.alignment >= alignFloor &&
        m.coherence >= coherenceLimit &&
        m.support >= m.requiredSupport
      ) {
        valid.push(m);
      }
    }
    valid.sort(function (a, b) {
      return b.scale - a.scale;
    });
    measured.sort(function (a, b) {
      return b.scale - a.scale;
    });

    var bestProfile = 0;
    for (i = 0; i < all.length; i++) {
      if (all[i].score > bestProfile) bestProfile = all[i].score;
    }

    if (!valid.length) {
      return {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        confidence: 0,
        blockiness: 0,
        profileScore: bestProfile,
        candidates: measured,
        valid: [],
        suggestions: [1],
        auto: true,
        rejected: bestProfile >= 1.08,
      };
    }

    var chosen = valid[0];
    var confidence = clamp(chosen.purityInner16, 0, 1);
    return {
      scale: chosen.scale,
      offsetX: chosen.offsetX,
      offsetY: chosen.offsetY,
      confidence: confidence,
      blockiness: confidence,
      purity: chosen.purityInner16,
      profileScore: chosen.profile,
      alignment: chosen.alignment,
      support: chosen.support,
      candidates: measured,
      valid: valid,
      suggestions: gridSuggestions(valid, chosen.scale),
      auto: true,
      rejected: false,
    };
  }

  function detectGridWithProfiles(profiles, image, options) {
    options = options || {};
    var preliminary = detectGridFromProfiles(profiles, options);
    return refineDetection(image, profiles, preliminary, options);
  }

  function detectGrid(image, options) {
    options = options || {};
    var profiles = buildGridProfiles(image, options);
    return detectGridWithProfiles(profiles, image, options);
  }

  // -------------------------------------------------------------------------
  // 3) Cell sampling (logical pixel reconstruction)
  // -------------------------------------------------------------------------

  function medianU8(buf, n, hist) {
    if (n <= 0) return 0;
    if (n === 1) return buf[0];
    if (n <= 24) {
      for (var i = 1; i < n; i++) {
        var v = buf[i];
        var j = i - 1;
        while (j >= 0 && buf[j] > v) {
          buf[j + 1] = buf[j];
          j--;
        }
        buf[j + 1] = v;
      }
      return buf[n >> 1];
    }
    hist.fill(0);
    for (var k = 0; k < n; k++) hist[buf[k]]++;
    var half = n >> 1;
    for (var c = 0; c < 256; c++) {
      half -= hist[c];
      if (half < 0) return c;
    }
    return 255;
  }

  /**
   * Reconstructs the logical-resolution image.
   * options: {
   *   scale, offsetX, offsetY,
   *   marginRatio = 0.25,     // fraction ignored on each cell edge
   *   alphaThreshold = 128,   // binary alpha cut-off
   *   binaryAlpha = true
   * }
   */
  function sampleCells(image, options) {
    options = options || {};
    var w = image.width | 0;
    var h = image.height | 0;
    var data = image.data;
    if (!w || !h || !data) throw new Error('Dati immagine non validi');

    var scale = clamp(Math.round(options.scale || 1), 1, Math.max(1, Math.min(w, h)));
    var offsetX = mod(Math.round(options.offsetX || 0), scale);
    var offsetY = mod(Math.round(options.offsetY || 0), scale);
    if (offsetX >= w) offsetX = 0;
    if (offsetY >= h) offsetY = 0;

    var marginRatio = clamp(options.marginRatio == null ? 0.25 : options.marginRatio, 0, 0.45);
    var alphaThreshold = clamp(Math.round(options.alphaThreshold == null ? 128 : options.alphaThreshold), 0, 255);
    var binaryAlpha = options.binaryAlpha !== false;

    var cols = Math.max(1, Math.ceil((w - offsetX) / scale));
    var rows = Math.max(1, Math.ceil((h - offsetY) / scale));
    var out = new Uint8ClampedArray(cols * rows * 4);

    var inner = Math.max(1, scale - 2 * Math.floor(scale * marginRatio));
    var maxSamples = inner * inner;
    var bufR = new Uint8Array(maxSamples);
    var bufG = new Uint8Array(maxSamples);
    var bufB = new Uint8Array(maxSamples);
    var bufA = new Uint8Array(maxSamples);
    var hist = new Uint32Array(256);

    for (var cy = 0; cy < rows; cy++) {
      var y0 = offsetY + cy * scale;
      var y1 = Math.min(h, y0 + scale);
      var ch = y1 - y0;
      var insetY = Math.floor(ch * marginRatio);
      var sy0 = y0 + insetY;
      var sy1 = y1 - insetY;
      if (sy1 <= sy0) {
        sy0 = y0;
        sy1 = y1;
      }

      for (var cx = 0; cx < cols; cx++) {
        var x0 = offsetX + cx * scale;
        var x1 = Math.min(w, x0 + scale);
        var cw = x1 - x0;
        var insetX = Math.floor(cw * marginRatio);
        var sx0 = x0 + insetX;
        var sx1 = x1 - insetX;
        if (sx1 <= sx0) {
          sx0 = x0;
          sx1 = x1;
        }

        var n = 0;
        var y, x, p;
        for (y = sy0; y < sy1; y++) {
          var rowOff = y * w;
          p = (rowOff + sx0) * 4 + 3;
          for (x = sx0; x < sx1; x++, p += 4) {
            bufA[n++] = data[p];
          }
        }

        var outIdx = (cy * cols + cx) * 4;
        var alphaMedian = medianU8(bufA, n, hist);

        if (alphaMedian === 0 || (binaryAlpha && alphaMedian < alphaThreshold)) {
          continue; // transparent cell, RGBA stay 0
        }

        // Ignore very transparent border samples when reading the color.
        var minAlpha = Math.max(1, Math.floor(alphaMedian * 0.5));
        var m = 0;
        for (y = sy0; y < sy1; y++) {
          var rowOff2 = y * w;
          p = (rowOff2 + sx0) * 4;
          for (x = sx0; x < sx1; x++, p += 4) {
            if (data[p + 3] >= minAlpha) {
              bufR[m] = data[p];
              bufG[m] = data[p + 1];
              bufB[m] = data[p + 2];
              m++;
            }
          }
        }

        if (m === 0) continue;

        out[outIdx] = medianU8(bufR, m, hist);
        out[outIdx + 1] = medianU8(bufG, m, hist);
        out[outIdx + 2] = medianU8(bufB, m, hist);
        out[outIdx + 3] = binaryAlpha ? 255 : alphaMedian;
      }
    }

    return { width: cols, height: rows, data: out };
  }

  // -------------------------------------------------------------------------
  // 4) Color quantization
  // -------------------------------------------------------------------------

  /**
   * Groups cell colors into 5-bit bins and returns weighted OKLab points.
   */
  function buildColorPoints(cells) {
    var w = cells.width | 0;
    var h = cells.height | 0;
    var data = cells.data;
    var map = new Map();
    var total = w * h;

    for (var i = 0, p = 0; i < total; i++, p += 4) {
      if (data[p + 3] < 8) continue;
      var r = data[p];
      var g = data[p + 1];
      var b = data[p + 2];
      var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      var bin = map.get(key);
      if (!bin) {
        bin = { r: 0, g: 0, b: 0, n: 0 };
        map.set(key, bin);
      }
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.n++;
    }

    var n = map.size;
    var L = new Float64Array(n);
    var A = new Float64Array(n);
    var B = new Float64Array(n);
    var W = new Float64Array(n);
    var R = new Uint8ClampedArray(n);
    var G = new Uint8ClampedArray(n);
    var Bc = new Uint8ClampedArray(n);
    var keys = new Int32Array(n);
    // NOTE: property names are L/A/B for OKLab and Bc for the blue channel.
    var totalOpaque = 0;
    var idx = 0;

    map.forEach(function (bin, key) {
      var r = Math.round(bin.r / bin.n);
      var g = Math.round(bin.g / bin.n);
      var b = Math.round(bin.b / bin.n);
      var lab = rgbToOklab(r, g, b);
      L[idx] = lab.L;
      A[idx] = lab.A;
      B[idx] = lab.B;
      W[idx] = bin.n;
      R[idx] = r;
      G[idx] = g;
      Bc[idx] = b;
      keys[idx] = key;
      totalOpaque += bin.n;
      idx++;
    });

    return {
      count: n,
      L: L,
      A: A,
      B: B,
      W: W,
      R: R,
      G: G,
      Bc: Bc,
      keys: keys,
      totalOpaque: totalOpaque,
    };
  }

  function weightedKMeans(points, k, options) {
    options = options || {};
    var n = points.count;
    var L = points.L;
    var A = points.A;
    var B = points.B;
    var W = points.W;
    var rng = mulberry32(options.seed == null ? 0x5eed1234 : options.seed);
    var assignments = new Int32Array(n);
    var centroids = new Float64Array(k * 3);

    if (k <= 1) {
      var sw = 0;
      var sl = 0;
      var sa = 0;
      var sb = 0;
      for (var q = 0; q < n; q++) {
        sw += W[q];
        sl += L[q] * W[q];
        sa += A[q] * W[q];
        sb += B[q] * W[q];
      }
      if (!sw) sw = 1;
      centroids[0] = sl / sw;
      centroids[1] = sa / sw;
      centroids[2] = sb / sw;
      assignments.fill(0);
      return { centroids: centroids, assignments: assignments, iterations: 0 };
    }

    // k-means++ initialization (weighted, deterministic).
    var first = 0;
    for (var f = 1; f < n; f++) if (W[f] > W[first]) first = f;
    centroids[0] = L[first];
    centroids[1] = A[first];
    centroids[2] = B[first];

    var minD2 = new Float64Array(n);
    minD2.fill(Infinity);
    for (var c = 1; c < k; c++) {
      var pl = centroids[(c - 1) * 3];
      var pa = centroids[(c - 1) * 3 + 1];
      var pb = centroids[(c - 1) * 3 + 2];
      var sum = 0;
      for (var i = 0; i < n; i++) {
        var d2 = oklabDist2(L[i], A[i], B[i], pl, pa, pb);
        if (d2 < minD2[i]) minD2[i] = d2;
        sum += minD2[i] * W[i];
      }
      var pick = -1;
      if (sum > 0) {
        var target = rng() * sum;
        for (var j = 0; j < n; j++) {
          target -= minD2[j] * W[j];
          if (target <= 0 && minD2[j] > 0) {
            pick = j;
            break;
          }
        }
      }
      if (pick < 0) {
        var bestD = -1;
        for (var b2 = 0; b2 < n; b2++) {
          if (minD2[b2] > bestD) {
            bestD = minD2[b2];
            pick = b2;
          }
        }
      }
      centroids[c * 3] = L[pick];
      centroids[c * 3 + 1] = A[pick];
      centroids[c * 3 + 2] = B[pick];
    }

    var maxIter = options.maxIterations == null ? 24 : options.maxIterations;
    var sumW = new Float64Array(k);
    var sumL = new Float64Array(k);
    var sumA = new Float64Array(k);
    var sumB = new Float64Array(k);

    for (var iter = 0; iter < maxIter; iter++) {
      sumW.fill(0);
      sumL.fill(0);
      sumA.fill(0);
      sumB.fill(0);

      for (var pi = 0; pi < n; pi++) {
        var bestC = 0;
        var bestDist = Infinity;
        var li = L[pi];
        var ai = A[pi];
        var bi = B[pi];
        for (var ci = 0; ci < k; ci++) {
          var cl = centroids[ci * 3];
          var ca = centroids[ci * 3 + 1];
          var cb = centroids[ci * 3 + 2];
          var dl = li - cl;
          var da = ai - ca;
          var db = bi - cb;
          var dd = dl * dl + da * da + db * db;
          if (dd < bestDist) {
            bestDist = dd;
            bestC = ci;
          }
        }
        assignments[pi] = bestC;
        var weight = W[pi];
        sumW[bestC] += weight;
        sumL[bestC] += li * weight;
        sumA[bestC] += ai * weight;
        sumB[bestC] += bi * weight;
      }

      var maxMove = 0;
      for (var cc = 0; cc < k; cc++) {
        var nw = sumW[cc];
        if (nw <= 0) {
          // Re-seed an empty cluster at the point with the largest weighted
          // distance from its current centre.
          var far = -1;
          var farD = -1;
          for (var pp = 0; pp < n; pp++) {
            var center = assignments[pp];
            var ddx = L[pp] - centroids[center * 3];
            var ddy = A[pp] - centroids[center * 3 + 1];
            var ddz = B[pp] - centroids[center * 3 + 2];
            var score = (ddx * ddx + ddy * ddy + ddz * ddz) * W[pp];
            if (score > farD) {
              farD = score;
              far = pp;
            }
          }
          if (far >= 0) {
            centroids[cc * 3] = L[far];
            centroids[cc * 3 + 1] = A[far];
            centroids[cc * 3 + 2] = B[far];
          }
          continue;
        }
        var nl = sumL[cc] / nw;
        var na = sumA[cc] / nw;
        var nb = sumB[cc] / nw;
        var move =
          Math.abs(nl - centroids[cc * 3]) +
          Math.abs(na - centroids[cc * 3 + 1]) +
          Math.abs(nb - centroids[cc * 3 + 2]);
        if (move > maxMove) maxMove = move;
        centroids[cc * 3] = nl;
        centroids[cc * 3 + 1] = na;
        centroids[cc * 3 + 2] = nb;
      }
      if (maxMove < 1e-5) break;
    }

    return { centroids: centroids, assignments: assignments, iterations: iter };
  }

  function clustersFromAssignments(points, assignments, k, centroids) {
    var L = points.L;
    var A = points.A;
    var B = points.B;
    var W = points.W;
    var R = points.R;
    var G = points.G;
    var Blue = points.Bc;
    var clusters = [];
    for (var c = 0; c < k; c++) {
      clusters.push({
        L: centroids[c * 3],
        A: centroids[c * 3 + 1],
        B: centroids[c * 3 + 2],
        w: 0,
        r: 0,
        g: 0,
        b: 0,
        bins: 0,
      });
    }
    for (var i = 0; i < points.count; i++) {
      var cl = clusters[assignments[i]];
      var w = W[i];
      cl.w += w;
      cl.r += R[i] * w;
      cl.g += G[i] * w;
      cl.b += Blue[i] * w;
      cl.bins++;
    }
    // Drop empty clusters.
    var out = [];
    for (var j = 0; j < clusters.length; j++) {
      if (clusters[j].w > 0) out.push(clusters[j]);
    }
    return out;
  }

  /** Merges palette entries closer than threshold (OKLab), nearest first. */
  function mergeClusters(clusters, threshold) {
    threshold = threshold == null ? 0.035 : Math.max(0, threshold);
    var t2 = threshold * threshold;
    var list = clusters.map(function (c) {
      return {
        L: c.L,
        A: c.A,
        B: c.B,
        w: c.w,
        r: c.r,
        g: c.g,
        b: c.b,
        bins: c.bins,
      };
    });

    while (list.length > 1) {
      var bestI = -1;
      var bestJ = -1;
      var bestDist = Infinity;
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var d2 = oklabDist2(list[i].L, list[i].A, list[i].B, list[j].L, list[j].A, list[j].B);
          if (d2 < bestDist) {
            bestDist = d2;
            bestI = i;
            bestJ = j;
          }
        }
      }
      if (bestDist >= t2) break;
      var a = list[bestI];
      var b = list[bestJ];
      var w = a.w + b.w;
      if (w <= 0) w = 1;
      a.L = (a.L * a.w + b.L * b.w) / w;
      a.A = (a.A * a.w + b.A * b.w) / w;
      a.B = (a.B * a.w + b.B * b.w) / w;
      a.r += b.r;
      a.g += b.g;
      a.b += b.b;
      a.w = w;
      a.bins += b.bins;
      list.splice(bestJ, 1);
    }
    return list;
  }

  function refineClusters(points, clusters, iterations) {
    var n = points.count;
    var L = points.L;
    var A = points.A;
    var B = points.B;
    var W = points.W;
    var R = points.R;
    var G = points.G;
    var Blue = points.Bc;

    for (var it = 0; it < iterations; it++) {
      var k = clusters.length;
      var sumW = new Float64Array(k);
      var sumL = new Float64Array(k);
      var sumA = new Float64Array(k);
      var sumB = new Float64Array(k);
      var sumR = new Float64Array(k);
      var sumG = new Float64Array(k);
      var sumBc = new Float64Array(k);
      var bins = new Uint32Array(k);

      for (var i = 0; i < n; i++) {
        var bestC = 0;
        var bestDist = Infinity;
        for (var c = 0; c < k; c++) {
          var d2 = oklabDist2(L[i], A[i], B[i], clusters[c].L, clusters[c].A, clusters[c].B);
          if (d2 < bestDist) {
            bestDist = d2;
            bestC = c;
          }
        }
        var w = W[i];
        sumW[bestC] += w;
        sumL[bestC] += L[i] * w;
        sumA[bestC] += A[i] * w;
        sumB[bestC] += B[i] * w;
        sumR[bestC] += R[i] * w;
        sumG[bestC] += G[i] * w;
        sumBc[bestC] += Blue[i] * w;
        bins[bestC]++;
      }

      for (var j = 0; j < k; j++) {
        if (sumW[j] <= 0) continue;
        clusters[j].L = sumL[j] / sumW[j];
        clusters[j].A = sumA[j] / sumW[j];
        clusters[j].B = sumB[j] / sumW[j];
        clusters[j].w = sumW[j];
        clusters[j].r = sumR[j];
        clusters[j].g = sumG[j];
        clusters[j].b = sumBc[j];
        clusters[j].bins = bins[j];
      }
    }
    return clusters.filter(function (c) {
      return c.w > 0;
    });
  }

  function finalizeClusters(points, clusters) {
    var n = points.count;
    var k = clusters.length;
    var L = points.L;
    var A = points.A;
    var B = points.B;
    var W = points.W;
    var R = points.R;
    var G = points.G;
    var Blue = points.Bc;
    var assignment = new Int32Array(n);
    var sumW = new Float64Array(k);
    var sumR = new Float64Array(k);
    var sumG = new Float64Array(k);
    var sumB = new Float64Array(k);

    for (var i = 0; i < n; i++) {
      var bestC = 0;
      var bestDist = Infinity;
      for (var c = 0; c < k; c++) {
        var d2 = oklabDist2(L[i], A[i], B[i], clusters[c].L, clusters[c].A, clusters[c].B);
        if (d2 < bestDist) {
          bestDist = d2;
          bestC = c;
        }
      }
      assignment[i] = bestC;
      var w = W[i];
      sumW[bestC] += w;
      sumR[bestC] += R[i] * w;
      sumG[bestC] += G[i] * w;
      sumB[bestC] += Blue[i] * w;
    }

    var palette = [];
    var remap = new Int16Array(k).fill(-1);
    for (var j = 0; j < k; j++) {
      if (sumW[j] <= 0) continue;
      remap[j] = palette.length;
      palette.push({
        r: Math.round(sumR[j] / sumW[j]),
        g: Math.round(sumG[j] / sumW[j]),
        b: Math.round(sumB[j] / sumW[j]),
        count: sumW[j],
      });
    }

    for (var a = 0; a < n; a++) assignment[a] = remap[assignment[a]];

    // Map each 5-bit color bin to its palette index.
    var keyToPalette = new Map();
    for (var p = 0; p < n; p++) keyToPalette.set(points.keys[p], assignment[p]);

    return { palette: palette, keyToPalette: keyToPalette, assignment: assignment };
  }

  /**
   * Quantizes the logical image.
   * options: {
   *   mode: 'auto' | 'manual',
   *   colors: 16,             // manual palette size
   *   mergeThreshold: 0.035,  // auto mode OKLab merge distance
   *   maxAutoColors: 32,
   *   seed: 12345
   * }
   */
  function quantize(cells, options) {
    options = options || {};
    var width = cells.width | 0;
    var height = cells.height | 0;
    var data = cells.data;
    var total = width * height;
    var alpha = new Uint8Array(total);
    var indices = new Int16Array(total);
    indices.fill(-1);
    var i;
    var p = 0;

    for (i = 0, p = 0; i < total; i++, p += 4) {
      alpha[i] = data[p + 3];
    }

    var points = buildColorPoints(cells);
    if (points.count === 0) {
      return { width: width, height: height, indices: indices, alpha: alpha, palette: [] };
    }

    var mode = options.mode === 'manual' ? 'manual' : 'auto';
    var k;
    if (mode === 'manual') {
      var requested = Math.round(options.colors == null ? 16 : options.colors);
      k = clamp(requested, 1, Math.min(256, points.count));
    } else {
      k = Math.min(Math.max(2, options.maxAutoColors || 32), points.count);
    }

    var clusters;
    if (k <= 1) {
      clusters = [
        {
          L: 0,
          A: 0,
          B: 0,
          w: 0,
          r: 0,
          g: 0,
          b: 0,
          bins: 0,
        },
      ];
      // Weighted mean for a single color.
      for (var q = 0; q < points.count; q++) {
        var wq = points.W[q];
        clusters[0].w += wq;
        clusters[0].L += points.L[q] * wq;
        clusters[0].A += points.A[q] * wq;
        clusters[0].B += points.B[q] * wq;
        clusters[0].r += points.R[q] * wq;
        clusters[0].g += points.G[q] * wq;
        clusters[0].b += points.Bc[q] * wq;
      }
      if (clusters[0].w <= 0) clusters[0].w = 1;
      clusters[0].L /= clusters[0].w;
      clusters[0].A /= clusters[0].w;
      clusters[0].B /= clusters[0].w;
    } else {
      var km = weightedKMeans(points, k, { seed: options.seed == null ? 0x51ed270b : options.seed });
      clusters = clustersFromAssignments(points, km.assignments, k, km.centroids);
      if (mode === 'auto') {
        clusters = mergeClusters(clusters, options.mergeThreshold == null ? 0.025 : options.mergeThreshold);
        clusters = refineClusters(points, clusters, 4);
      }
    }

    var finalized = finalizeClusters(points, clusters);

    // Quantize cells via their 5-bit color bin. This is fast and consistent.
    for (i = 0, p = 0; i < total; i++, p += 4) {
      if (alpha[i] < 8) continue;
      var key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3);
      var pi = finalized.keyToPalette.get(key);
      if (pi == null || pi < 0) pi = 0;
      indices[i] = pi;
    }

    return {
      width: width,
      height: height,
      indices: indices,
      alpha: alpha,
      palette: finalized.palette,
      mode: mode,
      autoColors: mode === 'auto' ? finalized.palette.length : null,
    };
  }

  // -------------------------------------------------------------------------
  // 5) Despeckle + palette compaction
  // -------------------------------------------------------------------------

  function dominantNeighbor(nb, n, exclude) {
    var mode = nb[0];
    var modeCount = 0;
    for (var a = 0; a < n; a++) {
      var c = 0;
      for (var b = 0; b < n; b++) {
        if (nb[b] === nb[a]) c++;
      }
      if (c > modeCount) {
        modeCount = c;
        mode = nb[a];
      }
    }
    if (exclude != null && mode === exclude && modeCount < n) {
      // Prefer a different dominant color when the current one is a tie.
      var alt = mode;
      var altCount = 0;
      for (var i = 0; i < n; i++) {
        if (nb[i] === exclude) continue;
        var cc = 0;
        for (var j = 0; j < n; j++) if (nb[j] === nb[i]) cc++;
        if (cc > altCount) {
          altCount = cc;
          alt = nb[i];
        }
      }
      if (altCount > 0) {
        mode = alt;
        modeCount = altCount;
      }
    }
    return { mode: mode, count: modeCount };
  }

  /**
   * Removes isolated logical pixels, without eroding 1px lines: a pixel is
   * only removed when it has no neighbour of its own color.
   * strength: 0 = off, 1 = light (single pixels), 2 = strong (also 2px specks).
   * Transparency (-1) counts as a color.
   */
  function despeckle(indices, width, height, strength) {
    strength = Math.round(strength || 0);
    var src = indices.slice();
    if (strength <= 0) return src;

    var dst = src.slice();
    var nb = new Int16Array(8);
    var y, x, dy, dx;

    // Pass 1: strictly isolated pixels (zero same-color neighbours).
    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        var idx = src[y * width + x];
        if (idx < 0) continue;

        var n = 0;
        var same = 0;
        for (dy = -1; dy <= 1; dy++) {
          var yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            var nv = src[yy * width + xx];
            nb[n++] = nv;
            if (nv === idx) same++;
          }
        }
        if (n < 3 || same > 0) continue;

        var dom = dominantNeighbor(nb, n, idx);
        if (dom.mode !== idx && dom.count / n >= 0.5) {
          dst[y * width + x] = dom.mode;
        }
      }
    }

    if (strength < 2) return dst;

    // Pass 2 (strong): remove 2-pixel specks as a whole. Lines and larger
    // details are left untouched, because only components of size <= 2 are
    // considered and their surrounding must be dominated by one colour.
    src = dst;
    dst = src.slice();
    var visited = new Uint8Array(width * height);
    var stack = new Int32Array(width * height);

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        var start = y * width + x;
        if (visited[start]) continue;
        var color = src[start];
        visited[start] = 1;
        if (color < 0) continue;

        var top = 0;
        stack[top++] = start;
        var comp = [];
        var tooBig = false;

        while (top > 0) {
          var cur = stack[--top];
          if (!tooBig) {
            comp.push(cur);
            if (comp.length > 2) {
              tooBig = true;
              comp = null;
            }
          }
          var cx = cur % width;
          var cy = (cur / width) | 0;
          for (var k = 0; k < 4; k++) {
            var nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0);
            var ny = cy + (k === 2 ? -1 : k === 3 ? 1 : 0);
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            var ni = ny * width + nx;
            if (visited[ni] || src[ni] !== color) continue;
            visited[ni] = 1;
            stack[top++] = ni;
          }
        }

        if (tooBig || !comp || comp.length > 2) continue;

        // Dominant colour around the small component.
        var counts = new Map();
        var border = 0;
        for (var ci = 0; ci < comp.length; ci++) {
          var p = comp[ci];
          var px = p % width;
          var py = (p / width) | 0;
          for (dy = -1; dy <= 1; dy++) {
            var oy = py + dy;
            if (oy < 0 || oy >= height) continue;
            for (dx = -1; dx <= 1; dx++) {
              var ox = px + dx;
              if (ox < 0 || ox >= width) continue;
              var oi = oy * width + ox;
              if (src[oi] === color) continue;
              border++;
              counts.set(src[oi], (counts.get(src[oi]) || 0) + 1);
            }
          }
        }
        if (border < 4) continue;
        var mode = color;
        var modeCount = 0;
        counts.forEach(function (cnt, col) {
          if (cnt > modeCount) {
            modeCount = cnt;
            mode = col;
          }
        });
        if (mode !== color && modeCount / border >= 0.65) {
          for (var ri = 0; ri < comp.length; ri++) dst[comp[ri]] = mode;
        }
      }
    }

    return dst;
  }

  /**
   * Drops unused palette entries, recomputes usage and sorts by frequency.
   */
  function compactPalette(indices, palette) {
    var counts = new Uint32Array(palette.length);
    var i;
    for (i = 0; i < indices.length; i++) {
      var idx = indices[i];
      if (idx >= 0 && idx < counts.length) counts[idx]++;
    }

    var order = [];
    for (i = 0; i < palette.length; i++) {
      if (counts[i] > 0) order.push({ old: i, count: counts[i] });
    }
    order.sort(function (a, b) {
      return b.count - a.count || a.old - b.old;
    });

    var remap = new Int16Array(palette.length).fill(-1);
    var outPalette = new Array(order.length);
    for (i = 0; i < order.length; i++) {
      var old = order[i].old;
      remap[old] = i;
      var c = palette[old];
      outPalette[i] = {
        r: c.r,
        g: c.g,
        b: c.b,
        count: order[i].count,
        hex: rgbToHex(c.r, c.g, c.b),
      };
    }

    var outIndices = new Int16Array(indices.length);
    for (i = 0; i < indices.length; i++) {
      var v = indices[i];
      outIndices[i] = v >= 0 ? remap[v] : -1;
    }
    return { indices: outIndices, palette: outPalette };
  }

  // -------------------------------------------------------------------------
  // 6) Compose / upscale
  // -------------------------------------------------------------------------

  function composeImageData(indices, palette, width, height, alpha) {
    var out = new Uint8ClampedArray(width * height * 4);
    for (var i = 0, p = 0; i < width * height; i++, p += 4) {
      var idx = indices[i];
      if (idx < 0) continue;
      var c = palette[idx] || palette[0];
      out[p] = c.r;
      out[p + 1] = c.g;
      out[p + 2] = c.b;
      out[p + 3] = alpha ? alpha[i] : 255;
    }
    return { width: width, height: height, data: out };
  }

  function upscaleImageData(image, factor) {
    var f = Math.max(1, Math.round(factor || 1));
    var w = image.width | 0;
    var h = image.height | 0;
    if (f === 1) {
      return {
        width: w,
        height: h,
        data: new Uint8ClampedArray(image.data),
      };
    }
    var outW = w * f;
    var outH = h * f;
    var out = new Uint8ClampedArray(outW * outH * 4);
    var src = image.data;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var si = (y * w + x) * 4;
        var r = src[si];
        var g = src[si + 1];
        var b = src[si + 2];
        var a = src[si + 3];
        for (var dy = 0; dy < f; dy++) {
          var di = ((y * f + dy) * outW + x * f) * 4;
          for (var dx = 0; dx < f; dx++, di += 4) {
            out[di] = r;
            out[di + 1] = g;
            out[di + 2] = b;
            out[di + 3] = a;
          }
        }
      }
    }
    return { width: outW, height: outH, data: out };
  }

  /**
   * Nearest-neighbour resize to arbitrary dimensions. Keeps hard pixel edges
   * and the original palette, so a reduced export still looks like pixel art.
   */
  function resizeImageDataNearest(image, width, height) {
    var srcW = Math.max(1, image.width | 0);
    var srcH = Math.max(1, image.height | 0);
    var outW = Math.max(1, Math.round(width) || 1);
    var outH = Math.max(1, Math.round(height) || 1);
    if (outW === srcW && outH === srcH) {
      return {
        width: srcW,
        height: srcH,
        data: new Uint8ClampedArray(image.data),
      };
    }
    var src = image.data;
    var out = new Uint8ClampedArray(outW * outH * 4);
    for (var y = 0; y < outH; y++) {
      var sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / outH));
      for (var x = 0; x < outW; x++) {
        var sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / outW));
        var si = (sy * srcW + sx) * 4;
        var di = (y * outW + x) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
    return { width: outW, height: outH, data: out };
  }

  /**
   * Resizes an indexed image to arbitrary dimensions while keeping its
   * palette. The visible content (alpha bounds, or the whole canvas with
   * `fit: 'canvas'`) is fitted inside the target with a margin.
   *
   * `area` averages the opaque source pixels covered by every output pixel
   * and maps the average back to the nearest palette entry, which keeps the
   * image readable when the reduction factor is not an integer.
   * `nearest` samples the centre of the cell and preserves the exact colours.
   *
   * Output alpha is binary: a pixel is visible when the covered opacity is at
   * least `alphaThreshold` (0..1). The input arrays are never modified.
   */
  function resizeIndexed(indices, alpha, width, height, palette, options) {
    options = options || {};
    var srcW = Math.max(0, width | 0);
    var srcH = Math.max(0, height | 0);
    var srcTotal = srcW * srcH;
    var outW = clamp(
      Math.round(options.width == null ? srcW : options.width),
      1,
      RESIZE_MAX_SIDE
    );
    var outH = clamp(
      Math.round(options.height == null ? srcH : options.height),
      1,
      RESIZE_MAX_SIDE
    );
    var method = options.method === 'nearest' ? 'nearest' : 'area';
    var margin = clamp(Math.round(options.margin == null ? 2 : options.margin), 0, 16);
    var alphaThreshold = clamp(
      options.alphaThreshold == null ? 0.3 : Number(options.alphaThreshold),
      0,
      1
    );
    var maxPixels =
      options.maxPixels == null
        ? RESIZE_MAX_PIXELS
        : Math.max(1, Math.round(options.maxPixels));
    var out = {
      width: outW,
      height: outH,
      indices: new Int16Array(0),
      alpha: new Uint8Array(0),
      palette: palette ? palette.slice() : [],
      sourceWidth: srcW,
      sourceHeight: srcH,
      contentWidth: 0,
      contentHeight: 0,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      method: method,
      margin: margin,
      alphaThreshold: alphaThreshold,
      skipped: false,
      reason: '',
    };

    if (
      !srcW ||
      !srcH ||
      !indices ||
      indices.length < srcTotal ||
      !palette ||
      !palette.length
    ) {
      out.skipped = true;
      out.reason = 'input';
      return out;
    }
    if (outW * outH > maxPixels) {
      out.skipped = true;
      out.reason = 'size';
      return out;
    }

    var total = outW * outH;
    var outIndices = new Int16Array(total);
    outIndices.fill(-1);
    var outAlpha = new Uint8Array(total);
    out.indices = outIndices;
    out.alpha = outAlpha;

    var i;
    var x;
    var y;
    var sx;
    var sy;
    var srcIndex;
    var srcAlpha;
    var minX = srcW;
    var minY = srcH;
    var maxX = -1;
    var maxY = -1;
    var visible = false;

    for (y = 0; y < srcH; y++) {
      for (x = 0; x < srcW; x++) {
        i = y * srcW + x;
        srcAlpha = alpha ? alpha[i] : indices[i] >= 0 ? 255 : 0;
        if (srcAlpha < 8 || indices[i] < 0) continue;
        visible = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!visible) return out;

    var bx = options.fit === 'canvas' ? 0 : minX;
    var by = options.fit === 'canvas' ? 0 : minY;
    var bw = options.fit === 'canvas' ? srcW : maxX - minX + 1;
    var bh = options.fit === 'canvas' ? srcH : maxY - minY + 1;

    margin = clamp(margin, 0, Math.floor((Math.min(outW, outH) - 1) / 2));
    out.margin = margin;
    var scale = Math.min((outW - 2 * margin) / bw, (outH - 2 * margin) / bh);
    var contentW = Math.max(
      1,
      Math.min(outW - 2 * margin, Math.round(bw * scale))
    );
    var contentH = Math.max(
      1,
      Math.min(outH - 2 * margin, Math.round(bh * scale))
    );
    var offsetX = Math.floor((outW - contentW) / 2);
    var offsetY = Math.floor((outH - contentH) / 2);
    out.contentWidth = contentW;
    out.contentHeight = contentH;
    out.offsetX = offsetX;
    out.offsetY = offsetY;
    out.scale = contentW / bw;

    var labs = null;
    if (method === 'area') {
      labs = new Array(palette.length);
      for (i = 0; i < palette.length; i++) {
        var entry = palette[i];
        labs[i] = entry ? rgbToOklab(entry.r, entry.g, entry.b) : null;
      }
    }
    var colorCache = method === 'area' ? new Map() : null;

    for (y = 0; y < contentH; y++) {
      var fy0 = by + (y * bh) / contentH;
      var fy1 = by + ((y + 1) * bh) / contentH;
      for (x = 0; x < contentW; x++) {
        var fx0 = bx + (x * bw) / contentW;
        var fx1 = bx + ((x + 1) * bw) / contentW;
        var outIndex = (y + offsetY) * outW + (x + offsetX);

        if (method === 'nearest') {
          sx = Math.min(bx + bw - 1, Math.floor((fx0 + fx1) * 0.5));
          sy = Math.min(by + bh - 1, Math.floor((fy0 + fy1) * 0.5));
          srcIndex = sy * srcW + sx;
          if (indices[srcIndex] < 0) continue;
          srcAlpha = alpha ? alpha[srcIndex] : 255;
          if (srcAlpha / 255 < alphaThreshold) continue;
          outIndices[outIndex] = indices[srcIndex];
          outAlpha[outIndex] = 255;
          continue;
        }

        var area = (fx1 - fx0) * (fy1 - fy0);
        if (area <= 0) continue;
        var sumR = 0;
        var sumG = 0;
        var sumB = 0;
        var sumA = 0;
        var firstSx = Math.floor(fx0);
        var lastSx = Math.ceil(fx1);
        var firstSy = Math.floor(fy0);
        var lastSy = Math.ceil(fy1);

        for (sy = firstSy; sy < lastSy; sy++) {
          if (sy < 0 || sy >= srcH) continue;
          var wy = Math.min(sy + 1, fy1) - Math.max(sy, fy0);
          if (wy <= 0) continue;
          for (sx = firstSx; sx < lastSx; sx++) {
            if (sx < 0 || sx >= srcW) continue;
            var wx = Math.min(sx + 1, fx1) - Math.max(sx, fx0);
            if (wx <= 0) continue;
            srcIndex = sy * srcW + sx;
            var index = indices[srcIndex];
            if (index < 0) continue;
            srcAlpha = alpha ? alpha[srcIndex] : 255;
            if (srcAlpha <= 0) continue;
            var weight = wx * wy * (srcAlpha / 255);
            var color = palette[index];
            if (!color) continue;
            sumR += color.r * weight;
            sumG += color.g * weight;
            sumB += color.b * weight;
            sumA += weight;
          }
        }
        if (sumA <= 0 || sumA / area < alphaThreshold) continue;

        var rr = Math.round(sumR / sumA);
        var gg = Math.round(sumG / sumA);
        var bb = Math.round(sumB / sumA);
        var key = (rr << 16) | (gg << 8) | bb;
        var paletteIndex = colorCache.get(key);
        if (paletteIndex == null) {
          var lab = rgbToOklab(rr, gg, bb);
          paletteIndex = 0;
          var best = Infinity;
          for (i = 0; i < labs.length; i++) {
            if (!labs[i]) continue;
            var distance = oklabDist2(
              lab.L,
              lab.A,
              lab.B,
              labs[i].L,
              labs[i].A,
              labs[i].B
            );
            if (distance < best) {
              best = distance;
              paletteIndex = i;
            }
          }
          colorCache.set(key, paletteIndex);
        }
        outIndices[outIndex] = paletteIndex;
        outAlpha[outIndex] = 255;
      }
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // 7) Pixel-art diagnostics (read-only)
  // -------------------------------------------------------------------------

  var LINT_MAX_PIXELS = 262144;
  var PALETTE_LOW_DISTANCE = 0.06;
  var PALETTE_NEAR_DISTANCE = 0.035;

  function relativeLuminance(color) {
    return (
      0.2126 * SRGB_LINEAR[color.r | 0] +
      0.7152 * SRGB_LINEAR[color.g | 0] +
      0.0722 * SRGB_LINEAR[color.b | 0]
    );
  }

  function hueDistance(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function roundTo(value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  }

  /**
   * Analyses the palette in HSL/OKLab without changing indices or colors.
   *
   * Reports:
   *   - palette HSL summary: used colors, hue families, saturation/lightness
   *     range and the number of distinct lightness bands;
   *   - near-duplicate palette pairs (OKLab distance below a small threshold);
   *   - adjacent-color contrast: the share of 4-neighbour boundaries whose two
   *     colors are perceptually distinguishable, plus a mask for the weak ones.
   *
   * The default weak-contrast threshold is an OKLab distance of 0.06. This is
   * deliberately advisory: close shading steps are a legitimate artistic
   * choice, so the caller can change lowDistance/nearDistance via options.
   */
  function analyzePalette(indices, width, height, palette, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    var lowDistance =
      options.lowDistance == null
        ? PALETTE_LOW_DISTANCE
        : Math.max(0, Number(options.lowDistance) || 0);
    var nearDistance =
      options.nearDistance == null
        ? PALETTE_NEAR_DISTANCE
        : Math.max(0, Number(options.nearDistance) || 0);

    var out = {
      width: Math.max(0, w),
      height: Math.max(0, h),
      colors: 0,
      hues: 0,
      saturation: { min: null, max: null, average: null },
      lightness: { min: null, max: null, average: null, spread: null },
      valueBins: 0,
      flat: false,
      nearDuplicates: [],
      nearDuplicateCount: 0,
      contrast: {
        edges: 0,
        pairs: 0,
        lowPairs: 0,
        lowEdges: 0,
        score: null,
        minDistance: null,
        averageDistance: null,
        minRatio: null,
        averageRatio: null,
        threshold: lowDistance,
        mask: new Uint8Array(total > 0 ? total : 0),
        worst: [],
        skipped: false,
      },
      skipped: false,
    };

    if (
      !total ||
      !indices ||
      indices.length < total ||
      !palette ||
      !palette.length ||
      total > maxPixels
    ) {
      out.skipped = true;
      out.contrast.skipped = true;
      return out;
    }

    var n = palette.length;
    var usage = new Uint32Array(n);
    var used = new Uint8Array(n);
    var x, y, i, a, b, k, key, count;
    var usedCount = 0;

    for (i = 0; i < total; i++) {
      k = indices[i];
      if (k >= 0 && k < n) usage[k]++;
    }

    var hsl = new Array(n);
    var oklab = new Array(n);
    var luminance = new Float64Array(n);
    for (i = 0; i < n; i++) {
      if (!usage[i]) continue;
      used[i] = 1;
      usedCount++;
      var color = palette[i];
      hsl[i] = rgbToHsl(color.r, color.g, color.b);
      oklab[i] = rgbToOklab(color.r, color.g, color.b);
      luminance[i] = relativeLuminance(color);
    }

    out.colors = usedCount;
    if (!usedCount) {
      out.contrast.skipped = true;
      return out;
    }

    var minS = Infinity;
    var maxS = -Infinity;
    var sumS = 0;
    var minL = Infinity;
    var maxL = -Infinity;
    var sumL = 0;
    var hueBins = {};
    var valueBins = {};
    var hueBinCount = 0;
    var valueBinCount = 0;

    for (i = 0; i < n; i++) {
      if (!used[i]) continue;
      var hValue = hsl[i].h;
      var sValue = hsl[i].s;
      var lValue = hsl[i].l;
      if (sValue < minS) minS = sValue;
      if (sValue > maxS) maxS = sValue;
      if (lValue < minL) minL = lValue;
      if (lValue > maxL) maxL = lValue;
      sumS += sValue;
      sumL += lValue;

      if (sValue >= 10) {
        k = Math.floor(mod(hValue, 360) / 30) % 12;
        if (!hueBins[k]) {
          hueBins[k] = 1;
          hueBinCount++;
        }
      }
      k = Math.min(9, Math.floor(lValue / 10));
      if (!valueBins[k]) {
        valueBins[k] = 1;
        valueBinCount++;
      }
    }

    out.hues = hueBinCount;
    out.saturation.min = roundTo(minS, 1);
    out.saturation.max = roundTo(maxS, 1);
    out.saturation.average = roundTo(sumS / usedCount, 1);
    out.lightness.min = roundTo(minL, 1);
    out.lightness.max = roundTo(maxL, 1);
    out.lightness.average = roundTo(sumL / usedCount, 1);
    out.lightness.spread = roundTo(maxL - minL, 1);
    out.valueBins = valueBinCount;
    out.flat = usedCount >= 3 && out.lightness.spread < 30;

    var distanceMatrix = new Float64Array(n * n);
    var ratioMatrix = new Float64Array(n * n);
    var lowMatrix = new Uint8Array(n * n);
    var nearPairs = [];
    var nearCount = 0;

    for (a = 0; a < n; a++) {
      if (!used[a]) continue;
      for (b = a + 1; b < n; b++) {
        if (!used[b]) continue;
        key = a * n + b;
        var distance = Math.sqrt(
          oklabDist2(oklab[a].L, oklab[a].A, oklab[a].B, oklab[b].L, oklab[b].A, oklab[b].B)
        );
        var lighter = Math.max(luminance[a], luminance[b]);
        var darker = Math.min(luminance[a], luminance[b]);
        var ratio = (lighter + 0.05) / (darker + 0.05);
        distanceMatrix[key] = distance;
        ratioMatrix[key] = ratio;
        if (distance < lowDistance) lowMatrix[key] = 1;

        if (distance <= nearDistance) {
          nearCount++;
          if (nearPairs.length < 32) {
            nearPairs.push({
              a: a,
              b: b,
              distance: roundTo(distance, 4),
              deltaL: roundTo(Math.abs(hsl[a].l - hsl[b].l), 1),
              deltaH: roundTo(hueDistance(hsl[a].h, hsl[b].h), 1),
              ratio: roundTo(ratio, 2),
            });
          }
        }
      }
    }

    nearPairs.sort(function (p, q) {
      return p.distance - q.distance || p.a - q.a || p.b - q.b;
    });
    out.nearDuplicates = nearPairs;
    out.nearDuplicateCount = nearCount;

    var pairCounts = new Uint32Array(n * n);
    var mask = out.contrast.mask;
    var edges = 0;
    var lowEdges = 0;

    function recordEdge(first, second, firstIndex, secondIndex) {
      if (second < 0 || second >= n || second === first || !used[second]) return;
      var lo = first < second ? first : second;
      var hi = first < second ? second : first;
      var pairKey = lo * n + hi;
      pairCounts[pairKey]++;
      edges++;
      if (lowMatrix[pairKey]) {
        mask[firstIndex] = 1;
        mask[secondIndex] = 1;
        lowEdges++;
      }
    }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        a = indices[i];
        if (a < 0 || a >= n || !used[a]) continue;
        if (x + 1 < w) recordEdge(a, indices[i + 1], i, i + 1);
        if (y + 1 < h) recordEdge(a, indices[i + w], i, i + w);
      }
    }

    var pairCount = 0;
    var lowPairCount = 0;
    var minDistance = Infinity;
    var minRatio = Infinity;
    var sumDistance = 0;
    var sumRatio = 0;
    var worst = [];

    for (a = 0; a < n; a++) {
      if (!used[a]) continue;
      for (b = a + 1; b < n; b++) {
        if (!used[b]) continue;
        key = a * n + b;
        count = pairCounts[key];
        if (!count) continue;
        pairCount++;
        distance = distanceMatrix[key];
        ratio = ratioMatrix[key];
        sumDistance += distance * count;
        sumRatio += ratio * count;
        if (distance < minDistance) minDistance = distance;
        if (ratio < minRatio) minRatio = ratio;
        if (lowMatrix[key]) {
          lowPairCount++;
          worst.push({
            a: a,
            b: b,
            distance: roundTo(distance, 4),
            ratio: roundTo(ratio, 2),
            deltaL: roundTo(Math.abs(hsl[a].l - hsl[b].l), 1),
            deltaH: roundTo(hueDistance(hsl[a].h, hsl[b].h), 1),
            edges: count,
          });
        }
      }
    }

    worst.sort(function (p, q) {
      return p.distance - q.distance || q.edges - p.edges || p.a - q.a || p.b - q.b;
    });

    out.contrast.edges = edges;
    out.contrast.pairs = pairCount;
    out.contrast.lowPairs = lowPairCount;
    out.contrast.lowEdges = lowEdges;
    out.contrast.score = edges > 0 ? 1 - lowEdges / edges : null;
    out.contrast.minDistance = pairCount ? roundTo(minDistance, 4) : null;
    out.contrast.averageDistance = edges ? roundTo(sumDistance / edges, 4) : null;
    out.contrast.minRatio = pairCount ? roundTo(minRatio, 2) : null;
    out.contrast.averageRatio = edges ? roundTo(sumRatio / edges, 2) : null;
    out.contrast.worst = worst.slice(0, 12);

    return out;
  }

  /**
   * Groups palette entries whose OKLab distance is within a tolerance.
   *
   * The grouping is single-linkage: two colours belong to the same group when
   * a chain of sufficiently similar colours connects them. The selected
   * colour and every entry in its group share the same editing behaviour.
   *
   * options: { threshold: 0.035 }   // OKLab distance
   * Returns { groups, groupOf, count, threshold }.
   */
  function groupSimilarColors(palette, options) {
    options = options || {};
    var threshold =
      options.threshold == null
        ? PALETTE_NEAR_DISTANCE
        : Math.max(0, Number(options.threshold) || 0);
    var n = palette ? palette.length : 0;
    var groupOf = new Int16Array(n);
    if (!n) {
      return { groups: [], groupOf: groupOf, count: 0, threshold: threshold };
    }

    var parent = new Int32Array(n);
    var i, j;
    for (i = 0; i < n; i++) parent[i] = i;

    function find(index) {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    }

    function union(a, b) {
      var ra = find(a);
      var rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }

    var t2 = threshold * threshold;
    var labs = new Array(n);
    for (i = 0; i < n; i++) {
      var color = palette[i];
      labs[i] = color ? rgbToOklab(color.r, color.g, color.b) : null;
    }

    for (i = 0; i < n; i++) {
      if (!labs[i]) continue;
      for (j = i + 1; j < n; j++) {
        if (!labs[j]) continue;
        if (
          oklabDist2(
            labs[i].L,
            labs[i].A,
            labs[i].B,
            labs[j].L,
            labs[j].A,
            labs[j].B
          ) <= t2
        ) {
          union(i, j);
        }
      }
    }

    var roots = new Map();
    var groups = [];
    for (i = 0; i < n; i++) {
      var root = find(i);
      var group = roots.get(root);
      if (group == null) {
        group = groups.length;
        roots.set(root, group);
        groups.push([]);
      }
      groups[group].push(i);
      groupOf[i] = group;
    }

    return {
      groups: groups,
      groupOf: groupOf,
      count: groups.length,
      threshold: threshold,
    };
  }

  var ISLAND_MAX_SIZE = 4;
  var ISLAND_DOMINANCE = 0.6;
  var ISLAND_COMPACTNESS = 1.5;
  var TILE_MAX_SIZE = 256;

  /**
   * Finds small opaque islands surrounded by another colour. Read-only.
   *
   * Components are 8-connected groups of the same palette index. A component
   * is reported only when:
   *   - its size is between 1 and maxSize (default 4);
   *   - it does not touch the image border;
   *   - one surrounding colour covers at least `dominance` (default 60%) of
   *     its unique 8-neighbour border, so intentional details at colour
   *     junctions are left alone.
   *
   * Transparency (-1) is ignored as a component colour but counts as a
   * surrounding colour. Returns a mask (1 = part of a reported island), the
   * number of single pixels and small clusters, plus a short list of examples.
   */
  function analyzeIslands(indices, width, height, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    var maxSize =
      options.maxSize == null ? ISLAND_MAX_SIZE : clamp(Math.round(options.maxSize), 1, 64);
    var dominance =
      options.dominance == null
        ? ISLAND_DOMINANCE
        : clamp(Number(options.dominance) || 0, 0, 1);
    var compactness =
      options.compactness == null
        ? ISLAND_COMPACTNESS
        : Math.max(1, Number(options.compactness) || 1);

    var out = {
      width: Math.max(0, w),
      height: Math.max(0, h),
      maxSize: maxSize,
      dominance: dominance,
      singles: 0,
      clusters: 0,
      hotspots: 0,
      pixels: 0,
      mask: new Uint8Array(total > 0 ? total : 0),
      list: [],
      skipped: false,
    };

    if (!total || !indices || indices.length < total || total > maxPixels) {
      out.skipped = true;
      return out;
    }

    var visited = new Uint8Array(total);
    var stack = new Int32Array(total);
    var compPixels = new Int32Array(maxSize);
    var compSeen = {};
    var x, y, start, color, compSize, top, i;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        start = y * w + x;
        if (visited[start]) continue;
        visited[start] = 1;
        color = indices[start];
        if (color < 0) continue;

        top = 0;
        stack[top++] = start;
        compSize = 0;
        var touchesEdge = false;
        var minX = w;
        var minY = h;
        var maxX = -1;
        var maxY = -1;
        compSeen = {};

        while (top > 0) {
          var cur = stack[--top];
          compSize++;
          var cx = cur % w;
          var cy = (cur / w) | 0;
          if (compSize <= maxSize) {
            compPixels[compSize - 1] = cur;
            compSeen[cur] = 1;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;
          }
          if (cx === 0 || cy === 0 || cx === w - 1 || cy === h - 1) touchesEdge = true;
          for (var dy = -1; dy <= 1; dy++) {
            var ny = cy + dy;
            if (ny < 0 || ny >= h) continue;
            for (var dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              var nx = cx + dx;
              if (nx < 0 || nx >= w) continue;
              var ni = ny * w + nx;
              if (visited[ni] || indices[ni] !== color) continue;
              visited[ni] = 1;
              stack[top++] = ni;
            }
          }
        }

        if (compSize > maxSize || touchesEdge) continue;

        // A short diagonal or curved stroke is a thin line, not a speck.
        var bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
        if (bboxArea > compSize * compactness) continue;

        var borderSeen = {};
        var borderCounts = {};
        var borderTotal = 0;
        for (i = 0; i < compSize; i++) {
          var p = compPixels[i];
          var px = p % w;
          var py = (p / w) | 0;
          for (var by = -1; by <= 1; by++) {
            var yy = py + by;
            if (yy < 0 || yy >= h) continue;
            for (var bx = -1; bx <= 1; bx++) {
              if (!bx && !by) continue;
              var xx = px + bx;
              if (xx < 0 || xx >= w) continue;
              var bi = yy * w + xx;
              if (compSeen[bi] || borderSeen[bi]) continue;
              borderSeen[bi] = 1;
              borderTotal++;
              var bc = indices[bi];
              borderCounts[bc] = (borderCounts[bc] || 0) + 1;
            }
          }
        }

        if (!borderTotal) continue;
        var dominant = 0;
        var dominantCount = 0;
        for (var key in borderCounts) {
          if (borderCounts[key] > dominantCount) {
            dominantCount = borderCounts[key];
            dominant = Number(key);
          }
        }
        var share = dominantCount / borderTotal;
        if (share < dominance) continue;

        for (i = 0; i < compSize; i++) out.mask[compPixels[i]] = 1;
        if (compSize === 1) out.singles++;
        else out.clusters++;
        out.pixels += compSize;
        if (out.list.length < 24) {
          out.list.push({
            x: start % w,
            y: (start / w) | 0,
            size: compSize,
            index: color,
            dominant: dominant,
            share: roundTo(share, 2),
          });
        }
      }
    }

    out.hotspots = out.singles + out.clusters;
    out.list.sort(function (a, b) {
      return a.size - b.size || a.y - b.y || a.x - b.x;
    });
    return out;
  }

  /**
   * Analyses a tile sheet on the logical grid. Read-only.
   *
   * Splits the largest whole-tile area into square tiles and reports:
   *   - layout (cols x rows, leftovers, unique/duplicate/empty tiles);
   *   - continuity of internal tile seams: the share of colour pairs that match
   *     across a seam, compared with the same measure on boundaries inside
   *     tiles. A seam is flagged only when it is at least `seamDrop` (default
   *     0.25) less continuous than the tile interior and its match rate is
   *     below `seamMaxRate` (default 0.5).
   *
   * The seam result is advisory: independent tiles in a sheet can legitimately
   * have hard edges, while a seamless scene crop should score high. The mask
   * marks both pixels of every flagged seam. Transparency (-1) is a colour.
   */
  function analyzeTiles(indices, width, height, tileSize, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    var size = Math.round(Number(tileSize) || 0);
    var drop =
      options.seamDrop == null ? 0.25 : clamp(Number(options.seamDrop) || 0, 0, 1);
    var maxRate =
      options.seamMaxRate == null
        ? 0.5
        : clamp(Number(options.seamMaxRate) || 0, 0, 1);

    var out = {
      width: Math.max(0, w),
      height: Math.max(0, h),
      tileSize: size,
      cols: 0,
      rows: 0,
      tiles: 0,
      exact: false,
      truncated: false,
      uniqueTiles: 0,
      duplicateTiles: 0,
      emptyTiles: 0,
      seams: {
        vertical: 0,
        horizontal: 0,
        total: 0,
        flagged: 0,
        score: null,
        baselineVertical: null,
        baselineHorizontal: null,
        list: [],
        mask: new Uint8Array(total > 0 ? total : 0),
      },
      skipped: false,
      reason: '',
    };

    if (!total || !indices || indices.length < total || total > maxPixels) {
      out.skipped = true;
      out.reason = 'grid';
      return out;
    }
    if (size < 2 || size > TILE_MAX_SIZE) {
      out.skipped = true;
      out.reason = 'size';
      return out;
    }

    var cols = Math.floor(w / size);
    var rows = Math.floor(h / size);
    if (cols < 1 || rows < 1) {
      out.skipped = true;
      out.reason = 'size';
      return out;
    }

    out.cols = cols;
    out.rows = rows;
    out.tiles = cols * rows;
    out.exact = cols * size === w && rows * size === h;
    out.truncated = !out.exact;

    var tileMap = Object.create(null);
    var unique = 0;
    var duplicate = 0;
    var empty = 0;
    var tx, ty, x, y, k, v;

    for (ty = 0; ty < rows; ty++) {
      for (tx = 0; tx < cols; tx++) {
        var key = '';
        var isEmpty = true;
        for (y = 0; y < size; y++) {
          var rowStart = (ty * size + y) * w + tx * size;
          for (x = 0; x < size; x++) {
            v = indices[rowStart + x];
            if (v >= 0) isEmpty = false;
            key += String.fromCharCode((v + 1) & 0xffff);
          }
        }
        if (isEmpty) empty++;
        if (tileMap[key]) {
          tileMap[key]++;
          duplicate++;
        } else {
          tileMap[key] = 1;
          unique++;
        }
      }
    }

    out.uniqueTiles = unique;
    out.duplicateTiles = duplicate;
    out.emptyTiles = empty;

    var analyzedW = cols * size;
    var analyzedH = rows * size;
    var baselineVSame = 0;
    var baselineVTotal = 0;
    var baselineHSame = 0;
    var baselineHTotal = 0;

    for (y = 0; y < analyzedH; y++) {
      var rowBase = y * w;
      for (x = 0; x < analyzedW - 1; x++) {
        if ((x + 1) % size === 0) continue;
        baselineVTotal++;
        if (indices[rowBase + x] === indices[rowBase + x + 1]) baselineVSame++;
      }
    }
    for (y = 0; y < analyzedH - 1; y++) {
      if ((y + 1) % size === 0) continue;
      var rowA = y * w;
      var rowB = (y + 1) * w;
      for (x = 0; x < analyzedW; x++) {
        baselineHTotal++;
        if (indices[rowA + x] === indices[rowB + x]) baselineHSame++;
      }
    }

    var baselineV = baselineVTotal ? baselineVSame / baselineVTotal : null;
    var baselineH = baselineHTotal ? baselineHSame / baselineHTotal : null;
    out.seams.baselineVertical = baselineV == null ? null : roundTo(baselineV, 2);
    out.seams.baselineHorizontal = baselineH == null ? null : roundTo(baselineH, 2);

    var mask = out.seams.mask;
    var flagged = 0;
    var allSeams = [];

    for (k = 1; k < cols; k++) {
      var seamX = k * size;
      var sameV = 0;
      for (y = 0; y < analyzedH; y++) {
        if (indices[y * w + seamX - 1] === indices[y * w + seamX]) sameV++;
      }
      var rateV = sameV / analyzedH;
      var flagV =
        baselineV != null && analyzedH >= 4 && rateV < baselineV - drop && rateV < maxRate;
      if (flagV) {
        flagged++;
        for (y = 0; y < analyzedH; y++) mask[y * w + seamX] = 1;
      }
      allSeams.push({
        orientation: 'v',
        position: seamX,
        same: sameV,
        total: analyzedH,
        rate: roundTo(rateV, 2),
        baseline: out.seams.baselineVertical,
        flagged: flagV,
      });
    }

    for (k = 1; k < rows; k++) {
      var seamY = k * size;
      var sameH = 0;
      for (x = 0; x < analyzedW; x++) {
        if (indices[(seamY - 1) * w + x] === indices[seamY * w + x]) sameH++;
      }
      var rateH = sameH / analyzedW;
      var flagH =
        baselineH != null && analyzedW >= 4 && rateH < baselineH - drop && rateH < maxRate;
      if (flagH) {
        flagged++;
        for (x = 0; x < analyzedW; x++) mask[seamY * w + x] = 1;
      }
      allSeams.push({
        orientation: 'h',
        position: seamY,
        same: sameH,
        total: analyzedW,
        rate: roundTo(rateH, 2),
        baseline: out.seams.baselineHorizontal,
        flagged: flagH,
      });
    }

    allSeams.sort(function (a, b) {
      if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
      return a.rate - b.rate || a.orientation.localeCompare(b.orientation) || a.position - b.position;
    });

    out.seams.vertical = Math.max(0, cols - 1);
    out.seams.horizontal = Math.max(0, rows - 1);
    out.seams.total = out.seams.vertical + out.seams.horizontal;
    out.seams.flagged = flagged;
    out.seams.score = out.seams.total ? 1 - flagged / out.seams.total : null;
    out.seams.list = allSeams.slice(0, 12);
    return out;
  }

  /**
   * Analyses the logical palette-index grid and reports three kinds of
   * pixel-art defects without changing anything:
   *   - doubles: 1px strokes whose consecutive segments overlap by one pixel,
   *     creating a 2px-thick "Z" joint (the classic double).
   *   - jaggies: segment-length rhythm breaks of exactly one pixel.
   *   - lines: segment-length rhythm breaks of two or more pixels.
   *   - patterns: perfect slopes, regular intermediate rhythms, progressive
   *     curves and irregular strokes, with a mask only for the irregular ones.
   *
   * Doubles and rhythm breaks only apply to 1px strokes: Z-shaped edges of
   * filled 2px bands and solid areas are not reported. Returns one mask per
   * category (logical resolution, 1 = defect), the number of double hotspots
   * plus the number of jaggy/line runs, and a skipped flag for oversized grids.
   * Transparency (-1) is ignored.
   */
  function lintPixelArt(indices, width, height, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    var out = {
      width: Math.max(0, w),
      height: Math.max(0, h),
      doubles: new Uint8Array(total > 0 ? total : 0),
      jaggies: new Uint8Array(total > 0 ? total : 0),
      lines: new Uint8Array(total > 0 ? total : 0),
      counts: { doubles: 0, jaggies: 0, lines: 0 },
      patterns: {
        perfect: 0,
        intermediate: 0,
        curves: 0,
        irregular: 0,
        total: 0,
        perfectRatio: null,
        mask: new Uint8Array(total > 0 ? total : 0),
        skipped: false,
      },
      skipped: false,
    };

    if (!total || !indices || indices.length < total) {
      out.skipped = true;
      out.patterns.skipped = true;
      return out;
    }
    if (total > maxPixels) {
      out.skipped = true;
      out.patterns.skipped = true;
      return out;
    }

    var H = new Int32Array(total);
    var V = new Int32Array(total);
    var hRuns = [];
    var vRuns = [];
    var byRow = new Array(h);
    var byCol = new Array(w);
    var x, y, i, runStart, color, len, run, rowRuns, colRuns;

    // Horizontal and vertical same-color runs (transparency excluded).
    for (y = 0; y < h; y++) {
      rowRuns = [];
      byRow[y] = rowRuns;
      runStart = 0;
      for (x = 1; x <= w; x++) {
        if (x < w && indices[y * w + x] === indices[y * w + runStart]) continue;
        color = indices[y * w + runStart];
        if (color >= 0) {
          len = x - runStart;
          run = { x: runStart, y: y, len: len, color: color, thin: false };
          rowRuns.push(run);
          hRuns.push(run);
          for (i = runStart; i < x; i++) H[y * w + i] = len;
        }
        runStart = x;
      }
    }

    for (x = 0; x < w; x++) {
      colRuns = [];
      byCol[x] = colRuns;
      runStart = 0;
      for (y = 1; y <= h; y++) {
        if (y < h && indices[y * w + x] === indices[runStart * w + x]) continue;
        color = indices[runStart * w + x];
        if (color >= 0) {
          len = y - runStart;
          run = { x: x, y: runStart, len: len, color: color, thin: false };
          colRuns.push(run);
          vRuns.push(run);
          for (i = runStart; i < y; i++) V[i * w + x] = len;
        }
        runStart = y;
      }
    }

    // Thin = the stroke perpendicular to the run is at most 2px wide. A pixel
    // of width 1 is required too: filled 2px bands are shapes, not lines.
    for (i = 0; i < hRuns.length; i++) {
      run = hRuns[i];
      run.thin = true;
      run.hasWidthOne = false;
      for (x = run.x; x < run.x + run.len; x++) {
        var hWidth = V[run.y * w + x];
        if (hWidth === 1) run.hasWidthOne = true;
        else if (hWidth > 2) {
          run.thin = false;
          break;
        }
      }
    }
    for (i = 0; i < vRuns.length; i++) {
      run = vRuns[i];
      run.thin = true;
      run.hasWidthOne = false;
      for (y = run.y; y < run.y + run.len; y++) {
        var vWidth = H[y * w + run.x];
        if (vWidth === 1) run.hasWidthOne = true;
        else if (vWidth > 2) {
          run.thin = false;
          break;
        }
      }
    }

    // Z overlaps inside a regular line pattern (perfect slope, alternating
    // rhythm or progressive curve) are part of the stroke, not doubles. A
    // preliminary pattern pass tells the double detector which pixels to skip.
    var preliminaryChains = collectPatternChains(false);
    var regularPatternMask = new Uint8Array(total);
    var pChain, pRun, pRunIndex, pStep, pIndex;
    for (i = 0; i < preliminaryChains.length; i++) {
      pChain = preliminaryChains[i];
      if (pChain.category === 'irregular') continue;
      for (pRunIndex = 0; pRunIndex < pChain.runs.length; pRunIndex++) {
        pRun = pChain.runs[pRunIndex];
        for (pStep = 0; pStep < pRun.len; pStep++) {
          pIndex = pChain.horizontal
            ? pRun.y * w + pRun.x + pStep
            : (pRun.y + pStep) * w + pRun.x;
          regularPatternMask[pIndex] = 1;
        }
      }
    }

    // -----------------------------------------------------------------------
    // Doubles — two consecutive parallel runs overlap in exactly one pixel and
    // continue on opposite sides (a Z joint), while the overlap column/row is
    // exactly two pixels thick (a 1px stroke, not a solid area).
    // -----------------------------------------------------------------------
    var a, b, top, bottom, j, k, lo, hi, xx, aEnd, bEnd, aLeft, aRight, bLeft, bRight;

    for (y = 0; y < h - 1; y++) {
      top = byRow[y];
      bottom = byRow[y + 1];
      j = 0;
      for (i = 0; i < top.length; i++) {
        a = top[i];
        aEnd = a.x + a.len - 1;
        while (j < bottom.length && bottom[j].x + bottom[j].len - 1 < a.x) j++;
        for (k = j; k < bottom.length; k++) {
          b = bottom[k];
          if (b.x > aEnd) break;
          if (b.color !== a.color) continue;
          lo = a.x > b.x ? a.x : b.x;
          hi = aEnd < b.x + b.len - 1 ? aEnd : b.x + b.len - 1;
          if (hi - lo !== 0) continue;
          xx = lo;
          if (
            (y > 0 && indices[(y - 1) * w + xx] === a.color) ||
            (y + 2 < h && indices[(y + 2) * w + xx] === a.color)
          ) {
            continue;
          }
          aLeft = a.x < xx;
          aRight = aEnd > xx;
          bLeft = b.x < xx;
          bRight = b.x + b.len - 1 > xx;
          if (!((aLeft && bRight) || (aRight && bLeft))) continue;
          if ((aLeft && bLeft) || (aRight && bRight)) continue;
          if (regularPatternMask[y * w + xx]) continue;
          // The pixels next to the joint must still belong to a 1px stroke:
          // a Z-shaped edge of a filled colour band is not a double.
          if (!runWidthOneAt(a, true, aLeft ? xx - 1 : xx + 1)) continue;
          if (!runWidthOneAt(b, true, bLeft ? xx - 1 : xx + 1)) continue;
          out.doubles[y * w + xx] = 1;
          out.doubles[(y + 1) * w + xx] = 1;
        }
      }
    }

    var left, right, aEndY, bEndY, yy, aUp, aDown, bUp, bDown;

    for (x = 0; x < w - 1; x++) {
      left = byCol[x];
      right = byCol[x + 1];
      j = 0;
      for (i = 0; i < left.length; i++) {
        a = left[i];
        aEndY = a.y + a.len - 1;
        while (j < right.length && right[j].y + right[j].len - 1 < a.y) j++;
        for (k = j; k < right.length; k++) {
          b = right[k];
          if (b.y > aEndY) break;
          if (b.color !== a.color) continue;
          lo = a.y > b.y ? a.y : b.y;
          hi = aEndY < b.y + b.len - 1 ? aEndY : b.y + b.len - 1;
          if (hi - lo !== 0) continue;
          yy = lo;
          if (
            (x > 0 && indices[yy * w + (x - 1)] === a.color) ||
            (x + 2 < w && indices[yy * w + (x + 2)] === a.color)
          ) {
            continue;
          }
          aUp = a.y < yy;
          aDown = aEndY > yy;
          bUp = b.y < yy;
          bDown = b.y + b.len - 1 > yy;
          if (!((aUp && bDown) || (aDown && bUp))) continue;
          if ((aUp && bUp) || (aDown && bDown)) continue;
          if (regularPatternMask[yy * w + x]) continue;
          if (!runWidthOneAt(a, false, aUp ? yy - 1 : yy + 1)) continue;
          if (!runWidthOneAt(b, false, bUp ? yy - 1 : yy + 1)) continue;
          out.doubles[yy * w + x] = 1;
          out.doubles[yy * w + x + 1] = 1;
        }
      }
    }

    // Count distinct double hotspots, not raw 3-pixel blocks: one Z joint is
    // detected by both orientations, and nearby joints often touch.
    var seen = new Uint8Array(total);
    var stack, cur, cx, cy, nx, ny, ni;
    for (i = 0; i < total; i++) {
      if (!out.doubles[i] || seen[i]) continue;
      out.counts.doubles++;
      stack = [i];
      seen[i] = 1;
      while (stack.length) {
        cur = stack.pop();
        cx = cur % w;
        cy = (cur / w) | 0;
        for (ny = cy - 1; ny <= cy + 1; ny++) {
          if (ny < 0 || ny >= h) continue;
          for (nx = cx - 1; nx <= cx + 1; nx++) {
            if (nx < 0 || nx >= w || (nx === cx && ny === cy)) continue;
            ni = ny * w + nx;
            if (out.doubles[ni] && !seen[ni]) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Jaggies / irregular lines — run-length rhythm breaks on thin strokes.
    // -----------------------------------------------------------------------

    function nearestParallel(list, start, length, runColor, horizontal) {
      var end = start + length - 1;
      var low = 0;
      var high = list.length;
      var mid, other, otherStart, otherEnd, gap;

      // First run that starts at >= start - 1 (runs in a row/column are sorted
      // and non-overlapping, so only the predecessor can also be adjacent).
      while (low < high) {
        mid = (low + high) >> 1;
        otherStart = horizontal ? list[mid].x : list[mid].y;
        if (otherStart < start - 1) low = mid + 1;
        else high = mid;
      }

      var best = null;
      var bestGap = 2;
      for (k = low - 1; k < list.length; k++) {
        if (k < 0) continue;
        other = list[k];
        otherStart = horizontal ? other.x : other.y;
        if (otherStart > end + 1) break;
        if (other.color !== runColor || !other.thin) continue;
        otherEnd = otherStart + other.len - 1;
        gap =
          otherStart > end ? otherStart - end : start > otherEnd ? start - otherEnd : 0;
        if (gap < bestGap) {
          bestGap = gap;
          best = other;
        }
      }
      return best;
    }

    function markRun(target, runRef, horizontal) {
      var m;
      if (horizontal) {
        for (m = runRef.x; m < runRef.x + runRef.len; m++) target[runRef.y * w + m] = 1;
      } else {
        for (m = runRef.y; m < runRef.y + runRef.len; m++) target[m * w + runRef.x] = 1;
      }
    }

    function runHasDouble(runRef, horizontal) {
      var m;
      if (horizontal) {
        for (m = 0; m < runRef.len; m++) {
          if (out.doubles[runRef.y * w + runRef.x + m]) return true;
        }
      } else {
        for (m = 0; m < runRef.len; m++) {
          if (out.doubles[(runRef.y + m) * w + runRef.x]) return true;
        }
      }
      return false;
    }

    function inspectRun(runRef, horizontal) {
      if (!runRef.thin) return;
      // Do not report the rhythm break caused by an already-detected double.
      if (runHasDouble(runRef, horizontal)) return;
      var axis = horizontal ? runRef.y : runRef.x;
      var limit = horizontal ? h : w;
      if (axis <= 0 || axis >= limit - 1) return;

      var list = horizontal ? byRow : byCol;
      var start = horizontal ? runRef.x : runRef.y;
      var prev = nearestParallel(list[axis - 1], start, runRef.len, runRef.color, horizontal);
      var next = nearestParallel(list[axis + 1], start, runRef.len, runRef.color, horizontal);
      if (!prev || !next) return;

      var loLen = prev.len < next.len ? prev.len : next.len;
      var hiLen = prev.len > next.len ? prev.len : next.len;
      var dev = 0;
      if (runRef.len < loLen) dev = loLen - runRef.len;
      else if (runRef.len > hiLen) dev = runRef.len - hiLen;
      if (dev <= 0) return;

      // Alternating segment rhythms (2,1,2,1 or 3,2,3,2) are a legitimate
      // pixel-art technique: only flag a one-pixel break when the rhythm does
      // not continue two runs away. Follow the stroke run by run, because the
      // segment two steps away is spatially shifted.
      if (dev === 1 && prev.len === next.len && runRef.len !== prev.len) {
        var prev2 = null;
        var next2 = null;
        if (axis - 2 >= 0) {
          prev2 = nearestParallel(
            list[axis - 2],
            horizontal ? prev.x : prev.y,
            prev.len,
            prev.color,
            horizontal
          );
        }
        if (axis + 2 < limit) {
          next2 = nearestParallel(
            list[axis + 2],
            horizontal ? next.x : next.y,
            next.len,
            next.color,
            horizontal
          );
        }
        if ((prev2 && prev2.len === runRef.len) || (next2 && next2.len === runRef.len)) {
          return;
        }
      }

      if (dev === 1) {
        markRun(out.jaggies, runRef, horizontal);
        out.counts.jaggies++;
      } else {
        markRun(out.lines, runRef, horizontal);
        out.counts.lines++;
      }
    }

    for (i = 0; i < hRuns.length; i++) inspectRun(hRuns[i], true);
    for (i = 0; i < vRuns.length; i++) inspectRun(vRuns[i], false);

    // -----------------------------------------------------------------------
    // Line patterns — thin run chains are classified by their rhythm:
    // perfect slopes (0:1, 1:0, 1:1, 1:2, 2:1), regular intermediate
    // patterns, progressive curves, or irregular strokes.
    // -----------------------------------------------------------------------

    function intervalDistance(aStart, aLen, bStart, bLen) {
      var aEnd = aStart + aLen - 1;
      var bEnd = bStart + bLen - 1;
      if (aEnd < bStart) return bStart - aEnd - 1;
      if (bEnd < aStart) return aStart - bEnd - 1;
      return 0;
    }

    function intervalOverlap(aStart, aLen, bStart, bLen) {
      var aEnd = aStart + aLen - 1;
      var bEnd = bStart + bLen - 1;
      var lo = aStart > bStart ? aStart : bStart;
      var hi = aEnd < bEnd ? aEnd : bEnd;
      return hi >= lo ? hi - lo + 1 : 0;
    }

    function firstTouchingIndex(list, minEnd, horizontal) {
      var low = 0;
      var high = list.length;
      var mid, start, end;
      while (low < high) {
        mid = (low + high) >> 1;
        start = horizontal ? list[mid].x : list[mid].y;
        end = start + list[mid].len - 1;
        if (end < minEnd) low = mid + 1;
        else high = mid;
      }
      return low;
    }

    function hasOverlappingParallel(list, runRef, horizontal) {
      var k, other, start, otherStart;
      if (!list || !list.length) return false;
      start = horizontal ? runRef.x : runRef.y;
      for (k = 0; k < list.length; k++) {
        other = list[k];
        if (other.color !== runRef.color) continue;
        otherStart = horizontal ? other.x : other.y;
        if (intervalOverlap(start, runRef.len, otherStart, other.len) > 0) return true;
      }
      return false;
    }

    function runWidthOneAt(runRef, horizontal, pos) {
      var width = horizontal ? V[runRef.y * w + pos] : H[pos * w + runRef.x];
      return width === 1;
    }

    function runHasDefect(runRef, horizontal) {
      var k, index;
      for (k = 0; k < runRef.len; k++) {
        index = horizontal
          ? runRef.y * w + runRef.x + k
          : (runRef.y + k) * w + runRef.x;
        if (out.doubles[index] || out.jaggies[index] || out.lines[index]) return true;
      }
      return false;
    }

    function buildChains(byLine, lineCount, horizontal) {
      var chains = [];
      var lineIndex, runIndex, candidateIndex, run, candidate, nextLine;
      var start, nextStart, first, best, bestOverlap, bestDelta, overlap, delta;
      var candidateCount, chainRuns, current;
      var candidates;

      for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          run.patternNext = null;
          run.patternPrev = false;
          run.patternPrevCount = 0;
          run.patternSeen = false;
        }
      }

      for (lineIndex = 0; lineIndex < lineCount - 1; lineIndex++) {
        nextLine = byLine[lineIndex + 1];
        if (!nextLine.length) continue;
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          if (!run.thin || run.patternFlagged) continue;
          start = horizontal ? run.x : run.y;
          first = firstTouchingIndex(nextLine, start - 1, horizontal);
          best = null;
          bestOverlap = -1;
          bestDelta = Infinity;
          candidateCount = 0;
          for (candidateIndex = first; candidateIndex < nextLine.length; candidateIndex++) {
            candidate = nextLine[candidateIndex];
            nextStart = horizontal ? candidate.x : candidate.y;
            if (nextStart > start + run.len) break;
            if (!candidate.thin || candidate.patternFlagged || candidate.color !== run.color) continue;
            if (intervalDistance(start, run.len, nextStart, candidate.len) !== 0) continue;
            overlap = intervalOverlap(start, run.len, nextStart, candidate.len);
            // A wide overlap between two 2px-wide runs is a filled area, not
            // a line transition (it would otherwise merge eyes, dots and bars).
            if (overlap > 1 && (!run.hasWidthOne || !candidate.hasWidthOne)) continue;
            candidateCount++;
            delta = Math.abs(start - nextStart);
            if (overlap > bestOverlap || (overlap === bestOverlap && delta < bestDelta)) {
              best = candidate;
              bestOverlap = overlap;
              bestDelta = delta;
            }
          }
          // Splitting at junctions avoids dragging a straight segment into a
          // curve and reporting the length jump as an irregular line.
          run.patternNext = candidateCount === 1 ? best : null;
        }
      }

      for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          if (run.patternNext) run.patternNext.patternPrevCount++;
        }
      }
      for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          if (run.patternNext && run.patternNext.patternPrevCount > 1) {
            run.patternNext = null;
          }
        }
      }
      for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          if (run.patternNext) run.patternNext.patternPrev = true;
        }
      }

      for (lineIndex = 0; lineIndex < lineCount; lineIndex++) {
        candidates = byLine[lineIndex];
        for (runIndex = 0; runIndex < candidates.length; runIndex++) {
          run = candidates[runIndex];
          if (!run.thin || run.patternFlagged || run.patternPrev || run.patternSeen) continue;
          chainRuns = [];
          current = run;
          while (current && !current.patternSeen) {
            current.patternSeen = true;
            chainRuns.push(current);
            current = current.patternNext;
          }
          if (chainRuns.length >= 2) {
            for (var c = 0; c < chainRuns.length; c++) chainRuns[c].patternUsed = true;
            if (chainRuns.length >= 3) chains.push({ runs: chainRuns, horizontal: horizontal });
          }
        }
      }

      return chains;
    }

    function allSame(values) {
      for (var k = 1; k < values.length; k++) {
        if (values[k] !== values[0]) return false;
      }
      return true;
    }

    function periodic(values, period, minValues) {
      var k;
      var needed = minValues == null ? period * 2 : minValues;
      if (values.length < needed) return false;
      for (k = period; k < values.length; k++) {
        if (values[k] !== values[k - period]) return false;
      }
      return true;
    }

    function hasMixedDirection(steps) {
      var positive = false;
      var negative = false;
      for (var k = 0; k < steps.length; k++) {
        if (steps[k] > 0) positive = true;
        else if (steps[k] < 0) negative = true;
      }
      return positive && negative;
    }

    function isProgressiveCurve(lengths, steps) {
      var k, diff, direction;
      var sign = 0;
      var turns = 0;
      if (lengths.length < 4) return false;
      for (k = 1; k < lengths.length; k++) {
        if (steps[k - 1] > 2) return false;
        diff = lengths[k] - lengths[k - 1];
        if (Math.abs(diff) > 1) return false;
        if (diff !== 0) {
          direction = diff > 0 ? 1 : -1;
          if (sign === 0) sign = direction;
          else if (direction !== sign) {
            turns++;
            sign = direction;
            if (turns > 1) return false;
          }
        }
      }
      return sign !== 0;
    }

    function classifyChain(chain) {
      var runs = chain.runs;
      var horizontal = chain.horizontal;
      var lengths = [];
      var steps = [];
      var absSteps = [];
      var k, start;

      chain.slope = null;
      for (k = 0; k < runs.length; k++) lengths.push(runs[k].len);
      for (k = 0; k < runs.length; k++) {
        start = horizontal ? runs[k].x : runs[k].y;
        if (k > 0) steps.push(start - (horizontal ? runs[k - 1].x : runs[k - 1].y));
      }
      for (k = 0; k < steps.length; k++) absSteps.push(Math.abs(steps[k]));

      var sameLength = allSame(lengths);
      var sameStep = allSame(absSteps);
      var mixed = hasMixedDirection(steps);

      if (sameLength && sameStep && !mixed) {
        var length = lengths[0];
        var step = absSteps[0];
        if (step === 0 && length === 1) {
          // Horizontal chains step down a column, vertical chains across a row.
          chain.slope = horizontal ? '0:1' : '1:0';
          return 'perfect';
        }
        if (step === 1 && length === 1) {
          chain.slope = '1:1';
          return 'perfect';
        }
        // Horizontal chains describe shallow lines (2:1), vertical chains
        // describe steep lines (1:2).
        if (horizontal && step === 1 && length === 2) {
          chain.slope = '2:1';
          return 'perfect';
        }
        if (!horizontal && step === 2 && length === 2) {
          chain.slope = '1:2';
          return 'perfect';
        }
        return 'intermediate';
      }

      var maxPeriod = Math.min(4, (lengths.length / 2) | 0);
      for (var period = 2; period <= maxPeriod; period++) {
        if (
          !mixed &&
          periodic(lengths, period) &&
          (allSame(absSteps) || periodic(absSteps, period, period + 1))
        ) {
          return 'intermediate';
        }
      }

      if (isProgressiveCurve(lengths, absSteps)) return 'curves';
      return 'irregular';
    }

    function collectPatternChains(useDefects) {
      var patternScore = { perfect: 3, intermediate: 2, curves: 1, irregular: 0 };
      var k, run, chains;
      for (k = 0; k < hRuns.length; k++) {
        run = hRuns[k];
        run.patternUsed = false;
        run.patternFlagged = useDefects ? runHasDefect(run, true) : false;
      }
      for (k = 0; k < vRuns.length; k++) {
        run = vRuns[k];
        run.patternUsed = false;
        run.patternFlagged = useDefects ? runHasDefect(run, false) : false;
      }
      chains = buildChains(byRow, h, true).concat(buildChains(byCol, w, false));
      for (k = 0; k < chains.length; k++) chains[k].category = classifyChain(chains[k]);
      chains.sort(function (a, b) {
        var scoreA = patternScore[a.category];
        var scoreB = patternScore[b.category];
        if (scoreA !== scoreB) return scoreB - scoreA;
        if (a.runs.length !== b.runs.length) return b.runs.length - a.runs.length;
        if (a.horizontal !== b.horizontal) return a.horizontal ? -1 : 1;
        return 0;
      });
      return chains;
    }

    var claimed = new Uint8Array(total);
    var chain, pixels, index, pixel, unclaimed, runRef, k;
    var chains = collectPatternChains(true);

    for (i = 0; i < chains.length; i++) {
      chain = chains[i];
      pixels = [];
      unclaimed = 0;
      for (k = 0; k < chain.runs.length; k++) {
        runRef = chain.runs[k];
        for (var p = 0; p < runRef.len; p++) {
          index = chain.horizontal
            ? runRef.y * w + runRef.x + p
            : (runRef.y + p) * w + runRef.x;
          pixels.push(index);
          if (!claimed[index]) unclaimed++;
        }
      }
      if (!unclaimed || unclaimed * 2 < pixels.length) continue;
      for (p = 0; p < pixels.length; p++) {
        pixel = pixels[p];
        claimed[pixel] = 1;
        if (chain.category === 'irregular') out.patterns.mask[pixel] = 1;
      }
      out.patterns[chain.category]++;
      out.patterns.total++;
    }

    // Isolated straight runs (horizontal or vertical lines) are not part of
    // any chain: they are perfect by construction.
    for (i = 0; i < hRuns.length; i++) {
      runRef = hRuns[i];
      if (runRef.patternUsed || runRef.patternFlagged || !runRef.thin || runRef.len < 3) continue;
      if (hasOverlappingParallel(byRow[runRef.y - 1], runRef, true)) continue;
      if (hasOverlappingParallel(byRow[runRef.y + 1], runRef, true)) continue;
      out.patterns.perfect++;
      out.patterns.total++;
    }
    for (i = 0; i < vRuns.length; i++) {
      runRef = vRuns[i];
      if (runRef.patternUsed || runRef.patternFlagged || !runRef.thin || runRef.len < 3) continue;
      if (hasOverlappingParallel(byCol[runRef.x - 1], runRef, false)) continue;
      if (hasOverlappingParallel(byCol[runRef.x + 1], runRef, false)) continue;
      out.patterns.perfect++;
      out.patterns.total++;
    }

    var straightChains =
      out.patterns.perfect + out.patterns.intermediate + out.patterns.irregular;
    out.patterns.perfectRatio =
      straightChains > 0 ? out.patterns.perfect / straightChains : null;

    return out;
  }

  // -------------------------------------------------------------------------
  // 8) Opt-in automatic fixes (safe, reversible, verified)
  // -------------------------------------------------------------------------

  function copyIndexGrid(indices, total) {
    var out = new Int16Array(total);
    for (var i = 0; i < total; i++) out[i] = indices[i];
    return out;
  }

  function clonePaletteColors(palette) {
    var out = new Array(palette.length);
    for (var i = 0; i < palette.length; i++) {
      var color = palette[i];
      out[i] = color ? { r: color.r, g: color.g, b: color.b } : color;
    }
    return out;
  }

  function buildFixChanges(before, after, width) {
    var changes = [];
    for (var i = 0; i < after.length; i++) {
      if (after[i] === before[i]) continue;
      changes.push({
        x: i % width,
        y: (i / width) | 0,
        from: before[i],
        to: after[i],
      });
    }
    return changes;
  }

  function lineDefectMask(lint, category) {
    if (category === 'doubles') return lint.doubles;
    if (category === 'jaggies') return lint.jaggies;
    if (category === 'lines') return lint.lines;
    if (category === 'irregular') return lint.patterns.mask;
    return null;
  }

  function lineDefectStats(lint, category) {
    var mask = lineDefectMask(lint, category);
    var target = 0;
    if (category === 'doubles') target = lint.counts.doubles;
    else if (category === 'jaggies') target = lint.counts.jaggies;
    else if (category === 'lines') target = lint.counts.lines;
    else target = lint.patterns.irregular;
    var maskPixels = 0;
    for (var i = 0; i < mask.length; i++) maskPixels += mask[i] ? 1 : 0;
    return {
      target: target,
      total:
        lint.counts.doubles +
        lint.counts.jaggies +
        lint.counts.lines +
        lint.patterns.irregular,
      maskPixels: maskPixels,
    };
  }

  function maskRuns(indices, width, height, mask) {
    var seenH = new Uint8Array(width * height);
    var seenV = new Uint8Array(width * height);
    var runs = [];
    var unique = Object.create(null);
    var x, y, i, color, end, key;

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        if (!mask[i] || seenH[i]) continue;
        color = indices[i];
        end = x;
        while (end < width && mask[y * width + end] && indices[y * width + end] === color) {
          seenH[y * width + end] = 1;
          end++;
        }
        key = 'h|' + x + '|' + y + '|' + (end - x) + '|' + color;
        if (!unique[key]) {
          unique[key] = 1;
          runs.push({ horizontal: true, x: x, y: y, len: end - x, color: color });
        }
      }
    }

    for (x = 0; x < width; x++) {
      for (y = 0; y < height; y++) {
        i = y * width + x;
        if (!mask[i] || seenV[i]) continue;
        color = indices[i];
        end = y;
        while (end < height && mask[end * width + x] && indices[end * width + x] === color) {
          seenV[end * width + x] = 1;
          end++;
        }
        key = 'v|' + x + '|' + y + '|' + (end - y) + '|' + color;
        if (!unique[key]) {
          unique[key] = 1;
          runs.push({ horizontal: false, x: x, y: y, len: end - y, color: color });
        }
      }
    }

    return runs;
  }

  function neighboringColors(indices, width, height, position, ownColor) {
    var x = position % width;
    var y = (position / width) | 0;
    var colors = [];
    var seen = Object.create(null);
    for (var dy = -1; dy <= 1; dy++) {
      var ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        var color = indices[ny * width + nx];
        if (color < 0 || color === ownColor || seen[color]) continue;
        seen[color] = 1;
        colors.push(color);
      }
    }
    return colors;
  }

  function lineFixCandidates(indices, width, height, lint, category, maxCandidates) {
    var mask = lineDefectMask(lint, category);
    var runs = maskRuns(indices, width, height, mask);
    var candidates = [];
    var seen = Object.create(null);
    var limit = maxCandidates == null ? 96 : Math.max(1, Math.round(maxCandidates));

    function push(position, color) {
      if (candidates.length >= limit) return;
      var key = position + ':' + color;
      if (seen[key]) return;
      seen[key] = 1;
      candidates.push({ position: position, color: color });
    }

    for (var i = 0; i < runs.length && candidates.length < limit; i++) {
      var run = runs[i];
      var start = run.horizontal ? run.x : run.y;
      var ends = [start, start + run.len - 1];
      for (var e = 0; e < ends.length && candidates.length < limit; e++) {
        var at = ends[e];
        if (at < 0) continue;
        var endpoint = run.horizontal ? run.y * width + at : at * width + run.x;
        if (endpoint < 0 || endpoint >= width * height) continue;
        var colors = neighboringColors(indices, width, height, endpoint, run.color);
        for (var c = 0; c < colors.length && candidates.length < limit; c++) {
          push(endpoint, colors[c]);
        }
      }
      // A missing pixel at either end can restore the segment rhythm.
      var additions = [start - 1, start + run.len];
      for (var a = 0; a < additions.length && candidates.length < limit; a++) {
        var next = additions[a];
        var x = run.horizontal ? next : run.x;
        var y = run.horizontal ? run.y : next;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        var position = y * width + x;
        if (indices[position] === run.color) continue;
        push(position, run.color);
      }
    }

    return candidates;
  }

  function lineStatsImproved(next, current) {
    if (next.target < current.target && next.total <= current.total) return true;
    if (next.target === current.target && next.total < current.total) return true;
    if (
      next.target === current.target &&
      next.total === current.total &&
      next.maskPixels < current.maskPixels
    ) {
      return true;
    }
    return false;
  }

  function lineStatsBetter(next, best) {
    if (!best) return true;
    if (next.target !== best.target) return next.target < best.target;
    if (next.total !== best.total) return next.total < best.total;
    if (next.maskPixels !== best.maskPixels) return next.maskPixels < best.maskPixels;
    return false;
  }

  /**
   * Repairs one class of line defect (`doubles`, `jaggies`, `lines` or
   * `irregular`) with a fully verified greedy pass. Candidates come from the
   * diagnostic masks and are accepted only when they reduce the selected
   * defect without increasing the total number of line defects. The input is
   * never modified: a new index grid is returned together with the pixel
   * changes and before/after statistics.
   *
   * Caps keep the synchronous pass bounded: `maxTarget` defect units,
   * `maxEvaluations` full lint runs and `maxSteps` accepted edits.
   */
  function autoFixLines(indices, width, height, category, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var out = {
      indices: total > 0 ? copyIndexGrid(indices, total) : new Int16Array(0),
      category: category,
      changes: [],
      before: null,
      after: null,
      evaluations: 0,
      steps: 0,
      applied: 0,
      skipped: false,
      reason: '',
    };

    if (
      category !== 'doubles' &&
      category !== 'jaggies' &&
      category !== 'lines' &&
      category !== 'irregular'
    ) {
      out.skipped = true;
      out.reason = 'category';
      return out;
    }
    if (!total || !indices || indices.length < total) {
      out.skipped = true;
      out.reason = 'input';
      return out;
    }

    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    if (total > maxPixels) {
      out.skipped = true;
      out.reason = 'grid';
      return out;
    }

    var maxTarget =
      options.maxTarget == null ? 24 : Math.max(0, Math.round(options.maxTarget));
    var maxEvaluations =
      options.maxEvaluations == null
        ? 96
        : Math.max(0, Math.round(options.maxEvaluations));
    var maxSteps =
      options.maxSteps == null ? 12 : Math.max(0, Math.round(options.maxSteps));
    var maxMs =
      options.maxMs == null ? 2000 : Math.max(0, Math.round(options.maxMs));
    var started = Date.now();

    var original = out.indices.slice();
    var current = out.indices;
    var lint = lintPixelArt(current, w, h, { maxPixels: maxPixels });
    var currentStats = lineDefectStats(lint, category);
    out.before = {
      target: currentStats.target,
      total: currentStats.total,
      maskPixels: currentStats.maskPixels,
    };

    if (!currentStats.target) {
      out.after = {
        target: 0,
        total: currentStats.total,
        maskPixels: currentStats.maskPixels,
      };
      out.reason = 'clean';
      return out;
    }

    var stopReason = '';
    while (out.steps < maxSteps) {
      var remaining = maxTarget - (out.before.target - currentStats.target);
      if (remaining <= 0) {
        stopReason = 'target-cap';
        break;
      }
      if (
        out.evaluations >= maxEvaluations ||
        (maxMs > 0 && Date.now() - started >= maxMs)
      ) {
        stopReason = 'limit';
        break;
      }

      var candidates = lineFixCandidates(current, w, h, lint, category);
      if (!candidates.length) {
        stopReason = 'no-improvement';
        break;
      }

      var bestChange = null;
      var bestStats = null;
      var bestLint = null;
      for (var i = 0; i < candidates.length; i++) {
        if (
          out.evaluations >= maxEvaluations ||
          (maxMs > 0 && Date.now() - started >= maxMs)
        ) {
          stopReason = 'limit';
          break;
        }
        var candidate = candidates[i];
        var oldColor = current[candidate.position];
        if (oldColor === candidate.color) continue;
        current[candidate.position] = candidate.color;
        var nextLint = lintPixelArt(current, w, h, { maxPixels: maxPixels });
        current[candidate.position] = oldColor;
        out.evaluations++;
        var nextStats = lineDefectStats(nextLint, category);
        if (!lineStatsImproved(nextStats, currentStats)) continue;
        if (lineStatsBetter(nextStats, bestStats)) {
          bestChange = candidate;
          bestStats = nextStats;
          bestLint = nextLint;
        }
      }

      if (!bestChange) {
        if (!stopReason) stopReason = 'no-improvement';
        break;
      }

      current[bestChange.position] = bestChange.color;
      lint = bestLint;
      currentStats = bestStats;
      out.steps++;
    }

    if (!stopReason) {
      stopReason =
        currentStats.target === 0
          ? 'complete'
          : out.steps >= maxSteps
            ? 'limit'
            : 'no-improvement';
    }
    out.after = {
      target: currentStats.target,
      total: currentStats.total,
      maskPixels: currentStats.maskPixels,
    };
    out.changes = buildFixChanges(original, current, w);
    out.applied = out.changes.length;
    out.reason = currentStats.target === 0 ? 'complete' : stopReason;
    return out;
  }

  /**
   * Replaces reported isolated pixels and compact clusters with the dominant
   * colour of their 8-neighbour border. This is the same rule used by the
   * read-only island diagnostic, so only components it considered safe are
   * touched. The original indices are preserved; `maxTarget` limits how many
   * components are handled in one pass.
   */
  function removeIslands(indices, width, height, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var out = {
      indices: total > 0 ? copyIndexGrid(indices, total) : new Int16Array(0),
      changes: [],
      before: null,
      after: null,
      applied: 0,
      components: 0,
      skipped: false,
      reason: '',
    };

    if (!total || !indices || indices.length < total) {
      out.skipped = true;
      out.reason = 'input';
      return out;
    }

    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    if (total > maxPixels) {
      out.skipped = true;
      out.reason = 'grid';
      return out;
    }
    var maxTarget =
      options.maxTarget == null ? 64 : Math.max(0, Math.round(options.maxTarget));

    var initial = analyzeIslands(out.indices, w, h, options);
    out.before = {
      hotspots: initial.hotspots,
      singles: initial.singles,
      clusters: initial.clusters,
      pixels: initial.pixels,
    };
    if (!initial.hotspots) {
      out.after = {
        hotspots: 0,
        singles: 0,
        clusters: 0,
        pixels: 0,
      };
      out.reason = 'clean';
      return out;
    }

    var maxPasses =
      options.maxPasses == null ? 4 : Math.max(1, Math.round(options.maxPasses));
    var original = out.indices.slice();
    var current = out.indices;
    var stack = [];
    var processed = 0;
    var passes = 0;
    var analysis = initial;
    var i, x, y;

    while (passes < maxPasses && processed < maxTarget) {
      var seen = new Uint8Array(total);
      var processedBefore = processed;

      for (y = 0; y < h && processed < maxTarget; y++) {
        for (x = 0; x < w && processed < maxTarget; x++) {
          i = y * w + x;
          if (!analysis.mask[i] || seen[i]) continue;

          var color = current[i];
          var component = [];
          stack.length = 0;
          stack.push(i);
          seen[i] = 1;
          while (stack.length) {
            var position = stack.pop();
            component.push(position);
            var cx = position % w;
            var cy = (position / w) | 0;
            for (var dy = -1; dy <= 1; dy++) {
              var ny = cy + dy;
              if (ny < 0 || ny >= h) continue;
              for (var dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                var nx = cx + dx;
                if (nx < 0 || nx >= w) continue;
                var next = ny * w + nx;
                if (seen[next] || !analysis.mask[next] || current[next] !== color) continue;
                seen[next] = 1;
                stack.push(next);
              }
            }
          }

          var inComponent = Object.create(null);
          for (var p = 0; p < component.length; p++) inComponent[component[p]] = 1;
          var borderCounts = Object.create(null);
          var borderSeen = Object.create(null);
          var borderTotal = 0;
          for (p = 0; p < component.length; p++) {
            var px = component[p] % w;
            var py = (component[p] / w) | 0;
            for (dy = -1; dy <= 1; dy++) {
              ny = py + dy;
              if (ny < 0 || ny >= h) continue;
              for (dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                nx = px + dx;
                if (nx < 0 || nx >= w) continue;
                var border = ny * w + nx;
                if (inComponent[border] || borderSeen[border]) continue;
                borderSeen[border] = 1;
                borderTotal++;
                var borderColor = current[border];
                borderCounts[borderColor] = (borderCounts[borderColor] || 0) + 1;
              }
            }
          }

          if (!borderTotal) continue;
          var dominant = 0;
          var dominantCount = 0;
          for (var key in borderCounts) {
            if (borderCounts[key] > dominantCount) {
              dominantCount = borderCounts[key];
              dominant = Number(key);
            }
          }
          if (dominant === color || dominantCount / borderTotal < analysis.dominance) continue;
          for (p = 0; p < component.length; p++) current[component[p]] = dominant;
          processed++;
          out.components++;
        }
      }

      passes++;
      if (processed === processedBefore || processed >= maxTarget) break;
      analysis = analyzeIslands(current, w, h, options);
      if (!analysis.hotspots) break;
    }

    var after = analyzeIslands(current, w, h, options);
    out.after = {
      hotspots: after.hotspots,
      singles: after.singles,
      clusters: after.clusters,
      pixels: after.pixels,
    };
    out.changes = buildFixChanges(original, current, w);
    out.applied = out.changes.length;

    if (out.applied && after.hotspots >= initial.hotspots) {
      out.indices = copyIndexGrid(indices, total);
      out.changes = [];
      out.applied = 0;
      out.components = 0;
      out.after = out.before;
      out.reason = 'no-improvement';
      return out;
    }

    out.reason =
      after.hotspots === 0
        ? 'complete'
        : processed >= maxTarget
          ? 'target-cap'
          : 'partial';
    return out;
  }

  function contrastSummary(analysis) {
    var contrast = analysis.contrast || {};
    return {
      lowPairs: contrast.lowPairs || 0,
      lowEdges: contrast.lowEdges || 0,
      score: contrast.score == null ? null : contrast.score,
      minDistance: contrast.minDistance == null ? null : contrast.minDistance,
    };
  }

  function contrastStatsBetter(next, best, nextShift, bestShift, threshold) {
    if (!best) return true;
    if (next.lowPairs !== best.lowPairs) return next.lowPairs < best.lowPairs;
    if (next.lowEdges !== best.lowEdges) return next.lowEdges < best.lowEdges;
    var nextDistance = next.minDistance == null ? -1 : next.minDistance;
    var bestDistance = best.minDistance == null ? -1 : best.minDistance;
    var nextClear = nextDistance >= threshold;
    var bestClear = bestDistance >= threshold;
    if (nextClear !== bestClear) return nextClear;
    if (nextShift !== bestShift) return nextShift < bestShift;
    return nextDistance > bestDistance + 0.000001;
  }

  function contrastStatsImproved(next, current) {
    if (next.lowPairs < current.lowPairs) return true;
    if (next.lowPairs > current.lowPairs) return false;
    if (next.lowEdges < current.lowEdges) return true;
    if (next.lowEdges > current.lowEdges) return false;
    var nextDistance = next.minDistance == null ? -1 : next.minDistance;
    var currentDistance = current.minDistance == null ? -1 : current.minDistance;
    return nextDistance > currentDistance + 0.000001;
  }

  function paletteChangeList(before, after) {
    var changes = [];
    for (var i = 0; i < after.length; i++) {
      var a = after[i];
      var b = before[i];
      if (!a || !b) continue;
      if (a.r === b.r && a.g === b.g && a.b === b.b) continue;
      var fromHsl = rgbToHsl(b.r, b.g, b.b);
      var toHsl = rgbToHsl(a.r, a.g, a.b);
      changes.push({
        index: i,
        from: { r: b.r, g: b.g, b: b.b },
        to: { r: a.r, g: a.g, b: a.b },
        fromLightness: roundTo(fromHsl.l, 1),
        toLightness: roundTo(toHsl.l, 1),
      });
    }
    return changes;
  }

  var CONTRAST_DELTAS = [5, 9, 14, 20, 28];

  /**
   * Separates adjacent palette colours whose OKLab distance is below the
   * diagnostic threshold. Only lightness is moved, in HSL, so hue and
   * saturation are preserved. Each candidate is checked with analyzePalette
   * and accepted only when the weak-pair count or its covered edges go down.
   * The indices are untouched; the returned palette has the same length.
   */
  function boostPaletteContrast(palette, indices, width, height, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var out = {
      palette: palette ? clonePaletteColors(palette) : [],
      changes: [],
      before: null,
      after: null,
      evaluations: 0,
      steps: 0,
      skipped: false,
      reason: '',
    };

    if (
      !total ||
      !indices ||
      indices.length < total ||
      !palette ||
      !palette.length
    ) {
      out.skipped = true;
      out.reason = 'input';
      return out;
    }

    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    if (total > maxPixels) {
      out.skipped = true;
      out.reason = 'grid';
      return out;
    }

    var maxSteps =
      options.maxSteps == null ? 8 : Math.max(0, Math.round(options.maxSteps));
    var maxEvaluations =
      options.maxEvaluations == null
        ? Math.max(8, Math.min(48, Math.round(1200000 / Math.max(1, total))))
        : Math.max(0, Math.round(options.maxEvaluations));

    var analysisOptions = { maxPixels: maxPixels };
    if (options.lowDistance != null) analysisOptions.lowDistance = options.lowDistance;
    if (options.nearDistance != null) analysisOptions.nearDistance = options.nearDistance;

    var current = out.palette;
    var analysis = analyzePalette(indices, w, h, current, analysisOptions);
    var currentStats = contrastSummary(analysis);
    out.before = currentStats;

    if (!currentStats.lowPairs) {
      out.after = currentStats;
      out.reason = 'clean';
      return out;
    }

    var stopReason = '';
    while (out.steps < maxSteps) {
      if (out.evaluations >= maxEvaluations) {
        stopReason = 'limit';
        break;
      }
      var worst = analysis.contrast.worst;
      if (!worst || !worst.length) {
        stopReason = 'no-improvement';
        break;
      }
      var pair = worst[0];
      var indexes = [pair.a, pair.b];
      var lab = [rgbToOklab(current[pair.a]), rgbToOklab(current[pair.b])];
      var directions = [0, 0];
      if (lab[0].L < lab[1].L) directions = [-1, 1];
      else if (lab[0].L > lab[1].L) directions = [1, -1];
      else directions = [-1, 1];

      var bestPalette = null;
      var bestStats = null;
      var bestAnalysis = null;
      var bestShift = Infinity;
      var threshold = analysis.contrast.threshold;
      for (var d = 0; d < CONTRAST_DELTAS.length && out.evaluations < maxEvaluations; d++) {
        var delta = CONTRAST_DELTAS[d];
        var variants = [];
        for (var one = 0; one < indexes.length; one++) {
          variants.push([one]);
        }
        variants.push([0, 1]);

        for (var v = 0; v < variants.length && out.evaluations < maxEvaluations; v++) {
          var variant = variants[v];
          var candidate = clonePaletteColors(current);
          var shifted = false;
          for (var vi = 0; vi < variant.length; vi++) {
            var which = variant[vi];
            var index = indexes[which];
            var color = current[index];
            var hsl = rgbToHsl(color.r, color.g, color.b);
            var lightness = clamp(hsl.l + directions[which] * delta, 2, 98);
            if (Math.abs(lightness - hsl.l) < 0.2) continue;
            var rgb = hslToRgb(hsl.h, hsl.s, lightness);
            if (rgb.r === color.r && rgb.g === color.g && rgb.b === color.b) continue;
            candidate[index] = rgb;
            shifted = true;
          }
          if (!shifted) continue;
          var candidateAnalysis = analyzePalette(indices, w, h, candidate, analysisOptions);
          out.evaluations++;
          var candidateStats = contrastSummary(candidateAnalysis);
          if (!contrastStatsImproved(candidateStats, currentStats)) continue;
          var shift = delta * variant.length;
          if (
            contrastStatsBetter(
              candidateStats,
              bestStats,
              shift,
              bestShift,
              threshold
            )
          ) {
            bestPalette = candidate;
            bestStats = candidateStats;
            bestAnalysis = candidateAnalysis;
            bestShift = shift;
          }
        }
      }

      if (!bestPalette) {
        if (!stopReason) stopReason = 'no-improvement';
        break;
      }
      current = bestPalette;
      analysis = bestAnalysis;
      currentStats = bestStats;
      out.steps++;
    }

    out.palette = current;
    out.after = currentStats;
    out.changes = paletteChangeList(palette, current);
    out.reason =
      currentStats.lowPairs === 0
        ? 'complete'
        : out.steps >= maxSteps
          ? 'limit'
          : out.evaluations >= maxEvaluations
            ? 'limit'
            : stopReason || 'partial';
    return out;
  }

  function copyColumn(source, w, h, fromX, toX) {
    var out = source.slice();
    for (var y = 0; y < h; y++) out[y * w + toX] = source[y * w + fromX];
    return out;
  }

  function copyRow(source, w, h, fromY, toY) {
    var out = source.slice();
    for (var x = 0; x < w; x++) out[toY * w + x] = source[fromY * w + x];
    return out;
  }

  function mixedColumnFix(source, w, h, seamX) {
    var out = source.slice();
    for (var y = 0; y < h; y++) {
      var left = source[y * w + seamX - 1];
      var right = source[y * w + seamX];
      if (left === right) continue;
      var leftInner = seamX - 2 >= 0 ? source[y * w + seamX - 2] : -2;
      var rightInner = seamX + 1 < w ? source[y * w + seamX + 1] : -2;
      var leftStrong = leftInner === left;
      var rightStrong = rightInner === right;
      if (leftStrong && rightStrong) continue;
      if (rightStrong && !leftStrong) out[y * w + seamX - 1] = right;
      else out[y * w + seamX] = left;
    }
    return out;
  }

  function mixedRowFix(source, w, h, seamY) {
    var out = source.slice();
    for (var x = 0; x < w; x++) {
      var top = source[(seamY - 1) * w + x];
      var bottom = source[seamY * w + x];
      if (top === bottom) continue;
      var topInner = seamY - 2 >= 0 ? source[(seamY - 2) * w + x] : -2;
      var bottomInner = seamY + 1 < h ? source[(seamY + 1) * w + x] : -2;
      var topStrong = topInner === top;
      var bottomStrong = bottomInner === bottom;
      if (topStrong && bottomStrong) continue;
      if (bottomStrong && !topStrong) out[(seamY - 1) * w + x] = bottom;
      else out[seamY * w + x] = top;
    }
    return out;
  }

  function tileSeamVariants(source, w, h, seam) {
    var variants = [];
    if (seam.orientation === 'v') {
      variants.push(copyColumn(source, w, h, seam.position - 1, seam.position));
      variants.push(copyColumn(source, w, h, seam.position, seam.position - 1));
      variants.push(mixedColumnFix(source, w, h, seam.position));
    } else {
      variants.push(copyRow(source, w, h, seam.position - 1, seam.position));
      variants.push(copyRow(source, w, h, seam.position, seam.position - 1));
      variants.push(mixedRowFix(source, w, h, seam.position));
    }
    return variants;
  }

  /**
   * Harmonises flagged tile seams. For each flagged seam it tries copying the
   * left/right (or top/bottom) side across the boundary, plus a mixed variant
   * that only follows the locally more coherent side. A candidate is accepted
   * only if the number of flagged seams actually decreases. The original grid
   * is never modified.
   */
  function fixTileSeams(indices, width, height, tileSize, options) {
    options = options || {};
    var w = width | 0;
    var h = height | 0;
    var total = w > 0 && h > 0 ? w * h : 0;
    var size = Math.round(Number(tileSize) || 0);
    var out = {
      indices: total > 0 ? copyIndexGrid(indices, total) : new Int16Array(0),
      changes: [],
      before: null,
      after: null,
      evaluations: 0,
      steps: 0,
      applied: 0,
      skipped: false,
      reason: '',
    };

    if (!total || !indices || indices.length < total) {
      out.skipped = true;
      out.reason = 'input';
      return out;
    }
    var maxPixels =
      options.maxPixels == null ? LINT_MAX_PIXELS : Math.max(1, Math.round(options.maxPixels));
    if (total > maxPixels) {
      out.skipped = true;
      out.reason = 'grid';
      return out;
    }

    var analysisOptions = { maxPixels: maxPixels };
    if (options.seamDrop != null) analysisOptions.seamDrop = options.seamDrop;
    if (options.seamMaxRate != null) analysisOptions.seamMaxRate = options.seamMaxRate;

    var analysis = analyzeTiles(out.indices, w, h, size, analysisOptions);
    if (analysis.skipped) {
      out.skipped = true;
      out.reason = analysis.reason || 'size';
      return out;
    }

    out.before = {
      flagged: analysis.seams.flagged,
      total: analysis.seams.total,
      score: analysis.seams.score,
    };
    if (!analysis.seams.flagged) {
      out.after = out.before;
      out.reason = 'clean';
      return out;
    }

    var maxSeams =
      options.maxSeams == null ? 8 : Math.max(0, Math.round(options.maxSeams));
    var maxEvaluations =
      options.maxEvaluations == null
        ? 24
        : Math.max(0, Math.round(options.maxEvaluations));

    var current = out.indices;
    var stopReason = '';
    while (out.steps < maxSeams) {
      if (out.evaluations >= maxEvaluations) {
        stopReason = 'limit';
        break;
      }
      var flagged = [];
      for (var i = 0; i < analysis.seams.list.length; i++) {
        if (analysis.seams.list[i].flagged) flagged.push(analysis.seams.list[i]);
      }
      if (!flagged.length) break;

      var seam = flagged[0];
      var variants = tileSeamVariants(current, w, h, seam);
      var bestGrid = null;
      var bestAnalysis = null;
      var bestChanges = Infinity;
      for (var v = 0; v < variants.length; v++) {
        if (out.evaluations >= maxEvaluations) {
          stopReason = 'limit';
          break;
        }
        var candidate = variants[v];
        var changes = buildFixChanges(current, candidate, w).length;
        if (!changes) continue;
        var candidateAnalysis = analyzeTiles(candidate, w, h, size, analysisOptions);
        out.evaluations++;
        if (
          candidateAnalysis.seams.flagged < analysis.seams.flagged &&
          (bestGrid == null ||
            candidateAnalysis.seams.flagged < bestAnalysis.seams.flagged ||
            (candidateAnalysis.seams.flagged === bestAnalysis.seams.flagged &&
              changes < bestChanges))
        ) {
          bestGrid = candidate;
          bestAnalysis = candidateAnalysis;
          bestChanges = changes;
        }
      }

      if (!bestGrid) {
        if (!stopReason) stopReason = 'no-improvement';
        break;
      }
      current = bestGrid;
      analysis = bestAnalysis;
      out.steps++;
    }

    out.indices = current;
    out.changes = buildFixChanges(indices, current, w);
    out.applied = out.changes.length;
    out.after = {
      flagged: analysis.seams.flagged,
      total: analysis.seams.total,
      score: analysis.seams.score,
    };
    out.reason =
      analysis.seams.flagged === 0
        ? 'complete'
        : out.steps >= maxSeams
          ? 'limit'
          : out.evaluations >= maxEvaluations
            ? 'limit'
            : stopReason || 'partial';
    return out;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    buildGridProfiles: buildGridProfiles,
    detectGridFromProfiles: detectGridFromProfiles,
    detectGridWithProfiles: detectGridWithProfiles,
    detectGrid: detectGrid,
    measureBlockiness: measureBlockiness,
    refineOffsets: refineOffsets,
    offsetsForScale: offsetsForScale,
    sampleCells: sampleCells,
    buildColorPoints: buildColorPoints,
    quantize: quantize,
    despeckle: despeckle,
    compactPalette: compactPalette,
    composeImageData: composeImageData,
    upscaleImageData: upscaleImageData,
    resizeImageDataNearest: resizeImageDataNearest,
    resizeIndexed: resizeIndexed,
    lintPixelArt: lintPixelArt,
    analyzePalette: analyzePalette,
    groupSimilarColors: groupSimilarColors,
    analyzeIslands: analyzeIslands,
    analyzeTiles: analyzeTiles,
    autoFixLines: autoFixLines,
    removeIslands: removeIslands,
    boostPaletteContrast: boostPaletteContrast,
    fixTileSeams: fixTileSeams,
    rgbToOklab: rgbToOklab,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbToHex: rgbToHex,
    MAX_GRID_SCALE: MAX_GRID_SCALE,
    RESIZE_MAX_SIDE: RESIZE_MAX_SIDE,
    RESIZE_MAX_PIXELS: RESIZE_MAX_PIXELS,
    LINT_MAX_PIXELS: LINT_MAX_PIXELS,
  };
});
