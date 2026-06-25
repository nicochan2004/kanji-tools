(() => {
  const MAX_WORK_DIM = 2000;
  const MIN_CROP_FRAC = 0.08;
  const THUMB_DIM = 240;

  const screens = {
    list: document.getElementById("screenList"),
    crop: document.getElementById("screenCrop"),
    print: document.getElementById("screenPrint"),
  };

  const fileInput = document.getElementById("fileInput");
  const pageGrid = document.getElementById("pageGrid");
  const toPrintBtn = document.getElementById("toPrintBtn");

  const cropTitle = document.getElementById("cropTitle");
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

  const printBackBtn = document.getElementById("printBackBtn");
  const modeBwBtn = document.getElementById("modeBwBtn");
  const modeColorBtn = document.getElementById("modeColorBtn");
  const previewArea = document.getElementById("previewArea");
  const printBtn = document.getElementById("printBtn");
  const restartBtn = document.getElementById("restartBtn");

  let pages = [];
  let nextId = 1;
  let pendingQueue = [];
  let currentCropId = null;
  let workCrop = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
  let workBaseRotation = 0;
  let workFineRotation = 0;
  let mode = "bw";

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function findPage(id) {
    return pages.find((p) => p.id === id);
  }

  function removePage(id) {
    pages = pages.filter((p) => p.id !== id);
  }

  const DEFAULT_CROP_FRAC = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
  const AUTO_CROP_SAMPLE_DIM = 120;
  const AUTO_CROP_LINE_FRAC = 0.5; // この割合以上が「明るい」行/列を紙の範囲とみなす
  const AUTO_CROP_MARGIN = 0.012;
  const AUTO_CROP_MIN_SIZE_FRAC = 0.3; // 検出範囲が小さすぎる場合は自動判定を諦める

  // 紙(明るい)と背景の机など(暗い)のコントラストを利用して、紙のおおよその
  // 範囲を自動検出する。背景との明暗差が乏しい場合や検出範囲が極端な場合は
  // null を返し、呼び出し側で従来の固定マージンにフォールバックする。
  function detectPaperCropFrac(img) {
    const sw = AUTO_CROP_SAMPLE_DIM;
    const sh = Math.max(1, Math.round((sw * img.naturalHeight) / img.naturalWidth));
    const c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;

    const luma = new Float32Array(sw * sh);
    let minV = 255, maxV = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      luma[p] = v;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    if (maxV - minV < 30) return null;
    const threshold = (minV + maxV) / 2;

    const rowBright = new Float32Array(sh);
    const colBright = new Float32Array(sw);
    for (let y = 0; y < sh; y++) {
      let count = 0;
      for (let x = 0; x < sw; x++) {
        if (luma[y * sw + x] > threshold) count++;
      }
      rowBright[y] = count / sw;
    }
    for (let x = 0; x < sw; x++) {
      let count = 0;
      for (let y = 0; y < sh; y++) {
        if (luma[y * sw + x] > threshold) count++;
      }
      colBright[x] = count / sh;
    }

    let top = 0, bottom = sh - 1, left = 0, right = sw - 1;
    while (top < bottom && rowBright[top] < AUTO_CROP_LINE_FRAC) top++;
    while (bottom > top && rowBright[bottom] < AUTO_CROP_LINE_FRAC) bottom--;
    while (left < right && colBright[left] < AUTO_CROP_LINE_FRAC) left++;
    while (right > left && colBright[right] < AUTO_CROP_LINE_FRAC) right--;

    if (bottom - top < sh * AUTO_CROP_MIN_SIZE_FRAC || right - left < sw * AUTO_CROP_MIN_SIZE_FRAC) {
      return null;
    }

    return {
      left: clamp(left / sw + AUTO_CROP_MARGIN, 0, 0.4),
      top: clamp(top / sh + AUTO_CROP_MARGIN, 0, 0.4),
      right: clamp((right + 1) / sw - AUTO_CROP_MARGIN, 0.6, 1),
      bottom: clamp((bottom + 1) / sh - AUTO_CROP_MARGIN, 0.6, 1),
    };
  }

  function createPage(img) {
    return {
      id: nextId++,
      sourceImage: img,
      baseRotation: 0,
      fineRotation: 0,
      cropFrac: detectPaperCropFrac(img) || { ...DEFAULT_CROP_FRAC },
      cropped: false,
      colorCanvas: null,
      colorDataURL: null,
      grayDataURL: null,
      thumbDataURL: null,
    };
  }

  // ---------- ① ページ一覧・撮影 ----------

  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (files.length === 0) return;

    let loadedCount = 0;
    const newPages = new Array(files.length);

    function onOneDone() {
      loadedCount++;
      if (loadedCount < files.length) return;
      newPages.filter(Boolean).forEach((p) => {
        pages.push(p);
        pendingQueue.push(p.id);
      });
      if (pendingQueue.length > 0) {
        startCropQueue();
      } else {
        alert("写真を読み込めませんでした。別の写真をお試しください。");
        renderList();
      }
    }

    files.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        newPages[i] = createPage(img);
        onOneDone();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        onOneDone();
      };
      img.src = url;
    });
  });

  function renderList() {
    pageGrid.innerHTML = "";
    pages.forEach((page, idx) => {
      const card = document.createElement("div");
      card.className = "page-card";

      const num = document.createElement("span");
      num.className = "page-num";
      num.textContent = String(idx + 1);
      card.appendChild(num);

      const thumb = document.createElement("img");
      thumb.className = "page-thumb";
      thumb.src = page.thumbDataURL;
      thumb.alt = `ページ ${idx + 1}`;
      thumb.addEventListener("click", () => editPage(page.id));
      card.appendChild(thumb);

      const btnRow = document.createElement("div");
      btnRow.className = "page-card-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "mini-btn";
      upBtn.textContent = "▲";
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", () => movePage(idx, -1));
      btnRow.appendChild(upBtn);

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "mini-btn";
      downBtn.textContent = "▼";
      downBtn.disabled = idx === pages.length - 1;
      downBtn.addEventListener("click", () => movePage(idx, 1));
      btnRow.appendChild(downBtn);

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "mini-btn";
      editBtn.textContent = "✂️";
      editBtn.title = "切り出し直し";
      editBtn.addEventListener("click", () => editPage(page.id));
      btnRow.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mini-btn danger";
      delBtn.textContent = "🗑";
      delBtn.title = "削除";
      delBtn.addEventListener("click", () => deletePage(page.id));
      btnRow.appendChild(delBtn);

      card.appendChild(btnRow);
      pageGrid.appendChild(card);
    });
    toPrintBtn.disabled = pages.length === 0;
  }

  function movePage(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= pages.length) return;
    [pages[idx], pages[newIdx]] = [pages[newIdx], pages[idx]];
    renderList();
  }

  function deletePage(id) {
    if (!confirm("このページを削除しますか？")) return;
    removePage(id);
    renderList();
  }

  function editPage(id) {
    pendingQueue = [];
    loadCropScreenFor(id);
    showScreen("crop");
  }

  toPrintBtn.addEventListener("click", () => {
    showScreen("print");
    renderPreview();
  });

  // ---------- ② かたむき補正・トリミング ----------

  function startCropQueue() {
    if (pendingQueue.length === 0) {
      showScreen("list");
      renderList();
      return;
    }
    const id = pendingQueue.shift();
    loadCropScreenFor(id);
    showScreen("crop");
  }

  function loadCropScreenFor(id) {
    const page = findPage(id);
    currentCropId = id;
    workBaseRotation = page.baseRotation;
    workFineRotation = page.fineRotation;
    workCrop = { ...page.cropFrac };
    rotateSlider.value = workFineRotation;
    rotateValueLabel.textContent = `${workFineRotation}°`;
    const idx = pages.findIndex((p) => p.id === id);
    cropTitle.textContent = `かたむき補正・切り出し（ページ ${idx + 1}）`;
    renderCropStage();
    renderCropBox();
  }

  function renderCropStage() {
    const page = findPage(currentCropId);
    if (!page) return;
    const rad = ((workBaseRotation + workFineRotation) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const iw = page.sourceImage.naturalWidth;
    const ih = page.sourceImage.naturalHeight;
    const outW = Math.round(iw * cos + ih * sin);
    const outH = Math.round(iw * sin + ih * cos);
    cropCanvas.width = outW;
    cropCanvas.height = outH;
    const ctx = cropCanvas.getContext("2d");
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.drawImage(page.sourceImage, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  function renderCropBox() {
    const { left, top, right, bottom } = workCrop;
    cropBox.style.left = `${left * 100}%`;
    cropBox.style.top = `${top * 100}%`;
    cropBox.style.width = `${(right - left) * 100}%`;
    cropBox.style.height = `${(bottom - top) * 100}%`;
    cropDim.style.clipPath = `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${left * 100}% ${top * 100}%, ${right * 100}% ${top * 100}%, ${right * 100}% ${bottom * 100}%, ${left * 100}% ${bottom * 100}%, ${left * 100}% ${top * 100}%)`;
  }

  function resetCropFrac() {
    workCrop = { ...DEFAULT_CROP_FRAC };
    renderCropBox();
  }

  rotateLeftBtn.addEventListener("click", () => {
    workBaseRotation = (workBaseRotation - 90 + 360) % 360;
    renderCropStage();
    resetCropFrac();
  });
  rotateRightBtn.addEventListener("click", () => {
    workBaseRotation = (workBaseRotation + 90) % 360;
    renderCropStage();
    resetCropFrac();
  });
  rotateSlider.addEventListener("input", () => {
    workFineRotation = parseFloat(rotateSlider.value);
    rotateValueLabel.textContent = `${workFineRotation}°`;
    renderCropStage();
    resetCropFrac();
  });

  cropBackBtn.addEventListener("click", () => {
    const page = findPage(currentCropId);
    const isNew = page && !page.cropped;
    if (isNew) {
      const remaining = 1 + pendingQueue.length;
      const msg = remaining > 1
        ? `切り出しをやめて一覧に戻りますか？まだ確定していない${remaining}枚の写真は追加されません。`
        : "切り出しをやめて一覧に戻りますか？この写真は追加されません。";
      if (!confirm(msg)) return;
      removePage(currentCropId);
      while (pendingQueue.length) removePage(pendingQueue.shift());
    }
    currentCropId = null;
    showScreen("list");
    renderList();
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
        workCrop = { left, top, right: left + w, bottom: top + h };
      } else {
        const r = { ...s };
        const handle = dragState.handle;
        if (handle.includes("l")) r.left = clamp(s.left + dx, 0, s.right - MIN_CROP_FRAC);
        if (handle.includes("r")) r.right = clamp(s.right + dx, s.left + MIN_CROP_FRAC, 1);
        if (handle.includes("t")) r.top = clamp(s.top + dy, 0, s.bottom - MIN_CROP_FRAC);
        if (handle.includes("b")) r.bottom = clamp(s.bottom + dy, s.top + MIN_CROP_FRAC, 1);
        workCrop = r;
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
        startRect: { ...workCrop },
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

  function makeThumbDataURL(canvas, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    const tw = Math.max(1, Math.round(canvas.width * scale));
    const th = Math.max(1, Math.round(canvas.height * scale));
    const tmp = document.createElement("canvas");
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext("2d").drawImage(canvas, 0, 0, tw, th);
    return tmp.toDataURL("image/jpeg", 0.8);
  }

  cropNextBtn.addEventListener("click", () => {
    const page = findPage(currentCropId);
    const w = cropCanvas.width;
    const h = cropCanvas.height;
    const sx = Math.round(workCrop.left * w);
    const sy = Math.round(workCrop.top * h);
    const sw = Math.round((workCrop.right - workCrop.left) * w);
    const sh = Math.round((workCrop.bottom - workCrop.top) * h);
    const scale = Math.min(1, MAX_WORK_DIM / Math.max(sw, sh));
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    outCanvas.getContext("2d").drawImage(cropCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

    page.baseRotation = workBaseRotation;
    page.fineRotation = workFineRotation;
    page.cropFrac = { ...workCrop };
    page.colorCanvas = outCanvas;
    page.colorDataURL = outCanvas.toDataURL("image/jpeg", 0.92);
    page.grayDataURL = null;
    page.thumbDataURL = makeThumbDataURL(outCanvas, THUMB_DIM);
    page.cropped = true;

    currentCropId = null;
    startCropQueue();
  });

  // ---------- ③ 印刷プレビュー ----------

  // 撮影時の照明ムラ(紙の上端が暗い、中央だけ明るい等)があると、固定の
  // しきい値では場所によって白くなったりならなかったりする。マス目(セル)
  // ごとに輝度の上位パーセンタイルを取って「そのあたりの紙の明るさ」を
  // 推定する。平均ではなく上位パーセンタイルを使うのは、文字や線がそこに
  // 多く含まれていても紙そのものの明るさに引っ張られにくくするため。
  const BG_GRID_COLS = 12;
  const BG_PERCENTILE = 0.2; // 明るい方から数えてこの割合に入る輝度を背景とみなす
  const NEAR_BACKGROUND_RATIO = 0.9;
  // 十分に暗い画素は文字・線とみなし、純粋な黒にする(撮影時の露出不足で
  // 黒のはずがグレーに写ってしまうのを補正)。これより明るい(が背景ほど
  // 明るくはない)画素は、意図的なグレーハッチングなど中間調とみなし、
  // 明るさを変えずそのまま残す(以前はここも暗くしていたが、中間調の
  // グレーが黒くなってしまう問題があったため廃止)。
  const BLACK_CUTOFF = 90;

  function buildBackgroundLumaMap(c) {
    const w = c.width;
    const h = c.height;
    const data = c.getContext("2d").getImageData(0, 0, w, h).data;

    const cols = BG_GRID_COLS;
    const rows = Math.max(1, Math.round((cols * h) / w));
    const cellW = Math.ceil(w / cols);
    const cellH = Math.ceil(h / rows);

    const small = document.createElement("canvas");
    small.width = cols;
    small.height = rows;
    const sctx = small.getContext("2d");
    const smallImg = sctx.createImageData(cols, rows);
    const bucket = new Uint32Array(64);

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        bucket.fill(0);
        const x0 = cx * cellW, x1 = Math.min(w, x0 + cellW);
        const y0 = cy * cellH, y1 = Math.min(h, y0 + cellH);
        let count = 0;
        for (let y = y0; y < y1; y++) {
          let p = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++, p += 4) {
            const v = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
            bucket[Math.min(63, v >> 2)]++;
            count++;
          }
        }
        let cum = 0;
        let est = 255;
        for (let b = 63; b >= 0; b--) {
          cum += bucket[b];
          if (cum >= count * BG_PERCENTILE) {
            est = b * 4 + 2;
            break;
          }
        }
        const idx = (cy * cols + cx) * 4;
        smallImg.data[idx] = smallImg.data[idx + 1] = smallImg.data[idx + 2] = est;
        smallImg.data[idx + 3] = 255;
      }
    }
    sctx.putImageData(smallImg, 0, 0);

    const map = document.createElement("canvas");
    map.width = w;
    map.height = h;
    map.getContext("2d").drawImage(small, 0, 0, w, h);
    return map.getContext("2d").getImageData(0, 0, w, h).data;
  }

  function getGrayDataURL(page) {
    if (page.grayDataURL) return page.grayDataURL;
    const c = page.colorCanvas;
    const bgData = buildBackgroundLumaMap(c);
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(c, 0, 0);
    const imgData = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const bg = bgData[i];
      let out;
      if (v >= bg * NEAR_BACKGROUND_RATIO) {
        out = 255;
      } else if (v <= BLACK_CUTOFF) {
        out = 0;
      } else {
        out = v;
      }
      d[i] = d[i + 1] = d[i + 2] = out;
    }
    tctx.putImageData(imgData, 0, 0);
    page.grayDataURL = tmp.toDataURL("image/jpeg", 0.92);
    return page.grayDataURL;
  }

  function renderPreview() {
    previewArea.innerHTML = "";
    pages.forEach((page) => {
      const div = document.createElement("div");
      div.className = "sheet-page";
      const img = document.createElement("img");
      img.src = mode === "bw" ? getGrayDataURL(page) : page.colorDataURL;
      img.alt = "印刷ページ";
      div.appendChild(img);
      previewArea.appendChild(div);
    });
  }

  function setMode(m) {
    mode = m;
    modeBwBtn.classList.toggle("active", m === "bw");
    modeColorBtn.classList.toggle("active", m === "color");
    renderPreview();
  }

  modeBwBtn.addEventListener("click", () => setMode("bw"));
  modeColorBtn.addEventListener("click", () => setMode("color"));

  printBackBtn.addEventListener("click", () => {
    showScreen("list");
    renderList();
  });

  const A4_W_MM = 210;
  const A4_H_MM = 297;
  const PDF_MARGIN_MM = 3;

  function buildPrintPdfBlob() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const maxW = A4_W_MM - PDF_MARGIN_MM * 2;
    const maxH = A4_H_MM - PDF_MARGIN_MM * 2;

    pages.forEach((page, idx) => {
      if (idx > 0) doc.addPage();
      const dataUrl = mode === "bw" ? getGrayDataURL(page) : page.colorDataURL;
      const iw = page.colorCanvas.width;
      const ih = page.colorCanvas.height;
      const scale = Math.min(maxW / iw, maxH / ih);
      const w = iw * scale;
      const h = ih * scale;
      const x = (A4_W_MM - w) / 2;
      const y = (A4_H_MM - h) / 2;
      doc.addImage(dataUrl, "JPEG", x, y, w, h);
    });

    return doc.output("blob");
  }

  // 真のPDFページとして書き出すことで、SafariのHTML印刷ページ分割の不具合
  // (画像が物理的に1個の<img>のため、ページ境界で真っ二つに割れる)を回避する。
  // 非表示iframeに読み込んで自動でprint()を呼ぶ方式は、iOS実機では
  // PDFの読み込みタイミング次第で1ページ目しか認識されないことがあり
  // 信頼できなかったため、Safari標準のPDFビューアで開いて、ユーザーに
  // 共有メニューから印刷してもらう確実な方式にする。
  function openPdfBlob(blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }

  printBtn.addEventListener("click", () => {
    printBtn.disabled = true;
    printBtn.textContent = "🖨️ 準備中…";
    setTimeout(() => {
      try {
        openPdfBlob(buildPrintPdfBlob());
      } finally {
        printBtn.disabled = false;
        printBtn.textContent = "🖨️ 印刷する";
      }
    }, 30);
  });

  restartBtn.addEventListener("click", () => {
    if (!confirm("最初からやり直しますか？追加したページはすべて削除されます。")) return;
    pages = [];
    pendingQueue = [];
    currentCropId = null;
    setMode("bw");
    showScreen("list");
    renderList();
  });

  showScreen("list");
  renderList();
})();
