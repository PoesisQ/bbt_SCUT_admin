/* 浏览器端检索规则自检：与 scripts/evaluate_workbuddy.py 的固定用例对齐。
 * 运行：node competition/site/selfcheck.js
 */
"use strict";
var fs = require("fs");
var path = require("path");
var R = require("./retrieval.js");
var corpusScript = require("./data/corpus.js");
var corpusJson = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "corpus.json"), "utf-8"));

var failures = [];
if (JSON.stringify(corpusScript) !== JSON.stringify(corpusJson)) {
  failures.push("data/corpus.js 与 data/corpus.json 不一致，请重新生成包装文件");
}

var report = R.selfCheck(corpusJson);
console.log("=== 固定检索用例（12 条） ===");
report.rows.forEach(function (row) {
  console.log(
    (row.pass ? "PASS" : "FAIL") + "  " + row.id.padEnd(20) +
    " query=" + row.query.padEnd(20) +
    " expected=[" + row.expected.join(",") + "]" +
    " returned=[" + row.returned.join(",") + "]" +
    " R@3=" + (row.recall_at_3 === null ? "-" : row.recall_at_3.toFixed(3)) +
    " R@8=" + (row.recall_at_8 === null ? "-" : row.recall_at_8.toFixed(3))
  );
  if (!row.pass) failures.push("检索用例失败：" + row.id);
});
console.log("\n=== 引文核对 ===");
report.quotes.forEach(function (q) {
  console.log((q.pass ? "PASS" : "FAIL") + "  " + q.label.padEnd(8) + q.id.padEnd(20) + q.status.padEnd(18) + q.reason);
  if (!q.pass) failures.push("引文核对失败：" + q.label);
});

console.log("\n=== 自然问句与检索边界 ===");
[
  { query: "你可以做什么" },
  { query: "能不能帮我一下" },
  { query: "可以给一个参考吗" },
  { query: "请问可以解释一下信号量吗", expected: "cv:2" }
].forEach(function (test) {
  var result = R.retrieve(corpusJson, test.query, "", 8);
  var pass = test.expected
    ? result.items.some(function (item) { return item.id === test.expected; })
    : !result.items.length && !R.blockedSources(corpusJson, test.query, "", result.items).length;
  console.log((pass ? "PASS" : "FAIL") + "  " + test.query);
  if (!pass) failures.push("自然问句检索失败：" + test.query);
});
console.log("\n=== 课程通知 ===");
[
  { query: "我马上要考试了，现在这门课老师有没有说什么时候考试考试考什么？", course: "dsd", expected: ["dsd_course_notice:0", "dsd_course_notice:1"] },
  { query: "期末考什么？", course: "os", expected: ["os_course_notice:1"] },
  { query: "什么时候交作业？", course: "dsd", expected: ["timing_due_current:0"] },
  { query: "作业最晚几点交、要做什么？", course: "os", expected: ["os_course_notice:2", "os_course_notice:3"] },
  { query: "作业要求是什么？", course: "dsd", expected: ["timing_lab_requirements:0"] },
  { query: "什么时候考试？", course: "other", expected: [] },
  { query: "考前复习建立时间", course: "dsd", expected: [] }
].forEach(function (test) {
  var topics = R.noticeTopics(test.query);
  var actual = R.courseNotices(corpusJson, test.course, topics).map(function (notice) { return notice.id; });
  var pass = JSON.stringify(actual) === JSON.stringify(test.expected);
  console.log((pass ? "PASS" : "FAIL") + "  " + test.query + " " + actual.join(", "));
  if (!pass) failures.push("课程通知失败：" + test.query + " / " + test.course);
});

console.log("\n=== 汇总 ===");
console.log(JSON.stringify({
  passed: report.passed,
  recall_at_3: report.recall_at_3,
  recall_at_8: report.recall_at_8,
  fixture_sources: report.fixture_sources,
  queries: report.queries,
  negative_quotes_rejected: report.negative_quotes_rejected,
  model_calls: report.model_calls
}, null, 2));

if (failures.length) {
  console.error("\nFAILED:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
