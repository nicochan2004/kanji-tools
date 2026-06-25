(() => {
  const MAX_WORK_DIM = 2000;
  const FILL_ITERATIONS = 60;
  const MIN_CROP_FRAC = 0.08;
  const COLOR_DEDUPE_DIST = 24;
  const UNDO_LIMIT = 8;

  const screens = {
    load: document.getElementById("screenLoad"),
    crop: document.getElementById("screenCrop"),
    erase: document.getElementById("screenErase"),
    print: document.getElementById("screenPrint"),
  };

  const fileInput = document.getElementById("fileInput");

  const cropCanvas = document.getElementById("cropCanvas");
  const cropStage = document.getElementById("cropStage");
  const cropDim = document.getElementById("cropDim");
  const cropBox = document.getElementById("cropBox");
  const rotateLeftBtn = document.getElementById("rotateLeftBtn");
  const rotateRightBtn = document.getElementById("rotateRightBtn");
  const rotateSlider = document.getElementById("rotateSlider");
  const rotateValueLabel = document.getElementById("rotateValueLabel");
  const cropBackBtn = document.getElementById("cropBackBtn");
  const cropNextBtn = document.getElementById("cropNextBtn");

  const eraseCanvas = document.getElementById("eraseCanvas");
  const eraseStage = document.getElementById("eraseStage");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const pickGuide = document.getElementById("pickGuide");
  const eraseBtn = document.getElementById("eraseBtn");
  const eraseHint = document.getElementById("eraseHint");
  const toleranceSlider = document.getElementById("toleranceSlider");
  const colorChips = document.getElementById("colorChips");
  const brushModeBtn = document.getElementById("brushModeBtn");
  const brushSizeSlider = document.getElementById("brushSizeSlider");
  const undoBtn = document.getElementById("undoBtn");
  const resetEraseBtn = document.getElementById("resetEraseBtn");
  const eraseBackBtn = document.getElementById("eraseBackBtn");
  const toPrintBtn = document.getElementById("toPrintBtn");

  const printImage = document.getElementById("printImage");
  const printBtn = document.getElementById("printBtn");
  const saveImageBtn = document.getElementById("saveImageBtn");
  const restartBtn = document.getElementById("restartBtn");

  let sourceImage = null;
  let baseRotation = 0; // 0/90/180/270 (度)
  let fineRotation = 0; // -15〜15 (度)
  let cropFrac = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };

  let originalImageData = null; // トリミング直後の状態（リセット用）
  let currentImageData = null; // 現在の編集状態
  let inkColors = []; // [r,g,b] の配列
  let tolerance = 30;
  let brushMode = false;
  let brushSize = 20;
  let awaitingPick = false;
  let undoStack = [];

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // ---------- ① 写真選択 ----------

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      baseRotation = 0;
      fineRotation = 0;
      rotateSlider.value = 0;
      rotateValueLabel.textContent = "0°";
      cropFrac = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
      URL.revokeObjectURL(url);
      showScreen("crop");
      renderCropStage();
      renderCropBox();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      alert("画像を読み込めませんでした。別の写真をお試しください。");
    };
    img.src = url;
    fileInput.value = "";
  });

  // ---------- ② かたむき補正・トリミング ----------

  function currentRotation() {
    return baseRotation + fineRotation;
  }

  function renderCropStage() {
    if (!sourceImage) return;
    const rad = (currentRotation() * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const iw = sourceImage.naturalWidth;
    const ih = sourceImage.naturalHeight;
    const outW = Math.round(iw * cos + ih * sin);
    const outH = Math.round(iw * sin + ih * cos);
    cropCanvas.width = outW;
    cropCanvas.height = outH;
    const ctx = cropCanvas.getContext("2d");
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.drawImage(sourceImage, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function renderCropBox() {
    const { left, top, right, bottom } = cropFrac;
    cropBox.style.left = `${left * 100}%`;
    cropBox.style.top = `${top * 100}%`;
    cropBox.style.width = `${(right - left) * 100}%`;
    cropBox.style.height = `${(bottom - top) * 100}%`;
    cropDim.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${left * 100}% ${top * 100}%, ${right * 100}% ${top * 100}%, ${right * 100}% ${bottom * 100}%, ${left * 100}% ${bottom * 100}%, ${left * 100}% ${top * 100}%)`;
  }

  function resetCropFrac() {
    cropFrac = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
    renderCropBox();
  }

  rotateLeftBtn.addEventListener("click", () => {
    baseRotation = (baseRotation - 90 + 360) % 360;
    renderCropStage();
    resetCropFrac();
  });
  rotateRightBtn.addEventListener("click", () => {
    baseRotation = (baseRotation + 90) % 360;
    renderCropStage();
    resetCropFrac();
  });
  rotateSlider.addEventListener("input", () => {
    fineRotation = parseFloat(rotateSlider.value);
    rotateValueLabel.textContent = `${fineRotation}°`;
    renderCropStage();
    resetCropFrac();
  });

  cropBackBtn.addEventListener("click", () => {
    showScreen("load");
  });

  // ドラッグ操作（四すみ＝リサイズ、本体＝移動）
  (() => {
    let dragState = null;

    function onPointerMove(e) {
      if (!dragState) return;
      const dx = (e.clientX - dragState.startX) / dragState.stageW;
      const dy = (e.clientY - dragState.startY) / dragState.stageH;
      const s = dragState.startRect;

      if (dragState.mode === "move") {
        const w = s.right - s.left;
        const h = s.bottom - s.top;
        let left = clamp(s.left + dx, 0, 1 - w);
        let top = clamp(s.top + dy, 0, 1 - h);
        cropFrac = { left, top, right: left + w, bottom: top + h };
      } else {
        const r = { ...s };
        const handle = dragState.handle;
        if (handle.includes("l")) r.left = clamp(s.left + dx, 0, s.right - MIN_CROP_FRAC);
        if (handle.includes("r")) r.right = clamp(s.right + dx, s.left + MIN_CROP_FRAC, 1);
        if (handle.includes("t")) r.top = clamp(s.top + dy, 0, s.bottom - MIN_CROP_FRAC);
        if (handle.includes("b")) r.bottom = clamp(s.bottom + dy, s.top + MIN_CROP_FRAC, 1);
        cropFrac = r;
      }
      renderCropBox();
    }

    function onPointerUp() {
      dragState = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    }

    function startDrag(e, mode, handle) {
      e.preventDefault();
      e.stopPropagation();
      const stageRect = cropStage.getBoundingClientRect();
      dragState = {
        mode,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...cropFrac },
        stageW: stageRect.width,
        stageH: stageRect.height,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }

    cropBox.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("crop-handle")) return;
      startDrag(e, "move", null);
    });
    cropBox.querySelectorAll(".crop-handle").forEach((handleEl) => {
      handleEl.addEventListener("pointerdown", (e) => {
        startDrag(e, "resize", handleEl.dataset.handle);
      });
    });
  })();

  cropNextBtn.addEventListener("click", () => {
    const w = cropCanvas.width;
    const h = cropCanvas.height;
    const sx = Math.round(cropFrac.left * w);
    const sy = Math.round(cropFrac.top * h);
    const sw = Math.round((cropFrac.right - cropFrac.left) * w);
    const sh = Math.round((cropFrac.bottom - cropFrac.top) * h);
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    eraseCanvas.width = outW;
    eraseCanvas.height = outH;
    const ectx = eraseCanvas.getContext("2d");
    ectx.drawImage(cropCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

    originalImageData = ectx.getImageData(0, 0, outW, outH);
    currentImageData = new ImageData(new Uint8ClampedArray(originalImageData.data), outW, outH);
    inkColors = [];
    undoStack = [];
    awaitingPick = false;
    pickGuide.hidden = true;
    eraseHint.textContent = "ボタンを押して、消したい書き込みの色を1か所タップしてください。";
    renderColorChips();
    updateUndoButton();

    showScreen("erase");
    drawCurrentToCanvas();
  });

  // ---------- ③ 書き込み消去 ----------

  function drawCurrentToCanvas() {
    const ctx = eraseCanvas.getContext("2d");
    ctx.putImageData(currentImageData, 0, 0);
  }

  function renderColorChips() {
    colorChips.innerHTML = "";
    inkColors.forEach((c, i) => {
      const chip = document.createElement("div");
      chip.className = "color-chip";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "この色を消去対象から外す";
      removeBtn.addEventListener("click", () => {
        inkColors.splice(i, 1);
        renderColorChips();
      });
      chip.appendChild(swatch);
      chip.appendChild(removeBtn);
      colorChips.appendChild(chip);
    });
  }

  function updateUndoButton() {
    undoBtn.disabled = undoStack.length === 0;
  }

  function pushUndo() {
    undoStack.push(new ImageData(new Uint8ClampedArray(currentImageData.data), currentImageData.width, currentImageData.height));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    updateUndoButton();
  }

  function getCanvasPoint(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: clamp(Math.floor((evt.clientX - rect.left) * scaleX), 0, canvas.width - 1),
      y: clamp(Math.floor((evt.clientY - rect.top) * scaleY), 0, canvas.height - 1),
    };
  }

  function buildInkMask(data, w, h, colors, tol) {
    const mask = new Uint8Array(w * h);
    const thresholdSq = (tol * 3) ** 2;
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      for (let c = 0; c < colors.length; c++) {
        const ic = colors[c];
        const dr = r - ic[0];
        const dg = g - ic[1];
        const db = b - ic[2];
        if (dr * dr + dg * dg + db * db <= thresholdSq) {
          mask[i] = 1;
          break;
        }
      }
    }
    return mask;
  }

  function dilateMask(mask, w, h, radius) {
    let cur = mask;
    for (let r = 0; r < radius; r++) {
      const next = new Uint8Array(cur.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (cur[idx]) {
            next[idx] = 1;
            continue;
          }
          if (
            (x > 0 && cur[idx - 1]) ||
            (x < w - 1 && cur[idx + 1]) ||
            (y > 0 && cur[idx - w]) ||
            (y < h - 1 && cur[idx + w])
          ) {
            next[idx] = 1;
          }
        }
      }
      cur = next;
    }
    return cur;
  }

  function diffusionFill(data, w, h, maskedIdx, iterations) {
    for (let iter = 0; iter < iterations; iter++) {
      for (let k = 0; k < maskedIdx.length; k++) {
        const idx = maskedIdx[k];
        const x = idx % w;
        const y = (idx / w) | 0;
        let r = 0, g = 0, b = 0, count = 0;
        if (x > 0) { const p = (idx - 1) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; count++; }
        if (x < w - 1) { const p = (idx + 1) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; count++; }
        if (y > 0) { const p = (idx - w) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; count++; }
        if (y < h - 1) { const p = (idx + w) * 4; r += data[p]; g += data[p + 1]; b += data[p + 2]; count++; }
        if (count === 0) continue;
        const p = idx * 4;
        data[p] = r / count;
        data[p + 1] = g / count;
        data[p + 2] = b / count;
      }
    }
  }

  function maskToIndices(mask) {
    const idx = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i);
    return idx;
  }

  function runFillFromMask(mask) {
    const { data, width: w, height: h } = currentImageData;
    const dilated = dilateMask(mask, w, h, 1);
    const idx = maskToIndices(dilated);
    if (idx.length === 0) return false;
    diffusionFill(data, w, h, idx, FILL_ITERATIONS);
    return true;
  }

  function performColorErase(point) {
    const { data, width: w } = currentImageData;
    const p = (point.y * w + point.x) * 4;
    const picked = [data[p], data[p + 1], data[p + 2]];
    const isDuplicate = inkColors.some((c) => {
      const dr = c[0] - picked[0], dg = c[1] - picked[1], db = c[2] - picked[2];
      return dr * dr + dg * dg + db * db <= COLOR_DEDUPE_DIST ** 2;
    });
    if (!isDuplicate) inkColors.push(picked);
    renderColorChips();

    loadingOverlay.hidden = false;
    setTimeout(() => {
      pushUndo();
      const mask = buildInkMask(currentImageData.data, currentImageData.width, currentImageData.height, inkColors, tolerance);
      runFillFromMask(mask);
      drawCurrentToCanvas();
      loadingOverlay.hidden = true;
      eraseHint.textContent = "消えなかった部分があれば、もう一度ボタンを押して別の色をタップしてください。「くわしい設定」の消しゴムで手直しもできます。";
    }, 30);
  }

  eraseBtn.addEventListener("click", () => {
    if (brushMode) setBrushMode(false);
    awaitingPick = true;
    pickGuide.hidden = false;
    eraseBtn.disabled = true;
  });

  eraseCanvas.addEventListener("pointerdown", (e) => {
    if (brushMode) return; // 消しゴムモードは別ハンドラで処理
    if (!awaitingPick) return;
    e.preventDefault();
    const point = getCanvasPoint(eraseCanvas, e);
    awaitingPick = false;
    pickGuide.hidden = true;
    eraseBtn.disabled = false;
    performColorErase(point);
  });

  toleranceSlider.addEventListener("input", () => {
    tolerance = parseFloat(toleranceSlider.value);
  });
  brushSizeSlider.addEventListener("input", () => {
    brushSize = parseFloat(brushSizeSlider.value);
  });

  function setBrushMode(on) {
    brushMode = on;
    brushModeBtn.textContent = on ? "🖌️ 消しゴムをやめる" : "🖌️ 手で消す（消しゴム）";
    brushModeBtn.classList.toggle("active", on);
    eraseCanvas.style.cursor = on ? "crosshair" : "";
    if (on) {
      awaitingPick = false;
      pickGuide.hidden = true;
      eraseBtn.disabled = false;
    }
  }

  brushModeBtn.addEventListener("click", () => setBrushMode(!brushMode));

  // 消しゴム：ドラッグした軌跡をマスクにして塗りつぶし
  (() => {
    let brushing = false;
    let brushMask = null;
    let hadStroke = false;

    function stampCircle(mask, w, h, cx, cy, radius) {
      const r2 = radius * radius;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(w - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(h - 1, Math.ceil(cy + radius));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r2) mask[y * w + x] = 1;
        }
      }
    }

    eraseCanvas.addEventListener("pointerdown", (e) => {
      if (!brushMode) return;
      e.preventDefault();
      brushing = true;
      hadStroke = false;
      brushMask = new Uint8Array(currentImageData.width * currentImageData.height);
      const pt = getCanvasPoint(eraseCanvas, e);
      stampCircle(brushMask, currentImageData.width, currentImageData.height, pt.x, pt.y, brushSize / 2);
      hadStroke = true;
    });

    window.addEventListener("pointermove", (e) => {
      if (!brushing || !brushMode) return;
      const pt = getCanvasPoint(eraseCanvas, e);
      stampCircle(brushMask, currentImageData.width, currentImageData.height, pt.x, pt.y, brushSize / 2);
      hadStroke = true;
    });

    window.addEventListener("pointerup", () => {
      if (!brushing) return;
      brushing = false;
      if (hadStroke && brushMask) {
        loadingOverlay.hidden = false;
        setTimeout(() => {
          pushUndo();
          runFillFromMask(brushMask);
          drawCurrentToCanvas();
          loadingOverlay.hidden = true;
        }, 20);
      }
      brushMask = null;
    });
  })();

  undoBtn.addEventListener("click", () => {
    if (undoStack.length === 0) return;
    currentImageData = undoStack.pop();
    updateUndoButton();
    drawCurrentToCanvas();
  });

  resetEraseBtn.addEventListener("click", () => {
    if (!confirm("書き込み消去をやり直して、切り出し直後の状態に戻しますか？")) return;
    currentImageData = new ImageData(new Uint8ClampedArray(originalImageData.data), originalImageData.width, originalImageData.height);
    inkColors = [];
    undoStack = [];
    renderColorChips();
    updateUndoButton();
    drawCurrentToCanvas();
  });

  eraseBackBtn.addEventListener("click", () => {
    awaitingPick = false;
    pickGuide.hidden = true;
    eraseBtn.disabled = false;
    setBrushMode(false);
    showScreen("crop");
  });

  toPrintBtn.addEventListener("click", () => {
    const dataUrl = eraseCanvas.toDataURL("image/jpeg", 0.92);
    printImage.src = dataUrl;
    showScreen("print");
  });

  // ---------- ④ 印刷 ----------

  printBtn.addEventListener("click", () => window.print());

  saveImageBtn.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = printImage.src;
    a.download = "やり直しシート.jpg";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  restartBtn.addEventListener("click", () => {
    if (!confirm("最初の写真選択からやり直しますか？")) return;
    sourceImage = null;
    originalImageData = null;
    currentImageData = null;
    inkColors = [];
    undoStack = [];
    setBrushMode(false);
    showScreen("load");
  });

  showScreen("load");
})();
