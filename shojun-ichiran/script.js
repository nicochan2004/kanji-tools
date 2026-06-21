(() => {
  const KVG_BASE = "https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg/kanji/";
  const SVG_NS = "http://www.w3.org/2000/svg";

  const textInput = document.getElementById("textInput");
  const searchBtn = document.getElementById("searchBtn");
  const messageEl = document.getElementById("message");
  const resultGridEl = document.getElementById("resultGrid");

  const svgCache = new Map();

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
    textEls.sort((a, b) => Number(a.textContent) - Number(b.textContent));

    const viewBox = sourceSvg.getAttribute("viewBox") || "0 0 109 109";
    return { pathEls, textEls, viewBox };
  }

  function buildStaticSvg({ pathEls, textEls, viewBox }) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", viewBox);

    const pathLayer = document.createElementNS(SVG_NS, "g");
    pathEls.forEach((p) => {
      const clone = document.createElementNS(SVG_NS, "path");
      clone.setAttribute("d", p.getAttribute("d"));
      clone.classList.add("stroke-path");
      pathLayer.appendChild(clone);
    });

    const numberLayer = document.createElementNS(SVG_NS, "g");
    textEls.forEach((t) => {
      const clone = document.createElementNS(SVG_NS, "text");
      clone.setAttribute("transform", t.getAttribute("transform"));
      clone.classList.add("stroke-number");
      clone.textContent = t.textContent;
      numberLayer.appendChild(clone);
    });

    svg.appendChild(pathLayer);
    svg.appendChild(numberLayer);
    return svg;
  }

  function createCard(char) {
    const card = document.createElement("div");
    card.className = "kanji-card";

    const stage = document.createElement("div");
    stage.className = "kanji-card-stage";
    stage.innerHTML = '<span class="loading">読込中…</span>';

    const label = document.createElement("p");
    label.className = "kanji-card-label";
    label.innerHTML = `<strong>${char}</strong>`;

    card.appendChild(stage);
    card.appendChild(label);
    return { card, stage, label };
  }

  async function loadCharIntoCard(char, { card, stage, label }) {
    try {
      const svgText = await fetchKvgSvg(char);
      const parsed = parseKvgSvg(svgText);
      const svg = buildStaticSvg(parsed);
      stage.innerHTML = "";
      stage.appendChild(svg);
      label.innerHTML = `<strong>${char}</strong>（全${parsed.pathEls.length}画）`;
    } catch (err) {
      card.classList.add("error");
      stage.innerHTML = '<span class="error-mark">？</span>';
      label.innerHTML = `<strong>${char}</strong>（見つかりません）`;
    }
  }

  function handleSearch() {
    const raw = textInput.value.trim();
    resultGridEl.innerHTML = "";
    if (!raw) {
      showMessage("漢字や言葉を入力してね。");
      return;
    }
    showMessage("");

    const chars = Array.from(new Set(Array.from(raw))).filter((c) => !/\s/.test(c));
    if (!chars.length) {
      showMessage("漢字や言葉を入力してね。");
      return;
    }

    chars.forEach((char) => {
      const parts = createCard(char);
      resultGridEl.appendChild(parts.card);
      loadCharIntoCard(char, parts);
    });
  }

  searchBtn.addEventListener("click", handleSearch);
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
})();
