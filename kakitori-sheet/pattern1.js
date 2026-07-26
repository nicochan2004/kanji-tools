// パターン①: 漢字単体練習
// 単語(複数文字の熟語も可)を入力すると、全単語をつなげた1つの文字列にし、
// 固定サイズのグリッド(横cols×縦rows)の右上の列から、上→下、列は右→左の順
// (縦書きの読み順)に敷き詰める。文字が足りない残りのマスは空欄になる。
// 各列の右にその列専用の読みがな列を添える。単語の最後の文字のマスだけ
// 罫線を太くして、次の単語との境目を示す。
(() => {
  const INITIAL_SLOTS = 20;
  const SLOT_STEP = 10;

  const unitsEl = document.getElementById("p1Units");
  const colsEl = document.getElementById("p1Cols");
  const rowsEl = document.getElementById("p1Rows");
  const addBtn = document.getElementById("p1AddBtn");
  let slotCount = 0;
  let previewEl = null;
  let onChange = null;

  // 単語テキストの文字構成に合わせて、読み入力欄を作り直す。
  // ひらがなの文字はそのまま固定表示(送り仮名は読みも同じひらがな)、それ以外は編集可能な入力欄にする。
  // 既存の入力値は同じ文字位置であれば保持する。
  function rebuildYomiInputs(container, text) {
    const prevValues = {};
    container.querySelectorAll("input[data-char-index]").forEach((el) => {
      prevValues[Number(el.dataset.charIndex)] = el.value;
    });
    container.innerHTML = "";
    Array.from(text).forEach((ch, i) => {
      if (KD.isHiragana(ch)) {
        const label = document.createElement("span");
        label.className = "yomi-char-fixed";
        label.textContent = ch;
        label.dataset.charIndex = String(i);
        container.appendChild(label);
      } else {
        const inp = document.createElement("input");
        inp.className = "yomi-char-input";
        inp.maxLength = 3;
        inp.placeholder = "読み";
        inp.dataset.charIndex = String(i);
        if (prevValues[i] !== undefined) inp.value = prevValues[i];
        container.appendChild(inp);
      }
    });
  }

  // 漢字の各文字について、まだ読みが空の入力欄だけkuromoji.jsの推定読みを補う。
  // 手動で入力/修正済みの値は上書きしない(自動生成はあくまで下書き)。
  async function autofillReadings(container, text) {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      if (KD.isHiragana(chars[i])) continue;
      const inp = container.querySelector(`.yomi-char-input[data-char-index="${i}"]`);
      if (!inp || inp.value) continue;
      const reading = await KD.guessReading(chars[i]);
      if (!inp.isConnected || inp.value) continue;
      if (reading) {
        inp.value = reading;
        scheduleRender();
      }
    }
  }

  function addSlots(n) {
    for (let i = 0; i < n; i++) {
      slotCount += 1;
      const row = document.createElement("div");
      row.className = "unit-input-row word-input-row";
      row.dataset.slot = String(slotCount);

      const label = document.createElement("span");
      label.className = "slot-label";
      label.textContent = String(slotCount);

      const wordInput = document.createElement("input");
      wordInput.className = "word-text-input";
      wordInput.placeholder = "漢字(複数文字も可)";

      const yomiContainer = document.createElement("div");
      yomiContainer.className = "yomi-inputs-container";

      wordInput.addEventListener("input", () => {
        const text = wordInput.value.trim();
        rebuildYomiInputs(yomiContainer, text);
        autofillReadings(yomiContainer, text);
        scheduleRender();
      });

      row.appendChild(label);
      row.appendChild(wordInput);
      row.appendChild(yomiContainer);
      unitsEl.appendChild(row);
    }
  }

  function getWords() {
    const rows = unitsEl.querySelectorAll(".word-input-row");
    const words = [];
    rows.forEach((row) => {
      const text = row.querySelector(".word-text-input").value.trim();
      if (!text) return;
      const chars = Array.from(text);
      const readings = chars.map((ch, i) => {
        if (KD.isHiragana(ch)) return ch;
        const inp = row.querySelector(`.yomi-char-input[data-char-index="${i}"]`);
        return inp ? inp.value.trim() : "";
      });
      words.push({ text, readings });
    });
    return words;
  }

  // 単語群を1つの文字ストリームに変換する。各文字がその単語の最後の文字かどうかを保持し、
  // 単語の境目(=次の単語に変わる直前)のマスだけ罫線を太くする判定に使う。
  function buildCharStream(words) {
    const stream = [];
    words.forEach((word) => {
      const chars = Array.from(word.text);
      chars.forEach((ch, i) => {
        stream.push({ char: ch, reading: word.readings[i] || "", isLastOfWord: i === chars.length - 1 });
      });
    });
    return stream;
  }

  function paginateStream(stream, capacity) {
    const pages = [];
    for (let i = 0; i < stream.length; i += capacity) {
      pages.push(stream.slice(i, i + capacity));
    }
    if (pages.length === 0) pages.push([]);
    return pages;
  }

  // パターン①はなぞり用のお手本文字を表示しない(空欄のマス+補助線のみ)。
  // 何を書くかは右側の読みがな列を見て自分で判断して書く。
  function buildMasu(charInfo) {
    const masu = document.createElement("div");
    masu.className = "masu-dashed";
    if (charInfo && charInfo.isLastOfWord) {
      masu.classList.add("p1-cell-strong");
    }
    return masu;
  }

  function buildYomiCell(charInfo) {
    const cell = document.createElement("div");
    cell.className = "p1-yomi-cell";
    if (charInfo) {
      cell.textContent = charInfo.reading;
      if (charInfo.isLastOfWord) cell.classList.add("p1-cell-strong");
    }
    return cell;
  }

  function buildPage(pageChars, pageIndex, totalPages, cols, rowsCount) {
    const page = document.createElement("div");
    page.className = "sheet-page orientation-portrait";

    const inner = document.createElement("div");
    inner.className = "page-inner";

    const header = document.createElement("div");
    header.className = "page-header";
    const title = document.createElement("div");
    title.textContent = `かんじ たんたい れんしゅう（${pageIndex + 1}/${totalPages}）`;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "名前：　　　　　　　　　　日付：　　年　　月　　日";
    header.appendChild(title);
    header.appendChild(meta);
    inner.appendChild(header);

    const body = document.createElement("div");
    body.className = "p1-page-body";
    // col=0が最初に埋まる列(=右端に表示、page-bodyはrow-reverseなのでDOM順の最初が右端に来る)。
    for (let c = 0; c < cols; c++) {
      const colGroup = document.createElement("div");
      colGroup.className = "p1-col-group";
      const practiceCol = document.createElement("div");
      practiceCol.className = "p1-col-practice";
      const yomiCol = document.createElement("div");
      yomiCol.className = "p1-col-yomi";
      for (let r = 0; r < rowsCount; r++) {
        const charInfo = pageChars[c * rowsCount + r] || null;
        practiceCol.appendChild(buildMasu(charInfo));
        yomiCol.appendChild(buildYomiCell(charInfo));
      }
      colGroup.appendChild(practiceCol);
      colGroup.appendChild(yomiCol);
      body.appendChild(colGroup);
    }
    inner.appendChild(body);

    page.appendChild(inner);
    return page;
  }

  function render() {
    const words = getWords();
    const cols = Math.max(1, Math.min(10, Number(colsEl.value) || 6));
    const rowsCount = Math.max(1, Math.min(20, Number(rowsEl.value) || 11));

    previewEl.innerHTML = "";
    if (words.length === 0) {
      const msg = document.createElement("p");
      msg.className = "no-print";
      msg.style.color = "#999";
      msg.style.padding = "20px";
      msg.textContent = "漢字と読みを入力すると、ここにプレビューが表示されます。";
      previewEl.appendChild(msg);
      return;
    }

    const stream = buildCharStream(words);
    const capacity = cols * rowsCount;
    const pages = paginateStream(stream, capacity);
    pages.forEach((pageChars, p) => {
      previewEl.appendChild(buildPage(pageChars, p, pages.length, cols, rowsCount));
    });
    requestAnimationFrame(() => KD.fitAllPages(previewEl));
  }

  let debounceTimer = null;
  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { if (onChange) onChange(); }, 350);
  }

  function clear() {
    unitsEl.innerHTML = "";
    slotCount = 0;
    addSlots(INITIAL_SLOTS);
    colsEl.value = 6;
    rowsEl.value = 11;
  }

  function init(pv, changeCb) {
    previewEl = pv;
    onChange = changeCb;
    addSlots(INITIAL_SLOTS);
    unitsEl.addEventListener("input", scheduleRender);
    colsEl.addEventListener("input", scheduleRender);
    rowsEl.addEventListener("input", scheduleRender);
    addBtn.addEventListener("click", () => addSlots(SLOT_STEP));
  }

  window.KD_pattern1 = {
    key: "1",
    init,
    render,
    clear,
    pageConfig: () => KD.PAGE_CONFIG.portrait,
    filename: () => "漢字単体練習.pdf",
  };
})();
