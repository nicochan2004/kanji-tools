(() => {
  const TOTAL_SLOTS = 18;
  const PER_PAGE = 3;
  const MASU_PER_WORD = 9;
  const SENTENCE_ROWS = 25;

  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";
  const kvgCache = new Map(); // char -> {viewBox, paths:[d...], numbers:[{x,y,label}]} | null

  const inputGroupsEl = document.getElementById("inputGroups");
  const previewEl = document.getElementById("preview");
  const pdfBtn = document.getElementById("pdfBtn");
  const clearBtn = document.getElementById("clearBtn");
  const kaiInputEl = document.getElementById("kaiInput");

  function buildInputUI() {
    inputGroupsEl.innerHTML = "";
    for (let g = 0; g < TOTAL_SLOTS / PER_PAGE; g++) {
      const group = document.createElement("div");
      group.className = "input-group";
      const h = document.createElement("h3");
      const start = g * PER_PAGE + 1;
      const end = start + PER_PAGE - 1;
      h.textContent = `${start}〜${end}`;
      group.appendChild(h);

      const row = document.createElement("div");
      row.className = "input-row";
      for (let i = 0; i < PER_PAGE; i++) {
        const slot = g * PER_PAGE + i + 1;
        const cell = document.createElement("div");
        cell.className = "input-cell";
        const label = document.createElement("label");
        label.textContent = slot;
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 4;
        input.dataset.slot = String(slot);
        input.autocapitalize = "off";
        input.autocomplete = "off";
        cell.appendChild(label);
        cell.appendChild(input);
        row.appendChild(cell);
      }
      group.appendChild(row);
      inputGroupsEl.appendChild(group);
    }
  }

  function getWords() {
    const inputs = inputGroupsEl.querySelectorAll("input");
    const words = new Array(TOTAL_SLOTS).fill("");
    inputs.forEach((inp) => {
      const slot = Number(inp.dataset.slot) - 1;
      words[slot] = inp.value.trim();
    });
    return words;
  }

  function charToHex(ch) {
    return ch.codePointAt(0).toString(16).padStart(5, "0");
  }

  function isKanji(ch) {
    return /[一-鿿㐀-䶿]/.test(ch);
  }

  function isHiragana(ch) {
    return /[぀-ゟ]/.test(ch);
  }

  // 単語を「1マスに入れる文字の組」の配列に変換する。
  // 送り仮名(連続するひらがな)は2文字ずつペアにして1マスに収める。
  function buildBaseSlots(word) {
    const slots = [];
    let i = 0;
    while (i < word.length) {
      const ch = word[i];
      const nextCh = word[i + 1];
      if (isHiragana(ch) && nextCh && isHiragana(nextCh)) {
        slots.push([ch, nextCh]);
        i += 2;
      } else {
        slots.push([ch]);
        i += 1;
      }
    }
    return slots;
  }

  // 4文字の単語のみ、ひらがなペアでマス数を圧縮した分だけ単語を繰り返して
  // 9マスを使い切り、複数回練習できるようにする。それ以外の文字数は1マス1文字のまま。
  function buildCellSlots(word) {
    if (word.length !== 4) {
      return word.split("").map((ch) => [ch]);
    }
    const base = buildBaseSlots(word);
    if (base.length === 0) return [];
    const slots = [];
    while (slots.length + base.length <= MASU_PER_WORD) {
      slots.push(...base);
    }
    return slots;
  }

  async function fetchKvg(ch) {
    if (kvgCache.has(ch)) return kvgCache.get(ch);
    try {
      const hex = charToHex(ch);
      const res = await fetch(`${KVG_BASE}${hex}.svg`);
      if (!res.ok) throw new Error("not-found");
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const source = doc.querySelector("svg");
      const pathGroup = source.querySelector('g[id^="kvg:StrokePaths_"]');
      const numberGroup = source.querySelector('g[id^="kvg:StrokeNumbers_"]');
      if (!pathGroup) throw new Error("parse-error");
      const viewBox = source.getAttribute("viewBox") || "0 0 109 109";
      const paths = Array.from(pathGroup.querySelectorAll("path")).map((p) => p.getAttribute("d"));
      const numbers = [];
      if (numberGroup) {
        numberGroup.querySelectorAll("text").forEach((t) => {
          numbers.push({ transform: t.getAttribute("transform"), label: t.textContent });
        });
      }
      const data = { viewBox, paths, numbers };
      kvgCache.set(ch, data);
      return data;
    } catch (e) {
      kvgCache.set(ch, null);
      return null;
    }
  }

  function buildStrokeSvg(data, showNumbers) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", data.viewBox);

    const pathLayer = document.createElementNS(ns, "g");
    pathLayer.setAttribute("fill", "none");
    pathLayer.setAttribute("stroke", "#A6A6A6");
    pathLayer.setAttribute("stroke-width", "3");
    pathLayer.setAttribute("stroke-linecap", "round");
    pathLayer.setAttribute("stroke-linejoin", "round");
    data.paths.forEach((d) => {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      pathLayer.appendChild(p);
    });

    svg.appendChild(pathLayer);

    if (showNumbers) {
      const numberLayer = document.createElementNS(ns, "g");
      numberLayer.setAttribute("fill", "#2E5395");
      numberLayer.setAttribute("font-size", "9");
      numberLayer.setAttribute("font-family", "sans-serif");
      data.numbers.forEach((n) => {
        const t = document.createElementNS(ns, "text");
        t.setAttribute("transform", n.transform);
        t.textContent = n.label;
        numberLayer.appendChild(t);
      });
      svg.appendChild(numberLayer);
    }

    return svg;
  }

  function buildSentenceCol() {
    const col = document.createElement("div");
    col.className = "sentence-col";
    const label = document.createElement("div");
    label.className = "sentence-label";
    label.textContent = "例文";
    col.appendChild(label);

    const grid = document.createElement("div");
    grid.className = "sentence-grid";
    for (let r = 0; r < SENTENCE_ROWS; r++) {
      const row = document.createElement("div");
      row.className = "sentence-row";
      for (let c = 0; c < 2; c++) {
        const cell = document.createElement("div");
        cell.className = "sentence-cell";
        row.appendChild(cell);
      }
      grid.appendChild(row);
    }
    col.appendChild(grid);
    return col;
  }

  function buildUnit(word, slotNumber) {
    const unit = document.createElement("div");
    unit.className = "unit";

    const practiceCol = document.createElement("div");
    practiceCol.className = "practice-col";

    const cellSlots = buildCellSlots(word);
    const isPairMode = word.length === 4;
    const charTargets = []; // { container, ch, small } : KVGロード後にストローク表示へ差し替える対象
    for (let i = 0; i < MASU_PER_WORD; i++) {
      const masu = document.createElement("div");
      masu.className = "masu";
      const slot = cellSlots[i];
      if (slot && slot.length === 2) {
        // 送り仮名のペアは縦書き(上下スタック)で1マスに収める
        masu.classList.add("masu-paired");
        slot.forEach((ch) => {
          const half = document.createElement("div");
          half.className = "masu-half";
          const charEl = document.createElement("div");
          charEl.className = "masu-char masu-char-half";
          charEl.textContent = ch;
          half.appendChild(charEl);
          masu.appendChild(half);
          charTargets.push({ container: half, ch, small: true });
        });
      } else if (slot && slot.length === 1) {
        const ch = slot[0];
        // ペア化できず1文字だけ残った送り仮名は、ペア表示と揃えて小さい文字・上寄せにする
        const isLoneKana = isPairMode && isHiragana(ch);
        const charEl = document.createElement("div");
        charEl.className = "masu-char" + (isLoneKana ? " masu-char-lone-kana" : "");
        charEl.textContent = ch;
        masu.appendChild(charEl);
        charTargets.push({ container: masu, ch, small: isLoneKana });
      }
      if (i === 0) {
        // masuはoverflow:hiddenなので、欄外に丸数字を出すためラッパーで囲む
        const wrap = document.createElement("div");
        wrap.className = "masu-slot-wrap";
        wrap.appendChild(masu);
        const slotLabel = document.createElement("div");
        slotLabel.className = "masu-slot-number";
        slotLabel.textContent = slotNumber;
        wrap.appendChild(slotLabel);
        practiceCol.appendChild(wrap);
      } else {
        practiceCol.appendChild(masu);
      }
    }
    unit.appendChild(practiceCol);
    unit.appendChild(buildSentenceCol());

    charTargets.forEach(({ container, ch, small }) => {
      const showNumbers = isKanji(ch); // 番号表示は漢字のみ。ひらがな等も同じ線の細さで統一する
      fetchKvg(ch).then((data) => {
        if (!data) return; // 取得失敗時はプレーンな文字表示のまま
        const charEl = container.querySelector(".masu-char");
        if (charEl) charEl.remove();
        const wrap = document.createElement("div");
        wrap.className = "masu-stroke" + (small ? " masu-stroke-small" : "");
        wrap.appendChild(buildStrokeSvg(data, showNumbers));
        container.appendChild(wrap);
      });
    });

    return unit;
  }

  function buildPage(words, pageIndex, totalPages) {
    const page = document.createElement("div");
    page.className = "sheet-page";

    const inner = document.createElement("div");
    inner.className = "page-inner";

    const header = document.createElement("div");
    header.className = "page-header";
    const title = document.createElement("div");
    title.textContent = `かんじ れんしゅう シート（${pageIndex + 1}/${totalPages}）`;
    const kai = kaiInputEl.value.trim();
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `名前：　　　　　　　　　　第${kai || "　　"}回　　日付：　　年　　月　　日`;
    header.appendChild(title);
    header.appendChild(meta);
    inner.appendChild(header);

    const body = document.createElement("div");
    body.className = "page-body";
    words.forEach((w, i) => body.appendChild(buildUnit(w, pageIndex * PER_PAGE + i + 1)));
    inner.appendChild(body);

    page.appendChild(inner);
    return page;
  }

  // 用紙の印刷可能領域はプリンタ環境によってA4の規定サイズより狭くなることがあるため、
  // 実際のコンテンツ高さを測って収まらない場合のみ縮小し、必ず1ページに収める。
  // (.sheet-page自体のサイズをA4ぴったりにしないことの説明はstyle.css参照)
  // 縮小には transform: scale() ではなく zoom を使う。transform は見た目だけを変える
  // ペイント時の効果でレイアウト上の占有サイズは縮まらないため、zoomの方がブラウザ間で
  // 一貫した挙動になる。
  function fitPageToOnePage(pageEl) {
    const inner = pageEl.querySelector(".page-inner");
    if (!inner) return;
    inner.style.zoom = 1;
    const cs = getComputedStyle(pageEl);
    const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // Safari対策の主な余裕は.sheet-page自体のサイズ(style.css参照)で確保済みなので、
    // ここでの余裕は印刷フォントレンダリング等の微小な誤差を吸収する程度で十分。
    const SAFETY_RATIO = 0.95;
    const availableHeight = (pageEl.clientHeight - paddingV) * SAFETY_RATIO;
    const innerHeight = inner.scrollHeight;
    if (innerHeight > availableHeight && availableHeight > 0) {
      const scale = availableHeight / innerHeight;
      inner.style.zoom = scale;
    }
  }

  function fitAllPages() {
    previewEl.querySelectorAll(".sheet-page").forEach(fitPageToOnePage);
  }

  // スマホのSafari/Chromeはブラウザの印刷エンジン側の余白・スケール処理が機種ごとに
  // ばらつき、CSSだけでは確実に1ページに収めきれない。そのため、画面に表示している
  // シートをそのままラスタライズしてPDFへ直接書き出す(=ブラウザの印刷ページ処理を経由しない)
  // ことで、印刷結果を確実に同じレイアウトにする。
  const PDF_PAGE_W_MM = 210; // A4
  const PDF_PAGE_H_MM = 297; // A4
  const SHEET_W_MM = 205; // .sheet-pageのwidth(20.5cm)と一致させる
  const SHEET_H_MM = 275; // .sheet-pageのheight(27.5cm)と一致させる

  async function buildPdfDoc() {
    const pages = previewEl.querySelectorAll(".sheet-page");
    if (pages.length === 0) return null;
    fitAllPages();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const offsetX = (PDF_PAGE_W_MM - SHEET_W_MM) / 2;
    const offsetY = (PDF_PAGE_H_MM - SHEET_H_MM) / 2;
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", offsetX, offsetY, SHEET_W_MM, SHEET_H_MM);
    }
    return pdf;
  }

  // window.open()でPDFを新規タブに開いて印刷する方式も試したが、iOS Safariは
  // 非同期処理(await)を挟んだ後のwindow.open()をユーザー操作起因と認識せず
  // ポップアップとしてブロックしてしまい、ボタンが反応しないように見える問題があった。
  // ダウンロード(pdf.save)はこの制限を受けないため、PDFを保存してそれを開いて
  // 印刷してもらう方式に統一する。
  async function savePdf() {
    if (previewEl.querySelectorAll(".sheet-page").length === 0) {
      alert("漢字や単語を入力してください。");
      return;
    }
    const originalLabel = pdfBtn.textContent;
    pdfBtn.disabled = true;
    pdfBtn.textContent = "準備中...";
    try {
      const pdf = await buildPdfDoc();
      const kai = kaiInputEl.value.trim();
      pdf.save(`漢字練習シート${kai ? "_第" + kai + "回" : ""}.pdf`);
    } catch (e) {
      // PDFライブラリが読み込めない場合(オフライン等)は従来の印刷方法にフォールバックする
      fitAllPages();
      window.print();
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = originalLabel;
    }
  }

  function render() {
    const words = getWords();
    let lastFilled = -1;
    words.forEach((w, i) => { if (w) lastFilled = i; });

    previewEl.innerHTML = "";
    if (lastFilled < 0) {
      const msg = document.createElement("p");
      msg.className = "no-print";
      msg.style.color = "#999";
      msg.style.padding = "20px";
      msg.textContent = "漢字や単語を入力すると、ここにプレビューが表示されます。";
      previewEl.appendChild(msg);
      return;
    }

    const totalPages = Math.ceil((lastFilled + 1) / PER_PAGE);
    for (let p = 0; p < totalPages; p++) {
      const pageWords = words.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
      previewEl.appendChild(buildPage(pageWords, p, totalPages));
    }
    requestAnimationFrame(fitAllPages);
  }

  let debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, 350);
  }

  buildInputUI();
  inputGroupsEl.addEventListener("input", scheduleRender);
  kaiInputEl.addEventListener("input", scheduleRender);
  pdfBtn.addEventListener("click", savePdf);
  clearBtn.addEventListener("click", () => {
    inputGroupsEl.querySelectorAll("input").forEach((inp) => { inp.value = ""; });
    render();
  });
  window.addEventListener("beforeprint", fitAllPages);
  window.addEventListener("resize", () => requestAnimationFrame(fitAllPages));

  render();
})();
