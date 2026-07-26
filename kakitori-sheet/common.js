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

  // 漢字→読み(カタカナ)の自動推定。kuromoji.js(形態素解析)をCDNから遅延ロードする。
  // 辞書ダウンロードに時間がかかるため、初回呼び出し時にPromiseをキャッシュして使い回す。
  // あくまで手入力の手間を減らすための下書き用途で、精度の保証はしない(呼び出し側で修正可能にする)。
  let tokenizerPromise = null;
  function loadTokenizer() {
    if (tokenizerPromise) return tokenizerPromise;
    tokenizerPromise = new Promise((resolve) => {
      if (typeof kuromoji === "undefined") { resolve(null); return; }
      kuromoji.builder({ dicPath: "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/" }).build((err, tokenizer) => {
        if (err) { console.error("kuromoji load failed", err); resolve(null); return; }
        resolve(tokenizer);
      });
    });
    return tokenizerPromise;
  }

  async function guessReading(text) {
    const tokenizer = await loadTokenizer();
    if (!tokenizer) return "";
    try {
      const tokens = tokenizer.tokenize(text);
      if (tokens.length === 0) return "";
      return tokens[0].reading || "";
    } catch (e) {
      return "";
    }
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
    guessReading,
    circledNumber,
    fitPageToOnePage,
    fitAllPages,
    PAGE_CONFIG,
    buildPdfDoc,
    savePdf,
    initTabs,
  };
})();
