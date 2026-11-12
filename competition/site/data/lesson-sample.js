/* Original fictional lesson. Timecodes refer to the sample transcript only. */
globalThis.BUXUE_LESSON = {
  id: "songzhen27",
  course: "dsd",
  title: "松针-27 · 读懂时序波形",
  description: "从同一张波形读出采样沿前后的稳定时长，分别检查建立时间和保持时间，再用两道变式巩固。",
  question: "松针-27 的建立时间和保持时间各满足吗？",
  topics: [
    { title: "从波形定位采样沿", evidence: "timing_lab:0", start: 38, end: 54,
      quote: "先在时钟线上找到 8 ns 的上升沿。往前看，D 在 7 ns 变为稳定；往后看，D 在 9.5 ns 再次变化。" },
    { title: "分别检查沿前和沿后", evidence: "timing_lab:1", start: 72, end: 92,
      quote: "沿前能用的是 8 减 7，只有 1 ns，建立时间少了 1 ns。沿后看下一次数据变化，是 9.5 减 8，得到 1.5 ns。" },
    { title: "变式一：把 D 的变化提前", evidence: "timing_lab:2", start: 121, end: 136,
      quote: "如果把 D 变稳的时刻提前到 6 ns，沿前正好有 2 ns。采样沿和沿后的数据变化都按原例读。" },
    { title: "变式二：只在沿后少半纳秒", evidence: "timing_lab:3", start: 155, end: 172,
      quote: "这次沿前稳定 2.5 ns，足够了。沿后从 8 ns 到 8.5 ns，只有 0.5 ns，保持时间还差 0.5 ns。" }
  ],
  themes: [
    { title: "定位时钟和数据变化", topic_indices: [0] },
    { title: "计算两个稳定窗口", topic_indices: [1] },
    { title: "改变时刻再检查", topic_indices: [2, 3] }
  ]
};
