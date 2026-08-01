// kuromoji.js(形態素解析)の辞書構築とtokenizeを別スレッドで行うWorker。
// 辞書構築(数MBのダウンロード+パース)はメインスレッドで行うとUIが固まって見えるため、
// この処理を完全にメインスレッドの外に出す。
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

self.onmessage = async (e) => {
  const { id, text } = e.data;
  const tokenizer = await loadTokenizer();
  let reading = "";
  if (tokenizer) {
    try {
      const tokens = tokenizer.tokenize(text);
      if (tokens.length > 0) reading = tokens[0].reading || "";
    } catch (err) {
      reading = "";
    }
  }
  self.postMessage({ id, reading });
};
