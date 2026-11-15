/*
 * Pixel Cleaner — logica dell'interfaccia.
 * Tutta l'elaborazione avviene localmente nel browser.
 */
(function () {
  'use strict';

  var E = window.PixelEngine;
  if (!E) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:system-ui;color:#fff">Errore: engine.js non è stato caricato.</p>';
    return;
  }

  var $ = function (id) {
    return document.getElementById(id);
  };

  var el = {
    sourceCanvas: $('sourceCanvas'),
    resultCanvas: $('resultCanvas'),
    sourceMeta: $('sourceMeta'),
    resultMeta: $('resultMeta'),
    sourcePlaceholder: $('sourcePlaceholder'),
    resultPlaceholder: $('resultPlaceholder'),
    sourcePanel: $('sourcePanel'),
    resultPanel: $('resultPanel'),
    resultWrap: $('resultWrap'),
    tileGrid: $('tileGrid'),
    tileSeams: $('tileSeams'),
    resultFlag: $('resultFlag'),
    busyOverlay: $('busyOverlay'),
    busyText: $('busyText'),
    toast: $('toast'),
    dropOverlay: $('dropOverlay'),
    showGridToggle: $('showGridToggle'),

    fileInput: $('fileInput'),
    openBtn: $('openBtn'),
    openBtn2: $('openBtn2'),
    demoBtn: $('demoBtn'),
    pasteBtn: $('pasteBtn'),

    gridBadge: $('gridBadge'),
    confidenceDot: $('confidenceDot'),
    detectSummary: $('detectSummary'),
    gridHint: $('gridHint'),
    scaleInput: $('scaleInput'),
    scaleMinus: $('scaleMinus'),
    scalePlus: $('scalePlus'),
    scaleSuggestions: $('scaleSuggestions'),
    scaleSuggestionList: $('scaleSuggestionList'),
    autoDetectBtn: $('autoDetectBtn'),
    manualScaleRow: $('manualScaleRow'),
    offsetRow: $('offsetRow'),
    offsetXInput: $('offsetXInput'),
    offsetYInput: $('offsetYInput'),

    colorCountBadge: $('colorCountBadge'),
    colorPresetsWrap: $('colorPresetsWrap'),
    colorPresets: $('colorPresets'),
    colorCountHint: $('colorCountHint'),
    hueShiftInput: $('hueShiftInput'),
    hueShiftOut: $('hueShiftOut'),
    hslSummary: $('hslSummary'),
    palette: $('palette'),
    paletteTools: $('paletteTools'),
    paletteCurrent: $('paletteCurrent'),
    paletteCurrentHex: $('paletteCurrentHex'),
    paletteCurrentHsl: $('paletteCurrentHsl'),
    paletteHelp: $('paletteHelp'),
    palettePicker: $('palettePicker'),
    paletteColorInput: $('paletteColorInput'),
    paletteResetBtn: $('paletteResetBtn'),

    despeckleSelect: $('despeckleSelect'),
    binaryAlphaInput: $('binaryAlphaInput'),
    marginInput: $('marginInput'),
    marginOut: $('marginOut'),

    resizeWidthInput: $('resizeWidthInput'),
    resizeHeightInput: $('resizeHeightInput'),
    resizeMethodSelect: $('resizeMethodSelect'),
    resizeMarginInput: $('resizeMarginInput'),
    resizeAlphaInput: $('resizeAlphaInput'),
    resizeAlphaOut: $('resizeAlphaOut'),
    resizeApplyBtn: $('resizeApplyBtn'),
    resizeResetBtn: $('resizeResetBtn'),
    resizeBadge: $('resizeBadge'),
    resizeInfo: $('resizeInfo'),

    diagnosticsToggle: $('diagnosticsToggle'),
    diagnosticsBadge: $('diagnosticsBadge'),
    lineQuality: $('lineQuality'),
    paletteQuality: $('paletteQuality'),
    lintPerfectRatio: $('lintPerfectRatio'),
    lintPerfectBar: $('lintPerfectBar'),
    lintPatternStats: $('lintPatternStats'),
    lintContrastScore: $('lintContrastScore'),
    lintContrastBar: $('lintContrastBar'),
    lintPaletteStats: $('lintPaletteStats'),
    lintLegend: $('lintLegend'),
    lintDoubles: $('lintDoubles'),
    lintJaggies: $('lintJaggies'),
    lintLines: $('lintLines'),
    lintIrregular: $('lintIrregular'),
    lintContrast: $('lintContrast'),
    lintIslands: $('lintIslands'),
    lintTileSeams: $('lintTileSeams'),
    lintIslandItem: $('lintIslandItem'),
    lintTileItem: $('lintTileItem'),
    lintHint: $('lintHint'),
    tileQuality: $('tileQuality'),
    tileSizeInput: $('tileSizeInput'),
    tileMinus: $('tileMinus'),
    tilePlus: $('tilePlus'),
    lintTileStats: $('lintTileStats'),
    fixDoubles: $('fixDoubles'),
    fixJaggies: $('fixJaggies'),
    fixLines: $('fixLines'),
    fixIrregular: $('fixIrregular'),
    fixContrast: $('fixContrast'),
    fixIslands: $('fixIslands'),
    fixTile: $('fixTile'),
    undoFixBtn: $('undoFixBtn'),
    fixHistoryInfo: $('fixHistoryInfo'),

    exportScaleSelect: $('exportScaleSelect'),
    outputSizeSelect: $('outputSizeSelect'),
    exportBtn: $('exportBtn'),
    copyImageBtn: $('copyImageBtn'),
    statusInfo: $('statusInfo'),
  };

  var state = {
    source: null,
    sourceName: 'immagine.png',
    detection: null,
    offsetX: 0,
    offsetY: 0,
    colorBaseCount: 0,
    colorLimit: 0,
    hueShift: 0,
    despeckleStrength: 0,
    binaryAlpha: true,
    marginRatio: 0.25,
    showGrid: true,
    showDiagnostics: false,
    tileSize: 0,
    resizeWidth: 128,
    resizeHeight: 128,
    resizeMethod: 'area',
    resizeMargin: 2,
    resizeAlpha: 0.3,
    resizeActive: false,
    nativeResult: null,
    exportFactor: 1,
    outputPercent: 100,
    pendingExportReset: true,
    result: null,
    paletteSelected: null,
    paletteOverrides: null,
    paletteBaseSig: '',
    paletteGroups: null,
    paletteHintTimer: null,
    fixHistory: [],
    fixing: false,
    reqId: 0,
    timer: null,
    toastTimer: null,
  };

  // ------------------------------------------------------------------------
  // Utility
  // ------------------------------------------------------------------------

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function mod(n, m) {
    return ((n % m) + m) % m;
  }

  // ------------------------------------------------------------------------
  // Configurazione iniziale (config.js)
  // ------------------------------------------------------------------------

  var CONFIG = (function () {
    var raw = window.PIXEL_CLEANER_CONFIG || {};
    var source = raw.defaults || {};

    function number(value, fallback) {
      var n = Number(value);
      return isFinite(n) ? n : fallback;
    }

    function bool(value, fallback) {
      return typeof value === 'boolean' ? value : fallback;
    }

    var presets = [];
    var rawPresets = Array.isArray(raw.palettePresets)
      ? raw.palettePresets
      : [4, 8, 12, 16, 24, 32, 48];
    for (var i = 0; i < rawPresets.length; i++) {
      var n = Number(rawPresets[i]);
      if (!isFinite(n) || n < 1 || n > 64) continue;
      var preset = Math.round(n);
      if (presets.indexOf(preset) === -1) presets.push(preset);
    }
    if (!presets.length) presets = [4, 8, 12, 16, 24, 32, 48];
    presets.sort(function (a, b) {
      return a - b;
    });

    return {
      defaults: {
        despeckle: clamp(Math.round(number(source.despeckle, 0)), 0, 2),
        binaryAlpha: bool(source.binaryAlpha, true),
        margin: clamp(Math.round(number(source.margin, 25)), 0, 40),
        hueShift: clamp(Math.round(number(source.hueShift, 0)), 0, 100),
        showGrid: bool(source.showGrid, true),
        showDiagnostics: bool(source.showDiagnostics, false),
        tileSize: clamp(Math.round(number(source.tileSize, 0)), 0, 256),
        resizeWidth: clamp(Math.round(number(source.resizeWidth, 128)), 8, 1024),
        resizeHeight: clamp(Math.round(number(source.resizeHeight, 128)), 8, 1024),
        resizeMethod: source.resizeMethod === 'nearest' ? 'nearest' : 'area',
        resizeMargin: clamp(Math.round(number(source.resizeMargin, 2)), 0, 16),
        resizeAlpha: clamp(Math.round(number(source.resizeAlpha, 30)), 5, 95),
      },
      palettePresets: presets,
      maxColors: clamp(Math.round(number(raw.maxColors, 64)), 1, 64),
      autoMergeTolerance: clamp(number(raw.autoMergeTolerance, 0.023), 0, 0.2),
      colorGroupTolerance: clamp(number(raw.colorGroupTolerance, 0.035), 0, 0.3),
    };
  })();

  function nextFrame() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        resolve();
      }
      requestAnimationFrame(finish);
      // Fallback for headless/background contexts where rAF may not fire.
      setTimeout(finish, 40);
    });
  }

  function paintRange(input) {
    var min = parseFloat(input.min) || 0;
    var max = parseFloat(input.max) || 100;
    var value = parseFloat(input.value) || 0;
    var pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(2) + '%');
  }

  function maxScaleFor(image) {
    return clamp(
      Math.min(E.MAX_GRID_SCALE, Math.floor(Math.min(image.width, image.height) / 4)),
      1,
      256
    );
  }

  function toast(message, type) {
    el.toast.textContent = message;
    el.toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.toast.className = 'toast';
    }, type === 'error' ? 5000 : 3200);
  }

  function setBusy(active, text) {
    if (text) el.busyText.textContent = text;
    el.busyOverlay.hidden = !active;
    el.resultPanel.setAttribute('aria-busy', active ? 'true' : 'false');
  }

  function setProcessing(active) {
    el.resultPanel.classList.toggle('processing', !!active);
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Impossibile codificare il PNG.'));
      }, 'image/png');
    });
  }

  // ------------------------------------------------------------------------
  // Caricamento immagine
  // ------------------------------------------------------------------------

  function looksLikeImage(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name || '');
  }

  function decodeBlob(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).catch(function () {
        return decodeWithElement(blob);
      });
    }
    return decodeWithElement(blob);
  }

  function decodeWithElement(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        // The decoded image stays usable after the URL is revoked.
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 30000);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Formato immagine non riconosciuto o file danneggiato.'));
      };
      img.src = url;
    });
  }

  function imageSize(source) {
    return {
      width: source.naturalWidth || source.width || 0,
      height: source.naturalHeight || source.height || 0,
    };
  }

  async function openImage(file, nameOverride) {
    if (!file || !looksLikeImage(file)) {
      toast('Formato non supportato. Usa PNG, JPG, WebP, GIF, BMP o AVIF.', 'error');
      return;
    }

    var name = nameOverride || file.name || 'immagine.png';
    state.reqId++;
    clearTimeout(state.timer);
    setBusy(true, 'Caricamento immagine…');

    var bitmap = null;
    try {
      await nextFrame();
      bitmap = await decodeBlob(file);
      var size = imageSize(bitmap);
      var w = size.width;
      var h = size.height;
      if (!w || !h) throw new Error('Impossibile leggere le dimensioni dell\'immagine.');
      if (Math.max(w, h) > 8192 || w * h > 40e6) {
        throw new Error('Immagine troppo grande: massimo 8192 px per lato e 40 megapixel.');
      }

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, w, h);
      if (typeof bitmap.close === 'function') {
        bitmap.close();
        bitmap = null;
      }
      var imageData = ctx.getImageData(0, 0, w, h);

      state.source = imageData;
      state.sourceName = name;
      state.detection = null;
      state.offsetX = 0;
      state.offsetY = 0;
      state.result = null;
      state.nativeResult = null;
      state.resizeActive = false;
      state.exportFactor = 1;
      state.outputPercent = 100;
      state.pendingExportReset = true;
      state.colorBaseCount = 0;
      state.colorLimit = 0;
      buildColorPresets(0);
      resetPaletteState();
      syncResizeUI();

      el.sourceCanvas.hidden = true;
      el.sourcePlaceholder.hidden = false;
      el.resultCanvas.hidden = true;
      el.resultPlaceholder.hidden = false;
      el.resultFlag.hidden = true;
      el.palette.replaceChildren();
      el.colorCountBadge.textContent = '—';
      syncExportOptions();
      el.sourceMeta.textContent = w + ' × ' + h + ' px';
      el.sourceMeta.title = name;
      el.resultMeta.textContent = 'Analisi in corso…';

      setBusy(true, 'Rilevamento della griglia…');
      await nextFrame();

      var detection;
      try {
        detection = E.detectGrid(imageData);
      } catch (err) {
        console.error('Rilevamento non riuscito', err);
        detection = {
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          confidence: 0,
          auto: true,
          rejected: true,
        };
      }

      state.detection = detection;
      state.offsetX = detection.offsetX;
      state.offsetY = detection.offsetY;

      syncDetectionUI();
      renderSourcePreview();
      await runPipeline({ showProcessing: false });

      if (state.result) {
        updateColorPresetButtons();
        el.resultFlag.hidden = false;
      }
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : 'Impossibile aprire questa immagine.', 'error');
    } finally {
      if (bitmap && typeof bitmap.close === 'function') {
        try {
          bitmap.close();
        } catch (e) {
          /* ignore */
        }
      }
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------------
  // Anteprime
  // ------------------------------------------------------------------------

  var scratchCanvas = null;

  function getScratch(w, h) {
    if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
    if (scratchCanvas.width !== w) scratchCanvas.width = w;
    if (scratchCanvas.height !== h) scratchCanvas.height = h;
    return {
      canvas: scratchCanvas,
      ctx: scratchCanvas.getContext('2d'),
    };
  }

  function renderSourcePreview() {
    if (!state.source) return;
    var src = state.source;
    var maxSide = Math.max(src.width, src.height);
    var scale = 1;
    if (maxSide > 1400) scale = 1400 / maxSide;
    else if (maxSide < 480) scale = 480 / maxSide;
    var pw = Math.max(1, Math.round(src.width * scale));
    var ph = Math.max(1, Math.round(src.height * scale));

    var canvas = el.sourceCanvas;
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, pw, ph);

    var scratch = getScratch(src.width, src.height);
    scratch.ctx.putImageData(src, 0, 0);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(scratch.canvas, 0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;

    if (state.showGrid && state.detection) {
      drawGridOverlay(ctx, pw, ph, src.width, src.height);
    }

    canvas.hidden = false;
    el.sourcePlaceholder.hidden = true;
  }

  function drawGridOverlay(ctx, pw, ph, sw, sh) {
    var scale = state.detection.scale;
    if (!scale || scale <= 1) return;

    var stepX = (scale * pw) / sw;
    var stepY = (scale * ph) / sh;
    if (stepX < 5.5 || stepY < 5.5) return;

    var ox = mod(state.offsetX, scale);
    var oy = mod(state.offsetY, scale);
    var x;
    var y;

    ctx.save();
    ctx.beginPath();
    for (x = ox; x < sw; x += scale) {
      if (x <= 0.01) continue;
      var px = Math.round((x * pw) / sw) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, ph);
    }
    for (y = oy; y < sh; y += scale) {
      if (y <= 0.01) continue;
      var py = Math.round((y * ph) / sh) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(pw, py);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(2, 6, 11, 0.18)';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.26)';
    ctx.stroke();
    ctx.restore();
  }

  function drawResultPreview() {
    if (!state.result) return;
    var composed = state.result.composed;
    var canvas = el.resultCanvas;
    canvas.width = composed.width;
    canvas.height = composed.height;
    var ctx = canvas.getContext('2d');
    var data = new ImageData(composed.data, composed.width, composed.height);
    ctx.putImageData(data, 0, 0);
    if (state.showDiagnostics && state.result.lint) {
      drawLintOverlay(ctx, state.result.lint);
    }
    canvas.hidden = false;
    el.resultPlaceholder.hidden = true;
    el.resultFlag.hidden = false;
    applyResultPreviewScale();
    updateTileGrid();
  }

  function applyResultPreviewScale() {
    var percent = clamp(Math.round(Number(state.outputPercent) || 100), 1, 100);
    var canvas = el.resultCanvas;
    if (percent === 100) {
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
    } else {
      canvas.style.width = percent + '%';
      canvas.style.height = percent + '%';
    }
  }

  function updateTileGrid() {
    var canvas = el.resultCanvas;
    var grid = el.tileGrid;
    var seams = el.tileSeams;

    function hide() {
      if (grid) grid.hidden = true;
      if (seams) {
        seams.hidden = true;
        seams.replaceChildren();
      }
    }

    if (!state.result || state.tileSize < 2 || !canvas || canvas.hidden || !canvas.width) {
      hide();
      return;
    }

    var canvasRect = canvas.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) {
      hide();
      return;
    }

    var scale = Math.min(canvasRect.width / canvas.width, canvasRect.height / canvas.height);
    var width = canvas.width * scale;
    var height = canvas.height * scale;
    var stepX = (width * state.tileSize) / canvas.width;
    var stepY = (height * state.tileSize) / canvas.height;
    if (stepX < 5 || stepY < 5) {
      hide();
      return;
    }

    var wrapRect = el.resultWrap.getBoundingClientRect();
    var left = canvasRect.left - wrapRect.left + (canvasRect.width - width) / 2;
    var top = canvasRect.top - wrapRect.top + (canvasRect.height - height) / 2;
    grid.style.left = left + 'px';
    grid.style.top = top + 'px';
    grid.style.width = width + 'px';
    grid.style.height = height + 'px';
    grid.style.setProperty('--tile-step-x', stepX + 'px');
    grid.style.setProperty('--tile-step-y', stepY + 'px');
    grid.hidden = false;

    var tileInfo = state.result.lint ? state.result.lint.tiles : null;
    if (!state.showDiagnostics || !tileInfo || tileInfo.skipped || !tileInfo.seams) {
      seams.hidden = true;
      seams.replaceChildren();
      return;
    }

    seams.style.left = left + 'px';
    seams.style.top = top + 'px';
    seams.style.width = width + 'px';
    seams.style.height = height + 'px';
    seams.replaceChildren();
    var lines = 0;
    var list = tileInfo.seams.list || [];
    for (var i = 0; i < list.length; i++) {
      if (!list[i].flagged) continue;
      var line = document.createElement('span');
      line.className = list[i].orientation === 'v' ? 'v' : 'h';
      if (list[i].orientation === 'v') {
        line.style.left = (list[i].position / canvas.width) * width + 'px';
      } else {
        line.style.top = (list[i].position / canvas.height) * height + 'px';
      }
      seams.appendChild(line);
      lines++;
    }
    seams.hidden = lines === 0;
  }

  function drawLintOverlay(ctx, lint) {
    if (!lint || lint.skipped) return;
    var w = lint.width;
    var h = lint.height;
    var layers = [
      { key: 'islands', mask: lint.islands ? lint.islands.mask : null, color: '#c6ff5e' },
      {
        key: 'contrast',
        mask: lint.palette && lint.palette.contrast ? lint.palette.contrast.mask : null,
        color: '#ff6b81',
      },
      { key: 'patterns', mask: lint.patterns ? lint.patterns.mask : null, color: '#b590ff' },
      { key: 'doubles', mask: lint.doubles, color: '#ff5ca8' },
      { key: 'jaggies', mask: lint.jaggies, color: '#ffb020' },
      { key: 'lines', mask: lint.lines, color: '#6fe7ff' },
    ];
    // Line, island and tile overlays stay available in the code but only
    // adjacent contrast is surfaced in the current UI.
    var visible = { contrast: true };
    for (var l = 0; l < layers.length; l++) {
      if (!visible[layers[l].key]) continue;
      var mask = layers[l].mask;
      if (!mask) continue;
      ctx.fillStyle = layers[l].color;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (mask[y * w + x]) ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // ------------------------------------------------------------------------
  // Pipeline
  // ------------------------------------------------------------------------

  function scheduleProcess(delay) {
    clearTimeout(state.timer);
    state.timer = setTimeout(function () {
      runPipeline();
    }, delay == null ? 60 : delay);
  }

  async function runPipeline(options) {
    options = options || {};
    if (!state.source || !state.detection) return;

    var id = ++state.reqId;
    var showProcessing = options.showProcessing !== false;
    if (showProcessing) setProcessing(true);

    var started = performance.now();
    await nextFrame();
    if (id !== state.reqId) return;

    try {
      var det = state.detection;
      var scale = clamp(
        Math.round(det.scale),
        1,
        Math.max(1, Math.min(state.source.width, state.source.height))
      );
      var offsetX = mod(Math.round(state.offsetX), scale);
      var offsetY = mod(Math.round(state.offsetY), scale);

      var cells = E.sampleCells(state.source, {
        scale: scale,
        offsetX: offsetX,
        offsetY: offsetY,
        marginRatio: state.marginRatio,
        binaryAlpha: state.binaryAlpha,
      });

      // The initial palette size follows the image: one automatic pass at up
      // to 64 colours decides how many buttons to offer. Every preset then
      // quantizes to that exact number of colours.
      if (!state.colorBaseCount) {
        var autoPalette = E.quantize(cells, {
          mode: 'auto',
          maxAutoColors: CONFIG.maxColors,
          mergeThreshold: CONFIG.autoMergeTolerance,
        });
        state.colorBaseCount = clamp(autoPalette.palette.length, 0, CONFIG.maxColors);
        state.colorLimit = Math.max(1, state.colorBaseCount);
        buildColorPresets(state.colorBaseCount);
      }
      state.colorLimit = clamp(
        Math.round(state.colorLimit || state.colorBaseCount || 1),
        1,
        CONFIG.maxColors
      );
      var quantized = E.quantize(cells, {
        mode: 'manual',
        colors: state.colorLimit,
      });

      var basePalette = clonePalette(quantized.palette);
      var paletteSig = paletteSignature(basePalette);
      if (paletteSig !== state.paletteBaseSig) {
        state.paletteBaseSig = paletteSig;
        state.paletteSelected = null;
        state.paletteOverrides = null;
        clearPaletteFeedback();
      }
      quantized.palette = applyPaletteOverrides(
        shiftPaletteHues(basePalette, state.hueShift),
        state.paletteOverrides
      );

      var indices = quantized.indices;
      if (state.despeckleStrength > 0) {
        indices = E.despeckle(indices, quantized.width, quantized.height, state.despeckleStrength);
      }

      var composed = E.composeImageData(
        indices,
        quantized.palette,
        quantized.width,
        quantized.height,
        quantized.alpha
      );

      if (id !== state.reqId) return;

      var lint = E.lintPixelArt(indices, quantized.width, quantized.height);
      if (!lint.skipped) {
        lint.palette = E.analyzePalette(
          indices,
          quantized.width,
          quantized.height,
          quantized.palette
        );
        lint.islands = E.analyzeIslands(indices, quantized.width, quantized.height);
        lint.tiles =
          state.tileSize >= 2
            ? E.analyzeTiles(indices, quantized.width, quantized.height, state.tileSize)
            : null;
      }

      var nativeResult = {
        cells: cells,
        cellsScale: scale,
        basePalette: basePalette,
        quantized: quantized,
        indices: indices,
        composed: composed,
        lint: lint,
        elapsed: performance.now() - started,
      };

      if (id !== state.reqId) return;

      state.nativeResult = nativeResult;
      if (state.resizeActive) {
        var resized = buildResizedResult(nativeResult, {
          width: state.resizeWidth,
          height: state.resizeHeight,
          margin: state.resizeMargin,
          method: state.resizeMethod,
          alphaThreshold: state.resizeAlpha,
        });
        if (resized) {
          state.result = resized;
        } else {
          state.resizeActive = false;
          state.result = nativeResult;
          toast(
            'Ridimensionamento non disponibile: uso la dimensione originale.',
            'error'
          );
        }
      } else {
        state.result = nativeResult;
      }

      clearFixHistory();

      drawResultPreview();
      updatePalette();
      updateResultInfo();
      syncDiagnosticsUI();
      syncExportOptions();
      syncResizeUI();
      updateStatus();
    } catch (err) {
      console.error(err);
      toast('Errore durante l\'elaborazione: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      if (showProcessing && id === state.reqId) setProcessing(false);
    }
  }

  // ------------------------------------------------------------------------
  // Ridimensionamento indicizzato
  // ------------------------------------------------------------------------

  function resizeMethodLabel(method) {
    return method === 'nearest' ? 'Nearest' : 'Area';
  }

  function buildResizedResult(native, settings) {
    if (!native) return null;
    var q = native.quantized;
    var base = native.basePalette && native.basePalette.length
      ? native.basePalette
      : q.palette;
    var res = E.resizeIndexed(native.indices, q.alpha, q.width, q.height, base, {
      width: settings.width,
      height: settings.height,
      method: settings.method,
      margin: settings.margin,
      alphaThreshold: settings.alphaThreshold,
      fit: 'bounds',
    });
    if (res.skipped) return null;

    var palette = applyPaletteOverrides(
      shiftPaletteHues(res.palette, state.hueShift),
      state.paletteOverrides
    );
    var composed = E.composeImageData(
      res.indices,
      palette,
      res.width,
      res.height,
      res.alpha
    );

    var lint = E.lintPixelArt(res.indices, res.width, res.height);
    if (!lint.skipped) {
      lint.palette = E.analyzePalette(
        res.indices,
        res.width,
        res.height,
        palette
      );
      lint.islands = E.analyzeIslands(res.indices, res.width, res.height);
      lint.tiles =
        state.tileSize >= 2
          ? E.analyzeTiles(res.indices, res.width, res.height, state.tileSize)
          : null;
    }

    return {
      cells: native.cells,
      cellsScale: native.cellsScale,
      basePalette: clonePalette(res.palette),
      quantized: {
        width: res.width,
        height: res.height,
        indices: res.indices,
        alpha: res.alpha,
        palette: palette,
        mode: 'resize',
      },
      indices: res.indices,
      composed: composed,
      lint: lint,
      elapsed: native.elapsed,
      autoFixed: !!native.autoFixed,
      resizeInfo: {
        sourceWidth: q.width,
        sourceHeight: q.height,
        width: res.width,
        height: res.height,
        method: res.method,
        margin: res.margin,
        alphaThreshold: res.alphaThreshold,
        contentWidth: res.contentWidth,
        contentHeight: res.contentHeight,
        offsetX: res.offsetX,
        offsetY: res.offsetY,
      },
    };
  }

  function syncResizeUI() {
    var hasNative = !!state.nativeResult;
    var q = state.result ? state.result.quantized : null;
    var nativeQ = state.nativeResult ? state.nativeResult.quantized : null;
    var percent = Math.round(state.resizeAlpha * 100);

    el.resizeWidthInput.value = String(state.resizeWidth);
    el.resizeHeightInput.value = String(state.resizeHeight);
    el.resizeMethodSelect.value = state.resizeMethod;
    el.resizeMarginInput.value = String(state.resizeMargin);
    el.resizeAlphaInput.value = String(percent);
    el.resizeAlphaOut.textContent = percent + '%';
    paintRange(el.resizeAlphaInput);

    var disabled = !hasNative || state.fixing;
    el.resizeWidthInput.disabled = disabled;
    el.resizeHeightInput.disabled = disabled;
    el.resizeMethodSelect.disabled = disabled;
    el.resizeMarginInput.disabled = disabled;
    el.resizeAlphaInput.disabled = disabled;
    el.resizeApplyBtn.disabled = disabled;
    el.resizeResetBtn.disabled = disabled || !state.resizeActive;

    el.resizeBadge.textContent = q ? q.width + ' × ' + q.height : '—';

    if (!state.source) {
      el.resizeInfo.textContent = 'In attesa di un\'immagine.';
    } else if (!hasNative) {
      el.resizeInfo.textContent = 'Analisi in corso…';
    } else if (state.resizeActive && state.result && state.result.resizeInfo) {
      var info = state.result.resizeInfo;
      el.resizeInfo.textContent =
        'Da ' +
        nativeQ.width +
        '×' +
        nativeQ.height +
        ' a ' +
        info.width +
        '×' +
        info.height +
        ' · ' +
        resizeMethodLabel(info.method) +
        ' · margine ' +
        info.margin +
        ' px.';
    } else {
      el.resizeInfo.textContent =
        'Originale ' +
        nativeQ.width +
        '×' +
        nativeQ.height +
        ' · scegli la misura e premi Ridimensiona.';
    }
  }

  function applyResize() {
    if (!state.nativeResult || state.fixing) return;
    var width = clamp(Math.round(Number(el.resizeWidthInput.value) || 0), 8, 1024);
    var height = clamp(Math.round(Number(el.resizeHeightInput.value) || 0), 8, 1024);
    var margin = clamp(Math.round(Number(el.resizeMarginInput.value) || 0), 0, 16);
    var alphaPercent = clamp(Math.round(Number(el.resizeAlphaInput.value) || 0), 5, 95);
    var method = el.resizeMethodSelect.value === 'nearest' ? 'nearest' : 'area';

    state.resizeWidth = width;
    state.resizeHeight = height;
    state.resizeMargin = margin;
    state.resizeAlpha = alphaPercent / 100;
    state.resizeMethod = method;

    var resized = buildResizedResult(state.nativeResult, {
      width: width,
      height: height,
      margin: margin,
      method: method,
      alphaThreshold: state.resizeAlpha,
    });
    if (!resized) {
      toast(
        'Ridimensionamento non riuscito: misura troppo grande o dati non validi.',
        'error'
      );
      return;
    }

    var hadTargetFixes = state.resizeActive && state.fixHistory.length > 0;
    state.resizeActive = true;
    state.result = resized;
    state.paletteSelected = null;
    clearPaletteFeedback();
    clearFixHistory();
    state.pendingExportReset = true;
    state.outputPercent = 100;

    drawResultPreview();
    updatePalette();
    updateResultInfo();
    syncDiagnosticsUI();
    syncExportOptions();
    syncResizeUI();
    updateStatus();
    toast(
      'Ridimensionato a ' +
        resized.quantized.width +
        '×' +
        resized.quantized.height +
        ' (' +
        resizeMethodLabel(method) +
        ').' +
        (hadTargetFixes
          ? ' Le correzioni automatiche fatte alla misura precedente sono state azzerate.'
          : ''),
      'success'
    );
  }

  function resetResize() {
    if (!state.nativeResult) return;
    state.resizeActive = false;
    state.result = state.nativeResult;
    state.paletteSelected = null;
    clearPaletteFeedback();
    clearFixHistory();
    state.pendingExportReset = true;
    state.outputPercent = 100;
    refreshResultAfterFix();
    syncExportOptions();
    syncResizeUI();
    toast('Dimensione originale ripristinata.', 'success');
  }

  // ------------------------------------------------------------------------
  // Rilevamento / controlli griglia
  // ------------------------------------------------------------------------

  function applyScale(value) {
    if (!state.source) return;
    var maxScale = maxScaleFor(state.source);
    var scale = clamp(Math.round(Number(value) || 1), 1, maxScale);
    var suggestions = state.detection && state.detection.suggestions;

    try {
      if (scale === 1) {
        state.detection = {
          scale: 1,
          offsetX: 0,
          offsetY: 0,
          confidence: 1,
          auto: false,
          rejected: false,
        };
      } else {
        state.detection = E.detectGrid(state.source, { forceScale: scale });
      }
    } catch (err) {
      console.error('Scala manuale non riuscita', err);
      state.detection = {
        scale: scale,
        offsetX: 0,
        offsetY: 0,
        confidence: 0,
        auto: false,
        rejected: false,
      };
    }

    // Keep proposing the scales that were plausible for the image even after
    // a manual override; forced detection has no suggestion list of its own.
    if (suggestions && suggestions.length) {
      state.detection.suggestions = suggestions.slice();
    }
    state.detection.fromSuggestion = !!(
      suggestions && suggestions.indexOf(scale) !== -1
    );

    state.offsetX = state.detection.offsetX || 0;
    state.offsetY = state.detection.offsetY || 0;
    syncDetectionUI();
    renderSourcePreview();
    scheduleProcess(0);
  }

  function autoDetect() {
    if (!state.source) return;
    var detection;
    try {
      detection = E.detectGrid(state.source);
    } catch (err) {
      console.error('Rilevamento automatico non riuscito', err);
      toast('Rilevamento non riuscito. Imposta la scala manualmente.', 'error');
      return;
    }
    state.detection = detection;
    state.offsetX = detection.offsetX;
    state.offsetY = detection.offsetY;
    syncDetectionUI();
    renderSourcePreview();
    scheduleProcess(0);
  }

  function updateOffset() {
    if (!state.source || !state.detection) return;
    var scale = state.detection.scale;
    state.offsetX = mod(Number(el.offsetXInput.value) || 0, scale);
    state.offsetY = mod(Number(el.offsetYInput.value) || 0, scale);
    el.offsetXInput.value = String(state.offsetX);
    el.offsetYInput.value = String(state.offsetY);
    renderSourcePreview();
    scheduleProcess(0);
  }

  function renderScaleSuggestions(det) {
    var list = el.scaleSuggestionList;
    list.replaceChildren();
    if (!state.source || !det) {
      el.scaleSuggestions.hidden = true;
      return 0;
    }

    var maxScale = maxScaleFor(state.source);
    var suggestions = det.suggestions || [];
    var seen = {};
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < suggestions.length; i++) {
      var value = Math.round(Number(suggestions[i]));
      if (!value || value < 1 || value > maxScale || seen[value]) continue;
      seen[value] = true;

      var button = document.createElement('button');
      var active = value === det.scale;
      button.type = 'button';
      button.className = 'scale-chip' + (active ? ' active' : '');
      button.textContent = value + '×';
      button.title = value === 1 ? 'Nessun ingrandimento (1×)' : 'Usa la scala ' + value + '×';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('data-scale', String(value));
      fragment.appendChild(button);
    }
    list.appendChild(fragment);
    // A single suggestion is not a choice: hide the row.
    var count = list.childElementCount;
    el.scaleSuggestions.hidden = count < 2;
    return count;
  }

  function syncDetectionUI() {
    var hasImage = !!state.source;
    var det = state.detection;

    el.scaleInput.disabled = !hasImage;
    el.scaleMinus.disabled = !hasImage;
    el.scalePlus.disabled = !hasImage;
    el.autoDetectBtn.disabled = !hasImage;
    el.despeckleSelect.disabled = !hasImage;
    el.binaryAlphaInput.disabled = !hasImage;
    el.marginInput.disabled = !hasImage;
    el.hueShiftInput.disabled = !hasImage;
    setColorPresetsDisabled(!hasImage);

    el.confidenceDot.className = 'status-dot';

    if (!hasImage || !det) {
      el.scaleInput.value = '1';
      el.offsetXInput.value = '0';
      el.offsetYInput.value = '0';
      el.offsetXInput.disabled = true;
      el.offsetYInput.disabled = true;
      el.detectSummary.textContent = 'In attesa di un\'immagine';
      el.gridHint.textContent = 'La griglia viene rilevata automaticamente.';
      el.gridBadge.textContent = '—';
      el.colorCountBadge.textContent = '—';
      el.palette.replaceChildren();
      el.paletteTools.hidden = true;
      el.paletteCurrentHsl.hidden = true;
      el.exportScaleSelect.disabled = true;
      el.exportBtn.disabled = true;
      el.copyImageBtn.disabled = true;
      el.manualScaleRow.hidden = false;
      el.offsetRow.hidden = true;
      renderScaleSuggestions(null);
      syncDiagnosticsUI();
      return;
    }

    var maxScale = maxScaleFor(state.source);
    el.scaleInput.max = String(maxScale);
    el.scaleInput.value = String(det.scale);
    el.offsetXInput.max = String(Math.max(0, det.scale - 1));
    el.offsetYInput.max = String(Math.max(0, det.scale - 1));
    el.offsetXInput.value = String(state.offsetX);
    el.offsetYInput.value = String(state.offsetY);
    el.offsetXInput.disabled = det.scale <= 1;
    el.offsetYInput.disabled = det.scale <= 1;

    el.gridBadge.textContent = det.scale + '×';

    var dot = '';
    var summary = '';
    var hint = '';

    if (det.auto && det.rejected) {
      dot = 'bad';
      summary = 'Nessuna griglia affidabile';
      hint =
        'L\'immagine potrebbe essere già 1× oppure troppo sfocata. Se la pixel art è ingrandita, imposta la scala manualmente: compariranno gli offset.';
    } else if (det.fromSuggestion) {
      dot = 'ok';
      summary = 'Griglia ' + det.scale + '× · proposta';
      hint = 'Scala scelta dalle proposte. Se i bordi non coincidono, scegli un\'altra proposta.';
    } else if (det.scale === 1) {
      dot = det.auto ? 'ok' : 'warn';
      summary = det.auto ? 'Nessun ingrandimento (1×)' : 'Griglia 1× · manuale';
      hint = det.auto
        ? 'L\'immagine sembra già alla risoluzione dei pixel logici.'
        : 'Scala impostata manualmente. Premi Auto per rilevarla di nuovo.';
    } else if (!det.auto) {
      dot = 'warn';
      summary = 'Griglia ' + det.scale + '× · manuale';
      hint =
        'Scala impostata manualmente. Se i bordi non coincidono, correggi gli offset.';
    } else {
      var confidence = det.confidence || 0;
      var level = confidence >= 0.98 ? 'alta' : confidence >= 0.9 ? 'media' : 'bassa';
      dot = confidence >= 0.98 ? 'ok' : confidence >= 0.9 ? 'warn' : 'bad';
      summary = 'Griglia ' + det.scale + '× · affidabilità ' + level;
      hint =
        'Ogni pixel logico occupa ' +
        det.scale +
        '×' +
        det.scale +
        ' pixel.';
    }

    var suggestionCount = renderScaleSuggestions(det);
    el.manualScaleRow.hidden = suggestionCount >= 2;
    // Offsets are only useful for a manual scale: hide them when the grid
    // detection or a proposal already found the scale.
    el.offsetRow.hidden =
      det.scale <= 1 || det.rejected || det.auto || det.fromSuggestion;
    if (suggestionCount >= 2 && !det.fromSuggestion) {
      hint += ' Scegli una delle proposte qui sotto.';
    }

    el.confidenceDot.className = 'status-dot' + (dot ? ' ' + dot : '');
    el.detectSummary.textContent = summary;
    el.gridHint.textContent = hint;
    syncDiagnosticsUI();
  }

  // ------------------------------------------------------------------------
  // Colori / pulizia
  // ------------------------------------------------------------------------

  function buildColorPresets(baseCount) {
    el.colorPresets.replaceChildren();
    var base = clamp(Math.round(Number(baseCount) || 0), 0, CONFIG.maxColors);
    if (!base) {
      el.colorPresetsWrap.hidden = true;
      return;
    }

    var counts = [base];
    for (var i = 0; i < CONFIG.palettePresets.length; i++) {
      var count = CONFIG.palettePresets[i];
      if (count < base && counts.indexOf(count) === -1) counts.push(count);
    }
    counts.sort(function (a, b) {
      return b - a;
    });

    var fragment = document.createDocumentFragment();
    for (var j = 0; j < counts.length; j++) {
      var value = counts[j];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-btn';
      button.textContent = String(value);
      button.title = value + (value === 1 ? ' colore' : ' colori');
      button.setAttribute('aria-label', 'Usa ' + value + ' colori');
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('data-colors', String(value));
      fragment.appendChild(button);
    }
    el.colorPresets.appendChild(fragment);
    el.colorPresetsWrap.hidden = false;
    updateColorPresetButtons();
  }

  function updateColorPresetButtons() {
    var buttons = el.colorPresets.children;
    for (var i = 0; i < buttons.length; i++) {
      var button = buttons[i];
      var active = Number(button.getAttribute('data-colors')) === state.colorLimit;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function setColorPresetsDisabled(disabled) {
    var buttons = el.colorPresets.children;
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !!disabled;
  }

  function setColorLimit(count) {
    if (!state.source) return;
    var max = state.colorBaseCount || CONFIG.maxColors;
    var target = clamp(Math.round(count), 1, Math.min(CONFIG.maxColors, max));
    if (target === state.colorLimit) return;
    state.colorLimit = target;
    updateColorPresetButtons();
    scheduleProcess(0);
  }

  function updateHueShiftUI() {
    el.hueShiftInput.value = String(state.hueShift);
    el.hueShiftOut.textContent = state.hueShift + '%';
    el.hslSummary.textContent =
      state.hueShift > 0 ? 'Armonia HSL · ' + state.hueShift + '%' : 'Armonia HSL';
    paintRange(el.hueShiftInput);
  }

  function clonePalette(palette) {
    var out = [];
    for (var i = 0; i < palette.length; i++) {
      out.push({ r: palette[i].r, g: palette[i].g, b: palette[i].b });
    }
    return out;
  }

  function clonePaletteOverrides(overrides) {
    if (!overrides) return null;
    var out = [];
    for (var i = 0; i < overrides.length; i++) {
      if (!overrides[i]) continue;
      out[i] = { r: overrides[i].r, g: overrides[i].g, b: overrides[i].b };
    }
    return out;
  }

  function shiftPaletteHues(palette, amount) {
    var out = clonePalette(palette);
    var strength = clamp(amount, 0, 100) / 100;
    if (!strength) return out;

    for (var i = 0; i < out.length; i++) {
      var color = out[i];
      var hsl = E.rgbToHsl(color.r, color.g, color.b);
      var luma = hsl.l / 100;
      var weight = Math.pow(Math.abs(luma - 0.5) * 2, 0.85) * strength;
      if (weight <= 0) continue;

      // Positive hue shift: shadows toward blue-violet, highlights toward warm yellow.
      var target = luma < 0.5 ? 250 : 45;
      var delta = ((target - hsl.h + 540) % 360) - 180;
      var hue = (hsl.h + delta * weight + 360) % 360;
      var rgb = E.hslToRgb(hue, hsl.s, hsl.l);
      out[i] = { r: rgb.r, g: rgb.g, b: rgb.b };
    }

    return out;
  }

  function formatHslColor(color) {
    var hsl = E.rgbToHsl(color.r, color.g, color.b);
    return (
      'H ' +
      Math.round(hsl.h) +
      '° · S ' +
      Math.round(hsl.s) +
      '% · L ' +
      Math.round(hsl.l) +
      '%'
    );
  }

  function paletteHex(color) {
    return E.rgbToHex(color.r, color.g, color.b);
  }

  function paletteSignature(palette) {
    var parts = [];
    for (var i = 0; i < palette.length; i++) parts.push(paletteHex(palette[i]));
    return parts.join('|');
  }

  // Swatches are shown as a colour ramp (neutrals, then hue) without changing
  // their palette indices, so overrides and pixel mapping stay untouched.
  function paletteDisplayOrder(palette) {
    var entries = [];
    for (var i = 0; i < palette.length; i++) {
      var hsl = E.rgbToHsl(palette[i].r, palette[i].g, palette[i].b);
      entries.push({
        index: i,
        neutral: hsl.s < 10 ? 0 : 1,
        hue: hsl.h,
        light: hsl.l,
        sat: hsl.s,
      });
    }
    entries.sort(function (a, b) {
      if (a.neutral !== b.neutral) return a.neutral - b.neutral;
      if (a.neutral === 0) return a.light - b.light || a.index - b.index;
      if (a.hue !== b.hue) return a.hue - b.hue;
      if (a.light !== b.light) return a.light - b.light;
      if (a.sat !== b.sat) return a.sat - b.sat;
      return a.index - b.index;
    });
    var order = [];
    for (var j = 0; j < entries.length; j++) order.push(entries[j].index);
    return order;
  }

  function refreshPaletteGroups(palette) {
    state.paletteGroups = E.groupSimilarColors(palette, {
      threshold: CONFIG.colorGroupTolerance,
    });
    return state.paletteGroups;
  }

  function paletteGroupIndices(index) {
    var palette = state.result ? state.result.quantized.palette : null;
    if (!palette || index == null || index < 0 || index >= palette.length) return [];
    if (
      !state.paletteGroups ||
      state.paletteGroups.groupOf.length !== palette.length
    ) {
      refreshPaletteGroups(palette);
    }
    var group = state.paletteGroups.groupOf[index];
    if (group == null || group < 0) return [index];
    return state.paletteGroups.groups[group].slice();
  }

  function hexToRgb(hex) {
    var match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!match) return null;
    var value = parseInt(match[1], 16);
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function applyPaletteOverrides(basePalette, overrides) {
    var palette = clonePalette(basePalette);
    if (!overrides) return palette;
    for (var i = 0; i < palette.length && i < overrides.length; i++) {
      if (overrides[i]) palette[i] = { r: overrides[i].r, g: overrides[i].g, b: overrides[i].b };
    }
    return palette;
  }

  function paletteHasEdits() {
    if (!state.result) return false;
    if (state.hueShift > 0) return true;
    var base = state.result.basePalette;
    var overrides = state.paletteOverrides;
    if (!base || !overrides) return false;
    for (var i = 0; i < base.length; i++) {
      var override = overrides[i];
      if (!override) continue;
      if (
        override.r !== base[i].r ||
        override.g !== base[i].g ||
        override.b !== base[i].b
      ) {
        return true;
      }
    }
    return false;
  }

  function ensurePaletteOverrides() {
    if (!state.result) return false;
    if (!state.paletteOverrides) {
      // Sparse overrides: only explicitly edited colors are frozen.
      state.paletteOverrides = [];
    }
    return true;
  }

  function clearPaletteFeedback() {
    if (state.paletteHintTimer) {
      clearTimeout(state.paletteHintTimer);
      state.paletteHintTimer = null;
    }
  }

  function showPaletteFeedback(message) {
    clearPaletteFeedback();
    el.paletteHelp.textContent = message;
    state.paletteHintTimer = setTimeout(function () {
      state.paletteHintTimer = null;
      updatePaletteEditor();
    }, 2200);
  }

  function updatePaletteEditor() {
    var hasResult = !!state.result;
    el.paletteTools.hidden = !hasResult;
    if (!hasResult) {
      state.paletteGroups = null;
      el.paletteCurrent.hidden = true;
      el.paletteCurrentHex.hidden = true;
      el.paletteCurrentHsl.hidden = true;
      el.palettePicker.hidden = true;
      el.palettePicker.title = 'Sostituisci con un colore personalizzato';
      el.paletteResetBtn.hidden = true;
      return;
    }

    var palette = state.result.quantized.palette;
    var index = state.paletteSelected;
    var hasSelection = index != null && index >= 0 && index < palette.length;
    if (!hasSelection) state.paletteSelected = null;

    el.paletteCurrent.hidden = !hasSelection;
    el.paletteCurrentHex.hidden = !hasSelection;
    el.paletteCurrentHsl.hidden = !hasSelection;
    el.palettePicker.hidden = !hasSelection;

    if (hasSelection) {
      var color = palette[index];
      var hex = paletteHex(color);
      var groupSize = paletteGroupIndices(index).length;
      el.paletteCurrent.style.background =
        'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
      el.paletteCurrentHex.textContent = hex;
      el.paletteCurrentHsl.textContent = formatHslColor(color);
      el.paletteColorInput.value = hex;
      el.palettePicker.title =
        groupSize > 1
          ? 'Sostituisci questo colore e i ' + (groupSize - 1) + ' colori simili'
          : 'Sostituisci con un colore personalizzato';
      if (!state.paletteHintTimer) {
        el.paletteHelp.textContent =
          groupSize > 1
            ? groupSize + ' colori simili: Sostituisci li cambia tutti.'
            : 'Colore selezionato. Usa Sostituisci per cambiarlo.';
      }
    } else if (!state.paletteHintTimer) {
      el.paletteHelp.textContent = paletteHasEdits()
        ? state.hueShift > 0
          ? 'Hue shift attivo. Clicca un colore per continuare.'
          : 'Palette modificata. Clicca un colore per continuare.'
        : 'Clicca un colore per selezionarlo. Sostituisci applica il nuovo colore a tutti i colori simili.';
    }

    el.paletteResetBtn.hidden = !paletteHasEdits();
  }

  function applyPaletteEdits() {
    if (!state.result) return;
    clearFixHistory();
    var result = state.result;
    var q = result.quantized;
    q.palette = applyPaletteOverrides(
      shiftPaletteHues(result.basePalette, state.hueShift),
      state.paletteOverrides
    );
    result.composed = E.composeImageData(result.indices, q.palette, q.width, q.height, q.alpha);
    if (result.lint) {
      result.lint.palette = result.lint.skipped
        ? null
        : E.analyzePalette(result.indices, q.width, q.height, q.palette);
    }
    drawResultPreview();
    updatePalette();
    updateResultInfo();
    syncDiagnosticsUI();
    updateStatus();
  }

  function applyTileSize(value) {
    var size = clamp(Math.round(Number(value) || 0), 0, 256);
    if (size === 1) size = 0;
    state.tileSize = size;
    el.tileSizeInput.value = String(size);

    if (state.result && state.result.lint) {
      if (size >= 2 && !state.result.lint.skipped) {
        var q = state.result.quantized;
        state.result.lint.tiles = E.analyzeTiles(
          state.result.indices,
          q.width,
          q.height,
          size
        );
      } else {
        state.result.lint.tiles = null;
      }
      drawResultPreview();
      syncDiagnosticsUI();
    }
  }

  var FIX_LABELS = {
    doubles: 'Doppie',
    jaggies: 'Scalini',
    lines: 'Rotture',
    irregular: 'Irregolari',
    contrast: 'Contrasto',
    islands: 'Isolati',
    tile: 'Tile',
  };

  function clearFixHistory() {
    state.fixHistory = [];
  }

  function rememberFix(label) {
    if (!state.result) return;
    state.fixHistory.push({
      label: label,
      indices: state.result.indices.slice(),
      paletteOverrides: clonePaletteOverrides(state.paletteOverrides),
      autoFixed: !!state.result.autoFixed,
    });
    if (state.fixHistory.length > 16) state.fixHistory.shift();
  }

  function refreshResultAfterFix() {
    if (!state.result) return;
    var result = state.result;
    var q = result.quantized;
    q.palette = applyPaletteOverrides(
      shiftPaletteHues(result.basePalette, state.hueShift),
      state.paletteOverrides
    );
    result.composed = E.composeImageData(
      result.indices,
      q.palette,
      q.width,
      q.height,
      q.alpha
    );
    result.lint = E.lintPixelArt(result.indices, q.width, q.height);
    if (!result.lint.skipped) {
      result.lint.palette = E.analyzePalette(
        result.indices,
        q.width,
        q.height,
        q.palette
      );
      result.lint.islands = E.analyzeIslands(result.indices, q.width, q.height);
      result.lint.tiles =
        state.tileSize >= 2
          ? E.analyzeTiles(result.indices, q.width, q.height, state.tileSize)
          : null;
    }
    drawResultPreview();
    updatePalette();
    updateResultInfo();
    syncDiagnosticsUI();
    updateStatus();
  }

  function fixNoChangeMessage(type, fix) {
    var label = FIX_LABELS[type] || type;
    if (fix && fix.skipped) {
      if (fix.reason === 'grid') {
        return 'Griglia troppo grande per correggere ' + label.toLowerCase() + '.';
      }
      if (fix.reason === 'size') {
        return 'Dimensione tile non valida per la correzione.';
      }
      return 'Correzione non disponibile per ' + label.toLowerCase() + '.';
    }
    return (
      'Nessuna correzione automatica sicura per ' +
      label.toLowerCase() +
      ': il disegno resta invariato.'
    );
  }

  function fixSuccessMessage(type, fix) {
    if (type === 'contrast') {
      return (
        'Contrasto — coppie deboli: ' +
        fix.before.lowPairs +
        ' → ' +
        fix.after.lowPairs +
        '. Palette aggiornata.'
      );
    }
    if (type === 'islands') {
      return (
        'Isolati — gruppi: ' +
        fix.before.hotspots +
        ' → ' +
        fix.after.hotspots +
        '; ' +
        fix.applied +
        ' px sostituiti.'
      );
    }
    if (type === 'tile') {
      return (
        'Tile — bordi sospetti: ' +
        fix.before.flagged +
        ' → ' +
        fix.after.flagged +
        '; ' +
        fix.applied +
        ' px corretti.'
      );
    }
    return (
      (FIX_LABELS[type] || type) +
      ' — difetti: ' +
      fix.before.target +
      ' → ' +
      fix.after.target +
      '; ' +
      fix.applied +
      ' px corretti.'
    );
  }

  async function applyAutoFix(type) {
    if (state.fixing || !state.result || !state.result.lint) return;
    var result = state.result;
    var lint = result.lint;
    if (lint.skipped) {
      toast('Diagnosi non disponibile per questa griglia.', 'error');
      return;
    }

    state.fixing = true;
    syncDiagnosticsUI();
    setBusy(true, 'Correzione automatica…');
    try {
      await nextFrame();
      if (state.result !== result) return;

      var q = result.quantized;
      var fix = null;
      if (type === 'contrast') {
        fix = E.boostPaletteContrast(q.palette, result.indices, q.width, q.height);
      } else if (type === 'islands') {
        fix = E.removeIslands(result.indices, q.width, q.height);
      } else if (type === 'tile') {
        if (state.tileSize < 2) {
          toast('Imposta prima una dimensione Tile maggiore di 1.', 'error');
          return;
        }
        fix = E.fixTileSeams(result.indices, q.width, q.height, state.tileSize);
      } else {
        fix = E.autoFixLines(result.indices, q.width, q.height, type);
      }

      if (!fix || fix.skipped || !fix.changes || !fix.changes.length) {
        toast(fixNoChangeMessage(type, fix), fix && fix.skipped ? 'error' : '');
        return;
      }

      if (type === 'contrast' && !ensurePaletteOverrides()) return;
      rememberFix(FIX_LABELS[type] || type);

      if (type === 'contrast') {
        for (var i = 0; i < fix.changes.length; i++) {
          var change = fix.changes[i];
          state.paletteOverrides[change.index] = {
            r: change.to.r,
            g: change.to.g,
            b: change.to.b,
          };
        }
      } else {
        result.indices = fix.indices;
      }
      result.autoFixed = true;
      refreshResultAfterFix();
      toast(fixSuccessMessage(type, fix), 'success');
    } catch (err) {
      console.error(err);
      toast(
        'Correzione non riuscita: ' + (err && err.message ? err.message : err),
        'error'
      );
    } finally {
      state.fixing = false;
      setBusy(false);
      syncDiagnosticsUI();
    }
  }

  function undoLastFix() {
    if (state.fixing || !state.result || !state.fixHistory.length) return;
    var snapshot = state.fixHistory.pop();
    state.result.indices = snapshot.indices;
    state.paletteOverrides = clonePaletteOverrides(snapshot.paletteOverrides);
    state.result.autoFixed = snapshot.autoFixed;
    state.paletteSelected = null;
    clearPaletteFeedback();
    refreshResultAfterFix();
    toast('Annullata: ' + snapshot.label + '.', 'success');
  }

  function resetPaletteEdits(showMessage) {
    if (!state.result) return;
    state.paletteSelected = null;
    state.paletteOverrides = null;
    state.hueShift = 0;
    updateHueShiftUI();
    clearPaletteFeedback();
    applyPaletteEdits();
    if (showMessage) showPaletteFeedback('Palette originale ripristinata.');
  }

  function resetPaletteState() {
    clearFixHistory();
    clearPaletteFeedback();
    state.paletteSelected = null;
    state.paletteOverrides = null;
    state.paletteBaseSig = '';
    state.hueShift = CONFIG.defaults.hueShift;
    updateHueShiftUI();
    updatePaletteEditor();
  }

  function setSelectedPaletteColor(hex) {
    if (!state.result || state.paletteSelected == null) return;
    var rgb = hexToRgb(hex);
    if (!rgb) return;
    var palette = state.result.quantized.palette;
    var group = paletteGroupIndices(state.paletteSelected);
    if (!group.length) return;

    var unchanged = true;
    for (var g = 0; g < group.length; g++) {
      var entry = palette[group[g]];
      if (!entry || entry.r !== rgb.r || entry.g !== rgb.g || entry.b !== rgb.b) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return;
    if (!ensurePaletteOverrides()) return;

    for (var i = 0; i < group.length; i++) {
      state.paletteOverrides[group[i]] = { r: rgb.r, g: rgb.g, b: rgb.b };
    }
    applyPaletteEdits();
  }

  function handlePaletteClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var swatch = target.closest('.swatch');
    if (!swatch || !el.palette.contains(swatch) || !state.result) return;
    var index = Number(swatch.getAttribute('data-index'));
    if (!isFinite(index) || Math.floor(index) !== index || index < 0) return;

    state.paletteSelected = state.paletteSelected === index ? null : index;
    clearPaletteFeedback();
    syncPaletteSelection();
  }

  function syncPaletteSelection() {
    if (!state.result) return;
    var group =
      state.paletteSelected == null ? [] : paletteGroupIndices(state.paletteSelected);
    var swatches = el.palette.children;
    for (var i = 0; i < swatches.length; i++) {
      var swatch = swatches[i];
      var index = Number(swatch.getAttribute('data-index'));
      var selected = state.paletteSelected === index;
      var similar = !selected && group.indexOf(index) !== -1;
      var hex = swatch.getAttribute('data-hex') || '';
      swatch.classList.toggle('selected', selected);
      swatch.classList.toggle('similar', similar);
      swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
      swatch.title =
        hex +
        ' — ' +
        (selected
          ? 'clicca per deselezionare'
          : similar
            ? 'colore simile: verrà sostituito insieme a quello selezionato'
            : state.paletteSelected == null
              ? 'clicca per selezionare'
              : 'clicca per selezionare questo colore');
    }
    updatePaletteEditor();
  }

  function updatePalette() {
    if (!state.result) {
      el.palette.replaceChildren();
      updatePaletteEditor();
      return;
    }

    var palette = state.result.quantized.palette;
    var groups = refreshPaletteGroups(palette);
    var selectedGroup =
      state.paletteSelected == null ? [] : paletteGroupIndices(state.paletteSelected);
    var fragment = document.createDocumentFragment();
    var order = paletteDisplayOrder(palette);

    for (var k = 0; k < order.length; k++) {
      var i = order[k];
      var color = palette[i];
      var hex = paletteHex(color);
      var selected = state.paletteSelected === i;
      var similar = !selected && selectedGroup.indexOf(i) !== -1;
      var groupSize = groups.groups[groups.groupOf[i]].length;
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className =
        'swatch' + (selected ? ' selected' : '') + (similar ? ' similar' : '');
      swatch.style.background = 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
      swatch.title =
        hex +
        ' — ' +
        (groupSize > 1
          ? groupSize + ' colori simili · '
          : '') +
        (selected
          ? 'clicca per deselezionare'
          : similar
            ? 'colore simile: verrà sostituito insieme a quello selezionato'
            : 'clicca per selezionare');
      swatch.setAttribute('aria-label', 'Colore ' + (k + 1) + ': ' + hex);
      swatch.setAttribute('aria-pressed', selected ? 'true' : 'false');
      swatch.setAttribute('data-index', String(i));
      swatch.setAttribute('data-hex', hex);
      fragment.appendChild(swatch);
    }

    el.palette.replaceChildren(fragment);
    el.colorCountBadge.textContent = palette.length + ' colori';
    updateColorPresetButtons();
    updatePaletteEditor();
  }

  // ------------------------------------------------------------------------
  // Informazioni / esportazione
  // ------------------------------------------------------------------------

  function updateResultInfo() {
    if (!state.result) return;
    var q = state.result.quantized;
    var custom = paletteHasEdits();
    var autoFixed = !!state.result.autoFixed;
    var resized = state.result.resizeInfo;
    el.resultMeta.textContent = q.width + ' × ' + q.height + ' px · ' + q.palette.length + ' colori';
    el.resultMeta.title = resized
      ? 'Ridimensionato da ' +
        resized.sourceWidth +
        '×' +
        resized.sourceHeight +
        ' con ' +
        resizeMethodLabel(resized.method) +
        ' · margine ' +
        resized.margin +
        ' px · soglia alpha ' +
        Math.round(resized.alphaThreshold * 100) +
        '% · griglia ' +
        state.result.cellsScale +
        '×'
      : 'Griglia ' + state.result.cellsScale + '× · ' + q.palette.length + ' colori nella palette';
    el.resultFlag.textContent = custom || autoFixed
      ? 'Modificato'
      : resized
        ? 'Ridimensionato'
        : 'Pulito';
    if (autoFixed && custom) {
      el.resultFlag.title = state.fixHistory.length
        ? 'Correzioni automatiche e palette personalizzata. Puoi annullare l\'ultima correzione dalla Diagnosi.'
        : 'Correzioni automatiche applicate e palette personalizzata.';
    } else if (autoFixed) {
      el.resultFlag.title = state.fixHistory.length
        ? 'Correzioni automatiche applicate. Puoi annullarle dalla Diagnosi.'
        : 'Correzioni automatiche applicate.';
    } else if (custom) {
      el.resultFlag.title =
        'Palette personalizzata: puoi ripristinarla dalla sezione Colori';
    } else if (resized) {
      el.resultFlag.title =
        'Ridotto da ' +
        resized.sourceWidth +
        '×' +
        resized.sourceHeight +
        ' a ' +
        q.width +
        '×' +
        q.height +
        ' con ' +
        resizeMethodLabel(resized.method) +
        '.';
    } else {
      el.resultFlag.title = '';
    }
  }

  function syncDiagnosticsUI() {
    var hasImage = !!state.source;
    var lint = state.result ? state.result.lint : null;
    var dash = '—';
    var paletteTitle =
      'Percentuale di confini tra colori diversi con distanza percettiva OKLab sufficiente. Le coppie sotto 0,06 sono segnalate.';
    var tileTitle =
      'Bordi tra tile con continuità molto inferiore alla media interna. Imposta Tile sopra 0 per analizzare.';
    var badgeTitle =
      'Coppie di colori adiacenti con contrasto insufficiente. La diagnosi delle linee, dei pixel isolati e dei tile resta nel motore ma non è mostrata in questa versione.';
    var fixButtons = {
      doubles: el.fixDoubles,
      jaggies: el.fixJaggies,
      lines: el.fixLines,
      irregular: el.fixIrregular,
      contrast: el.fixContrast,
      islands: el.fixIslands,
      tile: el.fixTile,
    };
    var fixKeys = ['doubles', 'jaggies', 'lines', 'irregular', 'contrast', 'islands', 'tile'];
    var k;
    for (k = 0; k < fixKeys.length; k++) {
      if (fixButtons[fixKeys[k]]) fixButtons[fixKeys[k]].disabled = true;
    }
    el.undoFixBtn.disabled = !state.result || !state.fixHistory.length || state.fixing;
    el.fixHistoryInfo.textContent = state.fixHistory.length
      ? state.fixHistory.length === 1
        ? '1 correzione annullabile.'
        : state.fixHistory.length + ' correzioni annullabili.'
      : 'Nessuna correzione annullabile.';

    function enableFix(key, enabled) {
      if (fixButtons[key]) fixButtons[key].disabled = !enabled || state.fixing;
    }

    function resetPatternQuality() {
      el.lintPerfectRatio.textContent = dash;
      el.lintPerfectBar.style.width = '0%';
      el.lintPatternStats.textContent = 'Perfette — · Intermedie — · Curve — · Irregolari —';
      el.lintIrregular.textContent = dash;
    }

    function resetPaletteQuality() {
      el.lintContrastScore.textContent = dash;
      el.lintContrastBar.style.width = '0%';
      el.lintPaletteStats.textContent = 'Colori — · Tinte — · Toni — · L —';
      el.lintContrast.textContent = dash;
      el.paletteQuality.title = paletteTitle;
    }

    function resetIslands() {
      el.lintIslands.textContent = dash;
      el.lintIslandItem.classList.add('inactive');
      el.lintIslandItem.title =
        'Pixel singoli o gruppi fino a 4 px circondati da un altro colore. Possono essere dettagli voluti.';
    }

    function resetTiles() {
      el.lintTileSeams.textContent = dash;
      el.lintTileItem.classList.add('inactive');
      el.lintTileItem.title = tileTitle;
      el.tileQuality.classList.add('inactive');
      el.tileQuality.title = tileTitle;
      el.lintTileStats.textContent =
        state.tileSize >= 2
          ? 'Tile ' + state.tileSize + ' px · in attesa di un\'immagine.'
          : 'Tile disattivati · 0 = off';
    }

    function plural(count, one, many) {
      return count + ' ' + (count === 1 ? one : many);
    }

    function pairLabel(pair, palette) {
      if (!palette) return '';
      var a = palette[pair.a];
      var b = palette[pair.b];
      if (!a || !b) return '';
      return (
        paletteHex(a) +
        '/' +
        paletteHex(b) +
        ' (ΔE ' +
        pair.distance.toFixed(3) +
        ')'
      );
    }

    el.diagnosticsToggle.disabled = !hasImage;
    el.diagnosticsBadge.title = badgeTitle;
    el.tileSizeInput.disabled = !hasImage;
    el.tileMinus.disabled = !hasImage;
    el.tilePlus.disabled = !hasImage;

    el.lintLegend.classList.toggle('inactive', !lint || lint.skipped);
    el.lineQuality.classList.toggle('inactive', !lint || lint.skipped);
    el.paletteQuality.classList.toggle(
      'inactive',
      !lint || lint.skipped || !lint.palette
    );

    if (!hasImage) {
      el.diagnosticsBadge.textContent = dash;
      el.diagnosticsBadge.className = 'pill';
      el.lintDoubles.textContent = dash;
      el.lintJaggies.textContent = dash;
      el.lintLines.textContent = dash;
      resetPatternQuality();
      resetPaletteQuality();
      resetIslands();
      resetTiles();
      el.lintHint.textContent =
        'Carica un\'immagine per analizzare il contrasto tra colori adiacenti.';
      return;
    }

    if (!lint) {
      el.diagnosticsBadge.textContent = dash;
      el.diagnosticsBadge.className = 'pill';
      el.lintDoubles.textContent = dash;
      el.lintJaggies.textContent = dash;
      el.lintLines.textContent = dash;
      resetPatternQuality();
      resetPaletteQuality();
      resetIslands();
      resetTiles();
      el.lintHint.textContent = 'Analisi dei pixel logici in corso…';
      return;
    }

    if (lint.skipped) {
      el.diagnosticsBadge.textContent = dash;
      el.diagnosticsBadge.className = 'pill';
      el.lintDoubles.textContent = dash;
      el.lintJaggies.textContent = dash;
      el.lintLines.textContent = dash;
      resetPatternQuality();
      resetPaletteQuality();
      resetIslands();
      resetTiles();
      el.lintHint.textContent =
        'Griglia troppo grande per la diagnosi (oltre ' +
        E.LINT_MAX_PIXELS.toLocaleString('it-IT') +
        ' pixel logici).';
      return;
    }

    var counts = lint.counts;
    var patterns = lint.patterns || {
      perfect: 0,
      intermediate: 0,
      curves: 0,
      irregular: 0,
      total: 0,
      perfectRatio: null,
    };
    var paletteInfo = lint.palette || null;
    var contrast = paletteInfo && paletteInfo.contrast ? paletteInfo.contrast : null;
    var lowPairs = contrast ? contrast.lowPairs : 0;
    var nearCount = paletteInfo ? paletteInfo.nearDuplicateCount : 0;
    var islands = lint.islands || null;
    var tiles = lint.tiles || null;
    var tileActive = state.tileSize >= 2;
    // Only adjacent contrast is surfaced in the UI for now. The line, island
    // and tile diagnostics above keep running so they can be re-enabled later.
    var total = lowPairs;

    enableFix('doubles', counts.doubles > 0);
    enableFix('jaggies', counts.jaggies > 0);
    enableFix('lines', counts.lines > 0);
    enableFix('irregular', patterns.irregular > 0);
    enableFix('contrast', !!(contrast && contrast.lowPairs > 0));
    enableFix('islands', !!(islands && islands.hotspots > 0));
    if (tileActive && tiles && !tiles.skipped) {
      enableFix('tile', tiles.seams.flagged > 0);
    }

    el.diagnosticsBadge.textContent = total === 0 ? 'OK' : String(total);
    el.diagnosticsBadge.className = 'pill' + (total > 0 ? ' warn' : '');
    el.lintDoubles.textContent = String(counts.doubles);
    el.lintJaggies.textContent = String(counts.jaggies);
    el.lintLines.textContent = String(counts.lines);
    el.lintIrregular.textContent = String(patterns.irregular);
    el.lintContrast.textContent = contrast ? String(lowPairs) : dash;

    if (patterns.perfectRatio == null) {
      el.lintPerfectRatio.textContent = dash;
      el.lintPerfectBar.style.width = '0%';
    } else {
      var percent = Math.round(patterns.perfectRatio * 100);
      el.lintPerfectRatio.textContent = percent + '%';
      el.lintPerfectBar.style.width = percent + '%';
    }
    el.lintPatternStats.textContent =
      patterns.total === 0
        ? 'Nessun tratto sottile analizzato.'
        : 'Perfette ' +
          patterns.perfect +
          ' · Intermedie ' +
          patterns.intermediate +
          ' · Curve ' +
          patterns.curves +
          ' · Irregolari ' +
          patterns.irregular;

    if (!contrast || contrast.score == null) {
      el.lintContrastScore.textContent = dash;
      el.lintContrastBar.style.width = '0%';
    } else {
      var contrastPercent = Math.round(contrast.score * 100);
      el.lintContrastScore.textContent = contrastPercent + '%';
      el.lintContrastBar.style.width = contrastPercent + '%';
    }

    if (!paletteInfo || !paletteInfo.colors) {
      el.lintPaletteStats.textContent = 'Nessun colore usato nella palette.';
      el.paletteQuality.title = paletteTitle;
    } else {
      var minL = Math.round(paletteInfo.lightness.min);
      var maxL = Math.round(paletteInfo.lightness.max);
      var stats =
        plural(paletteInfo.colors, 'colore', 'colori') +
        ' · ' +
        plural(paletteInfo.hues, 'tinta', 'tinte') +
        ' · ' +
        plural(paletteInfo.valueBins, 'tono', 'toni') +
        ' · L ' +
        (minL === maxL ? minL + '%' : minL + '–' + maxL + '%');
      if (nearCount) {
        stats +=
          ' · ' +
          (nearCount === 1 ? '1 coppia simile' : nearCount + ' coppie simili');
      }
      el.lintPaletteStats.textContent = stats;

      var paletteColors = state.result ? state.result.quantized.palette : null;
      var title = paletteTitle;
      if (paletteInfo.nearDuplicates && paletteInfo.nearDuplicates.length) {
        var nearLabels = [];
        for (var n = 0; n < paletteInfo.nearDuplicates.length && n < 3; n++) {
          var nearLabel = pairLabel(paletteInfo.nearDuplicates[n], paletteColors);
          if (nearLabel) nearLabels.push(nearLabel);
        }
        if (nearLabels.length) {
          title += ' Colori quasi identici: ' + nearLabels.join(', ') + '.';
        }
      }
      if (paletteInfo.contrast && paletteInfo.contrast.worst.length) {
        var weakLabels = [];
        for (var c = 0; c < paletteInfo.contrast.worst.length && c < 3; c++) {
          var weakLabel = pairLabel(paletteInfo.contrast.worst[c], paletteColors);
          if (weakLabel) weakLabels.push(weakLabel);
        }
        if (weakLabels.length) {
          title += ' Bordi più deboli: ' + weakLabels.join(', ') + '.';
        }
      }
      if (paletteInfo.flat) {
        title += ' Escursione di luminosità ridotta.';
      }
      el.paletteQuality.title = title;
    }

    if (islands) {
      el.lintIslands.textContent = String(islands.hotspots);
      el.lintIslandItem.classList.remove('inactive');
      el.lintIslandItem.title =
        plural(islands.singles, 'pixel singolo', 'pixel singoli') +
        ' e ' +
        plural(islands.clusters, 'gruppo', 'gruppi') +
        ' fino a ' +
        islands.maxSize +
        ' px circondati da un altro colore. Possono essere dettagli voluti.';
    } else {
      resetIslands();
    }

    if (!tileActive) {
      resetTiles();
    } else if (!tiles) {
      el.lintTileSeams.textContent = dash;
      el.lintTileItem.classList.add('inactive');
      el.lintTileItem.title = tileTitle;
      el.tileQuality.classList.add('inactive');
      el.lintTileStats.textContent = 'Analisi tile in corso…';
    } else if (tiles.skipped) {
      el.lintTileSeams.textContent = dash;
      el.lintTileItem.classList.add('inactive');
      el.tileQuality.classList.add('inactive');
      var tileSkip =
        tiles.reason === 'grid'
          ? 'Griglia troppo grande per l\'analisi tile.'
          : 'Tile più grande della griglia o dimensione non valida.';
      el.lintTileStats.textContent = tileSkip;
      el.lintTileItem.title = tileSkip;
      el.tileQuality.title = tileSkip;
    } else {
      el.lintTileItem.classList.remove('inactive');
      el.tileQuality.classList.remove('inactive');
      el.lintTileSeams.textContent = String(tiles.seams.flagged);
      var tileBits = [
        tiles.cols + '×' + tiles.rows + ' tile',
        plural(tiles.uniqueTiles, 'unico', 'unici'),
      ];
      if (tiles.duplicateTiles) {
        tileBits.push(plural(tiles.duplicateTiles, 'duplicato', 'duplicati'));
      }
      if (tiles.emptyTiles) {
        tileBits.push(plural(tiles.emptyTiles, 'vuoto', 'vuoti'));
      }
      if (tiles.seams.total) {
        tileBits.push(
          'bordi ' + tiles.seams.flagged + '/' + tiles.seams.total + ' sospetti'
        );
      } else {
        tileBits.push('nessun bordo interno');
      }
      if (!tiles.exact) tileBits.push('avanzo ignorato');
      el.lintTileStats.textContent = tileBits.join(' · ');
      el.lintTileItem.title =
        tileTitle +
        (tiles.seams.score == null
          ? ''
          : ' Continuità attuale: ' + Math.round(tiles.seams.score * 100) + '%.');
      el.tileQuality.title = el.lintTileItem.title;
    }

    var contrastNote = lowPairs
      ? ' ' +
        (lowPairs === 1
          ? '1 coppia di colori adiacenti ha poco contrasto.'
          : lowPairs + ' coppie di colori adiacenti hanno poco contrasto.')
      : '';

    if (total === 0) {
      el.lintHint.textContent =
        'Contrasto adiacente OK. L\'overlay resta solo nell\'anteprima e non viene mai esportato.';
    } else {
      el.lintHint.textContent =
        'Diagnosi indicativa: usa Risolvi per separare i colori adiacenti troppo simili. L\'overlay non viene mai esportato nel PNG.' +
        contrastNote;
    }
  }

  function updateStatus() {
    if (!state.source) {
      el.statusInfo.textContent = 'Nessuna immagine caricata';
      return;
    }
    if (!state.result) {
      el.statusInfo.textContent =
        state.source.width + '×' + state.source.height + ' · analisi in corso…';
      return;
    }
    var q = state.result.quantized;
    var det = state.detection;
    var resize = state.result.resizeInfo;
    var grid =
      det && det.auto && det.rejected
        ? 'griglia non rilevata'
        : 'griglia ' +
          (det ? det.scale : 1) +
          '×' +
          (det && !det.auto ? (det.fromSuggestion ? ' proposta' : ' manuale') : '');
    el.statusInfo.textContent =
      state.source.width +
      '×' +
      state.source.height +
      ' → ' +
      q.width +
      '×' +
      q.height +
      ' · ' +
      grid +
      (resize
        ? ' · ' +
          resizeMethodLabel(resize.method) +
          ' da ' +
          resize.sourceWidth +
          '×' +
          resize.sourceHeight
        : '') +
      ' · ' +
      q.palette.length +
      ' colori · ' +
      Math.round(state.result.elapsed) +
      ' ms';
  }

  function exportChoices(maxSide) {
    var factors = [1, 2, 4, 8, 16, 32];
    var choices = [];
    for (var i = 0; i < factors.length; i++) {
      var f = factors[i];
      if (f === 1 || maxSide * f <= 8192) choices.push(f);
    }
    return choices;
  }

  function outputPercent() {
    var percent = Math.round(Number(state.outputPercent) || 100);
    return percent === 75 || percent === 50 || percent === 25 ? percent : 100;
  }

  function outputTargetSize() {
    var q = state.result.quantized;
    var percent = outputPercent();
    return {
      width: Math.max(1, Math.round((q.width * state.exportFactor * percent) / 100)),
      height: Math.max(1, Math.round((q.height * state.exportFactor * percent) / 100)),
      percent: percent,
    };
  }

  function syncExportOptions() {
    if (!state.result) {
      el.exportScaleSelect.disabled = true;
      el.outputSizeSelect.value = '100';
      el.outputSizeSelect.disabled = true;
      el.exportBtn.disabled = true;
      el.copyImageBtn.disabled = true;
      return;
    }

    var q = state.result.quantized;
    var maxSide = Math.max(q.width, q.height);
    var choices = exportChoices(maxSide);
    var reset = state.pendingExportReset;

    if (reset || choices.indexOf(state.exportFactor) === -1) {
      var wanted = state.result.resizeInfo
        ? 1
        : Math.max(1, Math.round(state.result.cellsScale));
      var chosen = choices[0];
      for (var i = 0; i < choices.length; i++) {
        if (choices[i] <= wanted) chosen = choices[i];
      }
      state.exportFactor = chosen;
    }
    state.pendingExportReset = false;

    var options = choices.map(function (f) {
      return (
        '<option value="' +
        f +
        '">' +
        f +
        '× · ' +
        q.width * f +
        '×' +
        q.height * f +
        '</option>'
      );
    });
    el.exportScaleSelect.innerHTML = options.join('');
    el.exportScaleSelect.value = String(state.exportFactor);
    el.exportScaleSelect.disabled = false;
    state.outputPercent = outputPercent();
    el.outputSizeSelect.value = String(state.outputPercent);
    el.outputSizeSelect.disabled = false;
    el.exportBtn.disabled = false;
    el.copyImageBtn.disabled = false;
    updateExportDims();
  }

  function updateExportDims() {
    if (!state.result) return;
    var target = outputTargetSize();
    var label = target.width + ' × ' + target.height + ' px';
    el.exportScaleSelect.title =
      target.percent === 100
        ? 'Scala di esportazione — file ' + label
        : 'Scala base di esportazione — file ' + label + ' al ' + target.percent + '%';
    el.outputSizeSelect.title =
      'Riduzione proporzionale dell\'uscita — ' + target.percent + '%, ' + label;
    el.outputSizeSelect.setAttribute(
      'aria-label',
      'Riduci l\'uscita: ' + target.percent + '%, ' + label
    );
    el.exportBtn.title = 'Esporta PNG a ' + label;
  }

  function buildExportCanvas() {
    var r = state.result;
    var target = outputTargetSize();
    var out = E.resizeImageDataNearest(r.composed, target.width, target.height);
    var canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    var ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
    return canvas;
  }

  function exportFileName() {
    var base = (state.sourceName || 'pixel-art').replace(/\.[^.]+$/, '');
    if (state.result && state.result.resizeInfo) {
      var target = outputTargetSize();
      return base + '-' + target.width + 'x' + target.height + '-pulita.png';
    }
    return base + '-pulita.png';
  }

  async function exportPng() {
    if (!state.result) return;
    try {
      var canvas = buildExportCanvas();
      var blob = await canvasToBlob(canvas);
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = exportFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 5000);
      toast('PNG esportato: ' + canvas.width + ' × ' + canvas.height + ' px.', 'success');
    } catch (err) {
      console.error(err);
      toast('Esportazione non riuscita: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  async function copyImage() {
    if (!state.result) return;
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      toast('Copia non supportata in questo browser. Usa Esporta PNG.', 'error');
      return;
    }
    try {
      var blob = await canvasToBlob(buildExportCanvas());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Immagine copiata negli appunti.', 'success');
    } catch (err) {
      console.error(err);
      toast('Copia non consentita dal browser. Usa Esporta PNG.', 'error');
    }
  }

  // ------------------------------------------------------------------------
  // Demo, drag & drop, appunti
  // ------------------------------------------------------------------------

  async function loadDemo() {
    try {
      if (!window.PIXEL_CLEANER_DEMO) throw new Error('Immagine demo non disponibile.');
      var response = await fetch(window.PIXEL_CLEANER_DEMO);
      if (!response.ok) throw new Error('Impossibile caricare la demo.');
      var blob = await response.blob();
      await openImage(blob, window.PIXEL_CLEANER_DEMO_NAME || 'demo-ai.png');
    } catch (err) {
      console.error(err);
      toast('Demo non disponibile: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  function openFilePicker() {
    el.fileInput.click();
  }

  async function pasteFromClipboard() {
    if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
      toast('Usa Ctrl+V per incollare un\'immagine dagli appunti.', 'error');
      return;
    }
    try {
      var items = await navigator.clipboard.read();
      for (var i = 0; i < items.length; i++) {
        var types = items[i].types || [];
        for (var j = 0; j < types.length; j++) {
          if (types[j].indexOf('image/') === 0) {
            var blob = await items[i].getType(types[j]);
            var ext = types[j].split('/')[1].split('+')[0].replace('jpeg', 'jpg');
            await openImage(blob, 'appunti.' + ext);
            return;
          }
        }
      }
      toast('Nessuna immagine negli appunti.', 'error');
    } catch (err) {
      console.error(err);
      toast('Accesso agli appunti non consentito. Usa Ctrl+V.', 'error');
    }
  }

  var dragDepth = 0;

  function isFileDrag(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) {
      if (types[i] === 'Files') return true;
    }
    return false;
  }

  function resetDrag() {
    dragDepth = 0;
    el.dropOverlay.hidden = true;
  }

  // ------------------------------------------------------------------------
  // Eventi
  // ------------------------------------------------------------------------

  function bindEvents() {
    el.openBtn.addEventListener('click', openFilePicker);
    el.openBtn2.addEventListener('click', openFilePicker);
    el.demoBtn.addEventListener('click', loadDemo);
    el.pasteBtn.addEventListener('click', pasteFromClipboard);

    el.fileInput.addEventListener('change', function () {
      var file = el.fileInput.files && el.fileInput.files[0];
      if (file) openImage(file);
      el.fileInput.value = '';
    });

    el.showGridToggle.addEventListener('change', function () {
      state.showGrid = el.showGridToggle.checked;
      renderSourcePreview();
    });

    el.diagnosticsToggle.addEventListener('change', function () {
      state.showDiagnostics = el.diagnosticsToggle.checked;
      drawResultPreview();
    });

    el.lintLegend.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var button = target.closest('.lint-fix');
      if (!button || !el.lintLegend.contains(button) || button.disabled) return;
      applyAutoFix(button.getAttribute('data-fix'));
    });
    el.undoFixBtn.addEventListener('click', undoLastFix);

    el.tileSizeInput.addEventListener('change', function () {
      applyTileSize(el.tileSizeInput.value);
    });
    el.tileSizeInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyTileSize(el.tileSizeInput.value);
        el.tileSizeInput.blur();
      }
    });
    el.tileMinus.addEventListener('click', function () {
      applyTileSize(state.tileSize - 8);
    });
    el.tilePlus.addEventListener('click', function () {
      applyTileSize(state.tileSize + 8);
    });

    el.scaleInput.addEventListener('change', function () {
      applyScale(el.scaleInput.value);
    });
    el.scaleInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyScale(el.scaleInput.value);
        el.scaleInput.blur();
      }
    });
    el.scaleMinus.addEventListener('click', function () {
      applyScale((Number(el.scaleInput.value) || 1) - 1);
    });
    el.scalePlus.addEventListener('click', function () {
      applyScale((Number(el.scaleInput.value) || 1) + 1);
    });
    el.scaleSuggestionList.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var button = target.closest('.scale-chip');
      if (!button || !el.scaleSuggestionList.contains(button)) return;
      applyScale(button.getAttribute('data-scale'));
    });
    el.autoDetectBtn.addEventListener('click', autoDetect);

    el.offsetXInput.addEventListener('change', updateOffset);
    el.offsetYInput.addEventListener('change', updateOffset);
    el.offsetXInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') updateOffset();
    });
    el.offsetYInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') updateOffset();
    });

    el.colorPresets.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      var button = target.closest('.preset-btn');
      if (!button || !el.colorPresets.contains(button)) return;
      setColorLimit(Number(button.getAttribute('data-colors')));
    });

    el.hueShiftInput.addEventListener('input', function () {
      state.hueShift = Number(el.hueShiftInput.value);
      updateHueShiftUI();
      applyPaletteEdits();
    });
    el.hueShiftInput.addEventListener('change', function () {
      if (state.hueShift > 0) {
        showPaletteFeedback('Hue shift ' + state.hueShift + '% applicato.');
      }
    });

    el.palette.addEventListener('click', handlePaletteClick);
    el.paletteColorInput.addEventListener('input', function () {
      setSelectedPaletteColor(el.paletteColorInput.value);
    });
    el.paletteColorInput.addEventListener('change', function () {
      if (state.paletteSelected != null) {
        showPaletteFeedback('Colori simili aggiornati.');
      }
    });
    el.paletteResetBtn.addEventListener('click', function () {
      resetPaletteEdits(true);
    });

    el.despeckleSelect.addEventListener('change', function () {
      state.despeckleStrength = Number(el.despeckleSelect.value);
      scheduleProcess(0);
    });

    el.binaryAlphaInput.addEventListener('change', function () {
      state.binaryAlpha = el.binaryAlphaInput.checked;
      scheduleProcess(0);
    });

    el.marginInput.addEventListener('input', function () {
      state.marginRatio = Number(el.marginInput.value) / 100;
      el.marginOut.textContent = el.marginInput.value + '%';
      paintRange(el.marginInput);
      scheduleProcess(60);
    });

    el.exportScaleSelect.addEventListener('change', function () {
      state.exportFactor = Number(el.exportScaleSelect.value) || 1;
      updateExportDims();
    });

    el.resizeApplyBtn.addEventListener('click', applyResize);
    el.resizeResetBtn.addEventListener('click', resetResize);
    el.resizeAlphaInput.addEventListener('input', function () {
      state.resizeAlpha =
        clamp(Math.round(Number(el.resizeAlphaInput.value) || 0), 5, 95) / 100;
      el.resizeAlphaOut.textContent = el.resizeAlphaInput.value + '%';
      paintRange(el.resizeAlphaInput);
    });
    [el.resizeWidthInput, el.resizeHeightInput, el.resizeMarginInput].forEach(
      function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            applyResize();
            input.blur();
          }
        });
      }
    );

    el.outputSizeSelect.addEventListener('change', function () {
      state.outputPercent = Number(el.outputSizeSelect.value) || 100;
      state.outputPercent = outputPercent();
      el.outputSizeSelect.value = String(state.outputPercent);
      applyResultPreviewScale();
      updateTileGrid();
      updateExportDims();
    });

    el.exportBtn.addEventListener('click', exportPng);
    el.copyImageBtn.addEventListener('click', copyImage);

    document.addEventListener('paste', function (event) {
      var data = event.clipboardData;
      if (!data) return;
      var file = null;
      var items = data.items || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
          file = items[i].getAsFile();
          if (file) break;
        }
      }
      if (!file && data.files && data.files.length) {
        for (var j = 0; j < data.files.length; j++) {
          if (data.files[j].type.indexOf('image/') === 0) {
            file = data.files[j];
            break;
          }
        }
      }
      if (file) {
        event.preventDefault();
        openImage(file, file.name || 'appunti.png');
      }
    });

    window.addEventListener('dragenter', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth++;
      el.dropOverlay.hidden = false;
    });
    window.addEventListener('dragover', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (event) {
      if (!isFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) el.dropOverlay.hidden = true;
    });
    window.addEventListener('drop', function (event) {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      resetDrag();
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) openImage(file);
    });
    window.addEventListener('blur', resetDrag);
    window.addEventListener('resize', updateTileGrid);

    document.addEventListener('keydown', function (event) {
      var modKey = event.ctrlKey || event.metaKey;
      if (modKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openFilePicker();
      } else if (modKey && event.key.toLowerCase() === 's' && state.result) {
        event.preventDefault();
        exportPng();
      } else if (event.key === 'Escape') {
        if (!el.dropOverlay.hidden) {
          resetDrag();
        } else if (state.paletteSelected != null) {
          state.paletteSelected = null;
          clearPaletteFeedback();
          syncPaletteSelection();
        }
      }
    });
  }

  // ------------------------------------------------------------------------
  // Avvio
  // ------------------------------------------------------------------------

  function applyConfigDefaults() {
    var defaults = CONFIG.defaults;
    var tileSize = defaults.tileSize >= 2 ? defaults.tileSize : 0;

    el.tileSizeInput.value = String(tileSize);
    el.despeckleSelect.value = String(defaults.despeckle);
    el.binaryAlphaInput.checked = defaults.binaryAlpha;
    el.marginInput.value = String(defaults.margin);
    el.hueShiftInput.value = String(defaults.hueShift);
    el.showGridToggle.checked = defaults.showGrid;
    el.diagnosticsToggle.checked = defaults.showDiagnostics;
    el.resizeWidthInput.value = String(defaults.resizeWidth);
    el.resizeHeightInput.value = String(defaults.resizeHeight);
    el.resizeMethodSelect.value = defaults.resizeMethod;
    el.resizeMarginInput.value = String(defaults.resizeMargin);
    el.resizeAlphaInput.value = String(defaults.resizeAlpha);
    el.resizeAlphaOut.textContent = defaults.resizeAlpha + '%';

    state.despeckleStrength = defaults.despeckle;
    state.binaryAlpha = defaults.binaryAlpha;
    state.marginRatio = defaults.margin / 100;
    state.hueShift = defaults.hueShift;
    state.showGrid = defaults.showGrid;
    state.showDiagnostics = defaults.showDiagnostics;
    state.tileSize = tileSize;
    state.resizeWidth = defaults.resizeWidth;
    state.resizeHeight = defaults.resizeHeight;
    state.resizeMethod = defaults.resizeMethod;
    state.resizeMargin = defaults.resizeMargin;
    state.resizeAlpha = defaults.resizeAlpha / 100;

    updateHueShiftUI();
    el.marginOut.textContent = defaults.margin + '%';

    [el.marginInput, el.hueShiftInput, el.resizeAlphaInput].forEach(paintRange);
  }

  function init() {
    buildColorPresets(0);
    applyConfigDefaults();
    bindEvents();
    syncDetectionUI();
    syncResizeUI();

    if (new URLSearchParams(location.search).get('demo') === '1') {
      setTimeout(loadDemo, 30);
    }
  }

  init();
})();
