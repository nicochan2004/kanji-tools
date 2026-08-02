// kuromoji.js(形態素解析)の辞書構築とtokenizeを別スレッドで行うWorker。
// 辞書構築(数MBのダウンロード+パース)はメインスレッドで行うとUIが固まって見えるため、
// この処理を完全にメインスレッドの外に出す。

// kuromoji.js(ブラウザ版)は内部でNode.jsのpath.joinのブラウザ実装を使って
// dicPath+ファイル名を結合しており、これがPOSIXパス正規化のため
// "https://cdn.jsdelivr.net/.../base.dat.gz" の "//" を "/" に1つ潰してしまう
// (結果: "https:/cdn.jsdelivr.net/.../base.dat.gz")。この壊れたURLは、ページの
// オリジンがhttpの場合はブラウザがたまたま正しく解決するが、httpsの場合は
// 現在のオリジン配下の相対パス("https://自分のオリジン/cdn.jsdelivr.net/...")として
// 誤解釈されて404になる(GitHub Pagesはhttpsなのでこの問題が起きる)。
// kuromoji.js自体は直せないため、内部が使うXMLHttpRequestをラップし、
// open()に渡される直前でスキーム直後の欠けたスラッシュを補う。
const OriginalXHR = XMLHttpRequest;
XMLHttpRequest = function () {
  const xhr = new OriginalXHR();
  const originalOpen = xhr.open.bind(xhr);
  xhr.open = function (method, url, ...rest) {
    if (typeof url === "string") {
      url = url.replace(/^(https?):\/(?!\/)/, "$1://");
    }
    return originalOpen(method, url, ...rest);
  };
  return xhr;
};

importScripts("https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js");

let tokenizerPromise = null;
function loadTokenizer() {
  if (tokenizerPromise) return tokenizerPromise;
  tokenizerPromise = new Promise((resolve) => {
    kuromoji.builder({ dicPath: "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/" }).build((err, tokenizer) => {
      if (err) { resolve(null); return; }
      resolve(tokenizer);
    });
  });
  return tokenizerPromise;
}

// Worker起動と同時に先読みしておく(メインスレッドには影響しない)。
loadTokenizer();

// 単語まるごとの表層形と読みを形態素単位で返す。1文字ずつ個別に読みを引くと、
// 「興味」の「味」だけを見て「あじ」と誤読するようなことが起きるため、
// 呼び出し側で「まとまり」ごとまとめてtokenizeし、形態素の単位で読みを対応づける。
self.onmessage = async (e) => {
  const { id, text } = e.data;
  const tokenizer = await loadTokenizer();
  let tokens = [];
  if (tokenizer) {
    try {
      tokens = tokenizer.tokenize(text).map((t) => ({ surface: t.surface_form, reading: t.reading || "" }));
    } catch (err) {
      tokens = [];
    }
  }
  self.postMessage({ id, tokens });
};
