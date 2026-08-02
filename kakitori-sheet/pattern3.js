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

  let previewEl = null;
  let onChange = null;
  let nextId = 1;

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
    yomiEl.textContent = sel.readings.join("");
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
  }

  function init(pv, changeCb) {
    previewEl = pv;
    onChange = changeCb;
    sentencesEl.addEventListener("input", scheduleRender);
    resetPendingBtn.addEventListener("click", () => {
      state.pending = null;
      rerenderAll();
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
