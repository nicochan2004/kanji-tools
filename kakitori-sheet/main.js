// エントリーポイント: 3パターンのinit()呼び出し、タブ切替、共通の印刷/消去ボタンの配線。
(() => {
  const previewEl = document.getElementById("preview");
  const pdfBtn = document.getElementById("pdfBtn");
  const clearBtn = document.getElementById("clearBtn");
  const pageSizeStyleEl = document.getElementById("pageSizeRule");

  const modules = { 1: window.KD_pattern1, 2: window.KD_pattern2, 3: window.KD_pattern3 };
  const p1CopyToP2Btn = document.getElementById("p1CopyToP2Btn");
  const p2CopyToP1Btn = document.getElementById("p2CopyToP1Btn");

  let tabs = null;
  function makeOnChange(key, renderFn) {
    return () => {
      if (tabs && tabs.getCurrent().key === key) renderFn();
    };
  }

  modules[1].init(previewEl, makeOnChange("1", modules[1].render));
  modules[2].init(previewEl, makeOnChange("2", modules[2].render));
  modules[3].init(previewEl, makeOnChange("3", modules[3].render));

  const patterns = [1, 2, 3].map((n) => ({
    key: modules[n].key,
    tabBtn: document.querySelector(`.tab-btn[data-pattern="${n}"]`),
    inputAreaEl: document.getElementById(`pattern${n}Area`),
    render: modules[n].render,
    pageConfig: modules[n].pageConfig(),
  }));

  tabs = KD.initTabs(patterns, previewEl, pageSizeStyleEl);
  tabs.switchTo(patterns[0].key);

  pdfBtn.addEventListener("click", () => {
    const cur = tabs.getCurrent();
    const mod = modules[Number(cur.key)];
    KD.savePdf(previewEl, cur.pageConfig, mod.filename(), pdfBtn);
  });

  clearBtn.addEventListener("click", () => {
    const cur = tabs.getCurrent();
    const mod = modules[Number(cur.key)];
    mod.clear();
    mod.render();
  });

  // ①②は単語の入力欄が全く同じ構造(漢字+読み)なので、片方で打ったデータを
  // もう片方にそのまま流し込めるようにする。コピー先の既存内容は上書きされるため確認する。
  function copyWords(fromMod, toMod, toTabKey) {
    const words = fromMod.getWords();
    if (words.length === 0) {
      alert("コピーする内容がありません。");
      return;
    }
    if (!confirm("コピー先の内容は上書きされます。よろしいですか？")) return;
    toMod.setWords(words);
    tabs.switchTo(toTabKey);
  }

  p1CopyToP2Btn.addEventListener("click", () => copyWords(modules[1], modules[2], modules[2].key));
  p2CopyToP1Btn.addEventListener("click", () => copyWords(modules[2], modules[1], modules[1].key));
})();
