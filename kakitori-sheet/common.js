// 共通基盤: KanjiVGストローク取得/描画、PDF生成・印刷、1ページ収め、丸数字、タブ切替。
// renshu-sheet/script.js のロジックをほぼそのまま移植し、ページ向き(縦/横)を引数化して汎用化している。
(() => {
  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";
  const kvgCache = new Map(); // char -> Promise<{viewBox, paths:[d...], numbers:[{transform,label}]} | null>

  function charToHex(ch) {
    return ch.codePointAt(0).toString(16).padStart(5, "0");
  }

  function isKanji(ch) {
    return /[一-鿿㐀-䶿]/.test(ch);
  }

  function isHiragana(ch) {
    return /[぀-ゟ]/.test(ch);
  }

  // Promise自体を同期的にすぐキャッシュすることで、同じ文字への短時間の重複fetchを防ぐ
  // (renshu-sheetで、重複fetchのどちらかが原因不明に失敗する問題があったための対策を踏襲)。
  function fetchKvg(ch) {
    if (kvgCache.has(ch)) return kvgCache.get(ch);
    const promise = (async () => {
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
        return { viewBox, paths, numbers };
      } catch (e) {
        return null; // 取得失敗時はプレーンな文字表示のまま(呼び出し側でフォールバック)
      }
    })();
    kvgCache.set(ch, promise);
    return promise;
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

  // 文字1つを「うすいグレーの手本」としてcontainerへ描画する。KVG取得成功時はストローク、
  // 失敗時はプレーンテキスト(masu-char)のままにする。呼び出し側はcontainer内に
  // 先にmasu-char(プレーンテキスト)を用意しておくこと。
  function renderModelChar(container, ch, opts) {
    const small = !!(opts && opts.small);
    const showNumbers = isKanji(ch);
    fetchKvg(ch).then((data) => {
      if (!data) return;
      const charEl = container.querySelector(".masu-char");
      if (charEl) charEl.remove();
      const wrap = document.createElement("div");
      wrap.className = "masu-stroke" + (small ? " masu-stroke-small" : "");
      wrap.appendChild(buildStrokeSvg(data, showNumbers));
      container.appendChild(wrap);
    });
  }

  // 漢字→読み(カタカナ)の自動推定。kuromoji.js(形態素解析)の辞書構築・実行は重い同期処理で、
  // メインスレッドで行うとページが固まって見えるため、専用のWeb Workerに完全に切り出す。
  // あくまで手入力の手間を減らすための下書き用途で、精度の保証はしない(呼び出し側で修正可能にする)。
  let worker = null;
  let nextRequestId = 1;
  const pendingRequests = new Map();

  function getWorker() {
    if (worker) return worker;
    worker = new Worker("kuromoji-worker.js");
    worker.onmessage = (e) => {
      const { id, tokens } = e.data;
      const resolve = pendingRequests.get(id);
      if (resolve) {
        resolve(tokens || []);
        pendingRequests.delete(id);
      }
    };
    worker.onerror = () => {
      pendingRequests.forEach((resolve) => resolve([]));
      pendingRequests.clear();
    };
    return worker;
  }

  // textをまとめて形態素解析し、[{surface, reading}, ...] を返す。
  // 1文字ずつ個別に引くと単語としての文脈を失う(「興味」の「味」だけを見ると
  // 「あじ」になる等)ため、呼び出し側は意味のあるまとまり単位でこれを呼ぶこと。
  function guessReadingTokens(text) {
    return new Promise((resolve) => {
      try {
        const w = getWorker();
        const id = nextRequestId++;
        pendingRequests.set(id, resolve);
        w.postMessage({ id, text });
      } catch (e) {
        resolve([]);
      }
    });
  }

  // カタカナの読みを「モーラ(拍)」単位に分割する。拗音(ゃゅょ等)や長音(ー)は
  // 直前のモーラにくっつける(例: "キョウミ" → ["キョ","ウ","ミ"])。
  const SMALL_KANA = new Set(["ァ", "ィ", "ゥ", "ェ", "ォ", "ャ", "ュ", "ョ", "ヮ", "ぁ", "ぃ", "ぅ", "ぇ", "ぉ", "ゃ", "ゅ", "ょ", "ゎ"]);
  function splitMorae(text) {
    const chars = Array.from(text || "");
    const morae = [];
    chars.forEach((ch) => {
      if ((ch === "ー" || SMALL_KANA.has(ch)) && morae.length > 0) {
        morae[morae.length - 1] += ch;
      } else {
        morae.push(ch);
      }
    });
    return morae;
  }

  // 与えられたモーラ列を、weights(各文字のおおよその音の長さ)の比率でN個に分配する。
  // 例: モーラ["キョ","ウ","ミ"](3), weights=[2,2] → ["キョウ","ミ"]
  function distributeMorae(morae, weights) {
    const n = weights.length;
    const totalWeight = weights.reduce((a, b) => a + b, 0) || n;
    const counts = weights.map((w) => Math.max(1, Math.round((w / totalWeight) * morae.length)));
    let diff = morae.length - counts.reduce((a, b) => a + b, 0);
    let idx = n - 1;
    while (diff !== 0 && idx >= 0) {
      if (diff > 0) {
        counts[idx] += 1;
        diff -= 1;
      } else if (counts[idx] > 1) {
        counts[idx] -= 1;
        diff += 1;
      } else {
        idx -= 1;
      }
    }
    const result = [];
    let pos = 0;
    counts.forEach((c) => {
      result.push(morae.slice(pos, pos + c).join(""));
      pos += c;
    });
    return result;
  }

  // 各文字を単独でtokenizeした際の読みのモーラ数を、その文字のおおよその
  // 「音の長さ」の目安として使う(読みの中身自体は不正確な場合があっても、
  // 長さはそれなりに参考になることが多い)。単独では未知語になり読みが
  // 取れない文字(「捨」等)は、他の文字の平均モーラ数で補う。
  async function guessMoraCountsForChars(chars) {
    const raw = [];
    for (const ch of chars) {
      const tokens = await guessReadingTokens(ch);
      const reading = tokens.length > 0 ? tokens[0].reading || "" : "";
      const count = splitMorae(reading).length;
      raw.push(count > 0 ? count : null);
    }
    const known = raw.filter((c) => c !== null);
    const avg = known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) / known.length) : 1;
    return raw.map((c) => (c !== null ? c : Math.max(1, avg)));
  }

  // 文字配列(1単語ぶん)を受け取り、各文字位置に対応する読みの配列を返す。
  // ひらがな(送り仮名)はそのまま、それ以外は「連続する非ひらがなのまとまり」ごとに
  // まとめてtokenizeする(1文字ずつ個別に引くと「興味」の「味」だけを見て
  // 「あじ」と誤読するため)。形態素の文字数と読みの文字数が一致すれば1文字ずつ、
  // 一致しなければ(「興味→キョウミ」のように)モーラ単位で各文字の音の長さの
  // 比率に応じて分配する(「興→キョウ」「味→ミ」のように)。
  async function guessReadingsForChars(chars) {
    const readings = new Array(chars.length).fill("");
    let i = 0;
    while (i < chars.length) {
      if (isHiragana(chars[i])) {
        readings[i] = chars[i];
        i += 1;
        continue;
      }
      let j = i;
      while (j < chars.length && !isHiragana(chars[j])) j += 1;
      const runChars = chars.slice(i, j);
      const runText = runChars.join("");
      const tokens = await guessReadingTokens(runText);
      let offset = i;
      for (const t of tokens) {
        const segChars = Array.from(t.surface || "");
        const segReadingChars = Array.from(t.reading || "");
        if (segChars.length === 0) {
          continue;
        } else if (segChars.length === 1 || segChars.length === segReadingChars.length) {
          segChars.forEach((ch, k) => { readings[offset + k] = segReadingChars[k] || ""; });
        } else {
          const morae = splitMorae(t.reading || "");
          const weights = await guessMoraCountsForChars(segChars);
          const parts = distributeMorae(morae, weights);
          parts.forEach((p, k) => { readings[offset + k] = p; });
        }
        offset += segChars.length;
      }
      i = j;
    }
    return readings;
  }

  // 読み入力欄は「興味→キョウミ」のような複数文字の読みが1つの欄に入ることがあるため、
  // 内容に応じて幅を伸ばす。文字数の概算ではなく、実際のフォントでの描画幅を
  // canvasで計測して決める(全角カタカナの文字幅は概算だと誤差が出て見切れやすいため)。
  // 最小幅は既存のデザインに合わせて64pxのまま。
  let measureCanvas = null;
  function autoSizeYomiInput(inp) {
    const text = inp.value || inp.placeholder || "";
    if (!measureCanvas) measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    const cs = getComputedStyle(inp);
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const textWidth = ctx.measureText(text).width;
    inp.style.width = Math.max(64, Math.ceil(textWidth) + 28) + "px";
  }

  function circledNumber(n) {
    if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1); // ①..⑳
    return `(${n})`;
  }

  // 用紙の印刷可能領域はプリンタ環境によってA4の規定サイズより狭くなることがあるため、
  // 実際のコンテンツ高さを測って収まらない場合のみ zoom で縮小し、必ず1ページに収める。
  function fitPageToOnePage(pageEl) {
    const inner = pageEl.querySelector(".page-inner");
    if (!inner) return;
    inner.style.zoom = 1;
    const cs = getComputedStyle(pageEl);
    const paddingV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const SAFETY_RATIO = 0.95;
    const availableHeight = (pageEl.clientHeight - paddingV) * SAFETY_RATIO;
    const availableWidth = (pageEl.clientWidth - paddingH) * SAFETY_RATIO;
    const innerHeight = inner.scrollHeight;
    const innerWidth = inner.scrollWidth;
    const scaleH = innerHeight > availableHeight && availableHeight > 0 ? availableHeight / innerHeight : 1;
    const scaleW = innerWidth > availableWidth && availableWidth > 0 ? availableWidth / innerWidth : 1;
    const scale = Math.min(scaleH, scaleW);
    if (scale < 1) inner.style.zoom = scale;
  }

  function fitAllPages(previewEl) {
    previewEl.querySelectorAll(".sheet-page").forEach(fitPageToOnePage);
  }

  // A4ぴったりのサイズだとSafariが@page margin:0を完全に尊重せず、内容量に関係なく
  // 用紙からあふれて2ページ目(ほぼ白紙)が生成されることがあるため、十分小さいサイズにする
  // (renshu-sheetで縦向きは実機検証済み。横向きの値は本アプリで新規に用意したもので、
  //  実機Safariでの確認がまだのため要注意)。
  const PAGE_CONFIG = {
    portrait: { orientation: "portrait", pdfW: 210, pdfH: 297, sheetW: 20.5, sheetH: 27.5 },
    landscape: { orientation: "landscape", pdfW: 297, pdfH: 210, sheetW: 28.5, sheetH: 19.5 },
  };

  async function buildPdfDoc(previewEl, pageConfig) {
    const pages = previewEl.querySelectorAll(".sheet-page");
    if (pages.length === 0) return null;
    fitAllPages(previewEl);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: pageConfig.orientation });
    const offsetX = (pageConfig.pdfW - pageConfig.sheetW) / 2;
    const offsetY = (pageConfig.pdfH - pageConfig.sheetH) / 2;
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", offsetX, offsetY, pageConfig.sheetW, pageConfig.sheetH);
    }
    return pdf;
  }

  // PDF生成後にwindow.open()を呼ぶと、iOS Safariは非同期処理を挟んだ後のwindow.open()を
  // ユーザー操作起因と認識せずブロックすることがあるため、クリック直後に空タブを同期的に開いておき、
  // PDFが出来上がってからそのタブのlocationを差し替える。
  async function savePdf(previewEl, pageConfig, filename, pdfBtn) {
    if (previewEl.querySelectorAll(".sheet-page").length === 0) {
      alert("内容を入力してください。");
      return;
    }
    const win = window.open("", "_blank");
    if (win) {
      win.document.write("<title>漢字書き取りドリル</title><p style='font-family:sans-serif;padding:20px;color:#666;'>PDFを生成中です…</p>");
    }
    const originalLabel = pdfBtn.textContent;
    pdfBtn.disabled = true;
    pdfBtn.textContent = "準備中...";
    try {
      const pdf = await buildPdfDoc(previewEl, pageConfig);
      const url = URL.createObjectURL(pdf.output("blob"));
      if (win) {
        win.location.href = url;
      } else {
        pdf.save(filename);
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      if (win) win.close();
      fitAllPages(previewEl);
      window.print();
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.textContent = originalLabel;
    }
  }

  // タブ切替: 3パターン分のinput-areaを常にDOMに保持したままhiddenで表示切替し、
  // #previewは1つを共有して切替のたびに現在パターンのrender()を呼び直す。
  function initTabs(patterns, previewEl, pageSizeStyleEl) {
    let current = patterns[0].key;

    function applyPageSizeRule() {
      const cfg = patterns.find((p) => p.key === current).pageConfig;
      pageSizeStyleEl.textContent = `@page { size: A4 ${cfg.orientation}; margin: 0; }`;
    }

    function switchTo(key) {
      current = key;
      patterns.forEach((p) => {
        p.tabBtn.classList.toggle("active", p.key === key);
        p.inputAreaEl.hidden = p.key !== key;
      });
      applyPageSizeRule();
      previewEl.innerHTML = "";
      patterns.find((p) => p.key === key).render();
    }

    patterns.forEach((p) => {
      p.tabBtn.addEventListener("click", () => switchTo(p.key));
    });

    applyPageSizeRule();
    return { switchTo, getCurrent: () => patterns.find((p) => p.key === current) };
  }

  window.KD = {
    isKanji,
    isHiragana,
    fetchKvg,
    buildStrokeSvg,
    renderModelChar,
    guessReadingTokens,
    guessReadingsForChars,
    autoSizeYomiInput,
    circledNumber,
    fitPageToOnePage,
    fitAllPages,
    PAGE_CONFIG,
    buildPdfDoc,
    savePdf,
    initTabs,
  };

  // Workerを早めに起動しておき、実際にユーザーが入力を始める頃には
  // 辞書構築(Worker内、メインスレッドとは無関係)が終わっている可能性を高める。
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
  idle(() => { getWorker(); });
})();
