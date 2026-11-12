/* 从 data/corpus.json 生成 data/corpus.js。
 * 上游语料是 workbuddy/demo/corpus.json；更新语料后按 README 里的三步重跑即可。
 * 运行：node competition/site/build-corpus.js
 */
"use strict";
var fs = require("fs");
var path = require("path");
var dir = path.join(__dirname, "data");
var data = JSON.parse(fs.readFileSync(path.join(dir, "corpus.json"), "utf8"));
var output =
  "/* 由 workbuddy/demo/corpus.json 原样生成，勿手改；构建命令见 README.md。\n" +
  " * 用 script 标签加载，避免 file:// 与跨域 fetch 限制。 */\n" +
  "(function (root, factory) {\n" +
  "  var data = factory();\n" +
  "  root.BUXUE_CORPUS = data;\n" +
  "  if (typeof module !== \"undefined\" && module.exports) module.exports = data;\n" +
  "})(typeof globalThis !== \"undefined\" ? globalThis : this, function () {\n" +
  "  return " + JSON.stringify(data, null, 2) + ";\n" +
  "});\n";
fs.writeFileSync(path.join(dir, "corpus.js"), output, "utf8");
console.log("corpus.js 已生成：" + data.sources.length + " 份来源 / " + data.queries.length + " 条评测用例");
