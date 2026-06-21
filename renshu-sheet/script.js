(() => {
  const TOTAL_SLOTS = 18;
  const PER_PAGE = 3;
  const MASU_PER_WORD = 9;
  const SENTENCE_ROWS = 25;

  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";
  const kvgCache = new Map(); // char -> {viewBox, paths:[d...], numbers:[{x,y,label}]} | null

  const inputGroupsEl = document.getElementById("inputGroups");
  const previewEl = document.getElementById("preview");
  const printBtn = document.getElementById("printBtn");
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

    const masuEls = [];
    for (let i = 0; i < MASU_PER_WORD; i++) {
      const masu = document.createElement("div");
      masu.className = "masu";
      const ch = i < word.length ? word[i] : "";
      if (ch) {
        const charEl = document.createElement("div");
        charEl.className = "masu-char";
        charEl.textContent = ch;
        masu.appendChild(charEl);
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
      masuEls.push(masu);
    }
    unit.appendChild(practiceCol);
    unit.appendChild(buildSentenceCol());

    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      const showNumbers = isKanji(ch); // 番号表示は漢字のみ。ひらがな等も同じ線の細さで統一する
      fetchKvg(ch).then((data) => {
        if (!data) return; // 取得失敗時はプレーンな文字表示のまま
        const masu = masuEls[i];
        const charEl = masu.querySelector(".masu-char");
        if (charEl) charEl.remove();
        const wrap = document.createElement("div");
        wrap.className = "masu-stroke";
        wrap.appendChild(buildStrokeSvg(data, showNumbers));
        masu.appendChild(wrap);
      });
    }

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
  function fitPageToOnePage(pageEl) {
    const inner = pageEl.querySelector(".page-inner");
    if (!inner) return;
    inner.style.transform = "none";
    const cs = getComputedStyle(pageEl);
    const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availableHeight = pageEl.clientHeight - paddingV;
    const innerHeight = inner.scrollHeight;
    if (innerHeight > availableHeight && availableHeight > 0) {
      const scale = availableHeight / innerHeight;
      inner.style.transform = `scale(${scale})`;
    }
  }

  function fitAllPages() {
    previewEl.querySelectorAll(".sheet-page").forEach(fitPageToOnePage);
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
  printBtn.addEventListener("click", () => {
    fitAllPages();
    window.print();
  });
  clearBtn.addEventListener("click", () => {
    inputGroupsEl.querySelectorAll("input").forEach((inp) => { inp.value = ""; });
    render();
  });
  window.addEventListener("beforeprint", fitAllPages);
  window.addEventListener("resize", () => requestAnimationFrame(fitAllPages));

  render();
})();
