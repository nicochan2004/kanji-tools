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

  function createPage(img) {
    return {
      id: nextId++,
      sourceImage: img,
      baseRotation: 0,
      fineRotation: 0,
      cropFrac: { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 },
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
    workCrop = { left: 0.04, top: 0.04, right: 0.96, bottom: 0.96 };
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

  function getGrayDataURL(page) {
    if (page.grayDataURL) return page.grayDataURL;
    const c = page.colorCanvas;
    const tmp = document.createElement("canvas");
    tmp.width = c.width;
    tmp.height = c.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(c, 0, 0);
    const imgData = tctx.getImageData(0, 0, tmp.width, tmp.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      d[i] = d[i + 1] = d[i + 2] = v;
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

  printBtn.addEventListener("click", () => window.print());

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
