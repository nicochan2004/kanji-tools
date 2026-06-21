(() => {
  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";
  const SAMPLE_N = 12; // 1画あたりの比較用サンプリング点数

  // 始点・終点の許容距離(viewBox幅に対する比率)、形のズレ許容(同様)、方向ズレ許容(度)、
  // なぞった線の長さが本来の画の長さに対して最低どれだけ必要か
  const STRICTNESS_PRESETS = {
    loose: { startEnd: 0.30, shape: 0.26, angleDeg: 75, minLenRatio: 0.25 },
    normal: { startEnd: 0.20, shape: 0.17, angleDeg: 55, minLenRatio: 0.35 },
    strict: { startEnd: 0.14, shape: 0.12, angleDeg: 38, minLenRatio: 0.5 },
  };

  const FEEDBACK_MESSAGES = {
    too_short: "もう少し長くなぞってみよう",
    direction: "方向がちがうよ。よく見てなぞってみよう",
    start: "書きはじめの位置がちがうよ",
    end: "書き終わりの位置がちがうよ",
    shape: "形がちがうかも。お手本をよく見てね",
    default: "ここがちがうよ。もう一度なぞってみよう",
  };

  // ===== DOM参照 =====
  const screenSetup = document.getElementById("screenSetup");
  const screenQuiz = document.getElementById("screenQuiz");
  const screenResult = document.getElementById("screenResult");

  const kanjiListInput = document.getElementById("kanjiListInput");
  const startBtn = document.getElementById("startBtn");
  const setupMessageEl = document.getElementById("setupMessage");
  const strictnessBtns = Array.from(document.querySelectorAll(".strictness-btn"));

  const quitBtn = document.getElementById("quitBtn");
  const resetCharBtn = document.getElementById("resetCharBtn");
  const quizProgressTextEl = document.getElementById("quizProgressText");
  const quizProgressFillEl = document.getElementById("quizProgressFill");
  const kanjiStageWrapEl = document.getElementById("kanjiStageWrap");
  const kanjiStageEl = document.getElementById("kanjiStage");
  const strokeInfoEl = document.getElementById("strokeInfo");
  const feedbackMessageEl = document.getElementById("feedbackMessage");

  const scoreNumberEl = document.getElementById("scoreNumber");
  const scoreSummaryTextEl = document.getElementById("scoreSummaryText");
  const resultListEl = document.getElementById("resultList");
  const retrySameBtn = document.getElementById("retrySameBtn");
  const backToSetupBtn = document.getElementById("backToSetupBtn");

  // ===== 状態 =====
  let strictnessLevel = "normal";
  let quizQueue = [];
  let quizIndex = 0;
  let results = [];

  let svgEl = null;
  let traceLayerEl = null;
  let templatePaths = [];
  let donePaths = [];
  let hintDotEl = null;
  let viewBoxSize = 109;
  let currentExpectedStrokes = [];
  let currentStrokeIndex = 0;
  let mistakesThisKanji = 0;
  let consecutiveMistakes = 0;
  let stageLocked = false;

  let activePointerId = null;
  let drawnPoints = [];
  let userTracePathEl = null;

  const svgCache = new Map();

  // ===== 画面切替 =====
  function showScreen(el) {
    [screenSetup, screenQuiz, screenResult].forEach((s) => {
      s.hidden = s !== el;
    });
  }

  // ===== 出題リスト入力画面 =====
  function parseKanjiList(raw) {
    const cleaned = raw.replace(/[\s,、。・/\\|]+/gu, "");
    return Array.from(cleaned);
  }

  function showSetupMessage(text) {
    setupMessageEl.textContent = text;
    setupMessageEl.hidden = !text;
  }

  strictnessBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      strictnessBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      strictnessLevel = btn.dataset.level;
    });
  });

  startBtn.addEventListener("click", () => {
    const list = parseKanjiList(kanjiListInput.value);
    if (list.length === 0) {
      showSetupMessage("漢字を1つ以上入力してね。");
      return;
    }
    quizQueue = list;
    quizIndex = 0;
    results = [];
    showSetupMessage("");
    showScreen(screenQuiz);
    loadQuizKanji();
  });

  // ===== KanjiVGデータ取得・解析 =====
  function charToHex(char) {
    return char.codePointAt(0).toString(16).padStart(5, "0");
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
    if (!pathGroup) throw new Error("parse-error");
    const pathEls = Array.from(pathGroup.querySelectorAll("path"));
    if (pathEls.length === 0) throw new Error("parse-error");
    const viewBox = sourceSvg.getAttribute("viewBox") || "0 0 109 109";
    return { pathEls, viewBox };
  }

  // ===== 出題ステージの構築 =====
  function buildStageSvg(pathEls, viewBox) {
    kanjiStageEl.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", viewBox);

    const templateLayer = document.createElementNS(ns, "g");
    const doneLayer = document.createElementNS(ns, "g");
    const hintLayer = document.createElementNS(ns, "g");
    const traceLayer = document.createElementNS(ns, "g");

    templatePaths = [];
    donePaths = [];

    pathEls.forEach((p) => {
      const tpl = document.createElementNS(ns, "path");
      tpl.setAttribute("d", p.getAttribute("d"));
      tpl.classList.add("stroke-path-template");
      templateLayer.appendChild(tpl);
      templatePaths.push(tpl);

      const done = document.createElementNS(ns, "path");
      done.setAttribute("d", p.getAttribute("d"));
      done.classList.add("stroke-path-done");
      doneLayer.appendChild(done);
      donePaths.push(done);
    });

    const hintDot = document.createElementNS(ns, "circle");
    hintDot.setAttribute("r", "4");
    hintDot.classList.add("hint-dot");
    hintLayer.appendChild(hintDot);
    hintDotEl = hintDot;

    svg.appendChild(templateLayer);
    svg.appendChild(doneLayer);
    svg.appendChild(hintLayer);
    svg.appendChild(traceLayer);
    kanjiStageEl.appendChild(svg);

    svgEl = svg;
    traceLayerEl = traceLayer;

    const parts = viewBox.trim().split(/\s+/).map(Number);
    viewBoxSize = parts[2] || 109;

    // getPointAtLengthはDOM接続後でないと環境によって不安定なため、接続後にサンプリングする
    currentExpectedStrokes = templatePaths.map((tpl) => {
      const length = tpl.getTotalLength();
      const points = [];
      for (let i = 0; i < SAMPLE_N; i++) {
        const d = (i / (SAMPLE_N - 1)) * length;
        const pt = tpl.getPointAtLength(d);
        points.push({ x: pt.x, y: pt.y });
      }
      return { points, length };
    });
  }

  // ===== 座標変換・サンプリング =====
  function clientToSvgPoint(svg, clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function totalLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return len;
  }

  function sampleAlongPolyline(points, n) {
    if (points.length === 1) return new Array(n).fill(points[0]);
    const cum = [0];
    for (let i = 1; i < points.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    const total = cum[cum.length - 1];
    if (total === 0) return new Array(n).fill(points[0]);
    const result = [];
    for (let s = 0; s < n; s++) {
      const target = (s / (n - 1)) * total;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const segStart = cum[i - 1];
      const segEnd = cum[i];
      const t = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
      const p0 = points[i - 1];
      const p1 = points[i];
      result.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
    return result;
  }

  // ===== 書き順・形の判定 =====
  function judgeStroke(expected, drawn, levelConf) {
    if (drawn.length < 2) return { ok: false, reason: "too_short" };

    const drawnLen = totalLength(drawn);
    if (drawnLen < (expected.length || 1) * levelConf.minLenRatio) {
      return { ok: false, reason: "too_short" };
    }

    const sampledDrawn = sampleAlongPolyline(drawn, SAMPLE_N);
    const sampledExpected = expected.points;

    const tolStartEnd = viewBoxSize * levelConf.startEnd;
    const tolShape = viewBoxSize * levelConf.shape;

    const startDist = Math.hypot(
      sampledDrawn[0].x - sampledExpected[0].x,
      sampledDrawn[0].y - sampledExpected[0].y
    );
    const endDist = Math.hypot(
      sampledDrawn[SAMPLE_N - 1].x - sampledExpected[SAMPLE_N - 1].x,
      sampledDrawn[SAMPLE_N - 1].y - sampledExpected[SAMPLE_N - 1].y
    );

    const expVec = {
      x: sampledExpected[SAMPLE_N - 1].x - sampledExpected[0].x,
      y: sampledExpected[SAMPLE_N - 1].y - sampledExpected[0].y,
    };
    const drawnVec = {
      x: sampledDrawn[SAMPLE_N - 1].x - sampledDrawn[0].x,
      y: sampledDrawn[SAMPLE_N - 1].y - sampledDrawn[0].y,
    };
    const expVecLen = Math.hypot(expVec.x, expVec.y);
    const drawnVecLen = Math.hypot(drawnVec.x, drawnVec.y);

    let angleDiffDeg = 0;
    // 点(チョン)のような短い画は方向ベクトルが不安定なので方向チェックを免除する
    if (expVecLen > viewBoxSize * 0.05 && drawnVecLen > viewBoxSize * 0.05) {
      const dot = (expVec.x * drawnVec.x + expVec.y * drawnVec.y) / (expVecLen * drawnVecLen);
      angleDiffDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
    }

    let sumDist = 0;
    for (let i = 0; i < SAMPLE_N; i++) {
      sumDist += Math.hypot(
        sampledDrawn[i].x - sampledExpected[i].x,
        sampledDrawn[i].y - sampledExpected[i].y
      );
    }
    const avgDist = sumDist / SAMPLE_N;

    if (angleDiffDeg > levelConf.angleDeg) return { ok: false, reason: "direction" };
    if (startDist > tolStartEnd) return { ok: false, reason: "start" };
    if (endDist > tolStartEnd) return { ok: false, reason: "end" };
    if (avgDist > tolShape) return { ok: false, reason: "shape" };
    return { ok: true };
  }

  // ===== なぞり操作 =====
  function updateTracePathD() {
    if (!userTracePathEl || drawnPoints.length === 0) return;
    const d = drawnPoints
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");
    userTracePathEl.setAttribute("d", d);
  }

  function onPointerDown(e) {
    if (stageLocked || activePointerId !== null || !svgEl) return;
    if (currentStrokeIndex >= currentExpectedStrokes.length) return;
    activePointerId = e.pointerId;
    drawnPoints = [clientToSvgPoint(svgEl, e.clientX, e.clientY)];

    const ns = "http://www.w3.org/2000/svg";
    userTracePathEl = document.createElementNS(ns, "path");
    userTracePathEl.classList.add("user-trace-path");
    traceLayerEl.appendChild(userTracePathEl);
    updateTracePathD();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointerId) return;
    drawnPoints.push(clientToSvgPoint(svgEl, e.clientX, e.clientY));
    updateTracePathD();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    finalizeStroke();
    e.preventDefault();
  }

  function onPointerCancel(e) {
    if (e.pointerId !== activePointerId) return;
    activePointerId = null;
    if (userTracePathEl) {
      userTracePathEl.remove();
      userTracePathEl = null;
    }
    drawnPoints = [];
  }

  kanjiStageWrapEl.addEventListener("pointerdown", onPointerDown);
  kanjiStageWrapEl.addEventListener("pointermove", onPointerMove);
  kanjiStageWrapEl.addEventListener("pointerup", onPointerUp);
  kanjiStageWrapEl.addEventListener("pointercancel", onPointerCancel);

  function showFeedback(text, success) {
    feedbackMessageEl.textContent = text;
    feedbackMessageEl.classList.toggle("success", !!success);
  }

  function showHint(expected) {
    if (!hintDotEl) return;
    const start = expected.points[0];
    hintDotEl.setAttribute("cx", start.x);
    hintDotEl.setAttribute("cy", start.y);
    hintDotEl.classList.add("show");
  }

  function hideHint() {
    if (hintDotEl) hintDotEl.classList.remove("show");
  }

  function flashWrong() {
    const pathToRemove = userTracePathEl;
    if (pathToRemove) pathToRemove.classList.add("wrong");
    userTracePathEl = null;

    kanjiStageEl.classList.remove("shake");
    requestAnimationFrame(() => kanjiStageEl.classList.add("shake"));
    setTimeout(() => {
      if (pathToRemove) pathToRemove.remove();
      kanjiStageEl.classList.remove("shake");
    }, 650);
  }

  function markStrokeDone(idx) {
    const donePath = donePaths[idx];
    if (donePath) donePath.classList.add("show");
  }

  function updateStrokeInfo() {
    const total = currentExpectedStrokes.length;
    const done = Math.min(currentStrokeIndex, total);
    strokeInfoEl.textContent = `${done} / ${total} 画`;
  }

  function finalizeStroke() {
    const expected = currentExpectedStrokes[currentStrokeIndex];
    const conf = STRICTNESS_PRESETS[strictnessLevel];
    const judgment = judgeStroke(expected, drawnPoints, conf);

    if (judgment.ok) {
      consecutiveMistakes = 0;
      hideHint();
      if (userTracePathEl) {
        userTracePathEl.remove();
        userTracePathEl = null;
      }
      showFeedback("", false);
      markStrokeDone(currentStrokeIndex);
      currentStrokeIndex += 1;
      drawnPoints = [];
      updateStrokeInfo();
      if (currentStrokeIndex >= currentExpectedStrokes.length) {
        onKanjiComplete();
      }
    } else {
      mistakesThisKanji += 1;
      consecutiveMistakes += 1;
      showFeedback(FEEDBACK_MESSAGES[judgment.reason] || FEEDBACK_MESSAGES.default, false);
      flashWrong();
      if (consecutiveMistakes >= 3) {
        showHint(expected);
      }
      drawnPoints = [];
    }
  }

  function resetCurrentKanji() {
    if (!currentExpectedStrokes.length || stageLocked) return;
    currentStrokeIndex = 0;
    consecutiveMistakes = 0;
    hideHint();
    showFeedback("", false);
    donePaths.forEach((p) => p.classList.remove("show"));
    if (userTracePathEl) {
      userTracePathEl.remove();
      userTracePathEl = null;
    }
    drawnPoints = [];
    updateStrokeInfo();
  }

  resetCharBtn.addEventListener("click", resetCurrentKanji);

  quitBtn.addEventListener("click", () => {
    if (window.confirm("出題をやめて、リスト編集画面にもどりますか？\n（これまでの進行状況は失われます）")) {
      showScreen(screenSetup);
    }
  });

  // ===== 出題の進行 =====
  function updateProgressHeader() {
    quizProgressTextEl.textContent = `${quizIndex + 1} / ${quizQueue.length} 問目`;
    quizProgressFillEl.style.width = `${(quizIndex / quizQueue.length) * 100}%`;
  }

  function advanceQueue() {
    quizIndex += 1;
    if (quizIndex >= quizQueue.length) {
      showResultScreen();
    } else {
      loadQuizKanji();
    }
  }

  function onKanjiComplete() {
    stageLocked = true;
    results.push({ char: quizQueue[quizIndex], mistakes: mistakesThisKanji });
    showFeedback("よくできました！", true);
    setTimeout(advanceQueue, 900);
  }

  async function loadQuizKanji() {
    stageLocked = true;
    currentStrokeIndex = 0;
    mistakesThisKanji = 0;
    consecutiveMistakes = 0;
    drawnPoints = [];
    currentExpectedStrokes = [];
    hideHint();
    showFeedback("", false);
    updateProgressHeader();

    const char = quizQueue[quizIndex];
    kanjiStageEl.innerHTML = '<p class="loading">読み込み中…</p>';
    strokeInfoEl.textContent = "";

    try {
      const svgText = await fetchKvgSvg(char);
      const { pathEls, viewBox } = parseKvgSvg(svgText);
      buildStageSvg(pathEls, viewBox);
      updateStrokeInfo();
      stageLocked = false;
    } catch (err) {
      kanjiStageEl.innerHTML = "";
      strokeInfoEl.textContent = "";
      showFeedback(`「${char}」は書き順データが見つからなかったのでスキップしました。`, false);
      results.push({ char, mistakes: 0, skipped: true });
      setTimeout(advanceQueue, 1400);
    }
  }

  // ===== 採点結果画面 =====
  function showResultScreen() {
    showScreen(screenResult);
    const validResults = results.filter((r) => !r.skipped);
    const total = validResults.length;
    let scoreSum = 0;
    resultListEl.innerHTML = "";

    results.forEach((r) => {
      const li = document.createElement("li");
      if (r.skipped) {
        li.innerHTML =
          `<span class="result-mark">―</span>` +
          `<span class="result-char">${r.char}</span>` +
          `<span class="result-detail">書き順データが見つからずスキップ</span>`;
      } else {
        const perScore = Math.max(0, 100 - r.mistakes * 10);
        scoreSum += perScore;
        const mark = r.mistakes === 0 ? "◎" : r.mistakes <= 2 ? "○" : "△";
        const detail = r.mistakes === 0 ? "一発合格！" : `${r.mistakes}回まちがえて合格`;
        li.innerHTML =
          `<span class="result-mark">${mark}</span>` +
          `<span class="result-char">${r.char}</span>` +
          `<span class="result-detail">${detail}</span>`;
      }
      resultListEl.appendChild(li);
    });

    const finalScore = total > 0 ? Math.round(scoreSum / total) : 0;
    scoreNumberEl.textContent = String(finalScore);

    const perfectCount = validResults.filter((r) => r.mistakes === 0).length;
    scoreSummaryTextEl.textContent = `全${total}問中 ${perfectCount}問を一発で正解しました！`;
  }

  retrySameBtn.addEventListener("click", () => {
    quizIndex = 0;
    results = [];
    showScreen(screenQuiz);
    loadQuizKanji();
  });

  backToSetupBtn.addEventListener("click", () => {
    showScreen(screenSetup);
  });
})();
