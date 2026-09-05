// パターン③: テスト形式(横向きA4、縦書き)
// 漢字仮名混じりの文章をそのまま入力し、プレビュー上で漢字にしたい部分をクリックして選択する。
// 選択した文字列自体が升目に書く正解になり(升目の数=選択した文字数)、
// その読み・送り仮名は自動推定した上で手動修正できる。
// 1つの文が1つの縦書きの列になり、右から左に並ぶ。
(() => {

  const sentencesEl = document.getElementById("p3Sentences");
  const selectPreviewEl = document.getElementById("p3SelectPreview");
  const selectionListEl = document.getElementById("p3SelectionList");
  const resetPendingBtn = document.getElementById("p3ResetPendingBtn");
  const imageInputEl = document.getElementById("p3ImageInput");
  const ocrStatusEl = document.getElementById("p3OcrStatus");
  const debugPreviewEl = document.getElementById("p3DebugPreview");

  let previewEl = null;
  let onChange = null;
  let nextId = 1;
  let ocrWorker = null;

  const state = {
    sentences: [],
    selections: [], // { id, sentenceIndex, start, end, readings, displayNumber }
    pending: null, // { sentenceIndex, start } | null
  };

  function getSentencesFromTextarea() {
    return sentencesEl.value.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function selectedChars(sel) {
    return Array.from(state.sentences[sel.sentenceIndex] || "").slice(sel.start, sel.end + 1);
  }

  // 送り仮名(ひらがな)はそのまま、それ以外は空文字を初期値にした読み配列を作る。
  function defaultReadings(chars) {
    return chars.map((ch) => (KD.isHiragana(ch) ? ch : ""));
  }

  function findSelectionAt(sIdx, cIdx) {
    return state.selections.find((sel) => sel.sentenceIndex === sIdx && cIdx >= sel.start && cIdx <= sel.end);
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return !(aEnd < bStart || aStart > bEnd);
  }

  // 番号は出題ごとではなく1つの文章ごとに振る。同じ文章に含まれる出題は全部同じ番号になる。
  function sortedSelections() {
    const sorted = [...state.selections].sort((a, b) => a.sentenceIndex - b.sentenceIndex || a.start - b.start);
    const sentenceNumber = {};
    let counter = 0;
    sorted.forEach((sel) => {
      if (!(sel.sentenceIndex in sentenceNumber)) {
        counter += 1;
        sentenceNumber[sel.sentenceIndex] = counter;
      }
      sel.displayNumber = sentenceNumber[sel.sentenceIndex];
    });
    return sorted;
  }

  function flashReject(sIdx, start, end) {
    for (let i = start; i <= end; i++) {
      const span = selectPreviewEl.querySelector(`.char[data-s="${sIdx}"][data-i="${i}"]`);
      if (!span) continue;
      span.classList.add("char-reject");
      setTimeout(() => span.classList.remove("char-reject"), 350);
    }
  }

  // 漢字部分だけ、まだ読みが空なら自動推定して補う(kuromoji.js)。1文字ずつではなく
  // 連続する漢字のまとまりごとにまとめて解析することで、「興味」の「味」だけを見て
  // 「あじ」と誤読するようなことを避ける(KD.guessReadingsForChars参照)。
  // 手動修正済みの値は上書きしない。
  async function autofillSelectionReadings(sel) {
    const chars = selectedChars(sel);
    const readings = await KD.guessReadingsForChars(chars);
    if (!state.selections.includes(sel)) return;
    let changed = false;
    chars.forEach((ch, i) => {
      if (KD.isHiragana(ch)) return;
      if (sel.readings[i]) return;
      if (readings[i]) {
        sel.readings[i] = readings[i];
        changed = true;
      }
    });
    if (changed) {
      renderSelectionList();
      renderPrintPreview();
    }
  }

  // ===== 写真からの読み取り(OCR + 傍線検出) =====
  // 縦書きの文章を撮影した写真から、文字認識(OCR)と傍線(縦線)の検出を行い、
  // 自動的に文章と選択済み(=問題化したい)範囲を組み立てる。ブラウザ内で
  // 完結させるためTesseract.js(OCRライブラリ)を使う。縦書きはTesseractの
  // 標準的な横書き認識と相性が悪いため、画像を反時計回りに90度回転させて
  // 擬似的に横書きとして認識させ、得られた座標を元画像の座標系に逆変換して使う。
  // さらに、複数の縦書きの列(文)が並んだ画像を一度にOCRへかけると、
  // Tesseractの行/段落分割が複雑な縦書きレイアウトを正しく扱えず文字順序が
  // 大きく乱れることが分かった(実例が報告されている)ため、まず画像を
  // 縦方向のプロジェクションプロファイル(列と列の間の空白)で列ごとに分割し、
  // 列(=1文)ごとに個別にOCRする。
  // 文字認識・傍線検出のどちらも完璧ではない前提の機能であり、読み取り後は
  // 必ずユーザーが内容を確認・修正する(選択部分は従来どおりクリックで直せる)。

  function setOcrStatus(text) {
    if (!text) { ocrStatusEl.hidden = true; ocrStatusEl.textContent = ""; return; }
    ocrStatusEl.hidden = false;
    ocrStatusEl.textContent = text;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // 列分割・傍線検出はピクセル単位で画像全体を走査するため、スマホ写真の
  // フル解像度(4000px超が普通)のままだと処理が非常に重くなる。文字認識に
  // 支障が出ない範囲まで縮小してから扱う。
  const OCR_MAX_DIMENSION = 2000;
  function drawToCanvas(img) {
    const scale = Math.min(1, OCR_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // 縦書き(列は右→左、列内は上→下)を、Tesseractが得意な横書き風の並びに
  // 変換するため反時計回りに90度回転する。回転後は「列の順序(右→左)」が
  // 「行の順序(上→下)」に、「列内の文字順(上→下)」が「行内の文字順(左→右)」
  // になるので、Tesseractの通常の行認識でも縦書きの読み順どおりに文字が並ぶ。
  function rotateCanvasCCW90(srcCanvas) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const dst = document.createElement("canvas");
    dst.width = h;
    dst.height = w;
    const ctx = dst.getContext("2d");
    ctx.translate(0, w);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(srcCanvas, 0, 0);
    return dst;
  }

  function getImageData(canvas) {
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  function isDarkPixel(imgData, x, y, threshold) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= imgData.width || y >= imgData.height) return false;
    const idx = (y * imgData.width + x) * 4;
    const lum = 0.299 * imgData.data[idx] + 0.587 * imgData.data[idx + 1] + 0.114 * imgData.data[idx + 2];
    return lum < threshold;
  }

  // rotateCanvasCCW90(translate(0,w)してからrotate(-90°))は、元画像上の点(x,y)を
  // 回転後の点(y, w-x) (wは回転前の幅)に写す。その逆変換は
  // 回転後(rx,ry) -> 回転前(w-ry, rx)。bboxは向きが変わるため、
  // 4隅すべてを変換してから外接矩形を取る。
  function rotatedBoxToOriginal(box, origW) {
    const corners = [
      [box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1],
    ].map(([rx, ry]) => [origW - ry, rx]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  // 大津の二値化法で、画像全体の輝度ヒストグラムから最適な閾値を自動的に求める。
  // 固定閾値だと、撮影時の明るさ・コントラスト次第で文字と背景がほとんど
  // 区別できなくなり(全部「明るい」判定になって列分割が機能しない等)、
  // 精度が写真ごとに大きくばらつく原因になっていた。
  function computeOtsuThreshold(imgData) {
    const histogram = new Array(256).fill(0);
    const data = imgData.data;
    const total = imgData.width * imgData.height;
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      histogram[lum] += 1;
    }
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];
    let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  function cropCanvas(srcCanvas, x0, x1) {
    const w = x1 - x0 + 1;
    const h = srcCanvas.height;
    const dst = document.createElement("canvas");
    dst.width = w;
    dst.height = h;
    dst.getContext("2d").drawImage(srcCanvas, x0, 0, w, h, 0, 0, w, h);
    return dst;
  }

  // 列分割の結果を、検出した列の境界を赤枠で重ねた画像として画面に表示する。
  // OCRの精度が悪いとき、原因が「列分割自体がずれている」のか「分割は
  // できているが文字認識が外れている」のかを見分けられるようにするための
  // デバッグ用プレビュー。
  function showDebugColumnPreview(srcCanvas, colRanges) {
    const dbg = document.createElement("canvas");
    dbg.width = srcCanvas.width;
    dbg.height = srcCanvas.height;
    const ctx = dbg.getContext("2d");
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    colRanges.forEach(([x0, x1]) => {
      ctx.strokeRect(x0 + 1, 1, Math.max(1, x1 - x0 - 2), dbg.height - 2);
    });
    debugPreviewEl.innerHTML = "";
    const label = document.createElement("p");
    label.textContent = `検出した列: ${colRanges.length}個(赤枠)。文章や選択箇所が変なときは、ここが正しく列ごとに区切れているか確認してください。`;
    const img = document.createElement("img");
    img.src = dbg.toDataURL("image/png");
    debugPreviewEl.appendChild(label);
    debugPreviewEl.appendChild(img);
    debugPreviewEl.hidden = false;
  }

  // 元画像を二値化し、縦方向(X軸)の黒画素密度(プロジェクションプロファイル)を求め、
  // 密度がほぼ0(ただの余白)のX範囲を「列と列の間の隙間」とみなして、画像を
  // 縦書きの列ごとに分割する。複数列を一度にOCRへかけると精度が大きく落ちる
  // ため、列ごとに切り出して個別に処理する前段として使う。
  function splitIntoColumns(imgData, darkThreshold) {
    const w = imgData.width, h = imgData.height;
    const density = new Array(w).fill(0);
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = 0; y < h; y++) {
        if (isDarkPixel(imgData, x, y, darkThreshold)) count += 1;
      }
      density[x] = count;
    }
    const maxDensity = Math.max(...density, 1);
    const threshold = maxDensity * 0.02;
    const minGap = Math.max(4, Math.round(w * 0.006));

    const ranges = [];
    let start = null;
    let gapRun = 0;
    for (let x = 0; x < w; x++) {
      if (density[x] > threshold) {
        if (start === null) start = x;
        gapRun = 0;
      } else if (start !== null) {
        gapRun += 1;
        if (gapRun >= minGap) {
          ranges.push([start, x - gapRun]);
          start = null;
        }
      }
    }
    if (start !== null) ranges.push([start, w - 1]);
    return ranges;
  }

  // 文字bbox(元画像座標系)の左側(縦書きで次に読む文字がある方向)に、傍線
  // (太い縦棒)があるかを判定する。文字本体のストロークと誤検出しないよう、
  // 文字の外側(bboxよりさらに左)の細い帯だけを見て、その中で縦方向に連続する
  // 黒画素が文字の高さの大部分を占めるかをチェックする。手書きの傍線は文字の
  // 上端・下端を多少はみ出して引かれることが多いため、判定範囲は上下に少し広げる。
  function hasVerticalLineLeftOf(imgData, box, darkThreshold) {
    const boxW = box.x1 - box.x0;
    const boxH = box.y1 - box.y0;
    if (boxW <= 0 || boxH <= 0) return false;
    const bandX0 = box.x0 - boxW * 0.6;
    const bandX1 = box.x0 - boxW * 0.1;
    const padY = boxH * 0.2;
    const y0 = box.y0 - padY, y1 = box.y1 + padY;
    let bestRun = 0;
    for (let x = Math.floor(bandX0); x <= Math.ceil(bandX1); x++) {
      let run = 0, maxRun = 0;
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        if (isDarkPixel(imgData, x, y, darkThreshold)) {
          run += 1;
          maxRun = Math.max(maxRun, run);
        } else {
          run = 0;
        }
      }
      bestRun = Math.max(bestRun, maxRun);
    }
    return bestRun >= boxH * 0.6;
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    ocrWorker = await Tesseract.createWorker("jpn");
    return ocrWorker;
  }

  // 1列ぶん(切り出して回転した画像)のTesseract認識結果(階層構造:
  // blocks > paragraphs > lines > words > symbols)から、文字とbbox
  // (その列の切り出し画像内での回転前座標系)をフラットな配列で返す。
  // 上から下・左から右の順にそのまま辿れば、回転前の縦書きの正しい
  // 読み順(列内は上→下)になる。Tesseract.jsのバージョンによっては
  // symbolsまで辿れないことがあるため、取れなければword単位(そのwordの
  // 文字をbbox幅で均等割りした位置)にフォールバックする。
  function extractCharsFromColumnOcr(data, colW) {
    const blocks = data.blocks || (data.paragraphs ? [{ paragraphs: data.paragraphs }] : []);
    const chars = [];
    blocks.forEach((block) => {
      (block.paragraphs || []).forEach((para) => {
        (para.lines || []).forEach((line) => {
          (line.words || []).forEach((word) => {
            if (word.symbols && word.symbols.length > 0) {
              word.symbols.forEach((sym) => {
                if (!sym.text || !sym.text.trim()) return;
                chars.push({ text: sym.text, box: rotatedBoxToOriginal(sym.bbox, colW) });
              });
            } else if (word.text && word.text.trim()) {
              const wChars = Array.from(word.text.trim());
              const bbox = word.bbox;
              const step = (bbox.x1 - bbox.x0) / wChars.length;
              wChars.forEach((ch, i) => {
                const sub = { x0: bbox.x0 + step * i, x1: bbox.x0 + step * (i + 1), y0: bbox.y0, y1: bbox.y1 };
                chars.push({ text: ch, box: rotatedBoxToOriginal(sub, colW) });
              });
            }
          });
        });
      });
    });
    return chars;
  }

  async function runOcrPipeline(file) {
    imageInputEl.disabled = true;
    debugPreviewEl.hidden = true;
    try {
      setOcrStatus("画像を読み込み中…");
      const img = await loadImageFromFile(file);
      const srcCanvas = drawToCanvas(img);
      const origImgData = getImageData(srcCanvas);
      const darkThreshold = computeOtsuThreshold(origImgData);

      let colRanges = splitIntoColumns(origImgData, darkThreshold);
      if (colRanges.length === 0) colRanges = [[0, srcCanvas.width - 1]];
      // 縦書きは右の列から読むため、x座標が大きい順(右→左)に並べ替える。
      colRanges.sort((a, b) => b[0] - a[0]);
      showDebugColumnPreview(srcCanvas, colRanges);

      const worker = await getOcrWorker();
      const newSentences = [];
      const columnChars = []; // 列(=文)ごとの文字配列(元画像全体の座標系のbox付き)

      for (let c = 0; c < colRanges.length; c++) {
        const [colX0, colX1] = colRanges[c];
        setOcrStatus(
          `文字を認識しています…(${c + 1}/${colRanges.length}列目。初回は辞書データの取得で時間がかかることがあります)`
        );
        const colCanvas = cropCanvas(srcCanvas, colX0, colX1);
        const rotated = rotateCanvasCCW90(colCanvas);
        const { data } = await worker.recognize(rotated, {}, { blocks: true });
        const chars = extractCharsFromColumnOcr(data, colCanvas.width)
          .filter((c2) => c2.text)
          .map((c2) => ({
            text: c2.text,
            // 列の切り出し画像内の座標に、その列の元画像内でのオフセット(colX0)を
            // 足して元画像全体の座標系に戻す(傍線検出は元画像のImageDataを使うため)。
            box: { x0: c2.box.x0 + colX0, x1: c2.box.x1 + colX0, y0: c2.box.y0, y1: c2.box.y1 },
          }));
        if (chars.length === 0) continue;
        columnChars.push(chars);
        newSentences.push(chars.map((c2) => c2.text).join(""));
      }

      if (newSentences.length === 0) {
        alert("文字を読み取れませんでした。写真を変えるか、手入力してください。");
        setOcrStatus("");
        return;
      }

      const newSelections = [];
      let idc = 1;
      columnChars.forEach((chars, sentenceIndex) => {
        let i = 0;
        while (i < chars.length) {
          if (!hasVerticalLineLeftOf(origImgData, chars[i].box, darkThreshold)) { i += 1; continue; }
          let j = i;
          while (j + 1 < chars.length && hasVerticalLineLeftOf(origImgData, chars[j + 1].box, darkThreshold)) j += 1;
          const selChars = chars.slice(i, j + 1).map((c2) => c2.text);
          newSelections.push({ id: idc++, sentenceIndex, start: i, end: j, readings: defaultReadings(selChars) });
          i = j + 1;
        }
      });

      sentencesEl.value = newSentences.join("\n");
      state.sentences = newSentences;
      state.selections = newSelections;
      state.pending = null;
      rerenderAll();
      newSelections.forEach((sel) => autofillSelectionReadings(sel));

      setOcrStatus(
        `読み取り完了: ${newSentences.length}文、${newSelections.length}箇所を問題として検出しました。` +
        `内容と選択箇所を確認し、違っていればクリックで直接修正してください。`
      );
    } catch (e) {
      alert("読み取りに失敗しました。写真を変えるか、手入力してください。");
      setOcrStatus("");
    } finally {
      imageInputEl.disabled = false;
      imageInputEl.value = "";
    }
  }

  function onCharClick(sIdx, cIdx) {
    const existing = findSelectionAt(sIdx, cIdx);
    if (existing) {
      state.selections = state.selections.filter((s) => s.id !== existing.id);
      rerenderAll();
      return;
    }
    if (!state.pending) {
      state.pending = { sentenceIndex: sIdx, start: cIdx };
      rerenderAll();
      return;
    }
    if (state.pending.sentenceIndex !== sIdx) {
      state.pending = { sentenceIndex: sIdx, start: cIdx };
      rerenderAll();
      return;
    }
    if (cIdx < state.pending.start) {
      state.pending.start = cIdx;
      rerenderAll();
      return;
    }
    const start = state.pending.start;
    const end = cIdx;
    const overlap = state.selections.some(
      (sel) => sel.sentenceIndex === sIdx && rangesOverlap(start, end, sel.start, sel.end)
    );
    if (overlap) {
      flashReject(sIdx, start, end);
      return;
    }
    const chars = Array.from(state.sentences[sIdx]).slice(start, end + 1);
    const sel = { id: nextId++, sentenceIndex: sIdx, start, end, readings: defaultReadings(chars) };
    state.selections.push(sel);
    state.pending = null;
    rerenderAll();
    autofillSelectionReadings(sel);
  }

  function renderSelectPreview() {
    selectPreviewEl.innerHTML = "";
    if (state.sentences.length === 0) {
      const msg = document.createElement("p");
      msg.style.color = "#999";
      msg.style.margin = "0";
      msg.textContent = "文章を入力すると、ここで漢字にする部分をクリックして選択できます。";
      selectPreviewEl.appendChild(msg);
      return;
    }
    state.sentences.forEach((sentence, sIdx) => {
      const line = document.createElement("div");
      line.className = "select-line";
      Array.from(sentence).forEach((ch, cIdx) => {
        const span = document.createElement("span");
        span.className = "char";
        span.textContent = ch;
        span.dataset.s = String(sIdx);
        span.dataset.i = String(cIdx);
        if (findSelectionAt(sIdx, cIdx)) span.classList.add("char-selected");
        if (state.pending && state.pending.sentenceIndex === sIdx && cIdx === state.pending.start) {
          span.classList.add("char-pending");
        }
        span.addEventListener("click", () => onCharClick(sIdx, cIdx));
        line.appendChild(span);
      });
      selectPreviewEl.appendChild(line);
    });
  }

  // 選択範囲ごとに、読み・送り仮名を修正できる入力欄を並べる(パターン①②と同じ考え方)。
  // ひらがなの文字はそのまま固定表示、それ以外(漢字)だけ編集可能なカタカナ入力欄にする。
  function renderSelectionList() {
    selectionListEl.innerHTML = "";
    const sorted = sortedSelections();
    if (sorted.length === 0) return;
    sorted.forEach((sel) => {
      const item = document.createElement("div");
      item.className = "selection-item";

      const num = document.createElement("span");
      num.className = "sel-num";
      num.textContent = KD.circledNumber(sel.displayNumber);

      const chars = selectedChars(sel);
      const text = document.createElement("span");
      text.className = "sel-text";
      text.textContent = "「" + chars.join("") + "」";

      const yomiContainer = document.createElement("div");
      yomiContainer.className = "yomi-inputs-container";
      chars.forEach((ch, i) => {
        if (KD.isHiragana(ch)) {
          const label = document.createElement("span");
          label.className = "yomi-char-fixed";
          label.textContent = ch;
          yomiContainer.appendChild(label);
        } else {
          const inp = document.createElement("input");
          inp.className = "yomi-char-input";
          inp.maxLength = 12;
          inp.placeholder = "読み";
          inp.value = sel.readings[i] || "";
          inp.addEventListener("input", () => {
            sel.readings[i] = inp.value;
            KD.autoSizeYomiInput(inp);
            renderPrintPreview();
          });
          KD.autoSizeYomiInput(inp);
          yomiContainer.appendChild(inp);
        }
      });

      item.appendChild(num);
      item.appendChild(text);
      item.appendChild(yomiContainer);
      selectionListEl.appendChild(item);
    });
  }

  // 1つの出題(升目+読み)のブロックを作る。丸数字は文ごとに列の先頭で1回だけ出すので、
  // ここでは出さない。通常表示にも、下部の練習用の複製にも使う。
  function buildAnswerUnit(sel) {
    const unit = document.createElement("div");
    unit.className = "p3-answer-unit";

    const masusCol = document.createElement("div");
    masusCol.className = "p3-answer-masus";
    const boxCount = sel.end - sel.start + 1;
    for (let b = 0; b < boxCount; b++) {
      const masu = document.createElement("div");
      masu.className = "p3-answer-masu masu-dashed";
      masusCol.appendChild(masu);
    }

    const sideCol = document.createElement("div");
    sideCol.className = "p3-answer-side";
    const yomiEl = document.createElement("div");
    yomiEl.className = "p3-answer-yomi";
    yomiEl.appendChild(KD.buildVerticalText(sel.readings.join("")));
    sideCol.appendChild(yomiEl);

    unit.appendChild(masusCol);
    unit.appendChild(sideCol);
    return unit;
  }

  // 1つの文=1つの縦書きの列。丸数字は文の先頭に1つだけ表示する(文内の出題は全部同じ番号)。
  // 出題範囲(升目)以外はそのまま縦書きの文字として続ける。升目の数=選択した文字数。
  // 文字を並べ終わったら、この列で使った出題ブロックをまるごと複製し、
  // 列の下の余白に自主練習用としてもう一度並べる。
  function buildSentenceCol(sentence, sIdx) {
    const chars = Array.from(sentence);
    const col = document.createElement("div");
    col.className = "p3-sentence-col";
    const sels = sortedSelections().filter((s) => s.sentenceIndex === sIdx);

    if (sels.length > 0) {
      const numEl = document.createElement("div");
      numEl.className = "p3-sentence-num";
      numEl.textContent = KD.circledNumber(sels[0].displayNumber);
      col.appendChild(numEl);
    }

    let i = 0;
    const usedSels = [];
    while (i < chars.length) {
      const sel = sels.find((s) => s.start === i);
      if (sel) {
        col.appendChild(buildAnswerUnit(sel));
        usedSels.push(sel);
        i = sel.end + 1;
      } else {
        const c = document.createElement("div");
        c.className = "p3-char";
        // 句読点のグリフは横書き用に左下寄りにデザインされているため、そのまま縦に
        // 並べると縦書きなのに左下に見えてしまう。縦書きでの本来の位置(右下)に
        // 近づくよう、視覚的に右へずらす。
        if (chars[i] === "、" || chars[i] === "。") c.classList.add("p3-char-punct");
        c.textContent = chars[i];
        col.appendChild(c);
        i += 1;
      }
    }
    if (usedSels.length > 0) {
      const practiceWrap = document.createElement("div");
      practiceWrap.className = "p3-practice-wrap";
      usedSels.forEach((sel) => practiceWrap.appendChild(buildAnswerUnit(sel)));
      col.appendChild(practiceWrap);
    }
    return col;
  }

  async function renderPrintPreview() {
    previewEl.innerHTML = "";
    if (state.sentences.length === 0) {
      const msg = document.createElement("p");
      msg.className = "no-print";
      msg.style.color = "#999";
      msg.style.padding = "20px";
      msg.textContent = "文章を入力すると、ここにプレビューが表示されます。";
      previewEl.appendChild(msg);
      return;
    }

    const page = document.createElement("div");
    page.className = "sheet-page orientation-landscape";
    const inner = document.createElement("div");
    inner.className = "page-inner";

    const header = document.createElement("div");
    header.className = "page-header";
    const title = document.createElement("div");
    title.textContent = "かんじ かきとり テスト";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "名前：　　　　　　　　　　日付：　　年　　月　　日";
    header.appendChild(title);
    header.appendChild(meta);
    inner.appendChild(header);

    const body = document.createElement("div");
    body.className = "p3-page-body";
    // DOM順の最初の文がrow-reverseで一番右に来る(縦書き文章の読み順=右から左)。
    state.sentences.forEach((s, idx) => body.appendChild(buildSentenceCol(s, idx)));
    inner.appendChild(body);

    page.appendChild(inner);
    previewEl.appendChild(page);

    await new Promise((resolve) => requestAnimationFrame(resolve));

    KD.fitPageToOnePage(page);
  }

  function rerenderAll() {
    renderSelectPreview();
    renderSelectionList();
    renderPrintPreview();
  }

  function render() {
    state.sentences = getSentencesFromTextarea();
    // 文章編集で無効になった選択範囲(文が消えた/短くなった)を除去する
    state.selections = state.selections.filter((sel) => {
      const s = state.sentences[sel.sentenceIndex];
      if (s === undefined) return false;
      return sel.end < Array.from(s).length;
    });
    rerenderAll();
  }

  let debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { if (onChange) onChange(); }, 350);
  }

  function clear() {
    sentencesEl.value = "";
    state.sentences = [];
    state.selections = [];
    state.pending = null;
    setOcrStatus("");
    debugPreviewEl.hidden = true;
    debugPreviewEl.innerHTML = "";
  }

  function init(pv, changeCb) {
    previewEl = pv;
    onChange = changeCb;
    sentencesEl.addEventListener("input", scheduleRender);
    resetPendingBtn.addEventListener("click", () => {
      state.pending = null;
      rerenderAll();
    });
    imageInputEl.addEventListener("change", () => {
      const file = imageInputEl.files && imageInputEl.files[0];
      if (file) runOcrPipeline(file);
    });
  }

  window.KD_pattern3 = {
    key: "3",
    init,
    render,
    clear,
    pageConfig: () => KD.PAGE_CONFIG.landscape,
    filename: () => "漢字書き取りテスト.pdf",
  };
})();
