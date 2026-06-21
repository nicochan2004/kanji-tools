(() => {
  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";

  const inputEl = document.getElementById("kanjiInput");
  const searchBtn = document.getElementById("searchBtn");
  const charTabsEl = document.getElementById("charTabs");
  const modeStaticBtn = document.getElementById("modeStatic");
  const modeAnimateBtn = document.getElementById("modeAnimate");
  const messageEl = document.getElementById("message");
  const stageEl = document.getElementById("kanjiStage");
  const animControlsEl = document.getElementById("animControls");
  const btnRestart = document.getElementById("btnRestart");
  const btnPrev = document.getElementById("btnPrev");
  const btnPlayPause = document.getElementById("btnPlayPause");
  const btnNext = document.getElementById("btnNext");
  const speedRange = document.getElementById("speedRange");
  const showNumbersCheck = document.getElementById("showNumbersCheck");
  const strokeCountEl = document.getElementById("strokeCount");

  const svgCache = new Map();

  let mode = "static"; // "static" | "animate"
  let currentChar = null;
  let strokes = [];   // path要素の配列(画順)
  let numbers = [];   // text要素の配列(画順、strokesと対応)
  let currentIndex = 0; // 次に描く画のインデックス
  let playing = false;
  let playToken = 0; // 再生の世代管理(中断検知用)

  function charToHex(char) {
    return char.codePointAt(0).toString(16).padStart(5, "0");
  }

  function showMessage(text) {
    messageEl.textContent = text;
    messageEl.hidden = !text;
  }

  async function fetchKvgSvg(char) {
    if (svgCache.has(char)) return svgCache.get(char);
    const hex = charToHex(char);
    const res = await fetch(`${KVG_BASE}${hex}.svg`);
    if (!res.ok) throw new Error("not-found");
    const text = await res.text();
    svgCache.set(char, text);
    return text;
  }

  function parseKvgSvg(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const sourceSvg = doc.querySelector("svg");
    if (!sourceSvg) throw new Error("parse-error");

    const pathGroup = sourceSvg.querySelector('g[id^="kvg:StrokePaths_"]');
    const numberGroup = sourceSvg.querySelector('g[id^="kvg:StrokeNumbers_"]');
    if (!pathGroup) throw new Error("parse-error");

    const pathEls = Array.from(pathGroup.querySelectorAll("path"));
    const textEls = numberGroup ? Array.from(numberGroup.querySelectorAll("text")) : [];

    // 番号テキストの内容(1,2,3...)で並び替え、画順との対応を保証する
    textEls.sort((a, b) => Number(a.textContent) - Number(b.textContent));

    const viewBox = sourceSvg.getAttribute("viewBox") || "0 0 109 109";
    return { pathEls, textEls, viewBox };
  }

  function buildStage({ pathEls, textEls, viewBox }) {
    stageEl.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", viewBox);

    const pathLayer = document.createElementNS(ns, "g");
    const numberLayer = document.createElementNS(ns, "g");

    strokes = pathEls.map((p) => {
      const clone = document.createElementNS(ns, "path");
      clone.setAttribute("d", p.getAttribute("d"));
      clone.classList.add("stroke-path");
      pathLayer.appendChild(clone);
      return clone;
    });

    numbers = textEls.map((t) => {
      const clone = document.createElementNS(ns, "text");
      clone.setAttribute("transform", t.getAttribute("transform"));
      clone.classList.add("stroke-number");
      clone.textContent = t.textContent;
      numberLayer.appendChild(clone);
      return clone;
    });

    svg.appendChild(pathLayer);
    svg.appendChild(numberLayer);
    stageEl.appendChild(svg);

    strokeCountEl.textContent = `全${strokes.length}画`;
  }

  function showAllStatic() {
    strokes.forEach((p) => {
      p.style.transition = "none";
      p.style.strokeDasharray = "none";
      p.style.strokeDashoffset = "0";
      p.classList.remove("current");
    });
    numbers.forEach((n) => {
      n.style.visibility = "visible";
    });
    currentIndex = strokes.length;
  }

  function resetForAnimation() {
    stopPlaying();
    strokes.forEach((p) => {
      const len = p.getTotalLength();
      p.style.transition = "none";
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
      p.classList.remove("current");
    });
    numbers.forEach((n) => {
      n.style.visibility = "hidden";
    });
    currentIndex = 0;
    updateAnimButtons();
  }

  function applyCurrentMode() {
    if (!strokes.length) return;
    if (mode === "static") {
      animControlsEl.hidden = true;
      showAllStatic();
    } else {
      animControlsEl.hidden = false;
      resetForAnimation();
    }
  }

  function animateStroke(path, duration) {
    return new Promise((resolve) => {
      path.classList.add("current");
      requestAnimationFrame(() => {
        path.style.transition = `stroke-dashoffset ${duration}ms linear`;
        requestAnimationFrame(() => {
          path.style.strokeDashoffset = "0";
        });
      });
      const onEnd = (e) => {
        if (e.propertyName !== "stroke-dashoffset") return;
        path.removeEventListener("transitionend", onEnd);
        path.classList.remove("current");
        resolve();
      };
      path.addEventListener("transitionend", onEnd);
    });
  }

  async function stepForward() {
    if (currentIndex >= strokes.length) return;
    const idx = currentIndex;
    const duration = Number(speedRange.value);
    await animateStroke(strokes[idx], duration);
    if (showNumbersCheck.checked && numbers[idx]) {
      numbers[idx].style.visibility = "visible";
    }
    currentIndex += 1;
    updateAnimButtons();
  }

  function stepBackward() {
    if (currentIndex <= 0) return;
    currentIndex -= 1;
    const p = strokes[currentIndex];
    p.style.transition = "none";
    p.style.strokeDashoffset = p.style.strokeDasharray;
    if (numbers[currentIndex]) numbers[currentIndex].style.visibility = "hidden";
    updateAnimButtons();
  }

  async function playFromCurrent() {
    if (playing) return;
    playing = true;
    const token = ++playToken;
    updateAnimButtons();
    while (currentIndex < strokes.length && playing && token === playToken) {
      await stepForward();
    }
    playing = false;
    updateAnimButtons();
  }

  function stopPlaying() {
    playing = false;
    playToken += 1;
    updateAnimButtons();
  }

  function updateAnimButtons() {
    btnPrev.disabled = currentIndex <= 0;
    btnNext.disabled = currentIndex >= strokes.length || playing;
    btnRestart.disabled = currentIndex === 0 && !playing;
    btnPlayPause.textContent = playing ? "⏸ 一時停止" : "▶️ 再生";
    btnPlayPause.disabled = currentIndex >= strokes.length && !playing;
  }

  let loadToken = 0;

  async function loadChar(char) {
    showMessage("");
    currentChar = char;
    const token = ++loadToken;
    stopPlaying();
    strokes = [];
    numbers = [];
    stageEl.innerHTML = '<p class="loading">読み込み中…</p>';
    strokeCountEl.textContent = "";
    try {
      const svgText = await fetchKvgSvg(char);
      if (token !== loadToken) return; // 別の文字が選択済みなら古い結果は無視
      const parsed = parseKvgSvg(svgText);
      buildStage(parsed);
      applyCurrentMode();
    } catch (err) {
      if (token !== loadToken) return;
      strokes = [];
      numbers = [];
      stageEl.innerHTML = "";
      strokeCountEl.textContent = "";
      showMessage(`「${char}」の書き順データが見つかりませんでした。`);
    }
  }

  function renderCharTabs(chars) {
    charTabsEl.innerHTML = "";
    if (chars.length <= 1) {
      charTabsEl.hidden = true;
      return;
    }
    charTabsEl.hidden = false;
    chars.forEach((char, i) => {
      const btn = document.createElement("button");
      btn.className = "char-tab" + (i === 0 ? " active" : "");
      btn.textContent = char;
      btn.addEventListener("click", () => {
        charTabsEl.querySelectorAll(".char-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadChar(char);
      });
      charTabsEl.appendChild(btn);
    });
  }

  function handleSearch() {
    const raw = inputEl.value.trim();
    if (!raw) {
      showMessage("漢字を入力してね。");
      return;
    }
    const chars = Array.from(new Set(Array.from(raw)));
    renderCharTabs(chars);
    loadChar(chars[0]);
  }

  searchBtn.addEventListener("click", handleSearch);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  modeStaticBtn.addEventListener("click", () => {
    if (mode === "static") return;
    mode = "static";
    modeStaticBtn.classList.add("active");
    modeStaticBtn.setAttribute("aria-selected", "true");
    modeAnimateBtn.classList.remove("active");
    modeAnimateBtn.setAttribute("aria-selected", "false");
    applyCurrentMode();
  });

  modeAnimateBtn.addEventListener("click", () => {
    if (mode === "animate") return;
    mode = "animate";
    modeAnimateBtn.classList.add("active");
    modeAnimateBtn.setAttribute("aria-selected", "true");
    modeStaticBtn.classList.remove("active");
    modeStaticBtn.setAttribute("aria-selected", "false");
    applyCurrentMode();
  });

  btnRestart.addEventListener("click", () => {
    resetForAnimation();
  });

  btnPrev.addEventListener("click", () => {
    stopPlaying();
    stepBackward();
  });

  btnNext.addEventListener("click", () => {
    stopPlaying();
    stepForward();
  });

  btnPlayPause.addEventListener("click", () => {
    if (playing) {
      stopPlaying();
    } else {
      playFromCurrent();
    }
  });

  showNumbersCheck.addEventListener("change", () => {
    if (!showNumbersCheck.checked) return;
    for (let i = 0; i < currentIndex; i++) {
      if (numbers[i]) numbers[i].style.visibility = "visible";
    }
  });
})();
